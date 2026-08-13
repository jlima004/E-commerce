import { Client, Pool, PoolClient } from "pg"
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  CustomerAuthModuleService,
  CUSTOMER_AUTH_WRITE_FORBIDDEN,
  rejectCustomerAuthGeneratedWrite,
  type CustomerAuthMutationContext,
} from "../../src/modules/customer-auth/service"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const schemaSql = `
create table registration_intent (
  id text primary key, normalized_email_hash text not null,
  auth_identity_id text, customer_id text,
  status text not null, version integer not null default 1,
  expires_at timestamptz not null, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint registration_intent_version_positive check (version >= 1),
  constraint registration_intent_expiry_after_creation check (expires_at > created_at),
  constraint registration_intent_identity_precedes_customer check (customer_id is null or auth_identity_id is not null)
);
create unique index "UQ_registration_intent_active_email_hash" on registration_intent(normalized_email_hash)
  where status in ('pending_identity','pending_customer','failed_reconcilable') and deleted_at is null;

create table auth_credential_state (
  id text primary key, auth_identity_id text not null, customer_id text not null,
  operation_type text, operation_id text, operation_status text not null default 'stable',
  operation_version integer not null default 0, credential_version integer not null default 1,
  version integer not null default 1, provider_proved_at timestamptz,
  credential_updated_at timestamptz, revocation_committed_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_credential_state_versions_valid check (version >= 1 and credential_version >= 1 and operation_version >= 0),
  constraint auth_credential_state_completion_order check (completed_at is null or (provider_proved_at is not null and credential_updated_at is not null and revocation_committed_at is not null))
);
create unique index "UQ_auth_credential_state_identity" on auth_credential_state(auth_identity_id) where deleted_at is null;
create unique index "UQ_auth_credential_state_operation_id" on auth_credential_state(operation_id) where operation_id is not null and deleted_at is null;

create table auth_session_lineage (
  id text primary key, sid text not null, auth_identity_id text not null, customer_id text not null,
  credential_version_snapshot integer not null, status text not null default 'active', version integer not null default 1,
  original_authenticated_at timestamptz not null, absolute_expires_at timestamptz not null,
  revoked_at timestamptz, revocation_reason text, expired_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_session_lineage_absolute_deadline check (absolute_expires_at = original_authenticated_at + interval '30 days')
);
create unique index "UQ_auth_session_lineage_sid" on auth_session_lineage(sid) where deleted_at is null;

create table auth_refresh_credential (
  id text primary key, lineage_id text not null, token_hash text not null, generation integer not null default 0,
  status text not null default 'active', replacement_id text, request_key_hash text, nonce text not null,
  key_version integer not null, expires_at timestamptz not null, consumed_at timestamptz,
  recovery_until timestamptz, replacement_used_at timestamptz, replayed_at timestamptz, revoked_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_refresh_credential_generation_valid check (generation >= 0 and key_version >= 1 and version >= 1),
  constraint auth_refresh_credential_consumed_recovery check (
    (status in ('consumed','replayed') and consumed_at is not null and replacement_id is not null and request_key_hash is not null and recovery_until = consumed_at + interval '45 seconds') or
    (status not in ('consumed','replayed') and consumed_at is null and replacement_id is null and request_key_hash is null and recovery_until is null)
  )
);
create unique index "UQ_auth_refresh_credential_token_hash" on auth_refresh_credential(token_hash) where deleted_at is null;
create unique index "UQ_auth_refresh_credential_lineage_generation" on auth_refresh_credential(lineage_id,generation) where deleted_at is null;
create unique index "UQ_auth_refresh_credential_active_lineage" on auth_refresh_credential(lineage_id) where status='active' and deleted_at is null;

create table auth_verification_intent (
  id text primary key, auth_identity_id text not null, token_hash text not null, nonce text not null,
  key_version integer not null, generation integer not null default 0, status text not null default 'pending',
  version integer not null default 1, expires_at timestamptz not null, claimed_at timestamptz, confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_verification_intent_exact_ttl check (expires_at = created_at + interval '30 minutes')
);
create unique index "UQ_auth_verification_intent_token_hash" on auth_verification_intent(token_hash) where deleted_at is null;
create unique index "UQ_auth_verification_intent_identity_generation" on auth_verification_intent(auth_identity_id,generation) where deleted_at is null;
create unique index "UQ_auth_verification_intent_active_identity" on auth_verification_intent(auth_identity_id) where status in ('pending','claimed') and deleted_at is null;

create table auth_reset_intent (
  id text primary key, auth_identity_id text not null, token_hash text not null, nonce text not null,
  key_version integer not null, generation integer not null default 0, status text not null default 'pending',
  version integer not null default 1, operation_id text, expires_at timestamptz not null, claimed_at timestamptz,
  provider_proved_at timestamptz, credential_updated_at timestamptz, revocation_committed_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_reset_intent_exact_ttl check (expires_at = created_at + interval '15 minutes'),
  constraint auth_reset_intent_completion_order check (completed_at is null or (claimed_at is not null and provider_proved_at is not null and credential_updated_at is not null and revocation_committed_at is not null))
);
create unique index "UQ_auth_reset_intent_token_hash" on auth_reset_intent(token_hash) where deleted_at is null;
create unique index "UQ_auth_reset_intent_operation_id" on auth_reset_intent(operation_id) where operation_id is not null and deleted_at is null;
create unique index "UQ_auth_reset_intent_identity_generation" on auth_reset_intent(auth_identity_id,generation) where deleted_at is null;
create unique index "UQ_auth_reset_intent_active_identity" on auth_reset_intent(auth_identity_id) where status in ('pending','claimed','credential_updated','revocation_committed','failed_reconcilable') and deleted_at is null;

create table auth_notification_outbox (
  id text primary key, intent_id text not null, recipient_identity_id text not null,
  recipient_hash text not null, recipient_domain text not null, idempotency_key text not null,
  status text not null default 'recorded', generation integer not null default 0, version integer not null default 1,
  attempt_count integer not null default 0, claimed_at timestamptz, lease_owner text, lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint auth_notification_outbox_recipient_evidence check (char_length(recipient_identity_id)>0 and char_length(recipient_hash)>0 and char_length(recipient_domain) between 1 and 253),
  constraint auth_notification_outbox_lease_pair check ((lease_owner is null and lease_until is null) or (lease_owner is not null and lease_until is not null)),
  constraint auth_notification_outbox_lease_window check (lease_until is null or lease_until = claimed_at + interval '2 minutes')
);
create unique index "UQ_auth_notification_outbox_idempotency" on auth_notification_outbox(idempotency_key) where deleted_at is null;
`

function context(client: PoolClient): CustomerAuthMutationContext {
  return {
    __type: "MedusaContext",
    transactionManager: {
      getTransactionContext: () => ({
        raw: (sql, bindings = []) => {
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

async function transaction<T>(pool: Pool, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  await client.query("begin")
  try {
    const result = await task(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

if (!databaseUrl || !databaseName) {
  describe("customer auth PostgreSQL models", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(120_000)
  const pool = new Pool({ connectionString: databaseUrl })
  const service = Object.create(CustomerAuthModuleService.prototype) as CustomerAuthModuleService
  const maintenanceUrl = new URL(databaseUrl)
  maintenanceUrl.pathname = "/postgres"

  async function createDisposableDatabase() {
    expect(databaseName).toMatch(/^p12_disposable_[a-z0-9_]+$/)
    const maintenance = new Client({ connectionString: maintenanceUrl.toString() })
    await maintenance.connect()
    try {
      await maintenance.query(`create database "${databaseName}"`)
    } finally {
      await maintenance.end()
    }
  }

  async function dropDisposableDatabase() {
    await pool.end()
    const maintenance = new Client({ connectionString: maintenanceUrl.toString() })
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

  describe("customer auth PostgreSQL models", () => {
    beforeAll(async () => {
      await createDisposableDatabase()
      const current = await pool.query("select current_database() as name")
      expect(current.rows[0].name).toBe(databaseName)
      const migration = spawnSync(
        process.execPath,
        ["../../node_modules/@medusajs/cli/cli.js", "db:migrate"],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" }
      )
      expect(migration.status).toBe(0)
    })
    afterAll(dropDisposableDatabase)

    it("enforces unique, generation, deadline and recipient constraints across 7/7 models", async () => {
      await pool.query("insert into registration_intent(id,normalized_email_hash,semantic_payload_hmac,payload_key_version,status,expires_at) values ('r1','h1','sp1',1,'pending_identity',now()+interval '1 day')")
      await expect(pool.query("insert into registration_intent(id,normalized_email_hash,semantic_payload_hmac,payload_key_version,status,expires_at) values ('r2','h1','sp2',1,'pending_identity',now()+interval '1 day')")).rejects.toMatchObject({ code: "23505" })
      await pool.query("insert into auth_credential_state(id,auth_identity_id,customer_id) values ('c1','i1','u1')")
      await expect(pool.query("insert into auth_credential_state(id,auth_identity_id,customer_id) values ('c2','i1','u2')")).rejects.toMatchObject({ code: "23505" })
      await pool.query("insert into auth_session_lineage(id,sid,auth_identity_id,customer_id,credential_version_snapshot,original_authenticated_at,absolute_expires_at) values ('l1','sid1','i1','u1',1,now(),now()+interval '30 days')")
      await expect(pool.query("update auth_session_lineage set absolute_expires_at=absolute_expires_at+interval '1 second' where id='l1'")).rejects.toMatchObject({ code: "23514" })
      await pool.query("insert into auth_refresh_credential(id,lineage_id,token_hash,nonce,key_version,expires_at) values ('f1','l1','th1','n1',1,now()+interval '1 day')")
      await expect(pool.query("insert into auth_refresh_credential(id,lineage_id,token_hash,nonce,key_version,expires_at) values ('f2','l1','th2','n2',1,now()+interval '1 day')")).rejects.toMatchObject({ code: "23505" })
      await pool.query("insert into auth_verification_intent(id,auth_identity_id,token_hash,nonce,key_version,expires_at) values ('v1','i1','vh1','n1',1,now()+interval '30 minutes')")
      await expect(pool.query("insert into auth_verification_intent(id,auth_identity_id,token_hash,nonce,key_version,expires_at) values ('v2','i1','vh2','n2',1,now()+interval '30 minutes')")).rejects.toMatchObject({ code: "23505" })
      await pool.query("insert into auth_reset_intent(id,auth_identity_id,token_hash,nonce,key_version,expires_at) values ('x1','i2','xh1','n1',1,now()+interval '15 minutes')")
      await expect(pool.query("update auth_reset_intent set completed_at=now(),status='completed' where id='x1'")).rejects.toMatchObject({ code: "23514" })
      await expect(pool.query("insert into auth_notification_outbox(id,template,intent_type,intent_id,recipient_identity_id,recipient_hash,recipient_domain,idempotency_key,key_version,recorded_at) values ('o1','email_verification_v1','verification','v1','','rh','example.test','auth/v1',1,now())")).rejects.toMatchObject({ code: "23514" })
      await pool.query("insert into auth_notification_outbox(id,template,intent_type,intent_id,recipient_identity_id,recipient_hash,recipient_domain,idempotency_key,key_version,recorded_at) values ('o1','email_verification_v1','verification','v1','i1','rh','example.test','auth/v1',1,now())")
    })

    it("allows one CAS winner under a row lock and leaves no partial state on rollback", async () => {
      const results = await Promise.all([
        transaction(pool, (client) => service.transitionRegistrationIntent("r1", 1, "pending_customer", "i1", context(client))),
        transaction(pool, (client) => service.transitionRegistrationIntent("r1", 1, "pending_customer", "i1", context(client))),
      ])
      expect(results.filter((result) => result.type === "updated")).toHaveLength(1)
      expect(results.filter((result) => result.type === "stale")).toHaveLength(1)

      await expect(transaction(pool, async (client) => {
        await service.transitionCredentialState("c1", 1, "claimed", "reset", "op-rollback", context(client))
        throw new Error("P14_TEST_ROLLBACK")
      })).rejects.toThrow("P14_TEST_ROLLBACK")
      const state = await pool.query("select operation_status,version from auth_credential_state where id='c1'")
      expect(state.rows[0]).toMatchObject({ operation_status: "stable", version: 1 })
    })

    it("uses transaction-required CAS transitions for the remaining five models", async () => {
      await transaction(pool, async (client) => {
        const shared = context(client)
        await expect(
          service.transitionSessionLineage(
            "l1",
            1,
            "revoked",
            new Date(),
            "logout",
            shared
          )
        ).resolves.toMatchObject({ type: "updated", capability: "RECONCILIATION_REQUIRED" })

        const consumedAt = new Date()
        await expect(
          service.transitionRefreshCredential(
            "f1",
            0,
            "consumed",
            [
              { column: "consumed_at", value: consumedAt },
              { column: "replacement_id", value: "f2" },
              { column: "request_key_hash", value: "request-hash" },
              {
                column: "recovery_until",
                value: new Date(consumedAt.getTime() + 45_000),
              },
            ],
            shared
          )
        ).resolves.toMatchObject({ type: "updated" })

        await expect(
          service.transitionVerificationIntent(
            "v1",
            1,
            "claimed",
            "claimed_at",
            new Date(),
            shared
          )
        ).resolves.toMatchObject({ type: "updated" })

        await expect(
          service.transitionResetIntent(
            "x1",
            1,
            "claimed",
            "claimed_at",
            new Date(),
            "op1",
            shared
          )
        ).resolves.toMatchObject({ type: "updated" })

        await expect(
          service.claimNotificationOutbox(
            "o1",
            1,
            "worker-1",
            new Date(),
            shared
          )
        ).resolves.toMatchObject({ type: "updated" })
      })
    })

    it("keeps Redis outside validity and rejects generated writes", async () => {
      expect(JSON.stringify(CustomerAuthModuleService.prototype)).not.toMatch(/redis|ioredis|bullmq/i)
      await expect(rejectCustomerAuthGeneratedWrite()).rejects.toThrow(
        CUSTOMER_AUTH_WRITE_FORBIDDEN
      )
    })

    it("keeps one CLI migration and snapshot aligned to the exact 7-model set", () => {
      const migrationDirectory = join(
        process.cwd(),
        "src/modules/customer-auth/migrations"
      )
      const files = readdirSync(migrationDirectory).sort()
      const migrations = files.filter((file) => /^Migration\d{14}\.ts$/.test(file))
      expect(migrations).toEqual(["Migration20260813221813.ts"])
      expect(files).toContain(".snapshot-customer-auth.json")

      const migration = readFileSync(
        join(migrationDirectory, migrations[0]),
        "utf8"
      )
      const snapshot = JSON.parse(
        readFileSync(
          join(migrationDirectory, ".snapshot-customer-auth.json"),
          "utf8"
        )
      ) as { tables: Array<{ name: string }> }
      const expectedTables = [
        "auth_credential_state",
        "auth_notification_outbox",
        "auth_refresh_credential",
        "auth_reset_intent",
        "auth_session_lineage",
        "auth_verification_intent",
        "registration_intent",
      ]
      expect(snapshot.tables.map((table) => table.name).sort()).toEqual(
        expectedTables
      )
      expect(migration.match(/create table if not exists/g)).toHaveLength(7)
      expect(migration.match(/drop table if exists/g)).toHaveLength(7)
      for (const table of expectedTables) {
        expect(migration).toContain(`"${table}"`)
      }
      for (const constraint of [
        "auth_session_lineage_absolute_deadline",
        "auth_refresh_credential_consumed_recovery",
        "auth_verification_intent_exact_ttl",
        "auth_reset_intent_completion_order",
        "auth_notification_outbox_recipient_evidence",
        "auth_notification_outbox_lease_window",
      ]) {
        expect(migration).toContain(constraint)
      }
    })
  })
}
