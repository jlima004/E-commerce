import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  applyStripePaymentIntentWebhookInTransaction,
  assertPaymentAttemptCartResourceVersion,
  invalidatePaymentAttemptsForCartChangeInTransaction,
  lockCartOrderAuthority,
} from "../../src/modules/payment-attempt/transactional-authority"
import { createStructuralCartInvalidationRunner } from "../../src/modules/checkout/shipping-invalidation"
import type { StripePaymentIntentWebhookObject } from "../../src/modules/payment-attempt/service"
import { RECONCILIATION_REASON_CODE } from "../../src/reconciliation/reason-codes"

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
          if (found.rowCount === 0) await client.query(`create database "${name}"`)
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

const paymentIntent: StripePaymentIntentWebhookObject = {
  id: "pi_hr01_pg_01",
  object: "payment_intent",
  amount: 9900,
  amount_received: 9900,
  currency: "brl",
  metadata: { cart_id: "cart_hr01_pg_01" },
  payment_method_types: ["card"],
}

if (!requestedDatabaseName) {
  describe("PaymentAttempt/cart Order authority HR-01 PostgreSQL", () => {
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
    testSuite: ({ dbConnection, getContainer }) => {
      jest.setTimeout(180_000)

      const context = (transaction: any) => ({
        __type: "MedusaContext",
        transactionManager: { getTransactionContext: () => transaction },
        manager: { getTransactionContext: () => transaction },
      })

      async function createCart(container: MedusaContainer, id: string) {
        const cartModule = container.resolve(Modules.CART) as any
        return cartModule.createCarts({
          id,
          currency_code: "brl",
          region_id: "reg_hr01_pg",
        })
      }

      async function seedAttempt(cartId: string, id = "payatt_hr01_pg_01") {
        await dbConnection.raw(
          `
            insert into payment_attempt (
              id, cart_id, payment_collection_id, payment_session_id,
              provider, provider_payment_intent_id, provider_payment_session_id,
              payment_method_type, status, amount, currency_code, metadata,
              awaiting_webhook_since, created_at, updated_at
            ) values (?, ?, ?, ?, 'stripe', ?, ?, 'card',
              'awaiting_webhook_confirmation', 9900, 'brl', ?, ?, ?, ?)
          `,
          [
            id,
            cartId,
            `paycol_${id}`,
            `payses_${id}`,
            paymentIntent.id,
            `ps_${id}`,
            JSON.stringify({ cart_resource_version: 1 }),
            new Date("2026-08-22T10:00:00.000Z"),
            new Date("2026-08-22T09:00:00.000Z"),
            new Date("2026-08-22T09:00:00.000Z"),
          ]
        )
      }

      async function seedVersion(cartId: string, version = 1) {
        await dbConnection.raw(
          `
            insert into store_resource_version
              (id, resource_type, resource_id, version)
            values (?, 'cart', ?, ?)
          `,
          [`strver_${cartId}`, cartId, version]
        )
      }

      async function readState(cartId: string) {
        const cart = await dbConnection.raw(
          "select metadata from cart where id = ? and deleted_at is null",
          [cartId]
        )
        const version = await dbConnection.raw(
          "select version from store_resource_version where resource_type = 'cart' and resource_id = ? and deleted_at is null",
          [cartId]
        )
        const attempt = await dbConnection.raw(
          "select status, order_id, reconciliation_reason_code from payment_attempt where cart_id = ? and deleted_at is null",
          [cartId]
        )
        return {
          metadata: cart.rows[0]?.metadata ?? null,
          version: Number(version.rows[0]?.version ?? 0),
          status: attempt.rows[0]?.status ?? null,
          orderId: attempt.rows[0]?.order_id ?? null,
          reconciliationReasonCode:
            attempt.rows[0]?.reconciliation_reason_code ?? null,
        }
      }

      afterEach(async () => {
        await dbConnection.raw("delete from payment_attempt where id like 'payatt_hr01_pg_%'")
        await dbConnection.raw("delete from store_resource_version where id like 'strver_cart_hr01_pg_%'")
        await dbConnection.raw("delete from cart where id like 'cart_hr01_pg_%'")
      })

      it("rollback mantém cart, resource version e PaymentAttempt quando invalidação falha", async () => {
        const container = getContainer()
        const cartId = "cart_hr01_pg_rollback"
        await createCart(container, cartId)
        await seedVersion(cartId)
        await seedAttempt(cartId, "payatt_hr01_pg_rollback")
        const cartModule = container.resolve(Modules.CART) as any
        const runner = createStructuralCartInvalidationRunner()

        await expect(
          dbConnection.transaction(async (transaction: any) => {
            await cartModule.updateCarts(
              { id: cartId, metadata: { changed: true } },
              context(transaction)
            )
            await transaction.raw(
              "update store_resource_version set version = 2 where resource_type = 'cart' and resource_id = ?",
              [cartId]
            )
            await runner(cartId, new Date("2026-08-22T11:00:00.000Z"), {
              transaction,
              invalidateShippingQuote: async () => {
                throw new Error("SHIPPING_INVALIDATION_FAILED")
              },
            })
          })
        ).rejects.toThrow("SHIPPING_INVALIDATION_FAILED")

        await expect(readState(cartId)).resolves.toEqual({
          metadata: null,
          version: 1,
          status: "awaiting_webhook_confirmation",
          orderId: null,
          reconciliationReasonCode: null,
        })
      })

      it("same-value resource mutation fica stale e fail-closed para Order authority", async () => {
        const container = getContainer()
        const cartId = "cart_hr01_pg_same_value"
        await createCart(container, cartId)
        await seedVersion(cartId, 1)
        await seedAttempt(cartId, "payatt_hr01_pg_same_value")

        const rows = await dbConnection.raw(
          "select (metadata->>'cart_resource_version')::int as cart_resource_version from payment_attempt where id = ?",
          ["payatt_hr01_pg_same_value"]
        )
        const metadata = {
          cart_resource_version: Number(rows.rows[0]?.cart_resource_version),
        }
        expect(() =>
          assertPaymentAttemptCartResourceVersion(
            { metadata },
            1
          )
        ).not.toThrow()
        await dbConnection.raw(
          "update store_resource_version set version = 2 where resource_type = 'cart' and resource_id = ?",
          [cartId]
        )
        expect(() =>
          assertPaymentAttemptCartResourceVersion(
            { metadata },
            2
          )
        ).toThrow("PAYMENT_ATTEMPT_CART_VERSION_STALE")
      })

      it("webhook aguarda o lock da invalidação e não ressuscita estado invalidado", async () => {
        const container = getContainer()
        const cartId = "cart_hr01_pg_race"
        await createCart(container, cartId)
        await seedVersion(cartId)
        await seedAttempt(cartId, "payatt_hr01_pg_race")

        let releaseMutation!: () => void
        const mutationLockAcquired = new Promise<void>((resolve) => {
          dbConnection.transaction(async (transaction: any) => {
            await lockCartOrderAuthority(transaction, cartId)
            resolve()
            await new Promise<void>((unlock) => {
              releaseMutation = unlock
            })
            await invalidatePaymentAttemptsForCartChangeInTransaction(
              transaction,
              cartId,
              new Date("2026-08-22T11:00:00.000Z")
            )
          })
        })

        await mutationLockAcquired
        let staleRead!: () => void
        const staleReadCompleted = new Promise<void>((resolve) => {
          staleRead = resolve
        })
        const webhook = dbConnection.transaction(async (transaction: any) => {
          await transaction.raw(
            "select cart_id from payment_attempt where provider_payment_intent_id = ? and deleted_at is null",
            [paymentIntent.id]
          )
          staleRead()
          await lockCartOrderAuthority(transaction, cartId)
          return applyStripePaymentIntentWebhookInTransaction(
            transaction,
            paymentIntent,
            "payment_intent.succeeded",
            new Date("2026-08-22T11:00:01.000Z")
          )
        })

        await staleReadCompleted
        releaseMutation()
        await expect(webhook).resolves.toBeDefined()
        await expect(readState(cartId)).resolves.toMatchObject({
          status: "invalidated_by_cart_change",
          orderId: null,
          reconciliationReasonCode:
            RECONCILIATION_REASON_CODE.LATE_SUCCEEDED_AUTHORITY_CONFLICT,
        })
      })
    },
  })
}
