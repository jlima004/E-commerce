import { RECONCILIATION_REASON_CODE } from "../../../reconciliation/reason-codes"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import {
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH,
  PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT,
  bindProviderPaymentIntentInTransaction,
  buildBindProviderPaymentIntentSql,
  buildClaimProviderDiscoverySql,
  buildPersistPreProviderFinancialFreezeSql,
  buildSameOperationReplayEligibleSql,
  claimProviderDiscoveryInTransaction,
  isSameOperationReplayEligibleInTransaction,
  persistPreProviderFinancialFreezeInTransaction,
  readDurablePreProviderAuthority,
} from "../transactional-authority"
import {
  discoverPaymentIntentsByPaymentAttemptId,
  type StripePaymentIntentsClient,
} from "../stripe-real"
import type { PaymentAttemptRecord } from "../types"
import type { StripePaymentIntentLike } from "../stripe-safe"

const DB_NOW = "2026-09-02T15:00:00.000Z"
const DB_REPLAY_DEADLINE = "2026-09-03T14:00:00.000Z"

type MockAttemptRow = PaymentAttemptRecord & { deleted_at?: string | null }

function completeV1(input: {
  method?: "card" | "pix"
  amount?: number
  session?: string | null
}) {
  return buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: input.method ?? "card",
    amount_minor: input.amount ?? 9900,
    cart_id: "cart_r1",
    cart_resource_version: 3,
    payment_attempt_id: "payatt_r1_001",
    payment_collection_id: "paycol_r1",
    payment_session_id: input.session === undefined ? "payses_r1" : input.session,
    authority_created_at: "2026-09-02T10:00:00.000Z",
    replay_deadline: DB_REPLAY_DEADLINE,
  })
}

function buildAttempt(overrides: Partial<MockAttemptRow> = {}): MockAttemptRow {
  const v1 = completeV1({})
  return {
    id: "payatt_r1_001",
    cart_id: "cart_r1",
    payment_collection_id: "paycol_r1",
    payment_session_id: "payses_r1",
    provider: "stripe",
    provider_payment_intent_id: null,
    provider_payment_session_id: null,
    payment_method_type: "card",
    status: "created",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: {
      cart_resource_version: 3,
      provider_idempotency_key: "payment-attempt:card:payatt_r1_001",
      payment_attempt_id: "payatt_r1_001",
      stripe_payment_intent_create: v1,
    },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    financial_freeze_started_at: "2026-09-02T10:00:00.000Z",
    provider_canceled_confirmed_at: null,
    provider_discovery_started_at: null,
    reconciliation_reason_code: null,
    reconciliation_locked_at: null,
    last_reconciliation_at: null,
    created_at: "2026-09-02T09:00:00.000Z",
    updated_at: "2026-09-02T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

function toRow(attempt: MockAttemptRow): Record<string, unknown> {
  const { deleted_at: _deletedAt, ...row } = attempt
  return { ...row }
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, " ").trim()
}

function matchingIntent(
  id: string,
  extras: Record<string, unknown> = {}
): StripePaymentIntentLike {
  return {
    id,
    amount: 9900,
    currency: "brl",
    payment_method_types: ["card"],
    metadata: {
      payment_attempt_id: "payatt_r1_001",
      cart_id: "cart_r1",
      session_id: "payses_r1",
    },
    ...extras,
  }
}

function createCasConnection(
  rows: MockAttemptRow[],
  options: { dbNow?: string } = {}
) {
  const capturedSql: string[] = []
  let dbNow = options.dbNow ?? DB_NOW
  let insertedAttempts = 0

  const executeRaw = async (sql: string, bindings: unknown[] = []) => {
    capturedSql.push(sql)
    const normalized = normalizeSql(sql)

    if (normalized.startsWith("select") && normalized.includes("replay_deadline")) {
      const id = String(bindings[0])
      const found = rows.find((row) => row.id === id)
      const blob = found?.metadata?.stripe_payment_intent_create as
        | { replay_deadline?: string }
        | undefined
      const deadline = blob?.replay_deadline
      const eligible =
        typeof deadline === "string" && Date.parse(dbNow) < Date.parse(deadline)
      return { rows: [{ eligible }] }
    }

    if (
      normalized.startsWith("select") &&
      normalized.includes("from payment_attempt") &&
      normalized.includes("where id = ?")
    ) {
      const id = String(bindings[0])
      const found = rows.find((row) => row.id === id)
      return { rows: found ? [toRow(found)] : [] }
    }

    if (
      normalized.startsWith("update payment_attempt") &&
      normalized.includes("provider_discovery_started_at = current_timestamp")
    ) {
      const id = String(bindings[0])
      const index = rows.findIndex(
        (row) => row.id === id && row.provider_discovery_started_at == null
      )
      if (index < 0) {
        return { rows: [] }
      }
      rows[index] = {
        ...rows[index],
        provider_discovery_started_at: dbNow,
        updated_at: dbNow,
      }
      return { rows: [toRow(rows[index])] }
    }

    if (
      normalized.startsWith("update payment_attempt") &&
      normalized.includes("provider_payment_intent_id = ?") &&
      normalized.includes("financial_freeze_started_at is not null")
    ) {
      const intentId = String(bindings[0])
      const id = String(bindings[2])
      const cartId = String(bindings[3])
      const amount = Number(bindings[5])
      const currency = String(bindings[6])
      const method = String(bindings[7])
      const index = rows.findIndex(
        (row) =>
          row.id === id &&
          row.cart_id === cartId &&
          row.amount === amount &&
          row.currency_code === currency &&
          row.payment_method_type === method &&
          row.financial_freeze_started_at != null &&
          row.provider_canceled_confirmed_at == null &&
          row.order_id == null &&
          (row.provider_payment_intent_id == null ||
            row.provider_payment_intent_id === intentId)
      )
      if (index < 0) {
        return { rows: [] }
      }
      const current = rows[index]
      rows[index] = {
        ...current,
        provider_payment_intent_id: intentId,
        provider_payment_session_id:
          current.provider_payment_session_id ??
          (bindings[1] as string | null),
        updated_at: dbNow,
      }
      return { rows: [toRow(rows[index])] }
    }

    if (
      normalized.startsWith("update payment_attempt") &&
      normalized.includes("financial_freeze_started_at = coalesce")
    ) {
      const id = String(bindings[bindings.length - 5])
      const index = rows.findIndex((row) => row.id === id)
      if (index < 0) {
        return { rows: [] }
      }
      const current = rows[index]
      const existingBlob = current.metadata?.stripe_payment_intent_create
      const keepBlob =
        existingBlob &&
        typeof existingBlob === "object" &&
        (existingBlob as { schema?: unknown }).schema ===
          "stripe_payment_intent_create"
      rows[index] = {
        ...current,
        financial_freeze_started_at:
          current.financial_freeze_started_at ?? dbNow,
        metadata: {
          ...(current.metadata ?? {}),
          cart_resource_version: Number(bindings[2]),
          provider_idempotency_key: String(bindings[3]),
          stripe_payment_intent_create: keepBlob
            ? existingBlob
            : completeV1({
                method: current.payment_method_type,
                amount: current.amount,
                session: current.payment_session_id,
              }),
        },
        updated_at: dbNow,
      }
      return { rows: [toRow(rows[index])] }
    }

    return { rows: [] }
  }

  return {
    capturedSql,
    insertAttempt: () => {
      insertedAttempts += 1
    },
    newPaymentAttemptCount: () => insertedAttempts,
    setDbNow: (value: string) => {
      dbNow = value
    },
    transaction: { raw: executeRaw },
    rows,
  }
}

describe("pre-provider CAS bind / discovery / replay", () => {
  it("bind SQL uses CURRENT_TIMESTAMP and preserves freeze/v1 columns", () => {
    const sql = buildBindProviderPaymentIntentSql()
    expect(sql).toContain("CURRENT_TIMESTAMP")
    expect(sql).not.toMatch(/Date\.now|new Date\(/)
    expect(sql).toContain("provider_payment_intent_id is null or provider_payment_intent_id = ?")
    expect(sql).toContain("financial_freeze_started_at is not null")
    expect(sql).not.toContain("stripe_payment_intent_create")
    expect(sql).not.toContain("financial_freeze_started_at =")
  })

  it("discovery CAS SQL stamps CURRENT_TIMESTAMP only when the column is NULL", () => {
    const sql = buildClaimProviderDiscoverySql()
    expect(sql).toContain("provider_discovery_started_at = CURRENT_TIMESTAMP")
    expect(sql).toContain("provider_discovery_started_at is null")
    expect(sql).not.toMatch(/Date\.now|new Date\(/)
  })

  it("replay eligibility SQL compares CURRENT_TIMESTAMP to persisted replay_deadline", () => {
    const sql = buildSameOperationReplayEligibleSql()
    expect(sql).toContain("CURRENT_TIMESTAMP")
    expect(sql).toContain("replay_deadline")
    expect(sql).not.toMatch(/Date\.now|new Date\(/)
    expect(buildPersistPreProviderFinancialFreezeSql()).toContain("interval '23 hours'")
  })

  it("CAS BIND: unbound null → pi_A PASS; same pi_A REUSE; different pi_B FAIL CLOSED", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows)
    const dateNowSpy = jest.spyOn(Date, "now")

    const first = await bindProviderPaymentIntentInTransaction(harness.transaction, {
      payment_attempt_id: "payatt_r1_001",
      cart_id: "cart_r1",
      amount_minor: 9900,
      currency_code: "brl",
      payment_method_type: "card",
      provider_payment_intent_id: "pi_A",
      payment_intent: matchingIntent("pi_A"),
    })
    expect(first.outcome).toBe("BOUND")
    expect(first.attempt.provider_payment_intent_id).toBe("pi_A")

    const reused = await bindProviderPaymentIntentInTransaction(harness.transaction, {
      payment_attempt_id: "payatt_r1_001",
      cart_id: "cart_r1",
      amount_minor: 9900,
      currency_code: "brl",
      payment_method_type: "card",
      provider_payment_intent_id: "pi_A",
      payment_intent: matchingIntent("pi_A"),
    })
    expect(reused.outcome).toBe("REUSED")
    expect(reused.attempt.provider_payment_intent_id).toBe("pi_A")

    await expect(
      bindProviderPaymentIntentInTransaction(harness.transaction, {
        payment_attempt_id: "payatt_r1_001",
        cart_id: "cart_r1",
        amount_minor: 9900,
        currency_code: "brl",
        payment_method_type: "card",
        provider_payment_intent_id: "pi_B",
        payment_intent: matchingIntent("pi_B"),
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT)
    expect(rows[0].provider_payment_intent_id).toBe("pi_A")
    expect(dateNowSpy).not.toHaveBeenCalled()
    dateNowSpy.mockRestore()
  })

  it("AUTHORITY IMMUTABILITY: bind while altering S/currency/cart/version/method/idempotency/digest fails closed", async () => {
    const rows = [buildAttempt()]
    const original = structuredClone(rows[0].metadata?.stripe_payment_intent_create)
    const harness = createCasConnection(rows)
    const mismatches = [
      { amount_minor: 1200 },
      { currency_code: "usd" as "brl" },
      { cart_id: "cart_other" },
      { cart_resource_version: 9 },
      { payment_method_type: "pix" as const },
      { idempotency_key: "payment-attempt:card:other" },
      { request_digest: "deadbeef" },
    ]

    for (const mismatch of mismatches) {
      await expect(
        bindProviderPaymentIntentInTransaction(harness.transaction, {
          payment_attempt_id: "payatt_r1_001",
          cart_id: "cart_r1",
          amount_minor: 9900,
          currency_code: "brl",
          payment_method_type: "card",
          provider_payment_intent_id: "pi_A",
          payment_intent: matchingIntent("pi_A"),
          ...mismatch,
        })
      ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
    }

    expect(rows[0].provider_payment_intent_id).toBeNull()
    expect(rows[0].metadata?.stripe_payment_intent_create).toEqual(original)
  })

  it("DISCOVERY CAS: first claimant gets DB timestamp; second does not overwrite", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows)
    const first = await claimProviderDiscoveryInTransaction(
      harness.transaction,
      "payatt_r1_001"
    )
    expect(first.claimed).toBe(true)
    expect(first.attempt.provider_discovery_started_at).toBe(DB_NOW)

    harness.setDbNow("2026-09-02T16:00:00.000Z")
    const second = await claimProviderDiscoveryInTransaction(
      harness.transaction,
      "payatt_r1_001"
    )
    expect(second.claimed).toBe(false)
    expect(second.attempt.provider_discovery_started_at).toBe(DB_NOW)
    expect(rows[0].provider_discovery_started_at).toBe(DB_NOW)
  })

  it("DISCOVERY ZERO: freeze remains, no thaw, new PA = 0, PROVIDER_DISCOVERY_UNRESOLVED", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows)
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({ data: [], has_more: false, next_page: null })),
    }

    const discovery = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )
    expect(discovery).toEqual({
      matches: [],
      unresolved: true,
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    })
    expect(rows[0].financial_freeze_started_at).toBe("2026-09-02T10:00:00.000Z")
    expect(rows[0].provider_canceled_confirmed_at).toBeNull()
    expect(rows[0].provider_payment_intent_id).toBeNull()
    expect(harness.newPaymentAttemptCount()).toBe(0)
    expect(paymentIntents.create).not.toHaveBeenCalled()
  })

  it("DISCOVERY ONE: validate and CAS bind, new PA = 0", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows)
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({
        data: [matchingIntent("pi_A")],
        has_more: false,
        next_page: null,
      })),
    }

    const discovery = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )
    expect(discovery.unresolved).toBe(false)
    expect(discovery.matches).toHaveLength(1)

    const bound = await bindProviderPaymentIntentInTransaction(harness.transaction, {
      payment_attempt_id: "payatt_r1_001",
      cart_id: "cart_r1",
      amount_minor: 9900,
      currency_code: "brl",
      payment_method_type: "card",
      provider_payment_intent_id: "pi_A",
      payment_intent: discovery.matches[0],
    })
    expect(bound.outcome).toBe("BOUND")
    expect(rows[0].provider_payment_intent_id).toBe("pi_A")
    expect(harness.newPaymentAttemptCount()).toBe(0)
    expect(paymentIntents.create).not.toHaveBeenCalled()
  })

  it("DISCOVERY MULTI: no bind, RECONCILIATION_REQUIRED", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows)
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({
        data: [matchingIntent("pi_A"), matchingIntent("pi_B")],
        has_more: false,
        next_page: null,
      })),
    }

    const discovery = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )
    expect(discovery).toMatchObject({
      reconciliation_required: true,
      reason: "RECONCILIATION_REQUIRED",
    })
    expect(discovery.matches).toHaveLength(2)
    expect(rows[0].provider_payment_intent_id).toBeNull()
    expect(harness.newPaymentAttemptCount()).toBe(0)
    expect(paymentIntents.create).not.toHaveBeenCalled()
  })

  it("REPLAY DEADLINE: eligible before T0+23h; after deadline fresh create is not allowed", async () => {
    const rows = [buildAttempt()]
    const harness = createCasConnection(rows, { dbNow: "2026-09-03T13:59:59.000Z" })
    const dateNowSpy = jest.spyOn(Date, "now")

    await expect(
      isSameOperationReplayEligibleInTransaction(harness.transaction, "payatt_r1_001")
    ).resolves.toEqual({ eligible: true })

    harness.setDbNow("2026-09-03T14:00:00.001Z")
    await expect(
      isSameOperationReplayEligibleInTransaction(harness.transaction, "payatt_r1_001")
    ).resolves.toEqual({
      eligible: false,
      reason: "REPLAY_DEADLINE_ELAPSED",
    })
    expect(dateNowSpy).not.toHaveBeenCalled()
    dateNowSpy.mockRestore()
    expect(
      harness.capturedSql.some((sql) => sql.includes("CURRENT_TIMESTAMP"))
    ).toBe(true)
  })

  it("readDurable fails closed when persisted v1 is incomplete", async () => {
    const rows = [
      buildAttempt({
        metadata: {
          cart_resource_version: 3,
          provider_idempotency_key: "payment-attempt:card:payatt_r1_001",
          stripe_payment_intent_create: {
            schema: "stripe_payment_intent_create",
            version: 1,
            authority_created_at: "2026-09-02T10:00:00.000Z",
            replay_deadline: DB_REPLAY_DEADLINE,
          },
        },
      }),
    ]
    const harness = createCasConnection(rows)
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_r1_001")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  })

  it("second persist keeps an already-valid v1 blob unchanged", async () => {
    const original = completeV1({})
    const rows = [
      buildAttempt({
        metadata: {
          cart_resource_version: 3,
          provider_idempotency_key: "payment-attempt:card:payatt_r1_001",
          payment_attempt_id: "payatt_r1_001",
          stripe_payment_intent_create: original,
        },
      }),
    ]
    const harness = createCasConnection(rows)
    await persistPreProviderFinancialFreezeInTransaction(harness.transaction, {
      cart_id: "cart_r1",
      cart_resource_version: 3,
      payment_method_type: "card",
      amount_minor: 9900,
      currency_code: "brl",
      payment_attempt_id: "payatt_r1_001",
    })
    expect(rows[0].metadata?.stripe_payment_intent_create).toEqual(original)
  })
})
