import CheckoutCompletionModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const CHECKOUT_COMPLETION_MODULE = "checkoutCompletion"

export default Module(CHECKOUT_COMPLETION_MODULE, {
  service: CheckoutCompletionModuleService,
})
