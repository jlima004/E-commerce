import {
  addToCartWorkflow,
  createCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { GET as getActiveCart, POST as postActiveCart } from "../../src/api/store/carts/active/route"
import { POST as addLineItem } from "../../src/api/store/carts/[id]/line-items/route"
import { DELETE as clearLineItems } from "../../src/api/store/carts/[id]/line-items/route"
import {
  DELETE as deleteLineItem,
  POST as updateLineItem,
} from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import {
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_M1_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { CART_MERGE_MODULE } from "../../src/modules/cart-merge/module-id"
import {
  PAYMENT_ATTEMPT_MODULE,
} from "../../src/modules/payment-attempt"
import {
  STORE_IDEMPOTENCY_MODULE,
} from "../../src/modules/store-idempotency"
import {
  STORE_RESOURCE_VERSION_MODULE,
} from "../../src/modules/store-resource-version"
import {
  createGuestCartLeakageCollector,
} from "../helpers/guest-cart-leakage"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  createCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
}))

type Cart = {
  id: string
  customer?: { id: string } | null
  customer_id?: string | null
  items: Array<Record<string, unknown>>
  currency_code: string
  region_id: string
  metadata: Record<string, unknown>
  completed_at: string | null
  created_at: string
  updated_at: string
}

type ResponseLike = {
  statusCode: number
  headersSent: boolean
  headers: Record<string, string>
  body: unknown
  setHeader(name: string, value: string): ResponseLike
  status(code: number): ResponseLike
  json(body: unknown): ResponseLike
}

function response(): ResponseLike {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      this.headersSent = true
      return this
    },
  }
}

function createHarness() {
  const now = "2026-08-21T12:00:00.000Z"
  const guestCart: Cart = {
    id: "cart_guest_matrix_01",
    customer: null,
    customer_id: null,
    items: [],
    currency_code: "brl",
    region_id: "reg_br_matrix",
    metadata: { active_for_checkout: true },
    completed_at: null,
    created_at: now,
    updated_at: now,
  }
  const customerCart: Cart = {
    ...guestCart,
    id: "cart_customer_matrix_01",
    customer: { id: "cus_matrix_01" },
    customer_id: "cus_matrix_01",
    updated_at: "2026-08-21T13:00:00.000Z",
  }
  const carts = new Map<string, Cart>([
    [guestCart.id, guestCart],
    [customerCart.id, customerCart],
  ])
  const versions = new Map<string, number>([
    [guestCart.id, 1],
    [customerCart.id, 1],
  ])
  const records = new Map<string, any>()
  const attempts = new Map<string, Array<Record<string, unknown>>>([
    [guestCart.id, [{ id: "pat_matrix_guest", cart_id: guestCart.id, status: "created" }]],
    [customerCart.id, [{ id: "pat_matrix_customer", cart_id: customerCart.id, status: "created" }]],
  ])
  const capabilityToken = "canary_guest_cart_token_p15w0_never_persist_plaintext_val"
  const capabilityRecord = {
    id: "gccap_matrix_01",
    cart_id: guestCart.id,
    token_hash: "sha256_matrix_guest_capability_hash",
    status: "active",
    expires_at: new Date("2026-08-28T12:00:00.000Z"),
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: new Date(now),
    updated_at: new Date(now),
    deleted_at: null,
  }
  let mintedToken = capabilityToken
  let sequence = 1
  let requestedCartId = guestCart.id
  const authorities = new Map<
    string,
    {
      id: string
      customer_id: string
      cart_id: string
      state: "active" | "superseded"
    }
  >()

  const guestCapability = {
    async mintGuestCartCapability(input: { cart_id: string }) {
      capabilityRecord.cart_id = input.cart_id
      mintedToken = capabilityToken
      return { record: capabilityRecord, plaintext_token: mintedToken }
    },
    async lookupGuestCartCapabilityByPresentedToken(token: string) {
      if (token !== mintedToken) {
        throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
      }
      return capabilityRecord
    },
    async consumeGuestCartCapability() {
      capabilityRecord.consumed_at = new Date()
    },
    async authorizeGuestCartCapabilityForMutation() {
      return capabilityRecord
    },
  }

  const remoteQuery = jest.fn(async (queryObject: any) => {
    const entry = queryObject?.__value ? Object.keys(queryObject.__value)[0] : undefined
    const filters =
      (entry && queryObject.__value[entry]?.__args?.filters) ??
      queryObject?.variables?.filters ??
      {}
    if (filters.id) {
      const cart = carts.get(filters.id)
      return cart ? [cart] : []
    }
    if (filters.customer_id) {
      return [...carts.values()].filter(
        (cart) => cart.customer_id === filters.customer_id
      )
    }
    return []
  })

  const idempotency = {
    async claim(input: any) {
      const existing = records.get(input.rawIdempotencyKey)
      if (existing) {
        if (existing.state === "completed" || existing.state === "failed_terminal") {
          return { type: "replay", record: existing }
        }
        return { type: "in_progress", record: existing }
      }
      const record = {
        id: `idem_matrix_${records.size + 1}`,
        state: "processing",
        state_version: 1,
        retry_attempt_count: 0,
        failure_code: null,
        result_id: null,
        operation: input.operation,
      }
      records.set(input.rawIdempotencyKey, record)
      return { type: "claimed", record }
    },
    async recordProcessingResult(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async markCompleted(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "completed"
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async markFailedTerminal(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_terminal"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
    async markFailedRetryable(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_retryable"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
    async markReconciliationRequired(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "reconciliation_required"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
  }

  const resourceVersion = {
    async initialize(_type: string, id: string) {
      return {
        id: `strver_${id}`,
        resource_type: "cart",
        resource_id: id,
        version: versions.get(id) ?? 1,
      }
    },
    async compareAndSwapWithMutation(input: any) {
      const current = versions.get(input.resourceId) ?? 1
      if (current !== input.expectedVersion) {
        return { type: "stale", actualVersion: current, expectedVersion: input.expectedVersion }
      }
      const mutationResult = await input.mutate({})
      versions.set(input.resourceId, current + 1)
      return {
        type: "updated",
        version: current + 1,
        previousVersion: current,
        mutationResult,
      }
    },
  }

  const paymentAttempt = {
    async listPaymentAttempts(filters?: { cart_id?: string }) {
      return attempts.get(filters?.cart_id ?? requestedCartId) ?? []
    },
    async updatePaymentAttempts(input: any) {
      const updates = Array.isArray(input) ? input : [input]
      const rows = attempts.get(requestedCartId) ?? []
      for (const update of updates) {
        const row = rows.find((item) => item.id === update.id)
        if (row) Object.assign(row, update)
      }
      return updates
    },
  }

  const pgConnection = {
    async transaction(callback: (trx: unknown) => Promise<unknown>) {
      return callback({ raw: this.raw.bind(this) })
    },
    async raw(sql: string, bindings: unknown[] = []) {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] }
      }
      if (sql.includes("customer_cart_authority")) {
        if (sql.trimStart().startsWith("insert into")) {
          const [id, customerId, cartId] = bindings
          authorities.set(String(customerId), {
            id: String(id),
            customer_id: String(customerId),
            cart_id: String(cartId),
            state: "active",
          })
          return { rows: [] }
        }
        const customerId = String(bindings[0])
        const authority = authorities.get(customerId)
        return {
          rows: authority
            ? [{ ...authority, state: "active" }]
            : [],
        }
      }
      if (sql.includes("from payment_attempt")) {
        return {
          rows: (attempts.get(requestedCartId) ?? []).map((attempt) => ({
            id: attempt.id,
            status: attempt.status,
            order_id: null,
          })),
        }
      }
      if (sql.includes("update payment_attempt")) {
        const current = attempts.get(requestedCartId)?.[0]
        if (current) current.status = "invalidated_by_cart_change"
        return { rows: current ? [{ id: current.id }] : [] }
      }
      return { rows: [] }
    },
  }

  const cartModule = {
    listCarts: async (filters?: Record<string, unknown>) => {
      const customerId = filters?.customer_id
      return [...carts.values()]
        .filter((cart) => {
          const cartCustomerId = cart.customer_id ?? cart.customer?.id
          return (
            (!customerId || cartCustomerId === customerId) &&
            !cart.completed_at &&
            (cart as Cart & { deleted_at?: unknown }).deleted_at == null &&
            cart.metadata?.active_for_checkout !== false
          )
        })
        .map((cart) => ({
          id: cart.id,
          customer_id: cart.customer_id ?? cart.customer?.id,
          completed_at: cart.completed_at ?? null,
          deleted_at:
            (cart as Cart & { deleted_at?: unknown }).deleted_at ?? null,
          metadata: cart.metadata ?? null,
        }))
    },
    retrieveCart: async (id: string) => {
      const cart = carts.get(id)
      return cart ? JSON.parse(JSON.stringify(cart)) : null
    },
    baseRepository_: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({
          getTransactionContext: () => ({ raw: pgConnection.raw }),
      }),
    },
  }

  const cartMergeAuthority = {
    listCustomerCartAuthoritiesForUpdate: async (customerId: string) => {
      const authority = authorities.get(customerId)
      return authority && authority.state === "active"
        ? [{ ...authority }]
        : []
    },
    createCustomerCartAuthority: async (input: {
      customer_id: string
      cart_id: string
    }) => {
      const authority = {
        id: `ccauth_${input.cart_id}`,
        customer_id: input.customer_id,
        cart_id: input.cart_id,
        state: "active" as const,
      }
      authorities.set(input.customer_id, authority)
      return { ...authority }
    },
    supersedeCustomerCartAuthority: async (input: {
      authority_id: string
      customer_id: string
      cart_id: string
    }) => {
      const authority = authorities.get(input.customer_id)
      if (
        authority &&
        authority.id === input.authority_id &&
        authority.cart_id === input.cart_id
      ) {
        authority.state = "superseded"
      }
      return authority ? { ...authority } : undefined
    },
  }

  ;(createCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
    run: async ({ input }: any) => {
      const id = `cart_matrix_created_${sequence++}`
      const cart: Cart = {
        ...guestCart,
        id,
        customer: input.customer_id ? { id: input.customer_id } : null,
        customer_id: input.customer_id ?? null,
        items: [],
      }
      carts.set(id, cart)
      versions.set(id, 1)
      attempts.set(id, [{ id: `pat_${id}`, cart_id: id, status: "created" }])
      return { result: { id } }
    },
  }))
  ;(addToCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
    run: async ({ input }: any) => {
      const cart = carts.get(input.cart_id)!
      const item = {
        id: `li_matrix_${sequence++}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta",
        unit_price: 3990,
      }
      cart.items.push(item)
      return { result: { cart_id: cart.id } }
    },
  }))
  ;(updateLineItemInCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
    run: async ({ input }: any) => {
      const cart = carts.get(input.cart_id)!
      const item = cart.items.find((candidate) => candidate.id === input.item_id)!
      if (input.update.quantity === 0) {
        cart.items = cart.items.filter((candidate) => candidate.id !== input.item_id)
      } else {
        item.quantity = input.update.quantity
      }
      return { result: { cart_id: cart.id } }
    },
  }))
  ;(deleteLineItemsWorkflow as unknown as jest.Mock).mockImplementation(() => ({
    run: async ({ input }: any) => {
      const cart = carts.get(input.cart_id)!
      cart.items = cart.items.filter((item) => !input.ids.includes(item.id))
      return { result: { cart_id: cart.id } }
    },
  }))

  function request(options: {
    method: string
    path?: string
    cartId?: string
    lineId?: string
    body?: unknown
    key?: string
    ifMatch?: string
    guest?: boolean
    guestToken?: string
    customer?: boolean
    authorization?: string
  }) {
    requestedCartId = options.cartId ?? guestCart.id
    const headers: Record<string, string> = {
      "idempotency-key": options.key ?? `matrix-${sequence++}`,
      "x-indicio-bff-auth": "bff_matrix_secret",
    }
    if (options.guest || options.guestToken) {
      headers[GUEST_CART_CAPABILITY_HEADER] = options.guestToken ?? mintedToken
    }
    if (options.authorization) headers.authorization = options.authorization
    if (options.ifMatch) headers["if-match"] = options.ifMatch
    return {
      method: options.method,
      url: options.path ?? "/store/carts/active",
      originalUrl: options.path ?? "/store/carts/active",
      params: {
        id: options.cartId ?? guestCart.id,
        ...(options.lineId ? { line_id: options.lineId } : {}),
      },
      body: options.body,
      headers,
      customerAuth: options.customer
        ? {
            authorized: true,
            customerId: customerCart.customer_id,
            authIdentityId: "identity_matrix",
            lineageId: "lineage_matrix",
            sid: "sid_matrix",
            credentialVersion: 1,
            originalAuthenticatedAt: new Date(now),
            absoluteExpiresAt: new Date("2026-09-20T12:00:00.000Z"),
          }
        : undefined,
      scope: (() => {
        const parentResolve = (keyToResolve: unknown) => {
          if (keyToResolve === GUEST_CART_CAPABILITY_MODULE) return guestCapability
          if (keyToResolve === STORE_IDEMPOTENCY_MODULE) return idempotency
          if (keyToResolve === STORE_RESOURCE_VERSION_MODULE) return resourceVersion
          if (keyToResolve === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
          if (keyToResolve === ContainerRegistrationKeys.REMOTE_QUERY) return remoteQuery
          if (keyToResolve === ContainerRegistrationKeys.PG_CONNECTION) return pgConnection
          if (keyToResolve === ContainerRegistrationKeys.LINK) return { create: async () => undefined }
          if (keyToResolve === Modules.CART) return cartModule
          if (keyToResolve === CART_MERGE_MODULE) return cartMergeAuthority
          throw new Error(`unrecognized scope key ${String(keyToResolve)}`)
        }
        return {
          createScope() {
            const overrides = new Map<unknown, { resolve(): unknown }>()
            const child = {
              register(keyToRegister: unknown, override: { resolve(): unknown }) {
                overrides.set(keyToRegister, override)
                return child
              },
              resolve(keyToResolve: unknown) {
                const override = overrides.get(keyToResolve)
                return override ? override.resolve() : parentResolve(keyToResolve)
              },
            }
            return child
          },
          resolve: parentResolve,
        }
      })(),
    }
  }

  return {
    carts,
    guestCart,
    customerCart,
    attempts,
    records,
    request,
    response,
    token: () => mintedToken,
    version: (id = guestCart.id) => versions.get(id) ?? 1,
  }
}

describe("Phase 15 guest cart final HTTP contract matrix", () => {
  it("preserves the final exact-set, Auth M1, Cart M1 and native DENY policy", () => {
    const counts = summarizeStoreSurfaceManifest()
    expect(counts).toMatchObject({
      total: 66,
      native: 46,
      local: 15,
      extended: 18,
      deny: 46,
      preserveLegacy: 6,
      m1EnabledPolicy: 14,
    })
    expect(STORE_SURFACE_MANIFEST.filter((entry) => entry.runtime_policy === "M1_ENABLED"))
      .toHaveLength(14)
    expect(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS).toHaveLength(6)
    expect(STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS).toHaveLength(6)
    expect(STORE_SURFACE_M1_ENABLED_OPERATIONS).toHaveLength(14)

    for (const [method, path] of [
      ["GET", "/store/carts/cart_matrix_01"],
      ["POST", "/store/carts/cart_matrix_01/complete"],
      ["POST", "/store/carts/cart_matrix_01/shipping-methods"],
      ["POST", "/store/carts/cart_matrix_01/line-items/../complete"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
    }

    expect(
      decideStoreSurfaceAccess("POST", "/store/customers/me/cart/attach")
    ).toMatchObject({ action: "allow", mode: "preserve_legacy" })

    for (const operation of STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      expect(decideStoreSurfaceAccess(method, path.replace("{id}", "cart_matrix_01").replace("{line_id}", "li_matrix_01")).action).toBe("allow")
    }
  })

  it("proves lazy lifecycle, idempotency replay, invalid-present 404 and D14-08 lineage independence", async () => {
    const harness = createHarness()
    await expect(
      getActiveCart(harness.request({ method: "GET" }) as never, harness.response() as never)
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    const first = harness.response()
    await postActiveCart(
      harness.request({ method: "POST", key: "active-create-matrix" }) as never,
      first as never
    )
    expect(first.statusCode).toBe(201)
    const token = harness.token()
    expect(first.headers[GUEST_CART_CAPABILITY_HEADER]).toBe(token)
    expect(JSON.stringify(first.body)).not.toContain(token)
    expect(JSON.stringify(first.body)).not.toMatch(/order|payment/i)
    expect(first.headers.etag).toBe('"1"')

    const getResponse = harness.response()
    await getActiveCart(
      harness.request({ method: "GET", guest: true }) as never,
      getResponse as never
    )
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    expect(getResponse.headers.etag).toBe('"1"')

    const replay = harness.response()
    await postActiveCart(
      harness.request({ method: "POST", key: "active-create-matrix" }) as never,
      replay as never
    )
    expect(replay.statusCode).toBe(200)
    expect(replay.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    expect((replay.body as any).cart.id).toBe((first.body as any).cart.id)

    const beforeInvalid = harness.carts.size
    await expect(
      postActiveCart(
        harness.request({
          method: "POST",
          guestToken: "invalid-presented-capability",
          key: "invalid-present",
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    expect(harness.carts.size).toBe(beforeInvalid)

    const afterLineageRevoke = harness.response()
    await getActiveCart(
      harness.request({ method: "GET", guest: true }) as never,
      afterLineageRevoke as never
    )
    expect(afterLineageRevoke.statusCode).toBe(200)
  })

  it("covers add, update quantity zero, delete, clear, If-Match/ETag, PaymentAttempt invalidation and replay", async () => {
    const harness = createHarness()
    const run = async (kind: "add" | "update" | "delete" | "clear", key: string, body?: unknown, lineId?: string, ifMatch?: string) => {
      const req = harness.request({
        method: kind === "delete" || kind === "clear" ? "DELETE" : "POST",
        path: `/store/carts/${harness.guestCart.id}/line-items`,
        cartId: harness.guestCart.id,
        lineId,
        body,
        key,
        guest: true,
        ifMatch: ifMatch ?? `"${harness.version()}"`,
      })
      const res = harness.response()
      if (kind === "add") await addLineItem(req as never, res as never)
      if (kind === "update") await updateLineItem(req as never, res as never)
      if (kind === "delete") await deleteLineItem(req as never, res as never)
      if (kind === "clear") await clearLineItems(req as never, res as never)
      return res
    }

    const added = await run("add", "matrix-add", { variant_id: "variant_matrix_01", quantity: 1 })
    expect(added.statusCode).toBe(200)
    expect(added.headers.etag).toBe('"2"')
    expect(harness.guestCart.items).toHaveLength(1)
    expect(harness.attempts.get(harness.guestCart.id)?.[0].status).toBe("invalidated_by_cart_change")

    const lineId = String(harness.guestCart.items[0].id)
    const removedByZero = await run("update", "matrix-update-zero", { quantity: 0 }, lineId)
    expect(removedByZero.statusCode).toBe(200)
    expect(harness.guestCart.items).toHaveLength(0)

    const second = await run("add", "matrix-add-second", { variant_id: "variant_matrix_02", quantity: 2 })
    const secondLineId = String(harness.guestCart.items[0].id)
    expect(second.statusCode).toBe(200)
    const deleted = await run("delete", "matrix-delete", undefined, secondLineId)
    expect(deleted.statusCode).toBe(200)
    expect(harness.guestCart.items).toHaveLength(0)

    await run("add", "matrix-clear-one", { variant_id: "variant_matrix_03", quantity: 1 })
    await run("add", "matrix-clear-two", { variant_id: "variant_matrix_04", quantity: 1 })
    const cleared = await run("clear", "matrix-clear")
    expect(cleared.statusCode).toBe(200)
    expect(harness.guestCart.items).toHaveLength(0)
    expect(cleared.headers.etag).toBe(`"${harness.version()}"`)

    const stale = await run(
      "add",
      "matrix-stale",
      { variant_id: "variant_matrix_stale", quantity: 1 },
      undefined,
      '"1"'
    ).catch((error) => error)
    expect(stale).toMatchObject({ statusCode: 412, code: "CART_VERSION_MISMATCH" })
    expect(harness.records.get("matrix-stale")).toMatchObject({
      state: "failed_terminal",
      failure_code: "CART_VERSION_MISMATCH",
    })

    const replay = harness.response()
    await expect(
      addLineItem(
        harness.request({
          method: "POST",
          path: `/store/carts/${harness.guestCart.id}/line-items`,
          cartId: harness.guestCart.id,
          body: { variant_id: "variant_matrix_stale", quantity: 1 },
          key: "matrix-stale",
          guest: true,
          ifMatch: '"1"',
        }) as never,
        replay as never
      )
    ).rejects.toMatchObject({ statusCode: 412, code: "CART_VERSION_MISMATCH" })
    expect(harness.guestCart.items).toHaveLength(0)
  })

  it("keeps Customer active authority and the guest capability canary out of approved sinks", async () => {
    const harness = createHarness()
    const customerResponse = harness.response()
    await getActiveCart(
      harness.request({
        method: "GET",
        customer: true,
        authorization: "Bearer customer_matrix",
        cartId: harness.customerCart.id,
      }) as never,
      customerResponse as never
    )
    expect(customerResponse.statusCode).toBe(200)
    expect((customerResponse.body as any).cart.id).toBe(harness.customerCart.id)

    const collector = createGuestCartLeakageCollector()
    collector.record("db_plaintext", {
      id: "gccap_matrix_01",
      cart_id: harness.guestCart.id,
      token_hash: "sha256_matrix_guest_capability_hash",
      status: "active",
    })
    collector.record("redis_keys_jobs", { key: "gccap:sha256_matrix_guest_capability_hash" })
    collector.record("logs", JSON.stringify(customerResponse.body))
    collector.record("sentry", { error: "cart mutation failed", cart_id: harness.guestCart.id })
    collector.record("openapi", { header: GUEST_CART_CAPABILITY_HEADER })
    collector.record("fixtures_snapshots", { token_hash: "sha256_matrix_guest_capability_hash" })
    collector.record("analytics", { event: "cart_mutated", cart_id: harness.guestCart.id })
    collector.assertNoCanaries([harness.token()])
  })
})
