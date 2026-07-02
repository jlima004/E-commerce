import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import GelatoFulfillment from "./models/gelato-fulfillment"
import {
  GELATO_FULFILLMENT_ACTIVE_STATUSES,
  GELATO_FULFILLMENT_PROVIDER,
  GELATO_FULFILLMENT_STATUSES,
  GELATO_FULFILLMENT_STATUS,
  GELATO_FULFILLMENT_TERMINAL_STATUSES,
  type BuildGelatoDispatchIdempotencyKeyInput,
  type CreateGelatoFulfillmentInput,
  type GelatoFulfillmentMetadata,
  type GelatoFulfillmentMetadataValue,
  type GelatoFulfillmentProvider,
  type GelatoFulfillmentRecord,
  type GelatoFulfillmentRequestSummary,
  type GelatoFulfillmentRequestSummaryInput,
  type GelatoFulfillmentResponseSummary,
  type GelatoFulfillmentResponseSummaryInput,
  type GelatoFulfillmentStatus,
  type GelatoFulfillmentTrackingSummary,
  type GelatoFulfillmentTrackingSummaryInput,
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
  joinKey("x", "-", "api", "-", "key"),
  joinKey("gelato", "_", "api", "_", "key"),
  joinKey("authori", "zation"),
  joinKey("bear", "er"),
  "cookie",
  joinKey("cookie", "s"),
  "headers",
  joinKey("raw", "_", "body"),
  joinKey("raw", "body"),
  joinKey("client", "_", "secret"),
  joinKey("pix", "_", "qr"),
  joinKey("pix", "_", "copy", "_", "paste"),
  joinKey("hosted", "_", "instructions", "_", "url"),
  joinKey("federal", "tax", "id").toLowerCase(),
  joinKey("federal", "_", "tax", "_", "id"),
  joinKey("c", "pf"),
  joinKey("cn", "pj"),
  "email",
  joinKey("customer", "_", "email"),
  "phone",
  "telephone",
  joinKey("ship", "ping", "_", "address"),
  joinKey("bill", "ing", "_", "address"),
  joinKey("full", "_", "address"),
  joinKey("track", "ing", "_", "token"),
  joinKey("tracking", "_", "url"),
  joinKey("tracking", "_", "code"),
  joinKey("gelato", "_", "snapshot"),
  "refund",
  joinKey("ex", "change"),
  joinKey("stripe", "_", "cli"),
  joinKey("pay", "load"),
])

const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
  /\b00020126[0-9A-Z]+\b/i,
  /\b[A-Z0-9]{8,}\.[A-Z0-9]{8,}\.[A-Z0-9]{8,}\b/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i,
  /\(?(?:\+?55\s?)?(?:\d{2})\)?\s?(?:9?\d{4})-?\d{4}\b/,
]

const ERROR_REDACTION_PATTERNS: RegExp[] = [
  /\bX-API-KEY\b/gi,
  /\bGELATO_API_KEY\b/gi,
  /\bAuthorization\b/gi,
  /\bBearer\b/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\b00020126[0-9A-Z]+\b/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  /\(?(?:\+?55\s?)?(?:\d{2})\)?\s?(?:9?\d{4})-?\d{4}\b/g,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
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

function sanitizeMetadataValue(
  value: unknown
): GelatoFulfillmentMetadataValue {
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

  const normalized = sanitizeString(value.trim()).slice(0, maxLength)

  return normalized || null
}

function normalizeOptionalSanitizedText(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = sanitizeGelatoFulfillmentErrorText(value.trim()).slice(
    0,
    maxLength
  )

  return normalized || null
}

function normalizeNonNegativeInteger(value: number, errorCode: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(errorCode)
  }

  return value
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

function normalizeIsoDate(
  value: Date | string | null | undefined,
  errorCode: string
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error(errorCode)
  }

  return date.toISOString()
}

function normalizeConnectedOrderIds(
  orderId: string,
  connectedOrderIds: string[] | null | undefined
): string[] {
  if (!connectedOrderIds?.length) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const connectedOrderId of connectedOrderIds) {
    const candidate = normalizeRequiredString(
      connectedOrderId,
      "GELATO_FULFILLMENT_CONNECTED_ORDER_ID_REQUIRED"
    )

    if (candidate === orderId || seen.has(candidate)) {
      continue
    }

    seen.add(candidate)
    normalized.push(candidate)
  }

  return normalized
}

class GelatoFulfillmentModuleService extends MedusaService({
  GelatoFulfillment,
}) {}

export default GelatoFulfillmentModuleService

export function assertValidGelatoFulfillmentProvider(
  provider: string
): asserts provider is GelatoFulfillmentProvider {
  if (provider !== GELATO_FULFILLMENT_PROVIDER.GELATO) {
    throw new Error("GELATO_FULFILLMENT_PROVIDER_INVALID")
  }
}

export function assertValidGelatoFulfillmentStatus(
  status: string
): asserts status is GelatoFulfillmentStatus {
  if (!GELATO_FULFILLMENT_STATUSES.includes(status as GelatoFulfillmentStatus)) {
    throw new Error("GELATO_FULFILLMENT_STATUS_INVALID")
  }
}

export function buildGelatoDispatchIdempotencyKey(
  input: BuildGelatoDispatchIdempotencyKeyInput
): string {
  const orderId = normalizeRequiredString(
    input.order_id,
    "GELATO_FULFILLMENT_ORDER_ID_REQUIRED"
  )

  return `gelato-dispatch:${orderId}`
}

export function isGelatoFulfillmentActiveStatus(
  fulfillment:
    | Pick<GelatoFulfillmentRecord, "status">
    | GelatoFulfillmentStatus
    | string
    | null
    | undefined
): boolean {
  const status =
    typeof fulfillment === "string" ? fulfillment : fulfillment?.status

  if (!status) {
    return false
  }

  return GELATO_FULFILLMENT_ACTIVE_STATUSES.includes(
    status as GelatoFulfillmentStatus
  )
}

export function isGelatoFulfillmentTerminalStatus(
  fulfillment:
    | Pick<GelatoFulfillmentRecord, "status">
    | GelatoFulfillmentStatus
    | string
    | null
    | undefined
): boolean {
  const status =
    typeof fulfillment === "string" ? fulfillment : fulfillment?.status

  if (!status) {
    return false
  }

  return GELATO_FULFILLMENT_TERMINAL_STATUSES.includes(
    status as GelatoFulfillmentStatus
  )
}

export function assertSingleActiveGelatoFulfillmentForOrder(input: {
  order_id: string
  existing:
    | Pick<GelatoFulfillmentRecord, "order_id" | "status">
    | null
    | undefined
}): void {
  const orderId = normalizeRequiredString(
    input.order_id,
    "GELATO_FULFILLMENT_ORDER_ID_REQUIRED"
  )

  if (!input.existing) {
    return
  }

  if (input.existing.order_id !== orderId) {
    return
  }

  const status = input.existing.status
  const reason = isGelatoFulfillmentActiveStatus(status)
    ? "GELATO_FULFILLMENT_ORDER_ALREADY_ACTIVE"
    : "GELATO_FULFILLMENT_ORDER_ALREADY_RECORDED"

  throw new Error(reason)
}

export function assertNoSensitiveGelatoFulfillmentMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  if (containsForbiddenData(metadata)) {
    throw new Error("GELATO_FULFILLMENT_METADATA_FORBIDDEN")
  }
}

export function sanitizeGelatoFulfillmentMetadata(
  metadata: Record<string, unknown> | null | undefined
): GelatoFulfillmentMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveGelatoFulfillmentMetadata(metadata)

  const output: GelatoFulfillmentMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function buildGelatoFulfillmentRequestSummary(
  input: GelatoFulfillmentRequestSummaryInput &
    Record<string, unknown>
): GelatoFulfillmentRequestSummary {
  if (containsForbiddenData(input)) {
    throw new Error("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")
  }

  assertValidGelatoFulfillmentStatus(input.status)
  const orderId = normalizeRequiredString(
    input.order_id,
    "GELATO_FULFILLMENT_ORDER_ID_REQUIRED"
  )

  return {
    order_id: orderId,
    cart_id: normalizeRequiredString(
      input.cart_id,
      "GELATO_FULFILLMENT_CART_ID_REQUIRED"
    ),
    payment_attempt_id: normalizeRequiredString(
      input.payment_attempt_id,
      "GELATO_FULFILLMENT_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    checkout_completion_log_id: normalizeRequiredString(
      input.checkout_completion_log_id,
      "GELATO_FULFILLMENT_CHECKOUT_COMPLETION_LOG_ID_REQUIRED"
    ),
    analytics_event_log_id: normalizeRequiredString(
      input.analytics_event_log_id,
      "GELATO_FULFILLMENT_ANALYTICS_EVENT_LOG_ID_REQUIRED"
    ),
    email_delivery_log_id: normalizeRequiredString(
      input.email_delivery_log_id,
      "GELATO_FULFILLMENT_EMAIL_DELIVERY_LOG_ID_REQUIRED"
    ),
    idempotency_key: normalizeRequiredString(
      input.idempotency_key,
      "GELATO_FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED"
    ),
    request_hash: normalizeRequiredString(
      input.request_hash,
      "GELATO_FULFILLMENT_REQUEST_HASH_REQUIRED"
    ),
    item_count: normalizeStrictPositiveInteger(
      input.item_count,
      "GELATO_FULFILLMENT_ITEM_COUNT_INVALID"
    ),
    currency_code: normalizeRequiredString(
      input.currency_code,
      "GELATO_FULFILLMENT_CURRENCY_CODE_REQUIRED",
      (value) => value.toLowerCase()
    ),
    status: input.status,
    connected_order_ids: normalizeConnectedOrderIds(
      orderId,
      input.connected_order_ids
    ),
  }
}

export function buildGelatoFulfillmentResponseSummary(
  input: GelatoFulfillmentResponseSummaryInput &
    Record<string, unknown>
): GelatoFulfillmentResponseSummary {
  if (containsForbiddenData(input)) {
    throw new Error("GELATO_FULFILLMENT_RESPONSE_SUMMARY_FORBIDDEN")
  }

  assertValidGelatoFulfillmentProvider(input.provider)
  assertValidGelatoFulfillmentStatus(input.status)

  return {
    provider: input.provider,
    status: input.status,
    connected_order_ids: normalizeConnectedOrderIds(
      "__local__",
      input.connected_order_ids
    ),
    gelato_primary_order_id: normalizeOptionalString(
      input.gelato_primary_order_id,
      120
    ),
    provider_status: normalizeOptionalString(input.provider_status, 120),
    provider_reference_id: normalizeOptionalString(
      input.provider_reference_id,
      120
    ),
  }
}

export function buildGelatoFulfillmentTrackingSummary(
  input: GelatoFulfillmentTrackingSummaryInput & Record<string, unknown>
): GelatoFulfillmentTrackingSummary {
  if (containsForbiddenData(input)) {
    throw new Error("GELATO_FULFILLMENT_TRACKING_SUMMARY_FORBIDDEN")
  }

  assertValidGelatoFulfillmentStatus(input.status)

  return {
    status: input.status,
    tracking_status: normalizeOptionalString(input.tracking_status, 120),
    connected_order_ids: normalizeConnectedOrderIds(
      "__local__",
      input.connected_order_ids
    ),
  }
}

export function sanitizeGelatoFulfillmentErrorText(value: string): string {
  let sanitized = sanitizeString(value)

  for (const pattern of ERROR_REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]")
  }

  return sanitized
}

export function sanitizeGelatoFulfillmentError(error: unknown): {
  error_code: string | null
  error_message: string | null
} {
  if (error instanceof Error) {
    return {
      error_code:
        sanitizeGelatoFulfillmentErrorText(error.name || "Error").slice(0, 120) ||
        "Error",
      error_message:
        sanitizeGelatoFulfillmentErrorText(error.message).slice(0, 500) || null,
    }
  }

  if (typeof error === "string") {
    return {
      error_code: "Error",
      error_message:
        sanitizeGelatoFulfillmentErrorText(error).slice(0, 500) || null,
    }
  }

  return {
    error_code: "Error",
    error_message: null,
  }
}

export function buildGelatoFulfillmentRecord(
  input: CreateGelatoFulfillmentInput,
  id: string,
  at: Date = new Date()
): GelatoFulfillmentRecord {
  const orderId = normalizeRequiredString(
    input.order_id,
    "GELATO_FULFILLMENT_ORDER_ID_REQUIRED"
  )
  const timestamp = at.toISOString()
  const status = input.status ?? GELATO_FULFILLMENT_STATUS.RECORDED
  const requestSummary = buildGelatoFulfillmentRequestSummary(input.request_summary)

  assertValidGelatoFulfillmentStatus(status)

  return {
    id,
    order_id: orderId,
    cart_id: normalizeRequiredString(
      input.cart_id,
      "GELATO_FULFILLMENT_CART_ID_REQUIRED"
    ),
    payment_attempt_id: normalizeRequiredString(
      input.payment_attempt_id,
      "GELATO_FULFILLMENT_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    checkout_completion_log_id: normalizeRequiredString(
      input.checkout_completion_log_id,
      "GELATO_FULFILLMENT_CHECKOUT_COMPLETION_LOG_ID_REQUIRED"
    ),
    analytics_event_log_id: normalizeRequiredString(
      input.analytics_event_log_id,
      "GELATO_FULFILLMENT_ANALYTICS_EVENT_LOG_ID_REQUIRED"
    ),
    email_delivery_log_id: normalizeRequiredString(
      input.email_delivery_log_id,
      "GELATO_FULFILLMENT_EMAIL_DELIVERY_LOG_ID_REQUIRED"
    ),
    idempotency_key: buildGelatoDispatchIdempotencyKey({ order_id: orderId }),
    order_reference_id: orderId,
    customer_reference_id: normalizeOptionalString(
      input.customer_reference_id,
      120
    ),
    status,
    gelato_primary_order_id: normalizeOptionalString(
      input.gelato_primary_order_id,
      120
    ),
    connected_order_ids: normalizeConnectedOrderIds(
      orderId,
      input.connected_order_ids ?? requestSummary.connected_order_ids
    ),
    request_hash: normalizeRequiredString(
      input.request_hash,
      "GELATO_FULFILLMENT_REQUEST_HASH_REQUIRED"
    ),
    request_summary: requestSummary,
    response_summary: input.response_summary
      ? buildGelatoFulfillmentResponseSummary(input.response_summary)
      : null,
    tracking_summary: input.tracking_summary
      ? buildGelatoFulfillmentTrackingSummary(input.tracking_summary)
      : null,
    metadata: sanitizeGelatoFulfillmentMetadata(input.metadata),
    attempt_count: normalizeNonNegativeInteger(
      input.attempt_count ?? 0,
      "GELATO_FULFILLMENT_ATTEMPT_COUNT_INVALID"
    ),
    last_error_code: normalizeOptionalSanitizedText(input.last_error_code, 120),
    last_error_message: normalizeOptionalSanitizedText(
      input.last_error_message,
      500
    ),
    next_retry_at: normalizeIsoDate(
      input.next_retry_at,
      "GELATO_FULFILLMENT_NEXT_RETRY_AT_INVALID"
    ),
    requires_operator_attention: Boolean(input.requires_operator_attention),
    operator_alert_code: normalizeOptionalSanitizedText(
      input.operator_alert_code,
      120
    ),
    operator_alert_message: normalizeOptionalSanitizedText(
      input.operator_alert_message,
      500
    ),
    operator_alerted_at: normalizeIsoDate(
      input.operator_alerted_at,
      "GELATO_FULFILLMENT_OPERATOR_ALERTED_AT_INVALID"
    ),
    recorded_at:
      normalizeIsoDate(
        input.recorded_at ?? at,
        "GELATO_FULFILLMENT_RECORDED_AT_INVALID"
      ) ?? timestamp,
    queued_at: normalizeIsoDate(
      input.queued_at,
      "GELATO_FULFILLMENT_QUEUED_AT_INVALID"
    ),
    dispatching_started_at: normalizeIsoDate(
      input.dispatching_started_at,
      "GELATO_FULFILLMENT_DISPATCHING_STARTED_AT_INVALID"
    ),
    submitted_at: normalizeIsoDate(
      input.submitted_at,
      "GELATO_FULFILLMENT_SUBMITTED_AT_INVALID"
    ),
    accepted_at: normalizeIsoDate(
      input.accepted_at,
      "GELATO_FULFILLMENT_ACCEPTED_AT_INVALID"
    ),
    failed_at: normalizeIsoDate(
      input.failed_at,
      "GELATO_FULFILLMENT_FAILED_AT_INVALID"
    ),
    dead_lettered_at: normalizeIsoDate(
      input.dead_lettered_at,
      "GELATO_FULFILLMENT_DEAD_LETTERED_AT_INVALID"
    ),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  }
}

export function buildGelatoDeadLetterUpdate(
  input: {
    error: unknown
    operator_alert_code: string
    operator_alert_message: string
  },
  at: Date = new Date()
): Pick<
  GelatoFulfillmentRecord,
  | "status"
  | "requires_operator_attention"
  | "operator_alert_code"
  | "operator_alert_message"
  | "operator_alerted_at"
  | "last_error_code"
  | "last_error_message"
  | "dead_lettered_at"
  | "updated_at"
> {
  const sanitizedError = sanitizeGelatoFulfillmentError(input.error)
  const iso = at.toISOString()

  return {
    status: GELATO_FULFILLMENT_STATUS.DEAD_LETTER,
    requires_operator_attention: true,
    operator_alert_code: normalizeRequiredString(
      sanitizeGelatoFulfillmentErrorText(input.operator_alert_code),
      "GELATO_FULFILLMENT_OPERATOR_ALERT_CODE_REQUIRED"
    ).slice(0, 120),
    operator_alert_message: normalizeRequiredString(
      sanitizeGelatoFulfillmentErrorText(input.operator_alert_message),
      "GELATO_FULFILLMENT_OPERATOR_ALERT_MESSAGE_REQUIRED"
    ).slice(0, 500),
    operator_alerted_at: iso,
    last_error_code: sanitizedError.error_code,
    last_error_message: sanitizedError.error_message,
    dead_lettered_at: iso,
    updated_at: iso,
  }
}
