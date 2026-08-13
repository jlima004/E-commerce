import { model } from "@medusajs/framework/utils"
import { CUSTOMER_AUTH_SCHEMA_VERSION } from "../types"

const AUTH_NOTIFICATION_TEMPLATES = [
  "email_verification_v1",
  "password_reset_v1",
] as const

const AUTH_NOTIFICATION_INTENT_TYPES = ["verification", "reset"] as const

const AUTH_NOTIFICATION_OUTBOX_STATUSES = [
  "recorded",
  "claimed",
  "sent",
  "failed",
  "dead_letter",
] as const

const AUTH_NOTIFICATION_FAILURE_REASONS = [
  "provider_transient",
  "provider_permanent",
  "recipient_missing",
  "recipient_mismatch",
] as const

const AuthNotificationOutbox = model
  .define("auth_notification_outbox", {
    id: model.id({ prefix: "authout" }).primaryKey(),
    template: model.enum([...AUTH_NOTIFICATION_TEMPLATES]),
    intent_type: model.enum([...AUTH_NOTIFICATION_INTENT_TYPES]),
    intent_id: model.text(),
    generation: model.number().default(0),
    idempotency_key: model.text(),
    status: model
      .enum([...AUTH_NOTIFICATION_OUTBOX_STATUSES])
      .default("recorded"),
    recipient_identity_id: model.text(),
    recipient_hash: model.text(),
    recipient_domain: model.text(),
    key_version: model.number(),
    version: model.number().default(1),
    lease_owner: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    attempt_count: model.number().default(0),
    next_retry_at: model.dateTime().nullable(),
    failure_reason: model
      .enum([...AUTH_NOTIFICATION_FAILURE_REASONS])
      .nullable(),
    provider_message_id: model.text().nullable(),
    recorded_at: model.dateTime(),
    claimed_at: model.dateTime().nullable(),
    sent_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    dead_lettered_at: model.dateTime().nullable(),
    schema_version: model.number().default(CUSTOMER_AUTH_SCHEMA_VERSION),
  })
  .indexes([
    {
      name: "UQ_auth_notification_outbox_idempotency_key",
      on: ["idempotency_key"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_notification_outbox_intent_generation_template",
      on: ["intent_id", "generation", "template"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_auth_notification_outbox_provider_message_id",
      on: ["provider_message_id"],
      unique: true,
      where: "provider_message_id IS NOT NULL AND deleted_at IS NULL",
    },
    {
      name: "IDX_auth_notification_outbox_status_next_retry_at",
      on: ["status", "next_retry_at"],
    },
    {
      name: "IDX_auth_notification_outbox_lease_until",
      on: ["lease_until"],
    },
    {
      name: "IDX_auth_notification_outbox_intent_generation",
      on: ["intent_id", "generation"],
    },
  ])
  .checks([
    {
      name: "auth_notification_outbox_versions_valid",
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
      name: "auth_notification_outbox_attempt_count_valid",
      expression: (columns) =>
        columns.attempt_count +
        " >= 0 AND " +
        columns.attempt_count +
        " <= 6",
    },
    {
      name: "auth_notification_outbox_lease_pair",
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
      name: "auth_notification_outbox_lease_window",
      expression: (columns) =>
        columns.lease_until +
        " IS NULL OR " +
        columns.lease_until +
        " = " +
        columns.claimed_at +
        " + INTERVAL '2 minutes'",
    },
    {
      name: "auth_notification_outbox_idempotency_shape",
      expression: (columns) =>
        columns.idempotency_key +
        " LIKE 'auth/%' AND char_length(" +
        columns.idempotency_key +
        ") <= 256",
    },
    {
      name: "auth_notification_outbox_template_intent_match",
      expression: (columns) =>
        "((" +
        columns.template +
        " = 'email_verification_v1' AND " +
        columns.intent_type +
        " = 'verification') OR (" +
        columns.template +
        " = 'password_reset_v1' AND " +
        columns.intent_type +
        " = 'reset'))",
    },
    {
      name: "auth_notification_outbox_provider_message_id_sanitized",
      expression: (columns) =>
        columns.provider_message_id +
        " IS NULL OR (char_length(" +
        columns.provider_message_id +
        ") BETWEEN 1 AND 256 AND " +
        columns.provider_message_id +
        " ~ '^[A-Za-z0-9._:-]+$')",
    },
    {
      name: "auth_notification_outbox_recipient_evidence",
      expression: (columns) =>
        "char_length(" +
        columns.recipient_identity_id +
        ") > 0 AND char_length(" +
        columns.recipient_hash +
        ") > 0 AND char_length(" +
        columns.recipient_domain +
        ") BETWEEN 1 AND 253",
    },
    {
      name: "auth_notification_outbox_state_markers",
      expression: (columns) =>
        "((" +
        columns.status +
        " = 'recorded' AND " +
        columns.recorded_at +
        " IS NOT NULL AND " +
        columns.claimed_at +
        " IS NULL AND " +
        columns.sent_at +
        " IS NULL AND " +
        columns.failed_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL AND " +
        columns.failure_reason +
        " IS NULL AND " +
        columns.provider_message_id +
        " IS NULL) OR (" +
        columns.status +
        " = 'claimed' AND " +
        columns.recorded_at +
        " IS NOT NULL AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.lease_owner +
        " IS NOT NULL AND " +
        columns.lease_until +
        " IS NOT NULL AND " +
        columns.sent_at +
        " IS NULL AND " +
        columns.failed_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL AND " +
        columns.failure_reason +
        " IS NULL AND " +
        columns.provider_message_id +
        " IS NULL) OR (" +
        columns.status +
        " = 'sent' AND " +
        columns.recorded_at +
        " IS NOT NULL AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.sent_at +
        " IS NOT NULL AND " +
        columns.failed_at +
        " IS NULL AND " +
        columns.dead_lettered_at +
        " IS NULL AND " +
        columns.failure_reason +
        " IS NULL AND " +
        columns.provider_message_id +
        " IS NOT NULL AND " +
        columns.lease_owner +
        " IS NULL AND " +
        columns.lease_until +
        " IS NULL AND " +
        columns.next_retry_at +
        " IS NULL) OR (" +
        columns.status +
        " = 'failed' AND " +
        columns.recorded_at +
        " IS NOT NULL AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.failed_at +
        " IS NOT NULL AND " +
        columns.dead_lettered_at +
        " IS NULL AND " +
        columns.failure_reason +
        " IS NOT NULL AND " +
        columns.lease_owner +
        " IS NULL AND " +
        columns.lease_until +
        " IS NULL AND " +
        columns.next_retry_at +
        " IS NOT NULL) OR (" +
        columns.status +
        " = 'dead_letter' AND " +
        columns.recorded_at +
        " IS NOT NULL AND " +
        columns.claimed_at +
        " IS NOT NULL AND " +
        columns.dead_lettered_at +
        " IS NOT NULL AND " +
        columns.failure_reason +
        " IS NOT NULL AND " +
        columns.lease_owner +
        " IS NULL AND " +
        columns.lease_until +
        " IS NULL AND " +
        columns.next_retry_at +
        " IS NULL))",
    },
  ])

export default AuthNotificationOutbox
