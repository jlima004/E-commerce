import {
  MedusaError,
  MedusaService,
  generateEntityId,
} from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import AdminActionLog, {
  ADMIN_ACTIONS,
  ADMIN_ACTION_AUDIT_STAGES,
  ADMIN_ACTION_ENTITY_TYPES,
  ADMIN_ACTION_RESULTS,
  ADMIN_ACTION_SEVERITIES,
  type AdminAction,
  type AdminActionAuditStage,
  type AdminActionEntityType,
  type AdminActionResult,
  type AdminActionSeverity,
} from "./models/admin-action-log"

export const ADMIN_ACTION_STATE_KEYS = [
  "status",
  "amount",
  "currency_code",
  "reverse_logistics_provider",
  "reverse_tracking_code",
  "reverse_authorization_code",
  "reverse_label_reference",
] as const

export const ADMIN_ACTION_METADATA_KEYS = [
  "order_id",
  "request_id",
  "correlation_id",
  "action_attempt_id",
  "audit_stage",
  "idempotency_key",
  "actor_type",
  "reused_idempotency",
  "error_code",
] as const

type StateKey = (typeof ADMIN_ACTION_STATE_KEYS)[number]
type MetadataKey = (typeof ADMIN_ACTION_METADATA_KEYS)[number]
type JsonPrimitive = string | number | boolean | null

export type AdminActionState = Partial<Record<StateKey, JsonPrimitive>>
export type AdminActionMetadata = Partial<
  Record<MetadataKey, JsonPrimitive>
>

export type AdminActionFact = {
  id: string
  action_attempt_id: string
  correlation_id: string
  audit_stage: AdminActionAuditStage
  admin_id: string
  admin_email: string | null
  action: AdminAction
  entity_type: AdminActionEntityType
  entity_id: string
  result: AdminActionResult
  severity: AdminActionSeverity
  reason: string | null
  previous_state: AdminActionState | null
  new_state: AdminActionState | null
  metadata: AdminActionMetadata | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

type CommonAuditInput = {
  action_attempt_id: string
  correlation_id: string
  admin_id: string
  admin_email?: string | null
  action: AdminAction
  entity_type: AdminActionEntityType
  entity_id: string
  severity?: AdminActionSeverity
  reason?: string | null
  previous_state?: AdminActionState | Record<string, unknown> | null
  new_state?: AdminActionState | Record<string, unknown> | null
  metadata?: AdminActionMetadata | Record<string, unknown> | null
  idempotency_key?: string | null
}

export type AppendIntentInput = CommonAuditInput & {
  result?: "requested"
}

export type AppendOutcomeInput = CommonAuditInput & {
  result: AdminActionResult
}

export type AppendReconciliationInput = CommonAuditInput & {
  result: AdminActionResult
}

export type ListOrphanIntentsInput = {
  created_before: Date
  after?: { created_at: Date; id: string }
  limit: number
}

type QueryResult = { rows?: Record<string, unknown>[] }
type KnexLike = {
  raw: (sql: string, bindings?: unknown[]) => Promise<QueryResult>
}
type BaseRepositoryLike = {
  getActiveManager: () => { getKnex: () => KnexLike }
}

const STATE_KEYS = new Set<string>(ADMIN_ACTION_STATE_KEYS)
const METADATA_KEYS = new Set<string>(ADMIN_ACTION_METADATA_KEYS)
const INTERNAL_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/

function assertEnum(
  value: unknown,
  allowed: readonly string[],
  code: string
): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }
}

function requireAttemptId(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim().length > 128 ||
    !INTERNAL_ID_PATTERN.test(value.trim())
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }
  return value.trim()
}

function requireInternalId(value: unknown, code: string): string {
  return requireAttemptId(value, code)
}

function sanitizeOptionalEmail(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  if (typeof value !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_ACTION_LOG_ADMIN_EMAIL_INVALID"
    )
  }
  const trimmed = value.trim()
  if (trimmed === "") {
    return null
  }
  if (trimmed.length > 254 || !trimmed.includes("@")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_ACTION_LOG_ADMIN_EMAIL_INVALID"
    )
  }
  const local = trimmed.slice(0, trimmed.indexOf("@"))
  const domain = trimmed.slice(trimmed.indexOf("@") + 1)
  if (!local || !domain) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_ACTION_LOG_ADMIN_EMAIL_INVALID"
    )
  }
  return `${local[0]}***@${domain}`
}

function sanitizeReason(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  if (typeof value !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_ACTION_LOG_REASON_INVALID"
    )
  }
  return sanitizeString(value.trim())
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[REDACTED]")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[REDACTED]")
    .slice(0, 500)
}

function sanitizeOptionalIdempotencyKey(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  if (typeof value !== "string" || value.trim().length > 255) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_ACTION_LOG_IDEMPOTENCY_KEY_INVALID"
    )
  }
  return sanitizeString(value.trim()).slice(0, 255)
}

function sanitizeJsonObject(
  value: Record<string, unknown> | null | undefined,
  allowedKeys: Set<string>,
  code: string
): Record<string, JsonPrimitive> | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }

  const safe: Record<string, JsonPrimitive> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      continue
    }
    if (raw === null) {
      safe[key] = null
      continue
    }
    if (typeof raw === "boolean") {
      safe[key] = raw
      continue
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw
      continue
    }
    if (typeof raw === "string") {
      if (raw.length > 255) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
      }
      safe[key] = sanitizeString(raw).slice(0, 255)
      continue
    }
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }

  return Object.keys(safe).length > 0 ? safe : null
}

export function sanitizeAdminActionState(
  state: Record<string, unknown> | null | undefined
): AdminActionState | null {
  return sanitizeJsonObject(
    state,
    STATE_KEYS,
    "ADMIN_ACTION_LOG_STATE_INVALID"
  ) as AdminActionState | null
}

export function sanitizeAdminActionMetadata(
  metadata: Record<string, unknown> | null | undefined
): AdminActionMetadata | null {
  return sanitizeJsonObject(
    metadata,
    METADATA_KEYS,
    "ADMIN_ACTION_LOG_METADATA_INVALID"
  ) as AdminActionMetadata | null
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  return date.toISOString()
}

function toFact(row: Record<string, unknown>): AdminActionFact {
  return {
    id: String(row.id),
    action_attempt_id: String(row.action_attempt_id),
    correlation_id: String(row.correlation_id),
    audit_stage: row.audit_stage as AdminActionAuditStage,
    admin_id: String(row.admin_id),
    admin_email: row.admin_email === null ? null : String(row.admin_email),
    action: row.action as AdminAction,
    entity_type: row.entity_type as AdminActionEntityType,
    entity_id: String(row.entity_id),
    result: row.result as AdminActionResult,
    severity: row.severity as AdminActionSeverity,
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    previous_state: sanitizeAdminActionState(
      row.previous_state as Record<string, unknown> | null
    ),
    new_state: sanitizeAdminActionState(
      row.new_state as Record<string, unknown> | null
    ),
    metadata: sanitizeAdminActionMetadata(
      row.metadata as Record<string, unknown> | null
    ),
    idempotency_key:
      row.idempotency_key === null || row.idempotency_key === undefined
        ? null
        : String(row.idempotency_key),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as Error & { code?: unknown }).code
  return (
    code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message)
  )
}

function sanitizePersistenceError(error: unknown): never {
  if (error instanceof MedusaError) {
    throw error
  }
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "ADMIN_ACTION_LOG_PERSISTENCE_FAILED"
  )
}

const BaseAdminActionLogService = MedusaService({ AdminActionLog })

export class AdminActionLogModuleService extends BaseAdminActionLogService {
  protected declare readonly baseRepository_: BaseRepositoryLike

  private knex(): KnexLike {
    return this.baseRepository_.getActiveManager().getKnex()
  }

  private async retrieveIntent(
    actionAttemptId: string
  ): Promise<AdminActionFact | null> {
    const safeId = requireAttemptId(
      actionAttemptId,
      "ADMIN_ACTION_LOG_ACTION_ATTEMPT_ID_INVALID"
    )
    const result = await this.knex().raw(
      `
        select * from admin_action_log
        where action_attempt_id = ?
          and audit_stage = 'intent'
        limit 1
      `,
      [safeId]
    )
    return result.rows?.[0] ? toFact(result.rows[0]) : null
  }

  async retrieveTerminalFact(
    actionAttemptId: string
  ): Promise<AdminActionFact | null> {
    const safeId = requireAttemptId(
      actionAttemptId,
      "ADMIN_ACTION_LOG_ACTION_ATTEMPT_ID_INVALID"
    )
    const result = await this.knex().raw(
      `
        select * from admin_action_log
        where action_attempt_id = ?
          and audit_stage in ('outcome', 'reconciliation')
        limit 1
      `,
      [safeId]
    )
    return result.rows?.[0] ? toFact(result.rows[0]) : null
  }

  private normalizeCommon(input: CommonAuditInput) {
    assertEnum(input.action, ADMIN_ACTIONS, "ADMIN_ACTION_LOG_ACTION_INVALID")
    assertEnum(
      input.entity_type,
      ADMIN_ACTION_ENTITY_TYPES,
      "ADMIN_ACTION_LOG_ENTITY_TYPE_INVALID"
    )
    const severity = input.severity ?? "info"
    assertEnum(
      severity,
      ADMIN_ACTION_SEVERITIES,
      "ADMIN_ACTION_LOG_SEVERITY_INVALID"
    )

    return {
      action_attempt_id: requireAttemptId(
        input.action_attempt_id,
        "ADMIN_ACTION_LOG_ACTION_ATTEMPT_ID_INVALID"
      ),
      correlation_id: requireAttemptId(
        input.correlation_id,
        "ADMIN_ACTION_LOG_CORRELATION_ID_INVALID"
      ),
      admin_id: requireInternalId(
        input.admin_id,
        "ADMIN_ACTION_LOG_ADMIN_ID_INVALID"
      ),
      admin_email: sanitizeOptionalEmail(input.admin_email),
      action: input.action,
      entity_type: input.entity_type,
      entity_id: requireInternalId(
        input.entity_id,
        "ADMIN_ACTION_LOG_ENTITY_ID_INVALID"
      ),
      severity: severity as AdminActionSeverity,
      reason: sanitizeReason(input.reason),
      previous_state: sanitizeAdminActionState(input.previous_state),
      new_state: sanitizeAdminActionState(input.new_state),
      metadata: sanitizeAdminActionMetadata(input.metadata),
      idempotency_key: sanitizeOptionalIdempotencyKey(input.idempotency_key),
    }
  }

  private async insertFact(input: {
    audit_stage: AdminActionAuditStage
    result: AdminActionResult
    common: ReturnType<AdminActionLogModuleService["normalizeCommon"]>
  }): Promise<AdminActionFact> {
    assertEnum(
      input.audit_stage,
      ADMIN_ACTION_AUDIT_STAGES,
      "ADMIN_ACTION_LOG_AUDIT_STAGE_INVALID"
    )
    assertEnum(
      input.result,
      ADMIN_ACTION_RESULTS,
      "ADMIN_ACTION_LOG_RESULT_INVALID"
    )
    if (input.audit_stage === "intent" && input.result !== "requested") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_INTENT_RESULT_INVALID"
      )
    }

    const now = new Date().toISOString()
    const id = generateEntityId(undefined, "admact")

    try {
      const result = await this.knex().raw(
        `
          insert into admin_action_log (
            id, action_attempt_id, correlation_id, audit_stage,
            admin_id, admin_email, action, entity_type, entity_id,
            result, severity, reason, previous_state, new_state,
            metadata, idempotency_key, created_at, updated_at, deleted_at
          ) values (
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, cast(? as jsonb), cast(? as jsonb),
            cast(? as jsonb), ?, ?, ?, null
          )
          returning *
        `,
        [
          id,
          input.common.action_attempt_id,
          input.common.correlation_id,
          input.audit_stage,
          input.common.admin_id,
          input.common.admin_email,
          input.common.action,
          input.common.entity_type,
          input.common.entity_id,
          input.result,
          input.common.severity,
          input.common.reason,
          input.common.previous_state
            ? JSON.stringify(input.common.previous_state)
            : null,
          input.common.new_state
            ? JSON.stringify(input.common.new_state)
            : null,
          input.common.metadata
            ? JSON.stringify(input.common.metadata)
            : null,
          input.common.idempotency_key,
          now,
          now,
        ]
      )
      const row = result.rows?.[0]
      if (!row) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "ADMIN_ACTION_LOG_PERSISTENCE_FAILED"
        )
      }
      return toFact(row)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (input.audit_stage === "intent") {
          const existing = await this.retrieveIntent(
            input.common.action_attempt_id
          )
          if (existing) {
            return existing
          }
        } else {
          const existing = await this.retrieveTerminalFact(
            input.common.action_attempt_id
          )
          if (existing) {
            return existing
          }
        }
      }
      sanitizePersistenceError(error)
    }
  }

  async appendIntent(input: AppendIntentInput): Promise<AdminActionFact> {
    if (
      "audit_stage" in input &&
      (input as { audit_stage?: string }).audit_stage !== undefined &&
      (input as { audit_stage?: string }).audit_stage !== "intent"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_AUDIT_STAGE_INVALID"
      )
    }
    if (input.result !== undefined && input.result !== "requested") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_INTENT_RESULT_INVALID"
      )
    }

    const common = this.normalizeCommon(input)
    return this.insertFact({
      audit_stage: "intent",
      result: "requested",
      common,
    })
  }

  async appendOutcome(input: AppendOutcomeInput): Promise<AdminActionFact> {
    if (
      "audit_stage" in input &&
      (input as { audit_stage?: string }).audit_stage !== undefined &&
      (input as { audit_stage?: string }).audit_stage !== "outcome"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_AUDIT_STAGE_INVALID"
      )
    }

    const common = this.normalizeCommon(input)
    return this.insertFact({
      audit_stage: "outcome",
      result: input.result,
      common,
    })
  }

  async appendReconciliation(
    input: AppendReconciliationInput
  ): Promise<AdminActionFact> {
    if (
      "audit_stage" in input &&
      (input as { audit_stage?: string }).audit_stage !== undefined &&
      (input as { audit_stage?: string }).audit_stage !== "reconciliation"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_AUDIT_STAGE_INVALID"
      )
    }

    const intent = await this.retrieveIntent(input.action_attempt_id)
    if (!intent) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "ADMIN_ACTION_LOG_INTENT_NOT_FOUND"
      )
    }

    if (
      (input.admin_id && input.admin_id.trim() !== intent.admin_id) ||
      (input.action && input.action !== intent.action) ||
      (input.entity_type && input.entity_type !== intent.entity_type) ||
      (input.entity_id && input.entity_id.trim() !== intent.entity_id) ||
      (input.correlation_id &&
        input.correlation_id.trim() !== intent.correlation_id)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_RECONCILIATION_IDENTITY_MISMATCH"
      )
    }

    const common = this.normalizeCommon({
      ...input,
      action_attempt_id: intent.action_attempt_id,
      correlation_id: intent.correlation_id,
      admin_id: intent.admin_id,
      admin_email: intent.admin_email,
      action: intent.action,
      entity_type: intent.entity_type,
      entity_id: intent.entity_id,
      idempotency_key: input.idempotency_key ?? intent.idempotency_key,
    })

    return this.insertFact({
      audit_stage: "reconciliation",
      result: input.result,
      common,
    })
  }

  async listOrphanIntents(
    input: ListOrphanIntentsInput
  ): Promise<AdminActionFact[]> {
    if (
      !(input.created_before instanceof Date) ||
      !Number.isFinite(input.created_before.getTime())
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_ORPHAN_CUTOFF_INVALID"
      )
    }
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ADMIN_ACTION_LOG_ORPHAN_LIMIT_INVALID"
      )
    }

    const bindings: unknown[] = [input.created_before.toISOString()]
    let cursorClause = ""
    if (input.after) {
      if (
        !(input.after.created_at instanceof Date) ||
        !Number.isFinite(input.after.created_at.getTime())
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "ADMIN_ACTION_LOG_ORPHAN_CURSOR_INVALID"
        )
      }
      const afterId = requireInternalId(
        input.after.id,
        "ADMIN_ACTION_LOG_ORPHAN_CURSOR_INVALID"
      )
      cursorClause = `
        and (created_at, id) > (?::timestamptz, ?)
      `
      bindings.push(input.after.created_at.toISOString(), afterId)
    }
    bindings.push(input.limit)

    const result = await this.knex().raw(
      `
        select *
        from admin_action_log
        where audit_stage = 'intent'
          and created_at < ?::timestamptz
          and not exists (
            select 1
            from admin_action_log terminal
            where terminal.action_attempt_id = admin_action_log.action_attempt_id
              and terminal.audit_stage in ('outcome', 'reconciliation')
          )
          ${cursorClause}
        order by created_at asc, id asc
        limit ?
      `,
      bindings
    )

    return (result.rows ?? []).map(toFact)
  }
}

export default AdminActionLogModuleService
