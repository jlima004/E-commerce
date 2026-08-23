import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"
import GuestCartCapabilityModule from "../modules/guest-cart-capability"

export default defineLink(CartModule.linkable.cart, {
  linkable: GuestCartCapabilityModule.linkable.guestCartCapability,
  isList: true,
})
