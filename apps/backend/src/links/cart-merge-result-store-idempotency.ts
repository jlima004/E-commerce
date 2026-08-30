import { defineLink } from "@medusajs/framework/utils"
import CartMergeModule from "../modules/cart-merge"
import StoreIdempotencyModule from "../modules/store-idempotency"
import {
  cartMergeForeignLinkable,
  type CartMergeLinkableSource,
} from "../modules/cart-merge/linkable"

export default defineLink(
  cartMergeForeignLinkable(
    CartMergeModule.linkable.cartMergeResult as unknown as Record<
      string,
      CartMergeLinkableSource
    >,
    "idempotency_record_id",
    "idempotency_merge_result"
  ),
  {
    linkable: {
      ...StoreIdempotencyModule.linkable.storeIdempotencyRecord.toJSON(),
      alias: "store_idempotency",
    },
  }
)
