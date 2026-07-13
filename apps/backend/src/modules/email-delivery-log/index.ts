import { Module } from "@medusajs/framework/utils"
import EmailDeliveryLogModuleService from "./service"

export const EMAIL_DELIVERY_LOG_MODULE = "email_delivery_log"

export default Module(EMAIL_DELIVERY_LOG_MODULE, {
  service: EmailDeliveryLogModuleService,
})
