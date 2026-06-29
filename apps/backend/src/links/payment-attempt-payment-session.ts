import { defineLink } from "@medusajs/framework/utils"
import PaymentModule from "@medusajs/medusa/payment"
import PaymentAttemptModule from "../modules/payment-attempt"

export default defineLink(
  PaymentAttemptModule.linkable.paymentAttempt,
  PaymentModule.linkable.paymentSession
)
