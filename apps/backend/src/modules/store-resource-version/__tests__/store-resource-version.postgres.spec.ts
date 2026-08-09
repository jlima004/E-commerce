import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  identifyTransactionManager,
  resolveTransactionalKnex,
  type SharedTransactionContext,
  type TransactionalRepositoryLike,
} from "../../../infrastructure/store-foundation-transaction-compatibility"
import {
  STORE_RESOURCE_VERSION_MODULE,
  STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED,
  STORE_RESOURCE_VERSION_WRITE_FORBIDDEN,
  type StoreResourceVersionModuleService,
} from ".."
import { Migration20260809175009 } from "../migrations/Migration20260809175009"

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

type StoreResourceVersionServiceLike = StoreResourceVersionModuleService & {
  baseRepository_: TransactionalRepositoryLike
}

if (!requestedDatabaseName) {
  describe("StoreResourceVersion PostgreSQL", () => {
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

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const resolveVersionService = () =>
        getContainer().resolve(
          STORE_RESOURCE_VERSION_MODULE
        ) as StoreResourceVersionServiceLike

      const repository = () => resolveVersionService().baseRepository_

      const sharedContext = (
        transactionManager: Parameters<TransactionalRepositoryLike["transaction"]>[0] extends (
          manager: infer T
        ) => Promise<unknown>
          ? T
          : never
      ): SharedTransactionContext => ({
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      })

      const inTransaction = <T>(
        task: (context: SharedTransactionContext) => Promise<T>
      ) =>
        repository().transaction(async (transactionManager) =>
          task(sharedContext(transactionManager))
        )

      const createControlledMutation = async (
        entityId: string,
        context: SharedTransactionContext
      ) => {
        await resolveVersionService().initialize(
          "mutation_probe",
          entityId,
          context
        )
      }

      const readVersion = async (resourceType: string, resourceId: string) => {
        const result = await dbConnection.raw(
          `
            select version::text as version
            from store_resource_version
            where resource_type = ? and resource_id = ? and deleted_at is null
          `,
          [resourceType, resourceId]
        )
        return result.rows[0] ? BigInt(String(result.rows[0].version)) : null
      }

      const countControlledMutations = async (prefix: string) => {
        const result = await dbConnection.raw(
          `
            select count(*)::int as count
            from store_resource_version
            where resource_type = 'mutation_probe'
              and resource_id like ? and deleted_at is null
          `,
          [`${prefix}%`]
        )
        return Number(result.rows[0].count)
      }

      beforeEach(async () => {
        await dbConnection.raw(`delete from store_resource_version`)
      })

      it("applies the exact bigint, positive-version, and non-partial unique catalog contract", async () => {
        const columns = await dbConnection.raw(`
          select column_name, udt_name
          from information_schema.columns
          where table_schema = 'public' and table_name = 'store_resource_version'
          order by column_name
        `)
        expect(columns.rows).toEqual(
          expect.arrayContaining([
            { column_name: "id", udt_name: "text" },
            { column_name: "resource_type", udt_name: "text" },
            { column_name: "resource_id", udt_name: "text" },
            { column_name: "version", udt_name: "int8" },
          ])
        )

        const uniqueIndex = await dbConnection.raw(`
          select i.indisunique, i.indpred,
                 json_agg(a.attname order by u.ord) as ordered_columns
          from pg_index i
          join pg_class idx on idx.oid = i.indexrelid
          join pg_class tbl on tbl.oid = i.indrelid
          join pg_namespace n on n.oid = tbl.relnamespace
          join lateral unnest(i.indkey) with ordinality as u(attnum, ord) on true
          join pg_attribute a on a.attrelid = tbl.oid and a.attnum = u.attnum
          where n.nspname = 'public'
            and tbl.relname = 'store_resource_version'
            and idx.relname = 'UQ_store_resource_version_resource'
          group by i.indisunique, i.indpred, i.indexrelid
        `)
        expect(uniqueIndex.rows).toHaveLength(1)
        expect(uniqueIndex.rows[0].indisunique).toBe(true)
        expect(uniqueIndex.rows[0].indpred).toBeNull()
        expect(uniqueIndex.rows[0].ordered_columns).toEqual([
          "resource_type",
          "resource_id",
        ])

        const check = await dbConnection.raw(`
          select pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conrelid = 'store_resource_version'::regclass
            and conname = 'store_resource_version_version_check'
        `)
        expect(check.rows).toHaveLength(1)
        expect(String(check.rows[0].definition)).toMatch(/version\s*>\s*0/i)
      })

      it("fails closed without a real shared Medusa transaction", async () => {
        const service = resolveVersionService()
        await expect(service.initialize("product", "prod_no_tx")).rejects.toThrow(
          STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED
        )
        await expect(
          service.initialize("product", "prod_fake_tx", {
            __type: "MedusaContext",
            transactionManager: {},
            manager: {},
          })
        ).rejects.toThrow(STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED)
        expect(await readVersion("product", "prod_no_tx")).toBeNull()
        expect(await readVersion("product", "prod_fake_tx")).toBeNull()
      })

      it("blocks every MedusaService-generated write path even with a transaction", async () => {
        const service = resolveVersionService()
        const generatedWrites = [
          (context: SharedTransactionContext) =>
            service.createStoreResourceVersions(
              {
                resource_type: "bypass",
                resource_id: "create",
                version: 10,
              },
              context
            ),
          (context: SharedTransactionContext) =>
            service.updateStoreResourceVersions(
              {
                id: "strver_bypass",
                version: 1,
              },
              context
            ),
          (context: SharedTransactionContext) =>
            service.deleteStoreResourceVersions("strver_bypass", context),
          (context: SharedTransactionContext) =>
            service.softDeleteStoreResourceVersions(
              "strver_bypass",
              {},
              context
            ),
          (context: SharedTransactionContext) =>
            service.restoreStoreResourceVersions(
              "strver_bypass",
              {},
              context
            ),
        ]

        for (const generatedWrite of generatedWrites) {
          await expect(
            inTransaction((context) => generatedWrite(context))
          ).rejects.toThrow(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
        }

        const rows = await dbConnection.raw(
          `select count(*)::int as count from store_resource_version`
        )
        expect(rows.rows).toEqual([{ count: 0 }])
      })

      it("bootstraps lazily at version 1 and isolates resource scopes", async () => {
        await inTransaction(async (context) => {
          const service = resolveVersionService()
          expect((await service.initialize("product", "prod_a", context)).version).toBe(1n)
          expect((await service.initialize("product", "prod_a", context)).version).toBe(1n)
          expect((await service.initialize("product", "prod_b", context)).version).toBe(1n)
          expect((await service.initialize("variant", "prod_a", context)).version).toBe(1n)
        })

        const count = await dbConnection.raw(
          `select count(*)::int as count from store_resource_version`
        )
        expect(count.rows).toEqual([{ count: 3 }])
      })

      it("serializes concurrent first access into one version-1 row", async () => {
        const results = await Promise.all([
          inTransaction((context) =>
            resolveVersionService().initialize("product", "prod_first", context)
          ),
          inTransaction((context) =>
            resolveVersionService().initialize("product", "prod_first", context)
          ),
        ])
        expect(results.map((result) => result.version)).toEqual([1n, 1n])
        const count = await dbConnection.raw(
          `select count(*)::int as count from store_resource_version where resource_type = 'product' and resource_id = 'prod_first'`
        )
        expect(count.rows).toEqual([{ count: 1 }])
      })

      it("increments monotonically and rejects stale writes before mutation", async () => {
        await inTransaction((context) =>
          resolveVersionService().initialize("product", "prod_monotonic", context)
        )

        const first = await inTransaction((context) =>
          resolveVersionService().compareAndSwapWithMutation({
            resourceType: "product",
            resourceId: "prod_monotonic",
            expectedVersion: 1n,
            sharedContext: context,
            mutate: async (sameContext) =>
              createControlledMutation("strver_test_monotonic_1", sameContext),
          })
        )
        expect(first.type).toBe("updated")
        expect(first.type === "updated" && first.version).toBe(2n)

        let staleMutationRan = false
        const stale = await inTransaction((context) =>
          resolveVersionService().compareAndSwapWithMutation({
            resourceType: "product",
            resourceId: "prod_monotonic",
            expectedVersion: 1n,
            sharedContext: context,
            mutate: async () => {
              staleMutationRan = true
            },
          })
        )
        expect(stale.type).toBe("stale")
        expect(stale.type === "stale" && stale.actualVersion).toBe(2n)
        expect(staleMutationRan).toBe(false)
        expect(await readVersion("product", "prod_monotonic")).toBe(2n)
        expect(await countControlledMutations("strver_test_monotonic_")).toBe(1)
      })

      it("allows exactly one winner for two writers with the same expected version", async () => {
        await inTransaction((context) =>
          resolveVersionService().initialize("product", "prod_cas", context)
        )

        const results = await Promise.all(
          [0, 1].map((writer) =>
            inTransaction((context) =>
              resolveVersionService().compareAndSwapWithMutation({
                resourceType: "product",
                resourceId: "prod_cas",
                expectedVersion: 1n,
                sharedContext: context,
                mutate: async (sameContext) =>
                  createControlledMutation(`strver_test_cas_${writer}`, sameContext),
              })
            )
          )
        )
        expect(results.filter((result) => result.type === "updated")).toHaveLength(1)
        expect(results.filter((result) => result.type === "stale")).toHaveLength(1)
        expect(await readVersion("product", "prod_cas")).toBe(2n)
        expect(await countControlledMutations("strver_test_cas_")).toBe(1)
      })

      it("shares one manager with the Medusa mutation and rolls both effects back on failure", async () => {
        let managerIdentity: string | null = null
        let mutationIdentity: string | null = null
        let transactionId: string | null = null
        let mutationTransactionId: string | null = null

        await expect(
          inTransaction(async (context) => {
            managerIdentity = identifyTransactionManager(context.transactionManager)
            transactionId = String(
              (
                await resolveTransactionalKnex(context.transactionManager).raw(
                  `select txid_current()::text as txid`
                )
              ).rows?.[0]?.txid
            )
            const result = await resolveVersionService().compareAndSwapWithMutation({
              resourceType: "product",
              resourceId: "prod_rollback",
              expectedVersion: 1n,
              sharedContext: context,
              mutate: async (sameContext) => {
                mutationIdentity = identifyTransactionManager(
                  sameContext.transactionManager
                )
                mutationTransactionId = String(
                  (
                    await resolveTransactionalKnex(
                      sameContext.transactionManager
                    ).raw(`select txid_current()::text as txid`)
                  ).rows?.[0]?.txid
                )
                await createControlledMutation(
                  "strver_test_rollback_1",
                  sameContext
                )
              },
            })
            expect(result.type).toBe("updated")
            expect(result.transactionManagerIdentity).toBe(managerIdentity)
            throw new Error("STORE_RESOURCE_VERSION_INJECTED_FAILURE")
          })
        ).rejects.toThrow("STORE_RESOURCE_VERSION_INJECTED_FAILURE")

        expect(mutationIdentity).toBe(managerIdentity)
        expect(mutationTransactionId).toBe(transactionId)
        expect(await readVersion("product", "prod_rollback")).toBeNull()
        expect(await countControlledMutations("strver_test_rollback_")).toBe(0)
      })

      it("keeps PostgreSQL authoritative with Redis absent and supports migration down/reapply", async () => {
        expect(process.env.REDIS_URL).toBe("")
        expect(process.env.CACHE_REDIS_URL).toBe("")
        expect(process.env.EVENTS_REDIS_URL).toBe("")
        expect(process.env.WE_REDIS_URL).toBe("")

        const result = await inTransaction((context) =>
          resolveVersionService().increment("product", "prod_no_redis", 1n, context)
        )
        expect(result.type).toBe("updated")
        expect(await readVersion("product", "prod_no_redis")).toBe(2n)

        const collectSql = async (method: "up" | "down") => {
          const statements: string[] = []
          const migrationMethod = Migration20260809175009.prototype[method] as unknown as (
            this: { addSql: (sql: string) => void }
          ) => Promise<void>
          await migrationMethod.call({
            addSql: (sql: string) => statements.push(sql),
          })
          return statements
        }

        for (const statement of await collectSql("down")) {
          await dbConnection.raw(statement)
        }
        const absent = await dbConnection.raw(`
          select to_regclass('public.store_resource_version') as table_name
        `)
        expect(absent.rows).toEqual([{ table_name: null }])

        for (const statement of await collectSql("up")) {
          await dbConnection.raw(statement)
        }
        const reapplied = await dbConnection.raw(`
          select to_regclass('public.store_resource_version')::text as table_name
        `)
        expect(reapplied.rows).toEqual([{ table_name: "store_resource_version" }])

        const checkoutCount = await dbConnection.raw(
          `select count(*)::int as count from checkout_completion_log`
        )
        expect(checkoutCount.rows).toEqual([{ count: 0 }])
      })
    },
  })
}
