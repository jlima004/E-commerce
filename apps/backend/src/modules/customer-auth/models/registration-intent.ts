import { model } from "@medusajs/framework/utils"
import {
  CUSTOMER_AUTH_SCHEMA_VERSION,
  REGISTRATION_INTENT_ACTIVE_STATUSES,
  REGISTRATION_INTENT_STATUSES,
} from "../types"

const activeStatusSql = REGISTRATION_INTENT_ACTIVE_STATUSES.map(
  (status) => "'" + status + "'"
).join(", ")

const RegistrationIntent = model
  .define("registration_intent", {
    id: model.id({ prefix: "regint" }).primaryKey(),
    normalized_email_hash: model.text(),
    semantic_payload_hmac: model.text(),
    payload_key_version: model.number(),
    auth_identity_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    status: model
      .enum([...REGISTRATION_INTENT_STATUSES])
      .default("pending_identity"),
    version: model.number().default(1),
    expires_at: model.dateTime(),
    completed_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_registration_intent_active_email_hash",
      on: ["normalized_email_hash"],
      unique: true,
      where: "status IN (" + activeStatusSql + ") AND deleted_at IS NULL",
    },
    {
      name: "UQ_registration_intent_active_auth_identity_id",
      on: ["auth_identity_id"],
      unique: true,
      where:
        "auth_identity_id IS NOT NULL AND status <> 'expired' AND deleted_at IS NULL",
    },
    {
      name: "UQ_registration_intent_active_customer_id",
      on: ["customer_id"],
      unique: true,
      where:
        "customer_id IS NOT NULL AND status <> 'expired' AND deleted_at IS NULL",
    },
    {
      name: "IDX_registration_intent_status_expires_at",
      on: ["status", "expires_at"],
    },
    {
      name: "IDX_registration_intent_auth_identity_id",
      on: ["auth_identity_id"],
    },
    {
      name: "IDX_registration_intent_customer_id",
      on: ["customer_id"],
    },
  ])
  .checks([
    {
      name: "registration_intent_version_positive",
      expression: (columns) => columns.version + " >= 1",
    },
    {
      name: "registration_intent_key_versions_positive",
      expression: (columns) =>
        columns.payload_key_version +
        " >= 1 AND " +
        columns.schema_version +
        " >= 1",
    },
    {
      name: "registration_intent_expiry_after_creation",
      expression: (columns) => columns.expires_at + " > " + columns.created_at,
    },
    {
      name: "registration_intent_identity_precedes_customer",
      expression: (columns) =>
        columns.customer_id +
        " IS NULL OR " +
        columns.auth_identity_id +
        " IS NOT NULL",
    },
    {
      name: "registration_intent_state_requirements",
      expression: (columns) =>
        "(" +
        columns.status +
        " <> 'pending_identity' OR (" +
        columns.auth_identity_id +
        " IS NULL AND " +
        columns.customer_id +
        " IS NULL)) AND (" +
        columns.status +
        " <> 'pending_customer' OR (" +
        columns.auth_identity_id +
        " IS NOT NULL AND " +
        columns.customer_id +
        " IS NULL))",
    },
    {
      name: "registration_intent_completed_requirements",
      expression: (columns) =>
        "(" +
        columns.status +
        " <> 'completed' OR (" +
        columns.auth_identity_id +
        " IS NOT NULL AND " +
        columns.customer_id +
        " IS NOT NULL AND " +
        columns.completed_at +
        " IS NOT NULL)) AND (" +
        columns.completed_at +
        " IS NULL OR " +
        columns.status +
        " = 'completed')",
    },
  ])

export default RegistrationIntent

