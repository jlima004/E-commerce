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
