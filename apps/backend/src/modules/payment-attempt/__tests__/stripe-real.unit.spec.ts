import {
  RealStripeCardInitiationLayer,
  RealStripePixInitiationLayer,
  createStripePaymentIntentsClient,
  type StripePaymentIntentsClient,
} from "../stripe-real"
import { startCardPaymentAttempt } from "../card"
import { startPixPaymentAttempt } from "../pix"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"

function createPaymentIntentsMock(
  method: "card" | "pix"
): StripePaymentIntentsClient & { create: jest.Mock } {
  return {
    create: jest.fn(async (params) => {
      const base = {
        id: method === "card" ? "pi_real_card_mock" : "pi_real_pix_mock",
        object: "payment_intent",
        amount: params.amount,
        currency: params.currency,
        status: method === "card" ? "requires_payment_method" : "requires_action",
        client_secret:
          method === "card"
            ? "pi_real_card_mock_secret_test"
            : "pi_real_pix_mock_secret_test",
        metadata: params.metadata,
      }

      if (method === "card") {
        return base
      }

      return {
        ...base,
        next_action: {
          type: "pix_display_qr_code",
          pix_display_qr_code: {
            expires_at: 1782863999,
            data: "00020126580014BR.GOV.BCB.PIX0136real_layer_mock",
            hosted_instructions_url:
              "https://payments.stripe.com/pix/real_layer_mock",
            image_url_png:
              "https://payments.stripe.com/pix/real_layer_mock.png",
          },
        },
      }
    }),
  }
}

describe("04A RealStripeCardInitiationLayer", () => {
  it("cria PaymentIntent card test-mode com amount/currency derivados e safe boundary response-only", async () => {
    const paymentIntents = createPaymentIntentsMock("card")
    const stripeLayer = new RealStripeCardInitiationLayer({ paymentIntents })
    const cart = buildCompleteGuestCart({
      id: "cart_real_card_01",
      total: 99,
    })

    const result = await startCardPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_real_card_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_real_card_01",
      paymentSession: {
        payment_collection_id: "paycol_real_card_01",
        payment_session_id: "payses_real_card_01",
      },
      at: new Date("2026-06-29T18:00:00.000Z"),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9900,
        currency: "brl",
        payment_method_types: ["card"],
        capture_method: "automatic",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("payment-attempt:card:"),
      })
    )
    expect(result.attempt.provider_payment_intent_id).toBe("pi_real_card_mock")
    expect(result.attempt.payment_collection_id).toBe("paycol_real_card_01")
    expect(result.attempt.payment_session_id).toBe("payses_real_card_01")
    expect(result.attempt.provider_payment_session_id).toBe("payses_real_card_01")
    expect(result.attempt.order_id).toBeNull()
    expect(result.response.client_secret).toBe("pi_real_card_mock_secret_test")
    expect(result.attempt).not.toHaveProperty("client_secret")
    expect(JSON.stringify(result.attempt)).not.toContain(
      "pi_real_card_mock_secret_test"
    )
    expect(result.paymentSessionData).not.toHaveProperty("client_secret")
    expect(JSON.stringify(result.paymentSessionData)).not.toContain(
      "pi_real_card_mock_secret_test"
    )
  })
})

describe("04A RealStripePixInitiationLayer", () => {
  it("cria PaymentIntent Pix BRL confirmado com TTL e persiste apenas expires_at seguro", async () => {
    const paymentIntents = createPaymentIntentsMock("pix")
    const stripeLayer = new RealStripePixInitiationLayer({
      paymentIntents,
      pixExpiresAfterSeconds: 3_600,
    })
    const cart = buildCompleteGuestCart({
      id: "cart_real_pix_01",
      total: 99,
    })

    const result = await startPixPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_real_pix_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_real_pix_01",
      generatePaymentCollectionId: () => "paycol_real_pix_01",
      at: new Date("2026-06-29T18:05:00.000Z"),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9900,
        currency: "brl",
        payment_method_types: ["pix"],
        capture_method: "automatic",
        confirm: true,
        payment_method_data: { type: "pix" },
        payment_method_options: {
          pix: {
            expires_after_seconds: 3_600,
          },
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("payment-attempt:pix:"),
      })
    )
    expect(result.attempt.provider_payment_intent_id).toBe("pi_real_pix_mock")
    expect(result.attempt.expires_at).toBe(
      new Date(1782863999 * 1000).toISOString()
    )
    expect(result.response.copy_paste).toContain("00020126")
    expect(JSON.stringify(result.attempt)).not.toContain("00020126")
    expect(JSON.stringify(result.attempt)).not.toContain("next_action")
    expect(JSON.stringify(result.paymentSessionData)).not.toContain(
      "next_action"
    )
  })

  it("falha fechada antes de chamar Stripe quando currency nao e BRL", async () => {
    const paymentIntents = createPaymentIntentsMock("pix")
    const stripeLayer = new RealStripePixInitiationLayer({ paymentIntents })

    await expect(
      stripeLayer.createPixPaymentIntent({
        amount_minor: 9900,
        currency_code: "usd",
        cart_id: "cart_wrong_currency",
        idempotency_key: "idem_wrong_currency",
      })
    ).rejects.toThrow("STRIPE_REAL_INVALID_CURRENCY")
    expect(paymentIntents.create).not.toHaveBeenCalled()
  })

  it("rejeita TTL Pix fora dos limites da Stripe", () => {
    expect(
      () =>
        new RealStripePixInitiationLayer({
          paymentIntents: createPaymentIntentsMock("pix"),
          pixExpiresAfterSeconds: 1,
        })
    ).toThrow("STRIPE_REAL_INVALID_PIX_TTL")
  })
})

describe("04A createStripePaymentIntentsClient", () => {
  it("rejeita chave live para manter ativacao em test-mode", () => {
    expect(() => createStripePaymentIntentsClient("sk_live_forbidden")).toThrow(
      "STRIPE_REAL_SECRET_KEY_MUST_BE_TEST_MODE"
    )
  })
})
