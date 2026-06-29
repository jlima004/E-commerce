import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"
import PaymentAttemptModule from "../modules/payment-attempt"

export default defineLink(CartModule.linkable.cart, {
  linkable: PaymentAttemptModule.linkable.paymentAttempt,
  isList: true,
})
