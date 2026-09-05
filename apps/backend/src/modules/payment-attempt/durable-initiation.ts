import { isPaymentAttemptActive } from "./state-machine"
import type { PaymentAttemptRecord, PaymentMethodType } from "./types"

export const PAYMENT_ATTEMPT_INITIATION_ID_METADATA_KEY = "payment_attempt_id"

export function buildPaymentAttemptProviderIdempotencyKey(
  paymentMethodType: PaymentMethodType,
  paymentAttemptId: string
): string {
  const normalizedId = paymentAttemptId.trim()
  if (!normalizedId) {
    throw new Error("PAYMENT_ATTEMPT_ID_REQUIRED")
  }

  return `payment-attempt:${paymentMethodType}:${normalizedId}`
}

export function withDurablePaymentAttemptIdentity(
  metadata: Record<string, unknown> | null | undefined,
  paymentAttemptId: string
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [PAYMENT_ATTEMPT_INITIATION_ID_METADATA_KEY]: paymentAttemptId,
  }
}

export function readDurablePaymentAttemptIdentity(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.[PAYMENT_ATTEMPT_INITIATION_ID_METADATA_KEY]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

export function findReusablePaymentAttempt(
  attempts: PaymentAttemptRecord[],
  input: {
    cartId: string
    paymentMethodType: PaymentMethodType
    cartFingerprint: string
  }
): PaymentAttemptRecord | null {
  const reusable = attempts.filter(
    (attempt) =>
      attempt.cart_id === input.cartId &&
      attempt.payment_method_type === input.paymentMethodType &&
      isPaymentAttemptActive(attempt.status) &&
      readDurablePaymentAttemptIdentity(attempt.metadata) === attempt.id &&
      attempt.metadata?.cart_fingerprint === input.cartFingerprint
  )

  if (reusable.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }

  return reusable[0] ?? null
}
