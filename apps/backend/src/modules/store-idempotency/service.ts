import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import {
  MedusaError,
  MedusaService,
  generateEntityId,
} from "@medusajs/framework/utils"
import { env } from "../../config/env"
import StoreIdempotencyRecord, {
  STORE_IDEMPOTENCY_HASH_VERSION,
  STORE_IDEMPOTENCY_PEPPER_VERSION,
  STORE_IDEMPOTENCY_STATES,
  STORE_IDEMPOTENCY_TERMINAL_STATES,
  type StoreIdempotencyState,
  type StoreIdempotencyTerminalState,
} from "./models/store-idempotency-record"

export const STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS = 5 * 60 * 1000
export const STORE_IDEMPOTENCY_RECOVERY_HORIZON_MS = 15 * 60 * 1000
export const STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS =
  24 * 60 * 60 * 1000
export const STORE_IDEMPOTENCY_MIN_TERMINAL_RETENTION_MS = 15 * 60 * 1000
export const STORE_IDEMPOTENCY_MAX_TERMINAL_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000
export const STORE_IDEMPOTENCY_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
export const STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS = 8
export const STORE_IDEMPOTENCY_RECONCILIATION_REVIEW_MS =
  7 * 24 * 60 * 60 * 1000
export const STORE_IDEMPOTENCY_UNRESOLVED_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000

export const STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION =
  "phase13.local-mutation" as const
export const STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT =
  "phase13.uncertain-effect-simulation" as const

export const STORE_IDEMPOTENCY_SAFE_METADATA_KEYS = [
  "operation",
  "result_type",
  "result_id",
  "response_status",
  "failure_code",
  "harness",
  "correlation_ref",
] as const

type SafeMetadataKey = (typeof STORE_IDEMPOTENCY_SAFE_METADATA_KEYS)[number]
export type StoreIdempotencySafeMetadata = Partial<
  Record<SafeMetadataKey, string | number | boolean>
>

type QueryResult = { rows?: Record<string, unknown>[] }
type KnexLike = {
  raw: (sql: string, bindings?: unknown[]) => Promise<QueryResult>
  transaction: <T>(fn: (trx: KnexLike) => Promise<T>) => Promise<T>
}
type BaseRepositoryLike = {
  getActiveManager: () => { getKnex: () => KnexLike }
}

export type StoreIdempotencyRecordRow = {
  id: string
  operation: string
  actor_scope_hash: string
  resource_scope_hash: string
  idempotency_key_hash: string
  hash_version: string
  pepper_version: number
  request_fingerprint: string
  state: StoreIdempotencyState
  state_version: number
  result_type: string | null
  result_id: string | null
  response_status: number | null
  result_safe_metadata: StoreIdempotencySafeMetadata | null
  locked_at: string | null
  state_deadline_at: string | null
  next_retry_at: string | null
  retry_attempt_count: number
  retry_started_at: string | null
  terminalized_at: string | null
  completed_at: string | null
  failure_code: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type ClaimInput = {
  operation: string
  actorScope: unknown
  resourceScope?: unknown
  rawIdempotencyKey: string
  canonicalSemanticObject: Record<string, unknown>
  at?: Date
}

export type ClaimResult =
  | { type: "claimed"; record: StoreIdempotencyRecordRow }
  | { type: "in_progress"; record: StoreIdempotencyRecordRow }
  | { type: "replay"; record: StoreIdempotencyRecordRow }
  | {
      type: "conflict"
      record: StoreIdempotencyRecordRow
      publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT"
    }

export type LifecycleClaimResult =
  | { type: "claimed"; record: StoreIdempotencyRecordRow }
  | { type: "lost"; record: StoreIdempotencyRecordRow | null }

const SAFE_METADATA_KEYS = new Set<string>(STORE_IDEMPOTENCY_SAFE_METADATA_KEYS)
const OPERATION_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === "string") {
    return new Date(value).toISOString()
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "STORE_IDEMPOTENCY_TIMESTAMP_INVALID"
  )
}

function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return iso(value)
}

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms)
}

export function assertValidRawIdempotencyKey(rawKey: unknown): Buffer {
  if (typeof rawKey !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_KEY_INVALID"
    )
  }

  const bytes = Buffer.from(rawKey, "utf8")
  if (bytes.length < 1 || bytes.length > 255) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_KEY_LENGTH_INVALID"
    )
  }

  for (const byte of bytes) {
    if (byte < 0x21 || byte > 0x7e) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_KEY_CHARSET_INVALID"
      )
    }
  }

  return bytes
}

export function decodeStoreIdempotencyPepper(pepperBase64Url: string): Buffer {
  if (typeof pepperBase64Url !== "string" || pepperBase64Url.length === 0) {
    throw new Error("STORE_IDEMPOTENCY_KEY_PEPPER_INVALID")
  }

  if (!/^[A-Za-z0-9_-]+$/.test(pepperBase64Url)) {
    throw new Error("STORE_IDEMPOTENCY_KEY_PEPPER_INVALID")
  }

  const decoded = Buffer.from(pepperBase64Url, "base64url")
  if (decoded.length < 32) {
    throw new Error("STORE_IDEMPOTENCY_KEY_PEPPER_TOO_SHORT")
  }

  return decoded
}

export function hashStoreIdempotencyKey(
  rawKey: string,
  pepperBase64Url: string
): string {
  const keyBytes = assertValidRawIdempotencyKey(rawKey)
  const pepper = decodeStoreIdempotencyPepper(pepperBase64Url)
  return createHmac("sha256", pepper).update(keyBytes).digest("hex")
}

function canonicalizeSemanticValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_FINGERPRINT_INVALID"
      )
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeSemanticValue(entry))
  }

  if (!isPlainObject(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_FINGERPRINT_INVALID"
    )
  }

  const keys = Object.keys(value).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const nested = value[key]
    if (nested === undefined) {
      continue
    }
    out[key] = canonicalizeSemanticValue(nested)
  }
  return out
}

export function buildStoreIdempotencyRequestFingerprint(
  canonicalSemanticObject: Record<string, unknown>
): string {
  if (!isPlainObject(canonicalSemanticObject)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_FINGERPRINT_INVALID"
    )
  }

  const canonical = canonicalizeSemanticValue(canonicalSemanticObject)
  const encoded = JSON.stringify(canonical)
  return createHash("sha256").update(encoded, "utf8").digest("hex")
}

export function hashStoreIdempotencyScope(scope: unknown): string {
  const canonical = canonicalizeSemanticValue(
    scope === undefined ? null : scope
  )
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex")
}

export function sanitizeStoreIdempotencySafeMetadata(
  metadata: Record<string, unknown> | null | undefined
): StoreIdempotencySafeMetadata | null {
  if (!metadata) {
    return null
  }
  if (!isPlainObject(metadata)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_METADATA_INVALID"
    )
  }

  const out: StoreIdempotencySafeMetadata = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_METADATA_FORBIDDEN"
      )
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_METADATA_INVALID"
      )
    }
    if (typeof value === "string" && value.length > 240) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_METADATA_INVALID"
      )
    }
    out[key as SafeMetadataKey] = value
  }

  return Object.keys(out).length ? out : null
}

export function assertNoSensitiveStoreIdempotencyPersistence(
  row: Partial<StoreIdempotencyRecordRow> | Record<string, unknown>
): void {
  const forbiddenKeys = [
    "idempotency_key",
    "raw_key",
    "raw_idempotency_key",
    "pepper",
    "store_idempotency_key_pepper",
    "authorization",
    "cookie",
    "client_secret",
    "capability",
    "tracking_token",
    "cpf",
    "federal_tax_id",
  ]

  for (const key of Object.keys(row)) {
    const normalized = key.toLowerCase()
    if (forbiddenKeys.includes(normalized)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_SENSITIVE_FIELD_FORBIDDEN"
      )
    }
  }

  const serialized = JSON.stringify(row)
  for (const needle of [
    "STORE_IDEMPOTENCY_KEY_PEPPER=",
    "client_secret",
    "sk_live_",
    "sk_test_",
  ]) {
    if (serialized.includes(needle)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_SENSITIVE_VALUE_FORBIDDEN"
      )
    }
  }
}

export function resolveTerminalRetentionMs(input?: {
  retentionMs?: number
}): number {
  const retention =
    input?.retentionMs ?? STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS
  if (
    !Number.isFinite(retention) ||
    retention < STORE_IDEMPOTENCY_MIN_TERMINAL_RETENTION_MS ||
    retention > STORE_IDEMPOTENCY_MAX_TERMINAL_RETENTION_MS
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_RETENTION_OUT_OF_BOUNDS"
    )
  }
  return retention
}

export function isStoreIdempotencyTerminalState(
  state: string
): state is StoreIdempotencyTerminalState {
  return (STORE_IDEMPOTENCY_TERMINAL_STATES as readonly string[]).includes(
    state
  )
}

export function fingerprintsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}

function mapRow(row: Record<string, unknown>): StoreIdempotencyRecordRow {
  const metadataRaw = row.result_safe_metadata
  let metadata: StoreIdempotencySafeMetadata | null = null
  if (metadataRaw != null) {
    const parsed =
      typeof metadataRaw === "string"
        ? (JSON.parse(metadataRaw) as Record<string, unknown>)
        : (metadataRaw as Record<string, unknown>)
    metadata = sanitizeStoreIdempotencySafeMetadata(parsed)
  }

  const mapped: StoreIdempotencyRecordRow = {
    id: String(row.id),
    operation: String(row.operation),
    actor_scope_hash: String(row.actor_scope_hash),
    resource_scope_hash: String(row.resource_scope_hash),
    idempotency_key_hash: String(row.idempotency_key_hash),
    hash_version: String(row.hash_version),
    pepper_version: Number(row.pepper_version),
    request_fingerprint: String(row.request_fingerprint),
    state: row.state as StoreIdempotencyState,
    state_version: Number(row.state_version),
    result_type: row.result_type == null ? null : String(row.result_type),
    result_id: row.result_id == null ? null : String(row.result_id),
    response_status:
      row.response_status == null ? null : Number(row.response_status),
    result_safe_metadata: metadata,
    locked_at: toNullableIso(row.locked_at),
    state_deadline_at: toNullableIso(row.state_deadline_at),
    next_retry_at: toNullableIso(row.next_retry_at),
    retry_attempt_count: Number(row.retry_attempt_count ?? 0),
    retry_started_at: toNullableIso(row.retry_started_at),
    terminalized_at: toNullableIso(row.terminalized_at),
    completed_at: toNullableIso(row.completed_at),
    failure_code: row.failure_code == null ? null : String(row.failure_code),
    expires_at: toNullableIso(row.expires_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }

  if (
    !(STORE_IDEMPOTENCY_STATES as readonly string[]).includes(mapped.state)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_STATE_INVALID"
    )
  }

  assertNoSensitiveStoreIdempotencyPersistence(mapped)
  return mapped
}

function requireOperation(operation: string): string {
  if (!OPERATION_PATTERN.test(operation)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STORE_IDEMPOTENCY_OPERATION_INVALID"
    )
  }
  return operation
}

const BaseStoreIdempotencyService = MedusaService({ StoreIdempotencyRecord })

export class StoreIdempotencyModuleService extends BaseStoreIdempotencyService {
  protected declare readonly baseRepository_: BaseRepositoryLike

  private knex(): KnexLike {
    return this.baseRepository_.getActiveManager().getKnex()
  }

  private pepper(): string {
    const pepper = env.STORE_IDEMPOTENCY_KEY_PEPPER
    if (!pepper) {
      throw new Error("STORE_IDEMPOTENCY_KEY_PEPPER_NOT_CONFIGURED")
    }
    return pepper
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const at = input.at ?? new Date()
    const operation = requireOperation(input.operation)
    const keyHash = hashStoreIdempotencyKey(
      input.rawIdempotencyKey,
      this.pepper()
    )
    const actorScopeHash = hashStoreIdempotencyScope(input.actorScope)
    const resourceScopeHash = hashStoreIdempotencyScope(
      input.resourceScope ?? null
    )
    const fingerprint = buildStoreIdempotencyRequestFingerprint(
      input.canonicalSemanticObject
    )
    const lockedAt = at
    const deadline = addMs(at, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
    const id = generateEntityId(undefined, "stidem")
    const timestamp = at.toISOString()

    return this.knex().transaction(async (trx) => {
      const insert = await trx.raw(
        `
          insert into store_idempotency_record (
            id, operation, actor_scope_hash, resource_scope_hash,
            idempotency_key_hash, hash_version, pepper_version,
            request_fingerprint, state, state_version,
            result_type, result_id, response_status, result_safe_metadata,
            locked_at, state_deadline_at, next_retry_at,
            retry_attempt_count, retry_started_at,
            terminalized_at, completed_at, failure_code, expires_at,
            created_at, updated_at
          ) values (
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, 'processing', 1,
            null, null, null, null,
            ?, ?, null,
            0, null,
            null, null, null, null,
            ?, ?
          )
          on conflict (operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash)
          do nothing
          returning *
        `,
        [
          id,
          operation,
          actorScopeHash,
          resourceScopeHash,
          keyHash,
          STORE_IDEMPOTENCY_HASH_VERSION,
          STORE_IDEMPOTENCY_PEPPER_VERSION,
          fingerprint,
          lockedAt.toISOString(),
          deadline.toISOString(),
          timestamp,
          timestamp,
        ]
      )

      const inserted = insert.rows?.[0]
      if (inserted) {
        return { type: "claimed" as const, record: mapRow(inserted) }
      }

      const existingResult = await trx.raw(
        `
          select * from store_idempotency_record
          where operation = ?
            and actor_scope_hash = ?
            and resource_scope_hash = ?
            and idempotency_key_hash = ?
          for update
        `,
        [operation, actorScopeHash, resourceScopeHash, keyHash]
      )
      const existing = existingResult.rows?.[0]
      if (!existing) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "STORE_IDEMPOTENCY_CLAIM_RACE_MISSING_ROW"
        )
      }

      const record = mapRow(existing)
      if (!fingerprintsMatch(record.request_fingerprint, fingerprint)) {
        return {
          type: "conflict" as const,
          record,
          publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT" as const,
        }
      }

      if (record.state === "completed" || record.state === "failed_terminal") {
        return { type: "replay" as const, record }
      }

      return { type: "in_progress" as const, record }
    })
  }

  async transitionWithPredicate(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    next: {
      state: StoreIdempotencyState
      state_deadline_at?: Date | null
      next_retry_at?: Date | null
      retry_attempt_count?: number
      retry_started_at?: Date | null
      locked_at?: Date | null
      result_type?: string | null
      result_id?: string | null
      response_status?: number | null
      result_safe_metadata?: StoreIdempotencySafeMetadata | null
      failure_code?: string | null
      completed_at?: Date | null
      terminalized_at?: Date | null
      expires_at?: Date | null
    }
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    const metadata = sanitizeStoreIdempotencySafeMetadata(
      input.next.result_safe_metadata ?? null
    )

    if (
      isStoreIdempotencyTerminalState(input.next.state) &&
      (!input.next.terminalized_at || !input.next.expires_at)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_TERMINAL_REQUIRES_EXPIRES_AT"
      )
    }

    if (
      !isStoreIdempotencyTerminalState(input.next.state) &&
      input.next.state !== "failed_retryable" &&
      input.next.state_deadline_at == null
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_NON_TERMINAL_REQUIRES_DEADLINE"
      )
    }

    if (
      input.next.state === "failed_retryable" &&
      input.next.next_retry_at == null &&
      input.next.state_deadline_at == null
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "STORE_IDEMPOTENCY_RETRY_REQUIRES_DEADLINE"
      )
    }

    const result = await this.knex().raw(
      `
        update store_idempotency_record
        set
          state = ?,
          state_version = state_version + 1,
          state_deadline_at = ?,
          next_retry_at = ?,
          retry_attempt_count = coalesce(?, retry_attempt_count),
          retry_started_at = ?,
          locked_at = ?,
          result_type = ?,
          result_id = ?,
          response_status = ?,
          result_safe_metadata = cast(? as jsonb),
          failure_code = ?,
          completed_at = ?,
          terminalized_at = ?,
          expires_at = ?,
          updated_at = ?
        where id = ?
          and state = ?
          and state_version = ?
        returning *
      `,
      [
        input.next.state,
        input.next.state_deadline_at
          ? input.next.state_deadline_at.toISOString()
          : null,
        input.next.next_retry_at
          ? input.next.next_retry_at.toISOString()
          : null,
        input.next.retry_attempt_count ?? null,
        input.next.retry_started_at
          ? input.next.retry_started_at.toISOString()
          : null,
        input.next.locked_at ? input.next.locked_at.toISOString() : null,
        input.next.result_type ?? null,
        input.next.result_id ?? null,
        input.next.response_status ?? null,
        metadata ? JSON.stringify(metadata) : null,
        input.next.failure_code ?? null,
        input.next.completed_at
          ? input.next.completed_at.toISOString()
          : null,
        input.next.terminalized_at
          ? input.next.terminalized_at.toISOString()
          : null,
        input.next.expires_at ? input.next.expires_at.toISOString() : null,
        at.toISOString(),
        input.id,
        input.expectedState,
        input.expectedStateVersion,
      ]
    )

    const row = result.rows?.[0]
    if (!row) {
      const current = await this.knex().raw(
        `select * from store_idempotency_record where id = ?`,
        [input.id]
      )
      return {
        type: "lost",
        record: current.rows?.[0] ? mapRow(current.rows[0]) : null,
      }
    }

    return { type: "claimed", record: mapRow(row) }
  }

  async markCompleted(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    result_type?: string | null
    result_id?: string | null
    response_status?: number | null
    result_safe_metadata?: StoreIdempotencySafeMetadata | null
    retentionMs?: number
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    const retention = resolveTerminalRetentionMs({
      retentionMs: input.retentionMs,
    })
    return this.transitionWithPredicate({
      id: input.id,
      expectedState: input.expectedState,
      expectedStateVersion: input.expectedStateVersion,
      at,
      next: {
        state: "completed",
        result_type: input.result_type ?? null,
        result_id: input.result_id ?? null,
        response_status: input.response_status ?? null,
        result_safe_metadata: input.result_safe_metadata ?? null,
        completed_at: at,
        terminalized_at: at,
        expires_at: addMs(at, retention),
        state_deadline_at: null,
        next_retry_at: null,
        locked_at: null,
      },
    })
  }

  async markFailedRetryable(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    failure_code: string
    next_retry_at: Date
    retry_attempt_count: number
    retry_started_at: Date
    state_deadline_at: Date
    at?: Date
  }): Promise<LifecycleClaimResult> {
    return this.transitionWithPredicate({
      id: input.id,
      expectedState: input.expectedState,
      expectedStateVersion: input.expectedStateVersion,
      at: input.at,
      next: {
        state: "failed_retryable",
        failure_code: input.failure_code,
        next_retry_at: input.next_retry_at,
        retry_attempt_count: input.retry_attempt_count,
        retry_started_at: input.retry_started_at,
        state_deadline_at: input.state_deadline_at,
        locked_at: null,
      },
    })
  }

  async markFailedTerminal(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    failure_code: string
    retentionMs?: number
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    const retention = resolveTerminalRetentionMs({
      retentionMs: input.retentionMs,
    })
    return this.transitionWithPredicate({
      id: input.id,
      expectedState: input.expectedState,
      expectedStateVersion: input.expectedStateVersion,
      at,
      next: {
        state: "failed_terminal",
        failure_code: input.failure_code,
        terminalized_at: at,
        expires_at: addMs(at, retention),
        state_deadline_at: null,
        next_retry_at: null,
        locked_at: null,
      },
    })
  }

  async markReconciliationRequired(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    failure_code?: string | null
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    return this.transitionWithPredicate({
      id: input.id,
      expectedState: input.expectedState,
      expectedStateVersion: input.expectedStateVersion,
      at,
      next: {
        state: "reconciliation_required",
        failure_code: input.failure_code ?? null,
        state_deadline_at: addMs(
          at,
          STORE_IDEMPOTENCY_RECONCILIATION_REVIEW_MS
        ),
        next_retry_at: null,
        locked_at: null,
      },
    })
  }

  async markReconciliationUnresolved(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    return this.transitionWithPredicate({
      id: input.id,
      expectedState: input.expectedState,
      expectedStateVersion: input.expectedStateVersion,
      at,
      next: {
        state: "reconciliation_unresolved",
        terminalized_at: at,
        expires_at: addMs(at, STORE_IDEMPOTENCY_UNRESOLVED_RETENTION_MS),
        state_deadline_at: null,
        next_retry_at: null,
        locked_at: null,
      },
    })
  }

  async listDueLifecycleRows(input?: {
    now?: Date
    limit?: number
  }): Promise<StoreIdempotencyRecordRow[]> {
    const now = (input?.now ?? new Date()).toISOString()
    const limit = input?.limit ?? 100
    const result = await this.knex().raw(
      `
        select * from store_idempotency_record
        where
          (
            state in ('processing', 'reconciliation_required')
            and state_deadline_at is not null
            and state_deadline_at <= ?
          )
          or (
            state = 'failed_retryable'
            and (
              (next_retry_at is not null and next_retry_at <= ?)
              or (state_deadline_at is not null and state_deadline_at <= ?)
            )
          )
          or (
            state in ('completed', 'failed_terminal', 'reconciliation_unresolved')
            and expires_at is not null
            and expires_at <= ?
          )
        order by updated_at asc
        limit ?
      `,
      [now, now, now, now, limit]
    )
    return (result.rows ?? []).map((row) => mapRow(row))
  }

  async claimLifecycleRow(input: {
    id: string
    expectedState: StoreIdempotencyState
    expectedStateVersion: number
    at?: Date
  }): Promise<LifecycleClaimResult> {
    const at = input.at ?? new Date()
    // Conditional bump of state_version alone acts as an atomic lease without
    // changing business state; evaluator then transitions with the new version.
    const result = await this.knex().raw(
      `
        update store_idempotency_record
        set
          state_version = state_version + 1,
          locked_at = ?,
          updated_at = ?
        where id = ?
          and state = ?
          and state_version = ?
        returning *
      `,
      [
        at.toISOString(),
        at.toISOString(),
        input.id,
        input.expectedState,
        input.expectedStateVersion,
      ]
    )
    const row = result.rows?.[0]
    if (!row) {
      const current = await this.knex().raw(
        `select * from store_idempotency_record where id = ?`,
        [input.id]
      )
      return {
        type: "lost",
        record: current.rows?.[0] ? mapRow(current.rows[0]) : null,
      }
    }
    return { type: "claimed", record: mapRow(row) }
  }

  async cleanupExpiredTerminals(input?: {
    now?: Date
    limit?: number
  }): Promise<number> {
    const now = (input?.now ?? new Date()).toISOString()
    const limit = input?.limit ?? 100
    const result = await this.knex().raw(
      `
        with doomed as (
          select id from store_idempotency_record
          where state in ('completed', 'failed_terminal', 'reconciliation_unresolved')
            and expires_at is not null
            and expires_at <= ?
          order by expires_at asc
          limit ?
          for update skip locked
        )
        delete from store_idempotency_record
        where id in (select id from doomed)
        returning id
      `,
      [now, limit]
    )
    return result.rows?.length ?? 0
  }
}

export default StoreIdempotencyModuleService
