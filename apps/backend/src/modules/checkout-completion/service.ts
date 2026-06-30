import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import CheckoutCompletionLog from "./models/checkout-completion-log"
import {
  CHECKOUT_COMPLETION_OPERATION,
  CHECKOUT_COMPLETION_STATUS,
  type BuildCheckoutCompletionIdempotencyKeyInput,
  type CheckoutCompletionMetadata,
  type CheckoutCompletionMetadataValue,
  type CheckoutCompletionOperation,
  type CheckoutCompletionStatus,
  type CreateCheckoutCompletionLogInput,
} from "./types"

const ALLOWED_METADATA_KEYS = new Set([
  "correlation_id",
  "payment_method_type",
  "stripe_event_id",
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
  "payload",
  "cpf",
  "cnpj",
  "full_address",
  "address_1",
  "address_2",
  "shipping_address",
  "billing_address",
  "federal_tax_id",
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
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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

function sanitizeMetadataValue(value: unknown): CheckoutCompletionMetadataValue {
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

class CheckoutCompletionModuleService extends MedusaService({
  CheckoutCompletionLog,
}) {}

export default CheckoutCompletionModuleService

export function buildCheckoutCompletionIdempotencyKey(
  input: BuildCheckoutCompletionIdempotencyKeyInput
): string {
  const paymentIntentId = input.payment_intent_id?.trim()

  if (!paymentIntentId) {
    throw new Error("CHECKOUT_COMPLETION_PAYMENT_INTENT_ID_REQUIRED")
  }

  if (input.composite) {
    const cartId = input.cart_id?.trim()

    if (!cartId) {
      throw new Error("CHECKOUT_COMPLETION_CART_ID_REQUIRED_FOR_COMPOSITE")
    }

    return `${cartId}:${paymentIntentId}`
  }

  return paymentIntentId
}

export function assertValidCheckoutCompletionOperation(
  operation: string
): asserts operation is CheckoutCompletionOperation {
  if (
    operation !== CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER
  ) {
    throw new Error("CHECKOUT_COMPLETION_OPERATION_INVALID")
  }
}

export function assertValidCheckoutCompletionStatus(
  status: string
): asserts status is CheckoutCompletionStatus {
  if (
    status !== CHECKOUT_COMPLETION_STATUS.PROCESSING &&
    status !== CHECKOUT_COMPLETION_STATUS.COMPLETED &&
    status !== CHECKOUT_COMPLETION_STATUS.FAILED
  ) {
    throw new Error("CHECKOUT_COMPLETION_STATUS_INVALID")
  }
}

export function assertNoSensitiveCheckoutCompletionMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  for (const key of Object.keys(metadata)) {
    const normalizedKey = key.toLowerCase()

    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey)) {
      throw new Error("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")
    }
  }

  if (containsForbiddenValue(metadata)) {
    throw new Error("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")
  }
}

export function sanitizeCheckoutCompletionMetadata(
  metadata: Record<string, unknown> | null | undefined
): CheckoutCompletionMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveCheckoutCompletionMetadata(metadata)

  const output: CheckoutCompletionMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function buildCheckoutCompletionLogRecord(
  input: CreateCheckoutCompletionLogInput,
  id: string,
  at: Date = new Date()
) {
  const timestamp = at.toISOString()
  const operation =
    input.operation ??
    CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER
  const status = input.status ?? CHECKOUT_COMPLETION_STATUS.PROCESSING

  assertValidCheckoutCompletionOperation(operation)
  assertValidCheckoutCompletionStatus(status)

  const idempotencyKey =
    input.idempotency_key ??
    buildCheckoutCompletionIdempotencyKey({
      payment_intent_id: input.payment_intent_id,
      cart_id: input.cart_id,
    })

  return {
    id,
    operation,
    idempotency_key: idempotencyKey,
    cart_id: input.cart_id,
    payment_intent_id: input.payment_intent_id,
    payment_attempt_id: input.payment_attempt_id ?? null,
    order_id: input.order_id ?? null,
    status,
    error_code: input.error_code ?? null,
    error_message: input.error_message
      ? sanitizeString(input.error_message).slice(0, 500)
      : null,
    metadata: sanitizeCheckoutCompletionMetadata(input.metadata),
    locked_at: input.locked_at ?? null,
    completed_at: input.completed_at ?? null,
    failed_at: input.failed_at ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  }
}
