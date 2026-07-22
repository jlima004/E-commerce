import type { MedusaContainer } from "@medusajs/framework/types"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  ADMIN_ACTION_LOG_MODULE,
  type AdminActionFact,
  type AdminActionLogModuleService,
  type AdminActionState,
} from "../modules/admin-action-log"
import { EXCHANGE_REQUEST_MODULE } from "../modules/exchange-request"
import { REFUND_REQUEST_MODULE } from "../modules/refund-request"

export const ADMIN_ACTION_ORPHAN_AFTER_MS = 15 * 60_000
export const ADMIN_ACTION_RECONCILIATION_BATCH_SIZE = 100
export const ADMIN_ACTION_RECONCILIATION_MAX_PAGES = 20
export const ADMIN_ACTION_RECONCILIATION_TIMEOUT_MS = 25_000

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

type RefundRequestLike = {
  id: string
  status?: string | null
}

type ExchangeRequestLike = {
  id: string
  status?: string | null
  reverse_logistics_provider?: string | null
  reverse_tracking_code?: string | null
  reverse_authorization_code?: string | null
  reverse_label_reference?: string | null
}

type RefundRequestModuleLike = {
  retrieveRefundRequest?: (id: string) => Promise<RefundRequestLike | null>
  listRefundRequests?: (filters?: {
    id?: string
  }) => Promise<RefundRequestLike[]>
}

type ExchangeRequestModuleLike = {
  retrieveExchangeRequest?: (id: string) => Promise<ExchangeRequestLike | null>
  listExchangeRequests?: (filters?: {
    id?: string
  }) => Promise<ExchangeRequestLike[]>
}

export type AdminActionLogReconciliationDeps = {
  audit: Pick<
    AdminActionLogModuleService,
    "listOrphanIntents" | "retrieveTerminalFact" | "appendReconciliation"
  >
  refundRequest?: RefundRequestModuleLike | null
  exchangeRequest?: ExchangeRequestModuleLike | null
  logger?: SanitizedJobLogger
  now?: () => Date
  orphanAfterMs?: number
  batchSize?: number
  maxPages?: number
  timeoutMs?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type AdminActionLogReconciliationResult = {
  processed: number
  reconciled: number
  skipped_terminal: number
  left_orphan: number
  pages: number
  timed_out: boolean
  noop_reason: "not_worker" | "release_migration" | null
}

const STATE_COMPARE_KEYS = [
  "status",
  "amount",
  "currency_code",
  "reverse_logistics_provider",
  "reverse_tracking_code",
  "reverse_authorization_code",
  "reverse_label_reference",
] as const

function logSafe(
  logger: SanitizedJobLogger | undefined,
  level: "info" | "warn" | "error",
  code: string,
  meta: Record<string, unknown>
) {
  const payload = {
    error_code: code,
    job: "admin-action-log-reconciliation",
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

function isWorkerMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WORKER_MODE === "worker"
}

async function loadRefundRequest(
  module: RefundRequestModuleLike | null | undefined,
  id: string
): Promise<RefundRequestLike | null> {
  if (!module) {
    return null
  }
  if (typeof module.retrieveRefundRequest === "function") {
    return (await module.retrieveRefundRequest(id)) ?? null
  }
  if (typeof module.listRefundRequests === "function") {
    const rows = await module.listRefundRequests({ id })
    return rows[0] ?? null
  }
  return null
}

async function loadExchangeRequest(
  module: ExchangeRequestModuleLike | null | undefined,
  id: string
): Promise<ExchangeRequestLike | null> {
  if (!module) {
    return null
  }
  if (typeof module.retrieveExchangeRequest === "function") {
    return (await module.retrieveExchangeRequest(id)) ?? null
  }
  if (typeof module.listExchangeRequests === "function") {
    const rows = await module.listExchangeRequests({ id })
    return rows[0] ?? null
  }
  return null
}

function snapshotFromExchange(
  entity: ExchangeRequestLike
): AdminActionState {
  return {
    status: entity.status ?? null,
    reverse_logistics_provider: entity.reverse_logistics_provider ?? null,
    reverse_tracking_code: entity.reverse_tracking_code ?? null,
    reverse_authorization_code: entity.reverse_authorization_code ?? null,
    reverse_label_reference: entity.reverse_label_reference ?? null,
  }
}

function hasComparableState(
  expected: AdminActionState | null | undefined
): boolean {
  if (!expected || typeof expected !== "object") {
    return false
  }
  return STATE_COMPARE_KEYS.some((key) => key in expected)
}

function statesMatchUnequivocally(
  expected: AdminActionState | null | undefined,
  actual: AdminActionState
): boolean {
  if (!hasComparableState(expected)) {
    return false
  }
  let compared = 0
  for (const key of STATE_COMPARE_KEYS) {
    if (!(key in (expected as AdminActionState))) {
      continue
    }
    compared += 1
    if ((expected as AdminActionState)[key] !== actual[key]) {
      return false
    }
  }
  return compared > 0
}

async function resolveReconciliationFact(
  intent: AdminActionFact,
  deps: AdminActionLogReconciliationDeps
): Promise<{
  result: "requested" | "succeeded"
  new_state?: AdminActionState | null
} | null> {
  if (intent.entity_type === "refund_request") {
    if (intent.action !== "refund_order") {
      return null
    }
    const entity = await loadRefundRequest(
      deps.refundRequest,
      intent.entity_id
    )
    if (!entity) {
      return null
    }
    return { result: "requested" }
  }

  if (intent.entity_type !== "exchange_request") {
    return null
  }

  const entity = await loadExchangeRequest(
    deps.exchangeRequest,
    intent.entity_id
  )
  if (!entity) {
    return null
  }

  // Exchange create: action=update_exchange without comparable new_state.
  // Existence of the pre-generated entity is the only local proof allowed.
  if (
    intent.action === "update_exchange" &&
    !hasComparableState(intent.new_state)
  ) {
    return {
      result: "succeeded",
      new_state: snapshotFromExchange(entity),
    }
  }

  const actual = snapshotFromExchange(entity)
  if (!statesMatchUnequivocally(intent.new_state, actual)) {
    return null
  }

  return {
    result: "succeeded",
    new_state: actual,
  }
}

export async function runAdminActionLogReconciliation(
  deps: AdminActionLogReconciliationDeps
): Promise<AdminActionLogReconciliationResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      processed: 0,
      reconciled: 0,
      skipped_terminal: 0,
      left_orphan: 0,
      pages: 0,
      timed_out: false,
      noop_reason: "not_worker",
    }
  }

  if (isReleaseMigration()) {
    return {
      processed: 0,
      reconciled: 0,
      skipped_terminal: 0,
      left_orphan: 0,
      pages: 0,
      timed_out: false,
      noop_reason: "release_migration",
    }
  }

  const now = deps.now ?? (() => new Date())
  const orphanAfterMs = deps.orphanAfterMs ?? ADMIN_ACTION_ORPHAN_AFTER_MS
  const batchSize = deps.batchSize ?? ADMIN_ACTION_RECONCILIATION_BATCH_SIZE
  const maxPages = deps.maxPages ?? ADMIN_ACTION_RECONCILIATION_MAX_PAGES
  const timeoutMs = deps.timeoutMs ?? ADMIN_ACTION_RECONCILIATION_TIMEOUT_MS
  const startedAt = now().getTime()
  const cutoff = new Date(now().getTime() - orphanAfterMs)

  let processed = 0
  let reconciled = 0
  let skippedTerminal = 0
  let leftOrphan = 0
  let pages = 0
  let timedOut = false
  let cursor: { created_at: Date; id: string } | undefined

  while (pages < maxPages) {
    if (now().getTime() - startedAt >= timeoutMs) {
      timedOut = true
      break
    }

    let orphans: AdminActionFact[]
    try {
      orphans = await deps.audit.listOrphanIntents({
        created_before: cutoff,
        after: cursor,
        limit: batchSize,
      })
    } catch {
      logSafe(deps.logger, "error", "ADMIN_ACTION_RECONCILIATION_PAGE_FAILED", {
        page: pages,
      })
      break
    }

    pages += 1
    if (orphans.length === 0) {
      break
    }

    for (const intent of orphans) {
      if (now().getTime() - startedAt >= timeoutMs) {
        timedOut = true
        break
      }

      processed += 1

      try {
        const existingTerminal = await deps.audit.retrieveTerminalFact(
          intent.action_attempt_id
        )
        if (existingTerminal) {
          skippedTerminal += 1
          continue
        }

        const fact = await resolveReconciliationFact(intent, deps)
        if (!fact) {
          leftOrphan += 1
          continue
        }

        await deps.audit.appendReconciliation({
          action_attempt_id: intent.action_attempt_id,
          correlation_id: intent.correlation_id,
          admin_id: intent.admin_id,
          admin_email: intent.admin_email,
          action: intent.action,
          entity_type: intent.entity_type,
          entity_id: intent.entity_id,
          result: fact.result,
          severity: "info",
          previous_state: intent.previous_state,
          new_state: fact.new_state ?? intent.new_state,
          metadata: {
            reused_idempotency: false,
          },
          idempotency_key: intent.idempotency_key,
        })
        reconciled += 1
      } catch {
        leftOrphan += 1
        logSafe(
          deps.logger,
          "warn",
          "ADMIN_ACTION_RECONCILIATION_ITEM_FAILED",
          {
            action_attempt_id: intent.action_attempt_id,
            entity_type: intent.entity_type,
            entity_id: intent.entity_id,
          }
        )
      }
    }

    if (timedOut || orphans.length < batchSize) {
      break
    }

    const last = orphans[orphans.length - 1]
    cursor = {
      created_at: new Date(last.created_at),
      id: last.id,
    }
  }

  return {
    processed,
    reconciled,
    skipped_terminal: skippedTerminal,
    left_orphan: leftOrphan,
    pages,
    timed_out: timedOut,
    noop_reason: null,
  }
}

function resolveOptionalModule<T>(
  container: MedusaContainer,
  key: string
): T | null {
  try {
    return container.resolve(key) as T
  } catch {
    return null
  }
}

export async function runAdminActionLogReconciliationJob(
  container: MedusaContainer
): Promise<AdminActionLogReconciliationResult> {
  const audit = container.resolve(
    ADMIN_ACTION_LOG_MODULE
  ) as AdminActionLogModuleService
  const logger = resolveOptionalModule<SanitizedJobLogger>(container, "logger")

  return runAdminActionLogReconciliation({
    audit,
    refundRequest: resolveOptionalModule<RefundRequestModuleLike>(
      container,
      REFUND_REQUEST_MODULE
    ),
    exchangeRequest: resolveOptionalModule<ExchangeRequestModuleLike>(
      container,
      EXCHANGE_REQUEST_MODULE
    ),
    logger: logger ?? undefined,
  })
}

export default async function adminActionLogReconciliationJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runAdminActionLogReconciliationJob(container)
}

export const config = {
  name: "admin-action-log-reconciliation",
  schedule: "*/5 * * * *",
}
