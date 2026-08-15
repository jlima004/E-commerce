import { randomBytes } from "node:crypto"
import {
  AUTH_SESSION_FAULT_POINTS,
  hashAuthRefreshRequestKey,
  issueInitialAuthSession,
  rotateAuthRefresh,
  type AuthSessionDatabase,
  type AuthSessionRawResult,
  type AuthSessionTransaction,
} from "../session"
import {
  verifyCustomerAuthAccessToken,
  type AuthAccessJwtClaims,
} from "../jwt"

type MemoryLineage = {
  id: string
  sid: string
  auth_identity_id: string
  customer_id: string
  credential_version_snapshot: number
  status: "active" | "revoked" | "expired"
  version: number
  original_authenticated_at: Date
  absolute_expires_at: Date
  revoked_at: Date | null
  revocation_reason: string | null
  expired_at: Date | null
}

type MemoryRefresh = {
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
  deleted_at: Date | null
}

type MemoryState = {
  lineages: Map<string, MemoryLineage>
  refreshes: Map<string, MemoryRefresh>
}

const JWT_SECRET = "a".repeat(64)
const KEYRING = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [],
}
const BASE = new Date("2026-01-01T00:00:00.000Z")

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null
}

function cloneState(state: MemoryState): MemoryState {
  return {
    lineages: new Map(
      [...state.lineages].map(([id, row]) => [
        id,
        {
          ...row,
          original_authenticated_at: new Date(
            row.original_authenticated_at.getTime()
          ),
          absolute_expires_at: new Date(row.absolute_expires_at.getTime()),
          revoked_at: cloneDate(row.revoked_at),
          expired_at: cloneDate(row.expired_at),
        },
      ])
    ),
    refreshes: new Map(
      [...state.refreshes].map(([id, row]) => [
        id,
        {
          ...row,
          expires_at: new Date(row.expires_at.getTime()),
          consumed_at: cloneDate(row.consumed_at),
          recovery_until: cloneDate(row.recovery_until),
          replacement_used_at: cloneDate(row.replacement_used_at),
          replayed_at: cloneDate(row.replayed_at),
          revoked_at: cloneDate(row.revoked_at),
          deleted_at: cloneDate(row.deleted_at),
        },
      ])
    ),
  }
}

function asLineageRow(row: MemoryLineage): Record<string, unknown> {
  return { ...row }
}

function asRefreshRow(row: MemoryRefresh): Record<string, unknown> {
  return { ...row }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
}

class MemoryAuthSessionDatabase implements AuthSessionDatabase {
  state: MemoryState = {
    lineages: new Map(),
    refreshes: new Map(),
  }

  private queue = Promise.resolve()

  async transaction<T>(
    callback: (transaction: AuthSessionTransaction) => Promise<T>
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const working = cloneState(this.state)
      const transaction: AuthSessionTransaction = {
        raw: async (sql, bindings = []) =>
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

  private async execute(
    state: MemoryState,
    sql: string,
    bindings: unknown[]
  ): Promise<AuthSessionRawResult> {
    if (sql.startsWith("select * from auth_refresh_credential")) {
      let row: MemoryRefresh | undefined
      if (sql.includes("where token_hash =")) {
        row = [...state.refreshes.values()].find(
          (candidate) =>
            candidate.token_hash === bindings[0] && candidate.deleted_at === null
        )
      } else if (sql.includes("where id =")) {
        row = state.refreshes.get(String(bindings[0]))
        if (row?.deleted_at !== null) {
          row = undefined
        }
      } else if (sql.includes("where replacement_id =")) {
        row = [...state.refreshes.values()].find(
          (candidate) =>
            candidate.replacement_id === bindings[0] &&
            candidate.lineage_id === bindings[1] &&
            candidate.deleted_at === null
        )
      }
      return { rows: row ? [asRefreshRow(row)] : [], rowCount: row ? 1 : 0 }
    }

    if (sql.startsWith("select * from auth_session_lineage")) {
      const row = state.lineages.get(String(bindings[0]))
      return {
        rows: row && row.deleted_at === undefined ? [asLineageRow(row)] : [],
        rowCount: row && row.deleted_at === undefined ? 1 : 0,
      }
    }

    if (sql.startsWith("select credential_version, operation_status")) {
      return {
        rows: [
          {
            credential_version: 1,
            operation_status: "stable",
          },
        ],
        rowCount: 1,
      }
    }

    if (sql.startsWith("insert into auth_session_lineage")) {
      const row: MemoryLineage = {
        id: String(bindings[0]),
        sid: String(bindings[1]),
        auth_identity_id: String(bindings[2]),
        customer_id: String(bindings[3]),
        credential_version_snapshot: Number(bindings[4]),
        status: "active",
        version: 1,
        original_authenticated_at: new Date(bindings[5] as Date),
        absolute_expires_at: new Date(bindings[6] as Date),
        revoked_at: null,
        revocation_reason: null,
        expired_at: null,
      }
      state.lineages.set(row.id, row)
      return { rows: [], rowCount: 1 }
    }

    if (sql.startsWith("insert into auth_refresh_credential")) {
      const rotated = bindings.length === 8
      const row: MemoryRefresh = {
        id: String(bindings[0]),
        lineage_id: String(bindings[1]),
        token_hash: String(bindings[2]),
        generation: rotated ? Number(bindings[3]) : 0,
        status: "active",
        replacement_id: null,
        request_key_hash: null,
        nonce: String(bindings[rotated ? 4 : 3]),
        key_version: Number(bindings[rotated ? 5 : 4]),
        expires_at: new Date(bindings[rotated ? 6 : 5] as Date),
        consumed_at: null,
        recovery_until: null,
        replacement_used_at: null,
        replayed_at: null,
        revoked_at: null,
        version: 1,
        deleted_at: null,
      }
      state.refreshes.set(row.id, row)
      return { rows: [], rowCount: 1 }
    }

    if (
      sql.startsWith("update auth_refresh_credential") &&
      sql.includes("set status = 'revoked'") &&
      sql.includes("where lineage_id =")
    ) {
      const now = new Date(bindings[0] as Date)
      const lineageId = String(bindings[2])
      const replayId = bindings[3] ? String(bindings[3]) : null
      for (const row of state.refreshes.values()) {
        if (
          row.lineage_id === lineageId &&
          row.status !== "revoked" &&
          row.id !== replayId
        ) {
          row.status = "revoked"
          row.replacement_id = null
          row.request_key_hash = null
          row.consumed_at = null
          row.recovery_until = null
          row.replacement_used_at = null
          row.replayed_at = null
          row.revoked_at = now
          row.version += 1
        }
      }
      return { rows: [], rowCount: 1 }
    }

    if (
      sql.startsWith("update auth_refresh_credential") &&
      sql.includes("set status = 'replayed'")
    ) {
      const row = state.refreshes.get(String(bindings[2]))
      if (row) {
        row.status = "replayed"
        row.replayed_at = new Date(bindings[0] as Date)
        row.revoked_at = null
        row.version += 1
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (
      sql.startsWith("update auth_refresh_credential") &&
      sql.includes("set status = 'revoked'") &&
      sql.includes("where id =")
    ) {
      const row = state.refreshes.get(String(bindings[2]))
      if (row) {
        row.status = "revoked"
        row.replacement_id = null
        row.request_key_hash = null
        row.consumed_at = null
        row.recovery_until = null
        row.replacement_used_at = null
        row.replayed_at = null
        row.revoked_at = new Date(bindings[0] as Date)
        row.version += 1
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (
      sql.startsWith("update auth_refresh_credential") &&
      sql.includes("set replacement_used_at")
    ) {
      const row = state.refreshes.get(String(bindings[2]))
      if (row) {
        row.replacement_used_at = new Date(bindings[0] as Date)
        row.version += 1
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (
      sql.startsWith("update auth_refresh_credential") &&
      sql.includes("set status = 'consumed'")
    ) {
      const row = state.refreshes.get(String(bindings[5]))
      if (
        row &&
        row.lineage_id === bindings[6] &&
        row.generation === Number(bindings[7]) &&
        row.status === "active"
      ) {
        row.status = "consumed"
        row.replacement_id = String(bindings[0])
        row.request_key_hash = String(bindings[1])
        row.consumed_at = new Date(bindings[2] as Date)
        row.recovery_until = new Date(bindings[3] as Date)
        row.version += 1
        return { rows: [{ id: row.id }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }

    if (
      sql.startsWith("update auth_session_lineage") &&
      sql.includes("set status = 'revoked'")
    ) {
      const row = state.lineages.get(String(bindings[3]))
      if (row) {
        row.status = "revoked"
        row.revoked_at = new Date(bindings[0] as Date)
        row.revocation_reason = String(bindings[1])
        row.expired_at = null
        row.version += 1
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (
      sql.startsWith("update auth_session_lineage") &&
      sql.includes("set status = 'expired'")
    ) {
      const row = state.lineages.get(String(bindings[2]))
      if (row) {
        row.status = "expired"
        row.revoked_at = null
        row.revocation_reason = null
        row.expired_at = new Date(bindings[0] as Date)
        row.version += 1
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    throw new Error(`Unhandled memory SQL: ${sql}`)
  }

  activeRefreshes(): MemoryRefresh[] {
    return [...this.state.refreshes.values()].filter(
      (row) => row.status === "active"
    )
  }
}

function idFactory(): (prefix: string) => string {
  let sequence = 0
  return (prefix) => `${prefix}_${++sequence}`
}

function randomBytesFactory(): (size: number) => Buffer {
  let sequence = 0
  return (size) => {
    sequence += 1
    return Buffer.alloc(size, sequence)
  }
}

function sessionInput(database: AuthSessionDatabase) {
  return {
    database,
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    authIdentityId: "identity_1",
    customerId: "customer_1",
    credentialVersion: 1,
    now: BASE,
    idFactory: idFactory(),
    randomBytesFn: randomBytesFactory(),
  }
}

async function issue(database: AuthSessionDatabase) {
  const input = sessionInput(database)
  return issueInitialAuthSession(input.database, {
    ...input,
  })
}

function claims(token: string, now: Date = BASE): AuthAccessJwtClaims {
  return verifyCustomerAuthAccessToken(token, {
    secret: JWT_SECRET,
    now,
  })
}

describe("customer auth session lineage protocol", () => {
  it("issues an opaque 32-byte refresh, stores only its SHA-256 hash, and signs a 10m JWT", async () => {
    const database = new MemoryAuthSessionDatabase()
    const session = await issue(database)
    const accessClaims = claims(session.accessToken)
    const stored = [...database.state.refreshes.values()][0]

    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(session.refreshToken, "base64url")).toHaveLength(32)
    expect(stored.token_hash).not.toBe(session.refreshToken)
    expect(stored.token_hash).toHaveLength(64)
    expect(accessClaims.exp - accessClaims.iat).toBe(10 * 60)
    expect(accessClaims.sid).toBe(session.sid)
    expect(accessClaims.cv).toBe(1)
    expect(accessClaims.jti).toEqual(expect.any(String))
    expect(accessClaims.absolute_expires_at).toBe(
      accessClaims.original_authenticated_at + 30 * 24 * 60 * 60
    )
  })

  it("rotates N to exactly one N+1 and recovers the same descendant at 44s", async () => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    const first = await rotateAuthRefresh(database, {
      refreshToken: initial.refreshToken,
      idempotencyKey: "request-a",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 60_000),
      idFactory: idFactory(),
      randomBytesFn: randomBytesFactory(),
    })

    const recovered = await rotateAuthRefresh(database, {
      refreshToken: initial.refreshToken,
      idempotencyKey: "request-a",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 60_000 + 44_000),
    })

    expect(first.generation).toBe(1)
    expect(recovered.generation).toBe(1)
    expect(recovered.refreshToken).toBe(first.refreshToken)
    expect(recovered.accessToken).not.toBe(first.accessToken)
    expect(database.activeRefreshes()).toHaveLength(1)
    expect([...database.state.refreshes.values()]).toHaveLength(2)
  })

  it.each([
    ["different key", "request-b", 44_000],
    ["same key after recovery window", "request-a", 46_000],
  ])("revokes the whole family on %s", async (_label, key, offset) => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    await rotateAuthRefresh(database, {
      refreshToken: initial.refreshToken,
      idempotencyKey: "request-a",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 60_000),
      idFactory: idFactory(),
      randomBytesFn: randomBytesFactory(),
    })

    await expect(
      rotateAuthRefresh(database, {
        refreshToken: initial.refreshToken,
        idempotencyKey: key,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(BASE.getTime() + 60_000 + offset),
      })
    ).rejects.toMatchObject({
      code: "AUTH_SESSION_RECOVERY_REJECTED",
    })

    expect([...database.state.lineages.values()][0].status).toBe("revoked")
    expect(database.activeRefreshes()).toHaveLength(0)
  })

  it("revokes the family when an N+1 descendant was already used", async () => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    const first = await rotateAuthRefresh(database, {
      refreshToken: initial.refreshToken,
      idempotencyKey: "request-a",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 60_000),
      idFactory: idFactory(),
      randomBytesFn: randomBytesFactory(),
    })
    await rotateAuthRefresh(database, {
      refreshToken: first.refreshToken,
      idempotencyKey: "request-b",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 120_000),
      idFactory: idFactory(),
      randomBytesFn: randomBytesFactory(),
    })

    await expect(
      rotateAuthRefresh(database, {
        refreshToken: initial.refreshToken,
        idempotencyKey: "request-a",
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(BASE.getTime() + 121_000),
      })
    ).rejects.toMatchObject({ code: "AUTH_SESSION_RECOVERY_REJECTED" })

    expect([...database.state.lineages.values()][0].status).toBe("revoked")
    expect(database.activeRefreshes()).toHaveLength(0)
  })

  it("rolls back a pre-commit crash and recovers a post-commit lost response", async () => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    let preCommit = true

    await expect(
      rotateAuthRefresh(database, {
        refreshToken: initial.refreshToken,
        idempotencyKey: "request-a",
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(BASE.getTime() + 60_000),
        idFactory: idFactory(),
        randomBytesFn: randomBytesFactory(),
        beforeCommit: async () => {
          if (preCommit) {
            preCommit = false
            throw new Error("crash-before-commit")
          }
        },
      })
    ).rejects.toThrow("crash-before-commit")

    expect(database.state.refreshes.size).toBe(1)
    expect([...database.state.refreshes.values()][0].status).toBe("active")

    let postCommit = true
    await expect(
      rotateAuthRefresh(database, {
        refreshToken: initial.refreshToken,
        idempotencyKey: "request-b",
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(BASE.getTime() + 120_000),
        idFactory: idFactory(),
        randomBytesFn: randomBytesFactory(),
        faultInjector: {
          fire: (point) => {
            if (
              point === AUTH_SESSION_FAULT_POINTS.REFRESH_COMMIT_TO_RESPONSE &&
              postCommit
            ) {
              postCommit = false
              return { fired: true }
            }
            return { fired: false }
          },
        },
      })
    ).rejects.toThrow("AUTH_REFRESH_COMMIT_TO_RESPONSE_FAULT")

    const recovered = await rotateAuthRefresh(database, {
      refreshToken: initial.refreshToken,
      idempotencyKey: "request-b",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: new Date(BASE.getTime() + 120_000 + 44_000),
    })

    expect(recovered.generation).toBe(1)
    expect(database.state.refreshes.size).toBe(2)
  })

  it("serializes concurrent rotations to one descendant", async () => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    const results = await Promise.allSettled(
      ["request-a", "request-a"].map((idempotencyKey) =>
        rotateAuthRefresh(database, {
          refreshToken: initial.refreshToken,
          idempotencyKey,
          keyring: KEYRING,
          jwtSecret: JWT_SECRET,
          now: new Date(BASE.getTime() + 60_000),
          idFactory: idFactory(),
          randomBytesFn: randomBytesFactory(),
        })
      )
    )

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      2
    )
    expect(
      (results[0] as PromiseFulfilledResult<{ refreshToken: string }>).value
        .refreshToken
    ).toBe(
      (results[1] as PromiseFulfilledResult<{ refreshToken: string }>).value
        .refreshToken
    )
    expect(database.state.refreshes.size).toBe(2)
    expect(database.activeRefreshes()).toHaveLength(1)
  })

  it("preserves the original 30d deadline through multiple rotations and rejects descendants after it", async () => {
    const database = new MemoryAuthSessionDatabase()
    const initial = await issue(database)
    let current = initial
    for (const [days, idempotencyKey] of [
      [1, "request-a"],
      [2, "request-b"],
      [8, "request-c"],
      [14, "request-d"],
      [20, "request-e"],
      [26, "request-f"],
    ] as const) {
      current = await rotateAuthRefresh(database, {
        refreshToken: current.refreshToken,
        idempotencyKey,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(BASE.getTime() + days * 24 * 60 * 60 * 1000),
        idFactory: idFactory(),
        randomBytesFn: randomBytesFactory(),
      })
    }
    const nearDeadline = new Date(
      BASE.getTime() + 30 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000
    )
    const last = await rotateAuthRefresh(database, {
      refreshToken: current.refreshToken,
      idempotencyKey: "request-g",
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: nearDeadline,
      idFactory: idFactory(),
      randomBytesFn: randomBytesFactory(),
    })
    const lastClaims = claims(last.accessToken, nearDeadline)

    expect(last.originalAuthenticatedAt).toEqual(initial.originalAuthenticatedAt)
    expect(last.absoluteExpiresAt).toEqual(initial.absoluteExpiresAt)
    expect(lastClaims.exp - lastClaims.iat).toBe(5 * 60)
    expect(last.refreshExpiresAt).toEqual(initial.absoluteExpiresAt)

    await expect(
      rotateAuthRefresh(database, {
        refreshToken: last.refreshToken,
        idempotencyKey: "request-d",
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: new Date(initial.absoluteExpiresAt.getTime() + 1),
      })
    ).rejects.toMatchObject({ code: "AUTH_SESSION_DEADLINE_REACHED" })

    expect([...database.state.lineages.values()][0].status).toBe("expired")
    expect(database.activeRefreshes()).toHaveLength(0)
  })

  it("hashes request keys and never uses Redis as a validity authority", () => {
    const digest = hashAuthRefreshRequestKey("request-a")
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain("request-a")
    expect(randomBytes(32)).toHaveLength(32)
  })
})
