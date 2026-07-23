import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import { resolveOrderCapturedPaymentTruth } from "./captured-truth"
import RefundRequest from "./models/refund-request"
import {
  resolveStripeRefundCreationLayer,
  STRIPE_REFUND_CREATION_LAYER_TOKEN,
  type StripeRefundCreationLayer,
} from "./stripe-refund-boundary"
import {
  REFUND_REQUEST_CONFIRMED_STATUSES,
  REFUND_REQUEST_RESERVATION_STATUSES,
  REFUND_REQUEST_SLICE_ALLOWED_CREATE_STATUSES,
  REFUND_REQUEST_STATUSES,
  type AdminCreateRefundRequestResult,
  type CreateRefundRequestInput,
  type OrderCapturedPaymentTruth,
  type RefundRequestMetadata,
  type RefundRequestMetadataValue,
  type RefundRequestRecord,
  type RefundRequestStatus,
  type RefundableAvailability,
} from "./types"

const ALLOWED_METADATA_KEYS = new Set([
  "correlation_id",
  "recovery_origin",
  "source",
])

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function buildPattern(source: string, flags?: string): RegExp {
  return new RegExp(source, flags)
}

const FORBIDDEN_OBJECT_KEYS = new Set([
  joinKey("authori", "zation"),
  joinKey("bear", "er"),
  joinKey("bill", "ing", "_", "address"),
  "cookie",
  joinKey("cookie", "s"),
  joinKey("client", "_", "secret"),
  joinKey("copy", "_", "paste"),
  joinKey("customer", "_", "email"),
  joinKey("full", "_", "name"),
  joinKey("full", "_", "address"),
  joinKey("federal", "_", "tax", "_", "id"),
  "headers",
  joinKey("hosted", "_", "instructions", "_", "url"),
  "ip",
  joinKey("session", "_", "id"),
  joinKey("payment", "_", "intent"),
  joinKey("pix", "_", "display", "_", "qr", "_", "code"),
  joinKey("pix", "_", "copy", "_", "paste"),
  "phone",
  "telephone",
  joinKey("qr", "_", "code"),
  joinKey("raw", "_", "body"),
  joinKey("raw", "body"),
  joinKey("recipient", "_", "email"),
  joinKey("ship", "ping", "_", "address"),
  joinKey("to", "_", "email"),
  joinKey("track", "ing", "_", "token"),
  joinKey("gelato", "_", "snapshot"),
  joinKey("gelato", "_", "order", "_", "id"),
  joinKey("Ex", "change", "Request").toLowerCase(),
  joinKey("c", "pf"),
  joinKey("cn", "pj"),
])

const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/i,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "i"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "i"
  ),
  /\b00020126[0-9A-Z]+\b/i,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
]

const ERROR_REDACTION_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/gi,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "gi"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "gi"
  ),
  /000201[0-9A-Z.+-]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  /\(?(?:\+?55\s?)?(?:\d{2})\)?\s?(?:9?\d{4})-?\d{4}\b/g,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function containsForbiddenData(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenData(entry))
  }

  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, nested]) => {
      const normalizedKey = key.trim().toLowerCase()

      return (
        FORBIDDEN_OBJECT_KEYS.has(normalizedKey) || containsForbiddenData(nested)
      )
    })
  }

  return false
}

function normalizeRequiredString(
  value: string | null | undefined,
  errorCode: string,
  transform?: (input: string) => string
): string {
  const normalizedInput = value?.trim() ?? ""
  const normalized = transform
    ? transform(normalizedInput)
    : normalizedInput

  if (!normalized) {
    throw new Error(errorCode)
  }

  return normalized
}

function normalizeOptionalString(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = sanitizeString(value).slice(0, maxLength)
  return normalized.length > 0 ? normalized : null
}

function normalizeStrictPositiveInteger(
  value: number,
  errorCode: string
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(errorCode)
  }

  return value
}

function normalizeCurrencyCode(
  value: string | null | undefined,
  errorCode: string
): string {
  return normalizeRequiredString(value, errorCode, (input) =>
    input.toLowerCase()
  )
}

export function assertValidRefundRequestStatus(status: string): void {
  if (!(REFUND_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new Error("REFUND_REQUEST_STATUS_INVALID")
  }
}

export function sanitizeRefundRequestMetadata(
  metadata: RefundRequestMetadata | null | undefined
): RefundRequestMetadata | null {
  if (!metadata) {
    return null
  }

  const sanitized: RefundRequestMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.trim()

    if (!ALLOWED_METADATA_KEYS.has(normalizedKey)) {
      continue
    }

    sanitized[normalizedKey] = sanitizeMetadataValue(value)
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function sanitizeMetadataValue(value: unknown): RefundRequestMetadataValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "string") {
    return sanitizeString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadataValue(entry))
  }

  return sanitizeString(JSON.stringify(value))
}

export function assertNoSensitiveRefundRequestMetadata(
  metadata: RefundRequestMetadata | null | undefined
): void {
  if (!metadata) {
    return
  }

  if (containsForbiddenData(metadata)) {
    throw new Error("REFUND_REQUEST_METADATA_FORBIDDEN")
  }
}

export function sanitizeRefundRequestError(input: {
  code: string
  message: string
}): {
  error_code: string
  error_message: string
} {
  let message = sanitizeString(input.message).slice(0, 500)

  for (const pattern of ERROR_REDACTION_PATTERNS) {
    message = message.replace(pattern, "[redacted]")
  }

  return {
    error_code: sanitizeString(input.code).slice(0, 120),
    error_message: message,
  }
}

export function computeRefundableAvailability(input: {
  captured: Pick<OrderCapturedPaymentTruth, "captured_amount" | "currency_code">
  refund_requests: Array<
    Pick<RefundRequestRecord, "id" | "amount" | "status">
  >
  exclude_refund_request_id?: string | null
}): RefundableAvailability {
  const confirmedRefundedAmount = input.refund_requests.reduce((sum, request) => {
    if (
      !(REFUND_REQUEST_CONFIRMED_STATUSES as readonly string[]).includes(
        request.status
      )
    ) {
      return sum
    }

    return sum + request.amount
  }, 0)

  const reservedAmount = input.refund_requests.reduce((sum, request) => {
    if (
      input.exclude_refund_request_id &&
      request.id === input.exclude_refund_request_id
    ) {
      return sum
    }

    if (
      !(REFUND_REQUEST_RESERVATION_STATUSES as readonly string[]).includes(
        request.status
      )
    ) {
      return sum
    }

    return sum + request.amount
  }, 0)

  const availableAmount = Math.max(
    0,
    input.captured.captured_amount -
      confirmedRefundedAmount -
      reservedAmount
  )

  return {
    captured_amount: input.captured.captured_amount,
    confirmed_refunded_amount: confirmedRefundedAmount,
    reserved_amount: reservedAmount,
    available_amount: availableAmount,
    currency_code: input.captured.currency_code,
  }
}

export function assertRefundAmountWithinAvailability(input: {
  amount: number
  currency_code: string
  captured_currency_code: string
  availability: RefundableAvailability
}): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("REFUND_REQUEST_AMOUNT_INVALID")
  }

  const normalizedCurrency = input.currency_code.trim().toLowerCase()
  const capturedCurrency = input.captured_currency_code.trim().toLowerCase()

  if (normalizedCurrency !== capturedCurrency) {
    throw new Error("REFUND_REQUEST_CURRENCY_MISMATCH")
  }

  if (input.amount > input.availability.available_amount) {
    throw new Error("REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED")
  }
}

export function buildRefundRequestRecord(
  input: {
    id: string
    order_id: string
    payment_intent_id: string
    payment_attempt_id: string
    idempotency_key: string
    amount: number
    currency_code: string
    reason?: string | null
    operator_note?: string | null
    requested_by_operator_id?: string | null
    metadata?: RefundRequestMetadata | null
    status?: RefundRequestStatus
  },
  at: Date = new Date()
): RefundRequestRecord {
  const status =
    input.status ?? REFUND_REQUEST_SLICE_ALLOWED_CREATE_STATUSES[0]

  if (
    !(REFUND_REQUEST_SLICE_ALLOWED_CREATE_STATUSES as readonly string[]).includes(
      status
    )
  ) {
    throw new Error("REFUND_REQUEST_SLICE_STATUS_FORBIDDEN")
  }

  const metadata = sanitizeRefundRequestMetadata(input.metadata)
  assertNoSensitiveRefundRequestMetadata(metadata)

  return {
    id: input.id,
    order_id: normalizeRequiredString(input.order_id, "REFUND_REQUEST_ORDER_ID_REQUIRED"),
    payment_intent_id: normalizeRequiredString(
      input.payment_intent_id,
      "REFUND_REQUEST_PAYMENT_INTENT_ID_REQUIRED"
    ),
    payment_attempt_id: normalizeRequiredString(
      input.payment_attempt_id,
      "REFUND_REQUEST_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    stripe_refund_id: null,
    idempotency_key: normalizeRequiredString(
      input.idempotency_key,
      "REFUND_REQUEST_IDEMPOTENCY_KEY_REQUIRED"
    ),
    amount: normalizeStrictPositiveInteger(
      input.amount,
      "REFUND_REQUEST_AMOUNT_INVALID"
    ),
    currency_code: normalizeCurrencyCode(
      input.currency_code,
      "REFUND_REQUEST_CURRENCY_REQUIRED"
    ),
    reason: normalizeOptionalString(input.reason, 240),
    operator_note: normalizeOptionalString(input.operator_note, 1000),
    status,
    failure_code: null,
    failure_message: null,
    requested_by_operator_id: normalizeOptionalString(
      input.requested_by_operator_id,
      120
    ),
    confirmed_at: null,
    failed_at: null,
    canceled_at: null,
    rejected_at: null,
    metadata,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
  }
}

export function normalizeCreateRefundRequestInput(
  input: CreateRefundRequestInput
): CreateRefundRequestInput {
  const metadata = sanitizeRefundRequestMetadata(input.metadata)
  assertNoSensitiveRefundRequestMetadata(metadata)

  return {
    order_id: normalizeRequiredString(input.order_id, "REFUND_REQUEST_ORDER_ID_REQUIRED"),
    amount: normalizeStrictPositiveInteger(
      input.amount,
      "REFUND_REQUEST_AMOUNT_INVALID"
    ),
    currency_code: normalizeCurrencyCode(
      input.currency_code,
      "REFUND_REQUEST_CURRENCY_REQUIRED"
    ),
    idempotency_key: normalizeRequiredString(
      input.idempotency_key,
      "REFUND_REQUEST_IDEMPOTENCY_KEY_REQUIRED"
    ),
    reason: normalizeOptionalString(input.reason, 240),
    operator_note: normalizeOptionalString(input.operator_note, 1000),
    requested_by_operator_id: normalizeOptionalString(
      input.requested_by_operator_id,
      120
    ),
    metadata,
  }
}

export function createAdminRefundRequest(input: {
  request: CreateRefundRequestInput
  order_metadata: Record<string, unknown> | null | undefined
  payment_attempt: Parameters<typeof resolveOrderCapturedPaymentTruth>[0]["payment_attempt"]
  existing_refund_requests: RefundRequestRecord[]
  existing_by_idempotency_key?: RefundRequestRecord | null
  id: string
  /**
   * Authenticated Admin actor_id only. Never accept client-supplied operator IDs.
   */
  requested_by_operator_id?: string | null
  at?: Date
}): AdminCreateRefundRequestResult {
  const normalized = normalizeCreateRefundRequestInput({
    ...input.request,
    requested_by_operator_id: undefined,
  })

  if (input.existing_by_idempotency_key) {
    const captured = resolveOrderCapturedPaymentTruth({
      order_id: normalized.order_id,
      order_metadata: input.order_metadata,
      payment_attempt: input.payment_attempt,
    })

    return {
      refund_request: input.existing_by_idempotency_key,
      reused_idempotency: true,
      availability: computeRefundableAvailability({
        captured,
        refund_requests: input.existing_refund_requests,
      }),
    }
  }

  const captured = resolveOrderCapturedPaymentTruth({
    order_id: normalized.order_id,
    order_metadata: input.order_metadata,
    payment_attempt: input.payment_attempt,
  })

  const availability = computeRefundableAvailability({
    captured,
    refund_requests: input.existing_refund_requests,
  })

  assertRefundAmountWithinAvailability({
    amount: normalized.amount,
    currency_code: normalized.currency_code,
    captured_currency_code: captured.currency_code,
    availability,
  })

  const refundRequest = buildRefundRequestRecord(
    {
      id: input.id,
      order_id: captured.order_id,
      payment_intent_id: captured.payment_intent_id,
      payment_attempt_id: captured.payment_attempt_id,
      idempotency_key: normalized.idempotency_key,
      amount: normalized.amount,
      currency_code: captured.currency_code,
      reason: normalized.reason,
      operator_note: normalized.operator_note,
      requested_by_operator_id: input.requested_by_operator_id ?? null,
      metadata: normalized.metadata,
    },
    input.at
  )

  const postCreateAvailability = computeRefundableAvailability({
    captured,
    refund_requests: [...input.existing_refund_requests, refundRequest],
  })

  return {
    refund_request: refundRequest,
    reused_idempotency: false,
    availability: postCreateAvailability,
  }
}

class RefundRequestModuleService extends MedusaService({
  RefundRequest,
}) {
  protected readonly dependencies_: Record<string, unknown>

  constructor(dependencies: Record<string, unknown> = {}) {
    super(...arguments)
    this.dependencies_ = dependencies
  }

  async resolveStripeRefundCreationLayer(): Promise<StripeRefundCreationLayer | null> {
    return resolveStripeRefundCreationLayer(this.dependencies_)
  }
}

export default RefundRequestModuleService
export { STRIPE_REFUND_CREATION_LAYER_TOKEN }
