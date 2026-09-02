import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import CheckoutCompletionLog from "./models/checkout-completion-log"
import {
  CHECKOUT_COMPLETION_STALE_AFTER_MS,
  isCheckoutCompletionLockedStale,
} from "./staleness"
import {
  CHECKOUT_COMPLETION_OPERATION,
  CHECKOUT_COMPLETION_STATUS,
  type BuildCheckoutCompletionIdempotencyKeyInput,
  type CheckoutCompletionMetadata,
  type CheckoutCompletionMetadataValue,
  type CheckoutCompletionOperation,
  type CheckoutCompletionStatus,
  type CreateCheckoutCompletionLogInput,
  type CheckoutCompletionOrderBirthAuthority,
} from "./types"

export { CHECKOUT_COMPLETION_STALE_AFTER_MS } from "./staleness"

const ALLOWED_METADATA_KEYS = new Set([
  "cart_id",
  "order_creation_error_cause_message",
  "order_creation_error_code",
  "order_creation_error_message",
  "order_creation_error_name",
  "order_creation_error_step",
  "order_creation_error_string",
  "order_creation_error_type",
  "payment_attempt_id",
  "payment_intent_id",
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

export type CheckoutCompletionLogSqlTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

const CHECKOUT_COMPLETION_AUTHORITY_COLUMNS = [
  "id", "operation", "idempotency_key", "cart_id", "payment_intent_id",
  "payment_attempt_id", "order_id", "status", "execution_started_at",
  "last_reconciliation_at", "reconciliation_reason_code", "deleted_at",
] as const

const CHECKOUT_COMPLETION_FILTER_COLUMNS = {
  id: "id",
  idempotency_key: "idempotency_key",
  cart_id: "cart_id",
  payment_attempt_id: "payment_attempt_id",
} as const

function mapOrderBirthAuthority(
  row: Record<string, unknown>
): CheckoutCompletionOrderBirthAuthority {
  return {
    id: String(row.id),
    operation: row.operation as CheckoutCompletionOrderBirthAuthority["operation"],
    idempotency_key: String(row.idempotency_key),
    cart_id: String(row.cart_id),
    payment_intent_id: String(row.payment_intent_id),
    payment_attempt_id: row.payment_attempt_id == null ? null : String(row.payment_attempt_id),
    order_id: row.order_id == null ? null : String(row.order_id),
    status: row.status as CheckoutCompletionOrderBirthAuthority["status"],
    execution_started_at: row.execution_started_at instanceof Date || typeof row.execution_started_at === "string" ? row.execution_started_at : null,
    last_reconciliation_at: row.last_reconciliation_at instanceof Date || typeof row.last_reconciliation_at === "string" ? row.last_reconciliation_at : null,
    reconciliation_reason_code: row.reconciliation_reason_code == null ? null : String(row.reconciliation_reason_code) as CheckoutCompletionOrderBirthAuthority["reconciliation_reason_code"],
    deleted_at: row.deleted_at instanceof Date || typeof row.deleted_at === "string" ? row.deleted_at : null,
  }
}

export async function readCheckoutCompletionLogHistory(
  transaction: CheckoutCompletionLogSqlTransaction,
  filters: { id?: string; idempotency_key?: string; cart_id?: string; payment_attempt_id?: string }
): Promise<CheckoutCompletionOrderBirthAuthority[]> {
  const entries = Object.entries(filters)
    .filter(([key, value]) => key in CHECKOUT_COMPLETION_FILTER_COLUMNS && value != null)
    .map(([key, value]) => [
      CHECKOUT_COMPLETION_FILTER_COLUMNS[key as keyof typeof CHECKOUT_COMPLETION_FILTER_COLUMNS],
      value,
    ] as const)
  const where = entries.length > 0
    ? `where ${entries.map(([key]) => `${key} = ?`).join(" and ")}`
    : ""
  const result = await transaction.raw(
    `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")} from checkout_completion_log ${where} order by id`,
    entries.map(([, value]) => value)
  )
  return (result.rows ?? []).map(mapOrderBirthAuthority)
}

class CheckoutCompletionModuleService extends MedusaService({
  CheckoutCompletionLog,
}) {
  async readCheckoutCompletionLogHistory(
    transaction: CheckoutCompletionLogSqlTransaction,
    filters: { id?: string; idempotency_key?: string; cart_id?: string; payment_attempt_id?: string } = {}
  ): Promise<CheckoutCompletionOrderBirthAuthority[]> {
    return readCheckoutCompletionLogHistory(transaction, filters)
  }
}

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
    status !== CHECKOUT_COMPLETION_STATUS.FAILED &&
    status !== CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED
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

    if (
      key === "payment_intent_id" &&
      typeof value === "string" &&
      /^pi_[A-Za-z0-9]+$/.test(value)
    ) {
      output[key] = value
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export type CheckoutCompletionLogRecord = {
  id: string
  operation: CheckoutCompletionOperation
  idempotency_key: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id: string | null
  order_id: string | null
  status: CheckoutCompletionStatus
  error_code: string | null
  error_message: string | null
  metadata: CheckoutCompletionMetadata | null
  locked_at: Date | string | null
  completed_at: Date | string | null
  failed_at: Date | string | null
  execution_started_at?: Date | string | null
  last_reconciliation_at?: Date | string | null
  reconciliation_reason_code?: import("../../reconciliation/reason-codes").ReconciliationReasonCode | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export function buildCheckoutCompletionLogRecord(
  input: CreateCheckoutCompletionLogInput,
  id: string,
  at: Date = new Date()
): CheckoutCompletionLogRecord {
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
    execution_started_at: input.execution_started_at ?? null,
    last_reconciliation_at: input.last_reconciliation_at ?? null,
    reconciliation_reason_code: input.reconciliation_reason_code ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  }
}

export type CheckoutCompletionClaimDecision =
  | {
      type: "create"
      record: Omit<CheckoutCompletionLogRecord, "id">
    }
  | {
      type: "reuse_completed"
      log: CheckoutCompletionLogRecord
      order_id: string
    }
  | {
      type: "already_processing"
      log: CheckoutCompletionLogRecord
    }
  | {
      type: "retry_processing_without_order"
      log: CheckoutCompletionLogRecord
      failedUpdate: Partial<CheckoutCompletionLogRecord>
      retryUpdate: Partial<CheckoutCompletionLogRecord>
    }
  | {
      type: "recover_created_order"
      log: CheckoutCompletionLogRecord
      order_id: string
    }
  | {
      type: "retry_failed"
      log: CheckoutCompletionLogRecord
      update: Partial<CheckoutCompletionLogRecord>
    }

export function resolveCheckoutCompletionClaimDecision(input: {
  existing: CheckoutCompletionLogRecord | null
  next: CreateCheckoutCompletionLogInput
  at?: Date
}): CheckoutCompletionClaimDecision {
  const at = input.at ?? new Date()

  if (!input.existing) {
    const created = buildCheckoutCompletionLogRecord(
      {
        ...input.next,
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: at.toISOString(),
        completed_at: null,
        failed_at: null,
        error_code: null,
        error_message: null,
      },
      "claim-pending",
      at
    )

    const { id: _ignoredId, ...record } = created

    return {
      type: "create",
      record,
    }
  }

  if (
    input.existing.status === CHECKOUT_COMPLETION_STATUS.COMPLETED &&
    input.existing.order_id
  ) {
    return {
      type: "reuse_completed",
      log: input.existing,
      order_id: input.existing.order_id,
    }
  }

  if (
    input.existing.order_id &&
    (input.existing.status === CHECKOUT_COMPLETION_STATUS.PROCESSING ||
      input.existing.status === CHECKOUT_COMPLETION_STATUS.FAILED)
  ) {
    return {
      type: "recover_created_order",
      log: input.existing,
      order_id: input.existing.order_id,
    }
  }

  if (input.existing.status === CHECKOUT_COMPLETION_STATUS.PROCESSING) {
    if (!input.existing.order_id) {
      if (
        !isCheckoutCompletionLockedStale(
          input.existing.locked_at,
          at,
          CHECKOUT_COMPLETION_STALE_AFTER_MS
        )
      ) {
        return {
          type: "already_processing",
          log: input.existing,
        }
      }

      return {
        type: "retry_processing_without_order",
        log: input.existing,
        failedUpdate: {
          status: CHECKOUT_COMPLETION_STATUS.FAILED,
          failed_at: at.toISOString(),
          error_code: "CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER",
          error_message:
            "Processing checkout completion without order_id was marked retryable before a new attempt.",
          updated_at: at.toISOString(),
        },
        retryUpdate: {
          status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
          locked_at: at.toISOString(),
          completed_at: null,
          failed_at: null,
          error_code: null,
          error_message: null,
          updated_at: at.toISOString(),
        },
      }
    }

    return {
      type: "already_processing",
      log: input.existing,
    }
  }

  if (
    input.existing.status === CHECKOUT_COMPLETION_STATUS.FAILED &&
    !input.existing.order_id
  ) {
    return {
      type: "retry_failed",
      log: input.existing,
      update: {
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: at.toISOString(),
        completed_at: null,
        failed_at: null,
        error_code: null,
        error_message: null,
        updated_at: at.toISOString(),
      },
    }
  }

  throw new Error("CHECKOUT_COMPLETION_LOG_STATE_INVALID")
}

export function buildCheckoutCompletionCompletedUpdate(input: {
  id: string
  order_id: string
  at?: Date
}): Partial<CheckoutCompletionLogRecord> {
  const at = input.at ?? new Date()

  return {
    id: input.id,
    order_id: input.order_id,
    status: CHECKOUT_COMPLETION_STATUS.COMPLETED,
    completed_at: at.toISOString(),
    failed_at: null,
    error_code: null,
    error_message: null,
    updated_at: at.toISOString(),
  }
}

export function buildCheckoutCompletionFailedUpdate(input: {
  id: string
  error_code: string
  error_message: string
  metadata?: Record<string, unknown> | null
  at?: Date
}): Partial<CheckoutCompletionLogRecord> {
  const at = input.at ?? new Date()

  const update: Partial<CheckoutCompletionLogRecord> = {
    id: input.id,
    status: CHECKOUT_COMPLETION_STATUS.FAILED,
    failed_at: at.toISOString(),
    error_code: sanitizeString(input.error_code).slice(0, 120),
    error_message: sanitizeString(input.error_message).slice(0, 500),
    updated_at: at.toISOString(),
  }

  if (input.metadata !== undefined) {
    update.metadata = sanitizeCheckoutCompletionMetadata(input.metadata)
  }

  return update
}
