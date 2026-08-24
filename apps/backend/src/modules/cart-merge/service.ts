import type { MedusaRequest } from "@medusajs/framework/http"
import {
  MedusaError,
  MedusaService,
  Modules,
} from "@medusajs/framework/utils"
import {
  applyStructuralCartInvalidation,
} from "../checkout/shipping-invalidation"
import {
  assertNoPaymentOrOrderFields,
} from "../checkout/active-cart"
import {
  CartVersionMismatchError,
} from "../../api/store/carts/concurrency"
import type { StoreCartPreOrderRecord } from "../../api/store/carts/serializers"
import {
  STORE_IDEMPOTENCY_CART_MERGE,
  STORE_IDEMPOTENCY_MODULE,
  type StoreIdempotencyModuleService,
} from "../store-idempotency"
import {
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityRecord,
  type GuestCartCapabilityMutationContext,
} from "../guest-cart-capability"
import {
  STORE_RESOURCE_VERSION_MODULE,
  type StoreResourceVersionModuleService,
  type StoreResourceVersionMutationContext,
} from "../store-resource-version"
import { lockCartOrderAuthority } from "../payment-attempt/transactional-authority"

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

export type CartMergeExecutionInput = {
  request: MedusaRequest
  customerId: string
  guestCartId: string
  presentedCapability: string
  rawIdempotencyKey: string
  expectedGuestVersion: number
}

export type CartMergeExecutionResult = {
  outcome: "GUEST_CART_ATTACHED"
  cart: StoreCartPreOrderRecord
  version: number
}

type MergeRequest = MedusaRequest & {
  customerAuthBff?: { authorized?: boolean }
}

function cartMergeCartRetrieveConfig(): { relations: string[] } {
  return {
    relations: ["items", "customer"],
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

function readId(row: Record<string, unknown>): string {
  return typeof row.id === "string" ? row.id : String(row.id)
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

function normalizeGuestIntent(cart: StoreCartPreOrderRecord): Array<{
  variantId: string
  quantity: number
}> {
  const quantities = new Map<string, number>()
  for (const item of cart.items ?? []) {
    if (
      typeof item.variant_id !== "string" ||
      item.variant_id.trim().length === 0 ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      (item.quantity as number) <= 0
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "CART_MERGE_GUEST_INTENT_INVALID"
      )
    }
    const variantId = item.variant_id.trim()
    quantities.set(
      variantId,
      (quantities.get(variantId) ?? 0) + item.quantity
    )
  }

  const intent = [...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variantId, quantity]) => ({ variantId, quantity }))

  if (intent.length === 0) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "CART_MERGE_GUEST_INTENT_EMPTY"
    )
  }

  return intent
}

async function lockCustomerScope(
  transaction: TransactionContext,
  customerId: string
): Promise<void> {
  await transaction.raw(
    "select pg_advisory_xact_lock(hashtextextended(?, 1616))",
    [customerId]
  )
}

async function listCustomerCartIds(
  transaction: TransactionContext,
  customerId: string
): Promise<string[]> {
  const result = await transaction.raw(
    `
      select id
      from cart
      where customer_id = ? and completed_at is null and deleted_at is null
      order by id
    `,
    [customerId]
  )
  return requireRows(result).map(readId)
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

function throwConflict(code: string): never {
  throw Object.assign(
    new MedusaError(MedusaError.Types.CONFLICT, code),
    { code, statusCode: 409, status: 409 }
  )
}

class CartMergeModuleService extends MedusaService({}) {
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
    const preflightCapability = (await capabilityService.lookupGuestCartCapabilityByPresentedToken(
      input.presentedCapability,
      { touch: false, cart_id: input.guestCartId }
    )) as GuestCartCapabilityRecord

    if (preflightCapability.cart_id !== input.guestCartId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
    }

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

      await lockCustomerScope(transactionContext, input.customerId)
      const customerCartIds = await listCustomerCartIds(
        transactionContext,
        input.customerId
      )

      // Destination selection and all non-tracer outcomes belong to later
      // plans. Never turn this fail-closed branch into CUSTOMER_CART_PRESERVED.
      if (customerCartIds.length > 0) {
        throwConflict("CART_MERGE_CUSTOMER_DESTINATION_UNSUPPORTED")
      }

      await lockCartRows(transactionContext, [input.guestCartId])
      const sharedContext = currentVersionContext(manager)
      const versionService = request.scope.resolve<StoreResourceVersionModuleService>(
        STORE_RESOURCE_VERSION_MODULE
      )
      const versionRow = await versionService.initialize(
        "cart",
        input.guestCartId,
        sharedContext
      )

      const cart = cartModule.retrieveCart
        ? projectCartCustomer(
            await cartModule.retrieveCart(
              input.guestCartId,
              cartMergeCartRetrieveConfig(),
              sharedContext
            )
          )
        : null
      if (!cart || !isActiveGuestCart(cart)) {
        throwConflict("CART_MERGE_GUEST_CART_UNSUPPORTED")
      }
      assertNoPaymentOrOrderFields(cart)

      if (versionRow.version !== input.expectedGuestVersion) {
        throw new CartVersionMismatchError(cart, versionRow.version)
      }

      await capabilityService.authorizeGuestCartCapabilityForMutation(
        input.presentedCapability,
        input.guestCartId,
        { now: new Date() },
        sharedContext as GuestCartCapabilityMutationContext
      )

      const normalizedGuestIntent = normalizeGuestIntent(cart)
      const idempotencyService = request.scope.resolve<StoreIdempotencyModuleService>(
        STORE_IDEMPOTENCY_MODULE
      )
      const claim = await idempotencyService.claim({
        operation: STORE_IDEMPOTENCY_CART_MERGE,
        actorScope: {
          actor_type: "customer",
          customer_id: input.customerId,
        },
        resourceScope: {
          resource_type: "cart_merge",
          guest_cart_id: input.guestCartId,
          customer_cart_id: null,
          capability_id: preflightCapability.id,
        },
        rawIdempotencyKey: input.rawIdempotencyKey,
        canonicalSemanticObject: {
          operation: CART_MERGE_FINGERPRINT_OPERATION,
          customerId: input.customerId,
          guestCartId: input.guestCartId,
          customerCartId: null,
          guestVersion: versionRow.version,
          customerVersion: null,
          normalizedGuestIntent,
        },
        sharedContext,
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
        if (claim.record.state === "completed" && claim.record.result_id) {
          const replayCart = cartModule.retrieveCart
            ? projectCartCustomer(
                await cartModule.retrieveCart(
                  claim.record.result_id,
                  cartMergeCartRetrieveConfig(),
                  sharedContext
                )
              )
            : null
          if (!replayCart) throwConflict("CART_MERGE_REPLAY_UNAVAILABLE")
          return {
            outcome: "GUEST_CART_ATTACHED",
            cart: replayCart,
            version: versionRow.version,
          }
        }
        throwConflict("IDEMPOTENCY_KEY_REUSE_CONFLICT")
      }

      if (typeof cartModule.updateCarts !== "function") {
        throw new Error("CART_UPDATE_AUTHORITY_UNAVAILABLE")
      }
      if (cartModule.updateCarts.length === 1) {
        await cartModule.updateCarts(
          { id: input.guestCartId, customer_id: input.customerId },
          sharedContext
        )
      } else {
        await cartModule.updateCarts(
          { id: input.guestCartId },
          { customer_id: input.customerId },
          sharedContext
        )
      }

      await applyStructuralCartInvalidation(
        input.guestCartId,
        new Date(),
        { transaction: transactionContext }
      )

      const bumped = await versionService.increment(
        "cart",
        input.guestCartId,
        versionRow.version,
        sharedContext
      )
      if (bumped.type !== "updated") {
        throw new CartVersionMismatchError(cart, bumped.actualVersion)
      }

      await capabilityService.consumeGuestCartCapability(
        preflightCapability.id,
        { now: new Date() },
        sharedContext as GuestCartCapabilityMutationContext
      )

      const completion = await idempotencyService.markCompleted({
        id: claim.record.id,
        expectedState: "processing",
        expectedStateVersion: claim.record.state_version,
        result_type: "cart_merge",
        result_id: input.guestCartId,
        response_status: 200,
        result_safe_metadata: {
          operation: STORE_IDEMPOTENCY_CART_MERGE,
          result_type: "cart_merge",
          result_id: input.guestCartId,
          response_status: 200,
        },
        sharedContext,
      })
      if (completion.type !== "claimed") {
        throwConflict("IDEMPOTENCY_KEY_IN_PROGRESS")
      }

      const snapshot = cartModule.retrieveCart
        ? projectCartCustomer(
            await cartModule.retrieveCart(
              input.guestCartId,
              cartMergeCartRetrieveConfig(),
              sharedContext
            )
          )
        : null
      if (!snapshot) throwConflict("CART_MERGE_SNAPSHOT_UNAVAILABLE")
      assertNoPaymentOrOrderFields(snapshot)

      return {
        outcome: "GUEST_CART_ATTACHED",
        cart: snapshot,
        version: bumped.version,
      }
    })
  }
}

export { CartMergeModuleService }
export default CartMergeModuleService
