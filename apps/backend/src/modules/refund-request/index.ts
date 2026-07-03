import { Module } from "@medusajs/framework/utils"
import RefundRequestModuleService from "./service"

export const REFUND_REQUEST_MODULE = "refund_request"

export default Module(REFUND_REQUEST_MODULE, {
  service: RefundRequestModuleService,
})
