import { model } from "@medusajs/framework/utils"
import {
  TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES_LIST,
  TRACKING_ACCESS_TOKEN_STATUSES,
} from "../types"

const TrackingAccessToken = model
  .define("tracking_access_token", {
    id: model.id({ prefix: "trkacc" }).primaryKey(),
    order_id: model.text(),
    gelato_fulfillment_id: model.text(),
    token_hash: model.text(),
    status: model.enum(TRACKING_ACCESS_TOKEN_STATUSES).default("active"),
    expires_at: model.dateTime(),
    revoked_at: model.dateTime().nullable(),
    last_used_at: model.dateTime().nullable(),
    created_for: model
      .enum(TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES_LIST)
      .default("guest_tracking"),
  })
  .indexes([
    {
      name: "IDX_tracking_access_token_token_hash_unique",
      on: ["token_hash"],
      unique: true,
    },
    {
      name: "IDX_tracking_access_token_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_tracking_access_token_gelato_fulfillment_id",
      on: ["gelato_fulfillment_id"],
    },
    {
      name: "IDX_tracking_access_token_status_expires_at",
      on: ["status", "expires_at"],
    },
  ])

export default TrackingAccessToken
