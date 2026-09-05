import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { CHECKOUT_COMPLETION_MODULE } from ".."
import {
  acquireCheckoutOrderBirthAuthorityInTransaction,
  readCheckoutOrderBirthAuthorityInTransaction,
  markOrderBirthExecutionStartedInTransaction,
  bindRecoveredOrderInTransaction,
  markReconciliationRequiredInTransaction,
  markCompletedInTransaction,
  CheckoutCompletionAuthorityConflictError,
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

  jest.setTimeout(180_000)

  function assertNoStripeNetwork() {
    expect(process.env.STRIPE_SECRET_KEY).toBe("")
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe("")
    expect(process.env.STRIPE_REAL_INITIATION_ENABLED).toBe("false")
    expect(disposableEnvironment.STRIPE_SECRET_KEY).toBe("")
  }

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
          $1, 'complete_checkout_create_order', $2, $3, $4,
          $5, $6, $7, $8, now(), now()
        )
      `,
      [
        input.id,
        input.idempotency_key,
        `cart_${input.idempotency_key}`,
        `pi_${input.idempotency_key}`,
        `payatt_${input.idempotency_key}`,
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
            "UQ_checkout_completion_log_operation_idempotency_key",
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

      function makeTrxAdapter(client: Client) {
        return {
          raw: async (sql: string, bindings: unknown[] = []) => {
            let index = 0
            const pgSql = sql.replace(/\?/g, () => `$${++index}`)
            const res = await client.query(pgSql, bindings)
            return { rows: res.rows }
          },
        }
      }

      it("A1 & A2: two independent PostgreSQL connections racing for same cart authority produce exactly one CCL and one winner with reuse", async () => {
        const clientA = createAppClient()
        const clientB = createAppClient()
        await Promise.all([clientA.connect(), clientB.connect()])

        try {
          const cartId = "cart_concurrency_race_01"
          const paymentAttemptId = "payatt_race_01"
          const paymentIntentId = "pi_race_01"

          let release = false
          const gate = new Promise<void>((resolve) => {
            const poll = () => {
              if (release) return resolve()
              setImmediate(poll)
            }
            poll()
          })

          const workers = [clientA, clientB].map((client) =>
            (async () => {
              await gate
              return acquireCheckoutOrderBirthAuthorityInTransaction(
                makeTrxAdapter(client),
                {
                  cart_id: cartId,
                  payment_attempt_id: paymentAttemptId,
                  payment_intent_id: paymentIntentId,
                }
              )
            })()
          )

          release = true
          const results = await Promise.all(workers)

          const actions = results.map((r) => r.action).sort()
          expect(actions).toEqual(["created", "reused"])
          expect(results[0].authority.id).toBe(results[1].authority.id)
          expect(results[0].authority.cart_id).toBe(cartId)

          const countRes = await clientA.query(
            "select count(*)::int as count from checkout_completion_log where cart_id = $1",
            [cartId]
          )
          expect(countRes.rows[0].count).toBe(1)
        } finally {
          await Promise.all([clientA.end(), clientB.end()])
        }
      })

      it("A3: soft-deleted authority survives in DB and prevents second authority creation for same cart", async () => {
        const client = createAppClient()
        await client.connect()
        try {
          const cartId = "cart_soft_delete_survive_01"
          const paymentAttemptId = "payatt_sd_01"
          const paymentIntentId = "pi_sd_01"

          // Insert a soft-deleted CCL row
          await client.query(
            `
              insert into checkout_completion_log (
                id, operation, idempotency_key, cart_id, payment_intent_id,
                payment_attempt_id, status, locked_at, created_at, updated_at, deleted_at
              ) values (
                $1, 'complete_checkout_create_order', $2, $3, $4,
                $5, 'processing', now(), now(), now(), now()
              )
            `,
            [
              "chkcpl_soft_deleted_survive",
              paymentIntentId,
              cartId,
              paymentIntentId,
              paymentAttemptId,
            ]
          )

          // Verify the soft-deleted row exists
          const checkSoft = await client.query(
            "select id, deleted_at is not null as is_deleted from checkout_completion_log where cart_id = $1",
            [cartId]
          )
          expect(checkSoft.rows[0]).toEqual({
            id: "chkcpl_soft_deleted_survive",
            is_deleted: true,
          })

          // Now try to acquire authority for that same cart
          const result = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          // Must reuse the existing authority, NOT create a second one!
          expect(result.action).toBe("reused")
          expect(result.authority.id).toBe("chkcpl_soft_deleted_survive")

          // Database-enforced check: direct insert must fail with unique constraint violation
          await expect(
            client.query(
              `
                insert into checkout_completion_log (
                  id, operation, idempotency_key, cart_id, payment_intent_id,
                  payment_attempt_id, status, locked_at, created_at, updated_at
                ) values (
                  $1, 'complete_checkout_create_order', $2, $3, $4,
                  $5, 'processing', now(), now(), now()
                )
              `,
              [
                "chkcpl_direct_collision",
                "pi_collision_idemp",
                cartId,
                "pi_collision_idemp",
                "payatt_collision",
              ]
            )
          ).rejects.toThrow(/duplicate key value violates unique constraint|23505/)

          const finalCount = await client.query(
            "select count(*)::int as count from checkout_completion_log where cart_id = $1",
            [cartId]
          )
          expect(finalCount.rows[0].count).toBe(1)
        } finally {
          await client.end()
        }
      })

      it("A4: conflicting payment_attempt_id fails closed", async () => {
        const client = createAppClient()
        await client.connect()
        try {
          const cartId = "cart_pa_conflict_01"
          const paymentAttemptId = "payatt_original_01"
          const paymentIntentId = "pi_pa_conflict_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.action).toBe("created")

          await expect(
            acquireCheckoutOrderBirthAuthorityInTransaction(
              makeTrxAdapter(client),
              {
                cart_id: cartId,
                payment_attempt_id: "payatt_CONFLICTING_02",
                payment_intent_id: paymentIntentId,
              }
            )
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)
        } finally {
          await client.end()
        }
      })

      it("A5: conflicting payment_intent_id fails closed", async () => {
        const client = createAppClient()
        await client.connect()
        try {
          const cartId = "cart_pi_conflict_01"
          const paymentAttemptId = "payatt_pi_conflict_01"
          const paymentIntentId = "pi_original_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.action).toBe("created")

          await expect(
            acquireCheckoutOrderBirthAuthorityInTransaction(
              makeTrxAdapter(client),
              {
                cart_id: cartId,
                payment_attempt_id: paymentAttemptId,
                payment_intent_id: "pi_CONFLICTING_02",
              }
            )
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)
        } finally {
          await client.end()
        }
      })

      it("B1: newly acquired CCL starts with execution_started_at = NULL and two acquisitions produce one authority", async () => {
        const clientA = createAppClient()
        const clientB = createAppClient()
        await Promise.all([clientA.connect(), clientB.connect()])

        try {
          const cartId = "cart_b1_gate_01"
          const paymentAttemptId = "payatt_b1_01"
          const paymentIntentId = "pi_b1_01"

          const resA = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(clientA),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(resA.action).toBe("created")
          expect(resA.authority.execution_started_at).toBeNull()
          expect(resA.authority.order_id).toBeNull()
          expect(resA.authority.status).toBe("processing")

          const resB = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(clientB),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(resB.action).toBe("reused")
          expect(resB.authority.id).toBe(resA.authority.id)
          expect(resB.authority.execution_started_at).toBeNull()

          const dbRow = await clientA.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [resA.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).toBeNull()
        } finally {
          await Promise.all([clientA.end(), clientB.end()])
        }
      })

      it("B2 & B3: two concurrent markOrderBirthExecutionStarted calls produce exactly one winner and winner sees execution_started_at timestamp", async () => {
        const clientA = createAppClient()
        const clientB = createAppClient()
        await Promise.all([clientA.connect(), clientB.connect()])

        try {
          const cartId = "cart_b2_cas_race_01"
          const paymentAttemptId = "payatt_b2_01"
          const paymentIntentId = "pi_b2_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(clientA),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.authority.execution_started_at).toBeNull()

          let release = false
          const gate = new Promise<void>((resolve) => {
            const poll = () => {
              if (release) return resolve()
              setImmediate(poll)
            }
            poll()
          })

          const racers = [clientA, clientB].map((client) =>
            (async () => {
              await gate
              return markOrderBirthExecutionStartedInTransaction(
                makeTrxAdapter(client),
                {
                  id: created.authority.id,
                  cart_id: cartId,
                  payment_intent_id: paymentIntentId,
                  payment_attempt_id: paymentAttemptId,
                }
              )
            })()
          )

          release = true
          const results = await Promise.all(racers)

          const winners = results.filter((r) => r.won)
          const losers = results.filter((r) => !r.won)

          expect(winners).toHaveLength(1)
          expect(losers).toHaveLength(1)

          // B3: winner sees non-null execution_started_at
          expect(winners[0].authority.execution_started_at).toBeTruthy()
          // loser also sees the non-null execution_started_at
          expect(
            new Date(losers[0].authority.execution_started_at!).toISOString()
          ).toBe(
            new Date(winners[0].authority.execution_started_at!).toISOString()
          )
        } finally {
          await Promise.all([clientA.end(), clientB.end()])
        }
      })

      it("B4: loser of execution CAS cannot execute completeCart (won is false on repeated attempts)", async () => {
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_b4_loser_block_01"
          const paymentAttemptId = "payatt_b4_01"
          const paymentIntentId = "pi_b4_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          const firstCas = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
            }
          )
          expect(firstCas.won).toBe(true)

          // Subsequent attempt by second caller must lose CAS
          const secondCas = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
            }
          )
          expect(secondCas.won).toBe(false)
          expect(
            new Date(secondCas.authority.execution_started_at!).toISOString()
          ).toBe(
            new Date(firstCas.authority.execution_started_at!).toISOString()
          )
        } finally {
          await client.end()
        }
      })

      it("B5: stale locked_at does NOT reset execution_started_at", async () => {
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_b5_stale_gate_01"
          const paymentAttemptId = "payatt_b5_01"
          const paymentIntentId = "pi_b5_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          const casResult = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
            }
          )
          expect(casResult.won).toBe(true)
          const startedAt = casResult.authority.execution_started_at

          // Age the locked_at to simulate stale lease (1 hour ago)
          await client.query(
            "update checkout_completion_log set locked_at = now() - interval '1 hour' where id = $1",
            [created.authority.id]
          )

          // Read authority again
          const afterAging = await readCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            { id: created.authority.id }
          )
          // execution_started_at MUST NOT be reset
          expect(afterAging?.execution_started_at).toBeTruthy()

          // Claim decision must NEVER return retry_processing_without_order
          const logRecord = {
            id: created.authority.id,
            operation: "complete_checkout_create_order" as const,
            idempotency_key: created.authority.idempotency_key,
            cart_id: cartId,
            payment_intent_id: paymentIntentId,
            payment_attempt_id: paymentAttemptId,
            order_id: null,
            status: "processing" as const,
            error_code: null,
            error_message: null,
            metadata: null,
            locked_at: new Date(Date.now() - 3600_000).toISOString(),
            completed_at: null,
            failed_at: null,
            execution_started_at: startedAt,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          }

          const decision = resolveCheckoutCompletionClaimDecision({
            existing: logRecord,
            next: {
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
            },
          })

          // Must be already_processing, NOT retry_processing_without_order
          expect(decision.type).toBe("already_processing")
        } finally {
          await client.end()
        }
      })

      it("B6: soft-delete authority is still reused and prevents second authority", async () => {
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_b6_soft_del_01"
          const paymentAttemptId = "payatt_b6_01"
          const paymentIntentId = "pi_b6_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          // Soft delete
          await client.query(
            "update checkout_completion_log set deleted_at = now() where id = $1",
            [created.authority.id]
          )

          // Re-acquisition must reuse
          const reacquired = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(reacquired.action).toBe("reused")
          expect(reacquired.authority.id).toBe(created.authority.id)
        } finally {
          await client.end()
        }
      })

      it("R5-HR08 DB1: caller +2h has no effect; execution_started_at is DB CURRENT_TIMESTAMP-owned", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_db1_caller_plus_2h"
          const paymentAttemptId = "payatt_db1_01"
          const paymentIntentId = "pi_db1_01"

          const acquired = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(acquired.authority.execution_started_at).toBeNull()

          const beforeRes = await client.query(
            "select CURRENT_TIMESTAMP as before_ts"
          )
          const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

          const dbNowRes = await client.query("select CURRENT_TIMESTAMP as db_now")
          const dbNow = new Date(dbNowRes.rows[0].db_now)
          const callerAt = new Date(dbNow.getTime() + 2 * 60 * 60 * 1000)

          const result = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: acquired.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
              at: callerAt,
            }
          )

          const afterRes = await client.query(
            `
              select execution_started_at, updated_at, CURRENT_TIMESTAMP as after_ts
              from checkout_completion_log
              where id = $1
            `,
            [acquired.authority.id]
          )
          const row = afterRes.rows[0]
          const executionStartedAt = new Date(row.execution_started_at).getTime()
          const updatedAt = new Date(row.updated_at).getTime()
          const afterTs = new Date(row.after_ts).getTime()
          const callerAtMs = callerAt.getTime()

          expect(result.won).toBe(true)
          expect(executionStartedAt).toBeGreaterThanOrEqual(beforeTs)
          expect(executionStartedAt).toBeLessThanOrEqual(afterTs)
          expect(updatedAt).toBeGreaterThanOrEqual(beforeTs)
          expect(updatedAt).toBeLessThanOrEqual(afterTs)
          expect(executionStartedAt).not.toBe(callerAtMs)
          expect(Math.abs(executionStartedAt - callerAtMs)).toBeGreaterThan(
            3_600_000
          )
          expect(updatedAt).not.toBe(callerAtMs)
        } finally {
          await client.end()
        }
      })

      it("R5-HR08 DB2: caller -2h has no effect; execution_started_at is DB CURRENT_TIMESTAMP-owned", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_db2_caller_minus_2h"
          const paymentAttemptId = "payatt_db2_01"
          const paymentIntentId = "pi_db2_01"

          const acquired = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(acquired.authority.execution_started_at).toBeNull()

          const beforeRes = await client.query(
            "select CURRENT_TIMESTAMP as before_ts"
          )
          const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

          const dbNowRes = await client.query("select CURRENT_TIMESTAMP as db_now")
          const dbNow = new Date(dbNowRes.rows[0].db_now)
          const callerAt = new Date(dbNow.getTime() - 2 * 60 * 60 * 1000)

          const result = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: acquired.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
              at: callerAt,
            }
          )

          const afterRes = await client.query(
            `
              select execution_started_at, updated_at, CURRENT_TIMESTAMP as after_ts
              from checkout_completion_log
              where id = $1
            `,
            [acquired.authority.id]
          )
          const row = afterRes.rows[0]
          const executionStartedAt = new Date(row.execution_started_at).getTime()
          const updatedAt = new Date(row.updated_at).getTime()
          const afterTs = new Date(row.after_ts).getTime()
          const callerAtMs = callerAt.getTime()

          expect(result.won).toBe(true)
          expect(executionStartedAt).toBeGreaterThanOrEqual(beforeTs)
          expect(executionStartedAt).toBeLessThanOrEqual(afterTs)
          expect(updatedAt).toBeGreaterThanOrEqual(beforeTs)
          expect(updatedAt).toBeLessThanOrEqual(afterTs)
          expect(executionStartedAt).not.toBe(callerAtMs)
          expect(Math.abs(executionStartedAt - callerAtMs)).toBeGreaterThan(
            3_600_000
          )
          expect(updatedAt).not.toBe(callerAtMs)
        } finally {
          await client.end()
        }
      })

      it("R5-HR08 DB3 & DB4: concurrent CAS yields one winner; loser cannot replace DB-owned timestamps", async () => {
        assertNoStripeNetwork()
        const clientA = createAppClient()
        const clientB = createAppClient()
        await Promise.all([clientA.connect(), clientB.connect()])

        try {
          const cartId = "cart_db3_db4_cas_race"
          const paymentAttemptId = "payatt_db3_01"
          const paymentIntentId = "pi_db3_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(clientA),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.authority.execution_started_at).toBeNull()

          let release = false
          const gate = new Promise<void>((resolve) => {
            const poll = () => {
              if (release) return resolve()
              setImmediate(poll)
            }
            poll()
          })

          const racers = [clientA, clientB].map((client) =>
            (async () => {
              await gate
              return markOrderBirthExecutionStartedInTransaction(
                makeTrxAdapter(client),
                {
                  id: created.authority.id,
                  cart_id: cartId,
                  payment_intent_id: paymentIntentId,
                  payment_attempt_id: paymentAttemptId,
                }
              )
            })()
          )

          release = true
          const results = await Promise.all(racers)

          const winners = results.filter((r) => r.won)
          const losers = results.filter((r) => !r.won)
          expect(winners).toHaveLength(1)
          expect(losers).toHaveLength(1)

          const winnerStartedAt = new Date(
            winners[0].authority.execution_started_at!
          ).getTime()
          const loserStartedAt = new Date(
            losers[0].authority.execution_started_at!
          ).getTime()
          expect(loserStartedAt).toBe(winnerStartedAt)
          expect(winners[0].authority.execution_started_at).toBeTruthy()

          const dbNowRes = await clientA.query("select CURRENT_TIMESTAMP as db_now")
          const dbNow = new Date(dbNowRes.rows[0].db_now)
          const loserCallerAt = new Date(dbNow.getTime() + 2 * 60 * 60 * 1000)

          const loserRetry = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(clientB),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
              at: loserCallerAt,
            }
          )
          expect(loserRetry.won).toBe(false)
          expect(
            new Date(loserRetry.authority.execution_started_at!).getTime()
          ).toBe(winnerStartedAt)
          expect(
            new Date(loserRetry.authority.updated_at!).getTime()
          ).toBe(new Date(winners[0].authority.updated_at!).getTime())
          expect(
            new Date(loserRetry.authority.execution_started_at!).getTime()
          ).not.toBe(loserCallerAt.getTime())
        } finally {
          await Promise.all([clientA.end(), clientB.end()])
        }
      })

      it("R5-HR08 DB5: updated_at is DB CURRENT_TIMESTAMP-owned, not caller-supplied", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_db5_updated_at_owned"
          const paymentAttemptId = "payatt_db5_01"
          const paymentIntentId = "pi_db5_01"

          const acquired = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          const beforeRes = await client.query(
            "select CURRENT_TIMESTAMP as before_ts"
          )
          const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

          const dbNowRes = await client.query("select CURRENT_TIMESTAMP as db_now")
          const dbNow = new Date(dbNowRes.rows[0].db_now)
          const callerAt = new Date(dbNow.getTime() + 2 * 60 * 60 * 1000)

          await markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
            id: acquired.authority.id,
            cart_id: cartId,
            payment_intent_id: paymentIntentId,
            payment_attempt_id: paymentAttemptId,
            at: callerAt,
          })

          const afterRes = await client.query(
            `
              select updated_at, CURRENT_TIMESTAMP as after_ts
              from checkout_completion_log
              where id = $1
            `,
            [acquired.authority.id]
          )
          const row = afterRes.rows[0]
          const updatedAt = new Date(row.updated_at).getTime()
          const afterTs = new Date(row.after_ts).getTime()

          expect(updatedAt).toBeGreaterThanOrEqual(beforeTs)
          expect(updatedAt).toBeLessThanOrEqual(afterTs)
          expect(updatedAt).not.toBe(callerAt.getTime())
          expect(Math.abs(updatedAt - callerAt.getTime())).toBeGreaterThan(
            3_600_000
          )
        } finally {
          await client.end()
        }
      })

      it("PA1: CCL owned by PA-A; CAS with PA-A wins and execution_started_at is set in DB", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa1_fin04_01"
          const paymentAttemptA = "payatt_pa1_a_fin04"
          const paymentIntentId = "pi_pa1_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.authority.payment_attempt_id).toBe(paymentAttemptA)
          expect(created.authority.execution_started_at).toBeNull()

          const result = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptA,
            }
          )

          expect(result.won).toBe(true)
          expect(result.authority.execution_started_at).toBeTruthy()

          const dbRow = await client.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).not.toBeNull()
        } finally {
          await client.end()
        }
      })

      it("PA2: CAS with wrong PA-B throws PAYMENT_ATTEMPT_MISMATCH and does not win", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa2_fin04_01"
          const paymentAttemptA = "payatt_pa2_a_fin04"
          const paymentAttemptB = "payatt_pa2_b_fin04"
          const paymentIntentId = "pi_pa2_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptB,
            })
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptB,
            })
          ).rejects.toThrow(/PAYMENT_ATTEMPT_MISMATCH/)
        } finally {
          await client.end()
        }
      })

      it("PA3: after PA-B rejection execution_started_at remains NULL in DB", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa3_fin04_01"
          const paymentAttemptA = "payatt_pa3_a_fin04"
          const paymentAttemptB = "payatt_pa3_b_fin04"
          const paymentIntentId = "pi_pa3_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptB,
            })
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)

          const dbRow = await client.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).toBeNull()
        } finally {
          await client.end()
        }
      })

      it("PA4: PA-A wins the same CCL after PA-B was rejected", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa4_fin04_01"
          const paymentAttemptA = "payatt_pa4_a_fin04"
          const paymentAttemptB = "payatt_pa4_b_fin04"
          const paymentIntentId = "pi_pa4_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptB,
            })
          ).rejects.toThrow(/PAYMENT_ATTEMPT_MISMATCH/)

          const result = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptA,
            }
          )

          expect(result.won).toBe(true)
          expect(result.authority.execution_started_at).toBeTruthy()

          const dbRow = await client.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).not.toBeNull()
        } finally {
          await client.end()
        }
      })

      it("PA5: concurrent PA-A vs PA-B on independent connections — only PA-A can set execution_started_at", async () => {
        assertNoStripeNetwork()
        const clientA = createAppClient()
        const clientB = createAppClient()
        await Promise.all([clientA.connect(), clientB.connect()])

        try {
          const cartId = "cart_pa5_fin04_01"
          const paymentAttemptA = "payatt_pa5_a_fin04"
          const paymentAttemptB = "payatt_pa5_b_fin04"
          const paymentIntentId = "pi_pa5_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(clientA),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )
          expect(created.authority.execution_started_at).toBeNull()

          let release = false
          const gate = new Promise<void>((resolve) => {
            const poll = () => {
              if (release) return resolve()
              setImmediate(poll)
            }
            poll()
          })

          const racers = [
            (async () => {
              await gate
              return markOrderBirthExecutionStartedInTransaction(
                makeTrxAdapter(clientA),
                {
                  id: created.authority.id,
                  cart_id: cartId,
                  payment_intent_id: paymentIntentId,
                  payment_attempt_id: paymentAttemptA,
                }
              )
            })(),
            (async () => {
              await gate
              return markOrderBirthExecutionStartedInTransaction(
                makeTrxAdapter(clientB),
                {
                  id: created.authority.id,
                  cart_id: cartId,
                  payment_intent_id: paymentIntentId,
                  payment_attempt_id: paymentAttemptB,
                }
              )
            })(),
          ]

          release = true
          const results = await Promise.allSettled(racers)

          const paAResult = results[0]
          const paBResult = results[1]

          expect(paAResult.status).toBe("fulfilled")
          if (paAResult.status === "fulfilled") {
            expect(paAResult.value.won).toBe(true)
          }

          expect(paBResult.status).toBe("rejected")
          if (paBResult.status === "rejected") {
            expect(paBResult.reason).toBeInstanceOf(
              CheckoutCompletionAuthorityConflictError
            )
            expect(String(paBResult.reason)).toMatch(/PAYMENT_ATTEMPT_MISMATCH/)
          }

          const dbRow = await clientA.query(
            "select execution_started_at, payment_attempt_id from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).not.toBeNull()
          expect(dbRow.rows[0].payment_attempt_id).toBe(paymentAttemptA)
        } finally {
          await Promise.all([clientA.end(), clientB.end()])
        }
      })

      it("PA6: wrong payment_intent_id with correct PA throws PAYMENT_INTENT_MISMATCH and execution_started_at stays NULL", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa6_fin04_01"
          const paymentAttemptA = "payatt_pa6_a_fin04"
          const paymentIntentId = "pi_pa6_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: "pi_pa6_WRONG_fin04",
              payment_attempt_id: paymentAttemptA,
            })
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: cartId,
              payment_intent_id: "pi_pa6_WRONG_fin04",
              payment_attempt_id: paymentAttemptA,
            })
          ).rejects.toThrow(/PAYMENT_INTENT_MISMATCH/)

          const dbRow = await client.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).toBeNull()
        } finally {
          await client.end()
        }
      })

      it("PA7: wrong cart_id with correct PA throws CART_MISMATCH and execution_started_at stays NULL", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_pa7_fin04_01"
          const paymentAttemptA = "payatt_pa7_a_fin04"
          const paymentIntentId = "pi_pa7_fin04_01"

          const created = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptA,
              payment_intent_id: paymentIntentId,
            }
          )

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: "cart_pa7_WRONG_fin04",
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptA,
            })
          ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)

          await expect(
            markOrderBirthExecutionStartedInTransaction(makeTrxAdapter(client), {
              id: created.authority.id,
              cart_id: "cart_pa7_WRONG_fin04",
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptA,
            })
          ).rejects.toThrow(/CART_MISMATCH/)

          const dbRow = await client.query(
            "select execution_started_at from checkout_completion_log where id = $1",
            [created.authority.id]
          )
          expect(dbRow.rows[0].execution_started_at).toBeNull()
        } finally {
          await client.end()
        }
      })

      it("R5-HR08 DB6: execution_started_at is never reset or replaced after CAS win", async () => {
        assertNoStripeNetwork()
        const client = createAppClient()
        await client.connect()

        try {
          const cartId = "cart_db6_no_reset"
          const paymentAttemptId = "payatt_db6_01"
          const paymentIntentId = "pi_db6_01"

          const acquired = await acquireCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            {
              cart_id: cartId,
              payment_attempt_id: paymentAttemptId,
              payment_intent_id: paymentIntentId,
            }
          )

          const firstCas = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: acquired.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
            }
          )
          expect(firstCas.won).toBe(true)
          const winnerStartedAt = new Date(
            firstCas.authority.execution_started_at!
          ).getTime()
          const winnerUpdatedAt = new Date(firstCas.authority.updated_at!).getTime()

          const dbNowRes = await client.query("select CURRENT_TIMESTAMP as db_now")
          const dbNow = new Date(dbNowRes.rows[0].db_now)
          const loserCallerAt = new Date(dbNow.getTime() - 2 * 60 * 60 * 1000)

          const secondCas = await markOrderBirthExecutionStartedInTransaction(
            makeTrxAdapter(client),
            {
              id: acquired.authority.id,
              cart_id: cartId,
              payment_intent_id: paymentIntentId,
              payment_attempt_id: paymentAttemptId,
              at: loserCallerAt,
            }
          )
          expect(secondCas.won).toBe(false)
          expect(
            new Date(secondCas.authority.execution_started_at!).getTime()
          ).toBe(winnerStartedAt)
          expect(new Date(secondCas.authority.updated_at!).getTime()).toBe(
            winnerUpdatedAt
          )
          expect(secondCas.authority.execution_started_at).not.toBeNull()

          await client.query(
            "update checkout_completion_log set locked_at = now() - interval '1 hour' where id = $1",
            [acquired.authority.id]
          )

          const afterAging = await readCheckoutOrderBirthAuthorityInTransaction(
            makeTrxAdapter(client),
            { id: acquired.authority.id }
          )
          expect(afterAging?.execution_started_at).toBeTruthy()
          expect(
            new Date(afterAging!.execution_started_at!).getTime()
          ).toBe(winnerStartedAt)
        } finally {
          await client.end()
        }
      })
    },
  })
}
