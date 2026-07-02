import { createHash } from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import EmailDeliveryLog from "./models/email-delivery-log"
import {
  EMAIL_DELIVERY_LOG_EMAIL_TYPE,
  EMAIL_DELIVERY_LOG_PROVIDER,
  EMAIL_DELIVERY_LOG_STATUSES,
  EMAIL_DELIVERY_LOG_STATUS,
  EMAIL_DELIVERY_LOG_TEMPLATE_KEY,
  EMAIL_DELIVERY_LOG_TEMPLATE_VERSION,
  type BuildOrderConfirmationEmailIdempotencyKeyInput,
  type CreateEmailDeliveryLogInput,
  type EmailDeliveryAudit,
  type EmailDeliveryEmailType,
  type EmailDeliveryLogRecord,
  type EmailDeliveryMetadata,
  type EmailDeliveryMetadataValue,
  type EmailDeliveryProvider,
  type EmailDeliveryStatus,
  type EmailDeliveryTemplateKey,
  type OrderConfirmationEmailItemInput,
  type OrderConfirmationEmailPayload,
  type OrderConfirmationEmailPayloadInput,
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
  joinKey("re", "fund"),
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

function sanitizeMetadataValue(value: unknown): EmailDeliveryMetadataValue {
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

function normalizeEmailAddress(value: string, errorCode: string): string {
  const normalized = normalizeRequiredString(value, errorCode, (input) =>
    input.toLowerCase()
  )

  const atIndex = normalized.indexOf("@")
  const dotIndex = normalized.lastIndexOf(".")

  if (atIndex <= 0 || dotIndex <= atIndex + 1 || dotIndex === normalized.length - 1) {
    throw new Error(errorCode)
  }

  return normalized
}

class EmailDeliveryLogModuleService extends MedusaService({
  EmailDeliveryLog,
}) {}

export default EmailDeliveryLogModuleService

export function isOrderConfirmationEmailLocallyRecorded(
  log:
    | Pick<EmailDeliveryLogRecord, "status">
    | EmailDeliveryStatus
    | string
    | null
    | undefined
): boolean {
  const status = typeof log === "string" ? log : log?.status

  if (!status) {
    return false
  }

  return EMAIL_DELIVERY_LOG_STATUSES.includes(status as EmailDeliveryStatus)
}

export function resolveOrderConfirmationSupportEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): string {
  const configured = env.SUPPORT_EMAIL?.trim()

  if (!configured) {
    throw new Error("EMAIL_DELIVERY_SUPPORT_EMAIL_NOT_CONFIGURED")
  }

  return normalizeEmailAddress(
    configured,
    "EMAIL_DELIVERY_SUPPORT_EMAIL_INVALID"
  )
}

export function assertValidEmailDeliveryEmailType(
  emailType: string
): asserts emailType is EmailDeliveryEmailType {
  if (emailType !== EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION) {
    throw new Error("EMAIL_DELIVERY_EMAIL_TYPE_INVALID")
  }
}

export function assertValidEmailDeliveryTemplateKey(
  templateKey: string
): asserts templateKey is EmailDeliveryTemplateKey {
  if (templateKey !== EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1) {
    throw new Error("EMAIL_DELIVERY_TEMPLATE_KEY_INVALID")
  }
}

export function assertValidEmailDeliveryTemplateVersion(
  templateVersion: number
): asserts templateVersion is typeof EMAIL_DELIVERY_LOG_TEMPLATE_VERSION {
  if (templateVersion !== EMAIL_DELIVERY_LOG_TEMPLATE_VERSION) {
    throw new Error("EMAIL_DELIVERY_TEMPLATE_VERSION_INVALID")
  }
}

export function assertValidEmailDeliveryProvider(
  provider: string
): asserts provider is EmailDeliveryProvider {
  if (provider !== EMAIL_DELIVERY_LOG_PROVIDER.RESEND) {
    throw new Error("EMAIL_DELIVERY_PROVIDER_INVALID")
  }
}

export function assertValidEmailDeliveryStatus(
  status: string
): asserts status is EmailDeliveryStatus {
  if (!EMAIL_DELIVERY_LOG_STATUSES.includes(status as EmailDeliveryStatus)) {
    throw new Error("EMAIL_DELIVERY_STATUS_INVALID")
  }
}

export function buildOrderConfirmationEmailIdempotencyKey(
  input: BuildOrderConfirmationEmailIdempotencyKeyInput
): string {
  const orderId = normalizeRequiredString(
    input.order_id,
    "EMAIL_DELIVERY_ORDER_ID_REQUIRED"
  )

  return `order-confirmation/${orderId}`
}

export function assertNoSensitiveEmailDeliveryMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  if (containsForbiddenData(metadata)) {
    throw new Error("EMAIL_DELIVERY_METADATA_FORBIDDEN")
  }
}

export function sanitizeEmailDeliveryMetadata(
  metadata: Record<string, unknown> | null | undefined
): EmailDeliveryMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveEmailDeliveryMetadata(metadata)

  const output: EmailDeliveryMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function sanitizeEmailDeliveryError(error: unknown): {
  error_code: string | null
  error_message: string | null
} {
  const sanitizeErrorMessage = (value: string): string =>
    sanitizeEmailDeliveryErrorText(value)

  if (error instanceof Error) {
    return {
      error_code: sanitizeErrorMessage(error.name || "Error").slice(0, 120) || "Error",
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

export function sanitizeEmailDeliveryErrorText(value: string): string {
  let sanitized = sanitizeString(value)

  for (const pattern of ERROR_REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]")
  }

  return sanitized
}

function buildOrderConfirmationItem(
  item: OrderConfirmationEmailItemInput
): OrderConfirmationEmailItemInput {
  return {
    sku: normalizeRequiredString(item.sku, "EMAIL_DELIVERY_ITEM_SKU_REQUIRED"),
    quantity: normalizeStrictPositiveInteger(
      item.quantity,
      "EMAIL_DELIVERY_ITEM_QUANTITY_INVALID"
    ),
    unit_price: normalizeStrictPositiveInteger(
      item.unit_price,
      "EMAIL_DELIVERY_ITEM_UNIT_PRICE_INVALID"
    ),
    subtotal: normalizeStrictPositiveInteger(
      item.subtotal,
      "EMAIL_DELIVERY_ITEM_SUBTOTAL_INVALID"
    ),
  }
}

export function buildOrderConfirmationEmailPayload(
  input: OrderConfirmationEmailPayloadInput & Record<string, unknown>
): OrderConfirmationEmailPayload {
  if (containsForbiddenData(input)) {
    throw new Error("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")
  }

  const emailType =
    input.email_type ?? EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION
  const templateKey =
    input.template_key ?? EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1
  const templateVersion =
    input.template_version ?? EMAIL_DELIVERY_LOG_TEMPLATE_VERSION
  const provider = input.provider ?? EMAIL_DELIVERY_LOG_PROVIDER.RESEND

  assertValidEmailDeliveryEmailType(emailType)
  assertValidEmailDeliveryTemplateKey(templateKey)
  assertValidEmailDeliveryTemplateVersion(templateVersion)
  assertValidEmailDeliveryProvider(provider)

  const currencyCode = normalizeRequiredString(
    input.currency_code,
    "EMAIL_DELIVERY_CURRENCY_CODE_REQUIRED",
    (value) => value.toLowerCase()
  )

  if (currencyCode !== "brl") {
    throw new Error("EMAIL_DELIVERY_CURRENCY_CODE_INVALID")
  }

  const items = input.items.map((item) => buildOrderConfirmationItem(item))
  const itemCount = normalizeStrictPositiveInteger(
    input.item_count,
    "EMAIL_DELIVERY_ITEM_COUNT_INVALID"
  )

  if (items.length !== itemCount) {
    throw new Error("EMAIL_DELIVERY_ITEM_COUNT_MISMATCH")
  }

  return {
    order_id: normalizeRequiredString(
      input.order_id,
      "EMAIL_DELIVERY_ORDER_ID_REQUIRED"
    ),
    order_reference: normalizeRequiredString(
      input.order_reference,
      "EMAIL_DELIVERY_ORDER_REFERENCE_REQUIRED"
    ),
    amount: normalizeStrictPositiveInteger(
      input.amount,
      "EMAIL_DELIVERY_AMOUNT_INVALID"
    ),
    currency_code: currencyCode,
    item_count: itemCount,
    items,
    support_email: normalizeEmailAddress(
      input.support_email,
      "EMAIL_DELIVERY_SUPPORT_EMAIL_INVALID"
    ),
  }
}

export function buildRecipientEmailAudit(
  recipientEmail: string
): EmailDeliveryAudit {
  const normalizedRecipient = normalizeEmailAddress(
    recipientEmail,
    "EMAIL_DELIVERY_RECIPIENT_EMAIL_INVALID"
  )
  const [, domain] = normalizedRecipient.split("@")

  return {
    recipient_email_hash: createHash("sha256")
      .update(normalizedRecipient)
      .digest("hex"),
    recipient_email_domain: domain,
  }
}

export function buildEmailDeliveryLogRecord(
  input: CreateEmailDeliveryLogInput,
  id: string,
  at: Date = new Date()
): EmailDeliveryLogRecord {
  const payload = buildOrderConfirmationEmailPayload(
    input.payload as OrderConfirmationEmailPayloadInput & Record<string, unknown>
  )
  const emailType =
    input.email_type ?? EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION
  const templateKey =
    input.template_key ?? EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1
  const templateVersion =
    input.template_version ?? EMAIL_DELIVERY_LOG_TEMPLATE_VERSION
  const provider = input.provider ?? EMAIL_DELIVERY_LOG_PROVIDER.RESEND
  const status = input.status ?? EMAIL_DELIVERY_LOG_STATUS.RECORDED
  const recordedAt =
    normalizeIsoDate(
      input.recorded_at ?? at,
      "EMAIL_DELIVERY_RECORDED_AT_INVALID"
    ) ?? at.toISOString()
  const recipientAudit = buildRecipientEmailAudit(input.recipient_email)
  const orderId = input.order_id?.trim() ? input.order_id.trim() : payload.order_id
  const idempotencyKey = input.idempotency_key?.trim()
    ? input.idempotency_key.trim()
    : buildOrderConfirmationEmailIdempotencyKey({
        order_id: orderId,
      })

  assertValidEmailDeliveryEmailType(emailType)
  assertValidEmailDeliveryTemplateKey(templateKey)
  assertValidEmailDeliveryTemplateVersion(templateVersion)
  assertValidEmailDeliveryProvider(provider)
  assertValidEmailDeliveryStatus(status)

  return {
    id,
    email_type: emailType,
    template_key: templateKey,
    template_version: EMAIL_DELIVERY_LOG_TEMPLATE_VERSION,
    provider,
    idempotency_key: idempotencyKey,
    order_id: orderId,
    cart_id: normalizeRequiredString(
      input.cart_id,
      "EMAIL_DELIVERY_CART_ID_REQUIRED"
    ),
    payment_attempt_id: normalizeRequiredString(
      input.payment_attempt_id,
      "EMAIL_DELIVERY_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    checkout_completion_log_id: normalizeRequiredString(
      input.checkout_completion_log_id,
      "EMAIL_DELIVERY_CHECKOUT_COMPLETION_LOG_ID_REQUIRED"
    ),
    analytics_event_log_id: normalizeRequiredString(
      input.analytics_event_log_id,
      "EMAIL_DELIVERY_ANALYTICS_EVENT_LOG_ID_REQUIRED"
    ),
    payment_intent_id: normalizeRequiredString(
      input.payment_intent_id,
      "EMAIL_DELIVERY_PAYMENT_INTENT_ID_REQUIRED"
    ),
    status,
    recipient_email_hash: recipientAudit.recipient_email_hash,
    recipient_email_domain: recipientAudit.recipient_email_domain,
    payload,
    metadata: sanitizeEmailDeliveryMetadata(input.metadata),
    provider_message_id: input.provider_message_id
      ? sanitizeString(input.provider_message_id).slice(0, 255)
      : null,
    attempt_count:
      input.attempt_count === undefined
        ? 0
        : normalizeNonNegativeInteger(
          input.attempt_count,
          "EMAIL_DELIVERY_ATTEMPT_COUNT_INVALID"
        ),
    last_error_code: input.last_error_code
      ? sanitizeEmailDeliveryErrorText(input.last_error_code).slice(0, 120)
      : null,
    last_error_message: input.last_error_message
      ? sanitizeEmailDeliveryErrorText(input.last_error_message).slice(0, 500)
      : null,
    next_retry_at: normalizeIsoDate(
      input.next_retry_at,
      "EMAIL_DELIVERY_NEXT_RETRY_AT_INVALID"
    ),
    recorded_at: recordedAt,
    queued_at: normalizeIsoDate(input.queued_at, "EMAIL_DELIVERY_QUEUED_AT_INVALID"),
    sending_started_at: normalizeIsoDate(
      input.sending_started_at,
      "EMAIL_DELIVERY_SENDING_STARTED_AT_INVALID"
    ),
    sent_at: normalizeIsoDate(input.sent_at, "EMAIL_DELIVERY_SENT_AT_INVALID"),
    failed_at: normalizeIsoDate(
      input.failed_at,
      "EMAIL_DELIVERY_FAILED_AT_INVALID"
    ),
    dead_lettered_at: normalizeIsoDate(
      input.dead_lettered_at,
      "EMAIL_DELIVERY_DEAD_LETTERED_AT_INVALID"
    ),
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
  }
}

export const EMAIL_RESEND_RELAY_MAX_ATTEMPTS = 5 as const
export const EMAIL_RESEND_RELAY_BACKOFF_BASE_MS = 60_000
export const EMAIL_RESEND_RELAY_BACKOFF_MAX_MS = 3_600_000

export type ResendEmailSendPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  reply_to?: string
}

export type EmailResendRelayClaimUpdate = Pick<
  EmailDeliveryLogRecord,
  "status" | "queued_at" | "sending_started_at" | "updated_at"
>

export type EmailResendRelaySuccessUpdate = Pick<
  EmailDeliveryLogRecord,
  | "status"
  | "sent_at"
  | "provider_message_id"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "updated_at"
>

export type EmailResendRelayFailureUpdate = Pick<
  EmailDeliveryLogRecord,
  | "status"
  | "attempt_count"
  | "last_error_code"
  | "last_error_message"
  | "next_retry_at"
  | "failed_at"
  | "dead_lettered_at"
  | "updated_at"
>

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function formatOrderConfirmationAmount(
  amount: number,
  currencyCode: string
): string {
  if (currencyCode === "brl") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount / 100)
  }

  return `${amount} ${currencyCode.toUpperCase()}`
}

export function renderOrderConfirmationEmailText(
  payload: OrderConfirmationEmailPayload
): string {
  const lines = [
    "Pedido confirmado",
    "",
    `Referencia: ${payload.order_reference}`,
    `Total: ${formatOrderConfirmationAmount(payload.amount, payload.currency_code)}`,
    `Itens: ${payload.item_count}`,
    "",
    ...payload.items.map(
      (item) =>
        `- ${item.sku} x${item.quantity} (${formatOrderConfirmationAmount(item.subtotal, payload.currency_code)})`
    ),
    "",
    `Suporte: ${payload.support_email}`,
  ]

  return lines.join("\n")
}

export function renderOrderConfirmationEmailHtml(
  payload: OrderConfirmationEmailPayload
): string {
  const itemsHtml = payload.items
    .map(
      (item) =>
        `<li>${escapeHtml(item.sku)} x${item.quantity} - ${escapeHtml(formatOrderConfirmationAmount(item.subtotal, payload.currency_code))}</li>`
    )
    .join("")

  return [
    "<!DOCTYPE html>",
    "<html>",
    "<body>",
    "<h1>Pedido confirmado</h1>",
    `<p>Referencia: ${escapeHtml(payload.order_reference)}</p>`,
    `<p>Total: ${escapeHtml(formatOrderConfirmationAmount(payload.amount, payload.currency_code))}</p>`,
    `<ul>${itemsHtml}</ul>`,
    `<p>Suporte: ${escapeHtml(payload.support_email)}</p>`,
    "</body>",
    "</html>",
  ].join("")
}

export function buildOrderConfirmationResendSendPayload(input: {
  payload: OrderConfirmationEmailPayload
  recipientEmail: string
  fromEmail: string
  replyTo?: string
}): ResendEmailSendPayload {
  if (containsForbiddenData(input)) {
    throw new Error("EMAIL_RESEND_SEND_PAYLOAD_FORBIDDEN")
  }

  const sendPayload: ResendEmailSendPayload = {
    from: normalizeRequiredString(
      input.fromEmail,
      "EMAIL_RESEND_FROM_EMAIL_INVALID"
    ),
    to: [
      normalizeEmailAddress(
        input.recipientEmail,
        "EMAIL_RESEND_RECIPIENT_EMAIL_INVALID"
      ),
    ],
    subject: "Pedido confirmado",
    html: renderOrderConfirmationEmailHtml(input.payload),
    text: renderOrderConfirmationEmailText(input.payload),
  }

  if (input.replyTo?.trim()) {
    sendPayload.reply_to = normalizeEmailAddress(
      input.replyTo,
      "EMAIL_RESEND_REPLY_TO_INVALID"
    )
  }

  return sendPayload
}

export function resolveOrderRecipientEmail(
  order: { email?: string | null } | null | undefined
): string {
  if (!order?.email?.trim()) {
    throw new Error("EMAIL_RESEND_ORDER_EMAIL_MISSING")
  }

  return normalizeEmailAddress(order.email, "EMAIL_RESEND_ORDER_EMAIL_INVALID")
}

export function computeEmailResendRelayBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1)
  const backoff = EMAIL_RESEND_RELAY_BACKOFF_BASE_MS * 2 ** exponent

  return Math.min(backoff, EMAIL_RESEND_RELAY_BACKOFF_MAX_MS)
}

export function isEmailResendRelayDue(
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

export function isEmailResendRelayEligibleStatus(
  status: EmailDeliveryStatus | string
): boolean {
  return (
    status === EMAIL_DELIVERY_LOG_STATUS.RECORDED ||
    status === EMAIL_DELIVERY_LOG_STATUS.FAILED
  )
}

export function buildEmailResendRelayClaimUpdate(
  at: Date = new Date()
): EmailResendRelayClaimUpdate {
  const iso = at.toISOString()

  return {
    status: EMAIL_DELIVERY_LOG_STATUS.QUEUED,
    queued_at: iso,
    sending_started_at: iso,
    updated_at: iso,
  }
}

export function buildEmailResendRelaySendingUpdate(
  at: Date = new Date()
): Pick<EmailDeliveryLogRecord, "status" | "updated_at"> {
  return {
    status: EMAIL_DELIVERY_LOG_STATUS.SENDING,
    updated_at: at.toISOString(),
  }
}

export function buildEmailResendRelaySuccessUpdate(
  providerMessageId: string,
  at: Date = new Date()
): EmailResendRelaySuccessUpdate {
  const iso = at.toISOString()

  return {
    status: EMAIL_DELIVERY_LOG_STATUS.SENT,
    sent_at: iso,
    provider_message_id: sanitizeString(providerMessageId).slice(0, 255),
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    updated_at: iso,
  }
}

export function buildEmailResendRelayFailureUpdate(
  error: unknown,
  attemptCount: number,
  options: {
    maxAttempts?: number
    at?: Date
  } = {}
): EmailResendRelayFailureUpdate {
  const maxAttempts = options.maxAttempts ?? EMAIL_RESEND_RELAY_MAX_ATTEMPTS
  const at = options.at ?? new Date()
  const sanitized = sanitizeEmailDeliveryError(error)
  const nextAttemptCount = attemptCount + 1
  const iso = at.toISOString()

  if (nextAttemptCount >= maxAttempts) {
    return {
      status: EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER,
      attempt_count: nextAttemptCount,
      last_error_code: sanitized.error_code,
      last_error_message: sanitized.error_message,
      next_retry_at: null,
      failed_at: iso,
      dead_lettered_at: iso,
      updated_at: iso,
    }
  }

  const nextRetryAt = new Date(
    at.getTime() + computeEmailResendRelayBackoffMs(nextAttemptCount)
  )

  return {
    status: EMAIL_DELIVERY_LOG_STATUS.FAILED,
    attempt_count: nextAttemptCount,
    last_error_code: sanitized.error_code,
    last_error_message: sanitized.error_message,
    next_retry_at: nextRetryAt.toISOString(),
    failed_at: iso,
    dead_lettered_at: null,
    updated_at: iso,
  }
}
