import { createCartWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  assertNoPaymentOrOrderFields,
  resolveM1CartActor,
  type M1CartActorDecision,
} from "../../../../modules/checkout/active-cart"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../../../modules/guest-cart-capability/types"
import type GuestCartCapabilityModuleService from "../../../../modules/guest-cart-capability/service"
import {
  authorizeCustomerAuthAccess,
  createKnexCustomerAuthAccessDatabase,
  type CustomerAuthAccessContext,
} from "../../../../modules/customer-auth/access-guard"
import { CUSTOMER_AUTH_BFF_AUTH_HEADER } from "../../../../modules/customer-auth/bff-service-auth"
import {
  STORE_IDEMPOTENCY_MODULE,
  STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
  assertValidRawIdempotencyKey,
  type LifecycleClaimResult,
  type StoreIdempotencyModuleService,
} from "../../../../modules/store-idempotency"
import {
  guestCartCreateActorScope,
  customerActorScope,
  hashBffSecret,
} from "../idempotency-scope"
import { env } from "../../../../config/env"
import { storeCartPreOrderFields } from "../query-config"
import type { StoreCartPreOrderRecord } from "../serializers"
import {
  formatCartEtag,
  initializeCartResourceVersion,
} from "../concurrency"
import {
  CUSTOMER_CART_AUTHORITY_CONFLICT,
  isActiveCartForCheckout,
  resolveCanonicalCustomerActiveCart,
  resolveCanonicalCustomerCartAuthority,
  withCustomerCartAuthorityTransaction,
} from "../customer-active-cart"
import type {
  CustomerCartAuthorityRegistration,
  CustomerCartAuthoritySharedContext,
} from "../customer-active-cart"
import { lockCartOrderAuthority } from "../../../../modules/payment-attempt/transactional-authority"
import type { CartTransactionSql } from "../../../../workflows/cart/cart-transaction-boundary"

type StoreCartRecord = StoreCartPreOrderRecord

type LinkService = {
  create(input: Record<string, unknown>): Promise<unknown>
  dismiss?(input: Record<string, unknown>): Promise<unknown>
}

type CartCleanupService = {
  deleteCarts?(ids: string[]): Promise<void>
  softDeleteCarts?(ids: string[]): Promise<unknown>
}

const ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

async function refetchActiveCart(
  req: MedusaRequest,
  cartId: string,
  sharedContext?: CustomerCartAuthoritySharedContext
): Promise<StoreCartRecord> {
  if (sharedContext) {
    const cartModule = req.scope.resolve(Modules.CART) as unknown as {
      retrieveCart?: (
        id: string,
        config?: { relations?: string[] },
        context?: CustomerCartAuthoritySharedContext
      ) => Promise<StoreCartRecord | null>
    }
    if (typeof cartModule.retrieveCart !== "function") {
      throw new Error("CART_RETRIEVAL_AUTHORITY_UNAVAILABLE")
    }

    const cart = await cartModule.retrieveCart(
      cartId,
      {
        relations: [
          "items",
          "shipping_address",
          "billing_address",
        ],
      },
      sharedContext
    )
    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart with id '${cartId}' not found`
      )
    }
    return cart
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: {
      filters: {
        id: cartId,
      },
    },
    fields: [...ACTIVE_CART_QUERY_FIELDS],
  })

  const [cart] = (await remoteQuery(queryObject)) as StoreCartRecord[]

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart with id '${cartId}' not found`
    )
  }

  return cart
}

async function createGuestCartCapabilityLink(
  req: MedusaRequest,
  cartId: string,
  capabilityId: string
): Promise<Record<string, unknown>> {
  const link = req.scope.resolve(
    ContainerRegistrationKeys.LINK
  ) as LinkService | undefined

  if (!link || typeof link.create !== "function") {
    throw new Error("GUEST_CART_CAPABILITY_LINK_UNAVAILABLE")
  }

  // Only opaque record identifiers cross the module-link boundary. The
  // one-time plaintext token is intentionally never part of link storage.
  const definition = {
    [Modules.CART]: { cart_id: cartId },
    [GUEST_CART_CAPABILITY_MODULE]: {
      guest_cart_capability_id: capabilityId,
    },
  }
  await link.create(definition)
  return definition
}

async function dismissGuestCartCapabilityLink(
  req: MedusaRequest,
  definition: Record<string, unknown>
): Promise<void> {
  const link = req.scope.resolve(
    ContainerRegistrationKeys.LINK
  ) as LinkService | undefined

  if (!link || typeof link.dismiss !== "function") {
    throw new Error("GUEST_CART_CAPABILITY_LINK_DISMISS_UNAVAILABLE")
  }

  await link.dismiss(definition)
}

async function compensateGuestCartCapabilityMint(
  req: MedusaRequest,
  capabilityId: string
): Promise<void> {
  const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
    GUEST_CART_CAPABILITY_MODULE
  )

  if (typeof guestCapService.revokeGuestCartCapability !== "function") {
    throw new Error("GUEST_CART_CAPABILITY_COMPENSATION_UNAVAILABLE")
  }

  await guestCapService.revokeGuestCartCapability(capabilityId)
}

async function compensateGuestCartCreation(
  req: MedusaRequest,
  cartId: string
): Promise<void> {
  const cartModule = req.scope.resolve(Modules.CART) as CartCleanupService

  if (typeof cartModule.deleteCarts === "function") {
    await cartModule.deleteCarts([cartId])
    return
  }

  if (typeof cartModule.softDeleteCarts === "function") {
    await cartModule.softDeleteCarts([cartId])
    return
  }

  throw new Error("GUEST_CART_CREATION_COMPENSATION_UNAVAILABLE")
}

async function retrieveCartById(
  req: MedusaRequest,
  cartId: string,
  onCompleted?: () => Promise<void>,
  sharedContext?: CustomerCartAuthoritySharedContext
): Promise<StoreCartRecord | null> {
  try {
    const cart = await refetchActiveCart(req, cartId, sharedContext)

    if (cart.completed_at) {
      if (onCompleted) {
        await onCompleted()
      }
      return null
    }

    if (!isActiveCartForCheckout(cart)) {
      return null
    }

    return cart
  } catch (error) {
    if (
      error instanceof MedusaError &&
      error.type === MedusaError.Types.NOT_FOUND
    ) {
      return null
    }

    throw error
  }
}

async function resolveActor(req: MedusaRequest): Promise<M1CartActorDecision> {
  const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
    GUEST_CART_CAPABILITY_MODULE
  )
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    raw(sql: string, bindings?: unknown[]): Promise<{ rows?: Array<Record<string, unknown>> }>
  }
  const requestWithAuth = req as MedusaRequest & { customerAuth?: CustomerAuthAccessContext }

  return resolveM1CartActor({
    guestCapabilityHeader: req.headers[GUEST_CART_CAPABILITY_HEADER],
    authorizationHeader: req.headers.authorization,
    customerAuthContext: requestWithAuth.customerAuth,
    lookupGuestCapability: (token: string) =>
      guestCapService.lookupGuestCartCapabilityByPresentedToken(token),
    authorizeCustomerAccess: (authHeader: string) =>
      authorizeCustomerAuthAccess(
        createKnexCustomerAuthAccessDatabase(pgConnection),
        authHeader,
        { jwtSecret: env.JWT_SECRET }
      ),
  })
}

type CustomerActiveCartResult = {
  statusCode: 200 | 201
  cart: StoreCartRecord
}

function throwCustomerAuthorityConflict(): never {
  throw Object.assign(
    new MedusaError(
      MedusaError.Types.CONFLICT,
      "Customer cart state conflict"
    ),
    {
      code: CUSTOMER_CART_AUTHORITY_CONFLICT,
      statusCode: 409,
      status: 409,
    }
  )
}

/** Test-only loopback barrier used by the real multiprocess PostgreSQL proof. */
async function awaitCartMergeCustomerLockBarrier(
  sharedContext: CustomerCartAuthoritySharedContext,
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
  const transaction = sharedContext.transactionManager?.getTransactionContext?.()
  if (!transaction) {
    throw new Error("P16_CART_MERGE_LOCK_BARRIER_TRANSACTION_UNAVAILABLE")
  }
  const result = await transaction.raw("select txid_current()::text as txid")
  const txid = String(result.rows?.[0]?.txid ?? "")
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

async function createOrReuseCustomerCartUnderAuthority(
  req: MedusaRequest,
  customerId: string,
  rawIdempotencyKey: string,
  authority: Awaited<
    ReturnType<typeof resolveCanonicalCustomerCartAuthority>
  >,
  sharedContext: CustomerCartAuthoritySharedContext,
  registerAuthority: CustomerCartAuthorityRegistration
): Promise<CustomerActiveCartResult> {
  await awaitCartMergeCustomerLockBarrier(sharedContext, customerId)

  if (authority.type === "ambiguous" || authority.type === "conflict") {
    throwCustomerAuthorityConflict()
  }

  if (authority.type === "single") {
    const transaction = sharedContext.transactionManager
      .getTransactionContext?.() as CartTransactionSql | null | undefined
    if (!transaction || typeof transaction.raw !== "function") {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }
    await lockCartOrderAuthority(transaction, authority.cartId)
    const existingCart = await retrieveCartById(
      req,
      authority.cartId,
      undefined,
      sharedContext
    )
    if (!existingCart || existingCart.customer_id !== customerId) {
      throwCustomerAuthorityConflict()
    }
    assertNoPaymentOrOrderFields(existingCart)
    return { statusCode: 200, cart: existingCart }
  }

  const storeIdempotencyService = req.scope.resolve<StoreIdempotencyModuleService>(
    STORE_IDEMPOTENCY_MODULE
  )
  const actorScope = customerActorScope({ customerId })
  const canonicalSemanticObject = {
    customer_id: customerId,
    currency_code: "brl",
  }
  const transactionContext = sharedContext as never
  const claimResult = await storeIdempotencyService.claim({
    operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
    actorScope,
    rawIdempotencyKey,
    canonicalSemanticObject,
    sharedContext: transactionContext,
  })

  if (claimResult.type === "conflict") {
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency key reuse conflict"
      ),
      { code: "IDEMPOTENCY_KEY_REUSE_CONFLICT", statusCode: 409, status: 409 }
    )
  }

  if (claimResult.type === "in_progress") {
    throw Object.assign(
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
    )
  }

  if (claimResult.type === "replay") {
    const record = claimResult.record
    if (record.state === "completed" && record.result_id) {
      const cart = await refetchActiveCart(req, record.result_id)
      if (cart.customer_id !== customerId) {
        throwCustomerAuthorityConflict()
      }
      assertNoPaymentOrOrderFields(cart)
      return { statusCode: 200, cart }
    }
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency key previously terminated with failure or requires reconciliation"
      ),
      { code: "IDEMPOTENCY_KEY_REUSE_CONFLICT", statusCode: 409, status: 409 }
    )
  }

  let currentStateVersion = claimResult.record.state_version
  let cartId: string | null = null
  try {
    const { result } = await createCartWorkflow(req.scope).run({
      input: {
        customer_id: customerId,
        currency_code: "brl",
      },
      context: transactionContext,
    } as never)
    cartId = result.id
  } catch (error) {
    try {
      await storeIdempotencyService.markFailedRetryable({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        failure_code: "CART_CREATION_FAILED",
        next_retry_at: new Date(Date.now() + 5000),
        retry_attempt_count: 1,
        retry_started_at: new Date(),
        state_deadline_at: new Date(Date.now() + 5 * 60 * 1000),
        sharedContext: transactionContext,
      })
    } catch {}
    throw error
  }

  const partialResult = await storeIdempotencyService.recordProcessingResult({
    id: claimResult.record.id,
    expectedStateVersion: currentStateVersion,
    result_type: "cart",
    result_id: cartId,
    response_status: 201,
    result_safe_metadata: {
      operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
      result_type: "cart",
      result_id: cartId,
      response_status: 201,
    },
    sharedContext: transactionContext,
  })

  if (partialResult.type !== "claimed") {
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
  currentStateVersion = partialResult.record.state_version

  let cart: StoreCartRecord
  try {
    cart = await refetchActiveCart(req, cartId, sharedContext)
    if (cart.customer_id !== customerId) {
      throwCustomerAuthorityConflict()
    }
    assertNoPaymentOrOrderFields(cart)
  } catch (error) {
    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cartId,
        failure_code: "CART_REFETCH_FAILED",
        sharedContext: transactionContext,
      })
    } catch {}
    throw error
  }

  const materializedAuthority = await resolveCanonicalCustomerCartAuthority(
    req.scope,
    sharedContext,
    customerId
  )
  if (
    materializedAuthority.type !== "single" ||
    materializedAuthority.cartId !== cart.id
  ) {
    throwCustomerAuthorityConflict()
  }
  registerAuthority(materializedAuthority)

  let completion: LifecycleClaimResult
  try {
    completion = await storeIdempotencyService.markCompleted({
      id: claimResult.record.id,
      expectedState: "processing",
      expectedStateVersion: currentStateVersion,
      result_type: "cart",
      result_id: cart.id,
      response_status: 201,
      result_safe_metadata: {
        operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
        result_type: "cart",
        result_id: cart.id,
        response_status: 201,
      },
      sharedContext: transactionContext,
    })
  } catch (error) {
    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cart.id,
        failure_code: "MARK_COMPLETED_FAILED",
        sharedContext: transactionContext,
      })
    } catch {}
    throw error
  }

  if (completion.type !== "claimed") {
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

  return { statusCode: 201, cart }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actor = await resolveActor(req)

  if (actor.actorType === "invalid_guest_capability") {
    // GET with capability PRESENT but invalid/expired/revoked/consumed/missing in DB
    // MUST return uniform 404
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Presented guest capability is invalid, expired, revoked, or consumed"
    )
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
    // GET with NO identity headers MUST return 404 (GET never auto-mints!)
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active cart found for anonymous guest request"
    )
  }

  let cart: StoreCartRecord | null = null

  if (actor.actorType === "guest") {
    const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
      GUEST_CART_CAPABILITY_MODULE
    )
    cart = await retrieveCartById(req, actor.cartId, async () => {
      await guestCapService.consumeGuestCartCapability(actor.capabilityRecord.id)
    })
  } else if (actor.actorType === "customer") {
    cart = await resolveCanonicalCustomerActiveCart(req, actor.customerId)
  }

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active cart found for the current actor"
    )
  }

  assertNoPaymentOrOrderFields(cart)

  const version = await initializeCartResourceVersion(req, cart.id)
  res.setHeader("ETag", formatCartEtag(version))

  // GET never emits x-indicio-guest-cart-token header
  res.status(200).json({
    cart,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const actor = await resolveActor(req)

  if (actor.actorType === "invalid_guest_capability") {
    // POST with capability PRESENT but invalid/expired/revoked/consumed/missing in DB
    // MUST return uniform 404 and MUST NOT create a new cart!
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Presented guest capability is invalid, expired, revoked, or consumed"
    )
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

  // Idempotency-Key validation is mandatory on ALL POST active branches
  // (after actor resolution and auth checks, before any 200/201 response)
  const rawIdempotencyKey = req.headers["idempotency-key"]
  if (
    !rawIdempotencyKey ||
    typeof rawIdempotencyKey !== "string" ||
    rawIdempotencyKey.trim().length === 0
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key header is required for cart creation"
    )
  }
  assertValidRawIdempotencyKey(rawIdempotencyKey)

  if (actor.actorType === "guest") {
    const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
      GUEST_CART_CAPABILITY_MODULE
    )
    // Valid existing guest capability -> reuse existing cart
    const cart = await retrieveCartById(req, actor.cartId, async () => {
      await guestCapService.consumeGuestCartCapability(actor.capabilityRecord.id)
    })
    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Active cart for guest capability not found"
      )
    }
    assertNoPaymentOrOrderFields(cart)
    const version = await initializeCartResourceVersion(req, cart.id)
    res.setHeader("ETag", formatCartEtag(version))
    res.status(200).json({ cart })
    return
  }

  if (actor.actorType === "customer") {
    const result = await withCustomerCartAuthorityTransaction(
      req,
      actor.customerId,
      ({ authority, sharedContext, registerAuthority }) =>
        createOrReuseCustomerCartUnderAuthority(
          req,
          actor.customerId,
          rawIdempotencyKey,
          authority,
          sharedContext,
          registerAuthority
        )
    )
    // A newly created Cart is intentionally read with the shared Cart manager
    // while the transaction is open. Refetch the committed public projection
    // after commit so linked Customer/catalog fields are serialized normally.
    const cart = await refetchActiveCart(req, result.cart.id)
    if (cart.customer_id !== actor.customerId) {
      throwCustomerAuthorityConflict()
    }
    result.cart = cart
    const version = await initializeCartResourceVersion(req, result.cart.id)
    res.setHeader("ETag", formatCartEtag(version))
    // Customer path never emits guest capability header
    res.status(result.statusCode).json({ cart: result.cart })
    return
  }

  // Branch C: guest_anonymous (no guest capability header, no authorization header)
  // BFF guard has already authorized request
  const storeIdempotencyService = req.scope.resolve<StoreIdempotencyModuleService>(
    STORE_IDEMPOTENCY_MODULE
  )
  const bffHeader = req.headers[CUSTOMER_AUTH_BFF_AUTH_HEADER]
  const actorScope = guestCartCreateActorScope({
    bffKeyHash: hashBffSecret(bffHeader),
  })
  const canonicalSemanticObject = {
    currency_code: "brl",
  }
  const claimResult = await storeIdempotencyService.claim({
    operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
    actorScope,
    rawIdempotencyKey,
    canonicalSemanticObject,
  })

  if (claimResult.type === "conflict") {
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency key reuse conflict"
      ),
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
    const record = claimResult.record
    if (record.state === "completed" && record.result_id) {
      const cart = await refetchActiveCart(req, record.result_id)
      assertNoPaymentOrOrderFields(cart)
      const version = await initializeCartResourceVersion(req, cart.id)
      res.setHeader("ETag", formatCartEtag(version))
      // Replay contract: HTTP 200 without x-indicio-guest-cart-token header
      res.status(200).json({ cart })
      return
    }
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency key previously terminated with failure or requires reconciliation"
      ),
      { code: "IDEMPOTENCY_KEY_REUSE_CONFLICT", statusCode: 409, status: 409 }
    )
  }

  let currentStateVersion = claimResult.record.state_version
  let cartId: string | null = null
  try {
    const { result } = await createCartWorkflow(req.scope).run({
      input: {
        currency_code: "brl",
      },
    })
    cartId = result.id
  } catch (error) {
    try {
      await storeIdempotencyService.markFailedRetryable({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        failure_code: "CART_CREATION_FAILED",
        next_retry_at: new Date(Date.now() + 5000),
        retry_attempt_count: 1,
        retry_started_at: new Date(),
        state_deadline_at: new Date(Date.now() + 5 * 60 * 1000),
      })
    } catch {}
    throw error
  }

  // Immediately record confirmed result pointer before refetch / capability mint
  const partialResult = await storeIdempotencyService.recordProcessingResult({
    id: claimResult.record.id,
    expectedStateVersion: currentStateVersion,
    result_type: "cart",
    result_id: cartId,
    response_status: 201,
    result_safe_metadata: {
      operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
      result_type: "cart",
      result_id: cartId,
      response_status: 201,
    },
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

  currentStateVersion = partialResult.record.state_version

  let cart: StoreCartRecord
  try {
    cart = await refetchActiveCart(req, cartId)
    assertNoPaymentOrOrderFields(cart)
  } catch (error) {
    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cartId,
        failure_code: "CART_REFETCH_FAILED",
      })
    } catch {}
    throw error
  }

  let mintResult: {
    plaintext_token: string
    record: { id: string; cart_id: string }
  }
  try {
    const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
      GUEST_CART_CAPABILITY_MODULE
    )
    mintResult = await guestCapService.mintGuestCartCapability({
      cart_id: cart.id,
    })
  } catch (error) {
    // Post-create / mint failure: NEVER mark retryable (which would allow a 2nd create on retry!)
    // Mark reconciliation_required or failed_terminal, preserving result_id = cart.id
    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cart.id,
        failure_code: "CAPABILITY_MINT_FAILED",
      })
    } catch {}
    throw error
  }

  const linkDefinition = {
    [Modules.CART]: { cart_id: cart.id },
    [GUEST_CART_CAPABILITY_MODULE]: {
      guest_cart_capability_id: mintResult.record.id,
    },
  }
  try {
    await createGuestCartCapabilityLink(req, cart.id, mintResult.record.id)
  } catch (linkError) {
    let compensationFailed = false

    try {
      await dismissGuestCartCapabilityLink(req, linkDefinition)
    } catch {
      compensationFailed = true
    }

    try {
      await compensateGuestCartCapabilityMint(req, mintResult.record.id)
    } catch {
      compensationFailed = true
    }

    try {
      await compensateGuestCartCreation(req, cart.id)
    } catch {
      compensationFailed = true
    }

    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cart.id,
        failure_code: compensationFailed
          ? "CAPABILITY_LINK_COMPENSATION_FAILED"
          : "CAPABILITY_LINK_FAILED",
      })
    } catch {}
    throw linkError
  }

  let completion: LifecycleClaimResult
  try {
    completion = await storeIdempotencyService.markCompleted({
      id: claimResult.record.id,
      expectedState: "processing",
      expectedStateVersion: currentStateVersion,
      result_type: "cart",
      result_id: cart.id,
      response_status: 201,
      result_safe_metadata: {
        operation: STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
        result_type: "cart",
        result_id: cart.id,
        response_status: 201,
      },
    })
  } catch (error) {
    try {
      await storeIdempotencyService.markReconciliationRequired({
        id: claimResult.record.id,
        expectedState: "processing",
        expectedStateVersion: currentStateVersion,
        result_type: "cart",
        result_id: cart.id,
        failure_code: "MARK_COMPLETED_FAILED",
      })
    } catch {}
    throw error
  }

  if (completion.type !== "claimed") {
    throw Object.assign(
      new MedusaError(
        MedusaError.Types.CONFLICT,
        "Operation currently in progress or ownership lost for this idempotency key"
      ),
      { code: "IDEMPOTENCY_KEY_IN_PROGRESS", statusCode: 409, status: 409, retryable: true }
    )
  }

  const version = await initializeCartResourceVersion(req, cart.id)
  res.setHeader("ETag", formatCartEtag(version))

  // Set header only on 201 guest create after successful markCompleted
  res.setHeader(GUEST_CART_CAPABILITY_HEADER, mintResult.plaintext_token)

  // Dual-run session hint only (P15-D10)
  const requestWithSession = req as MedusaRequest & { session?: { active_cart_id?: string } }
  if (requestWithSession.session) {
    requestWithSession.session.active_cart_id = cart.id
  }

  res.status(201).json({ cart })
}
