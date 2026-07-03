import { computeRefundableAvailability } from "./service"
import type { OrderCapturedPaymentTruth, RefundRequestRecord } from "./types"

export const ORDER_FINANCIAL_PAYMENT_STATUSES = [
  "captured",
  "partially_refunded",
  "refunded",
] as const

export type OrderFinancialPaymentStatus =
  (typeof ORDER_FINANCIAL_PAYMENT_STATUSES)[number]

export function recomputeOrderFinancialPaymentStatus(input: {
  captured_amount: number
  confirmed_refunded_amount: number
}): OrderFinancialPaymentStatus {
  if (input.confirmed_refunded_amount <= 0) {
    return "captured"
  }

  if (input.confirmed_refunded_amount >= input.captured_amount) {
    return "refunded"
  }

  return "partially_refunded"
}

export function buildOrderFinancialStateMetadata(input: {
  current_metadata: Record<string, unknown> | null | undefined
  payment_status: OrderFinancialPaymentStatus
}): Record<string, unknown> {
  const current = input.current_metadata ?? {}

  return {
    ...current,
    payment_status: input.payment_status,
  }
}

export function recomputeOrderFinancialState(input: {
  captured: Pick<OrderCapturedPaymentTruth, "captured_amount" | "currency_code">
  refund_requests: Array<Pick<RefundRequestRecord, "id" | "amount" | "status">>
  current_metadata: Record<string, unknown> | null | undefined
}): {
  confirmed_refunded_amount: number
  payment_status: OrderFinancialPaymentStatus
  metadata: Record<string, unknown>
  order_status: string | null
} {
  const availability = computeRefundableAvailability({
    captured: input.captured,
    refund_requests: input.refund_requests,
  })
  const paymentStatus = recomputeOrderFinancialPaymentStatus({
    captured_amount: input.captured.captured_amount,
    confirmed_refunded_amount: availability.confirmed_refunded_amount,
  })
  const orderStatus =
    typeof input.current_metadata?.order_status === "string"
      ? input.current_metadata.order_status.trim()
      : null

  return {
    confirmed_refunded_amount: availability.confirmed_refunded_amount,
    payment_status: paymentStatus,
    metadata: buildOrderFinancialStateMetadata({
      current_metadata: input.current_metadata,
      payment_status: paymentStatus,
    }),
    order_status: orderStatus,
  }
}
