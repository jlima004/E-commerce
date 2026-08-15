import { randomBytes } from "node:crypto"
import { Pool } from "pg"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  AUTH_SESSION_FAULT_POINTS,
  createPostgresAuthSessionDatabase,
  issueInitialAuthSession,
  rotateAuthRefresh,
} from "../../src/modules/customer-auth/session"
import { verifyCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const JWT_SECRET = "a".repeat(64)
const KEYRING = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [],
}
const BASE = new Date("2026-01-01T00:00:00.000Z")

const schemaSql = `
create table if not exists auth_credential_state (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version integer not null default 1,
  operation_status text not null default 'stable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists "UQ_auth_session_test_credential_identity"
  on auth_credential_state(auth_identity_id) where deleted_at is null;

create table if not exists auth_session_lineage (
  id text primary key,
  sid text not null,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version_snapshot integer not null,
  status text not null default 'active',
  version integer not null default 1,
  original_authenticated_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  expired_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_session_test_absolute_deadline
    check (absolute_expires_at = original_authenticated_at + interval '30 days')
);
create unique index if not exists "UQ_auth_session_test_sid"
  on auth_session_lineage(sid) where deleted_at is null;

create table if not exists auth_refresh_credential (
  id text primary key,
  lineage_id text not null,
  token_hash text not null,
  generation integer not null default 0,
  status text not null default 'active',
  replacement_id text,
  request_key_hash text,
  nonce text not null,
  key_version integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  recovery_until timestamptz,
  replacement_used_at timestamptz,
  replayed_at timestamptz,
  revoked_at timestamptz,
  schema_version integer not null default 1,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_session_test_generation check (
    generation >= 0 and key_version >= 1 and version >= 1
  ),
  constraint auth_session_test_consumed_recovery check (
    (
      status in ('consumed', 'replayed')
      and consumed_at is not null
      and replacement_id is not null
      and request_key_hash is not null
      and recovery_until = consumed_at + interval '45 seconds'
    ) or (
      status not in ('consumed', 'replayed')
      and consumed_at is null
      and replacement_id is null
      and request_key_hash is null
      and recovery_until is null
    )
  ),
  constraint auth_session_test_replayed_state check (
    (status = 'replayed' and replayed_at is not null)
    or (status <> 'replayed' and replayed_at is null)
  ),
  constraint auth_session_test_revoked_state check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  )
);
create unique index if not exists "UQ_auth_session_test_token_hash"
  on auth_refresh_credential(token_hash) where deleted_at is null;
create unique index if not exists "UQ_auth_session_test_generation"
  on auth_refresh_credential(lineage_id, generation) where deleted_at is null;
create unique index if not exists "UQ_auth_session_test_active_lineage"
  on auth_refresh_credential(lineage_id)
  where status = 'active' and deleted_at is null;
`

function testIdFactory() {
  let sequence = 0
  return (prefix: string) => `${prefix}_pg_${++sequence}`
}

function insertCredential(pool: Pool): Promise<unknown> {
  return pool.query(
    `insert into auth_credential_state
       (id, auth_identity_id, customer_id, credential_version, operation_status)
     values ('credential_1', 'identity_1', 'customer_1', 1, 'stable')`
  )
}

function at(milliseconds: number): Date {
  return new Date(BASE.getTime() + milliseconds)
}

async function rotate(
  database: ReturnType<typeof createPostgresAuthSessionDatabase>,
  refreshToken: string,
  idempotencyKey: string,
  now: Date,
  options: Record<string, unknown> = {}
) {
  return rotateAuthRefresh(database, {
    refreshToken,
    idempotencyKey,
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    now,
    ...options,
  })
}

if (!databaseUrl || !databaseName) {
  describe("customer auth PostgreSQL session protocol", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(120_000)
  let harness: AuthPostgresHarness
  let pool: Pool
  let database: ReturnType<typeof createPostgresAuthSessionDatabase>

  describe("customer auth PostgreSQL session protocol", () => {
    beforeAll(async () => {
      harness = await createAuthPostgresHarness()
      const binding = getAuthPostgresTestBinding(harness)
      pool = new Pool({ connectionString: binding.databaseUrl })
      database = createPostgresAuthSessionDatabase(pool)
      await pool.query(schemaSql)
    })

    beforeEach(async () => {
      await pool.query(
        "delete from auth_refresh_credential; delete from auth_session_lineage; delete from auth_credential_state"
      )
      await insertCredential(pool)
    })

    afterAll(async () => {
      try {
        await pool?.query(
          "drop table if exists auth_refresh_credential; drop table if exists auth_session_lineage; drop table if exists auth_credential_state"
        )
      } finally {
        await pool?.end()
        await harness?.cleanup()
      }
    })

    it("creates exactly one descendant under two concurrent PostgreSQL transactions", async () => {
      const initial = await issueInitialAuthSession(database, {
        authIdentityId: "identity_1",
        customerId: "customer_1",
        credentialVersion: 1,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: BASE,
        idFactory: testIdFactory(),
        randomBytesFn: randomBytes,
      })

      const results = await Promise.all(
        ["request-a", "request-a"].map((idempotencyKey) =>
          rotate(database, initial.refreshToken, idempotencyKey, at(60_000), {
            idFactory: testIdFactory(),
            randomBytesFn: randomBytes,
          })
        )
      )

      expect(results[0].refreshToken).toBe(results[1].refreshToken)
      const state = await pool.query(
        `select
           count(*)::int as total,
           count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'consumed')::int as consumed
         from auth_refresh_credential`
      )
      expect(state.rows[0]).toEqual({
        total: 2,
        active: 1,
        consumed: 1,
      })
    })

    it("recovers after a committed response fault without creating N+2", async () => {
      const initial = await issueInitialAuthSession(database, {
        authIdentityId: "identity_1",
        customerId: "customer_1",
        credentialVersion: 1,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: BASE,
        idFactory: testIdFactory(),
        randomBytesFn: randomBytes,
      })
      let faulted = false

      await expect(
        rotate(database, initial.refreshToken, "request-a", at(60_000), {
          idFactory: testIdFactory(),
          randomBytesFn: randomBytes,
          faultInjector: {
            fire: (point) => {
              if (
                point ===
                  AUTH_SESSION_FAULT_POINTS.REFRESH_COMMIT_TO_RESPONSE &&
                !faulted
              ) {
                faulted = true
                return { fired: true }
              }
              return { fired: false }
            },
          },
        })
      ).rejects.toThrow("AUTH_REFRESH_COMMIT_TO_RESPONSE_FAULT")

      const recovered = await rotate(
        database,
        initial.refreshToken,
        "request-a",
        at(60_000 + 44_000)
      )
      const counts = await pool.query(
        "select count(*)::int as total, max(generation)::int as generation from auth_refresh_credential"
      )

      expect(recovered.rotation).toBe("recovered")
      expect(counts.rows[0]).toEqual({ total: 2, generation: 1 })
    })

    it("rolls back a pre-commit fault, revokes divergent replay, and keeps secrets out of persistence", async () => {
      const initial = await issueInitialAuthSession(database, {
        authIdentityId: "identity_1",
        customerId: "customer_1",
        credentialVersion: 1,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: BASE,
        idFactory: testIdFactory(),
        randomBytesFn: randomBytes,
      })

      await expect(
        rotate(database, initial.refreshToken, "request-a", at(60_000), {
          idFactory: testIdFactory(),
          randomBytesFn: randomBytes,
          beforeCommit: () => {
            throw new Error("crash-before-commit")
          },
        })
      ).rejects.toThrow("crash-before-commit")

      let afterRollback = await pool.query(
        "select status from auth_refresh_credential"
      )
      expect(afterRollback.rows).toEqual([{ status: "active" }])

      await rotate(database, initial.refreshToken, "request-a", at(60_000), {
        idFactory: testIdFactory(),
        randomBytesFn: randomBytes,
      })

      await expect(
        rotate(database, initial.refreshToken, "different-key", at(60_000 + 44_000))
      ).rejects.toMatchObject({ code: "AUTH_SESSION_RECOVERY_REJECTED" })

      const family = await pool.query(
        "select status, token_hash, request_key_hash from auth_refresh_credential order by generation"
      )
      expect(family.rows.every((row) => row.status !== "active")).toBe(true)
      expect(family.rows.every((row) => !String(row.token_hash).includes("request"))).toBe(
        true
      )
      expect(
        family.rows.some((row) => row.request_key_hash === "different-key")
      ).toBe(false)
      afterRollback = await pool.query(
        "select status from auth_session_lineage where id = $1",
        ["authlin_pg_1"]
      )
      expect(afterRollback.rows[0]?.status).toBe("revoked")
    })

    it("uses PostgreSQL—not Redis—as authority and caps JWT/refresh at the absolute deadline", async () => {
      const initial = await issueInitialAuthSession(database, {
        authIdentityId: "identity_1",
        customerId: "customer_1",
        credentialVersion: 1,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        now: BASE,
        originalAuthenticatedAt: BASE,
        idFactory: testIdFactory(),
        randomBytesFn: randomBytes,
      })

      let current = initial
      for (const [days, key] of [
        [1, "day-1"],
        [2, "day-2"],
        [8, "day-8"],
        [14, "day-14"],
        [20, "day-20"],
        [26, "day-26"],
      ] as const) {
        current = await rotate(
          database,
          current.refreshToken,
          key,
          at(days * 24 * 60 * 60 * 1000)
        )
      }

      const nearDeadline = at(30 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000)
      const last = await rotate(
        database,
        current.refreshToken,
        "near-deadline",
        nearDeadline
      )
      const claims = verifyCustomerAuthAccessToken(last.accessToken, {
        secret: JWT_SECRET,
        now: nearDeadline,
      })

      expect(claims.exp - claims.iat).toBe(5 * 60)
      expect(last.absoluteExpiresAt).toEqual(initial.absoluteExpiresAt)
      expect(last.originalAuthenticatedAt).toEqual(
        initial.originalAuthenticatedAt
      )
      expect(last.refreshExpiresAt).toEqual(initial.absoluteExpiresAt)

      await expect(
        rotate(
          database,
          last.refreshToken,
          "after-deadline",
          new Date(initial.absoluteExpiresAt.getTime() + 1)
        )
      ).rejects.toMatchObject({ code: "AUTH_SESSION_DEADLINE_REACHED" })

      const terminal = await pool.query(
        "select l.status as lineage_status, count(*) filter (where r.status = 'active')::int as active_count from auth_session_lineage l join auth_refresh_credential r on r.lineage_id=l.id where l.id=$1 group by l.status",
        [initial.lineageId]
      )
      expect(terminal.rows[0]).toEqual({
        lineage_status: "expired",
        active_count: 0,
      })
    })
  })
}
