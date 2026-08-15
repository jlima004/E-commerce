import { createHash } from "node:crypto"
import { generateEntityId } from "@medusajs/framework/utils"
import {
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
  type CapabilityKeyring,
} from "./security/capabilities"
import {
  AUTH_REFRESH_INACTIVITY_TTL_SECONDS,
  AUTH_REFRESH_RECOVERY_SECONDS,
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
} from "./types"
import {
  issueCustomerAuthAccessToken,
  type IssuedCustomerAuthAccessToken,
} from "./jwt"

export const AUTH_REFRESH_TOKEN_BYTES = 32 as const
export const AUTH_REFRESH_TOKEN_LENGTH = 43 as const
export const AUTH_REFRESH_RECOVERY_MS =
  AUTH_REFRESH_RECOVERY_SECONDS * 1000
export const AUTH_REFRESH_INACTIVITY_MS =
  AUTH_REFRESH_INACTIVITY_TTL_SECONDS * 1000
export const AUTH_SESSION_ABSOLUTE_MS =
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS * 1000

export const AUTH_SESSION_FAULT_POINTS = {
  REFRESH_PRE_COMMIT: "refresh_pre_commit",
  REFRESH_COMMIT_TO_RESPONSE: "refresh_commit_to_response",
} as const

export type AuthSessionFaultPoint =
  (typeof AUTH_SESSION_FAULT_POINTS)[keyof typeof AUTH_SESSION_FAULT_POINTS]

export type AuthSessionFaultInjector = {
  fire(point: AuthSessionFaultPoint): { fired: boolean }
}

export type AuthSessionRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type AuthSessionTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<AuthSessionRawResult> | AuthSessionRawResult
}

export type AuthSessionDatabase = {
  transaction<T>(
    callback: (transaction: AuthSessionTransaction) => Promise<T>
  ): Promise<T>
}

type AuthSessionPoolClient = {
  query(sql: string, bindings?: unknown[]): Promise<AuthSessionRawResult>
  release?: () => void | Promise<void>
}

type AuthSessionPool = {
  connect(): Promise<AuthSessionPoolClient>
}

export type AuthSessionIdFactory = (prefix: string) => string
export type AuthSessionRandomBytes = (size: number) => Buffer

export type AuthSessionMutationOptions = {
  idFactory?: AuthSessionIdFactory
  randomBytesFn?: AuthSessionRandomBytes
  beforeCommit?: () => void | Promise<void>
  faultInjector?: AuthSessionFaultInjector
}

export type AuthSessionErrorCode =
  | "AUTH_SESSION_INVALID_REQUEST"
  | "AUTH_SESSION_AUTHENTICATION_REQUIRED"
  | "AUTH_SESSION_DEADLINE_REACHED"
  | "AUTH_SESSION_RECOVERY_REJECTED"
  | "AUTH_SESSION_CREDENTIAL_STATE_UNAVAILABLE"
  | "AUTH_SESSION_TRANSACTION_REQUIRED"

export class AuthSessionError extends Error {
  readonly code: AuthSessionErrorCode

  constructor(code: AuthSessionErrorCode) {
    super(code)
    this.name = "AuthSessionError"
    this.code = code
  }
}

export class AuthSessionFaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthSessionFaultError"
  }
}

export type AuthSessionEnvelope = {
  accessToken: string
  accessExpiresAt: Date
  refreshToken: string
  refreshExpiresAt: Date
  originalAuthenticatedAt: Date
  absoluteExpiresAt: Date
  lineageId: string
  refreshCredentialId: string
  sid: string
  generation: number
  authIdentityId: string
  customerId: string
  credentialVersion: number
  rotation: "initial" | "rotated" | "recovered"
}

export type IssueInitialAuthSessionInput = {
  authIdentityId: string
  customerId: string
  credentialVersion: number
  keyring: CapabilityKeyring
  jwtSecret: string
  now?: Date
  originalAuthenticatedAt?: Date
} & AuthSessionMutationOptions

export type RotateAuthRefreshInput = {
  refreshToken: string
  idempotencyKey: string
  keyring: CapabilityKeyring
  jwtSecret: string
  now?: Date
} & AuthSessionMutationOptions

export type RevokeAuthSessionLineageInput = {
  lineageId: string
  reason:
    | "logout"
    | "refresh_replay"
    | "password_reset"
    | "password_change"
    | "security_revocation"
  now?: Date
}

type LineageRow = {
  id: string
  sid: string
  auth_identity_id: string
  customer_id: string
  credential_version_snapshot: number
  status: "active" | "revoked" | "expired"
  version: number
  original_authenticated_at: Date
  absolute_expires_at: Date
}

type RefreshRow = {
  id: string
  lineage_id: string
  token_hash: string
  generation: number
  status: "active" | "consumed" | "replayed" | "revoked"
  replacement_id: string | null
  request_key_hash: string | null
  nonce: string
  key_version: number
  expires_at: Date
  consumed_at: Date | null
  recovery_until: Date | null
  replacement_used_at: Date | null
  replayed_at: Date | null
  revoked_at: Date | null
  version: number
}

type CredentialRow = {
  credential_version: number
  operation_status: string
}

type TransactionOutcome =
  | {
      type: "success"
      lineage: LineageRow
      refresh: RefreshRow
      refreshToken: string
      rotation: "initial" | "rotated" | "recovered"
      now: Date
    }
  | {
      type: "failure"
      code:
        | "AUTH_SESSION_AUTHENTICATION_REQUIRED"
        | "AUTH_SESSION_DEADLINE_REACHED"
        | "AUTH_SESSION_RECOVERY_REJECTED"
      now: Date
    }

const DEFAULT_ID_FACTORY: AuthSessionIdFactory = (prefix) =>
  generateEntityId(undefined, prefix)

function replaceBindings(sql: string, bindings: unknown[]): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

export function createPostgresAuthSessionDatabase(
  pool: AuthSessionPool
): AuthSessionDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction: AuthSessionTransaction = {
        raw(sql, bindings = []) {
          return client.query(replaceBindings(sql, bindings), bindings)
        },
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

function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 255) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return value
}

function requireSecret(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return value
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return new Date(value.getTime())
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return Number(value)
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return Number(value)
}

function requireRawRows(result: AuthSessionRawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function dateFromRow(value: unknown): Date {
  if (value instanceof Date) {
    return requireDate(value)
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  throw new AuthSessionError("AUTH_SESSION_TRANSACTION_REQUIRED")
}

function stringFromRow(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new AuthSessionError("AUTH_SESSION_TRANSACTION_REQUIRED")
  }

  return value
}

function nullableStringFromRow(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return stringFromRow(value)
}

function numberFromRow(value: unknown, allowZero = false): number {
  return allowZero
    ? requireNonNegativeInteger(Number(value))
    : requirePositiveInteger(Number(value))
}

function nullableDateFromRow(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null
  }

  return dateFromRow(value)
}

function parseLineage(row: Record<string, unknown>): LineageRow {
  const status = stringFromRow(row.status)
  if (status !== "active" && status !== "revoked" && status !== "expired") {
    throw new AuthSessionError("AUTH_SESSION_TRANSACTION_REQUIRED")
  }

  return {
    id: stringFromRow(row.id),
    sid: stringFromRow(row.sid),
    auth_identity_id: stringFromRow(row.auth_identity_id),
    customer_id: stringFromRow(row.customer_id),
    credential_version_snapshot: numberFromRow(
      row.credential_version_snapshot
    ),
    status,
    version: numberFromRow(row.version),
    original_authenticated_at: dateFromRow(row.original_authenticated_at),
    absolute_expires_at: dateFromRow(row.absolute_expires_at),
  }
}

function parseRefresh(row: Record<string, unknown>): RefreshRow {
  const status = stringFromRow(row.status)
  if (
    status !== "active" &&
    status !== "consumed" &&
    status !== "replayed" &&
    status !== "revoked"
  ) {
    throw new AuthSessionError("AUTH_SESSION_TRANSACTION_REQUIRED")
  }

  return {
    id: stringFromRow(row.id),
    lineage_id: stringFromRow(row.lineage_id),
    token_hash: stringFromRow(row.token_hash),
    generation: numberFromRow(row.generation, true),
    status,
    replacement_id: nullableStringFromRow(row.replacement_id),
    request_key_hash: nullableStringFromRow(row.request_key_hash),
    nonce: stringFromRow(row.nonce),
    key_version: numberFromRow(row.key_version),
    expires_at: dateFromRow(row.expires_at),
    consumed_at: nullableDateFromRow(row.consumed_at),
    recovery_until: nullableDateFromRow(row.recovery_until),
    replacement_used_at: nullableDateFromRow(row.replacement_used_at),
    replayed_at: nullableDateFromRow(row.replayed_at),
    revoked_at: nullableDateFromRow(row.revoked_at),
    version: numberFromRow(row.version),
  }
}

function parseCredential(row: Record<string, unknown>): CredentialRow {
  return {
    credential_version: numberFromRow(row.credential_version),
    operation_status: stringFromRow(row.operation_status),
  }
}

function assertAbsoluteDeadline(
  originalAuthenticatedAt: Date,
  absoluteExpiresAt: Date
): void {
  if (
    absoluteExpiresAt.getTime() !==
    originalAuthenticatedAt.getTime() + AUTH_SESSION_ABSOLUTE_MS
  ) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }
}

function assertOpaqueRefreshToken(token: unknown): string {
  if (typeof token !== "string" || token.length !== AUTH_REFRESH_TOKEN_LENGTH) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  const decoded = Buffer.from(token, "base64url")
  if (
    decoded.length !== AUTH_REFRESH_TOKEN_BYTES ||
    decoded.toString("base64url") !== token
  ) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return token
}

function assertIdempotencyKey(key: unknown): string {
  if (
    typeof key !== "string" ||
    key.length < 1 ||
    key.length > 512 ||
    key.trim() === ""
  ) {
    throw new AuthSessionError("AUTH_SESSION_INVALID_REQUEST")
  }

  return key
}

export function hashAuthRefreshToken(refreshToken: string): string {
  assertOpaqueRefreshToken(refreshToken)
  return hashCustomerAuthCapability(refreshToken)
}

export function hashAuthRefreshRequestKey(idempotencyKey: string): string {
  assertIdempotencyKey(idempotencyKey)
  return createHash("sha256").update(idempotencyKey, "utf8").digest("hex")
}

export function deriveAuthRefreshToken(input: {
  keyring: CapabilityKeyring
  credentialId: string
  lineageId: string
  generation: number
  nonce: Buffer | string
  keyVersion: number
}): string {
  const credentialId = requireIdentifier(input.credentialId)
  const lineageId = requireIdentifier(input.lineageId)
  const generation = requireNonNegativeInteger(input.generation)
  const keyVersion = requirePositiveInteger(input.keyVersion)
  const derived = deriveCustomerAuthCapability({
    keyring: input.keyring,
    purpose: "refresh",
    intentId: credentialId,
    lineageId,
    generation: generation + 1,
    nonce: input.nonce,
    keyVersion,
  })

  assertOpaqueRefreshToken(derived.capability)
  return derived.capability
}

function minDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime()
    ? new Date(first.getTime())
    : new Date(second.getTime())
}

function refreshExpiresAt(now: Date, absoluteExpiresAt: Date): Date {
  return minDate(
    new Date(now.getTime() + AUTH_REFRESH_INACTIVITY_MS),
    absoluteExpiresAt
  )
}

function assertRefreshCanBeIssued(
  now: Date,
  absoluteExpiresAt: Date
): Date {
  const expiresAt = refreshExpiresAt(now, absoluteExpiresAt)
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AuthSessionError("AUTH_SESSION_DEADLINE_REACHED")
  }

  return expiresAt
}

function makeId(
  idFactory: AuthSessionIdFactory | undefined,
  prefix: string
): string {
  const id = (idFactory ?? DEFAULT_ID_FACTORY)(prefix)
  return requireIdentifier(id)
}

function makeNonce(randomBytesFn?: AuthSessionRandomBytes): Buffer {
  return generateCustomerAuthCapabilityNonce(randomBytesFn)
}

async function readRefreshByHash(
  transaction: AuthSessionTransaction,
  tokenHash: string
): Promise<RefreshRow | null> {
  const result = await transaction.raw(
    `select *
       from auth_refresh_credential
      where token_hash = ?
        and deleted_at is null
      for update`,
    [tokenHash]
  )
  const row = requireRawRows(result)[0]
  return row ? parseRefresh(row) : null
}

async function readLineage(
  transaction: AuthSessionTransaction,
  lineageId: string
): Promise<LineageRow | null> {
  const result = await transaction.raw(
    `select *
       from auth_session_lineage
      where id = ?
        and deleted_at is null
      for update`,
    [lineageId]
  )
  const row = requireRawRows(result)[0]
  return row ? parseLineage(row) : null
}

async function readCredential(
  transaction: AuthSessionTransaction,
  authIdentityId: string
): Promise<CredentialRow | null> {
  const result = await transaction.raw(
    `select credential_version, operation_status
       from auth_credential_state
      where auth_identity_id = ?
        and deleted_at is null
      for update`,
    [authIdentityId]
  )
  const row = requireRawRows(result)[0]
  return row ? parseCredential(row) : null
}

async function readRefreshById(
  transaction: AuthSessionTransaction,
  refreshId: string
): Promise<RefreshRow | null> {
  const result = await transaction.raw(
    `select *
       from auth_refresh_credential
      where id = ?
        and deleted_at is null
      for update`,
    [refreshId]
  )
  const row = requireRawRows(result)[0]
  return row ? parseRefresh(row) : null
}

async function readParentRefresh(
  transaction: AuthSessionTransaction,
  childId: string,
  lineageId: string
): Promise<RefreshRow | null> {
  const result = await transaction.raw(
    `select *
       from auth_refresh_credential
      where replacement_id = ?
        and lineage_id = ?
        and deleted_at is null
      for update`,
    [childId, lineageId]
  )
  const row = requireRawRows(result)[0]
  return row ? parseRefresh(row) : null
}

async function revokeRefreshRows(
  transaction: AuthSessionTransaction,
  lineageId: string,
  now: Date,
  replayCredentialId?: string
): Promise<void> {
  const excludeReplay = replayCredentialId
    ? "and id <> ?"
    : ""
  const bindings = replayCredentialId
    ? [now, now, lineageId, replayCredentialId]
    : [now, now, lineageId]
  await transaction.raw(
    `update auth_refresh_credential
        set status = 'revoked',
            replacement_id = null,
            request_key_hash = null,
            consumed_at = null,
            recovery_until = null,
            replacement_used_at = null,
            replayed_at = null,
            revoked_at = ?,
            version = version + 1,
            updated_at = ?
      where lineage_id = ?
        and deleted_at is null
        and status <> 'revoked'
        ${excludeReplay}`,
    bindings
  )

  if (!replayCredentialId) {
    return
  }

  const replayed = await readRefreshById(transaction, replayCredentialId)
  if (!replayed) {
    return
  }

  if (
    replayed.status === "consumed" ||
    replayed.status === "replayed"
  ) {
    await transaction.raw(
      `update auth_refresh_credential
          set status = 'replayed',
              replayed_at = ?,
              revoked_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and lineage_id = ?
          and deleted_at is null`,
      [now, now, replayCredentialId, lineageId]
    )
  } else if (replayed.status === "active") {
    await transaction.raw(
      `update auth_refresh_credential
          set status = 'revoked',
              replacement_id = null,
              request_key_hash = null,
              consumed_at = null,
              recovery_until = null,
              replacement_used_at = null,
              replayed_at = null,
              revoked_at = ?,
              version = version + 1,
              updated_at = ?
        where id = ?
          and lineage_id = ?
          and deleted_at is null`,
      [now, now, replayCredentialId, lineageId]
    )
  }
}

async function revokeLineageRows(
  transaction: AuthSessionTransaction,
  lineage: LineageRow,
  now: Date,
  reason: RevokeAuthSessionLineageInput["reason"],
  replayCredentialId?: string
): Promise<void> {
  await revokeRefreshRows(transaction, lineage.id, now, replayCredentialId)
  await transaction.raw(
    `update auth_session_lineage
        set status = 'revoked',
            revoked_at = ?,
            revocation_reason = ?,
            expired_at = null,
            version = version + 1,
            updated_at = ?
      where id = ?
        and deleted_at is null`,
    [now, reason, now, lineage.id]
  )
}

async function expireLineageRows(
  transaction: AuthSessionTransaction,
  lineage: LineageRow,
  now: Date
): Promise<void> {
  await revokeRefreshRows(transaction, lineage.id, now)
  await transaction.raw(
    `update auth_session_lineage
        set status = 'expired',
            revoked_at = null,
            revocation_reason = null,
            expired_at = ?,
            version = version + 1,
            updated_at = ?
      where id = ?
        and deleted_at is null`,
    [now, now, lineage.id]
  )
}

async function revokeOrExpireForDeadline(
  transaction: AuthSessionTransaction,
  lineage: LineageRow,
  now: Date
): Promise<void> {
  await expireLineageRows(transaction, lineage, now)
}

function assertCredentialAllowsRefresh(
  lineage: LineageRow,
  credential: CredentialRow | null
): void {
  if (!credential) {
    throw new AuthSessionError("AUTH_SESSION_CREDENTIAL_STATE_UNAVAILABLE")
  }

  if (
    credential.credential_version !== lineage.credential_version_snapshot ||
    credential.operation_status !== "stable"
  ) {
    throw new AuthSessionError("AUTH_SESSION_AUTHENTICATION_REQUIRED")
  }
}

function successEnvelope(
  outcome: Extract<TransactionOutcome, { type: "success" }>,
  jwtSecret: string
): AuthSessionEnvelope {
  const access: IssuedCustomerAuthAccessToken =
    issueCustomerAuthAccessToken({
      secret: requireSecret(jwtSecret),
      authIdentityId: outcome.lineage.auth_identity_id,
      customerId: outcome.lineage.customer_id,
      sid: outcome.lineage.sid,
      credentialVersion: outcome.lineage.credential_version_snapshot,
      originalAuthenticatedAt: outcome.lineage.original_authenticated_at,
      absoluteExpiresAt: outcome.lineage.absolute_expires_at,
      now: outcome.now,
    })

  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: outcome.refreshToken,
    refreshExpiresAt: outcome.refresh.expires_at,
    originalAuthenticatedAt: outcome.lineage.original_authenticated_at,
    absoluteExpiresAt: outcome.lineage.absolute_expires_at,
    lineageId: outcome.lineage.id,
    refreshCredentialId: outcome.refresh.id,
    sid: outcome.lineage.sid,
    generation: outcome.refresh.generation,
    authIdentityId: outcome.lineage.auth_identity_id,
    customerId: outcome.lineage.customer_id,
    credentialVersion: outcome.lineage.credential_version_snapshot,
    rotation: outcome.rotation,
  }
}

function throwOutcomeFailure(outcome: Extract<TransactionOutcome, { type: "failure" }>): never {
  throw new AuthSessionError(outcome.code)
}

export async function issueInitialAuthSession(
  database: AuthSessionDatabase,
  input: IssueInitialAuthSessionInput
): Promise<AuthSessionEnvelope> {
  const authIdentityId = requireIdentifier(input.authIdentityId)
  const customerId = requireIdentifier(input.customerId)
  const credentialVersion = requirePositiveInteger(input.credentialVersion)
  const now = requireDate(input.now ?? new Date())
  const originalAuthenticatedAt = requireDate(
    input.originalAuthenticatedAt ?? now
  )
  const keyring = input.keyring
  const jwtSecret = requireSecret(input.jwtSecret)
  const idFactory = input.idFactory
  const nonce = makeNonce(input.randomBytesFn)
  const lineageId = makeId(idFactory, "authlin")
  const sid = makeId(idFactory, "authsid")
  const refreshCredentialId = makeId(idFactory, "authref")
  const absoluteExpiresAt = new Date(
    originalAuthenticatedAt.getTime() + AUTH_SESSION_ABSOLUTE_MS
  )
  const refreshExpiresAt = assertRefreshCanBeIssued(
    now,
    absoluteExpiresAt
  )
  const refreshToken = deriveAuthRefreshToken({
    keyring,
    credentialId: refreshCredentialId,
    lineageId,
    generation: 0,
    nonce,
    keyVersion: keyring.active.version,
  })
  const tokenHash = hashAuthRefreshToken(refreshToken)

  const outcome = await database.transaction(async (transaction) => {
    await transaction.raw(
      `insert into auth_session_lineage (
         id, sid, auth_identity_id, customer_id,
         credential_version_snapshot, status, version,
         original_authenticated_at, absolute_expires_at,
         revoked_at, revocation_reason, expired_at,
         schema_version, created_at
       ) values (?, ?, ?, ?, ?, 'active', 1, ?, ?, null, null, null, 1, ?)`,
      [
        lineageId,
        sid,
        authIdentityId,
        customerId,
        credentialVersion,
        originalAuthenticatedAt,
        absoluteExpiresAt,
        now,
      ]
    )

    await transaction.raw(
      `insert into auth_refresh_credential (
         id, lineage_id, token_hash, generation, status,
         replacement_id, request_key_hash, nonce, key_version,
         expires_at, consumed_at, recovery_until, replacement_used_at,
         replayed_at, revoked_at, schema_version, created_at
       ) values (?, ?, ?, 0, 'active', null, null, ?, ?, ?, null, null, null, null, null, 1, ?)`,
      [
        refreshCredentialId,
        lineageId,
        tokenHash,
        nonce.toString("base64url"),
        keyring.active.version,
        refreshExpiresAt,
        now,
      ]
    )

    return {
      type: "success" as const,
      lineage: {
        id: lineageId,
        sid,
        auth_identity_id: authIdentityId,
        customer_id: customerId,
        credential_version_snapshot: credentialVersion,
        status: "active" as const,
        version: 1,
        original_authenticated_at: originalAuthenticatedAt,
        absolute_expires_at: absoluteExpiresAt,
      },
      refresh: {
        id: refreshCredentialId,
        lineage_id: lineageId,
        token_hash: tokenHash,
        generation: 0,
        status: "active" as const,
        replacement_id: null,
        request_key_hash: null,
        nonce: nonce.toString("base64url"),
        key_version: keyring.active.version,
        expires_at: refreshExpiresAt,
        consumed_at: null,
        recovery_until: null,
        replacement_used_at: null,
        replayed_at: null,
        revoked_at: null,
        version: 1,
      },
      refreshToken,
      rotation: "initial" as const,
      now,
    }
  })

  return successEnvelope(outcome, jwtSecret)
}

async function rotateInTransaction(
  transaction: AuthSessionTransaction,
  input: {
    refreshToken: string
    requestKeyHash: string
    keyring: CapabilityKeyring
    now: Date
  } & AuthSessionMutationOptions
): Promise<TransactionOutcome> {
  const tokenHash = hashAuthRefreshToken(input.refreshToken)
  const current = await readRefreshByHash(transaction, tokenHash)
  if (!current) {
    return {
      type: "failure",
      code: "AUTH_SESSION_AUTHENTICATION_REQUIRED",
      now: input.now,
    }
  }

  const lineage = await readLineage(transaction, current.lineage_id)
  if (!lineage) {
    await transaction.raw(
      `update auth_refresh_credential
          set status = 'revoked',
              revoked_at = ?,
              replacement_id = null,
              request_key_hash = null,
              consumed_at = null,
              recovery_until = null,
              replacement_used_at = null,
              replayed_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and deleted_at is null`,
      [input.now, input.now, current.id]
    )
    return {
      type: "failure",
      code: "AUTH_SESSION_AUTHENTICATION_REQUIRED",
      now: input.now,
    }
  }

  if (lineage.status === "revoked" || lineage.status === "expired") {
    return {
      type: "failure",
      code: "AUTH_SESSION_AUTHENTICATION_REQUIRED",
      now: input.now,
    }
  }

  if (input.now.getTime() >= lineage.absolute_expires_at.getTime()) {
    await revokeOrExpireForDeadline(transaction, lineage, input.now)
    return {
      type: "failure",
      code: "AUTH_SESSION_DEADLINE_REACHED",
      now: input.now,
    }
  }

  const credential = await readCredential(
    transaction,
    lineage.auth_identity_id
  )
  assertCredentialAllowsRefresh(lineage, credential)

  if (current.status === "active") {
    if (current.expires_at.getTime() <= input.now.getTime()) {
      await expireLineageRows(transaction, lineage, input.now)
      return {
        type: "failure",
        code: "AUTH_SESSION_DEADLINE_REACHED",
        now: input.now,
      }
    }

    const nextId = makeId(input.idFactory, "authref")
    const nextNonce = makeNonce(input.randomBytesFn)
    const nextGeneration = current.generation + 1
    const nextExpiresAt = assertRefreshCanBeIssued(
      input.now,
      lineage.absolute_expires_at
    )
    const nextToken = deriveAuthRefreshToken({
      keyring: input.keyring,
      credentialId: nextId,
      lineageId: lineage.id,
      generation: nextGeneration,
      nonce: nextNonce,
      keyVersion: input.keyring.active.version,
    })
    const nextTokenHash = hashAuthRefreshToken(nextToken)
    const recoveryUntil = new Date(
      input.now.getTime() + AUTH_REFRESH_RECOVERY_MS
    )

    const parent = await readParentRefresh(
      transaction,
      current.id,
      lineage.id
    )
    if (parent && parent.status === "consumed") {
      await transaction.raw(
        `update auth_refresh_credential
            set replacement_used_at = ?,
                version = version + 1,
                updated_at = ?
          where id = ?
            and status = 'consumed'
            and deleted_at is null`,
        [input.now, input.now, parent.id]
      )
    }

    const consumed = await transaction.raw(
      `update auth_refresh_credential
          set status = 'consumed',
              replacement_id = ?,
              request_key_hash = ?,
              consumed_at = ?,
              recovery_until = ?,
              version = version + 1,
              updated_at = ?
        where id = ?
          and lineage_id = ?
          and generation = ?
          and status = 'active'
          and deleted_at is null
        returning id`,
      [
        nextId,
        input.requestKeyHash,
        input.now,
        recoveryUntil,
        input.now,
        current.id,
        lineage.id,
        current.generation,
      ]
    )
    if (requireRawRows(consumed).length !== 1) {
      throw new AuthSessionError("AUTH_SESSION_TRANSACTION_REQUIRED")
    }

    await transaction.raw(
      `insert into auth_refresh_credential (
         id, lineage_id, token_hash, generation, status,
         replacement_id, request_key_hash, nonce, key_version,
         expires_at, consumed_at, recovery_until, replacement_used_at,
         replayed_at, revoked_at, schema_version, created_at
       ) values (?, ?, ?, ?, 'active', null, null, ?, ?, ?, null, null, null, null, null, 1, ?)`,
      [
        nextId,
        lineage.id,
        nextTokenHash,
        nextGeneration,
        nextNonce.toString("base64url"),
        input.keyring.active.version,
        nextExpiresAt,
        input.now,
      ]
    )

    if (input.beforeCommit) {
      await input.beforeCommit()
    }
    if (
      input.faultInjector?.fire(
        AUTH_SESSION_FAULT_POINTS.REFRESH_PRE_COMMIT
      ).fired
    ) {
      throw new AuthSessionFaultError("AUTH_REFRESH_PRE_COMMIT_FAULT")
    }

    return {
      type: "success",
      lineage,
      refresh: {
        id: nextId,
        lineage_id: lineage.id,
        token_hash: nextTokenHash,
        generation: nextGeneration,
        status: "active",
        replacement_id: null,
        request_key_hash: null,
        nonce: nextNonce.toString("base64url"),
        key_version: input.keyring.active.version,
        expires_at: nextExpiresAt,
        consumed_at: null,
        recovery_until: null,
        replacement_used_at: null,
        replayed_at: null,
        revoked_at: null,
        version: 1,
      },
      refreshToken: nextToken,
      rotation: "rotated",
      now: input.now,
    }
  }

  if (current.status === "consumed") {
    const replacement = current.replacement_id
      ? await readRefreshById(transaction, current.replacement_id)
      : null
    const sameKey =
      current.request_key_hash === input.requestKeyHash &&
      current.consumed_at !== null &&
      input.now.getTime() >= current.consumed_at.getTime() &&
      current.recovery_until !== null &&
      input.now.getTime() <= current.recovery_until.getTime()
    const replacementUnused =
      replacement?.status === "active" &&
      replacement.replacement_used_at === null

    if (sameKey && replacement && replacementUnused) {
      let replacementToken: string
      try {
        replacementToken = deriveAuthRefreshToken({
          keyring: input.keyring,
          credentialId: replacement.id,
          lineageId: lineage.id,
          generation: replacement.generation,
          nonce: replacement.nonce,
          keyVersion: replacement.key_version,
        })
      } catch {
        await revokeLineageRows(
          transaction,
          lineage,
          input.now,
          "refresh_replay",
          current.id
        )
        return {
          type: "failure",
          code: "AUTH_SESSION_RECOVERY_REJECTED",
          now: input.now,
        }
      }

      return {
        type: "success",
        lineage,
        refresh: replacement,
        refreshToken: replacementToken,
        rotation: "recovered",
        now: input.now,
      }
    }

    await revokeLineageRows(
      transaction,
      lineage,
      input.now,
      "refresh_replay",
      current.id
    )
    return {
      type: "failure",
      code: "AUTH_SESSION_RECOVERY_REJECTED",
      now: input.now,
    }
  }

  await revokeLineageRows(
    transaction,
    lineage,
    input.now,
    "refresh_replay",
    current.status === "replayed" ? current.id : undefined
  )
  return {
    type: "failure",
    code: "AUTH_SESSION_RECOVERY_REJECTED",
    now: input.now,
  }
}

export async function rotateAuthRefresh(
  database: AuthSessionDatabase,
  input: RotateAuthRefreshInput
): Promise<AuthSessionEnvelope> {
  const refreshToken = assertOpaqueRefreshToken(input.refreshToken)
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey)
  const jwtSecret = requireSecret(input.jwtSecret)
  const now = requireDate(input.now ?? new Date())
  const requestKeyHash = hashAuthRefreshRequestKey(idempotencyKey)

  const outcome = await database.transaction((transaction) =>
    rotateInTransaction(transaction, {
      ...input,
      refreshToken,
      requestKeyHash,
      now,
    })
  )

  if (outcome.type === "failure") {
    throwOutcomeFailure(outcome)
  }

  if (
    input.faultInjector?.fire(
      AUTH_SESSION_FAULT_POINTS.REFRESH_COMMIT_TO_RESPONSE
    ).fired
  ) {
    throw new AuthSessionFaultError("AUTH_REFRESH_COMMIT_TO_RESPONSE_FAULT")
  }

  return successEnvelope(outcome, jwtSecret)
}

export async function revokeAuthSessionLineage(
  database: AuthSessionDatabase,
  input: RevokeAuthSessionLineageInput
): Promise<{ lineageId: string; status: "revoked" | "expired" }> {
  const lineageId = requireIdentifier(input.lineageId)
  const now = requireDate(input.now ?? new Date())

  return database.transaction(async (transaction) => {
    const lineage = await readLineage(transaction, lineageId)
    if (!lineage) {
      return { lineageId, status: "revoked" as const }
    }

    if (lineage.status === "expired") {
      await revokeRefreshRows(transaction, lineage.id, now)
      return { lineageId, status: "expired" as const }
    }

    await revokeLineageRows(transaction, lineage, now, input.reason)
    return { lineageId, status: "revoked" as const }
  })
}

export const issueAuthSession = issueInitialAuthSession
export const rotateRefreshCredential = rotateAuthRefresh
export const revokeSessionLineage = revokeAuthSessionLineage
