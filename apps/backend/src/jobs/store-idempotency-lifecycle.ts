import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS,
  STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
  STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
  STORE_IDEMPOTENCY_RETRY_WINDOW_MS,
  STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
  isStoreIdempotencyTerminalState,
  type StoreIdempotencyModuleService,
  type StoreIdempotencyRecordRow,
} from "../modules/store-idempotency"

export const STORE_IDEMPOTENCY_LIFECYCLE_BATCH_SIZE = 100

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

export type StoreIdempotencyLifecycleDeps = {
  storeIdempotency: Pick<
    StoreIdempotencyModuleService,
    | "listDueLifecycleRows"
    | "claimLifecycleRow"
    | "markCompleted"
    | "markFailedRetryable"
    | "markFailedTerminal"
    | "markReconciliationRequired"
    | "markReconciliationUnresolved"
    | "cleanupExpiredTerminals"
  >
  logger?: SanitizedJobLogger
  now?: () => Date
  batchSize?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type StoreIdempotencyLifecycleResult = {
  scanned: number
  claimed: number
  transitioned: number
  claim_lost: number
  skipped_terminal: number
  skipped_unsupported_operation: number
  cleaned: number
  failed_items: number
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
    job: "store-idempotency-lifecycle",
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

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms)
}

function isPhase13HarnessOperation(operation: string): boolean {
  return (
    operation === STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION ||
    operation === STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT
  )
}

function retryCapExceeded(row: StoreIdempotencyRecordRow, at: Date): boolean {
  if (row.retry_attempt_count >= STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS) {
    return true
  }
  if (!row.retry_started_at) {
    return false
  }
  const started = new Date(row.retry_started_at).getTime()
  return at.getTime() - started >= STORE_IDEMPOTENCY_RETRY_WINDOW_MS
}

function isStoreCartActiveCreateOperation(operation: string): boolean {
  return operation === STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE
}

async function actOnClaimedRow(
  deps: StoreIdempotencyLifecycleDeps,
  row: StoreIdempotencyRecordRow,
  at: Date
): Promise<"transitioned" | "skipped_unsupported_operation"> {
  // --- store.carts.active.create lifecycle (exact match) ---
  // Worker NEVER calls createCartWorkflow, mints capability, or calls any provider.
  // It only classifies the stale row as reconciliation_required.
  if (isStoreCartActiveCreateOperation(row.operation)) {
    if (row.state === "processing") {
      // Case A (result_id present): confirmed create, stale before completion
      // Case B (result_id null): uncertain whether create committed
      // Both cases → reconciliation_required, preserving factual result_id
      const failureCode = row.result_id != null
        ? "stale_store_cart_create_partial_effect"
        : "stale_store_cart_create_uncertain_effect"
      const result = await deps.storeIdempotency.markReconciliationRequired({
        id: row.id,
        expectedState: "processing",
        expectedStateVersion: row.state_version,
        result_type: row.result_type ?? undefined,
        result_id: row.result_id ?? undefined,
        failure_code: failureCode,
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    if (row.state === "failed_retryable") {
      // Cart-create failed_retryable: we cannot determine if createCartWorkflow
      // partially committed. Worker MUST NOT retry create. Route to
      // reconciliation_required if within retry cap, or failed_terminal if cap exceeded.
      if (retryCapExceeded(row, at)) {
        const result = await deps.storeIdempotency.markFailedTerminal({
          id: row.id,
          expectedState: "failed_retryable",
          expectedStateVersion: row.state_version,
          failure_code: row.failure_code ?? "retry_cap_exceeded",
          at,
        })
        if (result.type !== "claimed") {
          throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
        }
        return "transitioned"
      }
      const result = await deps.storeIdempotency.markReconciliationRequired({
        id: row.id,
        expectedState: "failed_retryable",
        expectedStateVersion: row.state_version,
        failure_code: row.failure_code ?? "stale_store_cart_create_uncertain_effect",
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    if (row.state === "reconciliation_required") {
      const result = await deps.storeIdempotency.markReconciliationUnresolved({
        id: row.id,
        expectedState: "reconciliation_required",
        expectedStateVersion: row.state_version,
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    return "skipped_unsupported_operation"
  }

  // --- Phase 13 harness operations ---
  if (!isPhase13HarnessOperation(row.operation)) {
    return "skipped_unsupported_operation"
  }

  if (row.state === "processing") {
    if (row.operation === STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION) {
      const result = await deps.storeIdempotency.markCompleted({
        id: row.id,
        expectedState: "processing",
        expectedStateVersion: row.state_version,
        result_type: "local_mutation_result",
        result_id: "ord_01HPHASE13LOCAL",
        response_status: 200,
        result_safe_metadata: {
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          harness: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          result_type: "local_mutation_result",
        },
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    const result = await deps.storeIdempotency.markReconciliationRequired({
      id: row.id,
      expectedState: "processing",
      expectedStateVersion: row.state_version,
      failure_code: "uncertain_effect",
      at,
    })
    if (result.type !== "claimed") {
      throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
    }
    return "transitioned"
  }

  if (row.state === "failed_retryable") {
    if (retryCapExceeded(row, at)) {
      const result = await deps.storeIdempotency.markFailedTerminal({
        id: row.id,
        expectedState: "failed_retryable",
        expectedStateVersion: row.state_version,
        failure_code: row.failure_code ?? "retry_cap_exceeded",
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    if (row.operation === STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT) {
      const result = await deps.storeIdempotency.markReconciliationRequired({
        id: row.id,
        expectedState: "failed_retryable",
        expectedStateVersion: row.state_version,
        failure_code: row.failure_code ?? "uncertain_effect",
        at,
      })
      if (result.type !== "claimed") {
        throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
      }
      return "transitioned"
    }

    // phase13.local-mutation: harness retry succeeds locally (no provider network).
    const result = await deps.storeIdempotency.markCompleted({
      id: row.id,
      expectedState: "failed_retryable",
      expectedStateVersion: row.state_version,
      result_type: "local_mutation_result",
      result_id: "ord_01HPHASE13RETRY",
      response_status: 200,
      result_safe_metadata: {
        operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
        harness: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
        result_type: "local_mutation_result",
      },
      at,
    })
    if (result.type !== "claimed") {
      throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
    }
    return "transitioned"
  }

  if (row.state === "reconciliation_required") {
    const result = await deps.storeIdempotency.markReconciliationUnresolved({
      id: row.id,
      expectedState: "reconciliation_required",
      expectedStateVersion: row.state_version,
      at,
    })
    if (result.type !== "claimed") {
      throw new Error("STORE_IDEMPOTENCY_LIFECYCLE_TRANSITION_LOST")
    }
    return "transitioned"
  }

  return "skipped_unsupported_operation"
}

export async function runStoreIdempotencyLifecycle(
  deps: StoreIdempotencyLifecycleDeps
): Promise<StoreIdempotencyLifecycleResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      scanned: 0,
      claimed: 0,
      transitioned: 0,
      claim_lost: 0,
      skipped_terminal: 0,
      skipped_unsupported_operation: 0,
      cleaned: 0,
      failed_items: 0,
      noop_reason: "not_worker",
    }
  }

  if (isReleaseMigration()) {
    return {
      scanned: 0,
      claimed: 0,
      transitioned: 0,
      claim_lost: 0,
      skipped_terminal: 0,
      skipped_unsupported_operation: 0,
      cleaned: 0,
      failed_items: 0,
      noop_reason: "release_migration",
    }
  }

  const nowFn = deps.now ?? (() => new Date())
  const at = nowFn()
  const batchSize = deps.batchSize ?? STORE_IDEMPOTENCY_LIFECYCLE_BATCH_SIZE

  const counters: StoreIdempotencyLifecycleResult = {
    scanned: 0,
    claimed: 0,
    transitioned: 0,
    claim_lost: 0,
    skipped_terminal: 0,
    skipped_unsupported_operation: 0,
    cleaned: 0,
    failed_items: 0,
    noop_reason: null,
  }

  const due = await deps.storeIdempotency.listDueLifecycleRows({
    now: at,
    limit: batchSize,
  })
  counters.scanned = due.length

  for (const row of due) {
    if (isStoreIdempotencyTerminalState(row.state)) {
      counters.skipped_terminal += 1
      continue
    }

    try {
      const claimed = await deps.storeIdempotency.claimLifecycleRow({
        id: row.id,
        expectedState: row.state,
        expectedStateVersion: row.state_version,
        at,
      })

      if (claimed.type !== "claimed") {
        counters.claim_lost += 1
        continue
      }

      counters.claimed += 1
      const outcome = await actOnClaimedRow(deps, claimed.record, at)
      if (outcome === "transitioned") {
        counters.transitioned += 1
      } else {
        counters.skipped_unsupported_operation += 1
      }
    } catch {
      counters.failed_items += 1
      logSafe(deps.logger, "warn", "STORE_IDEMPOTENCY_LIFECYCLE_ITEM_FAILED", {
        record_id: row.id,
        state: row.state,
      })
    }
  }

  try {
    counters.cleaned = await deps.storeIdempotency.cleanupExpiredTerminals({
      now: at,
      limit: batchSize,
    })
  } catch {
    counters.failed_items += 1
    logSafe(deps.logger, "error", "STORE_IDEMPOTENCY_LIFECYCLE_CLEANUP_FAILED", {
      scanned: counters.scanned,
    })
  }

  logSafe(deps.logger, "info", "STORE_IDEMPOTENCY_LIFECYCLE_COMPLETE", {
    scanned: counters.scanned,
    claimed: counters.claimed,
    transitioned: counters.transitioned,
    claim_lost: counters.claim_lost,
    skipped_terminal: counters.skipped_terminal,
    cleaned: counters.cleaned,
    failed_items: counters.failed_items,
    // keep unused helper referenced for future retry scheduling clarity
    next_probe_hint_ms: addMs(at, 60_000).getTime() - at.getTime(),
  })

  return counters
}

function resolveOptionalLogger(
  container: MedusaContainer
): SanitizedJobLogger | undefined {
  try {
    return container.resolve(
      ContainerRegistrationKeys.LOGGER
    ) as SanitizedJobLogger
  } catch {
    return undefined
  }
}

export async function runStoreIdempotencyLifecycleJob(
  container: MedusaContainer
): Promise<StoreIdempotencyLifecycleResult> {
  const storeIdempotency = container.resolve(
    STORE_IDEMPOTENCY_MODULE
  ) as StoreIdempotencyModuleService

  return runStoreIdempotencyLifecycle({
    storeIdempotency,
    logger: resolveOptionalLogger(container),
  })
}

export default async function storeIdempotencyLifecycleJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runStoreIdempotencyLifecycleJob(container)
}

export const config = {
  name: "store-idempotency-lifecycle",
  schedule: "* * * * *",
}
