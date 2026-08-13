import { model } from "@medusajs/framework/utils"
import {
  AUTH_SESSION_LINEAGE_STATUSES,
  AUTH_SESSION_REVOCATION_REASONS,
  CUSTOMER_AUTH_SCHEMA_VERSION,
} from "../types"

const AuthSessionLineage = model
  .define("auth_session_lineage", {
    id: model.id({ prefix: "authlin" }).primaryKey(),
    sid: model.text(),
    auth_identity_id: model.text(),
    customer_id: model.text(),
    credential_version_snapshot: model.number(),
    status: model.enum([...AUTH_SESSION_LINEAGE_STATUSES]).default("active"),
    version: model.number().default(1),
    original_authenticated_at: model.dateTime(),
    absolute_expires_at: model.dateTime(),
    revoked_at: model.dateTime().nullable(),
    revocation_reason: model
      .enum([...AUTH_SESSION_REVOCATION_REASONS])
      .nullable(),
    expired_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_session_lineage_sid",
      on: ["sid"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_auth_session_lineage_identity_status",
      on: ["auth_identity_id", "status"],
    },
    {
      name: "IDX_auth_session_lineage_customer_status",
      on: ["customer_id", "status"],
    },
    {
      name: "IDX_auth_session_lineage_absolute_expires_at",
      on: ["absolute_expires_at"],
    },
  ])
  .checks([
    {
      name: "auth_session_lineage_versions_positive",
      expression: (columns) =>
        columns.version +
        " >= 1 AND " +
        columns.credential_version_snapshot +
        " >= 1 AND " +
        columns.schema_version +
        " >= 1",
    },
    {
      name: "auth_session_lineage_absolute_deadline",
      expression: (columns) =>
        columns.absolute_expires_at +
        " = " +
        columns.original_authenticated_at +
        " + INTERVAL '30 days'",
    },
    {
      name: "auth_session_lineage_revocation_state",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'revoked' AND " +
        columns.revoked_at +
        " IS NOT NULL AND " +
        columns.revocation_reason +
        " IS NOT NULL) OR (" +
        columns.status +
        " <> 'revoked' AND " +
        columns.revoked_at +
        " IS NULL AND " +
        columns.revocation_reason +
        " IS NULL))",
    },
    {
      name: "auth_session_lineage_expiry_state",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'expired' AND " +
        columns.expired_at +
        " IS NOT NULL) OR (" +
        columns.status +
        " <> 'expired' AND " +
        columns.expired_at +
        " IS NULL))",
    },
  ])

export default AuthSessionLineage

