import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  autoRequestVerification,
  confirmVerification,
  getVerificationStatus,
  resendVerification,
  type AuthVerificationDatabase,
  type AuthVerificationRawResult,
} from "../verification"
import {
  deriveCustomerAuthCapability,
  hashCustomerAuthCapability,
} from "../security/capabilities"

type MemoryRow = Record<string, unknown>

type MemoryState = {
  credential: MemoryRow | null
  intents: MemoryRow[]
  outbox: MemoryRow[]
  resetMutations: number
  sessionLineages: MemoryRow[]
  nativeEvents: MemoryRow[]
}

const KEYRING = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [{ version: 2, secret: "p".repeat(64) }],
}

const ROTATED_KEYRING = {
  active: { version: 2, secret: "q".repeat(64) },
  previous: [{ version: 1, secret: "k".repeat(64) }],
}

const BASE = new Date("2026-08-15T03:00:00.000Z")
const AUTH_IDENTITY_ID = "identity_unit_1"
const RECIPIENT_IDENTITY_ID = "recipient_unit_1"
const NORMALIZED_EMAIL = "customer@example.invalid"

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

function rawRows(rows: MemoryRow[]): AuthVerificationRawResult {
  return { rows, rowCount: rows.length }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
}

class MemoryVerificationDatabase implements AuthVerificationDatabase {
  state: MemoryState = {
    credential: null,
    intents: [],
    outbox: [],
    resetMutations: 0,
    sessionLineages: [],
    nativeEvents: [],
  }

  private queue = Promise.resolve()

  async transaction<T>(
    callback: (transaction: {
      raw(
        sql: string,
        bindings?: unknown[]
      ): Promise<AuthVerificationRawResult>
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
      id: "credential_unit_1",
      auth_identity_id: AUTH_IDENTITY_ID,
      customer_id: "customer_unit_1",
      email_verified_at: verifiedAt,
      version: 1,
      deleted_at: null,
    }
  }

  markResetMutation(): void {
    this.state.resetMutations += 1
  }

  latestIntent(): MemoryRow | undefined {
    return [...this.state.intents]
      .sort((left, right) => Number(right.generation) - Number(left.generation))
      .at(0)
  }

  pendingIntents(): MemoryRow[] {
    return this.state.intents.filter(
      (intent) =>
        intent.status === "pending" || intent.status === "claimed"
    )
  }

  snapshot(): MemoryState {
    return cloneState(this.state)
  }

  private async execute(
    state: MemoryState,
    sql: string,
    bindings: unknown[]
  ): Promise<AuthVerificationRawResult> {
    if (
      sql.startsWith(
        "select id, auth_identity_id, email_verified_at, version from auth_credential_state"
      )
    ) {
      const credential =
        state.credential?.auth_identity_id === bindings[0]
          ? state.credential
          : null
      return rawRows(credential ? [cloneValue(credential) as MemoryRow] : [])
    }

    if (
      sql.startsWith(
        "select email_verified_at from auth_credential_state"
      )
    ) {
      const credential =
        state.credential?.auth_identity_id === bindings[0]
          ? state.credential
          : null
      return rawRows(
        credential
          ? [{ email_verified_at: cloneValue(credential.email_verified_at) }]
          : []
      )
    }

    if (
      sql.startsWith(
        "select * from auth_verification_intent where auth_identity_id = ?"
      )
    ) {
      const identityId = String(bindings[0])
      return rawRows(
        state.intents
          .filter(
            (intent) =>
              intent.auth_identity_id === identityId &&
              intent.deleted_at === null
          )
          .sort(
            (left, right) => Number(right.generation) - Number(left.generation)
          )
          .map((intent) => cloneValue(intent) as MemoryRow)
      )
    }

    if (
      sql.startsWith(
        "select * from auth_verification_intent where token_hash = ?"
      )
    ) {
      const intent = state.intents.find(
        (candidate) =>
          candidate.token_hash === bindings[0] &&
          candidate.deleted_at === null
      )
      return rawRows(intent ? [cloneValue(intent) as MemoryRow] : [])
    }

    if (
      sql.startsWith(
        "select * from auth_verification_intent where id = ?"
      )
    ) {
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === bindings[0] && candidate.deleted_at === null
      )
      return rawRows(intent ? [cloneValue(intent) as MemoryRow] : [])
    }

    if (sql.startsWith("insert into auth_verification_intent")) {
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
        expires_at: expiresAt,
        claimed_at: null,
        confirmed_at: null,
        superseded_at: null,
        expired_at: null,
        dead_lettered_at: null,
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

    if (
      sql.startsWith(
        "update auth_verification_intent set status = 'expired'"
      )
    ) {
      const [marker, updatedAt, id, expiresBefore] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          (candidate.status === "pending" || candidate.status === "claimed") &&
          rowDate(candidate, "expires_at")!.getTime() <=
            new Date(String(expiresBefore)).getTime()
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

    if (
      sql.startsWith(
        "update auth_verification_intent set status = 'superseded'"
      ) && sql.includes("where id = ?")
    ) {
      const [marker, updatedAt, id] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          (candidate.status === "pending" || candidate.status === "claimed")
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

    if (
      sql.startsWith(
        "update auth_verification_intent set status = 'superseded'"
      ) && sql.includes("where auth_identity_id = ?")
    ) {
      const [marker, updatedAt, identityId, excludedId] = bindings
      const updated: MemoryRow[] = []
      for (const intent of state.intents) {
        if (
          intent.auth_identity_id === identityId &&
          intent.id !== excludedId &&
          (intent.status === "pending" || intent.status === "claimed")
        ) {
          intent.status = "superseded"
          intent.superseded_at = marker
          intent.version = Number(intent.version) + 1
          intent.updated_at = updatedAt
          updated.push(cloneValue(intent) as MemoryRow)
        }
      }
      return rawRows(updated)
    }

    if (
      sql.startsWith(
        "update auth_verification_intent set status = 'confirmed'"
      )
    ) {
      const [claimedAt, confirmedAt, , id, tokenHash, expiresAfter] = bindings
      const intent = state.intents.find(
        (candidate) =>
          candidate.id === id &&
          candidate.token_hash === tokenHash &&
          candidate.status === "pending" &&
          rowDate(candidate, "expires_at")!.getTime() >
            new Date(String(expiresAfter)).getTime()
      )
      if (!intent) {
        return rawRows([])
      }
      intent.status = "confirmed"
      intent.claimed_at = claimedAt
      intent.confirmed_at = confirmedAt
      intent.version = Number(intent.version) + 1
      intent.updated_at = confirmedAt
      return rawRows([cloneValue(intent) as MemoryRow])
    }

    if (
      sql.startsWith(
        "update auth_credential_state set email_verified_at = ?"
      )
    ) {
      const [verifiedAt, updatedAt, id] = bindings
      const currentCredential = state.credential
      const credential =
        currentCredential !== null &&
        currentCredential.id === id &&
        currentCredential.email_verified_at === null
          ? currentCredential
          : null
      if (!credential) {
        return rawRows([])
      }
      credential.email_verified_at = verifiedAt
      credential.version = Number(credential.version) + 1
      credential.updated_at = updatedAt
      return rawRows([cloneValue(credential) as MemoryRow])
    }

    throw new Error(`Unhandled memory SQL: ${sql}`)
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
  overrides: Partial<Parameters<typeof autoRequestVerification>[1]> = {}
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

function capabilityFor(
  intent: MemoryRow,
  keyring = KEYRING
): string {
  return deriveCustomerAuthCapability({
    keyring,
    purpose: "verification",
    intentId: String(intent.id),
    generation: Number(intent.generation),
    nonce: String(intent.nonce),
    keyVersion: Number(intent.key_version),
  }).capability
}

function expectUniformInvalid(error: unknown): void {
  expect(error).toMatchObject({
    code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
  })
}

describe("customer auth verification domain (P14-D08)", () => {
  beforeEach(() => {
    idSequence = 0
    nonceSequence = 0
  })

  it("auto-requests one hash-only intent and outbox with an exact 30-minute TTL", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()

    const result = await autoRequestVerification(
      database,
      requestInput()
    )
    const intent = database.latestIntent()!
    const snapshot = database.snapshot()
    const capability = capabilityFor(intent)

    expect(result).toMatchObject({
      accepted: true,
      created: true,
      state: "pending",
    })
    expect(intent.status).toBe("pending")
    expect(rowDate(intent, "expires_at")!.getTime()).toBe(
      rowDate(intent, "created_at")!.getTime() + 30 * 60 * 1000
    )
    expect(snapshot.outbox).toHaveLength(1)
    expect(snapshot.outbox[0]).toMatchObject({
      intent_id: intent.id,
      generation: intent.generation,
      status: "recorded",
    })
    expect(JSON.stringify(snapshot)).not.toContain(capability)
    expect(Object.keys(intent)).not.toEqual(
      expect.arrayContaining(["capability", "token", "code"])
    )
    expect(snapshot.sessionLineages).toHaveLength(0)
    expect(snapshot.nativeEvents).toHaveLength(0)
  })

  it("keeps automatic request idempotent without duplicating intent or outbox", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()

    const first = await autoRequestVerification(database, requestInput())
    const second = await autoRequestVerification(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )

    expect(first.created).toBe(true)
    expect(second).toMatchObject({
      accepted: true,
      created: false,
      state: "pending",
    })
    expect(database.state.intents).toHaveLength(1)
    expect(database.state.outbox).toHaveLength(1)
  })

  it("applies resend latest-wins and makes the old generation uniformly invalid", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()

    await autoRequestVerification(database, requestInput())
    const oldIntent = database.latestIntent()!
    const oldCapability = capabilityFor(oldIntent)

    const resend = await resendVerification(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )
    const current = database.latestIntent()!
    const currentCapability = capabilityFor(current)

    expect(resend).toMatchObject({
      accepted: true,
      created: true,
      state: "pending",
    })
    expect(Number(current.generation)).toBe(Number(oldIntent.generation) + 1)
    expect(database.pendingIntents()).toHaveLength(1)
    expect(database.state.intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldIntent.id, status: "superseded" }),
        expect.objectContaining({ id: current.id, status: "pending" }),
      ])
    )
    expect(database.state.outbox).toHaveLength(2)

    await expect(
      confirmVerification(database, {
        capability: oldCapability,
        now: new Date(BASE.getTime() + 2_000),
      })
    ).rejects.toMatchObject({
      code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
    })

    const confirmed = await confirmVerification(database, {
      capability: currentCapability,
      now: new Date(BASE.getTime() + 2_000),
    })
    expect(confirmed).toMatchObject({
      success: true,
      state: "verified",
    })
    expect(database.state.credential?.email_verified_at).toBeInstanceOf(Date)
    expect(database.pendingIntents()).toHaveLength(0)
    expect(database.state.sessionLineages).toHaveLength(0)
  })

  it("serializes two concurrent resends to one pending latest generation", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()
    await autoRequestVerification(database, requestInput())

    const results = await Promise.all([
      resendVerification(
        database,
        requestInput({ now: new Date(BASE.getTime() + 1_000) })
      ),
      resendVerification(
        database,
        requestInput({ now: new Date(BASE.getTime() + 1_000) })
      ),
    ])

    expect(results.every((result) => result.accepted)).toBe(true)
    expect(database.pendingIntents()).toHaveLength(1)
    expect(database.state.intents).toHaveLength(3)
    expect(database.state.outbox).toHaveLength(3)
    expect(database.latestIntent()?.status).toBe("pending")
  })

  it("lets exactly one concurrent confirmation win and rejects the loser uniformly", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()
    await autoRequestVerification(database, requestInput())
    const intent = database.latestIntent()!
    const capability = capabilityFor(intent)

    const results = await Promise.allSettled([
      confirmVerification(database, {
        capability,
        now: new Date(BASE.getTime() + 1_000),
      }),
      confirmVerification(database, {
        capability,
        now: new Date(BASE.getTime() + 1_000),
      }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1
    )
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    expect(rejected).toBeDefined()
    expectUniformInvalid(rejected?.reason)
    expect(database.state.intents).toEqual([
      expect.objectContaining({ status: "confirmed" }),
    ])
    expect(database.state.credential?.email_verified_at).toBeInstanceOf(Date)
    expect(database.state.sessionLineages).toHaveLength(0)
    expect(database.state.nativeEvents).toHaveLength(0)
  })

  it.each(["confirmed", "expired"] as const)(
    "rejects %s generations with the same invalid-or-expired code",
    async (terminalState) => {
      const database = new MemoryVerificationDatabase()
      database.seedCredential()
      await autoRequestVerification(database, requestInput())
      const intent = database.latestIntent()!
      const capability = capabilityFor(intent)

      if (terminalState === "confirmed") {
        await confirmVerification(database, { capability, now: BASE })
      } else {
        await expect(
          confirmVerification(database, {
            capability,
            now: new Date(BASE.getTime() + 30 * 60 * 1000),
          })
        ).rejects.toMatchObject({
          code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
        })
      }

      await expect(
        confirmVerification(database, {
          capability,
          now: new Date(BASE.getTime() + 30 * 60 * 1000 + 1),
        })
      ).rejects.toMatchObject({
        code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
      })
    }
  )

  it("rejects a used and superseded generation without creating a session", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()
    await autoRequestVerification(database, requestInput())
    const firstIntent = database.latestIntent()!
    const firstCapability = capabilityFor(firstIntent)
    await resendVerification(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )

    await expect(
      confirmVerification(database, {
        capability: firstCapability,
        now: new Date(BASE.getTime() + 2_000),
      })
    ).rejects.toMatchObject({
      code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
    })

    const currentCapability = capabilityFor(database.latestIntent()!)
    await confirmVerification(database, {
      capability: currentCapability,
      now: new Date(BASE.getTime() + 3_000),
    })
    await expect(
      confirmVerification(database, {
        capability: currentCapability,
        now: new Date(BASE.getTime() + 4_000),
      })
    ).rejects.toMatchObject({
      code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
    })
    expect(database.state.sessionLineages).toHaveLength(0)
  })

  it("keeps already-verified identities uniform and does not create intent/outbox", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential(BASE)

    const auto = await autoRequestVerification(database, requestInput())
    const resend = await resendVerification(
      database,
      requestInput({ now: new Date(BASE.getTime() + 1_000) })
    )

    expect(auto).toMatchObject({
      accepted: true,
      created: false,
      state: "verified",
    })
    expect(resend).toMatchObject({
      accepted: true,
      created: false,
      state: "verified",
    })
    expect(database.state.intents).toHaveLength(0)
    expect(database.state.outbox).toHaveLength(0)
  })

  it("keeps verification independent from a later reset mutation", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()
    await autoRequestVerification(database, requestInput())
    const intent = database.latestIntent()!
    const capability = capabilityFor(intent)
    database.markResetMutation()

    const statusBefore = await getVerificationStatus(
      database,
      AUTH_IDENTITY_ID
    )
    const confirmed = await confirmVerification(database, {
      capability,
      now: new Date(BASE.getTime() + 1_000),
    })
    const statusAfter = await getVerificationStatus(
      database,
      AUTH_IDENTITY_ID
    )

    expect(database.state.resetMutations).toBe(1)
    expect(statusBefore).toEqual({ state: "pending" })
    expect(confirmed.success).toBe(true)
    expect(statusAfter).toEqual({ state: "verified" })
  })

  it("accepts a capability created under a previous key after rotation without session side effects", async () => {
    const database = new MemoryVerificationDatabase()
    database.seedCredential()
    await autoRequestVerification(
      database,
      requestInput({
          keyring: {
            active: KEYRING.active,
            previous: [],
          },
      })
    )
    const intent = database.latestIntent()!
    const capability = capabilityFor(intent, ROTATED_KEYRING)
    expect(hashCustomerAuthCapability(capability)).toBe(intent.token_hash)

    const confirmed = await confirmVerification(database, {
      capability,
      now: new Date(BASE.getTime() + 1_000),
    })

    expect(confirmed.success).toBe(true)
    expect(database.state.sessionLineages).toHaveLength(0)
  })

  it("does not expose verification capabilities or native verification primitives in the domain source", () => {
    const source = readFileSync(resolve(__dirname, "../verification.ts"), "utf8")

    expect(source).not.toMatch(/auth_session_lineage|auth_refresh_credential/)
    expect(source).not.toMatch(/event_bus|eventBusService|emit\(/)
    expect(source).not.toMatch(/provider_metadata|verification\.code/)
    expect(source).not.toMatch(/console\.(log|warn|error)/)
  })
})
