import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto"
import { generateEntityId } from "@medusajs/framework/utils"
import {
  isCustomerAuthRecoveryFailClosed,
  type CustomerAuthRecoveryStatus,
} from "../../infrastructure/customer-auth-transaction-compatibility"
import {
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
  type CapabilityKeyring,
} from "./security/capabilities"
import { normalizeCustomerAuthEmail } from "./security/email-normalization"
import {
  deriveCustomerAuthRecipientHash,
  recordNotificationOutboxInTransaction,
  type AuthNotificationOutboxRecord,
} from "./notification-outbox"

export const AUTH_RESET_TTL_MS = 15 * 60 * 1000
export const AUTH_RESET_LEASE_MS = 2 * 60 * 1000
export const AUTH_RESET_RETRY_MS = 60 * 1000
export const AUTH_RESET_FIRST_GENERATION = 1 as const
export const AUTH_RESET_CAPABILITY_MIN_LENGTH = 43 as const
export const AUTH_RESET_CAPABILITY_MAX_LENGTH = 512 as const

export const AUTH_RESET_STATUSES = [
  "pending",
  "claimed",
  "credential_updated",
  "revocation_committed",
  "completed",
  "superseded",
  "expired",
  "failed_reconcilable",
] as const

export type AuthResetStatus = (typeof AUTH_RESET_STATUSES)[number]

export type AuthResetRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type AuthResetTransaction = {
  raw(sql: string, bindings?: unknown[]): Promise<AuthResetRawResult>
}

export type AuthResetDatabase = {
  transaction<T>(
    callback: (transaction: AuthResetTransaction) => Promise<T>
  ): Promise<T>
}

export type AuthResetIdFactory = (prefix: string) => string
export type AuthResetRandomBytes = (size: number) => Buffer

export type AuthResetIntentRecord = {
  id: string
  auth_identity_id: string
  token_hash: string
  nonce: string
  key_version: number
  generation: number
  status: AuthResetStatus
  version: number
  operation_id: string | null
  lease_owner: string | null
  lease_until: Date | null
  attempt_count: number
  next_retry_at: Date | null
  expires_at: Date
  claimed_at: Date | null
  provider_proved_at: Date | null
  credential_updated_at: Date | null
  revocation_committed_at: Date | null
  completed_at: Date | null
  superseded_at: Date | null
  expired_at: Date | null
  failed_reconcilable_at: Date | null
  schema_version: number
  created_at: Date
  updated_at: Date
}

export type AuthResetCredentialRecord = {
  id: string
  auth_identity_id: string
  customer_id: string
  credential_version: number
  email_verified_at: Date | null
  operation_type: string | null
  operation_id: string | null
  operation_status: string
  operation_version: number
  version: number
  lease_owner: string | null
  lease_until: Date | null
  attempt_count: number
  next_retry_at: Date | null
  provider_proved_at: Date | null
  credential_updated_at: Date | null
  revocation_committed_at: Date | null
  completed_at: Date | null
}

export type AuthResetPasswordProvider = {
  updatePassword(input: {
    authIdentityId: string
    password: string
  }): Promise<"updated" | "timeout" | "ambiguous">
  verifyPassword(input: {
    authIdentityId: string
    password: string
  }): Promise<boolean>
}

export type AuthResetRequestInput = {
  authIdentityId: string
  recipientIdentityId?: string
  normalizedEmail: string
  keyring: CapabilityKeyring
  now?: Date
  idFactory?: AuthResetIdFactory
  randomBytesFn?: AuthResetRandomBytes
}

export type AuthResetRequestResult = {
  accepted: true
  created: boolean
  intent: AuthResetIntentRecord | null
  outbox: AuthNotificationOutboxRecord | null
}

export type AuthResetConfirmInput = {
  capability: string
  newPassword: string
  idempotencyKey: string
  keyring: CapabilityKeyring
  provider: AuthResetPasswordProvider
  now?: Date
  leaseOwner?: string
}

export type AuthResetConfirmResult =
  | {
      outcome: "completed"
      intentId: string
      generation: number
      credentialVersion: number
    }
  | {
      outcome: "recovery_pending"
      intentId: string
      generation: number
    }

export type AuthResetErrorCode =
  | "AUTH_RESET_INVALID_REQUEST"
  | "AUTH_RESET_INVALID_OR_EXPIRED"
  | "AUTH_RESET_TRANSACTION_REQUIRED"

export class AuthResetError extends Error {
  readonly code: AuthResetErrorCode

  constructor(code: AuthResetErrorCode) {
    super(code)
    this.name = "AuthResetError"
    this.code = code
  }
}

class AuthResetLeaseLostError extends Error {
  constructor() {
    super("AUTH_RESET_LEASE_LOST")
    this.name = "AuthResetLeaseLostError"
  }
}

export type AuthResetReconcileInput = {
  now?: Date
  leaseOwner?: string
  batchSize?: number
  logger?: {
    warn?: (message: string, meta?: Record<string, unknown>) => void
  }
}

export type AuthResetReconcileResult = {
  processed: number
  leased: number
  revoked: number
  alerted: number
  skipped: number
}

type AuthResetPoolClient = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<AuthResetRawResult>
  release?: () => void | Promise<void>
}

type AuthResetPool = {
  connect(): Promise<AuthResetPoolClient>
}

const DEFAULT_ID_FACTORY: AuthResetIdFactory = (prefix) =>
  generateEntityId(undefined, prefix)

const IN_FLIGHT_INTENT_STATUSES = new Set<AuthResetStatus>([
  "claimed",
  "credential_updated",
  "revocation_committed",
  "failed_reconcilable",
])

function replaceBindings(sql: string): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

export function createPostgresAuthResetDatabase(
  pool: AuthResetPool
): AuthResetDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction: AuthResetTransaction = {
        raw: (sql, bindings = []) =>
          client.query(replaceBindings(sql), bindings),
      }

      try {
        const result = await callback(transaction)
        await client.query("commit")
        return result
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        await client.release?.()
      }
    },
  }
}

function invalidRequest(): never {
  throw new AuthResetError("AUTH_RESET_INVALID_REQUEST")
}

function invalidOrExpired(): never {
  throw new AuthResetError("AUTH_RESET_INVALID_OR_EXPIRED")
}

function transactionRequired(): never {
  throw new AuthResetError("AUTH_RESET_TRANSACTION_REQUIRED")
}

function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 255) {
    return invalidRequest()
  }
  return value
}

function requireDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime())
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return transactionRequired()
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireDate(value)
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireString(value)
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return transactionRequired()
  }
  return value
}

function requirePositiveInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return transactionRequired()
  }
  return parsed
}

function requireNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return transactionRequired()
  }
  return parsed
}

function rowsOf(result: AuthResetRawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function parseIntent(row: Record<string, unknown>): AuthResetIntentRecord {
  const status = requireString(row.status)
  if (!AUTH_RESET_STATUSES.includes(status as AuthResetStatus)) {
    return transactionRequired()
  }
  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    token_hash: requireString(row.token_hash),
    nonce: requireString(row.nonce),
    key_version: requirePositiveInteger(row.key_version),
    generation: requireNonNegativeInteger(row.generation),
    status: status as AuthResetStatus,
    version: requirePositiveInteger(row.version),
    operation_id: nullableString(row.operation_id),
    lease_owner: nullableString(row.lease_owner),
    lease_until: nullableDate(row.lease_until),
    attempt_count: requireNonNegativeInteger(row.attempt_count),
    next_retry_at: nullableDate(row.next_retry_at),
    expires_at: requireDate(row.expires_at),
    claimed_at: nullableDate(row.claimed_at),
    provider_proved_at: nullableDate(row.provider_proved_at),
    credential_updated_at: nullableDate(row.credential_updated_at),
    revocation_committed_at: nullableDate(row.revocation_committed_at),
    completed_at: nullableDate(row.completed_at),
    superseded_at: nullableDate(row.superseded_at),
    expired_at: nullableDate(row.expired_at),
    failed_reconcilable_at: nullableDate(row.failed_reconcilable_at),
    schema_version: requirePositiveInteger(row.schema_version),
    created_at: requireDate(row.created_at),
    updated_at: requireDate(row.updated_at),
  }
}

function parseCredential(row: Record<string, unknown>): AuthResetCredentialRecord {
  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    customer_id: requireString(row.customer_id),
    credential_version: requirePositiveInteger(row.credential_version),
    email_verified_at: nullableDate(row.email_verified_at),
    operation_type: nullableString(row.operation_type),
    operation_id: nullableString(row.operation_id),
    operation_status: requireString(row.operation_status),
    operation_version: requireNonNegativeInteger(row.operation_version),
    version: requirePositiveInteger(row.version),
    lease_owner: nullableString(row.lease_owner),
    lease_until: nullableDate(row.lease_until),
    attempt_count: requireNonNegativeInteger(row.attempt_count),
    next_retry_at: nullableDate(row.next_retry_at),
    provider_proved_at: nullableDate(row.provider_proved_at),
    credential_updated_at: nullableDate(row.credential_updated_at),
    revocation_committed_at: nullableDate(row.revocation_committed_at),
    completed_at: nullableDate(row.completed_at),
  }
}

function makeId(idFactory: AuthResetIdFactory | undefined, prefix: string): string {
  return requireIdentifier((idFactory ?? DEFAULT_ID_FACTORY)(prefix))
}

function makeNonce(randomBytesFn: AuthResetRandomBytes | undefined): Buffer {
  return generateCustomerAuthCapabilityNonce(randomBytesFn ?? randomBytes)
}

function assertCapabilityShape(capability: unknown): string {
  if (
    typeof capability !== "string" ||
    capability.length < AUTH_RESET_CAPABILITY_MIN_LENGTH ||
    capability.length > AUTH_RESET_CAPABILITY_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(capability)
  ) {
    return invalidOrExpired()
  }
  return capability
}

function assertIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 512
  ) {
    return invalidRequest()
  }
  return value
}

function assertNewPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    return invalidRequest()
  }
  return value
}

function sameDigest(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8")
  const rightBuffer = Buffer.from(right, "utf8")
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function normalizedEmailParts(input: string): {
  normalizedEmail: string
  domain: string
} {
  let normalizedEmail: string
  try {
    normalizedEmail = normalizeCustomerAuthEmail(input)
  } catch {
    return invalidRequest()
  }
  const separator = normalizedEmail.lastIndexOf("@")
  if (separator < 1 || separator === normalizedEmail.length - 1) {
    return invalidRequest()
  }
  return {
    normalizedEmail,
    domain: normalizedEmail.slice(separator + 1),
  }
}

export function hashResetOperationId(input: {
  keyring: CapabilityKeyring
  idempotencyKey: string
}): string {
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey)
  const keyVersion = input.keyring.active.version
  const derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(input.keyring.active.secret, "utf8"),
      Buffer.alloc(0),
      Buffer.from(`customer-auth-reset-operation-key:${keyVersion}`, "utf8"),
      32
    )
  )
  return createHmac("sha256", derivedKey)
    .update(
      `customer-auth-reset-operation|v1|key-version:${keyVersion}|idempotency:${idempotencyKey}`,
      "utf8"
    )
    .digest("hex")
}

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + AUTH_RESET_LEASE_MS)
}

function isLeaseClaimable(leaseUntilAt: Date | null, now: Date): boolean {
  return leaseUntilAt === null || leaseUntilAt.getTime() <= now.getTime()
}

function isRetryDue(nextRetryAt: Date | null, now: Date): boolean {
  return nextRetryAt === null || nextRetryAt.getTime() <= now.getTime()
}

async function tryAcquireIntentLease(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  leaseOwner: string,
  now: Date
): Promise<AuthResetIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_reset_intent
        set lease_owner = ?,
            lease_until = ?,
            attempt_count = attempt_count + 1,
            version = version + 1,
            updated_at = ?
      where id = ?
        and version = ?
        and status = ?
        and status in ('claimed', 'credential_updated', 'revocation_committed', 'failed_reconcilable')
        and completed_at is null
        and deleted_at is null
        and (lease_until is null or lease_until <= ?)
      returning *`,
    [
      leaseOwner,
      leaseUntil(now),
      now,
      intent.id,
      intent.version,
      intent.status,
      now,
    ]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function tryAcquireCredentialLease(
  transaction: AuthResetTransaction,
  credential: AuthResetCredentialRecord,
  leaseOwner: string,
  now: Date
): Promise<AuthResetCredentialRecord | null> {
  const result = await transaction.raw(
    `update auth_credential_state
        set lease_owner = ?,
            lease_until = ?,
            attempt_count = attempt_count + 1,
            version = version + 1,
            updated_at = ?
      where id = ?
        and version = ?
        and operation_type = 'reset'
        and operation_status = ?
        and operation_status in ('claimed', 'credential_proved', 'credential_updated', 'revocation_committed', 'provider_outcome_ambiguous')
        and completed_at is null
        and deleted_at is null
        and (lease_until is null or lease_until <= ?)
      returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                operation_type, operation_id, operation_status, operation_version, version,
                lease_owner, lease_until, attempt_count, next_retry_at,
                provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
    [
      leaseOwner,
      leaseUntil(now),
      now,
      credential.id,
      credential.version,
      credential.operation_status,
      now,
    ]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function readCredentialForUpdate(
  transaction: AuthResetTransaction,
  authIdentityId: string
): Promise<AuthResetCredentialRecord | null> {
  const result = await transaction.raw(
    `select id, auth_identity_id, customer_id, credential_version, email_verified_at,
            operation_type, operation_id, operation_status, operation_version, version,
            lease_owner, lease_until, attempt_count, next_retry_at,
            provider_proved_at, credential_updated_at, revocation_committed_at, completed_at
       from auth_credential_state
      where auth_identity_id = ?
        and deleted_at is null
      for update`,
    [authIdentityId]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function readIntentsForUpdate(
  transaction: AuthResetTransaction,
  authIdentityId: string
): Promise<AuthResetIntentRecord[]> {
  const result = await transaction.raw(
    `select *
       from auth_reset_intent
      where auth_identity_id = ?
        and deleted_at is null
      order by generation desc, id desc
      for update`,
    [authIdentityId]
  )
  return rowsOf(result).map(parseIntent)
}

async function readIntentByHash(
  transaction: AuthResetTransaction,
  tokenHash: string
): Promise<AuthResetIntentRecord | null> {
  const result = await transaction.raw(
    `select *
       from auth_reset_intent
      where token_hash = ?
        and deleted_at is null
      limit 1`,
    [tokenHash]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function readIntentByIdForUpdate(
  transaction: AuthResetTransaction,
  id: string
): Promise<AuthResetIntentRecord | null> {
  const result = await transaction.raw(
    `select *
       from auth_reset_intent
      where id = ?
        and deleted_at is null
      for update`,
    [id]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function expirePendingIntent(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  now: Date
): Promise<AuthResetIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_reset_intent
        set status = 'expired',
            expired_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and status = 'pending'
        and operation_id is null
        and claimed_at is null
        and expires_at <= ?
        and deleted_at is null
      returning *`,
    [now, now, intent.id, now]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function supersedePendingIntent(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  now: Date
): Promise<AuthResetIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_reset_intent
        set status = 'superseded',
            superseded_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and status = 'pending'
        and operation_id is null
        and claimed_at is null
        and deleted_at is null
      returning *`,
    [now, now, intent.id]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function insertResetIntent(
  transaction: AuthResetTransaction,
  input: {
    id: string
    authIdentityId: string
    tokenHash: string
    nonce: string
    keyVersion: number
    generation: number
    expiresAt: Date
    createdAt: Date
  }
): Promise<AuthResetIntentRecord> {
  const result = await transaction.raw(
    `insert into auth_reset_intent (
       id, auth_identity_id, token_hash, nonce, key_version, generation,
       status, version, operation_id, lease_owner, lease_until, attempt_count,
       next_retry_at, expires_at, claimed_at, provider_proved_at,
       credential_updated_at, revocation_committed_at, completed_at,
       superseded_at, expired_at, failed_reconcilable_at, schema_version,
       created_at, updated_at
     ) values (
       ?, ?, ?, ?, ?, ?,
       'pending', 1, null, null, null, 0,
       null, ?, null, null,
       null, null, null,
       null, null, null, 1,
       ?, ?
     )
     returning *`,
    [
      input.id,
      input.authIdentityId,
      input.tokenHash,
      input.nonce,
      input.keyVersion,
      input.generation,
      input.expiresAt,
      input.createdAt,
      input.createdAt,
    ]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : transactionRequired()
}

async function requireUpdatedIntent(
  result: AuthResetRawResult
): Promise<AuthResetIntentRecord> {
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : transactionRequired()
}

async function requireUpdatedCredential(
  result: AuthResetRawResult
): Promise<AuthResetCredentialRecord> {
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : transactionRequired()
}

export async function requestPasswordReset(
  database: AuthResetDatabase,
  input: AuthResetRequestInput
): Promise<AuthResetRequestResult> {
  const authIdentityId = requireIdentifier(input.authIdentityId)
  const recipientIdentityId = requireIdentifier(
    input.recipientIdentityId ?? input.authIdentityId
  )
  const now = requireDate(input.now ?? new Date())
  const email = normalizedEmailParts(input.normalizedEmail)
  const keyVersion = input.keyring.active.version
  const recipientHash = (() => {
    try {
      return deriveCustomerAuthRecipientHash({
        keyring: input.keyring,
        keyVersion,
        purpose: "reset",
        normalizedEmail: email.normalizedEmail,
        recipientIdentityId,
      })
    } catch {
      return invalidRequest()
    }
  })()

  return database.transaction(async (transaction) => {
    const credential = await readCredentialForUpdate(transaction, authIdentityId)
    if (!credential) {
      return {
        accepted: true as const,
        created: false,
        intent: null,
        outbox: null,
      }
    }

    if (
      isCustomerAuthRecoveryFailClosed(
        credential.operation_status as CustomerAuthRecoveryStatus
      )
    ) {
      return {
        accepted: true as const,
        created: false,
        intent: null,
        outbox: null,
      }
    }

    const intents = await readIntentsForUpdate(transaction, authIdentityId)
    for (const intent of intents) {
      if (IN_FLIGHT_INTENT_STATUSES.has(intent.status)) {
        return {
          accepted: true as const,
          created: false,
          intent: null,
          outbox: null,
        }
      }
      if (
        intent.status === "pending" &&
        intent.expires_at.getTime() <= now.getTime()
      ) {
        await expirePendingIntent(transaction, intent, now)
        continue
      }
      if (intent.status === "pending") {
        await supersedePendingIntent(transaction, intent, now)
      }
    }

    const refreshed = await readIntentsForUpdate(transaction, authIdentityId)
    const generation =
      Math.max(0, ...refreshed.map((intent) => Number(intent.generation))) + 1
    const intentId = makeId(input.idFactory, "authrst")
    const nonce = makeNonce(input.randomBytesFn)
    const derived = (() => {
      try {
        return deriveCustomerAuthCapability({
          keyring: input.keyring,
          purpose: "reset",
          intentId,
          generation,
          nonce,
          keyVersion,
        })
      } catch {
        return null
      }
    })()
    if (!derived) {
      return invalidRequest()
    }

    const intent = await insertResetIntent(transaction, {
      id: intentId,
      authIdentityId,
      tokenHash: derived.material.hash,
      nonce: derived.material.nonce,
      keyVersion,
      generation,
      expiresAt: new Date(now.getTime() + AUTH_RESET_TTL_MS),
      createdAt: now,
    })
    const outbox = await recordNotificationOutboxInTransaction(transaction, {
      template: "password_reset_v1",
      intentType: "reset",
      intentId: intent.id,
      generation: intent.generation,
      recipientIdentityId,
      recipientHash,
      recipientDomain: email.domain,
      keyVersion,
      recordedAt: now,
    })

    return {
      accepted: true as const,
      created: true,
      intent,
      outbox,
    }
  })
}

export async function resolveResetIntentId(
  database: AuthResetDatabase,
  capability: string
): Promise<string | null> {
  const token = assertCapabilityShape(capability)
  const tokenHash = hashCustomerAuthCapability(token)
  return database.transaction(async (transaction) => {
    const intent = await readIntentByHash(transaction, tokenHash)
    return intent?.id ?? null
  })
}

async function claimPending(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  operationId: string,
  leaseOwner: string,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  const claimedIntent = await requireUpdatedIntent(
    await transaction.raw(
      `update auth_reset_intent
          set status = 'claimed',
              claimed_at = ?,
              operation_id = ?,
              lease_owner = ?,
              lease_until = ?,
              attempt_count = attempt_count + 1,
              version = version + 1,
              updated_at = ?
        where id = ?
          and token_hash = ?
          and status = 'pending'
          and operation_id is null
          and expires_at > ?
          and deleted_at is null
        returning *`,
      [
        now,
        operationId,
        leaseOwner,
        leaseUntil(now),
        now,
        intent.id,
        intent.token_hash,
        now,
      ]
    )
  )
  const claimedCredential = await requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'claimed',
              operation_type = 'reset',
              operation_id = ?,
              lease_owner = ?,
              lease_until = ?,
              operation_version = operation_version + 1,
              attempt_count = attempt_count + 1,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_status = 'stable'
          and operation_type is null
          and operation_id is null
          and provider_proved_at is null
          and credential_updated_at is null
          and revocation_committed_at is null
          and completed_at is null
          and deleted_at is null
        returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                  operation_type, operation_id, operation_status, operation_version, version,
                  lease_owner, lease_until, attempt_count, next_retry_at,
                  provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
      [operationId, leaseOwner, leaseUntil(now), now, credential.id]
    )
  )
  return { intent: claimedIntent, credential: claimedCredential }
}

async function resumeInFlightOperation(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  if (intent.status !== "failed_reconcilable") {
    return { intent, credential }
  }

  const intentStatus = intent.revocation_committed_at
    ? "revocation_committed"
    : intent.credential_updated_at
      ? "credential_updated"
      : "claimed"
  const credentialStatus = credential.revocation_committed_at
    ? "revocation_committed"
    : credential.credential_updated_at
      ? "credential_updated"
      : credential.provider_proved_at
        ? "credential_proved"
        : "claimed"

  const resumedIntent = await requireUpdatedIntent(
    await transaction.raw(
      `update auth_reset_intent
          set status = ?,
              failed_reconcilable_at = null,
              next_retry_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and status = 'failed_reconcilable'
          and claimed_at is not null
          and operation_id is not null
          and completed_at is null
          and deleted_at is null
        returning *`,
      [intentStatus, now, intent.id]
    )
  )
  const resumedCredential = await requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = ?,
              next_retry_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'reset'
          and operation_status = 'provider_outcome_ambiguous'
          and completed_at is null
          and deleted_at is null
        returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                  operation_type, operation_id, operation_status, operation_version, version,
                  lease_owner, lease_until, attempt_count, next_retry_at,
                  provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
      [credentialStatus, now, credential.id]
    )
  )
  return { intent: resumedIntent, credential: resumedCredential }
}

async function persistProviderProof(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  const provedIntent = intent.provider_proved_at
    ? intent
    : await requireUpdatedIntent(
        await transaction.raw(
          `update auth_reset_intent
              set provider_proved_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and status = 'claimed'
              and claimed_at is not null
              and provider_proved_at is null
              and credential_updated_at is null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning *`,
          [now, now, intent.id]
        )
      )
  const provedCredential = credential.provider_proved_at
    ? credential
    : await requireUpdatedCredential(
        await transaction.raw(
          `update auth_credential_state
              set operation_status = 'credential_proved',
                  provider_proved_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and operation_type = 'reset'
              and operation_status = 'claimed'
              and provider_proved_at is null
              and credential_updated_at is null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                      operation_type, operation_id, operation_status, operation_version, version,
                      lease_owner, lease_until, attempt_count, next_retry_at,
                      provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
          [now, now, credential.id]
        )
      )
  return { intent: provedIntent, credential: provedCredential }
}

async function persistCredentialUpdated(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  const updatedIntent = intent.credential_updated_at
    ? intent
    : await requireUpdatedIntent(
        await transaction.raw(
          `update auth_reset_intent
              set status = 'credential_updated',
                  credential_updated_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and status = 'claimed'
              and claimed_at is not null
              and provider_proved_at is not null
              and credential_updated_at is null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning *`,
          [now, now, intent.id]
        )
      )
  const updatedCredential = credential.credential_updated_at
    ? credential
    : await requireUpdatedCredential(
        await transaction.raw(
          `update auth_credential_state
              set operation_status = 'credential_updated',
                  credential_updated_at = ?,
                  credential_version = credential_version + 1,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and operation_type = 'reset'
              and operation_status = 'credential_proved'
              and provider_proved_at is not null
              and credential_updated_at is null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                      operation_type, operation_id, operation_status, operation_version, version,
                      lease_owner, lease_until, attempt_count, next_retry_at,
                      provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
          [now, now, credential.id]
        )
      )
  return { intent: updatedIntent, credential: updatedCredential }
}

async function revokeAllLineages(
  transaction: AuthResetTransaction,
  authIdentityId: string,
  now: Date
): Promise<void> {
  await transaction.raw(
    `update auth_refresh_credential
        set status = 'revoked',
            revoked_at = ?,
            updated_at = ?
      where lineage_id in (
        select id from auth_session_lineage
         where auth_identity_id = ?
           and deleted_at is null
      )
        and status = 'active'
        and deleted_at is null`,
    [now, now, authIdentityId]
  )
  await transaction.raw(
    `update auth_session_lineage
        set status = 'revoked',
            revoked_at = ?,
            revocation_reason = 'password_reset',
            expired_at = null,
            version = version + 1,
            updated_at = ?
      where auth_identity_id = ?
        and status = 'active'
        and deleted_at is null`,
    [now, now, authIdentityId]
  )
}

async function persistRevocationCommitted(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  const revokedIntent = intent.revocation_committed_at
    ? intent
    : await requireUpdatedIntent(
        await transaction.raw(
          `update auth_reset_intent
              set status = 'revocation_committed',
                  revocation_committed_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and status = 'credential_updated'
              and claimed_at is not null
              and provider_proved_at is not null
              and credential_updated_at is not null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning *`,
          [now, now, intent.id]
        )
      )
  const revokedCredential = credential.revocation_committed_at
    ? credential
    : await requireUpdatedCredential(
        await transaction.raw(
          `update auth_credential_state
              set operation_status = 'revocation_committed',
                  revocation_committed_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and operation_type = 'reset'
              and operation_status = 'credential_updated'
              and provider_proved_at is not null
              and credential_updated_at is not null
              and revocation_committed_at is null
              and completed_at is null
              and deleted_at is null
            returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                      operation_type, operation_id, operation_status, operation_version, version,
                      lease_owner, lease_until, attempt_count, next_retry_at,
                      provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
          [now, now, credential.id]
        )
      )
  return { intent: revokedIntent, credential: revokedCredential }
}

async function completeAndStabilize(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<{ intent: AuthResetIntentRecord; credential: AuthResetCredentialRecord }> {
  const completedIntent = intent.completed_at
    ? intent
    : await requireUpdatedIntent(
        await transaction.raw(
          `update auth_reset_intent
              set status = 'completed',
                  completed_at = ?,
                  lease_owner = null,
                  lease_until = null,
                  next_retry_at = null,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and status = 'revocation_committed'
              and claimed_at is not null
              and provider_proved_at is not null
              and credential_updated_at is not null
              and revocation_committed_at is not null
              and completed_at is null
              and deleted_at is null
            returning *`,
          [now, now, intent.id]
        )
      )
  const stableCredential = await requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'stable',
              operation_type = null,
              operation_id = null,
              lease_owner = null,
              lease_until = null,
              next_retry_at = null,
              current_password_verified_at = null,
              provider_proved_at = null,
              credential_updated_at = null,
              revocation_committed_at = null,
              completed_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'reset'
          and operation_status = 'revocation_committed'
          and provider_proved_at is not null
          and credential_updated_at is not null
          and revocation_committed_at is not null
          and completed_at is null
          and deleted_at is null
        returning id, auth_identity_id, customer_id, credential_version, email_verified_at,
                  operation_type, operation_id, operation_status, operation_version, version,
                  lease_owner, lease_until, attempt_count, next_retry_at,
                  provider_proved_at, credential_updated_at, revocation_committed_at, completed_at`,
      [now, credential.id]
    )
  )
  return { intent: completedIntent, credential: stableCredential }
}

async function markFailedReconcilable(
  transaction: AuthResetTransaction,
  intent: AuthResetIntentRecord,
  credential: AuthResetCredentialRecord,
  now: Date
): Promise<void> {
  await transaction.raw(
    `update auth_reset_intent
        set status = 'failed_reconcilable',
            failed_reconcilable_at = ?,
            next_retry_at = ?,
            lease_owner = null,
            lease_until = null,
            version = version + 1,
            updated_at = ?
      where id = ?
        and status in ('claimed', 'credential_updated', 'revocation_committed')
        and claimed_at is not null
        and operation_id is not null
        and completed_at is null
        and deleted_at is null`,
    [now, new Date(now.getTime() + AUTH_RESET_RETRY_MS), now, intent.id]
  )
  await transaction.raw(
    `update auth_credential_state
        set operation_status = 'provider_outcome_ambiguous',
            next_retry_at = ?,
            lease_owner = null,
            lease_until = null,
            version = version + 1,
            updated_at = ?
      where id = ?
        and operation_type = 'reset'
        and operation_status in ('claimed', 'credential_proved', 'credential_updated', 'revocation_committed')
        and completed_at is null
        and deleted_at is null`,
    [new Date(now.getTime() + AUTH_RESET_RETRY_MS), now, credential.id]
  )
}

async function proveFreshPassword(
  provider: AuthResetPasswordProvider,
  authIdentityId: string,
  password: string
): Promise<"proved" | "ambiguous"> {
  const updated = await provider.updatePassword({
    authIdentityId,
    password,
  })
  if (updated !== "updated") {
    return "ambiguous"
  }
  const proved = await provider.verifyPassword({
    authIdentityId,
    password,
  })
  return proved ? "proved" : "ambiguous"
}

async function proveRecoveryPassword(
  provider: AuthResetPasswordProvider,
  authIdentityId: string,
  password: string
): Promise<"proved" | "ambiguous"> {
  const alreadyMatches = await provider.verifyPassword({
    authIdentityId,
    password,
  })
  if (alreadyMatches) {
    return "proved"
  }
  const updated = await provider.updatePassword({
    authIdentityId,
    password,
  })
  if (updated !== "updated") {
    return "ambiguous"
  }
  const proved = await provider.verifyPassword({
    authIdentityId,
    password,
  })
  return proved ? "proved" : "ambiguous"
}

export async function confirmPasswordReset(
  database: AuthResetDatabase,
  input: AuthResetConfirmInput
): Promise<AuthResetConfirmResult> {
  const capability = assertCapabilityShape(input.capability)
  const newPassword = assertNewPassword(input.newPassword)
  const operationId = hashResetOperationId({
    keyring: input.keyring,
    idempotencyKey: input.idempotencyKey,
  })
  const tokenHash = hashCustomerAuthCapability(capability)
  const now = requireDate(input.now ?? new Date())
  const leaseOwner = requireIdentifier(input.leaseOwner ?? `authlease_${operationId.slice(0, 24)}`)

  const prepared = await database.transaction(async (transaction) => {
    const candidate = await readIntentByHash(transaction, tokenHash)
    if (!candidate || !sameDigest(candidate.token_hash, tokenHash)) {
      return { invalid: true as const }
    }
    const intent = await readIntentByIdForUpdate(transaction, candidate.id)
    if (!intent || !sameDigest(intent.token_hash, tokenHash)) {
      return { invalid: true as const }
    }
    const credential = await readCredentialForUpdate(
      transaction,
      intent.auth_identity_id
    )
    if (!credential) {
      return { invalid: true as const }
    }

    if (
      intent.status === "pending" &&
      intent.expires_at.getTime() <= now.getTime()
    ) {
      await expirePendingIntent(transaction, intent, now)
      return { invalid: true as const }
    }

    if (intent.status === "completed") {
      if (!intent.operation_id || !sameDigest(intent.operation_id, operationId)) {
        return { invalid: true as const }
      }
      return {
        ready: {
          phase: "already_completed" as const,
          intent,
          credential,
        },
      }
    }

    if (
      intent.status === "superseded" ||
      intent.status === "expired" ||
      (intent.status === "pending" && intent.expires_at.getTime() <= now.getTime())
    ) {
      return { invalid: true as const }
    }

    if (intent.status === "pending") {
      const claimed = await claimPending(
        transaction,
        intent,
        credential,
        operationId,
        leaseOwner,
        now
      )
      return {
        ready: {
          phase: "fresh_claim" as const,
          intent: claimed.intent,
          credential: claimed.credential,
        },
      }
    }

    if (!IN_FLIGHT_INTENT_STATUSES.has(intent.status)) {
      return { invalid: true as const }
    }
    if (!intent.operation_id || !sameDigest(intent.operation_id, operationId)) {
      return { invalid: true as const }
    }
    if (
      credential.operation_id &&
      !sameDigest(credential.operation_id, operationId)
    ) {
      return { invalid: true as const }
    }

    return {
      ready: {
        phase: "resume" as const,
        intent,
        credential,
      },
    }
  })

  if ("invalid" in prepared) {
    return invalidOrExpired()
  }

  const { phase, intent, credential } = prepared.ready
  if (phase === "already_completed") {
    return {
      outcome: "completed",
      intentId: intent.id,
      generation: intent.generation,
      credentialVersion: credential.credential_version,
    }
  }

  let proof: "proved" | "ambiguous"
  try {
    proof =
      phase === "fresh_claim"
        ? await proveFreshPassword(
            input.provider,
            intent.auth_identity_id,
            newPassword
          )
        : await proveRecoveryPassword(
            input.provider,
            intent.auth_identity_id,
            newPassword
          )
  } catch {
    proof = "ambiguous"
  }

  if (proof !== "proved") {
    await database.transaction(async (transaction) => {
      const lockedIntent = await readIntentByIdForUpdate(transaction, intent.id)
      const lockedCredential = await readCredentialForUpdate(
        transaction,
        intent.auth_identity_id
      )
      if (lockedIntent && lockedCredential) {
        await markFailedReconcilable(
          transaction,
          lockedIntent,
          lockedCredential,
          now
        )
      }
    })
    return {
      outcome: "recovery_pending",
      intentId: intent.id,
      generation: intent.generation,
    }
  }

  try {
    const completed = await database.transaction(async (transaction) => {
      const lockedIntent = await readIntentByIdForUpdate(transaction, intent.id)
      const lockedCredential = await readCredentialForUpdate(
        transaction,
        intent.auth_identity_id
      )
      if (!lockedIntent || !lockedCredential) {
        return transactionRequired()
      }
      const resumed = await resumeInFlightOperation(
        transaction,
        lockedIntent,
        lockedCredential,
        now
      )
      const proved = await persistProviderProof(
        transaction,
        resumed.intent,
        resumed.credential,
        now
      )
      const updated = await persistCredentialUpdated(
        transaction,
        proved.intent,
        proved.credential,
        now
      )
      await revokeAllLineages(transaction, intent.auth_identity_id, now)
      const revoked = await persistRevocationCommitted(
        transaction,
        updated.intent,
        updated.credential,
        now
      )
      return completeAndStabilize(
        transaction,
        revoked.intent,
        revoked.credential,
        now
      )
    })
    return {
      outcome: "completed",
      intentId: completed.intent.id,
      generation: completed.intent.generation,
      credentialVersion: completed.credential.credential_version,
    }
  } catch {
    await database.transaction(async (transaction) => {
      const lockedIntent = await readIntentByIdForUpdate(transaction, intent.id)
      const lockedCredential = await readCredentialForUpdate(
        transaction,
        intent.auth_identity_id
      )
      if (lockedIntent && lockedCredential && !lockedIntent.completed_at) {
        await markFailedReconcilable(
          transaction,
          lockedIntent,
          lockedCredential,
          now
        )
      }
    }).catch(() => undefined)
    return {
      outcome: "recovery_pending",
      intentId: intent.id,
      generation: intent.generation,
    }
  }
}

export async function reconcileSecretlessPasswordReset(
  database: AuthResetDatabase,
  input: AuthResetReconcileInput = {}
): Promise<AuthResetReconcileResult> {
  const now = requireDate(input.now ?? new Date())
  const leaseOwner = requireIdentifier(
    input.leaseOwner ?? `authlease_reconcile_${now.getTime()}`
  )
  const batchSize = input.batchSize ?? 25
  const result: AuthResetReconcileResult = {
    processed: 0,
    leased: 0,
    revoked: 0,
    alerted: 0,
    skipped: 0,
  }

  const due = await database.transaction(async (transaction) => {
    const rows = await transaction.raw(
      `select *
         from auth_reset_intent
        where status in ('claimed', 'credential_updated', 'revocation_committed', 'failed_reconcilable')
          and completed_at is null
          and deleted_at is null
          and (lease_until is null or lease_until <= ?)
          and (next_retry_at is null or next_retry_at <= ?)
        order by coalesce(next_retry_at, created_at) asc, id asc
        limit ?`,
      [now, now, batchSize]
    )
    return rowsOf(rows).map(parseIntent)
  })

  for (const candidate of due) {
    result.processed += 1
    try {
      const step = await database.transaction(async (transaction) => {
        const intent = await readIntentByIdForUpdate(transaction, candidate.id)
        if (!intent || intent.completed_at) {
          return "skipped" as const
        }
        const credential = await readCredentialForUpdate(
          transaction,
          intent.auth_identity_id
        )
        if (!credential) {
          return "skipped" as const
        }

        if (
          !isLeaseClaimable(intent.lease_until, now) ||
          !isRetryDue(intent.next_retry_at, now)
        ) {
          return "lost" as const
        }
        if (!isLeaseClaimable(credential.lease_until, now)) {
          return "lost" as const
        }

        const leasedIntent = await tryAcquireIntentLease(
          transaction,
          intent,
          leaseOwner,
          now
        )
        if (!leasedIntent) {
          return "lost" as const
        }
        const leasedCredential = await tryAcquireCredentialLease(
          transaction,
          credential,
          leaseOwner,
          now
        )
        if (!leasedCredential) {
          throw new AuthResetLeaseLostError()
        }

        if (
          leasedIntent.credential_updated_at &&
          leasedCredential.credential_updated_at
        ) {
          await revokeAllLineages(transaction, intent.auth_identity_id, now)
          if (!leasedIntent.revocation_committed_at) {
            await persistRevocationCommitted(
              transaction,
              leasedIntent,
              leasedCredential,
              now
            )
          }
          return "revoked" as const
        }

        return "leased" as const
      })

      if (step === "skipped" || step === "lost") {
        result.skipped += 1
        continue
      }
      result.leased += 1
      if (step === "revoked") {
        result.revoked += 1
      }
      input.logger?.warn?.("AUTH_RESET_SECRETLESS_RECOVERY", {
        error_code: "AUTH_RESET_SECRETLESS_RECOVERY",
        job: "auth-reset-reconcile",
        intent_id: candidate.id,
        generation: candidate.generation,
      })
      result.alerted += 1
    } catch {
      result.skipped += 1
    }
  }

  return result
}

export function hashResetCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex")
}
