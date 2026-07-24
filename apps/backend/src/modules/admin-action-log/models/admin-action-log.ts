import { model } from "@medusajs/framework/utils"

export const ADMIN_ACTION_AUDIT_STAGES = [
  "intent",
  "outcome",
  "reconciliation",
] as const

export const ADMIN_ACTION_RESULTS = [
  "requested",
  "succeeded",
  "failed",
  "blocked",
] as const

export const ADMIN_ACTION_SEVERITIES = ["info", "warning", "critical"] as const

export const ADMIN_ACTIONS = [
  "refund_order",
  "update_exchange",
  "reject_exchange",
  "cancel_exchange",
] as const

export const ADMIN_ACTION_ENTITY_TYPES = [
  "refund_request",
  "exchange_request",
] as const

export type AdminActionAuditStage = (typeof ADMIN_ACTION_AUDIT_STAGES)[number]
export type AdminActionResult = (typeof ADMIN_ACTION_RESULTS)[number]
export type AdminActionSeverity = (typeof ADMIN_ACTION_SEVERITIES)[number]
export type AdminAction = (typeof ADMIN_ACTIONS)[number]
export type AdminActionEntityType = (typeof ADMIN_ACTION_ENTITY_TYPES)[number]

const AdminActionLog = model
  .define("admin_action_log", {
    id: model.id({ prefix: "admact" }).primaryKey(),
    action_attempt_id: model.text(),
    correlation_id: model.text(),
    audit_stage: model.enum([...ADMIN_ACTION_AUDIT_STAGES]),
    admin_id: model.text(),
    admin_email: model.text().nullable(),
    action: model.enum([...ADMIN_ACTIONS]),
    entity_type: model.enum([...ADMIN_ACTION_ENTITY_TYPES]),
    entity_id: model.text(),
    result: model.enum([...ADMIN_ACTION_RESULTS]),
    severity: model.enum([...ADMIN_ACTION_SEVERITIES]).default("info"),
    reason: model.text().nullable(),
    previous_state: model.json().nullable(),
    new_state: model.json().nullable(),
    metadata: model.json().nullable(),
    idempotency_key: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_admin_action_log_actor_created",
      on: ["admin_id", "created_at"],
    },
    {
      name: "IDX_admin_action_log_entity_created",
      on: ["entity_type", "entity_id", "created_at"],
    },
    {
      name: "IDX_admin_action_log_attempt_created",
      on: ["action_attempt_id", "created_at"],
    },
    {
      name: "IDX_admin_action_log_correlation_created",
      on: ["correlation_id", "created_at"],
    },
  ])

export default AdminActionLog
