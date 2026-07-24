import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { GELATO_FULFILLMENT_MODULE } from ".."
import { buildGelatoDispatchIdempotencyKey } from "../service"

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
  describe("GelatoFulfillment PostgreSQL routing", () => {
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

  async function insertFulfillment(
    client: Client,
    input: {
      id: string
      order_id: string
      idempotency_key: string
      status?: string
    }
  ) {
    await client.query(
      `
        insert into gelato_fulfillment (
          id, order_id, cart_id, payment_attempt_id, checkout_completion_log_id,
          analytics_event_log_id, email_delivery_log_id, idempotency_key,
          order_reference_id, status, connected_order_ids, request_hash,
          request_summary, recorded_at, created_at, updated_at
        ) values (
          $1, $2, 'cart_gelato_01', 'payatt_gelato_01', 'chkcpl_gelato_01',
          'anlevt_gelato_01', 'emlog_gelato_01', $3,
          $2, $4, '[]'::jsonb, 'hash_gelato_01',
          '{"item_count":1,"currency_code":"BRL"}'::jsonb, now(), now(), now()
        )
      `,
      [
        input.id,
        input.order_id,
        input.idempotency_key,
        input.status ?? "recorded",
      ]
    )
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      it("discovers Migration20260703000000 artifacts including IDX_gelato_fulfillment_order_id_unique", async () => {
        const fs = require("fs") as typeof import("fs")
        const path = require("path") as typeof import("path")
        const migrationSource = fs.readFileSync(
          path.join(__dirname, "../migrations/Migration20260703000000.ts"),
          "utf8"
        )
        expect(migrationSource).toContain("Migration20260703000000")
        expect(migrationSource).toContain("IDX_gelato_fulfillment_order_id_unique")
        expect(migrationSource).toContain(
          "IDX_gelato_fulfillment_idempotency_key_unique"
        )

        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'gelato_fulfillment'
        `)
        const indexes = await dbConnection.raw(`
          select indexname, indexdef
          from pg_indexes
          where schemaname = 'public' and tablename = 'gelato_fulfillment'
          order by indexname
        `)
        const configModule = getContainer().resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as { modules?: Record<string, unknown> }

        expect(table.rows).toEqual([{ table_name: "gelato_fulfillment" }])
        const byName = Object.fromEntries(
          indexes.rows.map((row: { indexname: string; indexdef: string }) => [
            row.indexname,
            row.indexdef,
          ])
        )
        expect(byName).toHaveProperty("IDX_gelato_fulfillment_order_id_unique")
        expect(byName.IDX_gelato_fulfillment_order_id_unique).toMatch(/UNIQUE/i)
        expect(byName.IDX_gelato_fulfillment_order_id_unique).toMatch(/order_id/i)
        expect(byName).toHaveProperty(
          "IDX_gelato_fulfillment_idempotency_key_unique"
        )
        expect(configModule.modules).toHaveProperty(GELATO_FULFILLMENT_MODULE)
      })

      it("rejects concurrent inserts for the same Order leaving one active fulfillment", async () => {
        const orderId = "order_gelato_concurrent_01"
        const idempotencyKey = buildGelatoDispatchIdempotencyKey({
          order_id: orderId,
        })
        const clients = [createAppClient(), createAppClient(), createAppClient()]
        await Promise.all(clients.map((client) => client.connect()))

        let released = false
        const gate = new Promise<void>((resolve) => {
          const poll = () => {
            if (released) {
              resolve()
              return
            }
            setImmediate(poll)
          }
          poll()
        })

        const workers = clients.map((client, index) =>
          (async () => {
            await gate
            try {
              await insertFulfillment(client, {
                id: `gelful_concurrent_${index}`,
                order_id: orderId,
                // Distinct keys so order_id unique is the contested constraint
                idempotency_key: `${idempotencyKey}:${index}`,
                status: "queued",
              })
              return { ok: true as const, index }
            } catch {
              return { ok: false as const, index }
            }
          })()
        )

        released = true
        const results = await Promise.all(workers)
        await Promise.all(clients.map((client) => client.end()))

        expect(results.filter((result) => result.ok)).toHaveLength(1)

        const cardinality = await dbConnection.raw(
          `
            select count(*)::int as count, array_agg(status) as statuses
            from gelato_fulfillment
            where order_id = ?
              and deleted_at is null
          `,
          [orderId]
        )
        expect(cardinality.rows[0].count).toBe(1)
        expect(cardinality.rows[0].statuses).toHaveLength(1)
      })

      it("enforces idempotency_key uniqueness and leaves a canonical final row", async () => {
        const orderId = "order_gelato_idem_01"
        const idempotencyKey = buildGelatoDispatchIdempotencyKey({
          order_id: orderId,
        })
        const client = createAppClient()
        await client.connect()
        try {
          await insertFulfillment(client, {
            id: "gelful_idem_01",
            order_id: orderId,
            idempotency_key: idempotencyKey,
            status: "submitted",
          })

          await expect(
            insertFulfillment(client, {
              id: "gelful_idem_02",
              order_id: "order_gelato_idem_02",
              idempotency_key: idempotencyKey,
              status: "queued",
            })
          ).rejects.toThrow(/unique|duplicate/i)

          const rows = await client.query(
            `
              select id, order_id, idempotency_key, status
              from gelato_fulfillment
              where idempotency_key = $1
                and deleted_at is null
            `,
            [idempotencyKey]
          )
          expect(rows.rows).toEqual([
            {
              id: "gelful_idem_01",
              order_id: orderId,
              idempotency_key: idempotencyKey,
              status: "submitted",
            },
          ])
        } finally {
          await client.end()
        }
      })

      it("never invokes an external Gelato provider in this suite", () => {
        expect(process.env.GELATO_DISPATCH_ENABLED).toBe("false")
        expect(disposableEnvironment.GELATO_DISPATCH_ENABLED).toBe("false")
      })
    },
  })
}
