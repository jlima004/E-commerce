import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  reconcileSecretlessPasswordReset,
  type AuthResetDatabase,
} from "../modules/customer-auth/reset"

export const AUTH_RESET_RECONCILE_BATCH_SIZE = 25
export const AUTH_RESET_RECONCILE_TIMEOUT_MS = 25_000

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
  transaction: <T>(
    callback: (transaction: KnexLike) => Promise<T>
  ) => Promise<T>
}

export type AuthResetReconcileDeps = {
  database?: AuthResetDatabase
  logger?: SanitizedJobLogger
  now?: () => Date
  leaseOwner?: string
  batchSize?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type AuthResetReconcileJobResult = {
  processed: number
  leased: number
  revoked: number
  alerted: number
  skipped: number
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
    job: "auth-reset-reconcile",
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

function createKnexResetDatabase(knex: KnexLike): AuthResetDatabase {
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

function resolveKnex(container: MedusaContainer): KnexLike {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as
    | KnexLike
    | undefined
  if (
    !knex ||
    typeof knex.raw !== "function" ||
    typeof knex.transaction !== "function"
  ) {
    throw new Error("AUTH_RESET_RECONCILE_KNEX_UNAVAILABLE")
  }
  return knex
}

export async function runAuthResetReconcile(
  deps: AuthResetReconcileDeps
): Promise<AuthResetReconcileJobResult> {
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
      noop_reason: "release_migration",
    }
  }

  if (!deps.database) {
    throw new Error("AUTH_RESET_RECONCILE_DATABASE_REQUIRED")
  }

  const result = await reconcileSecretlessPasswordReset(deps.database, {
    now: deps.now?.(),
    leaseOwner: deps.leaseOwner,
    batchSize: deps.batchSize ?? AUTH_RESET_RECONCILE_BATCH_SIZE,
    logger: deps.logger,
  })

  return {
    ...result,
    noop_reason: null,
  }
}

export async function runAuthResetReconcileJob(
  container: MedusaContainer
): Promise<AuthResetReconcileJobResult> {
  const logger = container.resolve("logger") as SanitizedJobLogger
  try {
    const knex = resolveKnex(container)
    return await runAuthResetReconcile({
      database: createKnexResetDatabase(knex),
      logger,
    })
  } catch (error) {
    logSafe(logger, "error", "AUTH_RESET_RECONCILE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown",
    })
    throw error
  }
}

export default async function authResetReconcileJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runAuthResetReconcileJob(container)
}

export const config = {
  name: "auth-reset-reconcile",
  schedule: "*/2 * * * *",
}
