import { applyStructuralCartInvalidation } from "../shipping-invalidation"

describe("structural cart invalidation hooks (CART-09)", () => {
  it("invoca PaymentAttempt, quote e selection em ordem sem network", async () => {
    const calls: string[] = []
    const at = new Date("2026-08-21T12:00:00.000Z")

    await applyStructuralCartInvalidation("cart_01", at, {
      invalidateActivePaymentAttemptForCartChange: async (cartId, timestamp) => {
        calls.push(`payment:${cartId}:${timestamp.toISOString()}`)
      },
      invalidateShippingQuote: async (cartId, timestamp) => {
        calls.push(`quote:${cartId}:${timestamp.toISOString()}`)
      },
      invalidateShippingSelection: async (cartId, timestamp) => {
        calls.push(`selection:${cartId}:${timestamp.toISOString()}`)
      },
    })

    expect(calls).toEqual([
      "payment:cart_01:2026-08-21T12:00:00.000Z",
      "quote:cart_01:2026-08-21T12:00:00.000Z",
      "selection:cart_01:2026-08-21T12:00:00.000Z",
    ])
  })
})
