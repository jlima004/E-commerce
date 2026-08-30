import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"
import CartMergeModule from "../modules/cart-merge"
import {
  cartMergeForeignLinkable,
  type CartMergeLinkableSource,
} from "../modules/cart-merge/linkable"

export default defineLink(
  {
    linkable: cartMergeForeignLinkable(
      CartMergeModule.linkable.cartMergeResult as unknown as Record<
        string,
        CartMergeLinkableSource
      >,
      "customer_cart_id",
      "customer_cart_merge_result"
    ),
    isList: true,
  },
  {
    linkable: {
      ...CartModule.linkable.cart.toJSON(),
      alias: "customer_cart",
    },
  }
)
