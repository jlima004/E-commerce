import { assertNoSensitivePaymentAttemptMetadata } from "./state-machine"

export type SafeStripePaymentData = {
  provider_payment_intent_id: string
  provider_payment_session_id: string | null
  amount: number
  currency_code: string
  status: string
  expires_at: string | null
  metadata: Record<string, unknown> | null
}

export type SafeStripeImmediateCardAction = {
  client_secret: string
}

export type StripePaymentIntentLike = Record<string, unknown>

export type SplitStripeCardPaymentIntentResult = {
  persistable: SafeStripePaymentData
  immediate: SafeStripeImmediateCardAction
  paymentSessionData: Record<string, unknown>
}

const FORBIDDEN_PERSISTABLE_KEYS = new Set([
  "client_secret",
  "clientSecret",
  "next_action",
  "charges",
  "payment_method",
  "last_payment_error",
  "payment_method_options",
  "automatic_payment_methods",
  "pix_display_qr_code",
  "hosted_instructions_url",
  "image_url_png",
  "image_url_svg",
  "object",
  "livemode",
  "confirmation_method",
  "capture_method",
  "payment_method_types",
  "latest_charge",
  "transfer_data",
  "shipping",
  "customer",
  "setup_future_usage",
  "application",
  "application_fee_amount",
  "on_behalf_of",
  "review",
  "source",
  "statement_descriptor",
  "statement_descriptor_suffix",
  "transfer_group",
])

const ALLOWED_PAYMENT_SESSION_DATA_KEYS = new Set([
  "provider_payment_intent_id",
  "provider_payment_session_id",
  "amount",
  "currency_code",
  "status",
  "expires_at",
  "metadata",
])

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/,
  /\bseti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/,
  /\b00020126\d+/,
]

const ALLOWED_METADATA_KEYS = new Set([
  "cart_id",
  "payment_attempt_id",
  "session_id",
  "note",
  "correlation_id",
])

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null
}

function sanitizeStripeMetadata(
  metadata: unknown
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }

  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (
        typeof value === "string" &&
        SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
      ) {
        continue
      }

      output[key] = value
    }
  }

  return Object.keys(output).length > 0 ? output : null
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }

  if (Array.isArray(value)) {
    return value.some(containsSensitiveValue)
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) =>
        FORBIDDEN_PERSISTABLE_KEYS.has(key) || containsSensitiveValue(nested)
    )
  }

  return false
}

function collectForbiddenKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (value === null || value === undefined) {
    return found
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectForbiddenKeys(entry, found)
    }
    return found
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PERSISTABLE_KEYS.has(key)) {
        found.add(key)
      }
      collectForbiddenKeys(nested, found)
    }
  }

  return found
}

export function assertPersistableHasNoSecrets(data: unknown): void {
  const forbidden = collectForbiddenKeys(data)

  for (const key of forbidden) {
    throw new Error("STRIPE_SAFE_PERSISTABLE_FORBIDDEN_KEY")
  }

  if (containsSensitiveValue(data)) {
    throw new Error("STRIPE_SAFE_PERSISTABLE_SENSITIVE_VALUE")
  }
}

export function assertPaymentSessionDataIsAllowlisted(
  data: Record<string, unknown>
): void {
  for (const key of Object.keys(data)) {
    if (!ALLOWED_PAYMENT_SESSION_DATA_KEYS.has(key)) {
      throw new Error("STRIPE_SAFE_PAYMENT_SESSION_DATA_FORBIDDEN_KEY")
    }
  }

  assertPersistableHasNoSecrets(data)
}

export function toSafeStripePaymentSessionData(
  persistable: SafeStripePaymentData
): Record<string, unknown> {
  const sessionData: Record<string, unknown> = {
    provider_payment_intent_id: persistable.provider_payment_intent_id,
    amount: persistable.amount,
    currency_code: persistable.currency_code,
    status: persistable.status,
  }

  if (persistable.provider_payment_session_id) {
    sessionData.provider_payment_session_id =
      persistable.provider_payment_session_id
  }

  if (persistable.expires_at) {
    sessionData.expires_at = persistable.expires_at
  }

  if (persistable.metadata) {
    sessionData.metadata = persistable.metadata
  }

  assertPaymentSessionDataIsAllowlisted(sessionData)

  return sessionData
}

export function splitStripeCardPaymentIntent(
  raw: StripePaymentIntentLike
): SplitStripeCardPaymentIntentResult {
  const providerPaymentIntentId = asNonEmptyString(raw.id)
  const amount = asPositiveInteger(raw.amount)
  const currency = asNonEmptyString(raw.currency)?.toLowerCase()
  const status = asNonEmptyString(raw.status)
  const clientSecret = asNonEmptyString(raw.client_secret)

  if (!providerPaymentIntentId || amount === null || !currency || !status) {
    throw new Error("STRIPE_SAFE_RAW_PAYMENT_INTENT_INVALID")
  }

  if (!clientSecret) {
    throw new Error("STRIPE_SAFE_RAW_CLIENT_SECRET_MISSING")
  }

  const metadata = sanitizeStripeMetadata(raw.metadata)
  if (metadata) {
    assertNoSensitivePaymentAttemptMetadata(metadata)
  }

  const providerPaymentSessionId =
    asNonEmptyString(
      (raw.metadata as Record<string, unknown> | undefined)?.session_id
    ) ?? null

  const persistable: SafeStripePaymentData = {
    provider_payment_intent_id: providerPaymentIntentId,
    provider_payment_session_id: providerPaymentSessionId,
    amount,
    currency_code: currency,
    status,
    expires_at: null,
    metadata,
  }

  assertPersistableHasNoSecrets(persistable)

  const immediate: SafeStripeImmediateCardAction = {
    client_secret: clientSecret,
  }

  const paymentSessionData = toSafeStripePaymentSessionData(persistable)

  return {
    persistable,
    immediate,
    paymentSessionData,
  }
}

export const STRIPE_SAFE_BOUNDARY_STRATEGY = "filtering_wrapper" as const
