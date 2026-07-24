import {
  MedusaError,
  MedusaService,
  generateEntityId,
} from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import OperationalAlert, {
  OPERATIONAL_ALERT_ENTITY_TYPES,
  OPERATIONAL_ALERT_SEVERITIES,
  OPERATIONAL_ALERT_STATUSES,
  OPERATIONAL_ALERT_TYPES,
  type OperationalAlertEntityType,
  type OperationalAlertSeverity,
  type OperationalAlertStatus,
  type OperationalAlertType,
} from "./models/operational-alert"

export const OPERATIONAL_ALERT_METADATA_KEYS = [
  "payment_attempt_id",
  "payment_intent_id",
  "checkout_completion_log_id",
  "webhook_event_log_id",
  "fulfillment_id",
  "order_id",
  "detector_code",
  "source_status",
  "operator_alert_code",
] as const

type MetadataKey = (typeof OPERATIONAL_ALERT_METADATA_KEYS)[number]
type MetadataValue = string | number | boolean

export type OperationalAlertMetadata = Partial<
  Record<MetadataKey, MetadataValue>
>

export type UpsertAlertInput = {
  type: OperationalAlertType
  severity: OperationalAlertSeverity
  entity_type: OperationalAlertEntityType
  entity_id: string
  message_code: string
  message: string
  error_code?: string | null
  metadata?: OperationalAlertMetadata | Record<string, unknown> | null
  observed_at: Date
}

export type ListSafeInput = {
  type?: OperationalAlertType
  status?: OperationalAlertStatus
  severity?: OperationalAlertSeverity
  entity_type?: OperationalAlertEntityType
  entity_id?: string
  last_seen_at_from?: Date
  last_seen_at_to?: Date
  limit: number
  offset: number
}

export type OperationalAlertSafe = {
  id: string
  type: OperationalAlertType
  severity: OperationalAlertSeverity
  status: OperationalAlertStatus
  entity_type: OperationalAlertEntityType
  entity_id: string
  message_code: string
  message: string
  error_code: string | null
  metadata: OperationalAlertMetadata | null
  first_seen_at: string
  last_seen_at: string
  occurrence_count: number
  acknowledged_at: string | null
  acknowledged_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  ignored_at: string | null
  ignored_by: string | null
  created_at: string
  updated_at: string
}

type QueryResult = { rows?: Record<string, unknown>[] }
type KnexLike = {
  raw: (sql: string, bindings?: unknown[]) => Promise<QueryResult>
}
type BaseRepositoryLike = {
  getActiveManager: () => { getKnex: () => KnexLike }
}

const METADATA_KEYS = new Set<string>(OPERATIONAL_ALERT_METADATA_KEYS)
const MESSAGE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/
const INTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function assertEnum(
  value: unknown,
  allowed: readonly string[],
  code: string
): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }
}

function sanitizeAlertText(value: unknown, maxLength: number, code: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }

  return sanitizeString(value.trim())
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[REDACTED]")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[REDACTED]")
    .slice(0, maxLength)
}

function requireInternalId(value: unknown, code: string): string {
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

function requireTimestamp(value: unknown, code: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, code)
  }
  return value
}

export function sanitizeOperationalAlertMetadata(
  metadata: Record<string, unknown> | null | undefined
): OperationalAlertMetadata | null {
  if (!metadata) {
    return null
  }
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "OPERATIONAL_ALERT_METADATA_INVALID"
    )
  }

  const safe: OperationalAlertMetadata = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEYS.has(key)) {
      continue
    }
    if (typeof value === "string") {
      if (value.length > 128) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "OPERATIONAL_ALERT_METADATA_INVALID"
        )
      }
      safe[key as MetadataKey] = sanitizeAlertText(
        value,
        128,
        "OPERATIONAL_ALERT_METADATA_INVALID"
      )
      continue
    }
    if (typeof value === "boolean") {
      safe[key as MetadataKey] = value
      continue
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key as MetadataKey] = value
      continue
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "OPERATIONAL_ALERT_METADATA_INVALID"
    )
  }

  return Object.keys(safe).length > 0 ? safe : null
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  return date.toISOString()
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value)
}

function toSafe(row: Record<string, unknown>): OperationalAlertSafe {
  return {
    id: String(row.id),
    type: row.type as OperationalAlertType,
    severity: row.severity as OperationalAlertSeverity,
    status: row.status as OperationalAlertStatus,
    entity_type: row.entity_type as OperationalAlertEntityType,
    entity_id: String(row.entity_id),
    message_code: String(row.message_code),
    message: String(row.message),
    error_code: row.error_code === null ? null : String(row.error_code),
    metadata: sanitizeOperationalAlertMetadata(
      row.metadata as Record<string, unknown> | null
    ),
    first_seen_at: iso(row.first_seen_at),
    last_seen_at: iso(row.last_seen_at),
    occurrence_count: Number(row.occurrence_count),
    acknowledged_at: nullableIso(row.acknowledged_at),
    acknowledged_by:
      row.acknowledged_by === null ? null : String(row.acknowledged_by),
    resolved_at: nullableIso(row.resolved_at),
    resolved_by: row.resolved_by === null ? null : String(row.resolved_by),
    ignored_at: nullableIso(row.ignored_at),
    ignored_by: row.ignored_by === null ? null : String(row.ignored_by),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }
}

const BaseOperationalAlertService = MedusaService({ OperationalAlert })

export class OperationalAlertModuleService extends BaseOperationalAlertService {
  protected declare readonly baseRepository_: BaseRepositoryLike

  private knex(): KnexLike {
    return this.baseRepository_.getActiveManager().getKnex()
  }

  async upsertAlert(input: UpsertAlertInput): Promise<OperationalAlertSafe> {
    assertEnum(
      input.type,
      OPERATIONAL_ALERT_TYPES,
      "OPERATIONAL_ALERT_TYPE_INVALID"
    )
    assertEnum(
      input.severity,
      OPERATIONAL_ALERT_SEVERITIES,
      "OPERATIONAL_ALERT_SEVERITY_INVALID"
    )
    assertEnum(
      input.entity_type,
      OPERATIONAL_ALERT_ENTITY_TYPES,
      "OPERATIONAL_ALERT_ENTITY_TYPE_INVALID"
    )

    const entityId = requireInternalId(
      input.entity_id,
      "OPERATIONAL_ALERT_ENTITY_ID_INVALID"
    )
    if (!MESSAGE_CODE_PATTERN.test(input.message_code)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "OPERATIONAL_ALERT_MESSAGE_CODE_INVALID"
      )
    }
    const observedAt = requireTimestamp(
      input.observed_at,
      "OPERATIONAL_ALERT_OBSERVED_AT_INVALID"
    )
    const message = sanitizeAlertText(
      input.message,
      500,
      "OPERATIONAL_ALERT_MESSAGE_INVALID"
    )
    const errorCode = input.error_code
      ? sanitizeAlertText(
          input.error_code,
          128,
          "OPERATIONAL_ALERT_ERROR_CODE_INVALID"
        )
      : null
    const metadata = sanitizeOperationalAlertMetadata(input.metadata)
    const timestamp = observedAt.toISOString()

    const result = await this.knex().raw(
      `
        insert into operational_alert (
          id, type, severity, status, entity_type, entity_id,
          message_code, message, error_code, metadata,
          first_seen_at, last_seen_at, occurrence_count,
          created_at, updated_at
        ) values (
          ?, ?, ?, 'open', ?, ?,
          ?, ?, ?, cast(? as jsonb),
          ?, ?, 1,
          ?, ?
        )
        on conflict (type, entity_type, entity_id)
        do update set
          severity = case
            when case excluded.severity
              when 'low' then 1 when 'medium' then 2
              when 'high' then 3 when 'critical' then 4 end
              > case operational_alert.severity
              when 'low' then 1 when 'medium' then 2
              when 'high' then 3 when 'critical' then 4 end
            then excluded.severity else operational_alert.severity end,
          status = case
            when operational_alert.status in ('resolved', 'ignored') then 'open'
            else operational_alert.status end,
          message_code = excluded.message_code,
          message = excluded.message,
          error_code = excluded.error_code,
          metadata = excluded.metadata,
          last_seen_at = greatest(
            operational_alert.last_seen_at,
            excluded.last_seen_at
          ),
          occurrence_count = operational_alert.occurrence_count + 1,
          acknowledged_at = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.acknowledged_at end,
          acknowledged_by = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.acknowledged_by end,
          resolved_at = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.resolved_at end,
          resolved_by = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.resolved_by end,
          ignored_at = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.ignored_at end,
          ignored_by = case
            when operational_alert.status in ('resolved', 'ignored') then null
            else operational_alert.ignored_by end,
          updated_at = greatest(operational_alert.updated_at, excluded.updated_at)
        returning *
      `,
      [
        generateEntityId(undefined, "opalert"),
        input.type,
        input.severity,
        input.entity_type,
        entityId,
        input.message_code,
        message,
        errorCode,
        metadata ? JSON.stringify(metadata) : null,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      ]
    )

    const row = result.rows?.[0]
    if (!row) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "OPERATIONAL_ALERT_UPSERT_FAILED"
      )
    }
    return toSafe(row)
  }

  async listSafe(
    input: ListSafeInput
  ): Promise<{ rows: OperationalAlertSafe[]; count: number }> {
    if (input.type !== undefined) {
      assertEnum(
        input.type,
        OPERATIONAL_ALERT_TYPES,
        "OPERATIONAL_ALERT_TYPE_INVALID"
      )
    }
    if (input.status !== undefined) {
      assertEnum(
        input.status,
        OPERATIONAL_ALERT_STATUSES,
        "OPERATIONAL_ALERT_STATUS_INVALID"
      )
    }
    if (input.severity !== undefined) {
      assertEnum(
        input.severity,
        OPERATIONAL_ALERT_SEVERITIES,
        "OPERATIONAL_ALERT_SEVERITY_INVALID"
      )
    }
    if (input.entity_type !== undefined) {
      assertEnum(
        input.entity_type,
        OPERATIONAL_ALERT_ENTITY_TYPES,
        "OPERATIONAL_ALERT_ENTITY_TYPE_INVALID"
      )
    }
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 100_000
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "OPERATIONAL_ALERT_PAGINATION_INVALID"
      )
    }

    const clauses = ["deleted_at is null"]
    const bindings: unknown[] = []
    const add = (clause: string, value: unknown) => {
      clauses.push(clause)
      bindings.push(value)
    }

    if (input.type) add("type = ?", input.type)
    if (input.status) add("status = ?", input.status)
    if (input.severity) add("severity = ?", input.severity)
    if (input.entity_type) add("entity_type = ?", input.entity_type)
    if (input.entity_id) {
      add(
        "entity_id = ?",
        requireInternalId(input.entity_id, "OPERATIONAL_ALERT_ENTITY_ID_INVALID")
      )
    }
    if (input.last_seen_at_from) {
      add(
        "last_seen_at >= ?",
        requireTimestamp(
          input.last_seen_at_from,
          "OPERATIONAL_ALERT_LAST_SEEN_INVALID"
        ).toISOString()
      )
    }
    if (input.last_seen_at_to) {
      add(
        "last_seen_at <= ?",
        requireTimestamp(
          input.last_seen_at_to,
          "OPERATIONAL_ALERT_LAST_SEEN_INVALID"
        ).toISOString()
      )
    }

    const where = clauses.join(" and ")
    const countResult = await this.knex().raw(
      `select count(*)::int as count from operational_alert where ${where}`,
      bindings
    )
    const rowsResult = await this.knex().raw(
      `
        select * from operational_alert
        where ${where}
        order by last_seen_at desc, id desc
        limit ? offset ?
      `,
      [...bindings, input.limit, input.offset]
    )

    return {
      rows: (rowsResult.rows ?? []).map(toSafe),
      count: Number(countResult.rows?.[0]?.count ?? 0),
    }
  }

  async retrieveSafe(id: string): Promise<OperationalAlertSafe | null> {
    const safeId = requireInternalId(id, "OPERATIONAL_ALERT_ID_INVALID")
    const result = await this.knex().raw(
      "select * from operational_alert where id = ? and deleted_at is null limit 1",
      [safeId]
    )
    return result.rows?.[0] ? toSafe(result.rows[0]) : null
  }
}

export default OperationalAlertModuleService
