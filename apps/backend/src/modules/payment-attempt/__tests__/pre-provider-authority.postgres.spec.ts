import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  PAYMENT_ATTEMPT_CART_VERSION_UNBOUND,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH,
  listUnresolvedFrozenPaymentAttemptsForCart,
  persistPreProviderFinancialFreezeInTransaction,
  readDurablePreProviderAuthority,
} from "../transactional-authority"

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
  describe("pre-provider authority PostgreSQL routing", () => {
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
      async function seedCartResourceVersion(cartId: string, version = 3) {
        await dbConnection.raw(
          `
            insert into store_resource_version
              (id, resource_type, resource_id, version)
            values (?, 'cart', ?, ?)
          `,
          [`strver_${cartId}`, cartId, version]
        )
      }

      async function seedPaymentAttempt(input: {
        id: string
        cartId: string
        status?: string
        amount?: number
        freeze?: Date | string | null
        canceledConfirmed?: Date | string | null
        discovery?: Date | string | null
        deletedAt?: Date | string | null
        orderId?: string | null
        metadata?: Record<string, unknown> | null
        providerPaymentIntentId?: string | null
        paymentSessionId?: string | null
      }) {
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
              ?, ?, ?, ?, null, null, null, now(), now(), ?
            )
          `,
          [
            input.id,
            input.cartId,
            `paycol_${input.id}`,
            input.paymentSessionId === undefined ? `payses_${input.id}` : input.paymentSessionId,
            input.providerPaymentIntentId ?? null,
            input.status ?? "created",
            input.amount ?? 9900,
            JSON.stringify(
              input.metadata === undefined
                ? { payment_attempt_id: input.id }
                : input.metadata
            ),
            input.orderId ?? null,
            input.freeze ?? null,
            input.canceledConfirmed ?? null,
            input.discovery ?? null,
            input.deletedAt ?? null,
          ]
        )
      }

      afterEach(async () => {
        await dbConnection.raw(
          "delete from payment_attempt where id like 'payatt_r1_%'"
        )
        await dbConnection.raw(
          "delete from store_resource_version where resource_id like 'cart_r1_%' or id like 'strver_cart_r1_%'"
        )
        await dbConnection.raw("delete from cart where id like 'cart_r1_%'")
      })

      it("persists freeze with PostgreSQL CURRENT_TIMESTAMP, 23h replay_deadline, and COMMITs without Stripe", async () => {
        assertNoStripeNetwork()
        const cartId = "cart_r1_auth_persist"
        const attemptId = "payatt_r1_auth_persist"
        await seedCartResourceVersion(cartId, 3)
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: null,
          paymentSessionId: `payses_${attemptId}`,
        })

        const persisted = await dbConnection.transaction(async (transaction: any) => {
          const clock = await transaction.raw(
            "select CURRENT_TIMESTAMP as db_now, clock_timestamp() as wall_clock"
          )
          const row = await persistPreProviderFinancialFreezeInTransaction(
            transaction,
            {
              cart_id: cartId,
              cart_resource_version: 3,
              payment_method_type: "card",
              amount_minor: 9900,
              currency_code: "brl",
              payment_attempt_id: attemptId,
              payment_collection_id: `paycol_${attemptId}`,
              payment_session_id: `payses_${attemptId}`,
            }
          )
          const interval = await transaction.raw(
            `
              select
                extract(epoch from (
                  (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz
                  - (metadata #>> '{stripe_payment_intent_create,authority_created_at}')::timestamptz
                )) as seconds,
                financial_freeze_started_at,
                CURRENT_TIMESTAMP as db_now,
                metadata #>> '{stripe_payment_intent_create,authority_created_at}' as authority_created_at,
                metadata #>> '{stripe_payment_intent_create,replay_deadline}' as replay_deadline
              from payment_attempt
              where id = ?
            `,
            [attemptId]
          )
          const authority = await readDurablePreProviderAuthority(
            transaction,
            attemptId
          )
          return {
            row,
            clock: clock.rows[0].db_now,
            wallClock: clock.rows[0].wall_clock,
            interval: interval.rows[0],
            authority,
          }
        })

        const freezeMs = new Date(
          persisted.row.financial_freeze_started_at as Date | string
        ).getTime()
        const dbNowMs = new Date(persisted.clock as Date | string).getTime()
        const wallClockMs = new Date(persisted.wallClock as Date | string).getTime()
        expect(freezeMs).toBe(dbNowMs)
        expect(Math.abs(freezeMs - wallClockMs)).toBeLessThan(60_000)
        expect(Number(persisted.interval.seconds)).toBe(23 * 3600)
        expect(
          new Date(persisted.interval.financial_freeze_started_at as Date | string).getTime()
        ).toBe(dbNowMs)
        expect(persisted.authority.replay_deadline).toBe(
          persisted.interval.replay_deadline
        )
        expect(persisted.authority.authority_created_at).toBe(
          persisted.interval.authority_created_at
        )
        expect(persisted.row.metadata).toMatchObject({
          cart_resource_version: 3,
          provider_idempotency_key: `payment-attempt:card:${attemptId}`,
          stripe_payment_intent_create: {
            schema: "stripe_payment_intent_create",
            version: 1,
          },
        })

        const committed = await dbConnection.raw(
          `
            select financial_freeze_started_at,
                   metadata -> 'stripe_payment_intent_create' as v1
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        expect(committed.rows).toHaveLength(1)
        expect(committed.rows[0].financial_freeze_started_at).not.toBeNull()
        expect(committed.rows[0].v1).toMatchObject({
          schema: "stripe_payment_intent_create",
          version: 1,
        })
        assertNoStripeNetwork()
      })

      it("lists soft-deleted frozen rows and excludes provider_canceled_confirmed_at", async () => {
        const cartId = "cart_r1_auth_list"
        await seedCartResourceVersion(cartId, 3)
        await seedPaymentAttempt({
          id: "payatt_r1_auth_soft",
          cartId,
          status: "payment_canceled",
          freeze: new Date("2026-09-02T10:00:00.000Z"),
          deletedAt: new Date("2026-09-02T12:00:00.000Z"),
        })
        await seedPaymentAttempt({
          id: "payatt_r1_auth_thawed",
          cartId,
          status: "payment_canceled",
          freeze: new Date("2026-09-02T10:00:00.000Z"),
          canceledConfirmed: new Date("2026-09-02T11:00:00.000Z"),
        })

        const listed = await dbConnection.transaction(async (transaction: any) =>
          listUnresolvedFrozenPaymentAttemptsForCart(transaction, cartId)
        )

        expect(listed.map((row) => row.id)).toEqual(["payatt_r1_auth_soft"])
        expect(listed[0].financial_freeze_started_at).not.toBeNull()
        expect(listed[0].provider_canceled_confirmed_at).toBeNull()
        expect(listed[0].order_id).toBeNull()

        const deleted = await dbConnection.raw(
          "select deleted_at from payment_attempt where id = ?",
          ["payatt_r1_auth_soft"]
        )
        expect(deleted.rows[0].deleted_at).not.toBeNull()
        assertNoStripeNetwork()
      })

      it("fails closed when CartResourceVersion is missing", async () => {
        const cartId = "cart_r1_auth_nocrv"
        const attemptId = "payatt_r1_auth_nocrv"
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: null,
          metadata: null,
        })

        await expect(
          dbConnection.transaction(async (transaction: any) =>
            persistPreProviderFinancialFreezeInTransaction(transaction, {
              cart_id: cartId,
              cart_resource_version: undefined as never,
              payment_method_type: "card",
              amount_minor: 9900,
              currency_code: "brl",
              payment_attempt_id: attemptId,
            })
          )
        ).rejects.toThrow(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)

        const remaining = await dbConnection.raw(
          "select financial_freeze_started_at from payment_attempt where id = ?",
          [attemptId]
        )
        expect(remaining.rows[0].financial_freeze_started_at).toBeNull()
        assertNoStripeNetwork()
      })

      it("rejects durable reread when PaymentAttempt.payment_collection_id drifts after persist", async () => {
        assertNoStripeNetwork()
        const cartId = "cart_r1_auth_col_drift"
        const attemptId = "payatt_r1_auth_col_drift"
        await seedCartResourceVersion(cartId, 3)
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: null,
          paymentSessionId: `payses_${attemptId}`,
        })

        await dbConnection.transaction(async (transaction: any) => {
          await persistPreProviderFinancialFreezeInTransaction(transaction, {
            cart_id: cartId,
            cart_resource_version: 3,
            payment_method_type: "card",
            amount_minor: 9900,
            currency_code: "brl",
            payment_attempt_id: attemptId,
            payment_collection_id: `paycol_${attemptId}`,
            payment_session_id: `payses_${attemptId}`,
          })
        })

        await dbConnection.raw(
          "update payment_attempt set payment_collection_id = ? where id = ?",
          ["paycol_mutated_only", attemptId]
        )

        await expect(
          dbConnection.transaction(async (transaction: any) =>
            readDurablePreProviderAuthority(transaction, attemptId)
          )
        ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
        assertNoStripeNetwork()
      })

      it("rejects durable reread when PaymentAttempt.payment_session_id drifts after persist", async () => {
        assertNoStripeNetwork()
        const cartId = "cart_r1_auth_ses_drift"
        const attemptId = "payatt_r1_auth_ses_drift"
        await seedCartResourceVersion(cartId, 3)
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: null,
          paymentSessionId: `payses_${attemptId}`,
        })

        await dbConnection.transaction(async (transaction: any) => {
          await persistPreProviderFinancialFreezeInTransaction(transaction, {
            cart_id: cartId,
            cart_resource_version: 3,
            payment_method_type: "card",
            amount_minor: 9900,
            currency_code: "brl",
            payment_attempt_id: attemptId,
            payment_collection_id: `paycol_${attemptId}`,
            payment_session_id: `payses_${attemptId}`,
          })
        })

        await dbConnection.raw(
          "update payment_attempt set payment_session_id = ? where id = ?",
          ["payses_mutated_only", attemptId]
        )

        await expect(
          dbConnection.transaction(async (transaction: any) =>
            readDurablePreProviderAuthority(transaction, attemptId)
          )
        ).rejects.toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
        assertNoStripeNetwork()
      })

      it("passes durable reread when Medusa identities remain unchanged after persist", async () => {
        assertNoStripeNetwork()
        const cartId = "cart_r1_auth_id_ok"
        const attemptId = "payatt_r1_auth_id_ok"
        await seedCartResourceVersion(cartId, 3)
        await seedPaymentAttempt({
          id: attemptId,
          cartId,
          freeze: null,
          paymentSessionId: `payses_${attemptId}`,
        })

        await dbConnection.transaction(async (transaction: any) => {
          await persistPreProviderFinancialFreezeInTransaction(transaction, {
            cart_id: cartId,
            cart_resource_version: 3,
            payment_method_type: "card",
            amount_minor: 9900,
            currency_code: "brl",
            payment_attempt_id: attemptId,
            payment_collection_id: `paycol_${attemptId}`,
            payment_session_id: `payses_${attemptId}`,
          })
        })

        const authority = await dbConnection.transaction(async (transaction: any) =>
          readDurablePreProviderAuthority(transaction, attemptId)
        )
        expect(authority.payment_method_type).toBe("card")
        expect(authority.amount_minor).toBe(9900)
        assertNoStripeNetwork()
      })

      it("never invokes an external Stripe provider in this suite", () => {
        assertNoStripeNetwork()
        expect(process.env.DB_HOST && ["localhost", "127.0.0.1", "::1"].includes(
          String(process.env.DB_HOST)
        )).toBe(true)
      })
    },
  })
}
