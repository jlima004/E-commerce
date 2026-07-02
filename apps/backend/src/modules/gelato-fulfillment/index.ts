import { Module } from "@medusajs/framework/utils"
import GelatoFulfillmentModuleService from "./service"

export const GELATO_FULFILLMENT_MODULE = "gelato-fulfillment"

export default Module(GELATO_FULFILLMENT_MODULE, {
  service: GelatoFulfillmentModuleService,
})
