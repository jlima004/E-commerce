import type {
  PaymentAttemptSqlConnection,
  PaymentAttemptSqlTransaction,
} from "../modules/payment-attempt/transactional-authority"
import {
  recordProviderCanceledConfirmedInTransaction,
  recordDurableReconciliationInTransaction,
  claimProviderDiscoveryInTransaction,
  bindProviderPaymentIntentInTransaction,
} from "../modules/payment-attempt/transactional-authority"
import {
  discoverPaymentIntentsByPaymentAttemptId,
  type StripePaymentIntentsClient,
} from "../modules/payment-attempt/stripe-real"
import {
  RECONCILIATION_REASON_CODE,
  type ReconciliationReasonCode,
} from "./reason-codes"

import type { StripePaymentIntentLike } from "../modules/payment-attempt/stripe-safe"

export const RECONCILIATION_LEASE_DURATION_MS = 15 * 60_000 // 15 minutes
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 50

export type StripePaymentIntentsClientLike = {
  retrieve?: (id: string) => Promise<{
    id: string
    status: string
    amount?: number
    currency?: string
    metadata?: Record<string, string | null>
    amount_received?: number
  }>
  search?: (
    params: { query: string; limit?: number; page?: string },
    options?: unknown
  ) => Promise<{
    data: StripePaymentIntentLike[]
    has_more: boolean
    next_page?: string | null
  }>
}

export type PaymentAttemptReconcilerDeps = {
  connection: PaymentAttemptSqlConnection
  stripeClient?: StripePaymentIntentsClientLike
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void
    warn?: (msg: string, meta?: Record<string, unknown>) => void
    error?: (msg: string, meta?: Record<string, unknown>) => void
  }
  now?: () => Date
  leaseDurationMs?: number
  batchSize?: number
  container?: any
  runOrderEntrypoint?: (
    container: any,
    input: {
      payment_attempt_id: string
      payment_intent_id: string
      correlation_id?: string | null
    }
  ) => Promise<{
    status: string
    order_id: string | null
  }>
}

export type PaymentAttemptReconcilerResult = {
  scanned: number
  thawed: number
  reconciled: number
  skipped: number
  errors: number
}

export type CandidateAttemptRow = {
  id: string
  cart_id: string
  provider_payment_intent_id: string | null
  status: string
  financial_freeze_started_at: string | null
  provider_canceled_confirmed_at: string | null
  reconciliation_reason_code: string | null
  reconciliation_locked_at: string | null
  order_id: string | null
  amount?: number
  currency_code?: string
  payment_method_type?: string
  metadata?: Record<string, unknown> | null
}

export async function releasePaymentAttemptReconciliationLease(
  connectionOrTrx: PaymentAttemptSqlConnection | PaymentAttemptSqlTransaction,
  attemptId: string
): Promise<void> {
  const execute = async (trx: PaymentAttemptSqlTransaction): Promise<void> => {
    await trx.raw(
      `
        update payment_attempt
        set reconciliation_locked_at = null,
            last_reconciliation_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        where id = ?
      `,
      [attemptId]
    )
  }

  if (
    typeof (connectionOrTrx as PaymentAttemptSqlConnection).transaction ===
    "function"
  ) {
    await (connectionOrTrx as PaymentAttemptSqlConnection).transaction(execute)
  } else {
    await execute(connectionOrTrx as PaymentAttemptSqlTransaction)
  }
}

export async function releaseLeaseWithReason(
  connectionOrTrx: PaymentAttemptSqlConnection | PaymentAttemptSqlTransaction,
  attemptId: string,
  reasonCode: string
): Promise<void> {
  const execute = async (trx: PaymentAttemptSqlTransaction): Promise<void> => {
    await trx.raw(
      `
        update payment_attempt
        set reconciliation_locked_at = null,
            reconciliation_reason_code = coalesce(reconciliation_reason_code, ?),
            last_reconciliation_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        where id = ?
      `,
      [reasonCode, attemptId]
    )
  }

  if (
    typeof (connectionOrTrx as PaymentAttemptSqlConnection).transaction ===
    "function"
  ) {
    await (connectionOrTrx as PaymentAttemptSqlConnection).transaction(execute)
  } else {
    await execute(connectionOrTrx as PaymentAttemptSqlTransaction)
  }
}

export async function scanPaymentAttemptReconciliationCandidates(
  connectionOrTrx: PaymentAttemptSqlConnection | PaymentAttemptSqlTransaction,
  options?: { leaseDurationMs?: number; batchSize?: number }
): Promise<CandidateAttemptRow[]> {
  const leaseDurationMs =
    options?.leaseDurationMs ?? RECONCILIATION_LEASE_DURATION_MS
  const batchSize = options?.batchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE

  const execute = async (
    trx: PaymentAttemptSqlTransaction
  ): Promise<CandidateAttemptRow[]> => {
    const { rows } = await trx.raw(
      `
        select id, cart_id, provider_payment_intent_id, status,
               financial_freeze_started_at, provider_canceled_confirmed_at,
               reconciliation_reason_code, reconciliation_locked_at, order_id,
               amount, currency_code, payment_method_type, metadata
        from payment_attempt
        where order_id is null
          and (
            (financial_freeze_started_at is not null and provider_canceled_confirmed_at is null)
            or reconciliation_reason_code is not null
          )
          and (
            reconciliation_locked_at is null
            or reconciliation_locked_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 millisecond'))
          )
        order by created_at asc
        limit ?
      `,
      [leaseDurationMs, batchSize]
    )
    return (rows ?? []) as CandidateAttemptRow[]
  }

  if (
    typeof (connectionOrTrx as PaymentAttemptSqlConnection).transaction ===
    "function"
  ) {
    return await (connectionOrTrx as PaymentAttemptSqlConnection).transaction(
      execute
    )
  }
  return await execute(connectionOrTrx as PaymentAttemptSqlTransaction)
}

export async function claimPaymentAttemptReconciliationLease(
  connectionOrTrx: PaymentAttemptSqlConnection | PaymentAttemptSqlTransaction,
  options: { attemptId: string; leaseDurationMs?: number }
): Promise<boolean> {
  const leaseDurationMs =
    options.leaseDurationMs ?? RECONCILIATION_LEASE_DURATION_MS

  const execute = async (
    trx: PaymentAttemptSqlTransaction
  ): Promise<boolean> => {
    const { rows } = await trx.raw(
      `
        update payment_attempt
        set reconciliation_locked_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        where id = ?
          and order_id is null
          and (
            (financial_freeze_started_at is not null and provider_canceled_confirmed_at is null)
            or reconciliation_reason_code is not null
          )
          and (
            reconciliation_locked_at is null
            or reconciliation_locked_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 millisecond'))
          )
        returning id
      `,
      [options.attemptId, leaseDurationMs]
    )
    return Boolean(rows && rows.length > 0)
  }

  if (
    typeof (connectionOrTrx as PaymentAttemptSqlConnection).transaction ===
    "function"
  ) {
    return await (connectionOrTrx as PaymentAttemptSqlConnection).transaction(
      execute
    )
  }
  return await execute(connectionOrTrx as PaymentAttemptSqlTransaction)
}

export async function runPaymentAttemptReconciliation(
  deps: PaymentAttemptReconcilerDeps
): Promise<PaymentAttemptReconcilerResult> {
  const leaseDurationMs =
    deps.leaseDurationMs ?? RECONCILIATION_LEASE_DURATION_MS
  const batchSize = deps.batchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE

  const result: PaymentAttemptReconcilerResult = {
    scanned: 0,
    thawed: 0,
    reconciled: 0,
    skipped: 0,
    errors: 0,
  }

  // 1. Scan candidates using PostgreSQL CURRENT_TIMESTAMP
  let candidates: CandidateAttemptRow[] = []
  try {
    candidates = await scanPaymentAttemptReconciliationCandidates(
      deps.connection,
      { leaseDurationMs, batchSize }
    )
  } catch (error) {
    deps.logger?.error?.("Failed to scan reconciliation candidates", {
      error: error instanceof Error ? error.message : String(error),
    })
    return result
  }

  result.scanned = candidates.length

  for (const candidate of candidates) {
    // 2. Claim lease using PostgreSQL CURRENT_TIMESTAMP
    let claimed = false
    try {
      claimed = await claimPaymentAttemptReconciliationLease(deps.connection, {
        attemptId: candidate.id,
        leaseDurationMs,
      })
    } catch {
      claimed = false
    }

    if (!claimed) {
      result.skipped++
      continue
    }

    // 3. Reconcile claimed attempt
    try {
      // If provider_payment_intent_id is missing, execute R1 provider discovery!
      if (!candidate.provider_payment_intent_id) {
        if (!deps.stripeClient?.search) {
          // No search capability configured -> release lease and skip
          await releasePaymentAttemptReconciliationLease(
            deps.connection,
            candidate.id
          )
          result.skipped++
          continue
        }

        let discoveryClaimed = false
        let boundAttemptIdAfterClaim: string | null = null

        await deps.connection.transaction(async (trx: PaymentAttemptSqlTransaction) => {
          const claimResult = await claimProviderDiscoveryInTransaction(
            trx,
            candidate.id
          )
          discoveryClaimed = claimResult.claimed
          boundAttemptIdAfterClaim =
            claimResult.attempt?.provider_payment_intent_id ?? null
        })

        if (!discoveryClaimed) {
          if (boundAttemptIdAfterClaim) {
            candidate.provider_payment_intent_id = boundAttemptIdAfterClaim
          } else {
            // Concurrent discovery already active by another worker
            await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
            result.skipped++
            continue
          }
        } else {
          // Owns discovery -> execute R1 discovery algorithm
          const discoveryResult =
            await discoverPaymentIntentsByPaymentAttemptId(
              deps.stripeClient as StripePaymentIntentsClient,
              candidate.id
            )

          if (discoveryResult.unresolved) {
            // D1: 0 matches -> remains frozen, reason = PROVIDER_DISCOVERY_UNRESOLVED
            await releaseLeaseWithReason(
              deps.connection,
              candidate.id,
              RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
            )
            result.reconciled++
            continue
          }

          if (
            "reconciliation_required" in discoveryResult &&
            discoveryResult.reconciliation_required
          ) {
            // D3: >1 matches -> material conflict, remains frozen, reason = RECONCILIATION_REQUIRED
            await releaseLeaseWithReason(
              deps.connection,
              candidate.id,
              RECONCILIATION_REASON_CODE.RECONCILIATION_REQUIRED
            )
            result.reconciled++
            continue
          }

          // D2: exactly 1 match -> validate against authority v1 and CAS bind
          const singleMatch = discoveryResult.matches[0]
          const matchIntentId = String(singleMatch?.id ?? "")
          const matchMetadata = ((singleMatch?.metadata as Record<string, unknown>) ??
            {}) as Record<string, unknown>
          const matchSessionId =
            typeof matchMetadata.session_id === "string"
              ? matchMetadata.session_id
              : null

          try {
            await deps.connection.transaction(async (trx: PaymentAttemptSqlTransaction) => {
              const bindResult = await bindProviderPaymentIntentInTransaction(
                trx,
                {
                  payment_attempt_id: candidate.id,
                  cart_id: candidate.cart_id,
                  amount_minor: candidate.amount ? Number(candidate.amount) : 0,
                  currency_code: (candidate.currency_code ?? "brl") as "brl",
                  payment_method_type: candidate.payment_method_type as any,
                  provider_payment_intent_id: matchIntentId,
                  provider_payment_session_id: matchSessionId,
                  payment_intent: singleMatch,
                }
              )
              candidate.provider_payment_intent_id =
                bindResult.attempt.provider_payment_intent_id
            })
          } catch (bindErr) {
            deps.logger?.warn?.(
              "CAS bind failed for discovered PaymentIntent",
              {
                attempt_id: candidate.id,
                payment_intent_id: matchIntentId,
                error:
                  bindErr instanceof Error
                    ? bindErr.message
                    : String(bindErr),
              }
            )
            await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
            result.errors++
            continue
          }
        }
      }

      if (!deps.stripeClient?.retrieve) {
        // No retrieve capability provided -> release lease
        await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
        result.skipped++
        continue
      }

      const pi = await deps.stripeClient.retrieve(
        candidate.provider_payment_intent_id!
      )

      if (pi.status === "canceled") {
        // Provider canceled -> authoritative thaw
        await deps.connection.transaction(async (trx: PaymentAttemptSqlTransaction) => {
          await recordProviderCanceledConfirmedInTransaction(
            trx,
            {
              paymentAttemptId: candidate.id,
              cartId: candidate.cart_id,
              providerPaymentIntentId: pi.id,
            }
          )
        })
        await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
        deps.logger?.info?.("Payment attempt thawed by reconciler", {
          payment_attempt_id: candidate.id,
          payment_intent_id: pi.id,
        })
        result.thawed++
      } else if (pi.status === "succeeded") {
        if (!candidate.order_id && deps.container && deps.runOrderEntrypoint) {
          try {
            const orderResult = await deps.runOrderEntrypoint(deps.container, {
              payment_attempt_id: candidate.id,
              payment_intent_id: pi.id,
              correlation_id: candidate.id,
            })

            if (orderResult.order_id) {
              candidate.order_id = orderResult.order_id
              await releasePaymentAttemptReconciliationLease(
                deps.connection,
                candidate.id
              )
              deps.logger?.info?.(
                "Payment attempt order created/recovered by reconciler",
                {
                  payment_attempt_id: candidate.id,
                  payment_intent_id: pi.id,
                  order_id: orderResult.order_id,
                }
              )
              result.reconciled++
              continue
            }
          } catch (orderErr) {
            deps.logger?.warn?.(
              "Order entrypoint execution failed during reconciliation",
              {
                payment_attempt_id: candidate.id,
                payment_intent_id: pi.id,
                error:
                  orderErr instanceof Error
                    ? orderErr.message
                    : String(orderErr),
              }
            )
          }
        }

        // Provider succeeded but no order recovered -> record durable reconciliation consequence
        await deps.connection.transaction(async (trx: PaymentAttemptSqlTransaction) => {
          await recordDurableReconciliationInTransaction(
            trx,
            {
              paymentAttemptId: candidate.id,
              cartId: candidate.cart_id,
              paymentIntentId: pi.id,
              reasonCode:
                RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT,
            }
          )
        })
        await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
        deps.logger?.info?.(
          "Payment attempt marked reconciliation_required by reconciler",
          {
            payment_attempt_id: candidate.id,
            payment_intent_id: pi.id,
          }
        )
        result.reconciled++
      } else {
        // Open/pending status at provider -> keep frozen, release lease
        await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
        result.skipped++
      }
    } catch (error) {
      // Release lease on error so attempt remains frozen but retriable
      try {
        await releasePaymentAttemptReconciliationLease(deps.connection, candidate.id)
      } catch {
        // ignore lease release error
      }

      deps.logger?.error?.("Error reconciling payment attempt", {
        payment_attempt_id: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      })
      result.errors++
    }
  }

  return result
}
