import { createCartWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
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

type StoreCartRecord = StoreCartPreOrderRecord

const ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

function isActiveMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.active_for_checkout !== false
}

function isIncompleteCart(cart: StoreCartRecord): boolean {
  return !cart.completed_at
}

function sortByUpdatedAtDesc(a: StoreCartRecord, b: StoreCartRecord): number {
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
}

async function listCustomerCarts(
  req: MedusaRequest,
  customerId: string
): Promise<StoreCartRecord[]> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: {
      filters: {
        customer_id: customerId,
        completed_at: null,
      },
    },
    fields: [...ACTIVE_CART_QUERY_FIELDS],
  })

  const results = (await remoteQuery(queryObject)) as StoreCartRecord[]

  return results.filter(
    (cart) =>
      isIncompleteCart(cart) &&
      isActiveMetadata(cart.metadata as Record<string, unknown>)
  )
}

async function refetchActiveCart(
  req: MedusaRequest,
  cartId: string
): Promise<StoreCartRecord> {
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

async function retrieveCartById(
  req: MedusaRequest,
  cartId: string,
  onCompleted?: () => Promise<void>
): Promise<StoreCartRecord | null> {
  try {
    const cart = await refetchActiveCart(req, cartId)

    if (cart.completed_at) {
      if (onCompleted) {
        await onCompleted()
      }
      return null
    }

    if (!isActiveMetadata(cart.metadata as Record<string, unknown>)) {
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
    const carts = await listCustomerCarts(req, actor.customerId)
    cart = carts.sort(sortByUpdatedAtDesc)[0] ?? null
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
    // Valid Customer context -> find existing active cart or create new cart
    const customerCarts = await listCustomerCarts(req, actor.customerId)
    const existingCart = customerCarts.sort(sortByUpdatedAtDesc)[0] ?? null

    if (existingCart) {
      assertNoPaymentOrOrderFields(existingCart)
      const version = await initializeCartResourceVersion(req, existingCart.id)
      res.setHeader("ETag", formatCartEtag(version))
      res.status(200).json({ cart: existingCart })
      return
    }

    // Customer creation path with Idempotency claim
    const storeIdempotencyService = req.scope.resolve<StoreIdempotencyModuleService>(
      STORE_IDEMPOTENCY_MODULE
    )
    const actorScope = customerActorScope({
      customerId: actor.customerId,
    })
    const canonicalSemanticObject = {
      customer_id: actor.customerId,
      currency_code: "brl",
    }
    const claimResult = await storeIdempotencyService.claim({
      operation: "store.carts.active.create",
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
          customer_id: actor.customerId,
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

    // Immediately record confirmed result pointer before refetch
    const partialResult = await storeIdempotencyService.recordProcessingResult({
      id: claimResult.record.id,
      expectedStateVersion: currentStateVersion,
      result_type: "cart",
      result_id: cartId,
      result_safe_metadata: {
        operation: "store.carts.active.create",
        result_type: "cart",
        result_id: cartId,
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
          operation: "store.carts.active.create",
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
    // Customer path never emits guest capability header
    res.status(201).json({ cart })
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
    operation: "store.carts.active.create",
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
    result_safe_metadata: {
      operation: "store.carts.active.create",
      result_type: "cart",
      result_id: cartId,
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

  let mintResult: { plaintext_token: string }
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
        operation: "store.carts.active.create",
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
