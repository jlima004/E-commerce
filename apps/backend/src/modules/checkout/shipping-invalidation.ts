import {
  invalidateActivePaymentAttemptForCartChange,
} from "../payment-attempt/cart-invalidation"
import type { PaymentAttemptRecord } from "../payment-attempt/types"
import { ACTIVE_PAYMENT_ATTEMPT_STATUSES } from "../payment-attempt/state-machine"
import type { PaymentAttemptSqlTransaction } from "../payment-attempt/transactional-authority"
import { createFinancialFreezeActiveError } from "../payment-attempt/financial-authority"

const ACTIVE_STATUS_BINDINGS = ACTIVE_PAYMENT_ATTEMPT_STATUSES.map(() => "?").join(
  ", "
)

async function invalidatePaymentAttemptsForCartChangeInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  at: Date
): Promise<void> {
  // This exact lock statement is also used by webhook and Order authority.
  await transaction.raw(
    "select pg_advisory_xact_lock(hashtextextended(?, 1515))",
    [cartId]
  )
  const freezeCheck = await transaction.raw(
    `
      select id, order_id, financial_freeze_started_at, provider_canceled_confirmed_at
      from payment_attempt
      where cart_id = ?
        and financial_freeze_started_at is not null
        and provider_canceled_confirmed_at is null
        and order_id is null
      limit 1
    `,
    [cartId]
  )
  const hasUnresolvedFreeze = (freezeCheck.rows ?? []).some(
    (row) =>
      row.financial_freeze_started_at != null &&
      row.provider_canceled_confirmed_at == null &&
      row.order_id == null
  )
  if (hasUnresolvedFreeze) {
    throw createFinancialFreezeActiveError()
  }
  const locked = await transaction.raw(
    `
      select id, status, order_id
      from payment_attempt
      where cart_id = ? and deleted_at is null
      order by id
      for update
    `,
    [cartId]
  )
  const rows = locked.rows ?? []
  const active = rows.filter((row) =>
    ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(
      row.status as (typeof ACTIVE_PAYMENT_ATTEMPT_STATUSES)[number]
    )
  )

  if (active.some((row) => row.order_id !== null && row.order_id !== undefined)) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS")
  }
  if (active.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }
  if (active.length === 0) {
    return
  }

  const updated = await transaction.raw(
    `
      update payment_attempt
      set status = 'invalidated_by_cart_change',
          invalidated_at = ?,
          order_id = null,
          updated_at = ?
      where id = ? and cart_id = ? and deleted_at is null
        and order_id is null
        and status in (${ACTIVE_STATUS_BINDINGS})
      returning id
    `,
    [
      at.toISOString(),
      at.toISOString(),
      active[0].id,
      cartId,
      ...ACTIVE_PAYMENT_ATTEMPT_STATUSES,
    ]
  )
  if ((updated.rows ?? []).length !== 1) {
    throw new Error("PAYMENT_ATTEMPT_INVALIDATION_CAS_FAILED")
  }
}

export type PaymentAttemptModuleForCartInvalidation = {
  listPaymentAttempts?: (filters?: { cart_id?: string }) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (input: PaymentAttemptRecord) => Promise<unknown>
}

export type StructuralCartInvalidationContext = {
  transaction?: PaymentAttemptSqlTransaction
}

export type StructuralCartInvalidationDependencies = {
  paymentAttemptModule?: PaymentAttemptModuleForCartInvalidation
  transaction?: PaymentAttemptSqlTransaction
  invalidateActivePaymentAttemptForCartChange?: (
    cartId: string,
    at: Date
  ) => Promise<void> | void
  invalidateShippingQuote?: (
    cartId: string,
    at: Date,
    context?: StructuralCartInvalidationContext
  ) => Promise<void> | void
  invalidateShippingSelection?: (
    cartId: string,
    at: Date,
    context?: StructuralCartInvalidationContext
  ) => Promise<void> | void
}

export type DefaultShippingInvalidationSeams = {
  invalidateShippingQuote: (
    cartId: string,
    at: Date,
    context?: StructuralCartInvalidationContext
  ) => Promise<void> | void
  invalidateShippingSelection: (
    cartId: string,
    at: Date,
    context?: StructuralCartInvalidationContext
  ) => Promise<void> | void
}

export async function defaultInvalidateShippingQuote(
  _cartId: string,
  _at: Date,
  _context?: StructuralCartInvalidationContext
): Promise<void> {}

export async function defaultInvalidateShippingSelection(
  _cartId: string,
  _at: Date,
  _context?: StructuralCartInvalidationContext
): Promise<void> {}

async function persistPaymentAttemptInvalidation(
  paymentAttemptModule: PaymentAttemptModuleForCartInvalidation,
  cartId: string,
  at: Date
): Promise<void> {
  const attempts =
    (await paymentAttemptModule.listPaymentAttempts?.({ cart_id: cartId })) ?? []
  const result = invalidateActivePaymentAttemptForCartChange(attempts, cartId, at)

  if (result.invalidated.length > 0 && !paymentAttemptModule.updatePaymentAttempts) {
    throw new Error("PAYMENT_ATTEMPT_UPDATE_UNAVAILABLE")
  }

  for (const invalidated of result.invalidated) {
    await paymentAttemptModule.updatePaymentAttempts?.(invalidated)
  }
}

/**
 * Structural cart changes invalidate payment state and notify the future
 * shipping quote/selection owners. The latter two hooks intentionally remain
 * no-ops in Phase 15, but stay injectable so every mutation proves invocation.
 */
export function createStructuralCartInvalidationRunner(
  defaultShippingSeams: DefaultShippingInvalidationSeams = {
    invalidateShippingQuote: defaultInvalidateShippingQuote,
    invalidateShippingSelection: defaultInvalidateShippingSelection,
  }
) {
  return async function runStructuralCartInvalidation(
    cartId: string,
    at: Date = new Date(),
    dependencies: StructuralCartInvalidationDependencies = {}
  ): Promise<void> {
    if (dependencies.transaction) {
      await invalidatePaymentAttemptsForCartChangeInTransaction(
        dependencies.transaction,
        cartId,
        at
      )
    } else if (dependencies.invalidateActivePaymentAttemptForCartChange) {
      await dependencies.invalidateActivePaymentAttemptForCartChange(cartId, at)
    } else if (dependencies.paymentAttemptModule) {
      await persistPaymentAttemptInvalidation(
        dependencies.paymentAttemptModule,
        cartId,
        at
      )
    } else {
      // Keep the real PaymentAttempt state transition as the default primitive;
      // without a module gateway there are simply no records to transition.
      invalidateActivePaymentAttemptForCartChange([], cartId, at)
    }

    const invalidateQuote =
      dependencies.invalidateShippingQuote ??
      defaultShippingSeams.invalidateShippingQuote
    const invalidateSelection =
      dependencies.invalidateShippingSelection ??
      defaultShippingSeams.invalidateShippingSelection

    const context = { transaction: dependencies.transaction }
    await invalidateQuote(cartId, at, context)
    await invalidateSelection(cartId, at, context)
  }
}

export const applyStructuralCartInvalidation =
  createStructuralCartInvalidationRunner()
