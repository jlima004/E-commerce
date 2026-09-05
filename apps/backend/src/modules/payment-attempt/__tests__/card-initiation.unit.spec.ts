import { MedusaError } from "@medusajs/framework/utils"
import { sanitizeError } from "../../../observability/sanitize"
import {
  markCardClientConfirmed,
  startCardPaymentAttempt,
  type CardPaymentAttemptResponse,
  type PrepareCardPaymentAttemptResult,
  type StripeCardInitiationLayer,
} from "../card"
import PaymentAttemptModuleService from "../service"
import type { PaymentAttemptRecord } from "../types"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import { buildStripeCanonicalPaymentIntentCreateRequest } from "../provider-request-authority"
import type { DurablePreProviderAuthority } from "../pre-provider-arbitration"
import { PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE } from "../provider-request-authority"

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
    createCardPaymentIntent: jest.fn(async (request) => ({
      ...rawIntent,
      metadata: {
        ...((rawIntent.metadata as Record<string, unknown> | undefined) ?? {}),
        session_id: request.payment_session_id,
        payment_attempt_id: request.payment_attempt_id,
      },
    })),
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
        amount: request.amount_minor,
        currency: request.currency_code,
        client_secret: `pi_synthetic_${suffix}_secret_synthetic`,
        metadata: {
          cart_id: request.cart_id,
          session_id: request.payment_session_id ?? `payses_synthetic_${suffix}`,
          payment_attempt_id: request.payment_attempt_id,
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

const MEDUSA_PAYMENT_SESSION = {
  payment_collection_id: "paycol_real_01",
  payment_session_id: "payses_real_01",
}

function createCommitAndRereadAuthorityStub(
  trace: string[] = [],
  cartResourceVersion = 1
) {
  return async (
    prepared: PrepareCardPaymentAttemptResult
  ): Promise<DurablePreProviderAuthority> => {
    trace.push("authority_tx_commit")
    const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "card",
      amount_minor: prepared.attempt.amount,
      cart_id: prepared.attempt.cart_id,
      cart_resource_version: cartResourceVersion,
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
        cart_resource_version: cartResourceVersion,
        provider_idempotency_key: prepared.idempotencyKey,
        stripe_payment_intent_create: v1,
      },
    }
    trace.push("durable_reread")
    return {
      attempt,
      cart_resource_version: cartResourceVersion,
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

describe("PaymentAttempt Stripe card resolver", () => {
  it("returns the injected layer asynchronously with service context preserved", async () => {
    const stripeLayer = createStripeLayer()
    const service = Object.create(PaymentAttemptModuleService.prototype)
    Object.defineProperty(service, "dependencies_", {
      value: { stripeCardInitiationLayer: stripeLayer },
    })

    await expect(
      service.resolveStripeCardInitiationLayer()
    ).resolves.toBe(stripeLayer)
  })
})

describe("04-04 startCardPaymentAttempt", () => {
  const completeCart = buildCompleteGuestCart({
    id: "cart_guest_01",
    total: 99,
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
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    assertResponseHasClientSecretOnlyInImmediate(result.response)
    expect(result.response.amount).toBe(9900)
    expect(result.response.currency_code).toBe("BRL")
    expect(result.response.status).toBe("card_client_secret_created")
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 9900,
        currency_code: "brl",
        cart_id: completeCart.id,
      })
    )
  })

  it("persiste PaymentAttempt.amount 9000 a partir de cart.total 90 com credito extra e line item 100", async () => {
    const cart = {
      ...buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 90,
        shipping_total: 15,
        discount_total: 10,
        tax_total: 5,
        items: [
          {
            ...buildCompleteGuestCart().items![0],
            unit_price: 100,
            quantity: 1,
          },
        ],
      }),
      credit_total: 20,
    }
    const stripeLayer = createStripeLayer(
      mockRawStripeCardPaymentIntent({ amount: 9000 })
    )

    const result = await startCardPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    expect(result.response.amount).toBe(9000)
    expect(result.attempt.amount).toBe(9000)
    expect(result.response.amount).not.toBe(10000)
    expect(result.response.amount).not.toBe(11000)
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 9000,
        currency_code: "brl",
        cart_id: cart.id,
      })
    )
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(1)
  })

  it("persiste PaymentAttempt.amount 11000 a partir de cart.total 110 mesmo com line item 100", async () => {
    const cart = buildCompleteGuestCart({
      id: "cart_guest_01",
      total: 110,
      shipping_total: 15,
      discount_total: 10,
      tax_total: 5,
      items: [
        {
          ...buildCompleteGuestCart().items![0],
          unit_price: 100,
          quantity: 1,
        },
      ],
    })
    const stripeLayer = createStripeLayer(
      mockRawStripeCardPaymentIntent({ amount: 11000 })
    )

    const result = await startCardPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    expect(result.response.amount).toBe(11000)
    expect(result.attempt.amount).toBe(11000)
    expect(result.response.amount).not.toBe(10000)
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 11000,
        currency_code: "brl",
        cart_id: cart.id,
      })
    )
    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(1)
  })

  it("nao chama Stripe quando cart.total esta ausente mesmo com line items somaveis", async () => {
    const stripeLayer = createStripeLayer()
    const cart = buildCompleteGuestCart({
      id: "cart_guest_01",
      total: undefined,
      shipping_total: 15,
      tax_total: 5,
      discount_total: 10,
      items: [
        {
          ...buildCompleteGuestCart().items![0],
          unit_price: 50,
          quantity: 2,
        },
      ],
    })

    await expect(
      startCardPaymentAttempt({
        cart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: cart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
      })
    ).rejects.toThrow(MedusaError)

    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("nao chama Stripe quando cart.total ausente mesmo com credito extra reconstruivel", async () => {
    const stripeLayer = createStripeLayer()
    const cart = {
      ...buildCompleteGuestCart({
        id: "cart_guest_01",
        total: undefined,
        shipping_total: 15,
        tax_total: 5,
        discount_total: 10,
        items: [
          {
            ...buildCompleteGuestCart().items![0],
            unit_price: 100,
            quantity: 1,
          },
        ],
      }),
      credit_total: 20,
    }

    await expect(
      startCardPaymentAttempt({
        cart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: cart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
      })
    ).rejects.toThrow(MedusaError)

    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it.each([null, 0, -1, 99.999, NaN])(
    "nao chama Stripe quando cart.total e invalido (%p)",
    async (total) => {
      const stripeLayer = createStripeLayer()
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: total as number | null,
      })

      await expect(
        startCardPaymentAttempt({
          cart,
          actor: { actorType: "guest", actorId: "sess_guest_01" },
          sessionActiveCartId: cart.id,
          existingAttempts: [],
          stripeLayer,
          generateId: () => "payatt_new_01",
          paymentSession: MEDUSA_PAYMENT_SESSION,
        })
      ).rejects.toThrow(MedusaError)

      expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(0)
    }
  )

  it("PaymentAttempt persiste apenas IDs seguros e metadata saneada — sem client_secret", async () => {
    const stripeLayer = createStripeLayer()
    const result = await startCardPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_new_01",
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
    })

    expect(result.attempt.order_id).toBeNull()
    expect(result.attempt.provider).toBe("stripe")
    expect(result.attempt.metadata?.stripe_initiation_layer).toBe(
      "stripe_safe_layer"
    )
    expect(result.attempt.provider_payment_intent_id).toBe("pi_card_init_mock")
    expect(result.attempt.payment_collection_id).toBe("paycol_real_01")
    expect(result.attempt.payment_session_id).toBe("payses_real_01")
    expect(result.attempt.provider_payment_session_id).toBe("payses_real_01")
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
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
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
      paymentSession: MEDUSA_PAYMENT_SESSION,
      commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
    })

    expect(result.supersededAttempts).toHaveLength(1)
    expect(result.supersededAttempts[0]?.status).toBe("superseded")
    expect(result.attempt.status).toBe("card_client_secret_created")
  })

  it("rejeita cart incompleto via eligibility de 04-03", async () => {
    const incompleteCart = buildCompleteGuestCart({
      id: "cart_guest_01",
      email: null,
      total: 99,
    })

    await expect(
      startCardPaymentAttempt({
        cart: incompleteCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: incompleteCart.id,
        existingAttempts: [],
        stripeLayer: createStripeLayer(),
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
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
        paymentSession: MEDUSA_PAYMENT_SESSION,
        commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
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
      mockRawStripeCardPaymentIntent({ amount: 99 })
    )

    await expect(
      startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
        commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
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
        paymentSession: MEDUSA_PAYMENT_SESSION,
        commitAndRereadAuthority: createCommitAndRereadAuthorityStub(),
      })
    ).rejects.toThrow("Stripe retornou dados de pagamento divergentes do carrinho.")
  })

  it("nao chama Stripe sem freeze+v1 quando commitAndRereadAuthority esta ausente", async () => {
    const stripeLayer = createStripeLayer()

    await expect(
      startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)

    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("nao chama Stripe quando a autoridade relida esta incompleta", async () => {
    const stripeLayer = createStripeLayer()

    await expect(
      startCardPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_new_01",
        paymentSession: MEDUSA_PAYMENT_SESSION,
        commitAndRereadAuthority: async (prepared) =>
          ({
            attempt: prepared.attempt,
            cart_resource_version: 1,
            amount_minor: prepared.attempt.amount,
            currency_code: "brl",
            payment_method_type: "card",
            provider_idempotency_key: prepared.idempotencyKey,
            financial_freeze_started_at: null as unknown as string,
            authority_created_at: "2026-09-02T12:00:00.000Z",
            replay_deadline: "2026-09-03T11:00:00.000Z",
          }) as DurablePreProviderAuthority,
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)

    expect(stripeLayer.createCardPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("createSyntheticStripeCardLayer retorna PI mock sem config Stripe", async () => {
    const layer = createSyntheticStripeCardLayer()
    const raw = await layer.createCardPaymentIntent({
      amount_minor: 5000,
      currency_code: "brl",
      cart_id: "cart_synthetic",
      idempotency_key: "idem_01",
      payment_attempt_id: "payatt_synthetic",
      payment_session_id: "payses_synthetic",
      canonical_request: buildStripeCanonicalPaymentIntentCreateRequest({
        payment_method_type: "card",
        amount_minor: 5000,
        cart_id: "cart_synthetic",
        payment_attempt_id: "payatt_synthetic",
        payment_session_id: "payses_synthetic",
      }),
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
