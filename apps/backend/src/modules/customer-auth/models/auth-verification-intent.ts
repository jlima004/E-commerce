import { model } from "@medusajs/framework/utils"
import { CUSTOMER_AUTH_SCHEMA_VERSION } from "../types"

const AUTH_VERIFICATION_INTENT_STATUSES = [
  "pending",
  "claimed",
  "confirmed",
  "superseded",
  "expired",
  "dead_letter",
] as const

const AuthVerificationIntent = model
  .define("auth_verification_intent", {
    id: model.id({ prefix: "authver" }).primaryKey(),
    auth_identity_id: model.text(),
    token_hash: model.text(),
    nonce: model.text(),
    key_version: model.number(),
    generation: model.number().default(0),
    status: model
      .enum([...AUTH_VERIFICATION_INTENT_STATUSES])
      .default("pending"),
    version: model.number().default(1),
    expires_at: model.dateTime(),
    claimed_at: model.dateTime().nullable(),
    confirmed_at: model.dateTime().nullable(),
    superseded_at: model.dateTime().nullable(),
    expired_at: model.dateTime().nullable(),
    dead_lettered_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_verification_intent_token_hash",
      on: ["token_hash"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_verification_intent_identity_generation",
      on: ["auth_identity_id", "generation"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_verification_intent_active_identity",
      on: ["auth_identity_id"],
      unique: true,
      where:
        "status IN ('pending', 'claimed') AND deleted_at IS NULL",
    },
    {
      name: "IDX_auth_verification_intent_status_expires_at",
      on: ["status", "expires_at"],
    },
  ])
  .checks([
    {
      name: "auth_verification_intent_versions_valid",
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
      name: "auth_verification_intent_exact_ttl",
      expression: (columns) =>
        columns.expires_at +
        " = " +
        columns.created_at +
        " + INTERVAL '30 minutes'",
    },
    {
      name: "auth_verification_intent_state_markers",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'pending' AND " +
        columns.claimed_at +
        " IS NULL AND " +
        columns.confirmed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'claimed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.confirmed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'confirmed' AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.confirmed_at +
        " IS NOT NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'superseded' AND " +
        columns.confirmed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NOT NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'expired' AND " +
        columns.confirmed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NOT NULL AND " +
        columns.dead_lettered_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'dead_letter' AND " +
        columns.confirmed_at +
        " IS NULL AND " +
        columns.superseded_at +
        " IS NULL AND " +
        columns.expired_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NOT NULL))",
    },
  ])

export default AuthVerificationIntent
