import { createHash, createHmac } from "node:crypto"
import { isCustomerAuthRecoveryFailClosed } from "../../src/infrastructure/customer-auth-transaction-compatibility"
import {
  AUTH_CANARIES,
  assertAuthSinksHaveNoCanaries,
} from "../helpers/auth-leakage"
import {
  authorizeCustomerAuthAccess,
  type CustomerAuthAccessDatabase,
} from "../../src/modules/customer-auth/access-guard"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import {
  AUTH_PASSWORD_CHANGE_LEASE_MS,
  authorizePasswordChangeResumeOnly,
  changePassword,
  hashPasswordChangeOperationId,
  type PasswordChangeDatabase,
  type PasswordChangePasswordProvider,
  type PasswordChangeQueryDatabase,
  type PasswordChangeRawResult,
} from "../../src/modules/customer-auth/password-change"
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitUnavailableError,
  consumeRateLimitBuckets,
  InMemoryAtomicRateLimitStore,
  type AtomicRateLimitStore,
  type DerivedRateLimitBucket,
  type RateLimitBucketResult,
} from "../../src/modules/customer-auth/security/rate-limit"
import { handleCustomerAuthCurrentCustomer } from "../../src/api/store/customers/me/route"
import { handleCustomerAuthVerificationRequest } from "../../src/api/store/customers/me/verify/route"
import { handleCustomerAuthRefresh } from "../../src/api/auth/token/refresh/route"
import { handleRevokeCurrentLineage } from "../../src/api/auth/customer/emailpass/revoke-current-lineage/route"
import {
  handleCustomerAuthPasswordChange,
  type CustomerAuthPasswordChangeDependencies,
} from "../../src/api/store/customers/me/password/route"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
} from "../../src/api/store-surface/manifest"
import {
  decideStoreSurfaceAccess,
  storeSurfaceGuardMiddleware,
} from "../../src/api/store-surface/guard"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import defaultMiddlewares, {
  createCustomerAuthBffServiceGuardMiddleware,
  customerAuthAccessGuardMiddleware,
  customerAuthBffServiceGuardMiddleware,
} from "../../src/api/middlewares"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
} from "../../src/modules/customer-auth/bff-service-auth"

jest.setTimeout(180_000)

const KEYRING = {
  active: {
    version: 1,
    secret: "password-change-http-capability-secret-32b",
  },
  previous: [],
} as const
const JWT_SECRET = "password-change-http-jwt-secret-32-bytes-min"
const BASE = new Date("2026-08-17T12:00:00.000Z")
const AUTH_IDENTITY_ID = "identity_password_change_1"
const CUSTOMER_ID = "customer_password_change_1"
const OTHER_IDENTITY_ID = "identity_password_change_other"
const OTHER_CUSTOMER_ID = "customer_password_change_other"
const SID = "sid_password_change_1"
const LINEAGE_ID = "lineage_password_change_1"
const SID_B = "sid_password_change_b"
const LINEAGE_B = "lineage_password_change_b"
const CURRENT_PASSWORD = "current-password-12"
const NEW_PASSWORD = AUTH_CANARIES.password
const IDEMPOTENCY_KEY = "password-change-http-idempotency-1"
const OTHER_IDEMPOTENCY_KEY = "password-change-http-idempotency-2"
const PASSWORD_PATH = "/store/customers/me/password"

type MemoryRow = Record<string, unknown>

type MemoryState = {
  credential: MemoryRow | null
  lineages: MemoryRow[]
  refresh: MemoryRow[]
  nativeEvents: MemoryRow[]
  sessionsIssued: number
  commerceWrites: number
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)])
    )
  }
  return value
}

function cloneState(state: MemoryState): MemoryState {
  return cloneValue(state) as MemoryState
}

function rawRows(rows: MemoryRow[]): PasswordChangeRawResult {
  return { rows, rowCount: rows.length }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
}

function rowDate(row: MemoryRow, key: string): Date | null {
  const value = row[key]
  if (value === null || value === undefined) {
    return null
  }
  return value instanceof Date ? value : new Date(String(value))
}

function credentialColumns(row: MemoryRow): MemoryRow {
  return {
    id: row.id,
    auth_identity_id: row.auth_identity_id,
    customer_id: row.customer_id,
    credential_version: row.credential_version,
    email_verified_at: row.email_verified_at,
    operation_type: row.operation_type,
    operation_id: row.operation_id,
    operation_status: row.operation_status,
    operation_version: row.operation_version,
    version: row.version,
    lease_owner: row.lease_owner,
    lease_until: row.lease_until,
    attempt_count: row.attempt_count,
    next_retry_at: row.next_retry_at,
    current_password_verified_at: row.current_password_verified_at,
    provider_proved_at: row.provider_proved_at,
    credential_updated_at: row.credential_updated_at,
    revocation_committed_at: row.revocation_committed_at,
    completed_at: row.completed_at,
  }
}

class MemoryPasswordChangeDatabase
  implements PasswordChangeDatabase, PasswordChangeQueryDatabase, CustomerAuthAccessDatabase
{
  state: MemoryState = {
    credential: null,
    lineages: [],
    refresh: [],
    nativeEvents: [],
    sessionsIssued: 0,
    commerceWrites: 0,
  }

  private queue = Promise.resolve()

  async transaction<T>(
    callback: (transaction: {
      raw(sql: string, bindings?: unknown[]): Promise<PasswordChangeRawResult>
    }) => Promise<T>
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const working = cloneState(this.state)
      const transaction = {
        raw: (sql: string, bindings: unknown[] = []) =>
          this.execute(working, normalizeSql(sql), bindings),
      }
      const result = await callback(transaction)
      this.state = working
      return result
    })
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async query(
    sql: string,
    bindings: unknown[] = []
  ): Promise<PasswordChangeRawResult> {
    return this.execute(this.state, normalizeSql(sql), bindings)
  }

  seedCredential(input: {
    verifiedAt?: Date | null
    identityId?: string
    customerId?: string
  } = {}): void {
    this.state.credential = {
      id: "credential_password_change_1",
      auth_identity_id: input.identityId ?? AUTH_IDENTITY_ID,
      customer_id: input.customerId ?? CUSTOMER_ID,
      credential_version: 1,
      email_verified_at: input.verifiedAt === undefined ? null : input.verifiedAt,
      operation_type: null,
      operation_id: null,
      operation_status: "stable",
      operation_version: 0,
      version: 1,
      lease_owner: null,
      lease_until: null,
      attempt_count: 0,
      next_retry_at: null,
      current_password_verified_at: null,
      provider_proved_at: null,
      credential_updated_at: null,
      revocation_committed_at: null,
      completed_at: null,
      schema_version: 1,
      created_at: BASE,
      updated_at: BASE,
      deleted_at: null,
    }
  }

  seedLineage(input: {
    id?: string
    sid?: string
    identityId?: string
    customerId?: string
  } = {}): void {
    const originalAuthenticatedAt = BASE
    const absoluteExpiresAt = new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000)
    const id = input.id ?? LINEAGE_ID
    this.state.lineages.push({
      id,
      sid: input.sid ?? SID,
      auth_identity_id: input.identityId ?? AUTH_IDENTITY_ID,
      customer_id: input.customerId ?? CUSTOMER_ID,
      credential_version_snapshot: 1,
      status: "active",
      version: 1,
      original_authenticated_at: originalAuthenticatedAt,
      absolute_expires_at: absoluteExpiresAt,
      revoked_at: null,
      revocation_reason: null,
      expired_at: null,
      deleted_at: null,
    })
    this.state.refresh.push({
      id: `refresh_${id}`,
      lineage_id: id,
      status: "active",
      revoked_at: null,
      deleted_at: null,
    })
  }

  snapshot(): MemoryState {
    return cloneState(this.state)
  }

  private async execute(
    state: MemoryState,
    sql: string,
    bindings: unknown[]
  ): Promise<PasswordChangeRawResult> {
    if (sql.includes("from auth_session_lineage lineage")) {
      const sid = bindings[0]
      const lineage = state.lineages.find(
        (row) => row.sid === sid && row.deleted_at === null
      )
      const credential = lineage
        ? state.lineages.length &&
          state.credential?.auth_identity_id === lineage.auth_identity_id &&
          state.credential.deleted_at === null
          ? state.credential
          : null
        : null
      if (!lineage || !credential) {
        return rawRows([])
      }
      return rawRows([
        {
          lineage_id: lineage.id,
          sid: lineage.sid,
          lineage_auth_identity_id: lineage.auth_identity_id,
          lineage_customer_id: lineage.customer_id,
          credential_version_snapshot: lineage.credential_version_snapshot,
          lineage_status: lineage.status,
          original_authenticated_at: lineage.original_authenticated_at,
          absolute_expires_at: lineage.absolute_expires_at,
          credential_auth_identity_id: credential.auth_identity_id,
          credential_customer_id: credential.customer_id,
          credential_version: credential.credential_version,
          operation_status: credential.operation_status,
          operation_type: credential.operation_type,
          operation_id: credential.operation_id,
          current_password_verified_at: credential.current_password_verified_at,
        },
      ])
    }

    if (sql.startsWith("select") && sql.includes("from auth_credential_state")) {
      const credential =
        state.credential?.auth_identity_id === bindings[0] &&
        state.credential.deleted_at === null
          ? state.credential
          : null
      return rawRows(
        credential ? [cloneValue(credentialColumns(credential)) as MemoryRow] : []
      )
    }

    if (
      sql.startsWith("update auth_credential_state set operation_status = 'claimed'")
    ) {
      const [
        operationId,
        verifiedAt,
        leaseOwner,
        leaseUntilAt,
        updatedAt,
        id,
        expectedVersion,
      ] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "stable" ||
        credential.operation_type !== null ||
        credential.operation_id !== null ||
        credential.current_password_verified_at !== null ||
        credential.provider_proved_at !== null ||
        credential.deleted_at !== null ||
        Number(credential.credential_version) !== Number(expectedVersion)
      ) {
        return rawRows([])
      }
      credential.operation_status = "claimed"
      credential.operation_type = "password_change"
      credential.operation_id = operationId
      credential.current_password_verified_at = verifiedAt
      credential.lease_owner = leaseOwner
      credential.lease_until = leaseUntilAt
      credential.operation_version = Number(credential.operation_version) + 1
      credential.attempt_count = Number(credential.attempt_count) + 1
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith(
        "update auth_credential_state set operation_status = 'credential_proved'"
      )
    ) {
      const [provedAt, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_type !== "password_change" ||
        credential.provider_proved_at ||
        credential.deleted_at
      ) {
        return rawRows([])
      }
      credential.operation_status = "credential_proved"
      credential.provider_proved_at = provedAt
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith(
        "update auth_credential_state set operation_status = 'credential_updated'"
      )
    ) {
      const [updatedAtMarker, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "credential_proved" ||
        credential.operation_type !== "password_change" ||
        credential.deleted_at
      ) {
        return rawRows([])
      }
      credential.operation_status = "credential_updated"
      credential.credential_updated_at = updatedAtMarker
      credential.credential_version = Number(credential.credential_version) + 1
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith(
        "update auth_credential_state set operation_status = 'revocation_committed'"
      )
    ) {
      const [revokedAt, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "credential_updated" ||
        credential.deleted_at
      ) {
        return rawRows([])
      }
      credential.operation_status = "revocation_committed"
      credential.revocation_committed_at = revokedAt
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith("update auth_credential_state set operation_status = 'stable'")
    ) {
      const [updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "revocation_committed" ||
        credential.deleted_at
      ) {
        return rawRows([])
      }
      credential.operation_status = "stable"
      credential.operation_type = null
      credential.operation_id = null
      credential.lease_owner = null
      credential.lease_until = null
      credential.next_retry_at = null
      credential.current_password_verified_at = null
      credential.provider_proved_at = null
      credential.credential_updated_at = null
      credential.revocation_committed_at = null
      credential.completed_at = null
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith(
        "update auth_credential_state set operation_status = 'provider_outcome_ambiguous'"
      )
    ) {
      const [nextRetryAt, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_type !== "password_change" ||
        credential.deleted_at
      ) {
        return rawRows([])
      }
      credential.operation_status = "provider_outcome_ambiguous"
      credential.next_retry_at = nextRetryAt
      credential.lease_owner = null
      credential.lease_until = null
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith("update auth_credential_state set operation_status = ?") &&
      sql.includes("provider_outcome_ambiguous")
    ) {
      const [nextStatus, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "provider_outcome_ambiguous"
      ) {
        return rawRows([])
      }
      credential.operation_status = nextStatus
      credential.next_retry_at = null
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (sql.startsWith("update auth_refresh_credential")) {
      const [revokedAt] = bindings
      for (const row of state.refresh) {
        if (row.status === "active") {
          row.status = "revoked"
          row.revoked_at = revokedAt
        }
      }
      return rawRows([])
    }

    if (sql.startsWith("update auth_session_lineage")) {
      const [revokedAt] = bindings
      for (const row of state.lineages) {
        if (row.status === "active") {
          row.status = "revoked"
          row.revoked_at = revokedAt
          row.revocation_reason = "password_change"
          row.version = Number(row.version) + 1
        }
      }
      return rawRows([])
    }

    throw new Error(`Unhandled memory SQL: ${sql}`)
  }
}

class RecordingProvider implements PasswordChangePasswordProvider {
  passwordByIdentity = new Map<string, string>()
  updateCalls = 0
  verifyCalls = 0
  calls: Array<"update" | "verify"> = []
  nextUpdate: "updated" | "timeout" | "ambiguous" = "updated"
  verifyImpl: ((password: string) => boolean) | null = null

  constructor(initial?: { authIdentityId: string; password: string }) {
    if (initial) {
      this.passwordByIdentity.set(initial.authIdentityId, initial.password)
    }
  }

  async updatePassword(input: {
    authIdentityId: string
    password: string
  }): Promise<"updated" | "timeout" | "ambiguous"> {
    this.calls.push("update")
    this.updateCalls += 1
    if (this.nextUpdate !== "updated") {
      const outcome = this.nextUpdate
      this.nextUpdate = "updated"
      return outcome
    }
    this.passwordByIdentity.set(input.authIdentityId, input.password)
    return "updated"
  }

  async verifyPassword(input: {
    authIdentityId: string
    password: string
  }): Promise<boolean> {
    this.calls.push("verify")
    this.verifyCalls += 1
    if (this.verifyImpl) {
      return this.verifyImpl(input.password)
    }
    return this.passwordByIdentity.get(input.authIdentityId) === input.password
  }
}

class RecordingRateLimitStore implements AtomicRateLimitStore {
  readonly calls: DerivedRateLimitBucket[][] = []
  private readonly delegate: AtomicRateLimitStore

  constructor(
    delegate: AtomicRateLimitStore = new InMemoryAtomicRateLimitStore()
  ) {
    this.delegate = delegate
  }

  increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.calls.push([...buckets])
    return this.delegate.increment(buckets)
  }
}

class BlockedRateLimitStore implements AtomicRateLimitStore {
  readonly keys: string[] = []

  async increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.keys.push(...buckets.map((bucket) => bucket.key))
    return buckets.map((bucket) => ({
      ...bucket,
      count: bucket.limit + 1,
      retryAfterSeconds: 42,
    }))
  }
}

class OutageRateLimitStore implements AtomicRateLimitStore {
  calls = 0

  async increment(): Promise<RateLimitBucketResult[]> {
    this.calls += 1
    throw new Error("synthetic Redis outage")
  }
}

type ResponseState = {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function responseRecorder(): {
  response: Record<string, unknown>
  state: ResponseState
} {
  const state: ResponseState = {
    statusCode: 200,
    headers: {},
    body: undefined,
  }
  const response = {
    headersSent: false,
    status(code: number) {
      state.statusCode = code
      return response
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = String(value)
      return response
    },
    json(body: unknown) {
      state.body = body
      response.headersSent = true
      return response
    },
    end() {
      response.headersSent = true
      return response
    },
  }
  return { response, state }
}

function issueAccessToken(input: {
  identityId?: string
  customerId?: string
  sid?: string
  credentialVersion?: number
} = {}): string {
  return issueCustomerAuthAccessToken({
    secret: JWT_SECRET,
    authIdentityId: input.identityId ?? AUTH_IDENTITY_ID,
    customerId: input.customerId ?? CUSTOMER_ID,
    sid: input.sid ?? SID,
    credentialVersion: input.credentialVersion ?? 1,
    originalAuthenticatedAt: BASE,
    absoluteExpiresAt: new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
    now: BASE,
    jti: "jti-password-change-1",
  }).token
}

function changeInput(
  provider: PasswordChangePasswordProvider,
  overrides: Partial<Parameters<typeof changePassword>[1]> = {}
): Parameters<typeof changePassword>[1] {
  return {
    authIdentityId: AUTH_IDENTITY_ID,
    customerId: CUSTOMER_ID,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    idempotencyKey: IDEMPOTENCY_KEY,
    originatingLineageId: LINEAGE_ID,
    originatingSid: SID,
    keyring: KEYRING,
    provider,
    mode: "fresh",
    now: BASE,
    ...overrides,
  }
}

function zeroWriteSnapshot(database: MemoryPasswordChangeDatabase): MemoryState {
  return database.snapshot()
}

function expectNoPasswordMaterial(value: unknown): void {
  const encoded = JSON.stringify(value)
  expect(encoded).not.toContain(CURRENT_PASSWORD)
  expect(encoded).not.toContain(NEW_PASSWORD)
  expect(encoded).not.toContain(AUTH_CANARIES.password)
}

function expectFailClosed(database: MemoryPasswordChangeDatabase): void {
  const credential = database.state.credential!
  expect(credential.operation_type).toBe("password_change")
  expect(credential.operation_status).not.toBe("stable")
  expect(credential.current_password_verified_at).toBeTruthy()
  expect(
    isCustomerAuthRecoveryFailClosed(
      credential.operation_status as "claimed" | "provider_outcome_ambiguous"
    )
  ).toBe(true)
}

describe("password-change domain faults", () => {
  it("fault before current-password proof keeps zero writes", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const before = zeroWriteSnapshot(database)

    await expect(
      changePassword(
        database,
        changeInput(provider, {
          hooks: {
            async onStep(step) {
              if (step === "before_current_password_proof") {
                throw new Error("fault before current proof")
              }
            },
          },
        })
      )
    ).rejects.toThrow("fault before current proof")

    expect(provider.verifyCalls).toBe(0)
    expect(provider.updateCalls).toBe(0)
    expect(database.snapshot()).toEqual(before)
    expect(database.state.sessionsIssued).toBe(0)
    expect(database.state.commerceWrites).toBe(0)
  })

  it("fault current-password wrong is zero-write and does not claim", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const before = zeroWriteSnapshot(database)

    await expect(
      changePassword(
        database,
        changeInput(provider, { currentPassword: "wrong-password-12" })
      )
    ).rejects.toMatchObject({
      code: "AUTH_PASSWORD_CHANGE_CURRENT_PASSWORD_INVALID",
    })

    expect(provider.calls).toEqual(["verify"])
    expect(provider.updateCalls).toBe(0)
    expect(database.snapshot()).toEqual(before)
    expectNoPasswordMaterial(database.snapshot())
  })

  it("fault after current proof before claim keeps zero writes", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const before = zeroWriteSnapshot(database)

    await expect(
      changePassword(
        database,
        changeInput(provider, {
          hooks: {
            async onStep(step) {
              if (step === "after_current_password_proof") {
                throw new Error("fault before claim")
              }
            },
          },
        })
      )
    ).rejects.toThrow("fault before claim")

    expect(provider.verifyCalls).toBe(1)
    expect(provider.updateCalls).toBe(0)
    expect(database.snapshot()).toEqual(before)
  })

  it("fault after claim blocks ordinary access without completing", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(
      database,
      changeInput(provider, {
        hooks: {
          async onStep(step) {
            if (step === "after_claim") {
              throw new Error("fault after claim")
            }
          },
        },
      })
    )

    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(provider.updateCalls).toBe(0)
    expect(database.state.credential?.operation_status).toBe(
      "provider_outcome_ambiguous"
    )
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(database.state.credential?.credential_version).toBe(1)
    expectFailClosed(database)
    const access = await authorizeCustomerAuthAccess(
      database,
      `Bearer ${issueAccessToken()}`,
      { jwtSecret: JWT_SECRET, now: BASE }
    )
    expect(access.authorized).toBe(false)
  })

  it("fault provider update timeout stays pending without proof", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"

    const result = await changePassword(database, changeInput(provider))
    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(provider.calls).toEqual(["verify", "update"])
    expect(database.state.credential?.provider_proved_at).toBeNull()
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(database.state.lineages[0]?.status).toBe("active")
    expectFailClosed(database)
  })

  it("fault provider update ambiguous stays fail-closed", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "ambiguous"

    const result = await changePassword(database, changeInput(provider))
    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(database.state.credential?.operation_status).toBe(
      "provider_outcome_ambiguous"
    )
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(database.state.sessionsIssued).toBe(0)
  })

  it("fault provider verify failure does not bump or revoke", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.verifyImpl = (password) => password === CURRENT_PASSWORD

    const result = await changePassword(database, changeInput(provider))
    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(provider.updateCalls).toBe(1)
    expect(database.state.credential?.provider_proved_at).toBeNull()
    expect(database.state.credential?.credential_version).toBe(1)
    expect(database.state.lineages[0]?.status).toBe("active")
  })

  it("fault before version bump keeps original credential version", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(
      database,
      changeInput(provider, {
        hooks: {
          async onStep(step) {
            if (step === "before_version_bump") {
              throw new Error("fault before bump")
            }
          },
        },
      })
    )

    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(database.state.credential?.provider_proved_at).toBeTruthy()
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(database.state.credential?.credential_version).toBe(1)
    expect(database.state.lineages[0]?.status).toBe("active")
  })

  it("fault before global revoke keeps lineages active after version bump", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    database.seedLineage({ id: "lineage_password_change_2", sid: "sid-2" })
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(
      database,
      changeInput(provider, {
        hooks: {
          async onStep(step) {
            if (step === "before_global_revoke") {
              throw new Error("fault before revoke")
            }
          },
        },
      })
    )

    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(database.state.credential?.credential_version).toBe(2)
    expect(
      database.state.lineages.every((lineage) => lineage.status === "active")
    ).toBe(true)
    expect(
      database.state.refresh.every((row) => row.status === "active")
    ).toBe(true)
  })

  it("fault after revoke before response does not return completed or mint a session", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(
      database,
      changeInput(provider, {
        hooks: {
          async onStep(step) {
            if (step === "after_revoke_before_response") {
              throw new Error("fault before response")
            }
          },
        },
      })
    )

    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(database.state.lineages[0]?.status).toBe("revoked")
    expect(database.state.lineages[0]?.revocation_reason).toBe("password_change")
    expect(database.state.refresh[0]?.status).toBe("revoked")
    expect(database.state.sessionsIssued).toBe(0)
    expect(database.state.credential?.operation_status).not.toBe("stable")
  })

  it("completes only after proof, monotonic version bump and global revoke", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential({ verifiedAt: new Date("2026-01-01T00:00:00.000Z") })
    database.seedLineage()
    database.seedLineage({ id: "lineage_b", sid: "sid-b" })
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(database, changeInput(provider))
    expect(result).toEqual({ outcome: "completed", credentialVersion: 2 })
    expect(provider.calls).toEqual(["verify", "update", "verify"])
    expect(database.state.credential?.credential_version).toBe(2)
    expect(database.state.credential?.operation_status).toBe("stable")
    expect(database.state.credential?.email_verified_at).toEqual(
      new Date("2026-01-01T00:00:00.000Z")
    )
    expect(
      database.state.lineages.every((lineage) => lineage.status === "revoked")
    ).toBe(true)
    expect(
      database.state.refresh.every((row) => row.status === "revoked")
    ).toBe(true)
    expect(database.state.sessionsIssued).toBe(0)
    expect(database.state.commerceWrites).toBe(0)
    expectNoPasswordMaterial(database.snapshot())
    const access = await authorizeCustomerAuthAccess(
      database,
      `Bearer ${issueAccessToken()}`,
      { jwtSecret: JWT_SECRET, now: BASE }
    )
    expect(access.authorized).toBe(false)
  })

  it("keeps an unverified identity unverified after success", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential({ verifiedAt: null })
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    await changePassword(database, changeInput(provider))
    expect(database.state.credential?.email_verified_at).toBeNull()
  })
})

describe("password-change resume faults", () => {
  it("same-key recovery verifies the re-presented newPassword and does not repeat update", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    provider.passwordByIdentity.set(AUTH_IDENTITY_ID, NEW_PASSWORD)

    const resumed = await changePassword(
      database,
      changeInput(provider, { mode: "resume" })
    )
    expect(resumed).toEqual({ outcome: "completed", credentialVersion: 2 })
    expect(provider.updateCalls).toBe(1)
    expect(database.state.credential?.operation_status).toBe("stable")
    expect(database.state.lineages[0]?.status).toBe("revoked")
    expect(database.state.sessionsIssued).toBe(0)
  })

  it("same-key recovery mismatch allows one update then mandatory verify", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    expect(provider.passwordByIdentity.get(AUTH_IDENTITY_ID)).toBe(
      CURRENT_PASSWORD
    )

    const resumed = await changePassword(
      database,
      changeInput(provider, { mode: "resume" })
    )
    expect(resumed).toEqual({ outcome: "completed", credentialVersion: 2 })
    expect(provider.updateCalls).toBe(2)
    expect(provider.passwordByIdentity.get(AUTH_IDENTITY_ID)).toBe(NEW_PASSWORD)
  })

  it("different-key recovery cannot assume the in-flight operation", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    const claimedId = database.state.credential?.operation_id

    await expect(
      changePassword(
        database,
        changeInput(provider, {
          mode: "resume",
          idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        })
      )
    ).rejects.toMatchObject({ code: "AUTH_PASSWORD_CHANGE_DENIED" })

    expect(database.state.credential?.operation_id).toBe(claimedId)
    expect(database.state.credential?.operation_status).not.toBe("stable")
    expect(database.state.credential?.credential_version).toBe(1)
  })

  it("binds resume-only to the originating lineage and denies a sibling lineage of the same identity", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    database.seedLineage({ id: LINEAGE_B, sid: SID_B })
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    expect(database.state.credential?.operation_status).not.toBe("stable")

    const tokenA = issueAccessToken()
    const tokenB = issueAccessToken({ sid: SID_B })

    const sameLineageSameKey = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenA}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(sameLineageSameKey.authorized).toBe(true)
    if (sameLineageSameKey.authorized) {
      expect(sameLineageSameKey.sid).toBe(SID)
      expect(sameLineageSameKey.lineageId).toBe(LINEAGE_ID)
      expect(sameLineageSameKey.authIdentityId).toBe(AUTH_IDENTITY_ID)
      expect(sameLineageSameKey.customerId).toBe(CUSTOMER_ID)
    }

    const siblingLineageSameKey = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenB}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(siblingLineageSameKey.authorized).toBe(false)

    const originatingDifferentKey = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenA}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(originatingDifferentKey.authorized).toBe(false)

    const siblingDifferentKey = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenB}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(siblingDifferentKey.authorized).toBe(false)

    const otherIdentity = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${issueAccessToken({
        identityId: OTHER_IDENTITY_ID,
        customerId: OTHER_CUSTOMER_ID,
        sid: "sid-other",
      })}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(otherIdentity.authorized).toBe(false)

    const ordinaryA = await authorizeCustomerAuthAccess(
      database,
      `Bearer ${tokenA}`,
      { jwtSecret: JWT_SECRET, now: BASE }
    )
    expect(ordinaryA.authorized).toBe(false)
    const ordinaryB = await authorizeCustomerAuthAccess(
      database,
      `Bearer ${tokenB}`,
      { jwtSecret: JWT_SECRET, now: BASE }
    )
    expect(ordinaryB.authorized).toBe(false)
  })

  it("after revoke fault, only the originating JWT same-key resume-only can finish", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    database.seedLineage({ id: LINEAGE_B, sid: SID_B })
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })

    const result = await changePassword(
      database,
      changeInput(provider, {
        hooks: {
          async onStep(step) {
            if (step === "after_revoke_before_response") {
              throw new Error("fault before response")
            }
          },
        },
      })
    )
    expect(result).toEqual({ outcome: "recovery_pending" })
    expect(
      database.state.lineages.every((lineage) => lineage.status === "revoked")
    ).toBe(true)

    const tokenA = issueAccessToken()
    const tokenB = issueAccessToken({ sid: SID_B })

    const ordinaryA = await authorizeCustomerAuthAccess(
      database,
      `Bearer ${tokenA}`,
      { jwtSecret: JWT_SECRET, now: BASE }
    )
    expect(ordinaryA.authorized).toBe(false)

    const originatingResume = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenA}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(originatingResume.authorized).toBe(true)

    const siblingResume = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenB}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(siblingResume.authorized).toBe(false)

    const me = responseRecorder()
    await handleCustomerAuthCurrentCustomer(
      requestOf({ authorization: `Bearer ${tokenA}` }),
      me.response,
      {
        resolveCustomer: async () => {
          throw new Error("me must not be authorized")
        },
        resolveVerificationState: async () => "pending",
      }
    )
    expect(me.state.statusCode).toBe(401)

    const verification = responseRecorder()
    await handleCustomerAuthVerificationRequest(
      requestOf({ authorization: `Bearer ${tokenA}`, body: {} }),
      verification.response,
      {
        database: {
          async transaction() {
            throw new Error("verification must not run")
          },
        },
        resolveEmailByIdentityId: async () => {
          throw new Error("verification must not run")
        },
        resolveIdentityByEmail: async () => null,
      }
    )
    expect(verification.state.statusCode).toBe(401)

    const refresh = responseRecorder()
    await handleCustomerAuthRefresh(
      {
        body: {},
        headers: { "x-indicio-refresh-token": "refresh-token-not-used" },
        correlationId: "refresh-isolation-after-revoke",
      } as never,
      refresh.response as never,
      {
        database: {
          async transaction() {
            throw new Error("refresh must not run")
          },
        },
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        rateLimitStore: new InMemoryAtomicRateLimitStore(),
        timing: async () => 0,
        resolveCustomer: async () => {
          throw new Error("refresh must not run")
        },
      }
    )
    expect([400, 401, 503]).toContain(refresh.state.statusCode)
    expect(refresh.state.statusCode).not.toBe(200)

    const revoke = responseRecorder()
    await handleRevokeCurrentLineage(
      requestOf({ authorization: `Bearer ${tokenA}`, body: {} }) as never,
      revoke.response as never,
      {
        database: {
          async transaction() {
            throw new Error("revoke must not use resume-only")
          },
        },
      }
    )
    expect(revoke.state.statusCode).toBe(401)

    provider.passwordByIdentity.set(AUTH_IDENTITY_ID, NEW_PASSWORD)
    const retry = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${tokenA}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      retry.response,
      handlerDependencies(database, provider)
    )
    expect(retry.state.statusCode).toBe(204)

    const siblingAfter = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${tokenB}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(siblingAfter.authorized).toBe(false)
  })

  it("resume-only authorizes the same operation and key and denies other handlers", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    const token = issueAccessToken()

    const resume = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${token}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(resume.authorized).toBe(true)

    const differentKey = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${token}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(differentKey.authorized).toBe(false)

    const otherIdentity = await authorizePasswordChangeResumeOnly(
      database,
      `Bearer ${issueAccessToken({
        identityId: OTHER_IDENTITY_ID,
        customerId: OTHER_CUSTOMER_ID,
        sid: "sid-other",
      })}`,
      {
        jwtSecret: JWT_SECRET,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        now: BASE,
      }
    )
    expect(otherIdentity.authorized).toBe(false)

    const access = await authorizeCustomerAuthAccess(database, `Bearer ${token}`, {
      jwtSecret: JWT_SECRET,
      now: BASE,
    })
    expect(access.authorized).toBe(false)
  })

  it("secretless inspection cannot verify, update or complete a pending change", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    await changePassword(database, changeInput(provider))
    const before = database.snapshot()

    expect(
      Object.prototype.hasOwnProperty.call(
        await import("../../src/modules/customer-auth/password-change"),
        "reconcileSecretlessPasswordChange"
      )
    ).toBe(false)

    const readOnly = JSON.stringify(before)
    expect(readOnly).not.toContain(NEW_PASSWORD)
    expect(readOnly).not.toContain(CURRENT_PASSWORD)
    expect(database.state.credential?.operation_status).not.toBe("stable")
    expect(database.state.credential?.credential_updated_at).toBeNull()
  })
})

function buildAuthenticatedPasswordChangeKeys(input: {
  authorizedLineageId: string
}): DerivedRateLimitBucket[] {
  const version = KEYRING.active.version
  const policy = AUTH_RATE_LIMIT_POLICIES["password-change"].authenticated.lineage
  const material = `lineage-digest:${createHash("sha256")
    .update(input.authorizedLineageId, "utf8")
    .digest("hex")}`
  const domain = [
    "auth-rate",
    `key-version:${version}`,
    "operation:password-change",
    "purpose:authenticated-lineage",
    material,
  ].join("|")
  const digest = createHmac("sha256", KEYRING.active.secret)
    .update(domain, "utf8")
    .digest("hex")
  return [
    {
      key: `auth-rate:v${version}:authenticated-lineage:${digest}`,
      digest,
      limit: policy[0],
      windowSeconds: policy[1],
    },
  ]
}

function requestOf(input: {
  body?: unknown
  authorization?: string
  idempotencyKey?: string
} = {}): Record<string, unknown> {
  return {
    body: input.body ?? {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    },
    headers: {
      ...(input.authorization
        ? { authorization: input.authorization }
        : {}),
      ...(input.idempotencyKey
        ? { "idempotency-key": input.idempotencyKey }
        : {}),
    },
    correlationId: "password-change-http-correlation",
  }
}

function handlerDependencies(
  database: MemoryPasswordChangeDatabase,
  provider: PasswordChangePasswordProvider,
  overrides: Partial<CustomerAuthPasswordChangeDependencies> = {}
): CustomerAuthPasswordChangeDependencies {
  return {
    accessDatabase: database,
    queryDatabase: database,
    database,
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    rateLimitStore: new RecordingRateLimitStore(),
    provider,
    now: () => BASE,
    ...overrides,
  }
}

describe("password-change HTTP resume isolation", () => {
  it("lets the same original token resume this password-change only", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const token = issueAccessToken()
    provider.nextUpdate = "timeout"
    const first = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${token}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      first.response,
      handlerDependencies(database, provider)
    )
    expect(first.state.statusCode).toBe(503)
    expect(first.state.body).toMatchObject({ code: "AUTH_RECOVERY_PENDING" })

    const me = responseRecorder()
    await handleCustomerAuthCurrentCustomer(
      requestOf({ authorization: `Bearer ${token}` }),
      me.response,
      {
        resolveCustomer: async () => {
          throw new Error("me must not be authorized")
        },
        resolveVerificationState: async () => "pending",
      }
    )
    expect(me.state.statusCode).toBe(401)

    const verification = responseRecorder()
    await handleCustomerAuthVerificationRequest(
      requestOf({ authorization: `Bearer ${token}`, body: {} }),
      verification.response,
      {
        database: {
          async transaction() {
            throw new Error("verification must not run")
          },
        },
        resolveEmailByIdentityId: async () => {
          throw new Error("verification must not run")
        },
        resolveIdentityByEmail: async () => null,
      }
    )
    expect(verification.state.statusCode).toBe(401)

    const refresh = responseRecorder()
    await handleCustomerAuthRefresh(
      {
        body: {},
        headers: { "x-indicio-refresh-token": "refresh-token-not-used" },
        correlationId: "refresh-isolation",
      } as never,
      refresh.response as never,
      {
        database: {
          async transaction() {
            throw new Error("refresh must not run")
          },
        },
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        rateLimitStore: new InMemoryAtomicRateLimitStore(),
        timing: async () => 0,
        resolveCustomer: async () => {
          throw new Error("refresh must not run")
        },
      }
    )
    expect([400, 401, 503]).toContain(refresh.state.statusCode)
    expect(refresh.state.statusCode).not.toBe(200)

    const revoke = responseRecorder()
    await handleRevokeCurrentLineage(
      requestOf({ authorization: `Bearer ${token}`, body: {} }) as never,
      revoke.response as never,
      {
        database: {
          async transaction() {
            throw new Error("revoke must not use resume-only")
          },
        },
      }
    )
    expect(revoke.state.statusCode).toBe(401)

    provider.passwordByIdentity.set(AUTH_IDENTITY_ID, NEW_PASSWORD)
    const retry = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${token}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      retry.response,
      handlerDependencies(database, provider)
    )
    expect(retry.state.statusCode).toBe(204)
    expect(retry.state.body).toBeUndefined()
  })

  it("denies a sibling lineage of the same identity from resuming with the same Idempotency-Key", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    database.seedLineage({ id: LINEAGE_B, sid: SID_B })
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const tokenA = issueAccessToken()
    const tokenB = issueAccessToken({ sid: SID_B })
    provider.nextUpdate = "timeout"
    const first = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${tokenA}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      first.response,
      handlerDependencies(database, provider)
    )
    expect(first.state.statusCode).toBe(503)
    expect(first.state.body).toMatchObject({ code: "AUTH_RECOVERY_PENDING" })

    const sibling = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${tokenB}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      sibling.response,
      handlerDependencies(database, provider)
    )
    expect(sibling.state.statusCode).toBe(401)
    expect(sibling.state.body).toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    expect(database.state.credential?.operation_status).not.toBe("stable")
    expect(database.state.sessionsIssued).toBe(0)
  })
})

describe("password-change HTTP public matrix", () => {
  it("returns 204 without echoing secrets or minting a substitute session", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      handlerDependencies(database, provider)
    )
    expect(state.statusCode).toBe(204)
    expect(state.body).toBeUndefined()
    expectNoPasswordMaterial(state)
    expect(database.state.sessionsIssued).toBe(0)
    expect(database.state.commerceWrites).toBe(0)
    expect(database.state.lineages[0]?.status).toBe("revoked")
  })

  it("maps wrong current password to 400 CURRENT_CREDENTIAL_INVALID", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: {
          currentPassword: "wrong-password-12",
          newPassword: NEW_PASSWORD,
        },
      }),
      response,
      handlerDependencies(database, provider)
    )
    expect(state.statusCode).toBe(400)
    expect(state.body).toMatchObject({ code: "CURRENT_CREDENTIAL_INVALID" })
    expect(database.state.credential?.operation_status).toBe("stable")
    expectNoPasswordMaterial(state.body)
  })

  it("maps invalid bearer to 401 AUTHENTICATION_REQUIRED", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: "Bearer not-a-jwt",
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      handlerDependencies(database, provider)
    )
    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    expect(provider.verifyCalls).toBe(0)
  })

  it("maps lineage limiter exhaustion to 429 RATE_LIMITED", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const store = new BlockedRateLimitStore()
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      handlerDependencies(database, provider, { rateLimitStore: store })
    )
    expect(state.statusCode).toBe(429)
    expect(state.body).toMatchObject({ code: "RATE_LIMITED" })
    expect(state.headers["retry-after"]).toBe("42")
    expect(provider.updateCalls).toBe(0)
    expect(store.keys.join("|")).not.toContain(LINEAGE_ID)
    expect(store.keys.join("|")).not.toContain(CURRENT_PASSWORD)
  })

  it("maps Redis outage to 503 AUTH_TEMPORARILY_UNAVAILABLE before mutation", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      handlerDependencies(database, provider, {
        rateLimitStore: new OutageRateLimitStore(),
      })
    )
    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(state.headers["retry-after"]).toBe("60")
    expect(database.state.credential?.operation_status).toBe("stable")
    expect(provider.updateCalls).toBe(0)
  })

  it("maps legitimate ambiguous recovery to 503 AUTH_RECOVERY_PENDING", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    provider.nextUpdate = "timeout"
    const { response, state } = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      handlerDependencies(database, provider)
    )
    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({ code: "AUTH_RECOVERY_PENDING" })
    expectNoPasswordMaterial(state.body)
  })

  it("rejects extra body fields and different resume keys", async () => {
    const database = new MemoryPasswordChangeDatabase()
    database.seedCredential()
    database.seedLineage()
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: CURRENT_PASSWORD,
    })
    const extra = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: {
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
          extra: true,
        },
      }),
      extra.response,
      handlerDependencies(database, provider)
    )
    expect(extra.state.statusCode).toBe(400)
    expect(extra.state.body).toMatchObject({ code: "INVALID_REQUEST" })

    provider.nextUpdate = "timeout"
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      responseRecorder().response,
      handlerDependencies(database, provider)
    )
    const differentKey = responseRecorder()
    await handleCustomerAuthPasswordChange(
      requestOf({
        authorization: `Bearer ${issueAccessToken()}`,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
      }),
      differentKey.response,
      handlerDependencies(database, provider)
    )
    expect(differentKey.state.statusCode).toBe(401)
  })

  it("derives the opaque 5/lineage/hour limiter after the guard", async () => {
    const keys = buildAuthenticatedPasswordChangeKeys({
      authorizedLineageId: LINEAGE_ID,
    })
    expect(keys[0]?.limit).toBe(5)
    expect(keys[0]?.windowSeconds).toBe(3600)
    expect(keys[0]?.key).not.toContain(LINEAGE_ID)
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    let result = await consumeRateLimitBuckets(store, keys)
    for (let hit = 2; hit <= 6; hit += 1) {
      result = await consumeRateLimitBuckets(store, keys)
    }
    expect(result.allowed).toBe(false)
    expect(result.blockedBy?.count).toBe(6)
    expect(new AuthRateLimitUnavailableError().retryAfterSeconds).toBe(60)
  })
})

describe("password-change store surface is enabled after reconciler proof", () => {
  it("elevates POST /store/customers/me/password in the Store and BFF exact-sets", async () => {
    expect(
      decideStoreSurfaceAccess("POST", PASSWORD_PATH).action
    ).toBe("allow")
    expect(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS).toContain(
      "POST /store/customers/me/password"
    )
    expect(
      STORE_SURFACE_MANIFEST.some(
        (entry) =>
          entry.method === "POST" &&
          entry.pathTemplate === PASSWORD_PATH &&
          entry.runtime_policy === "M1_ENABLED"
      )
    ).toBe(true)
    expect(CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS).toContain(
      "POST /store/customers/me/password"
    )
    expect(
      decideAuthSurfaceAccess("POST", PASSWORD_PATH).action
    ).toBe("deny")
    const originatingA = hashPasswordChangeOperationId({
      keyring: KEYRING,
      idempotencyKey: IDEMPOTENCY_KEY,
      originatingLineageId: LINEAGE_ID,
      originatingSid: SID,
    })
    const originatingB = hashPasswordChangeOperationId({
      keyring: KEYRING,
      idempotencyKey: IDEMPOTENCY_KEY,
      originatingLineageId: LINEAGE_B,
      originatingSid: SID_B,
    })
    const differentKey = hashPasswordChangeOperationId({
      keyring: KEYRING,
      idempotencyKey: OTHER_IDEMPOTENCY_KEY,
      originatingLineageId: LINEAGE_ID,
      originatingSid: SID,
    })
    expect(originatingA).toHaveLength(64)
    expect(originatingA).toBe(
      hashPasswordChangeOperationId({
        keyring: KEYRING,
        idempotencyKey: IDEMPOTENCY_KEY,
        originatingLineageId: LINEAGE_ID,
        originatingSid: SID,
      })
    )
    expect(originatingA).not.toBe(originatingB)
    expect(originatingA).not.toBe(differentKey)
    expect(originatingA).not.toContain(SID)
    expect(originatingA).not.toContain(LINEAGE_ID)
    expect(originatingA).not.toContain(IDEMPOTENCY_KEY)
    expect(AUTH_PASSWORD_CHANGE_LEASE_MS).toBe(120_000)
    expect(typeof handleCustomerAuthPasswordChange).toBe("function")
  })

  it("denies POST /store/customers/me/password without a BFF service credential before the handler", () => {
    const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
      expectedSecret: "indicio-bff-service-secret-synthetic-32b",
    })
    const handler = jest.fn()
    const missing = responseRecorder()
    const invalid = responseRecorder()

    const apply = (
      recorded: ReturnType<typeof responseRecorder>,
      headers: Record<string, string>
    ) => {
      storeSurfaceGuardMiddleware(
        {
          method: "POST",
          originalUrl: PASSWORD_PATH,
          url: PASSWORD_PATH,
          path: PASSWORD_PATH,
          headers,
        } as never,
        recorded.response as never,
        () => {
          bffGuard(
            {
              method: "POST",
              originalUrl: PASSWORD_PATH,
              url: PASSWORD_PATH,
              path: PASSWORD_PATH,
              headers,
              correlationId: "password-bff-deny",
            } as never,
            recorded.response as never,
            handler
          )
        }
      )
    }

    apply(missing, {})
    apply(invalid, {
      [CUSTOMER_AUTH_BFF_AUTH_HEADER]: "indicio-bff-service-secret-synthetic-other",
    })

    expect(handler).not.toHaveBeenCalled()
    expect(missing.state.statusCode).toBe(404)
    expect(invalid.state.statusCode).toBe(404)
    expect(missing.state.body).toEqual({
      type: "not_found",
      message: "Not Found",
    })
    expect(invalid.state.body).toEqual({
      type: "not_found",
      message: "Not Found",
    })
  })

  it("lets a valid BFF service credential reach the password-change handler guards", () => {
    const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
      expectedSecret: "indicio-bff-service-secret-synthetic-32b",
    })
    const handler = jest.fn()
    const recorded = responseRecorder()
    const headers = {
      [CUSTOMER_AUTH_BFF_AUTH_HEADER]: "indicio-bff-service-secret-synthetic-32b",
    }

    storeSurfaceGuardMiddleware(
      {
        method: "POST",
        originalUrl: PASSWORD_PATH,
        url: PASSWORD_PATH,
        path: PASSWORD_PATH,
        headers,
      } as never,
      recorded.response as never,
      () => {
        bffGuard(
          {
            method: "POST",
            originalUrl: PASSWORD_PATH,
            url: PASSWORD_PATH,
            path: PASSWORD_PATH,
            headers,
            correlationId: "password-bff-allow",
          } as never,
          recorded.response as never,
          handler
        )
      }
    )

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("mounts the password path as BFF-only after the Store surface guard", () => {
    const routes = defaultMiddlewares.routes ?? []
    const storeSurface = routes.find(
      (route) => String(route.matcher) === "/store*"
    )
    const passwordRoute = routes.find(
      (route) => String(route.matcher) === PASSWORD_PATH
    )
    expect(storeSurface?.middlewares).toEqual(
      expect.arrayContaining([storeSurfaceGuardMiddleware])
    )
    expect(passwordRoute).toBeDefined()
    expect(passwordRoute?.middlewares).toEqual([
      customerAuthBffServiceGuardMiddleware,
    ])
    expect(passwordRoute?.middlewares).not.toContain(
      customerAuthAccessGuardMiddleware
    )
  })
})
