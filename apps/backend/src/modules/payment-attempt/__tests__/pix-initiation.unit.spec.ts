import { MedusaError } from "@medusajs/framework/utils"
import { sanitizeError } from "../../../observability/sanitize"
import {
  markPixCanceled,
  markPixExpired,
  markPixFailed,
  startPixPaymentAttempt,
  type PixPaymentAttemptResponse,
  type PreparePixPaymentAttemptResult,
  type StripePixInitiationLayer,
} from "../pix"
import PaymentAttemptModuleService from "../service"
import type { PaymentAttemptRecord } from "../types"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import { buildStripeCanonicalPaymentIntentCreateRequest } from "../provider-request-authority"
import type { DurablePreProviderAuthority } from "../pre-provider-arbitration"
import { PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE } from "../provider-request-authority"

function mockRawStripePixPaymentIntent(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "pi_pix_init_mock",
    object: "payment_intent",
    status: "requires_action",
    amount: 9900,
    currency: "brl",
    client_secret: "pi_pix_init_mock_secret_synthetic",
    metadata: {
      cart_id: "cart_guest_01",
    },
    next_action: {
      type: "pix_display_qr_code",
      pix_display_qr_code: {
        expires_at: 1782863999,
        data: "00020126580014BR.GOV.BCB.PIX0136mock_pix_init_synthetic",
        hosted_instructions_url: "https://payments.stripe.com/pix/init_mock",
        image_url_png: "https://payments.stripe.com/pix/init_mock.png",
      },
    },
    payment_method: { id: "pm_pix_raw", type: "pix" },
    ...overrides,
  }
}

function createStripePixLayer(
  rawIntent: Record<string, unknown> = mockRawStripePixPaymentIntent()
): StripePixInitiationLayer {
  return {
    createPixPaymentIntent: jest.fn(async (request) => ({
      ...rawIntent,
      metadata: {
        ...((rawIntent.metadata as Record<string, unknown> | undefined) ?? {}),
        ...(request.payment_session_id
          ? { session_id: request.payment_session_id }
          : {}),
        payment_attempt_id: request.payment_attempt_id,
      },
    })),
  }
}

function createSyntheticStripePixLayer(): StripePixInitiationLayer {
  return {
    async createPixPaymentIntent(request) {
      const suffix = request.idempotency_key.replace(/[^a-z0-9]/gi, "").slice(-8)

      return {
        id: `pi_pix_synthetic_${suffix}`,
        object: "payment_intent",
        status: "requires_action",
        amount: request.amount_minor,
        currency: request.currency_code,
        client_secret: `pi_pix_synthetic_${suffix}_secret_synthetic`,
        metadata: {
          cart_id: request.cart_id,
          payment_attempt_id: request.payment_attempt_id,
        },
        next_action: {
          type: "pix_display_qr_code",
          pix_display_qr_code: {
            expires_at: 1782863999,
            data: "00020126580014BR.GOV.BCB.PIX0136synthetic_copy_paste",
            hosted_instructions_url: "https://payments.stripe.com/pix/synthetic",
          },
        },
      }
    },
  }
}

function existingActivePixAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_pix_existing",
    cart_id: "cart_guest_01",
    payment_collection_id: "paycol_pix_old",
    payment_session_id: "payses_pix_old",
    provider: "stripe_safe_layer",
    provider_payment_intent_id: "pi_pix_old",
    provider_payment_session_id: "payses_pix_old",
    payment_method_type: "pix",
    status: "awaiting_pix_payment",
    amount: 9900,
    currency_code: "brl",
    expires_at: "2026-12-31T23:59:59.000Z",
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: "2026-06-29T10:00:00.000Z",
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

function createCommitAndRereadPixAuthorityStub(
  trace: string[] = [],
  cartResourceVersion = 1
) {
  return async (
    prepared: PreparePixPaymentAttemptResult
  ): Promise<DurablePreProviderAuthority> => {
    trace.push("authority_tx_commit")
    const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
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
      payment_method_type: "pix",
      provider_idempotency_key: prepared.idempotencyKey,
      financial_freeze_started_at: "2026-09-02T12:00:00.000Z",
      authority_created_at: v1.authority_created_at,
      replay_deadline: v1.replay_deadline,
    }
  }
}

function assertResponseHasPixInstructionsOnlyInImmediate(
  response: PixPaymentAttemptResponse
) {
  expect(response.copy_paste).toContain("00020126")
  expect(response.qr_code).toBeTruthy()
  expect(response.expires_at).toBeTruthy()

  const allowedKeys = [
    "amount",
    "copy_paste",
    "currency_code",
    "expires_at",
    "hosted_instructions_url",
    "payment_attempt_id",
    "payment_method_type",
    "provider_payment_intent_id",
    "qr_code",
    "status",
    "client_secret",
  ]

  for (const key of Object.keys(response)) {
    expect(allowedKeys).toContain(key)
  }
}

describe("PaymentAttempt Stripe Pix resolver", () => {
  it("returns the injected layer asynchronously with service context preserved", async () => {
    const stripeLayer = createStripePixLayer()
    const service = Object.create(PaymentAttemptModuleService.prototype)
    Object.defineProperty(service, "dependencies_", {
      value: { stripePixInitiationLayer: stripeLayer },
    })

    await expect(service.resolveStripePixInitiationLayer()).resolves.toBe(
      stripeLayer
    )
  })
})

describe("04-05 startPixPaymentAttempt", () => {
  const completeCart = buildCompleteGuestCart({
    id: "cart_guest_01",
    total: 99,
  })

  it("deriva amount/currency do cart e retorna instrucoes Pix somente na resposta", async () => {
    const stripeLayer = createStripePixLayer()
    const result = await startPixPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    assertResponseHasPixInstructionsOnlyInImmediate(result.response)
    expect(result.response.amount).toBe(9900)
    expect(result.response.currency_code).toBe("BRL")
    expect(result.response.status).toBe("awaiting_pix_payment")
    expect(result.attempt.payment_collection_id).toBe("paycol_pix_new_01")
    expect(result.attempt.payment_session_id).toBeNull()
    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 9900,
        currency_code: "brl",
        cart_id: completeCart.id,
        canonical_request: expect.objectContaining({
          metadata: expect.not.objectContaining({
            session_id: expect.anything(),
          }),
        }),
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
    const stripeLayer = createStripePixLayer(
      mockRawStripePixPaymentIntent({ amount: 9000 })
    )

    const result = await startPixPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    expect(result.response.amount).toBe(9000)
    expect(result.attempt.amount).toBe(9000)
    expect(result.response.amount).not.toBe(10000)
    expect(result.response.amount).not.toBe(11000)
    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 9000,
        currency_code: "brl",
        cart_id: cart.id,
      })
    )
    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(1)
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
    const stripeLayer = createStripePixLayer(
      mockRawStripePixPaymentIntent({ amount: 11000 })
    )

    const result = await startPixPaymentAttempt({
      cart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: cart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      at: new Date("2026-06-29T12:00:00.000Z"),
    })

    expect(result.response.amount).toBe(11000)
    expect(result.attempt.amount).toBe(11000)
    expect(result.response.amount).not.toBe(10000)
    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_minor: 11000,
        currency_code: "brl",
        cart_id: cart.id,
      })
    )
    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(1)
  })

  it("nao chama Stripe quando cart.total esta ausente mesmo com line items somaveis", async () => {
    const stripeLayer = createStripePixLayer()
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
      startPixPaymentAttempt({
        cart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: cart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      })
    ).rejects.toThrow(MedusaError)

    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("nao chama Stripe quando cart.total ausente mesmo com credito extra reconstruivel", async () => {
    const stripeLayer = createStripePixLayer()
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
      startPixPaymentAttempt({
        cart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: cart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      })
    ).rejects.toThrow(MedusaError)

    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it.each([null, 0, -1, 99.999, NaN])(
    "nao chama Stripe quando cart.total e invalido (%p)",
    async (total) => {
      const stripeLayer = createStripePixLayer()
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: total as number | null,
      })

      await expect(
        startPixPaymentAttempt({
          cart,
          actor: { actorType: "guest", actorId: "sess_guest_01" },
          sessionActiveCartId: cart.id,
          existingAttempts: [],
          stripeLayer,
          generateId: () => "payatt_pix_new_01",
          paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
        })
      ).rejects.toThrow(MedusaError)

      expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(0)
    }
  )

  it("PaymentAttempt persiste expires_at e IDs seguros — sem QR/copia-e-cola integral", async () => {
    const stripeLayer = createStripePixLayer()
    const result = await startPixPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
    })

    expect(result.attempt.order_id).toBeNull()
    expect(result.attempt.provider_payment_intent_id).toBe("pi_pix_init_mock")
    expect(result.attempt.amount).toBe(9900)
    expect(result.attempt.currency_code).toBe("brl")
    expect(result.attempt.expires_at).toBe(
      new Date(1782863999 * 1000).toISOString()
    )
    expect(result.attempt.status).toBe("awaiting_pix_payment")
    expect(result.attempt).not.toHaveProperty("copy_paste")
    expect(result.attempt).not.toHaveProperty("qr_code")
    expect(JSON.stringify(result.attempt.metadata)).not.toMatch(/_secret_/)
    expect(JSON.stringify(result.attempt)).not.toContain("00020126")
  })

  it("PaymentSession.data mockado e allowlist-only", async () => {
    const stripeLayer = createStripePixLayer()
    const result = await startPixPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
    })

    expect(result.paymentSessionData).not.toHaveProperty("client_secret")
    expect(result.paymentSessionData).not.toHaveProperty("next_action")
    expect(result.paymentSessionData).not.toHaveProperty("copy_paste")
    expect(result.paymentSessionData).toEqual(
      expect.objectContaining({
        provider_payment_intent_id: "pi_pix_init_mock",
        amount: 9900,
        currency_code: "brl",
        expires_at: new Date(1782863999 * 1000).toISOString(),
      })
    )
  })

  it("supersede tentativa Pix ativa anterior do mesmo cart", async () => {
    const stripeLayer = createStripePixLayer()
    const result = await startPixPaymentAttempt({
      cart: completeCart,
      actor: { actorType: "guest", actorId: "sess_guest_01" },
      sessionActiveCartId: completeCart.id,
      existingAttempts: [existingActivePixAttempt()],
      stripeLayer,
      generateId: () => "payatt_pix_new_01",
      paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
    })

    expect(result.supersededAttempts).toHaveLength(1)
    expect(result.supersededAttempts[0]?.status).toBe("superseded")
    expect(result.attempt.status).toBe("awaiting_pix_payment")
  })

  it("rejeita cart incompleto via eligibility de 04-03", async () => {
    const incompleteCart = buildCompleteGuestCart({
      id: "cart_guest_01",
      email: null,
      total: 99,
    })

    await expect(
      startPixPaymentAttempt({
        cart: incompleteCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: incompleteCart.id,
        existingAttempts: [],
        stripeLayer: createStripePixLayer(),
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      })
    ).rejects.toThrow(MedusaError)
  })

  it("erro saneado nao ecoa payload Stripe bruto", async () => {
    const stripeLayer: StripePixInitiationLayer = {
      createPixPaymentIntent: jest.fn(async () => {
        throw new Error(
          "Stripe error pi_pix_init_mock_secret_synthetic 00020126580014BR.GOV.BCB.PIX"
        )
      }),
    }

    let caught: unknown

    try {
      await startPixPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
        commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MedusaError)
    const message = (caught as MedusaError).message
    expect(message).not.toMatch(/_secret_/)
    expect(message).not.toContain("00020126")
    expect(message).toContain("[REDACTED]")
    expect(sanitizeError(caught as Error).message).not.toMatch(/_secret_/)
  })

  it("rejeita retorno Stripe-like com amount divergente do cart", async () => {
    const stripeLayer = createStripePixLayer(
      mockRawStripePixPaymentIntent({ amount: 99 })
    )

    await expect(
      startPixPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
        commitAndRereadAuthority: createCommitAndRereadPixAuthorityStub(),
      })
    ).rejects.toThrow("Stripe retornou dados de pagamento divergentes do carrinho.")
  })

  it("nao chama Stripe sem freeze+v1 quando commitAndRereadAuthority esta ausente", async () => {
    const stripeLayer = createStripePixLayer()

    await expect(
      startPixPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)

    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("nao chama Stripe quando a autoridade relida esta incompleta", async () => {
    const stripeLayer = createStripePixLayer()

    await expect(
      startPixPaymentAttempt({
        cart: completeCart,
        actor: { actorType: "guest", actorId: "sess_guest_01" },
        sessionActiveCartId: completeCart.id,
        existingAttempts: [],
        stripeLayer,
        generateId: () => "payatt_pix_new_01",
        paymentCollection: { payment_collection_id: "paycol_pix_new_01" },
        commitAndRereadAuthority: async (prepared) =>
          ({
            attempt: prepared.attempt,
            cart_resource_version: 1,
            amount_minor: prepared.attempt.amount,
            currency_code: "brl",
            payment_method_type: "pix",
            provider_idempotency_key: prepared.idempotencyKey,
            financial_freeze_started_at: null as unknown as string,
            authority_created_at: "2026-09-02T12:00:00.000Z",
            replay_deadline: "2026-09-03T11:00:00.000Z",
          }) as DurablePreProviderAuthority,
      })
    ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)

    expect(stripeLayer.createPixPaymentIntent).toHaveBeenCalledTimes(0)
  })

  it("createSyntheticStripePixLayer retorna PI mock sem config Stripe", async () => {
    const layer = createSyntheticStripePixLayer()
    const raw = await layer.createPixPaymentIntent({
      amount_minor: 5000,
      currency_code: "brl",
      cart_id: "cart_synthetic",
      idempotency_key: "idem_pix_01",
      payment_attempt_id: "payatt_synthetic",
      canonical_request: buildStripeCanonicalPaymentIntentCreateRequest({
        payment_method_type: "pix",
        amount_minor: 5000,
        cart_id: "cart_synthetic",
        payment_attempt_id: "payatt_synthetic",
        payment_session_id: null,
      }),
    })

    expect(raw.id).toMatch(/^pi_pix_synthetic_/)
    expect(
      (raw.next_action as { pix_display_qr_code?: { data?: string } })
        .pix_display_qr_code?.data
    ).toContain("00020126")
  })
})

describe("04-05 pix local state helpers", () => {
  it("markPixExpired mantem order_id null e status pix_expired", () => {
    const attempt = existingActivePixAttempt({
      id: "payatt_expire",
      status: "awaiting_pix_payment",
    })

    const expired = markPixExpired(attempt, new Date("2026-06-29T13:00:00.000Z"))

    expect(expired.status).toBe("pix_expired")
    expect(expired.order_id).toBeNull()
    expect(expired.expired_at).toBe("2026-06-29T13:00:00.000Z")
    expect(expired.provider_payment_intent_id).toBe("pi_pix_old")
  })

  it("markPixFailed mantem order_id null e status payment_failed", () => {
    const attempt = existingActivePixAttempt({
      status: "awaiting_pix_payment",
    })

    const failed = markPixFailed(attempt, new Date("2026-06-29T13:00:00.000Z"))

    expect(failed.status).toBe("payment_failed")
    expect(failed.order_id).toBeNull()
    expect(failed.failed_at).toBe("2026-06-29T13:00:00.000Z")
  })

  it("markPixCanceled mantem order_id null e status payment_canceled", () => {
    const attempt = existingActivePixAttempt({
      status: "awaiting_pix_payment",
    })

    const canceled = markPixCanceled(
      attempt,
      new Date("2026-06-29T13:00:00.000Z")
    )

    expect(canceled.status).toBe("payment_canceled")
    expect(canceled.order_id).toBeNull()
    expect(canceled.canceled_at).toBe("2026-06-29T13:00:00.000Z")
  })

  it("awaiting_pix_payment, pix_expired, payment_failed e payment_canceled nunca criam Order", () => {
    const statuses = [
      markPixExpired(
        existingActivePixAttempt({ status: "awaiting_pix_payment" })
      ),
      markPixFailed(
        existingActivePixAttempt({ status: "awaiting_pix_payment" })
      ),
      markPixCanceled(
        existingActivePixAttempt({ status: "awaiting_pix_payment" })
      ),
    ]

    for (const attempt of statuses) {
      expect(attempt.order_id).toBeNull()
      expect(attempt.status).not.toBe("paid")
      expect(attempt.status).not.toBe("succeeded")
    }
  })

  it("nao permite transicao de status terminal para pix_expired", () => {
    const attempt = existingActivePixAttempt({
      status: "superseded",
    })

    expect(() => markPixExpired(attempt)).toThrow(
      "PAYMENT_ATTEMPT_TRANSITION_INVALID"
    )
  })
})
