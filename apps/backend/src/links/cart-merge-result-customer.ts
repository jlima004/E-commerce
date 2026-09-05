import { defineLink } from "@medusajs/framework/utils"
import CustomerModule from "@medusajs/medusa/customer"
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
      "customer_id",
      "customer_merge_result"
    ),
    isList: true,
  },
  {
    linkable: {
      ...CustomerModule.linkable.customer.toJSON(),
      alias: "merge_customer",
    },
  }
)
