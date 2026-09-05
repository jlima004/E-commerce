import {
  CanonicalCartMoneyError,
  resolveCanonicalCartPaymentAmount,
} from "../canonical-cart-money"

describe("resolveCanonicalCartPaymentAmount", () => {
  describe("cenarios positivos A-E", () => {
    it("A: deriva S=10000 a partir de cart.total 100 em BRL", () => {
      const snapshot = resolveCanonicalCartPaymentAmount({
        total: 100,
        currency_code: "brl",
      })

      expect(snapshot.amount_major).toBe(100)
      expect(snapshot.amount_minor).toBe(10000)
      expect(snapshot.currency_code).toBe("brl")
    })

    it("B: usa cart.total 115 (S=11500) e nao o subtotal do line item 100", () => {
      const cart = {
        total: 115,
        currency_code: "brl",
        shipping_total: 15,
        items: [{ unit_price: 100, quantity: 1 }],
      }
      const snapshot = resolveCanonicalCartPaymentAmount(cart)

      expect(snapshot.amount_major).toBe(115)
      expect(snapshot.amount_minor).toBe(11500)
      expect(snapshot.amount_minor).not.toBe(10000)
    })

    it("C: usa cart.total 90 (S=9000) e nao o line item 100 apos desconto", () => {
      const cart = {
        total: 90,
        currency_code: "brl",
        discount_total: 10,
        items: [{ unit_price: 100, quantity: 1 }],
      }
      const snapshot = resolveCanonicalCartPaymentAmount(cart)

      expect(snapshot.amount_major).toBe(90)
      expect(snapshot.amount_minor).toBe(9000)
      expect(snapshot.amount_minor).not.toBe(10000)
    })

    it("D: usa cart.total 108 (S=10800) e nao o line item 100 apos imposto", () => {
      const cart = {
        total: 108,
        currency_code: "brl",
        tax_total: 8,
        items: [{ unit_price: 100, quantity: 1 }],
      }
      const snapshot = resolveCanonicalCartPaymentAmount(cart)

      expect(snapshot.amount_major).toBe(108)
      expect(snapshot.amount_minor).toBe(10800)
      expect(snapshot.amount_minor).not.toBe(10000)
    })

    it("E: usa cart.total 110 (S=11000) no cenario combinado e nao 10000", () => {
      const cart = {
        total: 110,
        currency_code: "brl",
        shipping_total: 15,
        discount_total: 10,
        tax_total: 5,
        items: [{ unit_price: 100, quantity: 1 }],
      }
      const snapshot = resolveCanonicalCartPaymentAmount(cart)

      expect(snapshot.amount_major).toBe(110)
      expect(snapshot.amount_minor).toBe(11000)
      expect(snapshot.amount_minor).not.toBe(10000)
    })

    it("F: usa cart.total 90 (S=9000) no cenario com credito e nao 10000 nem 11000", () => {
      const cart = {
        total: 90,
        currency_code: "brl",
        shipping_total: 15,
        discount_total: 10,
        tax_total: 5,
        credit_total: 20,
        items: [{ unit_price: 100, quantity: 1 }],
      }
      const snapshot = resolveCanonicalCartPaymentAmount(cart)

      expect(snapshot.amount_major).toBe(90)
      expect(snapshot.amount_minor).toBe(9000)
      expect(snapshot.amount_minor).not.toBe(10000)
      expect(snapshot.amount_minor).not.toBe(11000)
    })

    it("normaliza currency_code BRL para brl", () => {
      const snapshot = resolveCanonicalCartPaymentAmount({
        total: 100,
        currency_code: "BRL",
      })

      expect(snapshot.currency_code).toBe("brl")
      expect(snapshot.amount_minor).toBe(10000)
    })
  })

  describe("rejeicao fail-closed", () => {
    it("rejeita cart.total ausente", () => {
      expect(() =>
        resolveCanonicalCartPaymentAmount({
          currency_code: "brl",
        })
      ).toThrow(CanonicalCartMoneyError)

      expect(() =>
        resolveCanonicalCartPaymentAmount({
          currency_code: "brl",
        })
      ).toThrow("CANONICAL_CART_TOTAL_MISSING")
    })

    it("rejeita cart.total nulo", () => {
      expect(() =>
        resolveCanonicalCartPaymentAmount({
          total: null,
          currency_code: "brl",
        })
      ).toThrow("CANONICAL_CART_TOTAL_MISSING")
    })

    it.each([
      [0, "CANONICAL_CART_TOTAL_INVALID"],
      [-1, "CANONICAL_CART_TOTAL_INVALID"],
      [99.999, "CANONICAL_CART_TOTAL_INVALID"],
      [NaN, "CANONICAL_CART_TOTAL_INVALID"],
      [Infinity, "CANONICAL_CART_TOTAL_INVALID"],
      ["90071992547409.92", "CANONICAL_CART_TOTAL_INVALID"],
    ])("rejeita cart.total invalido %p", (total, code) => {
      expect(() =>
        resolveCanonicalCartPaymentAmount({
          total,
          currency_code: "brl",
        })
      ).toThrow(code)
    })

    it("rejeita currency_code ausente", () => {
      expect(() =>
        resolveCanonicalCartPaymentAmount({
          total: 100,
        })
      ).toThrow("CANONICAL_CART_CURRENCY_INVALID")
    })

    it("rejeita currency_code diferente de BRL", () => {
      expect(() =>
        resolveCanonicalCartPaymentAmount({
          total: 100,
          currency_code: "usd",
        })
      ).toThrow("CANONICAL_CART_CURRENCY_INVALID")
    })

    it("nao reconstrói S a partir de line items, shipping, tax ou discount", () => {
      const cart = {
        total: undefined,
        currency_code: "brl",
        shipping_total: 15,
        tax_total: 5,
        discount_total: 10,
        items: [
          { unit_price: 50, quantity: 2 },
          { unit_price: 100, quantity: 1 },
        ],
      }

      expect(() => resolveCanonicalCartPaymentAmount(cart)).toThrow(
        "CANONICAL_CART_TOTAL_MISSING"
      )
    })

    it("nao reconstrói S a partir de line items, shipping, tax, discount ou credit", () => {
      const cart = {
        total: undefined,
        currency_code: "brl",
        shipping_total: 15,
        tax_total: 5,
        discount_total: 10,
        credit_total: 20,
        items: [{ unit_price: 100, quantity: 1 }],
      }

      expect(() => resolveCanonicalCartPaymentAmount(cart)).toThrow(
        "CANONICAL_CART_TOTAL_MISSING"
      )
    })
  })
})
