import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS,
  STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
  STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS,
  STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
  STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
  STORE_IDEMPOTENCY_RECONCILIATION_REVIEW_MS,
  STORE_IDEMPOTENCY_RETRY_WINDOW_MS,
  STORE_IDEMPOTENCY_UNRESOLVED_RETENTION_MS,
  StoreIdempotencyModuleService,
  assertNoSensitiveStoreIdempotencyPersistence,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
  buildStoreIdempotencyRequestFingerprint,
  type LifecycleClaimResult,
} from ".."
import { STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS } from "../service"
import {
  STORE_IDEMPOTENCY_HASH_VERSION,
  STORE_IDEMPOTENCY_PEPPER_VERSION,
} from "../models/store-idempotency-record"
import { STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT } from "../../../config/env"

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")

    function requireSafeName(databaseName: unknown): string {
      if (
        typeof databaseName !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(databaseName)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return databaseName
    }

    function maintenanceClient() {
      return new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })
    }

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          const existing = await client.query(
            "select 1 from pg_database where datname = $1",
            [safeName]
          )
          if (existing.rowCount === 0) {
            await client.query(`create database "${safeName}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [safeName]
          )
          await client.query(`drop database if exists "${safeName}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("StoreIdempotency PostgreSQL routing", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(180_000)

  function createAppClient() {
    return new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: databaseName,
    })
  }

  function addMs(at: Date, ms: number): Date {
    return new Date(at.getTime() + ms)
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const resolveService = () =>
        getContainer().resolve(
          STORE_IDEMPOTENCY_MODULE
        ) as StoreIdempotencyModuleService

      const pepper = () =>
        process.env.STORE_IDEMPOTENCY_KEY_PEPPER ||
        STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT

      async function wipeTable() {
        await dbConnection.raw(`delete from store_idempotency_record`)
      }

      beforeEach(async () => {
        await wipeTable()
      })

      it("1) applies migration with table, columns, unique scope, state check, and indexes", async () => {
        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'store_idempotency_record'
        `)
        expect(table.rows).toEqual([
          { table_name: "store_idempotency_record" },
        ])

        const columns = await dbConnection.raw(`
          select column_name
          from information_schema.columns
          where table_schema = 'public' and table_name = 'store_idempotency_record'
          order by column_name
        `)
        const columnNames = columns.rows.map(
          (row: { column_name: string }) => row.column_name
        )
        expect(columnNames).toEqual(
          expect.arrayContaining([
            "id",
            "operation",
            "actor_scope_hash",
            "resource_scope_hash",
            "idempotency_key_hash",
            "hash_version",
            "pepper_version",
            "request_fingerprint",
            "state",
            "state_version",
            "locked_at",
            "state_deadline_at",
            "next_retry_at",
            "expires_at",
            "result_safe_metadata",
          ])
        )

        const indexes = await dbConnection.raw(`
          select indexname
          from pg_indexes
          where schemaname = 'public' and tablename = 'store_idempotency_record'
          order by indexname
        `)
        const indexNames = indexes.rows.map(
          (row: { indexname: string }) => row.indexname
        )
        expect(indexNames).toEqual(
          expect.arrayContaining([
            "UQ_store_idempotency_record_claim_scope",
            "IDX_store_idempotency_record_state_deadline",
            "IDX_store_idempotency_record_next_retry_at",
            "IDX_store_idempotency_record_expires_at",
          ])
        )

        // R1-01: exact UNIQUE catalog proof (indisunique / indpred / ordered cols).
        const claimUnique = await dbConnection.raw(`
          select
            i.indisunique,
            i.indpred,
            pg_get_indexdef(i.indexrelid) as indexdef,
            json_agg(a.attname order by u.ord) as ordered_columns
          from pg_index i
          join pg_class idx on idx.oid = i.indexrelid
          join pg_class tbl on tbl.oid = i.indrelid
          join pg_namespace n on n.oid = tbl.relnamespace
          join lateral unnest(i.indkey) with ordinality as u(attnum, ord) on true
          join pg_attribute a
            on a.attrelid = tbl.oid and a.attnum = u.attnum
          where n.nspname = 'public'
            and tbl.relname = 'store_idempotency_record'
            and idx.relname = 'UQ_store_idempotency_record_claim_scope'
          group by i.indisunique, i.indpred, i.indexrelid
        `)
        expect(claimUnique.rows).toHaveLength(1)
        expect(claimUnique.rows[0].indisunique).toBe(true)
        expect(claimUnique.rows[0].indpred).toBeNull()
        const orderedColumnsRaw = claimUnique.rows[0].ordered_columns
        const orderedColumns = Array.isArray(orderedColumnsRaw)
          ? orderedColumnsRaw
          : JSON.parse(String(orderedColumnsRaw))
        expect(orderedColumns).toEqual([
          "operation",
          "actor_scope_hash",
          "resource_scope_hash",
          "idempotency_key_hash",
        ])
        expect(String(claimUnique.rows[0].indexdef)).not.toMatch(
          /where\s+deleted_at\s+is\s+null/i
        )

        const competingPartial = await dbConnection.raw(`
          select idx.relname as indexname, pg_get_indexdef(i.indexrelid) as indexdef
          from pg_index i
          join pg_class idx on idx.oid = i.indexrelid
          join pg_class tbl on tbl.oid = i.indrelid
          join pg_namespace n on n.oid = tbl.relnamespace
          where n.nspname = 'public'
            and tbl.relname = 'store_idempotency_record'
            and i.indisunique = true
            and i.indpred is not null
            and idx.relname <> 'UQ_store_idempotency_record_claim_scope'
            and pg_get_indexdef(i.indexrelid) ilike '%operation%'
            and pg_get_indexdef(i.indexrelid) ilike '%actor_scope_hash%'
            and pg_get_indexdef(i.indexrelid) ilike '%resource_scope_hash%'
            and pg_get_indexdef(i.indexrelid) ilike '%idempotency_key_hash%'
        `)
        expect(competingPartial.rows).toEqual([])

        const checks = await dbConnection.raw(`
          select conname, pg_get_constraintdef(oid) as def
          from pg_constraint
          where conrelid = 'store_idempotency_record'::regclass
            and contype = 'c'
          order by conname
        `)
        const defsByName = new Map<string, string>(
          (checks.rows as Array<{ conname: string; def: string }>).map(
            (row) => [row.conname, row.def] as [string, string]
          )
        )
        const allDefs = (
          checks.rows as Array<{ def: string }>
        ).map((row) => row.def)

        const expectedStates = [
          "processing",
          "completed",
          "failed_retryable",
          "failed_terminal",
          "reconciliation_required",
          "reconciliation_unresolved",
        ]
        // PostgreSQL may rewrite CHECK (... IN (...)) as (... = ANY (ARRAY[...])).
        const stateDef =
          allDefs.find((def: string) => {
            const n = def.replace(/"/g, "").toLowerCase()
            return (
              /\bstate\s+in\s*\(/.test(n) ||
              /\bstate\b.*\bany\s*\(\s*array\[/.test(n) ||
              /\(\s*state\s*\)\s*::\s*text\s*=\s*any\s*\(/.test(n)
            )
          }) ?? ""
        expect(stateDef.length).toBeGreaterThan(0)
        const stateMatches = [...stateDef.matchAll(/'([^']+)'/g)].map(
          (m) => m[1]
        )
        expect(new Set(stateMatches)).toEqual(new Set(expectedStates))
        expect(stateMatches).toHaveLength(expectedStates.length)
        // No extra / missing members after closed normalization.
        expect([...new Set(stateMatches)].sort()).toEqual(
          [...expectedStates].sort()
        )

        const normalizeCheck = (def: string) =>
          def
            .replace(/::[a-zA-Z0-9_]+/g, "")
            .replace(/"/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()

        const hashDef =
          defsByName.get("store_idempotency_record_hash_version_check") ?? ""
        expect(normalizeCheck(hashDef)).toMatch(
          /check\s*\(+hash_version\s*=\s*'hmac-sha256-v1'\)+/
        )

        const pepperDef =
          defsByName.get("store_idempotency_record_pepper_version_check") ?? ""
        expect(normalizeCheck(pepperDef)).toMatch(
          /check\s*\(+pepper_version\s*=\s*1\)+/
        )

        const stateVersionDef =
          defsByName.get("store_idempotency_record_state_version_check") ?? ""
        expect(normalizeCheck(stateVersionDef)).toMatch(
          /check\s*\(+state_version\s*>=\s*1\)+/
        )

        // Behavioral negative/positive enforcement for version CHECKs.
        const hex = (n: number) => "a".repeat(n)
        const baseInsert = {
          id: "stidem_ddl_check_01",
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actor_scope_hash: hex(64),
          resource_scope_hash: hex(64),
          idempotency_key_hash: hex(64),
          request_fingerprint: hex(64),
        }

        await expect(
          dbConnection.raw(
            `insert into store_idempotency_record
              (id, operation, actor_scope_hash, resource_scope_hash,
               idempotency_key_hash, hash_version, pepper_version,
               request_fingerprint, state, state_version)
             values (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 1)`,
            [
              baseInsert.id + "_hash",
              baseInsert.operation,
              baseInsert.actor_scope_hash,
              baseInsert.resource_scope_hash,
              baseInsert.idempotency_key_hash,
              "hmac-sha256-v0",
              1,
              baseInsert.request_fingerprint,
            ]
          )
        ).rejects.toThrow()

        await expect(
          dbConnection.raw(
            `insert into store_idempotency_record
              (id, operation, actor_scope_hash, resource_scope_hash,
               idempotency_key_hash, hash_version, pepper_version,
               request_fingerprint, state, state_version)
             values (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 1)`,
            [
              baseInsert.id + "_pepper",
              baseInsert.operation,
              baseInsert.actor_scope_hash,
              baseInsert.resource_scope_hash,
              baseInsert.idempotency_key_hash,
              "hmac-sha256-v1",
              2,
              baseInsert.request_fingerprint,
            ]
          )
        ).rejects.toThrow()

        await expect(
          dbConnection.raw(
            `insert into store_idempotency_record
              (id, operation, actor_scope_hash, resource_scope_hash,
               idempotency_key_hash, hash_version, pepper_version,
               request_fingerprint, state, state_version)
             values (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0)`,
            [
              baseInsert.id + "_sv",
              baseInsert.operation,
              baseInsert.actor_scope_hash,
              baseInsert.resource_scope_hash,
              baseInsert.idempotency_key_hash,
              "hmac-sha256-v1",
              1,
              baseInsert.request_fingerprint,
            ]
          )
        ).rejects.toThrow()

        await expect(
          dbConnection.raw(
            `insert into store_idempotency_record
              (id, operation, actor_scope_hash, resource_scope_hash,
               idempotency_key_hash, hash_version, pepper_version,
               request_fingerprint, state, state_version)
             values (?, ?, ?, ?, ?, ?, ?, ?, 'bogus_state', 1)`,
            [
              baseInsert.id + "_state",
              baseInsert.operation,
              baseInsert.actor_scope_hash,
              baseInsert.resource_scope_hash,
              baseInsert.idempotency_key_hash,
              "hmac-sha256-v1",
              1,
              baseInsert.request_fingerprint,
            ]
          )
        ).rejects.toThrow()

        await dbConnection.raw(
          `insert into store_idempotency_record
            (id, operation, actor_scope_hash, resource_scope_hash,
             idempotency_key_hash, hash_version, pepper_version,
             request_fingerprint, state, state_version)
           values (?, ?, ?, ?, ?, 'hmac-sha256-v1', 1, ?, 'processing', 1)`,
          [
            baseInsert.id + "_ok",
            baseInsert.operation,
            baseInsert.actor_scope_hash,
            baseInsert.resource_scope_hash,
            baseInsert.idempotency_key_hash,
            baseInsert.request_fingerprint,
          ]
        )
        await dbConnection.raw(
          `delete from store_idempotency_record where id = ?`,
          [baseInsert.id + "_ok"]
        )

        const leftovers = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record
           where id like ?`,
          [baseInsert.id + "%"]
        )
        expect(leftovers.rows).toEqual([{ count: 0 }])

        const configModule = getContainer().resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as { modules?: Record<string, unknown> }
        expect(configModule.modules).toHaveProperty(STORE_IDEMPOTENCY_MODULE)

        expect(disposableEnvironment.REDIS_URL).toBe("")
        expect(disposableEnvironment.CACHE_REDIS_URL).toBe("")
        expect(disposableEnvironment.EVENTS_REDIS_URL).toBe("")
        expect(disposableEnvironment.WE_REDIS_URL).toBe("")
      })

      it("2) concurrent initial claim yields exactly one row (UNIQUE decides)", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const input = {
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_concurrent_01" },
          resourceScope: { cart_id: "cart_concurrent_01" },
          rawIdempotencyKey: "Concurrent-Key-01",
          canonicalSemanticObject: { op: "phase13.local-mutation", n: 1 },
          at,
        }

        const results = await Promise.all([
          service.claim(input),
          service.claim(input),
          service.claim(input),
        ])

        const claimed = results.filter((r) => r.type === "claimed")
        const others = results.filter((r) => r.type !== "claimed")
        expect(claimed).toHaveLength(1)
        expect(others.length).toBe(2)
        for (const other of others) {
          expect(["in_progress", "replay"]).toContain(other.type)
        }

        const cardinality = await dbConnection.raw(`
          select count(*)::int as count
          from store_idempotency_record
          where deleted_at is null
        `)
        expect(cardinality.rows).toEqual([{ count: 1 }])
      })

      it("3) same key/same intent returns in_progress or replay, never new ownership", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const input = {
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_same_01" },
          resourceScope: { cart_id: "cart_same_01" },
          rawIdempotencyKey: "Same-Intent-Key",
          canonicalSemanticObject: { sku: "TEE-01", qty: 1 },
          at,
        }

        const first = await service.claim(input)
        expect(first.type).toBe("claimed")
        if (first.type !== "claimed") {
          throw new Error("expected first claim")
        }
        const ownerId = first.record.id
        const ownerVersion = first.record.state_version

        const second = await service.claim(input)
        expect(second.type).toBe("in_progress")
        if (second.type !== "in_progress") {
          throw new Error("expected in_progress")
        }
        expect(second.record.id).toBe(ownerId)
        expect(second.record.state_version).toBe(ownerVersion)

        await service.markCompleted({
          id: ownerId,
          expectedState: "processing",
          expectedStateVersion: ownerVersion,
          result_type: "local_mutation_result",
          result_id: "ord_01HSAME",
          response_status: 200,
          at: addMs(at, 1000),
        })

        const third = await service.claim(input)
        expect(third.type).toBe("replay")
        if (third.type !== "replay") {
          throw new Error("expected replay")
        }
        expect(third.record.id).toBe(ownerId)
        expect(third.record.state).toBe("completed")
      })

      it("4) same key/different intent → IDEMPOTENCY_KEY_REUSE_CONFLICT, no mutation", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const base = {
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_conflict_01" },
          resourceScope: { cart_id: "cart_conflict_01" },
          rawIdempotencyKey: "Conflict-Key-01",
          at,
        }

        const first = await service.claim({
          ...base,
          canonicalSemanticObject: { sku: "TEE-A" },
        })
        expect(first.type).toBe("claimed")
        if (first.type !== "claimed") {
          throw new Error("expected claim")
        }

        const conflict = await service.claim({
          ...base,
          canonicalSemanticObject: { sku: "TEE-B" },
        })
        expect(conflict.type).toBe("conflict")
        if (conflict.type !== "conflict") {
          throw new Error("expected conflict")
        }
        expect(conflict.publicCode).toBe("IDEMPOTENCY_KEY_REUSE_CONFLICT")
        expect(conflict.record.id).toBe(first.record.id)
        expect(conflict.record.state_version).toBe(first.record.state_version)
        expect(conflict.record.request_fingerprint).toBe(
          first.record.request_fingerprint
        )
      })

      it("5) actor/resource isolation allows same raw key across different scopes", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const rawKey = "Shared-Raw-Key"
        const semantic = { sku: "TEE-ISO" }

        const a = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_a" },
          resourceScope: { cart_id: "cart_a" },
          rawIdempotencyKey: rawKey,
          canonicalSemanticObject: semantic,
          at,
        })
        const b = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_b" },
          resourceScope: { cart_id: "cart_a" },
          rawIdempotencyKey: rawKey,
          canonicalSemanticObject: semantic,
          at,
        })
        const c = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_a" },
          resourceScope: { cart_id: "cart_b" },
          rawIdempotencyKey: rawKey,
          canonicalSemanticObject: semantic,
          at,
        })

        expect(a.type).toBe("claimed")
        expect(b.type).toBe("claimed")
        expect(c.type).toBe("claimed")
        if (
          a.type !== "claimed" ||
          b.type !== "claimed" ||
          c.type !== "claimed"
        ) {
          throw new Error("expected three claimed rows")
        }
        expect(new Set([a.record.id, b.record.id, c.record.id]).size).toBe(3)

        const count = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record where deleted_at is null`
        )
        expect(count.rows).toEqual([{ count: 3 }])
      })

      it("6) initial claim: processing, locked_at null, state_deadline_at = T0+5m", async () => {
        const service = resolveService()
        const t0 = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_deadline_01" },
          resourceScope: { cart_id: "cart_deadline_01" },
          rawIdempotencyKey: "Deadline-Key-01",
          canonicalSemanticObject: { n: 1 },
          at: t0,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }
        expect(claimed.record.state).toBe("processing")
        expect(claimed.record.locked_at).toBeNull()
        expect(claimed.record.state_deadline_at).toBe(
          addMs(t0, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).toISOString()
        )
        expect(claimed.record.state_version).toBe(1)
        expect(claimed.record.hash_version).toBe(STORE_IDEMPOTENCY_HASH_VERSION)
        expect(claimed.record.pepper_version).toBe(
          STORE_IDEMPOTENCY_PEPPER_VERSION
        )
      })

      it("7) processing due: absent at T+4m59s, present at T+5m", async () => {
        const service = resolveService()
        const t0 = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_due_01" },
          resourceScope: { cart_id: "cart_due_01" },
          rawIdempotencyKey: "Due-Key-01",
          canonicalSemanticObject: { n: 1 },
          at: t0,
        })
        expect(claimed.type).toBe("claimed")

        const at459 = addMs(t0, 4 * 60_000 + 59_000)
        const dueBefore = await service.listDueLifecycleRows({ now: at459 })
        expect(dueBefore).toHaveLength(0)

        const at5m = addMs(t0, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
        const dueAt = await service.listDueLifecycleRows({ now: at5m })
        expect(dueAt).toHaveLength(1)
        expect(dueAt[0].state).toBe("processing")
      })

      it("8) Worker A claimLifecycleRow excludes Worker B from listDue and direct claim", async () => {
        const service = resolveService()
        const t0 = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_lease_01" },
          resourceScope: { cart_id: "cart_lease_01" },
          rawIdempotencyKey: "Lease-Key-01",
          canonicalSemanticObject: { n: 1 },
          at: t0,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const tDue = addMs(t0, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
        const due = await service.listDueLifecycleRows({ now: tDue })
        expect(due).toHaveLength(1)

        const t1 = addMs(tDue, 1_000)
        const workerA = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          at: t1,
        })
        expect(workerA.type).toBe("claimed")
        if (workerA.type !== "claimed") {
          throw new Error("expected worker A claim")
        }
        expect(workerA.record.state_version).toBe(2)
        expect(workerA.record.locked_at).toBe(t1.toISOString())

        const dueAfterA = await service.listDueLifecycleRows({ now: t1 })
        expect(dueAfterA.find((row) => row.id === claimed.record.id)).toBeUndefined()

        const workerB = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 2,
          at: addMs(t1, 100),
        })
        expect(workerB.type).toBe("lost")
      })

      it("9) lifecycle lease active at T1+14m59s; stale/reclaimable at exact T1+15m", async () => {
        const service = resolveService()
        const t0 = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_boundary_01" },
          resourceScope: { cart_id: "cart_boundary_01" },
          rawIdempotencyKey: "Boundary-Key-01",
          canonicalSemanticObject: { n: 1 },
          at: t0,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const tDue = addMs(t0, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
        const t1 = tDue
        const lease = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          at: t1,
        })
        expect(lease.type).toBe("claimed")
        if (lease.type !== "claimed") {
          throw new Error("expected lease")
        }
        expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(900_000)

        const at1459 = addMs(t1, 14 * 60_000 + 59_000)
        const dueLive = await service.listDueLifecycleRows({ now: at1459 })
        expect(dueLive.find((row) => row.id === claimed.record.id)).toBeUndefined()
        const lostWhileLive = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 2,
          at: at1459,
        })
        expect(lostWhileLive.type).toBe("lost")

        const at15m = addMs(t1, STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS)
        const dueStale = await service.listDueLifecycleRows({ now: at15m })
        expect(dueStale).toHaveLength(1)
        const reclaim = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 2,
          at: at15m,
        })
        expect(reclaim.type).toBe("claimed")
        if (reclaim.type !== "claimed") {
          throw new Error("expected reclaim at exact T+15m")
        }
        expect(reclaim.record.state_version).toBe(3)
        expect(reclaim.record.locked_at).toBe(at15m.toISOString())
      })

      it("10) restart recovery uses PostgreSQL alone after lease expiry", async () => {
        const serviceA = resolveService()
        const t0 = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await serviceA.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_restart_01" },
          resourceScope: { cart_id: "cart_restart_01" },
          rawIdempotencyKey: "Restart-Key-01",
          canonicalSemanticObject: { n: 1 },
          at: t0,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const t1 = addMs(t0, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
        await serviceA.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          at: t1,
        })

        // Fresh resolve simulates process restart — no in-memory ownership.
        const serviceB = resolveService()
        const afterLease = addMs(t1, STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS)
        const due = await serviceB.listDueLifecycleRows({ now: afterLease })
        expect(due.map((row) => row.id)).toContain(claimed.record.id)

        const recovered = await serviceB.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 2,
          at: afterLease,
        })
        expect(recovered.type).toBe("claimed")
        if (recovered.type !== "claimed") {
          throw new Error("expected restart reclaim")
        }

        const completed = await serviceB.markCompleted({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 3,
          result_type: "local_mutation_result",
          result_id: "ord_01HRESTART",
          response_status: 200,
          at: afterLease,
        })
        expect(completed.type).toBe("claimed")
      })

      it("11) Redis independence: claim/replay/conflict/lifecycle with empty Redis env", async () => {
        expect(process.env.REDIS_URL).toBe("")
        expect(process.env.CACHE_REDIS_URL).toBe("")
        expect(process.env.EVENTS_REDIS_URL).toBe("")
        expect(process.env.WE_REDIS_URL).toBe("")

        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_redis_01" },
          resourceScope: { cart_id: "cart_redis_01" },
          rawIdempotencyKey: "Redis-Indep-Key",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const replay = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_redis_01" },
          resourceScope: { cart_id: "cart_redis_01" },
          rawIdempotencyKey: "Redis-Indep-Key",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(replay.type).toBe("in_progress")

        const conflict = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_redis_01" },
          resourceScope: { cart_id: "cart_redis_01" },
          rawIdempotencyKey: "Redis-Indep-Key",
          canonicalSemanticObject: { n: 2 },
          at,
        })
        expect(conflict.type).toBe("conflict")

        const dueAt = addMs(at, STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
        const due = await service.listDueLifecycleRows({ now: dueAt })
        expect(due).toHaveLength(1)
        const lease = await service.claimLifecycleRow({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          at: dueAt,
        })
        expect(lease.type).toBe("claimed")
      })

      it("12) transition CAS: one winner, one loser on state+state_version", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_cas_01" },
          resourceScope: { cart_id: "cart_cas_01" },
          rawIdempotencyKey: "Cas-Key-01",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const [winner, loser] = await Promise.all([
          service.markCompleted({
            id: claimed.record.id,
            expectedState: "processing",
            expectedStateVersion: 1,
            result_type: "local_mutation_result",
            result_id: "ord_01HCAS",
            response_status: 200,
            at: addMs(at, 10),
          }),
          service.markFailedTerminal({
            id: claimed.record.id,
            expectedState: "processing",
            expectedStateVersion: 1,
            failure_code: "timeout",
            at: addMs(at, 10),
          }),
        ])

        const types = [winner.type, loser.type].sort()
        expect(types).toEqual(["claimed", "lost"])
        const won = winner.type === "claimed" ? winner : loser
        expect(won.type).toBe("claimed")
        if (won.type !== "claimed") {
          throw new Error("expected one claimed")
        }
        expect(["completed", "failed_terminal"]).toContain(won.record.state)
        expect(won.record.state_version).toBe(2)

        const row = await dbConnection.raw(
          `select state, state_version from store_idempotency_record where id = ?`,
          [claimed.record.id]
        )
        expect(row.rows).toHaveLength(1)
        expect(row.rows[0].state_version).toBe(2)
      })

      it("13) terminal replay for completed, failed_terminal, reconciliation_unresolved", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")

        async function seedAndReplay(
          terminalizer: (id: string) => Promise<LifecycleClaimResult>
        ) {
          const key = `Terminal-${Math.random().toString(16).slice(2, 10)}`
          const input = {
            operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
            actorScope: { customer_id: "cus_term_01" },
            resourceScope: { cart_id: `cart_${key}` },
            rawIdempotencyKey: key,
            canonicalSemanticObject: { key },
            at,
          }
          const claimed = await service.claim(input)
          expect(claimed.type).toBe("claimed")
          if (claimed.type !== "claimed") {
            throw new Error("expected claimed")
          }
          const terminal = await terminalizer(claimed.record.id)
          expect(terminal.type).toBe("claimed")
          if (terminal.type !== "claimed") {
            throw new Error("expected terminal claimed")
          }
          const versionBefore = terminal.record.state_version
          const replay = await service.claim(input)
          expect(replay.type).toBe("replay")
          if (replay.type !== "replay") {
            throw new Error("expected replay")
          }
          expect(replay.record.id).toBe(claimed.record.id)
          expect(replay.record.state_version).toBe(versionBefore)
          expect(replay.record.state).toBe(terminal.record.state)
        }

        await seedAndReplay((id) =>
          service.markCompleted({
            id,
            expectedState: "processing",
            expectedStateVersion: 1,
            result_type: "local_mutation_result",
            result_id: "ord_01HTERM",
            response_status: 200,
            at: addMs(at, 1),
          })
        )

        await seedAndReplay((id) =>
          service.markFailedTerminal({
            id,
            expectedState: "processing",
            expectedStateVersion: 1,
            failure_code: "timeout",
            at: addMs(at, 1),
          })
        )

        await seedAndReplay(async (id) => {
          const required = await service.markReconciliationRequired({
            id,
            expectedState: "processing",
            expectedStateVersion: 1,
            failure_code: "uncertain",
            at: addMs(at, 1),
          })
          expect(required.type).toBe("claimed")
          if (required.type !== "claimed") {
            throw new Error("expected reconciliation_required")
          }
          return service.markReconciliationUnresolved({
            id,
            expectedState: "reconciliation_required",
            expectedStateVersion: 2,
            at: addMs(at, 2),
          })
        })
      })

      it("14) cleanup matrix: all expired terminals deleted; processing preserved; lease + idempotence", async () => {
        const service = resolveService()
        const now = new Date("2026-08-09T12:00:00.000Z")
        const expired = addMs(now, -60_000).toISOString()

        async function forceExpired(id: string) {
          // Setup-only clock control: service retention helpers keep expires_at
          // relative to transition time; cleanup proof needs past expires_at.
          await dbConnection.raw(
            `update store_idempotency_record
             set expires_at = ?, terminalized_at = coalesce(terminalized_at, ?)
             where id = ?`,
            [expired, expired, id]
          )
        }

        // --- Seed: expired completed ---
        const completedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_clean_completed" },
          resourceScope: { cart_id: "cart_clean_completed" },
          rawIdempotencyKey: "Clean-Completed",
          canonicalSemanticObject: { n: 1 },
          at: now,
        })
        expect(completedClaim.type).toBe("claimed")
        if (completedClaim.type !== "claimed") {
          throw new Error("expected completed claim")
        }
        const completedMarked = await service.markCompleted({
          id: completedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          result_type: "local_mutation_result",
          result_id: "ord_01HCLEAN_C",
          response_status: 200,
          at: now,
        })
        expect(completedMarked.type).toBe("claimed")
        await forceExpired(completedClaim.record.id)

        // --- Seed: expired failed_terminal ---
        const failedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_clean_failed" },
          resourceScope: { cart_id: "cart_clean_failed" },
          rawIdempotencyKey: "Clean-Failed",
          canonicalSemanticObject: { n: 2 },
          at: now,
        })
        expect(failedClaim.type).toBe("claimed")
        if (failedClaim.type !== "claimed") {
          throw new Error("expected failed claim")
        }
        const failedMarked = await service.markFailedTerminal({
          id: failedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          failure_code: "timeout",
          at: now,
        })
        expect(failedMarked.type).toBe("claimed")
        await forceExpired(failedClaim.record.id)

        // --- Seed: expired reconciliation_unresolved ---
        const unresolvedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
          actorScope: { customer_id: "cus_clean_unresolved" },
          resourceScope: { cart_id: "cart_clean_unresolved" },
          rawIdempotencyKey: "Clean-Unresolved",
          canonicalSemanticObject: { n: 3 },
          at: now,
        })
        expect(unresolvedClaim.type).toBe("claimed")
        if (unresolvedClaim.type !== "claimed") {
          throw new Error("expected unresolved claim")
        }
        const required = await service.markReconciliationRequired({
          id: unresolvedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          failure_code: "uncertain",
          at: now,
        })
        expect(required.type).toBe("claimed")
        if (required.type !== "claimed") {
          throw new Error("expected reconciliation_required")
        }
        const unresolved = await service.markReconciliationUnresolved({
          id: unresolvedClaim.record.id,
          expectedState: "reconciliation_required",
          expectedStateVersion: 2,
          at: now,
        })
        expect(unresolved.type).toBe("claimed")
        await forceExpired(unresolvedClaim.record.id)

        // --- Seed: expired processing canary (non-terminal must never delete) ---
        const processingClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_clean_processing" },
          resourceScope: { cart_id: "cart_clean_processing" },
          rawIdempotencyKey: "Clean-Processing",
          canonicalSemanticObject: { n: 4 },
          at: now,
        })
        expect(processingClaim.type).toBe("claimed")
        if (processingClaim.type !== "claimed") {
          throw new Error("expected processing claim")
        }
        await dbConnection.raw(
          `update store_idempotency_record set expires_at = ? where id = ?`,
          [expired, processingClaim.record.id]
        )

        // --- Seed: expired completed with fresh lifecycle lease ---
        const leasedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_clean_leased" },
          resourceScope: { cart_id: "cart_clean_leased" },
          rawIdempotencyKey: "Clean-Leased",
          canonicalSemanticObject: { n: 5 },
          at: now,
        })
        expect(leasedClaim.type).toBe("claimed")
        if (leasedClaim.type !== "claimed") {
          throw new Error("expected leased claim")
        }
        const leasedMarked = await service.markCompleted({
          id: leasedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          result_type: "local_mutation_result",
          result_id: "ord_01HCLEAN_L",
          response_status: 200,
          at: now,
        })
        expect(leasedMarked.type).toBe("claimed")
        await forceExpired(leasedClaim.record.id)
        const leaseAt = now
        const leased = await service.claimLifecycleRow({
          id: leasedClaim.record.id,
          expectedState: "completed",
          expectedStateVersion: 2,
          at: leaseAt,
        })
        expect(leased.type).toBe("claimed")

        // --- Seed: expired completed for exact stale-boundary (T+15m) ---
        const staleClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_clean_stale" },
          resourceScope: { cart_id: "cart_clean_stale" },
          rawIdempotencyKey: "Clean-Stale",
          canonicalSemanticObject: { n: 6 },
          at: now,
        })
        expect(staleClaim.type).toBe("claimed")
        if (staleClaim.type !== "claimed") {
          throw new Error("expected stale claim")
        }
        const staleMarked = await service.markCompleted({
          id: staleClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          result_type: "local_mutation_result",
          result_id: "ord_01HCLEAN_S",
          response_status: 200,
          at: now,
        })
        expect(staleMarked.type).toBe("claimed")
        await forceExpired(staleClaim.record.id)
        const staleLeaseAt = addMs(now, -STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS)
        const staleLeased = await service.claimLifecycleRow({
          id: staleClaim.record.id,
          expectedState: "completed",
          expectedStateVersion: 2,
          at: staleLeaseAt,
        })
        expect(staleLeased.type).toBe("claimed")

        const ids = {
          completed: completedClaim.record.id,
          failed_terminal: failedClaim.record.id,
          reconciliation_unresolved: unresolvedClaim.record.id,
          processing: processingClaim.record.id,
          leased: leasedClaim.record.id,
          stale: staleClaim.record.id,
        }

        // Live lease protects leased terminal; unprotected terminals + exact stale delete.
        const firstCleanup = await service.cleanupExpiredTerminals({ now })
        expect(firstCleanup).toBe(4)

        const afterFirst = await dbConnection.raw(
          `select id, state from store_idempotency_record
           where id in (?, ?, ?, ?, ?, ?)
           order by id`,
          [
            ids.completed,
            ids.failed_terminal,
            ids.reconciliation_unresolved,
            ids.processing,
            ids.leased,
            ids.stale,
          ]
        )
        const remainingIds = new Set(
          afterFirst.rows.map((row: { id: string }) => row.id)
        )
        expect(remainingIds.has(ids.completed)).toBe(false)
        expect(remainingIds.has(ids.failed_terminal)).toBe(false)
        expect(remainingIds.has(ids.reconciliation_unresolved)).toBe(false)
        expect(remainingIds.has(ids.stale)).toBe(false)
        expect(remainingIds.has(ids.processing)).toBe(true)
        expect(remainingIds.has(ids.leased)).toBe(true)

        const processingRow = afterFirst.rows.find(
          (row: { id: string; state: string }) => row.id === ids.processing
        )
        expect(processingRow?.state).toBe("processing")

        // Explicit negative: cleanupExpiredTerminals NEVER deletes processing.
        const processingStill = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record
           where id = ? and state = 'processing'`,
          [ids.processing]
        )
        expect(processingStill.rows).toEqual([{ count: 1 }])

        // Fresh lease still protects at T1+14m59s.
        const duringLive = await service.cleanupExpiredTerminals({
          now: addMs(leaseAt, 14 * 60_000 + 59_000),
        })
        expect(duringLive).toBe(0)
        const leasedStill = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record where id = ?`,
          [ids.leased]
        )
        expect(leasedStill.rows).toEqual([{ count: 1 }])

        // Exact stale boundary T+15m deletes the previously leased terminal.
        const atBoundary = await service.cleanupExpiredTerminals({
          now: addMs(leaseAt, STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS),
        })
        expect(atBoundary).toBe(1)
        const leasedGone = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record where id = ?`,
          [ids.leased]
        )
        expect(leasedGone.rows).toEqual([{ count: 0 }])

        // Idempotent second cleanup → 0; processing still preserved.
        const secondCleanup = await service.cleanupExpiredTerminals({
          now: addMs(leaseAt, STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS),
        })
        expect(secondCleanup).toBe(0)
        const processingFinal = await dbConnection.raw(
          `select count(*)::int as count from store_idempotency_record
           where id = ? and state = 'processing'`,
          [ids.processing]
        )
        expect(processingFinal.rows).toEqual([{ count: 1 }])
      })

      it("15) finite lifecycle: non-terminal deadlines and terminal expires_at enforced", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
          actorScope: { customer_id: "cus_finite_01" },
          resourceScope: { cart_id: "cart_finite_01" },
          rawIdempotencyKey: "Finite-Key-01",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }
        expect(claimed.record.state_deadline_at).toBeTruthy()

        await expect(
          service.transitionWithPredicate({
            id: claimed.record.id,
            expectedState: "processing",
            expectedStateVersion: 1,
            next: {
              state: "completed",
              terminalized_at: at,
              // missing expires_at
            },
            at,
          })
        ).rejects.toThrow(/STORE_IDEMPOTENCY_TERMINAL_REQUIRES_EXPIRES_AT/)

        const retryStarted = at
        const retryable = await service.markFailedRetryable({
          id: claimed.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          failure_code: "timeout",
          next_retry_at: addMs(at, 60_000),
          retry_attempt_count: 1,
          retry_started_at: retryStarted,
          state_deadline_at: addMs(at, STORE_IDEMPOTENCY_RETRY_WINDOW_MS),
          at,
        })
        expect(retryable.type).toBe("claimed")
        if (retryable.type !== "claimed") {
          throw new Error("expected retryable")
        }
        expect(retryable.record.next_retry_at).toBeTruthy()
        expect(retryable.record.state_deadline_at).toBeTruthy()
        expect(STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS).toBe(8)
      })

      it("16) retention: completed 24h, reconciliation_unresolved 30d; override supported", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")

        const completedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_ret_01" },
          resourceScope: { cart_id: "cart_ret_01" },
          rawIdempotencyKey: "Retention-Key-01",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(completedClaim.type).toBe("claimed")
        if (completedClaim.type !== "claimed") {
          throw new Error("expected claimed")
        }
        const completed = await service.markCompleted({
          id: completedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          result_type: "local_mutation_result",
          result_id: "ord_01HRET",
          response_status: 200,
          at,
        })
        expect(completed.type).toBe("claimed")
        if (completed.type !== "claimed") {
          throw new Error("expected completed")
        }
        expect(completed.record.expires_at).toBe(
          addMs(at, STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS).toISOString()
        )

        const overrideClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_ret_02" },
          resourceScope: { cart_id: "cart_ret_02" },
          rawIdempotencyKey: "Retention-Key-02",
          canonicalSemanticObject: { n: 2 },
          at,
        })
        expect(overrideClaim.type).toBe("claimed")
        if (overrideClaim.type !== "claimed") {
          throw new Error("expected claimed")
        }
        const overrideMs = 30 * 60 * 1000
        const overridden = await service.markCompleted({
          id: overrideClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          result_type: "local_mutation_result",
          result_id: "ord_01HRETOV",
          response_status: 200,
          retentionMs: overrideMs,
          at,
        })
        expect(overridden.type).toBe("claimed")
        if (overridden.type !== "claimed") {
          throw new Error("expected overridden")
        }
        expect(overridden.record.expires_at).toBe(
          addMs(at, overrideMs).toISOString()
        )

        const unresolvedClaim = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
          actorScope: { customer_id: "cus_ret_03" },
          resourceScope: { cart_id: "cart_ret_03" },
          rawIdempotencyKey: "Retention-Key-03",
          canonicalSemanticObject: { n: 3 },
          at,
        })
        expect(unresolvedClaim.type).toBe("claimed")
        if (unresolvedClaim.type !== "claimed") {
          throw new Error("expected claimed")
        }
        const required = await service.markReconciliationRequired({
          id: unresolvedClaim.record.id,
          expectedState: "processing",
          expectedStateVersion: 1,
          at,
        })
        expect(required.type).toBe("claimed")
        if (required.type !== "claimed") {
          throw new Error("expected required")
        }
        expect(required.record.state_deadline_at).toBe(
          addMs(at, STORE_IDEMPOTENCY_RECONCILIATION_REVIEW_MS).toISOString()
        )
        const unresolved = await service.markReconciliationUnresolved({
          id: unresolvedClaim.record.id,
          expectedState: "reconciliation_required",
          expectedStateVersion: 2,
          at,
        })
        expect(unresolved.type).toBe("claimed")
        if (unresolved.type !== "claimed") {
          throw new Error("expected unresolved")
        }
        expect(unresolved.record.expires_at).toBe(
          addMs(at, STORE_IDEMPOTENCY_UNRESOLVED_RETENTION_MS).toISOString()
        )
      })

      it("17) sensitive persistence canaries are rejected (synthetic only)", async () => {
        const jwt =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"
        const pix = "00020126580014br.gov.bcb.pix0136123"
        expect(() =>
          assertNoSensitiveStoreIdempotencyPersistence({
            result_safe_metadata: { correlation_ref: jwt },
          })
        ).toThrow(/STORE_IDEMPOTENCY_SENSITIVE_VALUE_FORBIDDEN/)
        expect(() =>
          assertNoSensitiveStoreIdempotencyPersistence({
            failure_code: pix,
          })
        ).toThrow(/STORE_IDEMPOTENCY_SENSITIVE_VALUE_FORBIDDEN/)

        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope: { customer_id: "cus_sens_01" },
          resourceScope: { cart_id: "cart_sens_01" },
          rawIdempotencyKey: "Sensitive-Key-01",
          canonicalSemanticObject: { n: 1 },
          at,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        await expect(
          service.markCompleted({
            id: claimed.record.id,
            expectedState: "processing",
            expectedStateVersion: 1,
            result_type: "local_mutation_result",
            result_id: "ord_01HSENS",
            response_status: 200,
            result_safe_metadata: { correlation_ref: jwt },
            at,
          })
        ).rejects.toThrow()
      })

      it("18) persists hashes only: 64-char hex HMAC/fingerprint/scopes; raw key absent", async () => {
        const service = resolveService()
        const at = new Date("2026-08-09T12:00:00.000Z")
        const rawKey = "Hash-Only-Key-XYZ"
        const actorScope = { customer_id: "cus_hash_01" }
        const resourceScope = { cart_id: "cart_hash_01" }
        const semantic = { sku: "TEE-HASH", qty: 2 }

        const claimed = await service.claim({
          operation: STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
          actorScope,
          resourceScope,
          rawIdempotencyKey: rawKey,
          canonicalSemanticObject: semantic,
          at,
        })
        expect(claimed.type).toBe("claimed")
        if (claimed.type !== "claimed") {
          throw new Error("expected claimed")
        }

        const expectedKeyHash = hashStoreIdempotencyKey(rawKey, pepper())
        const expectedActor = hashStoreIdempotencyScope(actorScope)
        const expectedResource = hashStoreIdempotencyScope(resourceScope)
        const expectedFp = buildStoreIdempotencyRequestFingerprint(semantic)

        expect(claimed.record.idempotency_key_hash).toBe(expectedKeyHash)
        expect(claimed.record.idempotency_key_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(claimed.record.actor_scope_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(claimed.record.resource_scope_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(claimed.record.request_fingerprint).toMatch(/^[a-f0-9]{64}$/)
        expect(claimed.record.actor_scope_hash).toBe(expectedActor)
        expect(claimed.record.resource_scope_hash).toBe(expectedResource)
        expect(claimed.record.request_fingerprint).toBe(expectedFp)

        const row = await dbConnection.raw(
          `select * from store_idempotency_record where id = ?`,
          [claimed.record.id]
        )
        const persisted = JSON.stringify(row.rows[0])
        expect(persisted).not.toContain(rawKey)
        expect(persisted).not.toContain(pepper())
        expect(persisted).not.toContain("cus_hash_01")
        expect(Object.keys(row.rows[0])).not.toContain("idempotency_key")
        expect(Object.keys(row.rows[0])).not.toContain("raw_key")
      })
    },
  })
}
