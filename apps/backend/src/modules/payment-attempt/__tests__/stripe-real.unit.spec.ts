import {
  RealStripeCardInitiationLayer,
  RealStripePixInitiationLayer,
  createStripePaymentIntentsClient,
  discoverPaymentIntentsByPaymentAttemptId,
  type StripePaymentIntentsClient,
} from "../stripe-real"
import { startCardPaymentAttempt } from "../card"
import { startPixPaymentAttempt } from "../pix"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"
import { RECONCILIATION_REASON_CODE } from "../../../reconciliation/reason-codes"
import {
  buildCompleteStripePaymentIntentCreateAuthorityV1,
  buildStripeCanonicalPaymentIntentCreateRequest,
  DEFAULT_PIX_EXPIRES_AFTER_SECONDS,
} from "../provider-request-authority"
import type { DurablePreProviderAuthority } from "../pre-provider-arbitration"
import type { PrepareCardPaymentAttemptResult } from "../card"
import type { PreparePixPaymentAttemptResult } from "../pix"
import type { PaymentAttemptRecord } from "../types"

function buildCardCanonicalRequest(input: {
  amount_minor: number
  cart_id: string
  payment_attempt_id: string
  payment_session_id?: string | null
}) {
  return buildStripeCanonicalPaymentIntentCreateRequest({
    payment_method_type: "card",
    amount_minor: input.amount_minor,
    cart_id: input.cart_id,
    payment_attempt_id: input.payment_attempt_id,
    payment_session_id: input.payment_session_id,
  })
}

function buildPixCanonicalRequest(input: {
  amount_minor: number
  cart_id: string
  payment_attempt_id: string
  payment_session_id?: string | null
}) {
  return buildStripeCanonicalPaymentIntentCreateRequest({
    payment_method_type: "pix",
    amount_minor: input.amount_minor,
    cart_id: input.cart_id,
    payment_attempt_id: input.payment_attempt_id,
    payment_session_id: input.payment_session_id,
  })
}

function createCommitAndRereadCardAuthorityStub() {
  return async (
    prepared: PrepareCardPaymentAttemptResult
  ): Promise<DurablePreProviderAuthority> => {
    const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "card",
      amount_minor: prepared.attempt.amount,
      cart_id: prepared.attempt.cart_id,
      cart_resource_version: 1,
      payment_attempt_id: prepared.attempt.id,
      payment_collection_id: prepared.attempt.payment_collection_id,
      payment_session_id: prepared.attempt.payment_session_id,
      idempotency_key: prepared.idempotencyKey,
      authority_created_at: "2026-09-02T12:00:00.000Z",
      replay_deadline: "2026-09-03T11:00:00.000Z",
    })
    const attempt: PaymentAttemptRecord = {
      ...prepared.attempt,
      financial_freeze_started_at: "2026-09-02T12:00:00.000Z",
      provider_canceled_confirmed_at: null,
      metadata: {
        ...(prepared.attempt.metadata ?? {}),
        cart_resource_version: 1,
        provider_idempotency_key: prepared.idempotencyKey,
        stripe_payment_intent_create: v1,
      },
    }
    return {
      attempt,
      cart_resource_version: 1,
      amount_minor: attempt.amount,
      currency_code: "brl",
      payment_method_type: "card",
      provider_idempotency_key: prepared.idempotencyKey,
      financial_freeze_started_at: "2026-09-02T12:00:00.000Z",
      authority_created_at: v1.authority_created_at,
      replay_deadline: v1.replay_deadline,
    }
  }
}

function createCommitAndRereadPixAuthorityStub() {
  return async (
    prepared: PreparePixPaymentAttemptResult
  ): Promise<DurablePreProviderAuthority> => {
    const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
      amount_minor: prepared.attempt.amount,
      cart_id: prepared.attempt.cart_id,
      cart_resource_version: 1,
      payment_attempt_id: prepared.attempt.id,
      payment_collection_id: prepared.attempt.payment_collection_id,
      payment_session_id: prepared.attempt.payment_session_id,
      idempotency_key: prepared.idempotencyKey,
      authority_created_at: "2026-09-02T12:00:00.000Z",
      replay_deadline: "2026-09-03T11:00:00.000Z",
    })
    const attempt: PaymentAttemptRecord = {
      ...prepared.attempt,
      financial_freeze_started_at: "2026-09-02T12:00:00.000Z",
      provider_canceled_confirmed_at: null,
      metadata: {
        ...(prepared.attempt.metadata ?? {}),
        cart_resource_version: 1,
        provider_idempotency_key: prepared.idempotencyKey,
        stripe_payment_intent_create: v1,
      },
    }
    return {
      attempt,
      cart_resource_version: 1,
      amount_minor: attempt.amount,
      currency_code: "brl",
      payment_method_type: "pix",
      provider_idempotency_key: prepared.idempotencyKey,
      financial_freeze_started_at: "2026-09-02T12:00:00.000Z",
      authority_created_at: v1.authority_created_at,
      replay_deadline: v1.replay_deadline,
    }
  }
}

function createPaymentIntentsMock(
  method: "card" | "pix"
): StripePaymentIntentsClient & { create: jest.Mock; search: jest.Mock } {
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
    search: jest.fn(async () => ({
      data: [],
      has_more: false,
      next_page: null,
    })),
  }
}

function buildDecorativeCart110() {
  return buildCompleteGuestCart({
    id: "cart_real_amount_110",
    total: 110,
    shipping_total: 15,
    discount_total: 10,
    tax_total: 5,
    items: [
      {
        id: "item_01",
        quantity: 1,
        title: "Camiseta Essential",
        variant_id: "variant_sellable",
        variant_title: "Preto / M",
        unit_price: 100,
        variant: {
          id: "variant_sellable",
          sku: "TSHIRT-BLACK-M",
          metadata: {
            gelato_product_uid: "prod_gelato_abc123",
            gelato_template_id: "template_fixed_001",
            gelato_variant_options: { size: "M", color: "Preto" },
            template_mode: "fixed",
          },
          prices: [{ currency_code: "brl", amount: 100 }],
        },
      },
    ],
  })
}

describe("04A RealStripeCardInitiationLayer", () => {
  it("repassa amount_minor 11000 e currency brl diretamente no adapter card", async () => {
    const paymentIntents = createPaymentIntentsMock("card")
    const stripeLayer = new RealStripeCardInitiationLayer({ paymentIntents })

    await stripeLayer.createCardPaymentIntent({
      amount_minor: 11000,
      currency_code: "brl",
      cart_id: "cart_direct_card_110",
      idempotency_key: "idem_direct_card_110",
      payment_attempt_id: "payatt_direct_card_110",
      payment_session_id: "payses_direct_card_110",
      canonical_request: buildCardCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_direct_card_110",
        payment_attempt_id: "payatt_direct_card_110",
        payment_session_id: "payses_direct_card_110",
      }),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      buildCardCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_direct_card_110",
        payment_attempt_id: "payatt_direct_card_110",
        payment_session_id: "payses_direct_card_110",
      }),
      {
        idempotencyKey: "idem_direct_card_110",
      }
    )
  })

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
      commitAndRereadAuthority: createCommitAndRereadCardAuthorityStub(),
      at: new Date("2026-06-29T18:00:00.000Z"),
    })

    const cardAuthority = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "card",
      amount_minor: 9900,
      cart_id: "cart_real_card_01",
      cart_resource_version: 1,
      payment_attempt_id: "payatt_real_card_01",
      payment_collection_id: "paycol_real_card_01",
      payment_session_id: "payses_real_card_01",
      idempotency_key: "payment-attempt:card:payatt_real_card_01",
      authority_created_at: "2026-09-02T12:00:00.000Z",
      replay_deadline: "2026-09-03T11:00:00.000Z",
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      cardAuthority.canonical_request,
      {
        idempotencyKey: cardAuthority.idempotency_key,
      }
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

  it("inicia cartao via adapter real com cart.total 110 e repassa 11000 ao Stripe", async () => {
    const paymentIntents = createPaymentIntentsMock("card")
    const stripeLayer = new RealStripeCardInitiationLayer({ paymentIntents })
    const cart = buildDecorativeCart110()

    await startCardPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_real_card_110" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_real_card_110",
      paymentSession: {
        payment_collection_id: "paycol_real_card_110",
        payment_session_id: "payses_real_card_110",
      },
      commitAndRereadAuthority: createCommitAndRereadCardAuthorityStub(),
      at: new Date("2026-06-29T18:00:00.000Z"),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      buildCardCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_real_amount_110",
        payment_attempt_id: "payatt_real_card_110",
        payment_session_id: "payses_real_card_110",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("payment-attempt:card:"),
      })
    )
  })
})

describe("04A RealStripePixInitiationLayer", () => {
  it("repassa amount_minor 11000 e currency brl diretamente no adapter Pix", async () => {
    const paymentIntents = createPaymentIntentsMock("pix")
    const stripeLayer = new RealStripePixInitiationLayer({ paymentIntents })

    await stripeLayer.createPixPaymentIntent({
      amount_minor: 11000,
      currency_code: "brl",
      cart_id: "cart_direct_pix_110",
      idempotency_key: "idem_direct_pix_110",
      payment_attempt_id: "payatt_direct_pix_110",
      canonical_request: buildPixCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_direct_pix_110",
        payment_attempt_id: "payatt_direct_pix_110",
        payment_session_id: null,
      }),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      buildPixCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_direct_pix_110",
        payment_attempt_id: "payatt_direct_pix_110",
        payment_session_id: null,
      }),
      {
        idempotencyKey: "idem_direct_pix_110",
      }
    )
  })

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
      paymentCollection: { payment_collection_id: "paycol_real_pix_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      at: new Date("2026-06-29T18:05:00.000Z"),
    })

    const pixAuthority = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
      amount_minor: 9900,
      cart_id: "cart_real_pix_01",
      cart_resource_version: 1,
      payment_attempt_id: "payatt_real_pix_01",
      payment_collection_id: "paycol_real_pix_01",
      payment_session_id: null,
      idempotency_key: "payment-attempt:pix:payatt_real_pix_01",
      authority_created_at: "2026-09-02T12:00:00.000Z",
      replay_deadline: "2026-09-03T11:00:00.000Z",
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      pixAuthority.canonical_request,
      {
        idempotencyKey: pixAuthority.idempotency_key,
      }
    )
    expect(pixAuthority.canonical_request.payment_method_options).toEqual({
      pix: { expires_after_seconds: DEFAULT_PIX_EXPIRES_AFTER_SECONDS },
    })
    expect(pixAuthority.canonical_request.metadata.session_id).toBeUndefined()
    expect(pixAuthority.canonical_request.metadata).not.toHaveProperty(
      "correlation_id"
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

  it("inicia Pix via adapter real com cart.total 110 e repassa 11000 ao Stripe", async () => {
    const paymentIntents = createPaymentIntentsMock("pix")
    const stripeLayer = new RealStripePixInitiationLayer({
      paymentIntents,
      pixExpiresAfterSeconds: 3_600,
    })
    const cart = buildDecorativeCart110()

    await startPixPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_real_pix_110" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_real_pix_110",
      paymentCollection: { payment_collection_id: "paycol_real_pix_110" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      at: new Date("2026-06-29T18:05:00.000Z"),
    })

    expect(paymentIntents.create).toHaveBeenCalledWith(
      buildPixCanonicalRequest({
        amount_minor: 11000,
        cart_id: "cart_real_amount_110",
        payment_attempt_id: "payatt_real_pix_110",
        payment_session_id: null,
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("payment-attempt:pix:"),
      })
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
        payment_attempt_id: "payatt_wrong_currency",
        canonical_request: buildPixCanonicalRequest({
          amount_minor: 9900,
          cart_id: "cart_wrong_currency",
          payment_attempt_id: "payatt_wrong_currency",
          payment_session_id: null,
        }),
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

describe("same-operation Stripe PaymentIntent discovery", () => {
  function matchingIntent(id: string) {
    return {
      id,
      amount: 9900,
      currency: "brl",
      payment_method_types: ["card"],
      metadata: { payment_attempt_id: "payatt_r1_001" },
    }
  }

  it("queries metadata payment_attempt_id and paginates until has_more is false", async () => {
    const pages: Array<{ page?: string }> = []
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async (params) => {
        pages.push({ page: params.page })
        if (!params.page) {
          return { data: [], has_more: true, next_page: "page_2" }
        }
        return {
          data: [matchingIntent("pi_from_page_2")],
          has_more: false,
          next_page: null,
        }
      }),
    }

    const result = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )

    expect(paymentIntents.search).toHaveBeenCalledTimes(2)
    expect(paymentIntents.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: 'metadata["payment_attempt_id"]:"payatt_r1_001"',
      })
    )
    expect(pages).toEqual([{ page: undefined }, { page: "page_2" }])
    expect(result).toEqual({
      matches: [matchingIntent("pi_from_page_2")],
      unresolved: false,
    })
    expect(result).not.toMatchObject({
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    })
  })

  it("does not treat a first empty page as zero-match when has_more is true", async () => {
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async (params) => {
        if (!params.page) {
          return { data: [], has_more: true, next_page: "page_2" }
        }
        return {
          data: [matchingIntent("pi_late")],
          has_more: false,
          next_page: null,
        }
      }),
    }

    const result = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )
    expect(result.unresolved).not.toBe(true)
    expect(result.matches.map((intent) => intent.id)).toEqual(["pi_late"])
  })

  it("returns PROVIDER_DISCOVERY_UNRESOLVED only after complete pagination with zero matches", async () => {
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({
        data: [],
        has_more: false,
        next_page: null,
      })),
    }

    await expect(
      discoverPaymentIntentsByPaymentAttemptId(paymentIntents, "payatt_r1_001")
    ).resolves.toEqual({
      matches: [],
      unresolved: true,
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    })
  })

  it("classifies multiple matches as RECONCILIATION_REQUIRED without create()", async () => {
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({
        data: [matchingIntent("pi_A"), matchingIntent("pi_B")],
        has_more: false,
        next_page: null,
      })),
    }

    const result = await discoverPaymentIntentsByPaymentAttemptId(
      paymentIntents,
      "payatt_r1_001"
    )
    expect(result).toMatchObject({
      reconciliation_required: true,
      reason: "RECONCILIATION_REQUIRED",
    })
    expect(result.matches).toHaveLength(2)
    expect(paymentIntents.create).not.toHaveBeenCalled()
  })

  it("exposes discovery on RealStripe card and Pix layers", async () => {
    const paymentIntents: StripePaymentIntentsClient = {
      create: jest.fn(),
      search: jest.fn(async () => ({
        data: [],
        has_more: false,
        next_page: null,
      })),
    }
    const card = new RealStripeCardInitiationLayer({ paymentIntents })
    const pix = new RealStripePixInitiationLayer({ paymentIntents })
    await expect(
      card.discoverPaymentIntentsByPaymentAttemptId("payatt_r1_001")
    ).resolves.toMatchObject({
      unresolved: true,
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    })
    await expect(
      pix.discoverPaymentIntentsByPaymentAttemptId("payatt_r1_001")
    ).resolves.toMatchObject({
      unresolved: true,
    })
  })
})
