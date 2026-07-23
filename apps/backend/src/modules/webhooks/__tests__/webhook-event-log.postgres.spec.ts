import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { WEBHOOKS_MODULE } from ".."

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
  describe("WebhookEventLog PostgreSQL routing", () => {
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

  async function insertWebhookRow(
    client: Client,
    input: {
      id: string
      external_event_id: string
      deduplication_key: string
      payload_hash?: string
    }
  ) {
    await client.query(
      `
        insert into webhook_event_log (
          id, provider, external_event_id, event_type, entity_type, payload_hash,
          deduplication_key, status, received_at, created_at, updated_at
        ) values (
          $1, 'stripe', $2, 'payment_intent.succeeded', 'payment_attempt', $3,
          $4, 'received', now(), now(), now()
        )
      `,
      [
        input.id,
        input.external_event_id,
        input.payload_hash ?? `hash_${input.deduplication_key}`,
        input.deduplication_key,
      ]
    )
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      it("discovers WebhookEventLog migration, constraints and indexes", async () => {
        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'webhook_event_log'
        `)
        const indexes = await dbConnection.raw(`
          select indexname
          from pg_indexes
          where schemaname = 'public' and tablename = 'webhook_event_log'
          order by indexname
        `)
        const configModule = getContainer().resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as { modules?: Record<string, unknown> }

        expect(table.rows).toEqual([{ table_name: "webhook_event_log" }])
        expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(
          expect.arrayContaining([
            "IDX_webhook_event_log_provider_deduplication_key_unique",
            "IDX_webhook_event_log_provider_external_event_id_unique",
          ])
        )
        expect(configModule.modules).toHaveProperty(WEBHOOKS_MODULE)
      })

      it("rejects concurrent inserts of the same external event leaving one canonical row", async () => {
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
              await insertWebhookRow(client, {
                id: `whlog_inv04_ext_${index}`,
                external_event_id: "evt_inv04_same_external",
                deduplication_key: `dedupe_ext_${index}`,
              })
              return { ok: true as const, index }
            } catch (error) {
              return { ok: false as const, index, error }
            }
          })()
        )

        released = true
        const results = await Promise.all(workers)
        await Promise.all(clients.map((client) => client.end()))

        const winners = results.filter((result) => result.ok)
        const losers = results.filter((result) => !result.ok)
        expect(winners).toHaveLength(1)
        expect(losers.length).toBeGreaterThanOrEqual(1)

        const cardinality = await dbConnection.raw(`
          select count(*)::int as count
          from webhook_event_log
          where provider = 'stripe'
            and external_event_id = 'evt_inv04_same_external'
            and deleted_at is null
        `)
        expect(cardinality.rows).toEqual([{ count: 1 }])
      })

      it("rejects concurrent inserts of the same deduplication key leaving one canonical fact", async () => {
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
              await insertWebhookRow(client, {
                id: `whlog_inv04_dedupe_${index}`,
                external_event_id: `evt_inv04_dedupe_${index}`,
                deduplication_key: "evt_inv04_canonical_dedupe",
              })
              return { ok: true as const }
            } catch {
              return { ok: false as const }
            }
          })()
        )

        released = true
        const results = await Promise.all(workers)
        await Promise.all(clients.map((client) => client.end()))

        expect(results.filter((result) => result.ok)).toHaveLength(1)

        const rows = await dbConnection.raw(`
          select id, deduplication_key, external_event_id
          from webhook_event_log
          where provider = 'stripe'
            and deduplication_key = 'evt_inv04_canonical_dedupe'
            and deleted_at is null
        `)
        expect(rows.rows).toHaveLength(1)

        const replayClient = createAppClient()
        await replayClient.connect()
        try {
          await expect(
            insertWebhookRow(replayClient, {
              id: "whlog_inv04_replay",
              external_event_id: "evt_inv04_replay",
              deduplication_key: "evt_inv04_canonical_dedupe",
            })
          ).rejects.toThrow(/unique|duplicate/i)
        } finally {
          await replayClient.end()
        }

        const finalCount = await dbConnection.raw(`
          select count(*)::int as count
          from webhook_event_log
          where deduplication_key = 'evt_inv04_canonical_dedupe'
            and deleted_at is null
        `)
        expect(finalCount.rows).toEqual([{ count: 1 }])
      })
    },
  })
}
