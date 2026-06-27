import {
  transferCartCustomerWorkflowId,
  updateCartWorkflowId,
} from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  assertNoPaymentOrOrderFields,
  markCartSupersededInput,
} from "../../../../../../modules/checkout/active-cart"
import { buildAttachGuestCartDecision } from "../../../../../../modules/checkout/attach-guest-cart"
import { storeCartPreOrderFields } from "../../../../carts/query-config"
import type { StoreCartPreOrderRecord } from "../../../../carts/serializers"

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
  body?: {
    cart_id?: unknown
    [key: string]: unknown
  }
}

type StoreCartRecord = StoreCartPreOrderRecord

const ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function isActiveMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.active_for_checkout !== false
}

function isIncompleteCart(cart: StoreCartRecord): boolean {
  return !cart.completed_at
}

function sortByUpdatedAtDesc(a: StoreCartRecord, b: StoreCartRecord): number {
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
}

type CustomerRecord = {
  id: string
  email?: string | null
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

async function refetchCart(
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
  cartId: string | undefined
): Promise<StoreCartRecord | null> {
  if (!cartId) {
    return null
  }

  try {
    const cart = await refetchCart(req, cartId)

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

async function retrieveCustomer(
  req: SessionCapableRequest,
  customerId: string
): Promise<CustomerRecord> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "customer",
    variables: {
      filters: {
        id: customerId,
      },
    },
    fields: ["id", "email"],
  })

  const [customer] = (await remoteQuery(queryObject)) as CustomerRecord[]

  if (!customer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Authenticated customer not found"
    )
  }

  return customer
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const customerId =
    request.auth_context?.actor_type === "customer"
      ? asNonEmptyString(request.auth_context.actor_id)
      : undefined

  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Customer authentication is required"
    )
  }

  const [customer, guestCart, customerCarts] = await Promise.all([
    retrieveCustomer(request, customerId),
    retrieveCartById(request, asNonEmptyString(request.session?.active_cart_id)),
    listCustomerCarts(request, customerId),
  ])

  const customerCart = customerCarts.sort(sortByUpdatedAtDesc)[0] ?? null
  const requestedCartId = asNonEmptyString(request.body?.cart_id)
  const attachDecision = buildAttachGuestCartDecision({
    customer,
    customerCart,
    guestCart,
    session: request.session,
    requestedCartId,
  })

  if (attachDecision.action === "reject_unauthorized_guest_cart") {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "Guest cart da sessao atual nao esta autorizado para attach."
    )
  }

  if (attachDecision.action === "preserve_customer_cart") {
    if (customerCart) {
      assertNoPaymentOrOrderFields(customerCart)
    }

    res.status(200).json({
      outcome: attachDecision.action,
      reason: attachDecision.reason,
      cart: customerCart,
    })
    return
  }

  const workflowEngine = request.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(transferCartCustomerWorkflowId, {
    input: {
      id: attachDecision.guestCartId,
      customer_id: customer.id,
    },
  })

  if (attachDecision.normalizedEmail) {
    await workflowEngine.run(updateCartWorkflowId, {
      input: {
        id: attachDecision.guestCartId,
        email: attachDecision.normalizedEmail,
      },
    })
  }

  if (attachDecision.supersedeCustomerCartId && customerCart) {
    await workflowEngine.run(updateCartWorkflowId, {
      input: {
        id: attachDecision.supersedeCustomerCartId,
        metadata: markCartSupersededInput(customerCart, {
          supersededByCartId: attachDecision.guestCartId,
          supersededAt: new Date().toISOString(),
        }).metadata,
      },
    })
  }

  if (request.session) {
    request.session.active_cart_id = attachDecision.guestCartId
  }

  const attachedCart = await refetchCart(request, attachDecision.guestCartId)
  assertNoPaymentOrOrderFields(attachedCart)

  res.status(200).json({
    outcome: "attached_guest_cart",
    cart: attachedCart,
  })
}
