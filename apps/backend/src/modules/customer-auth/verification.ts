import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { generateEntityId } from "@medusajs/framework/utils"
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

export const AUTH_VERIFICATION_TTL_MS = 30 * 60 * 1000
export const AUTH_VERIFICATION_FIRST_GENERATION = 1 as const
export const AUTH_VERIFICATION_CAPABILITY_MIN_LENGTH = 43 as const
export const AUTH_VERIFICATION_CAPABILITY_MAX_LENGTH = 512 as const

export const AUTH_VERIFICATION_STATUSES = [
  "pending",
  "claimed",
  "confirmed",
  "superseded",
  "expired",
  "dead_letter",
] as const

export type AuthVerificationStatus =
  (typeof AUTH_VERIFICATION_STATUSES)[number]

export type AuthVerificationRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type AuthVerificationTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<AuthVerificationRawResult>
}

export type AuthVerificationDatabase = {
  transaction<T>(
    callback: (transaction: AuthVerificationTransaction) => Promise<T>
  ): Promise<T>
}

export type AuthVerificationIdFactory = (prefix: string) => string
export type AuthVerificationRandomBytes = (size: number) => Buffer

export type AuthVerificationIntentRecord = {
  id: string
  auth_identity_id: string
  token_hash: string
  nonce: string
  key_version: number
  generation: number
  status: AuthVerificationStatus
  version: number
  expires_at: Date
  claimed_at: Date | null
  confirmed_at: Date | null
  superseded_at: Date | null
  expired_at: Date | null
  dead_lettered_at: Date | null
  schema_version: number
  created_at: Date
  updated_at: Date
}

export type AuthVerificationRequestInput = {
  authIdentityId: string
  recipientIdentityId?: string
  normalizedEmail: string
  keyring: CapabilityKeyring
  now?: Date
  idFactory?: AuthVerificationIdFactory
  randomBytesFn?: AuthVerificationRandomBytes
}

export type AuthVerificationRequestResult = {
  accepted: true
  created: boolean
  state: "pending" | "verified" | "unknown"
  intent: AuthVerificationIntentRecord | null
  outbox: AuthNotificationOutboxRecord | null
}

export type AuthVerificationConfirmInput = {
  capability: string
  now?: Date
}

export type AuthVerificationConfirmResult = {
  success: true
  state: "verified"
  intentId: string
  generation: number
}

export type AuthVerificationStatusResult = {
  state: "pending" | "verified"
}

export type AuthVerificationErrorCode =
  | "AUTH_VERIFICATION_INVALID_REQUEST"
  | "AUTH_VERIFICATION_INVALID_OR_EXPIRED"
  | "AUTH_VERIFICATION_TRANSACTION_REQUIRED"

export class AuthVerificationError extends Error {
  readonly code: AuthVerificationErrorCode

  constructor(code: AuthVerificationErrorCode) {
    super(code)
    this.name = "AuthVerificationError"
    this.code = code
  }
}

type AuthVerificationCredentialRow = {
  id: string
  auth_identity_id: string
  email_verified_at: Date | null
  version: number
}

type AuthVerificationRequestMode = "auto" | "resend"

type AuthVerificationPoolClient = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<AuthVerificationRawResult>
  release?: () => void | Promise<void>
}

type AuthVerificationPool = {
  connect(): Promise<AuthVerificationPoolClient>
}

const DEFAULT_ID_FACTORY: AuthVerificationIdFactory = (prefix) =>
  generateEntityId(undefined, prefix)

function replaceBindings(sql: string): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

export function createPostgresAuthVerificationDatabase(
  pool: AuthVerificationPool
): AuthVerificationDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction: AuthVerificationTransaction = {
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
  throw new AuthVerificationError("AUTH_VERIFICATION_INVALID_REQUEST")
}

function invalidOrExpired(): never {
  throw new AuthVerificationError("AUTH_VERIFICATION_INVALID_OR_EXPIRED")
}

function transactionRequired(): never {
  throw new AuthVerificationError("AUTH_VERIFICATION_TRANSACTION_REQUIRED")
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

function rowsOf(result: AuthVerificationRawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function parseIntent(row: Record<string, unknown>): AuthVerificationIntentRecord {
  const status = requireString(row.status)
  if (
    !AUTH_VERIFICATION_STATUSES.includes(
      status as AuthVerificationStatus
    )
  ) {
    return transactionRequired()
  }

  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    token_hash: requireString(row.token_hash),
    nonce: requireString(row.nonce),
    key_version: requirePositiveInteger(row.key_version),
    generation: requireNonNegativeInteger(row.generation),
    status: status as AuthVerificationStatus,
    version: requirePositiveInteger(row.version),
    expires_at: requireDate(row.expires_at),
    claimed_at: nullableDate(row.claimed_at),
    confirmed_at: nullableDate(row.confirmed_at),
    superseded_at: nullableDate(row.superseded_at),
    expired_at: nullableDate(row.expired_at),
    dead_lettered_at: nullableDate(row.dead_lettered_at),
    schema_version: requirePositiveInteger(row.schema_version),
    created_at: requireDate(row.created_at),
    updated_at: requireDate(row.updated_at),
  }
}

function parseCredential(
  row: Record<string, unknown>
): AuthVerificationCredentialRow {
  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    email_verified_at: nullableDate(row.email_verified_at),
    version: requirePositiveInteger(row.version),
  }
}

function makeId(
  idFactory: AuthVerificationIdFactory | undefined,
  prefix: string
): string {
  return requireIdentifier((idFactory ?? DEFAULT_ID_FACTORY)(prefix))
}

function makeNonce(
  randomBytesFn: AuthVerificationRandomBytes | undefined
): Buffer {
  return generateCustomerAuthCapabilityNonce(randomBytesFn ?? randomBytes)
}

function assertCapabilityShape(capability: unknown): string {
  if (
    typeof capability !== "string" ||
    capability.length < AUTH_VERIFICATION_CAPABILITY_MIN_LENGTH ||
    capability.length > AUTH_VERIFICATION_CAPABILITY_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(capability)
  ) {
    return invalidOrExpired()
  }
  return capability
}

function hashCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex")
}

function sameHash(left: string, right: string): boolean {
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

async function readCredentialForUpdate(
  transaction: AuthVerificationTransaction,
  authIdentityId: string
): Promise<AuthVerificationCredentialRow | null> {
  const result = await transaction.raw(
    `select id, auth_identity_id, email_verified_at, version
       from auth_credential_state
      where auth_identity_id = ?
        and deleted_at is null
      for update`,
    [authIdentityId]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function readVerificationStatus(
  transaction: AuthVerificationTransaction,
  authIdentityId: string
): Promise<AuthVerificationStatusResult> {
  const result = await transaction.raw(
    `select email_verified_at
       from auth_credential_state
      where auth_identity_id = ?
        and deleted_at is null
      limit 1`,
    [authIdentityId]
  )
  const row = rowsOf(result)[0]
  return {
    state: row?.email_verified_at ? "verified" : "pending",
  }
}

async function readIntentsForUpdate(
  transaction: AuthVerificationTransaction,
  authIdentityId: string
): Promise<AuthVerificationIntentRecord[]> {
  const result = await transaction.raw(
    `select *
       from auth_verification_intent
      where auth_identity_id = ?
        and deleted_at is null
      order by generation desc, id desc
      for update`,
    [authIdentityId]
  )
  return rowsOf(result).map(parseIntent)
}

async function readIntentByHash(
  transaction: AuthVerificationTransaction,
  tokenHash: string
): Promise<AuthVerificationIntentRecord | null> {
  const result = await transaction.raw(
    `select *
       from auth_verification_intent
      where token_hash = ?
        and deleted_at is null
      limit 1`,
    [tokenHash]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function readIntentByIdForUpdate(
  transaction: AuthVerificationTransaction,
  id: string
): Promise<AuthVerificationIntentRecord | null> {
  const result = await transaction.raw(
    `select *
       from auth_verification_intent
      where id = ?
        and deleted_at is null
      for update`,
    [id]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function expireIntent(
  transaction: AuthVerificationTransaction,
  intent: AuthVerificationIntentRecord,
  now: Date
): Promise<AuthVerificationIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_verification_intent
        set status = 'expired',
            expired_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and status in ('pending', 'claimed')
        and expires_at <= ?
        and deleted_at is null
      returning *`,
    [now, now, intent.id, now]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function supersedeIntent(
  transaction: AuthVerificationTransaction,
  intent: AuthVerificationIntentRecord,
  now: Date
): Promise<AuthVerificationIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_verification_intent
        set status = 'superseded',
            superseded_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and status in ('pending', 'claimed')
        and deleted_at is null
      returning *`,
    [now, now, intent.id]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function supersedeActiveIntents(
  transaction: AuthVerificationTransaction,
  authIdentityId: string,
  excludedId: string | null,
  now: Date
): Promise<AuthVerificationIntentRecord[]> {
  const exclusion = excludedId ? "and id <> ?" : ""
  const bindings = excludedId
    ? [now, now, authIdentityId, excludedId]
    : [now, now, authIdentityId]
  const result = await transaction.raw(
    `update auth_verification_intent
        set status = 'superseded',
            superseded_at = ?,
            version = version + 1,
            updated_at = ?
      where auth_identity_id = ?
        ${exclusion}
        and status in ('pending', 'claimed')
        and deleted_at is null
      returning *`,
    bindings
  )
  return rowsOf(result).map(parseIntent)
}

async function insertVerificationIntent(
  transaction: AuthVerificationTransaction,
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
): Promise<AuthVerificationIntentRecord> {
  const result = await transaction.raw(
    `insert into auth_verification_intent (
       id, auth_identity_id, token_hash, nonce, key_version, generation,
       status, version, expires_at, claimed_at, confirmed_at,
       superseded_at, expired_at, dead_lettered_at, schema_version, created_at
     ) values (
       ?, ?, ?, ?, ?, ?, 'pending', 1, ?, null, null,
       null, null, null, 1, ?
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
    ]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : transactionRequired()
}

async function confirmIntent(
  transaction: AuthVerificationTransaction,
  intent: AuthVerificationIntentRecord,
  tokenHash: string,
  now: Date
): Promise<AuthVerificationIntentRecord | null> {
  const result = await transaction.raw(
    `update auth_verification_intent
        set status = 'confirmed',
            claimed_at = coalesce(claimed_at, ?),
            confirmed_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and token_hash = ?
        and status = 'pending'
        and expires_at > ?
        and deleted_at is null
      returning *`,
    [now, now, now, intent.id, tokenHash, now]
  )
  const row = rowsOf(result)[0]
  return row ? parseIntent(row) : null
}

async function markCredentialVerified(
  transaction: AuthVerificationTransaction,
  credential: AuthVerificationCredentialRow,
  now: Date
): Promise<void> {
  const result = await transaction.raw(
    `update auth_credential_state
        set email_verified_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and email_verified_at is null
        and deleted_at is null
      returning id`,
    [now, now, credential.id]
  )
  if (rowsOf(result).length !== 1) {
    return transactionRequired()
  }
}

async function runVerificationRequest(
  database: AuthVerificationDatabase,
  input: AuthVerificationRequestInput,
  mode: AuthVerificationRequestMode
): Promise<AuthVerificationRequestResult> {
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
        purpose: "verification",
        normalizedEmail: email.normalizedEmail,
        recipientIdentityId,
      })
    } catch {
      return null
    }
  })()

  if (!recipientHash) {
    return invalidRequest()
  }

  return database.transaction(async (transaction) => {
    const credential = await readCredentialForUpdate(
      transaction,
      authIdentityId
    )

    if (!credential) {
      return {
        accepted: true,
        created: false,
        state: "unknown",
        intent: null,
        outbox: null,
      }
    }

    let intents = await readIntentsForUpdate(transaction, authIdentityId)
    for (const intent of intents) {
      if (
        (intent.status === "pending" || intent.status === "claimed") &&
        intent.expires_at.getTime() <= now.getTime()
      ) {
        await expireIntent(transaction, intent, now)
      }
    }
    intents = await readIntentsForUpdate(transaction, authIdentityId)

    if (credential.email_verified_at) {
      await supersedeActiveIntents(transaction, authIdentityId, null, now)
      return {
        accepted: true,
        created: false,
        state: "verified",
        intent: null,
        outbox: null,
      }
    }

    const active = intents.filter(
      (intent) => intent.status === "pending" || intent.status === "claimed"
    )

    if (mode === "auto" && active.length > 0) {
      const latest = active[0]!
      if (active.length > 1) {
        await supersedeActiveIntents(
          transaction,
          authIdentityId,
          latest.id,
          now
        )
      }
      return {
        accepted: true,
        created: false,
        state: "pending",
        intent: latest,
        outbox: null,
      }
    }

    if (mode === "resend") {
      for (const intent of active) {
        await supersedeIntent(transaction, intent, now)
      }
    }

    const generation =
      Math.max(
        0,
        ...intents.map((intent) => Number(intent.generation))
      ) + 1
    const intentId = makeId(input.idFactory, "authver")
    const nonce = makeNonce(input.randomBytesFn)
    const derived = (() => {
      try {
        return deriveCustomerAuthCapability({
          keyring: input.keyring,
          purpose: "verification",
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

    const intent = await insertVerificationIntent(transaction, {
      id: intentId,
      authIdentityId,
      tokenHash: derived.material.hash,
      nonce: derived.material.nonce,
      keyVersion,
      generation,
      expiresAt: new Date(now.getTime() + AUTH_VERIFICATION_TTL_MS),
      createdAt: now,
    })
    const outbox = await recordNotificationOutboxInTransaction(transaction, {
      template: "email_verification_v1",
      intentType: "verification",
      intentId: intent.id,
      generation: intent.generation,
      recipientIdentityId,
      recipientHash,
      recipientDomain: email.domain,
      keyVersion,
      recordedAt: now,
    })

    return {
      accepted: true,
      created: true,
      state: "pending",
      intent,
      outbox,
    }
  })
}

export async function autoRequestVerification(
  database: AuthVerificationDatabase,
  input: AuthVerificationRequestInput
): Promise<AuthVerificationRequestResult> {
  return runVerificationRequest(database, input, "auto")
}

export async function resendVerification(
  database: AuthVerificationDatabase,
  input: AuthVerificationRequestInput
): Promise<AuthVerificationRequestResult> {
  return runVerificationRequest(database, input, "resend")
}

export async function confirmVerification(
  database: AuthVerificationDatabase,
  input: AuthVerificationConfirmInput
): Promise<AuthVerificationConfirmResult> {
  const capability = assertCapabilityShape(input.capability)
  const tokenHash = hashCapability(capability)
  const now = requireDate(input.now ?? new Date())

  const result = await database.transaction<
    AuthVerificationConfirmResult | { invalid: true }
  >(async (transaction) => {
    const candidate = await readIntentByHash(transaction, tokenHash)
    if (!candidate) {
      return { invalid: true }
    }

    const credential = await readCredentialForUpdate(
      transaction,
      candidate.auth_identity_id
    )
    if (!credential) {
      return { invalid: true }
    }

    const intent = await readIntentByIdForUpdate(transaction, candidate.id)
    if (!intent || !sameHash(intent.token_hash, tokenHash)) {
      return { invalid: true }
    }

    if (credential.email_verified_at) {
      await supersedeActiveIntents(
        transaction,
        candidate.auth_identity_id,
        null,
        now
      )
      return { invalid: true }
    }

    if (
      (intent.status === "pending" || intent.status === "claimed") &&
      intent.expires_at.getTime() <= now.getTime()
    ) {
      await expireIntent(transaction, intent, now)
      return { invalid: true }
    }

    if (intent.status !== "pending") {
      return { invalid: true }
    }

    const confirmed = await confirmIntent(transaction, intent, tokenHash, now)
    if (!confirmed) {
      return { invalid: true }
    }

    await markCredentialVerified(transaction, credential, now)
    await supersedeActiveIntents(
      transaction,
      candidate.auth_identity_id,
      confirmed.id,
      now
    )

    return {
      success: true,
      state: "verified",
      intentId: confirmed.id,
      generation: confirmed.generation,
    }
  })

  if ("invalid" in result) {
    return invalidOrExpired()
  }

  return result
}

export async function getVerificationStatus(
  database: AuthVerificationDatabase,
  authIdentityId: string
): Promise<AuthVerificationStatusResult> {
  const identityId = requireIdentifier(authIdentityId)
  return database.transaction((transaction) =>
    readVerificationStatus(transaction, identityId)
  )
}

export const requestVerification = autoRequestVerification
export const requestVerificationResend = resendVerification
export const confirmCustomerEmailVerification = confirmVerification

