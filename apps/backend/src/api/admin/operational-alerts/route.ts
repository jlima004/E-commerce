import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  OPERATIONAL_ALERT_MODULE,
  type ListSafeInput,
  type OperationalAlertModuleService,
} from "../../../modules/operational-alert"
import {
  OPERATIONAL_ALERT_ENTITY_TYPES,
  OPERATIONAL_ALERT_SEVERITIES,
  OPERATIONAL_ALERT_STATUSES,
  OPERATIONAL_ALERT_TYPES,
} from "../../../modules/operational-alert/models/operational-alert"
import { requireAdminActor } from "../_shared/require-admin-actor"

const ALLOWED_QUERY_KEYS = new Set([
  "type",
  "status",
  "severity",
  "entity_type",
  "entity_id",
  "last_seen_at_from",
  "last_seen_at_to",
  "limit",
  "offset",
])

function invalidQuery(): never {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "OPERATIONAL_ALERT_QUERY_INVALID"
  )
}

function readSingle(query: Record<string, unknown>, key: string) {
  const value = query[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") invalidQuery()
  return value.trim()
}

function readEnum<T extends string>(
  query: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = readSingle(query, key)
  if (value === undefined) return undefined
  if (!allowed.includes(value as T)) invalidQuery()
  return value as T
}

function readInteger(
  query: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number
) {
  const value = readSingle(query, key)
  if (value === undefined) return defaultValue
  if (!/^\d+$/.test(value)) invalidQuery()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalidQuery()
  }
  return parsed
}

function readDate(query: Record<string, unknown>, key: string) {
  const value = readSingle(query, key)
  if (value === undefined) return undefined
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) invalidQuery()
  return parsed
}

export function parseOperationalAlertListQuery(
  rawQuery: unknown
): ListSafeInput {
  if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    invalidQuery()
  }
  const query = rawQuery as Record<string, unknown>
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) invalidQuery()
  }

  const entityId = readSingle(query, "entity_id")
  if (entityId && (entityId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(entityId))) {
    invalidQuery()
  }
  const from = readDate(query, "last_seen_at_from")
  const to = readDate(query, "last_seen_at_to")
  if (from && to && to.getTime() < from.getTime()) invalidQuery()

  const result: ListSafeInput = {
    limit: readInteger(query, "limit", 20, 1, 100),
    offset: readInteger(query, "offset", 0, 0, 100_000),
  }
  const type = readEnum(query, "type", OPERATIONAL_ALERT_TYPES)
  const status = readEnum(query, "status", OPERATIONAL_ALERT_STATUSES)
  const severity = readEnum(query, "severity", OPERATIONAL_ALERT_SEVERITIES)
  const entityType = readEnum(
    query,
    "entity_type",
    OPERATIONAL_ALERT_ENTITY_TYPES
  )
  if (type) result.type = type
  if (status) result.status = status
  if (severity) result.severity = severity
  if (entityType) result.entity_type = entityType
  if (entityId) result.entity_id = entityId
  if (from) result.last_seen_at_from = from
  if (to) result.last_seen_at_to = to
  return result
}

function resolveService(req: MedusaRequest): OperationalAlertModuleService {
  try {
    return req.scope.resolve(
      OPERATIONAL_ALERT_MODULE
    ) as OperationalAlertModuleService
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "OPERATIONAL_ALERT_MODULE_UNAVAILABLE"
    )
  }
}

export async function handleAdminListOperationalAlerts(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  requireAdminActor(
    req as MedusaRequest & {
      auth_context?: { actor_id?: unknown; actor_type?: unknown }
    }
  )
  const input = parseOperationalAlertListQuery(req.query ?? {})
  const service = resolveService(req)
  const result = await service.listSafe(input)

  res.status(200).json({
    operational_alerts: result.rows,
    count: result.count,
    limit: input.limit,
    offset: input.offset,
  })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminListOperationalAlerts(req, res)
}
