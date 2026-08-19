import type { MedusaContainer } from "@medusajs/framework/types"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE,
  AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
  computeAuthNotificationBackoff,
  type AuthNotificationFailureReason,
  type AuthNotificationOutboxRecord,
} from "../modules/customer-auth/notification-outbox"
import { CUSTOMER_AUTH_MODULE } from "../modules/customer-auth"

export const AUTH_NOTIFICATION_RECONCILE_BATCH_SIZE =
  AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE
export const AUTH_NOTIFICATION_RECONCILE_TIMEOUT_MS = 25_000

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

type KnexLike = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

type CustomerAuthModuleLike = {
  reclaimNotificationOutbox?: (
    id: string,
    expectedVersion: number,
    currentAttemptCount: number,
    now: Date,
    sharedContext?: unknown
  ) => Promise<{ type: string; version?: number }>
  failNotificationOutbox?: (
    id: string,
    expectedVersion: number,
    currentAttemptCount: number,
    failureReason: AuthNotificationFailureReason,
    failedAt: Date,
    forceDeadLetter?: boolean,
    sharedContext?: unknown
  ) => Promise<{ type: string; version?: number }>
}

export type AuthNotificationReconcileDeps = {
  knex?: KnexLike
  customerAuth?: CustomerAuthModuleLike | null
  logger?: SanitizedJobLogger
  now?: () => Date
  batchSize?: number
  timeoutMs?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type AuthNotificationReconcileResult = {
  processed: number
  reclaimed: number
  skipped_terminal: number
  dead_lettered: number
  timed_out: boolean
  noop_reason: "not_worker" | "release_migration" | null
}

function isWorkerMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WORKER_MODE === "worker"
}

function logSafe(
  logger: SanitizedJobLogger | undefined,
  level: "info" | "warn" | "error",
  code: string,
  meta: Record<string, unknown>
) {
  const payload = {
    error_code: code,
    job: "auth-notification-reconcile",
    ...meta,
  }
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

function resolveKnex(container: MedusaContainer): KnexLike {
  try {
    const manager = container.resolve("__pg_connection__") as
      | KnexLike
      | undefined
    if (manager && typeof manager.raw === "function") {
      return manager
    }
  } catch {
    // fallback to module service manager
  }

  const customerAuth = container.resolve(
    CUSTOMER_AUTH_MODULE
  ) as {
    baseRepository_?: {
      getActiveManager: () => { getKnex: () => KnexLike }
    }
  }
  const knex = customerAuth?.baseRepository_?.getActiveManager()?.getKnex()
  if (!knex || typeof knex.raw !== "function") {
    throw new Error("AUTH_NOTIFICATION_RECONCILE_KNEX_UNAVAILABLE")
  }
  return knex
}

async function isIntentTerminal(
  knex: KnexLike,
  intentType: string,
  intentId: string
): Promise<boolean> {
  const table =
    intentType === "verification"
      ? "auth_verification_intent"
      : "auth_reset_intent"
  const result = await knex.raw(
    `select status from ${table} where id = ? and deleted_at is null limit 1`,
    [intentId]
  )
  const row = result.rows?.[0]
  if (!row) {
    // Missing intent is treated as terminal
    return true
  }
  const status = String(row.status)
  return (
    status === "confirmed" ||
    status === "completed" ||
    status === "superseded" ||
    status === "expired" ||
    status === "dead_letter"
  )
}

export async function runAuthNotificationReconcile(
  deps: AuthNotificationReconcileDeps
): Promise<AuthNotificationReconcileResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      processed: 0,
      reclaimed: 0,
      skipped_terminal: 0,
      dead_lettered: 0,
      timed_out: false,
      noop_reason: "not_worker",
    }
  }

  if (isReleaseMigration()) {
    return {
      processed: 0,
      reclaimed: 0,
      skipped_terminal: 0,
      dead_lettered: 0,
      timed_out: false,
      noop_reason: "release_migration",
    }
  }

  if (!deps.knex) {
    throw new Error("AUTH_NOTIFICATION_RECONCILE_KNEX_REQUIRED")
  }

  const knex = deps.knex
  const nowFn = deps.now ?? (() => new Date())
  const batchSize = deps.batchSize ?? AUTH_NOTIFICATION_RECONCILE_BATCH_SIZE
  const timeoutMs = deps.timeoutMs ?? AUTH_NOTIFICATION_RECONCILE_TIMEOUT_MS
  const now = nowFn()
  const startedAt = now.getTime()

  // Query outbox records with expired leases (claimed but lease_until < now)
  const result = await knex.raw(
    `select * from auth_notification_outbox
     where status = 'claimed'
       and lease_until is not null
       and lease_until < ?
       and deleted_at is null
     order by lease_until asc, id asc
     limit ?`,
    [now.toISOString(), batchSize]
  )

  const candidates = (result.rows ?? []) as unknown as AuthNotificationOutboxRecord[]

  let processed = 0
  let reclaimed = 0
  let skippedTerminal = 0
  let deadLettered = 0
  let timedOut = false

  for (const candidate of candidates) {
    if (nowFn().getTime() - startedAt >= timeoutMs) {
      timedOut = true
      break
    }

    processed += 1

    try {
      const isTerminal = await isIntentTerminal(
        knex,
        candidate.intent_type,
        candidate.intent_id
      )

      if (isTerminal) {
        skippedTerminal += 1
        // B14-09-HR-06: Explicit CAS terminal transition to dead_letter with version increment
        await knex.raw(
          `update auth_notification_outbox
           set status = 'dead_letter',
               dead_lettered_at = ?,
               failure_reason = 'provider_permanent',
               lease_owner = null,
               lease_until = null,
               next_retry_at = null,
               version = version + 1,
               updated_at = now()
           where id = ? and version = ? and status = 'claimed'`,
          [now.toISOString(), candidate.id, candidate.version]
        )
        continue
      }

      // Intent is still pending: reclaim expired lease by recording transient failure
      const newAttemptCount = Number(candidate.attempt_count) + 1
      const isMaxAttempts =
        newAttemptCount >= AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS

      if (isMaxAttempts) {
        await knex.raw(
          `update auth_notification_outbox
           set status = 'dead_letter',
               dead_lettered_at = ?,
               failure_reason = 'provider_transient',
               attempt_count = ?,
               lease_owner = null,
               lease_until = null,
               next_retry_at = null,
               version = version + 1,
               updated_at = now()
           where id = ? and version = ? and status = 'claimed'`,
          [
            now.toISOString(),
            newAttemptCount,
            candidate.id,
            candidate.version,
          ]
        )
        deadLettered += 1
        logSafe(deps.logger, "warn", "AUTH_NOTIFICATION_DEAD_LETTER", {
          outbox_id: candidate.id,
          intent_id: candidate.intent_id,
          template: candidate.template,
          attempt_count: newAttemptCount,
          failure_reason: "provider_transient",
        })
      } else {
        const { nextRetryAt } = computeAuthNotificationBackoff(
          newAttemptCount,
          now
        )

        await knex.raw(
          `update auth_notification_outbox
           set status = 'failed',
               failed_at = ?,
               failure_reason = 'provider_transient',
               attempt_count = ?,
               next_retry_at = ?,
               lease_owner = null,
               lease_until = null,
               version = version + 1,
               updated_at = now()
           where id = ? and version = ? and status = 'claimed'`,
          [
            now.toISOString(),
            newAttemptCount,
            nextRetryAt ? nextRetryAt.toISOString() : null,
            candidate.id,
            candidate.version,
          ]
        )
        reclaimed += 1
      }
    } catch {
      logSafe(
        deps.logger,
        "error",
        "AUTH_NOTIFICATION_RECONCILE_ITEM_FAILED",
        {
          outbox_id: candidate.id,
          intent_id: candidate.intent_id,
        }
      )
    }
  }

  return {
    processed,
    reclaimed,
    skipped_terminal: skippedTerminal,
    dead_lettered: deadLettered,
    timed_out: timedOut,
    noop_reason: null,
  }
}

export async function runAuthNotificationReconcileJob(
  container: MedusaContainer
): Promise<AuthNotificationReconcileResult> {
  const knex = resolveKnex(container)
  const customerAuth = container.resolve(
    CUSTOMER_AUTH_MODULE
  ) as CustomerAuthModuleLike
  let logger: SanitizedJobLogger | undefined
  try {
    logger = container.resolve("logger") as SanitizedJobLogger
  } catch {
    // logger is optional
  }

  return runAuthNotificationReconcile({
    knex,
    customerAuth,
    logger,
  })
}

export default async function authNotificationReconcileJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runAuthNotificationReconcileJob(container)
}

export const config = {
  name: "auth-notification-reconcile",
  schedule: "*/2 * * * *",
}
