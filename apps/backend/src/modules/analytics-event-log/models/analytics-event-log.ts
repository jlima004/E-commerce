import { model } from "@medusajs/framework/utils"
import {
  ANALYTICS_EVENT_NAME,
  ANALYTICS_EVENT_STATUSES,
  ANALYTICS_EVENT_VERSION,
} from "../types"

const AnalyticsEventLog = model
  .define("analytics_event_log", {
    id: model.id({ prefix: "anlevt" }).primaryKey(),
    event_name: model
      .enum([ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED])
      .default(ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED),
    event_version: model.number().default(ANALYTICS_EVENT_VERSION),
    idempotency_key: model.text(),
    order_id: model.text(),
    cart_id: model.text(),
    payment_attempt_id: model.text(),
    checkout_completion_log_id: model.text(),
    payment_intent_id: model.text(),
    status: model
      .enum(ANALYTICS_EVENT_STATUSES)
      .default("recorded"),
    payload: model.json(),
    metadata: model.json().nullable(),
    attempt_count: model.number().default(0),
    last_error_code: model.text().nullable(),
    last_error_message: model.text().nullable(),
    next_retry_at: model.dateTime().nullable(),
    recorded_at: model.dateTime(),
    queued_at: model.dateTime().nullable(),
    sending_started_at: model.dateTime().nullable(),
    sent_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    dead_lettered_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_analytics_event_log_name_idempotency_key",
      on: ["event_name", "idempotency_key"],
      unique: true,
    },
    {
      name: "IDX_analytics_event_log_name_order_id",
      on: ["event_name", "order_id"],
      unique: true,
    },
    {
      name: "IDX_analytics_event_log_status_next_retry_at",
      on: ["status", "next_retry_at"],
    },
    {
      name: "IDX_analytics_event_log_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_analytics_event_log_payment_attempt_id",
      on: ["payment_attempt_id"],
    },
    {
      name: "IDX_analytics_event_log_checkout_completion_log_id",
      on: ["checkout_completion_log_id"],
    },
    {
      name: "IDX_analytics_event_log_payment_intent_id",
      on: ["payment_intent_id"],
    },
  ])

export default AnalyticsEventLog
