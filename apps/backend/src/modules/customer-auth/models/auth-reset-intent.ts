import { model } from "@medusajs/framework/utils"
import { CUSTOMER_AUTH_SCHEMA_VERSION } from "../types"

const AUTH_RESET_INTENT_STATUSES = [
  "pending",
  "claimed",
  "credential_updated",
  "revocation_committed",
  "completed",
  "superseded",
  "expired",
  "failed_reconcilable",
] as const

const AuthResetIntent = model
  .define("auth_reset_intent", {
    id: model.id({ prefix: "authrst" }).primaryKey(),
    auth_identity_id: model.text(),
    token_hash: model.text(),
    nonce: model.text(),
    key_version: model.number(),
    generation: model.number().default(0),
    status: model.enum([...AUTH_RESET_INTENT_STATUSES]).default("pending"),
    version: model.number().default(1),
    operation_id: model.text().nullable(),
    lease_owner: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    attempt_count: model.number().default(0),
    next_retry_at: model.dateTime().nullable(),
    expires_at: model.dateTime(),
    claimed_at: model.dateTime().nullable(),
    provider_proved_at: model.dateTime().nullable(),
    credential_updated_at: model.dateTime().nullable(),
    revocation_committed_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),
    superseded_at: model.dateTime().nullable(),
    expired_at: model.dateTime().nullable(),
    failed_reconcilable_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_reset_intent_token_hash",
      on: ["token_hash"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_reset_intent_identity_generation",
      on: ["auth_identity_id", "generation"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_reset_intent_operation_id",
      on: ["operation_id"],
      unique: true,
      where: "operation_id IS NOT NULL AND deleted_at IS NULL",
    },
    {
      name: "UQ_auth_reset_intent_active_identity",
      on: ["auth_identity_id"],
      unique: true,
      where:
        "status IN ('pending', 'claimed', 'credential_updated') AND deleted_at IS NULL",
    },
    {
      name: "IDX_auth_reset_intent_status_expires_at",
      on: ["status", "expires_at"],
    },
    {
      name: "IDX_auth_reset_intent_status_next_retry_at",
      on: ["status", "next_retry_at"],
    },
    {
      name: "IDX_auth_reset_intent_lease_until",
      on: ["lease_until"],
    },
  ])
  .checks([
    {
      name: "auth_reset_intent_versions_valid",
      expression: (columns) =>
        columns.generation +
        " >= 0 AND " +
        columns.version +
        " >= 1 AND " +
        columns.key_version +
        " >= 1 AND " +
        columns.schema_version +
        " >= 1",
    },
    {
      name: "auth_reset_intent_attempt_count_valid",
      expression: (columns) => columns.attempt_count + " >= 0",
    },
    {
      name: "auth_reset_intent_exact_ttl",
      expression: (columns) =>
        columns.expires_at +
        " = " +
        columns.created_at +
        " + INTERVAL '15 minutes'",
    },
    {
      name: "auth_reset_intent_lease_pair",
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
      name: "auth_reset_intent_operation_binding",
      expression: (columns) =>
        "((" +
        columns.status +
        " IN ('pending', 'superseded', 'expired') AND " +
        columns.operation_id +
        " IS NULL) OR (" +
        columns.status +
        " NOT IN ('pending', 'superseded', 'expired') AND " +
        columns.operation_id +
        " IS NOT NULL))",
    },
    {
      name: "auth_reset_intent_update_after_provider_proof",
      expression: (columns) =>
        columns.credential_updated_at +
        " IS NULL OR " +
        columns.provider_proved_at +
        " IS NOT NULL",
    },
    {
      name: "auth_reset_intent_revocation_after_update",
      expression: (columns) =>
        columns.revocation_committed_at +
        " IS NULL OR " +
        columns.credential_updated_at +
        " IS NOT NULL",
    },
    {
      name: "auth_reset_intent_completion_order",
      expression: (columns) =>
        columns.completed_at +
        " IS NULL OR (" +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NOT NULL AND " +
        columns.revocation_committed_at +
        " IS NOT NULL)",
    },
    {
      name: "auth_reset_intent_completed_status",
      expression: (columns) =>
        "(" +
        columns.status +
        " <> 'completed' OR " +
        columns.completed_at +
        " IS NOT NULL) AND (" +
        columns.completed_at +
        " IS NULL OR " +
        columns.status +
        " = 'completed')",
    },
    {
      name: "auth_reset_intent_state_markers",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'pending' AND " +
        columns.claimed_at +
        " IS NULL AND " +
        columns.provider_proved_at +
        " IS NULL AND " +
        columns.credential_updated_at +
        " IS NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'claimed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NULL AND " +
        columns.credential_updated_at +
        " IS NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'claimed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'credential_updated' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NOT NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'revocation_committed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NOT NULL AND " +
        columns.revocation_committed_at +
        " IS NOT NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'completed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.provider_proved_at +
        " IS NOT NULL AND " +
        columns.credential_updated_at +
        " IS NOT NULL AND " +
        columns.revocation_committed_at +
        " IS NOT NULL AND " +
        columns.completed_at +
        " IS NOT NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'superseded' AND " +
        columns.claimed_at +
        " IS NULL AND " +
        columns.provider_proved_at +
        " IS NULL AND " +
        columns.credential_updated_at +
        " IS NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NOT NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'expired' AND " +
        columns.claimed_at +
        " IS NULL AND " +
        columns.provider_proved_at +
        " IS NULL AND " +
        columns.credential_updated_at +
        " IS NULL AND " +
        columns.revocation_committed_at +
        " IS NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NOT NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.failed_reconcilable_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'failed_reconcilable' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.failed_reconcilable_at +
        " IS NOT NULL AND " +
        columns.completed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL))",
    },
  ])

export default AuthResetIntent
