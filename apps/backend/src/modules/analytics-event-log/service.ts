import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import AnalyticsEventLog from "./models/analytics-event-log"
import {
  ANALYTICS_EVENT_NAME,
  ANALYTICS_EVENT_STATUSES,
  ANALYTICS_EVENT_STATUS,
  ANALYTICS_EVENT_VERSION,
  PURCHASE_COMPLETED_LOCAL_GATE_STATUSES,
  type AnalyticsEventLogRecord,
  type AnalyticsEventMetadata,
  type AnalyticsEventMetadataValue,
  type AnalyticsEventName,
  type AnalyticsEventStatus,
  type BuildPurchaseCompletedIdempotencyKeyInput,
  type CreateAnalyticsEventLogInput,
  type PurchaseCompletedItemInput,
  type PurchaseCompletedPayload,
  type PurchaseCompletedPayloadInput,
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
  joinKey("cookie", "s"),
  "cookie",
  joinKey("client", "_", "secret"),
  joinKey("copy", "_", "paste"),
  "headers",
  joinKey("hosted", "_", "instructions", "_", "url"),
  joinKey("pix", "_", "copy", "_", "paste"),
  joinKey("pix", "_", "display", "_", "qr", "_", "code"),
  joinKey("qr", "_", "code"),
  joinKey("raw", "_", "body"),
  joinKey("raw", "body"),
  joinKey("federal", "_", "tax", "_", "id"),
  joinKey("ship", "ping", "_", "address"),
  joinKey("bill", "ing", "_", "address"),
  joinKey("full", "_", "address"),
  joinKey("track", "ing", "_", "token"),
  joinKey("gelato", "_", "snapshot"),
  joinKey("gelato", "_", "order", "_", "id"),
  joinKey("pay", "load"),
  joinKey("next", "_", "action"),
  joinKey("session", "_", "id"),
  joinKey("user", "_", "agent"),
  "ip",
  "phone",
  "telephone",
  "email",
  "name",
  joinKey("full", "_", "name"),
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
  /\b00020126[0-9A-Z]+/i,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
  /\bt=\d+,v1=[a-f0-9]+\b/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
]

const ERROR_REDACTION_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/gi,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "gi"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "gi"
  ),
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\bt=\d+,v1=[a-f0-9]+\b/gi,
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

function sanitizeMetadataValue(value: unknown): AnalyticsEventMetadataValue {
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
  value: string,
  errorCode: string,
  transform?: (input: string) => string
): string {
  const normalized = transform ? transform(value.trim()) : value.trim()

  if (!normalized) {
    throw new Error(errorCode)
  }

  return normalized
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

class AnalyticsEventLogModuleService extends MedusaService({
  AnalyticsEventLog,
}) {}

export default AnalyticsEventLogModuleService

export function assertValidAnalyticsEventName(
  eventName: string
): asserts eventName is AnalyticsEventName {
  if (eventName !== ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED) {
    throw new Error("ANALYTICS_EVENT_NAME_INVALID")
  }
}

export function assertValidAnalyticsEventVersion(
  eventVersion: number
): asserts eventVersion is typeof ANALYTICS_EVENT_VERSION {
  if (eventVersion !== ANALYTICS_EVENT_VERSION) {
    throw new Error("ANALYTICS_EVENT_VERSION_INVALID")
  }
}

export function assertValidAnalyticsEventStatus(
  status: string
): asserts status is AnalyticsEventStatus {
  if (!ANALYTICS_EVENT_STATUSES.includes(status as AnalyticsEventStatus)) {
    throw new Error("ANALYTICS_EVENT_STATUS_INVALID")
  }
}

export function buildPurchaseCompletedIdempotencyKey(
  input: BuildPurchaseCompletedIdempotencyKeyInput
): string {
  const paymentIntentId = input.payment_intent_id?.trim()

  if (!paymentIntentId) {
    throw new Error("ANALYTICS_PAYMENT_INTENT_ID_REQUIRED")
  }

  return `${ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED}:stripe:${paymentIntentId}`
}

export function assertNoSensitiveAnalyticsMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  if (containsForbiddenData(metadata)) {
    throw new Error("ANALYTICS_METADATA_FORBIDDEN")
  }
}

export function sanitizeAnalyticsMetadata(
  metadata: Record<string, unknown> | null | undefined
): AnalyticsEventMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveAnalyticsMetadata(metadata)

  const output: AnalyticsEventMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function sanitizeAnalyticsError(error: unknown): {
  error_code: string | null
  error_message: string | null
} {
  const sanitizeErrorMessage = (value: string): string => {
    let sanitized = sanitizeString(value)

    for (const pattern of ERROR_REDACTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]")
    }

    return sanitized
  }

  if (error instanceof Error) {
    return {
      error_code: sanitizeString(error.name || "Error").slice(0, 120) || "Error",
      error_message: sanitizeErrorMessage(error.message).slice(0, 500) || null,
    }
  }

  if (typeof error === "string") {
    return {
      error_code: "Error",
      error_message: sanitizeErrorMessage(error).slice(0, 500) || null,
    }
  }

  return {
    error_code: "Error",
    error_message: null,
  }
}

function buildPurchaseCompletedItem(
  item: PurchaseCompletedItemInput
): PurchaseCompletedItemInput {
  return {
    variant_id: normalizeRequiredString(
      item.variant_id,
      "ANALYTICS_ITEM_VARIANT_ID_REQUIRED"
    ),
    sku: item.sku ? sanitizeString(item.sku.trim()) : null,
    quantity: normalizeStrictPositiveInteger(
      item.quantity,
      "ANALYTICS_ITEM_QUANTITY_INVALID"
    ),
    unit_price: normalizeStrictPositiveInteger(
      item.unit_price,
      "ANALYTICS_ITEM_UNIT_PRICE_INVALID"
    ),
    subtotal: normalizeStrictPositiveInteger(
      item.subtotal,
      "ANALYTICS_ITEM_SUBTOTAL_INVALID"
    ),
  }
}

export function buildPurchaseCompletedPayload(
  input: PurchaseCompletedPayloadInput & Record<string, unknown>
): PurchaseCompletedPayload {
  if (containsForbiddenData(input)) {
    throw new Error("ANALYTICS_PAYLOAD_FORBIDDEN")
  }

  const eventName = input.event_name ?? ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED
  const eventVersion = input.event_version ?? ANALYTICS_EVENT_VERSION

  assertValidAnalyticsEventName(eventName)
  assertValidAnalyticsEventVersion(eventVersion)

  const items = input.items.map((item) => buildPurchaseCompletedItem(item))
  const itemCount = normalizeStrictPositiveInteger(
    input.item_count,
    "ANALYTICS_ITEM_COUNT_INVALID"
  )

  if (items.length !== itemCount) {
    throw new Error("ANALYTICS_ITEM_COUNT_MISMATCH")
  }

  const currencyCode = normalizeRequiredString(
    input.currency_code,
    "ANALYTICS_CURRENCY_CODE_REQUIRED",
    (value) => value.toLowerCase()
  )

  if (currencyCode !== "brl") {
    throw new Error("ANALYTICS_CURRENCY_CODE_INVALID")
  }

  const paymentMethodType = normalizeRequiredString(
    input.payment_method_type,
    "ANALYTICS_PAYMENT_METHOD_TYPE_REQUIRED",
    (value) => value.toLowerCase()
  )

  if (paymentMethodType !== "card" && paymentMethodType !== "pix") {
    throw new Error("ANALYTICS_PAYMENT_METHOD_TYPE_INVALID")
  }

  return {
    event_name: eventName,
    event_version: ANALYTICS_EVENT_VERSION,
    occurred_at:
      normalizeIsoDate(input.occurred_at, "ANALYTICS_OCCURRED_AT_INVALID")!,
    order_id: normalizeRequiredString(
      input.order_id,
      "ANALYTICS_ORDER_ID_REQUIRED"
    ),
    cart_id: normalizeRequiredString(input.cart_id, "ANALYTICS_CART_ID_REQUIRED"),
    payment_attempt_id: normalizeRequiredString(
      input.payment_attempt_id,
      "ANALYTICS_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    checkout_completion_log_id: normalizeRequiredString(
      input.checkout_completion_log_id,
      "ANALYTICS_CHECKOUT_COMPLETION_LOG_ID_REQUIRED"
    ),
    payment_intent_id: normalizeRequiredString(
      input.payment_intent_id,
      "ANALYTICS_PAYMENT_INTENT_ID_REQUIRED"
    ),
    payment_method_type: paymentMethodType,
    amount: normalizeStrictPositiveInteger(
      input.amount,
      "ANALYTICS_AMOUNT_INVALID"
    ),
    currency_code: currencyCode,
    order_status: normalizeRequiredString(
      input.order_status,
      "ANALYTICS_ORDER_STATUS_REQUIRED"
    ),
    payment_status: normalizeRequiredString(
      input.payment_status,
      "ANALYTICS_PAYMENT_STATUS_REQUIRED"
    ),
    item_count: itemCount,
    items,
  }
}

export function buildAnalyticsEventLogRecord(
  input: CreateAnalyticsEventLogInput,
  id: string,
  at: Date = new Date()
): AnalyticsEventLogRecord {
  const payload = buildPurchaseCompletedPayload(
    input.payload as PurchaseCompletedPayloadInput & Record<string, unknown>
  )
  const eventName = input.event_name ?? payload.event_name
  const eventVersion = input.event_version ?? payload.event_version
  const status = input.status ?? ANALYTICS_EVENT_STATUS.RECORDED
  const recordedAt =
    normalizeIsoDate(
      input.recorded_at ?? at,
      "ANALYTICS_RECORDED_AT_INVALID"
    ) ?? at.toISOString()

  assertValidAnalyticsEventName(eventName)
  assertValidAnalyticsEventVersion(eventVersion)
  assertValidAnalyticsEventStatus(status)

  return {
    id,
    event_name: eventName,
    event_version: ANALYTICS_EVENT_VERSION,
    idempotency_key:
      input.idempotency_key ??
      buildPurchaseCompletedIdempotencyKey({
        payment_intent_id: input.payment_intent_id ?? payload.payment_intent_id,
      }),
    order_id: input.order_id ?? payload.order_id,
    cart_id: input.cart_id ?? payload.cart_id,
    payment_attempt_id: input.payment_attempt_id ?? payload.payment_attempt_id,
    checkout_completion_log_id:
      input.checkout_completion_log_id ?? payload.checkout_completion_log_id,
    payment_intent_id: input.payment_intent_id ?? payload.payment_intent_id,
    status,
    payload,
    metadata: sanitizeAnalyticsMetadata(input.metadata),
    attempt_count:
      input.attempt_count === undefined
        ? 0
        : normalizeNonNegativeInteger(
            input.attempt_count,
            "ANALYTICS_ATTEMPT_COUNT_INVALID"
          ),
    last_error_code: input.last_error_code
      ? sanitizeString(input.last_error_code).slice(0, 120)
      : null,
    last_error_message: input.last_error_message
      ? sanitizeString(input.last_error_message).slice(0, 500)
      : null,
    next_retry_at:
      normalizeIsoDate(input.next_retry_at, "ANALYTICS_NEXT_RETRY_AT_INVALID"),
    recorded_at: recordedAt,
    queued_at: normalizeIsoDate(input.queued_at, "ANALYTICS_QUEUED_AT_INVALID"),
    sending_started_at: normalizeIsoDate(
      input.sending_started_at,
      "ANALYTICS_SENDING_STARTED_AT_INVALID"
    ),
    sent_at: normalizeIsoDate(input.sent_at, "ANALYTICS_SENT_AT_INVALID"),
    failed_at: normalizeIsoDate(input.failed_at, "ANALYTICS_FAILED_AT_INVALID"),
    dead_lettered_at: normalizeIsoDate(
      input.dead_lettered_at,
      "ANALYTICS_DEAD_LETTERED_AT_INVALID"
    ),
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
  }
}

export function isPurchaseCompletedLocallyRecorded(
  event:
    | Pick<AnalyticsEventLogRecord, "status">
    | AnalyticsEventStatus
    | string
    | null
    | undefined
): boolean {
  const status =
    typeof event === "string" ? event : event?.status

  if (!status) {
    return false
  }

  return PURCHASE_COMPLETED_LOCAL_GATE_STATUSES.includes(
    status as (typeof PURCHASE_COMPLETED_LOCAL_GATE_STATUSES)[number]
  )
}

export const ANALYTICS_RELAY_MAX_ATTEMPTS = 5 as const
export const ANALYTICS_RELAY_BACKOFF_BASE_MS = 60_000
export const ANALYTICS_RELAY_BACKOFF_MAX_MS = 3_600_000

export type PostHogCaptureInput = {
  event: string
  distinctId: string
  properties: PurchaseCompletedPayload
}

export type AnalyticsRelayClaimUpdate = Pick<
  AnalyticsEventLogRecord,
  "status" | "queued_at" | "sending_started_at" | "updated_at"
>

export type AnalyticsRelaySuccessUpdate = Pick<
  AnalyticsEventLogRecord,
  | "status"
  | "sent_at"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "updated_at"
>

export type AnalyticsRelayFailureUpdate = Pick<
  AnalyticsEventLogRecord,
  | "status"
  | "attempt_count"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "failed_at"
  | "dead_lettered_at"
  | "updated_at"
>

export function computeAnalyticsRelayBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1)
  const backoff = ANALYTICS_RELAY_BACKOFF_BASE_MS * 2 ** exponent

  return Math.min(backoff, ANALYTICS_RELAY_BACKOFF_MAX_MS)
}

export function isAnalyticsRelayDue(
  nextRetryAt: string | null | undefined,
  now: Date
): boolean {
  if (!nextRetryAt) {
    return true
  }

  const retryAt = new Date(nextRetryAt)

  if (Number.isNaN(retryAt.getTime())) {
    return true
  }

  return retryAt.getTime() <= now.getTime()
}

export function isAnalyticsRelayEligibleStatus(
  status: AnalyticsEventStatus | string
): boolean {
  return (
    status === ANALYTICS_EVENT_STATUS.RECORDED ||
    status === ANALYTICS_EVENT_STATUS.FAILED
  )
}

export function buildPostHogCaptureFromAnalyticsEvent(
  record: Pick<AnalyticsEventLogRecord, "event_name" | "order_id" | "payload">
): PostHogCaptureInput {
  return {
    event: record.event_name,
    distinctId: record.order_id,
    properties: record.payload,
  }
}

export function buildAnalyticsRelayClaimUpdate(
  at: Date = new Date()
): AnalyticsRelayClaimUpdate {
  const iso = at.toISOString()

  return {
    status: ANALYTICS_EVENT_STATUS.QUEUED,
    queued_at: iso,
    sending_started_at: iso,
    updated_at: iso,
  }
}

export function buildAnalyticsRelaySendingUpdate(
  at: Date = new Date()
): Pick<AnalyticsEventLogRecord, "status" | "updated_at"> {
  return {
    status: ANALYTICS_EVENT_STATUS.SENDING,
    updated_at: at.toISOString(),
  }
}

export function buildAnalyticsRelaySuccessUpdate(
  at: Date = new Date()
): AnalyticsRelaySuccessUpdate {
  const iso = at.toISOString()

  return {
    status: ANALYTICS_EVENT_STATUS.SENT,
    sent_at: iso,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    updated_at: iso,
  }
}

export function buildAnalyticsRelayFailureUpdate(
  error: unknown,
  attemptCount: number,
  options: {
    maxAttempts?: number
    at?: Date
  } = {}
): AnalyticsRelayFailureUpdate {
  const maxAttempts = options.maxAttempts ?? ANALYTICS_RELAY_MAX_ATTEMPTS
  const at = options.at ?? new Date()
  const sanitized = sanitizeAnalyticsError(error)
  const nextAttemptCount = attemptCount + 1
  const iso = at.toISOString()

  if (nextAttemptCount >= maxAttempts) {
    return {
      status: ANALYTICS_EVENT_STATUS.DEAD_LETTER,
      attempt_count: nextAttemptCount,
      last_error_code: sanitized.error_code,
      last_error_message: sanitized.error_message,
      next_retry_at: null,
      failed_at: null,
      dead_lettered_at: iso,
      updated_at: iso,
    }
  }

  const nextRetryAt = new Date(
    at.getTime() + computeAnalyticsRelayBackoffMs(nextAttemptCount)
  )

  return {
    status: ANALYTICS_EVENT_STATUS.FAILED,
    attempt_count: nextAttemptCount,
    last_error_code: sanitized.error_code,
    last_error_message: sanitized.error_message,
    next_retry_at: nextRetryAt.toISOString(),
    failed_at: iso,
    dead_lettered_at: null,
    updated_at: iso,
  }
}
