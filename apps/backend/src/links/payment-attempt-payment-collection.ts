import { defineLink } from "@medusajs/framework/utils"
import PaymentModule from "@medusajs/medusa/payment"
import PaymentAttemptModule from "../modules/payment-attempt"

export default defineLink(PaymentModule.linkable.paymentCollection, {
  linkable: PaymentAttemptModule.linkable.paymentAttempt,
  isList: true,
})
