import { model } from "@medusajs/framework/utils"

export const OPERATIONAL_ALERT_TYPES = [
  "payment_stuck",
  "fulfillment_failed",
] as const
export const OPERATIONAL_ALERT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const
export const OPERATIONAL_ALERT_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "ignored",
] as const
export const OPERATIONAL_ALERT_ENTITY_TYPES = [
  "payment_attempt",
  "fulfillment",
] as const

export type OperationalAlertType = (typeof OPERATIONAL_ALERT_TYPES)[number]
export type OperationalAlertSeverity =
  (typeof OPERATIONAL_ALERT_SEVERITIES)[number]
export type OperationalAlertStatus = (typeof OPERATIONAL_ALERT_STATUSES)[number]
export type OperationalAlertEntityType =
  (typeof OPERATIONAL_ALERT_ENTITY_TYPES)[number]

const OperationalAlert = model
  .define("operational_alert", {
    id: model.id({ prefix: "opalert" }).primaryKey(),
    type: model.enum([...OPERATIONAL_ALERT_TYPES]),
    severity: model.enum([...OPERATIONAL_ALERT_SEVERITIES]),
    status: model.enum([...OPERATIONAL_ALERT_STATUSES]).default("open"),
    entity_type: model.enum([...OPERATIONAL_ALERT_ENTITY_TYPES]),
    entity_id: model.text(),
    message_code: model.text(),
    message: model.text(),
    error_code: model.text().nullable(),
    metadata: model.json().nullable(),
    first_seen_at: model.dateTime(),
    last_seen_at: model.dateTime(),
    occurrence_count: model.number().default(1),
    acknowledged_at: model.dateTime().nullable(),
    acknowledged_by: model.text().nullable(),
    resolved_at: model.dateTime().nullable(),
    resolved_by: model.text().nullable(),
    ignored_at: model.dateTime().nullable(),
    ignored_by: model.text().nullable(),
  })
  .indexes([
    {
      name: "UQ_operational_alert_logical_key",
      on: ["type", "entity_type", "entity_id"],
      unique: true,
    },
    {
      name: "IDX_operational_alert_status_severity",
      on: ["status", "severity"],
    },
    {
      name: "IDX_operational_alert_entity",
      on: ["entity_type", "entity_id"],
    },
    {
      name: "IDX_operational_alert_type_last_seen",
      on: ["type", "last_seen_at"],
    },
    {
      name: "IDX_operational_alert_last_seen_id",
      on: ["last_seen_at", "id"],
    },
  ])

export default OperationalAlert
