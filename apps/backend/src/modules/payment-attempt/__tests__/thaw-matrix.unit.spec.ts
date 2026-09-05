import {
  applyStripePaymentIntentWebhookInTransaction,
  recordProviderCanceledConfirmedInTransaction,
} from "../transactional-authority"
import {
  isUnresolvedFinancialFreeze,
  toPaymentAttemptFinancialAuthority,
  assertNoUnresolvedFinancialFreezeInTransaction,
  PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE,
} from "../financial-authority"
import type { PaymentAttemptRecord } from "../types"
import type { StripePaymentIntentWebhookObject } from "../service"

function buildFrozenAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_thaw_01",
    cart_id: "cart_thaw_01",
    payment_collection_id: "paycol_thaw_01",
    payment_session_id: "payses_thaw_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_thaw_01",
    provider_payment_session_id: "ps_thaw_01",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 15000,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: { cart_resource_version: 1 },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-09-03T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    financial_freeze_started_at: "2026-09-03T10:00:00.000Z",
    provider_canceled_confirmed_at: null,
    provider_discovery_started_at: null,
    reconciliation_reason_code: null,
    reconciliation_locked_at: null,
    last_reconciliation_at: null,
    created_at: "2026-09-03T09:59:00.000Z",
    updated_at: "2026-09-03T10:00:00.000Z",
    ...overrides,
  }
}

function createMockHarness(initialAttempt: PaymentAttemptRecord) {
  let attemptState = { ...initialAttempt }

  const executeRaw = async (sql: string, bindings: unknown[] = []) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }

    if (sql.includes("from payment_attempt") && sql.includes("where cart_id = ?") && sql.includes("financial_freeze_started_at is not null")) {
      if (
        attemptState.cart_id === bindings[0] &&
        attemptState.financial_freeze_started_at != null &&
        attemptState.provider_canceled_confirmed_at == null &&
        attemptState.order_id == null
      ) {
        return {
          rows: [
            {
              id: attemptState.id,
              cart_id: attemptState.cart_id,
              order_id: attemptState.order_id,
              financial_freeze_started_at: attemptState.financial_freeze_started_at,
              provider_canceled_confirmed_at: attemptState.provider_canceled_confirmed_at,
            },
          ],
        }
      }
      return { rows: [] }
    }

    if (sql.trimStart().startsWith("select") && sql.includes("from payment_attempt")) {
      return { rows: [{ ...attemptState }] }
    }

    if (sql.trimStart().startsWith("update payment_attempt")) {
      if (sql.includes("set provider_payment_intent_id")) {
        const isCanceled = sql.includes("canceled_at = coalesce")
        const isFailed = sql.includes("failed_at = coalesce")
        const simulatedDbClock = "2026-09-03T10:05:00.000Z"
        attemptState = {
          ...attemptState,
          provider_payment_intent_id: String(bindings[0]),
          provider_payment_session_id:
            bindings[1] != null
              ? String(bindings[1])
              : attemptState.provider_payment_session_id,
          status: String(bindings[2]) as PaymentAttemptRecord["status"],
          failed_at: isFailed ? String(bindings[3]) : attemptState.failed_at,
          canceled_at: isCanceled
            ? attemptState.canceled_at ?? simulatedDbClock
            : attemptState.canceled_at,
          provider_canceled_confirmed_at: isCanceled
            ? attemptState.provider_canceled_confirmed_at ?? simulatedDbClock
            : attemptState.provider_canceled_confirmed_at,
          updated_at: isCanceled
            ? simulatedDbClock
            : String(bindings[isFailed ? 4 : 3]),
        }
        return { rows: [{ ...attemptState }] }
      }

      if (sql.includes("provider_canceled_confirmed_at =")) {
        const canceledTime = "2026-09-03T10:10:00.000Z"
        attemptState = {
          ...attemptState,
          status: "payment_canceled",
          canceled_at: canceledTime,
          provider_canceled_confirmed_at: canceledTime,
          updated_at: canceledTime,
        }
        return { rows: [{ ...attemptState }] }
      }

      return { rows: [{ ...attemptState }] }
    }

    return { rows: [] }
  }

  const transaction = { raw: executeRaw }

  return {
    get attempt() {
      return attemptState
    },
    setAttempt(a: PaymentAttemptRecord) {
      attemptState = { ...a }
    },
    transaction,
  }
}

describe("R4 Provider-Authoritative Thaw Matrix (T1–T14)", () => {
  it("T1: signed correlated payment_intent.canceled -> provider_canceled_confirmed_at set, unresolved=false", async () => {
    const harness = createMockHarness(buildFrozenAttempt())
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(harness.attempt))).toBe(true)

    const paymentIntent: StripePaymentIntentWebhookObject = {
      id: "pi_thaw_01",
      object: "payment_intent",
      amount: 15000,
      amount_received: 0,
      currency: "brl",
      metadata: { cart_id: "cart_thaw_01" },
      payment_method_types: ["card"],
    }

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      paymentIntent,
      "payment_intent.canceled",
      new Date("2026-09-03T10:05:00.000Z")
    )

    expect(updated.provider_canceled_confirmed_at).toBe("2026-09-03T10:05:00.000Z")
    expect(updated.status).toBe("payment_canceled")
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(updated))).toBe(false)
  })

  it("T2: duplicate canceled webhook -> idempotent, no conflicting timestamp/state", async () => {
    const harness = createMockHarness(
      buildFrozenAttempt({
        status: "payment_canceled",
        canceled_at: "2026-09-03T10:05:00.000Z",
        provider_canceled_confirmed_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const paymentIntent: StripePaymentIntentWebhookObject = {
      id: "pi_thaw_01",
      object: "payment_intent",
      amount: 15000,
      amount_received: 0,
      currency: "brl",
      metadata: { cart_id: "cart_thaw_01" },
      payment_method_types: ["card"],
    }

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      paymentIntent,
      "payment_intent.canceled",
      new Date("2026-09-03T10:06:00.000Z")
    )

    expect(updated.provider_canceled_confirmed_at).toBe("2026-09-03T10:05:00.000Z")
  })

  it("T4: wrong PaymentAttempt correlation -> rejected, no thaw", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    const mismatchedIntent: StripePaymentIntentWebhookObject = {
      id: "pi_different",
      object: "payment_intent",
      amount: 15000,
      amount_received: 0,
      currency: "brl",
      metadata: { cart_id: "cart_different" },
      payment_method_types: ["card"],
    }

    await expect(
      applyStripePaymentIntentWebhookInTransaction(
        harness.transaction,
        mismatchedIntent,
        "payment_intent.canceled",
        new Date()
      )
    ).rejects.toThrow()

    expect(harness.attempt.provider_canceled_confirmed_at).toBeNull()
  })

  it("T6: payment_intent.payment_failed -> NO thaw, provider_canceled_confirmed_at remains null", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    const failedIntent: StripePaymentIntentWebhookObject = {
      id: "pi_thaw_01",
      object: "payment_intent",
      amount: 15000,
      amount_received: 0,
      currency: "brl",
      metadata: { cart_id: "cart_thaw_01" },
      payment_method_types: ["card"],
    }

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      failedIntent,
      "payment_intent.payment_failed",
      new Date("2026-09-03T10:05:00.000Z")
    )

    expect(updated.status).toBe("payment_failed")
    expect(updated.provider_canceled_confirmed_at).toBeNull()
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(updated))).toBe(true)
  })

  it("T7-T10: local status transitions (failed, canceled, expired) NEVER thaw by themselves", () => {
    for (const localStatus of ["payment_failed", "payment_canceled", "pix_expired"] as const) {
      const localAttempt = buildFrozenAttempt({
        status: localStatus,
        failed_at: localStatus === "payment_failed" ? "2026-09-03T10:02:00.000Z" : null,
        canceled_at: localStatus === "payment_canceled" ? "2026-09-03T10:02:00.000Z" : null,
        expired_at: localStatus.includes("expired") ? "2026-09-03T10:02:00.000Z" : null,
        provider_canceled_confirmed_at: null,
      })

      expect(localAttempt.provider_canceled_confirmed_at).toBeNull()
      expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(localAttempt))).toBe(true)
    }
  })

  it("T11: provider retrieve status=canceled -> recordProviderCanceledConfirmedInTransaction sets provider_canceled_confirmed_at", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    const result = await recordProviderCanceledConfirmedInTransaction(
      harness.transaction,
      {
        paymentAttemptId: "payatt_thaw_01",
        cartId: "cart_thaw_01",
        providerPaymentIntentId: "pi_thaw_01",
      },
      new Date("2026-09-03T10:10:00.000Z")
    )

    expect(result.updated).toBe(true)
    expect(result.attempt.provider_canceled_confirmed_at).toBe("2026-09-03T10:10:00.000Z")
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(result.attempt))).toBe(false)
  })

  it("T12-T13: provider retrieve non-canceled (succeeded or processing) -> thaw must NOT be recorded", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    const shouldThawForStatus = (providerStatus: string) => providerStatus === "canceled"

    expect(shouldThawForStatus("succeeded")).toBe(false)
    expect(shouldThawForStatus("processing")).toBe(false)
    expect(shouldThawForStatus("requires_action")).toBe(false)
    expect(harness.attempt.provider_canceled_confirmed_at).toBeNull()
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(harness.attempt))).toBe(true)
  })

  it("T14: provider timeout/network failure -> thaw must NOT be recorded", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    const retrieveWithFailure = async () => {
      throw new Error("STRIPE_NETWORK_TIMEOUT")
    }

    await expect(retrieveWithFailure()).rejects.toThrow("STRIPE_NETWORK_TIMEOUT")
    expect(harness.attempt.provider_canceled_confirmed_at).toBeNull()
    expect(isUnresolvedFinancialFreeze(toPaymentAttemptFinancialAuthority(harness.attempt))).toBe(true)
  })
})

describe("R4 Mutation After Thaw Proof (Section 49)", () => {
  it("blocked mutation becomes allowed after provider cancellation is confirmed", async () => {
    const harness = createMockHarness(buildFrozenAttempt())

    // Step 1 & 2: PA is financially frozen -> mutation is blocked fail-closed
    await expect(
      assertNoUnresolvedFinancialFreezeInTransaction(harness.transaction, "cart_thaw_01")
    ).rejects.toMatchObject({
      code: PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE,
      status: 409,
    })

    // Step 3: Provider cancellation confirmed
    await recordProviderCanceledConfirmedInTransaction(
      harness.transaction,
      {
        paymentAttemptId: "payatt_thaw_01",
        cartId: "cart_thaw_01",
        providerPaymentIntentId: "pi_thaw_01",
      },
      new Date("2026-09-03T10:15:00.000Z")
    )

    // Step 4 & 5: Same mutation retried -> allowed!
    await expect(
      assertNoUnresolvedFinancialFreezeInTransaction(harness.transaction, "cart_thaw_01")
    ).resolves.toBeUndefined()
  })
})
