import {
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityRecord,
} from "../../src/modules/guest-cart-capability/types"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
} from "../../src/modules/customer-auth/bff-service-auth"
import {
  STORE_IDEMPOTENCY_MODULE,
  type ClaimInput,
  type ClaimResult,
  type StoreIdempotencyRecordRow,
} from "../../src/modules/store-idempotency"
import {
  createCartWorkflow,
} from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
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
  idempotencyRecords: Map<string, StoreIdempotencyRecordRow>
}

function createIdempotencyHarness() {
  const db: SyntheticDb = {
    carts: new Map(),
    capabilities: new Map(),
    idempotencyRecords: new Map(),
  }

  let cartSequence = 1
  let capSequence = 1
  let idemSequence = 1

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
      const tokenHash = hashGuestCartCapability(token)
      const record = db.capabilities.get(tokenHash)
      if (!record || record.status !== "active" || record.consumed_at || record.revoked_at) {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      return record
    },
  }

  const mockStoreIdempotencyService = {
    async claim(input: ClaimInput): Promise<ClaimResult> {
      const key = `${input.operation}:${JSON.stringify(input.actorScope)}:${input.rawIdempotencyKey}`
      const existing = db.idempotencyRecords.get(key)
      if (existing) {
        if (existing.state === "completed") {
          return { type: "replay", record: existing }
        }
        if (existing.state === "processing") {
          return { type: "in_progress", record: existing }
        }
        return {
          type: "conflict",
          record: existing,
          publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
        }
      }

      const id = `stidem_${idemSequence++}`
      const record: StoreIdempotencyRecordRow = {
        id,
        operation: input.operation,
        actor_scope_hash: "actor_hash",
        resource_scope_hash: "resource_hash",
        idempotency_key_hash: "key_hash",
        hash_version: "v1",
        pepper_version: 1,
        request_fingerprint: "fingerprint",
        state: "processing",
        state_version: 1,
        result_type: null,
        result_id: null,
        response_status: null,
        result_safe_metadata: null,
        locked_at: null,
        state_deadline_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        next_retry_at: null,
        retry_attempt_count: 0,
        retry_started_at: null,
        terminalized_at: null,
        completed_at: null,
        failure_code: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      db.idempotencyRecords.set(key, record)
      return { type: "claimed", record }
    },
    async markCompleted(input: {
      id: string
      result_id?: string | null
      response_status?: number | null
    }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          record.state = "completed"
          record.result_id = input.result_id ?? null
          record.response_status = input.response_status ?? null
          record.completed_at = new Date().toISOString()
          record.terminalized_at = new Date().toISOString()
          record.state_version += 1
          return { type: "claimed", record }
        }
      }
      return { type: "lost", record: null }
    },
    async markReconciliationRequired(input: { id: string; failure_code?: string | null }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          record.state = "reconciliation_required"
          record.failure_code = input.failure_code ?? null
          record.state_version += 1
          return { type: "claimed", record }
        }
      }
      return { type: "lost", record: null }
    },
    async markFailedRetryable(input: { id: string }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          record.state = "failed_retryable"
          record.state_version += 1
          return { type: "claimed", record }
        }
      }
      return { type: "lost", record: null }
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
        (c) => c.customer_id === filters.customer_id && !c.completed_at
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

  function createRequest(input: {
    method: "POST"
    headers?: Record<string, string>
    customerAuth?: any
  }) {
    return {
      method: input.method,
      url: "/store/carts/active",
      originalUrl: "/store/carts/active",
      headers: {
        [CUSTOMER_AUTH_BFF_AUTH_HEADER]: "test_bff_secret",
        ...(input.headers ?? {}),
      },
      customerAuth: input.customerAuth,
      scope: {
        resolve: (key: any) => {
          if (key === GUEST_CART_CAPABILITY_MODULE) {
            return mockGuestCapService
          }
          if (key === "store_resource_version") {
            return mockResourceVersionService
          }
          if (key === STORE_IDEMPOTENCY_MODULE) {
            return mockStoreIdempotencyService
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
    db,
    createRequest,
    mockGuestCapService,
    mockStoreIdempotencyService,
  }
}

describe("Guest Cart Idempotency, Replay 200 & Q-11 Matrix (P15-D04 / P15-D09 / B15-P-HR-02)", () => {
  it("executes mint on first request (201 with header) and refetch replay on same key (200 without header)", async () => {
    const harness = createIdempotencyHarness()
    const idempotencyKey = "idem_guest_mint_and_replay_01"

    // First request: mint
    const req1 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    })
    const res1 = createMockResponse()
    await postActiveCart(req1 as never, res1 as never)

    expect(res1.statusCode).toBe(201)
    const emittedToken = res1.headers[GUEST_CART_CAPABILITY_HEADER]
    expect(emittedToken).toBeDefined()
    expect(typeof emittedToken).toBe("string")
    expect(res1.headers["etag"]).toBe('"1"')

    const cart1 = (res1.body as any).cart
    expect(cart1).toBeDefined()
    expect(cart1.id).toBeDefined()

    // Second request: replay of SAME Idempotency-Key
    const req2 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    })
    const res2 = createMockResponse()
    await postActiveCart(req2 as never, res2 as never)

    // Replay returns HTTP 200, OMIT x-indicio-guest-cart-token, refetches canonical cart and attaches ETag
    expect(res2.statusCode).toBe(200)
    expect(res2.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    expect(res2.headers["etag"]).toBe('"1"')

    const cart2 = (res2.body as any).cart
    expect(cart2).toBeDefined()
    expect(cart2.id).toBe(cart1.id)

    // Negative proof: exactly ONE cart exists in DB for this key
    expect(harness.db.carts.size).toBe(1)
  })

  it("creates a new cart on a new key when token was lost (Q-11 Option A)", async () => {
    const harness = createIdempotencyHarness()

    // First call: key 1
    const req1 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": "idem_lost_token_01" },
    })
    const res1 = createMockResponse()
    await postActiveCart(req1 as never, res1 as never)
    expect(res1.statusCode).toBe(201)
    const cart1Id = (res1.body as any).cart.id

    // User loses token and presents a NEW Idempotency-Key
    const req2 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": "idem_lost_token_02" },
    })
    const res2 = createMockResponse()
    await postActiveCart(req2 as never, res2 as never)
    expect(res2.statusCode).toBe(201)
    const cart2Id = (res2.body as any).cart.id

    expect(cart2Id).not.toBe(cart1Id)
    expect(harness.db.carts.size).toBe(2)
  })

  it("handles Customer POST active idempotency with 201 mint and 200 replay (never emitting guest token)", async () => {
    const harness = createIdempotencyHarness()
    const customerAuth = { customerId: "cus_01HAUTO" }
    const idempotencyKey = "idem_customer_cart_01"

    // 1. First customer POST create
    const req1 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      customerAuth,
    })
    const res1 = createMockResponse()
    await postActiveCart(req1 as never, res1 as never)

    expect(res1.statusCode).toBe(201)
    expect(res1.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    expect(res1.headers["etag"]).toBe('"1"')
    const cusCartId = (res1.body as any).cart.id

    // 2. Customer replay with same key
    const req2 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      customerAuth,
    })
    const res2 = createMockResponse()
    await postActiveCart(req2 as never, res2 as never)

    expect(res2.statusCode).toBe(200)
    expect(res2.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    expect(res2.headers["etag"]).toBe('"1"')
    expect((res2.body as any).cart.id).toBe(cusCartId)
  })

  it("handles post-create capability failure without abandoning processing or creating a second cart", async () => {
    const harness = createIdempotencyHarness()
    const idempotencyKey = "idem_simulated_mint_failure_01"

    // Force mint failure on guest capability service
    jest
      .spyOn(harness.mockGuestCapService, "mintGuestCartCapability")
      .mockRejectedValueOnce(new Error("MINT_FAILED_SIMULATED"))

    const req1 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    })
    const res1 = createMockResponse()

    await expect(postActiveCart(req1 as never, res1 as never)).rejects.toThrow(
      "MINT_FAILED_SIMULATED"
    )

    // In DB, the cart was created
    expect(harness.db.carts.size).toBe(1)

    // Idempotency record is in reconciliation_required (NOT abandoned in processing)
    const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
    expect(storedRecord.state).toBe("reconciliation_required")
    expect(storedRecord.failure_code).toBe("CAPABILITY_MINT_FAILED")

    // Retry with SAME key returns 409 conflict, DOES NOT create a 2nd cart
    const req2 = harness.createRequest({
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    })
    const res2 = createMockResponse()
    await expect(postActiveCart(req2 as never, res2 as never)).rejects.toThrow(
      MedusaError
    )

    expect(harness.db.carts.size).toBe(1)
  })
})
