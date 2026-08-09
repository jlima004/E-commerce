import { Module } from "@medusajs/framework/utils"
import StoreResourceVersionModuleService from "./service"

export const STORE_RESOURCE_VERSION_MODULE = "store_resource_version"

export {
  STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED,
  STORE_RESOURCE_VERSION_WRITE_FORBIDDEN,
  StoreResourceVersionModuleService,
} from "./service"
export type {
  StoreResourceVersionCasResult,
  StoreResourceVersionMutationContext,
  StoreResourceVersionRow,
} from "./service"

export default Module(STORE_RESOURCE_VERSION_MODULE, {
  service: StoreResourceVersionModuleService,
})
