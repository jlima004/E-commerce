import { model } from "@medusajs/framework/utils"
import {
  WEBHOOK_ENTITY_TYPES,
  WEBHOOK_EVENT_LOG_STATUSES,
  WEBHOOK_PROVIDERS,
} from "../types"

const WebhookEventLog = model
  .define("webhook_event_log", {
    id: model.id({ prefix: "whlog" }).primaryKey(),
    provider: model.enum(WEBHOOK_PROVIDERS),
    external_event_id: model.text().nullable(),
    event_type: model.text(),
    entity_type: model.enum(WEBHOOK_ENTITY_TYPES).default("unknown"),
    entity_id: model.text().nullable(),
    payload_hash: model.text(),
    deduplication_key: model.text(),
    status: model
      .enum(WEBHOOK_EVENT_LOG_STATUSES)
      .default("received"),
    processing_attempts: model.number().default(0),
    error_code: model.text().nullable(),
    error_message: model.text().nullable(),
    metadata: model.json().nullable(),
    received_at: model.dateTime(),
    processed_at: model.dateTime().nullable(),
    ignored_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_webhook_event_log_provider_payload_hash",
      on: ["provider", "payload_hash"],
    },
    {
      name: "IDX_webhook_event_log_event_type",
      on: ["event_type"],
    },
    {
      name: "IDX_webhook_event_log_status_received_at",
      on: ["status", "received_at"],
    },
    {
      name: "IDX_webhook_event_log_entity",
      on: ["entity_type", "entity_id"],
    },
  ])

export default WebhookEventLog
