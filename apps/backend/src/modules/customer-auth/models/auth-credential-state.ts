import { model } from "@medusajs/framework/utils"
import {
  AUTH_CREDENTIAL_OPERATION_STATUSES,
  AUTH_CREDENTIAL_OPERATION_TYPES,
  CUSTOMER_AUTH_SCHEMA_VERSION,
} from "../types"

const AuthCredentialState = model
  .define("auth_credential_state", {
    id: model.id({ prefix: "authcred" }).primaryKey(),
    auth_identity_id: model.text(),
    customer_id: model.text(),
    credential_version: model.number().default(1),
    email_verified_at: model.dateTime().nullable(),
    operation_type: model
      .enum([...AUTH_CREDENTIAL_OPERATION_TYPES])
      .nullable(),
    operation_id: model.text().nullable(),
    operation_status: model
      .enum([...AUTH_CREDENTIAL_OPERATION_STATUSES])
      .default("stable"),
    operation_version: model.number().default(0),
    version: model.number().default(1),
    lease_owner: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    attempt_count: model.number().default(0),
    next_retry_at: model.dateTime().nullable(),
    current_password_verified_at: model.dateTime().nullable(),
    provider_proved_at: model.dateTime().nullable(),
    credential_updated_at: model.dateTime().nullable(),
    revocation_committed_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_credential_state_identity",
      on: ["auth_identity_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_credential_state_operation_id",
      on: ["operation_id"],
      unique: true,
      where: "operation_id IS NOT NULL AND deleted_at IS NULL",
    },
    {
      name: "IDX_auth_credential_state_due_operation",
      on: ["operation_status", "next_retry_at"],
    },
    {
      name: "IDX_auth_credential_state_lease_until",
      on: ["lease_until"],
    },
  ])
  .checks([
    {
      name: "auth_credential_state_versions_valid",
      expression: (columns) =>
        columns.version +
        " >= 1 AND " +
        columns.credential_version +
        " >= 1 AND " +
        columns.operation_version +
        " >= 0 AND " +
        columns.schema_version +
        " >= 1",
    },
    {
      name: "auth_credential_state_attempt_count_valid",
      expression: (columns) => columns.attempt_count + " >= 0",
    },
    {
      name: "auth_credential_state_lease_pair",
      expression: (columns) =>
        "((" +
        columns.lease_owner +
        " IS NULL AND " +
        columns.lease_until +
        " IS NULL) OR (" +
        columns.lease_owner +
        " IS NOT NULL AND " +
        columns.lease_until +
        " IS NOT NULL))",
    },
    {
      name: "auth_credential_state_operation_binding",
      expression: (columns) =>
        "((" +
        columns.operation_status +
        " = 'stable' AND " +
        columns.operation_type +
        " IS NULL AND " +
        columns.operation_id +
        " IS NULL) OR (" +
        columns.operation_status +
        " <> 'stable' AND " +
        columns.operation_type +
        " IS NOT NULL AND " +
        columns.operation_id +
        " IS NOT NULL))",
    },
    {
      name: "auth_credential_state_current_password_proof_scope",
      expression: (columns) =>
        columns.current_password_verified_at +
        " IS NULL OR " +
        columns.operation_type +
        " = 'password_change'",
    },
    {
      name: "auth_credential_state_update_after_provider_proof",
      expression: (columns) =>
        columns.credential_updated_at +
        " IS NULL OR " +
        columns.provider_proved_at +
        " IS NOT NULL",
    },
    {
      name: "auth_credential_state_revocation_after_update",
      expression: (columns) =>
        columns.revocation_committed_at +
        " IS NULL OR " +
        columns.credential_updated_at +
        " IS NOT NULL",
    },
    {
      name: "auth_credential_state_completion_order",
      expression: (columns) =>
        columns.completed_at +
        " IS NULL OR (" +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NOT NULL AND " +
        columns.revocation_committed_at +
        " IS NOT NULL)",
    },
    {
      name: "auth_credential_state_completed_status",
      expression: (columns) =>
        "(" +
        columns.operation_status +
        " <> 'completed' OR " +
        columns.completed_at +
        " IS NOT NULL) AND (" +
        columns.completed_at +
        " IS NULL OR " +
        columns.operation_status +
        " = 'completed')",
    },
  ])

export default AuthCredentialState
