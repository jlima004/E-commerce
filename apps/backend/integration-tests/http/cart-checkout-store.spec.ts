import fs from "fs"
import path from "path"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import {
  addToCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflowId,
  deleteLineItemsWorkflow,
  transferCartCustomerWorkflowId,
  updateCartWorkflowId,
  updateLineItemInCartWorkflow,
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
import { POST as startCardPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/card/route"
import { POST as startPixPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/pix/route"
import {
  DELETE as clearLineItems,
  POST as addLineItem,
} from "../../src/api/store/carts/[id]/line-items/route"
import {
  DELETE as deleteLineItem,
  POST as updateLineItem,
} from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import { toStoreErrorResponse } from "../../src/api/store-surface/errors"
import { decideStoreSurfaceAccess } from "../../src/api/store-surface/guard"
import {
  validateBrazilShippingAddress,
  type BrazilShippingAddressInput,
} from "../../src/modules/checkout/checkout-data"
import type { StoreCartPreOrderRecord } from "../../src/api/store/carts/serializers"

jest.mock("@medusajs/core-flows", () => ({
  createCartWorkflow: jest.fn(),
  addToCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
  transferCartCustomerWorkflowId: "transferCartCustomerWorkflow",
  updateCartWorkflowId: "updateCartWorkflow",
  createPaymentCollectionForCartWorkflowId: "createPaymentCollectionForCart",
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
    prices: [{ currency_code: "brl", amount: 99 }],
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
        unit_price: 99,
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

import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import {
  STRIPE_CARD_INITIATION_LAYER,
  type StripeCardInitiationLayer,
} from "../../src/modules/payment-attempt/card"
import {
  STRIPE_PIX_INITIATION_LAYER,
  type StripePixInitiationLayer,
} from "../../src/modules/payment-attempt/pix"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"

type SessionCapableRequest = MedusaRequest & {
  method?: "GET" | "POST" | "DELETE"
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  customerAuth?: any
  session?: {
    id?: string
    active_cart_id?: string
  }
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

function createResponse() {
  const jsonSpy = jest.fn()
  const setHeader = jest.fn()
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader: jest.fn(function (name: string, value: string) {
      response.headers[name.toLowerCase()] = value
      setHeader(name, value)
    }),
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
    headers: Record<string, string>
    setHeader: jest.Mock
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

type CustomerAuthorityCart = StoreCartPreOrderRecord & {
  customer_id: string
}

function createCustomerCartAuthorityModule(
  cart: CustomerAuthorityCart
) {
  const raw = jest.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()

    if (normalized.includes("from customer_cart_authority")) {
      return { rows: [] }
    }

    if (normalized.includes("from cart") && normalized.includes("customer_id")) {
      return {
        rows: [
          {
            id: cart.id,
            customer_id: cart.customer_id,
            completed_at: cart.completed_at ?? null,
            deleted_at: cart.deleted_at ?? null,
            metadata: cart.metadata,
          },
        ],
      }
    }

    return { rows: [] }
  })

  const transaction = jest.fn(
    async (callback: (manager: unknown) => Promise<unknown>) =>
      callback({
        getTransactionContext: () => ({ raw }),
      })
  )

  return {
    baseRepository_: { transaction },
    raw,
  }
}

function readRemoteQueryTarget(queryObject: RemoteQueryShape): {
  entryPoint?: string
  filters: Record<string, unknown>
} {
  const entryPoint = queryObject.__value
    ? Object.keys(queryObject.__value)[0]
    : undefined
  const filters =
    ((entryPoint &&
      queryObject.__value?.[entryPoint]?.__args?.filters) ??
    {}) as Record<string, unknown>

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

type CreateRequestOptions = Partial<SessionCapableRequest> & {
  omitDefaultIdempotencyKey?: boolean
}

function createRequest(overrides: CreateRequestOptions = {}) {
  const { omitDefaultIdempotencyKey, ...requestOverrides } = overrides
  const headers = {
    ...(requestOverrides.method === "POST" && !omitDefaultIdempotencyKey
      ? { "idempotency-key": "idem_cart_checkout_store" }
      : {}),
    ...(requestOverrides.headers ?? {}),
  }

  return {
    headers: {},
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
    ...requestOverrides,
    headers,
  } as SessionCapableRequest
}

function wireScope(
  req: SessionCapableRequest,
  options: {
    remoteQuery?: ReturnType<typeof createRemoteQueryResolver>
    workflowRun?: jest.Mock
    guestCapService?: any
    pgConnection?: any
    cartModule?: any
  } = {}
) {
  const remoteQuery = options.remoteQuery ?? createRemoteQueryResolver({})
  const workflowRun = options.workflowRun ?? jest.fn(async () => ({ result: {} }))
  const guestCapService = options.guestCapService ?? {
    mintGuestCartCapability: jest.fn(async ({ cart_id }: { cart_id: string }) => ({
      record: { id: "gccap_synth", cart_id, token_hash: "hash_synth", status: "active" },
      plaintext_token: "synth_guest_capability_token",
    })),
    lookupGuestCartCapabilityByPresentedToken: jest.fn(async (token: string) => {
      if (token === "invalid_token") {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      return {
        id: "gccap_synth",
        cart_id: (req.session?.active_cart_id as string) || "cart_guest_01",
        token_hash: "hash_synth",
        status: "active",
      }
    }),
  }
  const pgConnection = options.pgConnection ?? {
    raw: jest.fn(async () => ({ rows: [] })),
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback({
        raw: jest.fn(async () => ({ rows: [] })),
      })
    ),
  }
  const cartModule = options.cartModule
  const storeResourceVersionService = {
    initialize: jest.fn(async (resourceType: string, resourceId: string) => ({
      id: `strver_${resourceId}`,
      resource_type: resourceType,
      resource_id: resourceId,
      version: 1,
      created_at: "2026-06-27T10:00:00.000Z",
      updated_at: "2026-06-27T10:00:00.000Z",
    })),
  }
  let idempotencyStateVersion = 1
  let idempotencyResultId: string | null = null
  let idempotencyState: "processing" | "completed" = "processing"
  const storeIdempotencyService = {
    claim: jest.fn(async () => ({
      type: "claimed" as const,
      record: {
        id: "stidem_synth",
        state: idempotencyState,
        state_version: idempotencyStateVersion,
        result_id: idempotencyResultId,
      },
    })),
    recordProcessingResult: jest.fn(
      async ({ result_id }: { result_id: string }) => {
        idempotencyStateVersion += 1
        idempotencyResultId = result_id
        return {
          type: "claimed" as const,
          record: {
            id: "stidem_synth",
            state: "processing" as const,
            state_version: idempotencyStateVersion,
            result_id,
          },
        }
      }
    ),
    markCompleted: jest.fn(async ({ result_id }: { result_id: string }) => {
      idempotencyState = "completed"
      idempotencyStateVersion += 1
      idempotencyResultId = result_id
      return {
        type: "claimed" as const,
        record: {
          id: "stidem_synth",
          state: "completed" as const,
          state_version: idempotencyStateVersion,
          result_id,
        },
      }
    }),
    markFailedRetryable: jest.fn(async () => undefined),
    markFailedTerminal: jest.fn(async () => undefined),
    markReconciliationRequired: jest.fn(async () => undefined),
  }

  req.scope.resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === Modules.WORKFLOW_ENGINE) {
      return { run: workflowRun }
    }

    if (key === Modules.CART) {
      return cartModule
    }

    if (key === GUEST_CART_CAPABILITY_MODULE) {
      return guestCapService
    }

    if (key === ContainerRegistrationKeys.LINK) {
      return {
        create: jest.fn(async (input: Record<string, unknown>) => {
          expect(input[Modules.CART]).toEqual({
            cart_id: expect.any(String),
          })
          expect(input[GUEST_CART_CAPABILITY_MODULE]).toEqual({
            guest_cart_capability_id: expect.any(String),
          })
          expect(JSON.stringify(input)).not.toContain(
            "synth_guest_capability_token"
          )
          return undefined
        }),
        dismiss: jest.fn(async () => undefined),
      }
    }

    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      return pgConnection
    }

    if (key === STORE_RESOURCE_VERSION_MODULE) {
      return storeResourceVersionService
    }

    if (key === STORE_IDEMPOTENCY_MODULE) {
      return storeIdempotencyService
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  return { remoteQuery, workflowRun, guestCapService, pgConnection }
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
  const mockedCreateCartWorkflow = createCartWorkflow as unknown as jest.Mock

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
        method: "POST",
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
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeDefined()
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
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: "synth_guest_capability_token",
        },
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
      }) as CustomerAuthorityCart
      customerCart.customer_id = "cus_123"
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [customerCart.id]: customerCart,
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })

      const req = createRequest({
        method: "POST",
        customerAuth: {
          customerId: "cus_123",
        },
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
        body: {
          customer_id: "cus_spoofed",
        },
      })
      wireScope(req, {
        remoteQuery,
        cartModule: createCustomerCartAuthorityModule(customerCart),
      })

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
      }) as CustomerAuthorityCart
      customerCart.customer_id = "cus_123"
      const remoteQuery = createRemoteQueryResolver({
        carts: {
          [customerCart.id]: customerCart,
        },
        customerCarts: {
          cus_123: [customerCart],
        },
      })

      const req = createRequest({
        customerAuth: {
          customerId: "cus_123",
        },
        auth_context: {
          actor_id: "cus_123",
          actor_type: "customer",
        },
      })
      wireScope(req, {
        remoteQuery,
        cartModule: createCustomerCartAuthorityModule(customerCart),
      })

      const res = await invokeActiveCartRoute("GET", req)

      expect(res.statusCode).toBe(200)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.cart.customer.id).toBe("cus_123")
      expect(body.cart.email).toBe("cliente@exemplo.com")
    })
  })

  // Internal handler invariants only — public POST /store/customers/me/cart/attach
  // is BLOCKED→DENY via store-surface guard (see store-surface-lockdown.spec.ts).
  describe("guest cart attach / transfer", () => {
    it("public attach surface is PRESERVE_LEGACY while handler-level domain proofs remain", () => {
      expect(
        decideStoreSurfaceAccess("POST", "/store/customers/me/cart/attach")
      ).toMatchObject({ action: "allow", mode: "preserve_legacy" })
      expect(
        (defaultMiddlewares.routes ?? []).some(
          (route) => String(route.matcher) === "/store*"
        )
      ).toBe(true)
    })

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
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: "synth_guest_capability_token",
        },
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
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: "synth_guest_capability_token",
        },
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
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: "synth_guest_capability_token",
        },
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
              prices: [{ currency_code: "brl", amount: 99 }],
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
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: "synth_guest_capability_token",
        },
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

      const calledWorkflowIds = workflowRun.mock.calls.map((call: unknown[]) => call[0])
      for (const forbidden of FORBIDDEN_WORKFLOW_IDS) {
        expect(calledWorkflowIds).not.toContain(forbidden)
      }
      expect(calledWorkflowIds.every((id) => typeof id === "string")).toBe(true)
    })

    it("nao registra handlers de webhook nas rotas de cart/checkout da Phase 03", () => {
      const cartMatchers = (defaultMiddlewares.routes ?? [])
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
      // Production-source scan only — Wave 0 / unit fixtures under __tests__
      // may mention payment_intent without violating the Phase 03 cart surface.
      if (entry.name === "__tests__" || entry.name === "node_modules") {
        continue
      }
      files.push(...collectSourceFiles(fullPath))
      continue
    }

    if (/\.(spec|test)\.[jt]sx?$/.test(entry.name)) {
      continue
    }

    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

describe("pending review guards precede payment and line-item side effects", () => {
  function readSource(relativePath: string): string {
    return fs.readFileSync(
      path.join(__dirname, "../../src", relativePath),
      "utf8"
    )
  }

  function expectGuardBefore(source: string, markers: string[]) {
    const guard = source.indexOf("assertNoPendingCartReview")
    expect(guard).toBeGreaterThanOrEqual(0)
    for (const marker of markers) {
      const sideEffect = source.indexOf(marker)
      expect(sideEffect).toBeGreaterThanOrEqual(0)
      expect(guard).toBeLessThan(sideEffect)
    }
  }

  it("bloqueia add/update/delete/clear antes do pipeline estrutural", () => {
    expectGuardBefore(readSource("api/store/carts/line-item-mutation.ts"), [
      "await idempotencyService.claim(",
      "await versionService.compareAndSwapWithMutation(",
      "await applyStructuralCartInvalidation(",
      "await guestCapabilityService.authorizeGuestCartCapabilityForMutation(",
    ])
  })

  it("bloqueia card antes de PaymentCollection/PaymentSession, Stripe e PaymentAttempt", () => {
    expectGuardBefore(
      readSource("api/store/carts/[id]/payment-attempts/card/route.ts"),
      [
        "await ensurePaymentCollectionForCart(",
        "await createMedusaCardPaymentSession(",
        "await resolveStripeCardInitiationLayer(",
        "await startCardPaymentAttempt(",
      ]
    )
  })

  it("bloqueia Pix antes de Stripe e PaymentAttempt", () => {
    expectGuardBefore(
      readSource("api/store/carts/[id]/payment-attempts/pix/route.ts"),
      [
        "await resolveStripePixInitiationLayer(",
        "await startPixPaymentAttempt(",
        "await persistPixPaymentAttemptResult(",
      ]
    )
  })
})

const HR08_CUSTOMER_A = "cus_hr08_a"
const HR08_CUSTOMER_B = "cus_hr08_b"
const HR08_REVIEW_REF_CANARY = "revref_CANARY_hr08_do_not_leak"
const HR08_JWT_CANARY = "CANARY_JWT_hr08"
const HR08_CAP_CANARY = "CANARY_CAP_hr08"
const HR08_CANARIES = [
  HR08_JWT_CANARY,
  HR08_CAP_CANARY,
  HR08_REVIEW_REF_CANARY,
] as const

type Hr08LedgerEvent = {
  type: string
  cartId?: string
  customerId?: string | null
  transactionManager?: unknown
  iso2?: string | null
}

type Hr08KnexCatalog = {
  regionCountries: Array<{ iso_2: string | null }>
  variantRows: Array<{ id: string; sku?: string | null; metadata?: unknown }>
  priceLinkRows: Array<{ variant_id: string; price_set_id: string }>
  priceRows: Array<{
    price_set_id: string
    currency_code: string
    amount: number
  }>
}

type Hr08Cart = StoreCartPreOrderRecord & { total?: number | null }

function buildHr08CustomerCart(
  id: string,
  customerId: string
): Hr08Cart {
  return {
    ...buildCompleteGuestCart({
      id,
      email: `${customerId}@exemplo.com`,
      customer: {
        id: customerId,
        email: `${customerId}@exemplo.com`,
      },
    }),
    total: 99,
  }
}

function classifyHr08Sql(sql: string): string {
  const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase()

  if (normalized.includes("pg_advisory_xact_lock")) {
    return "lock"
  }

  if (normalized.includes("from cart_review") && normalized.includes("for update")) {
    return "review-read"
  }

  if (normalized.includes("from region_country")) {
    return "region-hydrate"
  }

  if (normalized.includes("from product_variant_price_set")) {
    return "variant-price-link"
  }

  if (normalized.includes("from product_variant")) {
    return "variant-hydrate"
  }

  if (/\bfrom price\b/.test(normalized)) {
    return "price-hydrate"
  }

  return "raw-other"
}

function buildHr08KnexCatalogFromCart(cart: Hr08Cart): Hr08KnexCatalog {
  const regionCountries =
    cart.region?.countries?.map((country) => ({
      iso_2: country.iso_2 ?? null,
    })) ?? [{ iso_2: "br" }]
  const variantRows: Hr08KnexCatalog["variantRows"] = []
  const priceLinkRows: Hr08KnexCatalog["priceLinkRows"] = []
  const priceRows: Hr08KnexCatalog["priceRows"] = []

  for (const item of cart.items ?? []) {
    const variant = item.variant
    const variantId = variant?.id ?? item.variant_id
    if (!variantId) {
      continue
    }

    variantRows.push({
      id: variantId,
      sku: variant?.sku ?? null,
      metadata: variant?.metadata ?? null,
    })

    const priceSetId = `pset_${variantId}`
    priceLinkRows.push({
      variant_id: variantId,
      price_set_id: priceSetId,
    })

    for (const price of variant?.prices ?? []) {
      if (!price.currency_code || price.amount === undefined) {
        continue
      }

      priceRows.push({
        price_set_id: priceSetId,
        currency_code: price.currency_code,
        amount: price.amount,
      })
    }
  }

  return { regionCountries, variantRows, priceLinkRows, priceRows }
}

function toCartOwnedLockedCart(cart: Hr08Cart): Hr08Cart & {
  customer_id: string | null
} {
  const { region: _ignoredRegion, ...cartWithoutRegion } = cart

  return {
    ...cartWithoutRegion,
    customer_id: cart.customer?.id ?? null,
    items: (cart.items ?? []).map((item) => {
      const { variant: _ignoredVariant, ...itemWithoutVariant } = item
      return itemWithoutVariant
    }),
  }
}

function unsellableQueryVariant(id: string) {
  return {
    id,
    sku: "UNBOUND-STALE",
    metadata: {},
    prices: [],
  }
}

function hr08LedgerIndex(ledger: Hr08LedgerEvent[], type: string): number {
  const index = ledger.findIndex((event) => event.type === type)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

function expectHr08LedgerOrder(ledger: Hr08LedgerEvent[], types: string[]) {
  let previous = -1

  for (const type of types) {
    const index = hr08LedgerIndex(ledger, type)
    expect(index).toBeGreaterThan(previous)
    previous = index
  }
}

function serializeHr08Unknown(value: unknown): string {
  const parts: string[] = []

  try {
    parts.push(JSON.stringify(value))
  } catch {
    parts.push(String(value))
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    parts.push(
      JSON.stringify({
        name: record.name,
        message: record.message,
        code: record.code,
        type: record.type,
        statusCode: record.statusCode,
        status: record.status,
        stack: record.stack,
      })
    )
  }

  return parts.join("\n")
}

function assertHr08NoPublicLeakage(...values: unknown[]) {
  const serialized = values.map(serializeHr08Unknown).join("\n")

  for (const canary of HR08_CANARIES) {
    expect(serialized).not.toContain(canary)
  }
}

function createHr08MedusaPaymentState() {
  return {
    collectionSequence: 1,
    sessionSequence: 1,
    cartPaymentCollections: {} as Record<
      string,
      {
        id: string
        payment_sessions: Array<{
          id: string
          status: string
          amount?: number
          currency_code?: string
          data?: Record<string, unknown>
        }>
      }
    >,
  }
}

function createHr08WorkflowEngineMock(
  medusaPaymentState: ReturnType<typeof createHr08MedusaPaymentState>
) {
  return {
    run: jest.fn(
      async (
        workflowId: string,
        options: { input?: { cart_id?: string } }
      ) => {
        if (workflowId !== createPaymentCollectionForCartWorkflowId) {
          throw new Error(`unexpected workflow ${workflowId}`)
        }

        const cartId = options.input?.cart_id
        if (!cartId) {
          throw new Error("cart_id required")
        }

        medusaPaymentState.cartPaymentCollections[cartId] ??= {
          id: `pay_col_hr08_${String(
            medusaPaymentState.collectionSequence++
          ).padStart(2, "0")}`,
          payment_sessions: [],
        }
      }
    ),
  }
}

function createHr08MedusaPaymentModuleMock(
  medusaPaymentState: ReturnType<typeof createHr08MedusaPaymentState>
) {
  function findCollectionById(collectionId: string) {
    return Object.values(medusaPaymentState.cartPaymentCollections).find(
      (collection) => collection.id === collectionId
    )
  }

  function updateSession(patch: {
    id: string
    status?: string
    data?: Record<string, unknown>
  }) {
    for (const collection of Object.values(
      medusaPaymentState.cartPaymentCollections
    )) {
      const session = collection.payment_sessions.find(
        (item) => item.id === patch.id
      )

      if (session) {
        if (patch.status) {
          session.status = patch.status
        }

        if (patch.data) {
          session.data = patch.data
        }

        return session
      }
    }

    return null
  }

  return {
    createPaymentSession_: jest.fn(
      async (
        paymentCollectionId: string,
        data: {
          provider_id: string
          amount: number
          currency_code: string
          data?: Record<string, unknown>
        }
      ) => {
        const collection = findCollectionById(paymentCollectionId)
        if (!collection) {
          throw new Error("payment collection not found")
        }

        const session = {
          id: `payses_hr08_${String(
            medusaPaymentState.sessionSequence++
          ).padStart(2, "0")}`,
          status: PaymentSessionStatus.PENDING,
          amount: data.amount,
          currency_code: data.currency_code,
          data: data.data ?? {},
        }
        collection.payment_sessions.push(session)

        return session
      }
    ),
    updatePaymentSessions: jest.fn(async (data) => {
      const rows = Array.isArray(data) ? data : [data]

      return rows.map((row) => updateSession(row)).filter(Boolean)
    }),
  }
}

function createHr08PaymentAttemptModuleMock(
  existingAttempts: PaymentAttemptRecord[] = []
) {
  const attempts = [...existingAttempts]

  return {
    listPaymentAttempts: jest.fn(async () => attempts),
    createPaymentAttempts: jest.fn(
      async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
        const rows = Array.isArray(data) ? data : [data]
        attempts.push(...rows)
        return rows
      }
    ),
    updatePaymentAttempts: jest.fn(
      async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
        const rows = Array.isArray(data) ? data : [data]
        for (const row of rows) {
          const index = attempts.findIndex((item) => item.id === row.id)
          if (index >= 0) {
            attempts[index] = row
          }
        }
        return rows
      }
    ),
    resolveStripeCardInitiationLayer: jest.fn(async () => null),
    resolveStripePixInitiationLayer: jest.fn(async () => null),
    attempts,
  }
}

function createHr08StripeCardInitiationLayerMock(
  overrides: Record<string, unknown> = {}
): StripeCardInitiationLayer {
  return {
    createCardPaymentIntent: jest.fn(async (request) => ({
      id: "pi_http_card_mock",
      object: "payment_intent",
      status: "requires_payment_method",
      amount: request.amount_minor,
      currency: request.currency_code,
      client_secret: "pi_http_card_mock_secret_test",
      metadata: {
        cart_id: request.cart_id,
        session_id: request.payment_session_id ?? "payses_http_card_mock",
      },
      ...overrides,
    })),
  }
}

function createHr08StripePixInitiationLayerMock(
  overrides: Record<string, unknown> = {}
): StripePixInitiationLayer {
  return {
    createPixPaymentIntent: jest.fn(async (request) => ({
      id: "pi_http_pix_mock",
      object: "payment_intent",
      status: "requires_action",
      amount: request.amount_minor,
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

function wrapHr08PostLockCart(
  cart: Hr08Cart,
  ledger: Hr08LedgerEvent[],
  transactionManager?: unknown
): Hr08Cart {
  let ownershipRecorded = false

  return new Proxy(cart, {
    get(target, prop, receiver) {
      if ((prop === "id" || prop === "customer") && !ownershipRecorded) {
        ownershipRecorded = true
        ledger.push({
          type: "ownership-check-input",
          cartId: target.id,
          customerId: target.customer?.id ?? null,
          transactionManager,
        })
      }

      return Reflect.get(target, prop, receiver)
    },
  })
}

function createHr08PendingReviewRow(cartId: string) {
  return {
    id: `crev_hr08_pending_${cartId}`,
    cart_id: cartId,
    review_ref: HR08_REVIEW_REF_CANARY,
    merge_result_id: `cmres_hr08_pending_${cartId}`,
    produced_cart_version: 1,
    status: "pending" as const,
    acknowledged_at: null,
  }
}

function createHr08AcknowledgedReviewRow(cartId: string) {
  return {
    id: `crev_hr08_ack_${cartId}`,
    cart_id: cartId,
    review_ref: "revref_hr08_acknowledged",
    merge_result_id: `cmres_hr08_ack_${cartId}`,
    produced_cart_version: 1,
    status: "acknowledged" as const,
    acknowledged_at: "2026-08-26T12:00:00.000Z",
  }
}

function createHr08PaymentStartRequest(cartId: string) {
  return createRequest({
    method: "POST",
    params: { id: cartId },
    body: {},
    auth_context: {
      actor_id: HR08_CUSTOMER_A,
      actor_type: "customer",
    },
    headers: {
      Authorization: `Bearer ${HR08_JWT_CANARY}`,
      [GUEST_CART_CAPABILITY_HEADER]: HR08_CAP_CANARY,
    },
  })
}

function wireHr08PaymentStartScope(
  req: SessionCapableRequest,
  options: {
    cart: Hr08Cart
    review: "pending" | "acknowledged"
    knexCatalog?: Partial<Hr08KnexCatalog>
    unboundRegionCountries?: Array<{ iso_2: string }>
    unboundQueryVariants?: Array<{
      id: string
      sku?: string
      metadata?: Record<string, unknown>
      prices?: Array<{ currency_code: string; amount: number }>
    }>
  }
) {
  const ledger: Hr08LedgerEvent[] = []
  const resolvedKeys: string[] = []
  const medusaPaymentState = createHr08MedusaPaymentState()
  medusaPaymentState.cartPaymentCollections[options.cart.id] = {
    id: `pay_col_hr08_${options.cart.id}`,
    payment_sessions: [],
  }

  const paymentAttemptModule = createHr08PaymentAttemptModuleMock()
  const originalCreatePaymentAttempts =
    paymentAttemptModule.createPaymentAttempts
  paymentAttemptModule.createPaymentAttempts = jest.fn(
    async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
      ledger.push({ type: "payment-attempt-persist" })
      return originalCreatePaymentAttempts(data)
    }
  )

  const medusaPaymentModule =
    createHr08MedusaPaymentModuleMock(medusaPaymentState)
  const workflowEngine = createHr08WorkflowEngineMock(medusaPaymentState)
  const stripeCardInitiationLayer = createHr08StripeCardInitiationLayerMock()
  const stripePixInitiationLayer = createHr08StripePixInitiationLayerMock()
  const originalCreateCardPaymentIntent =
    stripeCardInitiationLayer.createCardPaymentIntent
  stripeCardInitiationLayer.createCardPaymentIntent = jest.fn(
    async (request) => {
      ledger.push({ type: "provider-call" })
      return originalCreateCardPaymentIntent(request)
    }
  )
  const originalCreatePixPaymentIntent =
    stripePixInitiationLayer.createPixPaymentIntent
  stripePixInitiationLayer.createPixPaymentIntent = jest.fn(async (request) => {
    ledger.push({ type: "provider-call" })
    return originalCreatePixPaymentIntent(request)
  })

  const reviewRows =
    options.review === "pending"
      ? [createHr08PendingReviewRow(options.cart.id)]
      : [createHr08AcknowledgedReviewRow(options.cart.id)]

  const knexCatalog: Hr08KnexCatalog = {
    ...buildHr08KnexCatalogFromCart(options.cart),
    ...options.knexCatalog,
  }

  const knex = {
    raw: jest.fn(async (sql: string) => {
      const type = classifyHr08Sql(sql)
      if (type === "lock") {
        lockTransactionManager = transactionManager
      }

      const hydrateIso2 =
        type === "region-hydrate"
          ? knexCatalog.regionCountries[0]?.iso_2 ?? null
          : undefined
      ledger.push({
        type,
        transactionManager,
        ...(hydrateIso2 !== undefined ? { iso2: hydrateIso2 } : {}),
      })

      if (type === "review-read") {
        return { rows: reviewRows }
      }

      if (type === "region-hydrate") {
        return { rows: knexCatalog.regionCountries }
      }

      if (type === "variant-hydrate") {
        return { rows: knexCatalog.variantRows }
      }

      if (type === "variant-price-link") {
        return { rows: knexCatalog.priceLinkRows }
      }

      if (type === "price-hydrate") {
        return { rows: knexCatalog.priceRows }
      }

      return { rows: [] }
    }),
  }

  const transactionManager = {
    getTransactionContext: () => knex,
  }
  let lockTransactionManager: typeof transactionManager | undefined
  let retrieveSharedContext:
    | { transactionManager?: typeof transactionManager }
    | undefined
  let retrievedLockedCart: ReturnType<typeof toCartOwnedLockedCart> | undefined

  const originalListPaymentAttempts = paymentAttemptModule.listPaymentAttempts
  paymentAttemptModule.listPaymentAttempts = jest.fn(
    async (
      filters?: { cart_id?: string },
      configOrContext?: unknown,
      sharedContext?: { transactionManager?: typeof transactionManager }
    ) => {
      ledger.push({
        type: "eligibility",
        transactionManager:
          sharedContext?.transactionManager ??
          retrieveSharedContext?.transactionManager,
      })
      return originalListPaymentAttempts(filters, configOrContext, sharedContext)
    }
  )

  const cartModule = {
    baseRepository_: {
      transaction: jest.fn(
        async (callback: (manager: typeof transactionManager) => Promise<unknown>) => {
          ledger.push({ type: "transaction-start", transactionManager })
          try {
            return await callback(transactionManager)
          } catch (error) {
            ledger.push({ type: "failure", transactionManager })
            throw error
          }
        }
      ),
    },
    retrieveCart: jest.fn(
      async (
        cartId: string,
        _config?: unknown,
        sharedContext?: { transactionManager?: typeof transactionManager }
      ) => {
        cartQueryCount += 1
        retrieveCartCount += 1
        retrieveSharedContext = sharedContext
        ledger.push({
          type: "post-lock-query",
          cartId,
          customerId: options.cart.customer?.id ?? null,
          transactionManager: sharedContext?.transactionManager,
        })
        ledger.push({
          type: "cart-reread",
          cartId,
          customerId: options.cart.customer?.id ?? null,
          transactionManager: sharedContext?.transactionManager,
        })

        retrievedLockedCart = toCartOwnedLockedCart(options.cart)
        return wrapHr08PostLockCart(
          retrievedLockedCart,
          ledger,
          sharedContext?.transactionManager
        )
      }
    ),
  }

  let cartQueryCount = 0
  let retrieveCartCount = 0
  let remoteQueryCartCount = 0
  let paymentCollectionQueryCount = 0
  const wrappedCart = wrapHr08PostLockCart(options.cart, ledger)

  const remoteQuery = jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "cart") {
      cartQueryCount += 1
      remoteQueryCartCount += 1
      ledger.push({ type: "post-lock-query" })
      const cartId = String(filters.id ?? "")
      return cartId === options.cart.id ? [wrappedCart] : []
    }

    if (entryPoint === "cart_payment_collection") {
      paymentCollectionQueryCount += 1
      const cartId = String(filters.cart_id ?? "")
      const paymentCollection =
        medusaPaymentState.cartPaymentCollections[cartId]
      return paymentCollection
        ? [{ payment_collection: paymentCollection }]
        : []
    }

    return []
  })

  const unboundRegionCountries = options.unboundRegionCountries ?? [
    { iso_2: "us" },
  ]
  const regionModule = {
    retrieveRegion: jest.fn(async () => ({
      countries: unboundRegionCountries,
    })),
  }

  const queryGraph = {
    graph: jest.fn(async (query: { filters?: { id?: string | string[] } }) => {
      const requested = query.filters?.id
      const ids = Array.isArray(requested)
        ? requested
        : requested
          ? [requested]
          : []
      const unboundVariants = options.unboundQueryVariants
      const variantsById = new Map(
        (unboundVariants ??
          ids.map((id) => unsellableQueryVariant(id))).map((variant) => [
          variant.id,
          variant,
        ])
      )

      return {
        data: ids.map(
          (id) => variantsById.get(id) ?? unsellableQueryVariant(id)
        ),
      }
    }),
  }

  const storeResourceVersionService = {
    initialize: jest.fn(async (resourceType: string, resourceId: string) => ({
      id: `strver_${resourceId}`,
      resource_type: resourceType,
      resource_id: resourceId,
      version: 1,
      created_at: "2026-08-26T10:00:00.000Z",
      updated_at: "2026-08-26T10:00:00.000Z",
    })),
  }

  req.scope.resolve = jest.fn((key: string) => {
    const keyText = String(key)
    resolvedKeys.push(keyText)

    if (key === Modules.ORDER || /completeCart|createOrder/i.test(keyText)) {
      ledger.push({ type: "order-resolve" })
      throw new Error("ORDER_PATH_MUST_NOT_RESOLVE")
    }

    if (key === Modules.CART) {
      return cartModule
    }

    if (key === Modules.REGION) {
      return regionModule
    }

    if (key === ContainerRegistrationKeys.QUERY) {
      return queryGraph
    }

    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      return paymentAttemptModule
    }

    if (key === STRIPE_CARD_INITIATION_LAYER) {
      return stripeCardInitiationLayer
    }

    if (key === STRIPE_PIX_INITIATION_LAYER) {
      return stripePixInitiationLayer
    }

    if (key === Modules.PAYMENT) {
      return medusaPaymentModule
    }

    if (key === Modules.WORKFLOW_ENGINE) {
      return workflowEngine
    }

    if (key === STORE_RESOURCE_VERSION_MODULE) {
      return storeResourceVersionService
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  return {
    ledger,
    resolvedKeys,
    paymentAttemptModule,
    medusaPaymentModule,
    workflowEngine,
    stripeCardInitiationLayer,
    stripePixInitiationLayer,
    cartModule,
    knex,
    regionModule,
    queryGraph,
    transactionManager,
    get lockTransactionManager() {
      return lockTransactionManager
    },
    get retrieveSharedContext() {
      return retrieveSharedContext
    },
    get retrievedLockedCart() {
      return retrievedLockedCart
    },
    get cartQueryCount() {
      return cartQueryCount
    },
    get retrieveCartCount() {
      return retrieveCartCount
    },
    get remoteQueryCartCount() {
      return remoteQueryCartCount
    },
    get paymentCollectionQueryCount() {
      return paymentCollectionQueryCount
    },
  }
}

function assertHr08PendingBeforeProvider(input: {
  error: unknown
  harness: ReturnType<typeof wireHr08PaymentStartScope>
  stripeIntent: jest.Mock
}) {
  expect(input.error).toMatchObject({
    code: "REVIEW_REQUIRED",
    statusCode: 409,
    status: 409,
  })

  const publicError = toStoreErrorResponse(input.error)
  expect(publicError.statusCode).toBe(409)
  expect(publicError.body.code).toBe("CONFLICT")
  expect(publicError.body.message).toBe("Conflict")
  expect(publicError.body).not.toHaveProperty("cart")

  assertHr08NoPublicLeakage(input.error, publicError, publicError.body)

  expect(input.stripeIntent).not.toHaveBeenCalled()
  expect(input.harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
  expect(input.harness.paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
  expect(input.harness.ledger.filter((event) => event.type === "provider-call")).toHaveLength(0)
  expect(input.harness.ledger.filter((event) => event.type === "payment-attempt-persist")).toHaveLength(0)
  expect(input.harness.ledger.filter((event) => event.type === "order-resolve")).toHaveLength(0)
  expect(input.harness.ledger.filter((event) => event.type === "raw-other")).toHaveLength(0)
  expect(input.harness.cartQueryCount).toBe(1)
  expect(input.harness.paymentCollectionQueryCount).toBe(0)

  expectHr08LedgerOrder(input.harness.ledger, [
    "transaction-start",
    "lock",
    "post-lock-query",
    "ownership-check-input",
    "review-read",
    "failure",
  ])
}

function assertHr07CardSameTransactionManager(
  harness: ReturnType<typeof wireHr08PaymentStartScope>
) {
  expect(harness.lockTransactionManager).toBeDefined()
  expect(harness.retrieveSharedContext?.transactionManager).toBeDefined()
  expect(harness.retrieveSharedContext?.transactionManager).toBe(
    harness.lockTransactionManager
  )
  expect(harness.retrieveSharedContext?.transactionManager).toBe(
    harness.transactionManager
  )

  const lockIndex = hr08LedgerIndex(harness.ledger, "lock")
  const rereadIndex = hr08LedgerIndex(harness.ledger, "cart-reread")
  expect(rereadIndex).toBeGreaterThan(lockIndex)
  expect(harness.ledger[rereadIndex]?.transactionManager).toBe(
    harness.lockTransactionManager
  )

  expect(harness.retrieveCartCount).toBe(1)
  expect(harness.remoteQueryCartCount).toBe(0)
  expect(harness.cartModule.retrieveCart).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      select: expect.any(Array),
      relations: expect.arrayContaining(["items", "shipping_address"]),
    }),
    expect.objectContaining({
      __type: "MedusaContext",
      transactionManager: harness.lockTransactionManager,
    })
  )

  assertHr07CardEligibilitySnapshotFromLockTransaction(harness)
}

function assertHr07CardEligibilitySnapshotFromLockTransaction(
  harness: ReturnType<typeof wireHr08PaymentStartScope>
) {
  expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
  expect(harness.queryGraph.graph).not.toHaveBeenCalled()
  expect(harness.resolvedKeys).not.toContain(Modules.REGION)
  expect(harness.resolvedKeys).not.toContain(ContainerRegistrationKeys.QUERY)

  expect(harness.retrievedLockedCart).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      region_id: expect.any(String),
      customer_id: expect.any(String),
      shipping_address: expect.anything(),
    })
  )
  expect(harness.retrievedLockedCart?.region).toBeUndefined()
  expect(
    (harness.retrievedLockedCart?.items ?? []).every(
      (item) => item.variant === undefined
    )
  ).toBe(true)

  const rereadIndex = hr08LedgerIndex(harness.ledger, "cart-reread")
  const reviewIndex = harness.ledger.findIndex(
    (event) => event.type === "review-read"
  )
  const failureIndex = harness.ledger.findIndex(
    (event) => event.type === "failure"
  )
  const hydrateBeforeIndex =
    reviewIndex >= 0
      ? reviewIndex
      : failureIndex >= 0
        ? failureIndex
        : harness.ledger.length
  const hydrateTypes = [
    "region-hydrate",
    "variant-hydrate",
    "variant-price-link",
  ] as const

  for (const type of hydrateTypes) {
    const events = harness.ledger.filter((event) => event.type === type)
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      const index = harness.ledger.indexOf(event)
      expect(event.transactionManager).toBe(harness.lockTransactionManager)
      expect(index).toBeGreaterThan(rereadIndex)
      expect(index).toBeLessThan(hydrateBeforeIndex)
    }
  }

  expect(
    harness.knex.raw.mock.calls.some(
      ([sql]: [string]) => classifyHr08Sql(sql) === "region-hydrate"
    )
  ).toBe(true)
  expect(
    harness.knex.raw.mock.calls.some(
      ([sql]: [string]) => classifyHr08Sql(sql) === "variant-hydrate"
    )
  ).toBe(true)
}

function assertHr07CardNoCatalogQueriesAfterReview(
  harness: ReturnType<typeof wireHr08PaymentStartScope>
) {
  const reviewIndex = hr08LedgerIndex(harness.ledger, "review-read")
  const hydrateTypes = new Set([
    "region-hydrate",
    "variant-hydrate",
    "variant-price-link",
    "price-hydrate",
  ])

  expect(
    harness.ledger.filter(
      (event, index) => index > reviewIndex && hydrateTypes.has(event.type)
    )
  ).toHaveLength(0)
  expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
  expect(harness.queryGraph.graph).not.toHaveBeenCalled()
}

function assertHr07CardEligibilityRejectedClosed(
  harness: ReturnType<typeof wireHr08PaymentStartScope>,
  thrown: unknown
) {
  expect(thrown).toBeInstanceOf(MedusaError)
  expect(thrown).toMatchObject({
    type: MedusaError.Types.INVALID_DATA,
    message: "Checkout incompleto; pagamento nao pode ser iniciado.",
  })
  expect((thrown as { code?: string } | undefined)?.code).not.toBe(
    "REVIEW_REQUIRED"
  )
  expect(
    harness.stripeCardInitiationLayer.createCardPaymentIntent
  ).not.toHaveBeenCalled()
  expect(
    harness.ledger.filter((event) => event.type === "provider-call")
  ).toHaveLength(0)
  expect(
    harness.ledger.filter((event) => event.type === "payment-attempt-persist")
  ).toHaveLength(0)
  expect(
    harness.paymentAttemptModule.createPaymentAttempts
  ).not.toHaveBeenCalled()
  expect(
    harness.ledger.filter((event) => event.type === "order-resolve")
  ).toHaveLength(0)
  expect(harness.paymentCollectionQueryCount).toBe(0)
  expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
  expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
  expect(harness.queryGraph.graph).not.toHaveBeenCalled()
}

function assertHr07PixSameTransactionManager(
  harness: ReturnType<typeof wireHr08PaymentStartScope>
) {
  expect(harness.lockTransactionManager).toBeDefined()
  expect(harness.retrieveSharedContext?.transactionManager).toBeDefined()
  expect(harness.retrieveSharedContext?.transactionManager).toBe(
    harness.lockTransactionManager
  )
  expect(harness.retrieveSharedContext?.transactionManager).toBe(
    harness.transactionManager
  )
  expect(harness.lockTransactionManager).toBe(harness.transactionManager)

  const retrieveManager = harness.retrieveSharedContext?.transactionManager as
    | { getTransactionContext?: () => unknown }
    | undefined
  const lockManager = harness.lockTransactionManager as
    | { getTransactionContext?: () => unknown }
    | undefined
  expect(retrieveManager?.getTransactionContext?.()).toBe(harness.knex)
  expect(lockManager?.getTransactionContext?.()).toBe(harness.knex)
  expect(harness.transactionManager.getTransactionContext()).toBe(harness.knex)
  expect(
    harness.knex.raw.mock.calls.some(
      ([sql]: [string]) => classifyHr08Sql(sql) === "lock"
    )
  ).toBe(true)

  const lockIndex = hr08LedgerIndex(harness.ledger, "lock")
  const rereadIndex = hr08LedgerIndex(harness.ledger, "cart-reread")
  expect(rereadIndex).toBeGreaterThan(lockIndex)
  expect(harness.ledger[rereadIndex]?.transactionManager).toBe(
    harness.lockTransactionManager
  )
  expect(harness.ledger[lockIndex]?.transactionManager).toBe(
    harness.lockTransactionManager
  )

  expect(harness.retrieveCartCount).toBe(1)
  expect(harness.remoteQueryCartCount).toBe(0)
  expect(harness.resolvedKeys).not.toContain(
    ContainerRegistrationKeys.REMOTE_QUERY
  )
  expect(harness.cartModule.retrieveCart).toHaveBeenCalledTimes(1)
  expect(harness.cartModule.retrieveCart).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      select: expect.any(Array),
      relations: expect.arrayContaining(["items", "shipping_address"]),
    }),
    expect.objectContaining({
      __type: "MedusaContext",
      transactionManager: harness.lockTransactionManager,
      manager: harness.lockTransactionManager,
    })
  )

  expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
  expect(harness.queryGraph.graph).not.toHaveBeenCalled()
  expect(harness.resolvedKeys).not.toContain(Modules.REGION)
  expect(harness.resolvedKeys).not.toContain(ContainerRegistrationKeys.QUERY)
  expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
  expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
  expect(harness.paymentCollectionQueryCount).toBe(0)

  const hydrateTypes = [
    "region-hydrate",
    "variant-hydrate",
    "variant-price-link",
  ] as const
  const reviewIndex = harness.ledger.findIndex(
    (event) => event.type === "review-read"
  )
  const failureIndex = harness.ledger.findIndex(
    (event) => event.type === "failure"
  )
  const hydrateBeforeIndex =
    reviewIndex >= 0
      ? reviewIndex
      : failureIndex >= 0
        ? failureIndex
        : harness.ledger.length

  for (const type of hydrateTypes) {
    const events = harness.ledger.filter((event) => event.type === type)
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      const index = harness.ledger.indexOf(event)
      expect(event.transactionManager).toBe(harness.lockTransactionManager)
      expect(index).toBeGreaterThan(rereadIndex)
      expect(index).toBeLessThan(hydrateBeforeIndex)
    }
  }
}

function assertHr07PixNoCatalogQueriesAfterReview(
  harness: ReturnType<typeof wireHr08PaymentStartScope>
) {
  assertHr07CardNoCatalogQueriesAfterReview(harness)
  expect(
    harness.stripePixInitiationLayer.createPixPaymentIntent
  ).not.toHaveBeenCalled()
  expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
  expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
}

function assertHr07PixEligibilityRejectedClosed(
  harness: ReturnType<typeof wireHr08PaymentStartScope>,
  thrown: unknown
) {
  expect(thrown).toBeInstanceOf(MedusaError)
  expect(thrown).toMatchObject({
    type: MedusaError.Types.INVALID_DATA,
    message: "Checkout incompleto; pagamento nao pode ser iniciado.",
  })
  expect((thrown as { code?: string } | undefined)?.code).not.toBe(
    "REVIEW_REQUIRED"
  )
  expect(
    harness.stripePixInitiationLayer.createPixPaymentIntent
  ).not.toHaveBeenCalled()
  expect(
    harness.ledger.filter((event) => event.type === "provider-call")
  ).toHaveLength(0)
  expect(
    harness.ledger.filter((event) => event.type === "payment-attempt-persist")
  ).toHaveLength(0)
  expect(
    harness.paymentAttemptModule.createPaymentAttempts
  ).not.toHaveBeenCalled()
  expect(
    harness.ledger.filter((event) => event.type === "order-resolve")
  ).toHaveLength(0)
  expect(harness.paymentCollectionQueryCount).toBe(0)
  expect(harness.remoteQueryCartCount).toBe(0)
  expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
  expect(harness.workflowEngine.run).not.toHaveBeenCalled()
  expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
  expect(harness.queryGraph.graph).not.toHaveBeenCalled()
  expect(harness.resolvedKeys).not.toContain(Modules.REGION)
  expect(harness.resolvedKeys).not.toContain(ContainerRegistrationKeys.QUERY)
  expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
  expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
}

describe("B16-09-HR-08 Card dynamic HTTP evidence", () => {
  it("B16-09-HR-08 Card pending review returns 409 REVIEW_REQUIRED before provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr08_card_pending", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    assertHr08PendingBeforeProvider({
      error: thrown,
      harness,
      stripeIntent: harness.stripeCardInitiationLayer
        .createCardPaymentIntent as jest.Mock,
    })
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-08 Card allowed after review progresses with local provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr08_card_allowed", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startCardPaymentAttemptRoute(req, res)

    expect(res.statusCode).toBe(201)
    const body = res.jsonSpy.mock.calls[0][0] as {
      payment_attempt: {
        payment_method_type: string
        status: string
        amount: number
        currency_code: string
        client_secret: string
      }
    }
    expect(body.payment_attempt).toEqual(
      expect.objectContaining({
        payment_method_type: "card",
        status: "card_client_secret_created",
        amount: 9900,
        currency_code: "BRL",
        client_secret: expect.stringMatching(/_secret_/),
      })
    )
    expect(
      harness.stripeCardInitiationLayer.createCardPaymentIntent
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).toHaveBeenCalledTimes(1)
    const persisted = harness.paymentAttemptModule.createPaymentAttempts.mock
      .calls[0][0] as PaymentAttemptRecord
    expect(persisted.order_id).toBeNull()
    expect(harness.ledger.filter((event) => event.type === "order-resolve")).toHaveLength(
      0
    )
    expect(harness.ledger.filter((event) => event.type === "failure")).toHaveLength(0)
    expectHr08LedgerOrder(harness.ledger, [
      "lock",
      "post-lock-query",
      "review-read",
      "provider-call",
    ])
    assertHr08NoPublicLeakage(body)
  })

  it("B16-09-HR-08 Card post-lock ownership mismatch fails closed before provider", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr08_card_foreign",
      HR08_CUSTOMER_B
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MedusaError)
    expect(thrown).toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect(
      (thrown as { code?: string } | undefined)?.code
    ).not.toBe("REVIEW_REQUIRED")
    expect(
      harness.stripeCardInitiationLayer.createCardPaymentIntent
    ).not.toHaveBeenCalled()
    expect(harness.ledger.filter((event) => event.type === "provider-call")).toHaveLength(
      0
    )
    expect(harness.ledger.filter((event) => event.type === "review-read")).toHaveLength(
      0
    )
    expect(harness.ledger.filter((event) => event.type === "order-resolve")).toHaveLength(
      0
    )

    const ownershipEvent = harness.ledger.find(
      (event) => event.type === "ownership-check-input"
    )
    expect(ownershipEvent).toEqual(
      expect.objectContaining({
        type: "ownership-check-input",
        cartId: cart.id,
        customerId: HR08_CUSTOMER_B,
      })
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "post-lock-query",
      "ownership-check-input",
      "failure",
    ])
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })
})

describe("B16-09-HR-08 Pix dynamic HTTP evidence", () => {
  it("B16-09-HR-08 Pix pending review returns 409 REVIEW_REQUIRED before provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr08_pix_pending", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startPixPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    assertHr08PendingBeforeProvider({
      error: thrown,
      harness,
      stripeIntent: harness.stripePixInitiationLayer
        .createPixPaymentIntent as jest.Mock,
    })
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-08 Pix allowed after review progresses with local provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr08_pix_allowed", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startPixPaymentAttemptRoute(req, res)

    expect(res.statusCode).toBe(201)
    const body = res.jsonSpy.mock.calls[0][0] as {
      payment_attempt: {
        payment_method_type: string
        status: string
        copy_paste: string
        qr_code: string
        expires_at: string
      }
    }
    expect(body.payment_attempt).toEqual(
      expect.objectContaining({
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
        copy_paste: expect.any(String),
        qr_code: expect.any(String),
        expires_at: expect.any(String),
      })
    )
    expect(
      harness.stripePixInitiationLayer.createPixPaymentIntent
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).toHaveBeenCalledTimes(1)
    const persisted = harness.paymentAttemptModule.createPaymentAttempts.mock
      .calls[0][0] as PaymentAttemptRecord
    expect(persisted.order_id).toBeNull()
    expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
    expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
    expect(harness.ledger.filter((event) => event.type === "order-resolve")).toHaveLength(
      0
    )
    expectHr08LedgerOrder(harness.ledger, [
      "lock",
      "post-lock-query",
      "review-read",
      "provider-call",
    ])
  })
})

describe("B16-09-HR-07 Card transaction identity HTTP evidence", () => {
  it("B16-09-HR-07 Card lock and cart retrieve share the same transaction manager", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_card_identity", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startCardPaymentAttemptRoute(req, res)

    expect(harness.lockTransactionManager).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "eligibility",
      "provider-call",
    ])
    expect(res.statusCode).toBe(201)
  })

  it("B16-09-HR-07 Card ownership mismatch fails closed before review and provider", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_card_foreign",
      HR08_CUSTOMER_B
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MedusaError)
    expect(thrown).toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect((thrown as { code?: string } | undefined)?.code).not.toBe(
      "REVIEW_REQUIRED"
    )

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)

    expect(
      harness.stripeCardInitiationLayer.createCardPaymentIntent
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "review-read")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(0)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(harness.paymentCollectionQueryCount).toBe(0)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()

    const ownershipEvent = harness.ledger.find(
      (event) => event.type === "ownership-check-input"
    )
    expect(ownershipEvent).toEqual(
      expect.objectContaining({
        type: "ownership-check-input",
        cartId: cart.id,
        customerId: HR08_CUSTOMER_B,
        transactionManager: harness.lockTransactionManager,
      })
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "failure",
    ])
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Card pending review returns 409 REVIEW_REQUIRED before provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_card_pending", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)
    assertHr08PendingBeforeProvider({
      error: thrown,
      harness,
      stripeIntent: harness.stripeCardInitiationLayer
        .createCardPaymentIntent as jest.Mock,
    })
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(0)
    expect(harness.paymentCollectionQueryCount).toBe(0)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
    expect(harness.medusaPaymentModule.updatePaymentSessions).not.toHaveBeenCalled()
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    assertHr07CardNoCatalogQueriesAfterReview(harness)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Card allowed after review persists one attempt with local provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_card_allowed", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startCardPaymentAttemptRoute(req, res)

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)

    expect(res.statusCode).toBe(201)
    const body = res.jsonSpy.mock.calls[0][0] as {
      payment_attempt: {
        payment_method_type: string
        status: string
        amount: number
        currency_code: string
        client_secret: string
      }
    }
    expect(body.payment_attempt).toEqual(
      expect.objectContaining({
        payment_method_type: "card",
        status: "card_client_secret_created",
        amount: 9900,
        currency_code: "BRL",
        client_secret: expect.stringMatching(/_secret_/),
      })
    )
    expect(
      harness.stripeCardInitiationLayer.createCardPaymentIntent
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(1)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(1)
    const persisted = harness.paymentAttemptModule.createPaymentAttempts.mock
      .calls[0][0] as PaymentAttemptRecord
    expect(persisted.order_id).toBeNull()
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "failure")
    ).toHaveLength(0)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "eligibility",
      "provider-call",
    ])
    expect(
      harness.ledger.find((event) => event.type === "region-hydrate")?.iso2
    ).toBe("br")
    expect(
      harness.ledger.filter((event) => event.type === "price-hydrate").length
    ).toBeGreaterThan(0)
    expect(
      harness.ledger
        .filter((event) => event.type === "price-hydrate")
        .every(
          (event) => event.transactionManager === harness.lockTransactionManager
        )
    ).toBe(true)
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+region_country/i),
      [cart.region_id]
    )
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+product_variant\b/i),
      ["variant_sellable"]
    )
    assertHr08NoPublicLeakage(body)
  })

  it("B16-09-HR-07 Card stale region snapshot rejects while unbound Region would allow", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_card_stale_region",
      HR08_CUSTOMER_A
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
      knexCatalog: {
        regionCountries: [{ iso_2: "us" }],
      },
      unboundRegionCountries: [{ iso_2: "br" }],
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)
    assertHr07CardEligibilityRejectedClosed(harness, thrown)
    expect(
      harness.ledger.find((event) => event.type === "region-hydrate")?.iso2
    ).toBe("us")
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+region_country/i),
      [cart.region_id]
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Card stale variant snapshot rejects while unbound QUERY would allow", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_card_stale_variant",
      HR08_CUSTOMER_A
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
      knexCatalog: {
        variantRows: [
          {
            id: "variant_sellable",
            sku: "TSHIRT-BLACK-M",
            metadata: {},
          },
        ],
        priceLinkRows: [],
        priceRows: [],
      },
      unboundQueryVariants: [sellableVariant()],
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startCardPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07CardSameTransactionManager(harness)
    assertHr07CardEligibilityRejectedClosed(harness, thrown)
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+product_variant\b/i),
      ["variant_sellable"]
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })
})

describe("B16-09-HR-07 Pix transaction identity HTTP evidence", () => {
  it("B16-09-HR-07 Pix lock and cart retrieve share the same transaction manager", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_pix_identity", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startPixPaymentAttemptRoute(req, res)

    expect(harness.lockTransactionManager).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "eligibility",
      "provider-call",
    ])

    expect(res.statusCode).toBe(201)
    const body = res.jsonSpy.mock.calls[0][0] as {
      payment_attempt: {
        payment_method_type: string
        status: string
        copy_paste: string
        qr_code: string
        expires_at: string
      }
    }
    expect(body.payment_attempt).toEqual(
      expect.objectContaining({
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
        copy_paste: expect.any(String),
        qr_code: expect.any(String),
        expires_at: expect.any(String),
      })
    )
    expect(
      harness.stripePixInitiationLayer.createPixPaymentIntent
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(1)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).toHaveBeenCalledTimes(1)
    const persisted = harness.paymentAttemptModule.createPaymentAttempts.mock
      .calls[0][0] as PaymentAttemptRecord
    expect(persisted.order_id).toBeNull()
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "failure")
    ).toHaveLength(0)
    expect(harness.remoteQueryCartCount).toBe(0)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
    expect(harness.workflowEngine.run).not.toHaveBeenCalled()
    assertHr08NoPublicLeakage(body)
  })

  it("B16-09-HR-07 Pix ownership mismatch fails closed before review and provider", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_pix_foreign",
      HR08_CUSTOMER_B
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startPixPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MedusaError)
    expect(thrown).toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect((thrown as { code?: string } | undefined)?.code).not.toBe(
      "REVIEW_REQUIRED"
    )

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)

    expect(
      harness.stripePixInitiationLayer.createPixPaymentIntent
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "review-read")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(0)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(harness.paymentCollectionQueryCount).toBe(0)
    expect(harness.remoteQueryCartCount).toBe(0)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
    expect(harness.workflowEngine.run).not.toHaveBeenCalled()
    expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
    expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)

    const ownershipEvent = harness.ledger.find(
      (event) => event.type === "ownership-check-input"
    )
    expect(ownershipEvent).toEqual(
      expect.objectContaining({
        type: "ownership-check-input",
        cartId: cart.id,
        customerId: HR08_CUSTOMER_B,
        transactionManager: harness.lockTransactionManager,
      })
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "failure",
    ])
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Pix pending review returns 409 REVIEW_REQUIRED before provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_pix_pending", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startPixPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)
    assertHr08PendingBeforeProvider({
      error: thrown,
      harness,
      stripeIntent: harness.stripePixInitiationLayer
        .createPixPaymentIntent as jest.Mock,
    })
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(0)
    expect(harness.paymentCollectionQueryCount).toBe(0)
    expect(harness.remoteQueryCartCount).toBe(0)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
    expect(harness.medusaPaymentModule.updatePaymentSessions).not.toHaveBeenCalled()
    expect(harness.workflowEngine.run).not.toHaveBeenCalled()
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).not.toHaveBeenCalled()
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
    expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    assertHr07PixNoCatalogQueriesAfterReview(harness)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Pix allowed after review persists one attempt with local provider", async () => {
    const cart = buildHr08CustomerCart("cart_hr07_pix_allowed", HR08_CUSTOMER_A)
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
    })
    const res = createResponse()

    await startPixPaymentAttemptRoute(req, res)

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)

    expect(res.statusCode).toBe(201)
    const body = res.jsonSpy.mock.calls[0][0] as {
      payment_attempt: {
        payment_method_type: string
        status: string
        copy_paste: string
        qr_code: string
        expires_at: string
      }
    }
    expect(body.payment_attempt).toEqual(
      expect.objectContaining({
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
        copy_paste: expect.any(String),
        qr_code: expect.any(String),
        expires_at: expect.any(String),
      })
    )
    expect(
      harness.stripePixInitiationLayer.createPixPaymentIntent
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.ledger.filter((event) => event.type === "provider-call")
    ).toHaveLength(1)
    expect(
      harness.paymentAttemptModule.createPaymentAttempts
    ).toHaveBeenCalledTimes(1)
    expect(
      harness.ledger.filter((event) => event.type === "payment-attempt-persist")
    ).toHaveLength(1)
    const persisted = harness.paymentAttemptModule.createPaymentAttempts.mock
      .calls[0][0] as PaymentAttemptRecord
    expect(persisted.order_id).toBeNull()
    expect(
      harness.ledger.filter((event) => event.type === "order-resolve")
    ).toHaveLength(0)
    expect(
      harness.ledger.filter((event) => event.type === "failure")
    ).toHaveLength(0)
    expect(harness.resolvedKeys).not.toContain(Modules.PAYMENT)
    expect(harness.resolvedKeys).not.toContain(Modules.WORKFLOW_ENGINE)
    expect(harness.medusaPaymentModule.createPaymentSession_).not.toHaveBeenCalled()
    expect(harness.workflowEngine.run).not.toHaveBeenCalled()
    expect(harness.paymentCollectionQueryCount).toBe(0)
    expect(harness.remoteQueryCartCount).toBe(0)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "eligibility",
      "provider-call",
    ])
    expect(
      harness.ledger.find((event) => event.type === "region-hydrate")?.iso2
    ).toBe("br")
    expect(
      harness.ledger.filter((event) => event.type === "price-hydrate").length
    ).toBeGreaterThan(0)
    expect(
      harness.ledger
        .filter((event) => event.type === "price-hydrate")
        .every(
          (event) => event.transactionManager === harness.lockTransactionManager
        )
    ).toBe(true)
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+region_country/i),
      [cart.region_id]
    )
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+product_variant\b/i),
      ["variant_sellable"]
    )
    expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
    expect(harness.queryGraph.graph).not.toHaveBeenCalled()
    assertHr08NoPublicLeakage(body)
  })

  it("B16-09-HR-07 Pix stale region snapshot rejects while unbound Region would allow", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_pix_stale_region",
      HR08_CUSTOMER_A
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
      knexCatalog: {
        regionCountries: [{ iso_2: "us" }],
      },
      unboundRegionCountries: [{ iso_2: "br" }],
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startPixPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)
    assertHr07PixEligibilityRejectedClosed(harness, thrown)
    expect(
      harness.ledger.find((event) => event.type === "region-hydrate")?.iso2
    ).toBe("us")
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+region_country/i),
      [cart.region_id]
    )
    expect(harness.regionModule.retrieveRegion).not.toHaveBeenCalled()
    expect(harness.resolvedKeys).not.toContain(Modules.REGION)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it("B16-09-HR-07 Pix stale variant snapshot rejects while unbound QUERY would allow", async () => {
    const cart = buildHr08CustomerCart(
      "cart_hr07_pix_stale_variant",
      HR08_CUSTOMER_A
    )
    const req = createHr08PaymentStartRequest(cart.id)
    const harness = wireHr08PaymentStartScope(req, {
      cart,
      review: "acknowledged",
      knexCatalog: {
        variantRows: [
          {
            id: "variant_sellable",
            sku: "TSHIRT-BLACK-M",
            metadata: {},
          },
        ],
        priceLinkRows: [],
        priceRows: [],
      },
      unboundQueryVariants: [sellableVariant()],
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await startPixPaymentAttemptRoute(req, res)
    } catch (error) {
      thrown = error
    }

    expect(harness.retrieveSharedContext?.transactionManager).toBe(
      harness.lockTransactionManager
    )
    assertHr07PixSameTransactionManager(harness)
    assertHr07PixEligibilityRejectedClosed(harness, thrown)
    expect(harness.knex.raw).toHaveBeenCalledWith(
      expect.stringMatching(/from\s+product_variant\b/i),
      ["variant_sellable"]
    )
    expect(harness.queryGraph.graph).not.toHaveBeenCalled()
    expect(harness.resolvedKeys).not.toContain(ContainerRegistrationKeys.QUERY)
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "cart-reread",
      "ownership-check-input",
      "review-read",
      "failure",
    ])
    expect(
      harness.ledger.filter((event) => event.type === "eligibility")
    ).toHaveLength(0)
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })
})

const HR05_CUSTOMER_A = "cus_hr05_a"
const HR05_CUSTOMER_B = "cus_hr05_b"
const HR05_REVIEW_REF_CANARY = "revref_CANARY_hr05_do_not_leak"
const HR05_JWT_CANARY = "CANARY_JWT_hr05"
const HR05_CAP_CANARY = "CANARY_CAP_hr05"
const HR05_CANARIES = [
  HR05_JWT_CANARY,
  HR05_CAP_CANARY,
  HR05_REVIEW_REF_CANARY,
] as const

const HR05_PUBLIC_LEAK_MARKERS = [
  "reviewRef",
  "review_ref",
  "Authorization",
  "authorization",
  "gelato_product_uid",
  "gelato_template_id",
  "pg_advisory",
  "cart_review",
  "customer_cart_authority",
  "at Object.",
] as const

type Hr05LineItemOperation = "add" | "update" | "delete" | "clear"

type Hr05LineItemHandler = (
  req: MedusaRequest,
  res: MedusaResponse
) => Promise<unknown>

const HR05_LINE_ITEM_OPERATIONS: Array<{
  operation: Hr05LineItemOperation
  handler: Hr05LineItemHandler
}> = [
  { operation: "add", handler: addLineItem },
  { operation: "update", handler: updateLineItem },
  { operation: "delete", handler: deleteLineItem },
  { operation: "clear", handler: clearLineItems },
]

function hr05LedgerCount(ledger: Hr08LedgerEvent[], type: string): number {
  return ledger.filter((event) => event.type === type).length
}

function buildHr05CustomerCart(id: string, customerId: string): Hr08Cart {
  return {
    ...buildHr08CustomerCart(id, customerId),
    customer_id: customerId,
  } as Hr08Cart & { customer_id: string }
}

function classifyHr05MutationSql(sql: string): string {
  const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase()

  if (normalized.includes("payment_attempt")) {
    return "invalidation"
  }

  if (normalized.includes("store_resource_version")) {
    return "cas"
  }

  if (normalized.includes("pg_advisory_xact_lock") && normalized.includes("1616")) {
    return "customer-authority-lock"
  }

  return classifyHr08Sql(sql)
}

function assertHr05NoPublicLeakage(error: unknown, publicError: unknown) {
  const allSerialized = [error, publicError].map(serializeHr08Unknown).join("\n")

  for (const canary of HR05_CANARIES) {
    expect(allSerialized).not.toContain(canary)
  }

  const publicSerialized = serializeHr08Unknown(publicError)
  for (const marker of HR05_PUBLIC_LEAK_MARKERS) {
    expect(publicSerialized).not.toContain(marker)
  }
}

function createHr05PendingReviewRow(cartId: string) {
  return {
    id: `crev_hr05_pending_${cartId}`,
    cart_id: cartId,
    review_ref: HR05_REVIEW_REF_CANARY,
    merge_result_id: `cmres_hr05_pending_${cartId}`,
    produced_cart_version: 1,
    status: "pending" as const,
    acknowledged_at: null,
  }
}

function createHr05LineItemRequest(
  cart: Hr08Cart,
  operation: Hr05LineItemOperation
) {
  const lineId = cart.items?.[0]?.id ?? "item_01"
  const method = operation === "add" || operation === "update" ? "POST" : "DELETE"

  return createRequest({
    method,
    params: {
      id: cart.id,
      ...(operation === "update" || operation === "delete"
        ? { line_id: lineId }
        : {}),
    },
    body:
      operation === "add"
        ? { variant_id: "variant_sellable", quantity: 1 }
        : operation === "update"
          ? { quantity: 2 }
          : {},
    customerAuth: {
      customerId: HR05_CUSTOMER_A,
    },
    auth_context: {
      actor_id: HR05_CUSTOMER_A,
      actor_type: "customer",
    },
    headers: {
      authorization: `Bearer ${HR05_JWT_CANARY}`,
      "idempotency-key": `idem_hr05_${operation}_${cart.id}`,
    },
  })
}

function instrumentHr05Workflows(ledger: Hr08LedgerEvent[]) {
  for (const workflow of [
    addToCartWorkflow,
    deleteLineItemsWorkflow,
    updateLineItemInCartWorkflow,
  ]) {
    const mock = workflow as unknown as jest.Mock
    mock.mockImplementation(() => ({
      run: jest.fn(async () => {
        ledger.push({ type: "workflow" })
        return { result: {} }
      }),
    }))
  }
}

function wireHr05LineItemMutationScope(
  req: SessionCapableRequest,
  options: {
    canonicalCart: Hr08Cart
    lockedCart: Hr08Cart
    review: "pending" | "none"
  }
) {
  const ledger: Hr08LedgerEvent[] = []
  const resolvedKeys: string[] = []
  instrumentHr05Workflows(ledger)

  const reviewRows =
    options.review === "pending"
      ? [createHr05PendingReviewRow(options.canonicalCart.id)]
      : []

  const preLockKnex = {
    raw: jest.fn(async (sql: string) => {
      const type = classifyHr05MutationSql(sql)
      ledger.push({ type: `pre-lock-${type}` })
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase()

      if (
        normalized.includes("from cart") &&
        normalized.includes("customer_id")
      ) {
        return {
          rows: [
            {
              id: options.canonicalCart.id,
              customer_id: HR05_CUSTOMER_A,
              completed_at: options.canonicalCart.completed_at ?? null,
              deleted_at: null,
              metadata: options.canonicalCart.metadata,
            },
          ],
        }
      }

      return { rows: [] }
    }),
  }

  const mutationKnex = {
    raw: jest.fn(async (sql: string) => {
      const type = classifyHr05MutationSql(sql)
      ledger.push({ type })

      if (type === "review-read") {
        return { rows: reviewRows }
      }

      return { rows: [] }
    }),
  }

  let cartTransactionCalls = 0
  const cartModule = {
    baseRepository_: {
      transaction: jest.fn(
        async (callback: (manager: unknown) => Promise<unknown>) => {
          cartTransactionCalls += 1
          const isMutationTx = cartTransactionCalls > 1
          if (isMutationTx) {
            ledger.push({ type: "transaction-start" })
          } else {
            ledger.push({ type: "pre-lock-canonical-transaction" })
          }

          const knex = isMutationTx ? mutationKnex : preLockKnex

          try {
            return await callback({
              getTransactionContext: () => knex,
            })
          } catch (error) {
            if (isMutationTx) {
              ledger.push({ type: "failure" })
            }
            throw error
          }
        }
      ),
    },
    retrieveCart: jest.fn(async (cartId: string) => {
      ledger.push({
        type: "post-lock-query",
        cartId,
        customerId: options.lockedCart.customer?.id ?? null,
      })
      return wrapHr08PostLockCart(options.lockedCart, ledger)
    }),
  }

  const remoteQuery = jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "order" || /completeCart|createOrder/i.test(String(entryPoint))) {
      ledger.push({ type: "order-resolve" })
      throw new Error("ORDER_PATH_MUST_NOT_RESOLVE")
    }

    if (entryPoint === "cart") {
      if (filters.id) {
        const cartId = String(filters.id)
        ledger.push({
          type: "pre-lock-canonical-query",
          cartId,
          customerId: options.canonicalCart.customer?.id ?? null,
        })
        return cartId === options.canonicalCart.id ? [options.canonicalCart] : []
      }

      if (filters.customer_id) {
        return String(filters.customer_id) === HR05_CUSTOMER_A
          ? [options.canonicalCart]
          : []
      }
    }

    return []
  })

  const guestCapabilityService = {
    lookupGuestCartCapabilityByPresentedToken: jest.fn(async () => {
      ledger.push({ type: "capability-lookup" })
      throw new Error("CUSTOMER_MUST_NOT_LOOKUP_GUEST_CAPABILITY")
    }),
    authorizeGuestCartCapabilityForMutation: jest.fn(async () => {
      ledger.push({ type: "capability-mutation-auth" })
    }),
  }

  const idempotencyService = {
    claim: jest.fn(async () => {
      ledger.push({ type: "idempotency-claim" })
      return {
        type: "claimed" as const,
        record: {
          id: "stidem_hr05",
          state: "processing",
          state_version: 1,
          retry_attempt_count: 0,
          failure_code: null,
          result_id: null,
        },
      }
    }),
    markCompleted: jest.fn(),
    markFailedRetryable: jest.fn(),
    markFailedTerminal: jest.fn(),
    markReconciliationRequired: jest.fn(),
    recordProcessingResult: jest.fn(),
  }

  const versionService = {
    initialize: jest.fn(async (resourceType: string, resourceId: string) => ({
      id: `strver_${resourceId}`,
      resource_type: resourceType,
      resource_id: resourceId,
      version: 1,
      created_at: "2026-08-26T10:00:00.000Z",
      updated_at: "2026-08-26T10:00:00.000Z",
    })),
    compareAndSwapWithMutation: jest.fn(
      async (input: { mutate: (context: unknown) => Promise<unknown> }) => {
        ledger.push({ type: "cas" })
        await input.mutate({})
        return { type: "updated", version: 2, previousVersion: 1 }
      }
    ),
  }

  const workflowEngine = {
    run: jest.fn(async (workflowId: string) => {
      if (
        FORBIDDEN_WORKFLOW_IDS.some((id) => workflowId.includes(id)) ||
        /completeCart|createOrder/i.test(workflowId)
      ) {
        ledger.push({ type: "order-resolve" })
        throw new Error("ORDER_PATH_MUST_NOT_RESOLVE")
      }
      ledger.push({ type: "workflow" })
    }),
  }

  const createScope = jest.fn(() => {
    ledger.push({ type: "workflow" })
    return {
      register: jest.fn(),
      resolve: req.scope.resolve,
    }
  })

  req.scope.resolve = jest.fn((key: string) => {
    const keyText = String(key)
    resolvedKeys.push(keyText)

    if (key === Modules.ORDER || /completeCart|createOrder/i.test(keyText)) {
      ledger.push({ type: "order-resolve" })
      throw new Error("ORDER_PATH_MUST_NOT_RESOLVE")
    }

    if (key === Modules.CART) {
      return cartModule
    }

    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      return {
        raw: jest.fn(async () => ({ rows: [] })),
        transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
          callback({ raw: jest.fn(async () => ({ rows: [] })) })
        ),
      }
    }

    if (key === GUEST_CART_CAPABILITY_MODULE) {
      return guestCapabilityService
    }

    if (key === STORE_IDEMPOTENCY_MODULE) {
      return idempotencyService
    }

    if (key === STORE_RESOURCE_VERSION_MODULE) {
      return versionService
    }

    if (key === Modules.WORKFLOW_ENGINE) {
      return workflowEngine
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  Object.assign(req.scope, { createScope })

  return {
    ledger,
    resolvedKeys,
    cartModule,
    remoteQuery,
    guestCapabilityService,
    idempotencyService,
    versionService,
    workflowEngine,
    createScope,
    get cartTransactionCalls() {
      return cartTransactionCalls
    },
  }
}

function assertHr05NoMutationSideEffects(
  harness: ReturnType<typeof wireHr05LineItemMutationScope>
) {
  expect(hr05LedgerCount(harness.ledger, "idempotency-claim")).toBe(0)
  expect(hr05LedgerCount(harness.ledger, "cas")).toBe(0)
  expect(hr05LedgerCount(harness.ledger, "workflow")).toBe(0)
  expect(hr05LedgerCount(harness.ledger, "invalidation")).toBe(0)
  expect(hr05LedgerCount(harness.ledger, "capability-mutation-auth")).toBe(0)
  expect(hr05LedgerCount(harness.ledger, "order-resolve")).toBe(0)
  expect(harness.idempotencyService.claim).not.toHaveBeenCalled()
  expect(harness.versionService.compareAndSwapWithMutation).not.toHaveBeenCalled()
  expect(addToCartWorkflow as unknown as jest.Mock).not.toHaveBeenCalled()
  expect(updateLineItemInCartWorkflow as unknown as jest.Mock).not.toHaveBeenCalled()
  expect(deleteLineItemsWorkflow as unknown as jest.Mock).not.toHaveBeenCalled()
    expect(
      harness.guestCapabilityService.authorizeGuestCartCapabilityForMutation
    ).not.toHaveBeenCalled()
  expect(harness.createScope).not.toHaveBeenCalled()
  expect(harness.workflowEngine.run).not.toHaveBeenCalled()
  expect(harness.resolvedKeys).not.toContain(Modules.ORDER)
}

describe("B16-09-HR-05 line-item dynamic HTTP evidence", () => {
  it("B16-09-HR-05 add post-lock ownership mismatch fails closed before review", async () => {
    const canonicalCart = buildHr05CustomerCart(
      "cart_hr05_add_foreign",
      HR05_CUSTOMER_A
    )
    const lockedCart = buildHr05CustomerCart(
      "cart_hr05_add_foreign",
      HR05_CUSTOMER_B
    )
    const req = createHr05LineItemRequest(canonicalCart, "add")
    const harness = wireHr05LineItemMutationScope(req, {
      canonicalCart,
      lockedCart,
      review: "pending",
    })
    const res = createResponse()

    let thrown: unknown
    try {
      await addLineItem(req, res)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MedusaError)
    expect(thrown).toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect((thrown as { code?: string } | undefined)?.code).not.toBe(
      "REVIEW_REQUIRED"
    )

    const publicError = toStoreErrorResponse(thrown)
    expect(publicError.statusCode).toBe(404)
    expect(publicError.body.code).toBe("NOT_FOUND")
    expect(publicError.body.message).toBe("Not Found")
    expect(publicError.body).not.toHaveProperty("cart")
    expect(publicError.body).not.toHaveProperty("stack")
    assertHr05NoPublicLeakage(thrown, publicError)

    expect(hr05LedgerCount(harness.ledger, "review-read")).toBe(0)
    assertHr05NoMutationSideEffects(harness)

    const ownershipEvent = harness.ledger.find(
      (event) => event.type === "ownership-check-input"
    )
    expect(ownershipEvent).toEqual(
      expect.objectContaining({
        type: "ownership-check-input",
        cartId: lockedCart.id,
        customerId: HR05_CUSTOMER_B,
      })
    )
    expectHr08LedgerOrder(harness.ledger, [
      "transaction-start",
      "lock",
      "post-lock-query",
      "ownership-check-input",
      "failure",
    ])
    expect(res.jsonSpy).not.toHaveBeenCalled()
  })

  it.each(HR05_LINE_ITEM_OPERATIONS)(
    "B16-09-HR-05 $operation pending review returns 409 REVIEW_REQUIRED after post-lock ownership",
    async ({ operation, handler }) => {
      const cart = buildHr05CustomerCart(
        `cart_hr05_pending_${operation}`,
        HR05_CUSTOMER_A
      )
      const req = createHr05LineItemRequest(cart, operation)
      const harness = wireHr05LineItemMutationScope(req, {
        canonicalCart: cart,
        lockedCart: cart,
        review: "pending",
      })
      const res = createResponse()

      let thrown: unknown
      try {
        await handler(req, res)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeDefined()
      expect(thrown).toMatchObject({
        code: "REVIEW_REQUIRED",
        statusCode: 409,
        status: 409,
      })

      const publicError = toStoreErrorResponse(thrown)
      expect(publicError.statusCode).toBe(409)
      expect(publicError.body.code).toBe("CONFLICT")
      expect(publicError.body.message).toBe("Conflict")
      expect(publicError.body).not.toHaveProperty("cart")
      expect(publicError.body).not.toHaveProperty("stack")
      assertHr05NoPublicLeakage(thrown, publicError)

      const ownershipEvent = harness.ledger.find(
        (event) => event.type === "ownership-check-input"
      )
      expect(ownershipEvent).toEqual(
        expect.objectContaining({
          type: "ownership-check-input",
          cartId: cart.id,
          customerId: HR05_CUSTOMER_A,
        })
      )

      assertHr05NoMutationSideEffects(harness)
      expectHr08LedgerOrder(harness.ledger, [
        "transaction-start",
        "lock",
        "post-lock-query",
        "ownership-check-input",
        "review-read",
        "failure",
      ])
      expect(res.jsonSpy).not.toHaveBeenCalled()
    }
  )
})
