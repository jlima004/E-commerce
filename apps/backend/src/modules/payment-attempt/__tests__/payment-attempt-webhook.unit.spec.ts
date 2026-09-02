import { isPaymentAttemptActive } from "../state-machine"
import {
  PaymentAttemptWebhookError,
  applyStripePaymentIntentWebhookToAttempt,
  findPaymentAttemptForWebhook,
  validatePaymentIntentForAttempt,
  type StripePaymentIntentWebhookObject,
  type SupportedStripePaymentIntentEventType,
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

function assertPaymentAmountMismatch(
  attempt: PaymentAttemptRecord,
  paymentIntent: StripePaymentIntentWebhookObject,
  eventType: SupportedStripePaymentIntentEventType = "payment_intent.succeeded"
): void {
  try {
    validatePaymentIntentForAttempt(attempt, paymentIntent, eventType)
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

  it("recupera tentativa provisional pela identidade duravel do webhook", () => {
    const provisional = buildAttempt({
      id: "payatt_provisional",
      provider_payment_intent_id: null,
      status: "created",
    })

    expect(
      findPaymentAttemptForWebhook(
        [provisional],
        "pi_recovered",
        { payment_attempt_id: provisional.id }
      )
    ).toBe(provisional)
  })

  it("rejeita conflito entre identidade duravel e provider id", () => {
    const providerAttempt = buildAttempt({ id: "payatt_provider" })
    const durableAttempt = buildAttempt({
      id: "payatt_durable",
      provider_payment_intent_id: null,
      status: "created",
    })

    expect(() =>
      findPaymentAttemptForWebhook(
        [providerAttempt, durableAttempt],
        providerAttempt.provider_payment_intent_id as string,
        { payment_attempt_id: durableAttempt.id }
      )
    ).toThrow("As identidades do PaymentIntent nao correspondem à mesma tentativa.")
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

  it("compara Stripe amount com PaymentAttempt.amount 9900 sem reconstruir cart.total", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ amount: 9900 }),
        buildPaymentIntent({ amount: 9900, amount_received: 9900 }),
        "payment_intent.succeeded"
      )
    ).not.toThrow()
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

  it("succeeded aceita amount e amount_received 11000 iguais ao PaymentAttempt", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ amount: 11000 }),
        buildPaymentIntent({
          amount: 11000,
          amount_received: 11000,
        }),
        "payment_intent.succeeded"
      )
    ).not.toThrow()
  })

  it("succeeded rejeita amount_received 10999 quando amount e PaymentAttempt sao 11000", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: 11000,
        amount_received: 10999,
      })
    )
  })

  it("succeeded rejeita zero em amount, amount_received e PaymentAttempt", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 0 }),
      buildPaymentIntent({
        amount: 0,
        amount_received: 0,
      })
    )
  })

  it("succeeded rejeita PaymentIntent.amount zero com amount_received igual ao PaymentAttempt", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: 0,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita amount_received zero quando amount e PaymentAttempt sao 11000", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: 11000,
        amount_received: 0,
      })
    )
  })

  it("succeeded rejeita amount divergente mesmo com amount_received igual ao PaymentAttempt", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: 10999,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita PaymentAttempt.amount acima do inteiro seguro", () => {
    assertPaymentAmountMismatch(
      buildAttempt({
        amount: (Number.MAX_SAFE_INTEGER + 1) as unknown as number,
      }),
      buildPaymentIntent({
        amount: 11000,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita PaymentAttempt.amount string acima do inteiro seguro", () => {
    assertPaymentAmountMismatch(
      buildAttempt({
        amount: "9007199254740992" as unknown as number,
      }),
      buildPaymentIntent({
        amount: 11000,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita PaymentIntent.amount acima do inteiro seguro", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: Number.MAX_SAFE_INTEGER + 1,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita amount_received acima do inteiro seguro", () => {
    assertPaymentAmountMismatch(
      buildAttempt({ amount: 11000 }),
      buildPaymentIntent({
        amount: 11000,
        amount_received: Number.MAX_SAFE_INTEGER + 1,
      })
    )
  })

  it("aceita amount string do Postgres 11000 contra PaymentIntent inteiro da Stripe", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({
          amount: "11000" as unknown as number,
        }),
        buildPaymentIntent({ amount: 11000, amount_received: 11000 }),
        "payment_intent.succeeded"
      )
    ).not.toThrow()
  })

  it("succeeded aceita amount e amount_received no limite MAX_SAFE_INTEGER", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ amount: Number.MAX_SAFE_INTEGER }),
        buildPaymentIntent({
          amount: Number.MAX_SAFE_INTEGER,
          amount_received: Number.MAX_SAFE_INTEGER,
        }),
        "payment_intent.succeeded"
      )
    ).not.toThrow()
  })

  it("succeeded rejeita PaymentIntent sem amount valido", () => {
    const attempt = buildAttempt({ amount: 11000 })

    assertPaymentAmountMismatch(
      attempt,
      buildPaymentIntent({
        amount: undefined,
        amount_received: 11000,
      })
    )

    assertPaymentAmountMismatch(
      attempt,
      buildPaymentIntent({
        amount: 11000.5,
        amount_received: 11000,
      })
    )
  })

  it("succeeded rejeita PaymentIntent sem amount_received valido", () => {
    const attempt = buildAttempt({ amount: 11000 })
    const basePaymentIntent = buildPaymentIntent({
      amount: 11000,
    })

    assertPaymentAmountMismatch(attempt, {
      ...basePaymentIntent,
      amount_received: undefined,
    })

    assertPaymentAmountMismatch(attempt, {
      ...basePaymentIntent,
      amount_received: null,
    })

    assertPaymentAmountMismatch(attempt, {
      ...basePaymentIntent,
      amount_received: 11000.5,
    })
  })

  it("payment_failed nao rejeita quando amount_received e zero", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ amount: 11000 }),
        buildPaymentIntent({
          amount: 11000,
          amount_received: 0,
        }),
        "payment_intent.payment_failed"
      )
    ).not.toThrow()
  })

  it("payment_intent.canceled nao rejeita quando amount_received e zero", () => {
    expect(() =>
      validatePaymentIntentForAttempt(
        buildAttempt({ amount: 11000 }),
        buildPaymentIntent({
          amount: 11000,
          amount_received: 0,
        }),
        "payment_intent.canceled"
      )
    ).not.toThrow()
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
