import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import { POST as addLineItem } from "../../src/api/store/carts/[id]/line-items/route"
import { DELETE as clearLineItems } from "../../src/api/store/carts/[id]/line-items/route"
import {
  DELETE as deleteLineItem,
  POST as updateLineItem,
} from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import { POST as completeCartOverride } from "../../src/api/store/carts/[id]/complete/route"
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
import { POST as attachCart } from "../../src/api/store/customers/me/cart/attach/route"
import { POST as acknowledgeCartReview } from "../../src/api/store/carts/[id]/review/acknowledge/route"
import { POST as startCardPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/card/route"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { createStoreSurfaceGuardMiddleware } from "../../src/api/store-surface/guard"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"
import { CHECKOUT_COMPLETION_MODULE } from "../../src/modules/checkout-completion"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import { CART_MERGE_MODULE } from "../../src/modules/cart-merge"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptResult,
} from "../../src/workflows/order/webhook-order-entrypoint"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  countPersistedOrders,
  createCartMergeRequest,
  createCartMergeResponse,
  createRealCartMergeFixture,
  createRealCustomerCartFixture,
  createRealPendingCartReviewFixture,
  readCartReviewRaceLedger,
  runCartReviewRace,
  type CartMergeFixture,
  type CartMergePostgresRawConnection,
} from "../helpers/cart-merge-postgres"
import {
  assertPublicIdentifiersDoNotEncodeSecrets,
  createGuestCartLeakageCollector,
  PHASE16_CUSTOMER_JWT_CANARY,
  PHASE16_GUEST_CAPABILITY_CANARY,
  PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
} from "../helpers/guest-cart-leakage"
import { hashGuestCartCapability } from "../../src/modules/guest-cart-capability/hash"

jest.mock("@medusajs/core-flows", () => {
  const actual = jest.requireActual("@medusajs/core-flows")
  return {
    ...actual,
    addToCartWorkflow: jest.fn(),
    createCartWorkflow: jest.fn(),
    deleteLineItemsWorkflow: jest.fn(),
    updateLineItemInCartWorkflow: jest.fn(),
  }
})

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

function response() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    json(body: unknown) {
      this.body = body
      this.headersSent = true
      return this
    },
    end() {
      this.headersSent = true
      return this
    },
  }
}

if (!requestedDatabaseName) {
  describe("Phase 15 guest cart Order invariants PostgreSQL", () => {
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

  type Cart = {
    id: string
    customer: { id: string } | null
    customer_id: string | null
    items: Array<Record<string, any>>
    currency_code: string
    region_id: string
    metadata: Record<string, unknown>
    completed_at: string | null
    created_at: string
    updated_at: string
  }

  type CartPrerequisites = {
    cartId: string
    paymentCollectionId: string
    email: string
  }

  function routeHarness() {
    const now = "2026-08-21T12:00:00.000Z"
    const cart: Cart = {
      id: "cart_pg_cart_m1_01",
      customer: null,
      customer_id: null,
      items: [],
      currency_code: "brl",
      region_id: "reg_br_pg",
      metadata: { active_for_checkout: true },
      completed_at: null,
      created_at: now,
      updated_at: now,
    }
    const carts = new Map([[cart.id, cart]])
    const versions = new Map([[cart.id, 1]])
    const records = new Map<string, any>()
    const attempts = [{ id: "pat_pg_cart_m1", cart_id: cart.id, status: "created" }]
    const token = "canary_guest_cart_token_p15w0_never_persist_plaintext_val"
    const capability = {
      id: "gccap_pg_cart_m1",
      cart_id: cart.id,
      token_hash: "sha256_pg_guest_capability_hash",
      status: "active",
      expires_at: new Date("2026-08-28T12:00:00.000Z"),
      consumed_at: null,
      revoked_at: null,
      last_used_at: null,
      created_at: new Date(now),
      updated_at: new Date(now),
      deleted_at: null,
    }
    let sequence = 1

    const remoteQuery = jest.fn(async (queryObject: any) => {
      const entry = queryObject?.__value ? Object.keys(queryObject.__value)[0] : undefined
      const filters =
        (entry && queryObject.__value[entry]?.__args?.filters) ??
        queryObject?.variables?.filters ??
        {}
      if (filters.id) return carts.has(filters.id) ? [carts.get(filters.id)] : []
      return []
    })
    const idempotency = {
      async claim(input: any) {
        const existing = records.get(input.rawIdempotencyKey)
        if (existing) {
          if (existing.state === "completed" || existing.state === "failed_terminal") {
            return { type: "replay", record: existing }
          }
          return { type: "in_progress", record: existing }
        }
        const record = {
          id: `idem_pg_${records.size + 1}`,
          state: "processing",
          state_version: 1,
          retry_attempt_count: 0,
          failure_code: null,
          result_id: null,
        }
        records.set(input.rawIdempotencyKey, record)
        return { type: "claimed", record }
      },
      async recordProcessingResult(input: any) {
        const record = [...records.values()].find((item) => item.id === input.id)
        record.state_version += 1
        record.result_id = input.result_id
        return { type: "claimed", record }
      },
      async markCompleted(input: any) {
        const record = [...records.values()].find((item) => item.id === input.id)
        record.state = "completed"
        record.state_version += 1
        record.result_id = input.result_id
        return { type: "claimed", record }
      },
      async markFailedTerminal(input: any) {
        const record = [...records.values()].find((item) => item.id === input.id)
        record.state = "failed_terminal"
        record.state_version += 1
        record.failure_code = input.failure_code
        return { type: "claimed", record }
      },
      async markFailedRetryable(input: any) {
        const record = [...records.values()].find((item) => item.id === input.id)
        record.state = "failed_retryable"
        record.state_version += 1
        record.failure_code = input.failure_code
        return { type: "claimed", record }
      },
      async markReconciliationRequired(input: any) {
        const record = [...records.values()].find((item) => item.id === input.id)
        record.state = "reconciliation_required"
        record.state_version += 1
        record.failure_code = input.failure_code
        return { type: "claimed", record }
      },
    }
    const resourceVersion = {
      async initialize(_type: string, id: string) {
        return { id: `strver_${id}`, resource_type: "cart", resource_id: id, version: versions.get(id) ?? 1 }
      },
      async compareAndSwapWithMutation(input: any) {
        const current = versions.get(input.resourceId) ?? 1
        if (current !== input.expectedVersion) {
          return { type: "stale", actualVersion: current, expectedVersion: input.expectedVersion }
        }
        const mutationResult = await input.mutate({})
        versions.set(input.resourceId, current + 1)
        return { type: "updated", version: current + 1, previousVersion: current, mutationResult }
      },
    }
    const paymentAttempt = {
      async listPaymentAttempts() {
        return attempts
      },
      async updatePaymentAttempts(input: any) {
        Object.assign(attempts[0], Array.isArray(input) ? input[0] : input)
        return attempts
      },
    }
    const scope: any = {
      createScope() {
        const overrides = new Map<unknown, unknown>()
        const childScope: any = {
          register(key: unknown, registration: unknown) {
            overrides.set(key, registration)
            return childScope
          },
          resolve(key: unknown) {
            if (overrides.has(key)) {
              const registration = overrides.get(key) as { resolve?: () => unknown }
              return typeof registration?.resolve === "function"
                ? registration.resolve()
                : registration
            }
            return scope.resolve(key)
          },
        }
        return childScope
      },
      resolve(key: unknown) {
        if (key === GUEST_CART_CAPABILITY_MODULE) {
          return {
            async lookupGuestCartCapabilityByPresentedToken(value: string) {
              if (value !== token) throw new Error("invalid capability")
              return capability
            },
            async mintGuestCartCapability() {
              return { record: capability, plaintext_token: token }
            },
            async authorizeGuestCartCapabilityForMutation(
              presentedToken: string,
              cartId: string
            ) {
              if (
                presentedToken !== token ||
                cartId !== capability.cart_id ||
                capability.status !== "active"
              ) {
                throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
              }
              return capability
            },
          }
        }
        if (key === STORE_IDEMPOTENCY_MODULE) return idempotency
        if (key === STORE_RESOURCE_VERSION_MODULE) return resourceVersion
        if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
        if (key === ContainerRegistrationKeys.REMOTE_QUERY) return remoteQuery
        if (key === ContainerRegistrationKeys.PG_CONNECTION) {
          return {
            async transaction(callback: (trx: unknown) => Promise<unknown>) {
              return callback({ raw: async () => ({ rows: [] }) })
            },
            async raw() {
              return { rows: [] }
            },
          }
        }
        if (key === Modules.CART) {
          const transaction = { raw: async () => ({ rows: [] }) }
          const cartModule = {
            baseRepository_: {
              async transaction(callback: (manager: unknown) => Promise<unknown>) {
                return callback({
                  getTransactionContext: () => transaction,
                })
              },
            },
            async retrieveCart(id: string) {
              return carts.get(id)
            },
          }
          ;(cartModule as any).MedusaContextIndex_ = { retrieveCart: 2 }
          return cartModule
        }
        if (key === ContainerRegistrationKeys.LINK) {
          return {
            async create(input: Record<string, unknown>) {
              expect(JSON.stringify(input)).not.toContain(token)
              return undefined
            },
            async dismiss() {
              return undefined
            },
          }
        }
        throw new Error(`unrecognized test scope key ${String(key)}`)
      },
    }

    ;(createCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
      run: async () => {
        const id = `cart_pg_created_${sequence++}`
        const created = { ...cart, id, items: [] }
        carts.set(id, created)
        versions.set(id, 1)
        return { result: { id } }
      },
    }))
    ;(addToCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
      run: async ({ input }: any) => {
        const target = carts.get(input.cart_id)!
        target.items.push({
          id: `li_pg_${sequence++}`,
          variant_id: input.items[0].variant_id,
          quantity: input.items[0].quantity,
        })
        return { result: { cart_id: target.id } }
      },
    }))
    ;(updateLineItemInCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
      run: async ({ input }: any) => {
        const target = carts.get(input.cart_id)!
        if (input.update.quantity === 0) {
          target.items = target.items.filter((item) => item.id !== input.item_id)
        } else {
          const item = target.items.find((candidate) => candidate.id === input.item_id)
          item.quantity = input.update.quantity
        }
        return { result: { cart_id: target.id } }
      },
    }))
    ;(deleteLineItemsWorkflow as unknown as jest.Mock).mockImplementation(() => ({
      run: async ({ input }: any) => {
        const target = carts.get(input.cart_id)!
        target.items = target.items.filter((item) => !input.ids.includes(item.id))
        return { result: { cart_id: target.id } }
      },
    }))

    const request = (method: string, body?: unknown, lineId?: string, ifMatch?: string) => {
      return {
        method,
        url: `/store/carts/${cart.id}/line-items`,
        originalUrl: `/store/carts/${cart.id}/line-items`,
        params: { id: cart.id, ...(lineId ? { line_id: lineId } : {}) },
        body,
        headers: {
          [GUEST_CART_CAPABILITY_HEADER]: token,
          "idempotency-key": `pg-cart-${sequence++}`,
          "if-match": ifMatch ?? `"${versions.get(cart.id) ?? 1}"`,
          "x-indicio-bff-auth": "bff_pg_cart",
        },
        scope,
      }
    }
    const activeRequest = (method: "GET" | "POST", key: string, withToken = false) => ({
      method,
      url: "/store/carts/active",
      originalUrl: "/store/carts/active",
      headers: {
        "idempotency-key": key,
        "x-indicio-bff-auth": "bff_pg_cart",
        ...(withToken ? { [GUEST_CART_CAPABILITY_HEADER]: token } : {}),
      },
      scope,
    })
    return { cart, attempts, versions, request, activeRequest, response, token }
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      jest.setTimeout(180_000)

      async function countOrders(): Promise<number> {
        const rows = await dbConnection.raw('select count(*)::int as count from "order"')
        return Number(rows.rows[0]?.count ?? 0)
      }

      async function persistedOrders(email: string) {
        const orderModule = getContainer().resolve(Modules.ORDER) as {
          listOrders(selector: Record<string, unknown>): Promise<Array<{ id: string }>>
        }
        return orderModule.listOrders({ email })
      }

      async function seedPrerequisites(identity: string): Promise<CartPrerequisites & { email: string }> {
        const realContainer = getContainer()
        const fulfillmentModule = realContainer.resolve(Modules.FULFILLMENT) as {
          createShippingProfiles(input: { name: string; type: string }): Promise<{ id: string }>
        }
        const cartModule = realContainer.resolve(Modules.CART) as any
        const paymentModule = realContainer.resolve(Modules.PAYMENT) as any
        const shippingProfile = await fulfillmentModule.createShippingProfiles({
          name: `No shipping ${identity}`,
          type: "default",
        })
        const { result: products } = await createProductsWorkflow(realContainer).run({
          input: {
            products: [{
              title: `Guest cart order invariant ${identity}`,
              handle: `guest-cart-order-invariant-${identity.replace(/_/g, "-")}`,
              shipping_profile_id: shippingProfile.id,
              options: [{ title: "Size", values: ["M"] }],
              variants: [{
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
              }],
            }],
          },
        })
        const email = `${identity}@guest-cart-order.test`
        const cart = await cartModule.createCarts({
          currency_code: "brl",
          email,
          items: [{
            title: `Guest cart item ${identity}`,
            quantity: 1,
            unit_price: 99,
            variant_id: products[0].variants[0].id,
            variant_sku: products[0].variants[0].sku,
            requires_shipping: false,
            is_custom_price: true,
          }],
        })
        const { result: paymentCollection } = await createPaymentCollectionForCartWorkflow(realContainer).run({
          input: { cart_id: cart.id },
        })
        const paymentSession = await paymentModule.createPaymentSession(paymentCollection.id, {
          provider_id: "pp_system_default",
          amount: 99,
          currency_code: "brl",
          data: {},
        })
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

        const paymentAttemptModule = realContainer.resolve(
          PAYMENT_ATTEMPT_MODULE
        ) as {
          createPaymentAttempts(input: Record<string, unknown>): Promise<unknown>
        }
        await paymentAttemptModule.createPaymentAttempts({
          id: `payatt_${identity}`,
          cart_id: cart.id,
          payment_collection_id: paymentCollection.id,
          payment_session_id: paymentSession.id,
          provider: "stripe",
          provider_payment_intent_id: `pi_${identity}`,
          provider_payment_session_id: `ps_${identity}`,
          payment_method_type: "card",
          status: "awaiting_webhook_confirmation",
          amount: 9900,
          currency_code: "brl",
          metadata: { cart_resource_version: cartResourceVersion.version },
          awaiting_webhook_since: new Date("2026-08-21T12:00:00.000Z"),
        })

        return { cartId: cart.id, paymentCollectionId: paymentCollection.id, email }
      }

      function canonicalHarness(identity: string, prerequisites: CartPrerequisites) {
        const realContainer = getContainer()
        const webhookRows: Array<Record<string, unknown>> = []
        const analyticsRows: Array<Record<string, unknown>> = []
        const webhooks = {
          listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) =>
            webhookRows.filter((row) => !filters?.deduplication_key || row.deduplication_key === filters.deduplication_key)
          ),
          createWebhookEventLogs: jest.fn(async (input: any) => {
            const row = Array.isArray(input) ? input[0] : input
            if (webhookRows.some((existing) => existing.deduplication_key === row.deduplication_key)) throw new Error("duplicate webhook")
            const created = { ...row, id: `whlog_${webhookRows.length + 1}` }
            webhookRows.push(created)
            return [created]
          }),
          updateWebhookEventLogs: jest.fn(async (input: any) => {
            const update = Array.isArray(input) ? input[0] : input
            const index = webhookRows.findIndex((row) => row.id === update.id)
            webhookRows[index] = { ...webhookRows[index], ...update }
            return [webhookRows[index]]
          }),
        }
        const analytics = {
          listAnalyticsEventLogs: jest.fn(async () => analyticsRows),
          createAnalyticsEventLogs: jest.fn(async (input: any) => {
            const row = Array.isArray(input) ? input[0] : input
            analyticsRows.push(row)
            return [{ ...row, id: `anlevt_${identity}_${analyticsRows.length}` }]
          }),
        }
        const realCheckout = realContainer.resolve(CHECKOUT_COMPLETION_MODULE)
        const container = {
          resolve(key: string) {
            if (key === WEBHOOKS_MODULE) return webhooks
            if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") return analytics
            if (key === CHECKOUT_COMPLETION_MODULE) return realCheckout
            return realContainer.resolve(key)
          },
        } as unknown as MedusaContainer
        const runOrderEntrypoint = async (
          _scope: MedusaContainer,
          input: Parameters<typeof runCreateOrderFromConfirmedPaymentAttemptEntrypoint>[1]
        ): Promise<CreateOrderFromConfirmedPaymentAttemptResult> =>
          runCreateOrderFromConfirmedPaymentAttemptEntrypoint(container, input, {
            now: () => new Date("2026-08-21T12:00:00.000Z"),
            runCompleteCart: async (_scope, cartId) => {
              const { result } = await completeCartWorkflow(realContainer).run({ input: { id: cartId } })
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
              STRIPE_WEBHOOK_SECRET: "whsec_synthetic_guest_cart",
            } as never,
            stripe: { webhooks: { constructEvent: () => event(eventId) } },
            now: () => new Date("2026-08-21T12:00:00.000Z"),
            runOrderEntrypoint,
          })
          const res = response()
          await handler({
            headers: { "stripe-signature": "t=1,v1=synthetic" },
            rawBody: Buffer.from(JSON.stringify(event(eventId))),
            correlationId: `corr_${identity}`,
            scope: container,
          } as unknown as MedusaRequest, res as unknown as MedusaResponse)
          return res
        }
        return { post }
      }

      it("keeps every Store/BFF Cart M1 operation at zero persisted Orders", async () => {
        const harness = routeHarness()
        expect(await countOrders()).toBe(0)

        const active = response()
        await postActiveCart(harness.activeRequest("POST", "pg-active-create") as never, active as never)
        expect(active.statusCode).toBe(201)
        expect(await countOrders()).toBe(0)

        const activeGet = response()
        await getActiveCart(harness.activeRequest("GET", "pg-active-get", true) as never, activeGet as never)
        expect(activeGet.statusCode).toBe(200)
        expect(await countOrders()).toBe(0)

        const addResponse = response()
        await addLineItem(harness.request("POST", { variant_id: "variant_pg_01", quantity: 1 }) as never, addResponse as never)
        expect(addResponse.statusCode).toBe(200)
        expect(await countOrders()).toBe(0)
        const lineId = harness.cart.items[0].id as string

        const updateResponse = response()
        await updateLineItem(harness.request("POST", { quantity: 0 }, lineId) as never, updateResponse as never)
        expect(updateResponse.statusCode).toBe(200)
        expect(await countOrders()).toBe(0)

        const secondAdd = response()
        await addLineItem(harness.request("POST", { variant_id: "variant_pg_02", quantity: 1 }) as never, secondAdd as never)
        const secondLine = harness.cart.items[0].id as string
        const deleteResponse = response()
        await deleteLineItem(harness.request("DELETE", undefined, secondLine) as never, deleteResponse as never)
        expect(deleteResponse.statusCode).toBe(200)
        expect(await countOrders()).toBe(0)

        const finalAdd = response()
        await addLineItem(harness.request("POST", { variant_id: "variant_pg_03", quantity: 1 }) as never, finalAdd as never)
        const clearResponse = response()
        await clearLineItems(harness.request("DELETE") as never, clearResponse as never)
        expect(clearResponse.statusCode).toBe(200)
        expect(await countOrders()).toBe(0)

        const guard = createStoreSurfaceGuardMiddleware()
        for (const originalUrl of [
          "/store/carts/cart_pg_cart_m1_01/complete",
          "/store/customers/me/cart/attach",
          "/store/carts/cart_pg_cart_m1_01/shipping-methods",
        ]) {
          const next = jest.fn()
          guard({ method: "POST", originalUrl, url: originalUrl, headers: {}, scope: { resolve: jest.fn() } } as never, response() as never, next)
          expect(next).not.toHaveBeenCalled()
        }
        const denied = response()
        await completeCartOverride({ params: { id: harness.cart.id }, scope: { resolve: jest.fn() } } as never, denied as never)
        expect(denied.statusCode).toBe(404)
        expect(await countOrders()).toBe(0)
      })

      it("mantém zero Orders no deny fail-closed do endpoint de merge", async () => {
        const before = await countOrders()
        const mergeService = getContainer().resolve(CART_MERGE_MODULE) as {
          executeCartMerge: (...args: unknown[]) => Promise<unknown>
        }
        expect(mergeService.executeCartMerge).toEqual(expect.any(Function))

        await expect(
          mergeCart(
            {
              method: "POST",
              url: "/store/customers/me/cart/merge",
              originalUrl: "/store/customers/me/cart/merge",
              body: { guestCartId: "cart_denied_before_authority" },
              headers: {},
              scope: getContainer(),
            } as never,
            response() as never
          )
        ).rejects.toMatchObject({ message: "Not Found" })

        expect(await countOrders()).toBe(before)
      })

      it("uses only payment_intent.succeeded for one real Order and keeps webhook replay at one", async () => {
        const prerequisites = await seedPrerequisites("cart_order_positive_1508")
        expect(await countOrders()).toBe(0)
        const state = canonicalHarness("cart_order_positive_1508", prerequisites)
        const first = await state.post("evt_cart_order_positive_1508")
        expect(first.statusCode).toBe(200)
        expect(first.body).toEqual(expect.objectContaining({ ok: true, status: "processed" }))
        const orders = await persistedOrders(prerequisites.email)
        expect(orders).toHaveLength(1)
        expect(await countOrders()).toBe(1)

        const replay = await state.post("evt_cart_order_positive_1508")
        expect(replay.statusCode).toBe(200)
        expect(replay.body).toEqual(expect.objectContaining({ ok: true, duplicate: true }))
        const replayOrders = await persistedOrders(prerequisites.email)
        expect(replayOrders).toHaveLength(1)
        expect(replayOrders[0].id).toBe(orders[0].id)
        expect(await countOrders()).toBe(1)
      })

      describe("B16-09-HR-06 zero Order after review ACK and races", () => {
        const connection =
          dbConnection as unknown as CartMergePostgresRawConnection

        const restoreRealCartWorkflows = () => {
          const actual = jest.requireActual(
            "@medusajs/core-flows"
          ) as typeof import("@medusajs/core-flows")
          ;(addToCartWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) => (actual.addToCartWorkflow as Function)(...args)
          )
          ;(updateLineItemInCartWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) =>
              (actual.updateLineItemInCartWorkflow as Function)(...args)
          )
          ;(deleteLineItemsWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) =>
              (actual.deleteLineItemsWorkflow as Function)(...args)
          )
        }

        const ensureBrazilRegion = async (): Promise<string> => {
          const existing = await connection.raw(
            "select id from region where currency_code = ? and deleted_at is null limit 1",
            ["brl"]
          )
          const existingId = existing.rows?.[0]?.id
          if (existingId) return String(existingId)
          await createRegionsWorkflow(getContainer()).run({
            input: {
              regions: [
                {
                  name: "P16 HR-06 Brazil",
                  currency_code: "brl",
                  countries: ["br"],
                  payment_providers: ["pp_system_default"],
                },
              ],
            },
          })
          const created = await connection.raw(
            "select id from region where currency_code = ? and deleted_at is null limit 1",
            ["brl"]
          )
          const createdId = created.rows?.[0]?.id
          if (!createdId) {
            throw new Error("P16_REAL_PENDING_REVIEW_REGION_MISSING")
          }
          return String(createdId)
        }

        const createPendingReviewFixture = async (identity: string) =>
          createRealPendingCartReviewFixture(getContainer(), identity, {
            regionId: await ensureBrazilRegion(),
          })

        const customerAuthFields = (customerId: string) => ({
          auth_context: {
            actor_type: "customer" as const,
            actor_id: customerId,
          },
          customerAuth: { authorized: true, customerId },
          customerAuthBff: { authorized: true },
        })

        const createAcknowledgeRequest = (
          fixture: {
            customerId: string
            reviewCartId?: string
            guestCartId: string
            reviewRef?: string
            reviewVersion?: number
          },
          overrides: {
            reviewRef?: string | null
            version?: number
            cartId?: string
          } = {}
        ) => {
          const cartId =
            overrides.cartId ?? fixture.reviewCartId ?? fixture.guestCartId
          const reviewRef =
            "reviewRef" in overrides ? overrides.reviewRef : fixture.reviewRef
          const version = overrides.version ?? fixture.reviewVersion ?? 1
          return {
            method: "POST",
            url: `/store/carts/${cartId}/review/acknowledge`,
            originalUrl: `/store/carts/${cartId}/review/acknowledge`,
            params: { id: cartId },
            body: { reviewRef },
            headers: {
              authorization: "Bearer test-customer-jwt",
              "x-indicio-bff-auth": "test-bff-authority",
              "if-match": `"${version}"`,
            },
            ...customerAuthFields(fixture.customerId),
            scope: getContainer(),
          }
        }

        const publicErrorFields = (error: unknown) => {
          const record = (error ?? {}) as {
            statusCode?: unknown
            status?: unknown
            code?: unknown
            message?: unknown
          }
          return {
            statusCode: record.statusCode ?? record.status,
            code: record.code,
            message: record.message,
          }
        }

        beforeEach(() => {
          restoreRealCartWorkflows()
        })

        it("B16-09-HR-06 MERGED_PARTIAL keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_hr06_merged_partial",
            { guestItemQuantity: 30 }
          )
          const customerCart = await createRealCustomerCartFixture(
            container,
            fixture,
            "p16_hr06_merged_partial",
            { itemQuantity: 80 }
          )
          const beforeOrders = await countPersistedOrders(connection)

          const response = createCartMergeResponse()
          await mergeCart(
            createCartMergeRequest(fixture, container) as never,
            response as never
          )
          const body = response.body as {
            outcome?: unknown
            review?: { requiresReview?: unknown }
          }
          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            customerCart.cartId
          )
          const afterOrders = await countPersistedOrders(connection)

          expect(response.statusCode).toBe(200)
          expect(body.outcome).toBe("MERGED_PARTIAL")
          expect(body.review?.requiresReview).toBe(true)
          expect(after.review_status).toBe("pending")
          expect(after.review_count).toBe(1)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 REVIEW_REQUIRED line-item mutation keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_review_line")
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          const error = await addLineItem(
            {
              method: "POST",
              url: `/store/carts/${fixture.reviewCartId}/line-items`,
              originalUrl: `/store/carts/${fixture.reviewCartId}/line-items`,
              params: { id: fixture.reviewCartId },
              body: {
                variant_id: fixture.mutationVariantId,
                quantity: 1,
              },
              headers: {
                authorization: "Bearer test-customer-jwt",
                "x-indicio-bff-auth": "test-bff-authority",
                "idempotency-key": "p16-hr06-review-line",
                "if-match": `"${fixture.reviewVersion}"`,
              },
              ...customerAuthFields(fixture.customerId),
              scope: getContainer(),
            } as never,
            response as never
          ).catch((caught: unknown) => caught)

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)

          expect(error).toMatchObject({
            code: "REVIEW_REQUIRED",
            statusCode: 409,
          })
          expect(after.review_status).toBe("pending")
          expect(after.line_items).toEqual(before.line_items)
          expect(after.version).toBe(before.version)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 REVIEW_REQUIRED merge keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createPendingReviewFixture("p16_hr06_review_merge")
          const competitor = await createRealCartMergeFixture(
            container,
            "p16_hr06_review_merge_g",
            { customerId: fixture.customerId }
          )
          const beforeTarget = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeGuest = await readCartReviewRaceLedger(
            connection,
            competitor,
            competitor.guestCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          const error = await mergeCart(
            createCartMergeRequest(competitor, container) as never,
            response as never
          ).catch((caught: unknown) => caught)

          const afterTarget = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterGuest = await readCartReviewRaceLedger(
            connection,
            competitor,
            competitor.guestCartId
          )
          const afterOrders = await countPersistedOrders(connection)

          expect(error).toMatchObject({
            code: "REVIEW_REQUIRED",
            statusCode: 409,
          })
          expect(afterTarget.review_status).toBe("pending")
          expect(afterTarget.version).toBe(beforeTarget.version)
          expect(afterGuest.capability_status).toBe(beforeGuest.capability_status)
          expect(afterGuest.merge_result_count).toBe(0)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 REVIEW_REQUIRED payment initiation keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_review_pay")
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          const error = await startCardPaymentAttemptRoute(
            {
              method: "POST",
              url: `/store/carts/${fixture.reviewCartId}/payment-attempts/card`,
              originalUrl: `/store/carts/${fixture.reviewCartId}/payment-attempts/card`,
              params: { id: fixture.reviewCartId },
              body: {},
              headers: {
                authorization: "Bearer test-customer-jwt",
                "x-indicio-bff-auth": "test-bff-authority",
              },
              ...customerAuthFields(fixture.customerId),
              scope: getContainer(),
            } as never,
            response as never
          ).catch((caught: unknown) => caught)

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)

          expect(error).toMatchObject({
            code: "REVIEW_REQUIRED",
            statusCode: 409,
          })
          expect(after.review_status).toBe("pending")
          expect(after.payment_attempt_count).toBe(0)
          expect(after.payment_collection_count).toBe(before.payment_collection_count)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 valid ACK does not create Order", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_ack_valid")
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          await acknowledgeCartReview(
            createAcknowledgeRequest(fixture) as never,
            response as never
          )

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)
          const body = response.body as {
            review?: { requiresReview?: unknown; reviewRef?: unknown }
          }

          expect(response.statusCode).toBe(200)
          expect(body.review).toEqual(
            expect.objectContaining({
              requiresReview: false,
              reviewRef: null,
            })
          )
          expect(after.review_status).toBe("acknowledged")
          expect(after.review_ref).toBe(fixture.reviewRef)
          expect(after.acknowledged_at).toEqual(expect.any(String))
          expect(after.version).toBe(before.version)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK no-op with reviewRef null keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_hr06_ack_noop"
          )
          const mergeResponse = createCartMergeResponse()
          await mergeCart(
            createCartMergeRequest(fixture, container) as never,
            mergeResponse as never
          )
          expect(mergeResponse.statusCode).toBe(200)
          expect((mergeResponse.body as { outcome?: unknown }).outcome).toBe(
            "GUEST_CART_ATTACHED"
          )

          const attachedVersion = fixture.guestVersion + 1
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.guestCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          await acknowledgeCartReview(
            createAcknowledgeRequest(fixture, {
              cartId: fixture.guestCartId,
              reviewRef: null,
              version: attachedVersion,
            }) as never,
            response as never
          )

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.guestCartId
          )
          const afterOrders = await countPersistedOrders(connection)
          const body = response.body as {
            review?: { requiresReview?: unknown; reviewRef?: unknown }
          }

          expect(response.statusCode).toBe(200)
          expect(body.review).toEqual(
            expect.objectContaining({
              requiresReview: false,
              reviewRef: null,
            })
          )
          expect(after.review_count).toBe(0)
          expect(after.review_status).toBeNull()
          expect(after.version).toBe(before.version)
          expect(after.version).toBe(attachedVersion)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK replay is idempotent and keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_ack_replay")
          const first = createCartMergeResponse()
          await acknowledgeCartReview(
            createAcknowledgeRequest(fixture) as never,
            first as never
          )
          expect(first.statusCode).toBe(200)

          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const replay = createCartMergeResponse()

          await acknowledgeCartReview(
            createAcknowledgeRequest(fixture) as never,
            replay as never
          )

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)
          const body = replay.body as {
            cart?: { id?: unknown }
            review?: { requiresReview?: unknown; reviewRef?: unknown }
          }

          expect(replay.statusCode).toBe(200)
          expect(body.cart?.id).toBe(fixture.reviewCartId)
          expect(body.review).toEqual(
            expect.objectContaining({
              requiresReview: false,
              reviewRef: null,
            })
          )
          expect(after.review_status).toBe("acknowledged")
          expect(after.review_ref).toBe(fixture.reviewRef)
          expect(after.version).toBe(before.version)
          expect(after.line_items).toEqual(before.line_items)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 stale ACK fails closed and keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_ack_stale")
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const staleVersion = Math.max(1, fixture.reviewVersion - 1)
          const response = createCartMergeResponse()

          const error = await acknowledgeCartReview(
            createAcknowledgeRequest(fixture, { version: staleVersion }) as never,
            response as never
          ).catch((caught: unknown) => caught)

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)

          expect(error).toMatchObject({ statusCode: 412 })
          expect(after.review_status).toBe("pending")
          expect(after.review_ref).toBe(fixture.reviewRef)
          expect(after.version).toBe(before.version)
          expect(after.acknowledged_at).toBeNull()
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 divergent reviewRef fails closed and keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture("p16_hr06_ack_ref")
          const unknownRef = "review_divergent_hr06_01"
          const before = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const beforeOrders = await countPersistedOrders(connection)
          const response = createCartMergeResponse()

          const error = await acknowledgeCartReview(
            createAcknowledgeRequest(fixture, { reviewRef: unknownRef }) as never,
            response as never
          ).catch((caught: unknown) => caught)

          const after = await readCartReviewRaceLedger(
            connection,
            fixture,
            fixture.reviewCartId
          )
          const afterOrders = await countPersistedOrders(connection)
          const serialized = JSON.stringify(publicErrorFields(error))

          expect(error).toMatchObject({
            code: "CART_REVIEW_CONFLICT",
            statusCode: 409,
          })
          expect(serialized).not.toContain(fixture.reviewRef)
          expect(serialized).not.toContain(unknownRef)
          expect(after.review_status).toBe("pending")
          expect(after.review_ref).toBe(fixture.reviewRef)
          expect(after.version).toBe(before.version)
          expect(after.acknowledged_at).toBeNull()
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-line-item pending-first keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_line_pend"
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "customer-mutation",
            fixture,
            fixture,
            "competitor-first",
            "p16-hr06-line-item-pending-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(409)
          expect(competitor.code).toBe("REVIEW_REQUIRED")
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-line-item ACK-first keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_line_ack"
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "customer-mutation",
            fixture,
            fixture,
            "ack-first",
            "p16-hr06-line-item-ack-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(200)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-merge pending-first keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_merge_pend"
          )
          const competitorFixture = await createRealCartMergeFixture(
            container,
            "p16_hr06_race_merge_pend_g",
            { customerId: fixture.customerId }
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "merge",
            fixture,
            competitorFixture,
            "competitor-first",
            "p16-hr06-merge-pending-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(409)
          expect(competitor.code).toBe("REVIEW_REQUIRED")
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-merge ACK-first keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_merge_ack"
          )
          const competitorFixture = await createRealCartMergeFixture(
            container,
            "p16_hr06_race_merge_ack_g",
            { customerId: fixture.customerId }
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "merge",
            fixture,
            competitorFixture,
            "ack-first",
            "p16-hr06-merge-ack-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(200)
          expect(competitor.outcome).toBe("MERGED")
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-payment pending-first keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_pay_pend"
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "payment",
            fixture,
            fixture,
            "competitor-first",
            "p16-hr06-payment-pending-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(409)
          expect(competitor.code).toBe("REVIEW_REQUIRED")
          expect(competitor.providerCalls).toBe(0)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("B16-09-HR-06 ACK-vs-payment ACK-first keeps Order delta at zero", async () => {
          const fixture = await createPendingReviewFixture(
            "p16_hr06_race_pay_ack"
          )
          const beforeOrders = await countPersistedOrders(connection)
          const race = await runCartReviewRace(
            process.env.DATABASE_URL!,
            "payment",
            fixture,
            fixture,
            "ack-first",
            "p16-hr06-payment-ack-first"
          )
          const afterOrders = await countPersistedOrders(connection)
          const ack = race.workers.find((worker) => worker.role === "A")!
          const competitor = race.workers.find((worker) => worker.role === "B")!

          expect(ack.statusCode).toBe(200)
          expect(competitor.statusCode).toBe(201)
          expect(competitor.providerCalls).toBe(1)
          expect(afterOrders).toBe(beforeOrders)
          expect(afterOrders - beforeOrders).toBe(0)
        })
      })

      describe("Phase 16 C1–C8 Order delta and leakage", () => {
        const connection =
          dbConnection as unknown as CartMergePostgresRawConnection

        const restoreRealCartWorkflows = () => {
          const actual = jest.requireActual(
            "@medusajs/core-flows"
          ) as typeof import("@medusajs/core-flows")
          ;(addToCartWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) => (actual.addToCartWorkflow as Function)(...args)
          )
          ;(updateLineItemInCartWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) =>
              (actual.updateLineItemInCartWorkflow as Function)(...args)
          )
          ;(deleteLineItemsWorkflow as unknown as jest.Mock).mockImplementation(
            (...args: unknown[]) =>
              (actual.deleteLineItemsWorkflow as Function)(...args)
          )
        }

        const customerAuthFields = (customerId: string) => ({
          auth_context: {
            actor_type: "customer" as const,
            actor_id: customerId,
          },
          customerAuth: { authorized: true, customerId },
          customerAuthBff: { authorized: true },
        })

        function phase16CanaryHeaders(fixture: CartMergeFixture) {
          return {
            authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
            "x-indicio-bff-auth": "test-bff-authority",
            [GUEST_CART_CAPABILITY_HEADER]: PHASE16_GUEST_CAPABILITY_CANARY,
            "idempotency-key": PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
            "if-match": `"${fixture.guestVersion}"`,
          }
        }

        async function applyPhase16CanaryCapability(fixture: CartMergeFixture) {
          await connection.raw(
            "update guest_cart_capability set token_hash = ? where id = ?",
            [
              hashGuestCartCapability(PHASE16_GUEST_CAPABILITY_CANARY),
              fixture.capabilityId,
            ]
          )
        }

        function createAttachRequest(
          fixture: CartMergeFixture,
          overrides: Record<string, unknown> = {}
        ) {
          return {
            method: "POST",
            url: "/store/customers/me/cart/attach",
            originalUrl: "/store/customers/me/cart/attach",
            body: { guestCartId: fixture.guestCartId },
            headers: phase16CanaryHeaders(fixture),
            ...customerAuthFields(fixture.customerId),
            scope: getContainer(),
            ...overrides,
          }
        }

        async function scanPostgresLeakageTables(fixture?: CartMergeFixture) {
          const capability = fixture
            ? await connection.raw(
                "select * from guest_cart_capability where cart_id = ? and deleted_at is null",
                [fixture.guestCartId]
              )
            : await connection.raw(
                "select * from guest_cart_capability where deleted_at is null limit 20"
              )
          const mergeResult = fixture
            ? await connection.raw(
                "select * from cart_merge_result where guest_cart_id = ? and deleted_at is null",
                [fixture.guestCartId]
              )
            : await connection.raw(
                "select * from cart_merge_result where deleted_at is null order by created_at desc limit 20"
              )
          const review = fixture
            ? await connection.raw(
                `
                  select review.*
                  from cart_review review
                  join cart_merge_result result
                    on result.id = review.merge_result_id
                 where result.guest_cart_id = ?
                   and review.deleted_at is null
                `,
                [fixture.guestCartId]
              )
            : { rows: [] as Array<Record<string, unknown>> }
          const idempotency = await connection.raw(
            "select * from store_idempotency_record where deleted_at is null order by created_at desc limit 20"
          )
          return {
            guest_cart_capability: capability.rows ?? [],
            cart_merge_result: mergeResult.rows ?? [],
            cart_review: review.rows ?? [],
            store_idempotency_record: idempotency.rows ?? [],
          }
        }

        function assertPostgresLeakageScan(
          fixture: CartMergeFixture | undefined,
          response?: ReturnType<typeof createCartMergeResponse>
        ) {
          return async () => {
            const tables = await scanPostgresLeakageTables(fixture)
            const collector = createGuestCartLeakageCollector()
            collector.record("db_plaintext", tables)
            if (response) {
              collector.record("fixtures_snapshots", {
                body: response.body,
                headers: response.headers,
                reviewRef: (response.body as { review?: { reviewRef?: unknown } })
                  ?.review?.reviewRef,
              })
              const receipt = tables.cart_merge_result[0] as
                | { request_fingerprint?: string }
                | undefined
              assertPublicIdentifiersDoNotEncodeSecrets(
                (response.body as { review?: { reviewRef?: string | null } })
                  ?.review?.reviewRef ?? null,
                response.headers.etag ?? null,
                receipt?.request_fingerprint ?? null
              )
            }
            collector.assertNoCanaries()
          }
        }

        beforeEach(() => {
          restoreRealCartWorkflows()
        })

        it("C1 merge success keeps Order delta at zero and scans persisted sinks", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c1_merge"
          )
          await applyPhase16CanaryCapability(fixture)
          const beforeOrders = await countOrders()
          const response = createCartMergeResponse()

          await mergeCart(
            createCartMergeRequest(fixture, container, {
              headers: phase16CanaryHeaders(fixture),
            }) as never,
            response as never
          )

          const afterOrders = await countOrders()
          expect(response.statusCode).toBe(200)
          expect(afterOrders - beforeOrders).toBe(0)
          await assertPostgresLeakageScan(fixture, response)()
        })

        it("C2 attach success keeps Order delta at zero and scans persisted sinks", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c2_attach"
          )
          await applyPhase16CanaryCapability(fixture)
          const beforeOrders = await countOrders()
          const response = createCartMergeResponse()

          await attachCart(createAttachRequest(fixture) as never, response as never)

          const afterOrders = await countOrders()
          expect(response.statusCode).toBe(200)
          expect(afterOrders - beforeOrders).toBe(0)
          await assertPostgresLeakageScan(fixture, response)()
        })

        it("C3 committed replay keeps Order delta at zero and scans persisted sinks", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c3_replay"
          )
          await createRealCustomerCartFixture(
            container,
            fixture,
            "p16_leak_c3_replay"
          )
          await applyPhase16CanaryCapability(fixture)
          const headers = phase16CanaryHeaders(fixture)
          const beforeOrders = await countOrders()
          const first = createCartMergeResponse()
          await mergeCart(
            createCartMergeRequest(fixture, container, { headers }) as never,
            first as never
          )
          const replayHeaders = {
            ...headers,
            "if-match": `"${fixture.guestVersion}"`,
          }
          const replay = createCartMergeResponse()
          await attachCart(
            createAttachRequest(fixture, { headers: replayHeaders }) as never,
            replay as never
          )

          const afterOrders = await countOrders()
          expect(replay.statusCode).toBe(200)
          expect(afterOrders - beforeOrders).toBe(0)
          await assertPostgresLeakageScan(fixture, replay)()
        })

        it("C4 idempotency conflict keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c4_conflict"
          )
          await applyPhase16CanaryCapability(fixture)
          const headers = phase16CanaryHeaders(fixture)
          const beforeOrders = await countOrders()
          await mergeCart(
            createCartMergeRequest(fixture, container, { headers }) as never,
            createCartMergeResponse() as never
          )

          const error = await attachCart(
            createAttachRequest(fixture, {
              headers: { ...headers, "if-match": '"999"' },
            }) as never,
            createCartMergeResponse() as never
          ).catch((caught: unknown) => caught)

          const afterOrders = await countOrders()
          expect(error).toMatchObject({ statusCode: 409 })
          expect(afterOrders - beforeOrders).toBe(0)
          await assertPostgresLeakageScan(fixture)()
        })

        it("C5 session-only attach denial keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c5_session"
          )
          const beforeOrders = await countOrders()

          const error = await attachCart(
            {
              method: "POST",
              url: "/store/customers/me/cart/attach",
              originalUrl: "/store/customers/me/cart/attach",
              session: {
                id: "sess_phase16_leak_c5",
                active_cart_id: fixture.guestCartId,
              },
              body: { cart_id: fixture.guestCartId },
              headers: {
                authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
                "x-indicio-bff-auth": "test-bff-authority",
              },
              ...customerAuthFields(fixture.customerId),
              scope: container,
            } as never,
            createCartMergeResponse() as never
          ).catch((caught: unknown) => caught)

          const afterOrders = await countOrders()
          expect(error).toMatchObject({ type: "not_found" })
          expect(afterOrders - beforeOrders).toBe(0)
          const collector = createGuestCartLeakageCollector()
          collector.record("db_plaintext", await scanPostgresLeakageTables(fixture))
          collector.assertNoCanaries()
        })

        it("C6 missing capability denial keeps Order delta at zero", async () => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            "p16_leak_c6_missing_cap"
          )
          const beforeOrders = await countOrders()
          const {
            [GUEST_CART_CAPABILITY_HEADER]: _capability,
            ...headersWithoutCapability
          } = phase16CanaryHeaders(fixture)

          const error = await mergeCart(
            createCartMergeRequest(fixture, container, {
              headers: headersWithoutCapability,
            }) as never,
            createCartMergeResponse() as never
          ).catch((caught: unknown) => caught)

          const afterOrders = await countOrders()
          expect(error).toMatchObject({ type: "not_found" })
          expect(afterOrders - beforeOrders).toBe(0)
          const collector = createGuestCartLeakageCollector()
          collector.record("db_plaintext", await scanPostgresLeakageTables(fixture))
          collector.assertNoCanaries()
        })

        it("C7 native customer attach denial keeps Order delta at zero", async () => {
          const beforeOrders = await countOrders()
          const guard = createStoreSurfaceGuardMiddleware()
          const next = jest.fn()
          const res = response()
          guard(
            {
              method: "POST",
              originalUrl: "/store/carts/cart_native_deny_pg/customer",
              url: "/store/carts/cart_native_deny_pg/customer",
              headers: {
                authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
                [GUEST_CART_CAPABILITY_HEADER]: PHASE16_GUEST_CAPABILITY_CANARY,
                "idempotency-key": PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
              },
              scope: { resolve: jest.fn() },
            } as never,
            res as never,
            next
          )

          const afterOrders = await countOrders()
          expect(next).not.toHaveBeenCalled()
          expect(res.statusCode).toBe(404)
          expect(afterOrders - beforeOrders).toBe(0)
        })

        it("C8 prefix/unknown native denial keeps Order delta at zero", async () => {
          const guard = createStoreSurfaceGuardMiddleware()
          const paths = [
            "/store/cart/link",
            "/store/carts/cart_native_deny_pg/merge",
            "/store/carts/cart_native_deny_pg/attach",
          ] as const

          for (const path of paths) {
            const beforeOrders = await countOrders()
            const next = jest.fn()
            const res = response()
            guard(
              {
                method: "POST",
                originalUrl: path,
                url: path,
                headers: {
                  authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
                  [GUEST_CART_CAPABILITY_HEADER]: PHASE16_GUEST_CAPABILITY_CANARY,
                  "idempotency-key": PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
                },
                scope: { resolve: jest.fn() },
              } as never,
              res as never,
              next
            )
            const afterOrders = await countOrders()
            expect(next).not.toHaveBeenCalled()
            expect(res.statusCode).toBe(404)
            expect(afterOrders - beforeOrders).toBe(0)
          }
        })
      })
    },
  })
}
