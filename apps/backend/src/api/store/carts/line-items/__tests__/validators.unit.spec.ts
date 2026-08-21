import { MedusaError } from "@medusajs/framework/utils"
import {
  AddCartLineItemBodySchema,
  UpdateCartLineItemBodySchema,
  parseAddCartLineItemBody,
  parseUpdateCartLineItemBody,
  rejectLineItemAuthorityFields,
} from "../validators"

describe("Store cart line-item validators (CART-06)", () => {
  it("aceita add com quantidades inteiras nos limites", () => {
    expect(AddCartLineItemBodySchema.parse({ variant_id: "variant_1", quantity: 1 })).toEqual({
      variant_id: "variant_1",
      quantity: 1,
    })
    expect(parseAddCartLineItemBody({ variant_id: "variant_1", quantity: 99 })).toEqual({
      variant_id: "variant_1",
      quantity: 99,
    })
  })

  it.each([0, -1, 100, 1.5, 1.1, 98.9])(
    "rejeita add com quantity %p",
    (quantity) => {
      expect(() => parseAddCartLineItemBody({ variant_id: "variant_1", quantity })).toThrow(
        MedusaError
      )
    }
  )

  it("trata JSON 1.0 como o mesmo Number que 1", () => {
    expect(parseAddCartLineItemBody({ variant_id: "variant_1", quantity: 1.0 })).toEqual({
      variant_id: "variant_1",
      quantity: 1,
    })
  })

  it("aceita update 0 como remoção", () => {
    expect(parseUpdateCartLineItemBody({ quantity: 0 })).toEqual({ quantity: 0 })
    expect(parseUpdateCartLineItemBody({ quantity: 99 })).toEqual({ quantity: 99 })
  })

  it.each([-1, 100, 1.5, 1.1, 98.9])(
    "rejeita update com quantity %p",
    (quantity) => {
      expect(() => parseUpdateCartLineItemBody({ quantity })).toThrow(MedusaError)
    }
  )

  it.each([
    { cart_id: "cart_1" },
    { id: "line_1" },
    { unit_price: 10 },
    { price: 10 },
    { metadata: {} },
    { guestCartToken: "secret" },
  ])("rejeita campo de autoridade %j", (field) => {
    expect(() => rejectLineItemAuthorityFields(field)).toThrow(MedusaError)
  })

  it("rejeita campos extras no body strict", () => {
    expect(() => parseAddCartLineItemBody({
      variant_id: "variant_1",
      quantity: 1,
      metadata: {},
    })).toThrow(MedusaError)
    expect(() => parseUpdateCartLineItemBody({ quantity: 1, cart_id: "cart_1" })).toThrow(
      MedusaError
    )
  })
})
