import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import type { AuthResetDatabase } from "../modules/customer-auth/reset"
import {
  AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE,
  runAuthCredentialOperationReconcile,
} from "./auth-credential-operation-reconcile"

export const AUTH_RESET_RECONCILE_BATCH_SIZE =
  AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE
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
  const result = await runAuthCredentialOperationReconcile({
    database: deps.database,
    logger: deps.logger,
    now: deps.now,
    leaseOwner: deps.leaseOwner,
    batchSize: deps.batchSize ?? AUTH_RESET_RECONCILE_BATCH_SIZE,
    operationTypes: ["reset"],
    isWorker: deps.isWorker,
    isReleaseMigration: deps.isReleaseMigration,
  })

  return {
    processed: result.processed,
    leased: result.leased,
    revoked: result.revoked,
    alerted: result.alerted,
    skipped: result.skipped,
    noop_reason: result.noop_reason,
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
