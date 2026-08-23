import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
import {
  CART_MERGE_MODULE,
  CartMergeModuleService,
} from "../../src/modules/cart-merge"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { Modules } from "@medusajs/framework/utils"

function createResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
}

function createTracerHarness() {
  const guestCart = {
    id: "cart_guest_merge_01",
    customer: null,
    customer_id: null,
    email: "guest@example.com",
    currency_code: "brl",
    metadata: { active_for_checkout: true },
    items: [
      {
        id: "li_guest_merge_01",
        variant_id: "variant_tshirt_black_m",
        quantity: 2,
        title: "Camiseta preta M",
        variant_title: "Preta / M",
        unit_price: 9900,
      },
    ],
    completed_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
  }
  const capability = {
    id: "gccap_merge_01",
    cart_id: guestCart.id,
    token_hash: "hash_only_guest_merge_01",
    status: "active" as const,
    expires_at: "2026-08-30T12:00:00.000Z",
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    deleted_at: null,
  }
  const transaction = { id: "tx_cart_merge_01", raw: jest.fn(async () => ({ rows: [] })) }
  const versions = new Map([[guestCart.id, 1]])
  const idempotency = {
    claim: jest.fn(async (input: any) => ({
      type: "claimed" as const,
      record: {
        id: "stidem_merge_01",
        state: "processing" as const,
        state_version: 1,
        retry_attempt_count: 0,
        request_fingerprint: input.canonicalSemanticObject,
      },
    })),
    markCompleted: jest.fn(async () => ({
      type: "claimed" as const,
      record: { id: "stidem_merge_01", state: "completed", state_version: 2 },
    })),
  }
  const capabilityService = {
    lookupGuestCartCapabilityByPresentedToken: jest.fn(async () => capability),
    authorizeGuestCartCapabilityForMutation: jest.fn(
      async (_token: string, cartId: string) => {
        if (cartId !== guestCart.id) throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
        return capability
      }
    ),
    consumeGuestCartCapability: jest.fn(async () => {
      capability.status = "consumed"
      capability.consumed_at = "2026-08-23T12:00:01.000Z"
      return capability
    }),
  }
  const resourceVersion = {
    initialize: jest.fn(async (_type: string, id: string) => ({
      id: `strver_${id}`,
      resource_type: "cart",
      resource_id: id,
      version: versions.get(id) ?? 1,
    })),
    increment: jest.fn(async (_type: string, id: string, expected: number) => {
      const actual = versions.get(id) ?? 1
      if (actual !== expected) return { type: "stale", actualVersion: actual, expectedVersion: expected }
      versions.set(id, actual + 1)
      return { type: "updated", previousVersion: actual, version: actual + 1 }
    }),
  }
  const cartModule = {
    baseRepository_: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({ getTransactionContext: () => transaction }),
    },
    retrieveCart: jest.fn(async (id: string) => (id === guestCart.id ? guestCart : null)),
    updateCarts: jest.fn(async (input: Record<string, unknown>) => {
      Object.assign(guestCart, input)
      guestCart.customer = { id: String(input.customer_id) }
      guestCart.customer_id = String(input.customer_id)
      guestCart.updated_at = "2026-08-23T12:00:01.000Z"
      return guestCart
    }),
  }
  const service = new CartMergeModuleService()
  const scope = {
    resolve(key: unknown) {
      if (key === CART_MERGE_MODULE) return service
      if (key === Modules.CART) return cartModule
      if (key === GUEST_CART_CAPABILITY_MODULE) return capabilityService
      if (key === STORE_IDEMPOTENCY_MODULE) return idempotency
      if (key === STORE_RESOURCE_VERSION_MODULE) return resourceVersion
      throw new Error(`unrecognized container key ${String(key)}`)
    },
  }

  return {
    guestCart,
    capability,
    versions,
    idempotency,
    capabilityService,
    resourceVersion,
    cartModule,
    transaction,
    request: {
      method: "POST",
      url: "/store/customers/me/cart/merge",
      originalUrl: "/store/customers/me/cart/merge",
      auth_context: { actor_type: "customer", actor_id: "cus_merge_01" },
      customerAuthBff: { authorized: true },
      body: { guestCartId: guestCart.id },
      headers: {
        authorization: "Bearer customer-jwt-is-not-persisted",
        "x-indicio-bff-auth": "bff-secret-is-not-persisted",
        [GUEST_CART_CAPABILITY_HEADER]: "guest-capability-is-not-persisted",
        "idempotency-key": "merge-key-01",
        "if-match": '"1"',
      },
      scope,
    },
  }
}

describe("Cart merge HTTP tracer", () => {
  it("promove o guest integralmente quando não existe Customer cart", async () => {
    const harness = createTracerHarness()
    const response = createResponse()

    await mergeCart(harness.request as never, response as never)

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('"2"')
    expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
    expect((response.body as any).review).toEqual({
      requiresReview: false,
      reviewRef: null,
      rejectedItems: [],
    })
    expect((response.body as any).cart.id).toBe(harness.guestCart.id)
    expect((response.body as any).cart.customer.id).toBe("cus_merge_01")
    expect(harness.versions.get(harness.guestCart.id)).toBe(2)
    expect(harness.capability.status).toBe("consumed")
    expect(harness.idempotency.claim).toHaveBeenCalledTimes(1)
    expect(harness.idempotency.markCompleted).toHaveBeenCalledTimes(1)
    expect(harness.cartModule.updateCarts).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(response.body)).not.toContain("guest-capability-is-not-persisted")
    expect(JSON.stringify(response.body)).not.toContain("customer-jwt-is-not-persisted")
  })
})
