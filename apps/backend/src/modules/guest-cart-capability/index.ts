import { Module } from "@medusajs/framework/utils"
import GuestCartCapabilityModuleService from "./service"
import { GUEST_CART_CAPABILITY_MODULE } from "./types"

export { GUEST_CART_CAPABILITY_MODULE } from "./types"
export { GuestCartCapabilityModuleService } from "./service"
export * from "./types"
export * from "./hash"
export * from "./service"
export * from "./lookup"

export default Module(GUEST_CART_CAPABILITY_MODULE, {
  service: GuestCartCapabilityModuleService,
})
