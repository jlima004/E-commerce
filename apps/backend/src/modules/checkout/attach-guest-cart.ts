import { isCartUsableForCheckout, type CheckoutCartLike } from "./active-cart"

type RequestSessionLike = {
  id?: unknown
  active_cart_id?: unknown
}

type AuthenticatedCustomerLike = {
  id: string
  email?: string | null
}

export type AttachGuestCartInput = {
  customer: AuthenticatedCustomerLike
  customerCart?: CheckoutCartLike | null
  guestCart?: CheckoutCartLike | null
  session?: RequestSessionLike | null
  requestedCartId?: string | null
}

export type AttachGuestCartResult =
  | {
      action: "transfer"
      guestCartId: string
      normalizedEmail?: string
      supersedeCustomerCartId?: string
    }
  | {
      action: "preserve_customer_cart"
      reason:
        | "missing_session_guest_cart"
        | "guest_cart_not_found"
        | "guest_cart_empty_or_not_usable"
        | "guest_cart_already_customer_cart"
      customerCartId?: string
      normalizedEmail?: string
    }
  | {
      action: "reject_unauthorized_guest_cart"
      reason: "requested_cart_not_in_session" | "session_guest_cart_mismatch"
    }

type ResolveCurrentSessionGuestCartResult =
  | {
      status: "authorized"
      guestCart: CheckoutCartLike | null
    }
  | {
      status: "reject_unauthorized_guest_cart"
      reason: "requested_cart_not_in_session" | "session_guest_cart_mismatch"
    }

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

export function resolveCurrentSessionGuestCart(input: {
  session?: RequestSessionLike | null
  requestedCartId?: string | null
  guestCart?: CheckoutCartLike | null
}): ResolveCurrentSessionGuestCartResult {
  const sessionGuestCartId = asNonEmptyString(input.session?.active_cart_id)
  const requestedCartId = asNonEmptyString(input.requestedCartId)

  if (requestedCartId && requestedCartId !== sessionGuestCartId) {
    return {
      status: "reject_unauthorized_guest_cart",
      reason: "requested_cart_not_in_session",
    }
  }

  if (!sessionGuestCartId) {
    return {
      status: "authorized",
      guestCart: null,
    }
  }

  if (!input.guestCart) {
    return {
      status: "authorized",
      guestCart: null,
    }
  }

  if (input.guestCart.id !== sessionGuestCartId) {
    return {
      status: "reject_unauthorized_guest_cart",
      reason: "session_guest_cart_mismatch",
    }
  }

  return {
    status: "authorized",
    guestCart: input.guestCart,
  }
}

export function shouldTransferGuestCart(
  guestCart: CheckoutCartLike | null | undefined
): guestCart is CheckoutCartLike {
  if (!guestCart) {
    return false
  }

  return isCartUsableForCheckout(guestCart)
}

export function buildAttachGuestCartDecision(
  input: AttachGuestCartInput
): AttachGuestCartResult {
  const normalizedEmail = asNonEmptyString(input.customer.email)
  const resolvedGuestCart = resolveCurrentSessionGuestCart({
    session: input.session,
    requestedCartId: input.requestedCartId,
    guestCart: input.guestCart,
  })

  if (resolvedGuestCart.status === "reject_unauthorized_guest_cart") {
    return {
      action: "reject_unauthorized_guest_cart",
      reason: resolvedGuestCart.reason,
    }
  }

  const guestCart = resolvedGuestCart.guestCart
  const customerCartId = input.customerCart?.id

  if (!asNonEmptyString(input.session?.active_cart_id)) {
    return {
      action: "preserve_customer_cart",
      reason: "missing_session_guest_cart",
      customerCartId,
      normalizedEmail,
    }
  }

  if (!guestCart) {
    return {
      action: "preserve_customer_cart",
      reason: "guest_cart_not_found",
      customerCartId,
      normalizedEmail,
    }
  }

  if (customerCartId && customerCartId === guestCart.id) {
    return {
      action: "preserve_customer_cart",
      reason: "guest_cart_already_customer_cart",
      customerCartId,
      normalizedEmail,
    }
  }

  if (!shouldTransferGuestCart(guestCart)) {
    return {
      action: "preserve_customer_cart",
      reason: "guest_cart_empty_or_not_usable",
      customerCartId,
      normalizedEmail,
    }
  }

  return {
    action: "transfer",
    guestCartId: guestCart.id,
    normalizedEmail,
    supersedeCustomerCartId:
      customerCartId && customerCartId !== guestCart.id
        ? customerCartId
        : undefined,
  }
}
