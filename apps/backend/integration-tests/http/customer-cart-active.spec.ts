import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import {
  createCartWorkflow,
} from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  assertNoPaymentOrOrderFields,
} from "../../src/modules/checkout/active-cart"
import type { CustomerAuthAccessContext } from "../../src/modules/customer-auth/access-guard"

jest.mock("@medusajs/core-flows", () => ({
  createCartWorkflow: jest.fn(),
}))

function createMockResponse() {
  const json = jest.fn().mockReturnThis()
  const status = jest.fn().mockReturnThis()
  const setHeader = jest.fn()
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code
      status(code)
      return this
    },
    json(body: unknown) {
      this.body = body
      json(body)
      this.headersSent = true
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      setHeader(name, value)
    },
    statusMock: status,
    jsonMock: json,
    setHeaderMock: setHeader,
  }
}

type SyntheticCustomerHarness = {
  carts: Map<string, any>
  createRequest: (input: {
    method: "GET" | "POST"
    headers?: Record<string, string>
    customerAuth?: CustomerAuthAccessContext
  }) => any
}

function createCustomerHarness(): SyntheticCustomerHarness {
  const carts = new Map<string, any>()
  let cartSequence = 1

  const mockGuestCapService = {
    async lookupGuestCartCapabilityByPresentedToken(token: string) {
      throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
    },
    async mintGuestCartCapability() {
      throw new Error("MINT_SHOULD_NOT_BE_CALLED_FOR_CUSTOMER")
    },
  }

  const mockRemoteQuery = jest.fn(async (queryObj: any) => {
    const entry = queryObj?.__value ? Object.keys(queryObj.__value)[0] : undefined
    const filters =
      (entry && queryObj.__value[entry]?.__args?.filters) ??
      queryObj?.variables?.filters ??
      queryObj?.filters ??
      {}
    if (filters.id) {
      const cart = carts.get(filters.id)
      return cart ? [cart] : []
    }
    if (filters.customer_id) {
      const matched = Array.from(carts.values()).filter(
        (c) => c.customer_id === filters.customer_id && !c.completed_at
      )
      return matched
    }
    return []
  })

  const mockPgConnection = {
    async raw() {
      return { rows: [] }
    },
  }

  ;(createCartWorkflow as unknown as jest.Mock).mockImplementation((scope: any) => ({
    run: async ({ input }: any) => {
      const id = `cart_cus_${cartSequence++}`
      const newCart = {
        id,
        currency_code: input.currency_code ?? "brl",
        customer_id: input.customer_id ?? null,
        metadata: { active_for_checkout: true },
        items: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      }
      carts.set(id, newCart)
      return { result: { id } }
    },
  }))

  function createRequest(input: {
    method: "GET" | "POST"
    headers?: Record<string, string>
    customerAuth?: CustomerAuthAccessContext
  }) {
    return {
      method: input.method,
      url: "/store/carts/active",
      originalUrl: "/store/carts/active",
      headers: input.headers ?? {},
      customerAuth: input.customerAuth,
      scope: {
        resolve: (key: any) => {
          if (key === GUEST_CART_CAPABILITY_MODULE) {
            return mockGuestCapService
          }
          if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
            return mockRemoteQuery
          }
          if (key === ContainerRegistrationKeys.PG_CONNECTION) {
            return mockPgConnection
          }
          throw new Error(`Unrecognized container key: ${String(key)}`)
        },
      },
    }
  }

  return {
    carts,
    createRequest,
  }
}

function buildSyntheticCustomerAuth(customerId: string): CustomerAuthAccessContext {
  return {
    lineageId: "lin_test_01",
    sid: "sid_test_01",
    authIdentityId: "ident_test_01",
    customerId,
    credentialVersion: 1,
    originalAuthenticatedAt: new Date(),
    absoluteExpiresAt: new Date(Date.now() + 3600000),
    claims: {
      sub: customerId,
      customer_id: customerId,
      identity_id: "ident_test_01",
      auth_identity_id: "ident_test_01",
      sid: "sid_test_01",
      cv: 1,
      token_type: "access",
      jti: "jti_test_01",
      original_authenticated_at: Math.floor(Date.now() / 1000),
      absolute_expires_at: Math.floor(Date.now() / 1000) + 3600,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
  }
}

describe("Customer Cart Active HTTP Tracer Matrix (Task 15-03-03 — NO SKIP)", () => {
  it("Customer autenticado cria cart 201 associado ao customer_id sem emitir x-indicio-guest-cart-token", async () => {
    const harness = createCustomerHarness()
    const customerAuth = buildSyntheticCustomerAuth("cus_maria_123")
    const req = harness.createRequest({
      method: "POST",
      customerAuth,
    })
    const res = createMockResponse()

    await postActiveCart(req as never, res as never)

    expect(res.statusCode).toBe(201)
    const body = res.body as any
    expect(body.cart).toBeDefined()
    expect(body.cart.customer_id).toBe("cus_maria_123")
    expect(body.cart.currency_code).toBe("brl")
    assertNoPaymentOrOrderFields(body.cart)

    // NUNCA emite capability token para Customer
    expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("Customer autenticado reaproveita cart existente (200) sem criar duplicatas", async () => {
    const harness = createCustomerHarness()
    const customerAuth = buildSyntheticCustomerAuth("cus_joao_456")

    // 1. Criar primeiro cart
    const req1 = harness.createRequest({ method: "POST", customerAuth })
    const res1 = createMockResponse()
    await postActiveCart(req1 as never, res1 as never)
    expect(res1.statusCode).toBe(201)
    const cartId = (res1.body as any).cart.id

    // 2. Segundo POST com o mesmo customer
    const req2 = harness.createRequest({ method: "POST", customerAuth })
    const res2 = createMockResponse()
    await postActiveCart(req2 as never, res2 as never)

    expect(res2.statusCode).toBe(200)
    expect((res2.body as any).cart.id).toBe(cartId)
    expect(harness.carts.size).toBe(1)
    expect(res2.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("GET Customer devolve 200 com cart do Customer quando existente", async () => {
    const harness = createCustomerHarness()
    const customerAuth = buildSyntheticCustomerAuth("cus_ana_789")

    // Criar cart
    const postReq = harness.createRequest({ method: "POST", customerAuth })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    const cartId = (postRes.body as any).cart.id

    // GET cart
    const getReq = harness.createRequest({ method: "GET", customerAuth })
    const getRes = createMockResponse()
    await getActiveCart(getReq as never, getRes as never)

    expect(getRes.statusCode).toBe(200)
    expect((getRes.body as any).cart.id).toBe(cartId)
    expect((getRes.body as any).cart.customer_id).toBe("cus_ana_789")
    expect(getRes.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("GET Customer devolve 404 quando Customer nao possui cart ativo", async () => {
    const harness = createCustomerHarness()
    const customerAuth = buildSyntheticCustomerAuth("cus_novo_sem_cart")

    const req = harness.createRequest({ method: "GET", customerAuth })
    const res = createMockResponse()

    await expect(getActiveCart(req as never, res as never)).rejects.toThrow()
  })

  it("XOR estrito: quando header de guest capability esta presente (mas invalido), NUNCA cai para Customer", async () => {
    const harness = createCustomerHarness()
    const customerAuth = buildSyntheticCustomerAuth("cus_victor_999")

    // Cria um cart prévio para o customer
    const postReq = harness.createRequest({ method: "POST", customerAuth })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)

    // Request envia simultaneamente customerAuth E header de guest inválido
    const req = harness.createRequest({
      method: "GET",
      customerAuth,
      headers: {
        [GUEST_CART_CAPABILITY_HEADER]: "invalid_guest_token_xyz",
      },
    })
    const res = createMockResponse()

    // O header de guest tem precedência e falha closed -> 404! Nunca devolve o cart do Customer!
    await expect(getActiveCart(req as never, res as never)).rejects.toThrow()
  })
})
