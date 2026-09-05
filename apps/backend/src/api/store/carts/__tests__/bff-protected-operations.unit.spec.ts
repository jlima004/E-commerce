import {
  STORE_CART_BFF_PROTECTED_OPERATIONS,
  type StoreCartBffProtectedOperation,
} from "../bff-protected-operations"
import {
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
} from "../../../../modules/customer-auth/bff-service-auth"

describe("STORE_CART_BFF_PROTECTED_OPERATIONS", () => {
  it("tem exatamente as 8 operacoes fechadas de cart P15-D03 + Phase 16 merge/ACK", () => {
    expect(STORE_CART_BFF_PROTECTED_OPERATIONS).toHaveLength(8)
    expect(STORE_CART_BFF_PROTECTED_OPERATIONS).toEqual([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/:id/line-items",
      "POST /store/carts/:id/line-items/:line_id",
      "DELETE /store/carts/:id/line-items/:line_id",
      "DELETE /store/carts/:id/line-items",
      "POST /store/customers/me/cart/merge",
      "POST /store/carts/:id/review/acknowledge",
    ])
  })

  it("mantem CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS intacto com 12 operacoes e sem rotas de cart", () => {
    expect(CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS).toHaveLength(12)
    const cartOpsInAuth = CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS.filter((op) =>
      op.includes("/store/carts")
    )
    expect(cartOpsInAuth).toHaveLength(0)
  })

  it("garante que nao ha intersecao entre operacoes de auth e cart", () => {
    const authSet = new Set<string>(CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS)
    for (const cartOp of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      expect(authSet.has(cartOp)).toBe(false)
    }
  })

  it("garante que todas as entradas possuem formato 'METHOD /path'", () => {
    for (const op of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const parts = op.split(" ")
      expect(parts).toHaveLength(2)
      expect(["GET", "POST", "DELETE"]).toContain(parts[0])
      expect(parts[1].startsWith("/store/")).toBe(true)
    }
  })
})
