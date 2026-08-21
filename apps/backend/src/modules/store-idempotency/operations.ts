export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD =
  "store.carts.line-items.add" as const

export const STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE =
  "store.carts.line-items.update" as const

export type StoreCartLineItemIdempotencyOperation =
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD
  | typeof STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE
