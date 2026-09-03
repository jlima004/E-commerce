import {
  applyStripePaymentIntentWebhookInTransaction,
  recordDurableReconciliationInTransaction,
} from "../transactional-authority"
import { RECONCILIATION_REASON_CODE } from "../../../reconciliation/reason-codes"
import type { PaymentAttemptRecord } from "../types"
import type { StripePaymentIntentWebhookObject } from "../service"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_succeeded_01",
    cart_id: "cart_succeeded_01",
    payment_collection_id: "paycol_succeeded_01",
    payment_session_id: "payses_succeeded_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_succeeded_01",
    provider_payment_session_id: "ps_succeeded_01",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 19900,
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

function createSucceededPaymentIntent(): StripePaymentIntentWebhookObject {
  return {
    id: "pi_succeeded_01",
    object: "payment_intent",
    amount: 19900,
    amount_received: 19900,
    currency: "brl",
    metadata: { cart_id: "cart_succeeded_01" },
    payment_method_types: ["card"],
  }
}

function createSucceededHarness(initialAttempt: PaymentAttemptRecord) {
  let attemptState = { ...initialAttempt }
  let cclState: Record<string, unknown> | null = null

  const executeRaw = async (sql: string, bindings: unknown[] = []) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }

    if (sql.includes("select id from checkout_completion_log")) {
      return { rows: cclState ? [{ id: cclState.id }] : [] }
    }

    if (sql.trimStart().startsWith("insert into checkout_completion_log")) {
      cclState = {
        id: bindings[0],
        idempotency_key: bindings[1],
        cart_id: bindings[2],
        payment_intent_id: bindings[3],
        payment_attempt_id: bindings[4],
        status: "reconciliation_required",
        reconciliation_reason_code: bindings[5],
        last_reconciliation_at: "2026-09-03T11:00:00.000Z",
        error_code: bindings[6],
        error_message: bindings[7],
      }
      return { rows: [] }
    }

    if (sql.trimStart().startsWith("update checkout_completion_log")) {
      if (cclState) {
        cclState = {
          ...cclState,
          status: "reconciliation_required",
          reconciliation_reason_code: bindings[0],
          last_reconciliation_at: "2026-09-03T11:00:00.000Z",
          error_code: bindings[1],
          error_message: bindings[2],
        }
      }
      return { rows: [] }
    }

    if (sql.trimStart().startsWith("select") && sql.includes("from payment_attempt")) {
      return { rows: [{ ...attemptState }] }
    }

    if (sql.trimStart().startsWith("update payment_attempt")) {
      if (sql.includes("reconciliation_reason_code = ?")) {
        attemptState = {
          ...attemptState,
          reconciliation_reason_code: bindings[1] as any,
          last_reconciliation_at: "2026-09-03T11:00:00.000Z",
          updated_at: "2026-09-03T11:00:00.000Z",
        }
        return { rows: [{ ...attemptState }] }
      }

      if (sql.includes("status = ?")) {
        attemptState = {
          ...attemptState,
          status: String(bindings[2]) as any,
          updated_at: String(bindings[bindings.length - 6] ?? bindings[3]),
        }
        return { rows: [{ ...attemptState }] }
      }

      return { rows: [{ ...attemptState }] }
    }

    return { rows: [] }
  }

  return {
    get attempt() {
      return attemptState
    },
    get ccl() {
      return cclState
    },
    transaction: { raw: executeRaw },
  }
}

describe("R4 Succeeded Finality Matrix (S1–S8)", () => {
  it("S1: normal canonical path: awaiting_webhook_confirmation -> transitions to payment_confirmed_by_webhook", async () => {
    const harness = createSucceededHarness(buildAttempt())

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("payment_confirmed_by_webhook")
    expect(updated.reconciliation_reason_code).toBeNull()
  })

  it("S2: locally invalidated (invalidated_by_cart_change) -> NOT ignored -> durable reconciliation recorded on PA and CCL", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "invalidated_by_cart_change",
        invalidated_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("invalidated_by_cart_change")
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(updated.last_reconciliation_at).not.toBeNull()
    expect(harness.ccl).not.toBeNull()
    expect(harness.ccl?.status).toBe("reconciliation_required")
    expect(harness.ccl?.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
  })

  it("S3: local payment_failed -> provider succeeded arrives -> NOT ignored -> durable reconciliation recorded", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "payment_failed",
        failed_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("payment_failed")
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(harness.ccl?.status).toBe("reconciliation_required")
  })

  it("S4: local payment_canceled -> provider succeeded arrives -> NOT ignored -> durable reconciliation recorded", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "payment_canceled",
        canceled_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("payment_canceled")
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(harness.ccl?.status).toBe("reconciliation_required")
  })

  it("S5: local pix_expired -> provider succeeded arrives -> NOT ignored -> durable reconciliation recorded", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "pix_expired",
        payment_method_type: "pix",
        expired_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("pix_expired")
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(harness.ccl?.status).toBe("reconciliation_required")
  })

  it("S6: local superseded -> provider succeeded arrives -> NOT ignored -> durable reconciliation recorded", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "superseded",
        superseded_at: "2026-09-03T10:05:00.000Z",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T11:00:00.000Z")
    )

    expect(updated.status).toBe("superseded")
    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT
    )
    expect(harness.ccl?.status).toBe("reconciliation_required")
  })

  it("S7: Order entrypoint ambiguity -> recordDurableReconciliationInTransaction sets ORDER_BIRTH_EXECUTION_AMBIGUOUS", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "payment_confirmed_by_webhook",
      })
    )

    const updated = await recordDurableReconciliationInTransaction(
      harness.transaction,
      {
        paymentAttemptId: harness.attempt.id,
        cartId: harness.attempt.cart_id,
        paymentIntentId: "pi_succeeded_01",
        reasonCode: RECONCILIATION_REASON_CODE.ORDER_BIRTH_EXECUTION_AMBIGUOUS,
        errorCode: "ORDER_BIRTH_EXECUTION_AMBIGUOUS",
        errorMessage: "Ambiguity during order creation",
      },
      new Date("2026-09-03T11:30:00.000Z")
    )

    expect(updated.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.ORDER_BIRTH_EXECUTION_AMBIGUOUS
    )
    expect(updated.last_reconciliation_at).not.toBeNull()
    expect(harness.ccl?.status).toBe("reconciliation_required")
    expect(harness.ccl?.reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.ORDER_BIRTH_EXECUTION_AMBIGUOUS
    )
  })

  it("S8: duplicate succeeded delivery on existing order -> returns attempt idempotently without second reconciliation", async () => {
    const harness = createSucceededHarness(
      buildAttempt({
        status: "payment_confirmed_by_webhook",
        order_id: "order_existing_123",
      })
    )

    const updated = await applyStripePaymentIntentWebhookInTransaction(
      harness.transaction,
      createSucceededPaymentIntent(),
      "payment_intent.succeeded",
      new Date("2026-09-03T12:00:00.000Z")
    )

    expect(updated.order_id).toBe("order_existing_123")
    expect(updated.reconciliation_reason_code).toBeNull()
    expect(harness.ccl).toBeNull()
  })
})
