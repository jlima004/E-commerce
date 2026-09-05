import fs from "fs"
import path from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { POST as acknowledgeCartReview } from "../../../api/store/carts/[id]/review/acknowledge/route"
import { toStoreErrorResponse } from "../../../api/store-surface/errors"
import { CART_MERGE_MODULE } from ".."
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../guest-cart-capability/types"
import { STORE_IDEMPOTENCY_MODULE } from "../../store-idempotency"

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

function publicCart() {
  return {
    id: "cart_public_ack_01",
    email: "customer@example.test",
    currency_code: "brl",
    locale: "pt-BR",
    total: 9900,
    subtotal: 9900,
    item_total: 9900,
    shipping_total: 0,
    tax_total: 0,
    discount_total: 0,
    region_id: "reg_br",
    created_at: "2026-08-25T12:00:00.000Z",
    updated_at: "2026-08-25T12:00:01.000Z",
    checkout_data_complete: false,
    customer: {
      id: "cus_public_ack_01",
      email: "customer@example.test",
    },
    items: [],
    shipping_address: null,
  }
}

function createHarness(options: {
  body?: unknown
  headers?: Record<string, string>
  result?: Record<string, unknown>
} = {}) {
  const service = {
    acknowledgeCartReview: jest.fn().mockResolvedValue(
      options.result ?? {
        cart: publicCart(),
        version: 7,
        review: {
          requiresReview: false,
          reviewRef: null,
          rejectedItems: [],
        },
      }
    ),
  }
  const resolve = jest.fn((key: unknown) => {
    if (key === CART_MERGE_MODULE) return service
    throw new Error(`UNEXPECTED_SCOPE_RESOLUTION:${String(key)}`)
  })
  const request = {
    method: "POST",
    url: "/store/carts/cart_public_ack_01/review/acknowledge",
    originalUrl: "/store/carts/cart_public_ack_01/review/acknowledge",
    params: { id: "cart_public_ack_01" },
    body: options.body ?? { reviewRef: "review_public_ack_01" },
    headers: {
      "if-match": '"7"',
      ...(options.headers ?? {}),
    },
    auth_context: {
      actor_type: "customer",
      actor_id: "cus_public_ack_01",
    },
    customerAuth: {
      authorized: true,
      customerId: "cus_public_ack_01",
    },
    customerAuthBff: { authorized: true },
    scope: { resolve },
  }

  return { request, response: createResponse(), resolve, service }
}

describe("Cart review ACK route contract", () => {
  it("delegates applied/replay/no-op results using reviewRef + If-Match and projects a closed body", async () => {
    const harness = createHarness()

    await acknowledgeCartReview(
      harness.request as never,
      harness.response as never
    )

    expect(harness.service.acknowledgeCartReview).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: "cart_public_ack_01",
        customerId: "cus_public_ack_01",
        reviewRef: "review_public_ack_01",
        expectedVersion: 7,
      })
    )
    expect(harness.response.statusCode).toBe(200)
    expect(harness.response.headers).toEqual({
      etag: '"7"',
      "cache-control": "no-store",
    })
    expect(Object.keys(harness.response.body as object).sort()).toEqual([
      "cart",
      "review",
    ])
    expect(Object.keys((harness.response.body as any).review).sort()).toEqual([
      "rejectedItems",
      "requiresReview",
      "reviewRef",
    ])
    expect(JSON.stringify(harness.response.body)).not.toMatch(
      /review_id|merge_result_id|acknowledged_at|produced_cart_version|capability|idempotency|authorization|jwt|secret|hash|order/i
    )
  })

  it("funciona sem Idempotency-Key e sem capability, sem resolver StoreIdempotency ou GuestCapability", async () => {
    const harness = createHarness()

    await acknowledgeCartReview(
      harness.request as never,
      harness.response as never
    )

    expect(harness.request.headers).not.toHaveProperty("idempotency-key")
    expect(harness.request.headers).not.toHaveProperty(
      GUEST_CART_CAPABILITY_HEADER
    )
    expect(harness.resolve).toHaveBeenCalledWith(CART_MERGE_MODULE)
    expect(harness.resolve).not.toHaveBeenCalledWith(STORE_IDEMPOTENCY_MODULE)
    expect(harness.resolve).not.toHaveBeenCalledWith(
      GUEST_CART_CAPABILITY_MODULE
    )
  })

  it("rejeita capability presente no ACK sem consumir capability nem chamar o serviço", async () => {
    const harness = createHarness({
      headers: {
        [GUEST_CART_CAPABILITY_HEADER]: "capability-present-public_01",
      },
    })

    const error = await acknowledgeCartReview(
      harness.request as never,
      harness.response as never
    ).catch((caught) => caught)

    expect([400, 404]).toContain(toStoreErrorResponse(error).statusCode)
    expect(harness.service.acknowledgeCartReview).not.toHaveBeenCalled()
    expect(harness.resolve).not.toHaveBeenCalledWith(
      GUEST_CART_CAPABILITY_MODULE
    )
  })

  it("aplica body strict exatamente { reviewRef: string|null }", async () => {
    const harness = createHarness({
      body: {
        reviewRef: "review_public_ack_01",
        idempotencyKey: "must-not-be-accepted",
      },
    })

    const error = await acknowledgeCartReview(
      harness.request as never,
      harness.response as never
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(MedusaError)
    expect(toStoreErrorResponse(error).statusCode).toBe(400)
    expect(harness.service.acknowledgeCartReview).not.toHaveBeenCalled()
  })

  it("exige If-Match também para null/no-op e não delega sem a autoridade de versão", async () => {
    const harness = createHarness({
      body: { reviewRef: null },
      headers: { "if-match": "1" },
    })

    const error = await acknowledgeCartReview(
      harness.request as never,
      harness.response as never
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(MedusaError)
    expect(toStoreErrorResponse(error).statusCode).toBe(400)
    expect(harness.service.acknowledgeCartReview).not.toHaveBeenCalled()
  })
})

describe("pending review structural mutation guard contract", () => {
  it.each(["add", "update", "delete", "clear"])(
    "%s exige a guarda antes de claim, workflow, bump, invalidation e consume",
    (operation) => {
      const source = fs.readFileSync(
        path.join(__dirname, "../../../api/store/carts/line-item-mutation.ts"),
        "utf8"
      )
      const guard = source.indexOf("assertNoPendingCartReview")

      expect(operation).toBeTruthy()
      expect(guard).toBeGreaterThanOrEqual(0)
      expect(guard).toBeLessThan(
        source.indexOf("await idempotencyService.claim(")
      )
      expect(guard).toBeLessThan(
        source.indexOf("await versionService.compareAndSwapWithMutation(")
      )
      expect(guard).toBeLessThan(
        source.indexOf("await applyStructuralCartInvalidation(")
      )
      expect(guard).toBeLessThan(
        source.indexOf(
          "await guestCapabilityService.authorizeGuestCartCapabilityForMutation("
        )
      )
    }
  )
})
