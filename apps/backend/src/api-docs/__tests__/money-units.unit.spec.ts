import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"
import { brlMajorToMinor } from "../../utils/money-units"

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
    expect(cart.properties.item_total["x-money-unit"]).toBe("brl-major")
    expect(cart.properties.shipping_total["x-money-unit"]).toBe("brl-major")
    expect(cart.properties.tax_total["x-money-unit"]).toBe("brl-major")
    expect(cart.properties.discount_total["x-money-unit"]).toBe("brl-major")

    expect(amount.type).toBe("integer")
    expect(amount.minimum).toBe(1)
    expect(amount["x-money-unit"]).toBe("brl-minor")

    expect(store?.components.schemas.PublicStoreCartPreOrder).not.toBe(
      store?.components.schemas.StorePaymentAttemptAmountMinor
    )
    expect(cart.properties.total["x-money-unit"]).not.toBe(
      amount["x-money-unit"]
    )
  })

  it("documents PaymentSession money as major-unit (distinct from PaymentAttempt minor)", () => {
    const amount = store?.components.schemas.StorePaymentAttemptAmountMinor as {
      description?: string
      "x-money-unit"?: string
      type?: string
    }

    expect(amount.type).toBe("integer")
    expect(amount["x-money-unit"]).toBe("brl-minor")
    expect(amount.description).toMatch(/PaymentSession major-unit/i)
    expect(amount.description).toMatch(/Cart/i)
  })

  it("converts BRL major units to integer minor units via brlMajorToMinor", () => {
    expect(brlMajorToMinor(10.9)).toBe(1090)
    expect(brlMajorToMinor(0.01)).toBe(1)
    expect(brlMajorToMinor(19.99)).toBe(1999)
    expect(Number.isInteger(brlMajorToMinor(19.99))).toBe(true)
    expect(Number.isInteger(10.9)).toBe(false)
    expect(Number.isInteger(0.01)).toBe(false)
  })

  it("rejects invalid or unsafe major amounts", () => {
    expect(() => brlMajorToMinor(10.999)).toThrow("BRL_MAJOR_AMOUNT_TOO_PRECISE")
    expect(() => brlMajorToMinor(-1)).toThrow("BRL_MAJOR_AMOUNT_NEGATIVE")
    expect(() => brlMajorToMinor(Number.NaN)).toThrow("BRL_MAJOR_AMOUNT_INVALID")
    expect(() => brlMajorToMinor(Number.POSITIVE_INFINITY)).toThrow(
      "BRL_MAJOR_AMOUNT_INVALID"
    )
    expect(() => brlMajorToMinor(Number.NEGATIVE_INFINITY)).toThrow(
      "BRL_MAJOR_AMOUNT_INVALID"
    )

    // Minor units would exceed Number.MAX_SAFE_INTEGER (9007199254740991).
    // Use a string major so float precision cannot mask the overflow.
    const overflowingMajor = "90071992547410"
    expect(() => brlMajorToMinor(overflowingMajor)).toThrow(
      "BRL_MINOR_AMOUNT_OVERFLOW"
    )
  })

  it("rejects fractional minor-unit amounts in the PaymentAttempt schema", () => {
    const amount = store?.components.schemas.StorePaymentAttemptAmountMinor as {
      type?: string
    }
    expect(amount.type).toBe("integer")
    expect(amount.type).not.toBe("number")
  })

  it("reuses the minor-unit amount schema for card and Pix responses only", () => {
    const card = store?.components.schemas.StoreCardPaymentAttemptResponse as {
      properties: { amount: { $ref?: string } }
    }
    const pix = store?.components.schemas.StorePixPaymentAttemptResponse as {
      properties: { amount: { $ref?: string } }
    }
    const cart = store?.components.schemas.PublicStoreCartPreOrder as {
      properties: { total: { $ref?: string; "x-money-unit"?: string } }
    }

    expect(card.properties.amount.$ref).toBe(
      "#/components/schemas/StorePaymentAttemptAmountMinor"
    )
    expect(pix.properties.amount.$ref).toBe(
      "#/components/schemas/StorePaymentAttemptAmountMinor"
    )
    expect(cart.properties.total.$ref).toBeUndefined()
    expect(cart.properties.total["x-money-unit"]).toBe("brl-major")
  })

  it("aligns StoreCatalogPrice.amount with serializer integer publication gate", () => {
    const catalogPrice = store?.components.schemas.StoreCatalogPrice as {
      properties: {
        amount: {
          type?: string
          "x-money-unit"?: string
        }
      }
    }

    // Public catalog serializer (getBrlPrice) only publishes prices when
    // Number.isInteger(price.amount) — OpenAPI must declare integer, not number.
    expect(catalogPrice.properties.amount.type).toBe("integer")
    expect(catalogPrice.properties.amount["x-money-unit"]).toBe("brl-major")
    expect(catalogPrice.properties.amount.type).not.toBe("number")
    expect(Number.isInteger(1090)).toBe(true)
    expect(Number.isInteger(10.9)).toBe(false)
  })

  it("documents PublicStoreCartItem.unit_price as nullable major-unit number", () => {
    const item = store?.components.schemas.PublicStoreCartItem as {
      properties: {
        unit_price: {
          type?: unknown
          "x-money-unit"?: string
        }
      }
    }

    expect(item.properties.unit_price["x-money-unit"]).toBe("brl-major")
    expect(item.properties.unit_price.type).toEqual(["number", "null"])
  })
})

describe("OpenAPI Admin refund monetary unit boundary", () => {
  const admin = buildContracts(createFoundationRegistry()).find(
    (contract) => contract.surface === "admin"
  )?.document

  it("uses an Admin-local integer BRL minor-unit schema for refund request and response", () => {
    const amount = admin?.components.schemas.AdminBrlMinorAmount as {
      type?: string
      minimum?: number
      "x-money-unit"?: string
    }
    const request = admin?.components.schemas.AdminRefundRequestCreate as {
      properties: { amount: { $ref?: string } }
    }
    const response = admin?.components.schemas.AdminRefundRequest as {
      properties: { amount: { $ref?: string } }
    }
    const availability = admin?.components.schemas.AdminRefundAvailability as {
      properties: Record<string, { $ref?: string; type?: string; "x-money-unit"?: string }>
    }

    expect(amount).toEqual(
      expect.objectContaining({
        type: "integer",
        minimum: 1,
        "x-money-unit": "brl-minor",
      })
    )
    expect(request.properties.amount.$ref).toBe(
      "#/components/schemas/AdminBrlMinorAmount"
    )
    expect(response.properties.amount.$ref).toBe(
      "#/components/schemas/AdminBrlMinorAmount"
    )
    for (const field of [
      "captured_amount",
      "confirmed_refunded_amount",
      "reserved_amount",
      "available_amount",
    ]) {
      const schema = availability.properties[field]
      expect(
        schema.$ref === "#/components/schemas/AdminBrlMinorAmount" ||
          (schema.type === "integer" && schema["x-money-unit"] === "brl-minor")
      ).toBe(true)
    }
    expect(amount.type).not.toBe("number")
  })
})
