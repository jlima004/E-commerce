export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD =
  "store.carts.line-items.add" as const

export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE =
  "store.carts.line-items.update" as const

export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_DELETE =
  "store.carts.line-items.delete" as const

export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_CLEAR =
  "store.carts.line-items.clear" as const

/** Canonical idempotency operation for the Phase 16 cart merge tracer. */
export const STORE_IDEMPOTENCY_CART_MERGE = "cart_merge" as const

export type StoreCartLineItemIdempotencyOperation =
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_DELETE
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_CLEAR

export type StoreIdempotencyOperation =
  | StoreCartLineItemIdempotencyOperation
  | typeof STORE_IDEMPOTENCY_CART_MERGE
