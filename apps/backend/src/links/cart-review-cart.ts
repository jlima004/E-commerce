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
      CartMergeModule.linkable.cartReview as unknown as Record<
        string,
        CartMergeLinkableSource
      >,
      "cart_id",
      "cart_review"
    ),
    isList: true,
  },
  {
    linkable: {
      ...CartModule.linkable.cart.toJSON(),
      alias: "review_cart",
    },
  }
)
