import { model } from "@medusajs/framework/utils"
import {
  AUTH_REFRESH_CREDENTIAL_STATUSES,
  CUSTOMER_AUTH_SCHEMA_VERSION,
} from "../types"

const AuthRefreshCredential = model
  .define("auth_refresh_credential", {
    id: model.id({ prefix: "authref" }).primaryKey(),
    lineage_id: model.text(),
    token_hash: model.text(),
    generation: model.number().default(0),
    status: model.enum([...AUTH_REFRESH_CREDENTIAL_STATUSES]).default("active"),
    replacement_id: model.text().nullable(),
    request_key_hash: model.text().nullable(),
    nonce: model.text(),
    key_version: model.number(),
    expires_at: model.dateTime(),
    consumed_at: model.dateTime().nullable(),
    recovery_until: model.dateTime().nullable(),
    replacement_used_at: model.dateTime().nullable(),
    replayed_at: model.dateTime().nullable(),
    revoked_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_refresh_credential_token_hash",
      on: ["token_hash"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_refresh_credential_lineage_generation",
      on: ["lineage_id", "generation"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_refresh_credential_active_lineage",
      on: ["lineage_id"],
      unique: true,
      where: "status = 'active' AND deleted_at IS NULL",
    },
    {
      name: "IDX_auth_refresh_credential_status_expires_at",
      on: ["status", "expires_at"],
    },
  ])
  .checks([
    {
      name: "auth_refresh_credential_generation_valid",
      expression: (columns) =>
        columns.generation +
        " >= 0 AND " +
        columns.key_version +
        " >= 1 AND " +
        columns.schema_version +
        " >= 1",
    },
    {
      name: "auth_refresh_credential_expiry_after_creation",
      expression: (columns) => columns.expires_at + " > " + columns.created_at,
    },
    {
      name: "auth_refresh_credential_inactivity_window",
      expression: (columns) =>
        columns.expires_at +
        " <= " +
        columns.created_at +
        " + INTERVAL '7 days'",
    },
    {
      name: "auth_refresh_credential_consumed_recovery",
      expression: (columns) =>
        "((" +
        columns.status +
        " IN ('consumed', 'replayed') AND " +
        columns.consumed_at +
        " IS NOT NULL AND " +
        columns.replacement_id +
        " IS NOT NULL AND " +
        columns.request_key_hash +
        " IS NOT NULL AND " +
        columns.recovery_until +
        " = " +
        columns.consumed_at +
        " + INTERVAL '45 seconds') OR (" +
        columns.status +
        " NOT IN ('consumed', 'replayed') AND " +
        columns.consumed_at +
        " IS NULL AND " +
        columns.replacement_id +
        " IS NULL AND " +
        columns.request_key_hash +
        " IS NULL AND " +
        columns.recovery_until +
        " IS NULL))",
    },
    {
      name: "auth_refresh_credential_replacement_usage",
      expression: (columns) =>
        columns.replacement_used_at +
        " IS NULL OR " +
        columns.consumed_at +
        " IS NOT NULL",
    },
    {
      name: "auth_refresh_credential_replayed_state",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'replayed' AND " +
        columns.replayed_at +
        " IS NOT NULL) OR (" +
        columns.status +
        " <> 'replayed' AND " +
        columns.replayed_at +
        " IS NULL))",
    },
    {
      name: "auth_refresh_credential_revoked_state",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'revoked' AND " +
        columns.revoked_at +
        " IS NOT NULL) OR (" +
        columns.status +
        " <> 'revoked' AND " +
        columns.revoked_at +
        " IS NULL))",
    },
  ])

export default AuthRefreshCredential

