import fs from "fs"
import path from "path"

/**
 * Gate 04-01 — prova estática do provider Stripe Medusa v2.16.0.
 * Sem rede, Stripe real, secrets, banco ou runtime de pagamento.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../../../")
const STRIPE_BASE_SOURCE = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "node_modules/@medusajs/payment-stripe/dist/core/stripe-base.js"
  ),
  "utf8"
)
const STRIPE_SERVICES_INDEX = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "node_modules/@medusajs/payment-stripe/dist/services/index.js"
  ),
  "utf8"
)
const PAYMENT_MODULE_SOURCE = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "node_modules/@medusajs/payment/dist/services/payment-module.js"
  ),
  "utf8"
)
const PAYMENT_SESSION_MODEL = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "node_modules/@medusajs/payment/dist/models/payment-session.js"
  ),
  "utf8"
)
const STORE_CART_QUERY_CONFIG = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "node_modules/@medusajs/medusa/dist/api/store/carts/query-config.js"
  ),
  "utf8"
)

/** Espelha StripeBase.getStatus (stripe-base.js L377-400) sem instanciar o provider. */
function simulateStripeGetStatus(paymentIntent: Record<string, unknown>): {
  status: string
  data: Record<string, unknown>
} {
  switch (paymentIntent.status) {
    case "requires_payment_method":
      return {
        status: paymentIntent.last_payment_error ? "error" : "pending",
        data: paymentIntent,
      }
    case "requires_confirmation":
    case "processing":
      return { status: "pending", data: paymentIntent }
    case "requires_action":
      return { status: "requires_more", data: paymentIntent }
    case "canceled":
      return { status: "canceled", data: paymentIntent }
    case "requires_capture":
      return { status: "authorized", data: paymentIntent }
    case "succeeded":
      return { status: "captured", data: paymentIntent }
    default:
      return { status: "pending", data: paymentIntent }
  }
}

/** Mock mínimo — valores sintéticos, nunca secrets reais. */
function mockCardPaymentIntent() {
  return {
    id: "pi_gate_card_mock",
    object: "payment_intent",
    status: "requires_payment_method",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_gate_card_mock_secret_synthetic",
    metadata: { session_id: "payses_gate_mock" },
  }
}

function mockPixPaymentIntentAfterConfirm() {
  return {
    id: "pi_gate_pix_mock",
    object: "payment_intent",
    status: "requires_action",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_gate_pix_mock_secret_synthetic",
    metadata: { session_id: "payses_gate_pix_mock" },
    next_action: {
      type: "pix_display_qr_code",
      pix_display_qr_code: {
        data: "00020126580014br.gov.bcb.pix_mock_payload",
        expires_at: 1_700_000_000,
        hosted_instructions_url: "https://payments.stripe.com/pix/mock",
        image_url_png: "https://payments.stripe.com/pix/mock.png",
        image_url_svg: "https://payments.stripe.com/pix/mock.svg",
      },
    },
  }
}

describe("04-01 stripe provider gate (static)", () => {
  describe("StripeBase.getStatus devolve PaymentIntent integral em data", () => {
    it("getStatus referencia paymentIntent completo como data em todos os branches", () => {
      expect(STRIPE_BASE_SOURCE).toMatch(
        /getStatus\(paymentIntent\)[\s\S]*data:\s*paymentIntent/
      )
    })

    it("initiatePayment espalha getStatus(sessionData) no retorno do provider", () => {
      expect(STRIPE_BASE_SOURCE).toMatch(
        /\.\.\.this\.getStatus\(sessionData\)/
      )
    })

    it("simulação: PaymentIntent de cartão inclui client_secret em data retornado", () => {
      const intent = mockCardPaymentIntent()
      const result = simulateStripeGetStatus(intent)
      expect(result.data).toBe(intent)
      expect(result.data).toHaveProperty("client_secret")
    })

    it("simulação: PaymentIntent Pix em requires_action inclui next_action QR em data", () => {
      const intent = mockPixPaymentIntentAfterConfirm()
      const result = simulateStripeGetStatus(intent)
      expect(result.data).toHaveProperty("client_secret")
      expect(result.data).toHaveProperty("next_action")
      expect(
        (result.data.next_action as { pix_display_qr_code?: { expires_at?: number } })
          .pix_display_qr_code?.expires_at
      ).toBeDefined()
    })
  })

  describe("Medusa PaymentModule persiste providerPaymentSession.data em PaymentSession", () => {
    it("createPaymentSession grava merge de input.data e providerPaymentSession.data", () => {
      expect(PAYMENT_MODULE_SOURCE).toMatch(
        /data:\s*\{\s*\.\.\.input\.data,\s*\.\.\.providerPaymentSession\.data\s*\}/
      )
    })

    it("updatePaymentSession grava providerData.data integralmente", () => {
      expect(PAYMENT_MODULE_SOURCE).toMatch(
        /updatePaymentSession[\s\S]*data:\s*providerData\.data/
      )
    })

    it("PaymentSession model define coluna JSON data sem filtragem", () => {
      expect(PAYMENT_SESSION_MODEL).toMatch(/data:\s*utils_1\.model\.json\(\)/)
      expect(PAYMENT_SESSION_MODEL).not.toMatch(/sanitize|redact|filter/i)
    })
  })

  describe("Pix native-first — lacunas do provider v2.16.0", () => {
    it("não exporta service Pix dedicado (somente bancontact, blik, giropay, ideal, oxxo, promptpay, przelewy24, stripe)", () => {
      expect(STRIPE_SERVICES_INDEX).not.toMatch(/Pix|pix/i)
      expect(STRIPE_SERVICES_INDEX).toMatch(/StripeProviderService/)
      expect(STRIPE_SERVICES_INDEX).toMatch(/StripePromptpayService/)
    })

    it("StripeProviderService não define paymentIntentOptions — herda default manual capture", () => {
      const providerSource = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "node_modules/@medusajs/payment-stripe/dist/services/stripe-provider.js"
        ),
        "utf8"
      )
      expect(providerSource).toMatch(/paymentIntentOptions\(\)\s*\{\s*return\s*\{\s*\}/)
      expect(STRIPE_BASE_SOURCE).toMatch(
        /capture_method[\s\S]*this\.options_\.capture\s*\?\s*"automatic"\s*:\s*"manual"/
      )
    })

    it("providers assíncronos existentes (promptpay/oxxo) usam capture_method automatic, não manual", () => {
      const promptpay = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "node_modules/@medusajs/payment-stripe/dist/services/stripe-promptpay.js"
        ),
        "utf8"
      )
      expect(promptpay).toMatch(/capture_method:\s*"automatic"/)
      expect(promptpay).toMatch(/payment_method_types:\s*\["promptpay"\]/)
    })
  })

  describe("Store API expõe payment_sessions no cart default fields", () => {
    it("cart query-config inclui payment_collection.payment_sessions com wildcard", () => {
      expect(STORE_CART_QUERY_CONFIG).toMatch(
        /\*payment_collection\.payment_sessions/
      )
    })
  })

  describe("conclusões de gate (documentação executável)", () => {
    it("BLOCK_NATIVE_IF_SECRET_PERSISTED=true — PaymentSession.data receberia client_secret do provider", () => {
      const providerOutput = simulateStripeGetStatus(mockCardPaymentIntent())
      const persistedData = {
        session_id: "payses_gate_mock",
        ...providerOutput.data,
      }
      expect(persistedData).toHaveProperty("client_secret")
      expect(
        typeof (persistedData as { client_secret?: string }).client_secret
      ).toBe("string")
    })

    it("Pix QR/expires_at viriam junto em PaymentSession.data se provider retornasse requires_action", () => {
      const providerOutput = simulateStripeGetStatus(
        mockPixPaymentIntentAfterConfirm()
      )
      const pixBlock = (
        providerOutput.data.next_action as {
          pix_display_qr_code?: { data?: string; expires_at?: number }
        }
      ).pix_display_qr_code
      expect(pixBlock?.data).toBeDefined()
      expect(pixBlock?.expires_at).toBeDefined()
    })
  })
})
