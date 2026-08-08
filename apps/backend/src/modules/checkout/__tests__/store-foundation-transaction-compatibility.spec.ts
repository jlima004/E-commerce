import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { CHECKOUT_COMPLETION_MODULE } from "../../checkout-completion"
import {
  STORE_FOUNDATION_CAS_CONFLICT,
  STORE_FOUNDATION_INJECTED_FAILURE,
  STORE_FOUNDATION_LOCKING_UNAVAILABLE,
  STORE_FOUNDATION_PROBE_MUTATION_TABLE,
  STORE_FOUNDATION_PROBE_VERSION_TABLE,
  competeStoreFoundationCasWriters,
  countStoreFoundationProbeMutations,
  createFailingRedisLockingCoordinator,
  ensureStoreFoundationProbeTables,
  readStoreFoundationProbeVersion,
  runAtomicMedusaMutationWithVersionCas,
  seedStoreFoundationProbeVersion,
  type SharedTransactionContext,
  type TransactionalRepositoryLike,
} from "../../../infrastructure/store-foundation-transaction-compatibility"

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

type CheckoutCompletionServiceLike = {
  baseRepository_: TransactionalRepositoryLike
  createCheckoutCompletionLogs: (
    data: Record<string, unknown> | Record<string, unknown>[],
    sharedContext?: SharedTransactionContext
  ) => Promise<unknown>
}

if (!requestedDatabaseName) {
  describe("Store foundation transaction compatibility Wave 0", () => {
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

  jest.setTimeout(120_000)

  function createAppClient() {
    return new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: databaseName,
    })
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      function resolveCheckoutCompletionService(): CheckoutCompletionServiceLike {
        return getContainer().resolve(
          CHECKOUT_COMPLETION_MODULE
        ) as CheckoutCompletionServiceLike
      }

      function repository(): TransactionalRepositoryLike {
        return resolveCheckoutCompletionService().baseRepository_
      }

      function medusaMutationFor(
        paymentIntentId: string
      ): (sharedContext: SharedTransactionContext) => Promise<void> {
        return async (sharedContext) => {
          const service = resolveCheckoutCompletionService()
          await service.createCheckoutCompletionLogs(
            {
              operation: "complete_checkout_create_order",
              idempotency_key: paymentIntentId,
              cart_id: "cart_wave0_probe",
              payment_intent_id: paymentIntentId,
              payment_attempt_id: "payatt_wave0_probe",
              status: "processing",
              locked_at: new Date().toISOString(),
            },
            sharedContext
          )
        }
      }

      async function externalKnex() {
        const manager = repository().getActiveManager()
        const knex =
          (
            manager as {
              getKnex?: () => {
                raw: (
                  sql: string,
                  bindings?: unknown[]
                ) => Promise<{ rows: Array<Record<string, unknown>> }>
                schema: {
                  hasTable: (name: string) => Promise<boolean>
                  createTable: (...args: unknown[]) => Promise<unknown>
                  dropTableIfExists: (name: string) => Promise<unknown>
                }
                fn?: { now: () => unknown }
              }
            }
          ).getKnex?.() ?? null
        if (!knex) {
          throw new Error("STORE_FOUNDATION_TEST_KNEX_UNAVAILABLE")
        }
        return knex
      }

      beforeEach(async () => {
        const knex = await externalKnex()
        await ensureStoreFoundationProbeTables(knex)
        await knex.raw(`delete from ${STORE_FOUNDATION_PROBE_MUTATION_TABLE}`)
        await knex.raw(`delete from ${STORE_FOUNDATION_PROBE_VERSION_TABLE}`)
        await dbConnection.raw(`
          delete from checkout_completion_log
          where cart_id = 'cart_wave0_probe'
             or payment_intent_id like 'pi_wave0_%'
        `)
      })

      it("proves Redis contracts are absent in the disposable environment", () => {
        expect(process.env.REDIS_URL).toBe("")
        expect(process.env.CACHE_REDIS_URL).toBe("")
        expect(process.env.EVENTS_REDIS_URL).toBe("")
        expect(process.env.WE_REDIS_URL).toBe("")
      })

      it("commits Medusa mutation + version CAS on the same transaction manager", async () => {
        const knex = await externalKnex()
        const resourceKey = "resource_wave0_commit"
        await seedStoreFoundationProbeVersion(knex, resourceKey, 1)

        const result = await runAtomicMedusaMutationWithVersionCas({
          repository: repository(),
          medusaMutation: medusaMutationFor("pi_wave0_commit_01"),
          resourceKey,
          expectedVersion: 1,
          mutationId: "probe_mut_commit_01",
          mutationMarker: "commit",
          locking: createFailingRedisLockingCoordinator(),
        })

        expect(result.sameManager).toBe(true)
        expect(result.sameTransactionId).toBe(true)
        expect(result.transactionManagerIdentity).toBe(
          result.mutationManagerIdentity
        )
        expect(result.transactionManagerIdentity).toBe(result.casManagerIdentity)
        expect(result.casWon).toBe(true)
        expect(result.newVersion).toBe(2)

        expect(await readStoreFoundationProbeVersion(knex, resourceKey)).toBe(2)
        expect(await countStoreFoundationProbeMutations(knex, resourceKey)).toBe(
          1
        )

        const medusaRows = await dbConnection.raw(`
          select count(*)::int as count
          from checkout_completion_log
          where payment_intent_id = 'pi_wave0_commit_01'
            and deleted_at is null
        `)
        expect(medusaRows.rows).toEqual([{ count: 1 }])
      })

      it("rolls back Medusa mutation and CAS together when failure is injected after successful CAS", async () => {
        const knex = await externalKnex()
        const resourceKey = "resource_wave0_rollback"
        await seedStoreFoundationProbeVersion(knex, resourceKey, 3)

        let casSucceededInsideTransaction = false
        let casObservedVersion: number | null = null
        let casObservedTxId: string | null = null

        await expect(
          runAtomicMedusaMutationWithVersionCas({
            repository: repository(),
            medusaMutation: medusaMutationFor("pi_wave0_rollback_01"),
            resourceKey,
            expectedVersion: 3,
            mutationId: "probe_mut_rollback_01",
            mutationMarker: "rollback",
            injectErrorAfterCas: true,
            onCasSucceeded: ({ previousVersion, newVersion, casTransactionId }) => {
              expect(previousVersion).toBe(3)
              expect(newVersion).toBe(4)
              expect(casTransactionId.length).toBeGreaterThan(0)
              casSucceededInsideTransaction = true
              casObservedVersion = newVersion
              casObservedTxId = casTransactionId
            },
          })
        ).rejects.toThrow(STORE_FOUNDATION_INJECTED_FAILURE)

        // CAS must have executed successfully inside the transaction before failure.
        expect(casSucceededInsideTransaction).toBe(true)
        expect(casObservedVersion).toBe(4)
        expect(casObservedTxId).not.toBeNull()

        // After ROLLBACK, all three effects disappear — including the CAS bump.
        expect(await readStoreFoundationProbeVersion(knex, resourceKey)).toBe(3)
        expect(await countStoreFoundationProbeMutations(knex, resourceKey)).toBe(
          0
        )

        const medusaRows = await dbConnection.raw(`
          select count(*)::int as count
          from checkout_completion_log
          where payment_intent_id = 'pi_wave0_rollback_01'
            and deleted_at is null
        `)
        expect(medusaRows.rows).toEqual([{ count: 0 }])
      })

      it("allows exactly one CAS winner for two writers with the same expected version", async () => {
        const knex = await externalKnex()
        const resourceKey = "resource_wave0_cas"
        await seedStoreFoundationProbeVersion(knex, resourceKey, 10)

        const results = await competeStoreFoundationCasWriters({
          repositoryFactory: () => repository(),
          medusaMutationFactory: (index) =>
            medusaMutationFor(`pi_wave0_cas_${index}`),
          resourceKey,
          expectedVersion: 10,
          lockingFactory: () => createFailingRedisLockingCoordinator(),
          writerCount: 2,
        })

        const winners = results.filter((result) => result.ok)
        const losers = results.filter((result) => !result.ok)

        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(1)
        expect(losers[0].errorCode).toBe(STORE_FOUNDATION_CAS_CONFLICT)
        expect(winners[0].result?.sameManager).toBe(true)
        expect(winners[0].result?.sameTransactionId).toBe(true)
        expect(winners[0].result?.newVersion).toBe(11)

        expect(await readStoreFoundationProbeVersion(knex, resourceKey)).toBe(11)
        expect(await countStoreFoundationProbeMutations(knex, resourceKey)).toBe(
          1
        )

        const medusaRows = await dbConnection.raw(`
          select count(*)::int as count
          from checkout_completion_log
          where payment_intent_id in ('pi_wave0_cas_0', 'pi_wave0_cas_1')
            and deleted_at is null
        `)
        expect(medusaRows.rows).toEqual([{ count: 1 }])
      })

      it("keeps PostgreSQL CAS correct when Redis locking is unavailable", async () => {
        const knex = await externalKnex()
        const resourceKey = "resource_wave0_redis"
        await seedStoreFoundationProbeVersion(knex, resourceKey, 1)

        const locking = createFailingRedisLockingCoordinator()
        await expect(locking.acquire!("resource_wave0_redis")).rejects.toThrow(
          STORE_FOUNDATION_LOCKING_UNAVAILABLE
        )

        const result = await runAtomicMedusaMutationWithVersionCas({
          repository: repository(),
          medusaMutation: medusaMutationFor("pi_wave0_redis_01"),
          resourceKey,
          expectedVersion: 1,
          mutationId: "probe_mut_redis_01",
          mutationMarker: "redis_absent",
          locking,
        })

        expect(result.casWon).toBe(true)
        expect(result.sameManager).toBe(true)
        expect(await readStoreFoundationProbeVersion(knex, resourceKey)).toBe(2)

        // Probe tables are disposable-only; no product migration created them.
        const migrationProbe = await dbConnection.raw(
          `
            select count(*)::int as count
            from information_schema.tables
            where table_schema = 'public'
              and table_name in (?, ?)
          `,
          [
            STORE_FOUNDATION_PROBE_MUTATION_TABLE,
            STORE_FOUNDATION_PROBE_VERSION_TABLE,
          ]
        )
        expect(migrationProbe.rows[0].count).toBeGreaterThanOrEqual(2)
      })

      it("exposes disposable probe tables without requiring a product migration", async () => {
        const tables = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public'
            and table_name in (
              '${STORE_FOUNDATION_PROBE_MUTATION_TABLE}',
              '${STORE_FOUNDATION_PROBE_VERSION_TABLE}'
            )
          order by table_name
        `)
        expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual(
          [
            STORE_FOUNDATION_PROBE_MUTATION_TABLE,
            STORE_FOUNDATION_PROBE_VERSION_TABLE,
          ]
        )

        const clients = [createAppClient(), createAppClient()]
        await Promise.all(clients.map((client) => client.connect()))
        await Promise.all(clients.map((client) => client.end()))
      })
    },
  })
}
