import {
  assertNoPaymentOrOrderFields,
  isCartUsableForCheckout,
  markCartSupersededInput,
  resolveActiveCartIdentity,
  type CheckoutCartLike,
} from "../active-cart"

const SELLABLE_VARIANT = {
  id: "variant_sellable",
  metadata: {
    gelato_product_uid: "prod_gelato_abc123",
    gelato_template_id: "template_fixed_001",
    gelato_variant_options: {
      size: "M",
      color: "black",
    },
    template_mode: "fixed",
  },
  prices: [{ currency_code: "brl", amount: 99 }],
}

function buildCart(
  overrides: Partial<CheckoutCartLike> = {}
): CheckoutCartLike {
  return {
    id: "cart_01",
    currency_code: "brl",
    metadata: null,
    items: [
      {
        id: "item_01",
        quantity: 1,
        variant: SELLABLE_VARIANT,
      },
    ],
    ...overrides,
  }
}

describe("resolveActiveCartIdentity", () => {
  it("deriva customer autenticado da auth_context sem confiar em body arbitrario", () => {
    const identity = resolveActiveCartIdentity({
      auth_context: {
        actor_id: "cus_123",
        actor_type: "customer",
      },
      session: {
        active_cart_id: "cart_guest_01",
      },
      customer: {
        email: "cliente@exemplo.com",
      },
      body: {
        customer_id: "cus_spoofed",
      },
    })

    expect(identity).toEqual({
      actorType: "customer",
      actorId: "cus_123",
      customerId: "cus_123",
      email: "cliente@exemplo.com",
    })
  })

  it("deriva guest cart da sessao atual sem exigir email", () => {
    const identity = resolveActiveCartIdentity({
      session: {
        id: "sess_01",
        active_cart_id: "cart_guest_01",
      },
      body: {
        customer_id: "cus_spoofed",
      },
    })

    expect(identity).toEqual({
      actorType: "guest",
      actorId: "sess_01",
      sessionId: "sess_01",
      activeCartId: "cart_guest_01",
    })
  })
})

describe("isCartUsableForCheckout", () => {
  it("aceita cart basico de guest sem email quando houver item vendavel e quantidade positiva", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          email: undefined,
        })
      )
    ).toBe(true)
  })

  it("rejeita cart superseded por metadata existente sem exigir schema novo", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          metadata: {
            active_for_checkout: false,
            superseded_by_cart_id: "cart_02",
          },
        })
      )
    ).toBe(false)
  })

  it("rejeita line item com quantidade nao positiva", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          items: [
            {
              id: "item_01",
              quantity: 0,
              variant: SELLABLE_VARIANT,
            },
          ],
        })
      )
    ).toBe(false)
  })

  it("reaproveita a fronteira sellable da Phase 02 sem revalidacao profunda de Gelato", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          items: [
            {
              id: "item_01",
              quantity: 1,
              variant: {
                ...SELLABLE_VARIANT,
                metadata: {
                  gelato_product_uid: "prod_gelato_abc123",
                },
              },
            },
          ],
        })
      )
    ).toBe(false)
  })
})

describe("markCartSupersededInput", () => {
  it("marca cart antigo como nao ativo usando somente metadata do core cart", () => {
    expect(
      markCartSupersededInput(buildCart(), {
        supersededByCartId: "cart_02",
        supersededAt: "2026-06-27T12:00:00.000Z",
      })
    ).toEqual({
      id: "cart_01",
      metadata: {
        active_for_checkout: false,
        superseded_by_cart_id: "cart_02",
        superseded_at: "2026-06-27T12:00:00.000Z",
      },
    })
  })
})

describe("assertNoPaymentOrOrderFields", () => {
  it("permite contrato estritamente pre-Order", () => {
    expect(() => assertNoPaymentOrOrderFields(buildCart())).not.toThrow()
  })

  it("falha se o contrato expuser entidades de payment ou order", () => {
    expect(() =>
      assertNoPaymentOrOrderFields(
        buildCart({
          order_id: "order_01",
        })
      )
    ).toThrow("ACTIVE_CART_PREORDER_ONLY")

    expect(() =>
      assertNoPaymentOrOrderFields(
        buildCart({
          payment_collection: {
            id: "paycol_01",
          },
        })
      )
    ).toThrow("ACTIVE_CART_PREORDER_ONLY")
  })
})
