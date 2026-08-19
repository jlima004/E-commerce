import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  reconcileSecretlessPasswordReset,
  type AuthResetDatabase,
} from "../modules/customer-auth/reset"

export const AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE = 25 as const
export const AUTH_CREDENTIAL_OPERATION_LEASE_MS = 2 * 60 * 1000
export const AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS = 6 as const
export const AUTH_CREDENTIAL_OPERATION_BACKOFF_SCHEDULE_MS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
] as const

export const AUTH_CREDENTIAL_OPERATION_DUE_STATUSES = [
  "claimed",
  "provider_outcome_ambiguous",
  "credential_proved",
  "revocation_pending",
] as const

export const AUTH_CREDENTIAL_OPERATION_TYPES = [
  "reset",
  "password_change",
] as const

export type AuthCredentialOperationType =
  (typeof AUTH_CREDENTIAL_OPERATION_TYPES)[number]
export type AuthCredentialOperationDueStatus =
  (typeof AUTH_CREDENTIAL_OPERATION_DUE_STATUSES)[number]

export const AUTH_CREDENTIAL_OPERATION_ALERT_REASON_CODES = [
  "AUTH_CREDENTIAL_OPERATION_SECRETLESS_RECOVERY",
  "AUTH_CREDENTIAL_OPERATION_PROOF_REVOKE_PROGRESSED",
  "AUTH_CREDENTIAL_OPERATION_EXHAUSTED",
] as const

export type AuthCredentialOperationAlertReasonCode =
  (typeof AUTH_CREDENTIAL_OPERATION_ALERT_REASON_CODES)[number]

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

export type CredentialOperationRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type CredentialOperationTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<CredentialOperationRawResult>
}

export type CredentialOperationDatabase = {
  transaction<T>(
    callback: (transaction: CredentialOperationTransaction) => Promise<T>
  ): Promise<T>
}

type KnexLike = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<CredentialOperationRawResult>
  transaction: <T>(
    callback: (transaction: KnexLike) => Promise<T>
  ) => Promise<T>
}

type PostgresPoolClient = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<CredentialOperationRawResult>
  release?: () => void | Promise<void>
}

type PostgresPool = {
  connect(): Promise<PostgresPoolClient>
}

export type AuthCredentialOperationReconcileDeps = {
  database?: CredentialOperationDatabase
  logger?: SanitizedJobLogger
  now?: () => Date
  leaseOwner?: string
  batchSize?: number
  operationTypes?: readonly AuthCredentialOperationType[]
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type AuthCredentialOperationReconcileResult = {
  processed: number
  leased: number
  revoked: number
  alerted: number
  skipped: number
  exhausted: number
  noop_reason: "not_worker" | "release_migration" | null
}

type CredentialOperationRecord = {
  id: string
  auth_identity_id: string
  customer_id: string
  credential_version: number
  operation_type: AuthCredentialOperationType
  operation_id: string
  operation_status: string
  operation_version: number
  version: number
  lease_owner: string | null
  lease_until: Date | null
  attempt_count: number
  next_retry_at: Date | null
  provider_proved_at: Date | null
  credential_updated_at: Date | null
  revocation_committed_at: Date | null
  completed_at: Date | null
}

const CREDENTIAL_COLUMNS = `id, auth_identity_id, customer_id, credential_version,
                operation_type, operation_id, operation_status, operation_version, version,
                lease_owner, lease_until, attempt_count, next_retry_at,
                provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`

const FORBIDDEN_ALERT_KEYS = [
  "email",
  "ip",
  "jwt",
  "token",
  "password",
  "authorization",
  "cookie",
  "idempotency",
  "hmac",
  "lineage",
  "sid",
  "currentpassword",
  "newpassword",
  "secret",
  "refresh",
]

function replaceBindings(sql: string): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

function isWorkerMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WORKER_MODE === "worker"
}

export function isCredentialOperationDue(
  nextRetryAt: Date | null,
  now: Date
): boolean {
  return nextRetryAt === null || nextRetryAt.getTime() <= now.getTime()
}

export function isCredentialOperationLeaseClaimable(
  leaseUntilAt: Date | null,
  now: Date
): boolean {
  return leaseUntilAt === null || leaseUntilAt.getTime() <= now.getTime()
}

export function isCredentialOperationClaimable(
  input: {
    nextRetryAt: Date | null
    leaseUntilAt: Date | null
    attemptCount: number
  },
  now: Date
): boolean {
  return (
    input.attemptCount < AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS &&
    isCredentialOperationDue(input.nextRetryAt, now) &&
    isCredentialOperationLeaseClaimable(input.leaseUntilAt, now)
  )
}

export function computeCredentialOperationBackoff(
  attemptCount: number,
  at: Date
): { nextRetryAt: Date | null; exhausted: boolean } {
  if (attemptCount >= AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS) {
    return { nextRetryAt: null, exhausted: true }
  }
  const scheduleIndex = Math.min(
    Math.max(attemptCount - 1, 0),
    AUTH_CREDENTIAL_OPERATION_BACKOFF_SCHEDULE_MS.length - 1
  )
  return {
    nextRetryAt: new Date(
      at.getTime() + AUTH_CREDENTIAL_OPERATION_BACKOFF_SCHEDULE_MS[scheduleIndex]
    ),
    exhausted: false,
  }
}

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + AUTH_CREDENTIAL_OPERATION_LEASE_MS)
}

function requireDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime())
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  throw new Error("AUTH_CREDENTIAL_OPERATION_RECONCILE_DATE_INVALID")
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireDate(value)
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("AUTH_CREDENTIAL_OPERATION_RECONCILE_STRING_INVALID")
  }
  return value
}

function requireNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("AUTH_CREDENTIAL_OPERATION_RECONCILE_INTEGER_INVALID")
  }
  return parsed
}

function rowsOf(
  result: CredentialOperationRawResult
): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function parseCredential(
  row: Record<string, unknown>
): CredentialOperationRecord {
  const operationType = requireString(row.operation_type)
  if (
    operationType !== "reset" &&
    operationType !== "password_change"
  ) {
    throw new Error("AUTH_CREDENTIAL_OPERATION_TYPE_INVALID")
  }
  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    customer_id: requireString(row.customer_id),
    credential_version: requireNonNegativeInteger(row.credential_version),
    operation_type: operationType,
    operation_id: requireString(row.operation_id),
    operation_status: requireString(row.operation_status),
    operation_version: requireNonNegativeInteger(row.operation_version),
    version: requireNonNegativeInteger(row.version),
    lease_owner: row.lease_owner == null ? null : requireString(row.lease_owner),
    lease_until: nullableDate(row.lease_until),
    attempt_count: requireNonNegativeInteger(row.attempt_count),
    next_retry_at: nullableDate(row.next_retry_at),
    provider_proved_at: nullableDate(row.provider_proved_at),
    credential_updated_at: nullableDate(row.credential_updated_at),
    revocation_committed_at: nullableDate(row.revocation_committed_at),
    completed_at: nullableDate(row.completed_at),
  }
}

function sanitizeAlertMeta(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, "")
    if (FORBIDDEN_ALERT_KEYS.some((part) => normalized.includes(part))) {
      continue
    }
    if (typeof value === "string" && value.includes("@")) {
      continue
    }
    sanitized[key] = value
  }
  return sanitized
}

function logSafe(
  logger: SanitizedJobLogger | undefined,
  level: "info" | "warn" | "error",
  code: string,
  meta: Record<string, unknown>
) {
  const payload = sanitizeAlertMeta({
    error_code: code,
    job: "auth-credential-operation-reconcile",
    ...meta,
  })
  if (level === "error") {
    logger?.error?.(code, payload)
    return
  }
  if (level === "warn") {
    logger?.warn?.(code, payload)
    return
  }
  logger?.info?.(code, payload)
}

export function createKnexCredentialOperationDatabase(
  knex: KnexLike
): CredentialOperationDatabase {
  return {
    transaction(callback) {
      return knex.transaction((transaction) =>
        callback({
          raw(sql, bindings = []) {
            return transaction.raw(sql, bindings)
          },
        })
      )
    },
  }
}

export function createPostgresCredentialOperationDatabase(
  pool: PostgresPool
): CredentialOperationDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction: CredentialOperationTransaction = {
        raw: (sql, bindings = []) =>
          client.query(replaceBindings(sql), bindings),
      }
      try {
        const result = await callback(transaction)
        await client.query("commit")
        return result
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        await client.release?.()
      }
    },
  }
}

function resolveKnex(container: MedusaContainer): KnexLike {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as
    | KnexLike
    | undefined
  if (
    !knex ||
    typeof knex.raw !== "function" ||
    typeof knex.transaction !== "function"
  ) {
    throw new Error("AUTH_CREDENTIAL_OPERATION_RECONCILE_KNEX_UNAVAILABLE")
  }
  return knex
}

async function scanDuePasswordChangeOperations(
  database: CredentialOperationDatabase,
  now: Date,
  batchSize: number
): Promise<CredentialOperationRecord[]> {
  return database.transaction(async (transaction) => {
    const rows = await transaction.raw(
      `select ${CREDENTIAL_COLUMNS}
         from auth_credential_state
        where operation_type = 'password_change'
          and operation_status in ('claimed', 'provider_outcome_ambiguous', 'credential_proved', 'revocation_pending')
          and completed_at is null
          and deleted_at is null
          and attempt_count < ?
          and (lease_until is null or lease_until <= ?)
          and (next_retry_at is null or next_retry_at <= ?)
        order by coalesce(next_retry_at, created_at) asc, id asc
        limit ?`,
      [AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS, now, now, batchSize]
    )
    return rowsOf(rows).map(parseCredential)
  })
}

async function revokeAllLineages(
  transaction: CredentialOperationTransaction,
  authIdentityId: string,
  operationType: AuthCredentialOperationType,
  now: Date
): Promise<void> {
  const reason =
    operationType === "password_change" ? "password_change" : "password_reset"
  await transaction.raw(
    `update auth_refresh_credential
        set status = 'revoked',
            revoked_at = ?,
            updated_at = ?
      where lineage_id in (
        select id from auth_session_lineage
         where auth_identity_id = ?
           and deleted_at is null
      )
        and status = 'active'
        and deleted_at is null`,
    [now, now, authIdentityId]
  )
  await transaction.raw(
    `update auth_session_lineage
        set status = 'revoked',
            revoked_at = ?,
            revocation_reason = ?,
            expired_at = null,
            version = version + 1,
            updated_at = ?
      where auth_identity_id = ?
        and status = 'active'
        and deleted_at is null`,
    [now, reason, now, authIdentityId]
  )
}

async function persistRevocationCommittedIfAllowed(
  transaction: CredentialOperationTransaction,
  credential: CredentialOperationRecord,
  now: Date
): Promise<CredentialOperationRecord | null> {
  if (credential.revocation_committed_at) {
    return credential
  }
  if (!credential.provider_proved_at || !credential.credential_updated_at) {
    return null
  }
  const result = await transaction.raw(
    `update auth_credential_state
        set operation_status = 'revocation_committed',
            revocation_committed_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and operation_type = 'password_change'
        and operation_status in ('claimed', 'provider_outcome_ambiguous', 'credential_proved', 'revocation_pending')
        and provider_proved_at is not null
        and credential_updated_at is not null
        and revocation_committed_at is null
        and completed_at is null
        and deleted_at is null
      returning ${CREDENTIAL_COLUMNS}`,
    [now, now, credential.id]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function claimPasswordChangeLease(
  transaction: CredentialOperationTransaction,
  candidate: CredentialOperationRecord,
  leaseOwner: string,
  now: Date
): Promise<CredentialOperationRecord | null> {
  const nextAttempt = candidate.attempt_count + 1
  const backoff = computeCredentialOperationBackoff(nextAttempt, now)
  const result = await transaction.raw(
    `update auth_credential_state
        set lease_owner = ?,
            lease_until = ?,
            next_retry_at = ?,
            operation_version = operation_version + 1,
            attempt_count = attempt_count + 1,
            version = version + 1,
            updated_at = ?
      where id = ?
        and operation_type = 'password_change'
        and operation_id = ?
        and operation_version = ?
        and operation_status = ?
        and operation_status in ('claimed', 'provider_outcome_ambiguous', 'credential_proved', 'revocation_pending')
        and completed_at is null
        and deleted_at is null
        and attempt_count < ?
        and (lease_until is null or lease_until <= ?)
        and (next_retry_at is null or next_retry_at <= ?)
      returning ${CREDENTIAL_COLUMNS}`,
    [
      leaseOwner,
      leaseUntil(now),
      backoff.nextRetryAt,
      now,
      candidate.id,
      candidate.operation_id,
      candidate.operation_version,
      candidate.operation_status,
      AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS,
      now,
      now,
    ]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function reconcilePasswordChangeOperations(
  database: CredentialOperationDatabase,
  input: {
    now: Date
    leaseOwner: string
    batchSize: number
    logger?: SanitizedJobLogger
  }
): Promise<Omit<AuthCredentialOperationReconcileResult, "noop_reason">> {
  const result = {
    processed: 0,
    leased: 0,
    revoked: 0,
    alerted: 0,
    skipped: 0,
    exhausted: 0,
  }
  const due = await scanDuePasswordChangeOperations(
    database,
    input.now,
    input.batchSize
  )

  for (const candidate of due) {
    result.processed += 1
    try {
      const step = await database.transaction(async (transaction) => {
        if (
          !isCredentialOperationClaimable(
            {
              nextRetryAt: candidate.next_retry_at,
              leaseUntilAt: candidate.lease_until,
              attemptCount: candidate.attempt_count,
            },
            input.now
          )
        ) {
          return "lost" as const
        }

        const claimed = await claimPasswordChangeLease(
          transaction,
          candidate,
          input.leaseOwner,
          input.now
        )
        if (!claimed) {
          return "lost" as const
        }

        const hasAuthoritativeProof = Boolean(claimed.provider_proved_at)
        const hasUpdateMarker = Boolean(claimed.credential_updated_at)
        if (hasAuthoritativeProof) {
          await revokeAllLineages(
            transaction,
            claimed.auth_identity_id,
            claimed.operation_type,
            input.now
          )
        }

        let revokedCommitted = false
        if (hasAuthoritativeProof && hasUpdateMarker) {
          const progressed = await persistRevocationCommittedIfAllowed(
            transaction,
            claimed,
            input.now
          )
          revokedCommitted = Boolean(progressed?.revocation_committed_at)
        }

        if (claimed.completed_at) {
          throw new Error("AUTH_CREDENTIAL_OPERATION_SECRETLESS_COMPLETION")
        }

        const exhausted =
          claimed.attempt_count >= AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS
        return {
          kind: "leased" as const,
          revoked: hasAuthoritativeProof,
          revokedCommitted,
          exhausted,
          credentialId: claimed.id,
          operationType: claimed.operation_type,
          attemptCount: claimed.attempt_count,
        }
      })

      if (step === "lost") {
        result.skipped += 1
        continue
      }

      result.leased += 1
      if (step.revoked) {
        result.revoked += 1
      }
      if (step.exhausted) {
        result.exhausted += 1
      }

      const reason: AuthCredentialOperationAlertReasonCode = step.exhausted
        ? "AUTH_CREDENTIAL_OPERATION_EXHAUSTED"
        : step.revokedCommitted
          ? "AUTH_CREDENTIAL_OPERATION_PROOF_REVOKE_PROGRESSED"
          : "AUTH_CREDENTIAL_OPERATION_SECRETLESS_RECOVERY"

      logSafe(input.logger, "warn", reason, {
        reason_code: reason,
        credential_id: step.credentialId,
        operation_type: step.operationType,
        attempt_count: step.attemptCount,
        exhausted: step.exhausted,
      })
      result.alerted += 1
    } catch {
      result.skipped += 1
    }
  }

  return result
}

function mergeResults(
  left: Omit<AuthCredentialOperationReconcileResult, "noop_reason">,
  right: Omit<AuthCredentialOperationReconcileResult, "noop_reason">
): Omit<AuthCredentialOperationReconcileResult, "noop_reason"> {
  return {
    processed: left.processed + right.processed,
    leased: left.leased + right.leased,
    revoked: left.revoked + right.revoked,
    alerted: left.alerted + right.alerted,
    skipped: left.skipped + right.skipped,
    exhausted: left.exhausted + right.exhausted,
  }
}

export async function runAuthCredentialOperationReconcile(
  deps: AuthCredentialOperationReconcileDeps
): Promise<AuthCredentialOperationReconcileResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      processed: 0,
      leased: 0,
      revoked: 0,
      alerted: 0,
      skipped: 0,
      exhausted: 0,
      noop_reason: "not_worker",
    }
  }

  if (isReleaseMigration()) {
    return {
      processed: 0,
      leased: 0,
      revoked: 0,
      alerted: 0,
      skipped: 0,
      exhausted: 0,
      noop_reason: "release_migration",
    }
  }

  if (!deps.database) {
    throw new Error("AUTH_CREDENTIAL_OPERATION_RECONCILE_DATABASE_REQUIRED")
  }

  const now = deps.now?.() ?? new Date()
  const leaseOwner =
    deps.leaseOwner ?? `authlease_credop_${now.getTime()}`
  const batchSize =
    deps.batchSize ?? AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE
  const operationTypes = new Set(
    deps.operationTypes ?? AUTH_CREDENTIAL_OPERATION_TYPES
  )

  let aggregated: Omit<AuthCredentialOperationReconcileResult, "noop_reason"> = {
    processed: 0,
    leased: 0,
    revoked: 0,
    alerted: 0,
    skipped: 0,
    exhausted: 0,
  }

  if (operationTypes.has("password_change")) {
    aggregated = mergeResults(
      aggregated,
      await reconcilePasswordChangeOperations(deps.database, {
        now,
        leaseOwner,
        batchSize,
        logger: deps.logger,
      })
    )
  }

  if (operationTypes.has("reset")) {
    const resetResult = await reconcileSecretlessPasswordReset(deps.database, {
      now,
      leaseOwner,
      batchSize,
      logger: deps.logger,
    })
    aggregated = mergeResults(aggregated, {
      ...resetResult,
      exhausted: 0,
    })
  }

  return {
    ...aggregated,
    noop_reason: null,
  }
}

export async function runAuthCredentialOperationReconcileJob(
  container: MedusaContainer
): Promise<AuthCredentialOperationReconcileResult> {
  const logger = container.resolve("logger") as SanitizedJobLogger
  try {
    const knex = resolveKnex(container)
    return await runAuthCredentialOperationReconcile({
      database: createKnexCredentialOperationDatabase(knex),
      logger,
    })
  } catch (error) {
    logSafe(logger, "error", "AUTH_CREDENTIAL_OPERATION_RECONCILE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown",
    })
    throw error
  }
}

export default async function authCredentialOperationReconcileJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runAuthCredentialOperationReconcileJob(container)
}

export const config = {
  name: "auth-credential-operation-reconcile",
  schedule: "*/2 * * * *",
}
