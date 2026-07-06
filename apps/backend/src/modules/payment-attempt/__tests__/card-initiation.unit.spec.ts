import { MedusaError } from "@medusajs/framework/utils"
import { sanitizeError } from "../../../observability/sanitize"
import {
  markCardClientConfirmed,
  startCardPaymentAttempt,
  type CardPaymentAttemptResponse,
  type StripeCardInitiationLayer,
} from "../card"
import type { PaymentAttemptRecord } from "../types"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"

function mockRawStripeCardPaymentIntent(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "pi_card_init_mock",
    object: "payment_intent",
    status: "requires_payment_method",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_card_init_mock_secret_synthetic",
    metadata: {
      cart_id: "cart_guest_01",
      session_id: "payses_init_mock",
    },
    payment_method: { id: "pm_raw", type: "card" },
    next_action: { type: "use_stripe_sdk" },
    ...overrides,
  }
}

function createStripeLayer(
  rawIntent: Record<string, unknown> = mockRawStripeCardPaymentIntent()
): StripeCardInitiationLayer {
  return {
    createCardPaymentIntent: jest.fn(async () => rawIntent),
  }
}

function createSyntheticStripeCardLayer(): StripeCardInitiationLayer {
  return {
    async createCardPaymentIntent(request) {
      const suffix = request.idempotency_key.replace(/[^a-z0-9]/gi, "").slice(-8)

      return {
        id: `pi_synthetic_${suffix}`,
        object: "payment_intent",
        status: "requires_payment_method",
        amount: request.amount,
        currency: request.currency_code,
        client_secret: `pi_synthetic_${suffix}_secret_synthetic`,
        metadata: {
          cart_id: request.cart_id,
          session_id: `payses_synthetic_${suffix}`,
        },
      }
    },
  }
}

function existingActiveAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_existing",
    cart_id: "cart_guest_01",
    payment_collection_id: "paycol_old",
    payment_session_id: "payses_old",
    provider: "stripe_safe_layer",
    provider_payment_intent_id: "pi_old",
    provider_payment_session_id: "payses_old",
    payment_method_type: "card",
    status: "card_client_secret_created",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-29T10:00:00.000Z",
    updated_at: "2026-06-29T10:00:00.000Z",
    ...overrides,
  }
}

function assertResponseHasClientSecretOnlyInImmediate(
  response: CardPaymentAttemptResponse
) {
  expect(response.client_secret).toMatch(/_secret_/)
  expect(Object.keys(response).sort()).toEqual(
    [
      "amount",
      "client_secret",
      "currency_code",
      "payment_attempt_id",
      "payment_method_type",
      "provider_payment_intent_id",
      "status",
    ].sort()
  )
}

describe("04-04 startCardPaymentAttempt", () => {
  const completeCart = buildCompleteGuestCart({
    id: "cart_guest_01",
    total: 9900,
  })

  it("deriva amount/currency do cart e retorna client_secret somente na resposta", async () => {
    const stripeLayer = createStripeLayer()
    const result = await startCardPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      generatePaymentCollectionId: () => "paycol_new_01",
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    assertResponseHasClientSecretOnlyInImmediate(result.response)
    expect(result.response.amount).toBe(9900)
    expect(result.response.currency_code).toBe("BRL")
    expect(result.response.status).toBe("card_client_secret_created")
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9900,
        currency_code: "brl",
        cart_id: completeCart.id,
      })
    )
  })

  it("PaymentAttempt persiste apenas IDs seguros e metadata saneada — sem client_secret", async () => {
    const stripeLayer = createStripeLayer()
    const result = await startCardPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      generatePaymentCollectionId: () => "paycol_new_01",
    })

    expect(result.attempt.order_id).toBeNull()
    expect(result.attempt.provider).toBe("stripe")
    expect(result.attempt.metadata?.stripe_initiation_layer).toBe(
      "stripe_safe_layer"
    )
    expect(result.attempt.provider_payment_intent_id).toBe("pi_card_init_mock")
    expect(result.attempt.amount).toBe(9900)
    expect(result.attempt.currency_code).toBe("brl")
    expect(result.attempt).not.toHaveProperty("client_secret")
    expect(JSON.stringify(result.attempt.metadata)).not.toMatch(/_secret_/)
  })

  it("PaymentSession.data mockado e allowlist-only", async () => {
    const stripeLayer = createStripeLayer()
    const result = await startCardPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      generatePaymentCollectionId: () => "paycol_new_01",
    })

    expect(result.paymentSessionData).not.toHaveProperty("client_secret")
    expect(result.paymentSessionData).not.toHaveProperty("next_action")
    expect(result.paymentSessionData).not.toHaveProperty("payment_method")
    expect(result.paymentSessionData).toEqual(
      expect.objectContaining({
        provider_payment_intent_id: "pi_card_init_mock",
        amount: 9900,
        currency_code: "brl",
      })
    )
  })

  it("supersede tentativa ativa anterior do mesmo cart", async () => {
    const stripeLayer = createStripeLayer()
    const result = await startCardPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [existingActiveAttempt()],
      stripeLayer,
      generateId: () => "payatt_new_01",
      generatePaymentCollectionId: () => "paycol_new_01",
    })

    expect(result.supersededAttempts).toHaveLength(1)
    expect(result.supersededAttempts[0]?.status).toBe("superseded")
    expect(result.attempt.status).toBe("card_client_secret_created")
  })

  it("rejeita cart incompleto via eligibility de 04-03", async () => {
    const incompleteCart = buildCompleteGuestCart({
      id: "cart_guest_01",
      email: null,
      total: 9900,
    })

    await expect(
      startCardPaymentAttempt({
        cart: incompleteCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: incompleteCart.id,
        existingAttempts: [],
        stripeLayer: createStripeLayer(),
        generateId: () => "payatt_new_01",
        generatePaymentCollectionId: () => "paycol_new_01",
      })
    ).rejects.toThrow(MedusaError)
  })

  it("erro saneado nao ecoa payload Stripe bruto", async () => {
    const stripeLayer: StripeCardInitiationLayer = {
      createCardPaymentIntent: jest.fn(async () => {
        throw new Error(
          "Stripe error pi_card_init_mock_secret_synthetic pm_raw declined"
        )
      }),
    }

    let caught: unknown

    try {
      await startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        generatePaymentCollectionId: () => "paycol_new_01",
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MedusaError)
    const message = (caught as MedusaError).message
    expect(message).not.toMatch(/_secret_/)
    expect(message).toContain("[REDACTED]")
    expect(sanitizeError(caught as Error).message).not.toMatch(/_secret_/)
  })

  it("rejeita retorno Stripe-like com amount divergente do cart", async () => {
    const stripeLayer = createStripeLayer(
      mockRawStripeCardPaymentIntent({ amount: 9800 })
    )

    await expect(
      startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        generatePaymentCollectionId: () => "paycol_new_01",
      })
    ).rejects.toThrow("Stripe retornou dados de pagamento divergentes do carrinho.")
  })

  it("rejeita retorno Stripe-like com currency divergente do cart", async () => {
    const stripeLayer = createStripeLayer(
      mockRawStripeCardPaymentIntent({ currency: "usd" })
    )

    await expect(
      startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        generatePaymentCollectionId: () => "paycol_new_01",
      })
    ).rejects.toThrow("Stripe retornou dados de pagamento divergentes do carrinho.")
  })

  it("createSyntheticStripeCardLayer retorna PI mock sem config Stripe", async () => {
    const layer = createSyntheticStripeCardLayer()
    const raw = await layer.createCardPaymentIntent({
      amount: 5000,
      currency_code: "brl",
      cart_id: "cart_synthetic",
      idempotency_key: "idem_01",
    })

    expect(raw.id).toMatch(/^pi_synthetic_/)
    expect(raw.client_secret).toMatch(/_secret_synthetic$/)
  })
})

describe("04-04 markCardClientConfirmed", () => {
  it("payment_client_confirmed e estado local — nunca paid/succeeded/captured", () => {
    const attempt = existingActiveAttempt({
      id: "payatt_confirm",
      status: "card_client_secret_created",
    })

    const confirmed = markCardClientConfirmed(
      attempt,
      new Date("2026-06-29T12:30:00.000Z")
    )

    expect(confirmed.status).toBe("payment_client_confirmed")
    expect(confirmed.order_id).toBeNull()
    expect(confirmed.client_confirmed_at).toBe("2026-06-29T12:30:00.000Z")
    expect(confirmed.status).not.toBe("paid")
    expect(confirmed.status).not.toBe("succeeded")
    expect(confirmed.status).not.toBe("captured")
  })

  it("nao permite transicao de status terminal", () => {
    const attempt = existingActiveAttempt({
      status: "superseded",
    })

    expect(() => markCardClientConfirmed(attempt)).toThrow(
      "PAYMENT_ATTEMPT_TRANSITION_INVALID"
    )
  })
})
