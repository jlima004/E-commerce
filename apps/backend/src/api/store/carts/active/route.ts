import { createCartWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  assertNoPaymentOrOrderFields,
  resolveActiveCartIdentity,
} from "../../../../modules/checkout/active-cart"
import { storeCartPreOrderFields } from "../query-config"
import type { StoreCartPreOrderRecord } from "../serializers"

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
}

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
  req: SessionCapableRequest,
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
  req: SessionCapableRequest,
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
  req: SessionCapableRequest,
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

async function resolveExistingActiveCart(
  req: SessionCapableRequest
): Promise<StoreCartRecord | null> {
  const identity = resolveActiveCartIdentity({
    auth_context: req.auth_context,
    session: req.session,
  })

  if (identity.actorType === "customer") {
    const carts = await listCustomerCarts(req, identity.customerId)
    return carts.sort(sortByUpdatedAtDesc)[0] ?? null
  }

  if (!identity.activeCartId) {
    return null
  }

  return retrieveCartById(req, identity.activeCartId)
}

async function createActiveCart(req: SessionCapableRequest): Promise<StoreCartRecord> {
  const identity = resolveActiveCartIdentity({
    auth_context: req.auth_context,
    session: req.session,
  })

  const input =
    identity.actorType === "customer"
      ? {
          customer_id: identity.customerId,
          currency_code: "brl",
        }
      : {
          currency_code: "brl",
        }

  const { result } = await createCartWorkflow(req.scope).run({ input })
  const cart = await refetchActiveCart(req, result.id)

  if (identity.actorType === "guest" && req.session) {
    req.session.active_cart_id = cart.id
  }

  return cart
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const cart = await resolveExistingActiveCart(request)

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active cart found for the current actor"
    )
  }

  assertNoPaymentOrOrderFields(cart)

  res.status(200).json({
    cart,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const existingCart = await resolveExistingActiveCart(request)
  const cart = existingCart ?? (await createActiveCart(request))

  assertNoPaymentOrOrderFields(cart)

  res.status(existingCart ? 200 : 201).json({
    cart,
  })
}
