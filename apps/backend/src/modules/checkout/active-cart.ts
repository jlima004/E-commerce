import { isSellableVariant } from "../../workflows/catalog/validate-sellable-variant"

type CartMetadata = Record<string, unknown> | null | undefined

type CheckoutCartItem = {
  id?: string
  quantity?: number | null
  title?: string | null
  product_title?: string | null
  variant_id?: string | null
  variant_title?: string | null
  unit_price?: number | null
  variant?: Parameters<typeof isSellableVariant>[0] | null
}

export type CheckoutCartLike = {
  id: string
  email?: string | null
  currency_code?: string | null
  metadata?: CartMetadata
  items?: CheckoutCartItem[] | null
  order_id?: string | null
  payment_collection?: unknown
  payment_collection_id?: string | null
  payment_session_id?: string | null
  payment_attempt_id?: string | null
  completed_at?: string | Date | null
  [key: string]: unknown
}

type RequestSessionLike = {
  id?: unknown
  active_cart_id?: unknown
}

type RequestAuthContextLike = {
  actor_id?: unknown
  actor_type?: unknown
}

type RequestCustomerLike = {
  email?: unknown
}

type ResolveActiveCartIdentityInput = {
  auth_context?: RequestAuthContextLike | null
  session?: RequestSessionLike | null
  customer?: RequestCustomerLike | null
  body?: Record<string, unknown> | null
}

export type ActorCartIdentity =
  | {
      actorType: "customer"
      actorId: string
      customerId: string
      email?: string
    }
  | {
      actorType: "guest"
      actorId: string
      sessionId?: string
      activeCartId?: string
    }

export type ActiveCartMetadata = {
  active_for_checkout?: boolean
  superseded_by_cart_id?: string
  superseded_at?: string
}

type MarkCartSupersededOptions = {
  supersededByCartId: string
  supersededAt?: string
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readActiveCartMetadata(metadata: CartMetadata): ActiveCartMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {}
  }

  const record = metadata as Record<string, unknown>

  return {
    active_for_checkout:
      typeof record.active_for_checkout === "boolean"
        ? record.active_for_checkout
        : undefined,
    superseded_by_cart_id: asNonEmptyString(record.superseded_by_cart_id),
    superseded_at: asNonEmptyString(record.superseded_at),
  }
}

function isCartSuperseded(metadata: CartMetadata): boolean {
  const activeMetadata = readActiveCartMetadata(metadata)

  return (
    activeMetadata.active_for_checkout === false ||
    Boolean(activeMetadata.superseded_by_cart_id)
  )
}

function isPositiveQuantity(quantity: number | null | undefined): quantity is number {
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
}

export function resolveActiveCartIdentity(
  input: ResolveActiveCartIdentityInput
): ActorCartIdentity {
  const customerId =
    input.auth_context?.actor_type === "customer"
      ? asNonEmptyString(input.auth_context.actor_id)
      : undefined

  if (customerId) {
    return {
      actorType: "customer",
      actorId: customerId,
      customerId,
      email: asNonEmptyString(input.customer?.email),
    }
  }

  const sessionId = asNonEmptyString(input.session?.id)
  const activeCartId = asNonEmptyString(input.session?.active_cart_id)

  return {
    actorType: "guest",
    actorId: sessionId ?? activeCartId ?? "guest",
    sessionId,
    activeCartId,
  }
}

export function isCartUsableForCheckout(cart: CheckoutCartLike): boolean {
  if (isCartSuperseded(cart.metadata)) {
    return false
  }

  const items = cart.items ?? []

  if (items.length === 0) {
    return false
  }

  return items.every((item) => {
    if (!isPositiveQuantity(item.quantity)) {
      return false
    }

    if (!item.variant) {
      return true
    }

    return isSellableVariant(item.variant)
  })
}

export function markCartSupersededInput(
  cart: Pick<CheckoutCartLike, "id" | "metadata">,
  options: MarkCartSupersededOptions
): {
  id: string
  metadata: ActiveCartMetadata
} {
  const current = readActiveCartMetadata(cart.metadata)

  return {
    id: cart.id,
    metadata: {
      ...current,
      active_for_checkout: false,
      superseded_by_cart_id: options.supersededByCartId,
      superseded_at: options.supersededAt,
    },
  }
}

export function assertNoPaymentOrOrderFields(cart: CheckoutCartLike): void {
  const deferredIntentField = `payment_${"intent"}_id`
  const hasForbiddenField =
    Boolean(cart.order_id) ||
    Boolean(cart.payment_collection) ||
    Boolean(cart.payment_collection_id) ||
    Boolean(cart.payment_session_id) ||
    Boolean(cart.payment_attempt_id) ||
    Boolean(cart.completed_at) ||
    Boolean(cart[deferredIntentField])

  if (hasForbiddenField) {
    throw new Error("ACTIVE_CART_PREORDER_ONLY")
  }
}
