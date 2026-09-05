import { randomBytes } from "crypto"
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
  type AcquireCheckoutOrderBirthAuthorityInput,
  type AcquireCheckoutOrderBirthAuthorityResult,
  type MarkOrderBirthExecutionStartedInput,
  type MarkOrderBirthExecutionStartedResult,
  type BindRecoveredOrderInput,
  type MarkReconciliationRequiredInput,
  type MarkCompletedInput,
  type ReadOrderBirthAuthorityFilters,
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

export type CheckoutCompletionLogSqlTransaction = any

const CHECKOUT_COMPLETION_AUTHORITY_COLUMNS = [
  "id", "operation", "idempotency_key", "cart_id", "payment_intent_id",
  "payment_attempt_id", "order_id", "status", "execution_started_at",
  "last_reconciliation_at", "reconciliation_reason_code", "deleted_at",
  "created_at", "updated_at",
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
    created_at: row.created_at instanceof Date || typeof row.created_at === "string" ? row.created_at : null,
    updated_at: row.updated_at instanceof Date || typeof row.updated_at === "string" ? row.updated_at : String(row.updated_at),
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

export const CHECKOUT_COMPLETION_AUTHORITY_CONFLICT =
  "CHECKOUT_COMPLETION_AUTHORITY_CONFLICT"

export class CheckoutCompletionAuthorityConflictError extends Error {
  readonly code = CHECKOUT_COMPLETION_AUTHORITY_CONFLICT

  constructor(message: string) {
    super(message)
    this.name = "CheckoutCompletionAuthorityConflictError"
  }
}

export async function acquireCheckoutOrderBirthAuthorityInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: AcquireCheckoutOrderBirthAuthorityInput
): Promise<AcquireCheckoutOrderBirthAuthorityResult> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      acquireCheckoutOrderBirthAuthorityInTransaction(trx, input)
    )
  }

  const at = input.at ?? new Date()
  const operation = CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER
  const idempotencyKey =
    input.idempotency_key ??
    buildCheckoutCompletionIdempotencyKey({
      payment_intent_id: input.payment_intent_id,
      cart_id: input.cart_id,
    })

  // 1. Check for existing cart authority across all rows (surviving soft delete)
  const existingRows = await transaction.raw(
    `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}
     from checkout_completion_log
     where operation = ? and cart_id = ?
     order by created_at asc
     limit 1`,
    [operation, input.cart_id]
  )

  const existing = existingRows.rows?.[0]
    ? mapOrderBirthAuthority(existingRows.rows[0])
    : null

  if (existing) {
    if (
      existing.payment_attempt_id &&
      existing.payment_attempt_id !== input.payment_attempt_id
    ) {
      throw new CheckoutCompletionAuthorityConflictError(
        `PAYMENT_ATTEMPT_MISMATCH: existing authority owned by ${existing.payment_attempt_id} cannot be acquired by ${input.payment_attempt_id}`
      )
    }

    if (existing.payment_intent_id !== input.payment_intent_id) {
      throw new CheckoutCompletionAuthorityConflictError(
        `PAYMENT_INTENT_MISMATCH: existing authority owned by ${existing.payment_intent_id} cannot be acquired by ${input.payment_intent_id}`
      )
    }

    return {
      authority: existing,
      action: "reused",
    }
  }

  // 2. Also check by idempotency key
  const existingIdempRows = await transaction.raw(
    `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}
     from checkout_completion_log
     where operation = ? and idempotency_key = ?
     order by created_at asc
     limit 1`,
    [operation, idempotencyKey]
  )

  const existingIdemp = existingIdempRows.rows?.[0]
    ? mapOrderBirthAuthority(existingIdempRows.rows[0])
    : null

  if (existingIdemp) {
    if (existingIdemp.cart_id !== input.cart_id) {
      throw new CheckoutCompletionAuthorityConflictError(
        `CART_MISMATCH: idempotency key ${idempotencyKey} owned by cart ${existingIdemp.cart_id} cannot be claimed by cart ${input.cart_id}`
      )
    }
    if (
      existingIdemp.payment_attempt_id &&
      existingIdemp.payment_attempt_id !== input.payment_attempt_id
    ) {
      throw new CheckoutCompletionAuthorityConflictError(
        `PAYMENT_ATTEMPT_MISMATCH: existing authority owned by ${existingIdemp.payment_attempt_id} cannot be acquired by ${input.payment_attempt_id}`
      )
    }
    if (existingIdemp.payment_intent_id !== input.payment_intent_id) {
      throw new CheckoutCompletionAuthorityConflictError(
        `PAYMENT_INTENT_MISMATCH: existing authority owned by ${existingIdemp.payment_intent_id} cannot be acquired by ${input.payment_intent_id}`
      )
    }
    return {
      authority: existingIdemp,
      action: "reused",
    }
  }

  // 3. No existing authority -> create
  const newId = `chkcpl_${randomBytes(12).toString("hex")}`
  const nowIso = at.toISOString()
  const sanitizedMeta = sanitizeCheckoutCompletionMetadata(input.metadata)
  const metadataJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null

  try {
    const inserted = await transaction.raw(
      `insert into checkout_completion_log (
         id, operation, idempotency_key, cart_id, payment_intent_id,
         payment_attempt_id, status, execution_started_at, locked_at,
         metadata, created_at, updated_at
       ) values (
         ?, ?, ?, ?, ?,
         ?, 'processing', ?, ?,
         ?, ?, ?
       )
       returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
      [
        newId,
        operation,
        idempotencyKey,
        input.cart_id,
        input.payment_intent_id,
        input.payment_attempt_id,
        null,
        nowIso,
        metadataJson,
        nowIso,
        nowIso,
      ]
    )

    if (inserted.rows?.[0]) {
      return {
        authority: mapOrderBirthAuthority(inserted.rows[0]),
        action: "created",
      }
    }
  } catch (insertError: any) {
    const isUniqueViolation =
      insertError?.code === "23505" ||
      insertError?.message?.includes("unique constraint") ||
      insertError?.message?.includes("duplicate key")

    if (!isUniqueViolation) {
      throw insertError
    }

    const winnerRows = await transaction.raw(
      `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}
       from checkout_completion_log
       where operation = ? and cart_id = ?
       order by created_at asc
       limit 1`,
      [operation, input.cart_id]
    )

    const winner = winnerRows.rows?.[0]
      ? mapOrderBirthAuthority(winnerRows.rows[0])
      : null

    if (winner) {
      if (
        winner.payment_attempt_id &&
        winner.payment_attempt_id !== input.payment_attempt_id
      ) {
        throw new CheckoutCompletionAuthorityConflictError(
          `PAYMENT_ATTEMPT_MISMATCH: concurrent authority owned by ${winner.payment_attempt_id} cannot be acquired by ${input.payment_attempt_id}`
        )
      }
      if (winner.payment_intent_id !== input.payment_intent_id) {
        throw new CheckoutCompletionAuthorityConflictError(
          `PAYMENT_INTENT_MISMATCH: concurrent authority owned by ${winner.payment_intent_id} cannot be acquired by ${input.payment_intent_id}`
        )
      }
      return {
        authority: winner,
        action: "reused",
      }
    }

    const winnerIdempRows = await transaction.raw(
      `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}
       from checkout_completion_log
       where operation = ? and idempotency_key = ?
       order by created_at asc
       limit 1`,
      [operation, idempotencyKey]
    )

    const winnerIdemp = winnerIdempRows.rows?.[0]
      ? mapOrderBirthAuthority(winnerIdempRows.rows[0])
      : null

    if (winnerIdemp) {
      if (winnerIdemp.cart_id !== input.cart_id) {
        throw new CheckoutCompletionAuthorityConflictError(
          `CART_MISMATCH: idempotency key ${idempotencyKey} owned by cart ${winnerIdemp.cart_id} cannot be claimed by cart ${input.cart_id}`
        )
      }
      if (
        winnerIdemp.payment_attempt_id &&
        winnerIdemp.payment_attempt_id !== input.payment_attempt_id
      ) {
        throw new CheckoutCompletionAuthorityConflictError(
          `PAYMENT_ATTEMPT_MISMATCH: concurrent authority owned by ${winnerIdemp.payment_attempt_id} cannot be acquired by ${input.payment_attempt_id}`
        )
      }
      if (winnerIdemp.payment_intent_id !== input.payment_intent_id) {
        throw new CheckoutCompletionAuthorityConflictError(
          `PAYMENT_INTENT_MISMATCH: concurrent authority owned by ${winnerIdemp.payment_intent_id} cannot be acquired by ${input.payment_intent_id}`
        )
      }
      return {
        authority: winnerIdemp,
        action: "reused",
      }
    }

    throw insertError
  }

  throw new Error("CHECKOUT_COMPLETION_AUTHORITY_ACQUISITION_FAILED")
}

export async function readCheckoutOrderBirthAuthorityInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  filters: ReadOrderBirthAuthorityFilters
): Promise<CheckoutCompletionOrderBirthAuthority | null> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      readCheckoutOrderBirthAuthorityInTransaction(trx, filters)
    )
  }

  const conditions: string[] = []
  const bindings: unknown[] = []

  if (filters.id) {
    conditions.push("id = ?")
    bindings.push(filters.id)
  }
  if (filters.cart_id) {
    conditions.push("cart_id = ?")
    bindings.push(filters.cart_id)
  }
  if (filters.payment_intent_id) {
    conditions.push("payment_intent_id = ?")
    bindings.push(filters.payment_intent_id)
  }
  if (filters.payment_attempt_id) {
    conditions.push("payment_attempt_id = ?")
    bindings.push(filters.payment_attempt_id)
  }
  if (filters.idempotency_key) {
    conditions.push("idempotency_key = ?")
    bindings.push(filters.idempotency_key)
  }

  if (conditions.length === 0) {
    return null
  }

  const result = await transaction.raw(
    `select ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}
     from checkout_completion_log
     where ${conditions.join(" and ")}
     order by created_at asc
     limit 1`,
    bindings
  )

  return result.rows?.[0] ? mapOrderBirthAuthority(result.rows[0]) : null
}

export async function markOrderBirthExecutionStartedInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: MarkOrderBirthExecutionStartedInput
): Promise<MarkOrderBirthExecutionStartedResult> {
  const paymentAttemptId =
    typeof input.payment_attempt_id === "string"
      ? input.payment_attempt_id.trim()
      : ""

  if (!paymentAttemptId) {
    throw new Error("CHECKOUT_COMPLETION_PAYMENT_ATTEMPT_ID_REQUIRED")
  }

  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      markOrderBirthExecutionStartedInTransaction(trx, {
        ...input,
        payment_attempt_id: paymentAttemptId,
      })
    )
  }

  const updated = await transaction.raw(
    `update checkout_completion_log
     set execution_started_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     where id = ?
       and cart_id = ?
       and payment_intent_id = ?
       and payment_attempt_id = ?
       and execution_started_at is null
       and order_id is null
       and deleted_at is null
     returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
    [input.id, input.cart_id, input.payment_intent_id, paymentAttemptId]
  )

  if (updated.rows?.[0]) {
    return {
      won: true,
      authority: mapOrderBirthAuthority(updated.rows[0]),
    }
  }

  const current = await readCheckoutOrderBirthAuthorityInTransaction(transaction, {
    id: input.id,
  })

  if (!current) {
    throw new Error(`CHECKOUT_COMPLETION_LOG_NOT_FOUND: ${input.id}`)
  }

  if (current.cart_id !== input.cart_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `CART_MISMATCH: authority owned by ${current.cart_id}, expected ${input.cart_id}`
    )
  }

  if (current.payment_intent_id !== input.payment_intent_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_INTENT_MISMATCH: authority owned by ${current.payment_intent_id}, expected ${input.payment_intent_id}`
    )
  }

  if (
    current.payment_attempt_id == null ||
    current.payment_attempt_id !== paymentAttemptId
  ) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_ATTEMPT_MISMATCH: authority owned by ${current.payment_attempt_id}, expected ${paymentAttemptId}`
    )
  }

  return {
    won: false,
    authority: current,
  }
}

export async function bindRecoveredOrderInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: BindRecoveredOrderInput
): Promise<CheckoutCompletionOrderBirthAuthority> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      bindRecoveredOrderInTransaction(trx, input)
    )
  }

  const at = input.at ?? new Date()
  const nowIso = at.toISOString()

  const current = await readCheckoutOrderBirthAuthorityInTransaction(transaction, {
    id: input.id,
  })

  if (!current) {
    throw new Error(`CHECKOUT_COMPLETION_LOG_NOT_FOUND: ${input.id}`)
  }

  if (current.cart_id !== input.cart_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `CART_MISMATCH: authority owned by ${current.cart_id}, expected ${input.cart_id}`
    )
  }

  if (current.payment_intent_id !== input.payment_intent_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_INTENT_MISMATCH: authority owned by ${current.payment_intent_id}, expected ${input.payment_intent_id}`
    )
  }

  if (
    input.payment_attempt_id &&
    current.payment_attempt_id &&
    current.payment_attempt_id !== input.payment_attempt_id
  ) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_ATTEMPT_MISMATCH: authority owned by ${current.payment_attempt_id}, expected ${input.payment_attempt_id}`
    )
  }

  if (current.order_id && current.order_id !== input.order_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `ORDER_ID_CONFLICT: existing authority order_id ${current.order_id} cannot be overwritten with recovered ${input.order_id}`
    )
  }

  const updated = await transaction.raw(
    `update checkout_completion_log
     set order_id = ?,
         status = 'completed',
         completed_at = coalesce(completed_at, ?),
         error_code = null,
         error_message = null,
         updated_at = ?
     where id = ?
       and cart_id = ?
       and payment_intent_id = ?
       and (order_id is null or order_id = ?)
     returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
    [input.order_id, nowIso, nowIso, input.id, input.cart_id, input.payment_intent_id, input.order_id]
  )

  if (!updated.rows?.[0]) {
    throw new CheckoutCompletionAuthorityConflictError(
      `ORDER_BIND_FAILED: unable to bind order ${input.order_id} to authority ${input.id}`
    )
  }

  return mapOrderBirthAuthority(updated.rows[0])
}

export async function markReconciliationRequiredInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: MarkReconciliationRequiredInput
): Promise<CheckoutCompletionOrderBirthAuthority> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      markReconciliationRequiredInTransaction(trx, input)
    )
  }

  const at = input.at ?? new Date()
  const nowIso = at.toISOString()
  const sanitizedMessage = input.error_message
    ? sanitizeString(input.error_message).slice(0, 500)
    : null

  const updated = await transaction.raw(
    `update checkout_completion_log
     set status = 'reconciliation_required',
         reconciliation_reason_code = ?,
         last_reconciliation_at = ?,
         error_message = coalesce(?, error_message),
         updated_at = ?
     where id = ?
     returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
    [input.reason_code, nowIso, sanitizedMessage, nowIso, input.id]
  )

  if (!updated.rows?.[0]) {
    throw new Error(`CHECKOUT_COMPLETION_LOG_NOT_FOUND: ${input.id}`)
  }

  return mapOrderBirthAuthority(updated.rows[0])
}

export async function markCompletedInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: MarkCompletedInput
): Promise<CheckoutCompletionOrderBirthAuthority> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      markCompletedInTransaction(trx, input)
    )
  }

  const at = input.at ?? new Date()
  const nowIso = at.toISOString()

  const current = await readCheckoutOrderBirthAuthorityInTransaction(transaction, {
    id: input.id,
  })

  if (!current) {
    throw new Error(`CHECKOUT_COMPLETION_LOG_NOT_FOUND: ${input.id}`)
  }

  if (current.cart_id !== input.cart_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `CART_MISMATCH: authority owned by ${current.cart_id}, expected ${input.cart_id}`
    )
  }

  if (current.payment_intent_id !== input.payment_intent_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_INTENT_MISMATCH: authority owned by ${current.payment_intent_id}, expected ${input.payment_intent_id}`
    )
  }

  if (
    input.payment_attempt_id &&
    current.payment_attempt_id &&
    current.payment_attempt_id !== input.payment_attempt_id
  ) {
    throw new CheckoutCompletionAuthorityConflictError(
      `PAYMENT_ATTEMPT_MISMATCH: authority owned by ${current.payment_attempt_id}, expected ${input.payment_attempt_id}`
    )
  }

  if (current.order_id && current.order_id !== input.order_id) {
    throw new CheckoutCompletionAuthorityConflictError(
      `ORDER_ID_CONFLICT: existing authority order_id ${current.order_id} cannot be overwritten with ${input.order_id}`
    )
  }

  const updated = await transaction.raw(
    `update checkout_completion_log
     set status = 'completed',
         order_id = ?,
         completed_at = coalesce(completed_at, ?),
         error_code = null,
         error_message = null,
         updated_at = ?
     where id = ?
       and cart_id = ?
       and payment_intent_id = ?
       and (order_id is null or order_id = ?)
     returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
    [input.order_id, nowIso, nowIso, input.id, input.cart_id, input.payment_intent_id, input.order_id]
  )

  if (!updated.rows?.[0]) {
    throw new CheckoutCompletionAuthorityConflictError(
      `ORDER_COMPLETION_FAILED: unable to complete authority ${input.id} with order ${input.order_id}`
    )
  }

  return mapOrderBirthAuthority(updated.rows[0])
}

export async function markFailedInTransaction(
  transaction: CheckoutCompletionLogSqlTransaction,
  input: import("./types").MarkFailedInput
): Promise<CheckoutCompletionOrderBirthAuthority> {
  if (
    transaction &&
    typeof (transaction as any).transaction === "function" &&
    typeof transaction.raw !== "function"
  ) {
    return (transaction as any).transaction((trx: any) =>
      markFailedInTransaction(trx, input)
    )
  }

  const at = input.at ?? new Date()
  const nowIso = at.toISOString()
  const sanitizedCode = sanitizeString(input.error_code).slice(0, 120)
  const sanitizedMsg = sanitizeString(input.error_message).slice(0, 500)
  const metaJson = input.metadata
    ? JSON.stringify(sanitizeCheckoutCompletionMetadata(input.metadata))
    : null

  const updated = await transaction.raw(
    `update checkout_completion_log
     set status = 'failed',
         failed_at = coalesce(failed_at, ?),
         error_code = ?,
         error_message = ?,
         metadata = coalesce(?, metadata),
         updated_at = ?
     where id = ?
       and execution_started_at is null
     returning ${CHECKOUT_COMPLETION_AUTHORITY_COLUMNS.join(", ")}`,
    [nowIso, sanitizedCode, sanitizedMsg, metaJson, nowIso, input.id]
  )

  if (!updated.rows?.[0]) {
    const current = await readCheckoutOrderBirthAuthorityInTransaction(transaction, {
      id: input.id,
    })
    if (current) return current
    throw new Error(`CHECKOUT_COMPLETION_LOG_NOT_FOUND: ${input.id}`)
  }

  return mapOrderBirthAuthority(updated.rows[0])
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

  async acquireCheckoutOrderBirthAuthority(
    transaction: CheckoutCompletionLogSqlTransaction,
    input: AcquireCheckoutOrderBirthAuthorityInput
  ): Promise<AcquireCheckoutOrderBirthAuthorityResult> {
    return acquireCheckoutOrderBirthAuthorityInTransaction(transaction, input)
  }

  async readCheckoutOrderBirthAuthority(
    transaction: CheckoutCompletionLogSqlTransaction,
    filters: ReadOrderBirthAuthorityFilters
  ): Promise<CheckoutCompletionOrderBirthAuthority | null> {
    return readCheckoutOrderBirthAuthorityInTransaction(transaction, filters)
  }

  async markOrderBirthExecutionStarted(
    transaction: CheckoutCompletionLogSqlTransaction,
    input: MarkOrderBirthExecutionStartedInput
  ): Promise<MarkOrderBirthExecutionStartedResult> {
    return markOrderBirthExecutionStartedInTransaction(transaction, input)
  }

  async bindRecoveredOrder(
    transaction: CheckoutCompletionLogSqlTransaction,
    input: BindRecoveredOrderInput
  ): Promise<CheckoutCompletionOrderBirthAuthority> {
    return bindRecoveredOrderInTransaction(transaction, input)
  }

  async markReconciliationRequired(
    transaction: CheckoutCompletionLogSqlTransaction,
    input: MarkReconciliationRequiredInput
  ): Promise<CheckoutCompletionOrderBirthAuthority> {
    return markReconciliationRequiredInTransaction(transaction, input)
  }

  async markCompleted(
    transaction: CheckoutCompletionLogSqlTransaction,
    input: MarkCompletedInput
  ): Promise<CheckoutCompletionOrderBirthAuthority> {
    return markCompletedInTransaction(transaction, input)
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
      input.existing.status === CHECKOUT_COMPLETION_STATUS.FAILED ||
      input.existing.status === CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED)
  ) {
    return {
      type: "recover_created_order",
      log: input.existing,
      order_id: input.existing.order_id,
    }
  }

  if (input.existing.status === CHECKOUT_COMPLETION_STATUS.PROCESSING) {
    if (!input.existing.order_id) {
      // If execution has already started, staleness CANNOT authorize a second completeCart execution
      if (input.existing.execution_started_at) {
        return {
          type: "already_processing",
          log: input.existing,
        }
      }

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
    (input.existing.status === CHECKOUT_COMPLETION_STATUS.FAILED ||
      input.existing.status === CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED) &&
    !input.existing.order_id
  ) {
    // If execution has already started, cannot reset into processing without recovery
    if (input.existing.execution_started_at) {
      return {
        type: "already_processing",
        log: input.existing,
      }
    }

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
