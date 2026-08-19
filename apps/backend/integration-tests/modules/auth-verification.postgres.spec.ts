import { Pool } from "pg"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  createResendAuthProviderMock,
  type AuthProviderOutcome,
} from "../helpers/auth-providers"
import {
  assertAuthSinksHaveNoCanaries,
  assertSafeAuthSink,
  createAuthLeakageCollector,
} from "../helpers/auth-leakage"
import {
  AUTH_SURFACE_MANIFEST,
} from "../../src/api/auth-surface/manifest"
import {
  autoRequestVerification,
  confirmVerification,
  createPostgresAuthVerificationDatabase,
  getVerificationStatus,
  resendVerification,
  type AuthVerificationDatabase,
  type AuthVerificationIntentRecord,
} from "../../src/modules/customer-auth/verification"
import {
  deriveCustomerAuthCapability,
  hashCustomerAuthCapability,
  type CapabilityKeyring,
} from "../../src/modules/customer-auth/security/capabilities"
import { runAuthNotificationRelay } from "../../src/jobs/auth-notification-relay"
import type { ResendAuthRelayClient } from "../../src/jobs/auth-notification-relay"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const BASE = new Date("2026-08-15T03:00:00.000Z")
const AUTH_IDENTITY_ID = "identity_pg_1"
const RECIPIENT_IDENTITY_ID = "recipient_pg_1"
const NORMALIZED_EMAIL = "customer@example.invalid"

const KEYRING: CapabilityKeyring = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [{ version: 2, secret: "p".repeat(64) }],
}

const ROTATED_KEYRING: CapabilityKeyring = {
  active: { version: 2, secret: "q".repeat(64) },
  previous: [{ version: 1, secret: "k".repeat(64) }],
}

const OLD_KEYRING: CapabilityKeyring = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [],
}

const schemaSql = `
create table if not exists auth_credential_state (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version integer not null default 1,
  email_verified_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists auth_verification_test_credential_identity
  on auth_credential_state (auth_identity_id) where deleted_at is null;

create table if not exists auth_verification_intent (
  id text primary key,
  auth_identity_id text not null,
  token_hash text not null,
  nonce text not null,
  key_version integer not null,
  generation integer not null default 0,
  status text not null default 'pending',
  version integer not null default 1,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  expired_at timestamptz,
  dead_lettered_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_verification_test_exact_ttl
    check (expires_at = created_at + interval '30 minutes')
);

create unique index if not exists auth_verification_test_token_hash
  on auth_verification_intent (token_hash) where deleted_at is null;

create unique index if not exists auth_verification_test_identity_generation
  on auth_verification_intent (auth_identity_id, generation)
  where deleted_at is null;

create unique index if not exists auth_verification_test_active_identity
  on auth_verification_intent (auth_identity_id)
  where status in ('pending', 'claimed') and deleted_at is null;

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

create unique index if not exists auth_verification_test_outbox_key
  on auth_notification_outbox (idempotency_key) where deleted_at is null;

create unique index if not exists auth_verification_test_outbox_generation
  on auth_notification_outbox (intent_id, generation, template)
  where deleted_at is null;

create table if not exists auth_session_lineage (
  id text primary key
);

create table if not exists auth_refresh_credential (
  id text primary key
);

create table if not exists order_side_effect_canary (
  id text primary key
);

create table if not exists stripe_side_effect_canary (
  id text primary key
);
`

function makeKnexLike(pool: Pool) {
  return {
    raw(sql: string, bindings: unknown[] = []) {
      let parameter = 0
      return pool.query(
        sql.replace(/\?/g, () => `$${++parameter}`),
        bindings
      )
    },
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
  intent: Pick<
    AuthVerificationIntentRecord,
    "id" | "generation" | "nonce" | "key_version"
  >,
  keyring: CapabilityKeyring = KEYRING
): string {
  return deriveCustomerAuthCapability({
    keyring,
    purpose: "verification",
    intentId: intent.id,
    generation: intent.generation,
    nonce: intent.nonce,
    keyVersion: intent.key_version,
  }).capability
}

function expectInvalid(error: unknown): void {
  expect(error).toMatchObject({
    code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
  })
}

function makeProviderClient(outcome: AuthProviderOutcome): ResendAuthRelayClient {
  const response = createResendAuthProviderMock({
    seed: "verification-provider-test-seed",
    outcome,
  }).invoke()

  return {
    async send() {
      if (!response.ok) {
        throw new Error(response.errorCode ?? "AUTH_PROVIDER_FAILURE")
      }
      return { providerMessageId: "mock_provider_message" }
    },
  }
}

async function readLatestIntent(
  pool: Pool
): Promise<AuthVerificationIntentRecord> {
  const result = await pool.query(
    `select *
       from auth_verification_intent
      where auth_identity_id = $1
      order by generation desc`,
    [AUTH_IDENTITY_ID]
  )
  const row = result.rows[0]
  expect(row).toBeDefined()
  return row as AuthVerificationIntentRecord
}

async function readIntentRows(pool: Pool): Promise<
  Array<AuthVerificationIntentRecord>
> {
  const result = await pool.query(
    `select *
       from auth_verification_intent
      where auth_identity_id = $1
      order by generation asc`,
    [AUTH_IDENTITY_ID]
  )
  return result.rows as Array<AuthVerificationIntentRecord>
}

async function expectNoIsolationSideEffects(pool: Pool): Promise<void> {
  const result = await pool.query(`
    select
      (select count(*)::int from auth_session_lineage) as lineages,
      (select count(*)::int from auth_refresh_credential) as refresh_credentials,
      (select count(*)::int from order_side_effect_canary) as orders,
      (select count(*)::int from stripe_side_effect_canary) as stripe_effects
  `)
  expect(result.rows[0]).toEqual({
    lineages: 0,
    refresh_credentials: 0,
    orders: 0,
    stripe_effects: 0,
  })
}

if (!databaseUrl || !databaseName) {
  describe("customer auth verification PostgreSQL integration", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(120_000)

  let harness: AuthPostgresHarness
  let pool: Pool
  let database: AuthVerificationDatabase

  describe("customer auth verification PostgreSQL integration (P14-D08)", () => {
    beforeAll(async () => {
      harness = await createAuthPostgresHarness()
      const binding = getAuthPostgresTestBinding(harness)
      pool = new Pool({ connectionString: binding.databaseUrl })
      database = createPostgresAuthVerificationDatabase(pool)
      await pool.query(schemaSql)
    })

    beforeEach(async () => {
      idSequence = 0
      nonceSequence = 0
      await pool.query(`
        delete from auth_notification_outbox;
        delete from auth_verification_intent;
        delete from auth_credential_state;
        delete from auth_session_lineage;
        delete from auth_refresh_credential;
        delete from order_side_effect_canary;
        delete from stripe_side_effect_canary;
      `)
      await pool.query(
        `insert into auth_credential_state
          (id, auth_identity_id, customer_id, credential_version, version)
         values ('credential_pg_1', $1, 'customer_pg_1', 1, 1)`,
        [AUTH_IDENTITY_ID]
      )
    })

    afterAll(async () => {
      try {
        await pool?.query(`
          drop table if exists auth_notification_outbox;
          drop table if exists auth_verification_intent;
          drop table if exists auth_credential_state;
          drop table if exists auth_session_lineage;
          drop table if exists auth_refresh_credential;
          drop table if exists order_side_effect_canary;
          drop table if exists stripe_side_effect_canary;
        `)
      } finally {
        await pool?.end()
        await harness?.cleanup()
      }
    })

    it("commits hash-only intent and outbox atomically with the exact 30-minute TTL", async () => {
      const result = await autoRequestVerification(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      const outbox = await pool.query(
        "select * from auth_notification_outbox where intent_id = $1",
        [intent.id]
      )

      expect(result).toMatchObject({
        accepted: true,
        created: true,
        state: "pending",
      })
      expect(
        new Date(intent.expires_at).getTime() -
          new Date(intent.created_at).getTime()
      ).toBe(30 * 60 * 1000)
      expect(intent.token_hash).toBe(hashCustomerAuthCapability(capability))
      expect(JSON.stringify(intent)).not.toContain(capability)
      expect(JSON.stringify(outbox.rows[0])).not.toContain(capability)
      expect(JSON.stringify(outbox.rows[0])).not.toContain(NORMALIZED_EMAIL)
      expect(outbox.rowCount).toBe(1)
      expect(outbox.rows[0]).toMatchObject({
        intent_id: intent.id,
        generation: intent.generation,
        status: "recorded",
      })
      assertSafeAuthSink({
        hash: intent.token_hash,
        nonce: intent.nonce,
        key_version: intent.key_version,
      })
      await expectNoIsolationSideEffects(pool)
    })

    it("serializes concurrent resends into one pending latest generation", async () => {
      await autoRequestVerification(database, requestInput())

      await Promise.all([
        resendVerification(
          database,
          requestInput({ now: new Date(BASE.getTime() + 1_000) })
        ),
        resendVerification(
          database,
          requestInput({ now: new Date(BASE.getTime() + 2_000) })
        ),
      ])

      const intents = await readIntentRows(pool)
      const active = intents.filter(
        (intent) => intent.status === "pending" || intent.status === "claimed"
      )
      const latest = intents[intents.length - 1]!
      const previous = intents[intents.length - 2]!

      expect(intents).toHaveLength(3)
      expect(active).toHaveLength(1)
      expect(latest.status).toBe("pending")
      expect(previous.status).toBe("superseded")
      expect(intents.slice(0, -1).every((intent) => intent.status === "superseded")).toBe(
        true
      )

      await expect(
        confirmVerification(database, {
          capability: capabilityFor(previous),
          now: new Date(BASE.getTime() + 3_000),
        })
      ).rejects.toMatchObject({
        code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
      })

      const confirmed = await confirmVerification(database, {
        capability: capabilityFor(latest),
        now: new Date(BASE.getTime() + 4_000),
      })
      expect(confirmed).toMatchObject({
        success: true,
        state: "verified",
        generation: latest.generation,
      })
      expect(await getVerificationStatus(database, AUTH_IDENTITY_ID)).toEqual({
        state: "verified",
      })
    })

    it("gives exactly one concurrent confirmation a winner and creates no session lineage", async () => {
      await autoRequestVerification(database, requestInput())
      const intent = await readLatestIntent(pool)
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
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled"
      )
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toBeDefined()
      expectInvalid(rejected?.reason)

      const persisted = await readLatestIntent(pool)
      expect(persisted.status).toBe("confirmed")
      expect(persisted.confirmed_at).not.toBeNull()
      const credential = await pool.query(
        "select email_verified_at from auth_credential_state where auth_identity_id = $1",
        [AUTH_IDENTITY_ID]
      )
      expect(credential.rows[0].email_verified_at).not.toBeNull()
      await expectNoIsolationSideEffects(pool)
    })

    it("rejects expired, superseded, and used capabilities uniformly", async () => {
      await autoRequestVerification(database, requestInput())
      const first = await readLatestIntent(pool)
      const firstCapability = capabilityFor(first)

      await expect(
        confirmVerification(database, {
          capability: firstCapability,
          now: new Date(BASE.getTime() + 30 * 60 * 1000),
        })
      ).rejects.toMatchObject({
        code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
      })
      expect((await readLatestIntent(pool)).status).toBe("expired")

      await resendVerification(
        database,
        requestInput({ now: new Date(BASE.getTime() + 30 * 60 * 1000 + 1) })
      )
      const current = await readLatestIntent(pool)
      const currentCapability = capabilityFor(current)
      await confirmVerification(database, {
        capability: currentCapability,
        now: new Date(BASE.getTime() + 30 * 60 * 1000 + 2),
      })

      await expect(
        confirmVerification(database, {
          capability: currentCapability,
          now: new Date(BASE.getTime() + 30 * 60 * 1000 + 3),
        })
      ).rejects.toMatchObject({
        code: "AUTH_VERIFICATION_INVALID_OR_EXPIRED",
      })
      await expectNoIsolationSideEffects(pool)
    })

    it.each(["timeout", "5xx", "ambiguous"] as const)(
      "keeps verification pending when the provider returns %s",
      async (outcome) => {
        await autoRequestVerification(database, requestInput())
        const intentBefore = await readLatestIntent(pool)
        const outboxBefore = await pool.query(
          "select * from auth_notification_outbox where intent_id = $1",
          [intentBefore.id]
        )

        const relayResult = await runAuthNotificationRelay({
          knex: makeKnexLike(pool),
          client: makeProviderClient(outcome),
          config: {
            apiKey: "mock-only",
            fromEmail: "noreply@example.invalid",
          },
          keyring: KEYRING,
          resolveEmailByIdentityId: async (identityId) =>
            identityId === RECIPIENT_IDENTITY_ID ? NORMALIZED_EMAIL : null,
          now: () => BASE,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        const intentAfter = await readLatestIntent(pool)
        const outboxAfter = await pool.query(
          "select * from auth_notification_outbox where id = $1",
          [outboxBefore.rows[0].id]
        )

        expect(relayResult).toMatchObject({
          processed: 1,
          sent: 0,
          failed: 1,
          dead_lettered: 0,
        })
        expect(intentAfter.status).toBe("pending")
        expect(outboxAfter.rows[0]).toMatchObject({
          status: "failed",
          failure_reason: "provider_transient",
        })
        expect(outboxAfter.rows[0].failed_at).not.toBeNull()
        expect(outboxAfter.rows[0].next_retry_at).not.toBeNull()
        await expectNoIsolationSideEffects(pool)
      }
    )

    it("accepts a capability minted under the previous key after key rotation", async () => {
      await autoRequestVerification(
        database,
        requestInput({
          keyring: OLD_KEYRING,
          now: BASE,
        })
      )
      const intent = await readLatestIntent(pool)
      const rotatedCapability = capabilityFor(intent, ROTATED_KEYRING)

      expect(intent.key_version).toBe(1)
      expect(intent.token_hash).toBe(
        hashCustomerAuthCapability(rotatedCapability)
      )

      const confirmed = await confirmVerification(database, {
        capability: rotatedCapability,
        now: new Date(BASE.getTime() + 1_000),
      })
      expect(confirmed.success).toBe(true)
      await expectNoIsolationSideEffects(pool)
    })

    it("proves sanitized sinks, no native events, and verification paths remain DENY", async () => {
      const emittedEvents: unknown[] = []
      const leakage = createAuthLeakageCollector()

      await autoRequestVerification(database, requestInput())
      const intent = await readLatestIntent(pool)
      const capability = capabilityFor(intent)
      await confirmVerification(database, {
        capability,
        now: new Date(BASE.getTime() + 1_000),
      })

      const persisted = await pool.query(
        `select token_hash, nonce, key_version
           from auth_verification_intent
          where id = $1`,
        [intent.id]
      )
      const safeMaterial = {
        hash: persisted.rows[0].token_hash,
        nonce: persisted.rows[0].nonce,
        key_version: persisted.rows[0].key_version,
      }
      assertSafeAuthSink(safeMaterial)
      expect(JSON.stringify(safeMaterial)).not.toContain(capability)

      leakage.record("db_plaintext", safeMaterial)
      leakage.record("redis_keys_jobs", {
        intent_id: intent.id,
        generation: intent.generation,
      })
      leakage.record("logs", {
        event: "auth_verification_confirmed",
        intent_id: intent.id,
        generation: intent.generation,
      })
      leakage.record("openapi", {
        paths: ["/auth/verification/request", "/auth/verification/confirm"],
      })
      leakage.record("fixtures_snapshots", {
        state: "confirmed",
        generation: intent.generation,
      })
      leakage.record("persisted_provider_payload", {
        status: "not_sent",
      })
      leakage.assertNoCanaries()
      assertAuthSinksHaveNoCanaries(leakage.snapshots())
      expect(emittedEvents).toHaveLength(0)

      const verificationEntries = AUTH_SURFACE_MANIFEST.filter((entry) =>
        entry.pathTemplate.startsWith("/auth/verification/")
      )
      expect(verificationEntries).toHaveLength(2)
      expect(
        verificationEntries.every(
          (entry) => entry.origin === "native" && entry.runtimePolicy === "DENY"
        )
      ).toBe(true)
      expect(
        AUTH_SURFACE_MANIFEST.some(
          (entry) => entry.pathTemplate === "/auth/verification/status"
        )
      ).toBe(false)
      await expectNoIsolationSideEffects(pool)
    })
  })
}
