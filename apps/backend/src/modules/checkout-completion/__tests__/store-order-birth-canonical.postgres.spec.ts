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
import { STORE_RESOURCE_VERSION_MODULE } from "../../store-resource-version"
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

  jest.setTimeout(180_000)

  type WebhookRecord = {
    id: string
    provider: string
    external_event_id: string | null
    deduplication_key: string
    event_type: string
    status: string
    metadata?: Record<string, unknown> | null
  }

  type SeedMoney = {
    itemUnitPrice: number
    shippingAmount?: number
    paymentSessionAmount: number
    paymentAttemptAmount: number
    stripeMinorAmount: number
  }

  type PersistedPrerequisites = {
    cartId: string
    paymentCollectionId: string
    paymentSessionId: string
    email: string
    paymentAttemptId: string
    stripeMinorAmount: number
  }

  const DEFAULT_SEED_MONEY: SeedMoney = {
    itemUnitPrice: 99,
    paymentSessionAmount: 99,
    paymentAttemptAmount: 9900,
    stripeMinorAmount: 9900,
  }

  function exactMajorLiteral(value: unknown): number {
    if (typeof value === "number") {
      return value
    }
    if (typeof value === "bigint") {
      return Number(value)
    }
    if (typeof value === "string") {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        throw new Error(`AMOUNT_STRING_UNPARSABLE:${value}`)
      }
      return parsed
    }
    if (value && typeof value === "object") {
      const record = value as {
        numeric?: unknown
        toNumber?: () => unknown
      }
      if (typeof record.numeric === "number") {
        return record.numeric
      }
      if (typeof record.numeric === "string") {
        const parsed = Number(record.numeric)
        if (!Number.isFinite(parsed)) {
          throw new Error(`AMOUNT_NUMERIC_UNPARSABLE:${record.numeric}`)
        }
        return parsed
      }
      if (typeof record.toNumber === "function") {
        return Number(record.toNumber())
      }
      const digits = String(value)
      if (/^-?\d+(\.\d+)?$/.test(digits)) {
        return Number(digits)
      }
    }
    throw new Error(
      `AMOUNT_REPRESENTATION_UNREADABLE:${typeof value}:${String(value)}`
    )
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
        identity: string,
        money: SeedMoney = DEFAULT_SEED_MONEY
      ): Promise<PersistedPrerequisites> {
        const handleIdentity = identity.replace(/_/g, "-")
        const realContainer = getContainer()
        const fulfillmentModule = realContainer.resolve(Modules.FULFILLMENT) as {
          createShippingProfiles(input: {
            name: string
            type: string
          }): Promise<{ id: string }>
        }
        const cartModule = realContainer.resolve(Modules.CART) as unknown as {
          createCarts(input: Record<string, unknown>): Promise<{ id: string }>
          addShippingMethods(
            cartId: string,
            methods: Array<{ name: string; amount: number }>
          ): Promise<unknown>
        }
        const paymentModule = realContainer.resolve(Modules.PAYMENT) as unknown as {
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
                    prices: [{ amount: money.itemUnitPrice, currency_code: "brl" }],
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
              unit_price: money.itemUnitPrice,
              variant_id: variant.id,
              variant_sku: variant.sku,
              requires_shipping: false,
              is_custom_price: true,
            },
          ],
        })
        if (money.shippingAmount != null) {
          await cartModule.addShippingMethods(cart.id, [
            {
              name: `Canonical shipping ${identity}`,
              amount: money.shippingAmount,
            },
          ])
        }
        const { result: paymentCollection } =
          await createPaymentCollectionForCartWorkflow(realContainer).run({
            input: { cart_id: cart.id },
          })
        const paymentSession = await paymentModule.createPaymentSession(
          paymentCollection.id,
          {
            provider_id: "pp_system_default",
            amount: money.paymentSessionAmount,
            currency_code: "brl",
            data: {},
          }
        )
        await paymentModule.authorizePaymentSession(paymentSession.id, {})

        const resourceVersionModule = realContainer.resolve(
          STORE_RESOURCE_VERSION_MODULE
        ) as {
          baseRepository_: {
            transaction<T>(
              callback: (transactionManager: unknown) => Promise<T>
            ): Promise<T>
          }
          initialize(
            resourceType: string,
            resourceId: string,
            sharedContext: unknown
          ): Promise<{ version: number }>
        }
        const cartResourceVersion =
          await resourceVersionModule.baseRepository_.transaction(
            async (transactionManager) =>
              resourceVersionModule.initialize("cart", cart.id, {
                __type: "MedusaContext",
                transactionManager,
                manager: transactionManager,
              })
          )

        const paymentAttemptId = `payatt_${identity}`
        const paymentAttemptModule = realContainer.resolve(
          PAYMENT_ATTEMPT_MODULE
        ) as {
          createPaymentAttempts(input: Record<string, unknown>): Promise<unknown>
        }
        await paymentAttemptModule.createPaymentAttempts({
          id: paymentAttemptId,
          cart_id: cart.id,
          payment_collection_id: paymentCollection.id,
          payment_session_id: paymentSession.id,
          provider: "stripe",
          provider_payment_intent_id: `pi_${identity}`,
          provider_payment_session_id: `ps_${identity}`,
          payment_method_type: "card",
          status: "awaiting_webhook_confirmation",
          amount: money.paymentAttemptAmount,
          currency_code: "brl",
          metadata: { cart_resource_version: cartResourceVersion.version },
          awaiting_webhook_since: new Date("2026-08-09T12:00:00.000Z"),
        })

        return {
          cartId: cart.id,
          paymentCollectionId: paymentCollection.id,
          paymentSessionId: paymentSession.id,
          email,
          paymentAttemptId,
          stripeMinorAmount: money.stripeMinorAmount,
        }
      }

      async function persistedOrders(email: string) {
        const orderModule = getContainer().resolve(Modules.ORDER) as {
          listOrders(
            selector: Record<string, unknown>,
            config?: { select?: string[] }
          ): Promise<
            Array<{
              id: string
              total?: unknown
              currency_code?: string
              email?: string
            }>
          >
        }
        return orderModule.listOrders(
          { email },
          { select: ["id", "total", "currency_code", "email"] }
        )
      }

      async function loadCartObservedMoney(cartId: string) {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as {
          graph(input: {
            entity: string
            fields: string[]
            filters: Record<string, unknown>
          }): Promise<{ data: Array<Record<string, unknown>> }>
        }
        const { data } = await query.graph({
          entity: "cart",
          fields: [
            "id",
            "total",
            "item_total",
            "shipping_total",
            "currency_code",
            "items.unit_price",
            "items.quantity",
          ],
          filters: { id: cartId },
        })
        return data[0]
      }

      async function persistedPaymentAttempt(paymentAttemptId: string) {
        const paymentAttemptModule = getContainer().resolve(
          PAYMENT_ATTEMPT_MODULE
        ) as {
          listPaymentAttempts(
            filters: Record<string, unknown>
          ): Promise<PaymentAttemptRecord[]>
        }
        const rows = await paymentAttemptModule.listPaymentAttempts({
          id: paymentAttemptId,
        })
        return rows[0]
      }

      function harness(identity: string, prerequisites: PersistedPrerequisites) {
        const realContainer = getContainer()
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
              amount: prerequisites.stripeMinorAmount,
              amount_received: prerequisites.stripeMinorAmount,
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
        const confirmedAttempt = await persistedPaymentAttempt(
          prerequisites.paymentAttemptId
        )
        expect(confirmedAttempt.status).toBe("payment_confirmed_by_webhook")
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

      it("canonical webhook births Order.total 110 from cart 110 and PaymentAttempt 11000", async () => {
        const prerequisites = await seedPersistedPrerequisites("money_110_r1", {
          itemUnitPrice: 100,
          shippingAmount: 10,
          paymentSessionAmount: 110,
          paymentAttemptAmount: 11000,
          stripeMinorAmount: 11000,
        })

        const cartBefore = await loadCartObservedMoney(prerequisites.cartId)
        expect(cartBefore).toBeDefined()
        const cartTotal = cartBefore.total
        const itemUnitPrice = (
          cartBefore.items as Array<{ unit_price?: unknown }> | undefined
        )?.[0]?.unit_price
        const itemTotal = cartBefore.item_total
        const shippingTotal = cartBefore.shipping_total

        if (typeof cartTotal === "number") {
          expect(cartTotal).toBe(110)
        } else {
          expect(exactMajorLiteral(cartTotal)).toBe(110)
        }
        expect(exactMajorLiteral(itemUnitPrice)).toBe(100)
        expect(exactMajorLiteral(cartTotal)).not.toBe(
          exactMajorLiteral(itemUnitPrice)
        )
        if (itemTotal !== undefined && itemTotal !== null) {
          expect(exactMajorLiteral(itemTotal)).not.toBe(110)
        }
        if (shippingTotal !== undefined && shippingTotal !== null) {
          expect(exactMajorLiteral(shippingTotal)).toBe(10)
        }

        const attemptBefore = await persistedPaymentAttempt(
          prerequisites.paymentAttemptId
        )
        if (typeof attemptBefore.amount === "number") {
          expect(attemptBefore.amount).toBe(11000)
        } else {
          expect(attemptBefore.amount).toBe("11000")
        }
        const attemptSqlBefore = await dbConnection.raw(
          "select amount from payment_attempt where id = ?",
          [prerequisites.paymentAttemptId]
        )
        expect(Number(attemptSqlBefore.rows[0].amount)).toBe(11000)

        const state = harness("money_110_r1", prerequisites)
        const first = await state.post("evt_money_110_r1")
        expect(first.statusCode).toBe(200)
        expect(first.body).toEqual(
          expect.objectContaining({ ok: true, status: "processed" })
        )
        expect(state.counts()).toEqual({ completeCartInvocations: 1 })

        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const order = orders[0]
        const orderTotal = order.total
        if (typeof orderTotal === "number") {
          expect(orderTotal).toBe(110)
        } else {
          expect(exactMajorLiteral(orderTotal)).toBe(110)
        }

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as {
          graph(input: {
            entity: string
            fields: string[]
            filters: Record<string, unknown>
          }): Promise<{ data: Array<Record<string, unknown>> }>
        }
        const graphOrder = await query.graph({
          entity: "order",
          fields: ["id", "total", "currency_code", "email"],
          filters: { id: order.id },
        })
        const graphTotal = graphOrder.data[0]?.total
        if (typeof graphTotal === "number") {
          expect(graphTotal).toBe(110)
        } else {
          expect(exactMajorLiteral(graphTotal)).toBe(110)
        }

        const attemptAfter = await persistedPaymentAttempt(
          prerequisites.paymentAttemptId
        )
        if (typeof attemptAfter.amount === "number") {
          expect(attemptAfter.amount).toBe(11000)
        } else {
          expect(attemptAfter.amount).toBe("11000")
        }
      })
    },
  })
}
