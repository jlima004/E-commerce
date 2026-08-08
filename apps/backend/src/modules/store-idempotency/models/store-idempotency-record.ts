import { model } from "@medusajs/framework/utils"

export const STORE_IDEMPOTENCY_STATES = [
  "processing",
  "completed",
  "failed_retryable",
  "failed_terminal",
  "reconciliation_required",
  "reconciliation_unresolved",
] as const

export type StoreIdempotencyState = (typeof STORE_IDEMPOTENCY_STATES)[number]

export const STORE_IDEMPOTENCY_HASH_VERSION = "hmac-sha256-v1" as const
export const STORE_IDEMPOTENCY_PEPPER_VERSION = 1 as const

export const STORE_IDEMPOTENCY_TERMINAL_STATES = [
  "completed",
  "failed_terminal",
  "reconciliation_unresolved",
] as const

export type StoreIdempotencyTerminalState =
  (typeof STORE_IDEMPOTENCY_TERMINAL_STATES)[number]

const StoreIdempotencyRecord = model
  .define("store_idempotency_record", {
    id: model.id({ prefix: "stidem" }).primaryKey(),
    operation: model.text(),
    actor_scope_hash: model.text(),
    resource_scope_hash: model.text(),
    idempotency_key_hash: model.text(),
    hash_version: model.text().default(STORE_IDEMPOTENCY_HASH_VERSION),
    pepper_version: model.number().default(STORE_IDEMPOTENCY_PEPPER_VERSION),
    request_fingerprint: model.text(),
    state: model.enum([...STORE_IDEMPOTENCY_STATES]).default("processing"),
    state_version: model.number().default(1),
    result_type: model.text().nullable(),
    result_id: model.text().nullable(),
    response_status: model.number().nullable(),
    result_safe_metadata: model.json().nullable(),
    locked_at: model.dateTime().nullable(),
    state_deadline_at: model.dateTime().nullable(),
    next_retry_at: model.dateTime().nullable(),
    retry_attempt_count: model.number().default(0),
    retry_started_at: model.dateTime().nullable(),
    terminalized_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),
    failure_code: model.text().nullable(),
    expires_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "UQ_store_idempotency_record_claim_scope",
      on: [
        "operation",
        "actor_scope_hash",
        "resource_scope_hash",
        "idempotency_key_hash",
      ],
      unique: true,
    },
    {
      name: "IDX_store_idempotency_record_state_deadline",
      on: ["state", "state_deadline_at"],
    },
    {
      name: "IDX_store_idempotency_record_next_retry_at",
      on: ["next_retry_at"],
    },
    {
      name: "IDX_store_idempotency_record_expires_at",
      on: ["expires_at"],
    },
  ])

export default StoreIdempotencyRecord
