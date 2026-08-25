import {
  addToCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { asValue } from "@medusajs/framework/awilix"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  MedusaContext,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  applyStructuralCartInvalidation,
} from "../../../modules/checkout/shipping-invalidation"
import { lockCartOrderAuthority } from "../../../modules/payment-attempt/transactional-authority"
import {
  assertNoPaymentOrOrderFields,
  resolveM1CartActor,
  type M1CartActorDecision,
} from "../../../modules/checkout/active-cart"
import {
  authorizeCustomerAuthAccess,
  createKnexCustomerAuthAccessDatabase,
  type CustomerAuthAccessContext,
} from "../../../modules/customer-auth/access-guard"
import { env } from "../../../config/env"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../../modules/guest-cart-capability/types"
import type GuestCartCapabilityModuleService from "../../../modules/guest-cart-capability/service"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_CLEAR,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_DELETE,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE,
  assertValidRawIdempotencyKey,
  type LifecycleClaimResult,
  type StoreIdempotencyModuleService,
} from "../../../modules/store-idempotency"
import {
  STORE_RESOURCE_VERSION_MODULE,
  type StoreResourceVersionModuleService,
  type StoreResourceVersionMutationContext,
} from "../../../modules/store-resource-version"
import { assertNoPendingCartReview } from "../../../modules/cart-merge/review-guard"
import {
  cartResourceScope,
  customerActorScope,
  guestCartCapabilityActorScope,
} from "./idempotency-scope"
import {
  CartVersionMismatchError,
  formatCartEtag,
  initializeCartResourceVersion,
  requireIfMatch,
} from "./concurrency"
import { resolveCanonicalCustomerActiveCart } from "./customer-active-cart"
import {
  parseAddCartLineItemBody,
  parseUpdateCartLineItemBody,
  type AddCartLineItemBody,
  type UpdateCartLineItemBody,
} from "./line-items/validators"
import { storeCartPreOrderFields } from "./query-config"
import type { StoreCartPreOrderRecord } from "./serializers"
import type {
  KnexLike,
  TransactionalManagerLike,
} from "../../../infrastructure/store-foundation-transaction-compatibility"

export type LineItemMutationKind = "add" | "update" | "delete" | "clear"

type RequestWithCustomerAuth = MedusaRequest & {
  customerAuth?: CustomerAuthAccessContext
}

type TransactionManager = TransactionalManagerLike

type CartModuleForTransactionalMutation = {
  baseRepository_?: {
    transaction<T>(callback: (manager: TransactionManager) => Promise<T>): Promise<T>
  }
  [key: string]: unknown
}

type CartMutationSnapshot = {
  cart: StoreCartPreOrderRecord
  version: number
}

type CartMutationRequest = MedusaRequest & {
  params: {
    id: string
    line_id?: string
  }
}

type LineItemMutationExecution =
  | {
      type: "completed"
      snapshot: CartMutationSnapshot
    }
  | {
      type: "failed"
      error: unknown
    }
  | {
      type: "not_found"
    }

function notFound(): never {
  throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
}

function isActiveCart(cart: StoreCartPreOrderRecord): boolean {
  const metadata = cart.metadata
  return (
    !cart.completed_at &&
    (!metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      (metadata as Record<string, unknown>).active_for_checkout !== false)
  )
}

function readHeaderString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 && typeof value[0] === "string" ? value[0] : null
  }
  return typeof value === "string" ? value : null
}

async function resolveActor(req: CartMutationRequest): Promise<M1CartActorDecision> {
  const guestCapabilityService = req.scope.resolve<GuestCartCapabilityModuleService>(
    GUEST_CART_CAPABILITY_MODULE
  )
  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as {
    raw(
      sql: string,
      bindings?: unknown[]
    ): Promise<{ rows?: Array<Record<string, unknown>> }>
  }
  const request = req as RequestWithCustomerAuth

  return resolveM1CartActor({
    guestCapabilityHeader: req.headers[GUEST_CART_CAPABILITY_HEADER],
    authorizationHeader: req.headers.authorization,
    customerAuthContext: request.customerAuth,
    lookupGuestCapability: (token: string) =>
      // Preflight only. Final authorization and touch happen inside the
      // mutation transaction immediately before CAS/workflow execution.
      guestCapabilityService.lookupGuestCartCapabilityByPresentedToken(token, {
        touch: false,
      }),
    authorizeCustomerAccess: (authorization: string) =>
      authorizeCustomerAuthAccess(
        createKnexCustomerAuthAccessDatabase(pgConnection),
        authorization,
        { jwtSecret: env.JWT_SECRET }
      ),
  })
}

function throwActorError(actor: M1CartActorDecision): void {
  if (actor.actorType === "invalid_guest_capability") {
    notFound()
  }

  if (actor.actorType === "customer_auth_denied") {
    if (actor.statusCode === 503) {
      throw Object.assign(
        new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Customer authentication authority temporarily unavailable"
        ),
        { statusCode: 503, status: 503 }
      )
    }
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Customer authentication failed"
    )
  }

  if (actor.actorType === "guest_anonymous") {
    notFound()
  }
}

async function refetchCart(
  req: MedusaRequest,
  cartId: string
): Promise<StoreCartPreOrderRecord> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id: cartId } },
    fields: [...storeCartPreOrderFields],
  })
  const [cart] = (await remoteQuery(queryObject)) as StoreCartPreOrderRecord[]
  if (!cart || !isActiveCart(cart)) {
    notFound()
  }
  assertNoPaymentOrOrderFields(cart)
  return cart
}

function assertActorOwnsCart(
  actor: Extract<M1CartActorDecision, { actorType: "guest" | "customer" }>,
  cart: StoreCartPreOrderRecord
): void {
  if (!isActiveCart(cart)) {
    notFound()
  }

  if (actor.actorType === "guest") {
    if (cart.id !== actor.cartId) {
      notFound()
    }
    if (cart.customer?.id) {
      notFound()
    }
    return
  }

  if (cart.customer?.id !== actor.customerId) {
    notFound()
  }
}

function lineItemOperation(kind: LineItemMutationKind): string {
  switch (kind) {
    case "add":
      return STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD
    case "update":
      return STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE
    case "delete":
      return STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_DELETE
    case "clear":
      return STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_CLEAR
  }
}

function parseMutationBody(
  kind: LineItemMutationKind,
  body: unknown
): AddCartLineItemBody | UpdateCartLineItemBody | undefined {
  if (kind === "add") {
    return parseAddCartLineItemBody(body)
  }
  if (kind === "update") {
    return parseUpdateCartLineItemBody(body)
  }
  return undefined
}

function requireLineId(req: CartMutationRequest): string {
  const lineId = req.params.line_id
  if (typeof lineId !== "string" || lineId.trim().length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid value")
  }
  return lineId
}

function idempotencyKey(req: CartMutationRequest): string {
  const raw = readHeaderString(req.headers["idempotency-key"])
  if (!raw || raw.trim().length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key header is required"
    )
  }
  assertValidRawIdempotencyKey(raw)
  return raw
}

function currentActorScope(
  actor: Extract<M1CartActorDecision, { actorType: "guest" | "customer" }>
) {
  return actor.actorType === "guest"
    ? guestCartCapabilityActorScope({ tokenHash: actor.capabilityRecord.token_hash })
    : customerActorScope({ customerId: actor.customerId })
}

function currentVersionContext(
  transactionManager: TransactionManager
): StoreResourceVersionMutationContext {
  return {
    __type: "MedusaContext",
    // Keep the exact MikroORM manager supplied by the repository callback in
    // both aliases. The native Cart repository needs its manager methods
    // (including getDriver), while SQL modules obtain the Knex transaction via
    // manager.getTransactionContext().
    transactionManager,
    manager: transactionManager,
  }
}

function createTransactionalCartModule(
  cartModule: CartModuleForTransactionalMutation,
  sharedContext: StoreResourceVersionMutationContext
): CartModuleForTransactionalMutation {
  const facade = Object.create(null) as object
  return new Proxy(facade, {
    get(_target, property) {
      if (property === "constructor") {
        return Object
      }

      const value = Reflect.get(cartModule as object, property)
      if (typeof property !== "string" || typeof value !== "function") {
        return value
      }

      return (...args: unknown[]) => {
        const contextIndex = MedusaContext.getIndex(cartModule, property)
        if (!Number.isInteger(contextIndex)) {
          return value.apply(cartModule, args)
        }

        const contextArgs = [...args]
        contextArgs[contextIndex as number] = sharedContext
        return value.apply(cartModule, contextArgs)
      }
    },
  }) as CartModuleForTransactionalMutation
}

function createTransactionalWorkflowScope(
  req: CartMutationRequest,
  cartModule: CartModuleForTransactionalMutation,
  sharedContext: StoreResourceVersionMutationContext
): { resolve: (key: unknown) => unknown } {
  const transactionalCartModule = createTransactionalCartModule(
    cartModule,
    sharedContext
  )
  const transactionalScope = req.scope.createScope()
  transactionalScope.register(Modules.CART, asValue(transactionalCartModule))

  return transactionalScope
}

const transactionalCartSnapshotConfig = {
  select: [
    "id",
    "email",
    "currency_code",
    "locale",
    "total",
    "subtotal",
    "item_total",
    "shipping_total",
    "tax_total",
    "discount_total",
    "region_id",
    "created_at",
    "updated_at",
    "completed_at",
    "metadata",
  ],
  relations: [
    "region",
    "region.countries",
    "customer",
    "items",
    "items.variant",
    "shipping_address",
  ],
}

async function retrieveCartInTransaction(
  cartModule: CartModuleForTransactionalMutation,
  cartId: string,
  sharedContext: StoreResourceVersionMutationContext
): Promise<StoreCartPreOrderRecord> {
  const transactionalCartModule = createTransactionalCartModule(
    cartModule,
    sharedContext
  )
  const retrieveCart = transactionalCartModule.retrieveCart

  if (typeof retrieveCart !== "function") {
    throw new Error("CART_TRANSACTIONAL_RETRIEVE_UNAVAILABLE")
  }

  const cart = (await (retrieveCart as Function).call(
    transactionalCartModule,
    cartId,
    transactionalCartSnapshotConfig
  )) as StoreCartPreOrderRecord

  if (!cart || !isActiveCart(cart)) {
    notFound()
  }
  assertNoPaymentOrOrderFields(cart)
  return cart
}

async function retrieveCartSnapshotInTransaction(
  cartModule: CartModuleForTransactionalMutation,
  cartId: string,
  version: number,
  sharedContext: StoreResourceVersionMutationContext
): Promise<CartMutationSnapshot> {
  const cart = await retrieveCartInTransaction(cartModule, cartId, sharedContext)
  return { cart, version }
}

async function readCartSnapshotWithVersion(
  req: CartMutationRequest,
  cartId: string,
  sharedContext?: StoreResourceVersionMutationContext
): Promise<CartMutationSnapshot> {
  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )
  const cartModule = req.scope.resolve(Modules.CART) as unknown as CartModuleForTransactionalMutation

  if (sharedContext) {
    const versionRow = await versionService.initialize(
      "cart",
      cartId,
      sharedContext
    )
    return retrieveCartSnapshotInTransaction(
      cartModule,
      cartId,
      versionRow.version,
      sharedContext
    )
  }

  const transaction = cartModule.baseRepository_?.transaction

  if (typeof transaction !== "function") {
    throw new Error("CART_TRANSACTION_AUTHORITY_UNAVAILABLE")
  }

  return transaction.call(cartModule.baseRepository_, async (transactionManager) => {
    const transactionContext = transactionManager.getTransactionContext?.()
    if (!transactionContext) {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }

    await lockCartOrderAuthority(transactionContext, cartId)
    const context = currentVersionContext(transactionManager)
    const versionRow = await versionService.initialize("cart", cartId, context)
    return retrieveCartSnapshotInTransaction(
      cartModule,
      cartId,
      versionRow.version,
      context
    )
  })
}

async function markRetryable(
  service: StoreIdempotencyModuleService,
  record: {
    id: string
    state_version: number
    retry_attempt_count: number
  },
  failureCode: string,
  sharedContext?: StoreResourceVersionMutationContext
): Promise<LifecycleClaimResult> {
  return service.markFailedRetryable({
    id: record.id,
    expectedState: "processing",
    expectedStateVersion: record.state_version,
    failure_code: failureCode,
    next_retry_at: new Date(Date.now() + 5000),
    retry_attempt_count: record.retry_attempt_count + 1,
    retry_started_at: new Date(),
    state_deadline_at: new Date(Date.now() + 5 * 60 * 1000),
    sharedContext,
  })
}

function throwIdempotencyOwnershipLost(): never {
  throw Object.assign(
    new MedusaError(
      MedusaError.Types.CONFLICT,
      "Operation currently in progress or ownership lost for this idempotency key"
    ),
    {
      code: "IDEMPOTENCY_KEY_IN_PROGRESS",
      statusCode: 409,
      status: 409,
      retryable: true,
    }
  )
}

async function markTerminal(
  service: StoreIdempotencyModuleService,
  record: { id: string; state_version: number },
  failureCode: string,
  sharedContext?: StoreResourceVersionMutationContext
): Promise<LifecycleClaimResult> {
  return service.markFailedTerminal({
    id: record.id,
    expectedState: "processing",
    expectedStateVersion: record.state_version,
    failure_code: failureCode,
    sharedContext,
  })
}

async function replayTerminalFailure(
  req: CartMutationRequest,
  record: {
    state: string
    failure_code: string | null
    result_id: string | null
  },
  sharedContext?: StoreResourceVersionMutationContext
): Promise<never> {
  if (record.failure_code !== "CART_VERSION_MISMATCH" || !record.result_id) {
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency key previously terminated with failure"
      ),
      { code: "IDEMPOTENCY_KEY_REUSE_CONFLICT", statusCode: 409, status: 409 }
    )
  }

  const snapshot = await readCartSnapshotWithVersion(
    req,
    record.result_id,
    sharedContext
  )
  throw new CartVersionMismatchError(snapshot.cart, snapshot.version)
}

async function runWorkflowWithinCas(
  req: CartMutationRequest,
  kind: LineItemMutationKind,
  cartId: string,
  expectedVersion: number,
  body: AddCartLineItemBody | UpdateCartLineItemBody | undefined,
  lineItemIds: string[] | undefined,
  actor: Extract<M1CartActorDecision, { actorType: "guest" | "customer" }>,
  cartModule: CartModuleForTransactionalMutation,
  versionService: StoreResourceVersionModuleService,
  transactionContext: KnexLike,
  context: StoreResourceVersionMutationContext
) {
  // This is the final authority check. It re-locks and conditionally touches
  // the capability in the same PostgreSQL transaction that will CAS the cart
  // and run the native mutation.
  if (actor.actorType === "guest") {
    const presentedToken = readHeaderString(
      req.headers[GUEST_CART_CAPABILITY_HEADER]
    )
    if (!presentedToken) {
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    const guestCapabilityService = req.scope.resolve<GuestCartCapabilityModuleService>(
      GUEST_CART_CAPABILITY_MODULE
    )
    await guestCapabilityService.authorizeGuestCartCapabilityForMutation(
      presentedToken,
      cartId,
      { now: new Date() },
      context
    )
  }

  const workflowScope = createTransactionalWorkflowScope(req, cartModule, context)
  const casResult = await versionService.compareAndSwapWithMutation({
    resourceType: "cart",
    resourceId: cartId,
    expectedVersion,
    sharedContext: context,
    mutate: async (sharedContext) => {
      if (kind === "add") {
        return addToCartWorkflow(workflowScope as never).run({
          input: {
            cart_id: cartId,
            items: [body as AddCartLineItemBody],
          },
          context: sharedContext,
        })
      }

      if (kind === "delete" || kind === "clear") {
        return deleteLineItemsWorkflow(workflowScope as never).run({
          input: {
            cart_id: cartId,
            ids: lineItemIds ?? [],
          },
          context: sharedContext,
        })
      }

      return updateLineItemInCartWorkflow(workflowScope as never).run({
        input: {
          cart_id: cartId,
          item_id: req.params.line_id as string,
          update: body as UpdateCartLineItemBody,
        },
        context: sharedContext,
      })
    },
  })

  if (casResult.type === "updated") {
    await applyStructuralCartInvalidation(cartId, new Date(), {
      transaction: transactionContext,
    })
  }

  const snapshot = await retrieveCartSnapshotInTransaction(
    cartModule,
    cartId,
    casResult.type === "updated" ? casResult.version : casResult.actualVersion,
    context
  )

  return { casResult, snapshot }
}

/**
 * Shared M1 mutation pipeline. The ordering is contractual:
 * actor -> cart ownership -> input validation -> Cart/order lock -> review
 * guard -> Idempotency-Key claim -> replay short-circuit -> If-Match -> final
 * capability authority -> PostgreSQL CAS wrapping the native Medusa workflow ->
 * CART-09 invalidation -> terminalize claim -> canonical snapshot/current ETag.
 */
export async function executeLineItemMutation(
  req: CartMutationRequest,
  res: MedusaResponse,
  kind: LineItemMutationKind
): Promise<void> {
  const actor = await resolveActor(req)
  throwActorError(actor)

  const cartId = req.params.id
  if (typeof cartId !== "string" || cartId.trim().length === 0) {
    notFound()
  }

  const actorWithOwnership = actor as Extract<
    M1CartActorDecision,
    { actorType: "guest" | "customer" }
  >
  if (actorWithOwnership.actorType === "customer") {
    const canonicalCart = await resolveCanonicalCustomerActiveCart(
      req,
      actorWithOwnership.customerId
    )
    if (!canonicalCart || canonicalCart.id !== cartId) {
      notFound()
    }
  }
  const cart = await refetchCart(req, cartId)
  assertActorOwnsCart(actorWithOwnership, cart)

  const lineId =
    kind === "update" || kind === "delete" ? requireLineId(req) : undefined
  const body = parseMutationBody(kind, req.body)
  const rawIdempotencyKey = idempotencyKey(req)
  const operation = lineItemOperation(kind)

  const idempotencyService = req.scope.resolve<StoreIdempotencyModuleService>(
    STORE_IDEMPOTENCY_MODULE
  )

  const cartModule = req.scope.resolve(Modules.CART) as unknown as CartModuleForTransactionalMutation
  const transaction = cartModule.baseRepository_?.transaction
  if (typeof transaction !== "function") {
    throw new Error("CART_TRANSACTION_AUTHORITY_UNAVAILABLE")
  }

  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )

  const execution = await transaction.call(
    cartModule.baseRepository_,
    async (transactionManager): Promise<LineItemMutationExecution> => {
      const transactionContext = transactionManager.getTransactionContext?.()
      if (!transactionContext) {
        throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
      }

      const sharedContext = currentVersionContext(transactionManager)

      // The Cart/order lock is the authority boundary for the entire mutation.
      // Re-read ownership under that lock without initializing/bumping the
      // resource version, so a pending review still produces zero writes.
      const lockedCart = await retrieveCartInTransaction(
        cartModule,
        cartId,
        sharedContext
      )
      assertActorOwnsCart(actorWithOwnership, lockedCart)
      await lockCartOrderAuthority(transactionContext, cartId)
      await assertNoPendingCartReview(cartId, sharedContext)

      const claimResult = await idempotencyService.claim({
        operation,
        actorScope: currentActorScope(actorWithOwnership),
        resourceScope: cartResourceScope({ cartId, operation }),
        rawIdempotencyKey,
        canonicalSemanticObject: {
          operation,
          cart_id: cartId,
          ...(lineId ? { line_id: lineId } : {}),
          ...(body ?? {}),
        },
        sharedContext,
      })

      if (claimResult.type === "conflict") {
        return {
          type: "failed",
          error: Object.assign(
            new MedusaError(
              MedusaError.Types.CONFLICT,
              "Idempotency key reuse conflict"
            ),
            {
              code: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
              statusCode: 409,
              status: 409,
            }
          ),
        }
      }

      if (claimResult.type === "in_progress") {
        return {
          type: "failed",
          error: Object.assign(
            new MedusaError(
              MedusaError.Types.CONFLICT,
              "Operation currently in progress for this idempotency key"
            ),
            {
              code: "IDEMPOTENCY_KEY_IN_PROGRESS",
              statusCode: 409,
              status: 409,
              retryable: true,
            }
          ),
        }
      }

      if (claimResult.type === "replay") {
        if (claimResult.record.state === "completed" && claimResult.record.result_id) {
          const snapshot = await readCartSnapshotWithVersion(
            req,
            claimResult.record.result_id,
            sharedContext
          )
          return { type: "completed", snapshot }
        }

        await replayTerminalFailure(req, claimResult.record, sharedContext)
      }

      const terminalize = async (
        error: unknown,
        failureCode: string,
        record = claimResult.record
      ): Promise<LineItemMutationExecution> => {
        const terminal = await markTerminal(
          idempotencyService,
          record,
          failureCode,
          sharedContext
        )
        if (terminal.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
        return { type: "failed", error }
      }

      let expectedVersion: number
      try {
        expectedVersion = requireIfMatch(req)
      } catch (error) {
        return terminalize(error, "VALIDATION_ERROR")
      }

      let lineItemIds: string[] | undefined
      if (kind === "delete") {
        lineItemIds = [lineId as string]
      } else if (kind === "clear") {
        const items = lockedCart.items ?? []
        lineItemIds = items
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id))

        if (lineItemIds.length !== items.length) {
          return terminalize(
            new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "Cart line-item identity is unavailable"
            ),
            "VALIDATION_ERROR"
          )
        }

        if (lineItemIds.length === 0) {
          const versionRow = await versionService.initialize(
            "cart",
            cartId,
            sharedContext
          )
          const currentSnapshot = {
            cart: lockedCart,
            version: versionRow.version,
          }

          if (currentSnapshot.version !== expectedVersion) {
            const partialResult = await idempotencyService.recordProcessingResult({
              id: claimResult.record.id,
              expectedStateVersion: claimResult.record.state_version,
              result_type: "cart",
              result_id: cartId,
              sharedContext,
            })
            if (partialResult.type !== "claimed") {
              throwIdempotencyOwnershipLost()
            }
            return terminalize(
              new CartVersionMismatchError(
                currentSnapshot.cart,
                currentSnapshot.version
              ),
              "CART_VERSION_MISMATCH",
              partialResult.record
            )
          }

          const completion = await idempotencyService.markCompleted({
            id: claimResult.record.id,
            expectedState: "processing",
            expectedStateVersion: claimResult.record.state_version,
            result_type: "cart",
            result_id: cartId,
            response_status: 200,
            result_safe_metadata: {
              operation,
              result_type: "cart",
              result_id: cartId,
              response_status: 200,
            },
            sharedContext,
          })
          if (completion.type !== "claimed") {
            throwIdempotencyOwnershipLost()
          }
          return { type: "completed", snapshot: currentSnapshot }
        }
      }

      let mutationExecution: Awaited<ReturnType<typeof runWorkflowWithinCas>>
      try {
        mutationExecution = await runWorkflowWithinCas(
          req,
          kind,
          cartId,
          expectedVersion,
          body,
          lineItemIds,
          actorWithOwnership,
          cartModule,
          versionService,
          transactionContext,
          sharedContext
        )
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === GUEST_CART_CAPABILITY_LOOKUP_INVALID
        ) {
          return terminalize(
            new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found"),
            "VALIDATION_ERROR"
          )
        }

        const retryable = await markRetryable(
          idempotencyService,
          claimResult.record,
          "CART_MUTATION_FAILED",
          sharedContext
        )
        if (retryable.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
        return { type: "failed", error }
      }

      if (mutationExecution.casResult.type === "stale") {
        const partialResult = await idempotencyService.recordProcessingResult({
          id: claimResult.record.id,
          expectedStateVersion: claimResult.record.state_version,
          result_type: "cart",
          result_id: cartId,
          sharedContext,
        })
        if (partialResult.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }

        return terminalize(
          new CartVersionMismatchError(
            mutationExecution.snapshot.cart,
            mutationExecution.snapshot.version
          ),
          "CART_VERSION_MISMATCH",
          partialResult.record
        )
      }

      try {
        const completion = await idempotencyService.markCompleted({
          id: claimResult.record.id,
          expectedState: "processing",
          expectedStateVersion: claimResult.record.state_version,
          result_type: "cart",
          result_id: cartId,
          response_status: 200,
          result_safe_metadata: {
            operation,
            result_type: "cart",
            result_id: cartId,
            response_status: 200,
          },
          sharedContext,
        })
        if (completion.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
      } catch (error) {
        const reconciliation = await idempotencyService.markReconciliationRequired({
          id: claimResult.record.id,
          expectedState: "processing",
          expectedStateVersion: claimResult.record.state_version,
          result_type: "cart",
          result_id: cartId,
          failure_code: "MARK_COMPLETED_FAILED",
          sharedContext,
        })
        if (reconciliation.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
        return { type: "failed", error }
      }

      return { type: "completed", snapshot: mutationExecution.snapshot }
    }
  )

  if (execution.type === "failed") {
    throw execution.error
  }

  res.setHeader("ETag", formatCartEtag(execution.snapshot.version))
  res.status(200).json({ cart: execution.snapshot.cart })
}
