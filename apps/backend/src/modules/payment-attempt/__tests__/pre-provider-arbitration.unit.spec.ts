import { RECONCILIATION_REASON_CODE } from "../../../reconciliation/reason-codes"
import { buildPaymentAttemptProviderIdempotencyKey } from "../durable-initiation"
import {
  isUnresolvedFinancialFreeze,
  toPaymentAttemptFinancialAuthority,
} from "../financial-authority"
import {
  PRE_PROVIDER_ARBITRATION_DECISION,
  arbitratePreProviderPaymentAttempt,
  type PreProviderRequestedOperation,
} from "../pre-provider-arbitration"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import {
  PAYMENT_ATTEMPT_CART_VERSION_UNBOUND,
  PAYMENT_ATTEMPT_NOT_FOUND,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  buildListUnresolvedFrozenPaymentAttemptsForCartSql,
  buildPersistPreProviderFinancialFreezeSql,
  listUnresolvedFrozenPaymentAttemptsForCart,
  persistPreProviderFinancialFreezeInTransaction,
  readDurablePreProviderAuthority,
} from "../transactional-authority"
import type { PaymentAttemptRecord } from "../types"

type MockAttemptRow = PaymentAttemptRecord & {
  deleted_at?: string | null
}

const DB_NOW = "2026-09-02T15:00:00.000Z"
const DB_REPLAY_DEADLINE = "2026-09-03T14:00:00.000Z"

function buildAttempt(
  overrides: Partial<MockAttemptRow> = {}
): MockAttemptRow {
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
      stripe_payment_intent_create: {
        schema: "stripe_payment_intent_create",
        version: 1,
        authority_created_at: "2026-09-02T10:00:00.000Z",
        replay_deadline: "2026-09-03T09:00:00.000Z",
      },
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

function requested(
  overrides: Partial<PreProviderRequestedOperation> = {}
): PreProviderRequestedOperation {
  return {
    cart_id: "cart_r1",
    cart_resource_version: 3,
    payment_method_type: "card",
    amount_minor: 9900,
    currency_code: "brl",
    payment_attempt_id: "payatt_r1_001",
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

function applyUnresolvedFreezeSql(
  sql: string,
  rows: MockAttemptRow[],
  cartId: string
): MockAttemptRow[] {
  const normalized = normalizeSql(sql)
  let matched = rows.filter((row) => row.cart_id === cartId)

  if (normalized.includes("financial_freeze_started_at is not null")) {
    matched = matched.filter((row) => row.financial_freeze_started_at != null)
  }
  if (normalized.includes("provider_canceled_confirmed_at is null")) {
    matched = matched.filter((row) => row.provider_canceled_confirmed_at == null)
  }
  if (normalized.includes("order_id is null")) {
    matched = matched.filter((row) => row.order_id == null)
  }
  if (normalized.includes("deleted_at is null")) {
    matched = matched.filter((row) => row.deleted_at == null)
  }

  return matched
}

function hasValidAuthorityV1(metadata: Record<string, unknown> | null): boolean {
  const blob = metadata?.stripe_payment_intent_create
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) {
    return false
  }
  const record = blob as Record<string, unknown>
  return (
    record.schema === "stripe_payment_intent_create" &&
    (record.version === 1 || record.version === "1")
  )
}

function createAuthorityConnection(rows: MockAttemptRow[]) {
  const capturedSql: string[] = []
  let committed = false
  let providerTouched = false

  const executeRaw = async (sql: string, bindings: unknown[] = []) => {
    capturedSql.push(sql)
    const normalized = normalizeSql(sql)

    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }

    if (
      normalized.startsWith("select") &&
      normalized.includes("from payment_attempt") &&
      normalized.includes("financial_freeze_started_at is not null")
    ) {
      const cartId = String(bindings[0])
      return {
        rows: applyUnresolvedFreezeSql(sql, rows, cartId).map(toRow),
      }
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
      normalized.includes("financial_freeze_started_at = coalesce")
    ) {
      const id = String(bindings[bindings.length - 5])
      const cartId = String(bindings[bindings.length - 4])
      const method = String(bindings[bindings.length - 3])
      const amount = Number(bindings[bindings.length - 2])
      const currency = String(bindings[bindings.length - 1])
      const index = rows.findIndex(
        (row) =>
          row.id === id &&
          row.cart_id === cartId &&
          row.payment_method_type === method &&
          row.amount === amount &&
          row.currency_code === currency
      )
      if (index < 0) {
        return { rows: [] }
      }

      const current = rows[index]
      const keepBlob = hasValidAuthorityV1(current.metadata)
      const nextCollection =
        (bindings[0] as string | null) ?? current.payment_collection_id
      const nextSession =
        (bindings[1] as string | null) ?? current.payment_session_id
      const nextMetadata: Record<string, unknown> = {
        ...(current.metadata ?? {}),
        cart_resource_version: Number(bindings[2]),
        provider_idempotency_key: String(bindings[3]),
        payment_attempt_id: current.id,
        stripe_payment_intent_create: keepBlob
          ? (current.metadata as Record<string, unknown>).stripe_payment_intent_create
          : buildCompleteStripePaymentIntentCreateAuthorityV1({
              payment_method_type: current.payment_method_type,
              amount_minor: current.amount,
              cart_id: current.cart_id,
              cart_resource_version: Number(bindings[2]),
              payment_attempt_id: current.id,
              payment_collection_id: nextCollection,
              payment_session_id: nextSession,
              idempotency_key: String(bindings[3]),
              authority_created_at: DB_NOW,
              replay_deadline: DB_REPLAY_DEADLINE,
            }),
      }

      rows[index] = {
        ...current,
        payment_collection_id: nextCollection,
        payment_session_id: nextSession,
        financial_freeze_started_at:
          current.financial_freeze_started_at ?? DB_NOW,
        metadata: nextMetadata,
        updated_at: DB_NOW,
      }
      return { rows: [toRow(rows[index])] }
    }

    return { rows: [] }
  }

  const transaction = { raw: executeRaw }
  const connection = {
    transaction: async <T>(
      callback: (trx: typeof transaction) => Promise<T>
    ) => {
      const result = await callback(transaction)
      committed = true
      return result
    },
  }

  return {
    transaction,
    connection,
    capturedSql,
    isCommitted: () => committed,
    markProviderTouched: () => {
      providerTouched = true
    },
    providerWasTouched: () => providerTouched,
  }
}

describe("pre-provider arbitration", () => {
  it("A — frozen = 0 → NEW_ATTEMPT_ALLOWED", () => {
    expect(arbitratePreProviderPaymentAttempt([], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.NEW_ATTEMPT_ALLOWED,
    })
  })

  it("B — one exact same authority, provider bound → REUSE_SAME_OPERATION, new PA = 0", () => {
    const frozen = buildAttempt({
      provider_payment_intent_id: "pi_bound_r1",
    })
    const result = arbitratePreProviderPaymentAttempt([frozen], requested())
    expect(result).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.REUSE_SAME_OPERATION,
      attempt: frozen,
    })
    expect(result.decision === "REUSE_SAME_OPERATION" ? 0 : 1).toBe(0)
  })

  it("C — one exact same authority, provider unbound → DISCOVER_SAME_OPERATION, new PA = 0", () => {
    const frozen = buildAttempt({ provider_payment_intent_id: null })
    const result = arbitratePreProviderPaymentAttempt([frozen], requested())
    expect(result).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.DISCOVER_SAME_OPERATION,
      attempt: frozen,
    })
    expect(result.decision === "DISCOVER_SAME_OPERATION" ? 0 : 1).toBe(0)
  })

  it("omitted payment_attempt_id + matching cart/method/S/CRV + unbound PI → DISCOVER_SAME_OPERATION (new PA = 0)", () => {
    const frozen = buildAttempt({
      provider_payment_intent_id: null,
      metadata: {
        cart_resource_version: 3,
        provider_idempotency_key: "payment-attempt:card:payatt_r1_001",
        payment_attempt_id: "payatt_r1_001",
        stripe_payment_intent_create: buildCompleteStripePaymentIntentCreateAuthorityV1({
          payment_method_type: "card",
          amount_minor: 9900,
          cart_id: "cart_r1",
          cart_resource_version: 3,
          payment_attempt_id: "payatt_r1_001",
          payment_collection_id: "paycol_r1",
          payment_session_id: "payses_r1",
          authority_created_at: "2026-09-02T10:00:00.000Z",
          replay_deadline: "2026-09-03T09:00:00.000Z",
        }),
      },
    })
    const result = arbitratePreProviderPaymentAttempt(
      [frozen],
      requested({ payment_attempt_id: undefined })
    )
    expect(result).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.DISCOVER_SAME_OPERATION,
      attempt: frozen,
    })
    expect(result.decision === "DISCOVER_SAME_OPERATION" ? 0 : 1).toBe(0)
  })

  it("D — one frozen different S → RECONCILIATION_REQUIRED", () => {
    const frozen = buildAttempt({ amount: 8800 })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_r1_001"],
    })
  })

  it("E — one frozen different method → RECONCILIATION_REQUIRED", () => {
    const frozen = buildAttempt({ payment_method_type: "pix" })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_r1_001"],
    })
  })

  it("F — one frozen different CartResourceVersion → RECONCILIATION_REQUIRED", () => {
    const frozen = buildAttempt({
      metadata: {
        ...buildAttempt().metadata,
        cart_resource_version: 2,
      },
    })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_r1_001"],
    })
  })

  it("G — one frozen different idempotency/operation → RECONCILIATION_REQUIRED", () => {
    const frozen = buildAttempt({
      id: "payatt_other",
      metadata: {
        ...buildAttempt().metadata,
        provider_idempotency_key: "payment-attempt:card:payatt_other",
        payment_attempt_id: "payatt_other",
      },
    })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_other"],
    })
  })

  it("H — multiple unresolved → RECONCILIATION_REQUIRED + MULTIPLE_FROZEN_PAYMENT_ATTEMPTS", () => {
    const frozen = [
      buildAttempt(),
      buildAttempt({ id: "payatt_r1_002" }),
    ]
    expect(arbitratePreProviderPaymentAttempt(frozen, requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.MULTIPLE_FROZEN_PAYMENT_ATTEMPTS,
      frozen_attempt_ids: ["payatt_r1_001", "payatt_r1_002"],
    })
  })

  it("legacy freeze without authority v1 is not the same operation", () => {
    const frozen = buildAttempt({
      reconciliation_reason_code:
        RECONCILIATION_REASON_CODE.LEGACY_PROVIDER_DISPATCH_UNKNOWN,
      metadata: { cart_resource_version: 3 },
    })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_r1_001"],
    })
  })

  it("persisted request-authority blob that disagrees yields PROVIDER_REQUEST_AUTHORITY_MISMATCH", () => {
    const frozen = buildAttempt({
      metadata: {
        ...buildAttempt().metadata,
        stripe_payment_intent_create: {
          schema: "stripe_payment_intent_create",
          version: 1,
          amount_minor: 1200,
          authority_created_at: "2026-09-02T10:00:00.000Z",
          replay_deadline: "2026-09-03T09:00:00.000Z",
        },
      },
    })
    expect(arbitratePreProviderPaymentAttempt([frozen], requested())).toEqual({
      decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
      reason_code: RECONCILIATION_REASON_CODE.PROVIDER_REQUEST_AUTHORITY_MISMATCH,
      frozen_attempt_ids: ["payatt_r1_001"],
    })
  })

  it("local payment_failed does not bypass unresolved freeze identity", () => {
    const frozen = buildAttempt({
      status: "payment_failed",
      amount: 1100,
    })
    expect(
      isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(frozen))
    ).toBe(true)
    expect(arbitratePreProviderPaymentAttempt([frozen], requested()).decision).toBe(
      PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED
    )
  })
})

describe("listUnresolvedFrozenPaymentAttemptsForCart", () => {
  it("SQL omits deleted_at IS NULL and keeps the unresolved freeze predicate", () => {
    const sql = buildListUnresolvedFrozenPaymentAttemptsForCartSql(true)
    const normalized = normalizeSql(sql)
    expect(normalized).toContain("financial_freeze_started_at is not null")
    expect(normalized).toContain("provider_canceled_confirmed_at is null")
    expect(normalized).toContain("order_id is null")
    expect(normalized).not.toContain("deleted_at is null")
    expect(normalized).not.toContain("deleted_at")
  })

  it("I — frozen but provider_canceled_confirmed_at set is not unresolved", async () => {
    const rows = [
      buildAttempt({
        id: "payatt_thawed",
        provider_canceled_confirmed_at: "2026-09-02T12:00:00.000Z",
      }),
    ]
    const harness = createAuthorityConnection(rows)
    const listed = await listUnresolvedFrozenPaymentAttemptsForCart(
      harness.transaction,
      "cart_r1"
    )
    expect(listed).toEqual([])
    expect(normalizeSql(harness.capturedSql.join(" "))).toContain(
      "provider_canceled_confirmed_at is null"
    )
  })

  it("returns soft-deleted frozen rows when they match the freeze predicate", async () => {
    const rows = [
      buildAttempt({
        deleted_at: "2026-09-02T12:00:00.000Z",
        status: "payment_canceled",
      }),
    ]
    const harness = createAuthorityConnection(rows)
    const listed = await listUnresolvedFrozenPaymentAttemptsForCart(
      harness.transaction,
      "cart_r1"
    )
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe("payatt_r1_001")
    expect(normalizeSql(harness.capturedSql[0])).not.toContain("deleted_at is null")
  })

  it("does not let local Pix expiry bypass unresolved freeze", async () => {
    const rows = [buildAttempt({ status: "pix_expired", payment_method_type: "pix" })]
    const harness = createAuthorityConnection(rows)
    const listed = await listUnresolvedFrozenPaymentAttemptsForCart(
      harness.transaction,
      "cart_r1"
    )
    expect(listed).toHaveLength(1)
    expect(
      isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(listed[0]))
    ).toBe(true)
  })
})

describe("persistPreProviderFinancialFreezeInTransaction", () => {
  it("uses PostgreSQL CURRENT_TIMESTAMP and a 23 hour replay interval, not Date.now()", () => {
    const sql = buildPersistPreProviderFinancialFreezeSql()
    expect(sql).toContain("CURRENT_TIMESTAMP")
    expect(sql).toContain("interval '23 hours'")
    expect(sql).not.toMatch(/Date\.now|new Date\(/)
    for (const field of [
      "schema",
      "version",
      "operation",
      "provider",
      "authority_created_at",
      "payment_method_type",
      "amount_minor",
      "currency_code",
      "cart_id",
      "cart_resource_version",
      "payment_attempt_id",
      "payment_collection_id",
      "payment_session_id",
      "idempotency_key",
      "provider_payment_intent_id",
      "canonical_request",
      "request_digest",
      "replay_deadline",
      "payment_method_options",
    ]) {
      expect(sql).toContain(`'${field}'`)
    }
  })

  it("persists freeze with DB time and COMMITs without provider access", async () => {
    const rows = [
      buildAttempt({
        financial_freeze_started_at: null,
        metadata: {
          payment_attempt_id: "payatt_r1_001",
        },
        payment_session_id: null,
      }),
    ]
    const harness = createAuthorityConnection(rows)
    const dateNowSpy = jest.spyOn(Date, "now")

    const persisted = await harness.connection.transaction((transaction) =>
      persistPreProviderFinancialFreezeInTransaction(transaction, {
        ...requested(),
        payment_attempt_id: "payatt_r1_001",
        payment_collection_id: "paycol_r1",
      })
    )

    expect(dateNowSpy).not.toHaveBeenCalled()
    dateNowSpy.mockRestore()
    expect(harness.isCommitted()).toBe(true)
    expect(harness.providerWasTouched()).toBe(false)
    expect(persisted.financial_freeze_started_at).toBe(DB_NOW)
    expect(persisted.metadata).toMatchObject({
      cart_resource_version: 3,
      provider_idempotency_key: "payment-attempt:card:payatt_r1_001",
      stripe_payment_intent_create: {
        schema: "stripe_payment_intent_create",
        version: 1,
        authority_created_at: DB_NOW,
        replay_deadline: DB_REPLAY_DEADLINE,
      },
    })
    expect(persisted.payment_session_id).toBeNull()
    expect(
      harness.capturedSql.some((sql) =>
        normalizeSql(sql).includes("financial_freeze_started_at = coalesce")
      )
    ).toBe(true)
    expect(
      harness.capturedSql.some((sql) => sql.includes("CURRENT_TIMESTAMP"))
    ).toBe(true)
    expect(
      harness.capturedSql.some((sql) => sql.includes("interval '23 hours'"))
    ).toBe(true)
  })

  it("fails closed when CartResourceVersion is missing", async () => {
    const rows = [
      buildAttempt({
        financial_freeze_started_at: null,
        metadata: null,
      }),
    ]
    const harness = createAuthorityConnection(rows)
    await expect(
      persistPreProviderFinancialFreezeInTransaction(harness.transaction, {
        ...requested(),
        payment_attempt_id: "payatt_r1_001",
        cart_resource_version: undefined as never,
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)
  })

  it("fails closed when the target PaymentAttempt is missing", async () => {
    const harness = createAuthorityConnection([])
    await expect(
      persistPreProviderFinancialFreezeInTransaction(
        harness.transaction,
        requested({ payment_attempt_id: "payatt_missing" }) as never
      )
    ).rejects.toThrow(PAYMENT_ATTEMPT_NOT_FOUND)
  })

  it("does not retroactively assign authority v1 onto a legacy freeze", async () => {
    const rows = [
      buildAttempt({
        metadata: { cart_resource_version: 3 },
        reconciliation_reason_code:
          RECONCILIATION_REASON_CODE.LEGACY_PROVIDER_DISPATCH_UNKNOWN,
      }),
    ]
    const harness = createAuthorityConnection(rows)
    await expect(
      persistPreProviderFinancialFreezeInTransaction(
        harness.transaction,
        requested({ payment_attempt_id: "payatt_r1_001" }) as never
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH")
  })

  it("re-reads durable authority after persist in the same transaction", async () => {
    const rows = [
      buildAttempt({
        financial_freeze_started_at: null,
        metadata: { payment_attempt_id: "payatt_r1_001" },
      }),
    ]
    const harness = createAuthorityConnection(rows)
    const authority = await harness.connection.transaction(async (transaction) => {
      await persistPreProviderFinancialFreezeInTransaction(transaction, {
        ...requested(),
        payment_attempt_id: "payatt_r1_001",
      })
      return readDurablePreProviderAuthority(transaction, "payatt_r1_001")
    })

    expect(authority.cart_resource_version).toBe(3)
    expect(authority.amount_minor).toBe(9900)
    expect(authority.currency_code).toBe("brl")
    expect(authority.payment_method_type).toBe("card")
    expect(authority.provider_idempotency_key).toBe(
      "payment-attempt:card:payatt_r1_001"
    )
    expect(authority.financial_freeze_started_at).toBe(DB_NOW)
    expect(authority.authority_created_at).toBe(DB_NOW)
    expect(authority.replay_deadline).toBe(DB_REPLAY_DEADLINE)
  })

  it("readDurable fails closed when freeze timestamps are incomplete", async () => {
    const rows = [
      buildAttempt({
        financial_freeze_started_at: null,
        metadata: { cart_resource_version: 3 },
      }),
    ]
    const harness = createAuthorityConnection(rows)
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_r1_001")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  })
})

describe("pre-provider idempotency key", () => {
  it("payatt_r1_001 / card = payment-attempt:card:payatt_r1_001", () => {
    expect(
      buildPaymentAttemptProviderIdempotencyKey("card", "payatt_r1_001")
    ).toBe("payment-attempt:card:payatt_r1_001")
  })

  it("payatt_r1_001 / pix = payment-attempt:pix:payatt_r1_001", () => {
    expect(
      buildPaymentAttemptProviderIdempotencyKey("pix", "payatt_r1_001")
    ).toBe("payment-attempt:pix:payatt_r1_001")
  })
})
