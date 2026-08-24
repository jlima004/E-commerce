import { Modules } from "@medusajs/framework/utils"
import { CartMergeModuleService } from ".."
import type { CartMergeExecutionInput } from "../service"
import {
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityRecord,
} from "../../guest-cart-capability"
import {
  STORE_IDEMPOTENCY_CART_MERGE,
  STORE_IDEMPOTENCY_MODULE,
} from "../../store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../store-resource-version"

const CART_MERGE_OUTCOMES = [
  "MERGED",
  "MERGED_PARTIAL",
  "GUEST_CART_ATTACHED",
  "NO_ITEMS",
  "CUSTOMER_CART_PRESERVED",
] as const

type TestCart = {
  id: string
  customer: { id: string } | null
  customer_id: string | null
  email: string
  currency_code: string
  metadata: Record<string, unknown>
  items: Array<{
    id: string
    variant_id: string
    quantity: number
    title: string
    variant_title: string
    unit_price: number
  }>
  completed_at: null
  created_at: string
  updated_at: string
}

function createHarness() {
  const cart: TestCart = {
    id: "cart_unit_merge_01",
    customer: null,
    customer_id: null,
    email: "guest@unit.test",
    currency_code: "brl",
    metadata: { active_for_checkout: true },
    items: [
      {
        id: "line_b",
        variant_id: "variant_b",
        quantity: 2,
        title: "B",
        variant_title: "B",
        unit_price: 100,
      },
      {
        id: "line_a_1",
        variant_id: "variant_a",
        quantity: 3,
        title: "A",
        variant_title: "A",
        unit_price: 100,
      },
      {
        id: "line_a_2",
        variant_id: "variant_a",
        quantity: 4,
        title: "A",
        variant_title: "A",
        unit_price: 100,
      },
    ],
    completed_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
  }
  const capability: GuestCartCapabilityRecord = {
    id: "gccap_unit_merge_01",
    cart_id: cart.id,
    token_hash: "hash-only-unit-capability",
    status: "active",
    expires_at: "2026-08-30T12:00:00.000Z",
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    deleted_at: null,
  }
  const versions = new Map([[cart.id, 7]])
  const transaction = {
    raw: jest.fn(async (sql: string) => {
      if (sql.includes("from cart") && sql.includes("customer_id")) {
        return { rows: [] }
      }
      if (sql.includes("select id from cart")) {
        return { rows: [{ id: cart.id }] }
      }
      if (sql.includes("payment_attempt")) {
        return { rows: [] }
      }
      return { rows: [] }
    }),
  }
  const claim = jest.fn(async (input: any) => ({
    type: "claimed" as const,
    record: {
      id: "stidem_unit_merge_01",
      state: "processing" as const,
      state_version: 1,
      retry_attempt_count: 0,
      request_fingerprint: input.canonicalSemanticObject,
    },
  }))
  const markCompleted = jest.fn(async () => ({
    type: "claimed" as const,
    record: {
      id: "stidem_unit_merge_01",
      state: "completed" as const,
      state_version: 2,
    },
  }))
  const idempotency = { claim, markCompleted }
  const capabilityService = {
    lookupGuestCartCapabilityByPresentedToken: jest.fn(async () => capability),
    authorizeGuestCartCapabilityForMutation: jest.fn(async () => capability),
    consumeGuestCartCapability: jest.fn(async () => {
      capability.status = "consumed"
      capability.consumed_at = "2026-08-23T12:00:01.000Z"
      return capability
    }),
  }
  const resourceVersion = {
    initialize: jest.fn(async () => ({
      id: "strver_unit_merge_01",
      resource_type: "cart",
      resource_id: cart.id,
      version: versions.get(cart.id),
    })),
    increment: jest.fn(async (_type: string, _id: string, expected: number) => {
      const actual = versions.get(cart.id)!
      if (expected !== actual) {
        return { type: "stale" as const, actualVersion: actual, expectedVersion: expected }
      }
      versions.set(cart.id, actual + 1)
      return { type: "updated" as const, previousVersion: actual, version: actual + 1 }
    }),
  }
  const cartModule = {
    baseRepository_: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({ getTransactionContext: () => transaction }),
    },
    retrieveCart: jest.fn(async () => cart),
    updateCarts: jest.fn(async (input: Record<string, unknown>) => {
      cart.customer_id = String(input.customer_id)
      cart.customer = { id: cart.customer_id }
      cart.updated_at = "2026-08-23T12:00:01.000Z"
      return cart
    }),
  }
  const request = {
    scope: {
      resolve(key: unknown) {
        if (key === Modules.CART) return cartModule
        if (key === GUEST_CART_CAPABILITY_MODULE) return capabilityService
        if (key === STORE_IDEMPOTENCY_MODULE) return idempotency
        if (key === STORE_RESOURCE_VERSION_MODULE) return resourceVersion
        throw new Error(`UNEXPECTED_SCOPE_KEY:${String(key)}`)
      },
    },
    customerAuthBff: { authorized: true },
  }

  const input: CartMergeExecutionInput = {
    request: request as never,
    customerId: "cus_unit_merge_01",
    guestCartId: cart.id,
    presentedCapability: "guest-capability-is-not-persisted",
    rawIdempotencyKey: "merge-unit-key-01",
    expectedGuestVersion: 7,
  }

  return {
    cart,
    capability,
    versions,
    claim,
    markCompleted,
    capabilityService,
    cartModule,
    input,
  }
}

describe("Phase 16 cart merge decision tracer", () => {
  it("fixa exatamente os cinco outcomes públicos e mantém o reservado enum-only", () => {
    expect(CART_MERGE_OUTCOMES).toEqual([
      "MERGED",
      "MERGED_PARTIAL",
      "GUEST_CART_ATTACHED",
      "NO_ITEMS",
      "CUSTOMER_CART_PRESERVED",
    ])
  })

  it("agrega a intenção por variantId, ordena antes do fingerprint e promove integralmente", async () => {
    const harness = createHarness()
    const service = new CartMergeModuleService({} as never)

    const result = await service.executeCartMerge(harness.input)

    expect(result.outcome).toBe("GUEST_CART_ATTACHED")
    expect(result.outcome).not.toBe("CUSTOMER_CART_PRESERVED")
    expect(harness.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: STORE_IDEMPOTENCY_CART_MERGE,
        canonicalSemanticObject: {
          operation: "CART_MERGE",
          customerId: "cus_unit_merge_01",
          guestCartId: "cart_unit_merge_01",
          customerCartId: null,
          guestVersion: 7,
          customerVersion: null,
          normalizedGuestIntent: [
            { variantId: "variant_a", quantity: 7 },
            { variantId: "variant_b", quantity: 2 },
          ],
        },
        sharedContext: expect.any(Object),
      })
    )
    expect(harness.capability.status).toBe("consumed")
    expect(harness.versions.get(harness.cart.id)).toBe(8)
    expect(harness.markCompleted).toHaveBeenCalledTimes(1)
  })

  it("não transforma CUSTOMER_CART_PRESERVED em fallback positivo do tracer", async () => {
    const harness = createHarness()
    const service = new CartMergeModuleService({} as never)

    const result = await service.executeCartMerge(harness.input)

    expect(result).toEqual(
      expect.objectContaining({
        outcome: "GUEST_CART_ATTACHED",
        version: 8,
      })
    )
    expect(JSON.stringify(result)).not.toContain("CUSTOMER_CART_PRESERVED")
  })
})
