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
import { env } from "../../../../config/env"
import { storeCartPreOrderFields } from "../query-config"
import type { StoreCartPreOrderRecord } from "../serializers"

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
      },
    },
    fields: [...ACTIVE_CART_QUERY_FIELDS],
  })

  const result = await remoteQuery(queryObject)
  return (result as StoreCartRecord[]).filter(
    (cart) => isIncompleteCart(cart) && isActiveMetadata(cart.metadata as Record<string, unknown>)
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
  cartId: string
): Promise<StoreCartRecord | null> {
  try {
    const cart = await refetchActiveCart(req, cartId)

    if (!isIncompleteCart(cart) || !isActiveMetadata(cart.metadata as Record<string, unknown>)) {
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
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active cart found for the presented guest capability"
    )
  }

  if (actor.actorType === "customer_auth_denied") {
    throw new MedusaError(
      actor.statusCode === 503
        ? MedusaError.Types.UNEXPECTED_STATE
        : MedusaError.Types.UNAUTHORIZED,
      "Customer authentication failed"
    )
  }

  if (actor.actorType === "guest_anonymous") {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active cart found for anonymous guest request"
    )
  }

  let cart: StoreCartRecord | null = null

  if (actor.actorType === "guest") {
    cart = await retrieveCartById(req, actor.cartId)
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
    throw new MedusaError(
      actor.statusCode === 503
        ? MedusaError.Types.UNEXPECTED_STATE
        : MedusaError.Types.UNAUTHORIZED,
      "Customer authentication failed"
    )
  }

  if (actor.actorType === "guest") {
    // Valid existing guest capability -> reuse existing cart
    const cart = await retrieveCartById(req, actor.cartId)
    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Active cart for guest capability not found"
      )
    }
    assertNoPaymentOrOrderFields(cart)
    res.status(200).json({ cart })
    return
  }

  if (actor.actorType === "customer") {
    // Valid Customer context -> find existing active cart or create new cart
    const customerCarts = await listCustomerCarts(req, actor.customerId)
    const existingCart = customerCarts.sort(sortByUpdatedAtDesc)[0] ?? null

    if (existingCart) {
      assertNoPaymentOrOrderFields(existingCart)
      res.status(200).json({ cart: existingCart })
      return
    }

    const { result } = await createCartWorkflow(req.scope).run({
      input: {
        customer_id: actor.customerId,
        currency_code: "brl",
      },
    })
    const cart = await refetchActiveCart(req, result.id)
    assertNoPaymentOrOrderFields(cart)
    // Customer path never emits guest capability header
    res.status(201).json({ cart })
    return
  }

  // Branch C: guest_anonymous (no guest capability header, no authorization header)
  // BFF guard has already authorized request
  const { result } = await createCartWorkflow(req.scope).run({
    input: {
      currency_code: "brl",
    },
  })
  const cart = await refetchActiveCart(req, result.id)
  assertNoPaymentOrOrderFields(cart)

  // Mint guest cart capability
  const guestCapService = req.scope.resolve<GuestCartCapabilityModuleService>(
    GUEST_CART_CAPABILITY_MODULE
  )
  const mintResult = await guestCapService.mintGuestCartCapability({
    cart_id: cart.id,
  })

  // Set header only on 201 guest create
  res.setHeader(GUEST_CART_CAPABILITY_HEADER, mintResult.plaintext_token)

  // Dual-run session hint only (P15-D10)
  const requestWithSession = req as MedusaRequest & { session?: { active_cart_id?: string } }
  if (requestWithSession.session) {
    requestWithSession.session.active_cart_id = cart.id
  }

  res.status(201).json({ cart })
}
