import { isPaymentAttemptActive } from "../state-machine"
import {
  PaymentAttemptWebhookError,
  applyStripePaymentIntentWebhookToAttempt,
  findPaymentAttemptForWebhook,
  validatePaymentIntentForAttempt,
  type StripePaymentIntentWebhookObject,
} from "../service"
import type { PaymentAttemptRecord } from "../types"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_123",
    provider_payment_session_id: "ps_123",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-06-30T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-30T09:00:00.000Z",
    updated_at: "2026-06-30T09:30:00.000Z",
    ...overrides,
  }
}

function buildPaymentIntent(
  overrides: Partial<StripePaymentIntentWebhookObject> = {}
): StripePaymentIntentWebhookObject {
  return {
    id: "pi_123",
    object: "payment_intent",
    amount: 9900,
    amount_received: 9900,
    currency: "brl",
    metadata: {
      cart_id: "cart_01",
    },
    payment_method_types: ["card"],
    ...overrides,
  }
}

describe("payment attempt webhook state", () => {
  it("trata payment_confirmed_by_webhook como estado ativo", () => {
    expect(isPaymentAttemptActive("payment_confirmed_by_webhook")).toBe(true)
  })

  it("confirma tentativa para payment_confirmed_by_webhook", () => {
    const updated = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt({ status: "payment_client_confirmed" }),
      buildPaymentIntent(),
      "payment_intent.succeeded"
    )

    expect(updated.status).toBe("payment_confirmed_by_webhook")
    expect(updated.order_id).toBeNull()
  })

  it("marca tentativa como payment_failed", () => {
    const updated = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt(),
      buildPaymentIntent(),
      "payment_intent.payment_failed",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(updated.status).toBe("payment_failed")
    expect(updated.failed_at).toBe("2026-06-30T12:00:00.000Z")
    expect(updated.order_id).toBeNull()
  })

  it("marca tentativa como payment_canceled", () => {
    const updated = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt({ status: "awaiting_pix_payment", payment_method_type: "pix" }),
      buildPaymentIntent({
        payment_method_types: ["pix"],
      }),
      "payment_intent.canceled",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(updated.status).toBe("payment_canceled")
    expect(updated.canceled_at).toBe("2026-06-30T12:00:00.000Z")
    expect(updated.order_id).toBeNull()
  })

  it("trata status alvo igual como idempotente", () => {
    const confirmed = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt({
        status: "payment_confirmed_by_webhook",
        order_id: null,
      }),
      buildPaymentIntent(),
      "payment_intent.succeeded"
    )

    expect(confirmed.status).toBe("payment_confirmed_by_webhook")
    expect(confirmed.order_id).toBeNull()

    const failed = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt({
        status: "payment_failed",
        order_id: null,
      }),
      buildPaymentIntent(),
      "payment_intent.payment_failed",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(failed.status).toBe("payment_failed")
    expect(failed.order_id).toBeNull()

    const canceled = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt({
        status: "payment_canceled",
        payment_method_type: "pix",
        order_id: null,
      }),
      buildPaymentIntent({
        payment_method_types: ["pix"],
      }),
      "payment_intent.canceled",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(canceled.status).toBe("payment_canceled")
    expect(canceled.order_id).toBeNull()
  })
})

describe("payment attempt webhook validation", () => {
  it("falha quando tentativa nao existe", () => {
    expect(() => findPaymentAttemptForWebhook([], "pi_missing")).toThrow(
      "Tentativa nao encontrada para o PaymentIntent."
    )
  })

  it("nao reativa tentativa terminal", () => {
    expect(() =>
      applyStripePaymentIntentWebhookToAttempt(
        buildAttempt({ status: "payment_failed" }),
        buildPaymentIntent(),
        "payment_intent.succeeded"
      )
    ).toThrow(PaymentAttemptWebhookError)

    try {
      applyStripePaymentIntentWebhookToAttempt(
        buildAttempt({ status: "payment_failed" }),
        buildPaymentIntent(),
        "payment_intent.succeeded"
      )
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentAttemptWebhookError)
      expect((error as PaymentAttemptWebhookError).code).toBe(
        "PAYMENT_ATTEMPT_WEBHOOK_STALE"
      )
      expect((error as PaymentAttemptWebhookError).webhookDisposition).toBe(
        "ignored"
      )
    }
  })

  it("rejeita amount divergente", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt(),
        buildPaymentIntent({ amount: 10000, amount_received: 10000 }),
        "payment_intent.succeeded"
      )
    ).toThrow("Amount do PaymentIntent divergente da tentativa.")
  })

  it("aceita amount string do Postgres contra PaymentIntent inteiro da Stripe", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({
          amount: "9900" as unknown as number,
        }),
        buildPaymentIntent({ amount: 9900, amount_received: 9900 }),
        "payment_intent.succeeded"
      )
    ).not.toThrow()
  })

  it("rejeita amount string divergente com PAYMENT_ATTEMPT_AMOUNT_MISMATCH", () => {
    try {
      validatePaymentIntentForAttempt(
        buildAttempt({
          amount: "9901" as unknown as number,
        }),
        buildPaymentIntent({ amount: 9900, amount_received: 9900 }),
        "payment_intent.succeeded"
      )
      throw new Error("expected validation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentAttemptWebhookError)
      expect((error as PaymentAttemptWebhookError).code).toBe(
        "PAYMENT_ATTEMPT_AMOUNT_MISMATCH"
      )
      expect((error as PaymentAttemptWebhookError).message).toBe(
        "Amount do PaymentIntent divergente da tentativa."
      )
    }
  })

  it("rejeita currency divergente", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt(),
        buildPaymentIntent({ currency: "usd" }),
        "payment_intent.succeeded"
      )
    ).toThrow("Currency do PaymentIntent divergente da tentativa.")
  })

  it("rejeita cart divergente", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt(),
        buildPaymentIntent({ metadata: { cart_id: "cart_02" } }),
        "payment_intent.succeeded"
      )
    ).toThrow("Cart do PaymentIntent divergente da tentativa.")
  })

  it("rejeita metodo divergente", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ payment_method_type: "pix" }),
        buildPaymentIntent({ payment_method_types: ["card"] }),
        "payment_intent.succeeded"
      )
    ).toThrow("Metodo de pagamento do PaymentIntent incompativel com a tentativa.")
  })

  it("trata replay do mesmo evento terminal como idempotente", () => {
    const failed = applyStripePaymentIntentWebhookToAttempt(
      buildAttempt(),
      buildPaymentIntent(),
      "payment_intent.payment_failed",
      new Date("2026-06-30T12:00:00.000Z")
    )

    const replayed = applyStripePaymentIntentWebhookToAttempt(
      failed,
      buildPaymentIntent(),
      "payment_intent.payment_failed",
      new Date("2026-06-30T12:05:00.000Z")
    )

    expect(replayed.status).toBe("payment_failed")
    expect(replayed.order_id).toBeNull()
  })

  it("mantem stale/ignored quando evento diferente tenta reativar estado terminal", () => {
    expect(() =>
      applyStripePaymentIntentWebhookToAttempt(
        buildAttempt({ status: "payment_failed" }),
        buildPaymentIntent(),
        "payment_intent.succeeded"
      )
    ).toThrow("Tentativa nao pode ser atualizada pelo webhook atual.")
  })
})
