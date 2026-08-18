import { isCustomerAuthRecoveryFailClosed } from "../../../infrastructure/customer-auth-transaction-compatibility"
import {
  AUTH_CANARIES,
  assertAuthSinksHaveNoCanaries,
} from "../../../../integration-tests/helpers/auth-leakage"
import {
  AUTH_RESET_LEASE_MS,
  AUTH_RESET_TTL_MS,
  confirmPasswordReset,
  hashResetOperationId,
  reconcileSecretlessPasswordReset,
  requestPasswordReset,
  type AuthResetDatabase,
  type AuthResetPasswordProvider,
  type AuthResetRawResult,
} from "../reset"
import {
  deriveCustomerAuthCapability,
  hashCustomerAuthCapability,
} from "../security/capabilities"
import { runAuthResetReconcile } from "../../../jobs/auth-reset-reconcile"

type MemoryRow = Record<string, unknown>

type MemoryState = {
  credential: MemoryRow | null
  intents: MemoryRow[]
  outbox: MemoryRow[]
  lineages: MemoryRow[]
  refresh: MemoryRow[]
  nativeEvents: MemoryRow[]
  sessionsIssued: number
}

const KEYRING = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [{ version: 2, secret: "p".repeat(64) }],
}

const BASE = new Date("2026-08-17T03:00:00.000Z")
const AUTH_IDENTITY_ID = "identity_reset_unit_1"
const CUSTOMER_ID = "customer_reset_unit_1"
const RECIPIENT_IDENTITY_ID = "recipient_reset_unit_1"
const NORMALIZED_EMAIL = "customer@example.invalid"
const NEW_PASSWORD = AUTH_CANARIES.password
const IDEMPOTENCY_KEY = "reset-op-unit-1"

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

function rowDate(row: MemoryRow, key: string): Date | null {
  const value = row[key]
  if (value === null || value === undefined) {
    return null
  }
  return value instanceof Date ? value : new Date(String(value))
}

function rawRows(rows: MemoryRow[]): AuthResetRawResult {
  return { rows, rowCount: rows.length }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
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
    provider_proved_at: row.provider_proved_at,
    credential_updated_at: row.credential_updated_at,
    revocation_committed_at: row.revocation_committed_at,
    completed_at: row.completed_at,
  }
}

class MemoryResetDatabase implements AuthResetDatabase {
  state: MemoryState = {
    credential: null,
    intents: [],
    outbox: [],
    lineages: [],
    refresh: [],
    nativeEvents: [],
    sessionsIssued: 0,
  }

  private queue = Promise.resolve()

  async transaction<T>(
    callback: (transaction: {
      raw(sql: string, bindings?: unknown[]): Promise<AuthResetRawResult>
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

  seedCredential(verifiedAt: Date | null = null): void {
    this.state.credential = {
      id: "credential_reset_unit_1",
      auth_identity_id: AUTH_IDENTITY_ID,
      customer_id: CUSTOMER_ID,
      credential_version: 1,
      email_verified_at: verifiedAt,
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

  seedLineage(id = "lineage_reset_unit_1"): void {
    this.state.lineages.push({
      id,
      auth_identity_id: AUTH_IDENTITY_ID,
      customer_id: CUSTOMER_ID,
      credential_version_snapshot: 1,
      status: "active",
      version: 1,
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

  latestIntent(): MemoryRow | undefined {
    return [...this.state.intents]
      .sort((left, right) => Number(right.generation) - Number(left.generation))
      .at(0)
  }

  snapshot(): MemoryState {
    return cloneState(this.state)
  }

  private async execute(
    state: MemoryState,
    sql: string,
    bindings: unknown[]
  ): Promise<AuthResetRawResult> {
    if (sql.startsWith("select id, auth_identity_id, customer_id, credential_version")) {
      const credential =
        state.credential?.auth_identity_id === bindings[0]
          ? state.credential
          : null
      return rawRows(
        credential ? [cloneValue(credentialColumns(credential)) as MemoryRow] : []
      )
    }

    if (
      sql.startsWith("select * from auth_reset_intent where auth_identity_id = ?")
    ) {
      return rawRows(
        state.intents
          .filter(
            (intent) =>
              intent.auth_identity_id === bindings[0] &&
              intent.deleted_at === null
          )
          .sort(
            (left, right) => Number(right.generation) - Number(left.generation)
          )
          .map((intent) => cloneValue(intent) as MemoryRow)
      )
    }

    if (sql.startsWith("select * from auth_reset_intent where token_hash = ?")) {
      const intent = state.intents.find(
        (candidate) =>
          candidate.token_hash === bindings[0] && candidate.deleted_at === null
      )
      return rawRows(intent ? [cloneValue(intent) as MemoryRow] : [])
    }

    if (sql.startsWith("select * from auth_reset_intent where id = ?")) {
      const intent = state.intents.find(
        (candidate) => candidate.id === bindings[0] && candidate.deleted_at === null
      )
      return rawRows(intent ? [cloneValue(intent) as MemoryRow] : [])
    }

    if (
      sql.startsWith("select * from auth_reset_intent") &&
      sql.includes("status in ('claimed', 'credential_updated', 'revocation_committed', 'failed_reconcilable')")
    ) {
      const now = new Date(String(bindings[0]))
      return rawRows(
        state.intents
          .filter((intent) => {
            if (
              !["claimed", "credential_updated", "revocation_committed", "failed_reconcilable"].includes(
                String(intent.status)
              ) ||
              intent.completed_at ||
              intent.deleted_at
            ) {
              return false
            }
            const leaseUntil = rowDate(intent, "lease_until")
            const nextRetry = rowDate(intent, "next_retry_at")
            const leaseClaimable = !leaseUntil || leaseUntil.getTime() <= now.getTime()
            const retryDue = !nextRetry || nextRetry.getTime() <= now.getTime()
            return leaseClaimable && retryDue
          })
          .map((intent) => cloneValue(intent) as MemoryRow)
      )
    }

    if (sql.startsWith("insert into auth_reset_intent")) {
      const [
        id,
        identityId,
        tokenHash,
        nonce,
        keyVersion,
        generation,
        expiresAt,
        createdAt,
      ] = bindings
      const row: MemoryRow = {
        id,
        auth_identity_id: identityId,
        token_hash: tokenHash,
        nonce,
        key_version: keyVersion,
        generation,
        status: "pending",
        version: 1,
        operation_id: null,
        lease_owner: null,
        lease_until: null,
        attempt_count: 0,
        next_retry_at: null,
        expires_at: expiresAt,
        claimed_at: null,
        provider_proved_at: null,
        credential_updated_at: null,
        revocation_committed_at: null,
        completed_at: null,
        superseded_at: null,
        expired_at: null,
        failed_reconcilable_at: null,
        schema_version: 1,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      }
      state.intents.push(row)
      return rawRows([cloneValue(row) as MemoryRow])
    }

    if (sql.startsWith("insert into auth_notification_outbox")) {
      const [
        id,
        template,
        intentType,
        intentId,
        generation,
        idempotencyKey,
        recipientIdentityId,
        recipientHash,
        recipientDomain,
        keyVersion,
        recordedAt,
        schemaVersion,
      ] = bindings
      const row: MemoryRow = {
        id,
        template,
        intent_type: intentType,
        intent_id: intentId,
        generation,
        idempotency_key: idempotencyKey,
        status: "recorded",
        recipient_identity_id: recipientIdentityId,
        recipient_hash: recipientHash,
        recipient_domain: recipientDomain,
        key_version: keyVersion,
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
        schema_version: schemaVersion,
        created_at: recordedAt,
        updated_at: recordedAt,
        deleted_at: null,
      }
      state.outbox.push(row)
      return rawRows([cloneValue(row) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'expired'")) {
      const [marker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === "pending" &&
          candidate.operation_id === null
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "expired"
      intent.expired_at = marker
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'superseded'")) {
      const [marker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === "pending" &&
          candidate.operation_id === null
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "superseded"
      intent.superseded_at = marker
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'claimed'")) {
      const [claimedAt, operationId, leaseOwner, leaseUntilAt, updatedAt, id] =
        bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === "pending" &&
          candidate.operation_id === null
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "claimed"
      intent.claimed_at = claimedAt
      intent.operation_id = operationId
      intent.lease_owner = leaseOwner
      intent.lease_until = leaseUntilAt
      intent.attempt_count = Number(intent.attempt_count) + 1
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (
      sql.startsWith("update auth_reset_intent set status = ?") &&
      sql.includes("failed_reconcilable_at = null")
    ) {
      const [status, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id && candidate.status === "failed_reconcilable"
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = status
      intent.failed_reconcilable_at = null
      intent.next_retry_at = null
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set provider_proved_at = ?")) {
      const [provedAt, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === "claimed" &&
          candidate.provider_proved_at === null
      )
      if (!intent) {
        return rawRows([])
      }
      intent.provider_proved_at = provedAt
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'credential_updated'")) {
      const [updatedAtMarker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === "claimed" &&
          candidate.provider_proved_at !== null
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "credential_updated"
      intent.credential_updated_at = updatedAtMarker
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'revocation_committed'")) {
      const [marker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id && candidate.status === "credential_updated"
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "revocation_committed"
      intent.revocation_committed_at = marker
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'completed'")) {
      const [marker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id && candidate.status === "revocation_committed"
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "completed"
      intent.completed_at = marker
      intent.lease_owner = null
      intent.lease_until = null
      intent.next_retry_at = null
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_reset_intent set status = 'failed_reconcilable'")) {
      const [failedAt, nextRetryAt, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          ["claimed", "credential_updated", "revocation_committed"].includes(
            String(candidate.status)
          )
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "failed_reconcilable"
      intent.failed_reconcilable_at = failedAt
      intent.next_retry_at = nextRetryAt
      intent.lease_owner = null
      intent.lease_until = null
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (
      sql.startsWith("update auth_reset_intent set lease_owner = ?") &&
      sql.includes("attempt_count = attempt_count + 1")
    ) {
      const [
        leaseOwner,
        leaseUntilAt,
        updatedAt,
        id,
        expectedVersion,
        expectedStatus,
        claimableNow,
      ] = bindings
      const now = new Date(String(claimableNow))
      const intent = state.intents.find((candidate) => {
        if (
          candidate.id !== id ||
          candidate.completed_at ||
          candidate.deleted_at ||
          Number(candidate.version) !== Number(expectedVersion) ||
          candidate.status !== expectedStatus
        ) {
          return false
        }
        const currentLease = rowDate(candidate, "lease_until")
        return !currentLease || currentLease.getTime() <= now.getTime()
      })
      if (!intent) {
        return rawRows([])
      }
      intent.lease_owner = leaseOwner
      intent.lease_until = leaseUntilAt
      intent.attempt_count = Number(intent.attempt_count) + 1
      intent.version = Number(intent.version) + 1
      intent.updated_at = updatedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (sql.startsWith("update auth_credential_state set operation_status = 'claimed'")) {
      const [operationId, leaseOwner, leaseUntilAt, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "stable"
      ) {
        return rawRows([])
      }
      credential.operation_status = "claimed"
      credential.operation_type = "reset"
      credential.operation_id = operationId
      credential.lease_owner = leaseOwner
      credential.lease_until = leaseUntilAt
      credential.operation_version = Number(credential.operation_version) + 1
      credential.attempt_count = Number(credential.attempt_count) + 1
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (
      sql.startsWith("update auth_credential_state set operation_status = ?") &&
      sql.includes("provider_outcome_ambiguous")
    ) {
      const [status, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "provider_outcome_ambiguous"
      ) {
        return rawRows([])
      }
      credential.operation_status = status
      credential.next_retry_at = null
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (sql.startsWith("update auth_credential_state set operation_status = 'credential_proved'")) {
      const [provedAt, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "claimed"
      ) {
        return rawRows([])
      }
      credential.operation_status = "credential_proved"
      credential.provider_proved_at = provedAt
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (sql.startsWith("update auth_credential_state set operation_status = 'credential_updated'")) {
      const [updatedAtMarker, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "credential_proved"
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

    if (sql.startsWith("update auth_credential_state set operation_status = 'revocation_committed'")) {
      const [marker, updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "credential_updated"
      ) {
        return rawRows([])
      }
      credential.operation_status = "revocation_committed"
      credential.revocation_committed_at = marker
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credentialColumns(credential)) as MemoryRow])
    }

    if (sql.startsWith("update auth_credential_state set operation_status = 'stable'")) {
      const [updatedAt, id] = bindings
      const credential = state.credential
      if (
        !credential ||
        credential.id !== id ||
        credential.operation_status !== "revocation_committed"
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

    if (sql.startsWith("update auth_credential_state set operation_status = 'provider_outcome_ambiguous'")) {
      const [nextRetryAt, updatedAt, id] = bindings
      const credential = state.credential
      if (!credential || credential.id !== id) {
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
      sql.startsWith("update auth_credential_state set lease_owner = ?") &&
      sql.includes("attempt_count = attempt_count + 1")
    ) {
      const [
        leaseOwner,
        leaseUntilAt,
        updatedAt,
        id,
        expectedVersion,
        expectedStatus,
        claimableNow,
      ] = bindings
      const now = new Date(String(claimableNow))
      const credential = state.credential
      const currentLease = credential ? rowDate(credential, "lease_until") : null
      if (
        !credential ||
        credential.id !== id ||
        credential.completed_at ||
        credential.deleted_at ||
        credential.operation_type !== "reset" ||
        Number(credential.version) !== Number(expectedVersion) ||
        credential.operation_status !== expectedStatus ||
        (currentLease && currentLease.getTime() > now.getTime())
      ) {
        return rawRows([])
      }
      credential.lease_owner = leaseOwner
      credential.lease_until = leaseUntilAt
      credential.attempt_count = Number(credential.attempt_count) + 1
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
          row.revocation_reason = "password_reset"
          row.version = Number(row.version) + 1
        }
      }
      return rawRows([])
    }

    throw new Error(`Unhandled memory SQL: ${sql}`)
  }
}

class RecordingProvider implements AuthResetPasswordProvider {
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

let idSequence = 0
let nonceSequence = 0

function idFactory(prefix: string): string {
  idSequence += 1
  return `${prefix}_unit_${idSequence}`
}

function randomBytesFactory(size: number): Buffer {
  nonceSequence += 1
  return Buffer.alloc(size, nonceSequence)
}

function requestInput(
  overrides: Partial<Parameters<typeof requestPasswordReset>[1]> = {}
) {
  return {
    authIdentityId: AUTH_IDENTITY_ID,
    recipientIdentityId: RECIPIENT_IDENTITY_ID,
    normalizedEmail: NORMALIZED_EMAIL,
    keyring: KEYRING,
    now: BASE,
    idFactory,
    randomBytesFn: randomBytesFactory,
    ...overrides,
  }
}

function capabilityFor(intent: MemoryRow, keyring = KEYRING): string {
  return deriveCustomerAuthCapability({
    keyring,
    purpose: "reset",
    intentId: String(intent.id),
    generation: Number(intent.generation),
    nonce: String(intent.nonce),
    keyVersion: Number(intent.key_version),
  }).capability
}

function confirmInput(
  capability: string,
  provider: AuthResetPasswordProvider,
  overrides: Partial<Parameters<typeof confirmPasswordReset>[1]> = {}
) {
  return {
    capability,
    newPassword: NEW_PASSWORD,
    idempotencyKey: IDEMPOTENCY_KEY,
    keyring: KEYRING,
    provider,
    now: new Date(BASE.getTime() + 1_000),
    ...overrides,
  }
}

describe("customer auth reset domain (P14-D13..15)", () => {
  beforeEach(() => {
    idSequence = 0
    nonceSequence = 0
  })

  it("creates a latest-wins hash-only pending intent and outbox with a 15-minute TTL", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    const first = await requestPasswordReset(database, requestInput())
    const old = database.latestIntent()!
    const oldCapability = capabilityFor(old)
    const second = await requestPasswordReset(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )
    const current = database.latestIntent()!

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(current.generation).toBe(Number(old.generation) + 1)
    expect(rowDate(current, "expires_at")!.getTime()).toBe(
      rowDate(current, "created_at")!.getTime() + AUTH_RESET_TTL_MS
    )
    expect(database.state.intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.id, status: "superseded" }),
        expect.objectContaining({ id: current.id, status: "pending" }),
      ])
    )
    expect(database.state.outbox).toHaveLength(2)
    expect(JSON.stringify(database.snapshot())).not.toContain(oldCapability)
    expect(JSON.stringify(database.snapshot())).not.toContain(NEW_PASSWORD)
    expect(database.state.sessionsIssued).toBe(0)
    expect(database.state.nativeEvents).toHaveLength(0)
  })

  it("does not create an intent when the identity is unknown or recovery is non-stable", async () => {
    const unknown = new MemoryResetDatabase()
    const unknownResult = await requestPasswordReset(unknown, requestInput())
    expect(unknownResult).toMatchObject({ accepted: true, created: false, intent: null })
    expect(unknown.state.intents).toHaveLength(0)

    const blocked = new MemoryResetDatabase()
    blocked.seedCredential()
    blocked.state.credential!.operation_status = "claimed"
    blocked.state.credential!.operation_type = "reset"
    blocked.state.credential!.operation_id = "already-bound"
    const blockedResult = await requestPasswordReset(blocked, requestInput())
    expect(blockedResult.created).toBe(false)
    expect(blocked.state.intents).toHaveLength(0)
    expect(
      isCustomerAuthRecoveryFailClosed(
        blocked.state.credential!.operation_status as "claimed"
      )
    ).toBe(true)
  })

  it("completes composed reset only after password proof, token consume and global revoke", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    database.seedLineage()
    database.seedLineage("lineage_reset_unit_2")
    await requestPasswordReset(database, requestInput())
    const intent = database.latestIntent()!
    const capability = capabilityFor(intent)
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: "old-password-value",
    })

    const result = await confirmPasswordReset(
      database,
      confirmInput(capability, provider)
    )

    expect(result).toMatchObject({ outcome: "completed" })
    expect(provider.updateCalls).toBe(1)
    expect(provider.verifyCalls).toBeGreaterThanOrEqual(1)
    expect(provider.calls.slice(0, 2)).toEqual(["update", "verify"])
    expect(database.latestIntent()?.status).toBe("completed")
    expect(database.state.credential?.operation_status).toBe("stable")
    expect(database.state.credential?.credential_version).toBe(2)
    expect(database.state.credential?.email_verified_at).toBeNull()
    expect(database.state.lineages.every((row) => row.status === "revoked")).toBe(
      true
    )
    expect(database.state.refresh.every((row) => row.status === "revoked")).toBe(
      true
    )
    expect(database.state.sessionsIssued).toBe(0)
    expect(JSON.stringify(database.snapshot())).not.toContain(NEW_PASSWORD)
    expect(JSON.stringify(database.snapshot())).not.toContain(capability)
    expect(hashCustomerAuthCapability(capability)).toBe(
      database.latestIntent()?.token_hash
    )
  })

  it("keeps an unverified identity unverified and never issues a session", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential(null)
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    await confirmPasswordReset(
      database,
      confirmInput(capability, new RecordingProvider())
    )
    expect(database.state.credential?.email_verified_at).toBeNull()
    expect(database.state.sessionsIssued).toBe(0)
  })

  it("preserves a verified email timestamp across reset", async () => {
    const verifiedAt = new Date("2026-08-01T00:00:00.000Z")
    const database = new MemoryResetDatabase()
    database.seedCredential(verifiedAt)
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    await confirmPasswordReset(
      database,
      confirmInput(capability, new RecordingProvider())
    )
    expect(rowDate(database.state.credential!, "email_verified_at")?.toISOString()).toBe(
      verifiedAt.toISOString()
    )
  })

  it("rejects expired, used, superseded, unknown and malformed capabilities uniformly", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    await requestPasswordReset(database, requestInput())
    const first = database.latestIntent()!
    const firstCapability = capabilityFor(first)
    await requestPasswordReset(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )
    const current = database.latestIntent()!
    const currentCapability = capabilityFor(current)
    const provider = new RecordingProvider()

    await expect(
      confirmPasswordReset(
        database,
        confirmInput(firstCapability, provider)
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })

    const expired = new MemoryResetDatabase()
    expired.seedCredential()
    await requestPasswordReset(expired, requestInput())
    const expiredCapability = capabilityFor(expired.latestIntent()!)
    await expect(
      confirmPasswordReset(
        expired,
        confirmInput(expiredCapability, provider, {
          now: new Date(BASE.getTime() + AUTH_RESET_TTL_MS + 1),
        })
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })

    await confirmPasswordReset(
      database,
      confirmInput(currentCapability, provider)
    )
    await expect(
      confirmPasswordReset(
        database,
        confirmInput(currentCapability, provider, {
          idempotencyKey: "different-key",
        })
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })

    await expect(
      confirmPasswordReset(
        database,
        confirmInput("x".repeat(43), provider)
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })
    await expect(
      confirmPasswordReset(
        database,
        confirmInput("+++not-a-capability+++", provider)
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })
  })

  it("lets only one concurrent claim win", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    const results = await Promise.allSettled([
      confirmPasswordReset(
        database,
        confirmInput(capability, new RecordingProvider())
      ),
      confirmPasswordReset(
        database,
        confirmInput(capability, new RecordingProvider(), {
          idempotencyKey: "other-key",
        })
      ),
    ])
    const fulfilled = results.filter((entry) => entry.status === "fulfilled")
    const rejected = results.filter((entry) => entry.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      (fulfilled[0] as PromiseFulfilledResult<{ outcome: string }>).value.outcome
    ).toBe("completed")
  })

  it("keeps provider timeout fail-closed and secretless reconciler cannot complete it", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    database.seedLineage()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    const provider = new RecordingProvider()
    provider.nextUpdate = "timeout"

    const pending = await confirmPasswordReset(
      database,
      confirmInput(capability, provider)
    )
    expect(pending).toMatchObject({ outcome: "recovery_pending" })
    expect(database.latestIntent()?.status).toBe("failed_reconcilable")
    expect(database.state.credential?.operation_status).toBe(
      "provider_outcome_ambiguous"
    )
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(
      isCustomerAuthRecoveryFailClosed(
        database.state.credential!.operation_status as "provider_outcome_ambiguous"
      )
    ).toBe(true)

    const alerts: Array<Record<string, unknown>> = []
    const reconciled = await reconcileSecretlessPasswordReset(database, {
      now: new Date(BASE.getTime() + 2 * 60 * 1000),
      leaseOwner: "authlease_secretless_unit",
      logger: {
        warn(_message, meta) {
          alerts.push(meta ?? {})
        },
      },
    })
    expect(reconciled.processed).toBeGreaterThan(0)
    expect(database.latestIntent()?.status).not.toBe("completed")
    expect(database.state.credential?.operation_status).not.toBe("stable")
    expect(database.state.credential?.credential_updated_at).toBeNull()
    expect(JSON.stringify(alerts)).not.toContain(NEW_PASSWORD)
    expect(JSON.stringify(alerts)).not.toContain(capability)

    const job = await runAuthResetReconcile({
      database,
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => new Date(BASE.getTime() + 3 * 60 * 1000),
      leaseOwner: "authlease_secretless_job",
    })
    expect(job.noop_reason).toBeNull()
    expect(database.latestIntent()?.status).not.toBe("completed")
  })

  it("lets only one reconciler own a fresh recovery lease", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    const provider = new RecordingProvider()
    provider.nextUpdate = "timeout"
    await confirmPasswordReset(database, confirmInput(capability, provider))

    const acquireNow = new Date(BASE.getTime() + 2 * 60 * 1000)
    const beforeAttempt = Number(database.latestIntent()?.attempt_count)
    const [first, second] = await Promise.all([
      reconcileSecretlessPasswordReset(database, {
        now: acquireNow,
        leaseOwner: "authlease_unit_worker_a",
      }),
      reconcileSecretlessPasswordReset(database, {
        now: acquireNow,
        leaseOwner: "authlease_unit_worker_b",
      }),
    ])

    expect(first.leased + second.leased).toBe(1)
    const winner = database.latestIntent()!
    const winnerOwner = winner.lease_owner
    const winnerAttempt = Number(winner.attempt_count)
    const winnerLeaseUntil = rowDate(winner, "lease_until")!
    expect(["authlease_unit_worker_a", "authlease_unit_worker_b"]).toContain(
      winnerOwner
    )
    expect(winnerAttempt).toBe(beforeAttempt + 1)
    expect(winner.status).toBe("failed_reconcilable")
    expect(winner.completed_at).toBeNull()
    expect(winner.provider_proved_at).toBeNull()
    expect(provider.updateCalls).toBe(1)
    expect(provider.verifyCalls).toBe(0)

    const blockedNow = new Date(winnerLeaseUntil.getTime() - 1)
    const blocked = await reconcileSecretlessPasswordReset(database, {
      now: blockedNow,
      leaseOwner: "authlease_unit_worker_c",
    })
    expect(blocked.leased).toBe(0)
    expect(database.latestIntent()?.lease_owner).toBe(winnerOwner)
    expect(Number(database.latestIntent()?.attempt_count)).toBe(winnerAttempt)

    const expired = await reconcileSecretlessPasswordReset(database, {
      now: winnerLeaseUntil,
      leaseOwner: "authlease_unit_worker_d",
    })
    expect(expired.leased).toBe(1)
    expect(database.latestIntent()?.lease_owner).toBe("authlease_unit_worker_d")
    expect(
      rowDate(database.latestIntent()!, "lease_until")!.getTime()
    ).toBe(winnerLeaseUntil.getTime() + AUTH_RESET_LEASE_MS)
    expect(database.latestIntent()?.status).not.toBe("completed")
    expect(provider.updateCalls).toBe(1)
    expect(provider.verifyCalls).toBe(0)
  })

  it("resumes only the same Idempotency-Key after re-presenting newPassword", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    database.seedLineage()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    const provider = new RecordingProvider()
    provider.nextUpdate = "ambiguous"

    await confirmPasswordReset(database, confirmInput(capability, provider))
    await expect(
      confirmPasswordReset(
        database,
        confirmInput(capability, provider, { idempotencyKey: "other-op" })
      )
    ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })

    provider.passwordByIdentity.clear()
    const beforeRetry = {
      updateCalls: provider.updateCalls,
      verifyCalls: provider.verifyCalls,
      calls: [...provider.calls],
    }
    const completed = await confirmPasswordReset(
      database,
      confirmInput(capability, provider)
    )
    expect(completed).toMatchObject({ outcome: "completed" })
    expect(provider.calls.slice(beforeRetry.calls.length, beforeRetry.calls.length + 1)).toEqual([
      "verify",
    ])
    expect(provider.updateCalls).toBe(beforeRetry.updateCalls + 1)
    expect(provider.verifyCalls).toBeGreaterThan(beforeRetry.verifyCalls)
    expect(completed).toMatchObject({ outcome: "completed" })
    expect(database.latestIntent()?.status).toBe("completed")
    expect(database.state.credential?.operation_status).toBe("stable")
    expect(
      database.latestIntent()?.operation_id
    ).toBe(hashResetOperationId({ keyring: KEYRING, idempotencyKey: IDEMPOTENCY_KEY }))
  })

  it("treats a verify-after-timeout as the missing provider proof without a second update when it already matches", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    const provider = new RecordingProvider()
    provider.nextUpdate = "timeout"
    await confirmPasswordReset(database, confirmInput(capability, provider))
    provider.passwordByIdentity.set(AUTH_IDENTITY_ID, NEW_PASSWORD)
    const beforeUpdates = provider.updateCalls
    const beforeCalls = [...provider.calls]
    const completed = await confirmPasswordReset(
      database,
      confirmInput(capability, provider)
    )
    expect(completed.outcome).toBe("completed")
    expect(provider.calls.slice(beforeCalls.length)).toEqual(["verify"])
    expect(provider.updateCalls).toBe(beforeUpdates)
    expect(provider.verifyCalls).toBeGreaterThanOrEqual(1)
  })

  it("fresh reset still updates then verifies even when the provider already accepts newPassword", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    database.seedLineage()
    await requestPasswordReset(database, requestInput())
    const intent = database.latestIntent()!
    const capability = capabilityFor(intent)
    const provider = new RecordingProvider({
      authIdentityId: AUTH_IDENTITY_ID,
      password: NEW_PASSWORD,
    })

    const result = await confirmPasswordReset(
      database,
      confirmInput(capability, provider)
    )

    expect(result.outcome).toBe("completed")
    expect(provider.updateCalls).toBe(1)
    expect(provider.verifyCalls).toBeGreaterThanOrEqual(1)
    expect(provider.calls.indexOf("update")).toBe(0)
    expect(provider.calls.indexOf("verify")).toBeGreaterThan(
      provider.calls.indexOf("update")
    )
    expect(provider.calls.slice(0, 2)).toEqual(["update", "verify"])
    expect(database.latestIntent()?.status).toBe("completed")
    expect(database.latestIntent()?.provider_proved_at).not.toBeNull()
    expect(database.state.credential?.credential_version).toBe(2)
    expect(database.state.lineages.every((row) => row.status === "revoked")).toBe(
      true
    )
  })

  it("does not persist password fingerprints or capability plaintext", async () => {
    const database = new MemoryResetDatabase()
    database.seedCredential()
    await requestPasswordReset(database, requestInput())
    const capability = capabilityFor(database.latestIntent()!)
    await confirmPasswordReset(
      database,
      confirmInput(capability, new RecordingProvider())
    )
    const snapshot = database.snapshot()
    assertAuthSinksHaveNoCanaries({
      db_plaintext: snapshot,
      fixtures_snapshots: snapshot,
    })
    expect(JSON.stringify(snapshot)).not.toContain(NEW_PASSWORD)
    expect(JSON.stringify(snapshot)).not.toContain(capability)
    expect(JSON.stringify(snapshot)).not.toContain(IDEMPOTENCY_KEY)
  })
})
