import {
  addToCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  applyStructuralCartInvalidation,
  type PaymentAttemptModuleForCartInvalidation,
} from "../../../modules/checkout/shipping-invalidation"
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
  GUEST_CART_CAPABILITY_MODULE,
} from "../../../modules/guest-cart-capability/types"
import type GuestCartCapabilityModuleService from "../../../modules/guest-cart-capability/service"
import {
  PAYMENT_ATTEMPT_MODULE,
} from "../../../modules/payment-attempt"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD,
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

export type LineItemMutationKind = "add" | "update"

type RequestWithCustomerAuth = MedusaRequest & {
  customerAuth?: CustomerAuthAccessContext
}

type PgConnection = {
  transaction<T>(
    callback: (trx: {
      raw(
        sql: string,
        bindings?: unknown[]
      ): Promise<{ rows?: Array<Record<string, unknown>> }>
    }) => Promise<T>
  ): Promise<T>
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
      guestCapabilityService.lookupGuestCartCapabilityByPresentedToken(token),
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
  return kind === "add"
    ? STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD
    : STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE
}

function parseMutationBody(
  kind: LineItemMutationKind,
  body: unknown
): AddCartLineItemBody | UpdateCartLineItemBody {
  return kind === "add"
    ? parseAddCartLineItemBody(body)
    : parseUpdateCartLineItemBody(body)
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
  return {
    __type: "MedusaContext",
    transactionManager: {
      getTransactionContext: () => trx as never,
    },
  }
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

  const cart = await refetchCart(req, record.result_id)
  const version = await initializeCartResourceVersion(req, cart.id)
  throw new CartVersionMismatchError(cart, version)
}

async function runWorkflowWithinCas(
  req: CartMutationRequest,
  kind: LineItemMutationKind,
  cartId: string,
  expectedVersion: number,
  body: AddCartLineItemBody | UpdateCartLineItemBody
) {
  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )
  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as PgConnection

  return pgConnection.transaction(async (trx) => {
    const context = currentVersionContext(trx)
    return versionService.compareAndSwapWithMutation({
      resourceType: "cart",
      resourceId: cartId,
      expectedVersion,
      sharedContext: context,
      mutate: async (sharedContext) => {
        if (kind === "add") {
          return addToCartWorkflow(req.scope).run({
            input: {
              cart_id: cartId,
              items: [body as AddCartLineItemBody],
            },
            context: sharedContext,
          })
        }

        return updateLineItemInCartWorkflow(req.scope).run({
          input: {
            cart_id: cartId,
            item_id: (req.params.line_id as string),
            update: body as UpdateCartLineItemBody,
          },
          context: sharedContext,
        })
      },
    })
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

  const lineId = kind === "update" ? requireLineId(req) : undefined
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
      ...body,
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
      const replayCart = await refetchCart(req, claimResult.record.result_id)
      const version = await initializeCartResourceVersion(req, replayCart.id)
      res.setHeader("ETag", formatCartEtag(version))
      res.status(200).json({ cart: replayCart })
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

  let casResult
  try {
    casResult = await runWorkflowWithinCas(
      req,
      kind,
      cartId,
      expectedVersion,
      body
    )
  } catch (error) {
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

  if (casResult.type === "stale") {
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
    const currentCart = await refetchCart(req, cartId)
    throw new CartVersionMismatchError(currentCart, casResult.actualVersion)
  }

  try {
    const paymentAttemptModule = req.scope.resolve<PaymentAttemptModuleForCartInvalidation>(
      PAYMENT_ATTEMPT_MODULE
    )
    await applyStructuralCartInvalidation(cartId, new Date(), {
      paymentAttemptModule,
    })
  } catch (error) {
    const reconciliation = await idempotencyService.markReconciliationRequired({
      id: claimResult.record.id,
      expectedState: "processing",
      expectedStateVersion: claimResult.record.state_version,
      result_type: "cart",
      result_id: cartId,
      failure_code: "CART_INVALIDATION_FAILED",
    })
    if (reconciliation.type !== "claimed") {
      throwIdempotencyOwnershipLost()
    }
    throw error
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

  const currentCart = await refetchCart(req, cartId)
  res.setHeader("ETag", formatCartEtag(casResult.version))
  res.status(200).json({ cart: currentCart })
}
