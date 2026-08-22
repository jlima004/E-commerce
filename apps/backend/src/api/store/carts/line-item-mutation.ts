import {
  addToCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
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

export type LineItemMutationKind = "add" | "update" | "delete" | "clear"

type RequestWithCustomerAuth = MedusaRequest & {
  customerAuth?: CustomerAuthAccessContext
}

type TransactionManager = {
  getTransactionContext?: () => {
    raw(
      sql: string,
      bindings?: unknown[]
    ): Promise<{ rows?: Array<Record<string, unknown>> }>
  } | null
}

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

function currentVersionContext(trx: {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}): StoreResourceVersionMutationContext {
  const transactionManager = {
    getTransactionContext: () => trx as never,
  }

  return {
    __type: "MedusaContext",
    // Medusa's resource-version service verifies that both context aliases
    // identify the exact same transaction manager. Keeping two wrapper
    // objects here would silently turn this into a cross-manager operation.
    transactionManager,
    manager: transactionManager,
  }
}

function createTransactionalCartModule(
  cartModule: CartModuleForTransactionalMutation,
  sharedContext: StoreResourceVersionMutationContext
): CartModuleForTransactionalMutation {
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
  req: CartMutationRequest,
  cartModule: CartModuleForTransactionalMutation,
  sharedContext: StoreResourceVersionMutationContext
): { resolve: (key: unknown) => unknown } {
  const transactionalCartModule = createTransactionalCartModule(
    cartModule,
    sharedContext
  )

  return {
    resolve(key: unknown) {
      if (key === Modules.CART) {
        return transactionalCartModule
      }
      return req.scope.resolve(key as never)
    },
  }
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

async function retrieveCartSnapshotInTransaction(
  cartModule: CartModuleForTransactionalMutation,
  cartId: string,
  version: number,
  sharedContext: StoreResourceVersionMutationContext
): Promise<CartMutationSnapshot> {
  const transactionalCartModule = createTransactionalCartModule(
    cartModule,
    sharedContext
  )
  const retrieveCart = transactionalCartModule.retrieveCart

  if (typeof retrieveCart !== "function") {
    throw new Error("CART_TRANSACTIONAL_SNAPSHOT_UNAVAILABLE")
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

  return { cart, version }
}

async function readCartSnapshotWithVersion(
  req: CartMutationRequest,
  cartId: string
): Promise<CartMutationSnapshot> {
  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )
  const cartModule = req.scope.resolve(Modules.CART) as unknown as CartModuleForTransactionalMutation
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
    const context = currentVersionContext(transactionContext)
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
  failureCode: string
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
  failureCode: string
): Promise<LifecycleClaimResult> {
  return service.markFailedTerminal({
    id: record.id,
    expectedState: "processing",
    expectedStateVersion: record.state_version,
    failure_code: failureCode,
  })
}

async function replayTerminalFailure(
  req: CartMutationRequest,
  record: {
    state: string
    failure_code: string | null
    result_id: string | null
  }
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

  const snapshot = await readCartSnapshotWithVersion(req, record.result_id)
  throw new CartVersionMismatchError(snapshot.cart, snapshot.version)
}

async function runWorkflowWithinCas(
  req: CartMutationRequest,
  kind: LineItemMutationKind,
  cartId: string,
  expectedVersion: number,
  body: AddCartLineItemBody | UpdateCartLineItemBody | undefined,
  lineItemIds: string[] | undefined,
  actor: Extract<M1CartActorDecision, { actorType: "guest" | "customer" }>
) {
  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )
  const cartModule = req.scope.resolve(Modules.CART) as unknown as CartModuleForTransactionalMutation
  const transaction = cartModule.baseRepository_?.transaction

  if (typeof transaction !== "function") {
    throw new Error("CART_TRANSACTION_AUTHORITY_UNAVAILABLE")
  }

  return transaction.call(cartModule.baseRepository_, async (transactionManager) => {
    const transactionContext = transactionManager.getTransactionContext?.()
    if (!transactionContext) {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }

    // Serialize the entire native Cart workflow, resource-version CAS and
    // PaymentAttempt invalidation against webhook and Order authority.
    await lockCartOrderAuthority(transactionContext, cartId)

    const context = currentVersionContext(transactionContext)

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
      // This is the final authority check. It re-locks and conditionally
      // touches the capability in the same PostgreSQL transaction that will
      // CAS the cart and run the native mutation.
      await guestCapabilityService.authorizeGuestCartCapabilityForMutation(
        presentedToken,
        cartId,
        { now: new Date() },
        context
      )
    }

    const workflowScope = createTransactionalWorkflowScope(
      req,
      cartModule,
      context
    )
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
  })
}

/**
 * Shared M1 mutation pipeline. The ordering is contractual:
 * actor -> cart ownership -> input validation -> Idempotency-Key claim ->
 * replay short-circuit -> If-Match ->
 * PostgreSQL CAS wrapping the native Medusa workflow -> CART-09 invalidation ->
 * terminalize claim -> canonical refetch/DTO/current ETag.
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
  })

  if (claimResult.type === "conflict") {
    throw Object.assign(
      new MedusaError(MedusaError.Types.CONFLICT, "Idempotency key reuse conflict"),
      { code: "IDEMPOTENCY_KEY_REUSE_CONFLICT", statusCode: 409, status: 409 }
    )
  }

  if (claimResult.type === "in_progress") {
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Operation currently in progress for this idempotency key"
      ),
      { code: "IDEMPOTENCY_KEY_IN_PROGRESS", statusCode: 409, status: 409, retryable: true }
    )
  }

  if (claimResult.type === "replay") {
    if (claimResult.record.state === "completed" && claimResult.record.result_id) {
      const snapshot = await readCartSnapshotWithVersion(
        req,
        claimResult.record.result_id
      )
      res.setHeader("ETag", formatCartEtag(snapshot.version))
      res.status(200).json({ cart: snapshot.cart })
      return
    }
    await replayTerminalFailure(req, claimResult.record)
  }

  let expectedVersion: number
  try {
    expectedVersion = requireIfMatch(req)
  } catch (error) {
    const terminal = await markTerminal(
      idempotencyService,
      claimResult.record,
      "VALIDATION_ERROR"
    )
    if (terminal.type !== "claimed") {
      throwIdempotencyOwnershipLost()
    }
    throw error
  }

  let lineItemIds: string[] | undefined
  if (kind === "delete") {
    lineItemIds = [lineId as string]
  } else if (kind === "clear") {
    const currentCart = await refetchCart(req, cartId)
    assertActorOwnsCart(actorWithOwnership, currentCart)
    const items = currentCart.items ?? []
    lineItemIds = items.map((item) => item.id).filter((id): id is string => Boolean(id))

    if (lineItemIds.length !== items.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cart line-item identity is unavailable"
      )
    }

    if (lineItemIds.length === 0) {
      const currentSnapshot = await readCartSnapshotWithVersion(req, cartId)
      if (currentSnapshot.version !== expectedVersion) {
        const partialResult = await idempotencyService.recordProcessingResult({
          id: claimResult.record.id,
          expectedStateVersion: claimResult.record.state_version,
          result_type: "cart",
          result_id: cartId,
        })
        if (partialResult.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
        const terminal = await markTerminal(
          idempotencyService,
          partialResult.record,
          "CART_VERSION_MISMATCH"
        )
        if (terminal.type !== "claimed") {
          throwIdempotencyOwnershipLost()
        }
        throw new CartVersionMismatchError(
          currentSnapshot.cart,
          currentSnapshot.version
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
      })
      if (completion.type !== "claimed") {
        throwIdempotencyOwnershipLost()
      }

      res.setHeader("ETag", formatCartEtag(currentSnapshot.version))
      res.status(200).json({ cart: currentSnapshot.cart })
      return
    }
  }

  let execution
  try {
    execution = await runWorkflowWithinCas(
      req,
      kind,
      cartId,
      expectedVersion,
      body,
      lineItemIds,
      actorWithOwnership
    )
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === GUEST_CART_CAPABILITY_LOOKUP_INVALID
    ) {
      const terminal = await markTerminal(
        idempotencyService,
        claimResult.record,
        "VALIDATION_ERROR"
      )
      if (terminal.type !== "claimed") {
        throwIdempotencyOwnershipLost()
      }
      notFound()
    }

    const retryable = await markRetryable(
      idempotencyService,
      claimResult.record,
      "CART_MUTATION_FAILED"
    )
    if (retryable.type !== "claimed") {
      throwIdempotencyOwnershipLost()
    }
    throw error
  }

  if (execution.casResult.type === "stale") {
    const partialResult = await idempotencyService.recordProcessingResult({
      id: claimResult.record.id,
      expectedStateVersion: claimResult.record.state_version,
      result_type: "cart",
      result_id: cartId,
    })

    if (partialResult.type !== "claimed") {
      throw Object.assign(
        new MedusaError(
          MedusaError.Types.CONFLICT,
          "Operation currently in progress or ownership lost for this idempotency key"
        ),
        { code: "IDEMPOTENCY_KEY_IN_PROGRESS", statusCode: 409, status: 409, retryable: true }
      )
    }

    const terminal = await markTerminal(
      idempotencyService,
      partialResult.record,
      "CART_VERSION_MISMATCH"
    )
    if (terminal.type !== "claimed") {
      throwIdempotencyOwnershipLost()
    }
    throw new CartVersionMismatchError(
      execution.snapshot.cart,
      execution.snapshot.version
    )
  }

  let completion: LifecycleClaimResult
  try {
    completion = await idempotencyService.markCompleted({
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
    })
  } catch (error) {
    const reconciliation = await idempotencyService.markReconciliationRequired({
      id: claimResult.record.id,
      expectedState: "processing",
      expectedStateVersion: claimResult.record.state_version,
      result_type: "cart",
      result_id: cartId,
      failure_code: "MARK_COMPLETED_FAILED",
    })
    if (reconciliation.type !== "claimed") {
      throwIdempotencyOwnershipLost()
    }
    throw error
  }

  if (completion.type !== "claimed") {
    throwIdempotencyOwnershipLost()
  }

  res.setHeader("ETag", formatCartEtag(execution.snapshot.version))
  res.status(200).json({ cart: execution.snapshot.cart })
}
