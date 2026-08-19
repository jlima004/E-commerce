import { createHash, createHmac, hkdfSync } from "node:crypto"
import { generateEntityId } from "@medusajs/framework/utils"
import type { CapabilityKeyring } from "./security/capabilities"

export type TransactionalKnexLike = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

export const AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE = 25 as const
export const AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS = 6 as const
export const AUTH_NOTIFICATION_OUTBOX_LEASE_MS = 120_000 as const // 2 minutes

export const AUTH_NOTIFICATION_OUTBOX_BACKOFF_SCHEDULE_MS = [
  1 * 60 * 1000, // 1m (60,000 ms)
  5 * 60 * 1000, // 5m (300,000 ms)
  30 * 60 * 1000, // 30m (1,800,000 ms)
  2 * 60 * 60 * 1000, // 2h (7,200,000 ms)
  6 * 60 * 60 * 1000, // 6h (21,600,000 ms)
  12 * 60 * 60 * 1000, // 12h (43,200,000 ms)
] as const

export const AUTH_NOTIFICATION_TEMPLATES = [
  "email_verification_v1",
  "password_reset_v1",
] as const
export type AuthNotificationTemplate =
  (typeof AUTH_NOTIFICATION_TEMPLATES)[number]

export const AUTH_NOTIFICATION_INTENT_TYPES = [
  "verification",
  "reset",
] as const
export type AuthNotificationIntentType =
  (typeof AUTH_NOTIFICATION_INTENT_TYPES)[number]

export const AUTH_NOTIFICATION_OUTBOX_STATUSES = [
  "recorded",
  "claimed",
  "sent",
  "failed",
  "dead_letter",
] as const
export type AuthNotificationOutboxStatus =
  (typeof AUTH_NOTIFICATION_OUTBOX_STATUSES)[number]

export const AUTH_NOTIFICATION_FAILURE_REASONS = [
  "provider_transient",
  "provider_permanent",
  "recipient_missing",
  "recipient_mismatch",
] as const
export type AuthNotificationFailureReason =
  (typeof AUTH_NOTIFICATION_FAILURE_REASONS)[number]

export type AuthNotificationOutboxRecord = {
  id: string
  template: AuthNotificationTemplate
  intent_type: AuthNotificationIntentType
  intent_id: string
  generation: number
  idempotency_key: string
  status: AuthNotificationOutboxStatus
  recipient_identity_id: string
  recipient_hash: string
  recipient_domain: string
  key_version: number
  version: number
  lease_owner: string | null
  lease_until: Date | null
  attempt_count: number
  next_retry_at: Date | null
  failure_reason: AuthNotificationFailureReason | null
  provider_message_id: string | null
  recorded_at: Date
  claimed_at: Date | null
  sent_at: Date | null
  failed_at: Date | null
  dead_lettered_at: Date | null
  schema_version: number
  created_at?: Date
  updated_at?: Date
  deleted_at?: Date | null
}

export type RecordAuthNotificationOutboxInput = {
  id?: string
  template: AuthNotificationTemplate
  intentType: AuthNotificationIntentType
  intentId: string
  generation?: number
  recipientIdentityId: string
  recipientHash: string
  recipientDomain: string
  keyVersion: number
  recordedAt?: Date
  idempotencyKey?: string
}

export function formatAuthNotificationIdempotencyKey(
  template: string,
  intentId: string,
  generation: number
): string {
  if (
    !AUTH_NOTIFICATION_TEMPLATES.includes(
      template as AuthNotificationTemplate
    )
  ) {
    throw new Error("AUTH_NOTIFICATION_TEMPLATE_INVALID")
  }
  if (!intentId || typeof intentId !== "string" || intentId.trim() === "") {
    throw new Error("AUTH_NOTIFICATION_INTENT_ID_INVALID")
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error("AUTH_NOTIFICATION_GENERATION_INVALID")
  }
  const key = `auth/${template}/${intentId}/g${generation}`
  if (key.length > 256) {
    throw new Error("AUTH_NOTIFICATION_IDEMPOTENCY_KEY_TOO_LONG")
  }
  return key
}

const FORBIDDEN_SENSITIVE_SUBSTRINGS = [
  "token",
  "capability",
  "password",
  "secret",
  "privatekey",
  "rawkey",
  "email",
  "rawpayload",
]

const FORBIDDEN_EXACT_KEYS = new Set([
  "code",
  "otp",
  "verificationcode",
  "authcode",
  "payload",
])

export function assertNoSensitiveOutboxPayload(data: unknown): void {
  if (!data || typeof data !== "object") {
    return
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      assertNoSensitiveOutboxPayload(item)
    }
    return
  }
  for (const [key, value] of Object.entries(
    data as Record<string, unknown>
  )) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, "")
    const isExactForbidden = FORBIDDEN_EXACT_KEYS.has(normalizedKey)
    const isSubstringForbidden = FORBIDDEN_SENSITIVE_SUBSTRINGS.some((sub) =>
      normalizedKey.includes(sub)
    )
    if (isExactForbidden || isSubstringForbidden) {
      throw new Error(
        `SENSITIVE_OUTBOX_PAYLOAD_REJECTED: field '${key}' is forbidden`
      )
    }
    if (typeof value === "string") {
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) {
        throw new Error(
          "SENSITIVE_OUTBOX_PAYLOAD_REJECTED: plaintext email detected"
        )
      }
    }
    if (value && typeof value === "object") {
      assertNoSensitiveOutboxPayload(value)
    }
  }
}

export function deriveCustomerAuthRecipientHash(input: {
  keyring: CapabilityKeyring
  keyVersion?: number
  purpose: "verification" | "reset" | string
  normalizedEmail: string
  recipientIdentityId?: string
}): string {
  const keyVersion = input.keyVersion ?? input.keyring.active.version
  const key = [input.keyring.active, ...input.keyring.previous].find(
    (k) => k.version === keyVersion
  )
  if (!key) {
    throw new Error("Customer auth capability key version unavailable")
  }
  const domain = [
    "customer-auth-recipient",
    "v1",
    input.purpose,
    `key-version:${keyVersion}`,
    `email:${input.normalizedEmail}`,
    input.recipientIdentityId
      ? `identity:${input.recipientIdentityId}`
      : undefined,
  ]
    .filter(Boolean)
    .join("|")

  const derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(key.secret, "utf8"),
      Buffer.alloc(0),
      Buffer.from(
        `customer-auth-recipient-key:${keyVersion}:${input.purpose}`,
        "utf8"
      ),
      32
    )
  )
  return createHmac("sha256", derivedKey).update(domain, "utf8").digest("hex")
}

export function computeAuthNotificationBackoff(
  attemptCount: number,
  failedAt: Date
): {
  nextRetryAt: Date | null
  status: "failed" | "dead_letter"
  isDeadLetter: boolean
} {
  if (attemptCount >= AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS) {
    return {
      nextRetryAt: null,
      status: "dead_letter",
      isDeadLetter: true,
    }
  }
  const scheduleIndex = Math.min(
    attemptCount - 1,
    AUTH_NOTIFICATION_OUTBOX_BACKOFF_SCHEDULE_MS.length - 1
  )
  const delayMs = AUTH_NOTIFICATION_OUTBOX_BACKOFF_SCHEDULE_MS[scheduleIndex]
  return {
    nextRetryAt: new Date(failedAt.getTime() + delayMs),
    status: "failed",
    isDeadLetter: false,
  }
}

export function validateProviderMessageId(providerMessageId: string): string {
  const trimmed = providerMessageId?.trim()
  if (
    !trimmed ||
    trimmed.length < 1 ||
    trimmed.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(trimmed)
  ) {
    throw new Error("AUTH_NOTIFICATION_PROVIDER_MESSAGE_ID_INVALID")
  }
  return trimmed
}

export function buildNotificationOutboxRecordRow(
  input: RecordAuthNotificationOutboxInput
): Record<string, unknown> {
  if (
    (input.template === "email_verification_v1" &&
      input.intentType !== "verification") ||
    (input.template === "password_reset_v1" && input.intentType !== "reset")
  ) {
    throw new Error("AUTH_NOTIFICATION_TEMPLATE_INTENT_MISMATCH")
  }

  if (
    !input.recipientIdentityId ||
    typeof input.recipientIdentityId !== "string"
  ) {
    throw new Error("AUTH_NOTIFICATION_RECIPIENT_IDENTITY_ID_INVALID")
  }
  if (!input.recipientHash || typeof input.recipientHash !== "string") {
    throw new Error("AUTH_NOTIFICATION_RECIPIENT_HASH_INVALID")
  }
  if (
    !input.recipientDomain ||
    input.recipientDomain.length < 1 ||
    input.recipientDomain.length > 253
  ) {
    throw new Error("AUTH_NOTIFICATION_RECIPIENT_DOMAIN_INVALID")
  }
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("AUTH_NOTIFICATION_KEY_VERSION_INVALID")
  }

  const generation = input.generation ?? 0
  const recordedAt = input.recordedAt ?? new Date()
  const idempotencyKey =
    input.idempotencyKey ??
    formatAuthNotificationIdempotencyKey(
      input.template,
      input.intentId,
      generation
    )

  return {
    id: input.id,
    template: input.template,
    intent_type: input.intentType,
    intent_id: input.intentId,
    generation,
    idempotency_key: idempotencyKey,
    status: "recorded",
    recipient_identity_id: input.recipientIdentityId,
    recipient_hash: input.recipientHash,
    recipient_domain: input.recipientDomain,
    key_version: input.keyVersion,
    version: 1,
    lease_owner: null,
    lease_until: null,
    attempt_count: 0,
    next_retry_at: null,
    failure_reason: null,
    provider_message_id: null,
    recorded_at: recordedAt,
    claimed_at: null,
    sent_at: null,
    failed_at: null,
    dead_lettered_at: null,
    schema_version: 1,
  }
}

export async function recordNotificationOutboxInTransaction(
  knex: TransactionalKnexLike,
  input: RecordAuthNotificationOutboxInput
): Promise<AuthNotificationOutboxRecord> {
  const row = buildNotificationOutboxRecordRow(input)
  assertNoSensitiveOutboxPayload(row)

  const id =
    (row.id as string | undefined) ?? generateEntityId(undefined, "authout")
  const recordedAt =
    row.recorded_at instanceof Date
      ? row.recorded_at
      : new Date(String(row.recorded_at))

  const result = await knex.raw(
    `insert into auth_notification_outbox (
      id, template, intent_type, intent_id, generation, idempotency_key,
      status, recipient_identity_id, recipient_hash, recipient_domain,
      key_version, version, lease_owner, lease_until, attempt_count,
      next_retry_at, failure_reason, provider_message_id, recorded_at,
      claimed_at, sent_at, failed_at, dead_lettered_at, schema_version
    ) values (
      ?, ?, ?, ?, ?, ?,
      'recorded', ?, ?, ?,
      ?, 1, null, null, 0,
      null, null, null, ?,
      null, null, null, null, ?
    )
    returning *`,
    [
      id,
      row.template,
      row.intent_type,
      row.intent_id,
      row.generation,
      row.idempotency_key,
      row.recipient_identity_id,
      row.recipient_hash,
      row.recipient_domain,
      row.key_version,
      recordedAt.toISOString(),
      row.schema_version ?? 1,
    ]
  )

  const inserted = result.rows?.[0]
  if (!inserted) {
    throw new Error("AUTH_NOTIFICATION_OUTBOX_INSERT_FAILED")
  }

  return {
    id: String(inserted.id),
    template: inserted.template as AuthNotificationTemplate,
    intent_type: inserted.intent_type as AuthNotificationIntentType,
    intent_id: String(inserted.intent_id),
    generation: Number(inserted.generation),
    idempotency_key: String(inserted.idempotency_key),
    status: inserted.status as AuthNotificationOutboxStatus,
    recipient_identity_id: String(inserted.recipient_identity_id),
    recipient_hash: String(inserted.recipient_hash),
    recipient_domain: String(inserted.recipient_domain),
    key_version: Number(inserted.key_version),
    version: Number(inserted.version),
    lease_owner:
      inserted.lease_owner === null || inserted.lease_owner === undefined
        ? null
        : String(inserted.lease_owner),
    lease_until: inserted.lease_until
      ? new Date(String(inserted.lease_until))
      : null,
    attempt_count: Number(inserted.attempt_count),
    next_retry_at: inserted.next_retry_at
      ? new Date(String(inserted.next_retry_at))
      : null,
    failure_reason:
      (inserted.failure_reason as AuthNotificationFailureReason | null) ?? null,
    provider_message_id:
      inserted.provider_message_id === null ||
      inserted.provider_message_id === undefined
        ? null
        : String(inserted.provider_message_id),
    recorded_at: new Date(String(inserted.recorded_at)),
    claimed_at: inserted.claimed_at
      ? new Date(String(inserted.claimed_at))
      : null,
    sent_at: inserted.sent_at ? new Date(String(inserted.sent_at)) : null,
    failed_at: inserted.failed_at
      ? new Date(String(inserted.failed_at))
      : null,
    dead_lettered_at: inserted.dead_lettered_at
      ? new Date(String(inserted.dead_lettered_at))
      : null,
    schema_version: Number(inserted.schema_version),
    created_at: inserted.created_at
      ? new Date(String(inserted.created_at))
      : undefined,
    updated_at: inserted.updated_at
      ? new Date(String(inserted.updated_at))
      : undefined,
    deleted_at: inserted.deleted_at
      ? new Date(String(inserted.deleted_at))
      : null,
  }
}
