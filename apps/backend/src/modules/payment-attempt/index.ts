import PaymentAttemptModuleService from "./service"
import { Module } from "@medusajs/framework/utils"
import stripeRealInitiationLoader from "./loaders/stripe-real-initiation"

export const PAYMENT_ATTEMPT_MODULE = "paymentAttempt"

export default Module(PAYMENT_ATTEMPT_MODULE, {
  service: PaymentAttemptModuleService,
  loaders: [stripeRealInitiationLoader],
})
