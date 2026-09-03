import {
  runPaymentAttemptReconciliation,
  type StripePaymentIntentsClientLike,
} from "../payment-attempt-reconciler"
import { RECONCILIATION_REASON_CODE } from "../reason-codes"
import type {
  PaymentAttemptSqlConnection,
  PaymentAttemptSqlTransaction,
} from "../../modules/payment-attempt/transactional-authority"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../../modules/payment-attempt/provider-request-authority"
import type { StripePaymentIntentLike } from "../../modules/payment-attempt/stripe-safe"

type MockAttempt = {
  id: string
  cart_id: string
  payment_collection_id: string | null
  payment_session_id: string | null
  provider_payment_intent_id: string | null
  provider_payment_session_id: string | null
  status: string
  financial_freeze_started_at: string | null
  provider_canceled_confirmed_at: string | null
  provider_discovery_started_at: string | null
  reconciliation_reason_code: string | null
  reconciliation_locked_at: string | null
  last_reconciliation_at: string | null
  order_id: string | null
  canceled_at: string | null
  amount: number
  currency_code: string
  payment_method_type: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function buildMockAttempt(overrides: Partial<MockAttempt> = {}): MockAttempt {
  const paymentAttemptId = overrides.id ?? "payatt_rec_01"
  const cartId = overrides.cart_id ?? "cart_rec_01"
  const amount = overrides.amount ?? 15000
  const paymentMethodType = (overrides.payment_method_type as any) ?? "card"

  const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: paymentMethodType,
    amount_minor: amount,
    cart_id: cartId,
    cart_resource_version: 1,
    payment_attempt_id: paymentAttemptId,
    payment_collection_id: "paycol_rec_01",
    payment_session_id: "payses_rec_01",
    authority_created_at: "2026-09-03T09:50:00.000Z",
    replay_deadline: "2026-09-04T09:50:00.000Z",
  })

  return {
    id: paymentAttemptId,
    cart_id: cartId,
    payment_collection_id: "paycol_rec_01",
    payment_session_id: "payses_rec_01",
    provider_payment_intent_id: "pi_rec_01",
    provider_payment_session_id: null,
    status: "awaiting_webhook_confirmation",
    financial_freeze_started_at: "2026-09-03T10:00:00.000Z",
    provider_canceled_confirmed_at: null,
    provider_discovery_started_at: null,
    reconciliation_reason_code: null,
    reconciliation_locked_at: null,
    last_reconciliation_at: null,
    order_id: null,
    canceled_at: null,
    amount,
    currency_code: "brl",
    payment_method_type: paymentMethodType,
    metadata: {
      cart_resource_version: 1,
      provider_idempotency_key: `payment-attempt:${paymentMethodType}:${paymentAttemptId}`,
      payment_attempt_id: paymentAttemptId,
      stripe_payment_intent_create: v1,
    },
    created_at: "2026-09-03T09:50:00.000Z",
    updated_at: "2026-09-03T10:00:00.000Z",
    ...overrides,
  }
}

function createReconcilerHarness(
  attempts: MockAttempt[] = [],
  options: { simulatedDbNow?: Date } = {}
) {
  let attemptRows = attempts.map((a) => ({ ...a }))
  let cclRows: Record<string, unknown>[] = []
  const logs: { level: string; msg: string; meta?: Record<string, unknown> }[] = []

  const getDbNow = () => options.simulatedDbNow ?? new Date()

  const fakeTrx: PaymentAttemptSqlTransaction = {
    raw: async (sql: string, bindings: unknown[] = []) => {
      const trimmed = sql.trimStart()

      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] }
      }

      // 1. Scan candidates query
      if (
        trimmed.startsWith("select") &&
        sql.includes("from payment_attempt") &&
        sql.includes("order by created_at asc")
      ) {
        const leaseDurationMs =
          typeof bindings[0] === "number"
            ? bindings[0]
            : Number(bindings[0]) || 15 * 60_000
        const limit = Number(bindings[1])
        const staleThreshold = new Date(
          getDbNow().getTime() - leaseDurationMs
        ).toISOString()

        const matched = attemptRows.filter((a) => {
          if (a.order_id != null) return false
          const hasFreeze =
            a.financial_freeze_started_at != null &&
            a.provider_canceled_confirmed_at == null
          const hasReason = a.reconciliation_reason_code != null
          if (!hasFreeze && !hasReason) return false
          if (
            a.reconciliation_locked_at != null &&
            a.reconciliation_locked_at >= staleThreshold
          ) {
            return false
          }
          return true
        })

        return { rows: matched.slice(0, limit) }
      }

      // 2. Claim lease query
      if (
        trimmed.startsWith("update payment_attempt") &&
        (sql.includes("set reconciliation_locked_at = CURRENT_TIMESTAMP") ||
          sql.includes("set reconciliation_locked_at = ?"))
      ) {
        const targetId = String(bindings[0])
        const leaseDurationMs =
          typeof bindings[1] === "number"
            ? bindings[1]
            : Number(bindings[1]) || 15 * 60_000
        const staleThreshold = new Date(
          getDbNow().getTime() - leaseDurationMs
        ).toISOString()

        const idx = attemptRows.findIndex((a) => a.id === targetId)
        if (idx === -1) return { rows: [] }

        const row = attemptRows[idx]
        if (row.order_id != null) return { rows: [] }
        const hasFreeze =
          row.financial_freeze_started_at != null &&
          row.provider_canceled_confirmed_at == null
        const hasReason = row.reconciliation_reason_code != null
        if (!hasFreeze && !hasReason) return { rows: [] }

        if (
          row.reconciliation_locked_at != null &&
          row.reconciliation_locked_at >= staleThreshold
        ) {
          return { rows: [] }
        }

        const nowStr = getDbNow().toISOString()
        row.reconciliation_locked_at = nowStr
        row.updated_at = nowStr
        return { rows: [{ id: row.id }] }
      }

      // 3. Clear / release lease query (set reconciliation_locked_at = null)
      if (
        trimmed.startsWith("update payment_attempt") &&
        sql.includes("set reconciliation_locked_at = null")
      ) {
        const targetId = String(bindings[bindings.length - 1])
        const row = attemptRows.find((a) => a.id === targetId)
        if (row) {
          row.reconciliation_locked_at = null
          if (sql.includes("reconciliation_reason_code = coalesce")) {
            row.reconciliation_reason_code =
              row.reconciliation_reason_code ?? String(bindings[0])
          }
          const nowStr = getDbNow().toISOString()
          row.last_reconciliation_at = nowStr
          row.updated_at = nowStr
        }
        return { rows: [] }
      }

      // 4. Discovery claim query
      if (
        trimmed.startsWith("update payment_attempt") &&
        sql.includes("provider_discovery_started_at = CURRENT_TIMESTAMP")
      ) {
        const targetId = String(bindings[0])
        const row = attemptRows.find((a) => a.id === targetId)
        if (row && !row.provider_discovery_started_at) {
          row.provider_discovery_started_at = getDbNow().toISOString()
          return { rows: [{ ...row }] }
        }
        return { rows: [] }
      }

      // 5. CAS bind query
      if (
        trimmed.startsWith("update payment_attempt") &&
        sql.includes("provider_payment_session_id = coalesce")
      ) {
        const piId = String(bindings[0])
        const targetId = String(bindings[2])
        const row = attemptRows.find((a) => a.id === targetId)
        if (row) {
          row.provider_payment_intent_id = piId
          row.updated_at = getDbNow().toISOString()
          return { rows: [{ ...row }] }
        }
        return { rows: [] }
      }

      // 6. Thaw query (provider_canceled_confirmed_at)
      if (
        trimmed.startsWith("update payment_attempt") &&
        sql.includes("provider_canceled_confirmed_at = coalesce")
      ) {
        const targetId = String(bindings[0])
        const row = attemptRows.find((a) => a.id === targetId)
        if (row) {
          const nowStr = getDbNow().toISOString()
          row.provider_canceled_confirmed_at = nowStr
          row.canceled_at = nowStr
          row.status = "payment_canceled"
          row.updated_at = nowStr
          return { rows: [{ ...row }] }
        }
        return { rows: [] }
      }

      // 7. Durable reconciliation on payment_attempt
      if (
        trimmed.startsWith("update payment_attempt") &&
        sql.includes("reconciliation_reason_code = ?")
      ) {
        const targetId = String(bindings[2])
        const row = attemptRows.find((a) => a.id === targetId)
        if (row) {
          const nowStr = getDbNow().toISOString()
          row.reconciliation_reason_code = String(bindings[1])
          row.last_reconciliation_at = nowStr
          row.updated_at = nowStr
          return { rows: [{ ...row }] }
        }
        return { rows: [] }
      }

      // 8. CCL check
      if (sql.includes("select id from checkout_completion_log")) {
        const piId = String(bindings[0])
        const found = cclRows.find((c) => c.payment_intent_id === piId)
        return { rows: found ? [{ id: found.id }] : [] }
      }

      // 9. CCL insert
      if (trimmed.startsWith("insert into checkout_completion_log")) {
        cclRows.push({
          id: bindings[0],
          idempotency_key: bindings[1],
          cart_id: bindings[2],
          payment_intent_id: bindings[3],
          payment_attempt_id: bindings[4],
          status: "reconciliation_required",
          reconciliation_reason_code: bindings[5],
          last_reconciliation_at: getDbNow().toISOString(),
          error_code: bindings[6],
          error_message: bindings[7],
        })
        return { rows: [] }
      }

      // 10. General select
      if (trimmed.startsWith("select") && sql.includes("from payment_attempt")) {
        if (sql.includes("where id = ?")) {
          const targetId = String(bindings[0])
          const found = attemptRows.find((a) => a.id === targetId)
          return { rows: found ? [{ ...found }] : [] }
        }
        return { rows: attemptRows.map((a) => ({ ...a })) }
      }

      return { rows: [] }
    },
  }

  const connection: PaymentAttemptSqlConnection = {
    transaction: async <T>(
      cb: (trx: PaymentAttemptSqlTransaction) => Promise<T>
    ) => {
      return cb(fakeTrx)
    },
  }

  const logger = {
    logs,
    info: (msg: string, meta?: Record<string, unknown>) =>
      logs.push({ level: "info", msg, meta }),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      logs.push({ level: "warn", msg, meta }),
    error: (msg: string, meta?: Record<string, unknown>) =>
      logs.push({ level: "error", msg, meta }),
  }

  return { connection, attempts: attemptRows, ccls: cclRows, logger }
}

describe("payment attempt reconciler (FIN-03 / R4-HR02 / R4-HR04)", () => {
  it("R1: Unresolved freeze + provider retrieve returns canceled -> authoritative thaw -> status payment_canceled", async () => {
    const harness = createReconcilerHarness([buildMockAttempt()], {
      simulatedDbNow: new Date("2026-09-03T12:00:00.000Z"),
    })
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: "canceled",
      })),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.thawed).toBe(1)
    expect(result.errors).toBe(0)

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBe(
      "2026-09-03T12:00:00.000Z"
    )
    expect(updated.status).toBe("payment_canceled")
    expect(updated.reconciliation_locked_at).toBeNull()
  })

  it("R2: Unresolved freeze + provider retrieve returns succeeded -> records reconciliation_required -> freeze preserved", async () => {
    const harness = createReconcilerHarness([buildMockAttempt()], {
      simulatedDbNow: new Date("2026-09-03T12:00:00.000Z"),
    })
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: "succeeded",
      })),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.reconciled).toBe(1)
    expect(result.thawed).toBe(0)

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBeNull() // freeze preserved!
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(updated.reconciliation_locked_at).toBeNull()
    expect(harness.ccls.length).toBe(1)
    expect(harness.ccls[0].status).toBe("reconciliation_required")
  })

  it("R3: Unresolved freeze + provider retrieve returns requires_payment_method / open -> remains frozen, lease released, no thaw", async () => {
    const harness = createReconcilerHarness([buildMockAttempt()])
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: "requires_payment_method",
      })),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.thawed).toBe(0)
    expect(result.reconciled).toBe(0)
    expect(result.skipped).toBe(1)

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBeNull()
    expect(updated.reconciliation_locked_at).toBeNull()
  })

  it("R4: Attempt already thawed -> reconciler skips / noop", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_canceled_confirmed_at: "2026-09-03T10:30:00.000Z",
        status: "payment_canceled",
      }),
    ])
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(0)
    expect(result.thawed).toBe(0)
    expect(mockStripe.retrieve).not.toHaveBeenCalled()
  })

  it("R5: Attempt with order_id != null -> reconciler skips / noop", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        order_id: "order_existing_999",
      }),
    ])
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(0)
    expect(mockStripe.retrieve).not.toHaveBeenCalled()
  })

  it("R6: Concurrent reconciler workers -> claim lock (reconciliation_locked_at) prevents duplicate execution", async () => {
    const harness = createReconcilerHarness(
      [
        buildMockAttempt({
          reconciliation_locked_at: "2026-09-03T11:58:00.000Z",
        }),
      ],
      { simulatedDbNow: new Date("2026-09-03T12:00:00.000Z") }
    )
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(0)
    expect(result.thawed).toBe(0)
    expect(mockStripe.retrieve).not.toHaveBeenCalled()
  })

  it("R7: Stale lease (> 15 min) -> reconciler reclaims lease and processes attempt", async () => {
    const harness = createReconcilerHarness(
      [
        buildMockAttempt({
          reconciliation_locked_at: "2026-09-03T11:40:00.000Z", // 20 min ago
        }),
      ],
      { simulatedDbNow: new Date("2026-09-03T12:00:00.000Z") }
    )
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: "canceled",
      })),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.thawed).toBe(1)
    expect(mockStripe.retrieve).toHaveBeenCalledWith("pi_rec_01")
  })

  it("R8: Provider network error during retrieve -> lease released, attempt remains safely frozen, retriable", async () => {
    const harness = createReconcilerHarness([buildMockAttempt()])
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async () => {
        throw new Error("Stripe network timeout / unavailable")
      }),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.errors).toBe(1)
    expect(result.thawed).toBe(0)

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBeNull()
    expect(updated.reconciliation_locked_at).toBeNull() // lease released!
  })

  it("R9: Reconciliation action logs emitted durably", async () => {
    const harness = createReconcilerHarness([buildMockAttempt()])
    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: "canceled",
      })),
    }

    await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    const infoLogs = harness.logger.logs.filter((l) => l.level === "info")
    expect(infoLogs.length).toBeGreaterThanOrEqual(1)
    expect(infoLogs[0].msg).toBe("Payment attempt thawed by reconciler")
  })

  // --- Subagent C: R4-HR02 Provider Discovery In Reconciler Tests ---

  it("D1: Candidate with provider_payment_intent_id = null -> discovery returns 0 matches -> remains frozen, reason PROVIDER_DISCOVERY_UNRESOLVED", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_payment_intent_id: null,
      }),
    ])
    const searchMock = jest.fn(async () => ({
      data: [],
      has_more: false,
    }))
    const retrieveMock = jest.fn()

    const mockStripe: StripePaymentIntentsClientLike = {
      search: searchMock,
      retrieve: retrieveMock,
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.reconciled).toBe(1)
    expect(result.thawed).toBe(0)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).not.toHaveBeenCalled()

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBeNull()
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
    )
    expect(updated.reconciliation_locked_at).toBeNull()
  })

  it("D2: Candidate with provider_payment_intent_id = null -> discovery returns 1 match (canceled) -> CAS bind succeeds, candidate thaws", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_payment_intent_id: null,
      }),
    ])
    const discoveredIntent: StripePaymentIntentLike = {
      id: "pi_discovered_01",
      amount: 15000,
      currency: "brl",
      status: "canceled",
      payment_method_types: ["card"],
      metadata: {
        payment_attempt_id: "payatt_rec_01",
        cart_id: "cart_rec_01",
        session_id: "payses_rec_01",
      },
    }

    const searchMock = jest.fn(async () => ({
      data: [discoveredIntent],
      has_more: false,
    }))
    const retrieveMock = jest.fn(async (id: string) => ({
      id,
      status: "canceled",
    }))

    const mockStripe: StripePaymentIntentsClientLike = {
      search: searchMock,
      retrieve: retrieveMock,
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.thawed).toBe(1)
    expect(result.errors).toBe(0)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).toHaveBeenCalledWith("pi_discovered_01")

    const updated = harness.attempts[0]
    expect(updated.provider_payment_intent_id).toBe("pi_discovered_01")
    expect(updated.provider_canceled_confirmed_at).not.toBeNull()
    expect(updated.status).toBe("payment_canceled")
    expect(updated.reconciliation_locked_at).toBeNull()
  })

  it("D2-succeeded: Candidate with provider_payment_intent_id = null -> discovery returns 1 match (succeeded) -> CAS bind succeeds, durable reconciliation recorded, freeze preserved", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_payment_intent_id: null,
      }),
    ])
    const discoveredIntent: StripePaymentIntentLike = {
      id: "pi_discovered_02",
      amount: 15000,
      currency: "brl",
      status: "succeeded",
      payment_method_types: ["card"],
      metadata: {
        payment_attempt_id: "payatt_rec_01",
        cart_id: "cart_rec_01",
        session_id: "payses_rec_01",
      },
    }

    const searchMock = jest.fn(async () => ({
      data: [discoveredIntent],
      has_more: false,
    }))
    const retrieveMock = jest.fn(async (id: string) => ({
      id,
      status: "succeeded",
    }))

    const mockStripe: StripePaymentIntentsClientLike = {
      search: searchMock,
      retrieve: retrieveMock,
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.reconciled).toBe(1)
    expect(result.thawed).toBe(0)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).toHaveBeenCalledWith("pi_discovered_02")

    const updated = harness.attempts[0]
    expect(updated.provider_payment_intent_id).toBe("pi_discovered_02")
    expect(updated.provider_canceled_confirmed_at).toBeNull() // freeze preserved!
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(updated.reconciliation_locked_at).toBeNull()
    expect(harness.ccls.length).toBe(1)
    expect(harness.ccls[0].status).toBe("reconciliation_required")
  })

  it("D3: Candidate with provider_payment_intent_id = null -> discovery returns >1 matches -> remains frozen, reason RECONCILIATION_REQUIRED", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_payment_intent_id: null,
      }),
    ])
    const searchMock = jest.fn(async () => ({
      data: [
        {
          id: "pi_conflicting_01",
          amount: 15000,
          currency: "brl",
          status: "succeeded",
          payment_method_types: ["card"],
          metadata: { payment_attempt_id: "payatt_rec_01" },
        },
        {
          id: "pi_conflicting_02",
          amount: 15000,
          currency: "brl",
          status: "canceled",
          payment_method_types: ["card"],
          metadata: { payment_attempt_id: "payatt_rec_01" },
        },
      ],
      has_more: false,
    }))
    const retrieveMock = jest.fn()

    const mockStripe: StripePaymentIntentsClientLike = {
      search: searchMock,
      retrieve: retrieveMock,
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.reconciled).toBe(1)
    expect(result.thawed).toBe(0)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).not.toHaveBeenCalled()

    const updated = harness.attempts[0]
    expect(updated.provider_canceled_confirmed_at).toBeNull()
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.RECONCILIATION_REQUIRED
    )
    expect(updated.reconciliation_locked_at).toBeNull()
  })

  it("D4: Candidate with provider_payment_intent_id = null -> another worker already claimed discovery -> reconciler skips with 0 search calls", async () => {
    const harness = createReconcilerHarness([
      buildMockAttempt({
        provider_payment_intent_id: null,
        provider_discovery_started_at: "2026-09-03T11:59:00.000Z", // already claimed
      }),
    ])
    const searchMock = jest.fn()
    const retrieveMock = jest.fn()

    const mockStripe: StripePaymentIntentsClientLike = {
      search: searchMock,
      retrieve: retrieveMock,
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
    })

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(searchMock).not.toHaveBeenCalled()
    expect(retrieveMock).not.toHaveBeenCalled()
  })

  // --- Subagent E: R4-HR04 PostgreSQL Authority Proof Test ---

  it("R4-HR04 proof: Application clock skew (simulated +2 hours) has 0 impact on lease expiration or authority timestamps", async () => {
    const simulatedDbClock = new Date("2026-09-03T12:00:00.000Z")
    // Application thinks it is 2 hours in the future
    const skewedAppClock = () => new Date("2026-09-03T14:00:00.000Z")

    const harness = createReconcilerHarness(
      [
        buildMockAttempt({
          // Locked 5 minutes ago according to DB clock -> NOT stale
          reconciliation_locked_at: "2026-09-03T11:55:00.000Z",
        }),
      ],
      { simulatedDbNow: simulatedDbClock }
    )

    const mockStripe: StripePaymentIntentsClientLike = {
      retrieve: jest.fn(),
    }

    const result = await runPaymentAttemptReconciliation({
      connection: harness.connection,
      stripeClient: mockStripe,
      logger: harness.logger,
      now: skewedAppClock,
    })

    // Because DB clock is authoritative, 5-minute-old lease is NOT considered stale (15 min lease duration)
    // Application clock skew (+2h) did not cause false lease steal!
    expect(result.scanned).toBe(0)
    expect(mockStripe.retrieve).not.toHaveBeenCalled()
  })
})
