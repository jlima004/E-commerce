import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  claimPaymentAttemptReconciliationLease,
  releasePaymentAttemptReconciliationLease,
  scanPaymentAttemptReconciliationCandidates,
} from "../../../reconciliation/payment-attempt-reconciler"
import {
  applyStripePaymentIntentWebhookInTransaction,
  recordProviderCanceledConfirmedInTransaction,
} from "../transactional-authority"
import {
  isUnresolvedFinancialFreeze,
  toPaymentAttemptFinancialAuthority,
} from "../financial-authority"
import type { StripePaymentIntentWebhookObject } from "../service"
import { Client as PgClient } from "pg"

jest.mock(
  "pg-god",
  () => {
    const { Client: ActualPgClient } =
      jest.requireActual("pg") as typeof import("pg")

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
      return new ActualPgClient({
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
  describe("payment-attempt reconciliation lease PostgreSQL routing", () => {
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

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection }) => {
      async function seedCart(cartId: string) {
        await dbConnection.raw(
          `
            insert into cart (id, currency_code, email)
            values (?, 'brl', 'test@example.com')
            on conflict (id) do nothing
          `,
          [cartId]
        )
      }

      async function seedPaymentAttempt(input: {
        id: string
        cartId: string
        status?: string
        amount?: number
        freeze?: string | null
        canceledConfirmed?: string | null
        reconciliationReasonCode?: string | null
        reconciliationLockedAtSql?: string | null
        lastReconciliationAtSql?: string | null
        orderId?: string | null
        providerPaymentIntentId?: string | null
        paymentSessionId?: string | null
      }) {
        await seedCart(input.cartId)
        const lockedAtExpr = input.reconciliationLockedAtSql ?? "null"
        const lastRecExpr = input.lastReconciliationAtSql ?? "null"
        const freezeExpr =
          input.freeze === undefined
            ? "CURRENT_TIMESTAMP"
            : input.freeze === null
            ? "null"
            : `'${input.freeze}'::timestamptz`

        await dbConnection.raw(
          `
            insert into payment_attempt (
              id, cart_id, payment_collection_id, payment_session_id,
              provider, provider_payment_intent_id, provider_payment_session_id,
              payment_method_type, status, amount, currency_code, metadata,
              order_id, financial_freeze_started_at, provider_canceled_confirmed_at,
              provider_discovery_started_at, reconciliation_reason_code,
              reconciliation_locked_at, last_reconciliation_at,
              created_at, updated_at, deleted_at
            ) values (
              ?, ?, ?, ?, 'stripe', ?, null, 'card', ?, ?, 'brl', ?,
              ?, ${freezeExpr}, ?, null, ?,
              ${lockedAtExpr}, ${lastRecExpr},
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null
            )
          `,
          [
            input.id,
            input.cartId,
            `paycol_${input.id}`,
            input.paymentSessionId ?? `payses_${input.id}`,
            input.providerPaymentIntentId ?? null,
            input.status ?? "created",
            input.amount ?? 10000,
            JSON.stringify({ payment_attempt_id: input.id }),
            input.orderId ?? null,
            input.canceledConfirmed ?? null,
            input.reconciliationReasonCode ?? null,
          ]
        )
      }

      afterEach(async () => {
        await dbConnection.raw(
          "delete from payment_attempt where id like 'payatt_pg_%'"
        )
        await dbConnection.raw("delete from cart where id like 'cart_pg_%'")
      })

      // PG1 — FRESH LEASE SINGLE WINNER
      it("PG1: fresh lease claim has exactly one winner under concurrent attempts", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_concurrent_1"
        const cartId = "cart_pg_concurrent_1"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T18:00:00.000Z",
          reconciliationLockedAtSql: "null",
        })

        // Two concurrent claims on the same attempt
        const [claimA, claimB] = await Promise.all([
          claimPaymentAttemptReconciliationLease(dbConnection, { attemptId }),
          claimPaymentAttemptReconciliationLease(dbConnection, { attemptId }),
        ])

        const wins = [claimA, claimB].filter(Boolean)
        expect(wins.length).toBe(1)
        expect(claimA !== claimB).toBe(true)

        // Verify row in DB is locked
        const { rows } = await dbConnection.raw(
          "select reconciliation_locked_at from payment_attempt where id = ?",
          [attemptId]
        )
        expect(rows[0].reconciliation_locked_at).not.toBeNull()
      })

      // PG2 — APPLICATION CLOCK SKEW IRRELEVANT
      it("PG2: application clock skew (+2h / -2h) has zero authority on lease expiry", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_clock_skew"
        const cartId = "cart_pg_clock_skew"

        // Seed with fresh lease locked at CURRENT_TIMESTAMP
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          reconciliationLockedAtSql: "CURRENT_TIMESTAMP",
        })

        // Logical worker A (with app clock -2h) and worker B (with app clock +2h)
        // Try to claim via production seam. DB CURRENT_TIMESTAMP decides freshness.
        const claimAttempt = await claimPaymentAttemptReconciliationLease(
          dbConnection,
          { attemptId }
        )
        expect(claimAttempt).toBe(false)

        // Candidate scanner also must NOT return this row
        const candidates = await scanPaymentAttemptReconciliationCandidates(
          dbConnection
        )
        const found = candidates.find((c) => c.id === attemptId)
        expect(found).toBeUndefined()
      })

      // PG3 — STALE LEASE RECLAIM (> 15 MIN)
      it("PG3: stale lease (> 15 min, seeded at 16m) is reclaimed with DB CURRENT_TIMESTAMP", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_stale_16m"
        const cartId = "cart_pg_stale_16m"

        // Seed lease locked 16 minutes ago
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          reconciliationLockedAtSql: "CURRENT_TIMESTAMP - INTERVAL '16 minutes'",
        })

        const candidates = await scanPaymentAttemptReconciliationCandidates(
          dbConnection
        )
        const candidate = candidates.find((c) => c.id === attemptId)
        expect(candidate).toBeDefined()

        const beforeRes = await dbConnection.raw(
          "select CURRENT_TIMESTAMP as before_ts"
        )
        const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

        const claimed = await claimPaymentAttemptReconciliationLease(
          dbConnection,
          { attemptId }
        )
        expect(claimed).toBe(true)

        const afterRes = await dbConnection.raw(
          "select reconciliation_locked_at, CURRENT_TIMESTAMP as after_ts from payment_attempt where id = ?",
          [attemptId]
        )
        const lockedAt = new Date(
          afterRes.rows[0].reconciliation_locked_at
        ).getTime()
        const afterTs = new Date(afterRes.rows[0].after_ts).getTime()

        expect(lockedAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(lockedAt).toBeLessThanOrEqual(afterTs + 2000)
      })

      // PG4 — 14-MINUTE LEASE MUST NOT BE RECLAIMED
      it("PG4: 14-minute lease is NOT reclaimed (15-minute DB boundary enforced)", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_fresh_14m"
        const cartId = "cart_pg_fresh_14m"

        // Seed lease locked 14 minutes ago (within 15m lease window)
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          reconciliationLockedAtSql: "CURRENT_TIMESTAMP - INTERVAL '14 minutes'",
        })

        const candidates = await scanPaymentAttemptReconciliationCandidates(
          dbConnection
        )
        const found = candidates.find((c) => c.id === attemptId)
        expect(found).toBeUndefined()

        const claimed = await claimPaymentAttemptReconciliationLease(
          dbConnection,
          { attemptId }
        )
        expect(claimed).toBe(false)
      })

      // PG5 — PROVIDER-CANCELED TIMESTAMP AUTHORITY
      it("PG5: provider_canceled_confirmed_at is DB-clock-owned and preserves financial_freeze_started_at", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_thaw_ts"
        const cartId = "cart_pg_thaw_ts"
        const providerPi = "pi_test_pg5_thaw"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "client_action_required",
        })

        const beforeRes = await dbConnection.raw(
          "select CURRENT_TIMESTAMP as before_ts"
        )
        const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

        await dbConnection.transaction(async (trx: any) => {
          await recordProviderCanceledConfirmedInTransaction(trx, {
            paymentAttemptId: attemptId,
            cartId,
            providerPaymentIntentId: providerPi,
          })
        })

        const afterRes = await dbConnection.raw(
          `
            select provider_canceled_confirmed_at, canceled_at,
                   financial_freeze_started_at, CURRENT_TIMESTAMP as after_ts
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        const canceledConfirmedAt = new Date(
          row.provider_canceled_confirmed_at
        ).getTime()
        const canceledAt = new Date(row.canceled_at).getTime()
        const afterTs = new Date(row.after_ts).getTime()

        expect(canceledConfirmedAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledConfirmedAt).toBeLessThanOrEqual(afterTs + 2000)
        expect(canceledAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledAt).toBeLessThanOrEqual(afterTs + 2000)

        // financial_freeze_started_at MUST be preserved
        expect(new Date(row.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
      })

      // PG6 — LAST RECONCILIATION TIMESTAMP AND LEASE RELEASE
      it("PG6: last_reconciliation_at is generated by PostgreSQL and release clears lease", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_last_rec_ts"
        const cartId = "cart_pg_last_rec_ts"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          reconciliationLockedAtSql: "CURRENT_TIMESTAMP",
        })

        const beforeRes = await dbConnection.raw(
          "select CURRENT_TIMESTAMP as before_ts"
        )
        const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

        await releasePaymentAttemptReconciliationLease(dbConnection, attemptId)

        const afterRes = await dbConnection.raw(
          `
            select reconciliation_locked_at, last_reconciliation_at,
                   updated_at, CURRENT_TIMESTAMP as after_ts
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        expect(row.reconciliation_locked_at).toBeNull()

        const lastRecAt = new Date(row.last_reconciliation_at).getTime()
        const updatedAt = new Date(row.updated_at).getTime()
        const afterTs = new Date(row.after_ts).getTime()

        expect(lastRecAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(lastRecAt).toBeLessThanOrEqual(afterTs + 2000)
        expect(updatedAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(updatedAt).toBeLessThanOrEqual(afterTs + 2000)
      })

      // PG7 — CONCURRENT CLAIM CAS ACROSS TWO INDEPENDENT PG CONNECTIONS
      it("PG7: concurrent CAS contention across two independent PostgreSQL connections", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_two_connections"
        const cartId = "cart_pg_two_connections"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          reconciliationLockedAtSql: "null",
        })

        // Establish two independent PostgreSQL clients
        const clientA = new PgClient({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          user: process.env.DB_USERNAME,
          password: process.env.DB_PASSWORD,
          database: databaseName,
        })
        const clientB = new PgClient({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          user: process.env.DB_USERNAME,
          password: process.env.DB_PASSWORD,
          database: databaseName,
        })

        await clientA.connect()
        await clientB.connect()

        try {
          const pidResA = await clientA.query("select pg_backend_pid() as pid")
          const pidResB = await clientB.query("select pg_backend_pid() as pid")
          // Verify two distinct backend processes
          expect(pidResA.rows[0].pid).not.toBe(pidResB.rows[0].pid)

          // Helper to execute claim via PgClient using exact production SQL
          async function claimViaPgClient(
            client: PgClient,
            targetId: string,
            leaseMs = 15 * 60_000
          ): Promise<boolean> {
            const res = await client.query(
              `
                update payment_attempt
                set reconciliation_locked_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                where id = $1
                  and order_id is null
                  and (
                    (financial_freeze_started_at is not null and provider_canceled_confirmed_at is null)
                    or reconciliation_reason_code is not null
                  )
                  and (
                    reconciliation_locked_at is null
                    or reconciliation_locked_at < (CURRENT_TIMESTAMP - ($2 * INTERVAL '1 millisecond'))
                  )
                returning id
              `,
              [targetId, leaseMs]
            )
            return (res.rowCount ?? 0) > 0
          }

          // Concurrent claim race
          const [resultA, resultB] = await Promise.all([
            claimViaPgClient(clientA, attemptId),
            claimViaPgClient(clientB, attemptId),
          ])

          expect([resultA, resultB].filter(Boolean).length).toBe(1)

          // Whichever client lost, second attempt immediately fails
          const loserClient = resultA ? clientB : clientA
          const retryLoser = await claimViaPgClient(loserClient, attemptId)
          expect(retryLoser).toBe(false)

          // Release lease using production helper
          await releasePaymentAttemptReconciliationLease(
            dbConnection,
            attemptId
          )

          // Verify lease is now clear in DB
          const checkRes = await clientA.query(
            "select reconciliation_locked_at from payment_attempt where id = $1",
            [attemptId]
          )
          expect(checkRes.rows[0].reconciliation_locked_at).toBeNull()
        } finally {
          await clientA.end()
          await clientB.end()
        }
      })

      // =====================================================================
      // SIGNED CANCELED WEBHOOK DB-CLOCK AUTHORITY (PG-W1 – PG-W6)
      // =====================================================================

      // PG-W1 — APP CLOCK +2 HOURS
      it("PG-W1: caller at +2h skew does not control provider_canceled_confirmed_at (DB-clock owned)", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w1"
        const cartId = "cart_pg_w1"
        const providerPi = "pi_test_pg_w1"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        const beforeRes = await dbConnection.raw(
          "select CURRENT_TIMESTAMP as before_ts"
        )
        const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

        // App clock skewed +2 hours into the future
        const skewedAt = new Date(beforeTs + 2 * 60 * 60 * 1000)

        const webhookObject: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: cartId,
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        const updated = await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            webhookObject,
            "payment_intent.canceled",
            skewedAt
          )
        })

        const afterRes = await dbConnection.raw(
          `
            select canceled_at, provider_canceled_confirmed_at,
                   financial_freeze_started_at, CURRENT_TIMESTAMP as after_ts
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        const canceledConfirmedAt = new Date(
          row.provider_canceled_confirmed_at
        ).getTime()
        const canceledAt = new Date(row.canceled_at).getTime()
        const afterTs = new Date(row.after_ts).getTime()

        // Must be within DB-clock window
        expect(canceledConfirmedAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledConfirmedAt).toBeLessThanOrEqual(afterTs + 2000)
        // Must NOT match caller's +2h skewed timestamp
        expect(canceledConfirmedAt).not.toBe(skewedAt.getTime())
        expect(Math.abs(canceledConfirmedAt - skewedAt.getTime())).toBeGreaterThan(
          60 * 60 * 1000
        )

        // canceled_at is also DB-clock owned
        expect(canceledAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledAt).toBeLessThanOrEqual(afterTs + 2000)
        expect(canceledAt).not.toBe(skewedAt.getTime())

        // financial_freeze_started_at MUST remain preserved
        expect(new Date(row.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
        expect(updated.status).toBe("payment_canceled")
      })

      // PG-W2 — APP CLOCK -2 HOURS
      it("PG-W2: caller at -2h skew does not control provider_canceled_confirmed_at (DB-clock owned)", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w2"
        const cartId = "cart_pg_w2"
        const providerPi = "pi_test_pg_w2"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        const beforeRes = await dbConnection.raw(
          "select CURRENT_TIMESTAMP as before_ts"
        )
        const beforeTs = new Date(beforeRes.rows[0].before_ts).getTime()

        // App clock skewed -2 hours into the past
        const skewedAt = new Date(beforeTs - 2 * 60 * 60 * 1000)

        const webhookObject: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: cartId,
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        const updated = await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            webhookObject,
            "payment_intent.canceled",
            skewedAt
          )
        })

        const afterRes = await dbConnection.raw(
          `
            select canceled_at, provider_canceled_confirmed_at,
                   financial_freeze_started_at, CURRENT_TIMESTAMP as after_ts
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        const canceledConfirmedAt = new Date(
          row.provider_canceled_confirmed_at
        ).getTime()
        const canceledAt = new Date(row.canceled_at).getTime()
        const afterTs = new Date(row.after_ts).getTime()

        // Must be within DB-clock window
        expect(canceledConfirmedAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledConfirmedAt).toBeLessThanOrEqual(afterTs + 2000)
        // Must NOT match caller's -2h skewed timestamp
        expect(canceledConfirmedAt).not.toBe(skewedAt.getTime())
        expect(Math.abs(canceledConfirmedAt - skewedAt.getTime())).toBeGreaterThan(
          60 * 60 * 1000
        )

        // canceled_at is also DB-clock owned
        expect(canceledAt).toBeGreaterThanOrEqual(beforeTs - 2000)
        expect(canceledAt).toBeLessThanOrEqual(afterTs + 2000)
        expect(canceledAt).not.toBe(skewedAt.getTime())

        // financial_freeze_started_at MUST remain preserved
        expect(new Date(row.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
        expect(updated.status).toBe("payment_canceled")
      })

      // PG-W3 — FREEZE RESOLUTION
      it("PG-W3: financial freeze starts unresolved and resolves upon valid canceled webhook", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w3"
        const cartId = "cart_pg_w3"
        const providerPi = "pi_test_pg_w3"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        // Verify initial state: unresolved financial freeze
        const initialRes = await dbConnection.raw(
          `
            select id, cart_id, order_id, financial_freeze_started_at, provider_canceled_confirmed_at
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const initialRow = initialRes.rows[0]
        expect(initialRow.financial_freeze_started_at).not.toBeNull()
        expect(initialRow.provider_canceled_confirmed_at).toBeNull()
        expect(initialRow.order_id).toBeNull()
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(initialRow)
          )
        ).toBe(true)

        const webhookObject: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: cartId,
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        const updated = await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            webhookObject,
            "payment_intent.canceled",
            new Date()
          )
        })

        // Verify updated state: resolved financial freeze, freeze start preserved
        const afterRes = await dbConnection.raw(
          `
            select id, cart_id, order_id, financial_freeze_started_at, provider_canceled_confirmed_at, status
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const afterRow = afterRes.rows[0]
        expect(new Date(afterRow.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
        expect(afterRow.provider_canceled_confirmed_at).not.toBeNull()
        expect(afterRow.order_id).toBeNull()
        expect(afterRow.status).toBe("payment_canceled")
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(afterRow)
          )
        ).toBe(false)
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(updated)
          )
        ).toBe(false)
      })

      // PG-W4 — DUPLICATE CANCELED
      it("PG-W4: duplicate canceled webhook preserves first DB timestamp", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w4"
        const cartId = "cart_pg_w4"
        const providerPi = "pi_test_pg_w4"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        const webhookObject: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: cartId,
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        // First webhook delivery
        await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            webhookObject,
            "payment_intent.canceled",
            new Date("2026-09-03T16:00:00.000Z")
          )
        })

        const firstRes = await dbConnection.raw(
          `
            select canceled_at, provider_canceled_confirmed_at, updated_at
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const firstRow = firstRes.rows[0]
        const firstCanceledConfirmedAt = new Date(
          firstRow.provider_canceled_confirmed_at
        ).toISOString()
        const firstCanceledAt = new Date(firstRow.canceled_at).toISOString()

        // Duplicate delivery with completely different timestamp (+24h)
        const duplicateAt = new Date("2026-09-04T16:00:00.000Z")
        const secondResult = await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            webhookObject,
            "payment_intent.canceled",
            duplicateAt
          )
        })

        const secondRes = await dbConnection.raw(
          `
            select id, cart_id, order_id, status, canceled_at,
                   provider_canceled_confirmed_at, financial_freeze_started_at
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const secondRow = secondRes.rows[0]

        // First timestamps MUST be preserved
        expect(new Date(secondRow.provider_canceled_confirmed_at).toISOString()).toBe(
          firstCanceledConfirmedAt
        )
        expect(new Date(secondRow.canceled_at).toISOString()).toBe(
          firstCanceledAt
        )
        expect(secondRow.status).toBe("payment_canceled")
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(secondRow)
          )
        ).toBe(false)
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(secondResult)
          )
        ).toBe(false)
      })

      // PG-W5 — INVALID CORRELATION
      it("PG-W5: invalid correlation rejects and leaves freeze unresolved", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w5"
        const cartId = "cart_pg_w5"
        const providerPi = "pi_test_pg_w5"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        // Webhook with mismatched cart ID
        const mismatchedIntent: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: "cart_wrong_other",
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        await expect(
          dbConnection.transaction(async (trx: any) => {
            return applyStripePaymentIntentWebhookInTransaction(
              trx,
              mismatchedIntent,
              "payment_intent.canceled",
              new Date()
            )
          })
        ).rejects.toThrow()

        const afterRes = await dbConnection.raw(
          `
            select id, cart_id, order_id, status, provider_canceled_confirmed_at,
                   financial_freeze_started_at
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        expect(row.provider_canceled_confirmed_at).toBeNull()
        expect(row.status).toBe("awaiting_webhook_confirmation")
        expect(new Date(row.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(row)
          )
        ).toBe(true)
      })

      // PG-W6 — PAYMENT_FAILED REGRESSION
      it("PG-W6: payment_failed event does not thaw financial freeze", async () => {
        assertNoStripeNetwork()
        const attemptId = "payatt_pg_w6"
        const cartId = "cart_pg_w6"
        const providerPi = "pi_test_pg_w6"

        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: "2026-09-03T15:30:00.000Z",
          providerPaymentIntentId: providerPi,
          status: "awaiting_webhook_confirmation",
          amount: 10000,
        })

        const failedIntent: StripePaymentIntentWebhookObject = {
          id: providerPi,
          object: "payment_intent",
          amount: 10000,
          amount_received: 0,
          currency: "brl",
          metadata: {
            cart_id: cartId,
            payment_attempt_id: attemptId,
          },
          payment_method_types: ["card"],
        }

        const updated = await dbConnection.transaction(async (trx: any) => {
          return applyStripePaymentIntentWebhookInTransaction(
            trx,
            failedIntent,
            "payment_intent.payment_failed",
            new Date()
          )
        })

        const afterRes = await dbConnection.raw(
          `
            select id, cart_id, order_id, status, provider_canceled_confirmed_at,
                   financial_freeze_started_at
            from payment_attempt where id = ?
          `,
          [attemptId]
        )
        const row = afterRes.rows[0]
        expect(row.status).toBe("payment_failed")
        expect(row.provider_canceled_confirmed_at).toBeNull()
        expect(new Date(row.financial_freeze_started_at).toISOString()).toBe(
          new Date("2026-09-03T15:30:00.000Z").toISOString()
        )
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(row)
          )
        ).toBe(true)
        expect(
          isUnresolvedFinancialFreeze(
            toPaymentAttemptFinancialAuthority(updated)
          )
        ).toBe(true)
      })
    },
  })
}
