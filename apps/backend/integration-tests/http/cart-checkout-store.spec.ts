import fs from "fs"
import path from "path"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createCartWorkflow,
  transferCartCustomerWorkflowId,
  updateCartWorkflowId,
} from "@medusajs/core-flows"
import defaultMiddlewares from "../../src/api/middlewares"
import {
  applyStoreCartPreOrderQueryConfig,
  storeCartPreOrderFields,
} from "../../src/api/store/carts/query-config"
import {
  serializeStoreCartPreOrder,
  storeCartPreOrderResponseMiddleware,
  withCheckoutDataComplete,
} from "../../src/api/store/carts/serializers"
import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import { POST as attachGuestCart } from "../../src/api/store/customers/me/cart/attach/route"
import {
  validateBrazilShippingAddress,
  type BrazilShippingAddressInput,
} from "../../src/modules/checkout/checkout-data"
import type { StoreCartPreOrderRecord } from "../../src/api/store/carts/serializers"

jest.mock("@medusajs/core-flows", () => ({
  createCartWorkflow: jest.fn(),
  transferCartCustomerWorkflowId: "transferCartCustomerWorkflow",
  updateCartWorkflowId: "updateCartWorkflow",
}))

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "Preto",
  },
  template_mode: "fixed",
} as const

const VALID_CPF = "529.982.247-25"
const VALID_CPF_NORMALIZED = "52998224725"

const FORBIDDEN_RESPONSE_SUBSTRINGS = [
  "order_id",
  "payment_session_id",
  "payment_intent_id",
  "payment_attempt_id",
  "gelato_order_id",
  "ready_for_payment",
  "payment_collection",
] as const

const FORBIDDEN_WORKFLOW_IDS = [
  "completeCartWorkflow",
  "createPaymentSessionWorkflow",
  "capturePaymentWorkflow",
  "createOrderWorkflow",
] as const

function sellableVariant() {
  return {
    id: "variant_sellable",
    sku: "TSHIRT-BLACK-M",
    metadata: { ...COMPLETE_GELATO_METADATA },
    prices: [{ currency_code: "brl", amount: 9900 }],
  }
}

function validBrazilShippingAddress(
  overrides: Partial<BrazilShippingAddressInput> = {}
): BrazilShippingAddressInput {
  return {
    full_name: "Maria Silva",
    address_1: "Rua A, 100",
    city: "Sao Paulo",
    province: "sp",
    postal_code: "01311-000",
    country_code: "br",
    federal_tax_id: VALID_CPF,
    ...overrides,
  }
}

function buildStoreCartRecord(
  overrides: Partial<StoreCartPreOrderRecord> = {}
): StoreCartPreOrderRecord {
  return {
    id: "cart_guest_01",
    email: null,
    currency_code: "brl",
    locale: "pt-BR",
    region_id: "reg_br",
    created_at: "2026-06-27T10:00:00.000Z",
    updated_at: "2026-06-27T10:00:00.000Z",
    metadata: null,
    customer: null,
    items: [],
    shipping_address: null,
    region: {
      countries: [{ iso_2: "br" }],
    },
    ...overrides,
  }
}

function buildCompleteGuestCart(
  overrides: Partial<StoreCartPreOrderRecord> = {}
): StoreCartPreOrderRecord {
  return buildStoreCartRecord({
    email: "guest@exemplo.com",
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
    ...overrides,
  })
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
  body?: Record<string, unknown>
}

function createRequest(overrides: Partial<SessionCapableRequest> = {}) {
  return {
    query: {},
    queryConfig: {
      fields: ["id"],
    },
    filterableFields: {},
    params: {},
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

function assertPreOrderHttpBody(body: unknown) {
  const serialized = JSON.stringify(body)

  for (const forbidden of FORBIDDEN_RESPONSE_SUBSTRINGS) {
    expect(serialized.toLowerCase()).not.toContain(forbidden)
  }

  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>
    expect(record).not.toHaveProperty("order")
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
    (entryPoint &&
      queryObject.__value?.[entryPoint]?.__args?.filters) ??
    {}

  return { entryPoint, filters }
}

function createRemoteQueryResolver(input: {
  carts?: Record<string, StoreCartPreOrderRecord>
  customers?: Record<string, { id: string; email?: string | null }>
  customerCarts?: Record<string, StoreCartPreOrderRecord[]>
}) {
  const carts = input.carts ?? {}
  const customers = input.customers ?? {}
  const customerCarts = input.customerCarts ?? {}

  return jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "cart") {
      if (filters.id) {
        const cart = carts[String(filters.id)]
        return cart ? [cart] : []
      }

      if (filters.customer_id) {
        return customerCarts[String(filters.customer_id)] ?? []
      }
    }

    if (entryPoint === "customer") {
      const customer = customers[String(filters.id)]
      return customer ? [customer] : []
    }

    return []
  })
}

function wireScope(
  req: SessionCapableRequest,
  options: {
    remoteQuery?: ReturnType<typeof createRemoteQueryResolver>
    workflowRun?: jest.Mock
  } = {}
) {
  const remoteQuery = options.remoteQuery ?? createRemoteQueryResolver({})
  const workflowRun = options.workflowRun ?? jest.fn(async () => ({ result: {} }))

  req.scope.resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === Modules.WORKFLOW_ENGINE) {
      return { run: workflowRun }
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  return { remoteQuery, workflowRun }
}

async function invokeActiveCartRoute(
  method: "GET" | "POST",
  req: SessionCapableRequest
) {
  const res = createResponse()

  applyStoreCartPreOrderQueryConfig(req as never)
  storeCartPreOrderResponseMiddleware(req, res, jest.fn())

  if (method === "GET") {
    await getActiveCart(req, res)
  } else {
    await postActiveCart(req, res)
  }

  return res
}

async function invokeAttachRoute(req: SessionCapableRequest) {
  const res = createResponse()

  applyStoreCartPreOrderQueryConfig(req as never)
  storeCartPreOrderResponseMiddleware(req, res, jest.fn())

  await attachGuestCart(req, res)

  return res
}

describe("cart checkout store contract", () => {
  const mockedCreateCartWorkflow = createCartWorkflow as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockedCreateCartWorkflow.mockReturnValue({
      run: jest.fn(async () => ({
        result: { id: "cart_created_01" },
      })),
    })
  })

  describe("guest cart", () => {
    it("POST /store/carts/active cria cart sem conta e sem email obrigatorio", async () => {
      const createdCart = buildStoreCartRecord({
        id: "cart_created_01",
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [createdCart.id]: createdCart,
        },
      })

      const req = createRequest({
        session: {
          id: "sess_guest_01",
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("POST", req)

      expect(res.statusCode).toBe(201)
      const body = res.jsonSpy.mock.calls[0][0]
      assertPreOrderHttpBody(body)
      expect(body.cart).toEqual(
        expect.objectContaining({
          id: "cart_created_01",
          email: null,
          checkout_data_complete: false,
        })
      )
      expect(req.session?.active_cart_id).toBe("cart_created_01")
    })

    it("GET /store/carts/active consulta o guest cart da sessao atual sem email", async () => {
      const guestCart = buildStoreCartRecord({
        id: "cart_guest_01",
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
        },
      })

      const req = createRequest({
        session: {
          id: "sess_guest_01",
          active_cart_id: guestCart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("GET", req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      assertPreOrderHttpBody(body)
      expect(body.cart.id).toBe("cart_guest_01")
      expect(body.cart.email).toBeNull()
      expect(body.cart.checkout_data_complete).toBe(false)
    })
  })

  describe("authenticated customer cart", () => {
    it("POST /store/carts/active cria ou recupera cart associado ao customer autenticado", async () => {
      const customerCart = buildStoreCartRecord({
        id: "cart_customer_01",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [customerCart.id]: customerCart,
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        body: {
          customer_id: "cus_spoofed",
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("POST", req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      assertPreOrderHttpBody(body)
      expect(body.cart.customer).toEqual({
        id: "cus_123",
        email: "cliente@exemplo.com",
      })
      expect(mockedCreateCartWorkflow).not.toHaveBeenCalled()
    })

    it("GET /store/carts/active consulta o cart ativo do customer autenticado", async () => {
      const customerCart = buildCompleteGuestCart({
        id: "cart_customer_01",
        email: "cliente@exemplo.com",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [customerCart.id]: customerCart,
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("GET", req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.cart.customer.id).toBe("cus_123")
      expect(body.cart.email).toBe("cliente@exemplo.com")
    })
  })

  describe("guest cart attach / transfer", () => {
    it("transfere apenas o guest cart autorizado, nao vazio, da sessao atual", async () => {
      const guestCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: "guest@exemplo.com",
      })
      const customerCart = buildCompleteGuestCart({
        id: "cart_customer_old",
        email: "cliente@exemplo.com",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })
      const attachedCart = {
        ...guestCart,
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        email: "cliente@exemplo.com",
      }

      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
          [customerCart.id]: customerCart,
          [attachedCart.id]: attachedCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })
      const workflowRun = jest.fn(async () => ({ result: {} }))

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
        body: {
          cart_id: guestCart.id,
        },
      })
      wireScope(req, { remoteQuery, workflowRun })

      const res = await invokeAttachRoute(req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      assertPreOrderHttpBody(body)
      expect(body.outcome).toBe("attached_guest_cart")
      expect(body.cart.email).toBe("cliente@exemplo.com")
      expect(workflowRun).toHaveBeenCalledWith(transferCartCustomerWorkflowId, {
        input: {
          id: guestCart.id,
          customer_id: "cus_123",
        },
      })
      expect(workflowRun).toHaveBeenCalledWith(updateCartWorkflowId, {
        input: {
          id: guestCart.id,
          email: "cliente@exemplo.com",
        },
      })
    })

    it("rejeita cart_id no body quando nao corresponde a sessao atual", async () => {
      const guestCart = buildCompleteGuestCart({ id: "cart_guest_01" })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
      })

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        body: {
          cart_id: "cart_guest_999",
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeAttachRoute(req)).rejects.toMatchObject({
        type: MedusaError.Types.FORBIDDEN,
        message: "Guest cart da sessao atual nao esta autorizado para attach.",
      })
    })

    it("rejeita quando a sessao aponta para cart diferente do body", async () => {
      const guestCart = buildCompleteGuestCart({ id: "cart_guest_other" })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
      })

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        body: {
          cart_id: "cart_guest_other",
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeAttachRoute(req)).rejects.toMatchObject({
        type: MedusaError.Types.FORBIDDEN,
      })
    })

    it("preserva o customer cart util quando o guest cart da sessao esta vazio", async () => {
      const emptyGuestCart = buildStoreCartRecord({
        id: "cart_guest_empty",
      })
      const customerCart = buildCompleteGuestCart({
        id: "cart_customer_useful",
        email: "cliente@exemplo.com",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [emptyGuestCart.id]: emptyGuestCart,
          [customerCart.id]: customerCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })
      const workflowRun = jest.fn(async () => ({ result: {} }))

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: emptyGuestCart.id,
        },
      })
      wireScope(req, { remoteQuery, workflowRun })

      const res = await invokeAttachRoute(req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.outcome).toBe("preserve_customer_cart")
      expect(body.reason).toBe("guest_cart_empty_or_not_usable")
      expect(body.cart.id).toBe("cart_customer_useful")
      expect(workflowRun).not.toHaveBeenCalled()
    })

    it("faz o guest cart nao vazio vencer no login e marca o cart antigo como superseded", async () => {
      const guestCart = buildCompleteGuestCart({
        id: "cart_guest_winning",
        email: "guest@exemplo.com",
      })
      const oldCustomerCart = buildCompleteGuestCart({
        id: "cart_customer_old",
        email: "cliente@exemplo.com",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })
      const attachedCart = {
        ...guestCart,
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        email: "cliente@exemplo.com",
      }

      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
          [oldCustomerCart.id]: oldCustomerCart,
          [attachedCart.id]: attachedCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
        customerCarts: {
          cus_123: [oldCustomerCart],
        },
      })
      const workflowRun = jest.fn(async () => ({ result: {} }))

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
      })
      wireScope(req, { remoteQuery, workflowRun })

      const res = await invokeAttachRoute(req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.cart.id).toBe("cart_guest_winning")
      expect(workflowRun).toHaveBeenCalledWith(
        updateCartWorkflowId,
        expect.objectContaining({
          input: expect.objectContaining({
            id: "cart_customer_old",
            metadata: expect.objectContaining({
              active_for_checkout: false,
              superseded_by_cart_id: "cart_guest_winning",
            }),
          }),
        })
      )
    })

    it("usa customer.email como email final apos attach", async () => {
      const guestCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: "guest@exemplo.com",
      })
      const attachedCart = {
        ...guestCart,
        email: "cliente@exemplo.com",
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      }
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
          [attachedCart.id]: attachedCart,
        },
        customers: {
          cus_123: {
            id: "cus_123",
            email: "cliente@exemplo.com",
          },
        },
      })
      const workflowRun = jest.fn(async () => ({ result: {} }))

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
      })
      wireScope(req, { remoteQuery, workflowRun })

      const res = await invokeAttachRoute(req)
      const body = res.jsonSpy.mock.calls[0][0]

      expect(body.cart.email).toBe("cliente@exemplo.com")
      expect(body.cart.customer.email).toBe("cliente@exemplo.com")
    })
  })

  describe("checkout data / shipping address / checkout_data_complete", () => {
    it("forca a selecao publica minima de campos do cart pre-Order", () => {
      const req = createRequest({
        queryConfig: undefined,
      })

      applyStoreCartPreOrderQueryConfig(req as never)

      expect(req.query.fields).toBe(storeCartPreOrderFields.join(","))
    })

    it("shipping address Brasil aceita dados validos e mascara federal_tax_id na resposta HTTP", async () => {
      const cart = buildCompleteGuestCart({
        email: "guest@exemplo.com",
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [cart.id]: cart,
        },
      })

      const req = createRequest({
        session: {
          id: "sess_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("GET", req)
      const body = res.jsonSpy.mock.calls[0][0]

      expect(validateBrazilShippingAddress(validBrazilShippingAddress()).ok).toBe(true)
      expect(body.cart.shipping_address.masked_federal_tax_id).toBe("***.***.***-25")
      expect(JSON.stringify(body)).not.toContain(VALID_CPF_NORMALIZED)
      expect(JSON.stringify(body)).not.toContain(VALID_CPF)
    })

    it.each([
      ["country_code", { country_code: "US" }, "CHECKOUT_COUNTRY_CODE_INVALID"],
      ["postal_code", { postal_code: "123" }, "CHECKOUT_POSTAL_CODE_INVALID"],
      ["province", { province: "XX" }, "CHECKOUT_PROVINCE_INVALID"],
      [
        "federal_tax_id",
        { federal_tax_id: "111.111.111-11" },
        "CHECKOUT_FEDERAL_TAX_ID_INVALID",
      ],
    ])(
      "shipping address Brasil rejeita %s invalido com erro saneado",
      (_field, override, expectedCode) => {
        const result = validateBrazilShippingAddress(
          validBrazilShippingAddress(override)
        )

        expect(result.ok).toBe(false)
        if (result.ok) {
          throw new Error("expected invalid address")
        }

        expect(result.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: expectedCode,
            }),
          ])
        )

        const serialized = JSON.stringify(result.errors)
        expect(serialized).not.toContain("111.111.111-11")
        expect(serialized).not.toContain("11111111111")
      }
    )

    it("checkout_data_complete permanece false sem item, email ou endereco validos", async () => {
      const incompleteCart = buildStoreCartRecord({
        id: "cart_incomplete",
        email: null,
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [incompleteCart.id]: incompleteCart,
        },
      })

      const req = createRequest({
        session: {
          id: "sess_01",
          active_cart_id: incompleteCart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("GET", req)
      const body = res.jsonSpy.mock.calls[0][0]

      expect(body.cart.checkout_data_complete).toBe(false)
    })

    it("checkout_data_complete fica true apenas com item, email, endereco BR e contexto BRL", async () => {
      const completeCart = buildCompleteGuestCart({
        email: "guest@exemplo.com",
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [completeCart.id]: completeCart,
        },
      })

      const req = createRequest({
        session: {
          id: "sess_01",
          active_cart_id: completeCart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeActiveCartRoute("GET", req)
      const body = res.jsonSpy.mock.calls[0][0]

      expect(body.cart.checkout_data_complete).toBe(true)
      assertPreOrderHttpBody(body)
    })

    it("checkout_data_complete recalcula apos mutacao de item, email ou endereco", () => {
      const baseCart = buildCompleteGuestCart({
        email: "guest@exemplo.com",
      })

      expect(withCheckoutDataComplete(baseCart)).toBe(true)

      const withoutEmail = buildCompleteGuestCart({ email: null })
      expect(withCheckoutDataComplete(withoutEmail)).toBe(false)

      const withoutItems = buildCompleteGuestCart({
        email: "guest@exemplo.com",
        items: [],
      })
      expect(withCheckoutDataComplete(withoutItems)).toBe(false)

      const withInvalidAddress = buildCompleteGuestCart({
        email: "guest@exemplo.com",
        shipping_address: {
          first_name: "Maria",
          last_name: "Silva",
          address_1: "Rua A, 100",
          city: "Sao Paulo",
          postal_code: "123",
          country_code: "BR",
          province: "SP",
          metadata: {
            federal_tax_id: VALID_CPF_NORMALIZED,
          },
        },
      })
      expect(withCheckoutDataComplete(withInvalidAddress)).toBe(false)

      const withNonSellableVariant = buildCompleteGuestCart({
        email: "guest@exemplo.com",
        items: [
          {
            id: "item_01",
            quantity: 1,
            variant_id: "variant_draft",
            variant: {
              id: "variant_draft",
              metadata: {
                gelato_product_uid: "prod_gelato_abc123",
              },
              prices: [{ currency_code: "brl", amount: 9900 }],
            },
          },
        ],
      })
      expect(withCheckoutDataComplete(withNonSellableVariant)).toBe(false)

      const withWrongCurrency = buildCompleteGuestCart({
        email: "guest@exemplo.com",
        currency_code: "usd",
      })
      expect(withCheckoutDataComplete(withWrongCurrency)).toBe(false)
    })

    it("customer autenticado usa customer.email como fonte de verdade para completude", () => {
      const customerCart = buildCompleteGuestCart({
        email: null,
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
      })

      expect(withCheckoutDataComplete(customerCart)).toBe(true)

      const serialized = serializeStoreCartPreOrder(customerCart)
      expect(serialized?.checkout_data_complete).toBe(true)
      expect(serialized?.email).toBeNull()
      expect(serialized?.customer?.email).toBe("cliente@exemplo.com")
    })
  })

  describe("pre-Order negative proofs", () => {
    it("responses de cart/checkout nao expoem campos de Order, payment ou Gelato", async () => {
      const guestCart = buildCompleteGuestCart({
        email: "guest@exemplo.com",
      })
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [guestCart.id]: guestCart,
        },
      })

      const guestReq = createRequest({
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
      })
      wireScope(guestReq, { remoteQuery })

      const guestRes = await invokeActiveCartRoute("GET", guestReq)
      assertPreOrderHttpBody(guestRes.jsonSpy.mock.calls[0][0])

      const attachReq = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
      })
      wireScope(attachReq, {
        remoteQuery: createRemoteQueryResolver({
          carts: {
            [guestCart.id]: guestCart,
            [`${guestCart.id}-attached`]: {
              ...guestCart,
              id: `${guestCart.id}-attached`,
              customer: {
                id: "cus_123",
                email: "cliente@exemplo.com",
              },
              email: "cliente@exemplo.com",
            },
          },
          customers: {
            cus_123: {
              id: "cus_123",
              email: "cliente@exemplo.com",
            },
          },
        }),
        workflowRun: jest.fn(async () => ({ result: {} })),
      })

      const attachRes = await invokeAttachRoute(attachReq)
      assertPreOrderHttpBody(attachRes.jsonSpy.mock.calls[0][0])
    })

    it("nao resolve nem chama workflows/servicos de Order, PaymentSession ou fulfillment", async () => {
      const guestCart = buildCompleteGuestCart({ id: "cart_guest_01" })
      const attachedCart = {
        ...guestCart,
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        email: "cliente@exemplo.com",
      }
      const workflowRun = jest.fn(async () => ({ result: {} }))
      const scopeResolve = jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
          return createRemoteQueryResolver({
            carts: {
              [guestCart.id]: guestCart,
              [attachedCart.id]: attachedCart,
            },
            customers: {
              cus_123: {
                id: "cus_123",
                email: "cliente@exemplo.com",
              },
            },
          })
        }

        if (key === Modules.WORKFLOW_ENGINE) {
          return { run: workflowRun }
        }

        if (
          key.includes("order") ||
          key.includes("payment") ||
          key.includes("gelato") ||
          key.includes("stripe")
        ) {
          throw new Error(`FORBIDDEN_SERVICE_RESOLVED:${key}`)
        }

        return undefined
      })

      const req = createRequest({
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        session: {
          id: "sess_01",
          active_cart_id: guestCart.id,
        },
      })
      req.scope.resolve = scopeResolve as SessionCapableRequest["scope"]["resolve"]

      await invokeAttachRoute(req)

      const calledWorkflowIds = workflowRun.mock.calls.map((call) => call[0])
      for (const forbidden of FORBIDDEN_WORKFLOW_IDS) {
        expect(calledWorkflowIds).not.toContain(forbidden)
      }
      expect(calledWorkflowIds.every((id) => typeof id === "string")).toBe(true)
    })

    it("nao registra handlers de webhook nas rotas de cart/checkout da Phase 03", () => {
      const cartMatchers = defaultMiddlewares.routes
        .filter((route) =>
          route.matcher === "/store/carts/active" ||
          route.matcher === "/store/customers/me/cart/attach"
        )
        .map((route) => route.matcher)

      expect(cartMatchers).toEqual(
        expect.arrayContaining([
          "/store/carts/active",
          "/store/customers/me/cart/attach",
        ])
      )
      expect(
        cartMatchers.every((matcher) => !String(matcher).includes("/hooks"))
      ).toBe(true)
    })

    it("mantem grep estatico limpo contra completion, payment, webhook e fulfillment", () => {
      const backendRoot = path.resolve(__dirname, "../..")
      const scanRoots = [
        path.join(backendRoot, "src/modules/checkout"),
        path.join(backendRoot, "src/api/store/carts/active"),
        path.join(backendRoot, "src/api/store/customers/me/cart/attach"),
      ]
      const scanFiles = [
        path.join(backendRoot, "src/api/store/carts/query-config.ts"),
        path.join(backendRoot, "src/api/store/carts/serializers.ts"),
      ]
      const forbiddenPattern =
        /completeCartWorkflow|sdk\.store\.cart\.complete|start(?:Card|Pix)PaymentAttempt|createPaymentSession_|PaymentSession|payment_intent|order\.gelatoapis\.com|gelato_order_id|\/hooks/

      for (const root of scanRoots) {
        for (const filePath of collectSourceFiles(root)) {
          const source = fs.readFileSync(filePath, "utf8")
          expect(source).not.toMatch(forbiddenPattern)
        }
      }

      for (const filePath of scanFiles) {
        const source = fs.readFileSync(filePath, "utf8")
        expect(source).not.toMatch(forbiddenPattern)
      }
    })
  })
})

function collectSourceFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }

    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}
