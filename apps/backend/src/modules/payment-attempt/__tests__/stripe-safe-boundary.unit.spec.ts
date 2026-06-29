import {
  assertPaymentSessionDataIsAllowlisted,
  assertPersistableHasNoSecrets,
  extractImmediatePixInstructions,
  splitStripeCardPaymentIntent,
  splitStripePixPaymentIntent,
  toSafeStripePaymentSessionData,
  type SafeStripePaymentData,
} from "../stripe-safe"

/** Mock Stripe PaymentIntent — valores sintéticos, nunca secrets reais de produção. */
function mockRawStripeCardPaymentIntent(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "pi_card_boundary_mock",
    object: "payment_intent",
    status: "requires_payment_method",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_card_boundary_mock_secret_synthetic",
    metadata: {
      cart_id: "cart_mock_01",
      session_id: "payses_mock_01",
      note: "safe metadata value",
    },
    payment_method: {
      id: "pm_mock_raw",
      type: "card",
      card: {
        brand: "visa",
        last4: "4242",
        exp_month: 12,
        exp_year: 2030,
      },
    },
    charges: {
      object: "list",
      data: [{ id: "ch_mock", amount: 9900 }],
    },
    next_action: {
      type: "use_stripe_sdk",
      use_stripe_sdk: {
        type: "three_d_secure_redirect",
        stripe_js: "https://hooks.stripe.com/mock",
      },
    },
    last_payment_error: {
      message: "Your card was declined.",
      payment_method: { id: "pm_declined" },
    },
    ...overrides,
  }
}

/** Mock Stripe PaymentIntent Pix — valores sintéticos, nunca payload Pix real de produção. */
function mockRawStripePixPaymentIntent(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "pi_pix_boundary_mock",
    object: "payment_intent",
    status: "requires_action",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_pix_boundary_mock_secret_synthetic",
    metadata: {
      cart_id: "cart_mock_01",
      session_id: "payses_pix_mock_01",
      note: "safe metadata value",
    },
    next_action: {
      type: "pix_display_qr_code",
      pix_display_qr_code: {
        expires_at: 1782863999,
        data: "00020126580014BR.GOV.BCB.PIX0136mock_pix_copy_paste_synthetic",
        hosted_instructions_url: "https://payments.stripe.com/pix/mock",
        image_url_png: "https://payments.stripe.com/pix/mock.png",
        image_url_svg: "https://payments.stripe.com/pix/mock.svg",
      },
    },
    payment_method: {
      id: "pm_pix_mock",
      type: "pix",
    },
    ...overrides,
  }
}

function collectAllKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (value === null || value === undefined) {
    return keys
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAllKeys(entry, keys)
    }
    return keys
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key)
      collectAllKeys(nested, keys)
    }
  }

  return keys
}

const FORBIDDEN_PERSISTABLE_KEYS = [
  "client_secret",
  "clientSecret",
  "next_action",
  "charges",
  "payment_method",
  "last_payment_error",
  "payment_method_options",
  "automatic_payment_methods",
  "pix_display_qr_code",
  "hosted_instructions_url",
  "image_url_png",
  "image_url_svg",
] as const

describe("04-04 stripe safe boundary", () => {
  describe("splitStripeCardPaymentIntent", () => {
    it("separa persistivel allowlist-only de DTO imediato com client_secret", () => {
      const raw = mockRawStripeCardPaymentIntent()
      const result = splitStripeCardPaymentIntent(raw)

      expect(result.immediate.client_secret).toBe(
        "pi_card_boundary_mock_secret_synthetic"
      )
      expect(result.persistable.provider_payment_intent_id).toBe(
        "pi_card_boundary_mock"
      )
      expect(result.persistable.amount).toBe(9900)
      expect(result.persistable.currency_code).toBe("brl")
      expect(result.persistable.status).toBe("requires_payment_method")
    })

    it("persistivel nao contem client_secret, next_action, charges ou payment_method bruto", () => {
      const raw = mockRawStripeCardPaymentIntent()
      const { persistable } = splitStripeCardPaymentIntent(raw)
      const keys = collectAllKeys(persistable)

      for (const forbidden of FORBIDDEN_PERSISTABLE_KEYS) {
        expect(keys.has(forbidden)).toBe(false)
      }

      expect(JSON.stringify(persistable)).not.toMatch(/_secret_/)
      expect(JSON.stringify(persistable)).not.toContain("pm_mock_raw")
      expect(JSON.stringify(persistable)).not.toContain("three_d_secure")
    })

    it("immediate contem somente client_secret", () => {
      const raw = mockRawStripeCardPaymentIntent()
      const { immediate } = splitStripeCardPaymentIntent(raw)

      expect(Object.keys(immediate).sort()).toEqual(["client_secret"])
    })

    it("metadata persistivel e saneada — sem chaves sensiveis do PI bruto", () => {
      const raw = mockRawStripeCardPaymentIntent({
        metadata: {
          cart_id: "cart_mock_01",
          client_secret: "must_not_persist",
          cpf: "529.982.247-25",
        },
      })

      const { persistable } = splitStripeCardPaymentIntent(raw)

      expect(persistable.metadata).toEqual({
        cart_id: "cart_mock_01",
      })
    })

    it("PaymentSession.data derivado e allowlist-only", () => {
      const raw = mockRawStripeCardPaymentIntent()
      const { persistable, paymentSessionData } = splitStripeCardPaymentIntent(raw)

      expect(paymentSessionData).toEqual(toSafeStripePaymentSessionData(persistable))

      const keys = collectAllKeys(paymentSessionData)
      for (const forbidden of FORBIDDEN_PERSISTABLE_KEYS) {
        expect(keys.has(forbidden)).toBe(false)
      }
    })
  })

  describe("assertPersistableHasNoSecrets", () => {
    it("rejeita client_secret no shape persistivel", () => {
      expect(() =>
        assertPersistableHasNoSecrets({
          provider_payment_intent_id: "pi_x",
          client_secret: "pi_x_secret_synthetic",
        })
      ).toThrow("STRIPE_SAFE_PERSISTABLE_FORBIDDEN_KEY")
    })

    it("rejeita next_action no shape persistivel", () => {
      expect(() =>
        assertPersistableHasNoSecrets({
          provider_payment_intent_id: "pi_x",
          next_action: { type: "pix_display_qr_code" },
        })
      ).toThrow("STRIPE_SAFE_PERSISTABLE_FORBIDDEN_KEY")
    })

    it("rejeita valor com padrao pi_*_secret_*", () => {
      expect(() =>
        assertPersistableHasNoSecrets({
          provider_payment_intent_id: "pi_x",
          metadata: { trace: "pi_abc_secret_xyz" },
        })
      ).toThrow("STRIPE_SAFE_PERSISTABLE_SENSITIVE_VALUE")
    })

    it("aceita shape persistivel valido", () => {
      const safe: SafeStripePaymentData = {
        provider_payment_intent_id: "pi_safe",
        provider_payment_session_id: "payses_safe",
        amount: 9900,
        currency_code: "brl",
        status: "requires_payment_method",
        expires_at: null,
        metadata: { cart_id: "cart_01" },
      }

      expect(() => assertPersistableHasNoSecrets(safe)).not.toThrow()
    })
  })

  describe("assertPaymentSessionDataIsAllowlisted", () => {
    it("rejeita PaymentSession.data com PaymentIntent bruto espalhado", () => {
      const raw = mockRawStripeCardPaymentIntent()

      expect(() => assertPaymentSessionDataIsAllowlisted(raw)).toThrow(
        "STRIPE_SAFE_PAYMENT_SESSION_DATA_FORBIDDEN_KEY"
      )
    })

    it("aceita PaymentSession.data allowlist-only", () => {
      const raw = mockRawStripeCardPaymentIntent()
      const { paymentSessionData } = splitStripeCardPaymentIntent(raw)

      expect(() =>
        assertPaymentSessionDataIsAllowlisted(paymentSessionData)
      ).not.toThrow()
    })
  })

  describe("toSafeStripePaymentSessionData", () => {
    it("expoe apenas chaves allowlist para PaymentSession.data", () => {
      const persistable: SafeStripePaymentData = {
        provider_payment_intent_id: "pi_allow",
        provider_payment_session_id: "payses_allow",
        amount: 5000,
        currency_code: "brl",
        status: "requires_action",
        expires_at: "2026-12-31T23:59:59.000Z",
        metadata: { cart_id: "cart_allow" },
      }

      const sessionData = toSafeStripePaymentSessionData(persistable)

      expect(Object.keys(sessionData).sort()).toEqual(
        [
          "amount",
          "currency_code",
          "expires_at",
          "metadata",
          "provider_payment_intent_id",
          "provider_payment_session_id",
          "status",
        ].sort()
      )
    })
  })
})

describe("04-05 stripe safe boundary pix", () => {
  describe("splitStripePixPaymentIntent", () => {
    it("separa persistivel allowlist-only de DTO imediato com instrucoes Pix", () => {
      const raw = mockRawStripePixPaymentIntent()
      const result = splitStripePixPaymentIntent(raw)

      expect(result.immediate.copy_paste).toBe(
        "00020126580014BR.GOV.BCB.PIX0136mock_pix_copy_paste_synthetic"
      )
      expect(result.immediate.qr_code).toBe(
        "https://payments.stripe.com/pix/mock.png"
      )
      expect(result.immediate.hosted_instructions_url).toBe(
        "https://payments.stripe.com/pix/mock"
      )
      expect(result.persistable.provider_payment_intent_id).toBe(
        "pi_pix_boundary_mock"
      )
      expect(result.persistable.amount).toBe(9900)
      expect(result.persistable.currency_code).toBe("brl")
      expect(result.persistable.status).toBe("requires_action")
      expect(result.persistable.expires_at).toBe(
        new Date(1782863999 * 1000).toISOString()
      )
    })

    it("persistivel nao contem next_action, copy_paste, pix_display_qr_code ou client_secret", () => {
      const raw = mockRawStripePixPaymentIntent()
      const { persistable } = splitStripePixPaymentIntent(raw)
      const keys = collectAllKeys(persistable)

      for (const forbidden of FORBIDDEN_PERSISTABLE_KEYS) {
        expect(keys.has(forbidden)).toBe(false)
      }

      expect(JSON.stringify(persistable)).not.toMatch(/_secret_/)
      expect(JSON.stringify(persistable)).not.toContain("00020126")
      expect(JSON.stringify(persistable)).not.toContain("pix_display_qr_code")
      expect(JSON.stringify(persistable)).not.toContain("hosted_instructions_url")
    })

    it("immediate pode conter client_secret mas persistivel nunca", () => {
      const raw = mockRawStripePixPaymentIntent()
      const { immediate, persistable } = splitStripePixPaymentIntent(raw)

      expect(immediate.client_secret).toBe(
        "pi_pix_boundary_mock_secret_synthetic"
      )
      expect(JSON.stringify(persistable)).not.toContain("client_secret")
    })

    it("PaymentSession.data derivado e allowlist-only para Pix", () => {
      const raw = mockRawStripePixPaymentIntent()
      const { persistable, paymentSessionData } = splitStripePixPaymentIntent(raw)

      expect(paymentSessionData).toEqual(toSafeStripePaymentSessionData(persistable))
      expect(paymentSessionData).toHaveProperty("expires_at")

      const keys = collectAllKeys(paymentSessionData)
      for (const forbidden of FORBIDDEN_PERSISTABLE_KEYS) {
        expect(keys.has(forbidden)).toBe(false)
      }
    })

    it("falha se expires_at ausente no payload Pix", () => {
      const raw = mockRawStripePixPaymentIntent({
        next_action: {
          type: "pix_display_qr_code",
          pix_display_qr_code: {
            data: "00020126580014BR.GOV.BCB.PIX0136mock",
          },
        },
      })

      expect(() => splitStripePixPaymentIntent(raw)).toThrow(
        "STRIPE_SAFE_RAW_PIX_EXPIRES_AT_MISSING"
      )
    })
  })

  describe("extractImmediatePixInstructions", () => {
    it("extrai qr_code, copy_paste e hosted_instructions_url response-only", () => {
      const raw = mockRawStripePixPaymentIntent()
      const immediate = extractImmediatePixInstructions(raw)

      expect(immediate.copy_paste).toContain("00020126")
      expect(immediate.qr_code).toBe("https://payments.stripe.com/pix/mock.png")
      expect(immediate.hosted_instructions_url).toBe(
        "https://payments.stripe.com/pix/mock"
      )
    })
  })

  describe("assertPersistableHasNoSecrets pix", () => {
    it("rejeita copy_paste no shape persistivel", () => {
      expect(() =>
        assertPersistableHasNoSecrets({
          provider_payment_intent_id: "pi_x",
          copy_paste: "00020126580014BR.GOV.BCB.PIX",
        })
      ).toThrow("STRIPE_SAFE_PERSISTABLE_FORBIDDEN_KEY")
    })

    it("rejeita pix_display_qr_code.data no shape persistivel", () => {
      expect(() =>
        assertPersistableHasNoSecrets({
          provider_payment_intent_id: "pi_x",
          pix_display_qr_code: {
            data: "00020126580014BR.GOV.BCB.PIX",
          },
        })
      ).toThrow("STRIPE_SAFE_PERSISTABLE_FORBIDDEN_KEY")
    })
  })
})
