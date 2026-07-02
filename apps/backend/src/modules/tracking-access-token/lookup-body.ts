import { MedusaError } from "@medusajs/framework/utils"

export const TRACKING_LOOKUP_REQUEST_TOKEN_KEY = "token" as const

export const TRACKING_LOOKUP_REJECTED_BODY_KEYS = [
  "order_id",
  "cart_id",
  "payment_id",
  "payment_intent_id",
  "provider_payment_intent_id",
  "payment_attempt_id",
  "email",
  "customer_email",
  "to_email",
  "recipient_email",
  "phone",
  "telephone",
  "cpf",
  "cnpj",
  "federal_tax_id",
  "address",
  "shipping_address",
  "billing_address",
  "full_address",
  "tracking_token",
] as const

export type TrackingLookupRejectedBodyKey =
  (typeof TRACKING_LOOKUP_REJECTED_BODY_KEYS)[number]

const REJECTED_BODY_KEY_SET = new Set<string>(TRACKING_LOOKUP_REJECTED_BODY_KEYS)

const TRACKING_LOOKUP_BODY_ONLY_TOKEN_MESSAGE =
  "Somente o campo token e aceito no body JSON."

const TRACKING_LOOKUP_TOKEN_REQUIRED_MESSAGE =
  "O campo token e obrigatorio."

const TRACKING_LOOKUP_TOKEN_INVALID_SHAPE_MESSAGE =
  "O campo token deve ser uma string nao vazia."

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function isTrackingLookupRejectedBodyKey(key: string): boolean {
  return REJECTED_BODY_KEY_SET.has(key.trim().toLowerCase())
}

export function findTrackingLookupRejectedBodyKeys(
  body: Record<string, unknown>
): string[] {
  return Object.keys(body).filter((key) => isTrackingLookupRejectedBodyKey(key))
}

export function parseTrackingLookupRequestBody(body: unknown): { token: string } {
  if (!isPlainObject(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      TRACKING_LOOKUP_TOKEN_REQUIRED_MESSAGE
    )
  }

  const rejectedKeys = findTrackingLookupRejectedBodyKeys(body)

  if (rejectedKeys.length > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      TRACKING_LOOKUP_BODY_ONLY_TOKEN_MESSAGE
    )
  }

  const keys = Object.keys(body)

  if (keys.length !== 1 || keys[0] !== TRACKING_LOOKUP_REQUEST_TOKEN_KEY) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      TRACKING_LOOKUP_BODY_ONLY_TOKEN_MESSAGE
    )
  }

  const token = body[TRACKING_LOOKUP_REQUEST_TOKEN_KEY]

  if (typeof token !== "string" || token.trim().length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      TRACKING_LOOKUP_TOKEN_INVALID_SHAPE_MESSAGE
    )
  }

  return {
    token: token.trim(),
  }
}

export function getTrackingLookupBodyOnlyTokenMessage(): string {
  return TRACKING_LOOKUP_BODY_ONLY_TOKEN_MESSAGE
}
