import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"

jest.mock(
  "pg-god",
  () => {
    const { Client } = jest.requireActual("pg") as typeof import("pg")

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
      return new Client({
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
  describe("disposable PostgreSQL harness routing", () => {
    it("requires the disposable runner for the real PostgreSQL gate", () => {
      expect(() =>
        requireDisposableDatabaseName(requestedDatabaseName)
      ).toThrow("P12_DISPOSABLE_DATABASE_NAME_REQUIRED")
    })
  })
} else {
  const disposableMedusaEnvironment = buildDisposableMedusaEnvironment(
    process.env
  )
  assertDisposableMedusaEnvironment(disposableMedusaEnvironment)

  for (const [name, value] of Object.entries(disposableMedusaEnvironment)) {
    if (value !== undefined) {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")

  jest.setTimeout(120_000)

  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  console.info(`[P12_DISPOSABLE_POSTGRES_SUITE] target=${databaseName}`)

function collectResolveValues(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectResolveValues(entry, result)
    }
    return result
  }

  if (!value || typeof value !== "object") {
    return result
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "resolve" && typeof entry === "string") {
      result.push(entry)
    } else {
      collectResolveValues(entry, result)
    }
  }

  return result
}

describe("disposable Medusa environment preflight", () => {
  it("sanitizes Redis and provider contracts before application bootstrap", () => {
    expect(disposableMedusaEnvironment).toMatchObject({
      NODE_ENV: "test",
      WORKER_MODE: "shared",
      DB_TEMP_NAME: databaseName,
      REDIS_URL: "",
      CACHE_REDIS_URL: "",
      EVENTS_REDIS_URL: "",
      WE_REDIS_URL: "",
      DTC_RELEASE_MIGRATION_MODE: "",
      DTC_RELEASE_MIGRATION_CHILD_PROCESS: "",
      STRIPE_REAL_INITIATION_ENABLED: "false",
      STRIPE_WEBHOOK_INGESTION_ENABLED: "false",
      RESEND_ORDER_CONFIRMATION_ENABLED: "false",
      GELATO_DISPATCH_ENABLED: "false",
    })
  })
})

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableMedusaEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, dbConfig, getContainer }) => {
    it("uses the explicitly named disposable database", async () => {
      const current = await dbConnection.raw(
        "select current_database() as database_name"
      )

      expect(dbConfig.dbName).toBe(databaseName)
      expect(current.rows).toEqual([{ database_name: databaseName }])
    })

    it("uses only local or in-memory infrastructure doubles", () => {
      const configModule = getContainer().resolve(
        ContainerRegistrationKeys.CONFIG_MODULE
      ) as { modules?: unknown }
      const resolves = collectResolveValues(configModule.modules)

      expect(resolves).toEqual(
        expect.arrayContaining([
          "@medusajs/medusa/cache-inmemory",
          "@medusajs/medusa/event-bus-local",
          "@medusajs/medusa/workflow-engine-inmemory",
          "@medusajs/medusa/locking",
        ])
      )
      for (const forbiddenResolve of [
        "@medusajs/medusa/caching",
        "@medusajs/caching-redis",
        "@medusajs/medusa/locking-redis",
        "@medusajs/medusa/event-bus-redis",
        "@medusajs/medusa/workflow-engine-redis",
      ]) {
        expect(resolves).not.toContain(forbiddenResolve)
      }
    })

    it("discovers the WebhookEventLog, CheckoutCompletionLog and GelatoFulfillment migrations", async () => {
      const tables = await dbConnection.raw(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'webhook_event_log',
            'checkout_completion_log',
            'gelato_fulfillment'
          )
        order by table_name
      `)
      const indexes = await dbConnection.raw(`
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'IDX_webhook_event_log_provider_deduplication_key_unique',
            'IDX_checkout_completion_log_idempotency_key_unique',
            'IDX_gelato_fulfillment_order_id_unique'
          )
        order by indexname
      `)

      expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual([
        "checkout_completion_log",
        "gelato_fulfillment",
        "webhook_event_log",
      ])
      expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual([
        "IDX_checkout_completion_log_idempotency_key_unique",
        "IDX_gelato_fulfillment_order_id_unique",
        "IDX_webhook_event_log_provider_deduplication_key_unique",
      ])
    })

    it("writes a fixture that the runner must isolate from the next case", async () => {
      await dbConnection.raw(`
        insert into webhook_event_log (
          id, provider, event_type, entity_type, payload_hash,
          deduplication_key, status, received_at, created_at, updated_at
        ) values (
          'whlog_p12_fixture', 'stripe', 'payment_intent.succeeded',
          'payment_attempt', 'hash_p12_fixture', 'evt_p12_fixture',
          'received', now(), now(), now()
        )
      `)

      const fixture = await dbConnection.raw(
        "select count(*)::int as count from webhook_event_log where id = 'whlog_p12_fixture'"
      )
      expect(fixture.rows).toEqual([{ count: 1 }])
    })

    it("starts the following case with the prior fixture removed", async () => {
      const fixture = await dbConnection.raw(
        "select count(*)::int as count from webhook_event_log where id = 'whlog_p12_fixture'"
      )

      expect(fixture.rows).toEqual([{ count: 0 }])
    })
    },
  })
}
