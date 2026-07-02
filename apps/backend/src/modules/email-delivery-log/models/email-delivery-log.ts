import { model } from "@medusajs/framework/utils"
import {
  EMAIL_DELIVERY_LOG_EMAIL_TYPE,
  EMAIL_DELIVERY_LOG_PROVIDER,
  EMAIL_DELIVERY_LOG_STATUSES,
  EMAIL_DELIVERY_LOG_TEMPLATE_KEY,
  EMAIL_DELIVERY_LOG_TEMPLATE_VERSION,
} from "../types"

const EmailDeliveryLog = model
  .define("email_delivery_log", {
    id: model.id({ prefix: "emlog" }).primaryKey(),
    email_type: model
      .enum([EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION])
      .default(EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION),
    template_key: model
      .enum([EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1])
      .default(EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1),
    template_version: model.number().default(EMAIL_DELIVERY_LOG_TEMPLATE_VERSION),
    provider: model
      .enum([EMAIL_DELIVERY_LOG_PROVIDER.RESEND])
      .default(EMAIL_DELIVERY_LOG_PROVIDER.RESEND),
    idempotency_key: model.text(),
    order_id: model.text(),
    cart_id: model.text(),
    payment_attempt_id: model.text(),
    checkout_completion_log_id: model.text(),
    analytics_event_log_id: model.text(),
    payment_intent_id: model.text(),
    status: model
      .enum(EMAIL_DELIVERY_LOG_STATUSES)
      .default("recorded"),
    recipient_email_hash: model.text(),
    recipient_email_domain: model.text(),
    payload: model.json(),
    metadata: model.json().nullable(),
    provider_message_id: model.text().nullable(),
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
      name: "IDX_email_delivery_log_type_idempotency_key",
      on: ["email_type", "idempotency_key"],
      unique: true,
    },
    {
      name: "IDX_email_delivery_log_type_order_id",
      on: ["email_type", "order_id"],
      unique: true,
    },
    {
      name: "IDX_email_delivery_log_status_next_retry_at",
      on: ["status", "next_retry_at"],
    },
    {
      name: "IDX_email_delivery_log_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_email_delivery_log_analytics_event_log_id",
      on: ["analytics_event_log_id"],
    },
    {
      name: "IDX_email_delivery_log_payment_attempt_id",
      on: ["payment_attempt_id"],
    },
    {
      name: "IDX_email_delivery_log_checkout_completion_log_id",
      on: ["checkout_completion_log_id"],
    },
    {
      name: "IDX_email_delivery_log_payment_intent_id",
      on: ["payment_intent_id"],
    },
  ])

export default EmailDeliveryLog
