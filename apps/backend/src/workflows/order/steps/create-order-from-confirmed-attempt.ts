import { sanitizeString } from "../../../observability/sanitize"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"

type CartVariantRecord = {
  id?: string | null
  sku?: string | null
  metadata?: Record<string, unknown> | null
  prices?: Array<{
    amount: number
    currency_code: string
  }> | null
}

type CartLineItemRecord = {
  id: string
  quantity: number
  metadata?: Record<string, unknown> | null
  variant?: CartVariantRecord | null
}

export type ConfirmedAttemptCartRecord = {
  id: string
  total: number
  currency_code: string
  completed_at?: string | Date | null
  items: CartLineItemRecord[]
}

export type ConfirmedAttemptOrderState = {
  order_status: "confirmed"
  payment_status: "captured"
}

export function assertConfirmedAttemptCartMatchesPaymentAttempt(
  attempt: Pick<
    PaymentAttemptRecord,
    "cart_id" | "amount" | "currency_code" | "provider_payment_intent_id"
  >,
  cart: ConfirmedAttemptCartRecord
): void {
  if (cart.id !== attempt.cart_id) {
    throw new Error("ORDER_ENTRYPOINT_CART_MISMATCH")
  }

  if (cart.completed_at) {
    throw new Error("ORDER_ENTRYPOINT_CART_ALREADY_COMPLETED")
  }

  if (!(cart.total > 0) || cart.total !== attempt.amount) {
    throw new Error("ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH")
  }

  if (cart.currency_code.trim().toLowerCase() !== attempt.currency_code.trim().toLowerCase()) {
    throw new Error("ORDER_ENTRYPOINT_CART_CURRENCY_MISMATCH")
  }

  if (!Array.isArray(cart.items) || cart.items.length === 0) {
    throw new Error("ORDER_ENTRYPOINT_CART_ITEMS_REQUIRED")
  }
}

export function linkConfirmedPaymentAttemptToOrder(
  attempt: PaymentAttemptRecord,
  orderId: string,
  at: Date = new Date()
): PaymentAttemptRecord {
  if (attempt.status !== "payment_confirmed_by_webhook") {
    throw new Error("PAYMENT_ATTEMPT_ORDER_LINK_STATUS_INVALID")
  }

  const normalizedOrderId = orderId.trim()

  if (!normalizedOrderId) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_LINK_ORDER_ID_REQUIRED")
  }

  if (attempt.order_id && attempt.order_id !== normalizedOrderId) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_LINK_CONFLICT")
  }

  return {
    ...attempt,
    order_id: normalizedOrderId,
    updated_at: at.toISOString(),
  }
}

export function buildConfirmedOrderStateMetadata(
  current: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    order_status: "confirmed",
    payment_status: "captured",
  }
}

export function getConfirmedOrderState(): ConfirmedAttemptOrderState {
  return {
    order_status: "confirmed",
    payment_status: "captured",
  }
}

export function sanitizeOrderCreationFailure(input: {
  code: string
  message: string
}): {
  error_code: string
  error_message: string
} {
  return {
    error_code: sanitizeString(input.code).slice(0, 120),
    error_message: sanitizeString(input.message).slice(0, 500),
  }
}
