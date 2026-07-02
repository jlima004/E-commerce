import { model } from "@medusajs/framework/utils"
import { GELATO_FULFILLMENT_STATUSES } from "../types"

const GelatoFulfillment = model
  .define("gelato_fulfillment", {
    id: model.id({ prefix: "gelful" }).primaryKey(),
    order_id: model.text(),
    cart_id: model.text(),
    payment_attempt_id: model.text(),
    checkout_completion_log_id: model.text(),
    analytics_event_log_id: model.text(),
    email_delivery_log_id: model.text(),
    idempotency_key: model.text(),
    order_reference_id: model.text(),
    customer_reference_id: model.text().nullable(),
    status: model.enum(GELATO_FULFILLMENT_STATUSES).default("recorded"),
    gelato_primary_order_id: model.text().nullable(),
    connected_order_ids: model.json(),
    request_hash: model.text(),
    request_summary: model.json(),
    response_summary: model.json().nullable(),
    tracking_summary: model.json().nullable(),
    metadata: model.json().nullable(),
    attempt_count: model.number().default(0),
    last_error_code: model.text().nullable(),
    last_error_message: model.text().nullable(),
    next_retry_at: model.dateTime().nullable(),
    requires_operator_attention: model.boolean().default(false),
    operator_alert_code: model.text().nullable(),
    operator_alert_message: model.text().nullable(),
    operator_alerted_at: model.dateTime().nullable(),
    recorded_at: model.dateTime(),
    queued_at: model.dateTime().nullable(),
    dispatching_started_at: model.dateTime().nullable(),
    submitted_at: model.dateTime().nullable(),
    accepted_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    dead_lettered_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_gelato_fulfillment_order_id_unique",
      on: ["order_id"],
      unique: true,
    },
    {
      name: "IDX_gelato_fulfillment_idempotency_key_unique",
      on: ["idempotency_key"],
      unique: true,
    },
    {
      name: "IDX_gelato_fulfillment_status_next_retry_at",
      on: ["status", "next_retry_at"],
    },
    {
      name: "IDX_gelato_fulfillment_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_gelato_fulfillment_analytics_event_log_id",
      on: ["analytics_event_log_id"],
    },
    {
      name: "IDX_gelato_fulfillment_email_delivery_log_id",
      on: ["email_delivery_log_id"],
    },
    {
      name: "IDX_gelato_fulfillment_payment_attempt_id",
      on: ["payment_attempt_id"],
    },
    {
      name: "IDX_gelato_fulfillment_checkout_completion_log_id",
      on: ["checkout_completion_log_id"],
    },
  ])

export default GelatoFulfillment
