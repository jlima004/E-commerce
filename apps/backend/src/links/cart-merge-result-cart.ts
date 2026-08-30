import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"
import CartMergeModule from "../modules/cart-merge"
import {
  cartMergeForeignLinkable,
  type CartMergeLinkableSource,
} from "../modules/cart-merge/linkable"

const cartMergeResultLinkables =
  CartMergeModule.linkable.cartMergeResult as unknown as Record<
    string,
    CartMergeLinkableSource
  >

// A merge receipt can retain the guest, customer and canonical cart IDs. Each
// role gets its own link definition so the association remains queryable
// without turning a receipt's cross-module references into foreign keys.
export default defineLink(
  {
    linkable: cartMergeForeignLinkable(
      cartMergeResultLinkables,
      "guest_cart_id",
      "guest_cart_merge_result"
    ),
    isList: true,
  },
  {
    linkable: {
      ...CartModule.linkable.cart.toJSON(),
      alias: "guest_cart",
    },
  }
)
