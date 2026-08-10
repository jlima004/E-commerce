import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createProductsWorkflow,
} from "@medusajs/core-flows"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { createStripeWebhookPostHandler } from "../../../api/hooks/stripe/route"
import { createStoreSurfaceGuardMiddleware } from "../../../api/store-surface/guard"
import { POST as completeCartOverride } from "../../../api/store/carts/[id]/complete/route"
import { PAYMENT_ATTEMPT_MODULE } from "../../payment-attempt"
import type { PaymentAttemptRecord } from "../../payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../webhooks"
import { CHECKOUT_COMPLETION_MODULE } from ".."
import { ANALYTICS_EVENT_LOG_MODULE } from "../../analytics-event-log"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptResult,
} from "../../../workflows/order/webhook-order-entrypoint"

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

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("canonical Store Order birth PostgreSQL routing", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)
  for (const [key, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") process.env[key] = value
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(120_000)

  type WebhookRecord = {
    id: string
    provider: string
    external_event_id: string | null
    deduplication_key: string
    event_type: string
    status: string
    metadata?: Record<string, unknown> | null
  }

  type PersistedPrerequisites = {
    cartId: string
    paymentCollectionId: string
    paymentSessionId: string
    email: string
  }

  function attempt(
    identity: string,
    prerequisites: PersistedPrerequisites
  ): PaymentAttemptRecord {
    return {
      id: `payatt_${identity}`,
      cart_id: prerequisites.cartId,
      payment_collection_id: prerequisites.paymentCollectionId,
      payment_session_id: prerequisites.paymentSessionId,
      provider: "stripe",
      provider_payment_intent_id: `pi_${identity}`,
      provider_payment_session_id: `ps_${identity}`,
      payment_method_type: "card",
      status: "awaiting_webhook_confirmation",
      amount: 9900,
      currency_code: "brl",
      expires_at: null,
      order_id: null,
      metadata: null,
      client_confirmed_at: null,
      instructions_displayed_at: null,
      awaiting_webhook_since: "2026-08-09T12:00:00.000Z",
      superseded_at: null,
      invalidated_at: null,
      canceled_at: null,
      failed_at: null,
      expired_at: null,
      created_at: "2026-08-09T12:00:00.000Z",
      updated_at: "2026-08-09T12:00:00.000Z",
    }
  }

  function paymentAttemptService(seed: PaymentAttemptRecord) {
    const rows = [seed]
    return {
      rows,
      listPaymentAttempts: jest.fn(async (filters?: Record<string, unknown>) =>
        rows.filter(
          (row) =>
            (!filters?.id || row.id === filters.id) &&
            (!filters?.provider_payment_intent_id ||
              row.provider_payment_intent_id === filters.provider_payment_intent_id)
        )
      ),
      updatePaymentAttempts: jest.fn(async (input) => {
        const updates = Array.isArray(input) ? input : [input]
        for (const update of updates) {
          const index = rows.findIndex((row) => row.id === update.id)
          if (index >= 0) rows[index] = update
        }
        return updates
      }),
    }
  }

  function webhookService() {
    const rows: WebhookRecord[] = []
    return {
      rows,
      listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) =>
        rows.filter(
          (row) =>
            (!filters?.provider || row.provider === filters.provider) &&
            (!filters?.deduplication_key ||
              row.deduplication_key === filters.deduplication_key)
        )
      ),
      createWebhookEventLogs: jest.fn(async (input) => {
        const row = Array.isArray(input) ? input[0] : input
        if (
          rows.some(
            (existing) =>
              existing.provider === row.provider &&
              existing.deduplication_key === row.deduplication_key
          )
        ) {
          throw new Error("duplicate key value violates unique constraint")
        }
        const created = { ...row, id: `whlog_${rows.length + 1}` } as WebhookRecord
        rows.push(created)
        return [created]
      }),
      updateWebhookEventLogs: jest.fn(async (input) => {
        const update = Array.isArray(input) ? input[0] : input
        const index = rows.findIndex((row) => row.id === update.id)
        rows[index] = { ...rows[index], ...update }
        return [rows[index]]
      }),
    }
  }

  function response() {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      headersSent: false,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(body: unknown) {
        this.body = body
        this.headersSent = true
        return this
      },
    }
    return res as unknown as MedusaResponse & typeof res
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const originalEmailFlag = process.env.RESEND_ORDER_CONFIRMATION_ENABLED

      beforeAll(() => {
        process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "false"
      })

      afterAll(() => {
        if (originalEmailFlag === undefined) {
          delete process.env.RESEND_ORDER_CONFIRMATION_ENABLED
        } else {
          process.env.RESEND_ORDER_CONFIRMATION_ENABLED = originalEmailFlag
        }
      })

      async function seedPersistedPrerequisites(
        identity: string
      ): Promise<PersistedPrerequisites> {
        const handleIdentity = identity.replace(/_/g, "-")
        const realContainer = getContainer()
        const fulfillmentModule = realContainer.resolve(Modules.FULFILLMENT) as {
          createShippingProfiles(input: {
            name: string
            type: string
          }): Promise<{ id: string }>
        }
        const cartModule = realContainer.resolve(Modules.CART) as {
          createCarts(input: Record<string, unknown>): Promise<{ id: string }>
        }
        const paymentModule = realContainer.resolve(Modules.PAYMENT) as {
          createPaymentSession(
            paymentCollectionId: string,
            input: Record<string, unknown>
          ): Promise<{ id: string }>
          authorizePaymentSession(
            paymentSessionId: string,
            context: Record<string, unknown>
          ): Promise<unknown>
        }

        const shippingProfile = await fulfillmentModule.createShippingProfiles({
          name: `No shipping ${identity}`,
          type: "default",
        })
        const { result: products } = await createProductsWorkflow(realContainer).run({
          input: {
            products: [
              {
                title: `Canonical Order proof ${identity}`,
                handle: `canonical-order-proof-${handleIdentity}`,
                shipping_profile_id: shippingProfile.id,
                options: [{ title: "Size", values: ["M"] }],
                variants: [
                  {
                    title: "M",
                    sku: `SKU-${identity}`,
                    options: { Size: "M" },
                    manage_inventory: false,
                    allow_backorder: true,
                    metadata: {
                      gelato_product_uid: `gelato_${identity}`,
                      gelato_template_id: `template_${identity}`,
                      gelato_variant_options: { size: "M", color: "Preto" },
                      template_mode: "fixed",
                    },
                    prices: [{ amount: 99, currency_code: "brl" }],
                  },
                ],
              },
            ],
          },
        })
        const variant = products[0].variants[0]
        const email = `${identity}@canonical-order.test`
        const cart = await cartModule.createCarts({
          currency_code: "brl",
          email,
          items: [
            {
              title: `Canonical item ${identity}`,
              quantity: 1,
              unit_price: 99,
              variant_id: variant.id,
              variant_sku: variant.sku,
              requires_shipping: false,
              is_custom_price: true,
            },
          ],
        })
        const { result: paymentCollection } =
          await createPaymentCollectionForCartWorkflow(realContainer).run({
            input: { cart_id: cart.id },
          })
        const paymentSession = await paymentModule.createPaymentSession(
          paymentCollection.id,
          {
            provider_id: "pp_system_default",
            amount: 99,
            currency_code: "brl",
            data: {},
          }
        )
        await paymentModule.authorizePaymentSession(paymentSession.id, {})

        return {
          cartId: cart.id,
          paymentCollectionId: paymentCollection.id,
          paymentSessionId: paymentSession.id,
          email,
        }
      }

      async function persistedOrders(email: string) {
        const orderModule = getContainer().resolve(Modules.ORDER) as {
          listOrders(selector: Record<string, unknown>): Promise<Array<{ id: string }>>
        }
        return orderModule.listOrders({ email })
      }

      function harness(identity: string, prerequisites: PersistedPrerequisites) {
        const realContainer = getContainer()
        const payment = paymentAttemptService(attempt(identity, prerequisites))
        const webhooks = webhookService()
        const analytics: Array<Record<string, unknown>> = []
        let completeCartInvocations = 0
        const realCheckout = realContainer.resolve(CHECKOUT_COMPLETION_MODULE)

        const analyticsModule = {
          listAnalyticsEventLogs: jest.fn(async (filters?: Record<string, unknown>) =>
            analytics.filter(
              (row) =>
                (!filters?.idempotency_key ||
                  row.idempotency_key === filters.idempotency_key) &&
                (!filters?.order_id || row.order_id === filters.order_id)
            )
          ),
          createAnalyticsEventLogs: jest.fn(async (input) => {
            const row = Array.isArray(input) ? input[0] : input
            const created = { ...row, id: `anlevt_${identity}_${analytics.length + 1}` }
            analytics.push(created)
            return [created]
          }),
        }

        const container = {
          resolve: (key: string) => {
            if (key === CHECKOUT_COMPLETION_MODULE) return realCheckout
            if (key === PAYMENT_ATTEMPT_MODULE) return payment
            if (key === WEBHOOKS_MODULE) return webhooks
            if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
              return analyticsModule
            }
            return realContainer.resolve(key)
          },
        } as unknown as MedusaContainer

        const runOrderEntrypoint = async (
          _scope: MedusaContainer,
          input: Parameters<typeof runCreateOrderFromConfirmedPaymentAttemptEntrypoint>[1]
        ): Promise<CreateOrderFromConfirmedPaymentAttemptResult> =>
          runCreateOrderFromConfirmedPaymentAttemptEntrypoint(container, input, {
            now: () => new Date("2026-08-09T13:00:00.000Z"),
            runCompleteCart: async (_scope, cartId) => {
              completeCartInvocations += 1
              const { result } = await completeCartWorkflow(realContainer).run({
                input: { id: cartId },
              })
              return result
            },
          })

        const event = (eventId: string) => ({
          id: eventId,
          type: "payment_intent.succeeded",
          account: null,
          livemode: false,
          data: {
            object: {
              id: `pi_${identity}`,
              object: "payment_intent",
              status: "succeeded",
              amount: 9900,
              amount_received: 9900,
              currency: "brl",
              payment_method_types: ["card"],
              metadata: {},
            },
          },
        })

        const post = async (eventId: string) => {
          const handler = createStripeWebhookPostHandler({
            appEnv: {
              STRIPE_WEBHOOK_INGESTION_ENABLED: true,
              STRIPE_WEBHOOK_SECRET: "whsec_synthetic_13_07",
            } as never,
            stripe: {
              webhooks: {
                constructEvent: () => event(eventId),
              },
            },
            now: () => new Date("2026-08-09T13:00:00.000Z"),
            runOrderEntrypoint,
          })
          const res = response()
          await handler(
            {
              headers: { "stripe-signature": "t=1,v1=synthetic" },
              rawBody: Buffer.from(JSON.stringify(event(eventId))),
              correlationId: `corr_${identity}`,
              scope: container,
            } as unknown as MedusaRequest,
            res
          )
          return res
        }

        return {
          container,
          payment,
          webhooks,
          post,
          counts: () => ({ completeCartInvocations }),
        }
      }

      it("Store attempts including native complete reach zero Order-birth entrypoints", async () => {
        const prerequisites = await seedPersistedPrerequisites(
          "store_negative_1307_r1"
        )
        const state = harness("store_negative_1307_r1", prerequisites)
        const guard = createStoreSurfaceGuardMiddleware()
        const attempts = [
          ["POST", "/store/carts/cart_negative/complete"],
          ["POST", "/store/customers/me/cart/attach"],
          ["POST", "/store/payment-collections/paycol/sessions"],
          ["GET", "/store/shipping-options"],
          ["POST", "/store/orders/order/transfer/request"],
          ["POST", "/store/not-a-route"],
        ] as const

        for (const [method, originalUrl] of attempts) {
          const req = {
            method,
            originalUrl,
            url: originalUrl,
            baseUrl: "/store",
            path: originalUrl.replace(/^\/store/, ""),
            headers: {},
            scope: { resolve: jest.fn() },
          }
          const res = response()
          const next = jest.fn()
          guard(req as never, res, next)
          expect(next).not.toHaveBeenCalled()
          expect(req.scope.resolve).not.toHaveBeenCalled()
        }

        const completeRes = response()
        const completeReq = {
          params: { id: "cart_negative" },
          scope: { resolve: jest.fn() },
        }
        await completeCartOverride(completeReq as never, completeRes)
        expect(completeReq.scope.resolve).not.toHaveBeenCalled()
        expect(state.counts()).toEqual({ completeCartInvocations: 0 })
        expect(await persistedOrders(prerequisites.email)).toHaveLength(0)

        const rows = await dbConnection.raw(
          "select count(*)::int as count from checkout_completion_log where payment_intent_id = 'pi_store_negative_1307_r1'"
        )
        expect(rows.rows).toEqual([{ count: 0 }])
      })

      it("trusted canonical webhook creates exactly one correlated Order and replay stays one", async () => {
        const prerequisites = await seedPersistedPrerequisites("canonical_1307_r1")
        const state = harness("canonical_1307_r1", prerequisites)
        const first = await state.post("evt_canonical_1307_r1")
        expect(first.statusCode).toBe(200)
        expect(first.body).toEqual(expect.objectContaining({ ok: true, status: "processed" }))
        expect(state.payment.rows[0].status).toBe("payment_confirmed_by_webhook")
        const firstOrders = await persistedOrders(prerequisites.email)
        expect(firstOrders).toHaveLength(1)
        expect(state.counts()).toEqual({ completeCartInvocations: 1 })

        const replay = await state.post("evt_canonical_1307_r1")
        expect(replay.statusCode).toBe(200)
        expect(replay.body).toEqual(expect.objectContaining({ ok: true, duplicate: true }))
        const replayOrders = await persistedOrders(prerequisites.email)
        expect(replayOrders).toHaveLength(1)
        expect(replayOrders[0].id).toBe(firstOrders[0].id)

        const rows = await dbConnection.raw(
          "select status, order_id, payment_attempt_id from checkout_completion_log where payment_intent_id = 'pi_canonical_1307_r1'"
        )
        expect(rows.rows).toEqual([
          {
            status: "completed",
            order_id: firstOrders[0].id,
            payment_attempt_id: "payatt_canonical_1307_r1",
          },
        ])
      })

      it("concurrent canonical replay has multiple accepted attempts but one persisted birth", async () => {
        const prerequisites = await seedPersistedPrerequisites("concurrent_1307_r1")
        const state = harness("concurrent_1307_r1", prerequisites)
        const results = await Promise.all([
          state.post("evt_concurrent_1307_r1_a"),
          state.post("evt_concurrent_1307_r1_b"),
          state.post("evt_concurrent_1307_r1_c"),
        ])

        expect(results.every((result) => result.statusCode === 200)).toBe(true)
        expect(results).toHaveLength(3)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        expect(new Set(orders.map((order) => order.id)).size).toBe(1)
        expect(state.counts().completeCartInvocations).toBe(1)

        const rows = await dbConnection.raw(
          "select count(*)::int as count, max(order_id) as order_id from checkout_completion_log where payment_intent_id = 'pi_concurrent_1307_r1'"
        )
        expect(rows.rows).toEqual([
          { count: 1, order_id: orders[0].id },
        ])
      })
    },
  })
}
