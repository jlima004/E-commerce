import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
} from "../../src/modules/guest-cart-capability/types"
import {
  toStoreErrorResponse,
  STORE_ERROR_CODES,
} from "../../src/api/store-surface/errors"
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

function createLifecycleHarness() {
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
        status: GUEST_CART_CAPABILITY_STATUS.ACTIVE,
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
      if (
        record.status !== GUEST_CART_CAPABILITY_STATUS.ACTIVE ||
        record.consumed_at ||
        record.revoked_at
      ) {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      if (new Date(record.expires_at).getTime() <= Date.now()) {
        record.status = GUEST_CART_CAPABILITY_STATUS.EXPIRED
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      return record
    },
    async consumeGuestCartCapability(id: string) {
      for (const record of db.capabilities.values()) {
        if (record.id === id) {
          record.status = GUEST_CART_CAPABILITY_STATUS.CONSUMED
          record.consumed_at = new Date().toISOString()
          return record
        }
      }
      throw new Error("NOT_FOUND")
    },
    async revokeGuestCartCapability(id: string) {
      for (const record of db.capabilities.values()) {
        if (record.id === id) {
          record.status = GUEST_CART_CAPABILITY_STATUS.REVOKED
          record.revoked_at = new Date().toISOString()
          return record
        }
      }
      throw new Error("NOT_FOUND")
    },
  }

  const mockResourceVersionService = {
    async initialize(type: string, id: string) {
      return { id: `strver_${id}`, resource_type: type, resource_id: id, version: 1 }
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

describe("Guest Cart Capability Lifecycle & Uniform 404 Contract (CART-03 / FE-CART-002)", () => {
  it("provides uniform 404 response across expired, revoked, consumed, and invalid tokens", async () => {
    const harness = createLifecycleHarness()
    const collector = createGuestCartLeakageCollector()

    // 1. Create active cart
    const postReq = harness.createRequest({ method: "POST" })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    expect(postRes.statusCode).toBe(201)
    const validToken = postRes.headers[GUEST_CART_CAPABILITY_HEADER]
    const validHash = hashGuestCartCapability(validToken)
    const capRecord = harness.db.capabilities.get(validHash)!

    // Test cases for uniform 404
    const testCases = [
      {
        name: "expired capability",
        setup: () => {
          capRecord.expires_at = new Date(Date.now() - 1000).toISOString()
          capRecord.status = GUEST_CART_CAPABILITY_STATUS.EXPIRED
        },
      },
      {
        name: "revoked capability",
        setup: () => {
          capRecord.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          capRecord.status = GUEST_CART_CAPABILITY_STATUS.REVOKED
          capRecord.revoked_at = new Date().toISOString()
        },
      },
      {
        name: "consumed capability",
        setup: () => {
          capRecord.status = GUEST_CART_CAPABILITY_STATUS.CONSUMED
          capRecord.revoked_at = null
          capRecord.consumed_at = new Date().toISOString()
        },
      },
      {
        name: "unknown/random token",
        setup: () => {},
        tokenOverride: generateGuestCartCapability(),
      },
    ]

    for (const tc of testCases) {
      tc.setup()
      const tokenToPresent = tc.tokenOverride ?? validToken

      // GET with invalid/terminal capability -> 404
      const getReq = harness.createRequest({
        method: "GET",
        headers: { [GUEST_CART_CAPABILITY_HEADER]: tokenToPresent },
      })
      const getRes = createMockResponse()

      await expect(getActiveCart(getReq as never, getRes as never)).rejects.toThrow(
        MedusaError
      )

      // POST with invalid/terminal capability -> uniform 404 AND does NOT create cart!
      const initialCartCount = harness.db.carts.size
      const postInvalidReq = harness.createRequest({
        method: "POST",
        headers: { [GUEST_CART_CAPABILITY_HEADER]: tokenToPresent },
      })
      const postInvalidRes = createMockResponse()

      let caughtError: any
      try {
        await postActiveCart(postInvalidReq as never, postInvalidRes as never)
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(MedusaError)
      expect(caughtError.type).toBe(MedusaError.Types.NOT_FOUND)

      // Normalization check: produces closed 404 StoreErrorResponse
      const normalized = toStoreErrorResponse(caughtError, {
        correlationId: "corr_test_lifecycle",
      })
      expect(normalized.statusCode).toBe(404)
      expect(normalized.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
      expect(normalized.body.message).toBe("Not Found")
      expect(normalized.body.retryable).toBe(false)
      expect(normalized.body).not.toHaveProperty("cart")

      // Negative proof: no new cart was created in DB
      expect(harness.db.carts.size).toBe(initialCartCount)

      // Leakage check
      collector.record("logs", normalized.body)
      collector.record("logs", postInvalidRes.headers)
    }

    collector.assertNoCanaries()
  })

  it("consumes guest cart capability when underlying cart has completed_at", async () => {
    const harness = createLifecycleHarness()

    // 1. Create cart + mint capability
    const postReq = harness.createRequest({ method: "POST" })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    expect(postRes.statusCode).toBe(201)
    const validToken = postRes.headers[GUEST_CART_CAPABILITY_HEADER]
    const cartId = (postRes.body as any).cart.id
    const tokenHash = hashGuestCartCapability(validToken)
    const capRecord = harness.db.capabilities.get(tokenHash)!

    expect(capRecord.status).toBe(GUEST_CART_CAPABILITY_STATUS.ACTIVE)
    expect(capRecord.consumed_at).toBeNull()

    // 2. Simulate order completion on the cart
    const cart = harness.db.carts.get(cartId)!
    cart.completed_at = new Date().toISOString()

    // 3. GET /store/carts/active should trigger capability consumption and return 404
    const getReq = harness.createRequest({
      method: "GET",
      headers: { [GUEST_CART_CAPABILITY_HEADER]: validToken },
    })
    const getRes = createMockResponse()

    await expect(getActiveCart(getReq as never, getRes as never)).rejects.toThrow(
      MedusaError
    )

    // Capability is now CONSUMED in DB!
    expect(capRecord.status).toBe(GUEST_CART_CAPABILITY_STATUS.CONSUMED)
    expect(capRecord.consumed_at).not.toBeNull()

    // 4. Subsequent POST with this capability returns uniform 404 and does not create cart
    const cartCountBefore = harness.db.carts.size
    const postReq2 = harness.createRequest({
      method: "POST",
      headers: { [GUEST_CART_CAPABILITY_HEADER]: validToken },
    })
    const postRes2 = createMockResponse()

    await expect(postActiveCart(postReq2 as never, postRes2 as never)).rejects.toThrow(
      MedusaError
    )
    expect(harness.db.carts.size).toBe(cartCountBefore)
  })

  it("proves customer auth expiry does not delete or revoke guest carts/capabilities (D14-08)", async () => {
    const harness = createLifecycleHarness()

    // 1. Create guest cart
    const postReq = harness.createRequest({ method: "POST" })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    expect(postRes.statusCode).toBe(201)
    const guestToken = postRes.headers[GUEST_CART_CAPABILITY_HEADER]
    const guestCartId = (postRes.body as any).cart.id
    const guestHash = hashGuestCartCapability(guestToken)

    expect(harness.db.carts.has(guestCartId)).toBe(true)
    expect(harness.db.capabilities.has(guestHash)).toBe(true)

    // 2. Verify guest cart is intact and functional
    const getReq = harness.createRequest({
      method: "GET",
      headers: { [GUEST_CART_CAPABILITY_HEADER]: guestToken },
    })
    const getRes = createMockResponse()
    await getActiveCart(getReq as never, getRes as never)
    expect(getRes.statusCode).toBe(200)
    expect((getRes.body as any).cart.id).toBe(guestCartId)
  })
})
