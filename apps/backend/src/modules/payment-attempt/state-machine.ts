import {
  PAYMENT_ATTEMPT_STATUSES,
  PROHIBITED_PAYMENT_ATTEMPT_STATUSES,
  type PaymentAttemptRecord,
  type PaymentAttemptStatus,
} from "./types"

export const TERMINAL_PAYMENT_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  "pix_expired",
  "payment_failed",
  "payment_canceled",
  "superseded",
  "invalidated_by_cart_change",
]

export const ACTIVE_PAYMENT_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] =
  PAYMENT_ATTEMPT_STATUSES.filter(
    (status) => !TERMINAL_PAYMENT_ATTEMPT_STATUSES.includes(status)
  )

const ALLOWED_TRANSITIONS: Record<
  PaymentAttemptStatus,
  readonly PaymentAttemptStatus[]
> = {
  created: [
    "provider_session_created",
    "client_action_required",
    "superseded",
    "invalidated_by_cart_change",
  ],
  provider_session_created: [
    "client_action_required",
    "card_client_secret_created",
    "payment_instructions_displayed",
    "awaiting_pix_payment",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  client_action_required: [
    "card_client_secret_created",
    "payment_instructions_displayed",
    "awaiting_pix_payment",
    "payment_client_confirmed",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  card_client_secret_created: [
    "payment_client_confirmed",
    "client_action_required",
    "awaiting_webhook_confirmation",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  payment_client_confirmed: [
    "awaiting_webhook_confirmation",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  payment_instructions_displayed: [
    "awaiting_pix_payment",
    "pix_expired",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  awaiting_pix_payment: [
    "awaiting_webhook_confirmation",
    "pix_expired",
    "payment_failed",
    "payment_canceled",
    "superseded",
    "invalidated_by_cart_change",
  ],
  awaiting_webhook_confirmation: [
    "payment_failed",
    "payment_canceled",
    "pix_expired",
    "superseded",
    "invalidated_by_cart_change",
  ],
  pix_expired: [],
  payment_failed: [],
  payment_canceled: [],
  superseded: [],
  invalidated_by_cart_change: [],
}

const SENSITIVE_METADATA_KEYS = new Set([
  "client_secret",
  "clientSecret",
  "pix_display_qr_code",
  "pix_copy_paste",
  "copia",
  "qr_code",
  "qr_payload",
  "federal_tax_id",
  "cpf",
  "cnpj",
  "full_address",
  "address_1",
  "address_2",
  "shipping_address",
  "billing_address",
])

const SENSITIVE_METADATA_VALUE_PATTERNS: RegExp[] = [
  /\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/,
  /\bseti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
]

export function isPaymentAttemptActive(
  status: PaymentAttemptStatus
): boolean {
  return ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(status)
}

export function assertValidPaymentAttemptStatus(
  status: string
): asserts status is PaymentAttemptStatus {
  if (
    PROHIBITED_PAYMENT_ATTEMPT_STATUSES.includes(
      status as (typeof PROHIBITED_PAYMENT_ATTEMPT_STATUSES)[number]
    )
  ) {
    throw new Error("PAYMENT_ATTEMPT_STATUS_PROHIBITED")
  }

  if (!PAYMENT_ATTEMPT_STATUSES.includes(status as PaymentAttemptStatus)) {
    throw new Error("PAYMENT_ATTEMPT_STATUS_UNKNOWN")
  }
}

export function assertPaymentAttemptTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus
): void {
  assertValidPaymentAttemptStatus(from)
  assertValidPaymentAttemptStatus(to)

  const allowed = ALLOWED_TRANSITIONS[from] ?? []

  if (!allowed.includes(to)) {
    throw new Error("PAYMENT_ATTEMPT_TRANSITION_INVALID")
  }
}

export function assertOrderIdMustStayNull(
  attempt: Pick<PaymentAttemptRecord, "order_id" | "status">
): void {
  if (attempt.order_id != null) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_ID_FORBIDDEN")
  }

  const statusesThatMustNeverHaveOrder = [
    "awaiting_pix_payment",
    "pix_expired",
    "payment_failed",
    "payment_canceled",
  ] as const

  if (
    statusesThatMustNeverHaveOrder.includes(
      attempt.status as (typeof statusesThatMustNeverHaveOrder)[number]
    ) &&
    attempt.order_id != null
  ) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_ID_FORBIDDEN")
  }
}

export function markPaymentAttemptSuperseded<T extends PaymentAttemptRecord>(
  attempt: T,
  at: Date = new Date()
): T {
  assertPaymentAttemptTransition(attempt.status, "superseded")

  return {
    ...attempt,
    status: "superseded",
    superseded_at: at.toISOString(),
    order_id: null,
  }
}

export function markPaymentAttemptInvalidatedByCartChange<
  T extends PaymentAttemptRecord,
>(attempt: T, at: Date = new Date()): T {
  if (attempt.status === "superseded") {
    throw new Error("PAYMENT_ATTEMPT_ALREADY_SUPERSEDED")
  }

  assertPaymentAttemptTransition(attempt.status, "invalidated_by_cart_change")

  return {
    ...attempt,
    status: "invalidated_by_cart_change",
    invalidated_at: at.toISOString(),
    order_id: null,
  }
}

function containsSensitiveMetadataValue(value: unknown): boolean {
  if (typeof value === "string") {
    return SENSITIVE_METADATA_VALUE_PATTERNS.some((pattern) =>
      pattern.test(value)
    )
  }

  if (Array.isArray(value)) {
    return value.some(containsSensitiveMetadataValue)
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) =>
        SENSITIVE_METADATA_KEYS.has(key) ||
        containsSensitiveMetadataValue(nested)
    )
  }

  return false
}

export function assertNoSensitivePaymentAttemptMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  for (const key of Object.keys(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key)) {
      throw new Error("PAYMENT_ATTEMPT_METADATA_SENSITIVE_KEY")
    }
  }

  if (containsSensitiveMetadataValue(metadata)) {
    throw new Error("PAYMENT_ATTEMPT_METADATA_SENSITIVE_VALUE")
  }
}

export function paymentClientConfirmedIsNonFinancial(): true {
  return true
}
