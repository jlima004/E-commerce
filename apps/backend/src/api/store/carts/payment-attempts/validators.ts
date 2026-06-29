import { MedusaError } from "@medusajs/framework/utils"
import type { PaymentMethodType } from "../../../../modules/payment-attempt/types"

export const CLIENT_MONEY_BODY_FIELDS = [
  "amount",
  "total",
  "subtotal",
  "item_total",
  "shipping_total",
  "tax_total",
  "discount_total",
  "grand_total",
  "currency",
  "currency_code",
  "region_currency",
] as const

export type ClientMoneyBodyField = (typeof CLIENT_MONEY_BODY_FIELDS)[number]

export type PaymentStartRequestBody = {
  payment_method?: unknown
}

export type NormalizedPaymentStartRequest = {
  payment_method: PaymentMethodType
}

const PAYMENT_START_REJECTED_BODY_MESSAGE =
  "Campos monetarios no body nao sao aceitos; total e moeda sao derivados do cart no servidor."

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function findClientMoneyFields(body: Record<string, unknown>): ClientMoneyBodyField[] {
  const found: ClientMoneyBodyField[] = []

  for (const field of CLIENT_MONEY_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      found.push(field)
    }
  }

  return found
}

export function rejectClientMoneyFields(body: unknown): void {
  if (!isPlainObject(body)) {
    return
  }

  const rejectedFields = findClientMoneyFields(body)
  if (rejectedFields.length === 0) {
    return
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    PAYMENT_START_REJECTED_BODY_MESSAGE
  )
}

function parsePaymentMethod(value: unknown): PaymentMethodType | null {
  if (value === "card" || value === "pix") {
    return value
  }

  return null
}

export function normalizePaymentStartRequestBody(
  body: unknown
): NormalizedPaymentStartRequest {
  rejectClientMoneyFields(body)

  const payload = isPlainObject(body) ? body : {}
  const paymentMethod = parsePaymentMethod(payload.payment_method)

  if (!paymentMethod) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "payment_method deve ser card ou pix."
    )
  }

  return {
    payment_method: paymentMethod,
  }
}

export function getPaymentStartRejectedBodyMessage(): string {
  return PAYMENT_START_REJECTED_BODY_MESSAGE
}
