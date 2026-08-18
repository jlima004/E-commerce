import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import {
  verifyCustomerAuthAccessToken,
  type AuthAccessJwtClaims,
} from "./jwt"
import type { CapabilityKeyring } from "./security/capabilities"

export const AUTH_PASSWORD_CHANGE_LEASE_MS = 2 * 60 * 1000
export const AUTH_PASSWORD_CHANGE_RETRY_MS = 60 * 1000

export type PasswordChangeRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type PasswordChangeTransaction = {
  raw(sql: string, bindings?: unknown[]): Promise<PasswordChangeRawResult>
}

export type PasswordChangeDatabase = {
  transaction<T>(
    callback: (transaction: PasswordChangeTransaction) => Promise<T>
  ): Promise<T>
}

export type PasswordChangeQueryDatabase = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<PasswordChangeRawResult>
}

export type PasswordChangePasswordProvider = {
  updatePassword(input: {
    authIdentityId: string
    password: string
  }): Promise<"updated" | "timeout" | "ambiguous">
  verifyPassword(input: {
    authIdentityId: string
    password: string
  }): Promise<boolean>
}

export type PasswordChangeCredentialRecord = {
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
  current_password_verified_at: Date | null
  provider_proved_at: Date | null
  credential_updated_at: Date | null
  revocation_committed_at: Date | null
  completed_at: Date | null
}

export type PasswordChangeHookName =
  | "before_current_password_proof"
  | "after_current_password_proof"
  | "after_claim"
  | "after_provider_update"
  | "before_version_bump"
  | "before_global_revoke"
  | "after_revoke_before_response"

export type PasswordChangeHooks = {
  onStep?: (step: PasswordChangeHookName) => Promise<void> | void
}

export type PasswordChangeInput = {
  authIdentityId: string
  customerId: string
  currentPassword: string
  newPassword: string
  idempotencyKey: string
  keyring: CapabilityKeyring
  provider: PasswordChangePasswordProvider
  mode: "fresh" | "resume"
  now?: Date
  leaseOwner?: string
  hooks?: PasswordChangeHooks
}

export type PasswordChangeResult =
  | {
      outcome: "completed"
      credentialVersion: number
    }
  | {
      outcome: "recovery_pending"
    }

export type PasswordChangeErrorCode =
  | "AUTH_PASSWORD_CHANGE_INVALID_REQUEST"
  | "AUTH_PASSWORD_CHANGE_CURRENT_PASSWORD_INVALID"
  | "AUTH_PASSWORD_CHANGE_DENIED"
  | "AUTH_PASSWORD_CHANGE_TRANSACTION_REQUIRED"

export class AuthPasswordChangeError extends Error {
  readonly code: PasswordChangeErrorCode

  constructor(code: PasswordChangeErrorCode) {
    super(code)
    this.name = "AuthPasswordChangeError"
    this.code = code
  }
}

export type PasswordChangeResumeContext = {
  lineageId: string
  sid: string
  authIdentityId: string
  customerId: string
  operationId: string
  claims: AuthAccessJwtClaims
}

export type PasswordChangeResumeDecision =
  | ({ authorized: true } & PasswordChangeResumeContext)
  | { authorized: false }

export type AuthorizePasswordChangeResumeOnlyOptions = {
  jwtSecret: string
  idempotencyKey: unknown
  keyring: CapabilityKeyring
  expectedAuthIdentityId?: string
  expectedCustomerId?: string
  now?: Date
}

type PostgresQueryConnection = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<PasswordChangeRawResult>
}

type KnexRawConnection = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<PasswordChangeRawResult>
}

type AuthResetPoolClient = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<PasswordChangeRawResult>
  release?: () => void | Promise<void>
}

type AuthResetPool = {
  connect(): Promise<AuthResetPoolClient>
}

const CREDENTIAL_COLUMNS = `id, auth_identity_id, customer_id, credential_version, email_verified_at,
                operation_type, operation_id, operation_status, operation_version, version,
                lease_owner, lease_until, attempt_count, next_retry_at,
                current_password_verified_at, provider_proved_at, credential_updated_at,
                revocation_committed_at, completed_at`

const RESUME_LOOKUP_SQL = `
select
  lineage.id as lineage_id,
  lineage.sid,
  lineage.auth_identity_id as lineage_auth_identity_id,
  lineage.customer_id as lineage_customer_id,
  credential.auth_identity_id as credential_auth_identity_id,
  credential.customer_id as credential_customer_id,
  credential.operation_type,
  credential.operation_id,
  credential.operation_status,
  credential.current_password_verified_at
from auth_session_lineage lineage
join auth_credential_state credential
  on credential.auth_identity_id = lineage.auth_identity_id
 and credential.deleted_at is null
where lineage.sid = ?
  and lineage.deleted_at is null
`

const IN_FLIGHT_STATUSES = new Set([
  "claimed",
  "provider_outcome_ambiguous",
  "credential_proved",
  "credential_updated",
  "revocation_pending",
  "revocation_committed",
])

function replaceBindings(sql: string): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

export function createPostgresPasswordChangeDatabase(
  pool: AuthResetPool
): PasswordChangeDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction: PasswordChangeTransaction = {
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

export function createPostgresPasswordChangeQueryDatabase(
  connection: PostgresQueryConnection
): PasswordChangeQueryDatabase {
  return {
    query(sql, bindings = []) {
      return connection.query(replaceBindings(sql), bindings)
    },
  }
}

export function createKnexPasswordChangeQueryDatabase(
  connection: KnexRawConnection
): PasswordChangeQueryDatabase {
  return {
    query(sql, bindings = []) {
      return connection.raw(sql, bindings)
    },
  }
}

function invalidRequest(): never {
  throw new AuthPasswordChangeError("AUTH_PASSWORD_CHANGE_INVALID_REQUEST")
}

function currentPasswordInvalid(): never {
  throw new AuthPasswordChangeError(
    "AUTH_PASSWORD_CHANGE_CURRENT_PASSWORD_INVALID"
  )
}

function denied(): never {
  throw new AuthPasswordChangeError("AUTH_PASSWORD_CHANGE_DENIED")
}

function transactionRequired(): never {
  throw new AuthPasswordChangeError("AUTH_PASSWORD_CHANGE_TRANSACTION_REQUIRED")
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

function rowsOf(result: PasswordChangeRawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function parseCredential(row: Record<string, unknown>): PasswordChangeCredentialRecord {
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
    current_password_verified_at: nullableDate(row.current_password_verified_at),
    provider_proved_at: nullableDate(row.provider_proved_at),
    credential_updated_at: nullableDate(row.credential_updated_at),
    revocation_committed_at: nullableDate(row.revocation_committed_at),
    completed_at: nullableDate(row.completed_at),
  }
}

function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 512) {
    return invalidRequest()
  }
  return value
}

function assertPassword(value: unknown): string {
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

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + AUTH_PASSWORD_CHANGE_LEASE_MS)
}

function stringField(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  return typeof value === "string" && value.length > 0 ? value : null
}

function extractBearerToken(authorization: unknown): string | null {
  if (typeof authorization !== "string") {
    return null
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  return match?.[1] ?? null
}

export function hashPasswordChangeOperationId(input: {
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
      Buffer.from(
        `customer-auth-password-change-operation-key:${keyVersion}`,
        "utf8"
      ),
      32
    )
  )
  return createHmac("sha256", derivedKey)
    .update(
      `customer-auth-password-change-operation|v1|key-version:${keyVersion}|idempotency:${idempotencyKey}`,
      "utf8"
    )
    .digest("hex")
}

async function requireUpdatedCredential(
  result: PasswordChangeRawResult
): Promise<PasswordChangeCredentialRecord> {
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : transactionRequired()
}

async function readCredentialForUpdate(
  transaction: PasswordChangeTransaction,
  authIdentityId: string
): Promise<PasswordChangeCredentialRecord | null> {
  const result = await transaction.raw(
    `select ${CREDENTIAL_COLUMNS}
       from auth_credential_state
      where auth_identity_id = ?
        and deleted_at is null
      for update`,
    [authIdentityId]
  )
  const row = rowsOf(result)[0]
  return row ? parseCredential(row) : null
}

async function claimFresh(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  operationId: string,
  leaseOwner: string,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  return requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'claimed',
              operation_type = 'password_change',
              operation_id = ?,
              current_password_verified_at = ?,
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
          and current_password_verified_at is null
          and provider_proved_at is null
          and credential_updated_at is null
          and revocation_committed_at is null
          and completed_at is null
          and credential_version = ?
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [
        operationId,
        now,
        leaseOwner,
        leaseUntil(now),
        now,
        credential.id,
        credential.credential_version,
      ]
    )
  )
}

async function persistProviderProof(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  if (credential.provider_proved_at) {
    return credential
  }
  return requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'credential_proved',
              provider_proved_at = ?,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'password_change'
          and operation_status in ('claimed', 'provider_outcome_ambiguous')
          and current_password_verified_at is not null
          and provider_proved_at is null
          and credential_updated_at is null
          and revocation_committed_at is null
          and completed_at is null
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [now, now, credential.id]
    )
  )
}

async function persistCredentialUpdated(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  if (credential.credential_updated_at) {
    return credential
  }
  return requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'credential_updated',
              credential_updated_at = ?,
              credential_version = credential_version + 1,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'password_change'
          and operation_status = 'credential_proved'
          and current_password_verified_at is not null
          and provider_proved_at is not null
          and credential_updated_at is null
          and revocation_committed_at is null
          and completed_at is null
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [now, now, credential.id]
    )
  )
}

async function revokeAllLineages(
  transaction: PasswordChangeTransaction,
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
            revocation_reason = 'password_change',
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
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  if (credential.revocation_committed_at) {
    return credential
  }
  return requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = 'revocation_committed',
              revocation_committed_at = ?,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'password_change'
          and operation_status = 'credential_updated'
          and current_password_verified_at is not null
          and provider_proved_at is not null
          and credential_updated_at is not null
          and revocation_committed_at is null
          and completed_at is null
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [now, now, credential.id]
    )
  )
}

async function completeAndStabilize(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  return requireUpdatedCredential(
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
          and operation_type = 'password_change'
          and operation_status = 'revocation_committed'
          and current_password_verified_at is not null
          and provider_proved_at is not null
          and credential_updated_at is not null
          and revocation_committed_at is not null
          and completed_at is null
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [now, credential.id]
    )
  )
}

async function markFailedReconcilable(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<void> {
  await transaction.raw(
    `update auth_credential_state
        set operation_status = 'provider_outcome_ambiguous',
            next_retry_at = ?,
            lease_owner = null,
            lease_until = null,
            version = version + 1,
            updated_at = ?
      where id = ?
        and operation_type = 'password_change'
        and operation_status in ('claimed', 'credential_proved', 'credential_updated', 'revocation_committed', 'provider_outcome_ambiguous')
        and current_password_verified_at is not null
        and completed_at is null
        and deleted_at is null`,
    [new Date(now.getTime() + AUTH_PASSWORD_CHANGE_RETRY_MS), now, credential.id]
  )
}

async function resumeInFlight(
  transaction: PasswordChangeTransaction,
  credential: PasswordChangeCredentialRecord,
  now: Date
): Promise<PasswordChangeCredentialRecord> {
  if (credential.operation_status !== "provider_outcome_ambiguous") {
    return credential
  }
  const nextStatus = credential.revocation_committed_at
    ? "revocation_committed"
    : credential.credential_updated_at
      ? "credential_updated"
      : credential.provider_proved_at
        ? "credential_proved"
        : "claimed"
  return requireUpdatedCredential(
    await transaction.raw(
      `update auth_credential_state
          set operation_status = ?,
              next_retry_at = null,
              version = version + 1,
              updated_at = ?
        where id = ?
          and operation_type = 'password_change'
          and operation_status = 'provider_outcome_ambiguous'
          and current_password_verified_at is not null
          and completed_at is null
          and deleted_at is null
        returning ${CREDENTIAL_COLUMNS}`,
      [nextStatus, now, credential.id]
    )
  )
}

async function proveRecoveryPassword(
  provider: PasswordChangePasswordProvider,
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

async function runHook(
  hooks: PasswordChangeHooks | undefined,
  step: PasswordChangeHookName
): Promise<void> {
  await hooks?.onStep?.(step)
}

export async function authorizePasswordChangeResumeOnly(
  database: PasswordChangeQueryDatabase,
  authorization: unknown,
  options: AuthorizePasswordChangeResumeOnlyOptions
): Promise<PasswordChangeResumeDecision> {
  const token = extractBearerToken(authorization)
  const idempotencyKey =
    typeof options.idempotencyKey === "string" ? options.idempotencyKey : null
  if (!token || !idempotencyKey) {
    return { authorized: false }
  }

  let claims: AuthAccessJwtClaims
  const now = options.now ?? new Date()
  try {
    claims = verifyCustomerAuthAccessToken(token, {
      secret: options.jwtSecret,
      now,
    })
  } catch {
    return { authorized: false }
  }

  let operationId: string
  try {
    operationId = hashPasswordChangeOperationId({
      keyring: options.keyring,
      idempotencyKey,
    })
  } catch {
    return { authorized: false }
  }

  let rows: Array<Record<string, unknown>>
  try {
    const result = await database.query(RESUME_LOOKUP_SQL, [claims.sid])
    rows = result.rows ?? []
  } catch {
    return { authorized: false }
  }

  if (rows.length !== 1) {
    return { authorized: false }
  }

  const row = rows[0]!
  const lineageId = stringField(row, "lineage_id")
  const sid = stringField(row, "sid")
  const lineageIdentityId = stringField(row, "lineage_auth_identity_id")
  const credentialIdentityId = stringField(row, "credential_auth_identity_id")
  const lineageCustomerId = stringField(row, "lineage_customer_id")
  const credentialCustomerId = stringField(row, "credential_customer_id")
  const operationIdRow = stringField(row, "operation_id")

  if (
    !lineageId ||
    sid !== claims.sid ||
    lineageIdentityId !== claims.auth_identity_id ||
    credentialIdentityId !== claims.auth_identity_id ||
    lineageCustomerId !== claims.customer_id ||
    credentialCustomerId !== claims.customer_id ||
    row.operation_type !== "password_change" ||
    !operationIdRow ||
    !sameDigest(operationIdRow, operationId) ||
    !row.current_password_verified_at ||
    !IN_FLIGHT_STATUSES.has(String(row.operation_status)) ||
    (options.expectedAuthIdentityId &&
      options.expectedAuthIdentityId !== claims.auth_identity_id) ||
    (options.expectedCustomerId &&
      options.expectedCustomerId !== claims.customer_id)
  ) {
    return { authorized: false }
  }

  return {
    authorized: true,
    lineageId,
    sid: claims.sid,
    authIdentityId: claims.auth_identity_id,
    customerId: claims.customer_id,
    operationId,
    claims,
  }
}

export async function changePassword(
  database: PasswordChangeDatabase,
  input: PasswordChangeInput
): Promise<PasswordChangeResult> {
  const authIdentityId = requireIdentifier(input.authIdentityId)
  const customerId = requireIdentifier(input.customerId)
  const currentPassword = assertPassword(input.currentPassword)
  const newPassword = assertPassword(input.newPassword)
  const operationId = hashPasswordChangeOperationId({
    keyring: input.keyring,
    idempotencyKey: input.idempotencyKey,
  })
  const now = requireDate(input.now ?? new Date())
  const leaseOwner = requireIdentifier(
    input.leaseOwner ?? `authlease_${operationId.slice(0, 24)}`
  )

  await runHook(input.hooks, "before_current_password_proof")

  if (input.mode === "fresh") {
    let currentMatches = false
    try {
      currentMatches = await input.provider.verifyPassword({
        authIdentityId,
        password: currentPassword,
      })
    } catch {
      return denied()
    }
    if (!currentMatches) {
      return currentPasswordInvalid()
    }
    await runHook(input.hooks, "after_current_password_proof")
  }

  const prepared = await database.transaction(async (transaction) => {
    const credential = await readCredentialForUpdate(transaction, authIdentityId)
    if (!credential || credential.customer_id !== customerId) {
      return { denied: true as const }
    }

    if (input.mode === "fresh" && credential.operation_status === "stable") {
      const claimed = await claimFresh(
        transaction,
        credential,
        operationId,
        leaseOwner,
        now
      )
      return {
        ready: {
          phase: "fresh_claim" as const,
          credential: claimed,
        },
      }
    }

    if (
      credential.operation_type !== "password_change" ||
      !credential.operation_id ||
      !sameDigest(credential.operation_id, operationId) ||
      !credential.current_password_verified_at ||
      !IN_FLIGHT_STATUSES.has(credential.operation_status)
    ) {
      return { denied: true as const }
    }

    if (input.mode === "fresh") {
      return { denied: true as const }
    }

    return {
      ready: {
        phase: "resume" as const,
        credential,
      },
    }
  })

  if ("denied" in prepared) {
    return denied()
  }

  const { phase } = prepared.ready

  let proof: "proved" | "ambiguous"
  try {
    await runHook(input.hooks, "after_claim")
    if (phase === "fresh_claim") {
      const updated = await input.provider.updatePassword({
        authIdentityId,
        password: newPassword,
      })
      if (updated !== "updated") {
        proof = "ambiguous"
      } else {
        await runHook(input.hooks, "after_provider_update")
        const proved = await input.provider.verifyPassword({
          authIdentityId,
          password: newPassword,
        })
        proof = proved ? "proved" : "ambiguous"
      }
    } else {
      proof = await proveRecoveryPassword(
        input.provider,
        authIdentityId,
        newPassword
      )
    }
  } catch {
    proof = "ambiguous"
  }

  if (proof !== "proved") {
    await database.transaction(async (transaction) => {
      const locked = await readCredentialForUpdate(transaction, authIdentityId)
      if (locked) {
        await markFailedReconcilable(transaction, locked, now)
      }
    })
    return { outcome: "recovery_pending" }
  }

  try {
    await database.transaction(async (transaction) => {
      const locked = await readCredentialForUpdate(transaction, authIdentityId)
      if (!locked) {
        return transactionRequired()
      }
      const resumed = await resumeInFlight(transaction, locked, now)
      await persistProviderProof(transaction, resumed, now)
    })
    await runHook(input.hooks, "before_version_bump")
    await database.transaction(async (transaction) => {
      const locked = await readCredentialForUpdate(transaction, authIdentityId)
      if (!locked) {
        return transactionRequired()
      }
      const resumed = await resumeInFlight(transaction, locked, now)
      await persistCredentialUpdated(transaction, resumed, now)
    })
    await runHook(input.hooks, "before_global_revoke")
    await database.transaction(async (transaction) => {
      const locked = await readCredentialForUpdate(transaction, authIdentityId)
      if (!locked) {
        return transactionRequired()
      }
      const resumed = await resumeInFlight(transaction, locked, now)
      await revokeAllLineages(transaction, authIdentityId, now)
      await persistRevocationCommitted(transaction, resumed, now)
    })
    await runHook(input.hooks, "after_revoke_before_response")
    const completed = await database.transaction(async (transaction) => {
      const locked = await readCredentialForUpdate(transaction, authIdentityId)
      if (!locked) {
        return transactionRequired()
      }
      const resumed = await resumeInFlight(transaction, locked, now)
      return completeAndStabilize(transaction, resumed, now)
    })
    return {
      outcome: "completed",
      credentialVersion: completed.credential_version,
    }
  } catch {
    await database
      .transaction(async (transaction) => {
        const locked = await readCredentialForUpdate(transaction, authIdentityId)
        if (locked && locked.operation_status !== "stable") {
          await markFailedReconcilable(transaction, locked, now)
        }
      })
      .catch(() => undefined)
    return { outcome: "recovery_pending" }
  }
}
