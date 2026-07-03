import { model } from "@medusajs/framework/utils"
import {
  EXCHANGE_REQUEST_REASONS,
  EXCHANGE_REQUEST_STATUSES,
  REVERSE_LOGISTICS_PROVIDERS,
} from "../types"

const ExchangeRequest = model
  .define("exchange_request", {
    id: model.id({ prefix: "excreq" }).primaryKey(),
    order_id: model.text(),
    reason: model.enum(EXCHANGE_REQUEST_REASONS),
    status: model.enum(EXCHANGE_REQUEST_STATUSES).default("opened"),
    affected_items: model.json(),
    customer_visible_note: model.text().nullable(),
    operator_note: model.text().nullable(),
    reverse_logistics_provider: model
      .enum(REVERSE_LOGISTICS_PROVIDERS)
      .nullable(),
    reverse_tracking_code: model.text().nullable(),
    reverse_authorization_code: model.text().nullable(),
    reverse_label_reference: model.text().nullable(),
    return_received_at: model.dateTime().nullable(),
    resolved_at: model.dateTime().nullable(),
    created_by_operator_id: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_exchange_request_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_exchange_request_status",
      on: ["status"],
    },
    {
      name: "IDX_exchange_request_reason",
      on: ["reason"],
    },
  ])

export default ExchangeRequest
