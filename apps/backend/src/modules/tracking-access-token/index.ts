import { Module } from "@medusajs/framework/utils"
import TrackingAccessTokenModuleService from "./service"

export const TRACKING_ACCESS_TOKEN_MODULE = "tracking_access_token"

export default Module(TRACKING_ACCESS_TOKEN_MODULE, {
  service: TrackingAccessTokenModuleService,
})
