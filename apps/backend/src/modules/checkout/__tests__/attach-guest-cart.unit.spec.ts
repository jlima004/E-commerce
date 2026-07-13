import type { CheckoutCartLike } from "../active-cart"
import {
  buildAttachGuestCartDecision,
  resolveCurrentSessionGuestCart,
  shouldTransferGuestCart,
} from "../attach-guest-cart"

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
    id: "cart_guest_01",
    currency_code: "brl",
    email: "guest@exemplo.com",
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

describe("resolveCurrentSessionGuestCart", () => {
  it("rejeita cart_id isolado no body quando nao coincide com a sessao atual", () => {
    expect(
      resolveCurrentSessionGuestCart({
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        requestedCartId: "cart_guest_999",
        guestCart: buildCart(),
      })
    ).toEqual({
      status: "reject_unauthorized_guest_cart",
      reason: "requested_cart_not_in_session",
    })
  })

  it("aceita apenas o guest cart provado pela sessao atual", () => {
    expect(
      resolveCurrentSessionGuestCart({
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        requestedCartId: "cart_guest_01",
        guestCart: buildCart(),
      })
    ).toEqual({
      status: "authorized",
      guestCart: buildCart(),
    })
  })
})

describe("shouldTransferGuestCart", () => {
  it("transfere apenas guest cart nao vazio e utilizavel no checkout", () => {
    expect(shouldTransferGuestCart(buildCart())).toBe(true)
    expect(
      shouldTransferGuestCart(
        buildCart({
          items: [],
        })
      )
    ).toBe(false)
  })
})

describe("buildAttachGuestCartDecision", () => {
  it("transfere o guest cart da sessao atual e normaliza o email final para customer.email", () => {
    expect(
      buildAttachGuestCartDecision({
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        guestCart: buildCart(),
        customerCart: buildCart({
          id: "cart_customer_01",
          email: "antigo@exemplo.com",
        }),
      })
    ).toEqual({
      action: "transfer",
      guestCartId: "cart_guest_01",
      normalizedEmail: "cliente@exemplo.com",
      supersedeCustomerCartId: "cart_customer_01",
    })
  })

  it("preserva o cart util do customer quando nao houver guest cart na sessao atual", () => {
    expect(
      buildAttachGuestCartDecision({
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        session: {
          id: "sess_01",
        },
        customerCart: buildCart({
          id: "cart_customer_01",
        }),
      })
    ).toEqual({
      action: "preserve_customer_cart",
      reason: "missing_session_guest_cart",
      customerCartId: "cart_customer_01",
      normalizedEmail: "cliente@exemplo.com",
    })
  })

  it("preserva o cart util do customer quando o guest cart estiver vazio", () => {
    expect(
      buildAttachGuestCartDecision({
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        guestCart: buildCart({
          items: [],
        }),
        customerCart: buildCart({
          id: "cart_customer_01",
        }),
      })
    ).toEqual({
      action: "preserve_customer_cart",
      reason: "guest_cart_empty_or_not_usable",
      customerCartId: "cart_customer_01",
      normalizedEmail: "cliente@exemplo.com",
    })
  })

  it("preserva o cart do customer quando o guest cart provado nao e encontrado", () => {
    expect(
      buildAttachGuestCartDecision({
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        guestCart: null,
        customerCart: buildCart({
          id: "cart_customer_01",
        }),
      })
    ).toEqual({
      action: "preserve_customer_cart",
      reason: "guest_cart_not_found",
      customerCartId: "cart_customer_01",
      normalizedEmail: "cliente@exemplo.com",
    })
  })

  it("rejeita attach saneadamente quando o cart pedido nao pertence a sessao atual", () => {
    expect(
      buildAttachGuestCartDecision({
        customer: {
          id: "cus_123",
          email: "cliente@exemplo.com",
        },
        session: {
          id: "sess_01",
          active_cart_id: "cart_guest_01",
        },
        requestedCartId: "cart_guest_999",
        guestCart: buildCart(),
        customerCart: buildCart({
          id: "cart_customer_01",
        }),
      })
    ).toEqual({
      action: "reject_unauthorized_guest_cart",
      reason: "requested_cart_not_in_session",
    })
  })
})
