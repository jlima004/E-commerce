import { Module } from "@medusajs/framework/utils"
import ExchangeRequestModuleService from "./service"

export const EXCHANGE_REQUEST_MODULE = "exchange_request"

export default Module(EXCHANGE_REQUEST_MODULE, {
  service: ExchangeRequestModuleService,
})
