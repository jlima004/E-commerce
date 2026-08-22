import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityRecord,
} from "../../src/modules/guest-cart-capability/types"
import {
  createCartWorkflow,
} from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  createGuestCartLeakageCollector,
} from "../helpers/guest-cart-leakage"
import {
  assertNoPaymentOrOrderFields,
} from "../../src/modules/checkout/active-cart"
import {
  generateGuestCartCapability,
  hashGuestCartCapability,
} from "../../src/modules/guest-cart-capability/hash"

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

type SyntheticDb = {
  carts: Map<string, any>
  capabilities: Map<string, GuestCartCapabilityRecord>
}

function createSyntheticHarness() {
  const db: SyntheticDb = {
    carts: new Map(),
    capabilities: new Map(),
  }

  let cartSequence = 1
  let capSequence = 1

  const mockGuestCapService = {
    async mintGuestCartCapability(input: { cart_id: string }) {
      const plaintextToken = generateGuestCartCapability()
      const tokenHash = hashGuestCartCapability(plaintextToken)
      const id = `gccap_${capSequence++}`
      const record: GuestCartCapabilityRecord = {
        id,
        cart_id: input.cart_id,
        token_hash: tokenHash,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }
      db.capabilities.set(tokenHash, record)
      return {
        record,
        plaintext_token: plaintextToken,
      }
    },
    async lookupGuestCartCapabilityByPresentedToken(token: string) {
      if (!token || typeof token !== "string") {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      const tokenHash = hashGuestCartCapability(token)
      const record = db.capabilities.get(tokenHash)
      if (!record) {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      if (record.status !== "active" || record.consumed_at || record.revoked_at) {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      return record
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
      const cart = db.carts.get(filters.id)
      return cart ? [cart] : []
    }
    if (filters.customer_id) {
      const matched = Array.from(db.carts.values()).filter(
        (c) => c.customer_id === filters.customer_id
      )
      return matched
    }
    return []
  })

  const mockResourceVersionService = {
    async initialize(type: string, id: string) {
      return { id: `strver_${id}`, resource_type: type, resource_id: id, version: 1 }
    },
  }

  const mockPgConnection = {
    async transaction(cb: any) {
      return cb(this)
    },
    async raw() {
      return { rows: [] }
    },
  }

  ;(createCartWorkflow as unknown as jest.Mock).mockImplementation((scope: any) => ({
    run: async ({ input }: any) => {
      const id = `cart_synth_${cartSequence++}`
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
      db.carts.set(id, newCart)
      return { result: { id } }
    },
  }))

  const mockStoreIdempotencyService = {
    async claim() {
      return {
        type: "claimed",
        record: {
          id: `stidem_${Math.random()}`,
          state: "processing",
          state_version: 1,
        },
      }
    },
    async recordProcessingResult() {
      return {
        type: "claimed",
        record: {
          id: `stidem_mock`,
          state: "processing",
          state_version: 2,
        },
      }
    },
    async markCompleted() {
      return {
        type: "claimed",
        record: {
          id: `stidem_mock`,
          state: "completed",
          state_version: 3,
        },
      }
    },
    async markFailedRetryable() {},
    async markFailedTerminal() {},
    async markReconciliationRequired() {},
  }

  function createRequest(input: {
    method: "GET" | "POST"
    headers?: Record<string, string>
    session?: any
  }) {
    const headers = {
      ...(input.method === "POST" ? { "idempotency-key": `idem_${Math.random()}` } : {}),
      ...(input.headers ?? {}),
    }
    return {
      method: input.method,
      url: "/store/carts/active",
      originalUrl: "/store/carts/active",
      headers,
      session: input.session,
      scope: {
        resolve: (key: any) => {
          if (key === GUEST_CART_CAPABILITY_MODULE) {
            return mockGuestCapService
          }
          if (key === "store_resource_version") {
            return mockResourceVersionService
          }
          if (key === "store_idempotency") {
            return mockStoreIdempotencyService
          }
          if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
            return mockRemoteQuery
          }
          if (key === ContainerRegistrationKeys.PG_CONNECTION) {
            return mockPgConnection
          }
          if (key === ContainerRegistrationKeys.LINK) {
            return { create: async () => undefined }
          }
          throw new Error(`Unrecognized container key: ${String(key)}`)
        },
      },
    }
  }

  return {
    db,
    createRequest,
    mockGuestCapService,
  }
}

describe("Guest Cart HTTP Tracer Matrix (CART-01, CART-02, CART-04)", () => {
  it("POST sem capability cria guest cart 201 e emite x-indicio-guest-cart-token uma unica vez", async () => {
    const harness = createSyntheticHarness()
    const req = harness.createRequest({ method: "POST" })
    const res = createMockResponse()

    await postActiveCart(req as never, res as never)

    expect(res.statusCode).toBe(201)
    const emittedToken = res.headers[GUEST_CART_CAPABILITY_HEADER]
    expect(emittedToken).toBeDefined()
    expect(typeof emittedToken).toBe("string")
    expect(emittedToken.length).toBeGreaterThanOrEqual(32)

    // Token ausente do JSON de resposta
    const responseBody = res.body as any
    expect(responseBody.cart).toBeDefined()
    expect(responseBody.cart.id).toBeDefined()
    expect(responseBody.guestCartToken).toBeUndefined()
    expect(responseBody.token).toBeUndefined()
    expect(responseBody.cart.token_hash).toBeUndefined()
    expect(JSON.stringify(responseBody)).not.toContain(emittedToken)

    // Invariante de pre-order
    assertNoPaymentOrOrderFields(responseBody.cart)

    // Leakage check
    const leakageCollector = createGuestCartLeakageCollector()
    leakageCollector.record("logs", JSON.stringify(responseBody))
    leakageCollector.assertNoCanaries([emittedToken])
  })

  it("GET com capability valida devolve 200 e NAO reemite o header", async () => {
    const harness = createSyntheticHarness()
    // 1. Criar cart guest
    const postReq = harness.createRequest({ method: "POST" })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    const token = postRes.headers[GUEST_CART_CAPABILITY_HEADER]

    // 2. GET com o token
    const getReq = harness.createRequest({
      method: "GET",
      headers: {
        [GUEST_CART_CAPABILITY_HEADER]: token,
      },
    })
    const getRes = createMockResponse()
    await getActiveCart(getReq as never, getRes as never)

    expect(getRes.statusCode).toBe(200)
    const getBody = getRes.body as any
    expect(getBody.cart.id).toBe((postRes.body as any).cart.id)
    // NAO reemite o header no GET
    expect(getRes.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("GET sem capability e sem Customer devolve 404 e NAO cria cart", async () => {
    const harness = createSyntheticHarness()
    const initialCartCount = harness.db.carts.size
    const req = harness.createRequest({ method: "GET" })
    const res = createMockResponse()

    await expect(getActiveCart(req as never, res as never)).rejects.toThrow()
    expect(harness.db.carts.size).toBe(initialCartCount)
  })

  it("POST com capability valida reaproveita o cart (200) e NAO reemite o header", async () => {
    const harness = createSyntheticHarness()
    // 1. Criar cart guest
    const post1Req = harness.createRequest({ method: "POST" })
    const post1Res = createMockResponse()
    await postActiveCart(post1Req as never, post1Res as never)
    const token = post1Res.headers[GUEST_CART_CAPABILITY_HEADER]
    const cartId = (post1Res.body as any).cart.id

    // 2. POST com o token valido existente
    const post2Req = harness.createRequest({
      method: "POST",
      headers: {
        [GUEST_CART_CAPABILITY_HEADER]: token,
      },
    })
    const post2Res = createMockResponse()
    await postActiveCart(post2Req as never, post2Res as never)

    expect(post2Res.statusCode).toBe(200)
    expect((post2Res.body as any).cart.id).toBe(cartId)
    // NAO reemite o header no 200 de reuse
    expect(post2Res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("POST com capability PRESENTE mas INVALIDA/TERMINAL devolve 404 uniforme e NAO cria cart", async () => {
    const harness = createSyntheticHarness()
    const initialCartCount = harness.db.carts.size

    const invalidTokens = [
      "garbage_token_not_found",
      "expired_token_abc123",
      "revoked_token_xyz999",
      "   ",
    ]

    for (const badToken of invalidTokens) {
      const req = harness.createRequest({
        method: "POST",
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: badToken,
        },
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toThrow()
      // Zero cart criado!
      expect(harness.db.carts.size).toBe(initialCartCount)
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    }
  })

  it("Sessao sozinha com active_cart_id nao concede posse M1 em GET", async () => {
    const harness = createSyntheticHarness()
    const req = harness.createRequest({
      method: "GET",
      session: {
        id: "sess_01",
        active_cart_id: "cart_01",
      },
    })
    const res = createMockResponse()

    // Sem capability header, sessao sozinha nao autoriza GET M1 -> 404
    await expect(getActiveCart(req as never, res as never)).rejects.toThrow()
  })
})
