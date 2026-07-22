import { Module } from "@medusajs/framework/utils"
import OperationalAlertModuleService from "./service"

export const OPERATIONAL_ALERT_MODULE = "operational_alert"

export { OperationalAlertModuleService }
export type {
  ListSafeInput,
  OperationalAlertMetadata,
  OperationalAlertSafe,
  UpsertAlertInput,
} from "./service"

export default Module(OPERATIONAL_ALERT_MODULE, {
  service: OperationalAlertModuleService,
})
