import AnalyticsEventLogModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const ANALYTICS_EVENT_LOG_MODULE = "analytics-event-log"

export default Module(ANALYTICS_EVENT_LOG_MODULE, {
  service: AnalyticsEventLogModuleService,
})
