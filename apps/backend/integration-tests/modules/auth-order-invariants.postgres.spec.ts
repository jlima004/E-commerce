import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createProductsWorkflow,
} from "@medusajs/core-flows"
import { Pool } from "pg"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import { AUTH_HTTP_CONTRACT } from "../../src/api/auth-surface/contracts"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import { handleCustomerAuthSignup } from "../../src/api/auth/customer/emailpass/register/route"
import { handleRevokeCurrentLineage } from "../../src/api/auth/customer/emailpass/revoke-current-lineage/route"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { decideStoreSurfaceAccess } from "../../src/api/store-surface/guard"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"
import { CHECKOUT_COMPLETION_MODULE } from "../../src/modules/checkout-completion"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptResult,
} from "../../src/workflows/order/webhook-order-entrypoint"
import {
  createPostgresAuthSessionDatabase,
  issueInitialAuthSession,
  revokeAuthSessionLineage,
  type AuthSessionEnvelope,
} from "../../src/modules/customer-auth/session"
import { InMemoryAtomicRateLimitStore } from "../../src/modules/customer-auth/security/rate-limit"
import type { CustomerRegistrationResult } from "../../src/modules/customer-auth/registration"

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
  describe("Phase 14 auth Order invariants PostgreSQL", () => {
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

  const BASE = new Date("2026-08-18T15:00:00.000Z")
  const JWT_SECRET = "a".repeat(64)
  const KEYRING = {
    active: { version: 1, secret: "k".repeat(64) },
    previous: [],
  }

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
      awaiting_webhook_since: "2026-08-18T15:00:00.000Z",
      superseded_at: null,
      invalidated_at: null,
      canceled_at: null,
      failed_at: null,
      expired_at: null,
      created_at: "2026-08-18T15:00:00.000Z",
      updated_at: "2026-08-18T15:00:00.000Z",
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
      end() {
        this.headersSent = true
        return this
      },
      setHeader() {
        return this
      },
    }
    return res as unknown as MedusaResponse & typeof res
  }

  function sessionEnvelope(): AuthSessionEnvelope {
    return {
      accessToken: "synthetic-access-token",
      accessExpiresAt: new Date(BASE.getTime() + 10 * 60 * 1000),
      refreshToken: "synthetic-refresh-token",
      refreshExpiresAt: new Date(BASE.getTime() + 7 * 24 * 60 * 60 * 1000),
      originalAuthenticatedAt: BASE,
      absoluteExpiresAt: new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
      lineageId: "lineage-auth-order",
      refreshCredentialId: "refresh-auth-order",
      sid: "sid-auth-order",
      generation: 0,
      authIdentityId: "identity-auth-order",
      customerId: "customer-auth-order",
      credentialVersion: 1,
      rotation: "initial",
    }
  }

  function completedRegistration(): CustomerRegistrationResult {
    return {
      status: "completed",
      registrationIntentId: "regint-auth-order",
      authIdentityId: "identity-auth-order",
      customerId: "customer-auth-order",
      session: sessionEnvelope(),
      verification: {
        state: "pending",
        intentId: "verint-auth-order",
        outboxId: "outbox-auth-order",
      },
    }
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

      async function withSessionPool<T>(
        run: (
          database: ReturnType<typeof createPostgresAuthSessionDatabase>
        ) => Promise<T>
      ): Promise<T> {
        const sessionPool = new Pool({
          connectionString: process.env.DATABASE_URL,
        })
        sessionPool.on("error", () => undefined)
        try {
          return await run(createPostgresAuthSessionDatabase(sessionPool))
        } finally {
          await sessionPool.end().catch(() => undefined)
        }
      }

      async function countOrders(): Promise<number> {
        const rows = await dbConnection.raw(
          'select count(*)::int as count from "order"'
        )
        return Number(rows.rows[0]?.count ?? 0)
      }

      async function persistedOrders(email: string) {
        const orderModule = getContainer().resolve(Modules.ORDER) as {
          listOrders(selector: Record<string, unknown>): Promise<Array<{ id: string }>>
        }
        return orderModule.listOrders({ email })
      }

      async function persistedRow(table: "cart" | "payment_collection", id: string) {
        const quoted = table === "cart" ? "cart" : "payment_collection"
        const rows = await dbConnection.raw(
          `select id from "${quoted}" where id = ?`,
          [id]
        )
        return rows.rows as Array<{ id: string }>
      }

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
        const cartModule = realContainer.resolve(Modules.CART) as unknown as {
          createCarts(input: Record<string, unknown>): Promise<{ id: string }>
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
                title: `Auth Order invariant ${identity}`,
                handle: `auth-order-invariant-${handleIdentity}`,
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
        const email = `${identity}@auth-order-invariant.test`
        const cart = await cartModule.createCarts({
          currency_code: "brl",
          email,
          items: [
            {
              title: `Auth invariant item ${identity}`,
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
            now: () => new Date("2026-08-18T16:00:00.000Z"),
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
              STRIPE_WEBHOOK_SECRET: "whsec_synthetic_14_21",
            } as never,
            stripe: {
              webhooks: {
                constructEvent: () => event(eventId),
              },
            },
            now: () => new Date("2026-08-18T16:00:00.000Z"),
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
          payment,
          post,
          counts: () => ({ completeCartInvocations }),
        }
      }

      it("allows each of the twelve auth operations with Order count remaining zero", async () => {
        expect(AUTH_HTTP_CONTRACT).toHaveLength(12)
        expect(await countOrders()).toBe(0)

        for (const entry of AUTH_HTTP_CONTRACT) {
          const before = await countOrders()
          const decision = entry.path.startsWith("/auth/")
            ? decideAuthSurfaceAccess(entry.method, entry.path)
            : decideStoreSurfaceAccess(entry.method, entry.path)
          expect(decision.action).toBe("allow")
          expect(await countOrders()).toBe(before)
        }

        const signupRes = response()
        await handleCustomerAuthSignup(
          {
            body: {
              email: "auth-order@example.invalid",
              password: "correct-password-12",
              firstName: "Ada",
              lastName: "Lovelace",
            },
            headers: {},
            ip: "203.0.113.10",
            correlationId: "signup-auth-order",
          },
          signupRes,
          {
            keyring: KEYRING,
            jwtSecret: JWT_SECRET,
            rateLimitStore: new InMemoryAtomicRateLimitStore(),
            now: () => BASE,
            registerCustomer: async () => completedRegistration(),
            bffAuthorized: true,
          }
        )
        expect(signupRes.statusCode).toBe(201)
        expect(await countOrders()).toBe(0)
      })

      it("preserves cart and checkout after session expiry and revoke with zero Orders", async () => {
        const prerequisites = await seedPersistedPrerequisites("auth_revoke_1421")
        expect(await countOrders()).toBe(0)
        expect(await persistedRow("cart", prerequisites.cartId)).toEqual([
          { id: prerequisites.cartId },
        ])

        await withSessionPool(async (database) => {
          let sequence = 0
          const issued = await issueInitialAuthSession(database, {
            authIdentityId: "identity_auth_revoke_1421",
            customerId: "customer_auth_revoke_1421",
            credentialVersion: 1,
            keyring: KEYRING,
            jwtSecret: JWT_SECRET,
            now: BASE,
            originalAuthenticatedAt: BASE,
            idFactory: (prefix) => `${prefix}_revoke1421_${++sequence}`,
          })

          const revokeRes = response()
          await handleRevokeCurrentLineage(
            {
              headers: { "content-length": "0" },
              body: {},
              customerAuth: { lineageId: issued.lineageId },
              correlationId: "revoke-auth-order",
            } as never,
            revokeRes,
            { database, now: () => BASE }
          )
          expect(revokeRes.statusCode).toBe(204)

          let expireSequence = 0
          const expirySession = await issueInitialAuthSession(database, {
            authIdentityId: "identity_auth_expire_1421",
            customerId: "customer_auth_expire_1421",
            credentialVersion: 1,
            keyring: KEYRING,
            jwtSecret: JWT_SECRET,
            now: BASE,
            originalAuthenticatedAt: BASE,
            idFactory: (prefix) => `${prefix}_expire1421_${++expireSequence}`,
          })
          await dbConnection.raw(
            `update auth_refresh_credential
               set status = 'revoked', revoked_at = ?
             where lineage_id = ? and deleted_at is null`,
            [BASE, expirySession.lineageId]
          )
          await dbConnection.raw(
            `update auth_session_lineage
               set status = 'expired',
                   expired_at = ?,
                   revoked_at = null,
                   revocation_reason = null
             where id = ?`,
            [BASE, expirySession.lineageId]
          )
          const expired = await revokeAuthSessionLineage(database, {
            lineageId: expirySession.lineageId,
            reason: "logout",
            now: BASE,
          })
          expect(expired.status).toBe("expired")
        })

        expect(await persistedRow("cart", prerequisites.cartId)).toEqual([
          { id: prerequisites.cartId },
        ])
        expect(
          await persistedRow(
            "payment_collection",
            prerequisites.paymentCollectionId
          )
        ).toEqual([{ id: prerequisites.paymentCollectionId }])
        expect(await countOrders()).toBe(0)
        expect(await persistedOrders(prerequisites.email)).toHaveLength(0)
      })

      it("uses the real canonical payment_intent.succeeded webhook as the only Order birth", async () => {
        expect(await countOrders()).toBe(0)
        const prerequisites = await seedPersistedPrerequisites("auth_pos_1421")
        const state = harness("auth_pos_1421", prerequisites)
        expect(state.payment.rows[0].order_id).toBeNull()

        const first = await state.post("evt_auth_pos_1421")
        expect(first.statusCode).toBe(200)
        expect(first.body).toEqual(
          expect.objectContaining({ ok: true, status: "processed" })
        )
        const firstOrders = await persistedOrders(prerequisites.email)
        expect(firstOrders).toHaveLength(1)
        expect(firstOrders[0].id).toMatch(/^order_/)
        expect(state.counts()).toEqual({ completeCartInvocations: 1 })
        expect(await countOrders()).toBe(1)

        const replay = await state.post("evt_auth_pos_1421")
        expect(replay.statusCode).toBe(200)
        expect(replay.body).toEqual(
          expect.objectContaining({ ok: true, duplicate: true })
        )
        const replayOrders = await persistedOrders(prerequisites.email)
        expect(replayOrders).toHaveLength(1)
        expect(replayOrders[0].id).toBe(firstOrders[0].id)
        expect(await countOrders()).toBe(1)

        const rows = await dbConnection.raw(
          "select status, order_id, payment_attempt_id from checkout_completion_log where payment_intent_id = 'pi_auth_pos_1421'"
        )
        expect(rows.rows).toEqual([
          {
            status: "completed",
            order_id: firstOrders[0].id,
            payment_attempt_id: "payatt_auth_pos_1421",
          },
        ])
      })
    },
  })
}
