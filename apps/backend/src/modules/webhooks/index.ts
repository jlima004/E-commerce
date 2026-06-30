import WebhookModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const WEBHOOKS_MODULE = "webhooks"

export default Module(WEBHOOKS_MODULE, {
  service: WebhookModuleService,
})
