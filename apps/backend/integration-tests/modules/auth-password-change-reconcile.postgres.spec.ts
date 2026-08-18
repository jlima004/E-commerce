import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import { AUTH_CANARIES } from "../helpers/auth-leakage"
import {
  confirmPasswordReset,
  createPostgresAuthResetDatabase,
  requestPasswordReset,
  type AuthResetDatabase,
  type AuthResetIntentRecord,
  type AuthResetPasswordProvider,
} from "../../src/modules/customer-auth/reset"
import {
  deriveCustomerAuthCapability,
  type CapabilityKeyring,
} from "../../src/modules/customer-auth/security/capabilities"
import { runAuthResetReconcile } from "../../src/jobs/auth-reset-reconcile"
import {
  AUTH_CREDENTIAL_OPERATION_ALERT_REASON_CODES,
  AUTH_CREDENTIAL_OPERATION_BACKOFF_SCHEDULE_MS,
  AUTH_CREDENTIAL_OPERATION_DUE_STATUSES,
  AUTH_CREDENTIAL_OPERATION_LEASE_MS,
  AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS,
  AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE,
  computeCredentialOperationBackoff,
  config as credentialReconcileJobConfig,
  createPostgresCredentialOperationDatabase,
  isCredentialOperationClaimable,
  isCredentialOperationDue,
  isCredentialOperationLeaseClaimable,
  runAuthCredentialOperationReconcile,
} from "../../src/jobs/auth-credential-operation-reconcile"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  validateStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"
import {
  decideStoreSurfaceAccess,
  storeSurfaceGuardMiddleware,
} from "../../src/api/store-surface/guard"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../src/api/auth-surface/manifest"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
} from "../../src/modules/customer-auth/bff-service-auth"
import defaultMiddlewares, {
  createCustomerAuthBffServiceGuardMiddleware,
  customerAuthAccessGuardMiddleware,
  customerAuthBffServiceGuardMiddleware,
} from "../../src/api/middlewares"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const BASE = new Date("2026-08-17T18:00:00.000Z")
const PASSWORD_PATH = "/store/customers/me/password"
const RECONCILER_SOURCE = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../src/jobs/auth-credential-operation-reconcile.ts"
  ),
  "utf8"
)
const MEDUSA_CONFIG_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../medusa-config.ts"),
  "utf8"
)
const BFF_SERVICE_SECRET = "indicio-bff-service-secret-synthetic-32b"

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
  deleted_at timestamptz,
  constraint auth_credential_state_lease_pair
    check (((lease_owner is null and lease_until is null) or (lease_owner is not null and lease_until is not null))),
  constraint auth_credential_state_update_after_provider_proof
    check (credential_updated_at is null or provider_proved_at is not null),
  constraint auth_credential_state_revocation_after_update
    check (revocation_committed_at is null or credential_updated_at is not null),
  constraint auth_credential_state_completion_order
    check (completed_at is null or (provider_proved_at is not null and credential_updated_at is not null and revocation_committed_at is not null))
);

create unique index if not exists auth_credop_test_credential_identity
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

create unique index if not exists auth_credop_test_token_hash
  on auth_reset_intent (token_hash) where deleted_at is null;

create unique index if not exists auth_credop_test_identity_generation
  on auth_reset_intent (auth_identity_id, generation) where deleted_at is null;

create unique index if not exists auth_credop_test_active_identity
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
      return this.nextUpdate
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

type SeedPasswordChangeInput = {
  id: string
  authIdentityId: string
  customerId: string
  status: string
  operationVersion?: number
  attemptCount?: number
  leaseOwner?: string | null
  leaseUntil?: Date | null
  nextRetryAt?: Date | null
  providerProvedAt?: Date | null
  credentialUpdatedAt?: Date | null
  revocationCommittedAt?: Date | null
  completedAt?: Date | null
  currentPasswordVerifiedAt?: Date | null
}

async function seedPasswordChange(
  pool: Pool,
  input: SeedPasswordChangeInput
): Promise<void> {
  await pool.query(
    `insert into auth_credential_state (
        id, auth_identity_id, customer_id, credential_version, operation_type,
        operation_id, operation_status, operation_version, version, lease_owner,
        lease_until, attempt_count, next_retry_at, current_password_verified_at,
        provider_proved_at, credential_updated_at, revocation_committed_at,
        completed_at, created_at, updated_at
      ) values (
        $1, $2, $3, 1, 'password_change', $4, $5, $6, 1, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $16
      )`,
    [
      input.id,
      input.authIdentityId,
      input.customerId,
      `op_${input.id}`,
      input.status,
      input.operationVersion ?? 1,
      input.leaseOwner ?? null,
      input.leaseUntil ?? null,
      input.attemptCount ?? 0,
      input.nextRetryAt ?? null,
      input.currentPasswordVerifiedAt ?? BASE,
      input.providerProvedAt ?? null,
      input.credentialUpdatedAt ?? null,
      input.revocationCommittedAt ?? null,
      input.completedAt ?? null,
      BASE,
    ]
  )
}

async function seedLineages(
  pool: Pool,
  authIdentityId: string,
  customerId: string,
  prefix: string
): Promise<void> {
  await pool.query(
    `insert into auth_session_lineage (id, auth_identity_id, customer_id, status)
     values ($1, $3, $4, 'active'), ($2, $3, $4, 'active')`,
    [`${prefix}_lineage_a`, `${prefix}_lineage_b`, authIdentityId, customerId]
  )
  await pool.query(
    `insert into auth_refresh_credential (id, lineage_id, status)
     values ($1, $3, 'active'), ($2, $4, 'active')`,
    [
      `${prefix}_refresh_a`,
      `${prefix}_refresh_b`,
      `${prefix}_lineage_a`,
      `${prefix}_lineage_b`,
    ]
  )
}

async function readCredential(pool: Pool, id: string) {
  const result = await pool.query(
    `select * from auth_credential_state where id = $1`,
    [id]
  )
  return result.rows[0]
}

function collectAlerts() {
  const alerts: Array<Record<string, unknown>> = []
  return {
    alerts,
    logger: {
      warn(_message: string, meta?: Record<string, unknown>) {
        alerts.push(meta ?? {})
      },
    },
  }
}

let idSequence = 0
let nonceSequence = 0
function idFactory(prefix: string) {
  idSequence += 1
  return `${prefix}_${idSequence}`
}
function randomBytesFactory(size: number) {
  nonceSequence += 1
  return Buffer.alloc(size, nonceSequence)
}

function requestInput() {
  return {
    authIdentityId: "identity_reset_credop",
    recipientIdentityId: "recipient_reset_credop",
    normalizedEmail: "customer@example.invalid",
    keyring: KEYRING,
    now: BASE,
    idFactory,
    randomBytesFn: randomBytesFactory,
  }
}

function capabilityFor(
  intent: Pick<AuthResetIntentRecord, "id" | "generation" | "nonce" | "key_version">
): string {
  return deriveCustomerAuthCapability({
    keyring: KEYRING,
    purpose: "reset",
    intentId: intent.id,
    generation: intent.generation,
    nonce: intent.nonce,
    keyVersion: intent.key_version,
  }).capability
}

async function readLatestIntent(pool: Pool): Promise<AuthResetIntentRecord> {
  const result = await pool.query(
    `select * from auth_reset_intent order by generation desc`
  )
  expect(result.rows[0]).toBeDefined()
  return result.rows[0] as AuthResetIntentRecord
}

if (!databaseUrl || !databaseName) {
  describe("credential-operation reconciler PostgreSQL", () => {
    it("requires the disposable PostgreSQL runner for claim/lease/secretless/reset", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(180_000)

  let harness: AuthPostgresHarness
  let pool: Pool
  let resetDatabase: AuthResetDatabase

  describe("credential-operation reconciler PostgreSQL (14-18)", () => {
    beforeAll(async () => {
      harness = await createAuthPostgresHarness()
      const binding = getAuthPostgresTestBinding(harness)
      pool = new Pool({ connectionString: binding.databaseUrl })
      resetDatabase = createPostgresAuthResetDatabase(pool)
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
      `)
    })

    afterAll(async () => {
      try {
        await pool?.query(`
          drop table if exists auth_notification_outbox;
          drop table if exists auth_reset_intent;
          drop table if exists auth_refresh_credential;
          drop table if exists auth_session_lineage;
          drop table if exists auth_credential_state;
        `)
      } finally {
        await pool?.end()
        await harness?.cleanup()
      }
    })

    it("locks worker-only job name, 2m schedule, batch 25 and lease 2m", () => {
      expect(credentialReconcileJobConfig).toEqual({
        name: "auth-credential-operation-reconcile",
        schedule: "*/2 * * * *",
      })
      expect(AUTH_CREDENTIAL_OPERATION_RECONCILE_BATCH_SIZE).toBe(25)
      expect(AUTH_CREDENTIAL_OPERATION_LEASE_MS).toBe(120_000)
      expect(AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS).toBe(6)
      expect([...AUTH_CREDENTIAL_OPERATION_BACKOFF_SCHEDULE_MS]).toEqual([
        60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
      ])
      expect([...AUTH_CREDENTIAL_OPERATION_DUE_STATUSES]).toEqual([
        "claimed",
        "provider_outcome_ambiguous",
        "credential_proved",
        "revocation_pending",
      ])
    })

    it("is a secretless no-op outside worker mode and never scans", async () => {
      const database = createPostgresCredentialOperationDatabase(pool)
      const result = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => false,
        isReleaseMigration: () => false,
      })
      expect(result).toMatchObject({
        processed: 0,
        leased: 0,
        noop_reason: "not_worker",
      })
    })

    it("requires operation due AND lease claimable, never the historical OR", () => {
      const now = BASE
      const liveLease = new Date(now.getTime() + 1)
      expect(
        isCredentialOperationClaimable(
          { nextRetryAt: null, leaseUntilAt: liveLease, attemptCount: 0 },
          now
        )
      ).toBe(false)
      expect(isCredentialOperationDue(null, now)).toBe(true)
      expect(isCredentialOperationLeaseClaimable(liveLease, now)).toBe(false)
      expect(
        isCredentialOperationClaimable(
          { nextRetryAt: null, leaseUntilAt: null, attemptCount: 0 },
          now
        )
      ).toBe(true)
    })

    it("claims a due password_change claimed row with absent lease", async () => {
      await seedPasswordChange(pool, {
        id: "cred_claimed_due",
        authIdentityId: "identity_claimed",
        customerId: "customer_claimed",
        status: "claimed",
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      const { alerts, logger } = collectAlerts()
      const result = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_claimed",
        operationTypes: ["password_change"],
        logger,
      })
      const row = await readCredential(pool, "cred_claimed_due")
      expect(result.leased).toBe(1)
      expect(row.lease_owner).toBe("authlease_claimed")
      expect(new Date(row.lease_until).getTime()).toBe(
        BASE.getTime() + AUTH_CREDENTIAL_OPERATION_LEASE_MS
      )
      expect(row.operation_status).toBe("claimed")
      expect(row.completed_at).toBeNull()
      expect(row.credential_version).toBe(1)
      expect(JSON.stringify(alerts)).not.toContain(AUTH_CANARIES.password)
    })

    it("claims a due password_change provider_outcome_ambiguous row without inventing proof", async () => {
      await seedPasswordChange(pool, {
        id: "cred_ambiguous_due",
        authIdentityId: "identity_ambiguous",
        customerId: "customer_ambiguous",
        status: "provider_outcome_ambiguous",
        nextRetryAt: BASE,
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      const result = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_ambiguous",
        operationTypes: ["password_change"],
      })
      const row = await readCredential(pool, "cred_ambiguous_due")
      expect(result.leased).toBe(1)
      expect(row.provider_proved_at).toBeNull()
      expect(row.credential_updated_at).toBeNull()
      expect(row.operation_status).toBe("provider_outcome_ambiguous")
      expect(row.completed_at).toBeNull()
    })

    it("revokes idempotently for credential_proved with update marker and never completes secretless", async () => {
      await seedPasswordChange(pool, {
        id: "cred_proved",
        authIdentityId: "identity_proved",
        customerId: "customer_proved",
        status: "credential_proved",
        providerProvedAt: BASE,
        credentialUpdatedAt: BASE,
      })
      await seedLineages(pool, "identity_proved", "customer_proved", "proved")
      const database = createPostgresCredentialOperationDatabase(pool)
      const first = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_proved_a",
        operationTypes: ["password_change"],
      })
      const afterFirst = await readCredential(pool, "cred_proved")
      const lineages = await pool.query(
        `select status, revocation_reason from auth_session_lineage where auth_identity_id = $1`,
        ["identity_proved"]
      )
      expect(first.revoked).toBe(1)
      expect(afterFirst.revocation_committed_at).not.toBeNull()
      expect(afterFirst.operation_status).toBe("revocation_committed")
      expect(afterFirst.completed_at).toBeNull()
      expect(afterFirst.credential_version).toBe(1)
      expect(lineages.rows.every((row) => row.status === "revoked")).toBe(true)

      const second = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => new Date(BASE.getTime() + AUTH_CREDENTIAL_OPERATION_LEASE_MS),
        leaseOwner: "authlease_proved_b",
        operationTypes: ["password_change"],
      })
      const afterSecond = await readCredential(pool, "cred_proved")
      expect(second.leased).toBe(0)
      expect(afterSecond.completed_at).toBeNull()
      expect(afterSecond.operation_status).toBe("revocation_committed")
    })

    it("does not invent secretless proof or complete when credential_proved proof is absent", async () => {
      await seedPasswordChange(pool, {
        id: "cred_proved_absent",
        authIdentityId: "identity_proved_absent",
        customerId: "customer_proved_absent",
        status: "credential_proved",
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_absent",
        operationTypes: ["password_change"],
      })
      const row = await readCredential(pool, "cred_proved_absent")
      expect(row.provider_proved_at).toBeNull()
      expect(row.credential_updated_at).toBeNull()
      expect(row.revocation_committed_at).toBeNull()
      expect(row.completed_at).toBeNull()
      expect(row.operation_status).toBe("credential_proved")
    })

    it("delegates reset claimed/due and reset ambiguous/due without completing", async () => {
      await pool.query(
        `insert into auth_credential_state
          (id, auth_identity_id, customer_id, credential_version, version)
         values ('credential_reset_1', 'identity_reset_credop', 'customer_reset_credop', 1, 1)`
      )
      await requestPasswordReset(resetDatabase, requestInput())
      const intent = await readLatestIntent(pool)
      const provider = new RecordingProvider()
      provider.nextUpdate = "timeout"
      await confirmPasswordReset(resetDatabase, {
        capability: capabilityFor(intent),
        newPassword: AUTH_CANARIES.password,
        idempotencyKey: "reset-op-credop-1",
        keyring: KEYRING,
        provider,
        now: new Date(BASE.getTime() + 1_000),
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      const job = await runAuthResetReconcile({
        database,
        isWorker: () => true,
        now: () => new Date(BASE.getTime() + 3 * 60 * 1000),
        leaseOwner: "authlease_reset_delegate",
      })
      const after = await readLatestIntent(pool)
      const credential = await pool.query(
        `select operation_status, completed_at, provider_proved_at from auth_credential_state where auth_identity_id = $1`,
        ["identity_reset_credop"]
      )
      expect(job.processed).toBeGreaterThan(0)
      expect(job.noop_reason).toBeNull()
      expect(after.status).not.toBe("completed")
      expect(after.completed_at).toBeNull()
      expect(credential.rows[0].completed_at).toBeNull()
      expect(credential.rows[0].provider_proved_at).toBeNull()
      expect(provider.updateCalls).toBe(1)
      expect(provider.verifyCalls).toBe(0)
    })

    it("lets exactly one worker claim a password_change lease and blocks the loser", async () => {
      await seedPasswordChange(pool, {
        id: "cred_race",
        authIdentityId: "identity_race",
        customerId: "customer_race",
        status: "claimed",
      })
      const workerA = createPostgresCredentialOperationDatabase(pool)
      const workerB = createPostgresCredentialOperationDatabase(pool)
      const [first, second] = await Promise.all([
        runAuthCredentialOperationReconcile({
          database: workerA,
          isWorker: () => true,
          now: () => BASE,
          leaseOwner: "authlease_race_a",
          operationTypes: ["password_change"],
        }),
        runAuthCredentialOperationReconcile({
          database: workerB,
          isWorker: () => true,
          now: () => BASE,
          leaseOwner: "authlease_race_b",
          operationTypes: ["password_change"],
        }),
      ])
      const row = await readCredential(pool, "cred_race")
      expect(first.leased + second.leased).toBe(1)
      expect(["authlease_race_a", "authlease_race_b"]).toContain(row.lease_owner)
      expect(Number(row.operation_version)).toBe(2)
      expect(row.completed_at).toBeNull()
      const loser = first.leased === 1 ? second : first
      expect(loser.leased).toBe(0)
    })

    it("blocks reclaim before lease_until and allows reclaim at expiry", async () => {
      await seedPasswordChange(pool, {
        id: "cred_reclaim",
        authIdentityId: "identity_reclaim",
        customerId: "customer_reclaim",
        status: "claimed",
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      const first = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_reclaim_a",
        operationTypes: ["password_change"],
      })
      const held = await readCredential(pool, "cred_reclaim")
      const blockedNow = new Date(new Date(held.lease_until).getTime() - 1)
      const blocked = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => blockedNow,
        leaseOwner: "authlease_reclaim_b",
        operationTypes: ["password_change"],
      })
      const stillHeld = await readCredential(pool, "cred_reclaim")
      expect(first.leased).toBe(1)
      expect(blocked.leased).toBe(0)
      expect(stillHeld.lease_owner).toBe("authlease_reclaim_a")
      expect(new Date(stillHeld.lease_until).getTime()).toBe(
        new Date(held.lease_until).getTime()
      )

      const reclaimNow = new Date(held.lease_until)
      const reclaimed = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => reclaimNow,
        leaseOwner: "authlease_reclaim_c",
        operationTypes: ["password_change"],
      })
      const after = await readCredential(pool, "cred_reclaim")
      expect(reclaimed.leased).toBe(1)
      expect(after.lease_owner).toBe("authlease_reclaim_c")
      expect(new Date(after.lease_until).getTime()).toBe(
        reclaimNow.getTime() + AUTH_CREDENTIAL_OPERATION_LEASE_MS
      )
      expect(after.completed_at).toBeNull()
    })

    it("reclaims after restart from persisted PostgreSQL lease state, not memory", async () => {
      await seedPasswordChange(pool, {
        id: "cred_restart",
        authIdentityId: "identity_restart",
        customerId: "customer_restart",
        status: "provider_outcome_ambiguous",
      })
      const firstWorker = createPostgresCredentialOperationDatabase(pool)
      await runAuthCredentialOperationReconcile({
        database: firstWorker,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_restart_1",
        operationTypes: ["password_change"],
      })
      const persisted = await readCredential(pool, "cred_restart")
      expect(persisted.lease_owner).toBe("authlease_restart_1")

      const restarted = createPostgresCredentialOperationDatabase(pool)
      const blocked = await runAuthCredentialOperationReconcile({
        database: restarted,
        isWorker: () => true,
        now: () => new Date(new Date(persisted.lease_until).getTime() - 1),
        leaseOwner: "authlease_restart_2",
        operationTypes: ["password_change"],
      })
      expect(blocked.leased).toBe(0)
      const still = await readCredential(pool, "cred_restart")
      expect(still.lease_owner).toBe("authlease_restart_1")
      expect(still.completed_at).toBeNull()
    })

    it("applies the closed backoff sequence after each secretless claim and exhausts with a sanitized alert", async () => {
      await seedPasswordChange(pool, {
        id: "cred_backoff",
        authIdentityId: "identity_backoff",
        customerId: "customer_backoff",
        status: "claimed",
        attemptCount: 0,
        operationVersion: 0,
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      const { alerts, logger } = collectAlerts()
      let now = BASE
      for (let attempt = 1; attempt <= AUTH_CREDENTIAL_OPERATION_MAX_ATTEMPTS; attempt += 1) {
        const result = await runAuthCredentialOperationReconcile({
          database,
          isWorker: () => true,
          now: () => now,
          leaseOwner: `authlease_backoff_${attempt}`,
          operationTypes: ["password_change"],
          logger,
        })
        expect(result.leased).toBe(1)
        const row = await readCredential(pool, "cred_backoff")
        const expected = computeCredentialOperationBackoff(attempt, now)
        expect(Number(row.attempt_count)).toBe(attempt)
        if (expected.exhausted) {
          expect(result.exhausted).toBe(1)
          expect(row.next_retry_at).toBeNull()
        } else {
          expect(new Date(row.next_retry_at).getTime()).toBe(
            expected.nextRetryAt!.getTime()
          )
          now = new Date(
            Math.max(
              new Date(row.lease_until).getTime(),
              new Date(row.next_retry_at).getTime()
            )
          )
        }
      }
      const exhaustedScan = await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => new Date(now.getTime() + AUTH_CREDENTIAL_OPERATION_LEASE_MS),
        leaseOwner: "authlease_backoff_done",
        operationTypes: ["password_change"],
        logger,
      })
      expect(exhaustedScan.leased).toBe(0)
      const serialized = JSON.stringify(alerts)
      expect(serialized).not.toContain(AUTH_CANARIES.password)
      expect(serialized).not.toContain("customer@example.invalid")
      expect(serialized.toLowerCase()).not.toContain("authorization")
      expect(serialized).toContain("AUTH_CREDENTIAL_OPERATION_EXHAUSTED")
      expect(AUTH_CREDENTIAL_OPERATION_ALERT_REASON_CODES).toContain(
        "AUTH_CREDENTIAL_OPERATION_EXHAUSTED"
      )
    })

    it("never invokes a password provider and never completes secretless", async () => {
      expect(RECONCILER_SOURCE).not.toMatch(/verifyPassword/)
      expect(RECONCILER_SOURCE).not.toMatch(/updatePassword/)
      expect(RECONCILER_SOURCE).not.toMatch(/currentPassword/)
      expect(RECONCILER_SOURCE).not.toMatch(/newPassword/)
      expect(RECONCILER_SOURCE).not.toMatch(/authenticate\(/)
      await seedPasswordChange(pool, {
        id: "cred_secretless",
        authIdentityId: "identity_secretless",
        customerId: "customer_secretless",
        status: "claimed",
      })
      const database = createPostgresCredentialOperationDatabase(pool)
      await runAuthCredentialOperationReconcile({
        database,
        isWorker: () => true,
        now: () => BASE,
        leaseOwner: "authlease_secretless",
        operationTypes: ["password_change"],
      })
      const row = await readCredential(pool, "cred_secretless")
      expect(row.completed_at).toBeNull()
      expect(row.operation_status).not.toBe("stable")
      expect(row.operation_status).not.toBe("completed")
    })

    it("loses a stale operation-version CAS claim instead of overwriting the winner lease", async () => {
      await seedPasswordChange(pool, {
        id: "cred_cas",
        authIdentityId: "identity_cas",
        customerId: "customer_cas",
        status: "claimed",
        operationVersion: 4,
      })
      const workerA = createPostgresCredentialOperationDatabase(pool)
      const workerB = createPostgresCredentialOperationDatabase(pool)
      const [first, second] = await Promise.all([
        runAuthCredentialOperationReconcile({
          database: workerA,
          isWorker: () => true,
          now: () => BASE,
          leaseOwner: "authlease_cas_a",
          operationTypes: ["password_change"],
        }),
        runAuthCredentialOperationReconcile({
          database: workerB,
          isWorker: () => true,
          now: () => BASE,
          leaseOwner: "authlease_cas_b",
          operationTypes: ["password_change"],
        }),
      ])
      const row = await readCredential(pool, "cred_cas")
      expect(first.leased + second.leased).toBe(1)
      expect(Number(row.operation_version)).toBe(5)
      expect(["authlease_cas_a", "authlease_cas_b"]).toContain(row.lease_owner)
      const loserOwner =
        row.lease_owner === "authlease_cas_a"
          ? "authlease_cas_b"
          : "authlease_cas_a"
      expect(row.lease_owner).not.toBe(loserOwner)
      expect(row.completed_at).toBeNull()
    })

    it("elevates only POST /store/customers/me/password after PostgreSQL reconciler proof", () => {
      expect(credentialReconcileJobConfig).toEqual({
        name: "auth-credential-operation-reconcile",
        schedule: "*/2 * * * *",
      })
      expect(RECONCILER_SOURCE).not.toMatch(/verifyPassword|updatePassword|authenticate\(/)
      expect(RECONCILER_SOURCE).not.toContain("STORE_SURFACE_PHASE14_ENABLED_OPERATIONS")
      expect(RECONCILER_SOURCE).not.toContain("runtime_policy")
      expect(validateStoreSurfaceManifest()).toEqual([])
      expect([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS]).toEqual([
        "GET /store/customers/me",
        "POST /store/customers/me/verify",
        "POST /store/customers/verify/resend",
        "POST /store/customers/verify",
        "GET /store/customers/me/verify/status",
        "POST /store/customers/me/password",
      ])
      expect(
        STORE_SURFACE_MANIFEST.filter(
          (entry) => entry.runtime_policy === "M1_ENABLED"
        ).map((entry) => `${entry.method} ${entry.pathTemplate}`)
      ).toEqual([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS])
      expect(decideStoreSurfaceAccess("POST", PASSWORD_PATH).action).toBe("allow")
      expect(CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS).toContain(
        "POST /store/customers/me/password"
      )
      expect([...CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS]).toEqual([
        "POST /auth/customer/emailpass/register",
        "POST /auth/customer/emailpass",
        "POST /auth/token/refresh",
        "POST /auth/customer/emailpass/revoke-current-lineage",
        "GET /store/customers/me",
        "POST /store/customers/me/verify",
        "POST /store/customers/verify/resend",
        "POST /store/customers/verify",
        "GET /store/customers/me/verify/status",
        "POST /auth/customer/emailpass/reset-password",
        "POST /auth/customer/emailpass/update",
        "POST /store/customers/me/password",
      ])
      expect(
        AUTH_SURFACE_LOCAL_OPERATIONS.filter(
          (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
        ).map((entry) => `${entry.method} ${entry.pathTemplate}`)
      ).toEqual([
        "POST /auth/customer/emailpass/register",
        "POST /auth/customer/emailpass",
        "POST /auth/token/refresh",
        "POST /auth/customer/emailpass/revoke-current-lineage",
        "POST /auth/customer/emailpass/reset-password",
        "POST /auth/customer/emailpass/update",
      ])
      expect(
        AUTH_SURFACE_NATIVE_OPERATIONS.every(
          (entry) => entry.runtimePolicy === "DENY"
        )
      ).toBe(true)
      expect(decideAuthSurfaceAccess("POST", PASSWORD_PATH).action).toBe("deny")
      expect(decideAuthSurfaceAccess("POST", "/auth/session").action).toBe("deny")
      expect(decideAuthSurfaceAccess("POST", "/auth/token/refresh").action).toBe(
        "allow"
      )
      expect(
        decideAuthSurfaceAccess("POST", "/auth/customer/emailpass/reset-password/")
          .action
      ).toBe("deny")
      expect(
        decideStoreSurfaceAccess("POST", "/store/customers").action
      ).toBe("deny")
      expect(
        decideStoreSurfaceAccess("POST", `${PASSWORD_PATH}/`).action
      ).toBe("deny")
      expect(
        decideStoreSurfaceAccess("POST", "/store/customers/Me/password").action
      ).toBe("deny")
      expect(
        decideStoreSurfaceAccess("GET", PASSWORD_PATH).action
      ).toBe("deny")
      expect(
        decideStoreSurfaceAccess("POST", "/store/customers/me/password/alias")
          .action
      ).toBe("deny")
      expect(MEDUSA_CONFIG_SOURCE).toMatch(/workerMode:\s*env\.WORKER_MODE/)
      expect(MEDUSA_CONFIG_SOURCE).toMatch(
        /authMethodsPerActor:\s*\{\s*customer:\s*\["emailpass"\]/
      )
      expect(MEDUSA_CONFIG_SOURCE).not.toContain("CUSTOMER_AUTH_BFF_SERVICE_SECRET")
      const routes = defaultMiddlewares.routes ?? []
      const passwordRoute = routes.find(
        (route) => String(route.matcher) === PASSWORD_PATH
      )
      expect(passwordRoute).toBeDefined()
      expect(passwordRoute?.middlewares).toEqual([
        customerAuthBffServiceGuardMiddleware,
      ])
      expect(passwordRoute?.middlewares).not.toContain(
        customerAuthAccessGuardMiddleware
      )
      expect(customerAuthBffServiceGuardMiddleware).toEqual(expect.any(Function))
      expect(customerAuthAccessGuardMiddleware).toEqual(expect.any(Function))
    })

    it("denies password change without a BFF credential before the handler", () => {
      const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
        expectedSecret: BFF_SERVICE_SECRET,
      })
      const handler = jest.fn()
      const missing = {
        statusCode: 200,
        body: undefined as unknown,
      }
      const invalid = {
        statusCode: 200,
        body: undefined as unknown,
      }

      const responseOf = (state: { statusCode: number; body: unknown }) => {
        const response = {
          headersSent: false,
          status(code: number) {
            state.statusCode = code
            return response
          },
          setHeader() {
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
        return response
      }

      const apply = (
        state: { statusCode: number; body: unknown },
        headers: Record<string, string>
      ) => {
        const response = responseOf(state)
        storeSurfaceGuardMiddleware(
          {
            method: "POST",
            originalUrl: PASSWORD_PATH,
            url: PASSWORD_PATH,
            path: PASSWORD_PATH,
            headers,
          } as never,
          response as never,
          () => {
            bffGuard(
              {
                method: "POST",
                originalUrl: PASSWORD_PATH,
                url: PASSWORD_PATH,
                path: PASSWORD_PATH,
                headers,
                correlationId: "password-reconcile-bff-deny",
              } as never,
              response as never,
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
      expect(missing.statusCode).toBe(404)
      expect(invalid.statusCode).toBe(404)
      expect(missing.body).toEqual({ type: "not_found", message: "Not Found" })
      expect(invalid.body).toEqual({ type: "not_found", message: "Not Found" })
      expect(JSON.stringify(missing.body)).not.toContain(BFF_SERVICE_SECRET)
      expect(JSON.stringify(invalid.body)).not.toContain(BFF_SERVICE_SECRET)
    })

    it("lets a valid BFF credential reach password-change handler guards without job completion", () => {
      const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
        expectedSecret: BFF_SERVICE_SECRET,
      })
      const handler = jest.fn()
      const state = { statusCode: 200, body: undefined as unknown }
      const response = {
        headersSent: false,
        status(code: number) {
          state.statusCode = code
          return response
        },
        setHeader() {
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
      const headers = {
        [CUSTOMER_AUTH_BFF_AUTH_HEADER]: BFF_SERVICE_SECRET,
      }
      storeSurfaceGuardMiddleware(
        {
          method: "POST",
          originalUrl: PASSWORD_PATH,
          url: PASSWORD_PATH,
          path: PASSWORD_PATH,
          headers,
        } as never,
        response as never,
        () => {
          bffGuard(
            {
              method: "POST",
              originalUrl: PASSWORD_PATH,
              url: PASSWORD_PATH,
              path: PASSWORD_PATH,
              headers,
              correlationId: "password-reconcile-bff-allow",
            } as never,
            response as never,
            handler
          )
        }
      )
      expect(handler).toHaveBeenCalledTimes(1)
      expect(RECONCILER_SOURCE).not.toMatch(/completed_at\s*=/)
      expect(credentialReconcileJobConfig.name).toBe(
        "auth-credential-operation-reconcile"
      )
    })
  })
}
