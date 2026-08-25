import { addToCartWorkflow, deleteLineItemsWorkflow, updateLineItemInCartWorkflow } from "@medusajs/core-flows"
import { randomBytes } from "node:crypto"
import type { MedusaRequest } from "@medusajs/framework/http"
import {
  MedusaError,
  MedusaService,
  Modules,
  generateEntityId,
} from "@medusajs/framework/utils"
import {
  applyStructuralCartInvalidation,
} from "../checkout/shipping-invalidation"
import {
  assertNoPaymentOrOrderFields,
  markCartSupersededInput,
} from "../checkout/active-cart"
import {
  CartVersionMismatchError,
} from "../../api/store/carts/concurrency"
import {
  type StoreCartPreOrderRecord,
  serializeStoreCartPreOrder,
} from "../../api/store/carts/serializers"
import { formatCartEtag } from "../../api/store/carts/concurrency"
import { env } from "../../config/env"
import {
  STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
  STORE_IDEMPOTENCY_CART_MERGE,
  STORE_IDEMPOTENCY_MODULE,
  buildStoreIdempotencyRequestFingerprint,
  fingerprintsMatch,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
  type StoreIdempotencyModuleService,
} from "../store-idempotency"
import {
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityReplayBinding,
  type GuestCartCapabilityRecord,
  type GuestCartCapabilityMutationContext,
} from "../guest-cart-capability"
import { hashGuestCartCapability } from "../guest-cart-capability/hash"
import {
  STORE_RESOURCE_VERSION_MODULE,
  type StoreResourceVersionModuleService,
  type StoreResourceVersionMutationContext,
} from "../store-resource-version"
import { lockCartOrderAuthority } from "../payment-attempt/transactional-authority"
import {
  lockCustomerCartAuthority,
  resolveCanonicalCustomerCartAuthority,
} from "../../api/store/carts/customer-active-cart"
import type { CustomerCartAuthoritySharedContext } from "../../api/store/carts/customer-active-cart"
import { isSellableVariant } from "../../workflows/catalog/validate-sellable-variant"
import { buildCartMergeDecision } from "./decision"
import CustomerCartAuthority from "./models/customer-cart-authority"
import CartMergeResult from "./models/cart-merge-result"
import CartReview from "./models/cart-review"
import {
  CART_MERGE_OUTCOMES,
  type CartMergeDecision,
  CartMergeStateConflictError,
  type CartMergeOutcome,
  type CartReviewState,
} from "./types"

const CART_MERGE_FINGERPRINT_OPERATION = "CART_MERGE" as const

type TransactionContext = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

type TransactionManager =
  StoreResourceVersionMutationContext["transactionManager"]

type CartModule = {
  baseRepository_?: {
    transaction<T>(
      callback: (manager: TransactionManager) => Promise<T>
    ): Promise<T>
  }
  retrieveCart?: (...args: unknown[]) => Promise<StoreCartPreOrderRecord | null>
  updateCarts?: (...args: unknown[]) => Promise<unknown>
}

type TransactionalWorkflowScope = {
  resolve: (key: unknown) => unknown
}

function createTransactionalCartModule(
  cartModule: CartModule,
  sharedContext: StoreResourceVersionMutationContext
): CartModule {
  const contextAwareMethods = new Set([
    "addLineItems",
    "updateLineItems",
    "softDeleteLineItems",
    "restoreLineItems",
    "deleteLineItems",
    "listLineItems",
    "retrieveCart",
    "listCarts",
    "retrieveLineItem",
  ])

  return new Proxy(cartModule, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (
        typeof property !== "string" ||
        !contextAwareMethods.has(property) ||
        typeof value !== "function"
      ) {
        return value
      }

      return (...args: unknown[]) => value.apply(target, [...args, sharedContext])
    },
  })
}

function createTransactionalWorkflowScope(
  request: MergeRequest,
  cartModule: CartModule,
  sharedContext: StoreResourceVersionMutationContext
): TransactionalWorkflowScope {
  const transactionalCartModule = createTransactionalCartModule(
    cartModule,
    sharedContext
  )

  return {
    resolve(key: unknown) {
      if (key === Modules.CART) {
        return transactionalCartModule
      }
      return request.scope.resolve(key as never)
    },
  }
}

type CartMergeFailpoint = {
  trip(point: string): void
}

export type CartMergeExecutionInput = {
  request: MedusaRequest
  customerId: string
  guestCartId: string
  presentedCapability: string
  rawIdempotencyKey: string
  expectedGuestVersion: number
}

export type CartMergeExecutionResult = {
  outcome: CartMergeOutcome
  cart: StoreCartPreOrderRecord
  version: number
  review: CartReviewState
}

type MergeRequest = MedusaRequest & {
  customerAuthBff?: { authorized?: boolean }
  cartMergeFailpoint?: CartMergeFailpoint
}

type CartMergeReceiptRow = {
  id: string
  idempotency_record_id: string
  customer_id: string
  guest_cart_id: string
  customer_cart_id: string | null
  canonical_cart_id: string
  capability_id: string
  capability_hash: string | null
  request_fingerprint: string
  guest_version_before: number
  customer_version_before: number | null
  guest_version_after: number
  customer_version_after: number | null
  outcome: CartMergeOutcome
  rejected_items: unknown
  review_id: string | null
  review_ref: string | null
  original_public_cart_snapshot: unknown
  original_review_snapshot: unknown
  original_etag: string
  expires_at: string | Date
  capability_status: string | null
  actor_scope_hash: string
  resource_scope_hash: string
  idempotency_key_hash: string
  idempotency_operation: string
  idempotency_state: string
  idempotency_result_type: string | null
  idempotency_result_id: string | null
  idempotency_expires_at: string | Date | null
}

type CartMergeReviewIdentity = {
  id: string
  reviewRef: string
}

function cartMergeCartRetrieveConfig(): { relations: string[] } {
  return {
    relations: ["items", "items.variant", "customer"],
  }
}

function projectCartCustomer(
  cart: StoreCartPreOrderRecord | null
): StoreCartPreOrderRecord | null {
  if (!cart) {
    return null
  }

  if (cart.customer?.id) {
    return cart
  }

  const customerId =
    typeof cart.customer_id === "string" && cart.customer_id.length > 0
      ? cart.customer_id
      : undefined
  if (!customerId) {
    return cart
  }

  return {
    ...cart,
    customer: { id: customerId },
  }
}

function currentVersionContext(
  manager: TransactionManager
): StoreResourceVersionMutationContext {
  return {
    __type: "MedusaContext",
    transactionManager: manager,
    manager,
  }
}

function requireRows(result: { rows?: Array<Record<string, unknown>> }): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function isActiveGuestCart(cart: StoreCartPreOrderRecord): boolean {
  const metadata = cart.metadata
  return (
    !cart.completed_at &&
    (!metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      (metadata as Record<string, unknown>).active_for_checkout !== false) &&
    !cart.customer?.id
  )
}

function isActiveCustomerCart(
  cart: StoreCartPreOrderRecord,
  customerId: string
): boolean {
  return (
    !cart.completed_at &&
    (!cart.metadata ||
      typeof cart.metadata !== "object" ||
      Array.isArray(cart.metadata) ||
      (cart.metadata as Record<string, unknown>).active_for_checkout !== false) &&
    cart.customer?.id === customerId
  )
}

async function lockCartRows(
  transaction: TransactionContext,
  cartIds: string[]
): Promise<void> {
  for (const cartId of [...new Set(cartIds)].sort()) {
    await lockCartOrderAuthority(transaction, cartId)
    await transaction.raw(
      "select id from cart where id = ? and deleted_at is null for update",
      [cartId]
    )
  }
}

async function assertNoPendingCartReview(
  transaction: TransactionContext,
  cartIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(cartIds)].filter(Boolean)
  if (ids.length === 0) {
    return
  }

  const bindings = ids.map(() => "?").join(", ")
  const result = await transaction.raw(
    `
      select id
      from cart_review
      where cart_id in (${bindings})
        and status = 'pending'
        and deleted_at is null
      order by id
      for update
    `,
    ids
  )
  if (requireRows(result).length > 0) {
    throwConflict("REVIEW_REQUIRED")
  }
}

async function updateCartWithContext(
  cartModule: CartModule,
  selector: Record<string, unknown>,
  data: Record<string, unknown>,
  sharedContext: StoreResourceVersionMutationContext
): Promise<void> {
  if (typeof cartModule.updateCarts !== "function") {
    throw new Error("CART_UPDATE_AUTHORITY_UNAVAILABLE")
  }

  if (cartModule.updateCarts.length === 1) {
    await cartModule.updateCarts({ ...selector, ...data }, sharedContext)
    return
  }

  await cartModule.updateCarts(selector, data, sharedContext)
}

function persistedVariantAvailability(
  cart: StoreCartPreOrderRecord
): ReadonlyMap<string, "valid" | "invalid" | "unavailable"> {
  const availability = new Map<
    string,
    "valid" | "invalid" | "unavailable"
  >()

  for (const item of cart.items ?? []) {
    if (typeof item.variant_id !== "string" || item.variant_id.trim() === "") {
      continue
    }

    // The narrow HTTP tracer does not expose catalog relations. Real Medusa
    // snapshots do when the relation is loaded above; only then do we derive
    // deterministic catalog availability.
    if (!Object.prototype.hasOwnProperty.call(item, "variant")) {
      continue
    }

    const variant = item.variant as
      | {
          id?: unknown
          metadata?: Record<string, unknown> | null
          prices?: Array<{ amount?: unknown; currency_code?: unknown }>
          product?: { status?: unknown } | null
        }
      | null
      | undefined

    let value: "valid" | "invalid" | "unavailable"
    if (!variant || typeof variant !== "object") {
      value = "invalid"
    } else if (
      typeof variant.id !== "string" ||
      variant.id.trim() !== item.variant_id.trim()
    ) {
      throw new CartMergeStateConflictError(
        "Persisted cart variant relation is inconsistent"
      )
    } else if (
      variant.product?.status !== undefined &&
      variant.product.status !== "published"
    ) {
      value = "unavailable"
    } else {
      try {
        value = isSellableVariant(variant as never)
          ? "valid"
          : "unavailable"
      } catch {
        throw new CartMergeStateConflictError(
          "Persisted cart variant projection is malformed"
        )
      }
    }

    const previous = availability.get(item.variant_id.trim())
    if (previous !== undefined && previous !== value) {
      throw new CartMergeStateConflictError(
        "Persisted cart variant availability is inconsistent"
      )
    }
    availability.set(item.variant_id.trim(), value)
  }

  return availability
}

function mergeVariantItems(
  cart: StoreCartPreOrderRecord,
  variantId: string
) {
  return (cart.items ?? []).filter(
    (item) =>
      typeof item.variant_id === "string" &&
      item.variant_id.trim() === variantId
  )
}

async function retrieveMergeCart(
  cartModule: CartModule,
  cartId: string,
  sharedContext: StoreResourceVersionMutationContext
): Promise<StoreCartPreOrderRecord | null> {
  if (typeof cartModule.retrieveCart !== "function") {
    return null
  }

  return projectCartCustomer(
    await cartModule.retrieveCart(
      cartId,
      cartMergeCartRetrieveConfig(),
      sharedContext
    )
  )
}

async function applyAcceptedItemsToCart(
  request: MergeRequest,
  cartModule: CartModule,
  cart: StoreCartPreOrderRecord,
  desiredQuantity: (variantId: string) => number,
  sharedContext: StoreResourceVersionMutationContext
): Promise<void> {
  const workflowScope = createTransactionalWorkflowScope(
    request,
    cartModule,
    sharedContext
  )

  const variantIds = [
    ...new Set(
      (cart.items ?? []).map((item) =>
        typeof item.variant_id === "string"
          ? item.variant_id.trim()
          : item.variant_id
      )
    ),
  ]
  for (const variantId of variantIds) {
    if (typeof variantId !== "string" || variantId.length === 0) {
      throwConflict("CART_MERGE_LINE_VARIANT_ID_UNAVAILABLE")
    }

    const matchingItems = mergeVariantItems(cart, variantId)
    const wantedQuantity = desiredQuantity(variantId)
    if (!Number.isSafeInteger(wantedQuantity) || wantedQuantity < 0) {
      throwConflict("CART_MERGE_DECISION_QUANTITY_INVALID")
    }

    const lineIds = matchingItems.map((item) => item.id)
    if (lineIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throwConflict("CART_MERGE_LINE_ID_UNAVAILABLE")
    }
    const safeLineIds = lineIds as string[]

    const primaryItem = matchingItems[0]

    if (wantedQuantity === 0) {
      await deleteLineItemsWorkflow(workflowScope as never).run({
        input: { cart_id: cart.id, ids: safeLineIds },
        context: sharedContext as never,
      })
      continue
    }

    const primaryItemId = primaryItem?.id
    if (!primaryItem || typeof primaryItemId !== "string") {
      throwConflict("CART_MERGE_LINE_MISSING")
    }

    if (primaryItem.quantity !== wantedQuantity || matchingItems.length > 1) {
      await updateLineItemInCartWorkflow(workflowScope as never).run({
        input: {
          cart_id: cart.id,
          item_id: primaryItemId,
          update: { quantity: wantedQuantity },
        },
        context: sharedContext as never,
      })
    }

    const duplicateIds = safeLineIds.slice(1)
    if (duplicateIds.length > 0) {
      await deleteLineItemsWorkflow(workflowScope as never).run({
        input: {
          cart_id: cart.id,
          ids: duplicateIds,
        },
        context: sharedContext as never,
      })
    }
  }
}

async function applyAcceptedCustomerItems(
  request: MergeRequest,
  cartModule: CartModule,
  customerCart: StoreCartPreOrderRecord,
  decision: CartMergeDecision,
  sharedContext: StoreResourceVersionMutationContext
): Promise<void> {
  const workflowScope = createTransactionalWorkflowScope(
    request,
    cartModule,
    sharedContext
  )

  for (const accepted of decision.acceptedItems) {
    const variantDecision = decision.decisions.find(
      (candidate) => candidate.variantId === accepted.variantId
    )
    if (!variantDecision) {
      throw new Error("CART_MERGE_DECISION_VARIANT_MISSING")
    }

    const matchingItems = mergeVariantItems(customerCart, accepted.variantId)
    const primaryItem = matchingItems[0]

    if (!primaryItem) {
      await addToCartWorkflow(workflowScope as never).run({
        input: {
          cart_id: customerCart.id,
          items: [
            {
              variant_id: accepted.variantId,
              quantity: accepted.quantity,
            },
          ],
        },
        context: sharedContext as never,
      })
      continue
    }

    const primaryItemId = primaryItem?.id
    if (!primaryItem || typeof primaryItemId !== "string") {
      throwConflict("CART_MERGE_CUSTOMER_LINE_ID_UNAVAILABLE")
    }

    await updateLineItemInCartWorkflow(workflowScope as never).run({
      input: {
        cart_id: customerCart.id,
        item_id: primaryItemId,
        update: { quantity: variantDecision.customerQuantityAfter },
      },
      context: sharedContext as never,
    })

    const duplicateIds = matchingItems.slice(1).map((item) => item.id)
    if (duplicateIds.some((id) => !id)) {
      throwConflict("CART_MERGE_CUSTOMER_LINE_ID_UNAVAILABLE")
    }
    if (duplicateIds.length > 0) {
      await deleteLineItemsWorkflow(workflowScope as never).run({
        input: {
          cart_id: customerCart.id,
          ids: duplicateIds as string[],
        },
        context: sharedContext as never,
      })
    }
  }
}

/**
 * Disposable multiprocess proof hook. It is inert unless the test worker has
 * explicitly armed the loopback-only barrier environment. The transaction
 * remains open while the parent releases the worker, so the advisory lock is
 * the synchronization authority rather than process memory or Redis.
 */
async function awaitCartMergeCustomerLockBarrier(
  transaction: TransactionContext,
  customerId: string
): Promise<void> {
  const runId = process.env.P16_CART_MERGE_BARRIER_RUN_ID
  const role = process.env.P16_CART_MERGE_BARRIER_ROLE
  if (!runId || !/^[a-f0-9]{16}$/.test(runId) || !/^[AB]$/.test(role ?? "")) {
    return
  }
  if (typeof process.send !== "function") {
    throw new Error("P16_CART_MERGE_LOCK_BARRIER_IPC_UNAVAILABLE")
  }

  const txid = String(
    requireRows(await transaction.raw("select txid_current()::text as txid"))[0]
      ?.txid ?? ""
  )
  if (!/^\d+$/.test(txid)) {
    throw new Error("P16_CART_MERGE_LOCK_BARRIER_TXID_INVALID")
  }
  process.send({
    type: "lock-acquired",
    runId,
    role,
    customerId: customerId.replace(/[^a-zA-Z0-9_-]/g, "_"),
    txid,
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.removeListener("message", onMessage)
      reject(new Error("P16_CART_MERGE_LOCK_BARRIER_TIMEOUT"))
    }, 30_000)
    const onMessage = (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as { type?: unknown }).type !== "cart-merge-release" ||
        (message as { runId?: unknown }).runId !== runId ||
        (message as { role?: unknown }).role !== role
      ) {
        return
      }
      clearTimeout(timeout)
      process.removeListener("message", onMessage)
      resolve()
    }
    process.on("message", onMessage)
  })
}

function throwConflict(code: string): never {
  throw Object.assign(
    new MedusaError(MedusaError.Types.CONFLICT, code),
    { code, statusCode: 409, status: 409 }
  )
}

function tripFailpoint(request: MergeRequest, point: string): void {
  request.cartMergeFailpoint?.trip(point)
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    throw new Error("CART_MERGE_RECEIPT_JSON_INVALID")
  }
}

function parseReceiptOutcome(value: unknown): CartMergeOutcome {
  if (
    typeof value !== "string" ||
    !(CART_MERGE_OUTCOMES as readonly string[]).includes(value)
  ) {
    throw new Error("CART_MERGE_RECEIPT_OUTCOME_INVALID")
  }
  return value as CartMergeOutcome
}

function mapReceiptRow(row: Record<string, unknown>): CartMergeReceiptRow {
  return {
    id: String(row.id),
    idempotency_record_id: String(row.idempotency_record_id),
    customer_id: String(row.customer_id),
    guest_cart_id: String(row.guest_cart_id),
    customer_cart_id:
      row.customer_cart_id == null ? null : String(row.customer_cart_id),
    canonical_cart_id: String(row.canonical_cart_id),
    capability_id: String(row.capability_id),
    capability_hash:
      row.capability_hash == null ? null : String(row.capability_hash),
    request_fingerprint: String(row.request_fingerprint),
    guest_version_before: Number(row.guest_version_before),
    customer_version_before:
      row.customer_version_before == null
        ? null
        : Number(row.customer_version_before),
    guest_version_after: Number(row.guest_version_after),
    customer_version_after:
      row.customer_version_after == null
        ? null
        : Number(row.customer_version_after),
    outcome: parseReceiptOutcome(row.outcome),
    rejected_items: parseJsonValue(row.rejected_items),
    review_id: row.review_id == null ? null : String(row.review_id),
    review_ref: row.review_ref == null ? null : String(row.review_ref),
    original_public_cart_snapshot: parseJsonValue(
      row.original_public_cart_snapshot
    ),
    original_review_snapshot: parseJsonValue(row.original_review_snapshot),
    original_etag: String(row.original_etag),
    expires_at: row.expires_at as string | Date,
    capability_status:
      row.capability_status == null ? null : String(row.capability_status),
    actor_scope_hash: String(row.actor_scope_hash),
    resource_scope_hash: String(row.resource_scope_hash),
    idempotency_key_hash: String(row.idempotency_key_hash),
    idempotency_operation: String(row.idempotency_operation),
    idempotency_state: String(row.idempotency_state),
    idempotency_result_type:
      row.idempotency_result_type == null
        ? null
        : String(row.idempotency_result_type),
    idempotency_result_id:
      row.idempotency_result_id == null
        ? null
        : String(row.idempotency_result_id),
    idempotency_expires_at:
      row.idempotency_expires_at == null
        ? null
        : (row.idempotency_expires_at as string | Date),
  }
}

function receiptReview(row: CartMergeReceiptRow): CartReviewState {
  const value = parseJsonValue(row.original_review_snapshot)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CART_MERGE_RECEIPT_REVIEW_INVALID")
  }
  return value as CartReviewState
}

function receiptCart(row: CartMergeReceiptRow): StoreCartPreOrderRecord {
  const value = parseJsonValue(row.original_public_cart_snapshot)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CART_MERGE_RECEIPT_CART_INVALID")
  }
  // The receipt stores the already allowlisted public projection. It is cast at
  // this internal boundary so the unchanged HTTP serializer can consume it;
  // replay never refetches or rebuilds this projection from the current Cart.
  return value as StoreCartPreOrderRecord
}

function stableReceiptCart(
  cart: StoreCartPreOrderRecord
): StoreCartPreOrderRecord {
  const publicCart = serializeStoreCartPreOrder(cart)
  if (!publicCart) {
    throwConflict("CART_MERGE_SNAPSHOT_UNAVAILABLE")
  }

  return JSON.parse(JSON.stringify(publicCart)) as StoreCartPreOrderRecord
}

function replayResultFromReceipt(
  receipt: CartMergeReceiptRow
): CartMergeExecutionResult {
  return {
    outcome: receipt.outcome,
    cart: receiptCart(receipt),
    version: receipt.customer_version_after ?? receipt.guest_version_after,
    review: receiptReview(receipt),
  }
}

async function loadCommittedReceipt(
  transaction: TransactionContext,
  input: CartMergeExecutionInput
): Promise<CartMergeReceiptRow | null> {
  const capabilityHash = hashGuestCartCapability(input.presentedCapability)
  const idempotencyKeyHash = hashStoreIdempotencyKey(
    input.rawIdempotencyKey,
    env.STORE_IDEMPOTENCY_KEY_PEPPER
  )
  const actorScopeHash = hashStoreIdempotencyScope({
    actor_type: "customer",
    customer_id: input.customerId,
  })
  const result = await transaction.raw(
    `
      select
        r.*,
        cap.status as capability_status,
        i.actor_scope_hash,
        i.resource_scope_hash,
        i.idempotency_key_hash,
        i.operation as idempotency_operation,
        i.state as idempotency_state,
        i.result_type as idempotency_result_type,
        i.result_id as idempotency_result_id,
        i.expires_at as idempotency_expires_at
      from cart_merge_result r
      join store_idempotency_record i
        on i.id = r.idempotency_record_id
      join guest_cart_capability cap
        on cap.id = r.capability_id
     where r.customer_id = ?
       and r.guest_cart_id = ?
       and r.capability_hash = ?
       and i.operation = ?
       and i.actor_scope_hash = ?
       and i.idempotency_key_hash = ?
       and i.state = 'completed'
       and i.result_type = 'cart_merge'
       and i.result_id = r.id
       and i.request_fingerprint = r.request_fingerprint
       and i.expires_at = r.expires_at
       and i.expires_at > ?
       and i.deleted_at is null
       and r.deleted_at is null
       and cap.deleted_at is null
     order by r.created_at desc
     limit 1
    `,
    [
      input.customerId,
      input.guestCartId,
      capabilityHash,
      STORE_IDEMPOTENCY_CART_MERGE,
      actorScopeHash,
      idempotencyKeyHash,
      new Date().toISOString(),
    ]
  )
  const row = requireRows(result)[0]
  if (!row) {
    return null
  }

  const receipt = mapReceiptRow(row)
  const expectedResourceScopeHash = hashStoreIdempotencyScope({
    resource_type: "cart_merge",
    guest_cart_id: input.guestCartId,
    customer_cart_id: receipt.customer_cart_id,
    capability_id: receipt.capability_id,
  })
  if (
    receipt.idempotency_operation !== STORE_IDEMPOTENCY_CART_MERGE ||
    receipt.idempotency_state !== "completed" ||
    receipt.idempotency_result_id !== receipt.id ||
    receipt.capability_hash === null ||
    !fingerprintsMatch(receipt.capability_hash, capabilityHash) ||
    !fingerprintsMatch(receipt.actor_scope_hash, actorScopeHash) ||
    !fingerprintsMatch(receipt.idempotency_key_hash, idempotencyKeyHash) ||
    !fingerprintsMatch(
      receipt.resource_scope_hash,
      expectedResourceScopeHash
    ) ||
    receipt.idempotency_expires_at === null
  ) {
    return null
  }

  return receipt
}

async function replayCommittedReceipt(
  request: MergeRequest,
  sharedContext: StoreResourceVersionMutationContext,
  capabilityService: {
    lookupConsumedGuestCartCapabilityForReplay(input: {
      presentedToken: string
      cartId: string
      bffAuthorized: boolean
      customerAuthorized: boolean
      binding: GuestCartCapabilityReplayBinding
      sharedContext: GuestCartCapabilityMutationContext
      now?: Date
    }): Promise<unknown>
  },
  input: CartMergeExecutionInput,
  receipt: CartMergeReceiptRow
): Promise<CartMergeExecutionResult> {
  if (input.expectedGuestVersion !== receipt.guest_version_before) {
    throwConflict("IDEMPOTENCY_KEY_REUSE_CONFLICT")
  }

  if (receipt.capability_status === "consumed") {
    const replay = (await capabilityService.lookupConsumedGuestCartCapabilityForReplay(
      {
        presentedToken: input.presentedCapability,
        cartId: input.guestCartId,
        bffAuthorized: request.customerAuthBff?.authorized === true,
        customerAuthorized: true,
        binding: {
          customerId: receipt.customer_id,
          guestCartId: receipt.guest_cart_id,
          customerCartId: receipt.customer_cart_id,
          operation: receipt.idempotency_operation,
          actorScopeHash: receipt.actor_scope_hash,
          resourceScopeHash: receipt.resource_scope_hash,
          idempotencyKeyHash: receipt.idempotency_key_hash,
          idempotencyRecordId: receipt.idempotency_record_id,
          requestFingerprint: receipt.request_fingerprint,
          resultId: receipt.id,
          resultType: receipt.idempotency_result_type ?? "cart_merge",
          capabilityHash: receipt.capability_hash ?? "",
          expiresAt: receipt.expires_at,
        },
        sharedContext: sharedContext as GuestCartCapabilityMutationContext,
        now: new Date(),
      }
    )) as { result?: { id?: string } } | null
    if (!replay || replay.result?.id !== receipt.id) {
      throwConflict("IDEMPOTENCY_KEY_REUSE_CONFLICT")
    }
  }

  return replayResultFromReceipt(receipt)
}

function createCartMergeReviewIdentity(): CartMergeReviewIdentity {
  return {
    id: generateEntityId(undefined, "cmrev"),
    reviewRef: `review_${randomBytes(24).toString("base64url")}`,
  }
}

async function insertCartReview(
  transaction: TransactionContext,
  input: {
    id: string
    cartId: string
    reviewRef: string
    mergeResultId: string
    producedCartVersion: number
    rejectedItems: unknown
  }
): Promise<void> {
  await transaction.raw(
    `
      insert into cart_review (
        id, cart_id, review_ref, merge_result_id, produced_cart_version,
        status, rejected_items
      ) values (?, ?, ?, ?, ?, 'pending', cast(? as jsonb))
    `,
    [
      input.id,
      input.cartId,
      input.reviewRef,
      input.mergeResultId,
      input.producedCartVersion,
      JSON.stringify(input.rejectedItems),
    ]
  )
}

async function insertCartMergeResult(
  transaction: TransactionContext,
  input: {
    id?: string
    idempotencyRecordId: string
    customerId: string
    guestCartId: string
    customerCartId: string | null
    canonicalCartId: string
    capabilityId: string
    capabilityHash: string | null
    requestFingerprint: string
    guestVersionBefore: number
    customerVersionBefore: number | null
    guestVersionAfter: number
    customerVersionAfter: number | null
    outcome: CartMergeOutcome
    rejectedItems: unknown
    reviewId: string | null
    reviewRef: string | null
    originalPublicCartSnapshot: unknown
    originalReviewSnapshot: CartReviewState
    originalEtag: string
    expiresAt: Date
  }
): Promise<string> {
  const id = input.id ?? generateEntityId(undefined, "cmres")
  await transaction.raw(
    `
      insert into cart_merge_result (
        id, idempotency_record_id, customer_id, guest_cart_id,
        customer_cart_id, canonical_cart_id, capability_id, capability_hash,
        request_fingerprint, guest_version_before, customer_version_before,
        guest_version_after, customer_version_after, outcome, rejected_items,
        review_id, review_ref, original_public_cart_snapshot,
        original_review_snapshot, original_etag, expires_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, cast(? as jsonb), ?, ?,
                cast(? as jsonb), cast(? as jsonb), ?, ?)
    `,
    [
      id,
      input.idempotencyRecordId,
      input.customerId,
      input.guestCartId,
      input.customerCartId,
      input.canonicalCartId,
      input.capabilityId,
      input.capabilityHash,
      input.requestFingerprint,
      input.guestVersionBefore,
      input.customerVersionBefore,
      input.guestVersionAfter,
      input.customerVersionAfter,
      input.outcome,
      JSON.stringify(input.rejectedItems),
      input.reviewId,
      input.reviewRef,
      JSON.stringify(input.originalPublicCartSnapshot),
      JSON.stringify(input.originalReviewSnapshot),
      input.originalEtag,
      input.expiresAt.toISOString(),
    ]
  )
  return id
}

async function insertCustomerCartAuthority(
  transaction: TransactionContext,
  customerId: string,
  cartId: string
): Promise<void> {
  await transaction.raw(
    `
      insert into customer_cart_authority (id, customer_id, cart_id, state)
      values (?, ?, ?, 'active')
    `,
    [generateEntityId(undefined, "ccauth"), customerId, cartId]
  )
}

/**
 * Keep the merge service compatible with the narrow HTTP tracer double used by
 * the existing route contract while preferring the canonical facade in real
 * Medusa wiring.
 */
async function completeStoreIdempotencyCompat(
  service: StoreIdempotencyModuleService,
  input: Parameters<StoreIdempotencyModuleService["completeStoreIdempotency"]>[0]
) {
  const candidate = service as StoreIdempotencyModuleService & {
    completeStoreIdempotency?: StoreIdempotencyModuleService["completeStoreIdempotency"]
  }
  if (typeof candidate.completeStoreIdempotency === "function") {
    return candidate.completeStoreIdempotency(input)
  }

  return service.markCompleted({
    id: input.id,
    expectedState: input.expectedState,
    expectedStateVersion: input.expectedStateVersion,
    result_type: input.resultBinding.resultType,
    result_id: input.resultBinding.resultId,
    response_status: input.responseStatus,
    result_safe_metadata: input.resultSafeMetadata,
    sharedContext: input.sharedContext,
    retentionMs: input.retentionMs,
    at: input.at,
  })
}

class CartMergeModuleService extends MedusaService({
  CustomerCartAuthority,
  CartMergeResult,
  CartReview,
}) {
  async executeCartMerge(
    input: CartMergeExecutionInput
  ): Promise<CartMergeExecutionResult> {
    const request = input.request as MergeRequest
    if (request.customerAuthBff?.authorized !== true) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
    }

    const capabilityService = request.scope.resolve<any>(
      GUEST_CART_CAPABILITY_MODULE
    )
    const cartModule = request.scope.resolve<CartModule>(Modules.CART)
    const transaction = cartModule.baseRepository_?.transaction
    if (typeof transaction !== "function") {
      throw new Error("CART_TRANSACTION_AUTHORITY_UNAVAILABLE")
    }

    return transaction.call(cartModule.baseRepository_, async (manager) => {
      const transactionContext = manager.getTransactionContext?.()
      if (!transactionContext) {
        throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
      }

      const sharedContext = currentVersionContext(manager)
      const operationAt = new Date()

      // Every merge path enters the shared Customer lock first. A committed
      // replay is receipt-authoritative and must not be rejected by a later
      // authority/candidate anomaly.
      await lockCustomerCartAuthority(transactionContext, input.customerId)
      await awaitCartMergeCustomerLockBarrier(
        transactionContext,
        input.customerId
      )

      // Replay is resolved before reading the current Cart. This is essential
      // after capability consumption, ACK, or a later fixture mutation: the
      // receipt is the sole source of the response projection.
      const committedReceipt = await loadCommittedReceipt(
        transactionContext,
        input
      )
      if (committedReceipt) {
        return replayCommittedReceipt(
          request,
          sharedContext,
          capabilityService,
          input,
          committedReceipt
        )
      }

      const customerAuthority = await resolveCanonicalCustomerCartAuthority(
        sharedContext as unknown as CustomerCartAuthoritySharedContext,
        input.customerId
      )

      if (
        customerAuthority.type === "ambiguous" ||
        customerAuthority.type === "conflict"
      ) {
        throwConflict("CUSTOMER_CART_AUTHORITY_CONFLICT")
      }
      const customerCartId =
        customerAuthority.type === "single"
          ? customerAuthority.cartId
          : null

      await lockCartRows(
        transactionContext,
        [input.guestCartId, ...(customerCartId ? [customerCartId] : [])]
      )
      await assertNoPendingCartReview(
        transactionContext,
        [input.guestCartId, ...(customerCartId ? [customerCartId] : [])]
      )

      const preflightCapability = (await capabilityService.lookupGuestCartCapabilityByPresentedToken(
        input.presentedCapability,
        { touch: false, cart_id: input.guestCartId },
        sharedContext as GuestCartCapabilityMutationContext
      )) as GuestCartCapabilityRecord

      if (preflightCapability.cart_id !== input.guestCartId) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
      }

      const versionService = request.scope.resolve<StoreResourceVersionModuleService>(
        STORE_RESOURCE_VERSION_MODULE
      )
      const guestVersionRow = await versionService.initialize(
        "cart",
        input.guestCartId,
        sharedContext
      )
      const customerVersionRow = customerCartId
        ? await versionService.initialize("cart", customerCartId, sharedContext)
        : null

      const guestCart = await retrieveMergeCart(
        cartModule,
        input.guestCartId,
        sharedContext
      )
      const customerCart = customerCartId
        ? await retrieveMergeCart(cartModule, customerCartId, sharedContext)
        : null

      if (!guestCart || !isActiveGuestCart(guestCart)) {
        throwConflict("CART_MERGE_GUEST_CART_UNSUPPORTED")
      }
      assertNoPaymentOrOrderFields(guestCart)

      if (
        customerCartId &&
        (!customerCart || !isActiveCustomerCart(customerCart, input.customerId))
      ) {
        throwConflict("CUSTOMER_CART_AUTHORITY_CONFLICT")
      }
      if (customerCart) {
        assertNoPaymentOrOrderFields(customerCart)
      }

      if (guestVersionRow.version !== input.expectedGuestVersion) {
        throw new CartVersionMismatchError(guestCart, guestVersionRow.version)
      }

      let decision: CartMergeDecision
      try {
        const variantAvailability = persistedVariantAvailability(guestCart)
        decision = buildCartMergeDecision(
          customerCart
            ? {
                guestCart,
                customerCart,
                variantAvailability,
              }
            : {
                guestCart,
                variantAvailability,
              }
        )
      } catch (error) {
        if (error instanceof CartMergeStateConflictError) {
          throwConflict("CART_MERGE_STATE_CONFLICT")
        }
        throw error
      }

      const idempotencyService = request.scope.resolve<StoreIdempotencyModuleService>(
        STORE_IDEMPOTENCY_MODULE
      )
      const canonicalSemanticObject = {
        operation: CART_MERGE_FINGERPRINT_OPERATION,
        customerId: input.customerId,
        guestCartId: input.guestCartId,
        customerCartId,
        guestVersion: guestVersionRow.version,
        customerVersion: customerVersionRow?.version ?? null,
        normalizedGuestIntent: decision.normalizedGuestIntent,
      }
      const claim = await idempotencyService.claim({
        operation: STORE_IDEMPOTENCY_CART_MERGE,
        actorScope: {
          actor_type: "customer",
          customer_id: input.customerId,
        },
        resourceScope: {
          resource_type: "cart_merge",
          guest_cart_id: input.guestCartId,
          customer_cart_id: customerCartId,
          capability_id: preflightCapability.id,
        },
        rawIdempotencyKey: input.rawIdempotencyKey,
        canonicalSemanticObject,
        sharedContext,
        at: operationAt,
      })

      if (claim.type === "conflict") {
        throw Object.assign(
          new MedusaError(
            MedusaError.Types.CONFLICT,
            "Idempotency key reuse conflict"
          ),
          { code: claim.publicCode, statusCode: 409, status: 409 }
        )
      }
      if (claim.type === "in_progress") {
        throw Object.assign(
          new MedusaError(
            MedusaError.Types.CONFLICT,
            "Operation currently in progress"
          ),
          { code: "IDEMPOTENCY_KEY_IN_PROGRESS", statusCode: 409, status: 409 }
        )
      }
      if (claim.type === "replay") {
        throwConflict("IDEMPOTENCY_KEY_REUSE_CONFLICT")
      }

      const requestFingerprint = buildStoreIdempotencyRequestFingerprint(
        canonicalSemanticObject
      )
      const expiresAt = new Date(
        operationAt.getTime() + STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS
      )

      if (decision.outcome === "NO_ITEMS") {
        const canonicalCart = customerCart ?? guestCart
        const canonicalVersion =
          customerVersionRow?.version ?? guestVersionRow.version
        const originalPublicCartSnapshot = stableReceiptCart(canonicalCart)

        const resultId = await insertCartMergeResult(transactionContext, {
          idempotencyRecordId: claim.record.id,
          customerId: input.customerId,
          guestCartId: input.guestCartId,
          customerCartId,
          canonicalCartId: canonicalCart.id,
          capabilityId: preflightCapability.id,
          capabilityHash: preflightCapability.token_hash,
          requestFingerprint,
          guestVersionBefore: guestVersionRow.version,
          customerVersionBefore: customerVersionRow?.version ?? null,
          guestVersionAfter: guestVersionRow.version,
          customerVersionAfter: customerVersionRow?.version ?? null,
          outcome: decision.outcome,
          rejectedItems: decision.rejectedItems,
          reviewId: null,
          reviewRef: null,
          originalPublicCartSnapshot,
          originalReviewSnapshot: decision.review,
          originalEtag: formatCartEtag(canonicalVersion),
          expiresAt,
        })
        tripFailpoint(request, "result")

        const completion = await completeStoreIdempotencyCompat(idempotencyService, {
          id: claim.record.id,
          expectedState: "processing",
          expectedStateVersion: claim.record.state_version,
          resultBinding: {
            idempotencyRecordId: claim.record.id,
            resultId,
            resultType: "cart_merge",
            expiresAt,
          },
          responseStatus: 200,
          resultSafeMetadata: {
            operation: STORE_IDEMPOTENCY_CART_MERGE,
            result_type: "cart_merge",
            result_id: resultId,
            response_status: 200,
          },
          sharedContext,
          retentionMs: STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
          at: operationAt,
        })
        if (completion.type !== "claimed") {
          throwConflict("IDEMPOTENCY_KEY_IN_PROGRESS")
        }
        tripFailpoint(request, "idempotency_completion")

        return {
          outcome: decision.outcome,
          cart: originalPublicCartSnapshot,
          version: canonicalVersion,
          review: decision.review,
        }
      }

      await capabilityService.authorizeGuestCartCapabilityForMutation(
        input.presentedCapability,
        input.guestCartId,
        { now: operationAt },
        sharedContext as GuestCartCapabilityMutationContext
      )

      const acceptedQuantities = new Map(
        decision.acceptedItems.map((item) => [item.variantId, item.quantity])
      )
      let guestVersionAfter = guestVersionRow.version
      let customerVersionAfter = customerVersionRow?.version ?? null

      if (customerCart) {
        await applyAcceptedCustomerItems(
          request,
          cartModule,
          customerCart,
          decision,
          sharedContext
        )

        const superseded = markCartSupersededInput(guestCart, {
          supersededByCartId: customerCart.id,
          supersededAt: operationAt.toISOString(),
        })
        await updateCartWithContext(
          cartModule,
          { id: guestCart.id },
          { metadata: superseded.metadata },
          sharedContext
        )
        tripFailpoint(request, "supersede")
      } else {
        await applyAcceptedItemsToCart(
          request,
          cartModule,
          guestCart,
          (variantId) => acceptedQuantities.get(variantId) ?? 0,
          sharedContext
        )
        await updateCartWithContext(
          cartModule,
          { id: guestCart.id },
          { customer_id: input.customerId },
          sharedContext
        )
      }
      tripFailpoint(request, "cart")

      const affectedCartIds = [
        guestCart.id,
        ...(customerCart ? [customerCart.id] : []),
      ].sort()
      for (const cartId of affectedCartIds) {
        await applyStructuralCartInvalidation(cartId, operationAt, {
          transaction: transactionContext,
        })
      }
      tripFailpoint(request, "invalidation")

      for (const cartId of affectedCartIds) {
        const versionBefore =
          cartId === guestCart.id
            ? guestVersionRow.version
            : customerVersionRow?.version
        const cartBefore =
          cartId === guestCart.id ? guestCart : customerCart
        if (versionBefore === undefined || versionBefore === null || !cartBefore) {
          throw new Error("CART_MERGE_VERSION_STATE_UNAVAILABLE")
        }

        const bumped = await versionService.increment(
          "cart",
          cartId,
          versionBefore,
          sharedContext
        )
        if (bumped.type !== "updated") {
          throw new CartVersionMismatchError(cartBefore, bumped.actualVersion)
        }
        if (cartId === guestCart.id) {
          guestVersionAfter = bumped.version
        } else {
          customerVersionAfter = bumped.version
        }
      }
      tripFailpoint(request, "version")

      if (!customerCart) {
        await insertCustomerCartAuthority(
          transactionContext,
          input.customerId,
          guestCart.id
        )
      }
      tripFailpoint(request, "association")

      const canonicalCartId = customerCart?.id ?? guestCart.id
      const snapshot = await retrieveMergeCart(
        cartModule,
        canonicalCartId,
        sharedContext
      )
      if (!snapshot) throwConflict("CART_MERGE_SNAPSHOT_UNAVAILABLE")
      assertNoPaymentOrOrderFields(snapshot)
      const originalPublicCartSnapshot = stableReceiptCart(snapshot)

      const reviewIdentity =
        decision.outcome === "MERGED_PARTIAL"
          ? createCartMergeReviewIdentity()
          : null
      const review: CartReviewState = reviewIdentity
        ? {
            ...decision.review,
            reviewRef: reviewIdentity.reviewRef,
          }
        : decision.review
      const canonicalVersion = customerCart
        ? customerVersionAfter
        : guestVersionAfter
      if (canonicalVersion === null) {
        throw new Error("CART_MERGE_CANONICAL_VERSION_UNAVAILABLE")
      }
      const resultId = generateEntityId(undefined, "cmres")

      await insertCartMergeResult(transactionContext, {
        id: resultId,
        idempotencyRecordId: claim.record.id,
        customerId: input.customerId,
        guestCartId: input.guestCartId,
        customerCartId,
        canonicalCartId,
        capabilityId: preflightCapability.id,
        capabilityHash: preflightCapability.token_hash,
        requestFingerprint,
        guestVersionBefore: guestVersionRow.version,
        customerVersionBefore: customerVersionRow?.version ?? null,
        guestVersionAfter,
        customerVersionAfter,
        outcome: decision.outcome,
        rejectedItems: decision.rejectedItems,
        reviewId: reviewIdentity?.id ?? null,
        reviewRef: reviewIdentity?.reviewRef ?? null,
        originalPublicCartSnapshot,
        originalReviewSnapshot: review,
        originalEtag: formatCartEtag(canonicalVersion),
        expiresAt,
      })
      tripFailpoint(request, "result")

      if (reviewIdentity) {
        await insertCartReview(transactionContext, {
          id: reviewIdentity.id,
          cartId: canonicalCartId,
          reviewRef: reviewIdentity.reviewRef,
          mergeResultId: resultId,
          producedCartVersion: canonicalVersion,
          rejectedItems: decision.rejectedItems,
        })
        tripFailpoint(request, "review")
      }

      await capabilityService.consumeGuestCartCapability(
        preflightCapability.id,
        { now: operationAt },
        sharedContext as GuestCartCapabilityMutationContext
      )
      tripFailpoint(request, "capability_consume")

      const completion = await completeStoreIdempotencyCompat(idempotencyService, {
        id: claim.record.id,
        expectedState: "processing",
        expectedStateVersion: claim.record.state_version,
        resultBinding: {
          idempotencyRecordId: claim.record.id,
          resultId,
          resultType: "cart_merge",
          expiresAt,
        },
        responseStatus: 200,
        resultSafeMetadata: {
          operation: STORE_IDEMPOTENCY_CART_MERGE,
          result_type: "cart_merge",
          result_id: resultId,
          response_status: 200,
        },
        sharedContext,
        retentionMs: STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
        at: operationAt,
      })
      if (completion.type !== "claimed") {
        throwConflict("IDEMPOTENCY_KEY_IN_PROGRESS")
      }
      tripFailpoint(request, "idempotency_completion")

      return {
        outcome: decision.outcome,
        cart: originalPublicCartSnapshot,
        version: canonicalVersion,
        review,
      }
    })
  }
}

export { CartMergeModuleService }
export default CartMergeModuleService
