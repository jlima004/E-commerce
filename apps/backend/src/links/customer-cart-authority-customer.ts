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
      CartMergeModule.linkable.customerCartAuthority as unknown as Record<
        string,
        CartMergeLinkableSource
      >,
      "customer_id",
      "customer_cart_authority"
    ),
    isList: true,
  },
  {
    linkable: {
      ...CustomerModule.linkable.customer.toJSON(),
      alias: "authority_customer",
    },
  }
)
