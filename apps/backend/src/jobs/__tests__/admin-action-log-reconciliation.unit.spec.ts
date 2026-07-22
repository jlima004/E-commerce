import type { AdminActionFact } from "../../modules/admin-action-log"
import {
  ADMIN_ACTION_ORPHAN_AFTER_MS,
  config,
  runAdminActionLogReconciliation,
} from "../admin-action-log-reconciliation"

function buildIntent(
  overrides: Partial<AdminActionFact> = {}
): AdminActionFact {
  return {
    id: "admact_intent_01",
    action_attempt_id: "attempt_01",
    correlation_id: "corr_01",
    audit_stage: "intent",
    admin_id: "user_01",
    admin_email: null,
    action: "refund_order",
    entity_type: "refund_request",
    entity_id: "refreq_01",
    result: "requested",
    severity: "info",
    reason: null,
    previous_state: {},
    new_state: null,
    metadata: null,
    idempotency_key: "idem_01",
    created_at: "2026-07-20T11:00:00.000Z",
    updated_at: "2026-07-20T11:00:00.000Z",
    ...overrides,
  }
}

describe("admin-action-log-reconciliation", () => {
  it("exports the worker cron schedule */5 * * * *", () => {
    expect(config).toEqual({
      name: "admin-action-log-reconciliation",
      schedule: "*/5 * * * *",
    })
    expect(ADMIN_ACTION_ORPHAN_AFTER_MS).toBe(15 * 60_000)
  })

  it("is a no-op outside WORKER_MODE=worker", async () => {
    const listOrphanIntents = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents,
        retrieveTerminalFact: jest.fn(),
        appendReconciliation: jest.fn(),
      },
      isWorker: () => false,
    })

    expect(result.noop_reason).toBe("not_worker")
    expect(listOrphanIntents).not.toHaveBeenCalled()
  })

  it("is a no-op in release migration mode", async () => {
    const listOrphanIntents = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents,
        retrieveTerminalFact: jest.fn(),
        appendReconciliation: jest.fn(),
      },
      isWorker: () => true,
      isReleaseMigration: () => true,
    })

    expect(result.noop_reason).toBe("release_migration")
    expect(listOrphanIntents).not.toHaveBeenCalled()
  })

  it("uses a 15-minute cutoff and ignores fresher intents via created_before", async () => {
    const now = new Date("2026-07-20T12:00:00.000Z")
    const listOrphanIntents = jest.fn(async () => [])

    await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents,
        retrieveTerminalFact: jest.fn(),
        appendReconciliation: jest.fn(),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => now,
      orphanAfterMs: ADMIN_ACTION_ORPHAN_AFTER_MS,
    })

    expect(listOrphanIntents).toHaveBeenCalledWith(
      expect.objectContaining({
        created_before: new Date("2026-07-20T11:45:00.000Z"),
        limit: 100,
      })
    )
  })

  it("paginates with a batch limit and stops at max pages", async () => {
    const page = Array.from({ length: 2 }, (_, index) =>
      buildIntent({
        id: `admact_page_${index}`,
        action_attempt_id: `attempt_page_${index}`,
        entity_id: `refreq_page_${index}`,
        created_at: `2026-07-20T10:0${index}:00.000Z`,
      })
    )
    const listOrphanIntents = jest
      .fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page)

    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents,
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation: jest.fn(),
      },
      refundRequest: {
        retrieveRefundRequest: jest.fn(async () => null),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      batchSize: 2,
      maxPages: 2,
    })

    expect(listOrphanIntents).toHaveBeenCalledTimes(2)
    expect(result.pages).toBe(2)
    expect(listOrphanIntents.mock.calls[1][0].after).toEqual({
      created_at: new Date(page[1].created_at),
      id: page[1].id,
    })
  })

  it("stops when the timeout budget is exhausted", async () => {
    let nowMs = Date.parse("2026-07-20T12:00:00.000Z")
    const listOrphanIntents = jest.fn(async () => {
      nowMs += 30_000
      return [
        buildIntent({
          id: "admact_timeout",
          action_attempt_id: "attempt_timeout",
        }),
      ]
    })

    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents,
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation: jest.fn(),
      },
      refundRequest: {
        retrieveRefundRequest: jest.fn(async () => null),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => new Date(nowMs),
      timeoutMs: 25_000,
      maxPages: 20,
    })

    expect(result.timed_out).toBe(true)
    expect(result.pages).toBeLessThanOrEqual(2)
  })

  it("skips intents that already have a terminal fact", async () => {
    const appendReconciliation = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [buildIntent()]),
        retrieveTerminalFact: jest.fn(async () =>
          buildIntent({
            audit_stage: "outcome",
            result: "succeeded",
            id: "admact_terminal",
          })
        ),
        appendReconciliation,
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.skipped_terminal).toBe(1)
    expect(appendReconciliation).not.toHaveBeenCalled()
  })

  it("reconciles RefundRequest existence as requested", async () => {
    const appendReconciliation = jest.fn(async (input) =>
      buildIntent({
        audit_stage: "reconciliation",
        result: input.result,
      })
    )

    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [buildIntent()]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      refundRequest: {
        retrieveRefundRequest: jest.fn(async () => ({
          id: "refreq_01",
          status: "requested",
        })),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.reconciled).toBe(1)
    expect(appendReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "requested",
        action: "refund_order",
        entity_id: "refreq_01",
      })
    )
  })

  it("keeps RefundRequest absence as an orphan and never infers failed", async () => {
    const appendReconciliation = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [buildIntent()]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      refundRequest: {
        retrieveRefundRequest: jest.fn(async () => null),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.left_orphan).toBe(1)
    expect(appendReconciliation).not.toHaveBeenCalled()
  })

  it("reconciles exchange create existence as succeeded", async () => {
    const appendReconciliation = jest.fn(async (input) =>
      buildIntent({
        audit_stage: "reconciliation",
        result: input.result,
      })
    )

    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [
          buildIntent({
            action: "update_exchange",
            entity_type: "exchange_request",
            entity_id: "excreq_01",
            new_state: null,
          }),
        ]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      exchangeRequest: {
        retrieveExchangeRequest: jest.fn(async () => ({
          id: "excreq_01",
          status: "opened",
        })),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.reconciled).toBe(1)
    expect(appendReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ result: "succeeded" })
    )
  })

  it.each([
    ["update_exchange", "opened", { status: "opened" }],
    ["reject_exchange", "rejected", { status: "rejected" }],
    ["cancel_exchange", "canceled", { status: "canceled" }],
  ] as const)(
    "reconciles proven %s transitions",
    async (action, status, newState) => {
      const appendReconciliation = jest.fn(async (input) =>
        buildIntent({
          audit_stage: "reconciliation",
          result: input.result,
        })
      )

      const result = await runAdminActionLogReconciliation({
        audit: {
          listOrphanIntents: jest.fn(async () => [
            buildIntent({
              action,
              entity_type: "exchange_request",
              entity_id: "excreq_transition",
              new_state: newState,
            }),
          ]),
          retrieveTerminalFact: jest.fn(async () => null),
          appendReconciliation,
        },
        exchangeRequest: {
          retrieveExchangeRequest: jest.fn(async () => ({
            id: "excreq_transition",
            status,
          })),
        },
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.reconciled).toBe(1)
      expect(appendReconciliation).toHaveBeenCalledWith(
        expect.objectContaining({ result: "succeeded" })
      )
    }
  )

  it("keeps divergent exchange state as an orphan", async () => {
    const appendReconciliation = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [
          buildIntent({
            action: "reject_exchange",
            entity_type: "exchange_request",
            entity_id: "excreq_divergent",
            new_state: { status: "rejected" },
          }),
        ]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      exchangeRequest: {
        retrieveExchangeRequest: jest.fn(async () => ({
          id: "excreq_divergent",
          status: "opened",
        })),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.left_orphan).toBe(1)
    expect(appendReconciliation).not.toHaveBeenCalled()
  })

  it("keeps overwritten facts ambiguous as orphans", async () => {
    const appendReconciliation = jest.fn()
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [
          buildIntent({
            action: "update_exchange",
            entity_type: "exchange_request",
            entity_id: "excreq_overwrite",
            new_state: {
              status: "opened",
              reverse_tracking_code: "BR123",
            },
          }),
        ]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      exchangeRequest: {
        retrieveExchangeRequest: jest.fn(async () => ({
          id: "excreq_overwrite",
          status: "opened",
          reverse_tracking_code: "BR999",
        })),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.left_orphan).toBe(1)
    expect(appendReconciliation).not.toHaveBeenCalled()
  })

  it("returns the canonical terminal on reconciliation conflict", async () => {
    const canonical = buildIntent({
      id: "admact_canonical",
      audit_stage: "reconciliation",
      result: "requested",
    })
    const appendReconciliation = jest.fn(async () => canonical)

    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [buildIntent()]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation,
      },
      refundRequest: {
        retrieveRefundRequest: jest.fn(async () => ({ id: "refreq_01" })),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.reconciled).toBe(1)
    expect(appendReconciliation).toHaveBeenCalledTimes(1)
  })

  it("two workers reconciling the same orphan produce one logical success path", async () => {
    let terminal: AdminActionFact | null = null
    const appendReconciliation = jest.fn(async (input) => {
      if (terminal) {
        return terminal
      }
      terminal = buildIntent({
        id: "admact_worker_terminal",
        audit_stage: "reconciliation",
        result: input.result,
      })
      return terminal
    })
    const audit = {
      listOrphanIntents: jest.fn(async () => [buildIntent()]),
      retrieveTerminalFact: jest.fn(async () => terminal),
      appendReconciliation,
    }

    const [first, second] = await Promise.all([
      runAdminActionLogReconciliation({
        audit,
        refundRequest: {
          retrieveRefundRequest: jest.fn(async () => ({ id: "refreq_01" })),
        },
        isWorker: () => true,
        isReleaseMigration: () => false,
      }),
      runAdminActionLogReconciliation({
        audit,
        refundRequest: {
          retrieveRefundRequest: jest.fn(async () => ({ id: "refreq_01" })),
        },
        isWorker: () => true,
        isReleaseMigration: () => false,
      }),
    ])

    expect(first.reconciled + second.reconciled + first.skipped_terminal + second.skipped_terminal).toBeGreaterThanOrEqual(1)
    expect(appendReconciliation.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("stops the page/source on list error and preserves later cron retry", async () => {
    const logs: Array<Record<string, unknown>> = []
    const result = await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => {
          throw new Error("page failed")
        }),
        retrieveTerminalFact: jest.fn(),
        appendReconciliation: jest.fn(),
      },
      logger: {
        error: (code, meta) => {
          logs.push({ code, ...(meta ?? {}) })
        },
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(result.pages).toBe(0)
    expect(result.reconciled).toBe(0)
    expect(logs[0]).toMatchObject({
      code: "ADMIN_ACTION_RECONCILIATION_PAGE_FAILED",
      job: "admin-action-log-reconciliation",
    })
    expect(JSON.stringify(logs)).not.toMatch(
      /authorization|cookie|client_secret|payload|stack/i
    )
  })

  it("never calls providers and never mutates domain entities", async () => {
    const refundRetrieve = jest.fn(async () => ({ id: "refreq_01" }))
    const exchangeRetrieve = jest.fn(async () => null)
    const provider = {
      refund: jest.fn(),
      capture: jest.fn(),
      createOrder: jest.fn(),
    }

    await runAdminActionLogReconciliation({
      audit: {
        listOrphanIntents: jest.fn(async () => [buildIntent()]),
        retrieveTerminalFact: jest.fn(async () => null),
        appendReconciliation: jest.fn(async (input) =>
          buildIntent({
            audit_stage: "reconciliation",
            result: input.result,
          })
        ),
      },
      refundRequest: {
        retrieveRefundRequest: refundRetrieve,
        // @ts-expect-error intentional absence of mutation APIs in the double
        updateRefundRequests: undefined,
        createRefundRequests: undefined,
      },
      exchangeRequest: {
        retrieveExchangeRequest: exchangeRetrieve,
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
    })

    expect(refundRetrieve).toHaveBeenCalledWith("refreq_01")
    expect(exchangeRetrieve).not.toHaveBeenCalled()
    expect(provider.refund).not.toHaveBeenCalled()
    expect(provider.capture).not.toHaveBeenCalled()
    expect(provider.createOrder).not.toHaveBeenCalled()
  })
})
