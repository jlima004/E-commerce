import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { asValue } from "@medusajs/framework/awilix"
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
import {
  acquireCheckoutOrderBirthAuthorityInTransaction,
  CheckoutCompletionAuthorityConflictError,
} from "../service"
import { brlMajorToMinor } from "../../../utils/money-units"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../analytics-event-log"
import {
  OrderCreationEntrypointError,
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptResult,
  type WorkflowRuntimeOverrides,
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
        ) as unknown as {
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

      function harness(
        identity: string,
        prerequisites: PersistedPrerequisites,
        harnessOverrides?: Partial<WorkflowRuntimeOverrides>,
        sharedWebhooks?: ReturnType<typeof webhookService>
      ) {
        const realContainer = getContainer()
        const webhooks = sharedWebhooks ?? webhookService()
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

        const mergedOverrides: WorkflowRuntimeOverrides = {
          now: () => new Date("2026-08-09T13:00:00.000Z"),
          runCompleteCart: async (_scope, cartId, transactionId) => {
            completeCartInvocations += 1
            const { result } = await completeCartWorkflow(realContainer).run({
              input: { id: cartId },
              ...(transactionId ? { context: { transactionId } } : {}),
            })
            return result
          },
          ...harnessOverrides,
        }

        const runOrderEntrypoint = async (
          _scope: MedusaContainer,
          input: Parameters<typeof runCreateOrderFromConfirmedPaymentAttemptEntrypoint>[1]
        ): Promise<CreateOrderFromConfirmedPaymentAttemptResult> =>
          runCreateOrderFromConfirmedPaymentAttemptEntrypoint(container, input, mergedOverrides)

        const directEntrypoint = async (
          input: Parameters<typeof runCreateOrderFromConfirmedPaymentAttemptEntrypoint>[1],
          extraOverrides?: Partial<WorkflowRuntimeOverrides>
        ): Promise<CreateOrderFromConfirmedPaymentAttemptResult> =>
          runCreateOrderFromConfirmedPaymentAttemptEntrypoint(container, input, {
            ...mergedOverrides,
            ...extraOverrides,
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
          directEntrypoint,
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

      // ================================================================
      // FIN-04: EXACTLY-ONE ORDER BIRTH / POST-ORDER RECOVERY PROOFS
      // ================================================================

      it("O1: normal order birth passes transactionId = CCL.id to completeCartWorkflow", async () => {
        const prerequisites = await seedPersistedPrerequisites("o1_birth_txn_01")
        let capturedTransactionId: string | undefined
        const state = harness("o1_birth_txn_01", prerequisites, {
          runCompleteCart: async (_scope, cartId, transactionId) => {
            capturedTransactionId = transactionId
            const { result } = await completeCartWorkflow(getContainer()).run({
              input: { id: cartId },
              ...(transactionId ? { context: { transactionId } } : {}),
            })
            return result
          },
        })

        const res = await state.post("evt_o1_birth_txn_01")
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual(expect.objectContaining({ ok: true, status: "processed" }))

        // transactionId must start with chkcpl_ (the CCL id)
        expect(capturedTransactionId).toBeDefined()
        expect(capturedTransactionId).toMatch(/^chkcpl_/)

        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)

        // CCL must be completed with order_id bound
        const cclRows = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = 'pi_o1_birth_txn_01'"
        )
        expect(cclRows.rows).toEqual([
          {
            status: "completed",
            order_id: orders[0].id,
          },
        ])
      })

      it("O2: crash after physical order creation — recovery finds and binds exact Order X", async () => {
        const prerequisites = await seedPersistedPrerequisites("o2_crash_recovery_01")
        let crashedOrderId: string | null = null
        let crashCount = 0

        // First attempt: crash AFTER physical order is created
        const crashState = harness("o2_crash_recovery_01", prerequisites, {
          afterPhysicalOrderCreated: async (order) => {
            crashedOrderId = order.id
            crashCount += 1
            throw new Error("SIMULATED_CRASH_AFTER_ORDER_CREATED")
          },
        })

        const crashRes = await crashState.post("evt_o2_crash_a")
        expect(crashRes.statusCode).toBe(200)
        expect(crashedOrderId).toBeTruthy()
        expect(crashCount).toBe(1)

        // Order X physically exists in DB
        const ordersAfterCrash = await persistedOrders(prerequisites.email)
        expect(ordersAfterCrash).toHaveLength(1)
        expect(ordersAfterCrash[0].id).toBe(crashedOrderId)

        // CCL exists (crash triggered durable reconciliation)
        const cclAfterCrash = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = 'pi_o2_crash_recovery_01'"
        )
        expect(cclAfterCrash.rows).toHaveLength(1)

        // Recovery attempt: no crash injection
        const recoveryState = harness("o2_crash_recovery_01", prerequisites)
        const recoveryRes = await recoveryState.post("evt_o2_crash_b")
        expect(recoveryRes.statusCode).toBe(200)

        // Must recover Order X, not create a new one
        const ordersAfterRecovery = await persistedOrders(prerequisites.email)
        expect(ordersAfterRecovery).toHaveLength(1)
        expect(ordersAfterRecovery[0].id).toBe(crashedOrderId)

        // CCL must now be completed
        const cclAfterRecovery = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = 'pi_o2_crash_recovery_01'"
        )
        expect(cclAfterRecovery.rows).toEqual([
          {
            status: "completed",
            order_id: crashedOrderId,
          },
        ])

        // PA must be bound to the recovered order
        const attempt = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(attempt.order_id).toBe(crashedOrderId)
      })

      it("O3: repeated recovery returns same Order X every time, 0 new orders, 0 new CCLs", async () => {
        const prerequisites = await seedPersistedPrerequisites("o3_repeated_01")

        // First: create the order normally
        const firstState = harness("o3_repeated_01", prerequisites)
        const first = await firstState.post("evt_o3_repeated_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const originalOrderId = orders[0].id

        // Repeated recovery attempts (N=3) with same event id
        for (let i = 0; i < 3; i++) {
          const retryState = harness(
            "o3_repeated_01",
            prerequisites,
            undefined,
            firstState.webhooks
          )
          const res = await retryState.post("evt_o3_repeated_first")
          expect(res.statusCode).toBe(200)
          expect(res.body).toEqual(
            expect.objectContaining({ ok: true, duplicate: true })
          )
        }

        // Still exactly 1 order
        const finalOrders = await persistedOrders(prerequisites.email)
        expect(finalOrders).toHaveLength(1)
        expect(finalOrders[0].id).toBe(originalOrderId)

        // Still exactly 1 CCL
        const cclRows = await dbConnection.raw(
          "select count(*)::int as count from checkout_completion_log where payment_intent_id = 'pi_o3_repeated_01'"
        )
        expect(cclRows.rows).toEqual([{ count: 1 }])
      })

      it("O4: two concurrent recovery attempts produce exactly 1 order, same final order_id", async () => {
        const prerequisites = await seedPersistedPrerequisites("o4_concurrent_01")
        const stateA = harness("o4_concurrent_01", prerequisites)
        const stateB = harness("o4_concurrent_01", prerequisites)

        const [resA, resB] = await Promise.all([
          stateA.post("evt_o4_concurrent_a"),
          stateB.post("evt_o4_concurrent_b"),
        ])

        expect(resA.statusCode).toBe(200)
        expect(resB.statusCode).toBe(200)

        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)

        // Both should agree on the same order
        const cclRows = await dbConnection.raw(
          "select count(*)::int as count, max(order_id) as order_id from checkout_completion_log where payment_intent_id = 'pi_o4_concurrent_01'"
        )
        expect(cclRows.rows[0].count).toBe(1)
        expect(cclRows.rows[0].order_id).toBe(orders[0].id)
      })

      it("O5: soft-deleted CCL authority prevents second authority creation for same cart", async () => {
        const prerequisites = await seedPersistedPrerequisites("o5_softdel_01")

        // Create order normally
        const firstState = harness("o5_softdel_01", prerequisites)
        const first = await firstState.post("evt_o5_softdel_first")
        expect(first.statusCode).toBe(200)

        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)

        // Soft-delete the CCL row
        await dbConnection.raw(
          "update checkout_completion_log set deleted_at = now() where payment_intent_id = 'pi_o5_softdel_01'"
        )

        // Verify soft-deleted
        const softDeleted = await dbConnection.raw(
          "select deleted_at is not null as is_deleted from checkout_completion_log where payment_intent_id = 'pi_o5_softdel_01'"
        )
        expect(softDeleted.rows[0].is_deleted).toBe(true)

        // UQ constraint on (operation, cart_id) survives soft delete
        // Try direct insert with same cart_id — must fail
        await expect(
          dbConnection.raw(
            `insert into checkout_completion_log (
              id, operation, idempotency_key, cart_id, payment_intent_id,
              payment_attempt_id, status, locked_at, created_at, updated_at
            ) values (
              'chkcpl_collision_o5', 'complete_checkout_create_order', 'pi_collision_o5',
              ?, 'pi_collision_o5', 'payatt_collision_o5', 'processing', now(), now(), now()
            )`,
            [prerequisites.cartId]
          )
        ).rejects.toThrow(/duplicate key value violates unique constraint|23505/)

        // Replay via webhook still returns the original order
        const replayState = harness("o5_softdel_01", prerequisites)
        const replay = await replayState.post("evt_o5_softdel_replay")
        expect(replay.statusCode).toBe(200)

        const ordersAfter = await persistedOrders(prerequisites.email)
        expect(ordersAfter).toHaveLength(1)
        expect(ordersAfter[0].id).toBe(orders[0].id)
      })

      it("O6: true recovered-order conflict — candidate conflicts with authority, fails closed without overwriting", async () => {
        const prerequisites = await seedPersistedPrerequisites("o6_conflict_01")

        // Create order normally first
        const firstState = harness("o6_conflict_01", prerequisites)
        const first = await firstState.post("evt_o6_conflict_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const realOrderId = orders[0].id

        // Tamper the CCL to set a conflicting order_id ("order_CONFLICT_CCL_Y")
        // and keep PA order_id = null so recovery scanner candidate validation executes.
        await dbConnection.raw(
          "update payment_attempt set order_id = null where id = ?",
          [prerequisites.paymentAttemptId]
        )
        await dbConnection.raw(
          "update checkout_completion_log set status = 'processing', order_id = 'order_CONFLICT_CCL_Y', completed_at = null, execution_started_at = now() where payment_intent_id = 'pi_o6_conflict_01'"
        )

        let completeCartCalled = 0
        const conflictState = harness("o6_conflict_01", prerequisites, {
          runCompleteCart: async () => {
            completeCartCalled += 1
            throw new Error("COMPLETE_CART_MUST_NOT_BE_CALLED")
          },
        })

        const input = {
          payment_attempt_id: prerequisites.paymentAttemptId,
          payment_intent_id: "pi_o6_conflict_01",
          stripe_event_id: "evt_o6_conflict_replay",
          correlation_id: "corr_o6_conflict",
        }

        // Direct entrypoint executes recovery scan, finds realOrderId by marker,
        // detects conflict with CCL.order_id ("order_CONFLICT_CCL_Y"),
        // fails closed without overwriting or calling completeCart
        await expect(conflictState.directEntrypoint(input)).rejects.toThrow(
          /ORDER_ENTRYPOINT_ORDER_ID_CONFLICT|CCL_ORDER_ID_CONFLICT/
        )

        expect(completeCartCalled).toBe(0)

        // CCL must be marked reconciliation_required
        const cclRows = await dbConnection.raw(
          "select status, reconciliation_reason_code, order_id from checkout_completion_log where payment_intent_id = 'pi_o6_conflict_01'"
        )
        expect(cclRows.rows[0].status).toBe("reconciliation_required")
        expect(cclRows.rows[0].reconciliation_reason_code).toBe("ORDER_BIRTH_AUTHORITY_CONFLICT")
        expect(cclRows.rows[0].order_id).toBe("order_CONFLICT_CCL_Y")

        // PA must NOT be overwritten
        const attempt = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(attempt.order_id).toBeNull()

        // Real order is unchanged
        const ordersAfter = await persistedOrders(prerequisites.email)
        expect(ordersAfter).toHaveLength(1)
        expect(ordersAfter[0].id).toBe(realOrderId)
      })

      it("O7: PA has order X, CCL has order Y — entrypoint detects conflict", async () => {
        const prerequisites = await seedPersistedPrerequisites("o7_pa_ccl_01")

        // Create order normally first
        const firstState = harness("o7_pa_ccl_01", prerequisites)
        const first = await firstState.post("evt_o7_pa_ccl_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const realOrderId = orders[0].id

        // Tamper PA to point to a different order
        await dbConnection.raw(
          "update payment_attempt set order_id = 'order_FAKE_PA_Y' where id = ?",
          [prerequisites.paymentAttemptId]
        )

        // Direct entrypoint should detect conflict between PA.order_id and CCL.order_id
        const conflictState = harness("o7_pa_ccl_01", prerequisites)
        const input = {
          payment_attempt_id: prerequisites.paymentAttemptId,
          payment_intent_id: "pi_o7_pa_ccl_01",
          stripe_event_id: "evt_o7_pa_ccl_conflict",
          correlation_id: "corr_o7_pa_ccl",
        }

        // PA has "order_FAKE_PA_Y" but CCL has realOrderId -> conflict
        await expect(conflictState.directEntrypoint(input)).rejects.toThrow(
          /ORDER_ENTRYPOINT_ORDER_ID_CONFLICT|ORDER_ENTRYPOINT/
        )
      })

      it("O8: R4 ambiguous state recovery — recovers exact Order X without webhook", async () => {
        const prerequisites = await seedPersistedPrerequisites("o8_ambiguous_01")

        // 1. Create order normally first to have a real physical Order X in DB
        const normalState = harness("o8_ambiguous_01", prerequisites)
        const first = await normalState.post("evt_o8_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const orderX = orders[0]

        // 2. Artificially set CCL into R4 ambiguous state:
        // status = reconciliation_required, reason = ORDER_BIRTH_EXECUTION_AMBIGUOUS,
        // order_id = null, execution_started_at != null
        await dbConnection.raw(
          `update checkout_completion_log
           set status = 'reconciliation_required',
               reconciliation_reason_code = 'ORDER_BIRTH_EXECUTION_AMBIGUOUS',
               order_id = null,
               completed_at = null,
               execution_started_at = now() - interval '5 minutes'
           where payment_intent_id = 'pi_o8_ambiguous_01'`
        )
        // Set PA order_id = null
        await dbConnection.raw(
          "update payment_attempt set order_id = null where id = ?",
          [prerequisites.paymentAttemptId]
        )

        // 3. Run independent recovery (direct entrypoint without original webhook)
        let completeCartCalled = 0
        const recoveryState = harness("o8_ambiguous_01", prerequisites, {
          runCompleteCart: async () => {
            completeCartCalled += 1
            throw new Error("SHOULD_NOT_BE_CALLED")
          },
        })

        const result = await recoveryState.directEntrypoint({
          payment_attempt_id: prerequisites.paymentAttemptId,
          payment_intent_id: "pi_o8_ambiguous_01",
          stripe_event_id: "evt_o8_recovery",
          correlation_id: "corr_o8_recovery",
        })

        // Require:
        // X recovered
        expect(result.order_id).toBe(orderX.id)
        expect(completeCartCalled).toBe(0)

        // CCL -> completed, order_id = X
        const cclRows = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = 'pi_o8_ambiguous_01'"
        )
        expect(cclRows.rows).toEqual([
          {
            status: "completed",
            order_id: orderX.id,
          },
        ])

        // PA.order_id = X
        const attempt = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(attempt.order_id).toBe(orderX.id)

        // physical Orders = 1
        const finalOrders = await persistedOrders(prerequisites.email)
        expect(finalOrders).toHaveLength(1)
        expect(finalOrders[0].id).toBe(orderX.id)
      })

      it("O8L: late Order (+30m after execution_started_at) recovered via production scanner without completeCart", async () => {
        const identity = "late_scan_30m_01"
        const prerequisites = await seedPersistedPrerequisites(identity)

        // 1. Create order normally to persist real physical Order X with birth marker
        const normalState = harness(identity, prerequisites)
        const first = await normalState.post("evt_late_scan_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const orderX = orders[0]

        const cclBefore = await dbConnection.raw(
          "select id, order_id from checkout_completion_log where payment_intent_id = ?",
          [`pi_${identity}`]
        )
        const cclId = cclBefore.rows[0].id as string
        expect(cclBefore.rows[0].order_id).toBe(orderX.id)

        const markerRow = await dbConnection.raw(
          `select metadata->>'order_birth_checkout_completion_log_id' as marker
           from "order" where id = ?`,
          [orderX.id]
        )
        expect(markerRow.rows[0].marker).toBe(cclId)

        // 2. Simulate late-birth durable state:
        // T0 = execution_started_at = now() - 40m; Order created_at = T0 + 30m = now() - 10m
        // (outside legacy execution_started_at + 5m upper window ending at now() - 35m)
        await dbConnection.raw(
          `update checkout_completion_log
           set status = 'reconciliation_required',
               reconciliation_reason_code = 'ORDER_BIRTH_EXECUTION_AMBIGUOUS',
               order_id = null,
               completed_at = null,
               execution_started_at = now() - interval '40 minutes'
           where payment_intent_id = ?`,
          [`pi_${identity}`]
        )
        await dbConnection.raw(
          `update "order"
           set created_at = now() - interval '10 minutes'
           where id = ?`,
          [orderX.id]
        )
        await dbConnection.raw(
          "update payment_attempt set order_id = null where id = ?",
          [prerequisites.paymentAttemptId]
        )

        // 3. Production recovery entrypoint — scanner must find late Order X without completeCart
        let completeCartCalled = 0
        const recoveryState = harness(identity, prerequisites, {
          runCompleteCart: async () => {
            completeCartCalled += 1
            throw new Error("SHOULD_NOT_BE_CALLED")
          },
        })

        const result = await recoveryState.directEntrypoint({
          payment_attempt_id: prerequisites.paymentAttemptId,
          payment_intent_id: `pi_${identity}`,
          stripe_event_id: "evt_late_scan_recovery",
          correlation_id: "corr_late_scan_recovery",
        })

        expect(result.order_id).toBe(orderX.id)
        expect(completeCartCalled).toBe(0)

        const cclRows = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = ?",
          [`pi_${identity}`]
        )
        expect(cclRows.rows).toEqual([
          {
            status: "completed",
            order_id: orderX.id,
          },
        ])

        const attempt = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(attempt.order_id).toBe(orderX.id)

        const finalOrders = await persistedOrders(prerequisites.email)
        expect(finalOrders).toHaveLength(1)
        expect(finalOrders[0].id).toBe(orderX.id)
      })

      it("O8K: +2h CCL.created_at application skew does not hide exact-marker Order from production recovery", async () => {
        const identity = "skew_ccl_created_2h_01"
        const prerequisites = await seedPersistedPrerequisites(identity)

        // 1. Create order normally to persist real physical Order X with birth marker
        const normalState = harness(identity, prerequisites)
        const first = await normalState.post("evt_skew_ccl_first")
        expect(first.statusCode).toBe(200)
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const orderX = orders[0]

        const cclBefore = await dbConnection.raw(
          "select id, order_id from checkout_completion_log where payment_intent_id = ?",
          [`pi_${identity}`]
        )
        const cclId = cclBefore.rows[0].id as string
        expect(cclBefore.rows[0].order_id).toBe(orderX.id)

        const markerRow = await dbConnection.raw(
          `select metadata->>'order_birth_checkout_completion_log_id' as marker
           from "order" where id = ?`,
          [orderX.id]
        )
        expect(markerRow.rows[0].marker).toBe(cclId)

        // 2. Simulate R5-HR12 hide scenario:
        // CCL.created_at = now()+2h (application skew), execution_started_at = now() (DB-authoritative),
        // Order.created_at = now()+1m — legacy created_at-15m window excludes Order; execution_started_at-15m finds it.
        await dbConnection.raw(
          `update checkout_completion_log
           set status = 'reconciliation_required',
               reconciliation_reason_code = 'ORDER_BIRTH_EXECUTION_AMBIGUOUS',
               order_id = null,
               completed_at = null,
               created_at = now() + interval '2 hours',
               execution_started_at = now()
           where payment_intent_id = ?`,
          [`pi_${identity}`]
        )
        await dbConnection.raw(
          `update "order"
           set created_at = now() + interval '1 minute'
           where id = ?`,
          [orderX.id]
        )
        await dbConnection.raw(
          "update payment_attempt set order_id = null where id = ?",
          [prerequisites.paymentAttemptId]
        )

        const clockGeometry = await dbConnection.raw(
          `select
             ccl.created_at as ccl_created_at,
             ccl.execution_started_at as ccl_execution_started_at,
             o.created_at as order_created_at,
             extract(epoch from (ccl.created_at - ccl.execution_started_at)) as ccl_skew_seconds,
             extract(epoch from (o.created_at - ccl.execution_started_at)) as order_offset_seconds
           from checkout_completion_log ccl
           cross join "order" o
           where ccl.payment_intent_id = ?
             and o.id = ?`,
          [`pi_${identity}`, orderX.id]
        )
        const geometry = clockGeometry.rows[0]
        expect(Number(geometry.ccl_skew_seconds)).toBeGreaterThan(7000)
        expect(Number(geometry.ccl_skew_seconds)).toBeLessThan(7400)
        expect(Number(geometry.order_offset_seconds)).toBeGreaterThan(50)
        expect(Number(geometry.order_offset_seconds)).toBeLessThan(90)

        // 3. Production recovery entrypoint — scanner must find Order X without completeCart
        let completeCartCalled = 0
        const recoveryState = harness(identity, prerequisites, {
          runCompleteCart: async () => {
            completeCartCalled += 1
            throw new Error("SHOULD_NOT_BE_CALLED")
          },
        })

        const result = await recoveryState.directEntrypoint({
          payment_attempt_id: prerequisites.paymentAttemptId,
          payment_intent_id: `pi_${identity}`,
          stripe_event_id: "evt_skew_ccl_recovery",
          correlation_id: "corr_skew_ccl_recovery",
        })

        expect(result.order_id).toBe(orderX.id)
        expect(completeCartCalled).toBe(0)

        const cclRows = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = ?",
          [`pi_${identity}`]
        )
        expect(cclRows.rows).toEqual([
          {
            status: "completed",
            order_id: orderX.id,
          },
        ])

        const attempt = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(attempt.order_id).toBe(orderX.id)

        const finalOrders = await persistedOrders(prerequisites.email)
        expect(finalOrders).toHaveLength(1)
        expect(finalOrders[0].id).toBe(orderX.id)
      })

      it("O9A: failure BEFORE execution_started CAS — retry may execute once", async () => {
        const prerequisites = await seedPersistedPrerequisites("o9a_precas_01")
        let firstAttemptFailed = false

        // First attempt: cart mismatch before CAS
        const failState = harness("o9a_precas_01", prerequisites, {
          getCart: async () => {
            firstAttemptFailed = true
            return {
              ...(await loadCartObservedMoney(prerequisites.cartId)),
              total: 99999, // cart total mismatch before CAS
            } as any
          },
        })

        const failRes = await failState.post("evt_o9a_a")
        expect(failRes.statusCode).toBe(200)
        expect(firstAttemptFailed).toBe(true)

        // execution_started_at must be NULL because failure happened before CAS!
        const cclAfterFail = await dbConnection.raw(
          "select execution_started_at, order_id, status from checkout_completion_log where payment_intent_id = 'pi_o9a_precas_01'"
        )
        expect(cclAfterFail.rows[0].execution_started_at).toBeNull()
        expect(cclAfterFail.rows[0].order_id).toBeNull()
        expect(["failed", "reconciliation_required"]).toContain(
          cclAfterFail.rows[0].status
        )

        // Second attempt: normal execution succeeds and calls completeCart once
        const retryState = harness("o9a_precas_01", prerequisites)
        const retryRes = await retryState.post("evt_o9a_b")
        expect(retryRes.statusCode).toBe(200)

        // Exactly 1 physical order created
        const ordersAfterRetry = await persistedOrders(prerequisites.email)
        expect(ordersAfterRetry).toHaveLength(1)

        // CCL completed with order_id and execution_started_at set
        const cclFinal = await dbConnection.raw(
          "select status, order_id, execution_started_at is not null as has_started from checkout_completion_log where payment_intent_id = 'pi_o9a_precas_01'"
        )
        expect(cclFinal.rows).toEqual([
          {
            status: "completed",
            order_id: ordersAfterRetry[0].id,
            has_started: true,
          },
        ])
      })

      it("O9B: failure AFTER execution_started CAS — retry MUST NOT call completeCart again", async () => {
        const prerequisites = await seedPersistedPrerequisites("o9b_postcas_01")
        let firstRunCompleteCartCalls = 0

        // First attempt: runCompleteCart throws (after execution_started CAS)
        const failState = harness("o9b_postcas_01", prerequisites, {
          runCompleteCart: async () => {
            firstRunCompleteCartCalls += 1
            throw new Error("SIMULATED_FAILURE_AFTER_EXECUTION_STARTED_CAS")
          },
        })

        // Webhook returns 200 with error recorded or logs failure
        const failRes = await failState.post("evt_o9b_a")
        expect(failRes.statusCode).toBe(200)
        expect(firstRunCompleteCartCalls).toBe(1)

        // Verify: execution_started_at is NOT NULL!
        const cclAfterCrash = await dbConnection.raw(
          "select execution_started_at is not null as has_started, order_id, status from checkout_completion_log where payment_intent_id = 'pi_o9b_postcas_01'"
        )
        expect(cclAfterCrash.rows[0].has_started).toBe(true)
        expect(cclAfterCrash.rows[0].order_id).toBeNull()

        // 0 orders exist in DB
        const ordersAfterCrash = await persistedOrders(prerequisites.email)
        expect(ordersAfterCrash).toHaveLength(0)

        // Retry: MUST NOT call completeCart because execution_started_at != null and scan finds 0 orders!
        let secondRunCompleteCartCalls = 0
        const retryState = harness("o9b_postcas_01", prerequisites, {
          runCompleteCart: async () => {
            secondRunCompleteCartCalls += 1
            throw new Error("SHOULD_NEVER_BE_CALLED_ON_RETRY")
          },
        })

        const retryRes = await retryState.post("evt_o9b_b")
        expect(retryRes.statusCode).toBe(200)

        // CRITICAL INVARIANT: completeCart was NOT called again!
        expect(secondRunCompleteCartCalls).toBe(0)

        // Physical orders is still 0 (no ghost order created)
        const finalOrders = await persistedOrders(prerequisites.email)
        expect(finalOrders).toHaveLength(0)

        // CCL is in reconciliation_required
        const cclFinal = await dbConnection.raw(
          "select status, order_id from checkout_completion_log where payment_intent_id = 'pi_o9b_postcas_01'"
        )
        expect(cclFinal.rows[0].status).toBe("reconciliation_required")
        expect(cclFinal.rows[0].order_id).toBeNull()
      })

      it("O10: canonical money — brlMajorToMinor(order.total) === attempt.amount === stripe minor", async () => {
        const money: SeedMoney = {
          itemUnitPrice: 79,
          shippingAmount: 15,
          paymentSessionAmount: 94,
          paymentAttemptAmount: 9400,
          stripeMinorAmount: 9400,
        }
        const prerequisites = await seedPersistedPrerequisites("o10_money_01", money)

        // Verify canonical money chain before order
        const attemptBefore = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(Number(attemptBefore.amount)).toBe(9400)

        const cartBefore = await loadCartObservedMoney(prerequisites.cartId)
        expect(exactMajorLiteral(cartBefore.total)).toBe(94)

        // The FIN-02 canonical assertion: brlMajorToMinor(cart.total) === attempt.amount
        expect(brlMajorToMinor(exactMajorLiteral(cartBefore.total))).toBe(
          Number(attemptBefore.amount)
        )

        // Create order via webhook
        const state = harness("o10_money_01", prerequisites)
        const res = await state.post("evt_o10_money_01")
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual(expect.objectContaining({ ok: true, status: "processed" }))

        // Verify order total matches
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        const order = orders[0]
        const orderTotal = exactMajorLiteral(order.total)
        expect(orderTotal).toBe(94)

        // FIN-04 canonical money check: brlMajorToMinor(order.total) === attempt.amount
        expect(brlMajorToMinor(orderTotal)).toBe(9400)
        expect(brlMajorToMinor(orderTotal)).toBe(money.stripeMinorAmount)

        // PA.amount unchanged
        const attemptAfter = await persistedPaymentAttempt(prerequisites.paymentAttemptId)
        expect(Number(attemptAfter.amount)).toBe(9400)

        // The full canonical chain holds:
        // brlMajorToMinor(order.total) === brlMajorToMinor(cart.total) === PA.amount === stripe.amount
        expect(brlMajorToMinor(orderTotal)).toBe(brlMajorToMinor(exactMajorLiteral(cartBefore.total)))
        expect(brlMajorToMinor(orderTotal)).toBe(Number(attemptAfter.amount))
        expect(brlMajorToMinor(orderTotal)).toBe(money.stripeMinorAmount)
      })
    },
  })
}
