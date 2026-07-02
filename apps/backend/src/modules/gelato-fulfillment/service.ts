import { createHash } from "crypto"
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
  type CreateGelatoFulfillmentData,
  type CreateGelatoFulfillmentInput,
  type EvaluateGelatoFulfillmentAutomaticEligibilityInput,
  type GelatoDispatchAddress,
  type GelatoDispatchCandidateDecision,
  type GelatoDispatchItem,
  type GelatoDispatchPayload,
  type GelatoDispatchResult,
  type GelatoFulfillmentAutomaticEligibilityDecision,
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
  type GelatoLineItemSnapshot,
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
  joinKey("re", "fund"),
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

export function evaluateAutomaticGelatoFulfillmentEligibility(
  input: EvaluateGelatoFulfillmentAutomaticEligibilityInput
): GelatoFulfillmentAutomaticEligibilityDecision {
  const orderId = input.order?.id?.trim() ?? null
  const orderStatus = input.order?.order_status?.trim() ?? null
  const paymentStatus = input.order?.payment_status?.trim() ?? null
  const emailStatus = input.email_delivery_status?.trim() ?? null

  if (
    !orderId ||
    orderStatus !== "confirmed" ||
    paymentStatus !== "captured"
  ) {
    return {
      eligible: false,
      reason: "order_not_confirmed",
    }
  }

  if (!input.has_local_purchase_completed) {
    return {
      eligible: false,
      reason: "purchase_completed_missing",
    }
  }

  if (emailStatus !== "sent") {
    return {
      eligible: false,
      reason: "email_not_sent",
    }
  }

  if (input.existing_fulfillment?.order_id === orderId) {
    return {
      eligible: false,
      reason: "fulfillment_already_exists",
    }
  }

  return {
    eligible: true,
    reason: "eligible",
  }
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

export function buildCreateGelatoFulfillmentData(
  input: CreateGelatoFulfillmentInput,
  at: Date = new Date()
): CreateGelatoFulfillmentData {
  const record = buildGelatoFulfillmentRecord(input, "gelful_local_build_only", at)
  const { id, created_at, updated_at, deleted_at, ...createData } = record

  return createData
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

export const GELATO_DISPATCH_MAX_ATTEMPTS = 5 as const
export const GELATO_DISPATCH_BACKOFF_BASE_MS = 60_000
export const GELATO_DISPATCH_BACKOFF_MAX_MS = 3_600_000
export const GELATO_DISPATCH_STALE_AFTER_MS = 15 * 60_000

type DispatchAddressSource = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
}

type DispatchLineItemSource = {
  id?: string | null
  quantity?: number | null
  metadata?: Record<string, unknown> | null
}

type DispatchOrderSource = {
  id?: string | null
  display_id?: string | number | null
  email?: string | null
  shipping_address?: DispatchAddressSource | null
  items?: DispatchLineItemSource[] | null
}

function normalizePositiveQuantity(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("GELATO_DISPATCH_ITEM_QUANTITY_INVALID")
  }

  return value
}

function normalizeHttpUrl(
  value: string | null | undefined,
  errorCode: string
): string {
  const normalized = normalizeRequiredString(value, errorCode)

  try {
    const url = new URL(normalized)

    if (url.protocol !== "https:") {
      throw new Error(errorCode)
    }

    return url.toString()
  } catch {
    throw new Error(errorCode)
  }
}

function normalizeEmail(value: string | null | undefined, errorCode: string): string {
  const normalized = normalizeRequiredString(value, errorCode).toLowerCase()

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error(errorCode)
  }

  return normalized
}

function readMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = metadata?.[key]

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function readMetadataBoolean(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): boolean | undefined {
  const value = metadata?.[key]

  return typeof value === "boolean" ? value : undefined
}

function parseLineItemSnapshot(
  value: unknown
): GelatoLineItemSnapshot & { files: Array<{ type: string; url: string }> } {
  if (!isPlainObject(value)) {
    throw new Error("GELATO_DISPATCH_SNAPSHOT_REQUIRED")
  }

  const rawFiles = value.files

  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("GELATO_DISPATCH_FILES_REQUIRED")
  }

  const files = rawFiles.map((entry) => {
    if (!isPlainObject(entry)) {
      throw new Error("GELATO_DISPATCH_FILE_INVALID")
    }

    return {
      type: normalizeRequiredString(
        typeof entry.type === "string" ? entry.type : null,
        "GELATO_DISPATCH_FILE_TYPE_REQUIRED"
      ),
      url: normalizeHttpUrl(
        typeof entry.url === "string" ? entry.url : null,
        "GELATO_DISPATCH_FILE_URL_REQUIRED"
      ),
    }
  })

  return {
    gelato_product_uid: normalizeRequiredString(
      typeof value.gelato_product_uid === "string"
        ? value.gelato_product_uid
        : null,
      "GELATO_DISPATCH_PRODUCT_UID_REQUIRED"
    ),
    gelato_template_id: normalizeRequiredString(
      typeof value.gelato_template_id === "string"
        ? value.gelato_template_id
        : null,
      "GELATO_DISPATCH_TEMPLATE_ID_REQUIRED"
    ),
    gelato_variant_options: {
      size: normalizeRequiredString(
        isPlainObject(value.gelato_variant_options) &&
          typeof value.gelato_variant_options.size === "string"
          ? value.gelato_variant_options.size
          : null,
        "GELATO_DISPATCH_VARIANT_SIZE_REQUIRED"
      ),
      color: normalizeRequiredString(
        isPlainObject(value.gelato_variant_options) &&
          typeof value.gelato_variant_options.color === "string"
          ? value.gelato_variant_options.color
          : null,
        "GELATO_DISPATCH_VARIANT_COLOR_REQUIRED"
      ),
    },
    template_mode: normalizeRequiredString(
      typeof value.template_mode === "string" ? value.template_mode : null,
      "GELATO_DISPATCH_TEMPLATE_MODE_REQUIRED"
    ),
    source_product_variant_id: normalizeRequiredString(
      typeof value.source_product_variant_id === "string"
        ? value.source_product_variant_id
        : null,
      "GELATO_DISPATCH_SOURCE_VARIANT_ID_REQUIRED"
    ),
    source_product_variant_sku: normalizeRequiredString(
      typeof value.source_product_variant_sku === "string"
        ? value.source_product_variant_sku
        : null,
      "GELATO_DISPATCH_SOURCE_VARIANT_SKU_REQUIRED"
    ),
    captured_at: normalizeRequiredString(
      typeof value.captured_at === "string" ? value.captured_at : null,
      "GELATO_DISPATCH_CAPTURED_AT_REQUIRED"
    ),
    files,
  }
}

function buildDispatchCustomerReference(order: DispatchOrderSource): string {
  const orderId = normalizeRequiredString(order.id, "GELATO_DISPATCH_ORDER_ID_REQUIRED")
  const displayId =
    typeof order.display_id === "number" || typeof order.display_id === "string"
      ? String(order.display_id).trim()
      : null

  return displayId ? `order:${displayId}`.slice(0, 100) : `order:${orderId}`.slice(0, 100)
}

export function buildGelatoDispatchAddress(input: {
  shipping_address: DispatchAddressSource | null | undefined
  email: string | null | undefined
}): GelatoDispatchAddress {
  const shipping = input.shipping_address

  if (!shipping) {
    throw new Error("GELATO_DISPATCH_SHIPPING_ADDRESS_REQUIRED")
  }

  const federalTaxId = readMetadataString(shipping.metadata ?? null, "federal_tax_id")

  if (!federalTaxId) {
    throw new Error("GELATO_DISPATCH_FEDERAL_TAX_ID_REQUIRED")
  }

  return {
    firstName: normalizeRequiredString(
      shipping.first_name,
      "GELATO_DISPATCH_FIRST_NAME_REQUIRED"
    ),
    lastName: normalizeRequiredString(
      shipping.last_name,
      "GELATO_DISPATCH_LAST_NAME_REQUIRED"
    ),
    company: normalizeOptionalString(shipping.company, 120),
    addressLine1: normalizeRequiredString(
      shipping.address_1,
      "GELATO_DISPATCH_ADDRESS_LINE_1_REQUIRED"
    ),
    addressLine2: normalizeOptionalString(shipping.address_2, 120),
    city: normalizeRequiredString(shipping.city, "GELATO_DISPATCH_CITY_REQUIRED"),
    state: normalizeOptionalString(shipping.province, 80),
    zipCode: normalizeRequiredString(
      shipping.postal_code,
      "GELATO_DISPATCH_POSTAL_CODE_REQUIRED"
    ),
    country: normalizeRequiredString(
      shipping.country_code,
      "GELATO_DISPATCH_COUNTRY_REQUIRED",
      (value) => value.toUpperCase()
    ),
    email: normalizeEmail(input.email, "GELATO_DISPATCH_EMAIL_REQUIRED"),
    phone: normalizeOptionalString(shipping.phone, 40),
    federalTaxId,
    isBusiness: readMetadataBoolean(shipping.metadata ?? null, "is_business"),
    stateTaxId: readMetadataString(shipping.metadata ?? null, "state_tax_id"),
    registrationStateCode: readMetadataString(
      shipping.metadata ?? null,
      "registration_state_code"
    ),
  }
}

export function buildGelatoDispatchItems(
  items: DispatchLineItemSource[] | null | undefined
): GelatoDispatchItem[] {
  if (!items?.length) {
    throw new Error("GELATO_DISPATCH_ITEMS_REQUIRED")
  }

  return items.map((item) => {
    const snapshot = parseLineItemSnapshot(item.metadata?.gelato_snapshot)

    return {
      itemReferenceId: normalizeRequiredString(
        item.id,
        "GELATO_DISPATCH_ITEM_REFERENCE_REQUIRED"
      ),
      productUid: snapshot.gelato_product_uid,
      quantity: normalizePositiveQuantity(item.quantity),
      files: snapshot.files,
    }
  })
}

export function buildGelatoDispatchPayload(input: {
  order: DispatchOrderSource
  fulfillment: Pick<GelatoFulfillmentRecord, "id" | "order_id">
  shipment_method_uid?: string | null
}): GelatoDispatchPayload {
  const orderId = normalizeRequiredString(
    input.order.id,
    "GELATO_DISPATCH_ORDER_ID_REQUIRED"
  )
  const items = buildGelatoDispatchItems(input.order.items)

  return {
    orderType: "order",
    orderReferenceId: orderId,
    customerReferenceId: buildDispatchCustomerReference(input.order),
    currency: "BRL",
    items,
    shippingAddress: buildGelatoDispatchAddress({
      shipping_address: input.order.shipping_address,
      email: input.order.email,
    }),
    metadata: {
      order_id: orderId.slice(0, 100),
      fulfillment_id: input.fulfillment.id.slice(0, 100),
    },
    ...(input.shipment_method_uid?.trim()
      ? { shipmentMethodUid: input.shipment_method_uid.trim() }
      : {}),
  }
}

export function buildGelatoDispatchRequestHash(
  payload: GelatoDispatchPayload
): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`
}

export function computeGelatoDispatchBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1)
  const backoff = GELATO_DISPATCH_BACKOFF_BASE_MS * 2 ** exponent

  return Math.min(backoff, GELATO_DISPATCH_BACKOFF_MAX_MS)
}

export function isGelatoDispatchDue(
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

function isStaleTimestamp(
  value: string | null | undefined,
  now: Date,
  staleAfterMs: number
): boolean {
  if (!value) {
    return true
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return true
  }

  return now.getTime() - parsed.getTime() >= staleAfterMs
}

export function resolveGelatoDispatchCandidateDecision(
  fulfillment: Pick<
    GelatoFulfillmentRecord,
    | "status"
    | "next_retry_at"
    | "queued_at"
    | "dispatching_started_at"
    | "submitted_at"
    | "accepted_at"
    | "gelato_primary_order_id"
  >,
  now: Date,
  staleAfterMs = GELATO_DISPATCH_STALE_AFTER_MS
): GelatoDispatchCandidateDecision {
  if (
    fulfillment.status === GELATO_FULFILLMENT_STATUS.ACCEPTED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.IN_PRODUCTION ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.SHIPPED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.DELIVERED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.CANCELED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.DEAD_LETTER
  ) {
    return {
      action: "skip",
      reason:
        fulfillment.status === GELATO_FULFILLMENT_STATUS.ACCEPTED
          ? "already_accepted"
          : "terminal_status",
    }
  }

  if (
    fulfillment.status === GELATO_FULFILLMENT_STATUS.SUBMITTED &&
    fulfillment.gelato_primary_order_id
  ) {
    if (isStaleTimestamp(fulfillment.submitted_at, now, staleAfterMs)) {
      return {
        action: "operator_attention",
        reason: "stale_external_uncertain",
      }
    }

    return {
      action: "skip",
      reason: "already_submitted",
    }
  }

  if (
    fulfillment.status === GELATO_FULFILLMENT_STATUS.DISPATCHING ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.SUBMITTED
  ) {
    const timestamp =
      fulfillment.status === GELATO_FULFILLMENT_STATUS.DISPATCHING
        ? fulfillment.dispatching_started_at
        : fulfillment.submitted_at

    if (!isStaleTimestamp(timestamp, now, staleAfterMs)) {
      return {
        action: "skip",
        reason:
          fulfillment.status === GELATO_FULFILLMENT_STATUS.DISPATCHING
            ? "dispatching_recent"
            : "submitted_recent",
      }
    }

    return {
      action: "operator_attention",
      reason: "stale_external_uncertain",
    }
  }

  if (fulfillment.status === GELATO_FULFILLMENT_STATUS.QUEUED) {
    if (!isStaleTimestamp(fulfillment.queued_at, now, staleAfterMs)) {
      return {
        action: "skip",
        reason: "queued_recent",
      }
    }

    return {
      action: "recover_and_dispatch",
      reason: "queued_stale_recovered",
    }
  }

  if (
    fulfillment.status === GELATO_FULFILLMENT_STATUS.RECORDED ||
    fulfillment.status === GELATO_FULFILLMENT_STATUS.ELIGIBLE
  ) {
    return {
      action: "dispatch",
      reason: "ready",
    }
  }

  if (fulfillment.status === GELATO_FULFILLMENT_STATUS.FAILED) {
    return isGelatoDispatchDue(fulfillment.next_retry_at, now)
      ? {
          action: "dispatch",
          reason: "ready",
        }
      : {
          action: "skip",
          reason: "not_due",
        }
  }

  return {
    action: "skip",
    reason: "terminal_status",
  }
}

export function buildGelatoDispatchClaimUpdate(
  at: Date = new Date()
): Pick<
  GelatoFulfillmentRecord,
  "status" | "queued_at" | "updated_at"
> {
  const iso = at.toISOString()

  return {
    status: GELATO_FULFILLMENT_STATUS.QUEUED,
    queued_at: iso,
    updated_at: iso,
  }
}

export function buildGelatoDispatchingUpdate(
  at: Date = new Date()
): Pick<
  GelatoFulfillmentRecord,
  "status" | "dispatching_started_at" | "updated_at"
> {
  const iso = at.toISOString()

  return {
    status: GELATO_FULFILLMENT_STATUS.DISPATCHING,
    dispatching_started_at: iso,
    updated_at: iso,
  }
}

export function buildGelatoDispatchSuccessUpdate(
  input: GelatoDispatchResult,
  at: Date = new Date()
): Pick<
  GelatoFulfillmentRecord,
  | "status"
  | "gelato_primary_order_id"
  | "connected_order_ids"
  | "response_summary"
  | "submitted_at"
  | "accepted_at"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "requires_operator_attention"
  | "operator_alert_code"
  | "operator_alert_message"
  | "operator_alerted_at"
  | "updated_at"
> {
  const iso = at.toISOString()
  const status =
    input.status === GELATO_FULFILLMENT_STATUS.ACCEPTED
      ? GELATO_FULFILLMENT_STATUS.ACCEPTED
      : GELATO_FULFILLMENT_STATUS.SUBMITTED

  return {
    status,
    gelato_primary_order_id: normalizeRequiredString(
      input.gelato_primary_order_id,
      "GELATO_DISPATCH_PRIMARY_ORDER_ID_REQUIRED"
    ),
    connected_order_ids: normalizeConnectedOrderIds(
      "__local__",
      input.connected_order_ids
    ),
    response_summary: buildGelatoFulfillmentResponseSummary({
      provider: GELATO_FULFILLMENT_PROVIDER.GELATO,
      status,
      connected_order_ids: input.connected_order_ids,
      gelato_primary_order_id: input.gelato_primary_order_id,
      provider_status: input.provider_status,
      provider_reference_id: input.provider_reference_id,
    }),
    submitted_at: iso,
    accepted_at:
      status === GELATO_FULFILLMENT_STATUS.ACCEPTED ? iso : null,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    requires_operator_attention: false,
    operator_alert_code: null,
    operator_alert_message: null,
    operator_alerted_at: null,
    updated_at: iso,
  }
}

function classifyDispatchError(error: unknown): {
  transient: boolean
  permanent: boolean
  statusCode: number | null
} {
  const statusCode =
    error &&
    typeof error === "object" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : null

  if (statusCode === 429) {
    return { transient: true, permanent: false, statusCode }
  }

  if (statusCode && statusCode >= 500) {
    return { transient: true, permanent: false, statusCode }
  }

  if (statusCode && [400, 401, 404].includes(statusCode)) {
    return { transient: false, permanent: true, statusCode }
  }

  if (error instanceof Error) {
    if (
      error.message.includes("GELATO_DISPATCH_") ||
      error.message.includes("GELATO_FULFILLMENT_")
    ) {
      return { transient: false, permanent: true, statusCode }
    }
  }

  return { transient: false, permanent: false, statusCode }
}

export function buildGelatoDispatchFailureUpdate(
  error: unknown,
  attemptCount: number,
  options: {
    maxAttempts?: number
    at?: Date
    operatorAlertCode?: string
    operatorAlertMessage?: string
  } = {}
): Pick<
  GelatoFulfillmentRecord,
  | "status"
  | "attempt_count"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "failed_at"
  | "dead_lettered_at"
  | "requires_operator_attention"
  | "operator_alert_code"
  | "operator_alert_message"
  | "operator_alerted_at"
  | "updated_at"
> {
  const maxAttempts = options.maxAttempts ?? GELATO_DISPATCH_MAX_ATTEMPTS
  const at = options.at ?? new Date()
  const nextAttemptCount = attemptCount + 1
  const iso = at.toISOString()
  const sanitized = sanitizeGelatoFulfillmentError(error)
  const classification = classifyDispatchError(error)

  if (classification.permanent || nextAttemptCount >= maxAttempts) {
    return {
      status: GELATO_FULFILLMENT_STATUS.DEAD_LETTER,
      attempt_count: nextAttemptCount,
      last_error_code: sanitized.error_code,
      last_error_message: sanitized.error_message,
      next_retry_at: null,
      failed_at: null,
      dead_lettered_at: iso,
      requires_operator_attention: true,
      operator_alert_code:
        normalizeRequiredString(
          options.operatorAlertCode ??
            (classification.statusCode
              ? `gelato_dispatch_http_${classification.statusCode}`
              : "gelato_dispatch_dead_letter"),
          "GELATO_FULFILLMENT_OPERATOR_ALERT_CODE_REQUIRED"
        ).slice(0, 120),
      operator_alert_message:
        normalizeRequiredString(
          options.operatorAlertMessage ??
            "Dispatch Gelato falhou de forma persistente e requer revisao operacional.",
          "GELATO_FULFILLMENT_OPERATOR_ALERT_MESSAGE_REQUIRED"
        ).slice(0, 500),
      operator_alerted_at: iso,
      updated_at: iso,
    }
  }

  return {
    status: GELATO_FULFILLMENT_STATUS.FAILED,
    attempt_count: nextAttemptCount,
    last_error_code: sanitized.error_code,
    last_error_message: sanitized.error_message,
    next_retry_at: new Date(
      at.getTime() + computeGelatoDispatchBackoffMs(nextAttemptCount)
    ).toISOString(),
    failed_at: iso,
    dead_lettered_at: null,
    requires_operator_attention: false,
    operator_alert_code: null,
    operator_alert_message: null,
    operator_alerted_at: null,
    updated_at: iso,
  }
}

export function buildGelatoStaleOperatorAttentionUpdate(
  at: Date = new Date()
): Pick<
  GelatoFulfillmentRecord,
  | "status"
  | "requires_operator_attention"
  | "operator_alert_code"
  | "operator_alert_message"
  | "operator_alerted_at"
  | "dead_lettered_at"
  | "updated_at"
> {
  const iso = at.toISOString()

  return {
    status: GELATO_FULFILLMENT_STATUS.DEAD_LETTER,
    requires_operator_attention: true,
    operator_alert_code: "gelato_dispatch_reconciliation_required",
    operator_alert_message:
      "Dispatch Gelato ficou em estado incerto e exige reconciliacao manual antes de qualquer novo envio.",
    operator_alerted_at: iso,
    dead_lettered_at: iso,
    updated_at: iso,
  }
}

export type GelatoOrderStatusUpdatedWebhookPayload = {
  id: string
  event: "order_status_updated"
  orderId: string
  orderReferenceId: string
  fulfillmentStatus: string
  connectedOrderIds?: string[] | null
  items?: Array<{
    itemReferenceId?: string | null
    fulfillmentStatus?: string | null
    fulfillments?: unknown[] | null
  }> | null
}

export class GelatoWebhookError extends Error {
  readonly webhookDisposition: "failed" | "ignored"

  constructor(
    public readonly code: string,
    message: string,
    webhookDisposition: "failed" | "ignored" = "failed"
  ) {
    super(message)
    this.name = "GelatoWebhookError"
    this.webhookDisposition = webhookDisposition
  }
}

const GELATO_WEBHOOK_SUPPORTED_EVENT = "order_status_updated"

const GELATO_PROVIDER_STATUS_TO_LOCAL: Record<string, GelatoFulfillmentStatus> =
  {
    in_production: GELATO_FULFILLMENT_STATUS.IN_PRODUCTION,
    partially_shipped: GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED,
    shipped: GELATO_FULFILLMENT_STATUS.SHIPPED,
    delivered: GELATO_FULFILLMENT_STATUS.DELIVERED,
    failed: GELATO_FULFILLMENT_STATUS.FAILED,
    canceled: GELATO_FULFILLMENT_STATUS.CANCELED,
    cancelled: GELATO_FULFILLMENT_STATUS.CANCELED,
  }

function normalizeGelatoProviderStatus(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

export function isGelatoWebhookSupportedEventType(
  eventType: string | null | undefined
): eventType is typeof GELATO_WEBHOOK_SUPPORTED_EVENT {
  return eventType === GELATO_WEBHOOK_SUPPORTED_EVENT
}

export function parseGelatoOrderStatusUpdatedWebhookPayload(
  payload: unknown
): GelatoOrderStatusUpdatedWebhookPayload {
  if (!isPlainObject(payload)) {
    throw new GelatoWebhookError(
      "GELATO_WEBHOOK_PAYLOAD_INVALID",
      "Payload Gelato invalido."
    )
  }

  const event =
    typeof payload.event === "string" ? payload.event.trim() : ""

  if (event !== GELATO_WEBHOOK_SUPPORTED_EVENT) {
    throw new GelatoWebhookError(
      "GELATO_WEBHOOK_EVENT_UNSUPPORTED",
      "Evento Gelato fora do MVP.",
      "ignored"
    )
  }

  const id = normalizeRequiredString(
    typeof payload.id === "string" ? payload.id : null,
    "GELATO_WEBHOOK_EVENT_ID_REQUIRED"
  )
  const orderId = normalizeRequiredString(
    typeof payload.orderId === "string" ? payload.orderId : null,
    "GELATO_WEBHOOK_ORDER_ID_REQUIRED"
  )
  const orderReferenceId = normalizeRequiredString(
    typeof payload.orderReferenceId === "string"
      ? payload.orderReferenceId
      : null,
    "GELATO_WEBHOOK_ORDER_REFERENCE_ID_REQUIRED"
  )
  const fulfillmentStatus = normalizeRequiredString(
    typeof payload.fulfillmentStatus === "string"
      ? payload.fulfillmentStatus
      : null,
    "GELATO_WEBHOOK_FULFILLMENT_STATUS_REQUIRED"
  )

  let connectedOrderIds: string[] | null = null

  if (payload.connectedOrderIds !== undefined && payload.connectedOrderIds !== null) {
    if (!Array.isArray(payload.connectedOrderIds)) {
      throw new GelatoWebhookError(
        "GELATO_WEBHOOK_CONNECTED_ORDER_IDS_INVALID",
        "connectedOrderIds Gelato invalido."
      )
    }

    connectedOrderIds = normalizeConnectedOrderIds(
      orderReferenceId,
      payload.connectedOrderIds.filter(
        (entry): entry is string => typeof entry === "string"
      )
    )
  }

  return {
    id,
    event: GELATO_WEBHOOK_SUPPORTED_EVENT,
    orderId,
    orderReferenceId,
    fulfillmentStatus,
    connectedOrderIds,
    items: null,
  }
}

export function mapGelatoFulfillmentStatusFromWebhook(
  fulfillmentStatus: string
): GelatoFulfillmentStatus | null {
  const normalized = normalizeGelatoProviderStatus(fulfillmentStatus)
  return GELATO_PROVIDER_STATUS_TO_LOCAL[normalized] ?? null
}

export function shouldApplyGelatoWebhookStatusUpdate(
  currentStatus: GelatoFulfillmentStatus,
  mappedStatus: GelatoFulfillmentStatus
): boolean {
  if (currentStatus === mappedStatus) {
    return true
  }

  if (isGelatoFulfillmentTerminalStatus(currentStatus)) {
    return false
  }

  return true
}

export function resolveGelatoFulfillmentForWebhook(
  fulfillments: GelatoFulfillmentRecord[],
  payload: Pick<
    GelatoOrderStatusUpdatedWebhookPayload,
    "orderReferenceId" | "orderId" | "connectedOrderIds"
  >
): GelatoFulfillmentRecord | null {
  const orderReferenceId = payload.orderReferenceId.trim()
  const gelatoOrderId = payload.orderId.trim()

  const candidate = fulfillments.find(
    (fulfillment) =>
      fulfillment.order_id === orderReferenceId ||
      fulfillment.order_reference_id === orderReferenceId
  )

  if (!candidate) {
    return null
  }

  const primaryOrderId = candidate.gelato_primary_order_id?.trim() ?? null

  if (!primaryOrderId) {
    return candidate
  }

  const connectedOrderIds = new Set(candidate.connected_order_ids)
  payload.connectedOrderIds?.forEach((connectedOrderId) => {
    connectedOrderIds.add(connectedOrderId)
  })

  if (
    primaryOrderId === gelatoOrderId ||
    connectedOrderIds.has(gelatoOrderId)
  ) {
    return candidate
  }

  return null
}

export function buildGelatoWebhookTrackingSummary(input: {
  fulfillment: GelatoFulfillmentRecord
  providerStatus: string
  connectedOrderIds?: string[] | null
}): GelatoFulfillmentTrackingSummary {
  const mappedStatus =
    mapGelatoFulfillmentStatusFromWebhook(input.providerStatus) ??
    input.fulfillment.status

  return buildGelatoFulfillmentTrackingSummary({
    status: mappedStatus,
    tracking_status: normalizeOptionalString(input.providerStatus, 120),
    connected_order_ids:
      input.connectedOrderIds ?? input.fulfillment.connected_order_ids,
  })
}

export function buildGelatoWebhookFulfillmentUpdate(input: {
  fulfillment: GelatoFulfillmentRecord
  payload: GelatoOrderStatusUpdatedWebhookPayload
  at?: Date
}): Pick<
  GelatoFulfillmentRecord,
  | "status"
  | "connected_order_ids"
  | "response_summary"
  | "tracking_summary"
  | "updated_at"
> {
  const at = input.at ?? new Date()
  const iso = at.toISOString()
  const providerStatus = normalizeGelatoProviderStatus(input.payload.fulfillmentStatus)
  const mappedStatus = mapGelatoFulfillmentStatusFromWebhook(providerStatus)
  const mergedConnectedOrderIds = normalizeConnectedOrderIds(
    input.fulfillment.order_id,
    [
      ...input.fulfillment.connected_order_ids,
      ...(input.payload.connectedOrderIds ?? []),
      input.payload.orderId,
    ]
  )

  const nextStatus =
    mappedStatus &&
    shouldApplyGelatoWebhookStatusUpdate(input.fulfillment.status, mappedStatus)
      ? mappedStatus
      : input.fulfillment.status

  const responseSummary = buildGelatoFulfillmentResponseSummary({
    provider: GELATO_FULFILLMENT_PROVIDER.GELATO,
    status: nextStatus,
    connected_order_ids: mergedConnectedOrderIds,
    gelato_primary_order_id:
      input.fulfillment.gelato_primary_order_id ?? input.payload.orderId,
    provider_status: providerStatus,
    provider_reference_id: input.payload.orderId,
  })

  const trackingSummary = buildGelatoWebhookTrackingSummary({
    fulfillment: input.fulfillment,
    providerStatus: input.payload.fulfillmentStatus,
    connectedOrderIds: mergedConnectedOrderIds,
  })

  return {
    status: nextStatus,
    connected_order_ids: mergedConnectedOrderIds,
    response_summary: responseSummary,
    tracking_summary: trackingSummary,
    updated_at: iso,
  }
}

export function applyGelatoOrderStatusUpdatedWebhookToFulfillment(input: {
  fulfillment: GelatoFulfillmentRecord
  payload: GelatoOrderStatusUpdatedWebhookPayload
  at?: Date
}): GelatoFulfillmentRecord {
  const update = buildGelatoWebhookFulfillmentUpdate(input)

  return {
    ...input.fulfillment,
    ...update,
  }
}
