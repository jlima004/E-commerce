import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { CHECKOUT_COMPLETION_MODULE } from ".."
import {
  CHECKOUT_COMPLETION_STALE_AFTER_MS,
  resolveCheckoutCompletionClaimDecision,
} from "../service"
import { CHECKOUT_COMPLETION_STATUS } from "../types"
import { isCheckoutCompletionLockedStale } from "../staleness"

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
  describe("CheckoutCompletionLog PostgreSQL routing", () => {
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

  async function insertClaim(
    client: Client,
    input: {
      id: string
      idempotency_key: string
      locked_at?: string | null
      status?: string
      order_id?: string | null
    }
  ) {
    await client.query(
      `
        insert into checkout_completion_log (
          id, operation, idempotency_key, cart_id, payment_intent_id,
          payment_attempt_id, order_id, status, locked_at, created_at, updated_at
        ) values (
          $1, 'complete_checkout_create_order', $2, 'cart_ccl_01', 'pi_ccl_01',
          'payatt_ccl_01', $3, $4, $5, now(), now()
        )
      `,
      [
        input.id,
        input.idempotency_key,
        input.order_id ?? null,
        input.status ?? "processing",
        input.locked_at ?? new Date().toISOString(),
      ]
    )
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      it("discovers CheckoutCompletionLog migration and unique/claim indexes", async () => {
        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'checkout_completion_log'
        `)
        const indexes = await dbConnection.raw(`
          select indexname
          from pg_indexes
          where schemaname = 'public' and tablename = 'checkout_completion_log'
          order by indexname
        `)
        const configModule = getContainer().resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as { modules?: Record<string, unknown> }

        expect(table.rows).toEqual([{ table_name: "checkout_completion_log" }])
        expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(
          expect.arrayContaining([
            "IDX_checkout_completion_log_idempotency_key_unique",
            "IDX_checkout_completion_log_status_locked_at",
          ])
        )
        expect(configModule.modules).toHaveProperty(CHECKOUT_COMPLETION_MODULE)
      })

      it("allows exactly one concurrent claim winner for the same idempotency key", async () => {
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
              await insertClaim(client, {
                id: `chkcpl_claim_${index}`,
                idempotency_key: "pi_ccl_concurrent_01",
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

        const cardinality = await dbConnection.raw(`
          select count(*)::int as count
          from checkout_completion_log
          where idempotency_key = 'pi_ccl_concurrent_01'
            and deleted_at is null
        `)
        expect(cardinality.rows).toEqual([{ count: 1 }])
      })

      it("supports recoverable reclaim of stale processing via locked_at and rejects fresh processing", async () => {
        const now = new Date("2026-07-22T15:00:00.000Z")
        const freshLockedAt = new Date(now.getTime() - 5 * 60_000).toISOString()
        const staleLockedAt = new Date(
          now.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS - 1_000
        ).toISOString()

        expect(
          isCheckoutCompletionLockedStale(
            freshLockedAt,
            now,
            CHECKOUT_COMPLETION_STALE_AFTER_MS
          )
        ).toBe(false)
        expect(
          isCheckoutCompletionLockedStale(
            staleLockedAt,
            now,
            CHECKOUT_COMPLETION_STALE_AFTER_MS
          )
        ).toBe(true)

        const freshDecision = resolveCheckoutCompletionClaimDecision({
          existing: {
            id: "chkcpl_fresh",
            operation: "complete_checkout_create_order",
            idempotency_key: "pi_ccl_fresh",
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_fresh",
            payment_attempt_id: "payatt_ccl_01",
            order_id: null,
            status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
            error_code: null,
            error_message: null,
            metadata: null,
            locked_at: freshLockedAt,
            completed_at: null,
            failed_at: null,
            created_at: freshLockedAt,
            updated_at: freshLockedAt,
            deleted_at: null,
          },
          next: {
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_fresh",
            payment_attempt_id: "payatt_ccl_01",
          },
          at: now,
        })
        expect(freshDecision.type).toBe("already_processing")

        const staleDecision = resolveCheckoutCompletionClaimDecision({
          existing: {
            id: "chkcpl_stale",
            operation: "complete_checkout_create_order",
            idempotency_key: "pi_ccl_stale",
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_stale",
            payment_attempt_id: "payatt_ccl_01",
            order_id: null,
            status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
            error_code: null,
            error_message: null,
            metadata: null,
            locked_at: staleLockedAt,
            completed_at: null,
            failed_at: null,
            created_at: staleLockedAt,
            updated_at: staleLockedAt,
            deleted_at: null,
          },
          next: {
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_stale",
            payment_attempt_id: "payatt_ccl_01",
          },
          at: now,
        })
        expect(staleDecision.type).toBe("retry_processing_without_order")

        const failedDecision = resolveCheckoutCompletionClaimDecision({
          existing: {
            id: "chkcpl_failed",
            operation: "complete_checkout_create_order",
            idempotency_key: "pi_ccl_failed",
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_failed",
            payment_attempt_id: "payatt_ccl_01",
            order_id: null,
            status: CHECKOUT_COMPLETION_STATUS.FAILED,
            error_code: "CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER",
            error_message: "retryable",
            metadata: null,
            locked_at: staleLockedAt,
            completed_at: null,
            failed_at: now.toISOString(),
            created_at: staleLockedAt,
            updated_at: now.toISOString(),
            deleted_at: null,
          },
          next: {
            cart_id: "cart_ccl_01",
            payment_intent_id: "pi_ccl_failed",
            payment_attempt_id: "payatt_ccl_01",
          },
          at: now,
        })
        expect(failedDecision.type).toBe("retry_failed")

        // Prove reclaim clock is locked_at, not PaymentAttempt.updated_at
        const fs = require("fs") as typeof import("fs")
        const path = require("path") as typeof import("path")
        const source = fs.readFileSync(
          path.join(__dirname, "../service.ts"),
          "utf8"
        )
        expect(source).toMatch(/locked_at/)
        expect(source).not.toMatch(/PaymentAttempt\.updated_at/)
        expect(source).toMatch(/isCheckoutCompletionLockedStale/)
      })

      it("persists a recoverable failed claim and allows a later processing reclaim row update", async () => {
        const client = createAppClient()
        await client.connect()
        try {
          await insertClaim(client, {
            id: "chkcpl_recover_01",
            idempotency_key: "pi_ccl_recover_01",
            status: "failed",
            locked_at: "2026-07-22T12:00:00.000Z",
          })

          await client.query(
            `
              update checkout_completion_log
              set status = 'processing',
                  locked_at = $2,
                  failed_at = null,
                  error_code = null,
                  error_message = null,
                  updated_at = now()
              where id = $1
            `,
            ["chkcpl_recover_01", "2026-07-22T15:00:00.000Z"]
          )

          const row = await client.query(
            `
              select status, locked_at is not null as has_locked_at, order_id
              from checkout_completion_log
              where idempotency_key = 'pi_ccl_recover_01'
            `
          )
          expect(row.rows).toEqual([
            {
              status: "processing",
              has_locked_at: true,
              order_id: null,
            },
          ])
        } finally {
          await client.end()
        }
      })
    },
  })
}
