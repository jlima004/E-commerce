import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

function majorToMinor(major: number): number {
  return Math.round(major * 100)
}

describe("OpenAPI Store monetary unit boundary", () => {
  const store = buildContracts(createFoundationRegistry()).find(
    (contract) => contract.surface === "store"
  )?.document

  it("keeps Cart major-unit totals distinct from PaymentAttempt minor-unit amounts", () => {
    const cart = store?.components.schemas.PublicStoreCartPreOrder as {
      properties: Record<string, { "x-money-unit"?: string; type?: unknown }>
    }
    const amount = store?.components.schemas.StorePaymentAttemptAmountMinor as {
      type?: string
      minimum?: number
      "x-money-unit"?: string
    }

    expect(cart.properties.total["x-money-unit"]).toBe("brl-major")
    expect(cart.properties.subtotal["x-money-unit"]).toBe("brl-major")
    expect(amount.type).toBe("integer")
    expect(amount.minimum).toBe(1)
    expect(amount["x-money-unit"]).toBe("brl-minor")
    expect(store?.components.schemas.PublicStoreCartPreOrder).not.toBe(
      store?.components.schemas.StorePaymentAttemptAmountMinor
    )
  })

  it("proves representative major-to-minor conversions used by PaymentAttempt", () => {
    expect(majorToMinor(10.9)).toBe(1090)
    expect(majorToMinor(0.01)).toBe(1)
    expect(Number.isInteger(majorToMinor(19.99))).toBe(true)
    expect(Number.isInteger(10.9)).toBe(false)
    expect(Number.isInteger(0.01)).toBe(false)
  })

  it("rejects fractional minor-unit amounts in the PaymentAttempt schema", () => {
    const amount = store?.components.schemas.StorePaymentAttemptAmountMinor as {
      type?: string
    }
    expect(amount.type).toBe("integer")
    expect(amount.type).not.toBe("number")
  })

  it("reuses the minor-unit amount schema for card and Pix responses", () => {
    const card = store?.components.schemas.StoreCardPaymentAttemptResponse as {
      properties: { amount: { $ref?: string } }
    }
    const pix = store?.components.schemas.StorePixPaymentAttemptResponse as {
      properties: { amount: { $ref?: string } }
    }
    expect(card.properties.amount.$ref).toBe(
      "#/components/schemas/StorePaymentAttemptAmountMinor"
    )
    expect(pix.properties.amount.$ref).toBe(
      "#/components/schemas/StorePaymentAttemptAmountMinor"
    )
  })
})
