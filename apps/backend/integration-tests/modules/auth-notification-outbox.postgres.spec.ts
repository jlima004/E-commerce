import { Client, Pool, PoolClient } from "pg"
import {
  CustomerAuthModuleService,
  type CustomerAuthMutationContext,
} from "../../src/modules/customer-auth/service"
import {
  formatAuthNotificationIdempotencyKey,
  recordNotificationOutboxInTransaction,
  type AuthNotificationOutboxRecord,
} from "../../src/modules/customer-auth/notification-outbox"
import {
  runAuthNotificationRelay,
  type ResendAuthRelayClient,
} from "../../src/jobs/auth-notification-relay"
import { runAuthNotificationReconcile } from "../../src/jobs/auth-notification-reconcile"
import {
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
  parseCustomerAuthCapabilityKeyring,
} from "../../src/modules/customer-auth/security/capabilities"
import { deriveCustomerAuthRecipientHash } from "../../src/modules/customer-auth/notification-outbox"
import { normalizeCustomerAuthEmail } from "../../src/modules/customer-auth/security/email-normalization"
import { OperationalAlertModuleService } from "../../src/modules/operational-alert/service"
import { OPERATIONAL_ALERT_MODULE } from "../../src/modules/operational-alert"
import { Migration20260814030000 } from "../../src/modules/operational-alert/migrations/Migration20260814030000"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const schemaSql = `
create table if not exists auth_verification_intent (
  id text primary key, auth_identity_id text not null, token_hash text not null, nonce text not null,
  key_version integer not null, generation integer not null default 0, status text not null default 'pending',
  version integer not null default 1, expires_at timestamptz not null, claimed_at timestamptz, confirmed_at timestamptz,
  superseded_at timestamptz, expired_at timestamptz, dead_lettered_at timestamptz, schema_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists auth_reset_intent (
  id text primary key, auth_identity_id text not null, token_hash text not null, nonce text not null,
  key_version integer not null, generation integer not null default 0, status text not null default 'pending',
  version integer not null default 1, operation_id text, expires_at timestamptz not null, claimed_at timestamptz,
  provider_proved_at timestamptz, credential_updated_at timestamptz, revocation_committed_at timestamptz, completed_at timestamptz,
  superseded_at timestamptz, expired_at timestamptz, failed_reconcilable_at timestamptz, schema_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists auth_notification_outbox (
  id text primary key, template text not null, intent_type text not null,
  intent_id text not null, generation integer not null default 0, idempotency_key text not null,
  status text not null default 'recorded', recipient_identity_id text not null,
  recipient_hash text not null, recipient_domain text not null, key_version integer not null,
  version integer not null default 1, lease_owner text, lease_until timestamptz,
  attempt_count integer not null default 0, next_retry_at timestamptz, failure_reason text,
  provider_message_id text, recorded_at timestamptz not null, claimed_at timestamptz,
  sent_at timestamptz, failed_at timestamptz, dead_lettered_at timestamptz, schema_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_notification_outbox_versions_valid check (generation >= 0 AND version >= 1 AND key_version >= 1 AND schema_version >= 1),
  constraint auth_notification_outbox_attempt_count_valid check (attempt_count >= 0 AND attempt_count <= 6),
  constraint auth_notification_outbox_lease_pair check (((lease_owner IS NULL AND lease_until IS NULL) OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))),
  constraint auth_notification_outbox_idempotency_shape check (idempotency_key LIKE 'auth/%' AND char_length(idempotency_key) <= 256),
  constraint auth_notification_outbox_template_intent_match check (((template = 'email_verification_v1' AND intent_type = 'verification') OR (template = 'password_reset_v1' AND intent_type = 'reset'))),
  constraint auth_notification_outbox_recipient_evidence check (char_length(recipient_identity_id) > 0 AND char_length(recipient_hash) > 0 AND char_length(recipient_domain) BETWEEN 1 AND 253),
  constraint auth_notification_outbox_state_markers check (((status = 'recorded' AND recorded_at IS NOT NULL AND claimed_at IS NULL AND sent_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL AND failure_reason IS NULL AND provider_message_id IS NULL) OR (status = 'claimed' AND recorded_at IS NOT NULL AND claimed_at IS NOT NULL AND lease_owner IS NOT NULL AND lease_until IS NOT NULL AND sent_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL AND failure_reason IS NULL AND provider_message_id IS NULL) OR (status = 'sent' AND recorded_at IS NOT NULL AND claimed_at IS NOT NULL AND sent_at IS NOT NULL AND failed_at IS NULL AND dead_lettered_at IS NULL AND failure_reason IS NULL AND provider_message_id IS NOT NULL AND lease_owner IS NULL AND lease_until IS NULL AND next_retry_at IS NULL) OR (status = 'failed' AND recorded_at IS NOT NULL AND claimed_at IS NOT NULL AND failed_at IS NOT NULL AND dead_lettered_at IS NULL AND failure_reason IS NOT NULL AND lease_owner IS NULL AND lease_until IS NULL AND next_retry_at IS NOT NULL) OR (status = 'dead_letter' AND recorded_at IS NOT NULL AND claimed_at IS NOT NULL AND dead_lettered_at IS NOT NULL AND failure_reason IS NOT NULL AND lease_owner IS NULL AND lease_until IS NULL AND next_retry_at IS NULL)))
);
create unique index if not exists "UQ_auth_notification_outbox_idempotency_key" on auth_notification_outbox(idempotency_key) where deleted_at is null;

create table if not exists operational_alert (
  id text primary key,
  type text not null,
  severity text not null,
  status text not null default 'open',
  entity_type text not null,
  entity_id text not null,
  message_code text not null,
  message text not null,
  error_code text,
  metadata jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  ignored_at timestamptz,
  ignored_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint "CK_operational_alert_type" check ("type" in ('payment_stuck', 'fulfillment_failed', 'auth_notification_failed')),
  constraint "CK_operational_alert_severity" check ("severity" in ('low', 'medium', 'high', 'critical')),
  constraint "CK_operational_alert_status" check ("status" in ('open', 'acknowledged', 'resolved', 'ignored')),
  constraint "CK_operational_alert_entity_type" check ("entity_type" in ('payment_attempt', 'fulfillment', 'auth_notification_outbox')),
  constraint "CK_operational_alert_entity_id" check (length(btrim("entity_id")) between 1 and 128),
  constraint "CK_operational_alert_occurrence_count" check ("occurrence_count" >= 1),
  constraint "UQ_operational_alert_logical_key" unique ("type", "entity_type", "entity_id")
);
`

function makeContext(client: PoolClient): CustomerAuthMutationContext {
  return {
    __type: "MedusaContext",
    transactionManager: {
      getTransactionContext: () => ({
        raw: (sql: string, bindings: unknown[] = []) => {
          let parameter = 0
          return client.query(
            sql.replace(/\?/g, () => `$${++parameter}`),
            bindings
          )
        },
      }),
    },
  }
}

function makeKnexLike(pool: Pool) {
  return {
    raw: (sql: string, bindings: unknown[] = []) => {
      let parameter = 0
      return pool.query(
        sql.replace(/\?/g, () => `$${++parameter}`),
        bindings
      )
    },
  }
}

function makeTxKnex(client: PoolClient) {
  return {
    raw: (sql: string, bindings: unknown[] = []) => {
      let parameter = 0
      return client.query(
        sql.replace(/\?/g, () => `$${++parameter}`),
        bindings
      )
    },
  }
}

function makeTestContainer(
  knex: { raw: (sql: string, bindings?: unknown[]) => Promise<any> },
  overrides: Record<string, unknown> = {}
) {
  const opAlertService = new OperationalAlertModuleService({
    baseRepository: {
      getActiveManager: () => ({
        getKnex: () => knex,
      }),
    },
  } as any)

  return {
    resolve(key: string) {
      if (overrides[key] !== undefined) {
        return overrides[key]
      }
      if (key === OPERATIONAL_ALERT_MODULE || key === "operational_alert") {
        return opAlertService
      }
      if (key === "__pg_connection__") {
        return knex
      }
      return undefined
    },
  } as any
}

if (!databaseUrl || !databaseName) {
  describe("Auth Notification Outbox Postgres Integration (P14-D10)", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(120_000)
  let pool: Pool
  const maintenanceUrl = new URL(databaseUrl)
  maintenanceUrl.pathname = "/postgres"

  async function createDisposableDatabase() {
    expect(databaseName).toMatch(/^p12_disposable_[a-z0-9_]+$/)
    const maintenance = new Client({
      connectionString: maintenanceUrl.toString(),
    })
    await maintenance.connect()
    try {
      await maintenance.query(`create database "${databaseName}"`)
    } finally {
      await maintenance.end()
    }
  }

  async function dropDisposableDatabase() {
    if (pool) {
      await pool.end()
    }
    const maintenance = new Client({
      connectionString: maintenanceUrl.toString(),
    })
    await maintenance.connect()
    try {
      await maintenance.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
        [databaseName]
      )
      await maintenance.query(`drop database if exists "${databaseName}"`)
    } finally {
      await maintenance.end()
    }
  }

  describe("Auth Notification Outbox Postgres Integration (P14-D10)", () => {
    const keyring = parseCustomerAuthCapabilityKeyring({
      enabled: true,
      activeVersion: "1",
      activeSecret: "01234567890123456789012345678901",
      previousKeys: JSON.stringify([
        { version: 2, secret: "abcdefabcdefabcdefabcdefabcdefab" },
      ]),
    })!

    beforeAll(async () => {
      await createDisposableDatabase()
      pool = new Pool({ connectionString: databaseUrl })
      await pool.query(schemaSql)
    })

    afterAll(async () => {
      await dropDisposableDatabase()
    })

    beforeEach(async () => {
      await pool.query(
        "truncate table auth_notification_outbox, auth_verification_intent, auth_reset_intent, operational_alert"
      )
    })

    describe("Transactional Outbox Record Primitive Atomicity (B14-09-HR-01)", () => {
      it("same-transaction commit: inserts intent and outbox atomically, both present after COMMIT", async () => {
        const client = await pool.connect()
        const intentId = "authver_atomic_commit_1"
        const outboxId = "authout_atomic_commit_1"
        const identityId = "ident_atomic_1"
        const now = new Date()

        try {
          await client.query("BEGIN")
          const txKnex = makeTxKnex(client)

          // 1. Insert intent in transaction
          await txKnex.raw(
            `insert into auth_verification_intent (
              id, auth_identity_id, token_hash, nonce, key_version, generation,
              status, version, expires_at, created_at
            ) values (
              ?, ?, 'hash_dummy', 'nonce_dummy', 1, 0,
              'pending', 1, ?, ?
            )`,
            [
              intentId,
              identityId,
              new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
              now.toISOString(),
            ]
          )

          // 2. Insert outbox record using transactional primitive
          const outboxRecord = await recordNotificationOutboxInTransaction(
            txKnex,
            {
              id: outboxId,
              template: "email_verification_v1",
              intentType: "verification",
              intentId,
              generation: 0,
              recipientIdentityId: identityId,
              recipientHash: "hash_recipient_atomic",
              recipientDomain: "loja.com.br",
              keyVersion: 1,
              recordedAt: now,
            }
          )

          expect(outboxRecord.id).toBe(outboxId)
          expect(outboxRecord.status).toBe("recorded")

          // 3. Commit transaction
          await client.query("COMMIT")
        } finally {
          client.release()
        }

        // Verify with independent connection on pool: both intent and outbox are present!
        const intentRow = await pool.query(
          "select * from auth_verification_intent where id = $1",
          [intentId]
        )
        expect(intentRow.rowCount).toBe(1)
        expect(intentRow.rows[0].id).toBe(intentId)

        const outboxRow = await pool.query(
          "select * from auth_notification_outbox where id = $1",
          [outboxId]
        )
        expect(outboxRow.rowCount).toBe(1)
        expect(outboxRow.rows[0].id).toBe(outboxId)
        expect(outboxRow.rows[0].status).toBe("recorded")
        expect(outboxRow.rows[0].version).toBe(1)
      })

      it("same-transaction rollback: rolls back intent and outbox atomically, neither present after ROLLBACK", async () => {
        const client = await pool.connect()
        const intentId = "authver_atomic_rollback_1"
        const outboxId = "authout_atomic_rollback_1"
        const identityId = "ident_atomic_2"
        const now = new Date()

        try {
          await client.query("BEGIN")
          const txKnex = makeTxKnex(client)

          // 1. Insert intent in transaction
          await txKnex.raw(
            `insert into auth_verification_intent (
              id, auth_identity_id, token_hash, nonce, key_version, generation,
              status, version, expires_at, created_at
            ) values (
              ?, ?, 'hash_dummy_2', 'nonce_dummy_2', 1, 0,
              'pending', 1, ?, ?
            )`,
            [
              intentId,
              identityId,
              new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
              now.toISOString(),
            ]
          )

          // 2. Insert outbox record using transactional primitive
          const outboxRecord = await recordNotificationOutboxInTransaction(
            txKnex,
            {
              id: outboxId,
              template: "email_verification_v1",
              intentType: "verification",
              intentId,
              generation: 0,
              recipientIdentityId: identityId,
              recipientHash: "hash_recipient_atomic_2",
              recipientDomain: "loja.com.br",
              keyVersion: 1,
              recordedAt: now,
            }
          )

          expect(outboxRecord.id).toBe(outboxId)

          // 3. Rollback transaction
          await client.query("ROLLBACK")
        } finally {
          client.release()
        }

        // Verify with independent connection on pool: neither intent nor outbox exist!
        const intentRow = await pool.query(
          "select * from auth_verification_intent where id = $1",
          [intentId]
        )
        expect(intentRow.rowCount).toBe(0)

        const outboxRow = await pool.query(
          "select * from auth_notification_outbox where id = $1",
          [outboxId]
        )
        expect(outboxRow.rowCount).toBe(0)
      })
    })

    describe("Cross-worker CAS claiming", () => {
      it("guarantees single claimant when workers claim sequentially or concurrently via CAS", async () => {
        const now = new Date()
        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            'authout_cas_1', 'email_verification_v1', 'verification', 'authver_cas_1', 0, 'auth/email_verification_v1/authver_cas_1/g0',
            'recorded', 'ident_cas_1', 'hash123', 'example.com', 1, 1, $1
          )`,
          [now.toISOString()]
        )

        // Worker A claims with version 1
        const clientA = await pool.connect()
        let resA: any
        try {
          await clientA.query("BEGIN")
          const serviceA = new CustomerAuthModuleService({} as any)
          resA = await serviceA.claimNotificationOutbox(
            "authout_cas_1",
            1,
            "worker_A",
            now,
            makeContext(clientA)
          )
          await clientA.query("COMMIT")
        } finally {
          clientA.release()
        }

        expect(resA.type).toBe("updated")
        expect(resA.version).toBe(2)

        // Worker B attempts to claim with version 1 (stale version)
        const clientB = await pool.connect()
        let resB: any
        try {
          await clientB.query("BEGIN")
          const serviceB = new CustomerAuthModuleService({} as any)
          resB = await serviceB.claimNotificationOutbox(
            "authout_cas_1",
            1, // expects version 1, but actual is 2
            "worker_B",
            now,
            makeContext(clientB)
          )
          await clientB.query("COMMIT")
        } finally {
          clientB.release()
        }

        expect(resB.type).toBe("stale")
        expect(resB.actualVersion).toBe(2)

        const row = await pool.query(
          "select * from auth_notification_outbox where id = 'authout_cas_1'"
        )
        expect(row.rows[0].status).toBe("claimed")
        expect(row.rows[0].lease_owner).toBe("worker_A")
        expect(row.rows[0].version).toBe(2)
      })

      it("atomic relay claim update is mutually exclusive between concurrent workers", async () => {
        const now = new Date()
        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            'authout_cas_2', 'email_verification_v1', 'verification', 'authver_cas_2', 0, 'auth/email_verification_v1/authver_cas_2/g0',
            'recorded', 'ident_cas_2', 'hash123', 'example.com', 1, 1, $1
          )`,
          [now.toISOString()]
        )

        const leaseUntil = new Date(now.getTime() + 120_000)

        // Run atomic claim queries concurrently
        const qA = pool.query(
          `update auth_notification_outbox
           set status = 'claimed',
               claimed_at = $1,
               lease_owner = 'worker_A',
               lease_until = $2,
               failed_at = null,
               failure_reason = null,
               next_retry_at = null,
               version = version + 1,
               updated_at = now()
           where id = 'authout_cas_2'
             and version = 1
             and status in ('recorded', 'failed')
             and deleted_at is null
           returning *`,
          [now.toISOString(), leaseUntil.toISOString()]
        )

        const qB = pool.query(
          `update auth_notification_outbox
           set status = 'claimed',
               claimed_at = $1,
               lease_owner = 'worker_B',
               lease_until = $2,
               failed_at = null,
               failure_reason = null,
               next_retry_at = null,
               version = version + 1,
               updated_at = now()
           where id = 'authout_cas_2'
             and version = 1
             and status in ('recorded', 'failed')
             and deleted_at is null
           returning *`,
          [now.toISOString(), leaseUntil.toISOString()]
        )

        const [resA, resB] = await Promise.all([qA, qB])

        const totalClaimed = resA.rowCount + resB.rowCount
        expect(totalClaimed).toBe(1)
      })
    })

    describe("End-to-End Relay Delivery and In-Memory Capability Rederivation", () => {
      it("rederives capability in memory, verifies recipient hash, calls provider with stable idempotency key, and records sent", async () => {
        const email = "usuario.verificacao@dominio.com.br"
        const normalizedEmail = normalizeCustomerAuthEmail(email)
        const nonce = generateCustomerAuthCapabilityNonce()
        const identityId = "ident_user_100"
        const intentId = "authver_intent_100"

        const derivedCap = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail,
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const now = new Date()

        // Insert intent
        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derivedCap.material.hash,
            derivedCap.material.nonce,
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            now.toISOString(),
          ]
        )

        // Insert outbox
        const outboxId = "authout_test_100"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'recorded', $4, $5, 'dominio.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            now.toISOString(),
          ]
        )

        const providerCalls: Array<{
          payload: Record<string, unknown>
          idempotencyKey: string
        }> = []

        const mockClient: ResendAuthRelayClient = {
          async send(payload, options) {
            providerCalls.push({
              payload,
              idempotencyKey: options.idempotencyKey,
            })
            return { providerMessageId: "resend_msg_success_100" }
          },
        }

        const knex = makeKnexLike(pool)

        const result = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_mock_key",
            fromEmail: "noreply@ecommerce.com.br",
            storefrontUrl: "https://minhaloja.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async (id) => {
            if (id === identityId) return email
            return null
          },
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(1)
        expect(result.failed).toBe(0)
        expect(result.dead_lettered).toBe(0)

        // Verify provider was called
        expect(providerCalls.length).toBe(1)
        expect(providerCalls[0].idempotencyKey).toBe(idempotencyKey)
        expect(providerCalls[0].payload.to).toBe(normalizedEmail)
        expect(providerCalls[0].payload.html).toContain(
          encodeURIComponent(derivedCap.capability)
        )

        // Verify database outbox record
        const outboxRow = await pool.query(
          "select * from auth_notification_outbox where id = $1",
          [outboxId]
        )
        const record = outboxRow.rows[0]
        expect(record.status).toBe("sent")
        expect(record.sent_at).not.toBeNull()
        expect(record.provider_message_id).toBe("resend_msg_success_100")
        expect(record.lease_owner).toBeNull()
        expect(record.lease_until).toBeNull()
        expect(record.version).toBe(3)

        // Security Invariant: capability is not stored anywhere in DB
        const dbDump = JSON.stringify(record)
        expect(dbDump).not.toContain(derivedCap.capability)
        expect(dbDump).not.toContain(email) // Plaintext email not stored in outbox table
      })
    })

    describe("Sanctioned Recipient Boundary Fail-Closed and Operational Alerts (B14-09-HR-02 & B14-09-HR-04)", () => {
      it("dead-letters immediately with recipient_missing and creates sanitized operational alert when identity is missing, without calling provider", async () => {
        const now = new Date()
        const outboxId = "authout_missing_1"
        const intentId = "authver_missing_1"
        const idempotencyKey =
          "auth/email_verification_v1/authver_missing_1/g0"

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 0, $3,
            'recorded', 'ident_non_existent', 'dummyhash123456789012345678901234', 'example.com', 1, 1, $4
          )`,
          [outboxId, intentId, idempotencyKey, now.toISOString()]
        )

        let providerCalled = false
        const mockClient: ResendAuthRelayClient = {
          async send() {
            providerCalled = true
            return { providerMessageId: "msg_1" }
          },
        }

        const knex = makeKnexLike(pool)
        const container = makeTestContainer(knex)
        const result = await runAuthNotificationRelay({
          container,
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => null, // Identity missing
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(0)
        expect(result.dead_lettered).toBe(1)
        expect(providerCalled).toBe(false)

        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("dead_letter")
        expect(row.failure_reason).toBe("recipient_missing")
        expect(row.dead_lettered_at).not.toBeNull()
        expect(row.next_retry_at).toBeNull()

        // Verify sanitized operational alert created in database
        const alertRows = (
          await pool.query(
            "select * from operational_alert where entity_id = $1",
            [outboxId]
          )
        ).rows
        expect(alertRows.length).toBe(1)
        const alert = alertRows[0]
        expect(alert.type).toBe("auth_notification_failed")
        expect(alert.entity_type).toBe("auth_notification_outbox")
        expect(alert.message_code).toBe("RECIPIENT_MISSING")
        expect(alert.metadata).toMatchObject({
          outbox_id: outboxId,
          intent_id: intentId,
          recipient_identity_id: "ident_non_existent",
          failure_reason: "recipient_missing",
          detector_code: "RECIPIENT_MISSING",
        })

        // Verify ZERO PII in alert
        const alertDump = JSON.stringify(alert)
        expect(alertDump).not.toContain("@")
        expect(alertDump).not.toContain("token")
        expect(alertDump).not.toContain("secret")
      })

      it("dead-letters immediately with recipient_mismatch and creates sanitized operational alert when identity email hash does not match, without calling provider", async () => {
        const now = new Date()
        const outboxId = "authout_mismatch_1"
        const intentId = "authver_mismatch_1"
        const identityId = "ident_mismatch_1"
        const idempotencyKey =
          "auth/email_verification_v1/authver_mismatch_1/g0"

        // Hash was computed for original email
        const originalHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: "original@loja.com.br",
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 0, $3,
            'recorded', $4, $5, 'loja.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            originalHash,
            now.toISOString(),
          ]
        )

        let providerCalled = false
        const mockClient: ResendAuthRelayClient = {
          async send() {
            providerCalled = true
            return { providerMessageId: "msg_1" }
          },
        }

        const knex = makeKnexLike(pool)
        const container = makeTestContainer(knex)
        const result = await runAuthNotificationRelay({
          container,
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          // Identity has changed email to attacker / new email:
          resolveEmailByIdentityId: async () => "changed.email@loja.com.br",
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(0)
        expect(result.dead_lettered).toBe(1)
        expect(providerCalled).toBe(false)

        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("dead_letter")
        expect(row.failure_reason).toBe("recipient_mismatch")
        expect(row.dead_lettered_at).not.toBeNull()

        // Verify operational alert created
        const alertRows = (
          await pool.query(
            "select * from operational_alert where entity_id = $1",
            [outboxId]
          )
        ).rows
        expect(alertRows.length).toBe(1)
        expect(alertRows[0].type).toBe("auth_notification_failed")
        expect(alertRows[0].entity_type).toBe("auth_notification_outbox")
        expect(alertRows[0].message_code).toBe("RECIPIENT_MISMATCH")
        expect(alertRows[0].metadata).toMatchObject({
          outbox_id: outboxId,
          intent_id: intentId,
          recipient_identity_id: identityId,
          failure_reason: "recipient_mismatch",
          detector_code: "RECIPIENT_MISMATCH",
        })

        // Verify ZERO PII
        const alertDump = JSON.stringify(alertRows[0])
        expect(alertDump).not.toContain("changed.email@loja.com.br")
        expect(alertDump).not.toContain("original@loja.com.br")
      })

      it("dead-letters immediately with recipient_mismatch when identity sources are ambiguous (>1 distinct emails)", async () => {
        const now = new Date()
        const outboxId = "authout_ambiguous_1"
        const intentId = "authver_ambiguous_1"
        const identityId = "ident_ambiguous_1"
        const idempotencyKey =
          "auth/email_verification_v1/authver_ambiguous_1/g0"

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: "person@example.com",
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 0, $3,
            'recorded', $4, $5, 'example.com', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            now.toISOString(),
          ]
        )

        let providerCalled = false
        const mockClient: ResendAuthRelayClient = {
          async send() {
            providerCalled = true
            return { providerMessageId: "msg_1" }
          },
        }

        const knex = makeKnexLike(pool)
        const result = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          // Ambiguous: provider identity has person@example.com, customer has other@example.com
          resolveEmailByIdentityId: async () => ({
            providerEmail: "person@example.com",
            customerEmail: "other@example.com",
          }),
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(0)
        expect(result.dead_lettered).toBe(1)
        expect(providerCalled).toBe(false)

        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("dead_letter")
        expect(row.failure_reason).toBe("recipient_mismatch")
      })
    })

    describe("Operational Alert Migration20260814030000 Real Execution (B14-09-HR-02)", () => {
      const collectMigrationSql = async (method: "up" | "down") => {
        const statements: string[] = []
        const migrationMethod = Migration20260814030000.prototype[
          method
        ] as unknown as (this: {
          addSql: (sql: string) => void
        }) => Promise<void>
        await migrationMethod.call({
          addSql: (sql: string) => statements.push(sql),
        })
        return statements
      }

      it("executes real Migration20260814030000 up() and down() against PostgreSQL and proves constraint transitions", async () => {
        // A. Set up schema with OLD constraints (Migration20260720000100 baseline)
        await pool.query(`
          alter table operational_alert
            drop constraint if exists "CK_operational_alert_type",
            add constraint "CK_operational_alert_type"
              check ("type" in ('payment_stuck', 'fulfillment_failed'));
        `)
        await pool.query(`
          alter table operational_alert
            drop constraint if exists "CK_operational_alert_entity_type",
            add constraint "CK_operational_alert_entity_type"
              check ("entity_type" in ('payment_attempt', 'fulfillment'));
        `)

        const now = new Date()

        // 1. Under old constraints: payment_stuck / fulfillment_failed are accepted
        await pool.query(
          `insert into operational_alert (
            id, type, severity, status, entity_type, entity_id,
            message_code, message, occurrence_count, first_seen_at, last_seen_at
          ) values (
            'opalert_mig_pre_1', 'payment_stuck', 'high', 'open', 'payment_attempt', 'payatt_mig_1',
            'PAYMENT_STUCK_TEST', 'Test old schema', 1, $1, $1
          )`,
          [now.toISOString()]
        )

        // 2. Under old constraints: auth_notification_failed is REJECTED
        await expect(
          pool.query(
            `insert into operational_alert (
              id, type, severity, status, entity_type, entity_id,
              message_code, message, occurrence_count, first_seen_at, last_seen_at
            ) values (
              'opalert_mig_pre_fail_1', 'auth_notification_failed', 'high', 'open', 'payment_attempt', 'authout_mig_fail',
              'AUTH_FAIL_TEST', 'Test reject', 1, $1, $1
            )`,
            [now.toISOString()]
          )
        ).rejects.toThrow()

        // 3. Under old constraints: auth_notification_outbox is REJECTED
        await expect(
          pool.query(
            `insert into operational_alert (
              id, type, severity, status, entity_type, entity_id,
              message_code, message, occurrence_count, first_seen_at, last_seen_at
            ) values (
              'opalert_mig_pre_fail_2', 'payment_stuck', 'high', 'open', 'auth_notification_outbox', 'authout_mig_fail',
              'AUTH_FAIL_TEST', 'Test reject', 1, $1, $1
            )`,
            [now.toISOString()]
          )
        ).rejects.toThrow()

        // B. Execute Migration20260814030000.up()
        const upSqlStatements = await collectMigrationSql("up")
        expect(upSqlStatements.length).toBeGreaterThan(0)
        for (const stmt of upSqlStatements) {
          await pool.query(stmt)
        }

        // C. Proveis after up():
        // 1. payment_stuck / fulfillment_failed remain valid
        await pool.query(
          `insert into operational_alert (
            id, type, severity, status, entity_type, entity_id,
            message_code, message, occurrence_count, first_seen_at, last_seen_at
          ) values (
            'opalert_mig_post_1', 'fulfillment_failed', 'high', 'open', 'fulfillment', 'ful_mig_1',
            'FULFILLMENT_TEST', 'Test post-up', 1, $1, $1
          )`,
          [now.toISOString()]
        )

        // 2. auth_notification_failed and auth_notification_outbox are now accepted!
        await pool.query(
          `insert into operational_alert (
            id, type, severity, status, entity_type, entity_id,
            message_code, message, occurrence_count, first_seen_at, last_seen_at
          ) values (
            'opalert_mig_post_2', 'auth_notification_failed', 'high', 'open', 'auth_notification_outbox', 'authout_mig_post_2',
            'AUTH_NOTIFICATION_FAILED', 'Test post-up auth', 1, $1, $1
          )`,
          [now.toISOString()]
        )

        // 3. invalid values continue to be rejected
        await expect(
          pool.query(
            `insert into operational_alert (
              id, type, severity, status, entity_type, entity_id,
              message_code, message, occurrence_count, first_seen_at, last_seen_at
            ) values (
              'opalert_mig_invalid', 'invalid_type', 'high', 'open', 'auth_notification_outbox', 'authout_mig_bad',
              'BAD_TYPE', 'Invalid', 1, $1, $1
            )`,
            [now.toISOString()]
          )
        ).rejects.toThrow()

        await expect(
          pool.query(
            `insert into operational_alert (
              id, type, severity, status, entity_type, entity_id,
              message_code, message, occurrence_count, first_seen_at, last_seen_at
            ) values (
              'opalert_mig_invalid_2', 'auth_notification_failed', 'high', 'open', 'invalid_entity', 'authout_mig_bad',
              'BAD_ENTITY', 'Invalid', 1, $1, $1
            )`,
            [now.toISOString()]
          )
        ).rejects.toThrow()

        // Clean auth rows before down()
        await pool.query(
          "delete from operational_alert where type = 'auth_notification_failed' or entity_type = 'auth_notification_outbox'"
        )

        // D. Execute Migration20260814030000.down()
        const downSqlStatements = await collectMigrationSql("down")
        expect(downSqlStatements.length).toBeGreaterThan(0)
        for (const stmt of downSqlStatements) {
          await pool.query(stmt)
        }

        // Prove down(): auth values are rejected again
        await expect(
          pool.query(
            `insert into operational_alert (
              id, type, severity, status, entity_type, entity_id,
              message_code, message, occurrence_count, first_seen_at, last_seen_at
            ) values (
              'opalert_mig_post_down', 'auth_notification_failed', 'high', 'open', 'auth_notification_outbox', 'authout_down',
              'AUTH_FAIL_TEST', 'Test reject after down', 1, $1, $1
            )`,
            [now.toISOString()]
          )
        ).rejects.toThrow()

        // Reapply up() for rest of test suite
        for (const stmt of upSqlStatements) {
          await pool.query(stmt)
        }
      })
    })

    describe("Operational Alert Canonical Service Deduplication and Allowlisted Metadata (B14-09-HR-02)", () => {
      it("upserts canonical alert for auth_notification_outbox with logical key deduplication and metadata allowlisting", async () => {
        const knex = makeKnexLike(pool)
        const opAlertService = new OperationalAlertModuleService({
          baseRepository: {
            getActiveManager: () => ({
              getKnex: () => knex,
            }),
          },
        } as any)

        const outboxId = "authout_dedup_test_1"
        const time1 = new Date("2026-08-14T03:00:00.000Z")
        const time2 = new Date("2026-08-14T03:05:00.000Z")

        // First occurrence
        const alert1 = await opAlertService.upsertAlert({
          type: "auth_notification_failed",
          severity: "high",
          entity_type: "auth_notification_outbox",
          entity_id: outboxId,
          message_code: "RECIPIENT_MISSING",
          message: "Auth notification recipient validation failed: RECIPIENT_MISSING",
          error_code: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
          metadata: {
            outbox_id: outboxId,
            intent_id: "authver_dedup_1",
            recipient_identity_id: "ident_dedup_1",
            template: "email_verification_v1",
            generation: 0,
            attempt_count: 1,
            failure_reason: "recipient_missing",
            detector_code: "RECIPIENT_MISSING",
            // Attempt to inject non-allowlisted key:
            forbidden_key: "should_be_stripped",
          },
          observed_at: time1,
        })

        expect(alert1.id).toMatch(/^opalert_/)
        expect(alert1.type).toBe("auth_notification_failed")
        expect(alert1.entity_type).toBe("auth_notification_outbox")
        expect(alert1.entity_id).toBe(outboxId)
        expect(alert1.occurrence_count).toBe(1)
        expect(alert1.first_seen_at).toBe(time1.toISOString())
        expect(alert1.last_seen_at).toBe(time1.toISOString())
        expect(alert1.metadata).toMatchObject({
          outbox_id: outboxId,
          intent_id: "authver_dedup_1",
          recipient_identity_id: "ident_dedup_1",
          template: "email_verification_v1",
          generation: 0,
          attempt_count: 1,
          failure_reason: "recipient_missing",
          detector_code: "RECIPIENT_MISSING",
        })
        expect(alert1.metadata).not.toHaveProperty("forbidden_key")

        // Second occurrence for same logical key: (type, entity_type, entity_id)
        const alert2 = await opAlertService.upsertAlert({
          type: "auth_notification_failed",
          severity: "critical", // escalate severity
          entity_type: "auth_notification_outbox",
          entity_id: outboxId,
          message_code: "RECIPIENT_MISSING",
          message: "Auth notification recipient validation failed again",
          error_code: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
          metadata: {
            outbox_id: outboxId,
            intent_id: "authver_dedup_1",
            recipient_identity_id: "ident_dedup_1",
            attempt_count: 2,
            failure_reason: "recipient_missing",
            detector_code: "RECIPIENT_MISSING",
          },
          observed_at: time2,
        })

        expect(alert2.id).toBe(alert1.id) // Same ID (deduplicated)
        expect(alert2.occurrence_count).toBe(2) // Incremented
        expect(alert2.severity).toBe("critical") // Escalated
        expect(alert2.first_seen_at).toBe(time1.toISOString()) // Preserved
        expect(alert2.last_seen_at).toBe(time2.toISOString()) // Updated

        // Verify only 1 row exists in Postgres database
        const rows = await pool.query(
          "select * from operational_alert where entity_id = $1",
          [outboxId]
        )
        expect(rows.rowCount).toBe(1)
      })
    })

    describe("Operational Alert Creation Failure Observability in Postgres (B14-09-HR-02)", () => {
      it("logs OPERATIONAL_ALERT_CREATION_FAILED and completes dead_letter without throwing when alert module fails", async () => {
        const loggedWarnings: Array<{ code: string; meta: Record<string, unknown> }> = []
        const mockLogger = {
          warn: (code: string, meta: Record<string, unknown>) => {
            loggedWarnings.push({ code, meta })
          },
        }

        const outboxId = "authout_pg_alert_fail_1"
        const intentId = "authver_pg_alert_fail_1"
        const identityId = "ident_pg_alert_fail_1"
        const now = new Date()

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 0, $3,
            'recorded', $4, 'dummy_hash', 'loja.com.br', 1, 1, $5
          )`,
          [
            outboxId,
            intentId,
            `auth/email_verification_v1/${intentId}/g0`,
            identityId,
            now.toISOString(),
          ]
        )

        const mockContainerWithoutAlert = {
          resolve(key: string) {
            if (key === "operational_alert") {
              throw new Error("Module operational_alert not registered")
            }
            if (key === "__pg_connection__") {
              return makeKnexLike(pool)
            }
            return undefined
          },
        } as any

        let providerCalled = false
        const mockClient: ResendAuthRelayClient = {
          async send() {
            providerCalled = true
            return { providerMessageId: "msg_1" }
          },
        }

        const knex = makeKnexLike(pool)
        const result = await runAuthNotificationRelay({
          container: mockContainerWithoutAlert,
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => null, // missing -> triggers alert dispatch
          logger: mockLogger,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(0)
        expect(result.dead_lettered).toBe(1)
        expect(providerCalled).toBe(false)

        // 1. Dead letter status was committed in database
        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("dead_letter")
        expect(row.failure_reason).toBe("recipient_missing")

        // 2. Alert creation failure was logged observably with sanitized metadata
        const alertFailLog = loggedWarnings.find(
          (l) => l.code === "OPERATIONAL_ALERT_CREATION_FAILED"
        )
        expect(alertFailLog).toBeDefined()
        expect(alertFailLog?.meta).toMatchObject({
          outbox_id: outboxId,
          intent_id: intentId,
          recipient_identity_id: identityId,
        })
      })
    })

    describe("Key Rotation Multi-Version Delivery (B14-09-HR-05)", () => {
      it("proves delivery with previous key version when active key has rotated", async () => {
        // Keyring where active is v2, and previous is v1
        const rotatedKeyring = parseCustomerAuthCapabilityKeyring({
          enabled: true,
          activeVersion: "2",
          activeSecret: "secret_version_2_active_key_1234",
          previousKeys: JSON.stringify([
            { version: 1, secret: "01234567890123456789012345678901" },
          ]),
        })!

        const email = "rotated.key.user@loja.com.br"
        const normalizedEmail = normalizeCustomerAuthEmail(email)
        const nonce = generateCustomerAuthCapabilityNonce()
        const identityId = "ident_rotated_1"
        const intentId = "authver_rotated_1"

        // Intent was created under key_version = 1
        const derivedWithV1 = deriveCustomerAuthCapability({
          keyring: rotatedKeyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHashV1 = deriveCustomerAuthRecipientHash({
          keyring: rotatedKeyring,
          purpose: "verification",
          normalizedEmail,
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const now = new Date()

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derivedWithV1.material.hash,
            derivedWithV1.material.nonce,
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            now.toISOString(),
          ]
        )

        const outboxId = "authout_rotated_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'recorded', $4, $5, 'loja.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHashV1,
            now.toISOString(),
          ]
        )

        const sentPayloads: Array<{ payload: Record<string, unknown>; idempotencyKey: string }> = []
        const mockClient: ResendAuthRelayClient = {
          async send(payload, options) {
            sentPayloads.push({ payload, idempotencyKey: options.idempotencyKey })
            return { providerMessageId: "resend_msg_rotated_key" }
          },
        }

        const knex = makeKnexLike(pool)
        const result = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring: rotatedKeyring,
          resolveEmailByIdentityId: async () => email,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(1)
        expect(sentPayloads.length).toBe(1)

        // Verify the payload contains the capability derived with key_version = 1
        expect(sentPayloads[0].payload.html).toContain(
          encodeURIComponent(derivedWithV1.capability)
        )

        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("sent")
        expect(row.provider_message_id).toBe("resend_msg_rotated_key")
      })

      it("dead-letters with recipient_mismatch and creates sanitized operational alert when required key version is missing from keyring", async () => {
        const now = new Date()
        const outboxId = "authout_missing_key_v99"
        const intentId = "authver_missing_key_v99"
        const identityId = "ident_key_v99"
        const idempotencyKey = `auth/email_verification_v1/${intentId}/g0`

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 0, $3,
            'recorded', $4, 'hash_for_v99', 'loja.com.br', 99, 1, $5
          )`,
          [outboxId, intentId, idempotencyKey, identityId, now.toISOString()]
        )

        let providerCalled = false
        const mockClient: ResendAuthRelayClient = {
          async send() {
            providerCalled = true
            return { providerMessageId: "msg_never" }
          },
        }

        const knex = makeKnexLike(pool)
        const container = makeTestContainer(knex)

        const result = await runAuthNotificationRelay({
          container,
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring, // keyring only has v1 and v2, not v99!
          resolveEmailByIdentityId: async () => "user@loja.com.br",
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(0)
        expect(result.dead_lettered).toBe(1)
        expect(providerCalled).toBe(false)

        const row = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("dead_letter")
        expect(row.failure_reason).toBe("recipient_mismatch")
        expect(row.dead_lettered_at).not.toBeNull()

        // Verify operational alert created
        const alertRows = (
          await pool.query(
            "select * from operational_alert where entity_id = $1",
            [outboxId]
          )
        ).rows
        expect(alertRows.length).toBe(1)
        expect(alertRows[0].type).toBe("auth_notification_failed")
        expect(alertRows[0].entity_type).toBe("auth_notification_outbox")
        expect(alertRows[0].message_code).toBe("RECIPIENT_MISMATCH")
        expect(alertRows[0].metadata).toMatchObject({
          outbox_id: outboxId,
          intent_id: intentId,
          recipient_identity_id: identityId,
          failure_reason: "recipient_mismatch",
          detector_code: "RECIPIENT_MISMATCH",
        })
      })
    })

    describe("Worker Restart and Crash Recovery (B14-09-HR-05)", () => {
      it("recovers from worker crash via reconciler and converges without capability persisted", async () => {
        const email = "restart.user@loja.com.br"
        const identityId = "ident_restart_1"
        const intentId = "authver_restart_1"
        const nonce = generateCustomerAuthCapabilityNonce()

        const derived = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: normalizeCustomerAuthEmail(email),
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const baseTime = new Date("2026-08-14T04:00:00.000Z")

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derived.material.hash,
            derived.material.nonce,
            new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString(),
            baseTime.toISOString(),
          ]
        )

        const outboxId = "authout_restart_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        // 1. Worker A claims item, then crashes (leaving record in claimed with expired lease)
        const leaseUntil = new Date(baseTime.getTime() + 2 * 60 * 1000)
        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at, claimed_at, lease_owner, lease_until
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'claimed', $4, $5, 'loja.com.br', 1, 2, $6, $6, 'worker_A_crashed', $7
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            baseTime.toISOString(),
            leaseUntil.toISOString(),
          ]
        )

        const knex = makeKnexLike(pool)

        // 2. Reconciler runs at baseTime + 3m (lease expired)
        const reconcileTime = new Date(baseTime.getTime() + 3 * 60 * 1000)
        const recResult = await runAuthNotificationReconcile({
          knex,
          now: () => reconcileTime,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(recResult.processed).toBe(1)
        expect(recResult.reclaimed).toBe(1)

        const reclaimedRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(reclaimedRow.status).toBe("failed")
        expect(reclaimedRow.attempt_count).toBe(1)
        expect(reclaimedRow.version).toBe(3)
        expect(reclaimedRow.lease_owner).toBeNull()

        // 3. Worker B starts fresh after retry window (+1m after reconcile)
        const retryTime = new Date(reconcileTime.getTime() + 70_000)
        const providerCalls: Array<{ idempotencyKey: string }> = []
        const mockClient: ResendAuthRelayClient = {
          async send(_payload, options) {
            providerCalls.push({ idempotencyKey: options.idempotencyKey })
            return { providerMessageId: "msg_worker_B_recovered" }
          },
        }

        const relayResult = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          workerId: "worker_B",
          now: () => retryTime,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(relayResult.processed).toBe(1)
        expect(relayResult.sent).toBe(1)
        expect(providerCalls.length).toBe(1)
        expect(providerCalls[0].idempotencyKey).toBe(idempotencyKey) // Reuses exact same idempotency key

        const finalRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(finalRow.status).toBe("sent")
        expect(finalRow.provider_message_id).toBe("msg_worker_B_recovered")

        // Security check: capability was never stored in the database
        expect(JSON.stringify(finalRow)).not.toContain(derived.capability)
      })
    })

    describe("Ambiguous Provider Outcome and Retries (B14-09-HR-05)", () => {
      it("handles timeout/5xx transient failures, retains auth intent business state, and converges with identical idempotency key", async () => {
        const email = "ambiguous.outcome@loja.com.br"
        const identityId = "ident_ambig_outcome_1"
        const intentId = "authver_ambig_outcome_1"
        const nonce = generateCustomerAuthCapabilityNonce()

        const derived = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: normalizeCustomerAuthEmail(email),
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const baseTime = new Date("2026-08-14T05:00:00.000Z")

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derived.material.hash,
            derived.material.nonce,
            new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString(),
            baseTime.toISOString(),
          ]
        )

        const outboxId = "authout_ambig_outcome_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'recorded', $4, $5, 'loja.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            baseTime.toISOString(),
          ]
        )

        let attempt = 0
        const receivedIdempotencyKeys: string[] = []
        const mockClient: ResendAuthRelayClient = {
          async send(_payload, options) {
            attempt += 1
            receivedIdempotencyKeys.push(options.idempotencyKey)
            if (attempt === 1) {
              // Simulate timeout / network drop after sending
              throw new Error("ETIMEDOUT: Connection timed out")
            }
            return { providerMessageId: "resend_msg_retry_converged" }
          },
        }

        const knex = makeKnexLike(pool)

        // Attempt 1: fails with timeout
        const run1 = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          now: () => baseTime,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(run1.processed).toBe(1)
        expect(run1.sent).toBe(0)
        expect(run1.failed).toBe(1)

        // Verify intent business state is unchanged
        const intentRow = (
          await pool.query(
            "select * from auth_verification_intent where id = $1",
            [intentId]
          )
        ).rows[0]
        expect(intentRow.status).toBe("pending") // Unchanged!

        // Advance clock past retry window (+70s)
        const retryTime = new Date(baseTime.getTime() + 70_000)
        const run2 = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          now: () => retryTime,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(run2.processed).toBe(1)
        expect(run2.sent).toBe(1)

        // Verify both attempts used the exact same idempotency key
        expect(receivedIdempotencyKeys).toEqual([idempotencyKey, idempotencyKey])

        const finalRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(finalRow.status).toBe("sent")
        expect(finalRow.provider_message_id).toBe("resend_msg_retry_converged")
      })
    })

    describe("Terminal Intent Reconciliation and Stale Worker CAS Protection (B14-09-HR-06)", () => {
      it.each(["confirmed", "completed", "superseded", "expired"])(
        "transitions outbox to dead_letter with CAS version increment when intent is %s and prevents stale worker operations",
        async (terminalStatus) => {
          const now = new Date("2026-08-14T06:00:00.000Z")
          const intentId = `authver_term_${terminalStatus}`
          const outboxId = `authout_term_${terminalStatus}`

          await pool.query(
            `insert into auth_verification_intent (
              id, auth_identity_id, token_hash, nonce, key_version, generation,
              status, version, expires_at, created_at
            ) values (
              $1, 'ident_term', 'hash', 'nonce', 1, 0, $2, 1, $3, $4
            )`,
            [
              intentId,
              terminalStatus,
              new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
              now.toISOString(),
            ]
          )

          // Outbox claimed with expired lease at version 2
          await pool.query(
            `insert into auth_notification_outbox (
              id, template, intent_type, intent_id, generation, idempotency_key,
              status, recipient_identity_id, recipient_hash, recipient_domain,
              key_version, version, recorded_at, claimed_at, lease_owner, lease_until
            ) values (
              $1, 'email_verification_v1', 'verification', $2, 0, $3,
              'claimed', 'ident_term', 'hash', 'loja.com.br', 1, 2, $4, $4, 'stale_worker', $5
            )`,
            [
              outboxId,
              intentId,
              `auth/email_verification_v1/${intentId}/g0`,
              new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
              new Date(now.getTime() - 5 * 60 * 1000).toISOString(), // Expired
            ]
          )

          const knex = makeKnexLike(pool)
          const result = await runAuthNotificationReconcile({
            knex,
            now: () => now,
            isWorker: () => true,
            isReleaseMigration: () => false,
          })

          expect(result.processed).toBe(1)
          expect(result.skipped_terminal).toBe(1)

          const row = (
            await pool.query(
              "select * from auth_notification_outbox where id = $1",
              [outboxId]
            )
          ).rows[0]

          // 1. Never left in claimed: transitioned explicitly to dead_letter
          expect(row.status).toBe("dead_letter")
          expect(row.lease_owner).toBeNull()
          expect(row.lease_until).toBeNull()

          // 2. Version incremented from 2 to 3
          expect(row.version).toBe(3)

          // 3. Stale worker trying to mutate with version 2 is rejected by CAS
          const staleMutation = await pool.query(
            `update auth_notification_outbox
             set status = 'sent', sent_at = now()
             where id = $1 and version = 2 and status = 'claimed'`,
            [outboxId]
          )
          expect(staleMutation.rowCount).toBe(0) // CAS protection confirmed!

          // 4. Outbox never returns to relay
          const candidateQuery = await pool.query(
            `select * from auth_notification_outbox
             where status in ('recorded', 'failed')
               and id = $1`,
            [outboxId]
          )
          expect(candidateQuery.rowCount).toBe(0)
        }
      )
    })

    describe("Negative proof against native event bus capability transport (B14-09-HR-03)", () => {
      it("materially verifies that capability derivation and delivery is isolated from EventBus", async () => {
        const emittedEvents: Array<{ name: string; data: unknown }> = []

        const spyEventBus = {
          emit: jest.fn(async (name: string, data: unknown) => {
            emittedEvents.push({ name, data })
          }),
        }

        const email = "negative.proof@loja.com.br"
        const identityId = "ident_neg_1"
        const intentId = "authver_neg_1"
        const nonce = generateCustomerAuthCapabilityNonce()

        const derived = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: normalizeCustomerAuthEmail(email),
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const now = new Date()

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derived.material.hash,
            derived.material.nonce,
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            now.toISOString(),
          ]
        )

        const outboxId = "authout_neg_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'recorded', $4, $5, 'loja.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            now.toISOString(),
          ]
        )

        let providerReceived = false
        const mockClient: ResendAuthRelayClient = {
          async send(payload) {
            providerReceived = true
            expect(payload.html).toContain(encodeURIComponent(derived.capability))
            return { providerMessageId: "provider_neg_msg" }
          },
        }

        const knex = makeKnexLike(pool)
        const container = makeTestContainer(knex, {
          event_bus: spyEventBus,
          eventBusService: spyEventBus,
        })

        const result = await runAuthNotificationRelay({
          container,
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(1)
        expect(providerReceived).toBe(true)

        // 1. Material verification: EventBus was connected and received exactly 0 calls
        expect(spyEventBus.emit).toHaveBeenCalledTimes(0)
        expect(emittedEvents.length).toBe(0)

        // 2. Material verification: No capability present anywhere in Postgres database
        const outboxRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        const intentRow = (
          await pool.query(
            "select * from auth_verification_intent where id = $1",
            [intentId]
          )
        ).rows[0]

        expect(JSON.stringify(outboxRow)).not.toContain(derived.capability)
        expect(JSON.stringify(intentRow)).not.toContain(derived.capability)
        // 3. Material verification: Plaintext email is NOT stored in outbox table
        expect(JSON.stringify(outboxRow)).not.toContain(email)
      })

      it("pure decoupled runtime proof: relay delivers capability end-to-end without Event Bus or container resolution", async () => {
        const email = "decoupled.runtime@loja.com.br"
        const identityId = "ident_dec_1"
        const intentId = "authver_dec_1"
        const nonce = generateCustomerAuthCapabilityNonce()

        const derived = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })

        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: normalizeCustomerAuthEmail(email),
          recipientIdentityId: identityId,
          keyVersion: 1,
        })

        const now = new Date()

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derived.material.hash,
            derived.material.nonce,
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            now.toISOString(),
          ]
        )

        const outboxId = "authout_dec_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, recorded_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'recorded', $4, $5, 'loja.com.br', 1, 1, $6
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            now.toISOString(),
          ]
        )

        let providerReceived = false
        const mockClient: ResendAuthRelayClient = {
          async send(payload, options) {
            providerReceived = true
            expect(options.idempotencyKey).toBe(idempotencyKey)
            expect(payload.html).toContain(encodeURIComponent(derived.capability))
            return { providerMessageId: "provider_dec_msg" }
          },
        }

        const knex = makeKnexLike(pool)

        // Absolutely NO container, NO event_bus passed:
        const result = await runAuthNotificationRelay({
          knex,
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(1)
        expect(providerReceived).toBe(true)

        const outboxRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(outboxRow.status).toBe("sent")
        expect(outboxRow.provider_message_id).toBe("provider_dec_msg")
        expect(JSON.stringify(outboxRow)).not.toContain(derived.capability)
      })
    })

    describe("Failed outbox retry claim state markers", () => {
      it("claims a due failed row with a claimed-compatible shape, retries the provider, and preserves attempt_count", async () => {
        const email = "retry.markers@loja.com.br"
        const identityId = "ident_retry_markers_1"
        const intentId = "authver_retry_markers_1"
        const nonce = generateCustomerAuthCapabilityNonce()
        const derived = deriveCustomerAuthCapability({
          keyring,
          purpose: "verification",
          intentId,
          generation: 1,
          nonce,
          keyVersion: 1,
        })
        const recipientHash = deriveCustomerAuthRecipientHash({
          keyring,
          purpose: "verification",
          normalizedEmail: normalizeCustomerAuthEmail(email),
          recipientIdentityId: identityId,
          keyVersion: 1,
        })
        const recordedAt = new Date("2026-08-14T07:00:00.000Z")
        const claimedAt = new Date(recordedAt.getTime() + 1_000)
        const failedAt = new Date(recordedAt.getTime() + 2_000)
        const nextRetryAt = new Date(recordedAt.getTime() + 60_000)
        const retryNow = new Date(recordedAt.getTime() + 70_000)
        const outboxId = "authout_retry_markers_1"
        const idempotencyKey = formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          intentId,
          1
        )

        await pool.query(
          `insert into auth_verification_intent (
            id, auth_identity_id, token_hash, nonce, key_version, generation,
            status, version, expires_at, created_at
          ) values (
            $1, $2, $3, $4, 1, 1, 'pending', 1, $5, $6
          )`,
          [
            intentId,
            identityId,
            derived.material.hash,
            derived.material.nonce,
            new Date(recordedAt.getTime() + 30 * 60 * 1000).toISOString(),
            recordedAt.toISOString(),
          ]
        )

        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, attempt_count, next_retry_at, failure_reason,
            recorded_at, claimed_at, failed_at
          ) values (
            $1, 'email_verification_v1', 'verification', $2, 1, $3,
            'failed', $4, $5, 'loja.com.br', 1, 3, 2, $6, 'provider_transient',
            $7, $8, $9
          )`,
          [
            outboxId,
            intentId,
            idempotencyKey,
            identityId,
            recipientHash,
            nextRetryAt.toISOString(),
            recordedAt.toISOString(),
            claimedAt.toISOString(),
            failedAt.toISOString(),
          ]
        )

        const claimedSnapshots: Array<Record<string, unknown>> = []
        const mockClient: ResendAuthRelayClient = {
          async send(_payload, options) {
            const claimed = await pool.query(
              "select * from auth_notification_outbox where id = $1",
              [outboxId]
            )
            claimedSnapshots.push(claimed.rows[0])
            expect(options.idempotencyKey).toBe(idempotencyKey)
            return { providerMessageId: "msg_retry_markers_1" }
          },
        }

        const result = await runAuthNotificationRelay({
          knex: makeKnexLike(pool),
          client: mockClient,
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          keyring,
          resolveEmailByIdentityId: async () => email,
          workerId: "worker_retry_markers",
          now: () => retryNow,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.sent).toBe(1)
        expect(claimedSnapshots).toHaveLength(1)
        expect(claimedSnapshots[0]).toMatchObject({
          status: "claimed",
          lease_owner: "worker_retry_markers",
          attempt_count: 2,
          generation: 1,
          idempotency_key: idempotencyKey,
          recipient_identity_id: identityId,
          recipient_hash: recipientHash,
          recipient_domain: "loja.com.br",
        })
        expect(claimedSnapshots[0].failed_at).toBeNull()
        expect(claimedSnapshots[0].failure_reason).toBeNull()
        expect(claimedSnapshots[0].next_retry_at).toBeNull()
        expect(claimedSnapshots[0].claimed_at).toBeTruthy()
        expect(claimedSnapshots[0].lease_until).toBeTruthy()
        expect(Number(claimedSnapshots[0].version)).toBe(4)

        const finalRow = (
          await pool.query(
            "select * from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(finalRow.status).toBe("sent")
        expect(finalRow.provider_message_id).toBe("msg_retry_markers_1")
        expect(Number(finalRow.attempt_count)).toBe(2)
        expect(finalRow.failed_at).toBeNull()
        expect(finalRow.failure_reason).toBeNull()
        expect(finalRow.next_retry_at).toBeNull()
        expect(JSON.stringify(finalRow)).not.toContain(derived.capability)
      })

      it("does not claim a failed row whose next_retry_at is still in the future", async () => {
        const now = new Date("2026-08-14T08:00:00.000Z")
        const outboxId = "authout_retry_future_1"
        await pool.query(
          `insert into auth_notification_outbox (
            id, template, intent_type, intent_id, generation, idempotency_key,
            status, recipient_identity_id, recipient_hash, recipient_domain,
            key_version, version, attempt_count, next_retry_at, failure_reason,
            recorded_at, claimed_at, failed_at
          ) values (
            $1, 'email_verification_v1', 'verification', 'authver_retry_future_1', 1,
            'auth/email_verification_v1/authver_retry_future_1/g1',
            'failed', 'ident_retry_future_1', 'hash_future', 'loja.com.br', 1, 3, 2,
            $2, 'provider_transient', $3, $3, $3
          )`,
          [
            outboxId,
            new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
            now.toISOString(),
          ]
        )

        let providerCalls = 0
        const result = await runAuthNotificationRelay({
          knex: makeKnexLike(pool),
          client: {
            async send() {
              providerCalls += 1
              return { providerMessageId: "msg_must_not_send" }
            },
          },
          config: {
            apiKey: "re_key",
            fromEmail: "noreply@ecommerce.com.br",
          },
          now: () => now,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(0)
        expect(result.sent).toBe(0)
        expect(providerCalls).toBe(0)
        const row = (
          await pool.query(
            "select status, attempt_count, failure_reason from auth_notification_outbox where id = $1",
            [outboxId]
          )
        ).rows[0]
        expect(row.status).toBe("failed")
        expect(Number(row.attempt_count)).toBe(2)
        expect(row.failure_reason).toBe("provider_transient")
      })
    })
  })
}
