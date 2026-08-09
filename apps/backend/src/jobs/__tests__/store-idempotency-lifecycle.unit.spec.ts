import type { MedusaContainer } from "@medusajs/framework/types"
import {
  STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS,
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
  STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
  STORE_IDEMPOTENCY_RETRY_WINDOW_MS,
  type StoreIdempotencyRecordRow,
} from "../../modules/store-idempotency"
import {
  config,
  default as storeIdempotencyLifecycleJob,
  runStoreIdempotencyLifecycle,
  runStoreIdempotencyLifecycleJob,
  STORE_IDEMPOTENCY_LIFECYCLE_BATCH_SIZE,
} from "../store-idempotency-lifecycle"

function baseRow(
  overrides: Partial<StoreIdempotencyRecordRow> = {}
): StoreIdempotencyRecordRow {
  return {
    id: "stidem_lifecycle_01",
    operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
    actor_scope_hash: "a".repeat(64),
    resource_scope_hash: "b".repeat(64),
    idempotency_key_hash: "c".repeat(64),
    hash_version: "hmac-sha256-v1",
    pepper_version: 1,
    request_fingerprint: "d".repeat(64),
    state: "processing",
    state_version: 1,
    result_type: null,
    result_id: null,
    response_status: null,
    result_safe_metadata: null,
    locked_at: null,
    state_deadline_at: "2026-08-09T12:00:00.000Z",
    next_retry_at: null,
    retry_attempt_count: 0,
    retry_started_at: null,
    terminalized_at: null,
    completed_at: null,
    failure_code: null,
    expires_at: null,
    created_at: "2026-08-09T11:55:00.000Z",
    updated_at: "2026-08-09T11:55:00.000Z",
    ...overrides,
  }
}

function createServiceMock(seed: StoreIdempotencyRecordRow[] = []) {
  const rows = seed.map((row) => ({ ...row }))

  return {
    rows,
    listDueLifecycleRows: jest.fn(async () =>
      rows
        .filter((row) => row.locked_at == null)
        .map((row) => ({ ...row }))
    ),
    claimLifecycleRow: jest.fn(
      async (input: {
        id: string
        expectedState: string
        expectedStateVersion: number
        at?: Date
      }) => {
        const idx = rows.findIndex((row) => row.id === input.id)
        if (idx < 0) {
          return { type: "lost" as const, record: null }
        }
        const current = rows[idx]
        if (
          current.state !== input.expectedState ||
          current.state_version !== input.expectedStateVersion ||
          current.locked_at != null
        ) {
          return { type: "lost" as const, record: { ...current } }
        }
        const at = (input.at ?? new Date()).toISOString()
        const updated = {
          ...current,
          state_version: current.state_version + 1,
          locked_at: at,
          updated_at: at,
        }
        rows[idx] = updated
        return { type: "claimed" as const, record: { ...updated } }
      }
    ),
    markCompleted: jest.fn(
      async (input: {
        id: string
        expectedState: string
        expectedStateVersion: number
        at?: Date
      }) => {
        const idx = rows.findIndex((row) => row.id === input.id)
        if (idx < 0) {
          return { type: "lost" as const, record: null }
        }
        const current = rows[idx]
        if (
          current.state !== input.expectedState ||
          current.state_version !== input.expectedStateVersion
        ) {
          return { type: "lost" as const, record: { ...current } }
        }
        const at = (input.at ?? new Date()).toISOString()
        const updated = {
          ...current,
          state: "completed" as const,
          state_version: current.state_version + 1,
          locked_at: null,
          completed_at: at,
          terminalized_at: at,
          expires_at: at,
          updated_at: at,
        }
        rows[idx] = updated
        return { type: "claimed" as const, record: { ...updated } }
      }
    ),
    markFailedRetryable: jest.fn(),
    markFailedTerminal: jest.fn(
      async (input: {
        id: string
        expectedState: string
        expectedStateVersion: number
        at?: Date
      }) => {
        const idx = rows.findIndex((row) => row.id === input.id)
        if (idx < 0) {
          return { type: "lost" as const, record: null }
        }
        const current = rows[idx]
        if (
          current.state !== input.expectedState ||
          current.state_version !== input.expectedStateVersion
        ) {
          return { type: "lost" as const, record: { ...current } }
        }
        const at = (input.at ?? new Date()).toISOString()
        const updated = {
          ...current,
          state: "failed_terminal" as const,
          state_version: current.state_version + 1,
          locked_at: null,
          terminalized_at: at,
          expires_at: at,
          updated_at: at,
        }
        rows[idx] = updated
        return { type: "claimed" as const, record: { ...updated } }
      }
    ),
    markReconciliationRequired: jest.fn(
      async (input: {
        id: string
        expectedState: string
        expectedStateVersion: number
        at?: Date
      }) => {
        const idx = rows.findIndex((row) => row.id === input.id)
        if (idx < 0) {
          return { type: "lost" as const, record: null }
        }
        const current = rows[idx]
        if (
          current.state !== input.expectedState ||
          current.state_version !== input.expectedStateVersion
        ) {
          return { type: "lost" as const, record: { ...current } }
        }
        const at = (input.at ?? new Date()).toISOString()
        const updated = {
          ...current,
          state: "reconciliation_required" as const,
          state_version: current.state_version + 1,
          locked_at: null,
          updated_at: at,
        }
        rows[idx] = updated
        return { type: "claimed" as const, record: { ...updated } }
      }
    ),
    markReconciliationUnresolved: jest.fn(
      async (input: {
        id: string
        expectedState: string
        expectedStateVersion: number
        at?: Date
      }) => {
        const idx = rows.findIndex((row) => row.id === input.id)
        if (idx < 0) {
          return { type: "lost" as const, record: null }
        }
        const current = rows[idx]
        if (
          current.state !== input.expectedState ||
          current.state_version !== input.expectedStateVersion
        ) {
          return { type: "lost" as const, record: { ...current } }
        }
        const at = (input.at ?? new Date()).toISOString()
        const updated = {
          ...current,
          state: "reconciliation_unresolved" as const,
          state_version: current.state_version + 1,
          locked_at: null,
          terminalized_at: at,
          expires_at: at,
          updated_at: at,
        }
        rows[idx] = updated
        return { type: "claimed" as const, record: { ...updated } }
      }
    ),
    cleanupExpiredTerminals: jest.fn(async () => 0),
  }
}

describe("store-idempotency-lifecycle job", () => {
  const now = new Date("2026-08-09T12:05:00.000Z")

  it("exposes schedule metadata name and * * * * *", () => {
    expect(config.name).toBe("store-idempotency-lifecycle")
    expect(config.schedule).toBe("* * * * *")
    expect(config.schedule).not.toBe("*/15 * * * *")
    expect(STORE_IDEMPOTENCY_LIFECYCLE_BATCH_SIZE).toBe(100)
  })

  it("no due rows → no claim/transition; cleanup still invoked", async () => {
    const service = createServiceMock([])
    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.scanned).toBe(0)
    expect(result.claimed).toBe(0)
    expect(result.transitioned).toBe(0)
    expect(service.claimLifecycleRow).not.toHaveBeenCalled()
    expect(service.markCompleted).not.toHaveBeenCalled()
    expect(service.cleanupExpiredTerminals).toHaveBeenCalledWith({
      now,
      limit: 100,
    })
  })

  it("claim lost → no transition/side effect", async () => {
    const row = baseRow()
    const service = createServiceMock([row])
    service.claimLifecycleRow.mockResolvedValueOnce({
      type: "lost",
      record: { ...row },
    })

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.claim_lost).toBe(1)
    expect(result.transitioned).toBe(0)
    expect(service.markCompleted).not.toHaveBeenCalled()
    expect(service.markReconciliationRequired).not.toHaveBeenCalled()
    expect(service.cleanupExpiredTerminals).toHaveBeenCalled()
  })

  it("claimed → only that row gets action (local-mutation completes)", async () => {
    const due = baseRow({ id: "stidem_due" })
    const other = baseRow({
      id: "stidem_other",
      state_version: 1,
      locked_at: now.toISOString(),
    })
    const service = createServiceMock([due, other])
    // listDue returns only unlocked due row
    service.listDueLifecycleRows.mockResolvedValueOnce([{ ...due }])

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.claimed).toBe(1)
    expect(result.transitioned).toBe(1)
    expect(service.claimLifecycleRow).toHaveBeenCalledTimes(1)
    expect(service.claimLifecycleRow).toHaveBeenCalledWith({
      id: "stidem_due",
      expectedState: "processing",
      expectedStateVersion: 1,
      at: now,
    })
    expect(service.markCompleted).toHaveBeenCalledTimes(1)
    expect(service.markCompleted.mock.calls[0][0].id).toBe("stidem_due")
    expect(service.markCompleted.mock.calls[0][0].expectedStateVersion).toBe(2)
    expect(service.rows.find((row) => row.id === "stidem_other")?.state).toBe(
      "processing"
    )
  })

  it("uncertain-effect processing → reconciliation_required (no blind retry)", async () => {
    const row = baseRow({
      operation: STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
    })
    const service = createServiceMock([row])

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.transitioned).toBe(1)
    expect(service.markReconciliationRequired).toHaveBeenCalledTimes(1)
    expect(service.markCompleted).not.toHaveBeenCalled()
  })

  it("reconciliation_required due → reconciliation_unresolved", async () => {
    const row = baseRow({
      state: "reconciliation_required",
      operation: STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
    })
    const service = createServiceMock([row])

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.transitioned).toBe(1)
    expect(service.markReconciliationUnresolved).toHaveBeenCalledTimes(1)
  })

  it("failed_retryable over retry cap → failed_terminal", async () => {
    const row = baseRow({
      state: "failed_retryable",
      retry_attempt_count: 8,
      retry_started_at: "2026-08-08T12:00:00.000Z",
      next_retry_at: "2026-08-09T12:00:00.000Z",
      failure_code: "timeout",
    })
    const service = createServiceMock([row])

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.transitioned).toBe(1)
    expect(service.markFailedTerminal).toHaveBeenCalledTimes(1)
    expect(service.markCompleted).not.toHaveBeenCalled()
  })

  describe("failed_retryable 8/24h lifecycle matrix (R1-02)", () => {
    const matrixNow = new Date("2026-08-09T12:05:00.000Z")

    function addMs(at: Date, ms: number): Date {
      return new Date(at.getTime() + ms)
    }

    function createFailedRetryableEligibleMock(
      seed: StoreIdempotencyRecordRow[]
    ) {
      const service = createServiceMock(seed)
      // Mirror service listDue predicate for failed_retryable eligibility:
      // next_retry_at <= now OR state_deadline_at <= now; live locked_at excludes.
      service.listDueLifecycleRows.mockImplementation(
        async (input?: { now?: Date; limit?: number }) => {
          const at = input?.now ?? matrixNow
          const due = service.rows.filter((row) => {
            if (row.locked_at != null) {
              return false
            }
            if (row.state !== "failed_retryable") {
              return true
            }
            const nextDue =
              row.next_retry_at != null &&
              new Date(row.next_retry_at).getTime() <= at.getTime()
            const deadlineDue =
              row.state_deadline_at != null &&
              new Date(row.state_deadline_at).getTime() <= at.getTime()
            return nextDue || deadlineDue
          })
          const limit = input?.limit ?? 100
          return due.slice(0, limit).map((row) => ({ ...row }))
        }
      )
      return service
    }

    function failedRetryableRow(
      overrides: Partial<StoreIdempotencyRecordRow> = {}
    ): StoreIdempotencyRecordRow {
      const started = addMs(matrixNow, -60 * 60_000) // 1h ago, within 24h
      return baseRow({
        id: "stidem_retry_matrix",
        state: "failed_retryable",
        operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
        retry_attempt_count: 3,
        retry_started_at: started.toISOString(),
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
        state_deadline_at: addMs(
          started,
          STORE_IDEMPOTENCY_RETRY_WINDOW_MS
        ).toISOString(),
        failure_code: "timeout",
        ...overrides,
      })
    }

    it("Case A: future next_retry_at → not lifecycle eligible / no transition", async () => {
      expect(STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS).toBe(8)
      expect(STORE_IDEMPOTENCY_RETRY_WINDOW_MS).toBe(86_400_000)

      const started = addMs(matrixNow, -60 * 60_000)
      const row = failedRetryableRow({
        retry_attempt_count: 3,
        retry_started_at: started.toISOString(),
        next_retry_at: addMs(matrixNow, 60_000).toISOString(),
        state_deadline_at: addMs(
          started,
          STORE_IDEMPOTENCY_RETRY_WINDOW_MS
        ).toISOString(),
      })
      const service = createFailedRetryableEligibleMock([row])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.scanned).toBe(0)
      expect(result.claimed).toBe(0)
      expect(result.transitioned).toBe(0)
      expect(service.claimLifecycleRow).not.toHaveBeenCalled()
      expect(service.markCompleted).not.toHaveBeenCalled()
      expect(service.markFailedTerminal).not.toHaveBeenCalled()
      expect(service.rows[0].state).toBe("failed_retryable")
    })

    it("Case B: due below attempt/time cap → markCompleted (phase13.local-mutation)", async () => {
      const row = failedRetryableRow({
        retry_attempt_count: 3,
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
      })
      const service = createFailedRetryableEligibleMock([row])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.scanned).toBe(1)
      expect(result.claimed).toBe(1)
      expect(result.transitioned).toBe(1)
      expect(service.markCompleted).toHaveBeenCalledTimes(1)
      expect(service.markCompleted.mock.calls[0][0]).toMatchObject({
        id: row.id,
        expectedState: "failed_retryable",
      })
      expect(service.markFailedTerminal).not.toHaveBeenCalled()
      expect(service.rows[0].state).toBe("completed")
    })

    it("Case C: attempts = 8 → markFailedTerminal (no new retry)", async () => {
      const started = addMs(matrixNow, -60 * 60_000)
      const row = failedRetryableRow({
        retry_attempt_count: STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS,
        retry_started_at: started.toISOString(),
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
        state_deadline_at: addMs(
          started,
          STORE_IDEMPOTENCY_RETRY_WINDOW_MS
        ).toISOString(),
      })
      const service = createFailedRetryableEligibleMock([row])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.transitioned).toBe(1)
      expect(service.markFailedTerminal).toHaveBeenCalledTimes(1)
      expect(service.markFailedTerminal.mock.calls[0][0]).toMatchObject({
        id: row.id,
        expectedState: "failed_retryable",
      })
      expect(service.markCompleted).not.toHaveBeenCalled()
      expect(service.rows[0].state).toBe("failed_terminal")
    })

    it("Case D: age = exact 24h → markFailedTerminal (window cap)", async () => {
      const started = addMs(matrixNow, -STORE_IDEMPOTENCY_RETRY_WINDOW_MS)
      const row = failedRetryableRow({
        retry_attempt_count: 3,
        retry_started_at: started.toISOString(),
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
        // deadline also at exact window end; eligibility via next_retry_at
        state_deadline_at: matrixNow.toISOString(),
      })
      const service = createFailedRetryableEligibleMock([row])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.transitioned).toBe(1)
      expect(service.markFailedTerminal).toHaveBeenCalledTimes(1)
      expect(service.markCompleted).not.toHaveBeenCalled()
      expect(service.rows[0].state).toBe("failed_terminal")
    })

    it("Case E: age = 23h59m59s → still eligible → markCompleted", async () => {
      const started = addMs(
        matrixNow,
        -(STORE_IDEMPOTENCY_RETRY_WINDOW_MS - 1_000)
      )
      const row = failedRetryableRow({
        retry_attempt_count: 3,
        retry_started_at: started.toISOString(),
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
        state_deadline_at: addMs(
          started,
          STORE_IDEMPOTENCY_RETRY_WINDOW_MS
        ).toISOString(),
      })
      const service = createFailedRetryableEligibleMock([row])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.transitioned).toBe(1)
      expect(service.markCompleted).toHaveBeenCalledTimes(1)
      expect(service.markFailedTerminal).not.toHaveBeenCalled()
      expect(service.rows[0].state).toBe("completed")
    })

    it("infinite retry impossible: cap dispositions are terminal", async () => {
      const attemptCap = failedRetryableRow({
        id: "stidem_infinite_attempts",
        retry_attempt_count: 8,
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
      })
      const windowCap = failedRetryableRow({
        id: "stidem_infinite_window",
        retry_attempt_count: 2,
        retry_started_at: addMs(
          matrixNow,
          -STORE_IDEMPOTENCY_RETRY_WINDOW_MS
        ).toISOString(),
        next_retry_at: addMs(matrixNow, -1_000).toISOString(),
      })
      const service = createFailedRetryableEligibleMock([attemptCap, windowCap])

      const result = await runStoreIdempotencyLifecycle({
        storeIdempotency: service,
        now: () => matrixNow,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.transitioned).toBe(2)
      expect(service.markFailedTerminal).toHaveBeenCalledTimes(2)
      expect(service.markCompleted).not.toHaveBeenCalled()
      expect(
        service.rows.every((row) => row.state === "failed_terminal")
      ).toBe(true)
    })
  })

  it("restart/no Redis: two independent invocations depend only on service/PG results", async () => {
    const row = baseRow()
    const serviceA = createServiceMock([row])
    const first = await runStoreIdempotencyLifecycle({
      storeIdempotency: serviceA,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })
    expect(first.transitioned).toBe(1)

    // Fresh process / no Redis — second invocation sees completed terminal and skips action.
    const serviceB = createServiceMock([
      {
        ...serviceA.rows[0],
        locked_at: null,
      },
    ])
    serviceB.listDueLifecycleRows.mockResolvedValueOnce([])

    const second = await runStoreIdempotencyLifecycle({
      storeIdempotency: serviceB,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })
    expect(second.scanned).toBe(0)
    expect(second.claimed).toBe(0)
    expect(serviceB.claimLifecycleRow).not.toHaveBeenCalled()
    expect(serviceB.cleanupExpiredTerminals).toHaveBeenCalled()
  })

  it("bounded batch is passed to listDue and cleanup", async () => {
    const service = createServiceMock([])
    await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      batchSize: 25,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })
    expect(service.listDueLifecycleRows).toHaveBeenCalledWith({
      now,
      limit: 25,
    })
    expect(service.cleanupExpiredTerminals).toHaveBeenCalledWith({
      now,
      limit: 25,
    })
  })

  it("skips terminal due rows for transition and still cleans via cleanupExpiredTerminals", async () => {
    const terminal = baseRow({
      id: "stidem_terminal",
      state: "completed",
      state_version: 3,
      expires_at: "2026-08-09T11:00:00.000Z",
      terminalized_at: "2026-08-08T12:00:00.000Z",
      completed_at: "2026-08-08T12:00:00.000Z",
    })
    const service = createServiceMock([terminal])
    service.listDueLifecycleRows.mockResolvedValueOnce([{ ...terminal }])
    service.cleanupExpiredTerminals.mockResolvedValueOnce(1)

    const result = await runStoreIdempotencyLifecycle({
      storeIdempotency: service,
      now: () => now,
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.skipped_terminal).toBe(1)
    expect(result.claimed).toBe(0)
    expect(service.claimLifecycleRow).not.toHaveBeenCalled()
    expect(result.cleaned).toBe(1)
  })

  it("default job handler noops outside worker mode", async () => {
    const previous = process.env.WORKER_MODE
    process.env.WORKER_MODE = "server"
    const container = {
      resolve: jest.fn(),
    } as unknown as MedusaContainer

    await storeIdempotencyLifecycleJob(container)
    expect(container.resolve).not.toHaveBeenCalled()

    process.env.WORKER_MODE = previous
  })

  it("resolves STORE_IDEMPOTENCY_MODULE from container in worker mode", async () => {
    const previous = process.env.WORKER_MODE
    process.env.WORKER_MODE = "worker"
    const service = createServiceMock([])
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === STORE_IDEMPOTENCY_MODULE) {
          return service
        }
        throw new Error(`unexpected resolve: ${key}`)
      }),
    } as unknown as MedusaContainer

    // Avoid release-migration short-circuit.
    process.env.DTC_RELEASE_MIGRATION_MODE = ""
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = ""

    const result = await runStoreIdempotencyLifecycleJob(container)
    expect(container.resolve).toHaveBeenCalledWith(STORE_IDEMPOTENCY_MODULE)
    expect(result.noop_reason).toBeNull()
    expect(service.cleanupExpiredTerminals).toHaveBeenCalled()

    process.env.WORKER_MODE = previous
  })
})
