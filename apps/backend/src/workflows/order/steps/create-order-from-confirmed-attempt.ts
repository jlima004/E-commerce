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
  unit_price?: unknown
  metadata?: Record<string, unknown> | null
  variant?: CartVariantRecord | null
}

export type ConfirmedAttemptCartRecord = {
  id: string
  total?: unknown
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

  if (!Array.isArray(cart.items) || cart.items.length === 0) {
    throw new Error("ORDER_ENTRYPOINT_CART_ITEMS_REQUIRED")
  }

  const calculatedCartTotal = calculateCartLineItemsTotalCents(
    cart.items,
    cart.currency_code
  )
  const attemptAmount = resolvePositiveIntegerBigInt(attempt.amount)

  if (
    calculatedCartTotal === null ||
    attemptAmount === null ||
    calculatedCartTotal !== attemptAmount
  ) {
    throw new Error("ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH")
  }

  if (cart.currency_code.trim().toLowerCase() !== attempt.currency_code.trim().toLowerCase()) {
    throw new Error("ORDER_ENTRYPOINT_CART_CURRENCY_MISMATCH")
  }

}

function resolveIntegerBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : null
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    return /^-?\d+$/.test(trimmed) ? BigInt(trimmed) : null
  }

  if (!value || typeof value !== "object") {
    return null
  }

  const rawAmount = (value as { rawAmount?: unknown }).rawAmount
  if (rawAmount !== undefined) {
    return resolveIntegerBigInt(rawAmount)
  }

  const numeric = (value as { numeric?: unknown }).numeric
  if (numeric !== undefined) {
    return resolveIntegerBigInt(numeric)
  }

  const valueOf = (value as { valueOf?: () => unknown }).valueOf
  if (typeof valueOf === "function") {
    const resolved = valueOf.call(value)
    if (resolved !== value) {
      return resolveIntegerBigInt(resolved)
    }
  }

  const toString = (value as { toString?: () => string }).toString
  if (typeof toString === "function") {
    const resolved = toString.call(value)
    if (resolved && resolved !== "[object Object]") {
      return resolveIntegerBigInt(resolved)
    }
  }

  return null
}

function resolvePositiveIntegerBigInt(value: unknown): bigint | null {
  const cents = resolveIntegerBigInt(value)
  return cents !== null && cents > 0n ? cents : null
}

function resolveNonNegativeIntegerBigInt(value: unknown): bigint | null {
  const cents = resolveIntegerBigInt(value)
  return cents !== null && cents >= 0n ? cents : null
}

function resolveLineItemUnitPriceCents(
  item: CartLineItemRecord,
  currencyCode: string
): bigint | null {
  if (item.unit_price !== undefined && item.unit_price !== null) {
    return resolveNonNegativeIntegerBigInt(item.unit_price)
  }

  const matchingVariantPrice = item.variant?.prices?.find((price) => {
    return price.currency_code?.toLowerCase() === currencyCode.toLowerCase()
  })

  return resolveNonNegativeIntegerBigInt(matchingVariantPrice?.amount)
}

function calculateCartLineItemsTotalCents(
  items: CartLineItemRecord[] | null | undefined,
  currencyCode: string
): bigint | null {
  const lineItems = items ?? []
  if (lineItems.length === 0) {
    return null
  }

  let total = 0n

  for (const item of lineItems) {
    const quantity = resolvePositiveIntegerBigInt(item.quantity)
    const unitPrice = resolveLineItemUnitPriceCents(item, currencyCode)

    if (quantity === null || unitPrice === null) {
      return null
    }

    total += quantity * unitPrice
  }

  return total > 0n ? total : null
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
