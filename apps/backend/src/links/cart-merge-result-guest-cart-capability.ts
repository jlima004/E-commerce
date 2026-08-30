import { defineLink } from "@medusajs/framework/utils"
import CartMergeModule from "../modules/cart-merge"
import GuestCartCapabilityModule from "../modules/guest-cart-capability"
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
    "capability_id",
    "capability_merge_result"
  ),
  {
    linkable: {
      ...GuestCartCapabilityModule.linkable.guestCartCapability.toJSON(),
      alias: "guest_capability",
    },
  }
)
