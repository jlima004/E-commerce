import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, createRegionsWorkflow } from "@medusajs/core-flows"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  ensurePaymentCollectionForCart,
  fetchPaymentCollectionForCart,
} from "../../../api/store/carts/[id]/payment-attempts/medusa-payment-collection"
import { withCartModuleTransaction } from "../../../workflows/cart/cart-transaction-boundary"
import type { SharedTransactionContext } from "../../../infrastructure/store-foundation-transaction-compatibility"
import {
  derivePaymentAmountFromCart,
  type PaymentStartCartSnapshot,
} from "../eligibility"
import { preparePixPaymentAttempt } from "../pix"
import { readPersistedRequestAuthorityBlob } from "../pre-provider-arbitration"
import { assertCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import {
  persistPreProviderFinancialFreezeInTransaction,
  readDurablePreProviderAuthority,
  type PaymentAttemptSqlTransaction,
} from "../transactional-authority"
import type { PaymentAttemptRecord } from "../types"
import { STORE_RESOURCE_VERSION_MODULE } from "../../store-resource-version"

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
  describe("pix Medusa PaymentCollection PostgreSQL routing", () => {
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

  function getPaymentAttemptSqlTransaction(
    sharedContext: SharedTransactionContext
  ): PaymentAttemptSqlTransaction {
    const transaction = sharedContext.transactionManager.getTransactionContext?.()
    if (!transaction) {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }
    return transaction as unknown as PaymentAttemptSqlTransaction
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const trackedCartIds: string[] = []
      const trackedAttemptIds: string[] = []

      async function loadCartPaymentSnapshot(
        cartId: string
      ): Promise<PaymentStartCartSnapshot> {
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
            "email",
            "currency_code",
            "total",
            "item_total",
            "shipping_total",
            "customer.id",
            "items.id",
            "items.quantity",
            "items.unit_price",
            "items.variant_id",
            "items.variant.id",
            "items.variant.sku",
            "items.variant.metadata",
            "items.variant.prices.amount",
            "items.variant.prices.currency_code",
            "shipping_address.first_name",
            "shipping_address.last_name",
            "shipping_address.address_1",
            "shipping_address.city",
            "shipping_address.postal_code",
            "shipping_address.country_code",
            "shipping_address.province",
            "shipping_address.phone",
            "shipping_address.metadata",
            "region.id",
            "region.countries.iso_2",
          ],
          filters: { id: cartId },
        })
        return data[0] as PaymentStartCartSnapshot
      }

      async function insertPaymentAttemptInTransaction(
        transaction: PaymentAttemptSqlTransaction,
        attempt: PaymentAttemptRecord
      ) {
        await transaction.raw(
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
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, null, null, null, now(), now(), null
            )
          `,
          [
            attempt.id,
            attempt.cart_id,
            attempt.payment_collection_id,
            attempt.payment_session_id,
            attempt.provider,
            attempt.provider_payment_intent_id,
            attempt.provider_payment_session_id,
            attempt.payment_method_type,
            attempt.status,
            attempt.amount,
            attempt.currency_code,
            JSON.stringify(attempt.metadata ?? {}),
            attempt.order_id ?? null,
            attempt.financial_freeze_started_at ?? null,
            attempt.provider_canceled_confirmed_at ?? null,
            attempt.provider_discovery_started_at ?? null,
          ]
        )
      }

      async function ensureBrazilRegion(): Promise<{
        id: string
        countries: Array<{ iso_2?: string }>
      }> {
        const existing = await dbConnection.raw(
          "select id from region where currency_code = ? and deleted_at is null limit 1",
          ["brl"]
        )
        const existingId = existing.rows?.[0]?.id
        if (existingId) {
          return { id: String(existingId), countries: [{ iso_2: "br" }] }
        }

        await createRegionsWorkflow(getContainer()).run({
          input: {
            regions: [
              {
                name: "Pix collection proof Brazil",
                currency_code: "brl",
                countries: ["br"],
                payment_providers: ["pp_system_default"],
              },
            ],
          },
        })

        const created = await dbConnection.raw(
          "select id from region where currency_code = ? and deleted_at is null limit 1",
          ["brl"]
        )
        const createdId = created.rows?.[0]?.id
        if (!createdId) {
          throw new Error("PIX_COLLECTION_PROOF_REGION_MISSING")
        }
        return { id: String(createdId), countries: [{ iso_2: "br" }] }
      }

      async function seedRealCartWithoutPaymentCollection(identity: string) {
        const handleIdentity = identity.replace(/_/g, "-")
        const container = getContainer()
        const region = await ensureBrazilRegion()
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as {
          createShippingProfiles(input: {
            name: string
            type: string
          }): Promise<{ id: string }>
        }
        const cartModule = container.resolve(Modules.CART) as {
          createCarts(input: Record<string, unknown>): Promise<{ id: string }>
        }
        const shippingProfile = await fulfillmentModule.createShippingProfiles({
          name: `Pix collection proof ${identity}`,
          type: "default",
        })
        const variantMetadata = {
          gelato_product_uid: `gelato_${identity}`,
          gelato_template_id: `template_${identity}`,
          gelato_variant_options: { size: "M", color: "Preto" },
          template_mode: "fixed",
        }
        const { result: products } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: `Pix collection proof ${identity}`,
                handle: `pix-collection-proof-${handleIdentity}`,
                shipping_profile_id: shippingProfile.id,
                options: [{ title: "Size", values: ["M"] }],
                variants: [
                  {
                    title: "M",
                    sku: `SKU-${identity}`,
                    options: { Size: "M" },
                    manage_inventory: false,
                    allow_backorder: true,
                    metadata: variantMetadata,
                    prices: [{ amount: 99, currency_code: "brl" }],
                  },
                ],
              },
            ],
          },
        })
        const variant = products[0].variants[0]
        const cart = await cartModule.createCarts({
          currency_code: "brl",
          region_id: region.id,
          email: `${identity}@pix-collection.test`,
          shipping_address: {
            first_name: "Maria",
            last_name: "Silva",
            address_1: "Rua A, 100",
            city: "Sao Paulo",
            postal_code: "01311000",
            country_code: "br",
            province: "SP",
            phone: "+5511999999999",
            metadata: {
              federal_tax_id: "52998224725",
            },
          },
          items: [
            {
              title: `Pix collection item ${identity}`,
              quantity: 1,
              unit_price: 99,
              variant_id: variant.id,
              variant_sku: variant.sku,
              requires_shipping: false,
              is_custom_price: true,
            },
          ],
        })

        const resourceVersionModule = container.resolve(
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

        const cartSnapshot = await loadCartPaymentSnapshot(cart.id)
        const enrichedCartSnapshot: PaymentStartCartSnapshot = {
          ...cartSnapshot,
          region:
            cartSnapshot.region ??
            ({
              id: region.id,
              countries: region.countries?.length
                ? region.countries
                : [{ iso_2: "br" }],
            } as PaymentStartCartSnapshot["region"]),
          items: (cartSnapshot.items ?? []).map((item) => ({
            ...item,
            variant: item.variant ?? {
              id: variant.id,
              sku: variant.sku,
              metadata: variantMetadata,
              prices: [{ amount: 99, currency_code: "brl" }],
            },
          })),
        }
        const derivedAmount = derivePaymentAmountFromCart(enrichedCartSnapshot)
        if (!derivedAmount) {
          throw new Error("PIX_COLLECTION_PROOF_CART_TOTAL_UNAVAILABLE")
        }

        trackedCartIds.push(cart.id)

        return {
          cartId: cart.id,
          cartResourceVersion: cartResourceVersion.version,
          cartSnapshot: enrichedCartSnapshot,
          providerAmountMinor: derivedAmount.provider_amount_minor,
        }
      }

      afterEach(async () => {
        if (trackedAttemptIds.length) {
          await dbConnection.raw(
            "delete from payment_attempt where id = any(?)",
            [trackedAttemptIds]
          )
          trackedAttemptIds.length = 0
        }
        for (const cartId of trackedCartIds.splice(0)) {
          await dbConnection.raw(
            "delete from cart_payment_collection where cart_id = ?",
            [cartId]
          )
          await dbConnection.raw(
            "delete from store_resource_version where resource_id = ?",
            [cartId]
          )
          await dbConnection.raw("delete from cart where id = ?", [cartId])
        }
      })

      it("creates a real cart-linked PaymentCollection inside the cart transaction and persists Pix authority", async () => {
        assertNoStripeNetwork()
        const identity = "i3_pix_col_proof"
        const attemptId = `payatt_${identity}`
        trackedAttemptIds.push(attemptId)

        const seeded = await seedRealCartWithoutPaymentCollection(identity)
        const request = { scope: getContainer() } as MedusaRequest

        expect(await fetchPaymentCollectionForCart(request, seeded.cartId)).toBeNull()

        const beforeLink = await dbConnection.raw(
          `
            select payment_collection_id
            from cart_payment_collection
            where cart_id = ?
          `,
          [seeded.cartId]
        )
        expect(beforeLink.rows).toHaveLength(0)

        const proof = await withCartModuleTransaction(
          getContainer(),
          async (transaction, _manager, sharedContext) => {
            const collection = await ensurePaymentCollectionForCart(
              request,
              seeded.cartId,
              sharedContext
            )

            expect(collection.id).toBeTruthy()
            expect(collection.id).not.toMatch(/^paycol_/)

            const link = await transaction.raw(
              `
                select payment_collection_id
                from cart_payment_collection
                where cart_id = ?
              `,
              [seeded.cartId]
            )
            expect(link.rows).toHaveLength(1)
            expect(link.rows[0]?.payment_collection_id).toBe(collection.id)

            const prepared = preparePixPaymentAttempt({
              cart: seeded.cartSnapshot,
              actor: {
                actorType: "guest",
                actorId: "sess_i3_pix_col",
                sessionId: "sess_i3_pix_col",
              },
              sessionActiveCartId: seeded.cartId,
              existingAttempts: [],
              generateId: () => attemptId,
              cartResourceVersion: seeded.cartResourceVersion,
              paymentCollection: {
                payment_collection_id: collection.id,
              },
            })

            expect(prepared.attempt.payment_collection_id).toBe(collection.id)
            expect(prepared.attempt.payment_session_id).toBeNull()
            expect(prepared.attempt.amount).toBe(seeded.providerAmountMinor)

            await insertPaymentAttemptInTransaction(transaction, prepared.attempt)

            const persisted = await persistPreProviderFinancialFreezeInTransaction(
              transaction,
              {
                cart_id: seeded.cartId,
                cart_resource_version: seeded.cartResourceVersion,
                payment_method_type: "pix",
                amount_minor: seeded.providerAmountMinor,
                currency_code: "brl",
                payment_attempt_id: attemptId,
                payment_collection_id: prepared.attempt.payment_collection_id,
                payment_session_id: prepared.attempt.payment_session_id,
                idempotency_key: prepared.idempotencyKey,
              }
            )

            const authority = await readDurablePreProviderAuthority(
              getPaymentAttemptSqlTransaction(sharedContext),
              attemptId
            )

            return {
              collection,
              persisted,
              authority,
            }
          }
        )

        const authorityBlob = readPersistedRequestAuthorityBlob(
          proof.authority.attempt.metadata
        )
        const authorityV1 =
          assertCompleteStripePaymentIntentCreateAuthorityV1(authorityBlob)

        expect(proof.collection.id).toBe(proof.persisted.payment_collection_id)
        expect(proof.collection.id).toBe(authorityV1.payment_collection_id)
        expect(proof.persisted.payment_session_id).toBeNull()
        expect(proof.authority.attempt.payment_session_id).toBeNull()
        expect(authorityV1.payment_session_id).toBeNull()
        expect(authorityV1.canonical_request.metadata.session_id).toBeUndefined()
        expect(proof.persisted.amount).toBe(seeded.providerAmountMinor)

        const committedLink = await dbConnection.raw(
          `
            select payment_collection_id
            from cart_payment_collection
            where cart_id = ?
          `,
          [seeded.cartId]
        )
        expect(committedLink.rows[0]?.payment_collection_id).toBe(
          proof.collection.id
        )

        assertNoStripeNetwork()
      })

      it("never invokes an external Stripe provider in this suite", () => {
        assertNoStripeNetwork()
        expect(
          process.env.DB_HOST &&
            ["localhost", "127.0.0.1", "::1"].includes(String(process.env.DB_HOST))
        ).toBe(true)
      })
    },
  })
}
