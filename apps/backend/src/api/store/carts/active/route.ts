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
  type CheckoutCartLike,
} from "../../../../modules/checkout/active-cart"

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

type StoreCartRecord = CheckoutCartLike & {
  created_at?: string
  updated_at?: string
  region_id?: string | null
  customer?: {
    id?: string
    email?: string
  } | null
  items?: Array<{
    id?: string
    quantity?: number | null
    title?: string | null
    product_title?: string | null
    variant_id?: string | null
    variant_title?: string | null
    unit_price?: number | null
  }>
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    country_code?: string | null
    province?: string | null
    phone?: string | null
  } | null
}

const ACTIVE_CART_QUERY_FIELDS = [
  "id",
  "email",
  "currency_code",
  "locale",
  "region_id",
  "created_at",
  "updated_at",
  "completed_at",
  "metadata",
  "customer.id",
  "customer.email",
  "items.id",
  "items.quantity",
  "items.title",
  "items.product_title",
  "items.variant_id",
  "items.variant_title",
  "items.unit_price",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.company",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.postal_code",
  "shipping_address.country_code",
  "shipping_address.province",
  "shipping_address.phone",
] as const

function isActiveMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.active_for_checkout !== false
}

function isIncompleteCart(cart: StoreCartRecord): boolean {
  return !cart.completed_at
}

function sortByUpdatedAtDesc(a: StoreCartRecord, b: StoreCartRecord): number {
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
}

function serializeActiveCart(cart: StoreCartRecord) {
  return {
    id: cart.id,
    email: cart.email ?? null,
    currency_code: cart.currency_code ?? null,
    locale: cart.locale ?? null,
    region_id: cart.region_id ?? null,
    created_at: cart.created_at ?? null,
    updated_at: cart.updated_at ?? null,
    customer: cart.customer
      ? {
          id: cart.customer.id ?? null,
          email: cart.customer.email ?? null,
        }
      : null,
    items: (cart.items ?? []).map((item) => ({
      id: item.id ?? null,
      quantity: item.quantity ?? 0,
      title: item.title ?? item.product_title ?? null,
      variant_id: item.variant_id ?? null,
      variant_title: item.variant_title ?? null,
      unit_price: item.unit_price ?? null,
    })),
    shipping_address: cart.shipping_address
      ? {
          first_name: cart.shipping_address.first_name ?? null,
          last_name: cart.shipping_address.last_name ?? null,
          company: cart.shipping_address.company ?? null,
          address_1: cart.shipping_address.address_1 ?? null,
          address_2: cart.shipping_address.address_2 ?? null,
          city: cart.shipping_address.city ?? null,
          postal_code: cart.shipping_address.postal_code ?? null,
          country_code: cart.shipping_address.country_code ?? null,
          province: cart.shipping_address.province ?? null,
          phone: cart.shipping_address.phone ?? null,
        }
      : null,
  }
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
    cart: serializeActiveCart(cart),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const existingCart = await resolveExistingActiveCart(request)
  const cart = existingCart ?? (await createActiveCart(request))

  assertNoPaymentOrOrderFields(cart)

  res.status(existingCart ? 200 : 201).json({
    cart: serializeActiveCart(cart),
  })
}
