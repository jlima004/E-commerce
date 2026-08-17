import { Pool } from "pg"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  AUTH_CANARIES,
  assertAuthSinksHaveNoCanaries,
  assertSafeAuthSink,
  createAuthLeakageCollector,
} from "../helpers/auth-leakage"
import { AUTH_SURFACE_MANIFEST } from "../../src/api/auth-surface/manifest"
import { isCustomerAuthRecoveryFailClosed } from "../../src/infrastructure/customer-auth-transaction-compatibility"
import {
  AUTH_RESET_TTL_MS,
  confirmPasswordReset,
  createPostgresAuthResetDatabase,
  hashResetOperationId,
  requestPasswordReset,
  type AuthResetDatabase,
  type AuthResetIntentRecord,
  type AuthResetPasswordProvider,
} from "../../src/modules/customer-auth/reset"
import {
  deriveCustomerAuthCapability,
  hashCustomerAuthCapability,
  type CapabilityKeyring,
} from "../../src/modules/customer-auth/security/capabilities"
import { runAuthResetReconcile } from "../../src/jobs/auth-reset-reconcile"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const BASE = new Date("2026-08-17T03:00:00.000Z")
const AUTH_IDENTITY_ID = "identity_reset_pg_1"
const CUSTOMER_ID = "customer_reset_pg_1"
const RECIPIENT_IDENTITY_ID = "recipient_reset_pg_1"
const NORMALIZED_EMAIL = "customer@example.invalid"
const NEW_PASSWORD = AUTH_CANARIES.password
const IDEMPOTENCY_KEY = "reset-op-pg-1"

const KEYRING: CapabilityKeyring = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [{ version: 2, secret: "p".repeat(64) }],
}

const schemaSql = `
create table if not exists auth_credential_state (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version integer not null default 1,
  email_verified_at timestamptz,
  operation_type text,
  operation_id text,
  operation_status text not null default 'stable',
  operation_version integer not null default 0,
  version integer not null default 1,
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  current_password_verified_at timestamptz,
  provider_proved_at timestamptz,
  credential_updated_at timestamptz,
  revocation_committed_at timestamptz,
  completed_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists auth_reset_test_credential_identity
  on auth_credential_state (auth_identity_id) where deleted_at is null;

create table if not exists auth_reset_intent (
  id text primary key,
  auth_identity_id text not null,
  token_hash text not null,
  nonce text not null,
  key_version integer not null,
  generation integer not null default 0,
  status text not null default 'pending',
  version integer not null default 1,
  operation_id text,
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  provider_proved_at timestamptz,
  credential_updated_at timestamptz,
  revocation_committed_at timestamptz,
  completed_at timestamptz,
  superseded_at timestamptz,
  expired_at timestamptz,
  failed_reconcilable_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_reset_test_exact_ttl
    check (expires_at = created_at + interval '15 minutes')
);

create unique index if not exists auth_reset_test_token_hash
  on auth_reset_intent (token_hash) where deleted_at is null;

create unique index if not exists auth_reset_test_identity_generation
  on auth_reset_intent (auth_identity_id, generation)
  where deleted_at is null;

create unique index if not exists auth_reset_test_operation_id
  on auth_reset_intent (operation_id)
  where operation_id is not null and deleted_at is null;

create unique index if not exists auth_reset_test_active_identity
  on auth_reset_intent (auth_identity_id)
  where status in ('pending', 'claimed', 'credential_updated') and deleted_at is null;

create table if not exists auth_notification_outbox (
  id text primary key,
  template text not null,
  intent_type text not null,
  intent_id text not null,
  generation integer not null default 0,
  idempotency_key text not null,
  status text not null default 'recorded',
  recipient_identity_id text not null,
  recipient_hash text not null,
  recipient_domain text not null,
  key_version integer not null,
  version integer not null default 1,
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  failure_reason text,
  provider_message_id text,
  recorded_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  dead_lettered_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists auth_reset_test_outbox_key
  on auth_notification_outbox (idempotency_key) where deleted_at is null;

create table if not exists auth_session_lineage (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  status text not null default 'active',
  version integer not null default 1,
  revoked_at timestamptz,
  revocation_reason text,
  expired_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists auth_refresh_credential (
  id text primary key,
  lineage_id text not null,
  status text not null default 'active',
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists order_side_effect_canary (
  id text primary key
);

create table if not exists stripe_side_effect_canary (
  id text primary key
);
`

class RecordingProvider implements AuthResetPasswordProvider {
  passwordByIdentity = new Map<string, string>()
  updateCalls = 0
  verifyCalls = 0
  nextUpdate: "updated" | "timeout" | "ambiguous" = "updated"

  async updatePassword(input: {
    authIdentityId: string
    password: string
  }): Promise<"updated" | "timeout" | "ambiguous"> {
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
    this.verifyCalls += 1
    return this.passwordByIdentity.get(input.authIdentityId) === input.password
  }
}

let idSequence = 0
let nonceSequence = 0

function idFactory(prefix: string): string {
  idSequence += 1
  return `${prefix}_pg_${idSequence}`
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

function capabilityFor(
  intent: Pick<AuthResetIntentRecord, "id" | "generation" | "nonce" | "key_version">,
  keyring: CapabilityKeyring = KEYRING
): string {
  return deriveCustomerAuthCapability({
    keyring,
    purpose: "reset",
    intentId: intent.id,
    generation: intent.generation,
    nonce: intent.nonce,
    keyVersion: intent.key_version,
  }).capability
}

async function readLatestIntent(pool: Pool): Promise<AuthResetIntentRecord> {
  const result = await pool.query(
    `select *
       from auth_reset_intent
      where auth_identity_id = $1
      order by generation desc`,
    [AUTH_IDENTITY_ID]
  )
  expect(result.rows[0]).toBeDefined()
  return result.rows[0] as AuthResetIntentRecord
}

async function seedLineages(pool: Pool): Promise<void> {
  await pool.query(
    `insert into auth_session_lineage (id, auth_identity_id, customer_id, status)
     values ('lineage_pg_1', $1, $2, 'active'),
            ('lineage_pg_2', $1, $2, 'active')`,
    [AUTH_IDENTITY_ID, CUSTOMER_ID]
  )
  await pool.query(
    `insert into auth_refresh_credential (id, lineage_id, status)
     values ('refresh_pg_1', 'lineage_pg_1', 'active'),
            ('refresh_pg_2', 'lineage_pg_2', 'active')`
  )
}

if (!databaseUrl || !databaseName) {
  describe("customer auth reset PostgreSQL integration", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(120_000)

  let harness: AuthPostgresHarness
  let pool: Pool
  let database: AuthResetDatabase

  describe("customer auth reset PostgreSQL integration (P14-D13..15)", () => {
    beforeAll(async () => {
      harness = await createAuthPostgresHarness()
      const binding = getAuthPostgresTestBinding(harness)
      pool = new Pool({ connectionString: binding.databaseUrl })
      database = createPostgresAuthResetDatabase(pool)
      await pool.query(schemaSql)
    })

    beforeEach(async () => {
      idSequence = 0
      nonceSequence = 0
      await pool.query(`
        delete from auth_notification_outbox;
        delete from auth_reset_intent;
        delete from auth_refresh_credential;
        delete from auth_session_lineage;
        delete from auth_credential_state;
        delete from order_side_effect_canary;
        delete from stripe_side_effect_canary;
      `)
      await pool.query(
        `insert into auth_credential_state
          (id, auth_identity_id, customer_id, credential_version, version)
         values ('credential_pg_1', $1, $2, 1, 1)`,
        [AUTH_IDENTITY_ID, CUSTOMER_ID]
      )
    })

    afterAll(async () => {
      try {
        await pool?.query(`
          drop table if exists auth_notification_outbox;
          drop table if exists auth_reset_intent;
          drop table if exists auth_refresh_credential;
          drop table if exists auth_session_lineage;
          drop table if exists auth_credential_state;
          drop table if exists order_side_effect_canary;
          drop table if exists stripe_side_effect_canary;
        `)
      } finally {
        await pool?.end()
        await harness?.cleanup()
      }
    })

    it("applies latest-wins with one pending generation and a 15-minute TTL", async () => {
      await requestPasswordReset(database, requestInput())
      const first = await readLatestIntent(pool)
      await requestPasswordReset(
        database,
        requestInput({ now: new Date(BASE.getTime() + 1_000) })
      )
      const current = await readLatestIntent(pool)
      const rows = await pool.query(
        "select status, generation from auth_reset_intent order by generation"
      )

      expect(current.generation).toBe(first.generation + 1)
      expect(
        new Date(current.expires_at).getTime() -
          new Date(current.created_at).getTime()
      ).toBe(AUTH_RESET_TTL_MS)
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ generation: first.generation, status: "superseded" }),
          expect.objectContaining({ generation: current.generation, status: "pending" }),
        ])
      )
    })

    it("completes composed reset after proof, consume and global revoke without verifying email or creating a session", async () => {
      await seedLineages(pool)
      await requestPasswordReset(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      const provider = new RecordingProvider()
      const result = await confirmPasswordReset(database, {
        capability,
        newPassword: NEW_PASSWORD,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        provider,
        now: new Date(BASE.getTime() + 1_000),
      })
      const completed = await readLatestIntent(pool)
      const credential = await pool.query(
        "select * from auth_credential_state where auth_identity_id = $1",
        [AUTH_IDENTITY_ID]
      )
      const lineages = await pool.query("select status, revocation_reason from auth_session_lineage")
      const refresh = await pool.query("select status from auth_refresh_credential")
      const orders = await pool.query("select count(*)::int as n from order_side_effect_canary")
      const stripe = await pool.query("select count(*)::int as n from stripe_side_effect_canary")

      expect(result.outcome).toBe("completed")
      expect(completed.status).toBe("completed")
      expect(completed.operation_id).toBe(
        hashResetOperationId({ keyring: KEYRING, idempotencyKey: IDEMPOTENCY_KEY })
      )
      expect(credential.rows[0]).toMatchObject({
        operation_status: "stable",
        credential_version: 2,
        email_verified_at: null,
      })
      expect(lineages.rows.every((row) => row.status === "revoked")).toBe(true)
      expect(
        lineages.rows.every((row) => row.revocation_reason === "password_reset")
      ).toBe(true)
      expect(refresh.rows.every((row) => row.status === "revoked")).toBe(true)
      expect(orders.rows[0].n).toBe(0)
      expect(stripe.rows[0].n).toBe(0)
      expect(JSON.stringify(completed)).not.toContain(NEW_PASSWORD)
      expect(JSON.stringify(completed)).not.toContain(capability)
      expect(completed.token_hash).toBe(hashCustomerAuthCapability(capability))
    })

    it("keeps recovery fail-closed after provider timeout and secretless reconciler cannot complete", async () => {
      await seedLineages(pool)
      await requestPasswordReset(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      const provider = new RecordingProvider()
      provider.nextUpdate = "timeout"
      const pending = await confirmPasswordReset(database, {
        capability,
        newPassword: NEW_PASSWORD,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        provider,
        now: new Date(BASE.getTime() + 1_000),
      })
      const failed = await readLatestIntent(pool)
      const credential = await pool.query(
        "select operation_status, credential_updated_at, credential_version from auth_credential_state where auth_identity_id = $1",
        [AUTH_IDENTITY_ID]
      )

      expect(pending.outcome).toBe("recovery_pending")
      expect(failed.status).toBe("failed_reconcilable")
      expect(credential.rows[0].operation_status).toBe("provider_outcome_ambiguous")
      expect(credential.rows[0].credential_updated_at).toBeNull()
      expect(credential.rows[0].credential_version).toBe(1)
      expect(
        isCustomerAuthRecoveryFailClosed(
          credential.rows[0].operation_status
        )
      ).toBe(true)

      const job = await runAuthResetReconcile({
        database,
        isWorker: () => true,
        isReleaseMigration: () => false,
        now: () => new Date(BASE.getTime() + 3 * 60 * 1000),
        leaseOwner: "authlease_pg_secretless",
      })
      const afterJob = await readLatestIntent(pool)
      expect(job.processed).toBeGreaterThan(0)
      expect(afterJob.status).not.toBe("completed")
      expect(afterJob.completed_at).toBeNull()

      await expect(
        confirmPasswordReset(database, {
          capability,
          newPassword: NEW_PASSWORD,
          idempotencyKey: "different-key",
          keyring: KEYRING,
          provider,
          now: new Date(BASE.getTime() + 2_000),
        })
      ).rejects.toMatchObject({ code: "AUTH_RESET_INVALID_OR_EXPIRED" })

      const completed = await confirmPasswordReset(database, {
        capability,
        newPassword: NEW_PASSWORD,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        provider,
        now: new Date(BASE.getTime() + 2_000),
      })
      expect(completed.outcome).toBe("completed")
    })

    it("lets one concurrent claim win under row locks", async () => {
      await requestPasswordReset(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      const results = await Promise.allSettled([
        confirmPasswordReset(database, {
          capability,
          newPassword: NEW_PASSWORD,
          idempotencyKey: IDEMPOTENCY_KEY,
          keyring: KEYRING,
          provider: new RecordingProvider(),
          now: new Date(BASE.getTime() + 1_000),
        }),
        confirmPasswordReset(database, {
          capability,
          newPassword: NEW_PASSWORD,
          idempotencyKey: "other-op",
          keyring: KEYRING,
          provider: new RecordingProvider(),
          now: new Date(BASE.getTime() + 1_000),
        }),
      ])
      const fulfilled = results.filter((entry) => entry.status === "fulfilled")
      const rejected = results.filter((entry) => entry.status === "rejected")
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
    })

    it("keeps password and capability out of persisted sinks and leaves native reset DENY", async () => {
      await requestPasswordReset(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      await confirmPasswordReset(database, {
        capability,
        newPassword: NEW_PASSWORD,
        idempotencyKey: IDEMPOTENCY_KEY,
        keyring: KEYRING,
        provider: new RecordingProvider(),
        now: new Date(BASE.getTime() + 1_000),
      })
      const persisted = await pool.query(
        `select token_hash, nonce, key_version, operation_id from auth_reset_intent where id = $1`,
        [intent.id]
      )
      const leakage = createAuthLeakageCollector()
      const safeMaterial = {
        hash: persisted.rows[0].token_hash,
        nonce: persisted.rows[0].nonce,
        key_version: persisted.rows[0].key_version,
      }
      assertSafeAuthSink(safeMaterial)
      expect(JSON.stringify(persisted.rows[0])).not.toContain(NEW_PASSWORD)
      expect(JSON.stringify(persisted.rows[0])).not.toContain(capability)
      expect(JSON.stringify(persisted.rows[0])).not.toContain(IDEMPOTENCY_KEY)
      leakage.record("db_plaintext", persisted.rows[0])
      leakage.record("logs", { intent_id: intent.id, generation: intent.generation })
      leakage.assertNoCanaries()
      assertAuthSinksHaveNoCanaries(leakage.snapshots())

      const resetEntries = AUTH_SURFACE_MANIFEST.filter(
        (entry) =>
          entry.pathTemplate === "/auth/customer/emailpass/reset-password" ||
          entry.pathTemplate === "/auth/customer/emailpass/update"
      )
      expect(
        resetEntries.every((entry) => entry.runtimePolicy === "DENY")
      ).toBe(true)
    })
  })
}
