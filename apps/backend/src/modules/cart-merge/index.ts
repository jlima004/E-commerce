import { Module } from "@medusajs/framework/utils"
import CartMergeModuleService from "./service"

export const CART_MERGE_MODULE = "cart_merge"

export { CartMergeModuleService } from "./service"

export default Module(CART_MERGE_MODULE, {
  service: CartMergeModuleService,
})
