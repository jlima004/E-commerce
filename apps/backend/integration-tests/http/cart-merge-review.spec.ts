import { readFileSync } from "fs"
import { resolve } from "path"
import defaultMiddlewares from "../../src/api/middlewares"
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
import { POST as attachCart } from "../../src/api/store/customers/me/cart/attach/route"
import { POST as acknowledgeCartReview } from "../../src/api/store/carts/[id]/review/acknowledge/route"
import {
  addToCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import {
  CART_MERGE_MODULE,
  CartMergeModuleService,
} from "../../src/modules/cart-merge"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
} from "../../src/modules/guest-cart-capability/types"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_CART_MERGE,
} from "../../src/modules/store-idempotency"
import {
  buildStoreIdempotencyRequestFingerprint,
  fingerprintsMatch,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
} from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { env } from "../../src/config/env"
import { hashGuestCartCapability } from "../../src/modules/guest-cart-capability/hash"
import {
  MedusaAppLoader,
  container as medusaContainer,
} from "@medusajs/framework"
import { asValue } from "@medusajs/framework/awilix"
import { configManager } from "@medusajs/framework/config"
import {
  ContainerRegistrationKeys,
  createMedusaContainer,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { MedusaModule, ModulesDefinition } from "@medusajs/modules-sdk"
import {
  STORE_ERROR_CODES,
  toStoreErrorResponse,
} from "../../src/api/store-surface/errors"
import {
  isAttachNewContractPresent,
  parseCartMergeBody,
  parseCartMergeCustomerId,
  parseCartMergePresentedHeaders,
} from "../../src/api/store/carts/merge-review-validators"
import * as Sentry from "@sentry/node"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import {
  assertPublicIdentifiersDoNotEncodeSecrets,
  assertPublicSurfaceDoesNotEncodeSecrets,
  createGuestCartLeakageCollector,
  PHASE16_CUSTOMER_JWT_CANARY,
  PHASE16_GUEST_CAPABILITY_CANARY,
  PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
  readStoreOpenApiDocumentForLeakageScan,
  unusedSinkEvidence,
} from "../helpers/guest-cart-leakage"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
}))

jest.mock("../../src/api/store/carts/merge-review-validators", () => {
  const actual = jest.requireActual<
    typeof import("../../src/api/store/carts/merge-review-validators")
  >("../../src/api/store/carts/merge-review-validators")
  return {
    ...actual,
    parseCartMergeCustomerId: jest.fn(actual.parseCartMergeCustomerId),
    parseCartMergeBody: jest.fn(actual.parseCartMergeBody),
    parseCartMergePresentedHeaders: jest.fn(actual.parseCartMergePresentedHeaders),
    isAttachNewContractPresent: jest.fn(actual.isAttachNewContractPresent),
  }
})

type MedusaConfigModule = {
  modules: Record<string, unknown>
  [key: string]: unknown
}

type BootstrappedCartMerge = {
  container: typeof medusaContainer
  dispose: () => Promise<void>
  logEntries: unknown[]
}

function loadTracerConfig(includeCartMerge: boolean): MedusaConfigModule {
  const config = require("../../medusa-config") as MedusaConfigModule
  const cartMergeModule = config.modules[CART_MERGE_MODULE] as
    | Record<string, unknown>
    | undefined
  if (!cartMergeModule || cartMergeModule.resolve !== "./src/modules/cart-merge") {
    throw new Error("CART_MERGE_CONFIG_REGISTRATION_UNAVAILABLE")
  }

  const isolatedModules = Object.fromEntries(
    Object.keys(ModulesDefinition).map((key) => [key, false])
  ) as Record<string, unknown>
  isolatedModules[CART_MERGE_MODULE] = includeCartMerge
    ? cartMergeModule
    : false

  return { ...config, modules: isolatedModules }
}

async function bootstrapCartMergeContainer(
  includeCartMerge = true
): Promise<BootstrappedCartMerge> {
  const container = medusaContainer
  const tracerConfig = loadTracerConfig(includeCartMerge)
  configManager.loadConfig({
    projectConfig: tracerConfig,
    baseDir: process.cwd(),
  })
  const logEntries: unknown[] = []
  const logger = {
    debug: (...args: unknown[]) => {
      logEntries.push({ level: "debug", args })
    },
    info: (...args: unknown[]) => {
      logEntries.push({ level: "info", args })
    },
    log: (...args: unknown[]) => {
      logEntries.push({ level: "log", args })
    },
    warn: (...args: unknown[]) => {
      logEntries.push({ level: "warn", args })
    },
    error: (...args: unknown[]) => {
      logEntries.push({ level: "error", args })
    },
  }
  container.register({
    [ContainerRegistrationKeys.LOGGER]: asValue(logger),
    [ContainerRegistrationKeys.MANAGER]: asValue({}),
    [ContainerRegistrationKeys.PG_CONNECTION]: asValue(undefined),
  })

  const appLoader = new MedusaAppLoader({
    container,
    cwd: process.cwd(),
    medusaConfigPath: process.cwd(),
  })
  const application = await appLoader.load()

  return {
    container,
    logEntries,
    dispose: async () => {
      await application.onApplicationShutdown()
      MedusaModule.clearInstances()
    },
  }
}

function createResponse() {
  return {
    statusCode: 200,
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
      return this
    },
  }
}

type CartMergeHarnessOptions = {
  customerCart?: boolean
  guestItems?: Array<Record<string, unknown>>
  customerItems?: Array<Record<string, unknown>>
}

type CartReviewHarnessRow = {
  id: string
  cart_id: string
  review_ref: string
  merge_result_id: string
  produced_cart_version: number
  status: "pending" | "acknowledged"
  rejected_items: unknown
  acknowledged_at: string | null
}

function sellableVariant(id: string) {
  return {
    id,
    metadata: {
      gelato_product_uid: "gelato_product_test",
      gelato_template_id: "gelato_template_test",
      gelato_variant_options: { size: "M", color: "Black" },
      template_mode: "fixed",
    },
    prices: [{ currency_code: "brl", amount: 99 }],
    product: { status: "published" },
  }
}

function expectPublicMergeBody(body: any) {
  expect(Object.keys(body).sort()).toEqual(["cart", "outcome", "review"])
  expect(Object.keys(body.review).sort()).toEqual([
    "rejectedItems",
    "requiresReview",
    "reviewRef",
  ])
  for (const rejectedItem of body.review.rejectedItems) {
    expect(Object.keys(rejectedItem).sort()).toEqual([
      "acceptedQuantity",
      "reason",
      "rejectedQuantity",
      "requestedQuantity",
      "variantId",
    ])
  }
  expect(Object.keys(body.cart).sort()).toEqual([
    "checkout_data_complete",
    "created_at",
    "currency_code",
    "customer",
    "discount_total",
    "email",
    "id",
    "item_total",
    "items",
    "locale",
    "region_id",
    "shipping_address",
    "shipping_total",
    "subtotal",
    "tax_total",
    "total",
    "updated_at",
  ])
  expect(JSON.stringify(body)).not.toMatch(
    /guest-capability-is-not-persisted|customer-jwt-is-not-persisted|bff-secret-is-not-persisted|internalMetadata|raw-db-secret/
  )
}

function createTracerHarness(
  container: ReturnType<typeof createMedusaContainer>,
  options: CartMergeHarnessOptions = {}
) {
  const customerId = "cus_merge_01"
  const guestCart = {
    id: "cart_guest_merge_01",
    customer: null,
    customer_id: null,
    email: "guest@example.com",
    currency_code: "brl",
    metadata: { active_for_checkout: true },
    items: options.guestItems ?? [
      {
        id: "li_guest_merge_01",
        variant_id: "variant_tshirt_black_m",
        quantity: 2,
        title: "Camiseta preta M",
        variant_title: "Preta / M",
        unit_price: 9900,
        variant: sellableVariant("variant_tshirt_black_m"),
      },
    ],
    completed_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
  }
  const customerCart = options.customerCart
    ? {
        id: "cart_customer_merge_01",
        customer: { id: customerId },
        customer_id: customerId,
        email: "customer@example.com",
        currency_code: "brl",
        metadata: { active_for_checkout: true },
        items: options.customerItems ?? [
          {
            id: "li_customer_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 1,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
        completed_at: null,
        created_at: "2026-08-23T11:00:00.000Z",
        updated_at: "2026-08-23T11:00:00.000Z",
      }
    : null
  const carts = new Map<string, any>([[guestCart.id, guestCart]])
  if (customerCart) carts.set(customerCart.id, customerCart)
  const capability = {
    id: "gccap_merge_01",
    cart_id: guestCart.id,
    token_hash: hashGuestCartCapability("guest-capability-is-not-persisted"),
    status: "active" as const,
    expires_at: "2026-08-30T12:00:00.000Z",
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    deleted_at: null,
  }
  const versions = new Map<string, number>([[guestCart.id, 1]])
  if (customerCart) versions.set(customerCart.id, 1)
  const idempotencyRecords = new Map<string, any>()
  let committedReceiptRow: Record<string, unknown> | null = null
  let reviewRow: CartReviewHarnessRow | null = null
  const transaction = {
    id: "tx_cart_merge_01",
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      const normalized = sql.toLowerCase().replace(/\s+/g, " ").trim()
      if (normalized.includes("from cart_merge_result")) {
        if (!committedReceiptRow) return { rows: [] }
        const record = [...idempotencyRecords.values()].find(
          (candidate) => candidate.id === committedReceiptRow?.idempotency_record_id
        )
        const customerIdFromQuery = bindings[0] == null ? null : String(bindings[0])
        const guestCartIdFromQuery = bindings[1] == null ? null : String(bindings[1])
        const capabilityHashFromQuery =
          bindings[2] == null ? null : String(bindings[2])
        const idempotencyKeyHashFromQuery =
          bindings[5] == null ? null : String(bindings[5])
        const receiptMatchesQuery =
          customerIdFromQuery === String(committedReceiptRow.customer_id) &&
          guestCartIdFromQuery === String(committedReceiptRow.guest_cart_id) &&
          idempotencyKeyHashFromQuery != null &&
          record?.idempotency_key_hash != null &&
          fingerprintsMatch(record.idempotency_key_hash, idempotencyKeyHashFromQuery)
        if (!receiptMatchesQuery) {
          return { rows: [] }
        }
        const actorScopeHashFromQuery =
          bindings[4] == null ? record?.actor_scope_hash : String(bindings[4])
        const resourceScopeHash = hashStoreIdempotencyScope({
          resource_type: "cart_merge",
          guest_cart_id: String(committedReceiptRow.guest_cart_id),
          customer_cart_id:
            committedReceiptRow.customer_cart_id == null
              ? null
              : String(committedReceiptRow.customer_cart_id),
          capability_id: String(committedReceiptRow.capability_id),
        })
        return {
          rows: [
            {
              ...committedReceiptRow,
              capability_hash: capabilityHashFromQuery,
              capability_status: capability.status,
              actor_scope_hash: actorScopeHashFromQuery,
              resource_scope_hash: resourceScopeHash,
              idempotency_key_hash: idempotencyKeyHashFromQuery,
              idempotency_operation: "cart_merge",
              idempotency_state: "completed",
              idempotency_result_type: "cart_merge",
              idempotency_result_id: committedReceiptRow.id,
              idempotency_expires_at: committedReceiptRow.expires_at,
            },
          ],
        }
      }
      if (normalized.includes("from cart_review")) {
        return { rows: reviewRow ? [{ ...reviewRow }] : [] }
      }
      if (normalized.includes("from customer_cart_authority")) {
        return {
          rows: customerCart
            ? [
                {
                  id: "ccauth_merge_01",
                  customer_id: customerId,
                  cart_id: customerCart.id,
                  state: "active",
                },
              ]
            : [],
        }
      }
      if (normalized.includes("from cart where customer_id")) {
        return {
          rows: customerCart
            ? [
                {
                  id: customerCart.id,
                  customer_id: customerId,
                  completed_at: null,
                  deleted_at: null,
                  metadata: customerCart.metadata,
                },
              ]
          : [],
        }
      }
      if (normalized.includes("from cart where id")) {
        const cart = [...carts.values()].find((candidate) =>
          bindings.some((binding) => binding === candidate.id)
        )
        return {
          rows: cart
            ? [
                {
                  id: cart.id,
                  customer_id: cart.customer_id,
                  completed_at: cart.completed_at,
                  deleted_at: null,
                  metadata: cart.metadata,
                },
              ]
            : [],
        }
      }
      if (normalized.startsWith("insert into cart_merge_result")) {
        committedReceiptRow = {
          id: String(bindings[0]),
          idempotency_record_id: String(bindings[1]),
          customer_id: String(bindings[2]),
          guest_cart_id: String(bindings[3]),
          customer_cart_id: bindings[4] == null ? null : String(bindings[4]),
          canonical_cart_id: String(bindings[5]),
          capability_id: String(bindings[6]),
          capability_hash: bindings[7] == null ? null : String(bindings[7]),
          request_fingerprint: String(bindings[8]),
          guest_version_before: bindings[9],
          customer_version_before: bindings[10],
          guest_version_after: bindings[11],
          customer_version_after: bindings[12],
          outcome: bindings[13],
          rejected_items: bindings[14],
          review_id: bindings[15],
          review_ref: bindings[16],
          original_public_cart_snapshot: bindings[17],
          original_review_snapshot: bindings[18],
          original_etag: bindings[19],
          expires_at: bindings[20],
        }
      }
      if (normalized.startsWith("insert into cart_review")) {
        reviewRow = {
          id: String(bindings[0]),
          cart_id: String(bindings[1]),
          review_ref: String(bindings[2]),
          merge_result_id: String(bindings[3]),
          produced_cart_version: Number(bindings[4]),
          status: "pending",
          rejected_items:
            typeof bindings[5] === "string"
              ? JSON.parse(bindings[5])
              : bindings[5],
          acknowledged_at: null,
        }
      }
      if (
        normalized.startsWith("update cart_review") ||
        (normalized.includes("cart_review") && normalized.startsWith("update"))
      ) {
        if (reviewRow) {
          reviewRow.status = "acknowledged"
          reviewRow.acknowledged_at = "2026-08-25T12:00:01.000Z"
        }
      }
      return { rows: [] }
    }),
  }
  const idempotency = {
    claim: jest.fn(async (input: any) => {
      const existing = idempotencyRecords.get(input.rawIdempotencyKey)
      const fingerprint = buildStoreIdempotencyRequestFingerprint(
        input.canonicalSemanticObject
      )
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          return {
            type: "conflict" as const,
            record: existing,
            publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
          }
        }
        if (existing.state === "completed") {
          return { type: "replay" as const, record: existing }
        }
        return { type: "in_progress" as const, record: existing }
      }
      const record = {
        id: "stidem_merge_01",
        state: "processing" as const,
        state_version: 1,
        retry_attempt_count: 0,
        request_fingerprint: fingerprint,
        actor_scope_hash: hashStoreIdempotencyScope(input.actorScope),
        resource_scope_hash: hashStoreIdempotencyScope(input.resourceScope),
        idempotency_key_hash: hashStoreIdempotencyKey(
          input.rawIdempotencyKey,
          env.STORE_IDEMPOTENCY_KEY_PEPPER
        ),
        result_id: null as string | null,
      }
      idempotencyRecords.set(input.rawIdempotencyKey, record)
      return { type: "claimed" as const, record }
    }),
    markCompleted: jest.fn(async (input: any) => {
      const record = [...idempotencyRecords.values()].find(
        (candidate) => candidate.id === input.id
      )
      if (!record) throw new Error("IDEMPOTENCY_RECORD_NOT_FOUND")
      record.state = "completed"
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed" as const, record }
    }),
  }
  const capabilityService = {
    lookupGuestCartCapabilityByPresentedToken: jest.fn(async () => capability),
    authorizeGuestCartCapabilityForMutation: jest.fn(
      async (_token: string, cartId: string) => {
        if (cartId !== guestCart.id) {
          throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
        }
        return capability
      }
    ),
    consumeGuestCartCapability: jest.fn(async () => {
      capability.status = "consumed"
      capability.consumed_at = "2026-08-23T12:00:01.000Z"
      return capability
    }),
    lookupConsumedGuestCartCapabilityForReplay: jest.fn(
      async (input: { binding: { resultId: string } }) =>
        committedReceiptRow?.id === input.binding.resultId
          ? { result: { id: input.binding.resultId } }
          : null
    ),
  }
  const resourceVersion = {
    initialize: jest.fn(async (_type: string, id: string) => ({
      id: `strver_${id}`,
      resource_type: "cart",
      resource_id: id,
      version: versions.get(id) ?? 1,
    })),
    increment: jest.fn(async (_type: string, id: string, expected: number) => {
      const actual = versions.get(id) ?? 1
      if (actual !== expected) return { type: "stale", actualVersion: actual, expectedVersion: expected }
      versions.set(id, actual + 1)
      return { type: "updated", previousVersion: actual, version: actual + 1 }
    }),
    loadForUpdate: jest.fn(async (_type: string, id: string) => ({
      id: `strver_${id}`,
      resource_type: "cart",
      resource_id: id,
      version: versions.get(id) ?? 1,
    })),
  }
  ;(
    addToCartWorkflow as unknown as jest.Mock
  ).mockReset().mockImplementation(() => ({
    run: async ({ input }: any) => {
      const target = carts.get(input.cart_id)
      const item = {
        id: `li_added_${target.items.length + 1}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta",
        variant: sellableVariant(input.items[0].variant_id),
      }
      target.items.push(item)
      return { result: { cart_id: target.id } }
    },
  }))
  ;(
    updateLineItemInCartWorkflow as unknown as jest.Mock
  ).mockReset().mockImplementation(() => ({
    run: async ({ input }: any) => {
      const target = carts.get(input.cart_id)
      const item = target.items.find((candidate: any) => candidate.id === input.item_id)
      if (!item) throw new Error("LINE_ITEM_NOT_FOUND")
      item.quantity = input.update.quantity
      return { result: { cart_id: target.id } }
    },
  }))
  ;(
    deleteLineItemsWorkflow as unknown as jest.Mock
  ).mockReset().mockImplementation(() => ({
    run: async ({ input }: any) => {
      const target = carts.get(input.cart_id)
      target.items = target.items.filter((item: any) => !input.ids.includes(item.id))
      return { result: { cart_id: target.id } }
    },
  }))
  const cartModule = {
    baseRepository_: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) => {
        const cartSnapshot = new Map(
          [...carts.entries()].map(([id, cart]) => [id, JSON.parse(JSON.stringify(cart))])
        )
        const capabilitySnapshot = {
          status: capability.status,
          consumed_at: capability.consumed_at,
        }
        const versionSnapshot = versions.get(guestCart.id)
        const customerVersionSnapshot = customerCart
          ? versions.get(customerCart.id)
          : undefined
        const receiptSnapshot = committedReceiptRow
        const reviewSnapshot = reviewRow ? { ...reviewRow } : null

        try {
          return await callback({ getTransactionContext: () => transaction })
        } catch (error) {
          for (const [id, snapshot] of cartSnapshot.entries()) {
            Object.assign(carts.get(id), snapshot)
          }
          capability.status = capabilitySnapshot.status
          capability.consumed_at = capabilitySnapshot.consumed_at
          versions.set(guestCart.id, versionSnapshot ?? 1)
          if (customerCart) versions.set(customerCart.id, customerVersionSnapshot ?? 1)
          committedReceiptRow = receiptSnapshot
          reviewRow = reviewSnapshot
          throw error
        }
      },
    },
    retrieveCart: jest.fn(async (id: string) => carts.get(id) ?? null),
    updateCarts: jest.fn(async (selector: Record<string, unknown>, data?: Record<string, unknown>) => {
      const id = String(data ? selector.id : selector.id)
      const target = carts.get(id)
      const patch = data ?? selector
      if (!target) throw new Error("CART_NOT_FOUND")
      Object.assign(target, patch)
      if (Object.prototype.hasOwnProperty.call(patch, "customer_id")) {
        target.customer = patch.customer_id ? { id: String(patch.customer_id) } : null
        target.customer_id = patch.customer_id ?? null
      }
      target.updated_at = "2026-08-23T12:00:01.000Z"
      return target
    }),
  }
  const scope = createMedusaContainer({}, container)
  scope.register({
    [Modules.CART]: asValue(cartModule),
    [GUEST_CART_CAPABILITY_MODULE]: asValue(capabilityService),
    [STORE_IDEMPOTENCY_MODULE]: asValue(idempotency),
    [STORE_RESOURCE_VERSION_MODULE]: asValue(resourceVersion),
  })

  return {
    guestCart,
    customerCart,
    carts,
    capability,
    versions,
    idempotency,
    capabilityService,
    resourceVersion,
    get cartReview() {
      return reviewRow
    },
    getCommittedReceiptRow() {
      return committedReceiptRow
    },
    getIdempotencyRecordObjects() {
      return [...idempotencyRecords.values()]
    },
    cartModule,
    scope,
    transaction,
    request: {
      method: "POST",
      url: "/store/customers/me/cart/merge",
      originalUrl: "/store/customers/me/cart/merge",
      auth_context: { actor_type: "customer", actor_id: "cus_merge_01" },
      customerAuthBff: { authorized: true },
      body: { guestCartId: guestCart.id },
      headers: {
        authorization: "Bearer customer-jwt-is-not-persisted",
        "x-indicio-bff-auth": "bff-secret-is-not-persisted",
        [GUEST_CART_CAPABILITY_HEADER]: "guest-capability-is-not-persisted",
        "idempotency-key": "merge-key-01",
        "if-match": '"1"',
      },
      scope,
    },
  }
}

function asAttachRequest(
  harness: ReturnType<typeof createTracerHarness>,
  overrides: {
    body?: Record<string, unknown>
    headers?: Record<string, string | undefined>
    session?: { id?: string; active_cart_id?: string }
  } = {}
) {
  const headers = { ...harness.request.headers }
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    if (value === undefined) delete headers[name]
    else headers[name] = value
  }
  return {
    ...harness.request,
    url: "/store/customers/me/cart/attach",
    originalUrl: "/store/customers/me/cart/attach",
    body: overrides.body ?? harness.request.body,
    headers,
    ...(overrides.session ? { session: overrides.session } : {}),
  }
}

function getAttachRouteEntry() {
  const routes = defaultMiddlewares.routes ?? []
  const route = routes.find(
    (entry) => String(entry.matcher) === "/store/customers/me/cart/attach"
  )
  if (!route?.middlewares) {
    throw new Error("ATTACH_ROUTE_MIDDLEWARES_UNAVAILABLE")
  }
  return route
}

function getAttachAuthenticateMiddleware() {
  const middlewares = getAttachRouteEntry().middlewares as unknown[]
  return middlewares[1] as (
    req: unknown,
    res: unknown,
    next: () => void
  ) => void | Promise<void>
}

function wrapScopeResolveForConfigModule(
  scope: { resolve: (...args: unknown[]) => unknown }
) {
  const originalResolve = scope.resolve.bind(scope)
  const resolveSpy = jest.spyOn(scope, "resolve")
  resolveSpy.mockImplementation((key: unknown, ...args: unknown[]) => {
    if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
      return {
        projectConfig: {
          http: { jwtSecret: "unused-secret-for-absent-bearer" },
        },
      }
    }
    return originalResolve(key, ...args)
  })
  return resolveSpy
}

function sessionOnlyAttachRequest(
  harness: ReturnType<typeof createTracerHarness>
) {
  return {
    method: "POST",
    url: "/store/customers/me/cart/attach",
    originalUrl: "/store/customers/me/cart/attach",
    auth_context: { actor_type: "customer", actor_id: "cus_merge_01" },
    customerAuthBff: { authorized: true },
    session: {
      id: "sess_legacy_01",
      active_cart_id: harness.guestCart.id,
    },
    body: { cart_id: harness.guestCart.id },
    headers: {
      authorization: "Bearer customer-jwt-is-not-persisted",
      "x-indicio-bff-auth": "bff-secret-is-not-persisted",
    },
    scope: harness.scope,
  }
}

function expectAttachDeprecationZeroEffect(
  harness: ReturnType<typeof createTracerHarness>,
  executeCartMergeSpy?: jest.SpyInstance,
  resolveSpy?: jest.SpyInstance
) {
  expect(
    harness.capabilityService.lookupGuestCartCapabilityByPresentedToken.mock
      .calls.length
  ).toBe(0)
  expect(
    harness.capabilityService.authorizeGuestCartCapabilityForMutation.mock
      .calls.length
  ).toBe(0)
  expect(
    harness.capabilityService.consumeGuestCartCapability.mock.calls.length
  ).toBe(0)
  expect(harness.capability.status).toBe("active")
  expect(harness.idempotency.claim.mock.calls.length).toBe(0)
  expect(harness.idempotency.markCompleted.mock.calls.length).toBe(0)
  if (executeCartMergeSpy) {
    expect(executeCartMergeSpy).toHaveBeenCalledTimes(0)
  }
  expect(harness.cartModule.updateCarts.mock.calls.length).toBe(0)
  expect(harness.guestCart.customer_id).toBeNull()
  expect(harness.resourceVersion.increment.mock.calls.length).toBe(0)
  expect(harness.versions.get(harness.guestCart.id)).toBe(1)
  if (harness.customerCart) {
    expect(harness.versions.get(harness.customerCart.id)).toBe(1)
  }
  expect(harness.cartReview).toBeNull()
  expect(
    harness.transaction.raw.mock.calls
      .map(([sql]) => String(sql).toLowerCase())
      .join(" ")
  ).not.toMatch(/insert into cart_review|update cart_review/i)
  expect((addToCartWorkflow as unknown as jest.Mock).mock.calls.length).toBe(0)
  expect(
    (updateLineItemInCartWorkflow as unknown as jest.Mock).mock.calls.length
  ).toBe(0)
  expect((deleteLineItemsWorkflow as unknown as jest.Mock).mock.calls.length).toBe(
    0
  )
  if (resolveSpy) {
    expect(
      resolveSpy.mock.calls.some(([key]) => key === Modules.WORKFLOW_ENGINE)
    ).toBe(false)
    expect(resolveSpy.mock.calls.some(([key]) => key === Modules.ORDER)).toBe(
      false
    )
  }
  expect(
    harness.transaction.raw.mock.calls.map(([sql]) => String(sql)).join(" ")
  ).not.toMatch(/(?:from|into|update)\s+"?order"?(?:\s|\(|$)/i)
}

function expectCartMergeOnlyClaims(idempotency: {
  claim: { mock: { calls: Array<[Record<string, any>]> } }
}) {
  expect(idempotency.claim.mock.calls.length).toBeGreaterThan(0)
  for (const call of idempotency.claim.mock.calls) {
    const input = call[0]
    expect(input.operation).toBe(STORE_IDEMPOTENCY_CART_MERGE)
    expect(input.canonicalSemanticObject.operation).toBe("CART_MERGE")
    expect(input.rawIdempotencyKey).toBe("merge-key-01")
    expect(input.resourceScope.resource_type).toBe("cart_merge")
    expect(input.operation).not.toMatch(/cart_attach/i)
    expect(String(input.canonicalSemanticObject.operation)).not.toMatch(
      /CART_ATTACH|cart_attach/
    )
  }
}

function createAcknowledgeRequest(
  harness: ReturnType<typeof createTracerHarness>,
  options: {
    cartId?: string
    reviewRef: string | null
    version?: number
    headers?: Record<string, string | undefined>
  }
) {
  const headers = { ...harness.request.headers }
  delete headers[GUEST_CART_CAPABILITY_HEADER]
  delete headers["idempotency-key"]
  headers["if-match"] = `"${options.version ?? 2}"`
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === undefined) delete headers[name]
    else headers[name] = value
  }

  return {
    ...harness.request,
    method: "POST",
    url: `/store/carts/${options.cartId ?? harness.customerCart?.id ?? harness.guestCart.id}/review/acknowledge`,
    originalUrl: `/store/carts/${options.cartId ?? harness.customerCart?.id ?? harness.guestCart.id}/review/acknowledge`,
    params: {
      id: options.cartId ?? harness.customerCart?.id ?? harness.guestCart.id,
    },
    body: { reviewRef: options.reviewRef },
    headers,
  }
}

function expectPublicAcknowledgeBody(body: any) {
  expect(Object.keys(body).sort()).toEqual(["cart", "review"])
  expect(Object.keys(body.review).sort()).toEqual([
    "rejectedItems",
    "requiresReview",
    "reviewRef",
  ])
  expect(Object.keys(body.cart).sort()).toEqual([
    "checkout_data_complete",
    "created_at",
    "currency_code",
    "customer",
    "discount_total",
    "email",
    "id",
    "item_total",
    "items",
    "locale",
    "region_id",
    "shipping_address",
    "shipping_total",
    "subtotal",
    "tax_total",
    "total",
    "updated_at",
  ])
  expect(JSON.stringify(body)).not.toMatch(
    /review_id|merge_result_id|acknowledged_at|produced_cart_version|capability|idempotency|authorization|jwt|secret|hash|order/i
  )
}

async function createPendingReviewHarness(
  container: ReturnType<typeof createMedusaContainer>
) {
  const harness = createTracerHarness(container, {
    customerCart: true,
    customerItems: [
      {
        id: "li_customer_merge_01",
        variant_id: "variant_tshirt_black_m",
        quantity: 80,
        title: "Camiseta preta M",
        variant_title: "Preta / M",
        unit_price: 9900,
        variant: sellableVariant("variant_tshirt_black_m"),
      },
    ],
    guestItems: [
      {
        id: "li_guest_merge_01",
        variant_id: "variant_tshirt_black_m",
        quantity: 30,
        title: "Camiseta preta M",
        variant_title: "Preta / M",
        unit_price: 9900,
        variant: sellableVariant("variant_tshirt_black_m"),
      },
    ],
  })
  const mergeResponse = createResponse()
  await mergeCart(harness.request as never, mergeResponse as never)

  expect((mergeResponse.body as any).review.requiresReview).toBe(true)
  expect(harness.cartReview?.status).toBe("pending")
  expect(harness.cartReview?.cart_id).toBe(harness.customerCart?.id)

  return {
    harness,
    mergeResponse,
    reviewRef: (mergeResponse.body as any).review.reviewRef as string,
  }
}

function phase16CanaryRequestHeaders(
  overrides: Record<string, string | undefined> = {}
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
    "x-indicio-bff-auth": "bff-phase16-leakage-harness",
    [GUEST_CART_CAPABILITY_HEADER]: PHASE16_GUEST_CAPABILITY_CANARY,
    "idempotency-key": PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
    "if-match": '"1"',
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete headers[name]
    else headers[name] = value
  }
  return headers
}

const PHASE16_LEAKAGE_RESOLVE_KEYS = [
  Modules.CACHE,
  Modules.EVENT_BUS,
  Modules.WORKFLOW_ENGINE,
  "locking",
  ANALYTICS_EVENT_LOG_MODULE,
  "analytics_event_log",
] as const

type Phase16LeakageSpyBundle = {
  resolveSpy: jest.SpyInstance
  sentryCaptureExceptionSpy: jest.SpyInstance
  sentryCaptureMessageSpy: jest.SpyInstance
  restore: () => void
}

function installPhase16LeakageSpies(
  scope: { resolve: (...args: unknown[]) => unknown }
): Phase16LeakageSpyBundle {
  const resolveSpy = jest.spyOn(scope, "resolve")
  const sentryCaptureExceptionSpy = jest.spyOn(Sentry, "captureException")
  const sentryCaptureMessageSpy = jest.spyOn(Sentry, "captureMessage")

  return {
    resolveSpy,
    sentryCaptureExceptionSpy,
    sentryCaptureMessageSpy,
    restore() {
      resolveSpy.mockRestore()
      sentryCaptureExceptionSpy.mockRestore()
      sentryCaptureMessageSpy.mockRestore()
    },
  }
}

function countResolveCalls(
  resolveSpy: jest.SpyInstance,
  keys: readonly unknown[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of keys) {
    const label = String(key)
    counts[label] = resolveSpy.mock.calls.filter(
      ([resolved]) => resolved === key
    ).length
  }
  return counts
}

function extractSafeWorkflowCallArgs(calls: unknown[][]): Array<Record<string, unknown>> {
  return calls.map((call) => {
    const first = call[0]
    if (!first || typeof first !== "object") return {}
    const record = first as Record<string, unknown>
    const input =
      record.input && typeof record.input === "object"
        ? (record.input as Record<string, unknown>)
        : record
    return {
      cart_id: input.cart_id,
      items: input.items,
    }
  })
}

function buildPersistedProviderPayloadEvidence() {
  const addMock = addToCartWorkflow as unknown as jest.Mock
  const updateMock = updateLineItemInCartWorkflow as unknown as jest.Mock
  const deleteMock = deleteLineItemsWorkflow as unknown as jest.Mock
  return {
    callCounts: {
      addToCartWorkflow: addMock.mock.calls.length,
      updateLineItemInCartWorkflow: updateMock.mock.calls.length,
      deleteLineItemsWorkflow: deleteMock.mock.calls.length,
    },
    safeWorkflowArgs: {
      addToCartWorkflow: extractSafeWorkflowCallArgs(addMock.mock.calls),
      updateLineItemInCartWorkflow: extractSafeWorkflowCallArgs(updateMock.mock.calls),
      deleteLineItemsWorkflow: extractSafeWorkflowCallArgs(deleteMock.mock.calls),
    },
  }
}

function buildLeakageErrorSurface(
  error: unknown,
  normalized?: ReturnType<typeof toStoreErrorResponse>
) {
  const norm = normalized ?? toStoreErrorResponse(error)
  const record = (error ?? {}) as Record<string, unknown>
  return {
    name: record.name,
    message:
      (norm.body as { message?: unknown }).message ?? record.message,
    code: (norm.body as { code?: unknown }).code ?? record.code,
    status: record.status,
    statusCode: norm.statusCode,
    envelope: norm.body,
    headers: {},
  }
}

function recordMergeLeakageSnapshots(
  collector: ReturnType<typeof createGuestCartLeakageCollector>,
  harness: ReturnType<typeof createTracerHarness>,
  boot: BootstrappedCartMerge,
  response: ReturnType<typeof createResponse>,
  options: {
    spies?: Phase16LeakageSpyBundle
    errorSurface?: ReturnType<typeof buildLeakageErrorSurface>
  } = {}
) {
  const fixturesSnapshot: Record<string, unknown> = {
    body: response.body,
    headers: response.headers,
    reviewRef: (response.body as { review?: { reviewRef?: unknown } })?.review
      ?.reviewRef,
  }
  if (options.errorSurface) {
    fixturesSnapshot.errorSurface = options.errorSurface
  }

  collector.record("fixtures_snapshots", fixturesSnapshot)
  collector.record("db_plaintext", {
    receipt: harness.getCommittedReceiptRow(),
    review: harness.cartReview,
    idempotency: harness.getIdempotencyRecordObjects(),
    capability: harness.capability,
  })
  collector.record("logs", boot.logEntries)
  collector.record("openapi", readStoreOpenApiDocumentForLeakageScan())
  collector.record(
    "persisted_provider_payload",
    buildPersistedProviderPayloadEvidence()
  )

  const resolveCounts = options.spies
    ? countResolveCalls(options.spies.resolveSpy, PHASE16_LEAKAGE_RESOLVE_KEYS)
    : Object.fromEntries(
        PHASE16_LEAKAGE_RESOLVE_KEYS.map((key) => [String(key), 0])
      )

  collector.record(
    "redis_keys_jobs",
    unusedSinkEvidence({
      cache: resolveCounts[String(Modules.CACHE)] ?? 0,
      event_bus: resolveCounts[String(Modules.EVENT_BUS)] ?? 0,
      workflow_engine: resolveCounts[String(Modules.WORKFLOW_ENGINE)] ?? 0,
      locking: resolveCounts.locking ?? 0,
    })
  )
  collector.record(
    "sentry",
    unusedSinkEvidence({
      captureException: options.spies?.sentryCaptureExceptionSpy.mock.calls
        .length ?? 0,
      captureMessage: options.spies?.sentryCaptureMessageSpy.mock.calls
        .length ?? 0,
    })
  )
  collector.record(
    "analytics",
    unusedSinkEvidence({
      analytics_event_log_module:
        resolveCounts[String(ANALYTICS_EVENT_LOG_MODULE)] ?? 0,
      analytics_event_log: resolveCounts.analytics_event_log ?? 0,
    })
  )
}

function assertEncodingSafePublicIdentifiers(
  harness: ReturnType<typeof createTracerHarness>,
  response: ReturnType<typeof createResponse>
) {
  const receipt = harness.getCommittedReceiptRow()
  assertPublicIdentifiersDoNotEncodeSecrets(
    (response.body as { review?: { reviewRef?: string | null } })?.review
      ?.reviewRef ?? null,
    response.headers.etag ?? null,
    receipt && typeof receipt.request_fingerprint === "string"
      ? receipt.request_fingerprint
      : null
  )
}

describe("Cart merge HTTP tracer", () => {
  it("falha se cart_merge não puder ser resolvido pelo container real", async () => {
    const boot = await bootstrapCartMergeContainer(false)
    try {
      const harness = createTracerHarness(boot.container)
      await expect(
        mergeCart(harness.request as never, createResponse() as never)
      ).rejects.toThrow(/cart_merge/)
    } finally {
      await boot.dispose()
    }
  })

  it("promove o guest integralmente quando não existe Customer cart", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      expect(boot.container.resolve(CART_MERGE_MODULE)).toBeInstanceOf(
        CartMergeModuleService
      )

      const harness = createTracerHarness(boot.container)
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"2"')
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
      expect((response.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      })
      expect((response.body as any).cart.id).toBe(harness.guestCart.id)
      expect((response.body as any).cart.customer.id).toBe("cus_merge_01")
      expect(harness.versions.get(harness.guestCart.id)).toBe(2)
      expect(harness.capability.status).toBe("consumed")
      expect(
        harness.capabilityService.authorizeGuestCartCapabilityForMutation
      ).toHaveBeenCalledTimes(1)
      expect(harness.idempotency.claim).toHaveBeenCalledTimes(1)
      expect(harness.idempotency.markCompleted).toHaveBeenCalledTimes(1)
      expect(harness.cartModule.updateCarts).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(response.body)).not.toContain(
        "guest-capability-is-not-persisted"
      )
      expect(JSON.stringify(response.body)).not.toContain(
        "customer-jwt-is-not-persisted"
      )
      expectPublicMergeBody(response.body)
    } finally {
      await boot.dispose()
    }
  })

  it("executa MERGED integral no Customer destination pelo serviço real", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        customerItems: [
          {
            id: "li_customer_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 1,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
        guestItems: [
          {
            id: "li_guest_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 2,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
      })
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"2"')
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).outcome).toBe("MERGED")
      expect((response.body as any).cart.id).toBe(harness.customerCart?.id)
      expect((response.body as any).cart.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant_id: "variant_tshirt_black_m",
            quantity: 3,
          }),
        ])
      )
      expect((response.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      })
      expect(harness.customerCart?.items[0].quantity).toBe(3)
      expect(harness.capability.status).toBe("consumed")
      expectPublicMergeBody(response.body)
    } finally {
      await boot.dispose()
    }
  })

  it("executa partial real Customer A=80 + guest A=30 como 99/19/11 com review", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        customerItems: [
          {
            id: "li_customer_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 80,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
        guestItems: [
          {
            id: "li_guest_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 30,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
      })
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"2"')
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).outcome).toBe("MERGED_PARTIAL")
      expect((response.body as any).cart.id).toBe(harness.customerCart?.id)
      expect((response.body as any).cart.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant_id: "variant_tshirt_black_m",
            quantity: 99,
          }),
        ])
      )
      expect((response.body as any).review).toEqual({
        requiresReview: true,
        reviewRef: expect.stringMatching(/^review_/),
        rejectedItems: [
          {
            variantId: "variant_tshirt_black_m",
            requestedQuantity: 30,
            acceptedQuantity: 19,
            rejectedQuantity: 11,
            reason: "QUANTITY_LIMIT_EXCEEDED",
          },
        ],
      })
      expect(harness.customerCart?.items[0].quantity).toBe(99)
      expect(harness.capability.status).toBe("consumed")
      expectPublicMergeBody(response.body)
    } finally {
      await boot.dispose()
    }
  })

  it("retorna NO_ITEMS para todas as variantes rejeitadas e preserva o estado", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        guestItems: [
          {
            id: "li_guest_invalid_01",
            variant_id: "variant_invalid",
            quantity: 3,
            title: "Camiseta inválida",
            variant: null,
          },
        ],
      })
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"1"')
      expect((response.body as any).outcome).toBe("NO_ITEMS")
      expect((response.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [
          {
            variantId: "variant_invalid",
            requestedQuantity: 3,
            acceptedQuantity: 0,
            rejectedQuantity: 3,
            reason: "VARIANT_INVALID",
          },
        ],
      })
      expect(harness.customerCart?.items[0].quantity).toBe(1)
      expect(harness.capability.status).toBe("active")
      expect(harness.versions.get(harness.customerCart?.id ?? "")).toBe(1)
      expectPublicMergeBody(response.body)
    } finally {
      await boot.dispose()
    }
  })

  it("mantém razões fechadas VARIANT_INVALID, VARIANT_UNAVAILABLE e QUANTITY_LIMIT_EXCEEDED", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        customerItems: [
          {
            id: "li_customer_overflow_01",
            variant_id: "variant_overflow",
            quantity: 80,
            title: "Camiseta overflow",
            variant: sellableVariant("variant_overflow"),
          },
        ],
        guestItems: [
          {
            id: "li_guest_invalid_01",
            variant_id: "variant_invalid",
            quantity: 2,
            title: "Inválida",
            variant: null,
          },
          {
            id: "li_guest_unavailable_01",
            variant_id: "variant_unavailable",
            quantity: 4,
            title: "Indisponível",
            variant: {
              ...sellableVariant("variant_unavailable"),
              product: { status: "draft" },
            },
          },
          {
            id: "li_guest_overflow_01",
            variant_id: "variant_overflow",
            quantity: 30,
            title: "Overflow",
            variant: sellableVariant("variant_overflow"),
          },
          {
            id: "li_guest_valid_01",
            variant_id: "variant_valid",
            quantity: 2,
            title: "Válida",
            variant: sellableVariant("variant_valid"),
          },
        ],
      })
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect((response.body as any).outcome).toBe("MERGED_PARTIAL")
      expect((response.body as any).review.rejectedItems).toEqual(
        expect.arrayContaining([
          {
            variantId: "variant_invalid",
            requestedQuantity: 2,
            acceptedQuantity: 0,
            rejectedQuantity: 2,
            reason: "VARIANT_INVALID",
          },
          {
            variantId: "variant_unavailable",
            requestedQuantity: 4,
            acceptedQuantity: 0,
            rejectedQuantity: 4,
            reason: "VARIANT_UNAVAILABLE",
          },
          {
            variantId: "variant_overflow",
            requestedQuantity: 30,
            acceptedQuantity: 19,
            rejectedQuantity: 11,
            reason: "QUANTITY_LIMIT_EXCEEDED",
          },
        ])
      )
      expect((response.body as any).review.rejectedItems).toHaveLength(3)
      expect((response.body as any).review.requiresReview).toBe(true)
      expectPublicMergeBody(response.body)
    } finally {
      await boot.dispose()
    }
  })

  it("replay committed devolve body, review e ETag originais após mudança posterior", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        customerItems: [
          {
            id: "li_customer_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 80,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
        guestItems: [
          {
            id: "li_guest_merge_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 30,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
      })
      const first = createResponse()
      await mergeCart(harness.request as never, first as never)
      const originalBody = JSON.parse(JSON.stringify(first.body))
      const originalEtag = first.headers.etag

      harness.customerCart?.items.push({
        id: "li_later_mutation",
        variant_id: "variant_later",
        quantity: 1,
        title: "Posterior",
        variant: sellableVariant("variant_later"),
      })
      harness.versions.set(harness.customerCart?.id ?? "", 9)
      harness.customerCart!.updated_at = "2026-08-23T14:00:00.000Z"

      const replay = createResponse()
      await mergeCart(harness.request as never, replay as never)

      expect(replay.statusCode).toBe(200)
      expect(replay.headers.etag).toBe(originalEtag)
      expect(replay.headers["cache-control"]).toBe("no-store")
      expect(replay.body).toEqual(originalBody)
      expect(harness.capabilityService.lookupConsumedGuestCartCapabilityForReplay).toHaveBeenCalledTimes(1)
      expect(harness.customerCart?.items).toHaveLength(2)
      expectPublicMergeBody(replay.body)
    } finally {
      await boot.dispose()
    }
  })

  it("preserva a projeção pública persistida no replay sem reserializar o snapshot", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        customerCart: true,
        customerItems: [
          {
            id: "li_customer_replay_projection",
            variant_id: "variant_tshirt_black_m",
            quantity: 80,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
        guestItems: [
          {
            id: "li_guest_replay_projection",
            variant_id: "variant_tshirt_black_m",
            quantity: 30,
            title: "Camiseta preta M",
            variant_title: "Preta / M",
            unit_price: 9900,
            variant: sellableVariant("variant_tshirt_black_m"),
          },
        ],
      })
      harness.customerCart!.shipping_address = {
        first_name: "Maria",
        last_name: "Silva",
        address_1: "Rua A",
        city: "Sao Paulo",
        province: "SP",
        postal_code: "01311000",
        country_code: "BR",
        phone: "11987654321",
        metadata: { federal_tax_id: "52998224725" },
      }

      const first = createResponse()
      await mergeCart(harness.request as never, first as never)
      const receipt = harness.getCommittedReceiptRow()
      expect(receipt).not.toBeNull()
      const rawPersistedSnapshot = receipt?.original_public_cart_snapshot
      const persistedCart =
        typeof rawPersistedSnapshot === "string"
          ? (JSON.parse(rawPersistedSnapshot) as Record<string, unknown>)
          : (rawPersistedSnapshot as Record<string, unknown>)
      const persistedSnapshot = {
        ...persistedCart,
        checkout_data_complete: true,
        shipping_address: {
          ...(persistedCart.shipping_address as Record<string, unknown>),
          masked_federal_tax_id: "***.***.***-25",
        },
      }
      receipt!.original_public_cart_snapshot = persistedSnapshot
      receipt!.original_review_snapshot = {
        ...first.body.review,
        rejectedItems: first.body.review.rejectedItems.map(
          (item: Record<string, unknown>) => ({
            ...item,
            internal_only: "must-not-leak",
          })
        ),
      }
      const retrieveCountAfterFirst = harness.cartModule.retrieveCart.mock.calls.length

      expect(first.body).toEqual(
        expect.objectContaining({
          outcome: "MERGED_PARTIAL",
        })
      )
      expect(persistedSnapshot.checkout_data_complete).toBe(true)
      expect(persistedSnapshot.shipping_address.masked_federal_tax_id).toBe(
        "***.***.***-25"
      )

      harness.customerCart!.items.push({
        id: "li_replay_projection_later",
        variant_id: "variant_later",
        quantity: 1,
        title: "Posterior",
        variant: sellableVariant("variant_later"),
      })
      const replay = createResponse()
      await mergeCart(harness.request as never, replay as never)

      expect(replay.body).toEqual({
        outcome: "MERGED_PARTIAL",
        cart: persistedSnapshot,
        review: first.body.review,
      })
      expect(replay.headers.etag).toBe(first.headers.etag)
      expect(JSON.stringify(replay.body)).not.toContain("internal_only")
      expect(harness.cartModule.retrieveCart.mock.calls.length).toBe(
        retrieveCountAfterFirst
      )
    } finally {
      await boot.dispose()
    }
  })

  it("rejeita reuso da mesma idempotency key com If-Match incompatível como 409", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      await mergeCart(harness.request as never, createResponse() as never)
      harness.request.headers["if-match"] = '"2"'

      await expect(
        mergeCart(harness.request as never, createResponse() as never)
      ).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
        statusCode: 409,
      })
      expect(harness.capability.status).toBe("consumed")
      expect(harness.versions.get(harness.guestCart.id)).toBe(2)
    } finally {
      await boot.dispose()
    }
  })

  it("retorna 409 sanitizado para estado persistido malformado", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, {
        guestItems: [
          {
            id: "li_guest_malformed_01",
            variant_id: "variant_tshirt_black_m",
            quantity: 0,
            title: "Estado inválido",
          },
        ],
      })

      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)

      expect(error).toMatchObject({
        code: "CART_MERGE_STATE_CONFLICT",
        statusCode: 409,
      })
      const normalized = toStoreErrorResponse(error, {
        correlationId: "merge-malformed-state",
      })
      expect(normalized.statusCode).toBe(409)
      expect(normalized.body).toEqual(
        expect.objectContaining({ code: "CONFLICT" })
      )
      expect(JSON.stringify(normalized.body)).not.toContain("Estado inválido")
      expect(harness.capability.status).toBe("active")
    } finally {
      await boot.dispose()
    }
  })

  it("retorna 404 para capability inválida e para capability foreign", async () => {
    const invalidBoot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(invalidBoot.container)
      harness.capabilityService.lookupGuestCartCapabilityByPresentedToken.mockRejectedValueOnce(
        new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
      )
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect(error).toMatchObject({ type: MedusaError.Types.NOT_FOUND })
      const normalized = toStoreErrorResponse(error)
      expect(normalized.statusCode).toBe(404)
      expect(normalized.body.code).toBe("NOT_FOUND")
      expect(JSON.stringify(normalized.body)).not.toContain(
        GUEST_CART_CAPABILITY_LOOKUP_INVALID
      )
      expect(harness.capability.status).toBe("active")
      expect(harness.guestCart.customer_id).toBeNull()
      expect(harness.versions.get(harness.guestCart.id)).toBe(1)
      expect(updateLineItemInCartWorkflow).not.toHaveBeenCalled()
      expect(addToCartWorkflow).not.toHaveBeenCalled()
    } finally {
      await invalidBoot.dispose()
    }

    const foreignBoot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(foreignBoot.container)
      harness.request.body = { guestCartId: "cart_guest_foreign" }
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect(error).toMatchObject({ type: MedusaError.Types.NOT_FOUND })
      expect(toStoreErrorResponse(error).statusCode).toBe(404)
      expect(harness.capability.status).toBe("active")
    } finally {
      await foreignBoot.dispose()
    }
  })

  it("retorna 400 para input malformado antes de resolver o motor", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      harness.request.body = {}
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect(error).toMatchObject({ type: MedusaError.Types.INVALID_DATA })
      expect(toStoreErrorResponse(error).statusCode).toBe(400)
      expect(harness.idempotency.claim).not.toHaveBeenCalled()
    } finally {
      await boot.dispose()
    }
  })

  it("merge consome parseCartMerge* compartilhados e não isAttachNewContractPresent", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      jest.mocked(parseCartMergeCustomerId).mockClear()
      jest.mocked(parseCartMergeBody).mockClear()
      jest.mocked(parseCartMergePresentedHeaders).mockClear()
      jest.mocked(isAttachNewContractPresent).mockClear()

      const harness = createTracerHarness(boot.container)
      const response = createResponse()

      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(parseCartMergeCustomerId).toHaveBeenCalledTimes(1)
      expect(parseCartMergeBody).toHaveBeenCalledTimes(1)
      expect(parseCartMergePresentedHeaders).toHaveBeenCalledTimes(1)
      expect(isAttachNewContractPresent).not.toHaveBeenCalled()
    } finally {
      await boot.dispose()
    }
  })

  it("retorna 400 para merge sem Idempotency-Key antes de claim", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      delete harness.request.headers["idempotency-key"]

      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)

      expect(error).toMatchObject({ type: MedusaError.Types.INVALID_DATA })
      const normalized = toStoreErrorResponse(error)
      expect(normalized.statusCode).toBe(400)
      expect(normalized.body.code).toBe(STORE_ERROR_CODES.VALIDATION_ERROR)
      expect(harness.idempotency.claim).not.toHaveBeenCalled()
      expect(harness.capability.status).toBe("active")
      expect(harness.cartModule.updateCarts).not.toHaveBeenCalled()
      expect(harness.resourceVersion.increment).not.toHaveBeenCalled()
      expect(harness.versions.get(harness.guestCart.id)).toBe(1)
      expect(harness.guestCart.customer_id).toBeNull()
    } finally {
      await boot.dispose()
    }
  })

  it("normaliza falha técnica sem expor detalhe e preserva zero efeito", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      harness.transaction.raw.mockImplementationOnce(async () => {
        throw new Error("raw-db-secret-merge-technical-failure")
      })
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      const normalized = toStoreErrorResponse(error, {
        correlationId: "merge-technical-failure",
      })
      expect(normalized.statusCode).toBe(500)
      expect(normalized.body).toEqual(
        expect.objectContaining({ code: "INTERNAL_ERROR" })
      )
      expect(JSON.stringify(normalized.body)).not.toContain("raw-db-secret")
      expect(harness.guestCart.customer_id).toBeNull()
      expect(harness.capability.status).toBe("active")
    } finally {
      await boot.dispose()
    }
  })

  it("projeta o review parcial do mesmo resultado e impede leakage", async () => {
    const boot = await bootstrapCartMergeContainer()
    let executeCartMerge: jest.SpyInstance | undefined
    try {
      const harness = createTracerHarness(boot.container)
      const service = harness.request.scope.resolve<any>(CART_MERGE_MODULE)
      executeCartMerge = jest.spyOn(service, "executeCartMerge")
      executeCartMerge.mockResolvedValue({
        outcome: "MERGED_PARTIAL",
        cart: harness.guestCart,
        version: 7,
        review: {
          requiresReview: true,
          reviewRef: "review_public_01",
          rejectedItems: [
            {
              variantId: "variant_tshirt_black_m",
              requestedQuantity: 30,
              acceptedQuantity: 19,
              rejectedQuantity: 11,
              reason: "QUANTITY_LIMIT_EXCEEDED",
            },
          ],
          internalMetadata: "must-not-cross-boundary",
        },
      })

      const response = createResponse()
      await mergeCart(harness.request as never, response as never)

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"7"')
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).outcome).toBe("MERGED_PARTIAL")
      expect((response.body as any).review).toEqual({
        requiresReview: true,
        reviewRef: "review_public_01",
        rejectedItems: [
          {
            variantId: "variant_tshirt_black_m",
            requestedQuantity: 30,
            acceptedQuantity: 19,
            rejectedQuantity: 11,
            reason: "QUANTITY_LIMIT_EXCEEDED",
          },
        ],
      })
      expect(JSON.stringify(response.body)).not.toContain(
        "must-not-cross-boundary"
      )
      expect(JSON.stringify(response.body)).not.toContain(
        "guest-capability-is-not-persisted"
      )
      expect(JSON.stringify(response.body)).not.toContain(
        "customer-jwt-is-not-persisted"
      )
    } finally {
      executeCartMerge?.mockRestore()
      await boot.dispose()
    }
  })

  it("rejeita If-Match stale antes de claim/CAS e devolve o snapshot corrente", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      harness.request.headers["if-match"] = '"2"'

      await expect(
        mergeCart(harness.request as never, createResponse() as never)
      ).rejects.toMatchObject({
        code: "CART_VERSION_MISMATCH",
        statusCode: 412,
        currentVersion: 1,
        currentEtag: '"1"',
      })

      expect(harness.guestCart.customer_id).toBeNull()
      expect(harness.versions.get(harness.guestCart.id)).toBe(1)
      expect(harness.capability.status).toBe("active")
      expect(harness.idempotency.claim).not.toHaveBeenCalled()
      expect(harness.cartModule.updateCarts).not.toHaveBeenCalled()
    } finally {
      await boot.dispose()
    }
  })

  it("reverte cart, versão e capability quando o failpoint ocorre antes do commit", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container)
      harness.idempotency.markCompleted.mockImplementationOnce(async () => {
        throw new Error("W0_FAILPOINT_BEFORE_COMMIT")
      })

      await expect(
        mergeCart(harness.request as never, createResponse() as never)
      ).rejects.toThrow("W0_FAILPOINT_BEFORE_COMMIT")

      expect(harness.guestCart.customer_id).toBeNull()
      expect(harness.versions.get(harness.guestCart.id)).toBe(1)
      expect(harness.capability.status).toBe("active")
      expect(harness.capability.consumed_at).toBeNull()
      expect(harness.idempotency.claim).toHaveBeenCalledTimes(1)
      expect(harness.idempotency.markCompleted).toHaveBeenCalledTimes(1)
    } finally {
      await boot.dispose()
    }
  })

  it("nega novo merge enquanto a review permanece pending, antes de claim/workflow/bump/consume", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const customerCartId = harness.customerCart?.id as string
      const versionBefore = harness.versions.get(customerCartId)
      const itemSnapshot = JSON.stringify(harness.customerCart?.items)
      const claimCount = harness.idempotency.claim.mock.calls.length
      const consumeCount =
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      const workflowCount = (addToCartWorkflow as unknown as jest.Mock).mock.calls.length

      harness.request.headers["idempotency-key"] = "merge-after-pending-review"
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      const normalized = toStoreErrorResponse(error)

      expect(normalized.statusCode).toBe(409)
      expect(error).toMatchObject({
        code: "REVIEW_REQUIRED",
        statusCode: 409,
        status: 409,
      })
      expect(JSON.stringify(normalized.body)).not.toContain(reviewRef)
      expect(harness.versions.get(customerCartId)).toBe(versionBefore)
      expect(JSON.stringify(harness.customerCart?.items)).toBe(itemSnapshot)
      expect(harness.cartReview?.status).toBe("pending")
      expect(harness.idempotency.claim.mock.calls.length).toBe(claimCount)
      expect(
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      ).toBe(consumeCount)
      expect((addToCartWorkflow as unknown as jest.Mock).mock.calls.length).toBe(
        workflowCount
      )
    } finally {
      await boot.dispose()
    }
  })

  it("aplica ACK pending com reviewRef e If-Match correspondentes sem bump estrutural", async () => {
    const boot = await bootstrapCartMergeContainer()
    let resolveSpy: jest.SpyInstance | undefined
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const cartId = harness.customerCart?.id as string
      const versionBefore = harness.versions.get(cartId)
      const resourceVersionIncrementsBeforeAck =
        harness.resourceVersion.increment.mock.calls.length
      const rawCallsBeforeAck = harness.transaction.raw.mock.calls.length
      const capabilityLookups =
        harness.capabilityService.lookupGuestCartCapabilityByPresentedToken.mock
          .calls.length
      const capabilityConsumes =
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      const idempotencyClaims = harness.idempotency.claim.mock.calls.length
      resolveSpy = jest.spyOn(harness.scope, "resolve")

      const response = createResponse()
      await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef,
          version: versionBefore,
        }) as never,
        response as never
      )

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe(`"${versionBefore}"`)
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      })
      expect(harness.cartReview?.status).toBe("acknowledged")
      expect(harness.versions.get(cartId)).toBe(versionBefore)
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      expect(
        harness.capabilityService.lookupGuestCartCapabilityByPresentedToken
          .mock.calls.length
      ).toBe(capabilityLookups)
      expect(
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      ).toBe(capabilityConsumes)
      expect(harness.idempotency.claim.mock.calls.length).toBe(idempotencyClaims)
      expectPublicAcknowledgeBody(response.body)

      const ackSql = harness.transaction.raw.mock.calls
        .slice(rawCallsBeforeAck)
        .map(([sql]) => String(sql).toLowerCase())
      expect(ackSql.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(
        true
      )
      expect(ackSql.some((sql) => sql.includes("for update"))).toBe(true)
      expect(ackSql.some((sql) => sql.includes("cart_review"))).toBe(true)
      expect(ackSql.join(" ")).not.toMatch(
        /(?:from|into|update)\s+"?order"?(?:\s|\(|$)/i
      )
      expect(
        resolveSpy.mock.calls.some(([key]) =>
          [STORE_IDEMPOTENCY_MODULE, GUEST_CART_CAPABILITY_MODULE].includes(
            key as string
          )
        )
      ).toBe(false)
    } finally {
      resolveSpy?.mockRestore()
      await boot.dispose()
    }
  })

  it("repete o mesmo reviewRef acknowledged sem write e sem alterar ETag", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const cartId = harness.customerCart?.id as string
      const resourceVersionIncrementsBeforeAck =
        harness.resourceVersion.increment.mock.calls.length
      const first = createResponse()
      await acknowledgeCartReview(
        createAcknowledgeRequest(harness, { reviewRef, version: 2 }) as never,
        first as never
      )
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      const rawCallsAfterFirstAck = harness.transaction.raw.mock.calls.length
      const reviewUpdatesAfterFirstAck = harness.transaction.raw.mock.calls.filter(
        ([sql]) => String(sql).toLowerCase().includes("update cart_review")
      ).length

      const replay = createResponse()
      await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          cartId,
          reviewRef,
          version: 2,
        }) as never,
        replay as never
      )

      expect(replay.statusCode).toBe(200)
      expect(replay.headers.etag).toBe('"2"')
      expect(replay.headers["cache-control"]).toBe("no-store")
      expect((replay.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      })
      expect(harness.transaction.raw.mock.calls.length).toBeGreaterThan(
        rawCallsAfterFirstAck
      )
      expect(
        harness.transaction.raw.mock.calls.filter(([sql]) =>
          String(sql).toLowerCase().includes("update cart_review")
        ).length
      ).toBe(reviewUpdatesAfterFirstAck)
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      expect(harness.versions.get(cartId)).toBe(2)
    } finally {
      await boot.dispose()
    }
  })

  it("rejeita replay acknowledged depois de mutation posterior", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const cartId = harness.customerCart?.id as string
      const resourceVersionIncrementsBeforeAck =
        harness.resourceVersion.increment.mock.calls.length

      await acknowledgeCartReview(
        createAcknowledgeRequest(harness, { reviewRef, version: 2 }) as never,
        createResponse() as never
      )
      harness.versions.set(cartId, 3)

      const error = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          cartId,
          reviewRef,
          version: 3,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)

      const normalized = toStoreErrorResponse(error)
      expect(normalized.statusCode).toBe(409)
      expect(harness.cartReview?.status).toBe("acknowledged")
      expect(harness.versions.get(cartId)).toBe(3)
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      expect(JSON.stringify(normalized.body)).not.toContain(reviewRef)
    } finally {
      await boot.dispose()
    }
  })

  it("faz no-op 200 com reviewRef null quando não há pending", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const harness = createTracerHarness(boot.container, { customerCart: true })
      const response = createResponse()

      await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          cartId: harness.customerCart?.id,
          reviewRef: null,
          version: 1,
        }) as never,
        response as never
      )

      expect(response.statusCode).toBe(200)
      expect(response.headers.etag).toBe('"1"')
      expect(response.headers["cache-control"]).toBe("no-store")
      expect((response.body as any).review).toEqual({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      })
      expect(harness.cartReview).toBeNull()
      expect(harness.resourceVersion.increment).not.toHaveBeenCalled()
      expect(harness.transaction.raw.mock.calls.join(" ")).not.toMatch(
        /insert into cart_review|update cart_review/i
      )
    } finally {
      await boot.dispose()
    }
  })

  it("rejeita pending + reviewRef null preservando review e versão", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness } = await createPendingReviewHarness(boot.container)
      const resourceVersionIncrementsBeforeAck =
        harness.resourceVersion.increment.mock.calls.length
      const error = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef: null,
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)

      expect(toStoreErrorResponse(error).statusCode).toBe(409)
      expect(harness.cartReview?.status).toBe("pending")
      expect(harness.versions.get(harness.customerCart?.id ?? "")).toBe(2)
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      expect(JSON.stringify(toStoreErrorResponse(error).body)).not.toContain(
        "review_"
      )
    } finally {
      await boot.dispose()
    }
  })

  it("falha fechado para ref divergente, unknown e foreign sem enumerar a revisão", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const divergent = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef: "review_divergent_public_01",
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect(toStoreErrorResponse(divergent).statusCode).toBe(409)
      expect(JSON.stringify(toStoreErrorResponse(divergent).body)).not.toMatch(
        /review_divergent_public_01|review_id|merge_result_id/i
      )
      expect(harness.cartReview?.status).toBe("pending")

      const unknown = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef: "review_unknown_public_01",
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect([404, 409]).toContain(toStoreErrorResponse(unknown).statusCode)
      expect(JSON.stringify(toStoreErrorResponse(unknown).body)).not.toMatch(
        /review_unknown_public_01|review_id|merge_result_id/i
      )
      expect(harness.cartReview?.status).toBe("pending")

      harness.cartReview!.cart_id = "cart_foreign_public_01"
      harness.cartReview!.review_ref = "review_foreign_public_01"
      const foreign = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef: "review_foreign_public_01",
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect([404, 409]).toContain(toStoreErrorResponse(foreign).statusCode)
      expect(JSON.stringify(toStoreErrorResponse(foreign).body)).not.toMatch(
        /review_foreign_public_01|review_id|merge_result_id/i
      )
      expect(harness.cartReview?.status).toBe("pending")
      expect(reviewRef).not.toBe("review_foreign_public_01")
    } finally {
      await boot.dispose()
    }
  })

  it("retorna 412 para If-Match stale e mantém pending aplicável somente à versão produzida", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const cartId = harness.customerCart?.id as string
      const resourceVersionIncrementsBeforeAck =
        harness.resourceVersion.increment.mock.calls.length
      harness.versions.set(cartId, 3)

      const error = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef,
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)

      const normalized = toStoreErrorResponse(error)
      expect(normalized.statusCode).toBe(412)
      expect(harness.cartReview?.status).toBe("pending")
      expect(harness.versions.get(cartId)).toBe(3)
      expect(harness.resourceVersion.increment.mock.calls.length).toBe(
        resourceVersionIncrementsBeforeAck
      )
      expect(JSON.stringify(normalized.body)).not.toContain(reviewRef)
    } finally {
      await boot.dispose()
    }
  })

  it("não aceita capability no ACK e não entra em path de capability/idempotência", async () => {
    const boot = await bootstrapCartMergeContainer()
    let resolveSpy: jest.SpyInstance | undefined
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const capabilityLookups =
        harness.capabilityService.lookupGuestCartCapabilityByPresentedToken.mock
          .calls.length
      const capabilityConsumes =
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      const idempotencyClaims = harness.idempotency.claim.mock.calls.length
      resolveSpy = jest.spyOn(harness.scope, "resolve")

      const error = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          reviewRef,
          version: 2,
          headers: {
            [GUEST_CART_CAPABILITY_HEADER]: "capability-present-public_01",
          },
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)

      expect([400, 404]).toContain(toStoreErrorResponse(error).statusCode)
      expect(harness.cartReview?.status).toBe("pending")
      expect(
        harness.capabilityService.lookupGuestCartCapabilityByPresentedToken
          .mock.calls.length
      ).toBe(capabilityLookups)
      expect(
        harness.capabilityService.consumeGuestCartCapability.mock.calls.length
      ).toBe(capabilityConsumes)
      expect(harness.idempotency.claim.mock.calls.length).toBe(idempotencyClaims)
      expect(
        resolveSpy.mock.calls.some(([key]) =>
          [STORE_IDEMPOTENCY_MODULE, GUEST_CART_CAPABILITY_MODULE].includes(
            key as string
          )
        )
      ).toBe(false)
    } finally {
      resolveSpy?.mockRestore()
      await boot.dispose()
    }
  })

  it("falha fechado quando Customer ou cart não pertencem ao ACK", async () => {
    const boot = await bootstrapCartMergeContainer()
    try {
      const { harness, reviewRef } = await createPendingReviewHarness(boot.container)
      const foreignCustomerRequest = createAcknowledgeRequest(harness, {
        reviewRef,
        version: 2,
      })
      foreignCustomerRequest.auth_context = {
        actor_type: "customer",
        actor_id: "cus_foreign_public_01",
      }
      const foreignCustomer = await acknowledgeCartReview(
        foreignCustomerRequest as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect([404, 409]).toContain(
        toStoreErrorResponse(foreignCustomer).statusCode
      )
      expect(harness.cartReview?.status).toBe("pending")

      const foreignCart = await acknowledgeCartReview(
        createAcknowledgeRequest(harness, {
          cartId: harness.guestCart.id,
          reviewRef,
          version: 2,
        }) as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect([404, 409]).toContain(toStoreErrorResponse(foreignCart).statusCode)
      expect(harness.cartReview?.status).toBe("pending")
    } finally {
      await boot.dispose()
    }
  })

  describe("Adaptador attach depreciado", () => {
    it("delega attach elegível ao mesmo pipeline, body e efeitos do merge", async () => {
      const mergeBoot = await bootstrapCartMergeContainer()
      const attachBoot = await bootstrapCartMergeContainer()
      try {
        const mergeHarness = createTracerHarness(mergeBoot.container)
        const attachHarness = createTracerHarness(attachBoot.container)
        const mergeResponse = createResponse()
        const attachResponse = createResponse()

        await mergeCart(mergeHarness.request as never, mergeResponse as never)
        await attachCart(
          asAttachRequest(attachHarness) as never,
          attachResponse as never
        )

        expect(mergeResponse.statusCode).toBe(200)
        expect(attachResponse.statusCode).toBe(200)
        expect(JSON.stringify(attachResponse.body)).toBe(
          JSON.stringify(mergeResponse.body)
        )
        expect(attachResponse.headers.etag).toBe(mergeResponse.headers.etag)
        expect(attachResponse.headers["cache-control"]).toBe("no-store")
        expect(mergeResponse.headers["cache-control"]).toBe("no-store")
        expectPublicMergeBody(mergeResponse.body)
        expectPublicMergeBody(attachResponse.body)
        expect(attachHarness.capability.status).toBe("consumed")
        expect(attachHarness.versions.get(attachHarness.guestCart.id)).toBe(2)
        expect(attachHarness.cartModule.updateCarts).toHaveBeenCalledTimes(1)
        expect(attachHarness.idempotency.claim).toHaveBeenCalledTimes(1)
        expect(attachHarness.idempotency.markCompleted).toHaveBeenCalledTimes(1)
      } finally {
        await mergeBoot.dispose()
        await attachBoot.dispose()
      }
    })

    it("executa MERGED integral no attach com a mesma semântica do merge", async () => {
      const boot = await bootstrapCartMergeContainer()
      try {
        const harness = createTracerHarness(boot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 1,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 2,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        const response = createResponse()

        await attachCart(asAttachRequest(harness) as never, response as never)

        expect(response.statusCode).toBe(200)
        expect(response.headers.etag).toBe('"2"')
        expect(response.headers["cache-control"]).toBe("no-store")
        expect((response.body as any).outcome).toBe("MERGED")
        expect((response.body as any).cart.id).toBe(harness.customerCart?.id)
        expect((response.body as any).cart.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: "variant_tshirt_black_m",
              quantity: 3,
            }),
          ])
        )
        expect((response.body as any).review).toEqual({
          requiresReview: false,
          reviewRef: null,
          rejectedItems: [],
        })
        expect(harness.customerCart?.items[0].quantity).toBe(3)
        expect(harness.capability.status).toBe("consumed")
        expectPublicMergeBody(response.body)
      } finally {
        await boot.dispose()
      }
    })

    it("executa MERGED_PARTIAL e review no attach como 99/19/11", async () => {
      const boot = await bootstrapCartMergeContainer()
      try {
        const harness = createTracerHarness(boot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 80,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 30,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        const response = createResponse()

        await attachCart(asAttachRequest(harness) as never, response as never)

        expect(response.statusCode).toBe(200)
        expect(response.headers.etag).toBe('"2"')
        expect(response.headers["cache-control"]).toBe("no-store")
        expect((response.body as any).outcome).toBe("MERGED_PARTIAL")
        expect((response.body as any).cart.id).toBe(harness.customerCart?.id)
        expect((response.body as any).cart.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: "variant_tshirt_black_m",
              quantity: 99,
            }),
          ])
        )
        expect((response.body as any).review).toEqual({
          requiresReview: true,
          reviewRef: expect.stringMatching(/^review_/),
          rejectedItems: [
            {
              variantId: "variant_tshirt_black_m",
              requestedQuantity: 30,
              acceptedQuantity: 19,
              rejectedQuantity: 11,
              reason: "QUANTITY_LIMIT_EXCEEDED",
            },
          ],
        })
        expect(harness.customerCart?.items[0].quantity).toBe(99)
        expect(harness.capability.status).toBe("consumed")
        expectPublicMergeBody(response.body)
      } finally {
        await boot.dispose()
      }
    })

    it("promove GUEST_CART_ATTACHED no attach quando não existe Customer cart", async () => {
      const boot = await bootstrapCartMergeContainer()
      try {
        const harness = createTracerHarness(boot.container)
        const response = createResponse()

        await attachCart(asAttachRequest(harness) as never, response as never)

        expect(response.statusCode).toBe(200)
        expect(response.headers.etag).toBe('"2"')
        expect(response.headers["cache-control"]).toBe("no-store")
        expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
        expect((response.body as any).review).toEqual({
          requiresReview: false,
          reviewRef: null,
          rejectedItems: [],
        })
        expect((response.body as any).cart.id).toBe(harness.guestCart.id)
        expect((response.body as any).cart.customer.id).toBe("cus_merge_01")
        expect(harness.versions.get(harness.guestCart.id)).toBe(2)
        expect(harness.capability.status).toBe("consumed")
        expect(
          harness.capabilityService.authorizeGuestCartCapabilityForMutation
        ).toHaveBeenCalledTimes(1)
        expect(harness.idempotency.claim).toHaveBeenCalledTimes(1)
        expect(harness.idempotency.markCompleted).toHaveBeenCalledTimes(1)
        expect(harness.cartModule.updateCarts).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(response.body)).not.toContain(
          "guest-capability-is-not-persisted"
        )
        expect(JSON.stringify(response.body)).not.toContain(
          "customer-jwt-is-not-persisted"
        )
        expectPublicMergeBody(response.body)
      } finally {
        await boot.dispose()
      }
    })

    it("retorna NO_ITEMS no attach e preserva o estado como o merge", async () => {
      const boot = await bootstrapCartMergeContainer()
      try {
        const harness = createTracerHarness(boot.container, {
          customerCart: true,
          guestItems: [
            {
              id: "li_guest_invalid_01",
              variant_id: "variant_invalid",
              quantity: 3,
              title: "Camiseta inválida",
              variant: null,
            },
          ],
        })
        const response = createResponse()

        await attachCart(asAttachRequest(harness) as never, response as never)

        expect(response.statusCode).toBe(200)
        expect(response.headers.etag).toBe('"1"')
        expect((response.body as any).outcome).toBe("NO_ITEMS")
        expect((response.body as any).review).toEqual({
          requiresReview: false,
          reviewRef: null,
          rejectedItems: [
            {
              variantId: "variant_invalid",
              requestedQuantity: 3,
              acceptedQuantity: 0,
              rejectedQuantity: 3,
              reason: "VARIANT_INVALID",
            },
          ],
        })
        expect(harness.customerCart?.items[0].quantity).toBe(1)
        expect(harness.capability.status).toBe("active")
        expect(harness.versions.get(harness.customerCart?.id ?? "")).toBe(1)
        expectPublicMergeBody(response.body)
      } finally {
        await boot.dispose()
      }
    })

    it("emite o mesmo ETag do merge para o mesmo snapshot", async () => {
      const partialMergeBoot = await bootstrapCartMergeContainer()
      let partialMergeEtag = ""
      try {
        const partialMergeHarness = createTracerHarness(partialMergeBoot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 80,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 30,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        const partialMergeResponse = createResponse()
        await mergeCart(
          partialMergeHarness.request as never,
          partialMergeResponse as never
        )
        partialMergeEtag = partialMergeResponse.headers.etag
        expect(partialMergeEtag).toBe('"2"')
      } finally {
        await partialMergeBoot.dispose()
      }

      const partialAttachBoot = await bootstrapCartMergeContainer()
      try {
        const partialAttachHarness = createTracerHarness(
          partialAttachBoot.container,
          {
            customerCart: true,
            customerItems: [
              {
                id: "li_customer_merge_01",
                variant_id: "variant_tshirt_black_m",
                quantity: 80,
                title: "Camiseta preta M",
                variant_title: "Preta / M",
                unit_price: 9900,
                variant: sellableVariant("variant_tshirt_black_m"),
              },
            ],
            guestItems: [
              {
                id: "li_guest_merge_01",
                variant_id: "variant_tshirt_black_m",
                quantity: 30,
                title: "Camiseta preta M",
                variant_title: "Preta / M",
                unit_price: 9900,
                variant: sellableVariant("variant_tshirt_black_m"),
              },
            ],
          }
        )
        const partialAttachResponse = createResponse()
        await attachCart(
          asAttachRequest(partialAttachHarness) as never,
          partialAttachResponse as never
        )
        expect(partialAttachResponse.headers.etag).toBe('"2"')
        expect(partialAttachResponse.headers.etag).toBe(partialMergeEtag)
        expect(partialAttachResponse.headers["cache-control"]).toBe("no-store")
      } finally {
        await partialAttachBoot.dispose()
      }

      const noItemsMergeBoot = await bootstrapCartMergeContainer()
      const noItemsAttachBoot = await bootstrapCartMergeContainer()
      try {
        const noItemsMergeHarness = createTracerHarness(noItemsMergeBoot.container, {
          customerCart: true,
          guestItems: [
            {
              id: "li_guest_invalid_01",
              variant_id: "variant_invalid",
              quantity: 3,
              title: "Camiseta inválida",
              variant: null,
            },
          ],
        })
        const noItemsAttachHarness = createTracerHarness(
          noItemsAttachBoot.container,
          {
            customerCart: true,
            guestItems: [
              {
                id: "li_guest_invalid_01",
                variant_id: "variant_invalid",
                quantity: 3,
                title: "Camiseta inválida",
                variant: null,
              },
            ],
          }
        )
        const noItemsMergeResponse = createResponse()
        const noItemsAttachResponse = createResponse()
        await mergeCart(
          noItemsMergeHarness.request as never,
          noItemsMergeResponse as never
        )
        await attachCart(
          asAttachRequest(noItemsAttachHarness) as never,
          noItemsAttachResponse as never
        )
        expect(noItemsMergeResponse.headers.etag).toBe('"1"')
        expect(noItemsAttachResponse.headers.etag).toBe('"1"')
        expect(noItemsAttachResponse.headers.etag).toBe(
          noItemsMergeResponse.headers.etag
        )
      } finally {
        await noItemsMergeBoot.dispose()
        await noItemsAttachBoot.dispose()
      }
    })

    it("replay committed compartilha a operação cart_merge entre merge e attach", async () => {
      const mergeThenAttachBoot = await bootstrapCartMergeContainer()
      const attachThenMergeBoot = await bootstrapCartMergeContainer()
      try {
        const mergeHarness = createTracerHarness(mergeThenAttachBoot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 80,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 30,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        const first = createResponse()
        await mergeCart(mergeHarness.request as never, first as never)
        const originalBody = JSON.parse(JSON.stringify(first.body))
        const originalEtag = first.headers.etag
        const claimCountBeforeReplay =
          mergeHarness.idempotency.claim.mock.calls.length
        const markCompletedBeforeReplay =
          mergeHarness.idempotency.markCompleted.mock.calls.length
        expect(claimCountBeforeReplay).toBe(1)
        expectCartMergeOnlyClaims(mergeHarness.idempotency)

        mergeHarness.customerCart?.items.push({
          id: "li_later_mutation",
          variant_id: "variant_later",
          quantity: 1,
          title: "Posterior",
          variant: sellableVariant("variant_later"),
        })
        mergeHarness.versions.set(mergeHarness.customerCart?.id ?? "", 9)
        mergeHarness.customerCart!.updated_at = "2026-08-23T14:00:00.000Z"

        const replay = createResponse()
        await attachCart(
          asAttachRequest(mergeHarness) as never,
          replay as never
        )

        expect(replay.statusCode).toBe(200)
        expect(replay.headers.etag).toBe(originalEtag)
        expect(replay.headers["cache-control"]).toBe("no-store")
        expect(replay.body).toEqual(originalBody)
        expectPublicMergeBody(replay.body)
        expect(
          mergeHarness.capabilityService.lookupConsumedGuestCartCapabilityForReplay
        ).toHaveBeenCalled()
        expect(mergeHarness.customerCart?.items).toHaveLength(2)
        expect(mergeHarness.capability.status).toBe("consumed")
        expect(mergeHarness.idempotency.claim.mock.calls.length).toBe(
          claimCountBeforeReplay
        )
        expect(mergeHarness.idempotency.markCompleted.mock.calls.length).toBe(
          markCompletedBeforeReplay
        )
        expectCartMergeOnlyClaims(mergeHarness.idempotency)

        const attachHarness = createTracerHarness(attachThenMergeBoot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 80,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 30,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        const attachFirst = createResponse()
        await attachCart(
          asAttachRequest(attachHarness) as never,
          attachFirst as never
        )
        const attachOriginalBody = JSON.parse(JSON.stringify(attachFirst.body))
        const attachOriginalEtag = attachFirst.headers.etag
        const attachClaimCountBeforeReplay =
          attachHarness.idempotency.claim.mock.calls.length
        const attachMarkCompletedBeforeReplay =
          attachHarness.idempotency.markCompleted.mock.calls.length
        expect(attachClaimCountBeforeReplay).toBe(1)
        expectCartMergeOnlyClaims(attachHarness.idempotency)

        attachHarness.customerCart?.items.push({
          id: "li_later_mutation",
          variant_id: "variant_later",
          quantity: 1,
          title: "Posterior",
          variant: sellableVariant("variant_later"),
        })
        attachHarness.versions.set(attachHarness.customerCart?.id ?? "", 9)
        attachHarness.customerCart!.updated_at = "2026-08-23T14:00:00.000Z"

        const mergeReplay = createResponse()
        await mergeCart(attachHarness.request as never, mergeReplay as never)

        expect(mergeReplay.statusCode).toBe(200)
        expect(mergeReplay.headers.etag).toBe(attachOriginalEtag)
        expect(mergeReplay.headers["cache-control"]).toBe("no-store")
        expect(mergeReplay.body).toEqual(attachOriginalBody)
        expectPublicMergeBody(mergeReplay.body)
        expect(
          attachHarness.capabilityService.lookupConsumedGuestCartCapabilityForReplay
        ).toHaveBeenCalled()
        expect(attachHarness.customerCart?.items).toHaveLength(2)
        expect(attachHarness.capability.status).toBe("consumed")
        expect(attachHarness.idempotency.claim.mock.calls.length).toBe(
          attachClaimCountBeforeReplay
        )
        expect(attachHarness.idempotency.markCompleted.mock.calls.length).toBe(
          attachMarkCompletedBeforeReplay
        )
        expectCartMergeOnlyClaims(attachHarness.idempotency)
      } finally {
        await mergeThenAttachBoot.dispose()
        await attachThenMergeBoot.dispose()
      }
    })

    it("nega attach sem Idempotency-Key com 404 Not Found e zero efeito", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")

        const error = await attachCart(
          asAttachRequest(harness, {
            headers: { "idempotency-key": undefined },
          }) as never,
          createResponse() as never
        ).catch((caught) => caught)

        expect(error).toMatchObject({
          type: MedusaError.Types.NOT_FOUND,
          message: "Not Found",
        })
        const normalized = toStoreErrorResponse(error)
        expect(normalized.statusCode).toBe(404)
        expect(normalized.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
        expect(normalized.body.message).toBe("Not Found")
        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("nega attach sem If-Match com 404 Not Found e zero efeito", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")

        const error = await attachCart(
          asAttachRequest(harness, {
            headers: { "if-match": undefined },
          }) as never,
          createResponse() as never
        ).catch((caught) => caught)

        expect(error).toMatchObject({
          type: MedusaError.Types.NOT_FOUND,
          message: "Not Found",
        })
        const normalized = toStoreErrorResponse(error)
        expect(normalized.statusCode).toBe(404)
        expect(normalized.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
        expect(normalized.body.message).toBe("Not Found")
        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("nega attach sem capability e sem replay elegível", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")

        const error = await attachCart(
          asAttachRequest(harness, {
            headers: { [GUEST_CART_CAPABILITY_HEADER]: undefined },
          }) as never,
          createResponse() as never
        ).catch((caught) => caught)

        expect(error).toMatchObject({
          type: MedusaError.Types.NOT_FOUND,
          message: "Not Found",
        })
        const normalized = toStoreErrorResponse(error)
        expect(normalized.statusCode).toBe(404)
        expect(normalized.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
        expect(normalized.body.message).toBe("Not Found")
        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("nega attach session-only com 404 Not Found e zero efeito", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")
        const request = sessionOnlyAttachRequest(harness)

        const error = await attachCart(
          request as never,
          createResponse() as never
        ).catch((caught) => caught)

        expect(error).toMatchObject({
          type: MedusaError.Types.NOT_FOUND,
          message: "Not Found",
        })
        const normalized = toStoreErrorResponse(error)
        expect(normalized.statusCode).toBe(404)
        expect(normalized.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
        expect(normalized.body.message).toBe("Not Found")
        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
        expect(harness.guestCart.customer_id).toBeNull()
        expect(request.session?.active_cart_id).toBe(harness.guestCart.id)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("nega attach session-only even with full new-contract fields at middleware (HR-04)", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = wrapScopeResolveForConfigModule(harness.scope)
        const { authorization: _authorization, ...headersWithoutBearer } =
          harness.request.headers
        const request = {
          method: "POST",
          url: "/store/customers/me/cart/attach",
          originalUrl: "/store/customers/me/cart/attach",
          customerAuthBff: { authorized: true },
          session: {
            id: "sess_hr04_01",
            active_cart_id: harness.guestCart.id,
            auth_context: {
              actor_id: "cus_merge_01",
              actor_type: "customer",
              auth_identity_id: "authid_hr04",
              app_metadata: {},
            },
          },
          body: { guestCartId: harness.guestCart.id },
          headers: headersWithoutBearer,
          scope: harness.scope,
        }
        const response = createResponse()
        const next = jest.fn()
        const authenticateMiddleware = getAttachAuthenticateMiddleware()

        await authenticateMiddleware(request as never, response as never, next)

        expect(next).not.toHaveBeenCalled()
        expect(response.statusCode).toBe(401)
        expect(response.body).toEqual({ message: "Unauthorized" })
        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("attach middleware tuple usa authenticate bearer-only sem session", () => {
      const middlewaresSource = readFileSync(
        resolve(__dirname, "../../src/api/middlewares.ts"),
        "utf8"
      )
      const attachBlockMatch = middlewaresSource.match(
        /matcher:\s*"\/store\/customers\/me\/cart\/attach"[\s\S]*?middlewares:\s*\[[\s\S]*?\],/
      )
      expect(attachBlockMatch?.[0]).toContain(
        'authenticate("customer", ["bearer"])'
      )
      expect(attachBlockMatch?.[0]).not.toContain('"session"')
    })

    it("attach route delega merge sem motor legado ou request.session", () => {
      const attachRouteSource = readFileSync(
        resolve(
          __dirname,
          "../../src/api/store/customers/me/cart/attach/route.ts"
        ),
        "utf8"
      )
      expect(attachRouteSource).toContain("executeCartMerge")
      expect(attachRouteSource).not.toContain("transferCartCustomerWorkflowId")
      expect(attachRouteSource).not.toContain("updateCartWorkflowId")
      expect(attachRouteSource).not.toContain("request.session")
    })

    it("ignora session.active_cart_id como autoridade de attach", async () => {
      const boot = await bootstrapCartMergeContainer()
      try {
        const harness = createTracerHarness(boot.container)
        const response = createResponse()
        const foreignCartId = "cart_guest_foreign"
        const request = asAttachRequest(harness, {
          session: {
            id: "sess_legacy_01",
            active_cart_id: foreignCartId,
          },
        })

        await attachCart(request as never, response as never)

        expect(response.statusCode).toBe(200)
        expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
        expect((response.body as any).cart.id).toBe(harness.guestCart.id)
        expect(request.session?.active_cart_id).toBe(foreignCartId)
        expect(harness.capability.status).toBe("consumed")
      } finally {
        await boot.dispose()
      }
    })

    it("não executa motor legado de transfer, update ou supersede", async () => {
      const boot = await bootstrapCartMergeContainer()
      let resolveSpy: jest.SpyInstance | undefined
      let executeCartMerge: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")

        const request = asAttachRequest(harness, {
          session: {
            id: "sess_legacy_01",
            active_cart_id: harness.guestCart.id,
          },
        })
        const response = createResponse()
        await attachCart(request as never, response as never)

        expect(executeCartMerge).toHaveBeenCalledTimes(1)
        expect(resolveSpy.mock.calls.some(([key]) => key === CART_MERGE_MODULE)).toBe(
          true
        )
        expect(
          resolveSpy.mock.calls.some(([key]) => key === Modules.WORKFLOW_ENGINE)
        ).toBe(false)
        expect((addToCartWorkflow as unknown as jest.Mock).mock.calls.length).toBe(0)
        expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
        expect((response.body as any).outcome).not.toBe("attached_guest_cart")
        expect((response.body as any).outcome).not.toBe("preserve_customer_cart")
        expect((response.body as any).outcome).not.toBe(
          "reject_unauthorized_guest_cart"
        )
        expect(request.session?.active_cart_id).toBe(harness.guestCart.id)
        expect(harness.cartModule.updateCarts).toHaveBeenCalledTimes(1)
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })

    it("não causa efeito colateral na denial de depreciação", async () => {
      const boot = await bootstrapCartMergeContainer()
      let executeCartMerge: jest.SpyInstance | undefined
      let resolveSpy: jest.SpyInstance | undefined
      try {
        const harness = createTracerHarness(boot.container)
        const service = harness.scope.resolve<any>(CART_MERGE_MODULE)
        executeCartMerge = jest.spyOn(service, "executeCartMerge")
        resolveSpy = jest.spyOn(harness.scope, "resolve")
        const request = sessionOnlyAttachRequest(harness)

        const error = await attachCart(
          request as never,
          createResponse() as never
        ).catch((caught) => caught)

        expectAttachDeprecationZeroEffect(harness, executeCartMerge, resolveSpy)
        expect(harness.guestCart.customer_id).toBeNull()
        expect(harness.capability.consumed_at).toBeNull()
        expect(request.session?.active_cart_id).toBe(harness.guestCart.id)
        const normalized = toStoreErrorResponse(error)
        expect(JSON.stringify(normalized.body)).not.toMatch(
          /guest-capability-is-not-persisted|customer-jwt-is-not-persisted|bff-secret-is-not-persisted|review_|order/i
        )
      } finally {
        resolveSpy?.mockRestore()
        executeCartMerge?.mockRestore()
        await boot.dispose()
      }
    })
  })

  describe("Phase 16 eight-sink leakage (C1–C6)", () => {
    it("C1 merge success keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container)
        spies = installPhase16LeakageSpies(harness.scope)
        harness.request.headers = {
          ...harness.request.headers,
          ...phase16CanaryRequestHeaders(),
        }
        const response = createResponse()
        await mergeCart(harness.request as never, response as never)

        expect(response.statusCode).toBe(200)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(collector, harness, boot, response, {
          spies,
        })
        collector.assertExactEightSinksNoCanaries()
        assertEncodingSafePublicIdentifiers(harness, response)
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })

    it("C2 attach success keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container)
        spies = installPhase16LeakageSpies(harness.scope)
        const response = createResponse()
        await attachCart(
          asAttachRequest(harness, {
            headers: phase16CanaryRequestHeaders(),
          }) as never,
          response as never
        )

        expect(response.statusCode).toBe(200)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(collector, harness, boot, response, {
          spies,
        })
        collector.assertExactEightSinksNoCanaries()
        assertEncodingSafePublicIdentifiers(harness, response)
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })

    it("C3 committed replay keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container, {
          customerCart: true,
          customerItems: [
            {
              id: "li_customer_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 80,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
          guestItems: [
            {
              id: "li_guest_merge_01",
              variant_id: "variant_tshirt_black_m",
              quantity: 30,
              title: "Camiseta preta M",
              variant_title: "Preta / M",
              unit_price: 9900,
              variant: sellableVariant("variant_tshirt_black_m"),
            },
          ],
        })
        spies = installPhase16LeakageSpies(harness.scope)
        harness.request.headers[GUEST_CART_CAPABILITY_HEADER] =
          PHASE16_GUEST_CAPABILITY_CANARY
        harness.request.headers.authorization = `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`
        harness.request.headers["idempotency-key"] =
          PHASE16_RAW_IDEMPOTENCY_KEY_CANARY
        const first = createResponse()
        await mergeCart(harness.request as never, first as never)
        expect(first.statusCode).toBe(200)
        harness.customerCart?.items.push({
          id: "li_later_mutation",
          variant_id: "variant_later",
          quantity: 1,
          title: "Posterior",
          variant: sellableVariant("variant_later"),
        })
        harness.versions.set(harness.customerCart?.id ?? "", 9)
        const replay = createResponse()
        await mergeCart(harness.request as never, replay as never)

        expect(replay.statusCode).toBe(200)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(collector, harness, boot, replay, {
          spies,
        })
        collector.assertExactEightSinksNoCanaries()
        assertEncodingSafePublicIdentifiers(harness, replay)
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })

    it("C4 idempotency conflict keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container)
        spies = installPhase16LeakageSpies(harness.scope)
        harness.request.headers = {
          ...harness.request.headers,
          ...phase16CanaryRequestHeaders(),
        }
        await mergeCart(harness.request as never, createResponse() as never)
        harness.request.headers["if-match"] = '"2"'

        const error = await mergeCart(
          harness.request as never,
          createResponse() as never
        ).catch((caught) => caught)
        const normalized = toStoreErrorResponse(error)
        const errorSurface = buildLeakageErrorSurface(error, normalized)

        expect(normalized.statusCode).toBe(409)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(
          collector,
          harness,
          boot,
          {
            body: normalized.body,
            headers: {},
            statusCode: normalized.statusCode,
          } as ReturnType<typeof createResponse>,
          { spies, errorSurface }
        )
        collector.assertExactEightSinksNoCanaries()
        assertPublicSurfaceDoesNotEncodeSecrets({
          message: errorSurface.message,
          code: errorSurface.code,
          envelope: errorSurface.envelope,
        })
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })

    it("C5 session-only attach denial keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container)
        spies = installPhase16LeakageSpies(harness.scope)
        const request = {
          ...sessionOnlyAttachRequest(harness),
          headers: {
            ...sessionOnlyAttachRequest(harness).headers,
            ...phase16CanaryRequestHeaders({
              [GUEST_CART_CAPABILITY_HEADER]: undefined,
              "idempotency-key": undefined,
              "if-match": undefined,
            }),
          },
        }

        const error = await attachCart(
          request as never,
          createResponse() as never
        ).catch((caught) => caught)
        const normalized = toStoreErrorResponse(error)
        const errorSurface = buildLeakageErrorSurface(error, normalized)

        expect(normalized.statusCode).toBe(404)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(
          collector,
          harness,
          boot,
          {
            body: normalized.body,
            headers: {},
            statusCode: normalized.statusCode,
          } as ReturnType<typeof createResponse>,
          { spies, errorSurface }
        )
        collector.assertExactEightSinksNoCanaries()
        assertPublicSurfaceDoesNotEncodeSecrets({
          message: errorSurface.message,
          code: errorSurface.code,
          envelope: errorSurface.envelope,
        })
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })

    it("C6 missing capability denial keeps Phase 16 canaries out of exercised sinks", async () => {
      const boot = await bootstrapCartMergeContainer()
      let spies: Phase16LeakageSpyBundle | undefined
      try {
        const harness = createTracerHarness(boot.container)
        spies = installPhase16LeakageSpies(harness.scope)
        const error = await attachCart(
          asAttachRequest(harness, {
            headers: {
              ...phase16CanaryRequestHeaders(),
              [GUEST_CART_CAPABILITY_HEADER]: undefined,
            },
          }) as never,
          createResponse() as never
        ).catch((caught) => caught)
        const normalized = toStoreErrorResponse(error)
        const errorSurface = buildLeakageErrorSurface(error, normalized)

        expect(normalized.statusCode).toBe(404)
        const collector = createGuestCartLeakageCollector()
        recordMergeLeakageSnapshots(
          collector,
          harness,
          boot,
          {
            body: normalized.body,
            headers: {},
            statusCode: normalized.statusCode,
          } as ReturnType<typeof createResponse>,
          { spies, errorSurface }
        )
        collector.assertExactEightSinksNoCanaries()
        assertPublicSurfaceDoesNotEncodeSecrets({
          message: errorSurface.message,
          code: errorSurface.code,
          envelope: errorSurface.envelope,
        })
      } finally {
        spies?.restore()
        await boot.dispose()
      }
    })
  })
})
