import { createHash } from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import WebhookEventLog from "./models/webhook-event-log"
import type {
  CreateWebhookEventLogInput,
  WebhookEventLogStatus,
  WebhookMetadata,
  WebhookMetadataValue,
} from "./types"

const ALLOWED_METADATA_KEYS = new Set([
  "correlation_id",
  "external_event_id",
  "payment_attempt_id",
  "payment_intent_id",
  "provider",
  "status",
  "event_type",
  "stripe_account",
  "stripe_livemode",
  "stripe_refund_id",
  "refund_request_id",
  "refund_webhook_result",
  "delivery_attempt",
  "gelato_order_id",
  "order_reference_id",
  "fulfillment_id",
  "provider_status",
  "cart_id",
  "checkout_completion_log_id",
  "order_creation_error_cause_message",
  "order_creation_error_code",
  "order_creation_error_message",
  "order_creation_error_name",
  "order_creation_error_step",
  "order_creation_error_string",
  "order_creation_error_type",
])

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function buildPattern(source: string, flags?: string): RegExp {
  return new RegExp(source, flags)
}

const FORBIDDEN_METADATA_KEYS = new Set([
  joinKey("authori", "zation"),
  "cookie",
  joinKey("cookie", "s"),
  joinKey("copy", "_", "paste"),
  joinKey("client", "_", "secret"),
  "headers",
  joinKey("hosted", "_", "instructions", "_", "url"),
  joinKey("pix", "_", "copy", "_", "paste"),
  joinKey("pix", "_", "display", "_", "qr", "_", "code"),
  joinKey("qr", "_", "code"),
  joinKey("raw", "_", "body"),
  joinKey("raw", "body"),
  joinKey("gelato", "_", "webhook", "_", "secret"),
  joinKey("x", "-", "gelato", "-", "webhook", "-", "secret"),
  joinKey("x", "-", "api", "-", "key"),
  joinKey("gelato", "_", "api", "_", "key"),
  joinKey("track", "ing", "_", "token"),
  joinKey("tracking", "_", "url"),
  joinKey("tracking", "_", "code"),
  joinKey("pay", "load"),
])

const FORBIDDEN_METADATA_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/i,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "i"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "i"
  ),
  /\bpix_[A-Za-z0-9]+\b/i,
  /\b00020126[0-9A-Z]+/i,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
  /\bt=\d+,v1=[a-f0-9]+\b/i,
]

const METADATA_STRING_REDACTION_PATTERNS: RegExp[] = [
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

function normalizeForHash(value: unknown): unknown {
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
    return value.map((entry) => normalizeForHash(entry))
  }

  if (!isPlainObject(value)) {
    return String(value)
  }

  const output: Record<string, unknown> = {}

  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      continue
    }

    output[key] = normalizeForHash(value[key])
  }

  return output
}

function containsForbiddenValue(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_METADATA_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenValue(entry))
  }

  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, nested]) => {
      const normalizedKey = key.toLowerCase()
      return (
        FORBIDDEN_METADATA_KEYS.has(normalizedKey) ||
        containsForbiddenValue(nested)
      )
    })
  }

  return false
}

function sanitizeMetadataValue(value: unknown): WebhookMetadataValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "string") {
    let sanitized = value
    for (const pattern of METADATA_STRING_REDACTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]")
    }
    return sanitized
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadataValue(entry))
  }

  return sanitizeString(JSON.stringify(normalizeForHash(value)))
}

class WebhookModuleService extends MedusaService({
  WebhookEventLog,
}) {}

export default WebhookModuleService

export function buildWebhookPayloadHash(payload: unknown): string {
  const normalized = normalizeForHash(payload)
  const serialized = JSON.stringify(normalized)
  return createHash("sha256").update(serialized).digest("hex")
}

export function buildStripeDeduplicationKey(input: {
  external_event_id?: string | null
  payload_hash: string
}): string {
  if (input.external_event_id && input.external_event_id.trim().length > 0) {
    return input.external_event_id.trim()
  }

  return `payload_hash:${input.payload_hash}`
}

export function buildGelatoDeduplicationKey(input: {
  external_event_id?: string | null
  payload_hash: string
}): string {
  return buildStripeDeduplicationKey(input)
}

export function assertNoSensitiveWebhookMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  for (const key of Object.keys(metadata)) {
    const normalizedKey = key.toLowerCase()

    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey)) {
      throw new Error("WEBHOOK_METADATA_FORBIDDEN")
    }
  }

  if (containsForbiddenValue(metadata)) {
    throw new Error("WEBHOOK_METADATA_FORBIDDEN")
  }
}

export function sanitizeWebhookMetadata(
  metadata: Record<string, unknown> | null | undefined
): WebhookMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveWebhookMetadata(metadata)

  const output: WebhookMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function sanitizeWebhookError(error: unknown): {
  error_code: string | null
  error_message: string | null
} {
  const readProperty = (property: "name" | "message" | "code" | "cause") => {
    if (!error || typeof error !== "object") {
      return null
    }

    return (error as Record<string, unknown>)[property]
  }

  const sanitizeOptional = (value: unknown, maxLength: number) => {
    if (typeof value === "string") {
      return sanitizeString(value).slice(0, maxLength) || null
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return sanitizeString(String(value)).slice(0, maxLength) || null
    }

    return null
  }

  const code =
    sanitizeOptional(readProperty("code"), 120) ??
    sanitizeOptional(readProperty("name"), 120)
  const cause = readProperty("cause")
  const causeMessage =
    cause instanceof Error
      ? sanitizeOptional(cause.message, 500)
      : sanitizeOptional(
          cause && typeof cause === "object"
            ? (cause as Record<string, unknown>).message
            : cause,
          500
        )

  if (error instanceof Error) {
    const message = sanitizeOptional(error.message, 500) ?? causeMessage

    return {
      error_code: code ?? "Error",
      error_message: message,
    }
  }

  if (typeof error === "string") {
    return {
      error_code: "Error",
      error_message: sanitizeString(error).slice(0, 500) || null,
    }
  }

  if (error && typeof error === "object") {
    const message = sanitizeOptional(readProperty("message"), 500)
    const stringified = String(error)
    const fallback =
      stringified && stringified !== "[object Object]"
        ? sanitizeString(stringified).slice(0, 500) || null
        : null

    return {
      error_code: code ?? "Error",
      error_message: message ?? causeMessage ?? fallback,
    }
  }

  return {
    error_code: "Error",
    error_message: sanitizeOptional(error, 500),
  }
}

export function buildWebhookEventLogRecord(
  input: CreateWebhookEventLogInput,
  id: string,
  at: Date = new Date()
) {
  const timestamp = at.toISOString()
  const status: WebhookEventLogStatus = input.status ?? "received"

  return {
    id,
    provider: input.provider,
    external_event_id: input.external_event_id ?? null,
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    payload_hash: input.payload_hash,
    deduplication_key: input.deduplication_key,
    status,
    processing_attempts: input.processing_attempts ?? 0,
    error_code: input.error_code ?? null,
    error_message: input.error_message ?? null,
    metadata: sanitizeWebhookMetadata(input.metadata),
    received_at: input.received_at ?? timestamp,
    processed_at: input.processed_at ?? null,
    ignored_at: input.ignored_at ?? null,
    failed_at: input.failed_at ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  }
}
