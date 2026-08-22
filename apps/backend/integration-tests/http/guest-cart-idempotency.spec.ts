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
  const resourceVersions = new Map<string, number>()

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
    async recordProcessingResult(input: {
      id: string
      expectedStateVersion?: number
      result_type?: string | null
      result_id?: string | null
      result_safe_metadata?: any
    }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          if (
            record.state !== "processing" ||
            (input.expectedStateVersion != null && record.state_version !== input.expectedStateVersion)
          ) {
            return { type: "lost" as const, record: { ...record } }
          }
          record.result_type = input.result_type ?? null
          record.result_id = input.result_id ?? null
          record.result_safe_metadata = input.result_safe_metadata ?? null
          record.state_version += 1
          return { type: "claimed" as const, record: { ...record } }
        }
      }
      return { type: "lost" as const, record: null }
    },
    async markCompleted(input: {
      id: string
      expectedState?: string
      expectedStateVersion?: number
      result_type?: string | null
      result_id?: string | null
      response_status?: number | null
      result_safe_metadata?: any
    }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          if (
            (input.expectedState && record.state !== input.expectedState) ||
            (input.expectedStateVersion != null && record.state_version !== input.expectedStateVersion)
          ) {
            return { type: "lost" as const, record: { ...record } }
          }
          record.state = "completed"
          record.result_type = input.result_type ?? null
          record.result_id = input.result_id ?? null
          record.response_status = input.response_status ?? null
          record.result_safe_metadata = input.result_safe_metadata ?? null
          record.completed_at = new Date().toISOString()
          record.terminalized_at = new Date().toISOString()
          record.state_version += 1
          return { type: "claimed" as const, record: { ...record } }
        }
      }
      return { type: "lost" as const, record: null }
    },
    async markReconciliationRequired(input: {
      id: string
      expectedState?: string
      expectedStateVersion?: number
      result_type?: string | null
      result_id?: string | null
      result_safe_metadata?: any
      failure_code?: string | null
    }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          if (
            (input.expectedState && record.state !== input.expectedState) ||
            (input.expectedStateVersion != null && record.state_version !== input.expectedStateVersion)
          ) {
            return { type: "lost" as const, record: { ...record } }
          }
          record.state = "reconciliation_required"
          record.result_type = input.result_type ?? null
          record.result_id = input.result_id ?? null
          record.result_safe_metadata = input.result_safe_metadata ?? null
          record.failure_code = input.failure_code ?? null
          record.state_version += 1
          return { type: "claimed" as const, record: { ...record } }
        }
      }
      return { type: "lost" as const, record: null }
    },
    async markFailedRetryable(input: {
      id: string
      expectedState?: string
      expectedStateVersion?: number
      failure_code?: string
    }) {
      for (const record of db.idempotencyRecords.values()) {
        if (record.id === input.id) {
          if (
            (input.expectedState && record.state !== input.expectedState) ||
            (input.expectedStateVersion != null && record.state_version !== input.expectedStateVersion)
          ) {
            return { type: "lost" as const, record: { ...record } }
          }
          record.state = "failed_retryable"
          record.failure_code = input.failure_code ?? null
          record.state_version += 1
          return { type: "claimed" as const, record: { ...record } }
        }
      }
      return { type: "lost" as const, record: null }
    },
  }

  const mockResourceVersionService = {
    async initialize(type: string, id: string) {
      const key = `${type}:${id}`
      const current = resourceVersions.get(key) ?? 1
      resourceVersions.set(key, current)
      return { id: `strver_${id}`, resource_type: type, resource_id: id, version: current }
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
    method: "GET" | "POST"
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
    mockStoreIdempotencyService,
    mockRemoteQuery,
    setResourceVersion: (type: string, id: string, version: number) => {
      resourceVersions.set(`${type}:${id}`, version)
    },
  }
}

describe("Guest & Customer Active Cart Idempotency, Concurrency & Replay Matrix", () => {
  describe("B15-04-HR-01: Idempotency-Key Header Required on All POST Active Branches", () => {
    it("rejects anonymous guest POST without Idempotency-Key with 400 VALIDATION_ERROR", async () => {
      const harness = createIdempotencyHarness()
      const req = harness.createRequest({
        method: "POST",
        // no idempotency-key header
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(harness.db.carts.size).toBe(0)
    })

    it("rejects valid guest capability reuse POST without Idempotency-Key with 400 VALIDATION_ERROR", async () => {
      const harness = createIdempotencyHarness()
      // First create cart with valid key
      const createReq = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": "idem_create_guest_01" },
      })
      const createRes = createMockResponse()
      await postActiveCart(createReq as never, createRes as never)
      expect(createRes.statusCode).toBe(201)
      const token = createRes.headers[GUEST_CART_CAPABILITY_HEADER]

      // Now attempt reuse POST without idempotency-key
      const reuseReq = harness.createRequest({
        method: "POST",
        headers: { [GUEST_CART_CAPABILITY_HEADER]: token },
        // missing idempotency-key
      })
      const reuseRes = createMockResponse()

      await expect(postActiveCart(reuseReq as never, reuseRes as never)).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
    })

    it("rejects Customer with existing cart POST without Idempotency-Key with 400 VALIDATION_ERROR", async () => {
      const harness = createIdempotencyHarness()
      const customerAuth = { customerId: "cus_existing_user" }

      // 1. Create first cart for customer with valid key
      const createReq = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": "idem_create_cus_01" },
        customerAuth,
      })
      const createRes = createMockResponse()
      await postActiveCart(createReq as never, createRes as never)
      expect(createRes.statusCode).toBe(201)

      // 2. Second POST for customer with existing cart but missing Idempotency-Key
      const reuseReq = harness.createRequest({
        method: "POST",
        customerAuth,
        // missing idempotency-key
      })
      const reuseRes = createMockResponse()

      await expect(postActiveCart(reuseReq as never, reuseRes as never)).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
    })

    it("rejects Customer without existing cart POST without Idempotency-Key with 400 VALIDATION_ERROR", async () => {
      const harness = createIdempotencyHarness()
      const customerAuth = { customerId: "cus_new_user_no_cart" }

      const req = harness.createRequest({
        method: "POST",
        customerAuth,
        // missing idempotency-key
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(harness.db.carts.size).toBe(0)
    })

    it("allows GET active without Idempotency-Key header", async () => {
      const harness = createIdempotencyHarness()
      // 1. Create cart
      const createReq = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": "idem_for_get_check" },
      })
      const createRes = createMockResponse()
      await postActiveCart(createReq as never, createRes as never)
      const token = createRes.headers[GUEST_CART_CAPABILITY_HEADER]

      // 2. GET without idempotency-key header -> 200
      const getReq = harness.createRequest({
        method: "GET",
        headers: { [GUEST_CART_CAPABILITY_HEADER]: token },
      })
      const getRes = createMockResponse()
      await getActiveCart(getReq as never, getRes as never)

      expect(getRes.statusCode).toBe(200)
    })

    it("preserves fail-closed 404 security precedence when invalid guest capability is present without key", async () => {
      const harness = createIdempotencyHarness()
      const req = harness.createRequest({
        method: "POST",
        headers: { [GUEST_CART_CAPABILITY_HEADER]: "invalid_token_header" },
        // missing idempotency-key
      })
      const res = createMockResponse()

      // Actor resolution fails closed with 404 NOT_FOUND before validation
      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        type: MedusaError.Types.NOT_FOUND,
      })
      expect(harness.db.carts.size).toBe(0)
    })
  })

  describe("B15-04-HR-05: Confirmed Result Pointer Persisted Immediately After Create (Guest & Customer)", () => {
    it("proves guest partial result pointer is durably recorded in processing state before capability mint", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_guest_order_proof_01"

      let inspectedDuringMint: StoreIdempotencyRecordRow | undefined

      // Instrument mintGuestCartCapability to inspect DB row at exact invocation moment
      const originalMint = harness.mockGuestCapService.mintGuestCartCapability.bind(
        harness.mockGuestCapService
      )
      jest
        .spyOn(harness.mockGuestCapService, "mintGuestCartCapability")
        .mockImplementation(async (input: { cart_id: string }) => {
          const record = Array.from(harness.db.idempotencyRecords.values())[0]
          inspectedDuringMint = record ? { ...record } : undefined
          return originalMint(input)
        })

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res = createMockResponse()
      await postActiveCart(req as never, res as never)

      expect(res.statusCode).toBe(201)
      const createdCartId = (res.body as any).cart.id

      // Discriminant order proof: at mint time, record is already processing with result_id and state_version = 2
      expect(inspectedDuringMint).toBeDefined()
      expect(inspectedDuringMint?.state).toBe("processing")
      expect(inspectedDuringMint?.result_type).toBe("cart")
      expect(inspectedDuringMint?.result_id).toBe(createdCartId)
      expect(inspectedDuringMint?.state_version).toBe(2)

      // Final state after completion is completed with state_version = 3
      const finalRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(finalRecord.state).toBe("completed")
      expect(finalRecord.result_id).toBe(createdCartId)
      expect(finalRecord.state_version).toBe(3)
    })

    it("proves customer partial result pointer is durably recorded in processing state before markCompleted", async () => {
      const harness = createIdempotencyHarness()
      const customerAuth = { customerId: "cus_order_proof_02" }
      const idempotencyKey = "idem_cus_order_proof_02"

      let inspectedBeforeComplete: StoreIdempotencyRecordRow | undefined

      const originalMarkCompleted = harness.mockStoreIdempotencyService.markCompleted.bind(
        harness.mockStoreIdempotencyService
      )
      jest
        .spyOn(harness.mockStoreIdempotencyService, "markCompleted")
        .mockImplementation(async (input: any) => {
          const record = Array.from(harness.db.idempotencyRecords.values())[0]
          inspectedBeforeComplete = record ? { ...record } : undefined
          return originalMarkCompleted(input)
        })

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        customerAuth,
      })
      const res = createMockResponse()
      await postActiveCart(req as never, res as never)

      expect(res.statusCode).toBe(201)
      const createdCartId = (res.body as any).cart.id

      expect(inspectedBeforeComplete).toBeDefined()
      expect(inspectedBeforeComplete?.state).toBe("processing")
      expect(inspectedBeforeComplete?.result_type).toBe("cart")
      expect(inspectedBeforeComplete?.result_id).toBe(createdCartId)
      expect(inspectedBeforeComplete?.state_version).toBe(2)
    })

    it("fails closed when recordProcessingResult returns lost (no mint, no 201, no guest token header, 1 cart)", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_partial_cas_lost_01"

      jest
        .spyOn(harness.mockStoreIdempotencyService, "recordProcessingResult")
        .mockResolvedValueOnce({
          type: "lost",
          record: null,
        })

      const mintSpy = jest.spyOn(harness.mockGuestCapService, "mintGuestCartCapability")
      const completeSpy = jest.spyOn(harness.mockStoreIdempotencyService, "markCompleted")

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_IN_PROGRESS",
      })

      // Invariants:
      expect(harness.db.carts.size).toBe(1)
      expect(mintSpy).not.toHaveBeenCalled()
      expect(completeSpy).not.toHaveBeenCalled()
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
      expect(res.statusCode).toBe(200) // response was not sent as 201
      expect(res.headersSent).toBe(false)
    })
  })

  describe("B15-04-HR-06: markCompleted CAS Lost Fails Closed (Guest & Customer)", () => {
    it("fails closed on Guest create when markCompleted returns lost (no 201, no guest token header, pointer preserved, 1 cart)", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_guest_mark_completed_lost_01"

      jest
        .spyOn(harness.mockStoreIdempotencyService, "markCompleted")
        .mockResolvedValueOnce({
          type: "lost",
          record: null,
        })

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_IN_PROGRESS",
      })

      // Invariants:
      expect(harness.db.carts.size).toBe(1)
      const createdCartId = Array.from(harness.db.carts.keys())[0]

      // Result pointer was previously durably persisted in DB by recordProcessingResult
      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.result_id).toBe(createdCartId)
      expect(storedRecord.state).toBe("processing")
      expect(storedRecord.state_version).toBe(2)

      // Token header was NOT emitted to client, no 201 sent
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
      expect(res.headersSent).toBe(false)
    })

    it("fails closed on Customer create when markCompleted returns lost (no 201, pointer preserved, 1 cart)", async () => {
      const harness = createIdempotencyHarness()
      const customerAuth = { customerId: "cus_mark_completed_lost_02" }
      const idempotencyKey = "idem_cus_mark_completed_lost_02"

      jest
        .spyOn(harness.mockStoreIdempotencyService, "markCompleted")
        .mockResolvedValueOnce({
          type: "lost",
          record: null,
        })

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        customerAuth,
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_IN_PROGRESS",
      })

      expect(harness.db.carts.size).toBe(1)
      const createdCartId = Array.from(harness.db.carts.keys())[0]

      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.result_id).toBe(createdCartId)
      expect(storedRecord.state).toBe("processing")
      expect(storedRecord.state_version).toBe(2)

      expect(res.headersSent).toBe(false)
    })

    it("transitions to reconciliation_required with updated expectedStateVersion when markCompleted throws", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_mark_completed_throws_01"

      jest
        .spyOn(harness.mockStoreIdempotencyService, "markCompleted")
        .mockRejectedValueOnce(new Error("PG_CONNECTION_TIMEOUT"))

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toThrow(
        "PG_CONNECTION_TIMEOUT"
      )

      expect(harness.db.carts.size).toBe(1)
      const createdCartId = Array.from(harness.db.carts.keys())[0]

      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord.state).toBe("reconciliation_required")
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.result_id).toBe(createdCartId)
      expect(storedRecord.failure_code).toBe("MARK_COMPLETED_FAILED")
      expect(storedRecord.state_version).toBe(3) // 1 (claim) -> 2 (recordProcessingResult) -> 3 (markReconciliationRequired)
    })
  })

  describe("B15-04-HR-02: Partial Effect Preservation (result_id & result_type)", () => {
    it("preserves exact result_id and result_type in reconciliation_required upon mint failure", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_partial_effect_mint_fail"

      // Force mint failure after workflow runs
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

      // 1 cart was created in DB
      expect(harness.db.carts.size).toBe(1)
      const createdCartId = Array.from(harness.db.carts.keys())[0]

      // Check stored idempotency record
      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord).toBeDefined()
      expect(storedRecord.state).toBe("reconciliation_required")
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.result_id).toBe(createdCartId)
      expect(storedRecord.failure_code).toBe("CAPABILITY_MINT_FAILED")
      expect(storedRecord.state_version).toBe(3) // 1 (claim) -> 2 (recordProcessingResult) -> 3 (markReconciliationRequired)

      // Negative proof: no plaintext token or capability stored
      expect(JSON.stringify(storedRecord)).not.toContain("x-indicio-guest-cart-token")
      expect(JSON.stringify(storedRecord)).not.toContain("gccap_")

      // Retry with same key fails closed (409 conflict) and does NOT create a second cart
      const req2 = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res2 = createMockResponse()

      await expect(postActiveCart(req2 as never, res2 as never)).rejects.toThrow(MedusaError)
      expect(harness.db.carts.size).toBe(1)
    })

    it("preserves exact result_id and result_type in reconciliation_required upon refetch failure", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_partial_effect_refetch_fail"

      // Mock remoteQuery to fail when refetching cart by id
      harness.mockRemoteQuery.mockRejectedValueOnce(new Error("DB_REFETCH_UNAVAILABLE"))

      const req = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res = createMockResponse()

      await expect(postActiveCart(req as never, res as never)).rejects.toThrow(
        "DB_REFETCH_UNAVAILABLE"
      )

      expect(harness.db.carts.size).toBe(1)
      const createdCartId = Array.from(harness.db.carts.keys())[0]

      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord).toBeDefined()
      expect(storedRecord.state).toBe("reconciliation_required")
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.result_id).toBe(createdCartId)
      expect(storedRecord.failure_code).toBe("CART_REFETCH_FAILED")
      expect(storedRecord.state_version).toBe(3) // 1 (claim) -> 2 (recordProcessingResult) -> 3 (markReconciliationRequired)
    })
  })

  describe("B15-04-HR-03: Replay Canonical Refetch & Discriminating Proof", () => {
    it("materializes current canonical DB cart and StoreResourceVersion on replay (discriminating proof)", async () => {
      const harness = createIdempotencyHarness()
      const idempotencyKey = "idem_discriminating_refetch_01"

      // 1. First POST: mint success
      const req1 = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res1 = createMockResponse()
      await postActiveCart(req1 as never, res1 as never)

      expect(res1.statusCode).toBe(201)
      const token = res1.headers[GUEST_CART_CAPABILITY_HEADER]
      expect(token).toBeDefined()
      expect(res1.headers["etag"]).toBe('"1"')

      const cart1 = (res1.body as any).cart
      const cartId = cart1.id
      const initialUpdatedAt = cart1.updated_at

      // 2. Server-side synthetic mutation:
      // Change updated_at to value B and advance resource version to 2
      const cartInDb = harness.db.carts.get(cartId)
      const mutatedUpdatedAt = new Date(Date.now() + 120000).toISOString()
      cartInDb.updated_at = mutatedUpdatedAt
      harness.setResourceVersion("cart", cartId, 2)

      // 3. Replay with SAME Idempotency-Key
      const req2 = harness.createRequest({
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      })
      const res2 = createMockResponse()
      await postActiveCart(req2 as never, res2 as never)

      // Discriminating assertions:
      expect(res2.statusCode).toBe(200)
      expect(res2.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
      // Current ETag reflects version 2, NOT old snapshot "1"!
      expect(res2.headers["etag"]).toBe('"2"')

      const cart2 = (res2.body as any).cart
      expect(cart2.id).toBe(cartId)
      // updated_at reflects mutated state B, NOT old snapshot initialUpdatedAt!
      expect(cart2.updated_at).toBe(mutatedUpdatedAt)
      expect(cart2.updated_at).not.toBe(initialUpdatedAt)

      // Exactly 1 cart in DB
      expect(harness.db.carts.size).toBe(1)

      // 4. Verify no full response DTO was stored in StoreIdempotencyRecord
      const storedRecord = Array.from(harness.db.idempotencyRecords.values())[0]
      expect(storedRecord.state).toBe("completed")
      expect(storedRecord.result_id).toBe(cartId)
      expect(storedRecord.result_type).toBe("cart")
      expect(storedRecord.response_status).toBe(201)
      expect(storedRecord.result_safe_metadata).toEqual({
        operation: "store.carts.active.create",
        result_type: "cart",
        result_id: cartId,
        response_status: 201,
      })
      expect((storedRecord as any).items).toBeUndefined()
      expect((storedRecord as any).email).toBeUndefined()
      expect((storedRecord as any).cart).toBeUndefined()
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
  })
})
