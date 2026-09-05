import {
  applyStripePaymentIntentWebhookToAttempt,
  PaymentAttemptWebhookError,
  type StripePaymentIntentWebhookObject,
  type SupportedStripePaymentIntentEventType,
} from "./service"
import {
  ACTIVE_PAYMENT_ATTEMPT_STATUSES,
} from "./state-machine"
import type { PaymentAttemptRecord } from "./types"
import { readDurablePaymentAttemptIdentity } from "./durable-initiation"
import {
  isUnresolvedFinancialFreeze,
  toPaymentAttemptFinancialAuthority,
} from "./financial-authority"
import {
  assertValidPreProviderCartResourceVersion,
  isStripePaymentIntentCreateAuthorityV1,
  persistedRequestAuthorityDisagrees,
  readFrozenAttemptDurableIdempotencyKey,
  readPersistedRequestAuthorityBlob,
  readPreProviderCartResourceVersion,
  resolveRequestedIdempotencyKey,
  type DurablePreProviderAuthority,
  type PersistPreProviderFinancialFreezeInput,
} from "./pre-provider-arbitration"
import {
  assertCompleteStripePaymentIntentCreateAuthorityV1,
  assertStripePaymentIntentMatchesAuthorityV1,
  buildStripeCanonicalPaymentIntentCreateRequest,
  digestStripeCanonicalPaymentIntentCreateRequest,
  PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE,
} from "./provider-request-authority"
import type { StripePaymentIntentLike } from "./stripe-safe"
import {
  RECONCILIATION_REASON_CODE,
  type ReconciliationReasonCode,
} from "../../reconciliation/reason-codes"

export type PaymentAttemptSqlTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

export type PaymentAttemptSqlConnection = {
  transaction<T>(callback: (trx: PaymentAttemptSqlTransaction) => Promise<T>): Promise<T>
}

export const PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS =
  "PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS"
export const PAYMENT_ATTEMPT_ORDER_AUTHORITY_UNAVAILABLE =
  "PAYMENT_ATTEMPT_ORDER_AUTHORITY_UNAVAILABLE"
export const PAYMENT_ATTEMPT_CART_VERSION_UNBOUND =
  "PAYMENT_ATTEMPT_CART_VERSION_UNBOUND"
export const PAYMENT_ATTEMPT_CART_VERSION_STALE =
  "PAYMENT_ATTEMPT_CART_VERSION_STALE"
export const PAYMENT_ATTEMPT_NOT_FOUND = "PAYMENT_ATTEMPT_NOT_FOUND"
export const PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH =
  "PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH"
export const PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH =
  "PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH"
export const PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE =
  "PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE"
export const PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT =
  "PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT"
export { PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE }

const ACTIVE_STATUS_BINDINGS = ACTIVE_PAYMENT_ATTEMPT_STATUSES.map(() => "?").join(
  ", "
)

const PAYMENT_ATTEMPT_COLUMNS = [
  "id",
  "cart_id",
  "payment_collection_id",
  "payment_session_id",
  "provider",
  "provider_payment_intent_id",
  "provider_payment_session_id",
  "payment_method_type",
  "status",
  "amount",
  "currency_code",
  "expires_at",
  "order_id",
  "metadata",
  "client_confirmed_at",
  "instructions_displayed_at",
  "awaiting_webhook_since",
  "superseded_at",
  "invalidated_at",
  "canceled_at",
  "failed_at",
  "expired_at",
  "financial_freeze_started_at",
  "provider_canceled_confirmed_at",
  "provider_discovery_started_at",
  "reconciliation_reason_code",
  "reconciliation_locked_at",
  "last_reconciliation_at",
  "created_at",
  "updated_at",
] as const

function queryRows(
  transaction: PaymentAttemptSqlTransaction,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  return transaction.raw(sql, bindings).then((result) => result.rows ?? [])
}

function readNullableDate(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null
}

function mapPaymentAttemptRow(row: Record<string, unknown>): PaymentAttemptRecord {
  const metadata = row.metadata

  return {
    id: String(row.id),
    cart_id: String(row.cart_id),
    payment_collection_id: String(row.payment_collection_id),
    payment_session_id:
      row.payment_session_id === null || row.payment_session_id === undefined
        ? null
        : String(row.payment_session_id),
    provider: String(row.provider),
    provider_payment_intent_id:
      row.provider_payment_intent_id === null ||
      row.provider_payment_intent_id === undefined
        ? null
        : String(row.provider_payment_intent_id),
    provider_payment_session_id:
      row.provider_payment_session_id === null ||
      row.provider_payment_session_id === undefined
        ? null
        : String(row.provider_payment_session_id),
    payment_method_type: row.payment_method_type as PaymentAttemptRecord["payment_method_type"],
    status: row.status as PaymentAttemptRecord["status"],
    amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
    currency_code: String(row.currency_code),
    expires_at: readNullableDate(row.expires_at),
    order_id: row.order_id === null || row.order_id === undefined ? null : String(row.order_id),
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null,
    client_confirmed_at: readNullableDate(row.client_confirmed_at),
    instructions_displayed_at: readNullableDate(row.instructions_displayed_at),
    awaiting_webhook_since: readNullableDate(row.awaiting_webhook_since),
    superseded_at: readNullableDate(row.superseded_at),
    invalidated_at: readNullableDate(row.invalidated_at),
    canceled_at: readNullableDate(row.canceled_at),
    failed_at: readNullableDate(row.failed_at),
    expired_at: readNullableDate(row.expired_at),
    financial_freeze_started_at: readNullableDate(row.financial_freeze_started_at),
    provider_canceled_confirmed_at: readNullableDate(row.provider_canceled_confirmed_at),
    provider_discovery_started_at: readNullableDate(row.provider_discovery_started_at),
    reconciliation_reason_code:
      row.reconciliation_reason_code === null || row.reconciliation_reason_code === undefined
        ? null
        : (String(row.reconciliation_reason_code) as PaymentAttemptRecord["reconciliation_reason_code"]),
    reconciliation_locked_at: readNullableDate(row.reconciliation_locked_at),
    last_reconciliation_at: readNullableDate(row.last_reconciliation_at),
    created_at: readNullableDate(row.created_at) ?? undefined,
    updated_at: readNullableDate(row.updated_at) ?? undefined,
  }
}

function selectColumns(): string {
  return PAYMENT_ATTEMPT_COLUMNS.join(", ")
}

/**
 * All cart mutation, webhook transition and Order authority paths acquire this
 * transaction-scoped PostgreSQL lock before touching PaymentAttempt state.
 * hashtextextended keeps the lock key opaque and avoids putting IDs in logs.
 */
export async function lockCartOrderAuthority(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string
): Promise<void> {
  await transaction.raw(
    "select pg_advisory_xact_lock(hashtextextended(?, 1515))",
    [cartId]
  )
}

export async function readPaymentAttemptForUpdate(
  transaction: PaymentAttemptSqlTransaction,
  input:
    | { id: string }
    | { provider_payment_intent_id: string },
  forUpdate = true
): Promise<PaymentAttemptRecord | null> {
  const key = "id" in input ? "id" : "provider_payment_intent_id"
  const rows = await queryRows(
    transaction,
    `select ${selectColumns()} from payment_attempt where ${key} = ? and deleted_at is null${forUpdate ? " for update" : ""}`,
    [input[key]]
  )
  return rows[0] ? mapPaymentAttemptRow(rows[0]) : null
}

export async function readCartResourceVersionForUpdate(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  forUpdate = true
): Promise<number | null> {
  const rows = await queryRows(
    transaction,
    `
      select version
      from store_resource_version
      where resource_type = 'cart' and resource_id = ? and deleted_at is null
      ${forUpdate ? "for update" : ""}
    `,
    [cartId]
  )
  return rows[0] ? Number(rows[0].version) : null
}

export function readPaymentAttemptCartResourceVersion(
  attempt: Pick<PaymentAttemptRecord, "metadata">
): number | null {
  const value = attempt.metadata?.cart_resource_version
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export function assertPaymentAttemptCartResourceVersion(
  attempt: Pick<PaymentAttemptRecord, "metadata">,
  currentVersion: number | null
): void {
  const boundVersion = readPaymentAttemptCartResourceVersion(attempt)

  if (boundVersion === null) {
    throw new Error(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)
  }

  if (currentVersion === null || boundVersion !== currentVersion) {
    throw new Error(PAYMENT_ATTEMPT_CART_VERSION_STALE)
  }
}

export async function invalidatePaymentAttemptsForCartChangeInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  at: Date
): Promise<PaymentAttemptRecord[]> {
  await lockCartOrderAuthority(transaction, cartId)

  const locked = await queryRows(
    transaction,
    `
      select ${selectColumns()}
      from payment_attempt
      where cart_id = ? and deleted_at is null
      order by id
      for update
    `,
    [cartId]
  )
  const attempts = locked.map(mapPaymentAttemptRow)
  const active = attempts.filter((attempt) =>
    ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(attempt.status)
  )

  if (active.some((attempt) => attempt.order_id !== null)) {
    throw new Error(PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS)
  }

  if (active.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }

  if (active.length === 0) {
    return []
  }

  const updated = await queryRows(
    transaction,
    `
      update payment_attempt
      set status = 'invalidated_by_cart_change',
          invalidated_at = ?,
          order_id = null,
          updated_at = ?
      where id = ?
        and cart_id = ?
        and deleted_at is null
        and order_id is null
        and status in (${ACTIVE_STATUS_BINDINGS})
      returning ${selectColumns()}
    `,
    [
      at.toISOString(),
      at.toISOString(),
      active[0].id,
      cartId,
      ...ACTIVE_PAYMENT_ATTEMPT_STATUSES,
    ]
  )

  if (updated.length !== 1) {
    throw new Error("PAYMENT_ATTEMPT_INVALIDATION_CAS_FAILED")
  }

  return [mapPaymentAttemptRow(updated[0])]
}

export async function applyStripePaymentIntentWebhookInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  paymentIntent: StripePaymentIntentWebhookObject,
  eventType: SupportedStripePaymentIntentEventType,
  at: Date
): Promise<PaymentAttemptRecord> {
  const providerRows = await queryRows(
    transaction,
    `select ${selectColumns()} from payment_attempt where provider_payment_intent_id = ? and deleted_at is null`,
    [paymentIntent.id]
  )
  if (providerRows.length > 1) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CORRELATION_CONFLICT",
      "Mais de uma tentativa corresponde ao PaymentIntent."
    )
  }

  const durableAttemptId = readDurablePaymentAttemptIdentity(
    paymentIntent.metadata
  )
  const durableRows = durableAttemptId
    ? await queryRows(
        transaction,
        `select ${selectColumns()} from payment_attempt where id = ? and deleted_at is null`,
        [durableAttemptId]
      )
    : []

  if (durableRows.length > 1) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CORRELATION_CONFLICT",
      "Mais de uma tentativa corresponde à identidade duravel."
    )
  }

  const providerAttempt = providerRows[0]
    ? mapPaymentAttemptRow(providerRows[0])
    : null
  const durableAttempt = durableRows[0]
    ? mapPaymentAttemptRow(durableRows[0])
    : null

  if (durableAttemptId && !durableAttempt) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CORRELATION_MISMATCH",
      "Identidade da tentativa nao encontrada."
    )
  }

  if (
    providerAttempt &&
    durableAttempt &&
    providerAttempt.id !== durableAttempt.id
  ) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CORRELATION_MISMATCH",
      "As identidades do PaymentIntent nao correspondem à mesma tentativa."
    )
  }

  const unlocked = durableAttempt ?? providerAttempt

  if (!unlocked) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada para o PaymentIntent."
    )
  }

  const cartId = unlocked.cart_id
  await lockCartOrderAuthority(transaction, cartId)
  const attempt = await readPaymentAttemptForUpdate(transaction, {
    id: unlocked.id,
  })

  if (!attempt) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada para o PaymentIntent."
    )
  }

  if (attempt.id !== unlocked.id) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CORRELATION_MISMATCH",
      "Tentativa mudou durante a correlacao do webhook."
    )
  }

  let updatedAttempt: PaymentAttemptRecord
  try {
    updatedAttempt = applyStripePaymentIntentWebhookToAttempt(
      attempt,
      paymentIntent,
      eventType,
      at
    )
  } catch (error) {
    if (
      eventType === "payment_intent.succeeded" &&
      error instanceof PaymentAttemptWebhookError &&
      error.code === "PAYMENT_ATTEMPT_LATE_SUCCEEDED_CONFLICT"
    ) {
      return recordDurableReconciliationInTransaction(
        transaction,
        {
          paymentAttemptId: attempt.id,
          cartId: attempt.cart_id,
          paymentIntentId: String(paymentIntent.id),
          reasonCode: RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT,
          errorCode: "LATE_SUCCEEDED_AUTHORITY_CONFLICT",
          errorMessage:
            "Pagamento confirmado pelo Stripe em estado local conflitante.",
          skipCartLock: true,
        },
        at
      )
    }
    throw error
  }

  if (
    eventType === "payment_intent.canceled" &&
    attempt.provider_canceled_confirmed_at != null
  ) {
    return attempt
  }

  if (
    eventType !== "payment_intent.canceled" &&
    updatedAttempt.status === attempt.status
  ) {
    return attempt
  }

  const isFailed = eventType === "payment_intent.payment_failed"
  const isCanceled = eventType === "payment_intent.canceled"
  const paymentSessionId =
    typeof paymentIntent.metadata?.session_id === "string" &&
    paymentIntent.metadata.session_id.trim().length > 0
      ? paymentIntent.metadata.session_id.trim()
      : null
  const rows = await queryRows(
    transaction,
    `
      update payment_attempt
      set provider_payment_intent_id = ?,
          provider_payment_session_id = coalesce(provider_payment_session_id, ?),
          status = ?,
          ${isFailed ? "failed_at = coalesce(failed_at, ?)," : ""}
          ${isCanceled ? "canceled_at = coalesce(canceled_at, CURRENT_TIMESTAMP), provider_canceled_confirmed_at = coalesce(provider_canceled_confirmed_at, CURRENT_TIMESTAMP)," : ""}
          order_id = null,
          updated_at = ${isCanceled ? "CURRENT_TIMESTAMP" : "?"}
      where id = ?
        and cart_id = ?
        and (provider_payment_intent_id is null or provider_payment_intent_id = ?)
        and deleted_at is null
        and order_id is null
        and (status = ? or (status = 'payment_canceled' and ? = 'payment_intent.canceled'))
      returning ${selectColumns()}
    `,
    [
      paymentIntent.id,
      paymentSessionId,
      updatedAttempt.status,
      ...(isFailed ? [at.toISOString()] : []),
      ...(isCanceled ? [] : [at.toISOString()]),
      attempt.id,
      attempt.cart_id,
      paymentIntent.id,
      attempt.status,
      eventType,
    ]
  )

  if (rows.length !== 1) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_WEBHOOK_STALE",
      "Tentativa nao pode ser atualizada pelo webhook atual.",
      "ignored"
    )
  }

  return mapPaymentAttemptRow(rows[0])
}

export async function recordProviderCanceledConfirmedInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  input: {
    paymentAttemptId: string
    cartId: string
    providerPaymentIntentId: string
  },
  at: Date = new Date()
): Promise<{ updated: boolean; attempt: PaymentAttemptRecord }> {
  await lockCartOrderAuthority(transaction, input.cartId)
  const attempt = await readPaymentAttemptForUpdate(transaction, {
    id: input.paymentAttemptId,
  })

  if (!attempt) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }

  if (attempt.cart_id !== input.cartId) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  if (
    attempt.provider_payment_intent_id &&
    attempt.provider_payment_intent_id !== input.providerPaymentIntentId
  ) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  if (attempt.provider_canceled_confirmed_at != null) {
    return { updated: false, attempt }
  }

  const rows = await queryRows(
    transaction,
    `
      update payment_attempt
      set provider_canceled_confirmed_at = coalesce(provider_canceled_confirmed_at, CURRENT_TIMESTAMP),
          status = case
            when status in ('payment_canceled', 'created', 'provider_session_created', 'client_action_required', 'card_client_secret_created', 'payment_client_confirmed', 'payment_instructions_displayed', 'awaiting_pix_payment', 'awaiting_webhook_confirmation', 'pix_expired', 'payment_failed')
            then 'payment_canceled'
            else status
          end,
          canceled_at = coalesce(canceled_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      where id = ?
        and cart_id = ?
        and (provider_payment_intent_id is null or provider_payment_intent_id = ?)
        and order_id is null
        and provider_canceled_confirmed_at is null
      returning ${selectColumns()}
    `,
    [
      attempt.id,
      attempt.cart_id,
      input.providerPaymentIntentId,
    ]
  )

  if (rows.length !== 1) {
    const reread = await readPaymentAttemptForUpdate(transaction, {
      id: input.paymentAttemptId,
    })
    if (reread?.provider_canceled_confirmed_at != null) {
      return { updated: false, attempt: reread }
    }
    throw new Error("PAYMENT_ATTEMPT_THAW_CAS_FAILED")
  }

  return { updated: true, attempt: mapPaymentAttemptRow(rows[0]) }
}

export async function recordDurableReconciliationInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  input: {
    paymentAttemptId: string
    cartId: string
    paymentIntentId: string
    reasonCode: ReconciliationReasonCode
    errorCode?: string
    errorMessage?: string
    skipCartLock?: boolean
  },
  at: Date = new Date()
): Promise<PaymentAttemptRecord> {
  if (!input.skipCartLock) {
    await lockCartOrderAuthority(transaction, input.cartId)
  }

  // 1. Update PaymentAttempt
  const rows = await queryRows(
    transaction,
    `
      update payment_attempt
      set provider_payment_intent_id = coalesce(provider_payment_intent_id, ?),
          reconciliation_reason_code = ?,
          last_reconciliation_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      where id = ?
        and cart_id = ?
        and order_id is null
      returning ${selectColumns()}
    `,
    [
      input.paymentIntentId,
      input.reasonCode,
      input.paymentAttemptId,
      input.cartId,
    ]
  )

  // 2. Persist or update CheckoutCompletionLog
  const existingCcl = await queryRows(
    transaction,
    `
      select id from checkout_completion_log
      where payment_intent_id = ?
      limit 1
    `,
    [input.paymentIntentId]
  )

  if (existingCcl.length > 0) {
    await queryRows(
      transaction,
      `
        update checkout_completion_log
        set status = 'reconciliation_required',
            reconciliation_reason_code = ?,
            last_reconciliation_at = CURRENT_TIMESTAMP,
            error_code = ?,
            error_message = ?,
            updated_at = CURRENT_TIMESTAMP
        where id = ?
          and order_id is null
      `,
      [
        input.reasonCode,
        input.errorCode ?? input.reasonCode,
        input.errorMessage ?? "Reconciliação requerida para o pagamento confirmado.",
        existingCcl[0].id,
      ]
    )
  } else {
    const cclId = `chkcpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    await queryRows(
      transaction,
      `
        insert into checkout_completion_log (
          id,
          operation,
          idempotency_key,
          cart_id,
          payment_intent_id,
          payment_attempt_id,
          status,
          reconciliation_reason_code,
          last_reconciliation_at,
          error_code,
          error_message,
          created_at,
          updated_at
        ) values (
          ?,
          'complete_checkout_create_order',
          ?,
          ?,
          ?,
          ?,
          'reconciliation_required',
          ?,
          CURRENT_TIMESTAMP,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
      [
        cclId,
        input.paymentIntentId,
        input.cartId,
        input.paymentIntentId,
        input.paymentAttemptId,
        input.reasonCode,
        input.errorCode ?? input.reasonCode,
        input.errorMessage ?? "Reconciliação requerida para o pagamento confirmado.",
      ]
    )
  }

  if (rows.length > 0) {
    return mapPaymentAttemptRow(rows[0])
  }

  const attempt = await readPaymentAttemptForUpdate(transaction, {
    id: input.paymentAttemptId,
  })
  if (!attempt) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }
  return attempt
}

export async function withCartOrderAuthorityLock<T>(
  connection: PaymentAttemptSqlConnection,
  paymentAttemptId: string,
  callback: (input: {
    transaction: PaymentAttemptSqlTransaction
    attempt: PaymentAttemptRecord
    currentCartResourceVersion: number | null
  }) => Promise<T>
): Promise<T> {
  return connection.transaction(async (transaction) => {
    const unlocked = await queryRows(
      transaction,
      `select cart_id from payment_attempt where id = ? and deleted_at is null`,
      [paymentAttemptId]
    )
    if (unlocked.length !== 1) {
      throw new Error("PAYMENT_ATTEMPT_NOT_FOUND")
    }

    const cartId = String(unlocked[0].cart_id)
    await lockCartOrderAuthority(transaction, cartId)
    // The advisory lock serializes this authority check with cart mutation and
    // webhook transitions. Do not retain row locks while the callback invokes
    // Medusa modules, because those modules may use another DB connection.
    const attempt = await readPaymentAttemptForUpdate(
      transaction,
      { id: paymentAttemptId },
      false
    )
    if (!attempt) {
      throw new Error("PAYMENT_ATTEMPT_NOT_FOUND")
    }

    return callback({
      transaction,
      attempt,
      currentCartResourceVersion: await readCartResourceVersionForUpdate(
        transaction,
        cartId,
        false
      ),
    })
  })
}

export function buildListUnresolvedFrozenPaymentAttemptsForCartSql(
  forUpdate = true
): string {
  return `
      select ${selectColumns()}
      from payment_attempt
      where cart_id = ?
        and financial_freeze_started_at is not null
        and provider_canceled_confirmed_at is null
        and order_id is null
      order by id
      ${forUpdate ? "for update" : ""}
    `
}

export function buildReadPaymentAttemptByIdForAuthoritySql(
  forUpdate = false
): string {
  return `select ${selectColumns()} from payment_attempt where id = ?${forUpdate ? " for update" : ""}`
}

export function buildPersistPreProviderFinancialFreezeSql(): string {
  return `
      update payment_attempt
      set
        financial_freeze_started_at = coalesce(financial_freeze_started_at, CURRENT_TIMESTAMP),
        payment_collection_id = coalesce(?, payment_collection_id),
        payment_session_id = coalesce(?, payment_session_id),
        metadata = jsonb_set(
          coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'cart_resource_version', cast(? as integer),
            'provider_idempotency_key', cast(? as text),
            'payment_attempt_id', id
          ),
          '{stripe_payment_intent_create}',
          case
            when coalesce(metadata, '{}'::jsonb) -> 'stripe_payment_intent_create' ->> 'schema' = 'stripe_payment_intent_create'
             and coalesce(metadata, '{}'::jsonb) -> 'stripe_payment_intent_create' ->> 'version' = '1'
            then coalesce(metadata -> 'stripe_payment_intent_create', '{}'::jsonb)
            else jsonb_build_object(
              'schema', 'stripe_payment_intent_create',
              'version', 1,
              'operation', 'stripe_payment_intent_create',
              'provider', 'stripe',
              'authority_created_at', to_char((CURRENT_TIMESTAMP at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'payment_method_type', payment_method_type,
              'amount_minor', amount,
              'currency_code', 'brl',
              'cart_id', cart_id,
              'cart_resource_version', cast(? as integer),
              'payment_attempt_id', id,
              'payment_collection_id', coalesce(to_jsonb(cast(coalesce(?, payment_collection_id) as text)), 'null'::jsonb),
              'payment_session_id', coalesce(to_jsonb(cast(coalesce(?, payment_session_id) as text)), 'null'::jsonb),
              'idempotency_key', cast(? as text),
              'provider_payment_intent_id', 'null'::jsonb,
              'canonical_request', cast(? as jsonb),
              'request_digest', cast(? as text),
              'replay_deadline', to_char(((CURRENT_TIMESTAMP + interval '23 hours') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ) || case
              when payment_method_type = 'pix' then jsonb_build_object(
                'payment_method_options', jsonb_build_object(
                  'pix', jsonb_build_object('expires_after_seconds', 86400)
                )
              )
              else '{}'::jsonb
            end
          end,
          true
        ),
        updated_at = CURRENT_TIMESTAMP
      where id = ?
        and cart_id = ?
        and payment_method_type = ?
        and amount = ?
        and currency_code = ?
      returning ${selectColumns()}
    `
}

export function buildBindProviderPaymentIntentSql(): string {
  return `
      update payment_attempt
      set
        provider_payment_intent_id = ?,
        provider_payment_session_id = coalesce(provider_payment_session_id, ?),
        updated_at = CURRENT_TIMESTAMP
      where id = ?
        and cart_id = ?
        and (provider_payment_intent_id is null or provider_payment_intent_id = ?)
        and amount = ?
        and currency_code = ?
        and payment_method_type = ?
        and financial_freeze_started_at is not null
        and provider_canceled_confirmed_at is null
        and order_id is null
      returning ${selectColumns()}
    `
}

export function buildClaimProviderDiscoverySql(): string {
  return `
      update payment_attempt
      set
        provider_discovery_started_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      where id = ?
        and provider_discovery_started_at is null
      returning ${selectColumns()}
    `
}

export function buildSameOperationReplayEligibleSql(): string {
  return `
      select
        (CURRENT_TIMESTAMP < (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz) as eligible
      from payment_attempt
      where id = ?
    `
}

export {
  PRE_PROVIDER_ARBITRATION_DECISION,
  arbitratePreProviderPaymentAttempt,
} from "./pre-provider-arbitration"
export type {
  DurablePreProviderAuthority,
  PersistPreProviderFinancialFreezeInput,
  PreProviderArbitrationResult,
  PreProviderRequestedOperation,
} from "./pre-provider-arbitration"

function optionalProvidedText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readDurableMedusaIdentityText(
  value: string | null | undefined
): string | null {
  if (value == null) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === "null") {
    return null
  }
  return trimmed
}

async function readPaymentAttemptByIdForAuthority(
  transaction: PaymentAttemptSqlTransaction,
  paymentAttemptId: string,
  forUpdate = false
): Promise<PaymentAttemptRecord | null> {
  const rows = await queryRows(
    transaction,
    buildReadPaymentAttemptByIdForAuthoritySql(forUpdate),
    [paymentAttemptId]
  )
  return rows[0] ? mapPaymentAttemptRow(rows[0]) : null
}

export async function listUnresolvedFrozenPaymentAttemptsForCart(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  options: { forUpdate?: boolean } = {}
): Promise<PaymentAttemptRecord[]> {
  const forUpdate = options.forUpdate !== false
  const rows = await queryRows(
    transaction,
    buildListUnresolvedFrozenPaymentAttemptsForCartSql(forUpdate),
    [cartId]
  )
  return rows
    .map(mapPaymentAttemptRow)
    .filter((attempt) =>
      isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(attempt))
    )
}

export async function persistPreProviderFinancialFreezeInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  input: PersistPreProviderFinancialFreezeInput
): Promise<PaymentAttemptRecord> {
  const cartResourceVersion = assertValidPreProviderCartResourceVersion(
    input.cart_resource_version
  )
  const idempotencyKey = resolveRequestedIdempotencyKey(input)
  if (!idempotencyKey) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const attempt = await readPaymentAttemptByIdForAuthority(
    transaction,
    input.payment_attempt_id,
    true
  )
  if (!attempt) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }

  if (
    attempt.cart_id !== input.cart_id ||
    attempt.payment_method_type !== input.payment_method_type ||
    attempt.amount !== input.amount_minor ||
    attempt.currency_code !== input.currency_code ||
    attempt.id !== input.payment_attempt_id
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const providedCollection = optionalProvidedText(input.payment_collection_id)
  if (
    providedCollection &&
    providedCollection !== attempt.payment_collection_id
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const providedSession = optionalProvidedText(input.payment_session_id)
  if (
    providedSession &&
    attempt.payment_session_id != null &&
    providedSession !== attempt.payment_session_id
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const reconstructedKey = readFrozenAttemptDurableIdempotencyKey(attempt)
  if (reconstructedKey !== idempotencyKey) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const blob = readPersistedRequestAuthorityBlob(attempt.metadata)
  const validV1 = isStripePaymentIntentCreateAuthorityV1(blob)
  const alreadyFrozen = attempt.financial_freeze_started_at != null

  if (alreadyFrozen && !validV1) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  if (persistedRequestAuthorityDisagrees(blob, input, idempotencyKey)) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  if (validV1) {
    const boundVersion = readPreProviderCartResourceVersion(attempt)
    if (boundVersion !== cartResourceVersion) {
      throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
    }
    const storedKey = readFrozenAttemptDurableIdempotencyKey(attempt)
    if (storedKey !== idempotencyKey) {
      throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
    }
  }

  const canonicalRequest = buildStripeCanonicalPaymentIntentCreateRequest({
    payment_method_type: attempt.payment_method_type,
    amount_minor: attempt.amount,
    cart_id: attempt.cart_id,
    payment_attempt_id: attempt.id,
    payment_session_id: providedSession ?? attempt.payment_session_id,
  })
  const requestDigest =
    digestStripeCanonicalPaymentIntentCreateRequest(canonicalRequest)

  const rows = await queryRows(
    transaction,
    buildPersistPreProviderFinancialFreezeSql(),
    [
      providedCollection,
      providedSession,
      cartResourceVersion,
      idempotencyKey,
      cartResourceVersion,
      providedCollection,
      providedSession,
      idempotencyKey,
      JSON.stringify(canonicalRequest),
      requestDigest,
      attempt.id,
      attempt.cart_id,
      attempt.payment_method_type,
      attempt.amount,
      attempt.currency_code,
    ]
  )

  if (rows.length !== 1) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  return mapPaymentAttemptRow(rows[0])
}

export async function readDurablePreProviderAuthority(
  transaction: PaymentAttemptSqlTransaction,
  paymentAttemptId: string
): Promise<DurablePreProviderAuthority> {
  const attempt = await readPaymentAttemptByIdForAuthority(
    transaction,
    paymentAttemptId,
    false
  )
  if (!attempt) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }

  if (
    !isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(attempt))
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }

  const cartResourceVersion = readPreProviderCartResourceVersion(attempt)
  if (cartResourceVersion === null) {
    throw new Error(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)
  }

  if (
    attempt.currency_code !== "brl" ||
    (attempt.payment_method_type !== "card" &&
      attempt.payment_method_type !== "pix") ||
    typeof attempt.amount !== "number" ||
    !Number.isFinite(attempt.amount)
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }

  const providerIdempotencyKey = readFrozenAttemptDurableIdempotencyKey(attempt)
  if (!providerIdempotencyKey) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }

  const blob = readPersistedRequestAuthorityBlob(attempt.metadata)
  if (!isStripePaymentIntentCreateAuthorityV1(blob)) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }
  const completeAuthority = assertCompleteStripePaymentIntentCreateAuthorityV1(blob)
  if (
    completeAuthority.cart_id !== attempt.cart_id ||
    completeAuthority.payment_attempt_id !== attempt.id ||
    completeAuthority.payment_method_type !== attempt.payment_method_type ||
    completeAuthority.amount_minor !== attempt.amount ||
    completeAuthority.currency_code !== "brl" ||
    completeAuthority.cart_resource_version !== cartResourceVersion ||
    completeAuthority.idempotency_key !== providerIdempotencyKey
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  const authorityCollection = readDurableMedusaIdentityText(
    completeAuthority.payment_collection_id
  )
  const attemptCollection = readDurableMedusaIdentityText(
    attempt.payment_collection_id
  )
  if (!authorityCollection || !attemptCollection) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }
  if (authorityCollection !== attemptCollection) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  if (attempt.payment_method_type === "card") {
    const authoritySession = optionalProvidedText(
      completeAuthority.payment_session_id ?? undefined
    )
    const attemptSession = optionalProvidedText(
      attempt.payment_session_id ?? undefined
    )
    if (
      !authoritySession ||
      !attemptSession ||
      authoritySession !== attemptSession
    ) {
      throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
    }
  } else if (
    completeAuthority.payment_session_id !== attempt.payment_session_id
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  const authorityCreatedAt = completeAuthority.authority_created_at
  const replayDeadline = completeAuthority.replay_deadline
  const financialFreezeStartedAt = attempt.financial_freeze_started_at
  if (!authorityCreatedAt || !replayDeadline || financialFreezeStartedAt == null) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }

  return {
    attempt,
    cart_resource_version: cartResourceVersion,
    amount_minor: attempt.amount,
    currency_code: "brl",
    payment_method_type: attempt.payment_method_type,
    provider_idempotency_key: providerIdempotencyKey,
    financial_freeze_started_at: financialFreezeStartedAt,
    authority_created_at: authorityCreatedAt,
    replay_deadline: replayDeadline,
  }
}

export type BindProviderPaymentIntentInput = {
  payment_attempt_id: string
  cart_id: string
  cart_resource_version?: number
  amount_minor: number
  currency_code: "brl"
  payment_method_type: PaymentAttemptRecord["payment_method_type"]
  provider_payment_intent_id: string
  provider_payment_session_id?: string | null
  idempotency_key?: string
  request_digest?: string
  payment_intent: StripePaymentIntentLike
}

export type BindProviderPaymentIntentResult = {
  outcome: "BOUND" | "REUSED"
  attempt: PaymentAttemptRecord
}

export type ClaimProviderDiscoveryResult = {
  claimed: boolean
  attempt: PaymentAttemptRecord
}

export type SameOperationReplayEligibility =
  | { eligible: true }
  | { eligible: false; reason: "REPLAY_DEADLINE_ELAPSED" }

function snapshotRequestAuthority(
  attempt: PaymentAttemptRecord
): Record<string, unknown> | null {
  const blob = readPersistedRequestAuthorityBlob(attempt.metadata)
  return blob ? { ...blob } : null
}

function requestAuthorityUnchanged(
  before: Record<string, unknown> | null,
  after: PaymentAttemptRecord
): boolean {
  const next = readPersistedRequestAuthorityBlob(after.metadata)
  return JSON.stringify(before) === JSON.stringify(next)
}

export async function bindProviderPaymentIntentInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  input: BindProviderPaymentIntentInput
): Promise<BindProviderPaymentIntentResult> {
  const attempt = await readPaymentAttemptByIdForAuthority(
    transaction,
    input.payment_attempt_id,
    true
  )
  if (!attempt) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }

  await readDurablePreProviderAuthority(
    transaction,
    input.payment_attempt_id
  )
  const v1 = assertCompleteStripePaymentIntentCreateAuthorityV1(
    readPersistedRequestAuthorityBlob(attempt.metadata)
  )
  const originalV1 = snapshotRequestAuthority(attempt)

  if (
    input.cart_id !== v1.cart_id ||
    input.amount_minor !== v1.amount_minor ||
    input.currency_code !== v1.currency_code ||
    input.payment_method_type !== v1.payment_method_type ||
    (input.cart_resource_version !== undefined &&
      input.cart_resource_version !== v1.cart_resource_version) ||
    (input.idempotency_key !== undefined &&
      input.idempotency_key !== v1.idempotency_key) ||
    (input.request_digest !== undefined &&
      input.request_digest !== v1.request_digest)
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  const boundIntentId =
    typeof attempt.provider_payment_intent_id === "string" &&
    attempt.provider_payment_intent_id.trim().length > 0
      ? attempt.provider_payment_intent_id.trim()
      : null

  if (boundIntentId && boundIntentId !== input.provider_payment_intent_id) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT)
  }

  assertStripePaymentIntentMatchesAuthorityV1(input.payment_intent, v1)

  const intentId =
    typeof input.payment_intent.id === "string"
      ? input.payment_intent.id.trim()
      : ""
  if (!intentId || intentId !== input.provider_payment_intent_id) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const rows = await queryRows(
    transaction,
    buildBindProviderPaymentIntentSql(),
    [
      input.provider_payment_intent_id,
      optionalProvidedText(input.provider_payment_session_id),
      attempt.id,
      attempt.cart_id,
      input.provider_payment_intent_id,
      v1.amount_minor,
      v1.currency_code,
      v1.payment_method_type,
    ]
  )

  if (rows.length !== 1) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_IDENTITY_MISMATCH)
  }

  const updated = mapPaymentAttemptRow(rows[0])
  if (!requestAuthorityUnchanged(originalV1, updated)) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  return {
    outcome: boundIntentId === input.provider_payment_intent_id ? "REUSED" : "BOUND",
    attempt: updated,
  }
}

export async function claimProviderDiscoveryInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  paymentAttemptId: string
): Promise<ClaimProviderDiscoveryResult> {
  const rows = await queryRows(
    transaction,
    buildClaimProviderDiscoverySql(),
    [paymentAttemptId]
  )
  if (rows.length === 1) {
    return {
      claimed: true,
      attempt: mapPaymentAttemptRow(rows[0]),
    }
  }

  const existing = await readPaymentAttemptByIdForAuthority(
    transaction,
    paymentAttemptId,
    false
  )
  if (!existing) {
    throw new Error(PAYMENT_ATTEMPT_NOT_FOUND)
  }

  return {
    claimed: false,
    attempt: existing,
  }
}

export async function isSameOperationReplayEligibleInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  paymentAttemptId: string
): Promise<SameOperationReplayEligibility> {
  const authority = await readDurablePreProviderAuthority(
    transaction,
    paymentAttemptId
  )
  const v1 = assertCompleteStripePaymentIntentCreateAuthorityV1(
    readPersistedRequestAuthorityBlob(authority.attempt.metadata)
  )
  const reconstructedKey = readFrozenAttemptDurableIdempotencyKey(
    authority.attempt
  )
  if (
    reconstructedKey !== v1.idempotency_key ||
    reconstructedKey !== authority.provider_idempotency_key ||
    v1.amount_minor !== authority.amount_minor ||
    v1.currency_code !== authority.currency_code ||
    v1.payment_method_type !== authority.payment_method_type ||
    v1.cart_id !== authority.attempt.cart_id ||
    v1.cart_resource_version !== authority.cart_resource_version
  ) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }

  const rows = await queryRows(
    transaction,
    buildSameOperationReplayEligibleSql(),
    [paymentAttemptId]
  )
  const eligible = rows[0]?.eligible
  if (eligible === true || eligible === "t" || eligible === "true") {
    return { eligible: true }
  }
  return { eligible: false, reason: "REPLAY_DEADLINE_ELAPSED" }
}
