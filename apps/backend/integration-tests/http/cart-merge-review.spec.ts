import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
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
} from "../../src/modules/guest-cart-capability/types"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import {
  buildStoreIdempotencyRequestFingerprint,
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
import { toStoreErrorResponse } from "../../src/api/store-surface/errors"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
}))

type MedusaConfigModule = {
  modules: Record<string, unknown>
  [key: string]: unknown
}

type BootstrappedCartMerge = {
  container: typeof medusaContainer
  dispose: () => Promise<void>
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
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
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
        return {
          rows: [
            {
              ...committedReceiptRow,
              capability_status: capability.status,
              actor_scope_hash: record?.actor_scope_hash,
              resource_scope_hash: record?.resource_scope_hash,
              idempotency_key_hash: record?.idempotency_key_hash,
              idempotency_operation: "cart_merge",
              idempotency_state: record?.state,
              idempotency_result_type: "cart_merge",
              idempotency_result_id: record?.result_id,
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
        new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
      )
      const error = await mergeCart(
        harness.request as never,
        createResponse() as never
      ).catch((caught) => caught)
      expect(error).toMatchObject({ type: MedusaError.Types.NOT_FOUND })
      expect(toStoreErrorResponse(error).statusCode).toBe(404)
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
})
