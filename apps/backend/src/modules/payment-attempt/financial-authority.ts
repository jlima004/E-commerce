import type {
  PaymentAttemptFinancialAuthority,
  PaymentAttemptFinancialAuthorityProjection,
} from "./types"

export const PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE =
  "PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE"

export function assertCompletePaymentAttemptFinancialAuthority(
  value: unknown
): asserts value is PaymentAttemptFinancialAuthority {
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.prototype.hasOwnProperty.call(value, "id") ||
    !Object.prototype.hasOwnProperty.call(value, "cart_id") ||
    !Object.prototype.hasOwnProperty.call(value, "order_id") ||
    !Object.prototype.hasOwnProperty.call(value, "financial_freeze_started_at") ||
    !Object.prototype.hasOwnProperty.call(value, "provider_canceled_confirmed_at") ||
    (value as Record<string, unknown>).id === undefined ||
    (value as Record<string, unknown>).cart_id === undefined ||
    (value as Record<string, unknown>).order_id === undefined ||
    (value as Record<string, unknown>).financial_freeze_started_at === undefined ||
    (value as Record<string, unknown>).provider_canceled_confirmed_at === undefined
  ) {
    throw new Error(PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE)
  }
}

/**
 * Financial freeze resolution is deliberately independent of operational
 * status. Only the three persisted authority fields participate.
 * Soft-deletion does not resolve freeze; listing unresolved financial
 * authority must not filter deleted_at IS NULL.
 */
export function isUnresolvedFinancialFreeze(
  attempt: PaymentAttemptFinancialAuthority
): boolean {
  assertCompletePaymentAttemptFinancialAuthority(attempt)
  return (
    attempt.financial_freeze_started_at != null &&
    attempt.provider_canceled_confirmed_at == null &&
    attempt.order_id == null
  )
}

export function projectPaymentAttemptFinancialAuthority(
  attempt: PaymentAttemptFinancialAuthority
): PaymentAttemptFinancialAuthorityProjection {
  assertCompletePaymentAttemptFinancialAuthority(attempt)

  return {
    id: attempt.id,
    cart_id: attempt.cart_id,
    order_id: attempt.order_id,
    financial_freeze_started_at: attempt.financial_freeze_started_at,
    provider_canceled_confirmed_at: attempt.provider_canceled_confirmed_at,
    unresolved_financial_freeze: isUnresolvedFinancialFreeze(attempt),
  }
}

export function toPaymentAttemptFinancialAuthority(
  attempt: {
    id: string
    cart_id: string
    order_id?: string | null
    financial_freeze_started_at?: Date | string | null
    provider_canceled_confirmed_at?: Date | string | null
  }
): PaymentAttemptFinancialAuthority {
  return {
    id: attempt.id,
    cart_id: attempt.cart_id,
    order_id: attempt.order_id ?? null,
    financial_freeze_started_at: attempt.financial_freeze_started_at ?? null,
    provider_canceled_confirmed_at: attempt.provider_canceled_confirmed_at ?? null,
  }
}

export const PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE =
  "PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE"

export function createFinancialFreezeActiveError(
  message = "Operação bloqueada por congelamento financeiro ativo."
): Error & { code: string; status: number; statusCode: number } {
  const error = new Error(message) as Error & {
    code: string
    status: number
    statusCode: number
  }
  error.name = PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE
  error.code = PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE
  error.status = 409
  error.statusCode = 409
  return error
}

export type FinancialFreezeSqlTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

export async function findUnresolvedFinancialFreezeInTransaction(
  transaction: FinancialFreezeSqlTransaction,
  cartId: string
): Promise<PaymentAttemptFinancialAuthority | null> {
  const result = await transaction.raw(
    `
      select id, cart_id, order_id, financial_freeze_started_at, provider_canceled_confirmed_at
      from payment_attempt
      where cart_id = ?
        and financial_freeze_started_at is not null
        and provider_canceled_confirmed_at is null
        and order_id is null
      order by id
      limit 1
    `,
    [cartId]
  )
  const row = result.rows?.[0]
  if (!row) {
    return null
  }
  const authority: PaymentAttemptFinancialAuthority = {
    id: String(row.id),
    cart_id: String(row.cart_id),
    order_id: row.order_id == null ? null : String(row.order_id),
    financial_freeze_started_at:
      row.financial_freeze_started_at instanceof Date ||
      typeof row.financial_freeze_started_at === "string"
        ? row.financial_freeze_started_at
        : null,
    provider_canceled_confirmed_at:
      row.provider_canceled_confirmed_at instanceof Date ||
      typeof row.provider_canceled_confirmed_at === "string"
        ? row.provider_canceled_confirmed_at
        : null,
  }
  return isUnresolvedFinancialFreeze(authority) ? authority : null
}

export async function assertNoUnresolvedFinancialFreezeInTransaction(
  transaction: FinancialFreezeSqlTransaction,
  cartId: string
): Promise<void> {
  const unresolved = await findUnresolvedFinancialFreezeInTransaction(
    transaction,
    cartId
  )
  if (unresolved) {
    throw createFinancialFreezeActiveError()
  }
}

export async function assertNoUnresolvedFinancialFreezeForCartsInTransaction(
  transaction: FinancialFreezeSqlTransaction,
  cartIds: string[]
): Promise<void> {
  const uniqueCartIds = [...new Set(cartIds)].filter(
    (id) => typeof id === "string" && id.trim().length > 0
  )
  for (const cartId of uniqueCartIds) {
    await assertNoUnresolvedFinancialFreezeInTransaction(transaction, cartId)
  }
}
