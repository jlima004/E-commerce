import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import ExchangeRequest from "./models/exchange-request"
import {
  EXCHANGE_REQUEST_REASONS,
  EXCHANGE_REQUEST_STATUS,
  EXCHANGE_REQUEST_STATUSES,
  EXCHANGE_REQUEST_TERMINAL_STATUSES,
  REVERSE_LOGISTICS_PROVIDERS,
  type AdminCreateExchangeRequestResult,
  type AdminUpdateExchangeRequestResult,
  type AffectedItemSummary,
  type CreateExchangeRequestInput,
  type ExchangeRequestReason,
  type ExchangeRequestRecord,
  type ExchangeRequestStatus,
  type ReverseLogisticsProvider,
  type UpdateExchangeRequestInput,
} from "./types"

const ALLOWED_AFFECTED_ITEM_KEYS = new Set([
  "line_item_id",
  "product_title",
  "variant_title",
  "quantity",
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
  joinKey("payment", "_", "status"),
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
  joinKey("gelato", "_", "payload"),
  joinKey("stripe", "_", "payload"),
  joinKey("correios", "_", "payload"),
  joinKey("payment", "_", "data"),
  joinKey("re", "fund"),
  joinKey("c", "pf"),
  joinKey("cn", "pj"),
  "metadata",
  "payload",
  joinKey("raw", "_", "payload"),
  "email",
  "address",
])

const CREATE_BODY_ALLOWED_KEYS = new Set([
  "order_id",
  "reason",
  "affected_items",
  "customer_visible_note",
  "operator_note",
  "reverse_logistics_provider",
  "reverse_tracking_code",
  "reverse_authorization_code",
  "reverse_label_reference",
])

const UPDATE_BODY_ALLOWED_KEYS = new Set([
  "status",
  "customer_visible_note",
  "operator_note",
  "reverse_logistics_provider",
  "reverse_tracking_code",
  "reverse_authorization_code",
  "reverse_label_reference",
])

const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i,
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/i,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "i"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "i"
  ),
  /\b00020126[0-9A-Z]+\b/i,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
  /https:\/\/api\.correios\.com\.br/i,
  /https:\/\/order\.gelatoapis\.com/i,
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

const EXCHANGE_STATUS_TRANSITIONS: Record<
  ExchangeRequestStatus,
  readonly ExchangeRequestStatus[]
> = {
  [EXCHANGE_REQUEST_STATUS.OPENED]: [
    EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
    EXCHANGE_REQUEST_STATUS.REJECTED,
    EXCHANGE_REQUEST_STATUS.CANCELED,
  ],
  [EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN]: [
    EXCHANGE_REQUEST_STATUS.RETURN_IN_TRANSIT,
    EXCHANGE_REQUEST_STATUS.REJECTED,
    EXCHANGE_REQUEST_STATUS.CANCELED,
  ],
  [EXCHANGE_REQUEST_STATUS.RETURN_IN_TRANSIT]: [
    EXCHANGE_REQUEST_STATUS.RETURN_RECEIVED,
    EXCHANGE_REQUEST_STATUS.REJECTED,
    EXCHANGE_REQUEST_STATUS.CANCELED,
  ],
  [EXCHANGE_REQUEST_STATUS.RETURN_RECEIVED]: [
    EXCHANGE_REQUEST_STATUS.REPLACEMENT_REVIEW,
    EXCHANGE_REQUEST_STATUS.RESOLVED,
    EXCHANGE_REQUEST_STATUS.REJECTED,
    EXCHANGE_REQUEST_STATUS.CANCELED,
  ],
  [EXCHANGE_REQUEST_STATUS.REPLACEMENT_REVIEW]: [
    EXCHANGE_REQUEST_STATUS.RESOLVED,
    EXCHANGE_REQUEST_STATUS.REJECTED,
    EXCHANGE_REQUEST_STATUS.CANCELED,
  ],
  [EXCHANGE_REQUEST_STATUS.RESOLVED]: [],
  [EXCHANGE_REQUEST_STATUS.REJECTED]: [],
  [EXCHANGE_REQUEST_STATUS.CANCELED]: [],
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeBodyKey(key: string): string {
  return key.trim().toLowerCase()
}

function assertExchangeRequestBodyAllowed(
  body: unknown,
  allowedKeys: Set<string>
): asserts body is Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new Error("EXCHANGE_REQUEST_BODY_INVALID")
  }

  for (const key of Object.keys(body)) {
    const normalizedKey = normalizeBodyKey(key)

    if (FORBIDDEN_OBJECT_KEYS.has(normalizedKey)) {
      throw new Error("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
    }

    if (!allowedKeys.has(normalizedKey)) {
      throw new Error("EXCHANGE_REQUEST_BODY_INVALID")
    }
  }
}

export function assertExchangeRequestCreateBodyAllowed(body: unknown): void {
  assertExchangeRequestBodyAllowed(body, CREATE_BODY_ALLOWED_KEYS)
}

export function assertExchangeRequestUpdateBodyAllowed(body: unknown): void {
  assertExchangeRequestBodyAllowed(body, UPDATE_BODY_ALLOWED_KEYS)
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
  errorCode: string
): string {
  const normalized = value?.trim() ?? ""

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

function normalizeOptionalReverseCode(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = sanitizeString(value).replace(/\s+/g, "").slice(0, maxLength)
  return normalized.length > 0 ? normalized : null
}

export function assertValidExchangeRequestStatus(status: string): void {
  if (!(EXCHANGE_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new Error("EXCHANGE_REQUEST_STATUS_INVALID")
  }
}

export function assertValidExchangeRequestReason(reason: string): void {
  if (!(EXCHANGE_REQUEST_REASONS as readonly string[]).includes(reason)) {
    throw new Error("EXCHANGE_REQUEST_REASON_INVALID")
  }
}

export function assertValidReverseLogisticsProvider(
  provider: string | null | undefined
): void {
  if (provider === null || provider === undefined) {
    return
  }

  if (!(REVERSE_LOGISTICS_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error("EXCHANGE_REQUEST_REVERSE_LOGISTICS_PROVIDER_INVALID")
  }
}

export function assertOrderEligibleForExchange(input: {
  order_id: string
  order_metadata: Record<string, unknown> | null | undefined
}): void {
  normalizeRequiredString(input.order_id, "EXCHANGE_REQUEST_ORDER_ID_REQUIRED")

  const metadata = input.order_metadata ?? {}
  const orderStatus =
    typeof metadata.order_status === "string"
      ? metadata.order_status.trim()
      : null

  if (orderStatus !== "confirmed") {
    throw new Error("EXCHANGE_REQUEST_ORDER_STATUS_NOT_ELIGIBLE")
  }
}

export function assertValidExchangeStatusTransition(input: {
  from: ExchangeRequestStatus
  to: ExchangeRequestStatus
}): void {
  if (input.from === input.to) {
    return
  }

  const allowed = EXCHANGE_STATUS_TRANSITIONS[input.from] ?? []

  if (!(allowed as readonly string[]).includes(input.to)) {
    throw new Error("EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID")
  }
}

export function assertNoSensitiveExchangeData(value: unknown): void {
  if (containsForbiddenData(value)) {
    throw new Error("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  }
}

export function sanitizeAffectedItems(
  items: AffectedItemSummary[] | null | undefined
): AffectedItemSummary[] {
  if (!items || !Array.isArray(items)) {
    throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_REQUIRED")
  }

  if (items.length === 0) {
    throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_EMPTY")
  }

  if (items.length > 20) {
    throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_TOO_MANY")
  }

  const sanitized: AffectedItemSummary[] = []

  for (const item of items) {
    if (!isPlainObject(item)) {
      throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_INVALID")
    }

    assertNoSensitiveExchangeData(item)

    const keys = Object.keys(item)
    if (keys.some((key) => !ALLOWED_AFFECTED_ITEM_KEYS.has(key))) {
      throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_INVALID")
    }

    const summary: AffectedItemSummary = {}

    if (typeof item.line_item_id === "string") {
      summary.line_item_id = normalizeOptionalString(item.line_item_id, 120)
    }

    if (typeof item.product_title === "string") {
      summary.product_title = normalizeOptionalString(item.product_title, 240)
    }

    if (typeof item.variant_title === "string") {
      summary.variant_title = normalizeOptionalString(item.variant_title, 240)
    }

    if (item.quantity !== undefined && item.quantity !== null) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_INVALID")
      }

      summary.quantity = item.quantity
    }

    if (
      !summary.line_item_id &&
      !summary.product_title &&
      !summary.variant_title &&
      summary.quantity === undefined
    ) {
      throw new Error("EXCHANGE_REQUEST_AFFECTED_ITEMS_INVALID")
    }

    sanitized.push(summary)
  }

  return sanitized
}

export function sanitizeExchangeRequestError(input: {
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

export function buildExchangeRequestRecord(
  input: {
    id: string
    order_id: string
    reason: ExchangeRequestReason
    affected_items: AffectedItemSummary[]
    customer_visible_note?: string | null
    operator_note?: string | null
    reverse_logistics_provider?: ReverseLogisticsProvider | null
    reverse_tracking_code?: string | null
    reverse_authorization_code?: string | null
    reverse_label_reference?: string | null
    created_by_operator_id?: string | null
  },
  at: Date = new Date()
): ExchangeRequestRecord {
  assertValidExchangeRequestReason(input.reason)
  assertValidReverseLogisticsProvider(input.reverse_logistics_provider)

  const affectedItems = sanitizeAffectedItems(input.affected_items)
  const customerNote = normalizeOptionalString(input.customer_visible_note, 1000)
  const operatorNote = normalizeOptionalString(input.operator_note, 2000)

  assertNoSensitiveExchangeData({
    customer_visible_note: customerNote,
    operator_note: operatorNote,
    affected_items: affectedItems,
  })

  return {
    id: input.id,
    order_id: normalizeRequiredString(
      input.order_id,
      "EXCHANGE_REQUEST_ORDER_ID_REQUIRED"
    ),
    reason: input.reason,
    status: EXCHANGE_REQUEST_STATUS.OPENED,
    affected_items: affectedItems,
    customer_visible_note: customerNote,
    operator_note: operatorNote,
    reverse_logistics_provider: input.reverse_logistics_provider ?? null,
    reverse_tracking_code: normalizeOptionalReverseCode(
      input.reverse_tracking_code,
      64
    ),
    reverse_authorization_code: normalizeOptionalReverseCode(
      input.reverse_authorization_code,
      64
    ),
    reverse_label_reference: normalizeOptionalString(
      input.reverse_label_reference,
      120
    ),
    return_received_at: null,
    resolved_at: null,
    created_by_operator_id: normalizeOptionalString(
      input.created_by_operator_id,
      120
    ),
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
  }
}

export function normalizeCreateExchangeRequestInput(
  input: CreateExchangeRequestInput
): CreateExchangeRequestInput {
  assertValidExchangeRequestReason(input.reason)
  assertValidReverseLogisticsProvider(input.reverse_logistics_provider)

  const affectedItems = sanitizeAffectedItems(input.affected_items)
  const customerNote = normalizeOptionalString(input.customer_visible_note, 1000)
  const operatorNote = normalizeOptionalString(input.operator_note, 2000)

  assertNoSensitiveExchangeData({
    customer_visible_note: customerNote,
    operator_note: operatorNote,
    affected_items: affectedItems,
  })

  return {
    order_id: normalizeRequiredString(
      input.order_id,
      "EXCHANGE_REQUEST_ORDER_ID_REQUIRED"
    ),
    reason: input.reason,
    affected_items: affectedItems,
    customer_visible_note: customerNote,
    operator_note: operatorNote,
    reverse_logistics_provider: input.reverse_logistics_provider ?? null,
    reverse_tracking_code: normalizeOptionalReverseCode(
      input.reverse_tracking_code,
      64
    ),
    reverse_authorization_code: normalizeOptionalReverseCode(
      input.reverse_authorization_code,
      64
    ),
    reverse_label_reference: normalizeOptionalString(
      input.reverse_label_reference,
      120
    ),
    created_by_operator_id: normalizeOptionalString(
      input.created_by_operator_id,
      120
    ),
  }
}

export function normalizeUpdateExchangeRequestInput(
  input: UpdateExchangeRequestInput
): UpdateExchangeRequestInput {
  if (input.status !== undefined) {
    assertValidExchangeRequestStatus(input.status)
  }

  if (input.reverse_logistics_provider !== undefined) {
    assertValidReverseLogisticsProvider(input.reverse_logistics_provider)
  }

  const normalized: UpdateExchangeRequestInput = {}

  if (input.status !== undefined) {
    normalized.status = input.status
  }

  if (input.customer_visible_note !== undefined) {
    normalized.customer_visible_note = normalizeOptionalString(
      input.customer_visible_note,
      1000
    )
  }

  if (input.operator_note !== undefined) {
    normalized.operator_note = normalizeOptionalString(input.operator_note, 2000)
  }

  if (input.reverse_logistics_provider !== undefined) {
    normalized.reverse_logistics_provider = input.reverse_logistics_provider
  }

  if (input.reverse_tracking_code !== undefined) {
    normalized.reverse_tracking_code = normalizeOptionalReverseCode(
      input.reverse_tracking_code,
      64
    )
  }

  if (input.reverse_authorization_code !== undefined) {
    normalized.reverse_authorization_code = normalizeOptionalReverseCode(
      input.reverse_authorization_code,
      64
    )
  }

  if (input.reverse_label_reference !== undefined) {
    normalized.reverse_label_reference = normalizeOptionalString(
      input.reverse_label_reference,
      120
    )
  }

  assertNoSensitiveExchangeData(normalized)

  return normalized
}

export function applyExchangeRequestUpdate(
  existing: ExchangeRequestRecord,
  input: UpdateExchangeRequestInput,
  at: Date = new Date()
): ExchangeRequestRecord {
  const normalized = normalizeUpdateExchangeRequestInput(input)

  if (
    (EXCHANGE_REQUEST_TERMINAL_STATUSES as readonly string[]).includes(
      existing.status
    )
  ) {
    throw new Error("EXCHANGE_REQUEST_TERMINAL_STATUS_IMMUTABLE")
  }

  if (normalized.status) {
    assertValidExchangeStatusTransition({
      from: existing.status,
      to: normalized.status,
    })
  }

  const nextStatus = normalized.status ?? existing.status
  const next: ExchangeRequestRecord = {
    ...existing,
    status: nextStatus,
    customer_visible_note:
      normalized.customer_visible_note !== undefined
        ? normalized.customer_visible_note
        : existing.customer_visible_note,
    operator_note:
      normalized.operator_note !== undefined
        ? normalized.operator_note
        : existing.operator_note,
    reverse_logistics_provider:
      normalized.reverse_logistics_provider !== undefined
        ? normalized.reverse_logistics_provider
        : existing.reverse_logistics_provider,
    reverse_tracking_code:
      normalized.reverse_tracking_code !== undefined
        ? normalized.reverse_tracking_code
        : existing.reverse_tracking_code,
    reverse_authorization_code:
      normalized.reverse_authorization_code !== undefined
        ? normalized.reverse_authorization_code
        : existing.reverse_authorization_code,
    reverse_label_reference:
      normalized.reverse_label_reference !== undefined
        ? normalized.reverse_label_reference
        : existing.reverse_label_reference,
    return_received_at: existing.return_received_at,
    resolved_at: existing.resolved_at,
    updated_at: at.toISOString(),
  }

  if (
    nextStatus === EXCHANGE_REQUEST_STATUS.RETURN_RECEIVED &&
    !next.return_received_at
  ) {
    next.return_received_at = at.toISOString()
  }

  if (nextStatus === EXCHANGE_REQUEST_STATUS.RESOLVED && !next.resolved_at) {
    next.resolved_at = at.toISOString()
  }

  return next
}

export function createAdminExchangeRequest(input: {
  request: CreateExchangeRequestInput
  order_metadata: Record<string, unknown> | null | undefined
  id: string
  /**
   * Authenticated Admin actor_id only. Never accept client-supplied operator IDs.
   */
  created_by_operator_id?: string | null
  at?: Date
}): AdminCreateExchangeRequestResult {
  const normalized = normalizeCreateExchangeRequestInput({
    ...input.request,
    created_by_operator_id: undefined,
  })

  assertOrderEligibleForExchange({
    order_id: normalized.order_id,
    order_metadata: input.order_metadata,
  })

  const exchangeRequest = buildExchangeRequestRecord(
    {
      id: input.id,
      order_id: normalized.order_id,
      reason: normalized.reason,
      affected_items: normalized.affected_items,
      customer_visible_note: normalized.customer_visible_note,
      operator_note: normalized.operator_note,
      reverse_logistics_provider: normalized.reverse_logistics_provider,
      reverse_tracking_code: normalized.reverse_tracking_code,
      reverse_authorization_code: normalized.reverse_authorization_code,
      reverse_label_reference: normalized.reverse_label_reference,
      created_by_operator_id: input.created_by_operator_id ?? null,
    },
    input.at
  )

  return { exchange_request: exchangeRequest }
}

export function updateAdminExchangeRequest(input: {
  existing: ExchangeRequestRecord
  update: UpdateExchangeRequestInput
  at?: Date
}): AdminUpdateExchangeRequestResult {
  const exchangeRequest = applyExchangeRequestUpdate(
    input.existing,
    input.update,
    input.at
  )

  return { exchange_request: exchangeRequest }
}

class ExchangeRequestModuleService extends MedusaService({
  ExchangeRequest,
}) {}

export default ExchangeRequestModuleService

export { EXCHANGE_STATUS_TRANSITIONS }
