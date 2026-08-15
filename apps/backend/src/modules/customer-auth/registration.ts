import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, createHmac, hkdfSync } from "node:crypto"
import { generateEntityId } from "@medusajs/framework/utils"
import {
  resolveCustomerAuthTransactionalKnex,
  type CustomerAuthTransactionalRepositoryLike,
} from "../../infrastructure/customer-auth-transaction-compatibility"
import { normalizeCustomerAuthEmail } from "./security/email-normalization"
import type {
  CapabilityKey,
} from "./security/capabilities"
import {
  CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS,
  CUSTOMER_AUTH_SCHEMA_VERSION,
  REGISTRATION_INTENT_STATUSES,
  type RegistrationIntentStatus,
} from "./types"
import type { AuthSessionEnvelope } from "./session"

export const REGISTRATION_FAULT_POINTS = {
  BEFORE_IDENTITY: "before_identity",
  AFTER_IDENTITY_BEFORE_CUSTOMER: "after_identity_before_customer",
  AFTER_CUSTOMER_BEFORE_LINEAGE: "after_customer_before_lineage",
  AFTER_LINEAGE_BEFORE_VERIFICATION: "after_lineage_before_verification",
  AFTER_VERIFICATION_BEFORE_COMPLETION:
    "after_verification_before_completion",
} as const

export type RegistrationFaultPoint =
  (typeof REGISTRATION_FAULT_POINTS)[keyof typeof REGISTRATION_FAULT_POINTS]

export type RegistrationFaultInjector = {
  fire(point: RegistrationFaultPoint): { fired: boolean }
}

export type RegistrationKeyring = {
  active: CapabilityKey
  previous: readonly CapabilityKey[]
}

export type RegistrationRawResult = {
  rows?: Array<Record<string, unknown>>
  rowCount?: number | null
}

export type RegistrationCustomerData = {
  first_name: string
  last_name: string
  email?: string
}

export type CustomerRegistrationRequest = {
  email: string
  password: string
  customerData: RegistrationCustomerData
  keyring: RegistrationKeyring
  jwtSecret: string
  now?: Date
}

export type RegistrationIntentRecord = {
  id: string
  normalized_email_hash: string
  semantic_payload_hmac: string
  payload_key_version: number
  auth_identity_id: string | null
  customer_id: string | null
  status: RegistrationIntentStatus
  version: number
  expires_at: Date
  completed_at: Date | null
  schema_version: number
  created_at: Date
  updated_at: Date
}

export type RegistrationIntentClaimInput = {
  id: string
  normalizedEmailHash: string
  semanticPayloadHmac: string
  payloadKeyVersion: number
  now: Date
  expiresAt: Date
}

export type RegistrationIntentClaimResult = {
  created: boolean
  expired: boolean
  intent: RegistrationIntentRecord
}

export type RegistrationIntentTransitionInput = {
  id: string
  expectedVersion: number
  status: RegistrationIntentStatus
  authIdentityId: string | null
  customerId: string | null
  completedAt: Date | null
  at: Date
}

export type RegistrationCredentialStateInput = {
  id: string
  authIdentityId: string
  customerId: string
  at: Date
}

export type RegistrationCredentialStateRecord = {
  id: string
  auth_identity_id: string
  customer_id: string
  credential_version: number
}

export type RegistrationTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<RegistrationRawResult>
  claimOrCreateIntent(
    input: RegistrationIntentClaimInput
  ): Promise<RegistrationIntentClaimResult>
  transitionIntent(
    input: RegistrationIntentTransitionInput
  ): Promise<RegistrationIntentRecord>
  ensureCredentialState(
    input: RegistrationCredentialStateInput
  ): Promise<RegistrationCredentialStateRecord>
}

export type RegistrationDatabase = {
  transaction<T>(
    callback: (transaction: RegistrationTransaction) => Promise<T>
  ): Promise<T>
}

export type RegistrationAuthIdentity = {
  id: string
  app_metadata?: Record<string, unknown> | null
}

export type RegistrationAuth = {
  findIdentity(input: {
    normalizedEmail: string
  }): Promise<RegistrationAuthIdentity | null>
  authenticate(input: {
    normalizedEmail: string
    email: string
    password: string
  }): Promise<RegistrationAuthIdentity | null>
  register(input: {
    normalizedEmail: string
    email: string
    password: string
  }): Promise<RegistrationAuthIdentity | null>
}

export type RegistrationCustomerRecord = {
  id: string
  email?: string
  first_name?: string | null
  last_name?: string | null
}

export type RegistrationCustomer = {
  find(input: {
    authIdentityId: string
    normalizedEmail: string
    authIdentity: RegistrationAuthIdentity
  }): Promise<RegistrationCustomerRecord | null>
  create(input: {
    authIdentityId: string
    normalizedEmail: string
    customerData: RegistrationCustomerData
  }): Promise<RegistrationCustomerRecord | null>
}

export type RegistrationSessionInput = {
  authIdentityId: string
  customerId: string
  credentialVersion: number
  keyring: RegistrationKeyring
  jwtSecret: string
  now: Date
}

export type RegistrationSession = AuthSessionEnvelope

export type RegistrationSessionService = {
  findInitial(input: RegistrationSessionInput): Promise<RegistrationSession | null>
  issueInitial(input: RegistrationSessionInput): Promise<RegistrationSession>
}

export type RegistrationVerificationInput = {
  authIdentityId: string
  normalizedEmail: string
  keyring: RegistrationKeyring
  now: Date
}

export type RegistrationVerificationResult = {
  state: "pending" | "verified" | "unknown"
  intentId: string | null
  outboxId: string | null
}

export type RegistrationVerification = {
  autoRequest(
    input: RegistrationVerificationInput
  ): Promise<RegistrationVerificationResult>
}

export type CustomerRegistrationResult = {
  status: "completed"
  registrationIntentId: string
  authIdentityId: string
  customerId: string
  session: RegistrationSession
  verification: RegistrationVerificationResult
}

export type CustomerRegistrationCoordinatorInput = {
  request: CustomerRegistrationRequest
  database: RegistrationDatabase
  auth: RegistrationAuth
  customer: RegistrationCustomer
  session: RegistrationSessionService
  verification: RegistrationVerification
  idFactory?: (prefix: string) => string
  faultInjector?: RegistrationFaultInjector
  /**
   * Kept in the coordinator contract to make provider independence explicit.
   * The registration coordinator records an outbox only; it never invokes
   * delivery.
   */
  providerDelivery?: () => Promise<void>
}

export type RegistrationErrorCode =
  | "CUSTOMER_REGISTRATION_INVALID_REQUEST"
  | "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH"
  | "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH"
  | "CUSTOMER_REGISTRATION_EXPIRED"
  | "CUSTOMER_REGISTRATION_ALREADY_COMPLETED"
  | "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
  | "CUSTOMER_REGISTRATION_PROVIDER_FAILURE"
  | "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
  | "CUSTOMER_REGISTRATION_SESSION_FAILURE"
  | "CUSTOMER_REGISTRATION_VERIFICATION_FAILURE"

export class CustomerRegistrationError extends Error {
  readonly code: RegistrationErrorCode
  readonly registrationIntentId?: string

  constructor(code: RegistrationErrorCode, registrationIntentId?: string) {
    super(code)
    this.name = "CustomerRegistrationError"
    this.code = code
    this.registrationIntentId = registrationIntentId
  }
}

const DEFAULT_ID_FACTORY = (prefix: string): string =>
  generateEntityId(undefined, prefix)

const activeRegistrationRaw =
  new AsyncLocalStorage<RegistrationTransaction["raw"]>()

export function runWithRegistrationTransactionRaw<T>(
  raw: RegistrationTransaction["raw"],
  callback: () => Promise<T>
): Promise<T> {
  return activeRegistrationRaw.run(raw, callback)
}

export function requireActiveRegistrationTransactionRaw(): RegistrationTransaction["raw"] {
  const raw = activeRegistrationRaw.getStore()
  if (!raw) {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
    )
  }
  return raw
}

export function createScopedRegistrationDatabase(
  inner: RegistrationDatabase
): RegistrationDatabase {
  return {
    transaction(callback) {
      return inner.transaction((transaction) =>
        runWithRegistrationTransactionRaw(
          (sql, bindings) => transaction.raw(sql, bindings),
          () => callback(transaction)
        )
      )
    },
  }
}

const REGISTRATION_TTL_MS =
  CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS * 1000

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_INVALID_REQUEST"
    )
  }
  return new Date(value.getTime())
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_INVALID_REQUEST"
    )
  }
  return value
}

function requirePositiveInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_INVALID_REQUEST"
    )
  }
  return parsed
}

function requireRows(result: RegistrationRawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireString(value)
}

function dateFromRow(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime())
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  throw new CustomerRegistrationError(
    "CUSTOMER_REGISTRATION_INVALID_REQUEST"
  )
}

function parseRegistrationIntent(
  row: Record<string, unknown>
): RegistrationIntentRecord {
  const status = requireString(row.status)
  if (!REGISTRATION_INTENT_STATUSES.includes(status as RegistrationIntentStatus)) {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_INVALID_REQUEST"
    )
  }

  return {
    id: requireString(row.id),
    normalized_email_hash: requireString(row.normalized_email_hash),
    semantic_payload_hmac: requireString(row.semantic_payload_hmac),
    payload_key_version: requirePositiveInteger(row.payload_key_version),
    auth_identity_id: nullableString(row.auth_identity_id),
    customer_id: nullableString(row.customer_id),
    status: status as RegistrationIntentStatus,
    version: requirePositiveInteger(row.version),
    expires_at: dateFromRow(row.expires_at),
    completed_at:
      row.completed_at === null || row.completed_at === undefined
        ? null
        : dateFromRow(row.completed_at),
    schema_version: requirePositiveInteger(row.schema_version),
    created_at: dateFromRow(row.created_at),
    updated_at: dateFromRow(row.updated_at),
  }
}

function parseCredentialState(
  row: Record<string, unknown>
): RegistrationCredentialStateRecord {
  return {
    id: requireString(row.id),
    auth_identity_id: requireString(row.auth_identity_id),
    customer_id: requireString(row.customer_id),
    credential_version: requirePositiveInteger(row.credential_version),
  }
}

function replaceBindings(sql: string): string {
  let parameter = 0
  return sql.replace(/\?/g, () => `$${++parameter}`)
}

function advisoryLockParts(normalizedEmailHash: string): [number, number] {
  const digest = createHash("sha256")
    .update(`customer-auth-registration:${normalizedEmailHash}`, "utf8")
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

type RegistrationRaw = (
  sql: string,
  bindings?: unknown[]
) => Promise<RegistrationRawResult> | RegistrationRawResult

function createRegistrationTransaction(raw: RegistrationRaw): RegistrationTransaction {
  return {
    async raw(sql, bindings = []) {
      return raw(sql, bindings)
    },
    async claimOrCreateIntent(input) {
      const [classId, objectId] = advisoryLockParts(input.normalizedEmailHash)
      await raw("select pg_advisory_xact_lock(?, ?)", [classId, objectId])

      const existingRows = requireRows(
        await raw(
          `select *
             from registration_intent
            where normalized_email_hash = ?
              and deleted_at is null
              and status <> 'expired'
            order by created_at desc, id desc
            limit 1
            for update`,
          [input.normalizedEmailHash]
        )
      )
      const existing = existingRows[0]
        ? parseRegistrationIntent(existingRows[0])
        : null

      if (existing) {
        const isExpirable =
          existing.status === "pending_identity" ||
          existing.status === "pending_customer" ||
          existing.status === "failed_reconcilable"
        if (isExpirable && existing.expires_at.getTime() <= input.now.getTime()) {
          const expiredRows = requireRows(
            await raw(
              `update registration_intent
                  set status = 'expired',
                      version = version + 1,
                      updated_at = ?
                where id = ?
                  and status in (
                    'pending_identity',
                    'pending_customer',
                    'failed_reconcilable'
                  )
                  and expires_at <= ?
                  and deleted_at is null
                returning *`,
              [input.now, existing.id, input.now]
            )
          )
          const expired = expiredRows[0]
            ? parseRegistrationIntent(expiredRows[0])
            : existing
          return { created: false, expired: true, intent: expired }
        }

        return { created: false, expired: false, intent: existing }
      }

      const insertedRows = requireRows(
        await raw(
          `insert into registration_intent (
             id,
             normalized_email_hash,
             semantic_payload_hmac,
             payload_key_version,
             auth_identity_id,
             customer_id,
             status,
             version,
             expires_at,
             completed_at,
             schema_version,
             created_at,
             updated_at
           ) values (?, ?, ?, ?, null, null, 'pending_identity', 1, ?, null, ?, ?, ?)
           on conflict do nothing
           returning *`,
          [
            input.id,
            input.normalizedEmailHash,
            input.semanticPayloadHmac,
            input.payloadKeyVersion,
            input.expiresAt,
            CUSTOMER_AUTH_SCHEMA_VERSION,
            input.now,
            input.now,
          ]
        )
      )

      if (insertedRows[0]) {
        return {
          created: true,
          expired: false,
          intent: parseRegistrationIntent(insertedRows[0]),
        }
      }

      const racedRows = requireRows(
        await raw(
          `select *
             from registration_intent
            where normalized_email_hash = ?
              and deleted_at is null
              and status <> 'expired'
            order by created_at desc, id desc
            limit 1
            for update`,
          [input.normalizedEmailHash]
        )
      )
      if (!racedRows[0]) {
        throw new CustomerRegistrationError(
          "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
        )
      }
      return {
        created: false,
        expired: false,
        intent: parseRegistrationIntent(racedRows[0]),
      }
    },

    async transitionIntent(input) {
      const updatedRows = requireRows(
        await raw(
          `update registration_intent
              set status = ?,
                  auth_identity_id = ?,
                  customer_id = ?,
                  completed_at = ?,
                  version = version + 1,
                  updated_at = ?
            where id = ?
              and version = ?
              and deleted_at is null
            returning *`,
          [
            input.status,
            input.authIdentityId,
            input.customerId,
            input.completedAt,
            input.at,
            input.id,
            input.expectedVersion,
          ]
        )
      )
      if (!updatedRows[0]) {
        throw new CustomerRegistrationError(
          "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
          input.id
        )
      }
      return parseRegistrationIntent(updatedRows[0])
    },

    async ensureCredentialState(input) {
      const currentRows = requireRows(
        await raw(
          `select id, auth_identity_id, customer_id, credential_version
             from auth_credential_state
            where auth_identity_id = ?
              and deleted_at is null
            for update`,
          [input.authIdentityId]
        )
      )
      if (currentRows[0]) {
        const current = parseCredentialState(currentRows[0])
        if (current.customer_id !== input.customerId) {
          throw new CustomerRegistrationError(
            "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
          )
        }
        return current
      }

      await raw(
        `insert into auth_credential_state (
           id,
           auth_identity_id,
           customer_id,
           credential_version,
           email_verified_at,
           operation_type,
           operation_id,
           operation_status,
           operation_version,
           version,
           lease_owner,
           lease_until,
           attempt_count,
           next_retry_at,
           current_password_verified_at,
           provider_proved_at,
           credential_updated_at,
           revocation_committed_at,
           completed_at,
           schema_version,
           created_at,
           updated_at
         ) values (
           ?, ?, ?, 1, null, null, null, 'stable', 0, 1,
           null, null, 0, null, null, null, null, null, null, ?, ?, ?
         )
         on conflict do nothing`,
        [
          input.id,
          input.authIdentityId,
          input.customerId,
          CUSTOMER_AUTH_SCHEMA_VERSION,
          input.at,
          input.at,
        ]
      )

      const createdRows = requireRows(
        await raw(
          `select id, auth_identity_id, customer_id, credential_version
             from auth_credential_state
            where auth_identity_id = ?
              and deleted_at is null
            for update`,
          [input.authIdentityId]
        )
      )
      if (!createdRows[0]) {
        throw new CustomerRegistrationError(
          "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
        )
      }
      const created = parseCredentialState(createdRows[0])
      if (created.customer_id !== input.customerId) {
        throw new CustomerRegistrationError(
          "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
        )
      }
      return created
    },
  }
}

type RegistrationPoolClient = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<RegistrationRawResult>
  release?: () => void | Promise<void>
}

type RegistrationPool = {
  connect(): Promise<RegistrationPoolClient>
}

export function createPostgresRegistrationDatabase(
  pool: RegistrationPool
): RegistrationDatabase {
  return {
    async transaction<T>(callback) {
      const client = await pool.connect()
      await client.query("begin")
      const transaction = createRegistrationTransaction((sql, bindings = []) =>
        client.query(replaceBindings(sql), bindings)
      )
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

export function createRegistrationDatabaseFromRepository(
  repository: CustomerAuthTransactionalRepositoryLike
): RegistrationDatabase {
  return {
    transaction<T>(callback) {
      return repository.transaction(async (manager) => {
        const knex = resolveCustomerAuthTransactionalKnex(manager)
        return callback(
          createRegistrationTransaction((sql, bindings = []) =>
            knex.raw(sql, bindings)
          )
        )
      })
    },
  }
}

function registrationKey(
  keyring: RegistrationKeyring,
  keyVersion: number
): string {
  const key = [keyring.active, ...keyring.previous].find(
    (candidate) => candidate.version === keyVersion
  )
  if (!key) {
    throw new CustomerRegistrationError(
      "CUSTOMER_REGISTRATION_INVALID_REQUEST"
    )
  }
  return key.secret
}

function semanticName(value: unknown): string {
  return requireString(value).trim()
}

export function deriveRegistrationSemanticPayloadHmac(input: {
  keyring: RegistrationKeyring
  normalizedEmail: string
  customerData: RegistrationCustomerData
  keyVersion?: number
}): { hmac: string; keyVersion: number } {
  const normalizedEmail = normalizeCustomerAuthEmail(input.normalizedEmail)
  const keyVersion = input.keyVersion ?? input.keyring.active.version
  const secret = registrationKey(input.keyring, keyVersion)
  const semanticPayload = JSON.stringify({
    schema: `customer-registration-v${CUSTOMER_AUTH_SCHEMA_VERSION}`,
    normalized_email: normalizedEmail,
    normalized_names: {
      first_name: semanticName(input.customerData.first_name),
      last_name: semanticName(input.customerData.last_name),
    },
  })
  const derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      Buffer.from(`customer-auth-registration-key:${keyVersion}`, "utf8"),
      32
    )
  )
  const hmac = createHmac("sha256", derivedKey)
    .update(semanticPayload, "utf8")
    .digest("hex")
  return { hmac, keyVersion }
}

export function hashNormalizedCustomerAuthEmail(
  normalizedEmail: string
): string {
  return createHash("sha256")
    .update(normalizeCustomerAuthEmail(normalizedEmail), "utf8")
    .digest("hex")
}

function semanticPayloadMatches(
  intent: RegistrationIntentRecord,
  input: CustomerRegistrationRequest,
  normalizedEmail: string
): boolean {
  const keyVersions = [
    intent.payload_key_version,
    input.keyring.active.version,
    ...input.keyring.previous.map((key) => key.version),
  ]
  const uniqueVersions = [...new Set(keyVersions)]
  return uniqueVersions.some((keyVersion) => {
    try {
      const candidate = deriveRegistrationSemanticPayloadHmac({
        keyring: input.keyring,
        normalizedEmail,
        customerData: input.customerData,
        keyVersion,
      })
      return (
        candidate.keyVersion === intent.payload_key_version &&
        candidate.hmac === intent.semantic_payload_hmac
      )
    } catch {
      return false
    }
  })
}

function idFor(
  factory: ((prefix: string) => string) | undefined,
  prefix: string
): string {
  return (factory ?? DEFAULT_ID_FACTORY)(prefix)
}

function faulted(
  injector: RegistrationFaultInjector | undefined,
  point: RegistrationFaultPoint
): boolean {
  return injector?.fire(point).fired === true
}

type RegistrationRunOutcome =
  | { kind: "completed"; result: CustomerRegistrationResult }
  | { kind: "rejected"; error: CustomerRegistrationError }
  | {
      kind: "recovery"
      intentId: string
      code: RegistrationErrorCode
    }

function recovery(
  intentId: string,
  code: RegistrationErrorCode = "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED"
): RegistrationRunOutcome {
  return { kind: "recovery", intentId, code }
}

function rejected(
  error: CustomerRegistrationError
): RegistrationRunOutcome {
  return { kind: "rejected", error }
}

function recoveryError(
  outcome: Extract<RegistrationRunOutcome, { kind: "recovery" }>
): CustomerRegistrationError {
  return new CustomerRegistrationError(outcome.code, outcome.intentId)
}

function completedResult(input: {
  intent: RegistrationIntentRecord
  authIdentityId: string
  customerId: string
  session: RegistrationSession
  verification: RegistrationVerificationResult
}): CustomerRegistrationResult {
  return {
    status: "completed",
    registrationIntentId: input.intent.id,
    authIdentityId: input.authIdentityId,
    customerId: input.customerId,
    session: input.session,
    verification: input.verification,
  }
}

async function authenticateExistingIdentity(
  input: CustomerRegistrationCoordinatorInput,
  normalizedEmail: string,
  intentId: string
): Promise<
  | { identity: RegistrationAuthIdentity }
  | { outcome: RegistrationRunOutcome }
> {
  const identity = await input.auth.authenticate({
    normalizedEmail,
    email: normalizedEmail,
    password: input.request.password,
  })
  if (!identity) {
    return {
      outcome: rejected(
        new CustomerRegistrationError(
          "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH",
          intentId
        )
      ),
    }
  }
  return { identity }
}

export async function coordinateCustomerRegistration(
  input: CustomerRegistrationCoordinatorInput
): Promise<CustomerRegistrationResult> {
  const request = input.request
  const normalizedEmail = normalizeCustomerAuthEmail(request.email)
  const now = requireDate(request.now ?? new Date())
  const firstName = semanticName(request.customerData.first_name)
  const lastName = semanticName(request.customerData.last_name)
  const customerData: RegistrationCustomerData = {
    ...request.customerData,
    first_name: firstName,
    last_name: lastName,
    email: normalizedEmail,
  }
  const semanticPayload = deriveRegistrationSemanticPayloadHmac({
    keyring: request.keyring,
    normalizedEmail,
    customerData,
  })
  const normalizedEmailHash = hashNormalizedCustomerAuthEmail(normalizedEmail)
  const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS)

  const outcome = await input.database.transaction<RegistrationRunOutcome>(
    async (transaction) => {
      const claim = await transaction.claimOrCreateIntent({
        id: idFor(input.idFactory, "regint"),
        normalizedEmailHash,
        semanticPayloadHmac: semanticPayload.hmac,
        payloadKeyVersion: semanticPayload.keyVersion,
        now,
        expiresAt,
      })
      const intent = claim.intent

      if (claim.expired) {
        return recovery(
          intent.id,
          "CUSTOMER_REGISTRATION_EXPIRED"
        )
      }

      if (
        !semanticPayloadMatches(intent, {
          ...request,
          customerData,
        }, normalizedEmail)
      ) {
        return rejected(
          new CustomerRegistrationError(
            "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH",
            intent.id
          )
        )
      }

      if (intent.status === "completed") {
        const authenticated = await authenticateExistingIdentity(
          input,
          normalizedEmail,
          intent.id
        )
        if ("outcome" in authenticated) {
          return authenticated.outcome
        }
        const customerId = intent.customer_id
        if (!customerId || !intent.auth_identity_id) {
          return recovery(intent.id)
        }
        const customer = await input.customer.find({
          authIdentityId: intent.auth_identity_id,
          normalizedEmail,
          authIdentity: authenticated.identity,
        })
        if (!customer || customer.id !== customerId) {
          return recovery(
            intent.id,
            "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
          )
        }
        const credential = await transaction.ensureCredentialState({
          id: idFor(input.idFactory, "authcred"),
          authIdentityId: intent.auth_identity_id,
          customerId,
          at: now,
        })
        const session = await input.session.findInitial({
          authIdentityId: intent.auth_identity_id,
          customerId,
          credentialVersion: credential.credential_version,
          keyring: request.keyring,
          jwtSecret: request.jwtSecret,
          now,
        })
        if (!session) {
          return recovery(
            intent.id,
            "CUSTOMER_REGISTRATION_SESSION_FAILURE"
          )
        }
        const verification = await input.verification.autoRequest({
          authIdentityId: intent.auth_identity_id,
          normalizedEmail,
          keyring: request.keyring,
          now,
        })
        if (verification.state === "unknown") {
          return recovery(
            intent.id,
            "CUSTOMER_REGISTRATION_VERIFICATION_FAILURE"
          )
        }
        return {
          kind: "completed",
          result: completedResult({
            intent,
            authIdentityId: intent.auth_identity_id,
            customerId,
            session,
            verification,
          }),
        }
      }

      if (faulted(input.faultInjector, REGISTRATION_FAULT_POINTS.BEFORE_IDENTITY)) {
        return recovery(intent.id)
      }

      let authIdentity: RegistrationAuthIdentity | null = null

      if (intent.auth_identity_id) {
        const authenticated = await authenticateExistingIdentity(
          input,
          normalizedEmail,
          intent.id
        )
        if ("outcome" in authenticated) {
          return authenticated.outcome
        }
        if (authenticated.identity.id !== intent.auth_identity_id) {
          return rejected(
            new CustomerRegistrationError(
              "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH",
              intent.id
            )
          )
        }
        authIdentity = authenticated.identity
      } else {
        const existing = await input.auth.findIdentity({ normalizedEmail })
        if (existing) {
          const authenticated = await authenticateExistingIdentity(
            input,
            normalizedEmail,
            intent.id
          )
          if ("outcome" in authenticated) {
            return authenticated.outcome
          }
          authIdentity = authenticated.identity
        } else {
          try {
            authIdentity = await input.auth.register({
              normalizedEmail,
              email: normalizedEmail,
              password: request.password,
            })
          } catch {
            return recovery(
              intent.id,
              "CUSTOMER_REGISTRATION_PROVIDER_FAILURE"
            )
          }
          if (!authIdentity) {
            return recovery(
              intent.id,
              "CUSTOMER_REGISTRATION_PROVIDER_FAILURE"
            )
          }
        }
      }

      if (!authIdentity) {
        return recovery(
          intent.id,
          "CUSTOMER_REGISTRATION_PROVIDER_FAILURE"
        )
      }

      let currentIntent = intent
      if (
        currentIntent.status === "pending_identity" ||
        !currentIntent.auth_identity_id
      ) {
        currentIntent = await transaction.transitionIntent({
          id: currentIntent.id,
          expectedVersion: currentIntent.version,
          status: "pending_customer",
          authIdentityId: authIdentity.id,
          customerId: null,
          completedAt: null,
          at: now,
        })
      }

      if (
        faulted(
          input.faultInjector,
          REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
        )
      ) {
        return recovery(currentIntent.id)
      }

      let customerId = currentIntent.customer_id
      if (customerId) {
        const existingCustomer = await input.customer.find({
          authIdentityId: authIdentity.id,
          normalizedEmail,
          authIdentity,
        })
        if (!existingCustomer || existingCustomer.id !== customerId) {
          return recovery(
            currentIntent.id,
            "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
          )
        }
      } else {
        const recoveredCustomer = await input.customer.find({
          authIdentityId: authIdentity.id,
          normalizedEmail,
          authIdentity,
        })
        if (recoveredCustomer) {
          customerId = recoveredCustomer.id
        } else {
          try {
            const createdCustomer = await input.customer.create({
              authIdentityId: authIdentity.id,
              normalizedEmail,
              customerData,
            })
            customerId = createdCustomer?.id ?? null
          } catch {
            return recovery(
              currentIntent.id,
              "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
            )
          }
          if (!customerId) {
            return recovery(
              currentIntent.id,
              "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
            )
          }
        }

        currentIntent = await transaction.transitionIntent({
          id: currentIntent.id,
          expectedVersion: currentIntent.version,
          status: "failed_reconcilable",
          authIdentityId: authIdentity.id,
          customerId,
          completedAt: null,
          at: now,
        })
      }

      if (!customerId) {
        return recovery(
          currentIntent.id,
          "CUSTOMER_REGISTRATION_CUSTOMER_FAILURE"
        )
      }

      const credential = await transaction.ensureCredentialState({
        id: idFor(input.idFactory, "authcred"),
        authIdentityId: authIdentity.id,
        customerId,
        at: now,
      })

      if (
        faulted(
          input.faultInjector,
          REGISTRATION_FAULT_POINTS.AFTER_CUSTOMER_BEFORE_LINEAGE
        )
      ) {
        return recovery(currentIntent.id)
      }

      let session = await input.session.findInitial({
        authIdentityId: authIdentity.id,
        customerId,
        credentialVersion: credential.credential_version,
        keyring: request.keyring,
        jwtSecret: request.jwtSecret,
        now,
      })
      if (!session) {
        try {
          session = await input.session.issueInitial({
            authIdentityId: authIdentity.id,
            customerId,
            credentialVersion: credential.credential_version,
            keyring: request.keyring,
            jwtSecret: request.jwtSecret,
            now,
          })
        } catch {
          return recovery(
            currentIntent.id,
            "CUSTOMER_REGISTRATION_SESSION_FAILURE"
          )
        }
      }

      if (
        faulted(
          input.faultInjector,
          REGISTRATION_FAULT_POINTS.AFTER_LINEAGE_BEFORE_VERIFICATION
        )
      ) {
        return recovery(currentIntent.id)
      }

      let verification: RegistrationVerificationResult
      try {
        verification = await input.verification.autoRequest({
          authIdentityId: authIdentity.id,
          normalizedEmail,
          keyring: request.keyring,
          now,
        })
      } catch {
        return recovery(
          currentIntent.id,
          "CUSTOMER_REGISTRATION_VERIFICATION_FAILURE"
        )
      }
      if (verification.state === "unknown") {
        return recovery(
          currentIntent.id,
          "CUSTOMER_REGISTRATION_VERIFICATION_FAILURE"
        )
      }

      if (
        faulted(
          input.faultInjector,
          REGISTRATION_FAULT_POINTS.AFTER_VERIFICATION_BEFORE_COMPLETION
        )
      ) {
        return recovery(currentIntent.id)
      }

      currentIntent = await transaction.transitionIntent({
        id: currentIntent.id,
        expectedVersion: currentIntent.version,
        status: "completed",
        authIdentityId: authIdentity.id,
        customerId,
        completedAt: now,
        at: now,
      })

      return {
        kind: "completed",
        result: completedResult({
          intent: currentIntent,
          authIdentityId: authIdentity.id,
          customerId,
          session,
          verification,
        }),
      }
    }
  )

  if (outcome.kind === "completed") {
    return outcome.result
  }
  if (outcome.kind === "rejected") {
    throw outcome.error
  }
  throw recoveryError(outcome)
}

