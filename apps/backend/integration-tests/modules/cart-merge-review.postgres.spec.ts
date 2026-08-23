import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  createCartMergeFailpoint,
  createCartMergePostgresHarness,
  type CartMergePostgresRawConnection,
} from "../helpers/cart-merge-postgres"

const requestedDatabaseName = process.env.DB_TEMP_NAME

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")

    const safe = (name: unknown) => {
      if (typeof name !== "string" || !/^p12_disposable_[a-z0-9_]+$/.test(name)) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return name
    }

    const maintenance = () =>
      new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName)
        const client = maintenance()
        await client.connect()
        try {
          const found = await client.query(
            "select 1 from pg_database where datname = $1",
            [name]
          )
          if (found.rowCount === 0) {
            await client.query(`create database "${name}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName)
        const client = maintenance()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [name]
          )
          await client.query(`drop database if exists "${name}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

if (!requestedDatabaseName) {
  describe("Cart merge Wave 0 PostgreSQL", () => {
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
    if (typeof value === "string") process.env[name] = value
  }

  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection }) => {
      jest.setTimeout(180_000)

      const connection = dbConnection as unknown as CartMergePostgresRawConnection & {
        transaction<T>(callback: (transaction: CartMergePostgresRawConnection) => Promise<T>): Promise<T>
      }
      let probe: Awaited<ReturnType<typeof createCartMergePostgresHarness>>
      let probeCleaned = false

      const countOrders = async (): Promise<number> => {
        const result = await dbConnection.raw(
          'select count(*)::int as count from "order"'
        )
        return Number(result.rows[0]?.count ?? 0)
      }

      beforeAll(async () => {
        probe = await createCartMergePostgresHarness(connection)
      })

      beforeEach(async () => {
        await probe.clear()
      })

      afterAll(async () => {
        if (
          probe &&
          !probeCleaned &&
          typeof (connection as unknown as { raw?: unknown }).raw === "function"
        ) {
          await probe.cleanup()
        }
      })

      it("prova commit único, ordem Customer→cart e delta de Order zero", async () => {
        const ordersBefore = await countOrders()

        const transactionIds = await connection.transaction(async (transaction) => {
          await transaction.raw(
            "select pg_advisory_xact_lock(hashtextextended(?, 1616))",
            ["cus_p16_wave0_01"]
          )
          await transaction.raw(
            "select pg_advisory_xact_lock(hashtextextended(?, 1515))",
            ["cart_p16_wave0_01"]
          )

          const ids = []
          ids.push(
            await probe.record(transaction, {
              id: "p16_cart_effect_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-key-01",
              stage: "cart",
              state: "processing",
            })
          )
          ids.push(
            await probe.record(transaction, {
              id: "p16_version_effect_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-key-01",
              stage: "version",
              state: "processing",
            })
          )
          ids.push(
            await probe.record(transaction, {
              id: "p16_capability_effect_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-key-01",
              stage: "capability",
              state: "committed",
            })
          )
          ids.push(
            await probe.record(transaction, {
              id: "p16_idempotency_effect_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-key-01",
              stage: "idempotency",
              state: "committed",
            })
          )
          return ids
        })

        expect(new Set(transactionIds)).toEqual(new Set([transactionIds[0]]))
        const rows = await probe.read()
        expect(rows).toHaveLength(4)
        expect(new Set(rows.map((row) => row.transaction_id)).size).toBe(1)
        expect(rows.map((row) => row.stage)).toEqual([
          "cart",
          "version",
          "capability",
          "idempotency",
        ])
        expect(await countOrders()).toBe(ordersBefore)
      })

      it("reverte todos os efeitos do tracer quando o failpoint dispara antes do commit", async () => {
        const ordersBefore = await countOrders()
        const failpoint = createCartMergeFailpoint()
        failpoint.arm()

        await expect(
          connection.transaction(async (transaction) => {
            await probe.record(transaction, {
              id: "p16_rollback_cart_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-rollback-key-01",
              stage: "cart",
              state: "processing",
            })
            await probe.record(transaction, {
              id: "p16_rollback_version_01",
              operation: "CART_MERGE",
              idempotencyKey: "p16-rollback-key-01",
              stage: "version",
              state: "processing",
            })
            failpoint.trip()
          })
        ).rejects.toThrow("P16_CART_MERGE_FAILPOINT")

        expect(await probe.read()).toEqual([])
        expect(await countOrders()).toBe(ordersBefore)
      })

      it("serializa duas tentativas da mesma chave e deixa uma claim e uma replay", async () => {
        const run = (id: string) =>
          connection.transaction(async (transaction) => {
            await transaction.raw(
              "select pg_advisory_xact_lock(hashtextextended(?, 1616))",
              ["cus_p16_same_key_01"]
            )
            await transaction.raw(
              "select pg_advisory_xact_lock(hashtextextended(?, 1515))",
              ["cart_p16_same_key_01"]
            )
            try {
              await probe.record(transaction, {
                id,
                operation: "CART_MERGE",
                idempotencyKey: "p16-same-key-01",
                stage: "idempotency",
                state: "committed",
              })
              return "claim"
            } catch (error) {
              if ((error as { code?: string }).code === "23505") {
                return "replay"
              }
              throw error
            }
          })

        await expect(Promise.all([run("p16_race_a"), run("p16_race_b")])).resolves.toEqual(
          expect.arrayContaining(["claim", "replay"])
        )
        expect(await probe.read()).toHaveLength(1)
      })

      it("limpa exatamente o recurso PostgreSQL registrado pela suite", async () => {
        const cleanup = await probe.cleanup()
        probeCleaned = true
        expect(cleanup.droppedTables).toEqual([probe.tableName])
      })
    },
  })
}
