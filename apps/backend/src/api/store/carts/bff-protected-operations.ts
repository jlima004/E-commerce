/**
 * Exact Phase 15 Store Cart BFF→Medusa contracts protected by the service credential.
 * Sibling closed tuple to Phase 14 CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS.
 * This list is closed: do not derive authorization from prefix matching.
 */
export const STORE_CART_BFF_PROTECTED_OPERATIONS = [
  "GET /store/carts/active",
  "POST /store/carts/active",
  "POST /store/carts/:id/line-items",
  "POST /store/carts/:id/line-items/:line_id",
  "DELETE /store/carts/:id/line-items/:line_id",
  "DELETE /store/carts/:id/line-items",
] as const

export type StoreCartBffProtectedOperation =
  (typeof STORE_CART_BFF_PROTECTED_OPERATIONS)[number]
