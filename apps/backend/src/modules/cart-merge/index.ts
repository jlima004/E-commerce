import { Module } from "@medusajs/framework/utils"
import CartMergeModuleService from "./service"
import { CART_MERGE_MODULE } from "./module-id"

export { CART_MERGE_MODULE } from "./module-id"

export { CartMergeModuleService } from "./service"

export default Module(CART_MERGE_MODULE, {
  service: CartMergeModuleService,
})
