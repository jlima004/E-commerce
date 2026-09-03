import { readFileSync } from "fs"
import { join } from "path"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import defaultMiddlewares from "../../src/api/middlewares"
import {
  applyStoreCartPreOrderQueryConfig,
} from "../../src/api/store/carts/query-config"
import { POST as startCardPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/card/route"
import { POST as startPixPaymentAttemptRoute } from "../../src/api/store/carts/[id]/payment-attempts/pix/route"
import { getPaymentStartRejectedBodyMessage } from "../../src/api/store/carts/payment-attempts/validators"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import {
  STRIPE_CARD_INITIATION_LAYER,
  type StripeCardInitiationLayer,
} from "../../src/modules/payment-attempt/card"
import {
  STRIPE_PIX_INITIATION_LAYER,
  type StripePixInitiationLayer,
} from "../../src/modules/payment-attempt/pix"
import type { StoreCartPreOrderRecord } from "../../src/api/store/carts/serializers"
import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../src/api/store/carts/serializers"
import {
  PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY,
  withPaymentAttemptCartFingerprintMetadata,
} from "../../src/modules/payment-attempt/cart-invalidation"
import { findActiveAttemptsForCart } from "../../src/modules/payment-attempt/service"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../../src/modules/payment-attempt/provider-request-authority"
import { discoverPaymentIntentsByPaymentAttemptId } from "../../src/modules/payment-attempt/stripe-real"
import { RECONCILIATION_REASON_CODE } from "../../src/reconciliation/reason-codes"
import { PAYMENT_ATTEMPT_CART_VERSION_UNBOUND } from "../../src/modules/payment-attempt/transactional-authority"

const VALID_CPF_NORMALIZED = "52998224725"

const FORBIDDEN_RESPONSE_SUBSTRINGS = [
  "order_id",
  "\"order\"",
  "WebhookEventLog",
  "CheckoutCompletionLog",
  "purchase_completed",
  "gelato",
  "order.gelatoapis.com",
  "payment_session.data",
  "next_action",
  "\"payment_method\":",
  "charges",
] as const

const FORBIDDEN_PRODUCTION_SUBSTRINGS = [
  "completeCartWorkflow",
  "/store/carts/",
  "sdk.store.cart.complete",
  "WebhookEventLog",
  "CheckoutCompletionLog",
  "purchase_completed",
  "order.gelatoapis.com",
  "gelato_order_id",
] as const

function buildExistingAttemptForCart(
  cart: StoreCartPreOrderRecord & { total?: number | null },
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  const fingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)

  return {
    id: "payatt_existing_01",
    cart_id: cart.id,
    payment_collection_id: "paycol_existing",
    payment_session_id: "payses_existing",
    provider: "stripe_safe_layer",
    provider_payment_intent_id: "pi_existing",
    provider_payment_session_id: "ps_existing",
    payment_method_type: "card",
    status: "card_client_secret_created",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: withPaymentAttemptCartFingerprintMetadata(null, fingerprint),
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-29T10:00:00.000Z",
    updated_at: "2026-06-29T10:00:00.000Z",
    ...overrides,
  }
}

function countActiveAttempts(
  attempts: PaymentAttemptRecord[],
  cartId: string
): number {
  return findActiveAttemptsForCart(attempts, cartId).length
}

function sellableVariant() {
  return {
    id: "variant_sellable",
    sku: "TSHIRT-BLACK-M",
    metadata: {
      gelato_product_uid: "prod_gelato_abc123",
      gelato_template_id: "template_fixed_001",
      gelato_variant_options: { size: "M", color: "Preto" },
      template_mode: "fixed",
    },
    prices: [{ currency_code: "brl", amount: 99 }],
  }
}

function buildCompleteGuestCart(
  overrides: Partial<StoreCartPreOrderRecord & { total?: number | null }> = {}
): StoreCartPreOrderRecord & { total?: number | null } {
  return {
    id: "cart_guest_01",
    email: "guest@exemplo.com",
    currency_code: "brl",
    locale: "pt-BR",
    region_id: "reg_br",
    created_at: "2026-06-27T10:00:00.000Z",
    updated_at: "2026-06-27T10:00:00.000Z",
    metadata: null,
    customer: null,
    total: 99,
    items: [
      {
        id: "item_01",
        quantity: 1,
        title: "Camiseta Essential",
        variant_id: "variant_sellable",
        variant_title: "Preto / M",
        unit_price: 99,
        variant: sellableVariant(),
      },
    ],
    shipping_address: {
      first_name: "Maria",
      last_name: "Silva",
      company: null,
      address_1: "Rua A, 100",
      address_2: null,
      city: "Sao Paulo",
      postal_code: "01311000",
      country_code: "BR",
      province: "SP",
      phone: "+5511999999999",
      metadata: {
        federal_tax_id: VALID_CPF_NORMALIZED,
      },
    },
    region: {
      countries: [{ iso_2: "br" }],
    },
    ...overrides,
  }
}

function buildDecorativeGuestCart110(
  overrides: Partial<StoreCartPreOrderRecord & { total?: number | null }> = {}
): StoreCartPreOrderRecord & { total?: number | null } {
  return buildCompleteGuestCart({
    id: "cart_guest_110",
    total: 110,
    shipping_total: 15,
    discount_total: 10,
    tax_total: 5,
    items: [
      {
        id: "item_01",
        quantity: 1,
        title: "Camiseta Essential",
        variant_id: "variant_sellable",
        variant_title: "Preto / M",
        unit_price: 100,
        variant: sellableVariant(),
      },
    ],
    ...overrides,
  })
}

type MedusaPaymentSessionMock = {
  id: string
  status: string
  amount?: number
  currency_code?: string
  data?: Record<string, unknown>
}

type MedusaPaymentCollectionMock = {
  id: string
  payment_sessions: MedusaPaymentSessionMock[]
}

function createMedusaPaymentState() {
  return {
    collectionSequence: 1,
    sessionSequence: 1,
    cartPaymentCollections: {} as Record<string, MedusaPaymentCollectionMock>,
  }
}

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
  params?: {
    id?: string
  }
  body?: Record<string, unknown>
}

function createRequest(overrides: Partial<SessionCapableRequest> = {}) {
  return {
    query: {},
    params: { id: "cart_guest_01" },
    body: {},
    scope: {
      resolve: jest.fn(),
    },
    ...overrides,
  } as SessionCapableRequest
}

function createResponse() {
  const jsonSpy = jest.fn()
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      jsonSpy(body)
      return response
    }),
    jsonSpy,
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
    jsonSpy: jest.Mock
  }
}

type RemoteQueryShape = {
  __value?: Record<
    string,
    {
      __args?: {
        filters?: Record<string, unknown>
      }
    }
  >
}

function readRemoteQueryTarget(queryObject: RemoteQueryShape): {
  entryPoint?: string
  filters: Record<string, unknown>
} {
  const entryPoint = queryObject.__value
    ? Object.keys(queryObject.__value)[0]
    : undefined
  const filters =
    ((entryPoint && queryObject.__value?.[entryPoint]?.__args?.filters) as
      | Record<string, unknown>
      | undefined) ?? {}

  return { entryPoint, filters }
}

function createRemoteQueryResolver(input: {
  carts?: Record<string, StoreCartPreOrderRecord & { total?: number | null }>
  medusaPaymentState?: ReturnType<typeof createMedusaPaymentState>
}) {
  const carts = input.carts ?? {}
  const medusaPaymentState =
    input.medusaPaymentState ?? createMedusaPaymentState()

  const resolver = jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "cart" && filters.id) {
      const cart = carts[String(filters.id)]
      return cart ? [cart] : []
    }

    if (entryPoint === "cart_payment_collection" && filters.cart_id) {
      const paymentCollection =
        medusaPaymentState.cartPaymentCollections[String(filters.cart_id)]

      return paymentCollection
        ? [
            {
              payment_collection: paymentCollection,
            },
          ]
        : []
    }

    return []
  })

  ;(resolver as typeof resolver & {
    medusaPaymentState: ReturnType<typeof createMedusaPaymentState>
    carts: Record<string, StoreCartPreOrderRecord & { total?: number | null }>
  }).medusaPaymentState = medusaPaymentState
  ;(resolver as typeof resolver & {
    carts: Record<string, StoreCartPreOrderRecord & { total?: number | null }>
  }).carts = carts

  return resolver
}

type PaymentKnexCatalog = {
  regionCountries: Array<{ iso_2: string | null }>
  variantRows: Array<{
    id: string
    sku: string | null
    metadata: Record<string, unknown> | null
  }>
  priceLinkRows: Array<{ variant_id: string; price_set_id: string }>
  priceRows: Array<{
    price_set_id: string
    currency_code: string
    amount: number
  }>
}

function classifyPaymentSql(sql: string): string {
  const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase()

  if (normalized.includes("pg_advisory_xact_lock")) {
    return "lock"
  }

  if (normalized.includes("from cart_review") && normalized.includes("for update")) {
    return "review-read"
  }

  if (normalized.includes("from region_country")) {
    return "region-hydrate"
  }

  if (normalized.includes("from product_variant_price_set")) {
    return "variant-price-link"
  }

  if (normalized.includes("from product_variant")) {
    return "variant-hydrate"
  }

  if (/\bfrom price\b/.test(normalized)) {
    return "price-hydrate"
  }

  if (normalized.includes("from store_resource_version")) {
    return "crv-read"
  }

  if (
    normalized.includes("from payment_attempt") &&
    normalized.includes("financial_freeze_started_at is not null") &&
    normalized.startsWith("select")
  ) {
    return "frozen-list"
  }

  if (
    normalized.startsWith("select") &&
    normalized.includes("from payment_attempt") &&
    normalized.includes("replay_deadline")
  ) {
    return "replay-eligible"
  }

  if (
    normalized.startsWith("select") &&
    normalized.includes("from payment_attempt") &&
    normalized.includes("where id = ?")
  ) {
    return "pa-read"
  }

  if (
    normalized.startsWith("update payment_attempt") &&
    normalized.includes("financial_freeze_started_at = coalesce")
  ) {
    return "freeze-persist"
  }

  if (
    normalized.startsWith("update payment_attempt") &&
    normalized.includes("provider_payment_intent_id = ?") &&
    normalized.includes("financial_freeze_started_at is not null")
  ) {
    return "provider-bind"
  }

  if (
    normalized.startsWith("update payment_attempt") &&
    normalized.includes("provider_discovery_started_at = current_timestamp")
  ) {
    return "claim-discovery"
  }

  return "raw-other"
}

type PaymentAttemptTableRow = PaymentAttemptRecord & {
  deleted_at?: string | null
}

type PreProviderHttpHarness = {
  paymentAttempts: PaymentAttemptTableRow[]
  cartResourceVersionByCartId: Record<string, number | null>
  defaultCartResourceVersion: number | null
  dbNow: string
  trace: string[]
  pendingAuthorityCommit: boolean
}

const HTTP_DB_NOW = "2026-09-02T15:00:00.000Z"

function createPreProviderHttpHarness(
  existingAttempts: PaymentAttemptRecord[] = []
): PreProviderHttpHarness {
  return {
    paymentAttempts: existingAttempts.map((attempt) => ({
      ...attempt,
      deleted_at: null,
    })),
    cartResourceVersionByCartId: {},
    defaultCartResourceVersion: 1,
    dbNow: HTTP_DB_NOW,
    trace: [],
    pendingAuthorityCommit: false,
  }
}

function replayDeadlineFromDbNow(dbNow: string): string {
  return new Date(Date.parse(dbNow) + 23 * 60 * 60 * 1000).toISOString()
}

function stampCompleteV1OnRow(
  row: PaymentAttemptTableRow,
  cartResourceVersion: number,
  idempotencyKey: string,
  dbNow: string
) {
  const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: row.payment_method_type,
    amount_minor: row.amount,
    cart_id: row.cart_id,
    cart_resource_version: cartResourceVersion,
    payment_attempt_id: row.id,
    payment_collection_id: row.payment_collection_id,
    payment_session_id: row.payment_session_id,
    idempotency_key: idempotencyKey,
    authority_created_at: dbNow,
    replay_deadline: replayDeadlineFromDbNow(dbNow),
  })
  return {
    ...row,
    financial_freeze_started_at: row.financial_freeze_started_at ?? dbNow,
    metadata: {
      ...(row.metadata ?? {}),
      cart_resource_version: cartResourceVersion,
      provider_idempotency_key: idempotencyKey,
      payment_attempt_id: row.id,
      stripe_payment_intent_create: v1,
    },
    updated_at: dbNow,
  }
}

function toAuthorityRow(attempt: PaymentAttemptTableRow): Record<string, unknown> {
  const { deleted_at: _deletedAt, ...row } = attempt
  return { ...row }
}

function buildKnexCatalogFromCart(
  cart: StoreCartPreOrderRecord & { total?: number | null }
): PaymentKnexCatalog {
  const regionCountries =
    cart.region?.countries?.map((country) => ({
      iso_2: country.iso_2 ?? null,
    })) ?? [{ iso_2: "br" }]
  const variantRows: PaymentKnexCatalog["variantRows"] = []
  const priceLinkRows: PaymentKnexCatalog["priceLinkRows"] = []
  const priceRows: PaymentKnexCatalog["priceRows"] = []

  for (const item of cart.items ?? []) {
    const variant = item.variant
    const variantId = variant?.id ?? item.variant_id
    if (!variantId) {
      continue
    }

    variantRows.push({
      id: variantId,
      sku: variant?.sku ?? null,
      metadata: variant?.metadata ?? null,
    })

    const priceSetId = `pset_${variantId}`
    priceLinkRows.push({
      variant_id: variantId,
      price_set_id: priceSetId,
    })

    for (const price of variant?.prices ?? []) {
      if (!price.currency_code || price.amount === undefined) {
        continue
      }

      priceRows.push({
        price_set_id: priceSetId,
        currency_code: price.currency_code,
        amount: price.amount,
      })
    }
  }

  return { regionCountries, variantRows, priceLinkRows, priceRows }
}

function toCartOwnedLockedCart(
  cart: StoreCartPreOrderRecord & { total?: number | null }
): StoreCartPreOrderRecord & { total?: number | null; customer_id: string | null } {
  const { region: _ignoredRegion, ...cartWithoutRegion } = cart

  return {
    ...cartWithoutRegion,
    customer_id: cart.customer?.id ?? null,
    items: (cart.items ?? []).map((item) => {
      const { variant: _ignoredVariant, ...itemWithoutVariant } = item
      return itemWithoutVariant
    }),
  }
}

function createDefaultCartModuleForPayment(
  carts: Record<string, StoreCartPreOrderRecord & { total?: number | null }>,
  harness: PreProviderHttpHarness = createPreProviderHttpHarness()
) {
  let knexCatalog: PaymentKnexCatalog = {
    regionCountries: [{ iso_2: "br" }],
    variantRows: [],
    priceLinkRows: [],
    priceRows: [],
  }

  const knex = {
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      const type = classifyPaymentSql(sql)

      if (type === "review-read") {
        return { rows: [] }
      }

      if (type === "region-hydrate") {
        return { rows: knexCatalog.regionCountries }
      }

      if (type === "variant-hydrate") {
        return { rows: knexCatalog.variantRows }
      }

      if (type === "variant-price-link") {
        return { rows: knexCatalog.priceLinkRows }
      }

      if (type === "price-hydrate") {
        return { rows: knexCatalog.priceRows }
      }

      if (type === "crv-read") {
        const cartId = String(bindings[0])
        const version =
          cartId in harness.cartResourceVersionByCartId
            ? harness.cartResourceVersionByCartId[cartId]
            : harness.defaultCartResourceVersion
        if (typeof version !== "number" || version < 1) {
          return { rows: [] }
        }
        return { rows: [{ version }] }
      }

      if (type === "frozen-list") {
        const cartId = String(bindings[0])
        return {
          rows: harness.paymentAttempts
            .filter(
              (row) =>
                row.cart_id === cartId &&
                row.financial_freeze_started_at != null &&
                row.provider_canceled_confirmed_at == null &&
                row.order_id == null
            )
            .map(toAuthorityRow),
        }
      }

      if (type === "replay-eligible") {
        const id = String(bindings[0])
        const found = harness.paymentAttempts.find((row) => row.id === id)
        const blob = found?.metadata?.stripe_payment_intent_create as
          | { replay_deadline?: string }
          | undefined
        const deadline = blob?.replay_deadline
        const eligible =
          typeof deadline === "string" &&
          Date.parse(harness.dbNow) < Date.parse(deadline)
        return { rows: [{ eligible }] }
      }

      if (type === "pa-read") {
        const id = String(bindings[0])
        const found = harness.paymentAttempts.find((row) => row.id === id)
        if (
          found &&
          found.financial_freeze_started_at != null &&
          !harness.trace.includes("stripe_create") &&
          !harness.trace.includes("durable_reread") &&
          harness.trace.includes("authority_tx_commit")
        ) {
          harness.trace.push("durable_reread")
        }
        return { rows: found ? [toAuthorityRow(found)] : [] }
      }

      if (type === "freeze-persist") {
        const id = String(bindings[bindings.length - 5])
        const index = harness.paymentAttempts.findIndex((row) => row.id === id)
        if (index < 0) {
          return { rows: [] }
        }
        const current = harness.paymentAttempts[index]
        const cartResourceVersion = Number(bindings[2])
        const idempotencyKey = String(bindings[3])
        const existingBlob = current.metadata?.stripe_payment_intent_create
        const keepBlob =
          existingBlob &&
          typeof existingBlob === "object" &&
          (existingBlob as { schema?: unknown }).schema ===
            "stripe_payment_intent_create"
        const next = keepBlob
          ? {
              ...current,
              financial_freeze_started_at:
                current.financial_freeze_started_at ?? harness.dbNow,
              metadata: {
                ...(current.metadata ?? {}),
                cart_resource_version: cartResourceVersion,
                provider_idempotency_key: idempotencyKey,
                payment_attempt_id: current.id,
              },
              updated_at: harness.dbNow,
            }
          : stampCompleteV1OnRow(
              current,
              cartResourceVersion,
              idempotencyKey,
              harness.dbNow
            )
        harness.paymentAttempts[index] = next
        harness.pendingAuthorityCommit = true
        return { rows: [toAuthorityRow(next)] }
      }

      if (type === "provider-bind") {
        const intentId = String(bindings[0])
        const id = String(bindings[2])
        const cartId = String(bindings[3])
        const amount = Number(bindings[5])
        const currency = String(bindings[6])
        const method = String(bindings[7])
        const index = harness.paymentAttempts.findIndex(
          (row) =>
            row.id === id &&
            row.cart_id === cartId &&
            row.amount === amount &&
            row.currency_code === currency &&
            row.payment_method_type === method &&
            row.financial_freeze_started_at != null &&
            row.provider_canceled_confirmed_at == null &&
            row.order_id == null &&
            (row.provider_payment_intent_id == null ||
              row.provider_payment_intent_id === intentId)
        )
        if (index < 0) {
          return { rows: [] }
        }
        const current = harness.paymentAttempts[index]
        harness.paymentAttempts[index] = {
          ...current,
          provider_payment_intent_id: intentId,
          provider_payment_session_id:
            current.provider_payment_session_id ??
            (typeof bindings[1] === "string" ? bindings[1] : current.provider_payment_session_id),
          updated_at: harness.dbNow,
        }
        harness.trace.push("provider_bind")
        return { rows: [toAuthorityRow(harness.paymentAttempts[index])] }
      }

      if (type === "claim-discovery") {
        const id = String(bindings[0])
        const index = harness.paymentAttempts.findIndex(
          (row) => row.id === id && row.provider_discovery_started_at == null
        )
        if (index < 0) {
          return { rows: [] }
        }
        harness.paymentAttempts[index] = {
          ...harness.paymentAttempts[index],
          provider_discovery_started_at: harness.dbNow,
          updated_at: harness.dbNow,
        }
        return { rows: [toAuthorityRow(harness.paymentAttempts[index])] }
      }

      return { rows: [] }
    }),
  }

  const transactionManager = {
    getTransactionContext: () => knex,
  }

  return {
    harness,
    pgConnection: {
      transaction: jest.fn(
        async (callback: (transaction: typeof knex) => Promise<unknown>) => {
          const result = await callback(knex)
          if (harness.pendingAuthorityCommit) {
            harness.trace.push("authority_tx_commit")
            harness.pendingAuthorityCommit = false
          }
          return result
        }
      ),
    },
    retrieveCart: jest.fn(
      async (
        cartId: string,
        _config?: unknown,
        _sharedContext?: { transactionManager?: typeof transactionManager }
      ) => {
        const cart = carts[cartId]
        if (!cart) {
          return undefined
        }

        knexCatalog = buildKnexCatalogFromCart(cart)
        return toCartOwnedLockedCart(cart)
      }
    ),
  }
}

function createWorkflowEngineMock(
  medusaPaymentState: ReturnType<typeof createMedusaPaymentState>
) {
  return {
    run: jest.fn(async (workflowId: string, options: { input?: { cart_id?: string } }) => {
      if (workflowId !== createPaymentCollectionForCartWorkflowId) {
        throw new Error(`unexpected workflow ${workflowId}`)
      }

      const cartId = options.input?.cart_id
      if (!cartId) {
        throw new Error("cart_id required")
      }

      medusaPaymentState.cartPaymentCollections[cartId] ??= {
        id: `pay_col_http_${String(
          medusaPaymentState.collectionSequence++
        ).padStart(2, "0")}`,
        payment_sessions: [],
      }
    }),
  }
}

function createMedusaPaymentModuleMock(
  medusaPaymentState: ReturnType<typeof createMedusaPaymentState>
) {
  function findCollectionById(collectionId: string) {
    return Object.values(medusaPaymentState.cartPaymentCollections).find(
      (collection) => collection.id === collectionId
    )
  }

  function updateSession(
    patch: { id: string; status?: string; data?: Record<string, unknown> }
  ) {
    for (const collection of Object.values(
      medusaPaymentState.cartPaymentCollections
    )) {
      const session = collection.payment_sessions.find(
        (item) => item.id === patch.id
      )

      if (session) {
        if (patch.status) {
          session.status = patch.status
        }

        if (patch.data) {
          session.data = patch.data
        }

        return session
      }
    }

    return null
  }

  return {
    createPaymentSession: jest.fn(
      async (
        paymentCollectionId: string,
        data: {
          provider_id: string
          amount: number
          currency_code: string
          data?: Record<string, unknown>
        }
      ) => {
        const collection = findCollectionById(paymentCollectionId)
        if (!collection) {
          throw new Error("payment collection not found")
        }

        const session = {
          id: `payses_http_${String(
            medusaPaymentState.sessionSequence++
          ).padStart(2, "0")}`,
          status: PaymentSessionStatus.PENDING,
          amount: data.amount,
          currency_code: data.currency_code,
          data: data.data ?? {},
        }
        collection.payment_sessions.push(session)

        return session
      }
    ),
    updatePaymentSessions: jest.fn(async (data) => {
      const rows = Array.isArray(data) ? data : [data]

      return rows.map((row) => updateSession(row)).filter(Boolean)
    }),
  }
}

function createPaymentAttemptModuleMock(
  existingAttempts: PaymentAttemptRecord[] = [],
  layers: {
    card?: StripeCardInitiationLayer | null
    pix?: StripePixInitiationLayer | null
  } = {},
  harness: PreProviderHttpHarness = createPreProviderHttpHarness(existingAttempts)
) {
  const attempts = [...existingAttempts]
  if (harness.paymentAttempts.length === 0 && existingAttempts.length > 0) {
    harness.paymentAttempts.push(
      ...existingAttempts.map((attempt) => ({ ...attempt, deleted_at: null }))
    )
  }

  return {
    listPaymentAttempts: jest.fn(async () => attempts),
    createPaymentAttempts: jest.fn(async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
      const rows = Array.isArray(data) ? data : [data]
      attempts.push(...rows)
      for (const row of rows) {
        harness.paymentAttempts.push({
          ...row,
          financial_freeze_started_at: row.financial_freeze_started_at ?? null,
          provider_canceled_confirmed_at: row.provider_canceled_confirmed_at ?? null,
          deleted_at: null,
        })
      }
      return rows
    }),
    updatePaymentAttempts: jest.fn(async (data: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
      const rows = Array.isArray(data) ? data : [data]
      for (const row of rows) {
        const index = attempts.findIndex((item) => item.id === row.id)
        if (index >= 0) {
          attempts[index] = row
        }
        const knexIndex = harness.paymentAttempts.findIndex((item) => item.id === row.id)
        if (knexIndex >= 0) {
          const current = harness.paymentAttempts[knexIndex]
          harness.paymentAttempts[knexIndex] = {
            ...current,
            ...row,
            financial_freeze_started_at:
              row.financial_freeze_started_at ?? current.financial_freeze_started_at,
            metadata: {
              ...(current.metadata ?? {}),
              ...(row.metadata ?? {}),
              ...(current.metadata?.stripe_payment_intent_create
                ? {
                    stripe_payment_intent_create:
                      current.metadata.stripe_payment_intent_create,
                  }
                : {}),
              ...(typeof current.metadata?.provider_idempotency_key === "string"
                ? {
                    provider_idempotency_key:
                      current.metadata.provider_idempotency_key,
                  }
                : {}),
            },
            deleted_at: current.deleted_at ?? null,
          }
        }
      }
      return rows
    }),
    resolveStripeCardInitiationLayer: jest.fn(async () => layers.card ?? null),
    resolveStripePixInitiationLayer: jest.fn(async () => layers.pix ?? null),
    attempts,
    harness,
  }
}

function createStripeCardInitiationLayerMock(
  overrides: Record<string, unknown> = {},
  harness?: PreProviderHttpHarness
): StripeCardInitiationLayer & { search: jest.Mock } {
  const search = jest.fn(async () => ({
    data: [],
    has_more: false,
    next_page: null,
  }))
  return {
    search,
    createCardPaymentIntent: jest.fn(async (request) => {
      harness?.trace.push("stripe_create")
      const metadata =
        request.canonical_request?.metadata ??
        {
          cart_id: request.cart_id,
          payment_attempt_id: request.payment_attempt_id,
          ...(request.payment_session_id
            ? { session_id: request.payment_session_id }
            : {}),
        }
      return {
        id: "pi_http_card_mock",
        object: "payment_intent",
        status: "requires_payment_method",
        amount: request.amount_minor,
        currency: request.currency_code,
        payment_method_types: ["card"],
        client_secret: "pi_http_card_mock_secret_test",
        metadata,
        ...overrides,
      }
    }),
    discoverPaymentIntentsByPaymentAttemptId: jest.fn(async (paymentAttemptId: string) =>
      discoverPaymentIntentsByPaymentAttemptId(
        { create: jest.fn(), search },
        paymentAttemptId
      )
    ),
  }
}

function createStripePixInitiationLayerMock(
  overrides: Record<string, unknown> = {},
  harness?: PreProviderHttpHarness
): StripePixInitiationLayer & { search: jest.Mock } {
  const search = jest.fn(async () => ({
    data: [],
    has_more: false,
    next_page: null,
  }))
  return {
    search,
    createPixPaymentIntent: jest.fn(async (request) => {
      harness?.trace.push("stripe_create")
      const metadata =
        request.canonical_request?.metadata ??
        {
          cart_id: request.cart_id,
          payment_attempt_id: request.payment_attempt_id,
          ...(request.payment_session_id
            ? { session_id: request.payment_session_id }
            : {}),
        }
      return {
        id: "pi_http_pix_mock",
        object: "payment_intent",
        status: "requires_action",
        amount: request.amount_minor,
        currency: request.currency_code,
        payment_method_types: ["pix"],
        client_secret: "pi_http_pix_mock_secret_test",
        metadata,
        next_action: {
          type: "pix_display_qr_code",
          pix_display_qr_code: {
            expires_at: 1782863999,
            data: "00020126580014BR.GOV.BCB.PIX0136http_pix_copy_paste_test",
            hosted_instructions_url: "https://payments.stripe.com/pix/http_mock",
            image_url_png: "https://payments.stripe.com/pix/http_mock.png",
          },
        },
        ...overrides,
      }
    }),
    discoverPaymentIntentsByPaymentAttemptId: jest.fn(async (paymentAttemptId: string) =>
      discoverPaymentIntentsByPaymentAttemptId(
        { create: jest.fn(), search },
        paymentAttemptId
      )
    ),
  }
}

function wireScope(
  req: SessionCapableRequest,
  options: {
    remoteQuery?: ReturnType<typeof createRemoteQueryResolver>
    paymentAttemptModule?: unknown
    medusaPaymentModule?: unknown
    workflowEngine?: unknown
    cartModule?: ReturnType<typeof createDefaultCartModuleForPayment>
    paymentAttemptModuleResolveError?: Error
    stripeCardInitiationLayerResolveError?: Error
    stripePixInitiationLayerResolveError?: Error
    stripeCardInitiationLayer?: StripeCardInitiationLayer | null
    stripePixInitiationLayer?: StripePixInitiationLayer | null
    harness?: PreProviderHttpHarness
  } = {}
) {
  const defaultMedusaPaymentState = createMedusaPaymentState()
  const remoteQuery =
    options.remoteQuery ??
    createRemoteQueryResolver({
      medusaPaymentState: defaultMedusaPaymentState,
    })
  const medusaPaymentState =
    (
      remoteQuery as typeof remoteQuery & {
        medusaPaymentState?: ReturnType<typeof createMedusaPaymentState>
      }
    ).medusaPaymentState ?? defaultMedusaPaymentState
  const carts =
    (
      remoteQuery as typeof remoteQuery & {
        carts?: Record<string, StoreCartPreOrderRecord & { total?: number | null }>
      }
    ).carts ?? {}
  const existingAttempts =
    (
      options.paymentAttemptModule as
        | { attempts?: PaymentAttemptRecord[] }
        | undefined
    )?.attempts ?? []
  const harness =
    options.harness ??
    (
      options.paymentAttemptModule as { harness?: PreProviderHttpHarness } | undefined
    )?.harness ??
    createPreProviderHttpHarness(existingAttempts)
  const cartModule =
    options.cartModule ?? createDefaultCartModuleForPayment(carts, harness)
  const paymentAttemptModule = (options.paymentAttemptModule ??
    createPaymentAttemptModuleMock([], {}, harness)) as ReturnType<
    typeof createPaymentAttemptModuleMock
  >
  const medusaPaymentModule = (options.medusaPaymentModule ??
    createMedusaPaymentModuleMock(medusaPaymentState)) as ReturnType<
    typeof createMedusaPaymentModuleMock
  >
  const workflowEngine = (options.workflowEngine ??
    createWorkflowEngineMock(medusaPaymentState)) as ReturnType<
    typeof createWorkflowEngineMock
  >
  const stripeCardInitiationLayer =
    options.stripeCardInitiationLayer === undefined
      ? createStripeCardInitiationLayerMock({}, harness)
      : options.stripeCardInitiationLayer
  const stripePixInitiationLayer =
    options.stripePixInitiationLayer === undefined
      ? createStripePixInitiationLayerMock({}, harness)
      : options.stripePixInitiationLayer

  req.scope.resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return remoteQuery
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      if (options.paymentAttemptModuleResolveError) {
        throw options.paymentAttemptModuleResolveError
      }

      return paymentAttemptModule
    }

    if (key === Modules.PAYMENT) {
      return medusaPaymentModule
    }

    if (key === Modules.WORKFLOW_ENGINE) {
      return workflowEngine
    }

    if (key === STRIPE_CARD_INITIATION_LAYER) {
      if (options.stripeCardInitiationLayerResolveError) {
        throw options.stripeCardInitiationLayerResolveError
      }

      return stripeCardInitiationLayer
    }

    if (key === STRIPE_PIX_INITIATION_LAYER) {
      if (options.stripePixInitiationLayerResolveError) {
        throw options.stripePixInitiationLayerResolveError
      }

      return stripePixInitiationLayer
    }

    if (key === Modules.CART) {
      return cartModule
    }

    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      return cartModule.pgConnection
    }

    return undefined
  }) as SessionCapableRequest["scope"]["resolve"]

  return {
    remoteQuery,
    paymentAttemptModule,
    medusaPaymentModule,
    workflowEngine,
    stripeCardInitiationLayer,
    stripePixInitiationLayer,
    cartModule,
    harness,
  }
}

function assertCardPaymentResponseBody(body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase()

  for (const forbidden of FORBIDDEN_RESPONSE_SUBSTRINGS) {
    expect(serialized).not.toContain(forbidden.toLowerCase())
  }

  expect(body).toEqual(
    expect.objectContaining({
      payment_attempt: expect.objectContaining({
        payment_method_type: "card",
        client_secret: expect.stringMatching(/_secret_/),
      }),
    })
  )

  const paymentAttempt = (body as { payment_attempt?: Record<string, unknown> })
    .payment_attempt

  expect(paymentAttempt).not.toHaveProperty("payment_session")
  expect(paymentAttempt).not.toHaveProperty("data")
  expect(Object.keys(paymentAttempt ?? {}).sort()).toEqual(
    [
      "amount",
      "client_secret",
      "currency_code",
      "payment_attempt_id",
      "payment_method_type",
      "provider_payment_intent_id",
      "status",
    ].sort()
  )
}

async function invokeCardPaymentRoute(req: SessionCapableRequest) {
  const res = createResponse()
  applyStoreCartPreOrderQueryConfig(req as never)
  await startCardPaymentAttemptRoute(req, res)
  return res
}

function assertPixPaymentResponseBody(body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase()

  for (const forbidden of FORBIDDEN_RESPONSE_SUBSTRINGS) {
    expect(serialized).not.toContain(forbidden.toLowerCase())
  }

  expect(body).toEqual(
    expect.objectContaining({
      payment_attempt: expect.objectContaining({
        payment_method_type: "pix",
        copy_paste: expect.stringContaining("00020126"),
        qr_code: expect.any(String),
        expires_at: expect.any(String),
      }),
    })
  )

  const paymentAttempt = (body as { payment_attempt?: Record<string, unknown> })
    .payment_attempt

  expect(paymentAttempt).not.toHaveProperty("payment_session")
  expect(paymentAttempt).not.toHaveProperty("data")
  expect(paymentAttempt).not.toHaveProperty("next_action")

  const allowedKeys = [
    "amount",
    "copy_paste",
    "currency_code",
    "expires_at",
    "hosted_instructions_url",
    "payment_attempt_id",
    "payment_method_type",
    "provider_payment_intent_id",
    "qr_code",
    "status",
    "client_secret",
  ]

  for (const key of Object.keys(paymentAttempt ?? {})) {
    expect(allowedKeys).toContain(key)
  }
}

async function invokePixPaymentRoute(req: SessionCapableRequest) {
  const res = createResponse()
  applyStoreCartPreOrderQueryConfig(req as never)
  await startPixPaymentAttemptRoute(req, res)
  return res
}

describe("payment attempt store card contract", () => {
  describe("card", () => {
    it("POST /store/carts/:id/payment-attempts/card inicia cartao em cart completo", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const fallbackLayer = createStripeCardInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        card: fallbackLayer,
      })
      const {
        medusaPaymentModule,
        workflowEngine,
        stripeCardInitiationLayer,
      } = wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      assertCardPaymentResponseBody(res.jsonSpy.mock.calls[0][0])
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(9900)
      expect(body.payment_attempt.currency_code).toBe("BRL")
      expect(body.payment_attempt.status).toBe("card_client_secret_created")
      expect(
        stripeCardInitiationLayer?.createCardPaymentIntent
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_minor: 9900,
          currency_code: "brl",
          cart_id: cart.id,
        })
      )
      expect(workflowEngine.run).toHaveBeenCalledWith(
        createPaymentCollectionForCartWorkflowId,
        {
          input: { cart_id: cart.id },
        }
      )
      expect(medusaPaymentModule.createPaymentSession).toHaveBeenCalledWith(
        "pay_col_http_01",
        expect.objectContaining({
          provider_id: "pp_stripe_deferred",
          amount: 99,
          currency_code: "brl",
          data: {},
        })
      )
      expect(medusaPaymentModule.updatePaymentSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payses_http_01",
          status: PaymentSessionStatus.PENDING,
          data: expect.objectContaining({
            id: "pi_http_card_mock",
            provider_payment_intent_id: "pi_http_card_mock",
            provider_payment_session_id: "payses_http_01",
          }),
        })
      )
      expect(paymentAttemptModule.createPaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_collection_id: "pay_col_http_01",
          payment_session_id: "payses_http_01",
          provider_payment_intent_id: null,
          provider_payment_session_id: null,
          status: "created",
          metadata: expect.objectContaining({
            payment_attempt_id: expect.any(String),
          }),
        })
      )
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_collection_id: "pay_col_http_01",
          payment_session_id: "payses_http_01",
          provider_payment_intent_id: "pi_http_card_mock",
          provider_payment_session_id: "payses_http_01",
          status: "card_client_secret_created",
        })
      )
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledTimes(1)
      expect(body.payment_attempt.client_secret).toContain("pi_http_card_mock")
      expect(
        paymentAttemptModule.resolveStripeCardInitiationLayer
      ).not.toHaveBeenCalled()
      expect(fallbackLayer.createCardPaymentIntent).not.toHaveBeenCalled()
    })

    it("POST card com cart.total 110 propaga S literal em PaymentSession major e Stripe minor", async () => {
      const cart = buildDecorativeGuestCart110()
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_110",
          active_cart_id: cart.id,
        },
      })
      const fallbackLayer = createStripeCardInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        card: fallbackLayer,
      })
      const {
        medusaPaymentModule,
        stripeCardInitiationLayer,
      } = wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(11000)
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_minor: 11000,
          currency_code: "brl",
          cart_id: cart.id,
        })
      )
      expect(medusaPaymentModule.createPaymentSession).toHaveBeenCalledWith(
        "pay_col_http_01",
        expect.objectContaining({
          amount: 110,
          currency_code: "brl",
        })
      )
      expect(paymentAttemptModule.attempts[0]?.amount).toBe(11000)
      expect(
        paymentAttemptModule.resolveStripeCardInitiationLayer
      ).not.toHaveBeenCalled()
      expect(fallbackLayer.createCardPaymentIntent).not.toHaveBeenCalled()
    })

    it("rejeita cart com total canonico ausente antes de chamar Stripe card", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_no_total_card",
        total: undefined,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_no_total",
          active_cart_id: cart.id,
        },
      })
      const {
        medusaPaymentModule,
        stripeCardInitiationLayer,
      } = wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
      expect(
        stripeCardInitiationLayer?.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(medusaPaymentModule.createPaymentSession).not.toHaveBeenCalled()
    })

    it("rejeita cart com total canonico nulo antes de chamar Stripe card", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_null_total_card",
        total: null,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_null_total",
          active_cart_id: cart.id,
        },
      })
      const {
        medusaPaymentModule,
        stripeCardInitiationLayer,
      } = wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
      expect(
        stripeCardInitiationLayer?.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(medusaPaymentModule.createPaymentSession).not.toHaveBeenCalled()
    })

    it("mantem a identidade local e converge no mesmo PaymentIntent após falha do finalize", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.updatePaymentAttempts.mockRejectedValueOnce(
        new Error("finalize write failed")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { medusaPaymentModule, stripeCardInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        "Falha ao finalizar tentativa de pagamento."
      )

      const provisional = paymentAttemptModule.attempts[0]
      expect(provisional).toEqual(
        expect.objectContaining({
          status: "created",
          provider_payment_intent_id: null,
        })
      )
      expect(provisional?.metadata).toEqual(
        expect.objectContaining({
          payment_attempt_id: provisional?.id,
        })
      )

      const firstProviderCall = stripeCardInitiationLayer?.createCardPaymentIntent as
        | jest.Mock
        | undefined
      expect(firstProviderCall).toHaveBeenCalledTimes(1)

      const retryResponse = await invokeCardPaymentRoute(req)

      expect(retryResponse.statusCode).toBe(201)
      expect(paymentAttemptModule.attempts).toHaveLength(1)
      expect(firstProviderCall).toHaveBeenCalledTimes(2)
      const providerResults = await Promise.all(
        firstProviderCall?.mock.results.map((result) => result.value) ?? []
      )
      expect(new Set(providerResults.map((result) => result.id)).size).toBe(1)
      expect(firstProviderCall?.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          idempotency_key: firstProviderCall?.mock.calls[0]?.[0].idempotency_key,
          payment_attempt_id: provisional?.id,
        })
      )
      expect(medusaPaymentModule.createPaymentSession).toHaveBeenCalledTimes(1)
      expect(paymentAttemptModule.attempts[0]).toEqual(
        expect.objectContaining({
          status: "card_client_secret_created",
          provider_payment_intent_id: "pi_http_card_mock",
        })
      )
    })

    it("mantem a identidade local quando a atualizacao da PaymentSession falha", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { medusaPaymentModule, stripeCardInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })
      medusaPaymentModule.updatePaymentSessions.mockRejectedValueOnce(
        new Error("payment session finalize failed")
      )

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        "Falha ao finalizar tentativa de pagamento."
      )

      const provisional = paymentAttemptModule.attempts[0]
      expect(provisional).toEqual(
        expect.objectContaining({
          status: "card_client_secret_created",
          provider_payment_intent_id: "pi_http_card_mock",
        })
      )
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).toHaveBeenCalledTimes(1)

      const retryResponse = await invokeCardPaymentRoute(req)

      expect(retryResponse.statusCode).toBe(201)
      expect(paymentAttemptModule.attempts).toHaveLength(1)
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).toHaveBeenCalledTimes(2)
      expect(medusaPaymentModule.createPaymentSession).toHaveBeenCalledTimes(1)
      expect(paymentAttemptModule.attempts[0]?.provider_payment_intent_id).toBe(
        "pi_http_card_mock"
      )
    })

    it("usa uma unica vez o fallback assincrono do servico para cartao", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const fallbackLayer = createStripeCardInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        card: fallbackLayer,
      })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripeCardInitiationLayerResolveError: new Error("direct token missing"),
      })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(
        paymentAttemptModule.resolveStripeCardInitiationLayer
      ).toHaveBeenCalledTimes(1)
      expect(fallbackLayer.createCardPaymentIntent).toHaveBeenCalledTimes(1)
    })

    it("converte rejeicao do resolver de cartao em camada ausente", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.resolveStripeCardInitiationLayer.mockRejectedValueOnce(
        new Error("resolver failed")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripeCardInitiationLayerResolveError: new Error("direct token missing"),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para cartao nao configurada."
      )
      expect(
        paymentAttemptModule.resolveStripeCardInitiationLayer
      ).toHaveBeenCalledTimes(1)
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
    })

    it("falha fechada quando camada Stripe card nao esta configurada", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer: null,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para cartao nao configurada."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao esta disponivel antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer,
        paymentAttemptModuleResolveError: new Error(
          "payment attempt missing pi_http_card_mock_secret_test"
        ),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao expoe listPaymentAttempts antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripeCardInitiationLayer,
        paymentAttemptModule: {
          createPaymentAttempts: jest.fn(),
          updatePaymentAttempts: jest.fn(),
        },
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando listPaymentAttempts falha antes de chamar Stripe", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      const stripeCardInitiationLayer = createStripeCardInitiationLayerMock()
      paymentAttemptModule.listPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_card_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripeCardInitiationLayer,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(paymentAttemptModule.listPaymentAttempts).toHaveBeenCalledWith({
        cart_id: cart.id,
      })
      expect(
        stripeCardInitiationLayer.createCardPaymentIntent
      ).not.toHaveBeenCalled()
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao pode ser persistido", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.createPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_card_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startCardPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao registrar tentativa de pagamento."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("rejeita cart incompleto", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: null,
        total: 99,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita guest sem posse do cart via sessionActiveCartId", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: "cart_other",
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita body com campos monetarios", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        body: { amount: 100 },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        getPaymentStartRejectedBodyMessage()
      )
    })

    it("nao retorna Order nem PaymentSession.data bruto", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokeCardPaymentRoute(req)
      const serialized = JSON.stringify(res.jsonSpy.mock.calls[0][0])

      expect(serialized).not.toMatch(/completeCartWorkflow/)
      expect(serialized).not.toContain("WebhookEventLog")
      expect(serialized).not.toContain("CheckoutCompletionLog")
      expect(serialized).not.toContain("purchase_completed")
      expect(serialized).not.toContain("gelato")
    })

    it("registra middleware Store API para rota card", () => {
      const cardRoute = defaultMiddlewares.routes?.find(
        (route) => route.matcher === "/store/carts/:id/payment-attempts/card"
      )

      expect(cardRoute).toBeDefined()
      expect(cardRoute?.methods ?? cardRoute?.method).toEqual(
        expect.arrayContaining(["POST"])
      )
    })
  })

  describe("pix", () => {
    it("POST /store/carts/:id/payment-attempts/pix inicia Pix em cart completo", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const fallbackLayer = createStripePixInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        pix: fallbackLayer,
      })
      const {
        medusaPaymentModule,
        workflowEngine,
        stripePixInitiationLayer,
      } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      assertPixPaymentResponseBody(res.jsonSpy.mock.calls[0][0])
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(9900)
      expect(body.payment_attempt.currency_code).toBe("BRL")
      expect(body.payment_attempt.status).toBe("awaiting_pix_payment")
      expect(workflowEngine.run).toHaveBeenCalledWith(
        createPaymentCollectionForCartWorkflowId,
        {
          input: { cart_id: cart.id },
        }
      )
      expect(medusaPaymentModule.createPaymentSession).not.toHaveBeenCalled()
      const medusaCollection = (
        remoteQuery as {
          medusaPaymentState?: {
            cartPaymentCollections: Record<string, { id: string }>
          }
        }
      ).medusaPaymentState?.cartPaymentCollections[cart.id]
      expect(medusaCollection?.id).toEqual(expect.any(String))
      expect(medusaCollection?.id).not.toMatch(/^paycol_[0-9a-f]{16}$/)
      expect(paymentAttemptModule.createPaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_collection_id: medusaCollection?.id,
          payment_session_id: null,
        })
      )
      expect(paymentAttemptModule.attempts[0]?.payment_collection_id).toBe(
        medusaCollection?.id
      )
      const pixCreateRequest = (
        stripePixInitiationLayer?.createPixPaymentIntent as jest.Mock | undefined
      )?.mock.calls[0]?.[0]
      expect(pixCreateRequest.canonical_request.metadata.session_id).toBeUndefined()
      expect(pixCreateRequest.canonical_request.metadata).not.toHaveProperty(
        "correlation_id"
      )
      expect(stripePixInitiationLayer?.createPixPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_minor: 9900,
          currency_code: "brl",
          cart_id: cart.id,
        })
      )
      expect(body.payment_attempt.expires_at).toBe(
        new Date(1782863999 * 1000).toISOString()
      )
      expect(
        paymentAttemptModule.resolveStripePixInitiationLayer
      ).not.toHaveBeenCalled()
      expect(fallbackLayer.createPixPaymentIntent).not.toHaveBeenCalled()
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledTimes(1)
    })

    it("POST pix com cart.total 110 propaga S literal em PaymentAttempt minor e Stripe minor", async () => {
      const cart = buildDecorativeGuestCart110({ id: "cart_guest_pix_110" })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_pix_110",
          active_cart_id: cart.id,
        },
      })
      const fallbackLayer = createStripePixInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        pix: fallbackLayer,
      })
      const {
        medusaPaymentModule,
        stripePixInitiationLayer,
      } = wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      const body = res.jsonSpy.mock.calls[0][0]
      expect(body.payment_attempt.amount).toBe(11000)
      expect(stripePixInitiationLayer?.createPixPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_minor: 11000,
          currency_code: "brl",
          cart_id: cart.id,
        })
      )
      expect(medusaPaymentModule.createPaymentSession).not.toHaveBeenCalled()
      expect(paymentAttemptModule.attempts[0]?.amount).toBe(11000)
      expect(
        paymentAttemptModule.resolveStripePixInitiationLayer
      ).not.toHaveBeenCalled()
      expect(fallbackLayer.createPixPaymentIntent).not.toHaveBeenCalled()
    })

    it("rejeita cart com total canonico ausente antes de chamar Stripe Pix", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_no_total_pix",
        total: undefined,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_no_total_pix",
          active_cart_id: cart.id,
        },
      })
      const { stripePixInitiationLayer } = wireScope(req, { remoteQuery })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(MedusaError)
      expect(
        stripePixInitiationLayer?.createPixPaymentIntent
      ).not.toHaveBeenCalled()
    })

    it("mantem a identidade local e converge no mesmo PaymentIntent Pix após falha do finalize", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.updatePaymentAttempts.mockRejectedValueOnce(
        new Error("finalize write failed")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { stripePixInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(
        "Falha ao finalizar tentativa de pagamento."
      )

      const provisional = paymentAttemptModule.attempts[0]
      expect(provisional).toEqual(
        expect.objectContaining({
          status: "created",
          provider_payment_intent_id: null,
        })
      )
      const providerCall = stripePixInitiationLayer?.createPixPaymentIntent as
        | jest.Mock
        | undefined
      expect(providerCall).toHaveBeenCalledTimes(1)

      const retryResponse = await invokePixPaymentRoute(req)

      expect(retryResponse.statusCode).toBe(201)
      expect(paymentAttemptModule.attempts).toHaveLength(1)
      expect(providerCall).toHaveBeenCalledTimes(2)
      const providerResults = await Promise.all(
        providerCall?.mock.results.map((result) => result.value) ?? []
      )
      expect(new Set(providerResults.map((result) => result.id)).size).toBe(1)
      expect(providerCall?.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          idempotency_key: providerCall?.mock.calls[0]?.[0].idempotency_key,
          payment_attempt_id: provisional?.id,
        })
      )
      expect(paymentAttemptModule.attempts[0]).toEqual(
        expect.objectContaining({
          status: "awaiting_pix_payment",
          provider_payment_intent_id: "pi_http_pix_mock",
        })
      )
    })

    it("usa uma unica vez o fallback assincrono do servico para Pix", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const fallbackLayer = createStripePixInitiationLayerMock()
      const paymentAttemptModule = createPaymentAttemptModuleMock([], {
        pix: fallbackLayer,
      })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripePixInitiationLayerResolveError: new Error("direct token missing"),
      })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(
        paymentAttemptModule.resolveStripePixInitiationLayer
      ).toHaveBeenCalledTimes(1)
      expect(fallbackLayer.createPixPaymentIntent).toHaveBeenCalledTimes(1)
    })

    it("converte rejeicao do resolver Pix em camada ausente", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.resolveStripePixInitiationLayer.mockRejectedValueOnce(
        new Error("resolver failed")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
        stripePixInitiationLayerResolveError: new Error("direct token missing"),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para Pix nao configurada."
      )
      expect(
        paymentAttemptModule.resolveStripePixInitiationLayer
      ).toHaveBeenCalledTimes(1)
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
    })

    it("falha fechada quando camada Stripe Pix nao esta configurada", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripePixInitiationLayer: null,
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Camada Stripe para Pix nao configurada."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao esta disponivel antes de chamar Stripe Pix", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const stripePixInitiationLayer = createStripePixInitiationLayerMock()
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, {
        remoteQuery,
        stripePixInitiationLayer,
        paymentAttemptModuleResolveError: new Error(
          "payment attempt missing pi_http_pix_mock_secret_test"
        ),
      })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao consultar tentativas de pagamento."
      )
      expect(
        stripePixInitiationLayer.createPixPaymentIntent
      ).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("falha fechada quando PaymentAttempt nao pode ser persistido", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.createPaymentAttempts.mockRejectedValueOnce(
        new Error("db failed pi_http_pix_mock_secret_test")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      const res = createResponse()
      wireScope(req, { remoteQuery, paymentAttemptModule })
      applyStoreCartPreOrderQueryConfig(req as never)

      await expect(startPixPaymentAttemptRoute(req, res)).rejects.toThrow(
        "Falha ao registrar tentativa de pagamento."
      )
      expect(res.status).not.toHaveBeenCalledWith(201)
      expect(res.json).not.toHaveBeenCalled()
    })

    it("rejeita cart incompleto", async () => {
      const cart = buildCompleteGuestCart({
        id: "cart_guest_01",
        email: null,
        total: 99,
      })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(MedusaError)
    })

    it("rejeita body com campos monetarios", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        body: { currency_code: "USD" },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(
        getPaymentStartRejectedBodyMessage()
      )
    })

    it("nao retorna Order nem PaymentSession.data bruto", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: {
          id: "sess_guest_01",
          active_cart_id: cart.id,
        },
      })
      wireScope(req, { remoteQuery })

      const res = await invokePixPaymentRoute(req)
      const serialized = JSON.stringify(res.jsonSpy.mock.calls[0][0])

      expect(serialized).not.toMatch(/completeCartWorkflow/)
      expect(serialized).not.toContain("WebhookEventLog")
      expect(serialized).not.toContain("CheckoutCompletionLog")
      expect(serialized).not.toContain("purchase_completed")
      expect(serialized).not.toContain("gelato")
      expect(serialized).not.toContain("next_action")
    })

    it("registra middleware Store API para rota pix", () => {
      const pixRoute = defaultMiddlewares.routes?.find(
        (route) => route.matcher === "/store/carts/:id/payment-attempts/pix"
      )

      expect(pixRoute).toBeDefined()
      expect(pixRoute?.methods ?? pixRoute?.method).toEqual(
        expect.arrayContaining(["POST"])
      )
    })
  })

  describe("retry supersede and invalidated_by_cart_change", () => {
    it("retry card->card supersede mantem uma tentativa ativa por cart", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_card_old",
        payment_method_type: "card",
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_card_old",
          status: "superseded",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, cart.id)).toBe(1)
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active[0]?.payment_method_type).toBe("card")
      expect(active[0]?.order_id).toBeNull()
    })

    it("retry pix->pix supersede mantem uma tentativa ativa por cart", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_pix_old",
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_pix_old",
          status: "superseded",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, cart.id)).toBe(1)
    })

    it("troca card->pix supersede tentativa ativa anterior", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_card_old",
        payment_method_type: "card",
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ status: "superseded" })
      )
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active).toHaveLength(1)
      expect(active[0]?.payment_method_type).toBe("pix")
    })

    it("troca pix->card supersede tentativa ativa anterior", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const existing = buildExistingAttemptForCart(cart, {
        id: "payatt_pix_old",
        payment_method_type: "pix",
        status: "awaiting_pix_payment",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ status: "superseded" })
      )
      const active = findActiveAttemptsForCart(
        paymentAttemptModule.attempts,
        cart.id
      )
      expect(active).toHaveLength(1)
      expect(active[0]?.payment_method_type).toBe("card")
    })

    it("mutacao de email invalida tentativa stale antes de nova iniciacao card", async () => {
      const originalCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 99,
        email: "original@exemplo.com",
      })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 99,
        email: "novo@exemplo.com",
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "awaiting_pix_payment",
        payment_method_type: "pix",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale",
          status: "invalidated_by_cart_change",
        })
      )
      expect(countActiveAttempts(paymentAttemptModule.attempts, mutatedCart.id)).toBe(1)
    })

    it("mutacao de quantidade invalida tentativa stale antes de nova iniciacao pix", async () => {
      const originalCart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 19800,
        items: [
          {
            ...originalCart.items![0],
            quantity: 2,
          },
        ],
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale_qty",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "awaiting_pix_payment",
        payment_method_type: "pix",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale_qty",
          status: "invalidated_by_cart_change",
        })
      )
    })

    it("mutacao de shipping address invalida tentativa stale", async () => {
      const originalCart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const mutatedCart = buildCompleteGuestCart({
        id: "cart_guest_01",
        total: 99,
        shipping_address: {
          ...originalCart.shipping_address!,
          address_1: "Av Paulista, 1000",
          postal_code: "01310100",
        },
      })
      const staleFingerprint =
        resolvePaymentAttemptCartFingerprintFromStoreCart(originalCart)
      const existing = buildExistingAttemptForCart(originalCart, {
        id: "payatt_stale_ship",
        metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
        status: "card_client_secret_created",
      })
      const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
      const remoteQuery = createRemoteQueryResolver({
        carts: { [mutatedCart.id]: mutatedCart },
      })
      const req = createRequest({
        params: { id: mutatedCart.id },
        session: { id: "sess_guest_01", active_cart_id: mutatedCart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokeCardPaymentRoute(req)

      expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payatt_stale_ship",
          status: "invalidated_by_cart_change",
        })
      )
    })
  })

  describe("phase 04 final negative proofs", () => {
    it("respostas card/pix nao retornam Order, webhook, completion ou Gelato", async () => {
      const cardCart = buildCompleteGuestCart({ id: "cart_guest_card_final", total: 99 })
      const pixCart = buildCompleteGuestCart({ id: "cart_guest_pix_final", total: 99 })
      const cardReq = createRequest({
        params: { id: cardCart.id },
        session: { id: "sess_guest_01", active_cart_id: cardCart.id },
      })
      const pixReq = createRequest({
        params: { id: pixCart.id },
        session: { id: "sess_guest_01", active_cart_id: pixCart.id },
      })
      wireScope(cardReq, {
        remoteQuery: createRemoteQueryResolver({ carts: { [cardCart.id]: cardCart } }),
      })
      wireScope(pixReq, {
        remoteQuery: createRemoteQueryResolver({ carts: { [pixCart.id]: pixCart } }),
      })

      const cardRes = await invokeCardPaymentRoute(cardReq)
      const pixRes = await invokePixPaymentRoute(pixReq)
      const combined = JSON.stringify([
        cardRes.jsonSpy.mock.calls[0][0],
        pixRes.jsonSpy.mock.calls[0][0],
      ]).toLowerCase()

      for (const forbidden of FORBIDDEN_PRODUCTION_SUBSTRINGS) {
        if (forbidden === "/store/carts/") {
          continue
        }
        expect(combined).not.toContain(forbidden.toLowerCase())
      }

      expect(combined).not.toMatch(/"order"/)
      expect(combined).not.toContain("order_id")
    })

    it("nao persiste client_secret, QR integral ou next_action na trilha PaymentAttempt", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      wireScope(req, { remoteQuery, paymentAttemptModule })

      await invokePixPaymentRoute(req)

      const persisted = paymentAttemptModule.attempts[0]
      const serialized = JSON.stringify(persisted).toLowerCase()

      expect(serialized).not.toContain("client_secret")
      expect(serialized).not.toContain("next_action")
      expect(serialized).not.toContain("00020126")
      expect(persisted?.metadata?.[PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY]).toEqual(
        expect.any(String)
      )
      expect(persisted?.order_id).toBeNull()
    })

    it("estados Pix locais nao criam Order na resposta HTTP", async () => {
      const terminalStatuses = [
        "awaiting_pix_payment",
        "pix_expired",
        "payment_failed",
        "payment_canceled",
      ] as const

      for (const status of terminalStatuses) {
        const cart = buildCompleteGuestCart({ id: `cart_${status}`, total: 99 })
        const existing = buildExistingAttemptForCart(cart, {
          id: `payatt_${status}`,
          status,
          payment_method_type: "pix",
        })
        const paymentAttemptModule = createPaymentAttemptModuleMock([existing])
        const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
        const req = createRequest({
          params: { id: cart.id },
          session: { id: "sess_guest_01", active_cart_id: cart.id },
        })
        wireScope(req, { remoteQuery, paymentAttemptModule })

        const res = await invokePixPaymentRoute(req)
        const body = res.jsonSpy.mock.calls[0][0]

        expect(body.payment_attempt.order_id).toBeUndefined()
        expect(JSON.stringify(body)).not.toContain('"order"')
      }
    })
  })

  describe("pre-provider authority R1", () => {
    const cardRouteSource = readFileSync(
      join(
        __dirname,
        "../../src/api/store/carts/[id]/payment-attempts/card/route.ts"
      ),
      "utf8"
    )
    const pixRouteSource = readFileSync(
      join(
        __dirname,
        "../../src/api/store/carts/[id]/payment-attempts/pix/route.ts"
      ),
      "utf8"
    )

    function seedFrozenAttempt(
      cart: StoreCartPreOrderRecord & { total?: number | null },
      overrides: Partial<PaymentAttemptRecord> = {}
    ): PaymentAttemptRecord {
      const id = overrides.id ?? "payatt_frozen_01"
      const method = overrides.payment_method_type ?? "card"
      const amount = overrides.amount ?? 9900
      const fingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)
      const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
        payment_method_type: method,
        amount_minor: amount,
        cart_id: cart.id,
        cart_resource_version: 1,
        payment_attempt_id: id,
        payment_collection_id: "paycol_frozen",
        payment_session_id: method === "pix" ? null : "payses_frozen",
        authority_created_at: HTTP_DB_NOW,
        replay_deadline: replayDeadlineFromDbNow(HTTP_DB_NOW),
      })
      const { metadata: overrideMetadata, ...restOverrides } = overrides
      return buildExistingAttemptForCart(cart, {
        id,
        payment_collection_id: "paycol_frozen",
        payment_session_id: method === "pix" ? null : "payses_frozen",
        provider_payment_intent_id: null,
        status: "created",
        amount,
        payment_method_type: method,
        financial_freeze_started_at: HTTP_DB_NOW,
        provider_canceled_confirmed_at: null,
        metadata: {
          ...withPaymentAttemptCartFingerprintMetadata(null, fingerprint),
          cart_resource_version: 1,
          provider_idempotency_key: `payment-attempt:${method}:${id}`,
          payment_attempt_id: id,
          stripe_payment_intent_create: v1,
          ...(overrideMetadata ?? {}),
        },
        ...restOverrides,
      })
    }

    it("card ordered trace commits authority before stripe_create", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_01", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { harness } = wireScope(req, { remoteQuery })

      const res = await invokeCardPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(harness.trace).toEqual([
        "authority_tx_commit",
        "durable_reread",
        "stripe_create",
        "provider_bind",
      ])
    })

    it("pix ordered trace commits authority before stripe_create", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_guest_pix_trace", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { harness } = wireScope(req, { remoteQuery })

      const res = await invokePixPaymentRoute(req)

      expect(res.statusCode).toBe(201)
      expect(harness.trace).toEqual([
        "authority_tx_commit",
        "durable_reread",
        "stripe_create",
        "provider_bind",
      ])
    })

    it("missing CRV fails closed with Stripe 0 for card and pix", async () => {
      for (const invoke of [invokeCardPaymentRoute, invokePixPaymentRoute]) {
        const cart = buildCompleteGuestCart({
          id: `cart_missing_crv_${invoke === invokeCardPaymentRoute ? "card" : "pix"}`,
          total: 99,
        })
        const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
        const req = createRequest({
          params: { id: cart.id },
          session: { id: "sess_guest_01", active_cart_id: cart.id },
        })
        const harness = createPreProviderHttpHarness()
        harness.defaultCartResourceVersion = null
        const {
          stripeCardInitiationLayer,
          stripePixInitiationLayer,
          paymentAttemptModule,
        } = wireScope(req, { remoteQuery, harness })

        await expect(invoke(req)).rejects.toThrow(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)
        expect(stripeCardInitiationLayer?.createCardPaymentIntent).not.toHaveBeenCalled()
        expect(stripePixInitiationLayer?.createPixPaymentIntent).not.toHaveBeenCalled()
        expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
      }
    })

    it("invalid S / eligibility failure keeps Stripe 0", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_invalid_s", total: null })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { stripeCardInitiationLayer } = wireScope(req, { remoteQuery })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(MedusaError)
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).not.toHaveBeenCalled()
    })

    it("conflicting frozen different S fails closed with Stripe 0 and new PA 0", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_conflict_s", total: 99 })
      const frozen = seedFrozenAttempt(cart, { amount: 8800, id: "payatt_conflict_s" })
      const paymentAttemptModule = createPaymentAttemptModuleMock([frozen])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { stripeCardInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        RECONCILIATION_REASON_CODE.PROVIDER_REQUEST_AUTHORITY_MISMATCH
      )
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).not.toHaveBeenCalled()
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
      expect(paymentAttemptModule.attempts).toHaveLength(1)
    })

    it("multiple frozen fails closed with Stripe 0", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_multi_frozen", total: 99 })
      const first = seedFrozenAttempt(cart, { id: "payatt_frozen_a" })
      const second = seedFrozenAttempt(cart, { id: "payatt_frozen_b" })
      const paymentAttemptModule = createPaymentAttemptModuleMock([first, second])
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { stripePixInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      await expect(invokePixPaymentRoute(req)).rejects.toThrow(
        RECONCILIATION_REASON_CODE.MULTIPLE_FROZEN_PAYMENT_ATTEMPTS
      )
      expect(stripePixInitiationLayer?.createPixPaymentIntent).not.toHaveBeenCalled()
      expect(paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
    })

    it("FIN-02 card amount 9900 for cart.total 99 and PaymentSession amount 99", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_fin02", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { medusaPaymentModule, stripeCardInitiationLayer, paymentAttemptModule } =
        wireScope(req, { remoteQuery })

      const res = await invokeCardPaymentRoute(req)
      const body = res.jsonSpy.mock.calls[0][0]

      expect(body.payment_attempt.amount).toBe(9900)
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amount_minor: 9900 })
      )
      expect(medusaPaymentModule.createPaymentSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ amount: 99, currency_code: "brl" })
      )
      expect(paymentAttemptModule.attempts[0]?.amount).toBe(9900)
    })

    it("crash after Stripe then retry reuses the same PaymentAttempt and idempotency key", async () => {
      const cart = buildCompleteGuestCart({ id: "cart_crash_retry", total: 99 })
      const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })
      const paymentAttemptModule = createPaymentAttemptModuleMock()
      paymentAttemptModule.updatePaymentAttempts.mockRejectedValueOnce(
        new Error("finalize write failed")
      )
      const req = createRequest({
        params: { id: cart.id },
        session: { id: "sess_guest_01", active_cart_id: cart.id },
      })
      const { stripeCardInitiationLayer } = wireScope(req, {
        remoteQuery,
        paymentAttemptModule,
      })

      await expect(invokeCardPaymentRoute(req)).rejects.toThrow(
        "Falha ao finalizar tentativa de pagamento."
      )

      const retry = await invokeCardPaymentRoute(req)
      expect(retry.statusCode).toBe(201)
      expect(paymentAttemptModule.attempts).toHaveLength(1)
      expect(stripeCardInitiationLayer?.createCardPaymentIntent).toHaveBeenCalledTimes(2)
      const firstKey = (stripeCardInitiationLayer?.createCardPaymentIntent as jest.Mock)
        .mock.calls[0][0].idempotency_key
      const secondKey = (stripeCardInitiationLayer?.createCardPaymentIntent as jest.Mock)
        .mock.calls[1][0].idempotency_key
      expect(secondKey).toBe(firstKey)
      expect(secondKey).toMatch(/^payment-attempt:card:/)
    })

    it("D1 D2 D4 discovery ownership matrix for card and pix", async () => {
      for (const [method, invoke] of [
        ["card", invokeCardPaymentRoute],
        ["pix", invokePixPaymentRoute],
      ] as const) {
        const cart = buildCompleteGuestCart({
          id: `cart_discovery_${method}`,
          total: 99,
        })
        const frozen = seedFrozenAttempt(cart, {
          id: `payatt_discovery_${method}`,
          payment_method_type: method,
        })
        const remoteQuery = createRemoteQueryResolver({ carts: { [cart.id]: cart } })

        const reqD1 = createRequest({
          params: { id: cart.id },
          session: { id: "sess_guest_01", active_cart_id: cart.id },
        })
        const d1 = wireScope(reqD1, {
          remoteQuery,
          paymentAttemptModule: createPaymentAttemptModuleMock([frozen]),
        })
        const d1Search =
          method === "card" ? d1.stripeCardInitiationLayer?.search : d1.stripePixInitiationLayer?.search
        d1Search?.mockResolvedValueOnce({
          data: [
            {
              id: `pi_discovery_${method}`,
              amount: 9900,
              currency: "brl",
              status: method === "card" ? "requires_payment_method" : "requires_action",
              payment_method_types: [method],
              ...(method === "card"
                ? { client_secret: `pi_discovery_${method}_secret_test` }
                : {
                    next_action: {
                      type: "pix_display_qr_code",
                      pix_display_qr_code: {
                        expires_at: 1782863999,
                        data: "00020126580014BR.GOV.BCB.PIX0136http_pix_copy_paste_test",
                        hosted_instructions_url:
                          "https://payments.stripe.com/pix/http_mock",
                        image_url_png:
                          "https://payments.stripe.com/pix/http_mock.png",
                      },
                    },
                  }),
              metadata: {
                payment_attempt_id: frozen.id,
                cart_id: cart.id,
                ...(method === "card" ? { session_id: "payses_frozen" } : {}),
              },
            },
          ],
          has_more: false,
          next_page: null,
        })
        const d1Res = await invoke(reqD1)
        expect(d1Res.statusCode).toBe(201)
        expect(d1Search).toHaveBeenCalledTimes(1)
        expect(d1.paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()

        const reqD2 = createRequest({
          params: { id: cart.id },
          session: { id: "sess_guest_01", active_cart_id: cart.id },
        })
        const frozenDiscoveryStarted = {
          ...frozen,
          provider_discovery_started_at: HTTP_DB_NOW,
        }
        const d2 = wireScope(reqD2, {
          remoteQuery,
          paymentAttemptModule: createPaymentAttemptModuleMock([
            frozenDiscoveryStarted,
          ]),
        })
        const d2Search =
          method === "card" ? d2.stripeCardInitiationLayer?.search : d2.stripePixInitiationLayer?.search
        const d2Create =
          method === "card"
            ? d2.stripeCardInitiationLayer?.createCardPaymentIntent
            : d2.stripePixInitiationLayer?.createPixPaymentIntent
        await expect(invoke(reqD2)).rejects.toThrow(
          RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
        )
        expect(d2Search).not.toHaveBeenCalled()
        expect(d2Create).not.toHaveBeenCalled()
        expect(d2.paymentAttemptModule.createPaymentAttempts).not.toHaveBeenCalled()
      }
    })

    it("structural card and pix HTTP paths persist freeze and reread before Stripe create", () => {
      for (const [source, stripeResolver] of [
        [cardRouteSource, "resolveCardPaymentIntentAfterAuthority"],
        [pixRouteSource, "resolvePixPaymentIntentAfterAuthority"],
      ] as const) {
        const postSource = source.slice(source.indexOf("export async function POST"))
        const persistAt = postSource.indexOf("persistPreProviderFinancialFreezeInTransaction")
        const rereadAt = postSource.indexOf("readDurablePreProviderAuthority")
        const stripeAt = postSource.indexOf(stripeResolver)
        const bindAt = postSource.indexOf("bindProviderPaymentIntentInTransaction")
        expect(persistAt).toBeGreaterThan(-1)
        expect(rereadAt).toBeGreaterThan(persistAt)
        expect(stripeAt).toBeGreaterThan(rereadAt)
        expect(bindAt).toBeGreaterThan(stripeAt)
        expect(source).not.toMatch(/catch\s*\{[\s\S]{0,80}return null/)
      }
    })
  })
})
