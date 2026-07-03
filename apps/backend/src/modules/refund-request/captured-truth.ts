import type { PaymentAttemptRecord } from "../payment-attempt/types"
import type { OrderCapturedPaymentTruth } from "./types"

export type OrderRefundEligibilityMetadata = {
  order_status: string | null
  payment_status: string | null
}

export type ResolveOrderCapturedPaymentTruthInput = {
  order_id: string
  order_metadata: Record<string, unknown> | null | undefined
  payment_attempt: Pick<
    PaymentAttemptRecord,
    | "id"
    | "order_id"
    | "status"
    | "provider"
    | "provider_payment_intent_id"
    | "amount"
    | "currency_code"
  > | null
}

export function readOrderRefundEligibilityMetadata(
  metadata: Record<string, unknown> | null | undefined
): OrderRefundEligibilityMetadata {
  const orderStatus =
    typeof metadata?.order_status === "string"
      ? metadata.order_status.trim()
      : null
  const paymentStatus =
    typeof metadata?.payment_status === "string"
      ? metadata.payment_status.trim()
      : null

  return {
    order_status: orderStatus,
    payment_status: paymentStatus,
  }
}

export function assertOrderEligibleForRefundRequest(
  orderId: string,
  metadata: Record<string, unknown> | null | undefined
): void {
  const normalizedOrderId = orderId.trim()

  if (!normalizedOrderId) {
    throw new Error("REFUND_REQUEST_ORDER_ID_REQUIRED")
  }

  const { order_status, payment_status } =
    readOrderRefundEligibilityMetadata(metadata)

  if (order_status !== "confirmed") {
    throw new Error("REFUND_REQUEST_ORDER_STATUS_NOT_ELIGIBLE")
  }

  if (payment_status !== "captured") {
    throw new Error("REFUND_REQUEST_PAYMENT_STATUS_NOT_ELIGIBLE")
  }
}

export function assertPaymentAttemptEligibleForRefundSource(
  attempt: Pick<
    PaymentAttemptRecord,
    | "id"
    | "order_id"
    | "status"
    | "provider"
    | "provider_payment_intent_id"
    | "amount"
    | "currency_code"
  >,
  orderId: string
): void {
  const normalizedOrderId = orderId.trim()

  if (attempt.status !== "payment_confirmed_by_webhook") {
    throw new Error("REFUND_REQUEST_PAYMENT_ATTEMPT_STATUS_INVALID")
  }

  if (!attempt.order_id || attempt.order_id !== normalizedOrderId) {
    throw new Error("REFUND_REQUEST_PAYMENT_ATTEMPT_ORDER_MISMATCH")
  }

  if (attempt.provider !== "stripe") {
    throw new Error("REFUND_REQUEST_PAYMENT_ATTEMPT_PROVIDER_INVALID")
  }

  const paymentIntentId = attempt.provider_payment_intent_id?.trim()
  if (!paymentIntentId) {
    throw new Error("REFUND_REQUEST_PAYMENT_INTENT_ID_REQUIRED")
  }

  if (!(attempt.amount > 0)) {
    throw new Error("REFUND_REQUEST_CAPTURED_AMOUNT_INVALID")
  }

  const currencyCode = attempt.currency_code?.trim().toLowerCase()
  if (currencyCode !== "brl") {
    throw new Error("REFUND_REQUEST_CAPTURED_CURRENCY_INVALID")
  }
}

export function resolveOrderCapturedPaymentTruth(
  input: ResolveOrderCapturedPaymentTruthInput
): OrderCapturedPaymentTruth {
  assertOrderEligibleForRefundRequest(input.order_id, input.order_metadata)

  if (!input.payment_attempt) {
    throw new Error("REFUND_REQUEST_PAYMENT_ATTEMPT_NOT_FOUND")
  }

  assertPaymentAttemptEligibleForRefundSource(
    input.payment_attempt,
    input.order_id
  )

  const paymentIntentId =
    input.payment_attempt.provider_payment_intent_id?.trim() ?? ""

  return {
    order_id: input.order_id.trim(),
    payment_attempt_id: input.payment_attempt.id,
    payment_intent_id: paymentIntentId,
    captured_amount: input.payment_attempt.amount,
    currency_code: input.payment_attempt.currency_code.trim().toLowerCase(),
  }
}
