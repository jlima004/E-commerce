import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import defaultMiddlewares from "../../src/api/middlewares"
import {
  applyStoreCartPreOrderQueryConfig,
} from "../../src/api/store/carts/query-config"
import { POST as startCardPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/card/route"
import { POST as startPixPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/pix/route"
import { getPaymentStartRejectedBodyMessage } from "../../src/api/store/carts/payment-attempts/validators"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import {
  STRIPE_CARD_INITIATION_LAYER,
  type StripeCardInitiationLayer,
} from "../../src/modules/payment-attempt/card"
import {
  STRIPE_PIX_INITIATION_LAYER,
  type StripePixInitiationLayer,
} from "../../src/modules/payment-attempt/pix"
import type { StoreCartPreOrderRecord } from "../../src/api/store/carts/serializers"
import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../src/api/store/carts/serializers"
import {
  PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY,
  withPaymentAttemptCartFingerprintMetadata,
} from "../../src/modules/payment-attempt/cart-invalidation"
import { findActiveAttemptsForCart } from "../../src/modules/payment-attempt/service"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"

const VALID_CPF_NORMALIZED = "52998224725"

const FORBIDDEN_RESPONSE_SUBSTRINGS = [
  "order_id",
  "\"order\"",
  "WebhookEventLog",
  "CheckoutCompletionLog",
  "purchase_completed",
  "gelato",
  "order.gelatoapis.com",
  "payment_session.data",
  "next_action",
  "\"payment_method\":",
  "charges",
] as const

const FORBIDDEN_PRODUCTION_SUBSTRINGS = [
  "completeCartWorkflow",
  "/store/carts/",
  "sdk.store.cart.complete",
  "WebhookEventLog",
  "CheckoutCompletionLog",
  "purchase_completed",
  "order.gelatoapis.com",
  "gelato_order_id",
] as const

function buildExistingAttemptForCart(
  cart: StoreCartPreOrderRecord & { total?: number | null },
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  const fingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)

  return {
    id: "payatt_existing_01",
    cart_id: cart.id,
    payment_collection_id: "paycol_existing",
    payment_session_id: "payses_existing",
    provider: "stripe_safe_layer",
    provider_payment_intent_id: "pi_existing",
    provider_payment_session_id: "ps_existing",
    payment_method_type: "card",
    status: "card_client_secret_created",
    amount: cart.total ?? 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: withPaymentAttemptCartFingerprintMetadata(null, fingerprint),
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

function countActiveAttempts(
  attempts: PaymentAttemptRecord[],
  cartId: string
): number {
  return findActiveAttemptsForCart(attempts, cartId).length
}

function sellableVariant() {
  return {
    id: "variant_sellable",
    sku: "TSHIRT-BLACK-M",
    metadata: {
      gelato_product_uid: "prod_gelato_abc123",
      gelato_template_id: "template_fixed_001",
      gelato_variant_options: { size: "M", color: "Preto" },
      template_mode: "fixed",
    },
    prices: [{ currency_code: "brl", amount: 9900 }],
  }
}

function buildCompleteGuestCart(
  overrides: Partial<StoreCartPreOrderRecord & { total?: number | null }> = {}
): StoreCartPreOrderRecord & { total?: number | null } {
  return {
    id: "cart_guest_01",
    email: "guest@exemplo.com",
    currency_code: "brl",
    locale: "pt-BR",
    region_id: "reg_br",
    created_at: "2026-06-27T10:00:00.000Z",
    updated_at: "2026-06-27T10:00:00.000Z",
    metadata: null,
    customer: null,
    total: 9900,
    items: [
      {
        id: "item_01",
        quantity: 1,
        title: "Camiseta Essential",
        variant_id: "variant_sellable",
        variant_title: "Preto / M",
        unit_price: 9900,
        variant: sellableVariant(),
      },
    ],
    shipping_address: {
      first_name: "Maria",
      last_name: "Silva",
      company: null,
      address_1: "Rua A, 100",
      address_2: null,
      city: "Sao Paulo",
      postal_code: "01311000",
      country_code: "BR",
      province: "SP",
      phone: "+5511999999999",
      metadata: {
        federal_tax_id: VALID_CPF_NORMALIZED,
      },
    },
    region: {
      countries: [{ iso_2: "br" }],
    },
    ...overrides,
  }
}

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
  params?: {
    id?: string
  }
  body?: Record<string, unknown>
}

function createRequest(overrides: Partial<SessionCapableRequest> = {}) {
  return {
    query: {},
    params: { id: "cart_guest_01" },
    body: {},
    scope: {
      resolve: jest.fn(),
    },
    ...overrides,
  } as SessionCapableRequest
}

function createResponse() {
  const jsonSpy = jest.fn()
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      jsonSpy(body)
      return response
    }),
    jsonSpy,
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
    jsonSpy: jest.Mock
  }
}

type RemoteQueryShape = {
  __value?: Record<
    string,
    {
      __args?: {
        filters?: Record<string, unknown>
      }
    }
  >
}

function readRemoteQueryTarget(queryObject: RemoteQueryShape): {
  entryPoint?: string
  filters: Record<string, unknown>
} {
  const entryPoint = queryObject.__value
    ? Object.keys(queryObject.__value)[0]
    : undefined
  const filters =
    (entryPoint && queryObject.__value?.[entryPoint]?.__args?.filters) ?? {}

  return { entryPoint, filters }
}

function createRemoteQueryResolver(input: {
  carts?: Record<string, StoreCartPreOrderRecord & { total?: number | null }>
}) {
  const carts = input.carts ?? {}

  return jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "cart" && filters.id) {
      const cart = carts[String(filters.id)]
      return cart ? [cart] : []
    }

    return []
  })
}

function createPaymentAttemptModuleMock(
  existingAttempts: PaymentAttemptRecord[] = []
) {
  const attempts = [...existingAttempts]

  return {
    listPaymentAttempts: jest.fn(async () => attempts),
    createPaymentAttempts: jest.fn(async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
      const rows = Array.isArray(data) ? data : [data]
      attempts.push(...rows)
      return rows
    }),
    updatePaymentAttempts: jest.fn(async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
      const rows = Array.isArray(data) ? data : [data]
      for (const row of rows) {
        const index = attempts.findIndex((item) => item.id === row.id)
        if (index >= 0) {
          attempts[index] = row
        }
      }
      return rows
    }),
    attempts,
  }
}

function createStripeCardInitiationLayerMock(
  overrides: Record<string, unknown> = {}
): StripeCardInitiationLayer {
  return {
    createCardPaymentIntent: jest.fn(async (request) => ({
      id: "pi_http_card_mock",
      object: "payment_intent",
      status: "requires_payment_method",
      amount: request.amount,
      currency: request.currency_code,
      client_secret: "pi_http_card_mock_secret_test",
      metadata: {
        cart_id: request.cart_id,
        session_id: "payses_http_card_mock",
      },
      ...overrides,
    })),
  }
}

function createStripePixInitiationLayerMock(
  overrides: Record<string, unknown> = {}
): StripePixInitiationLayer {
  return {
    createPixPaymentIntent: jest.fn(async (request) => ({
      id: "pi_http_pix_mock",
      object: "payment_intent",
      status: "requires_action",
      amount: request.amount,
      currency: request.currency_code,
      client_secret: "pi_http_pix_mock_secret_test",
      metadata: {
        cart_id: request.cart_id,
        session_id: "payses_http_pix_mock",
      },
      next_action: {
        type: "pix_display_qr_code",
        pix_display_qr_code: {
          expires_at: 1782863999,
          data: "00020126580014BR.GOV.BCB.PIX0136http_pix_copy_paste_test",
          hosted_instructions_url: "https://payments.stripe.com/pix/http_mock",
          image_url_png: "https://payments.stripe.com/pix/http_mock.png",
        },
      },
      ...overrides,
    })),
  }
}

function wireScope(
  req: SessionCapableRequest,
  options: {
    remoteQuery?: ReturnType<typeof createRemoteQueryResolver>
    paymentAttemptModule?: unknown
    paymentAttemptModuleResolveError?: Error
    stripeCardInitiationLayer?: StripeCardInitiationLayer | null
    stripePixInitiationLayer?: StripePixInitiationLayer | null
  } = {}
) {
  const remoteQuery = options.remoteQuery ?? createRemoteQueryResolver({})
  const paymentAttemptModule =
    options.paymentAttemptModule ?? createPaymentAttemptModuleMock()
  const stripeCardInitiationLayer =
    options.stripeCardInitiationLayer === undefined
      ? createStripeCardInitiationLayerMock()
      : options.stripeCardInitiationLayer
  const stripePixInitiationLayer =
    options.stripePixInitiationLayer === undefined
      ? createStripePixInitiationLayerMock()
      : options.stripePixInitiationLayer

  req.scope.resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      if (options.paymentAttemptModuleResolveError) {
        throw options.paymentAttemptModuleResolveError
      }

      return paymentAttemptModule
    }

    if (key === STRIPE_CARD_INITIATION_LAYER) {
      return stripeCardInitiationLayer
    }

    if (key === STRIPE_PIX_INITIATION_LAYER) {
      return stripePixInitiationLayer
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  return { remoteQuery, paymentAttemptModule }
}

function assertCardPaymentResponseBody(body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase()

  for (const forbidden of FORBIDDEN_RESPONSE_SUBSTRINGS) {
    expect(serialized).not.toContain(forbidden.toLowerCase())
  }

  expect(body).toEqual(
    expect.objectContaining({
      payment_attempt: expect.objectContaining({
        payment_method_type: "card",
        client_secret: expect.stringMatching(/_secret_/),
      }),
    })
  )

  const paymentAttempt = (body as { payment_attempt?: Record<string, unknown> })
    .payment_attempt

  expect(paymentAttempt).not.toHaveProperty("payment_session")
  expect(paymentAttempt).not.toHaveProperty("data")
  expect(Object.keys(paymentAttempt ?? {}).sort()).toEqual(
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

async function invokeCardPaymentRoute(req: SessionCapableRequest) {
  const res = createResponse()
  applyStoreCartPreOrderQueryConfig(req as never)
  await startCardPaymentAttemptRoute(req, res)
  return res
}

function assertPixPaymentResponseBody(body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase()

  for (const forbidden of FORBIDDEN_RESPONSE_SUBSTRINGS) {
    expect(serialized).not.toContain(forbidden.toLowerCase())
  }

  expect(body).toEqual(
    expect.objectContaining({
      payment_attempt: expect.objectContaining({
        payment_method_type: "pix",
        copy_paste: expect.stringContaining("00020126"),
        qr_code: expect.any(String),
        expires_at: expect.any(String),
      }),
    })
  )

  const paymentAttempt = (body as { payment_attempt?: Record<string, unknown> })
    .payment_attempt

  expect(paymentAttempt).not.toHaveProperty("payment_session")
  expect(paymentAttempt).not.toHaveProperty("data")
  expect(paymentAttempt).not.toHaveProperty("next_action")

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

  for (const key of Object.keys(paymentAttempt ?? {})) {
    expect(allowedKeys).toContain(key)
  }
}

async function invokePixPaymentRoute(req: SessionCapableRequest) {
  const res = createResponse()
  applyStoreCartPreOrderQueryConfig(req as never)
  await startPixPaymentAttemptRoute(req, res)
  return res
}

describe("payment attempt store card contract", () => {
  describe("card", () => {
    it("POST /store/carts/:id/payment-attempts/card inicia cartao em cart completo", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      assertCardPaymentResponseBody(res.jsonSpy.mock.calls[0][0])
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(9900)
      expect(body.payment_attempt.currency_code).toBe("BRL")
      expect(body.payment_attempt.status).toBe("card_client_secret_created")
    })

    it("falha fechada quando camada Stripe card nao esta configurada", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer: null,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para cartao nao configurada."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao esta disponivel antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer,
        paymentAttemptModuleResolveError: new Error(
          "payment attempt missing pi_http_card_mock_secret_test"
        ),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao expoe listPaymentAttempts antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer,
        paymentAttemptModule: {
          createPaymentAttempts: jest.fn(),
          updatePaymentAttempts: jest.fn(),
        },
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando listPaymentAttempts falha antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      paymentAttemptModule.listPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_card_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripeCardInitiationLayer,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(paymentAttemptModule.listPaymentAttempts).toHaveBeenCalledWith({
        cart_id: cart.id,
      })
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao pode ser persistido", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.createPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_card_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, { remoteQuery, paymentAttemptModule })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao registrar tentativa de pagamento."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("rejeita cart incompleto", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: null,
        total: 9900,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita guest sem posse do cart via sessionActiveCartId", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: "cart_other",
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita body com campos monetarios", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        body: { amount: 100 },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        getPaymentStartRejectedBodyMessage()
      )
    })

    it("nao retorna Order nem PaymentSession.data bruto", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeCardPaymentRoute(req)
      const serialized = JSON.stringify(res.jsonSpy.mock.calls[0][0])

      expect(serialized).not.toMatch(/completeCartWorkflow/)
      expect(serialized).not.toContain("WebhookEventLog")
      expect(serialized).not.toContain("CheckoutCompletionLog")
      expect(serialized).not.toContain("purchase_completed")
      expect(serialized).not.toContain("gelato")
    })

    it("registra middleware Store API para rota card", () => {
      const cardRoute = defaultMiddlewares.routes.find(
        (route) => route.matcher === "/store/carts/:id/payment-attempts/card"
      )

      expect(cardRoute).toBeDefined()
      expect(cardRoute?.methods ?? cardRoute?.method).toEqual(
        expect.arrayContaining(["POST"])
      )
    })
  })

  describe("pix", () => {
    it("POST /store/carts/:id/payment-attempts/pix inicia Pix em cart completo", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      assertPixPaymentResponseBody(res.jsonSpy.mock.calls[0][0])
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(9900)
      expect(body.payment_attempt.currency_code).toBe("BRL")
      expect(body.payment_attempt.status).toBe("awaiting_pix_payment")
      expect(body.payment_attempt.expires_at).toBe(
        new Date(1782863999 * 1000).toISOString()
      )
    })

    it("falha fechada quando camada Stripe Pix nao esta configurada", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripePixInitiationLayer: null,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para Pix nao configurada."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao esta disponivel antes de chamar Stripe Pix", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripePixInitiationLayer = createStripePixInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripePixInitiationLayer,
        paymentAttemptModuleResolveError: new Error(
          "payment attempt missing pi_http_pix_mock_secret_test"
        ),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripePixInitiationLayer.createPixPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao pode ser persistido", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.createPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_pix_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, { remoteQuery, paymentAttemptModule })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao registrar tentativa de pagamento."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("rejeita cart incompleto", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: null,
        total: 9900,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita body com campos monetarios", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        body: { currency_code: "USD" },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(
        getPaymentStartRejectedBodyMessage()
      )
    })

    it("nao retorna Order nem PaymentSession.data bruto", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokePixPaymentRoute(req)
      const serialized = JSON.stringify(res.jsonSpy.mock.calls[0][0])

      expect(serialized).not.toMatch(/completeCartWorkflow/)
      expect(serialized).not.toContain("WebhookEventLog")
      expect(serialized).not.toContain("CheckoutCompletionLog")
      expect(serialized).not.toContain("purchase_completed")
      expect(serialized).not.toContain("gelato")
      expect(serialized).not.toContain("next_action")
    })

    it("registra middleware Store API para rota pix", () => {
      const pixRoute = defaultMiddlewares.routes.find(
        (route) => route.matcher === "/store/carts/:id/payment-attempts/pix"
      )

      expect(pixRoute).toBeDefined()
      expect(pixRoute?.methods ?? pixRoute?.method).toEqual(
        expect.arrayContaining(["POST"])
      )
    })
  })

  describe("retry supersede and invalidated_by_cart_change", () => {
    it("retry card->card supersede mantem uma tentativa ativa por cart", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_card_old",
        payment_method_type: "card",
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_card_old",
          status: "superseded",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, cart.id)).toBe(1)
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active[0]?.payment_method_type).toBe("card")
      expect(active[0]?.order_id).toBeNull()
    })

    it("retry pix->pix supersede mantem uma tentativa ativa por cart", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_pix_old",
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_pix_old",
          status: "superseded",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, cart.id)).toBe(1)
    })

    it("troca card->pix supersede tentativa ativa anterior", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_card_old",
        payment_method_type: "card",
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ status: "superseded" })
      )
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active).toHaveLength(1)
      expect(active[0]?.payment_method_type).toBe("pix")
    })

    it("troca pix->card supersede tentativa ativa anterior", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_pix_old",
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ status: "superseded" })
      )
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active).toHaveLength(1)
      expect(active[0]?.payment_method_type).toBe("card")
    })

    it("mutacao de email invalida tentativa stale antes de nova iniciacao card", async () => {
      const originalCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 9900,
        email: "original@exemplo.com",
      })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 9900,
        email: "novo@exemplo.com",
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "awaiting_pix_payment",
        payment_method_type: "pix",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale",
          status: "invalidated_by_cart_change",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, mutatedCart.id)).toBe(1)
    })

    it("mutacao de quantidade invalida tentativa stale antes de nova iniciacao pix", async () => {
      const originalCart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 19800,
        items: [
          {
            ...originalCart.items![0],
            quantity: 2,
          },
        ],
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale_qty",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "awaiting_pix_payment",
        payment_method_type: "pix",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale_qty",
          status: "invalidated_by_cart_change",
        })
      )
    })

    it("mutacao de shipping address invalida tentativa stale", async () => {
      const originalCart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 9900,
        shipping_address: {
          ...originalCart.shipping_address!,
          address_1: "Av Paulista, 1000",
          postal_code: "01310100",
        },
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale_ship",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale_ship",
          status: "invalidated_by_cart_change",
        })
      )
    })
  })

  describe("phase 04 final negative proofs", () => {
    it("respostas card/pix nao retornam Order, webhook, completion ou Gelato", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery })

      const cardRes = await invokeCardPaymentRoute(req)
      const pixRes = await invokePixPaymentRoute(req)
      const combined = JSON.stringify([
        cardRes.jsonSpy.mock.calls[0][0],
        pixRes.jsonSpy.mock.calls[0][0],
      ]).toLowerCase()

      for (const forbidden of FORBIDDEN_PRODUCTION_SUBSTRINGS) {
        if (forbidden === "/store/carts/") {
          continue
        }
        expect(combined).not.toContain(forbidden.toLowerCase())
      }

      expect(combined).not.toMatch(/"order"/)
      expect(combined).not.toContain("order_id")
    })

    it("nao persiste client_secret, QR integral ou next_action na trilha PaymentAttempt", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 9900 })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      const persisted = paymentAttemptModule.attempts[0]
      const serialized = JSON.stringify(persisted).toLowerCase()

      expect(serialized).not.toContain("client_secret")
      expect(serialized).not.toContain("next_action")
      expect(serialized).not.toContain("00020126")
      expect(persisted?.metadata?.[PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY]).toEqual(
        expect.any(String)
      )
      expect(persisted?.order_id).toBeNull()
    })

    it("estados Pix locais nao criam Order na resposta HTTP", async () => {
      const terminalStatuses = [
        "awaiting_pix_payment",
        "pix_expired",
        "payment_failed",
        "payment_canceled",
      ] as const

      for (const status of terminalStatuses) {
        const cart = buildCompleteGuestCart({ id: `cart_${status}`, total: 9900 })
        const existing = buildExistingAttemptForCart(cart, {
          id: `payatt_${status}`,
          status,
          payment_method_type: "pix",
        })
        const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
        const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
        const req = createRequest({
          params: { id: cart.id },
          session: { id: "sess_guest_01", active_cart_id: cart.id },
        })
        wireScope(req, { remoteQuery, paymentAttemptModule })

        const res = await invokePixPaymentRoute(req)
        const body = res.jsonSpy.mock.calls[0][0]

        expect(body.payment_attempt.order_id).toBeUndefined()
        expect(JSON.stringify(body)).not.toContain('"order"')
      }
    })
  })
})
