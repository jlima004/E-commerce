import {
  applyStripePaymentIntentWebhookInTransaction,
  invalidatePaymentAttemptsForCartChangeInTransaction,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH,
  readDurablePreProviderAuthority,
} from "../transactional-authority"
import { createStructuralCartInvalidationRunner } from "../../checkout/shipping-invalidation"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import type { PaymentAttemptRecord } from "../types"
import type { StripePaymentIntentWebhookObject } from "../service"

const DB_REPLAY_DEADLINE = "2026-09-03T14:00:00.000Z"

type ProbeState = {
  cartItems: string[]
  resourceVersion: number
  attempt: PaymentAttemptRecord
}

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_hr01_01",
    cart_id: "cart_hr01_01",
    payment_collection_id: "paycol_hr01_01",
    payment_session_id: "payses_hr01_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_hr01_01",
    provider_payment_session_id: "ps_hr01_01",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: { cart_resource_version: 1 },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-08-22T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-08-22T09:00:00.000Z",
    updated_at: "2026-08-22T09:00:00.000Z",
    ...overrides,
  }
}

function toRow(attempt: PaymentAttemptRecord): Record<string, unknown> {
  return { ...attempt }
}

function paymentIntent(): StripePaymentIntentWebhookObject {
  return {
    id: "pi_hr01_01",
    object: "payment_intent",
    amount: 9900,
    amount_received: 9900,
    currency: "brl",
    metadata: { cart_id: "cart_hr01_01" },
    payment_method_types: ["card"],
  }
}

function createProbe(state: ProbeState, blockFirstLock = false) {
  let lockHeld = false
  let firstLockSeen = false
  let firstLockReached: (() => void) | undefined
  let releaseFirstLock: (() => void) | undefined
  const firstLockReachedPromise = new Promise<void>((resolve) => {
    firstLockReached = resolve
  })
  const firstLockReleasePromise = new Promise<void>((resolve) => {
    releaseFirstLock = resolve
  })

  const acquire = async () => {
    if (lockHeld) {
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (!lockHeld) {
            resolve()
          } else {
            queueMicrotask(poll)
          }
        }
        poll()
      })
    }
    lockHeld = true
    if (!firstLockSeen) {
      firstLockSeen = true
      firstLockReached?.()
      if (blockFirstLock) {
        await firstLockReleasePromise
      }
    }
  }

  const release = () => {
    lockHeld = false
  }

  const executeRaw = async (
    sql: string,
    bindings: unknown[] = [],
    owner: { writes: number } = { writes: 0 }
  ) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      await acquire()
      return { rows: [] }
    }

    if (sql.includes("select cart_id from payment_attempt")) {
      return { rows: [{ cart_id: state.attempt.cart_id }] }
    }

    if (sql.includes("from store_resource_version")) {
      return { rows: [{ version: state.resourceVersion }] }
    }

    if (sql.includes("checkout_completion_log")) {
      return { rows: [] }
    }

    if (sql.trimStart().startsWith("select") && sql.includes("from payment_attempt")) {
      return { rows: [toRow(state.attempt)] }
    }

      if (sql.trimStart().startsWith("update payment_attempt")) {
        owner.writes += 1
        if (sql.includes("invalidated_by_cart_change")) {
          state.attempt = {
            ...state.attempt,
            status: "invalidated_by_cart_change",
            invalidated_at: String(bindings[0]),
            updated_at: String(bindings[1]),
          }
        } else if (sql.includes("reconciliation_reason_code = ?")) {
          state.attempt = {
            ...state.attempt,
            reconciliation_reason_code: String(bindings[1]) as any,
            last_reconciliation_at: String(bindings[2]),
            updated_at: String(bindings[3]),
          }
        } else {
          const usesDurableBinding = sql.includes(
            "set provider_payment_intent_id"
          )
          const statusIndex = usesDurableBinding ? 2 : 0
          const updatedAtIndex = usesDurableBinding
            ? sql.includes("failed_at") || sql.includes("canceled_at")
              ? 4
              : 3
            : 1
          state.attempt = {
            ...state.attempt,
            provider_payment_intent_id: usesDurableBinding
              ? String(bindings[0])
              : state.attempt.provider_payment_intent_id,
            provider_payment_session_id: usesDurableBinding
              ? bindings[1] === null || bindings[1] === undefined
                ? state.attempt.provider_payment_session_id
                : String(bindings[1])
              : state.attempt.provider_payment_session_id,
            status: String(bindings[statusIndex]) as PaymentAttemptRecord["status"],
            updated_at: String(bindings[updatedAtIndex]),
          }
        }
      return { rows: [toRow(state.attempt)] }
    }

    return { rows: [] }
  }

  const transaction = { raw: executeRaw }
  const connection = {
    transaction: async <T>(callback: (trx: typeof transaction) => Promise<T>) => {
      const owner = { writes: 0 }
      const trx = {
        raw: (sql: string, bindings: unknown[] = []) =>
          executeRaw(sql, bindings, owner),
      }
      const snapshot = structuredClone(state)
      try {
        return await callback(trx)
      } catch (error) {
        if (owner.writes > 0) {
          Object.assign(state, snapshot)
        }
        throw error
      } finally {
        release()
      }
    },
  }

  return {
    transaction,
    connection,
    waitForFirstLock: firstLockReachedPromise,
    releaseFirstLock: () => releaseFirstLock?.(),
  }
}

describe("PaymentAttempt/cart/webhook Order authority HR-01", () => {
  it("invalidação failure rolls back cart mutation e resource-version increment", async () => {
    const state: ProbeState = {
      cartItems: ["line_before"],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    const probe = createProbe(state)
    const runner = createStructuralCartInvalidationRunner()

    await expect(
      probe.connection.transaction(async (transaction) => {
        state.cartItems.push("line_new")
        state.resourceVersion += 1
        await runner(state.attempt.cart_id, new Date("2026-08-22T11:00:00.000Z"), {
          transaction,
          invalidateShippingQuote: async () => {
            throw new Error("SHIPPING_INVALIDATION_FAILED")
          },
        })
      })
    ).rejects.toThrow("SHIPPING_INVALIDATION_FAILED")

    expect(state.cartItems).toEqual(["line_before"])
    expect(state.resourceVersion).toBe(1)
    expect(state.attempt.status).toBe("awaiting_webhook_confirmation")
  })

  it("successful structural mutation invalidates the active attempt under the shared authority", async () => {
    const state: ProbeState = {
      cartItems: ["line_before"],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    const probe = createProbe(state)

    await probe.connection.transaction(async (transaction) => {
      await invalidatePaymentAttemptsForCartChangeInTransaction(
        transaction,
        state.attempt.cart_id,
        new Date("2026-08-22T11:00:00.000Z")
      )
    })

    expect(state.attempt.status).toBe("invalidated_by_cart_change")
    expect(state.attempt.order_id).toBeNull()
  })

  it("falha closed quando há mais de uma tentativa ativa ou uma tentativa com Order authority", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt({ order_id: "order_hr01_01" }),
    }
    const probe = createProbe(state)

    await expect(
      probe.connection.transaction((transaction) =>
        invalidatePaymentAttemptsForCartChangeInTransaction(
          transaction,
          state.attempt.cart_id,
          new Date("2026-08-22T11:00:00.000Z")
        )
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS")
  })

  it("webhook concorrente não ressuscita tentativa invalidada depois de um read stale", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    // The invalidation owns the shared lock first; the webhook starts from a
    // stale pre-lock read and must observe the committed invalidated state
    // only after the invalidation releases the lock.
    const probe = createProbe(state, true)
    const invalidation = probe.connection.transaction((transaction) =>
      invalidatePaymentAttemptsForCartChangeInTransaction(
        transaction,
        state.attempt.cart_id,
        new Date("2026-08-22T11:00:00.000Z")
      )
    )

    await probe.waitForFirstLock
    const webhook = probe.connection.transaction((transaction) =>
      applyStripePaymentIntentWebhookInTransaction(
        transaction,
        paymentIntent(),
        "payment_intent.succeeded",
        new Date("2026-08-22T11:00:01.000Z")
      )
    )
    probe.releaseFirstLock()

    await invalidation
    const updated = await webhook
    expect(updated.status).toBe("invalidated_by_cart_change")
    expect(updated.reconciliation_reason_code).toBe(
      "LATE_SUCCEEDED_AUTHORITY_CONFLICT"
    )
    expect(state.attempt.status).toBe("invalidated_by_cart_change")
    expect(state.attempt.reconciliation_reason_code).toBe(
      "LATE_SUCCEEDED_AUTHORITY_CONFLICT"
    )
  })

  it("correlaciona webhook com tentativa provisional antes do finalize local", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt({
        id: "payatt_provisional",
        provider_payment_intent_id: null,
        provider_payment_session_id: null,
        status: "created",
        payment_method_type: "card",
        payment_session_id: "payses_provisional",
        metadata: {
          payment_attempt_id: "payatt_provisional",
          cart_id: "cart_hr01_01",
        },
      }),
    }
    const probe = createProbe(state)
    const intent = {
      ...paymentIntent(),
      id: "pi_bound_before_finalize",
      metadata: {
        cart_id: state.attempt.cart_id,
        payment_attempt_id: state.attempt.id,
        session_id: state.attempt.payment_session_id,
      },
    }

    const updated = await probe.connection.transaction((transaction) =>
      applyStripePaymentIntentWebhookInTransaction(
        transaction,
        intent,
        "payment_intent.succeeded",
        new Date("2026-08-22T11:00:01.000Z")
      )
    )

    expect(updated.status).toBe("payment_confirmed_by_webhook")
    expect(updated.provider_payment_intent_id).toBe("pi_bound_before_finalize")
    expect(state.attempt.provider_payment_intent_id).toBe(
      "pi_bound_before_finalize"
    )
    expect(state.attempt.status).toBe("payment_confirmed_by_webhook")
  })

  it("rejeita identidade de tentativa divergente sem vincular o PaymentIntent", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt({
        provider_payment_intent_id: null,
        status: "created",
        metadata: { payment_attempt_id: "payatt_hr01_01" },
      }),
    }
    const probe = createProbe(state)

    await expect(
      probe.connection.transaction((transaction) =>
        applyStripePaymentIntentWebhookInTransaction(
          transaction,
          {
            ...paymentIntent(),
            id: "pi_mismatched",
            metadata: {
              cart_id: state.attempt.cart_id,
              payment_attempt_id: "payatt_other",
            },
          },
          "payment_intent.succeeded",
          new Date("2026-08-22T11:00:01.000Z")
        )
      )
    ).rejects.toMatchObject({
      code: "PAYMENT_ATTEMPT_CORRELATION_MISMATCH",
    })
    expect(state.attempt.provider_payment_intent_id).toBeNull()
    expect(state.attempt.status).toBe("created")
  })
})

function completeV1(input: {
  method?: "card" | "pix"
  collection?: string | null
  session?: string | null
}) {
  return buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: input.method ?? "card",
    amount_minor: 9900,
    cart_id: "cart_id_seal",
    cart_resource_version: 3,
    payment_attempt_id: "payatt_id_seal",
    payment_collection_id:
      input.collection === undefined ? "paycol_A" : input.collection,
    payment_session_id: input.session === undefined ? "payses_A" : input.session,
    authority_created_at: "2026-09-02T10:00:00.000Z",
    replay_deadline: DB_REPLAY_DEADLINE,
  })
}

function buildFrozenAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  const method = overrides.payment_method_type ?? "card"
  const v1 = completeV1({
    method,
    collection: "paycol_A",
    session: method === "pix" ? null : "payses_A",
  })
  return {
    id: "payatt_id_seal",
    cart_id: "cart_id_seal",
    payment_collection_id: "paycol_A",
    payment_session_id: method === "pix" ? null : "payses_A",
    provider: "stripe",
    provider_payment_intent_id: null,
    provider_payment_session_id: null,
    payment_method_type: method,
    status: "created",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: {
      cart_resource_version: 3,
      provider_idempotency_key: `payment-attempt:${method}:payatt_id_seal`,
      payment_attempt_id: "payatt_id_seal",
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
    ...overrides,
  }
}

function createIdentitySealHarness(attempt: PaymentAttemptRecord) {
  const state = { attempt }
  const transaction = {
    raw: async (sql: string, bindings: unknown[] = []) => {
      if (
        sql.trimStart().startsWith("select") &&
        sql.includes("from payment_attempt")
      ) {
        return { rows: [{ ...state.attempt }] }
      }
      return { rows: [] }
    },
  }
  return { transaction, state }
}

describe("readDurablePreProviderAuthority local identity seal", () => {
  it("U1 — Card exact identities", async () => {
    const harness = createIdentitySealHarness(buildFrozenAttempt())
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).resolves.toMatchObject({
      payment_method_type: "card",
      amount_minor: 9900,
    })
  })

  it("U2 — Card collection mismatch", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({ payment_collection_id: "paycol_B" })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U3 — Card session mismatch", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({ payment_session_id: "payses_B" })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U4 — Card null session mismatch", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({ payment_session_id: null })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U5 — Pix exact", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({
        payment_method_type: "pix",
        payment_session_id: null,
      })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).resolves.toMatchObject({
      payment_method_type: "pix",
    })
  })

  it("U6 — Pix collection mismatch", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({
        payment_method_type: "pix",
        payment_collection_id: "paycol_B",
        payment_session_id: null,
      })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U7 — Pix invented/non-null session", async () => {
    const harness = createIdentitySealHarness(
      buildFrozenAttempt({
        payment_method_type: "pix",
        payment_session_id: "payses_fake",
      })
    )
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U8 — reverse Pix session mismatch", async () => {
    const attempt = buildFrozenAttempt({
      payment_method_type: "pix",
      payment_session_id: null,
    })
    attempt.metadata = {
      ...attempt.metadata,
      stripe_payment_intent_create: completeV1({
        method: "pix",
        collection: "paycol_A",
        session: "payses_fake",
      }),
    }
    const harness = createIdentitySealHarness(attempt)
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  })

  it("U9 — null PaymentCollection on Card durable reread", async () => {
    // Intentional corrupt fixture for U9: production PaymentAttemptRecord.payment_collection_id is string.
    const attempt = buildFrozenAttempt({
      payment_collection_id: null as unknown as string,
    })
    const harness = createIdentitySealHarness(attempt)
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  })

  it("U9 — null PaymentCollection on Pix durable reread", async () => {
    // Intentional corrupt fixture for U9: production PaymentAttemptRecord.payment_collection_id is string.
    const attempt = buildFrozenAttempt({
      payment_method_type: "pix",
      payment_collection_id: null as unknown as string,
      payment_session_id: null,
    })
    const harness = createIdentitySealHarness(attempt)
    await expect(
      readDurablePreProviderAuthority(harness.transaction, "payatt_id_seal")
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  })
})
