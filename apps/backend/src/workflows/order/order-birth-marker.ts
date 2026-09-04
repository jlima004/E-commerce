import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export const ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY =
  "order_birth_checkout_completion_log_id" as const

export class CartOrderBirthMarkerConflictError extends Error {
  readonly code = "CART_ORDER_BIRTH_MARKER_CONFLICT"

  constructor(
    readonly cartId: string,
    readonly existingCclId: string,
    readonly attemptedCclId: string
  ) {
    super(
      `Cart ${cartId} already has marker for CCL ${existingCclId}; cannot overwrite with ${attemptedCclId}`
    )
    this.name = "CartOrderBirthMarkerConflictError"
  }
}

export type ValidateCartMarkerResult =
  | { state: "absent" }
  | { state: "matches"; cclId: string }
  | { state: "conflict"; existingCclId: string }

export function inspectCartOrderBirthMarker(
  cart: { metadata?: Record<string, unknown> | null } | null | undefined,
  expectedCclId: string
): ValidateCartMarkerResult {
  const marker = cart?.metadata?.[ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]

  if (marker == null || marker === "") {
    return { state: "absent" }
  }

  if (typeof marker === "string" && marker.trim() === expectedCclId) {
    return { state: "matches", cclId: expectedCclId }
  }

  return { state: "conflict", existingCclId: String(marker) }
}

export function validateOrderBirthMarkerOnOrder(
  order: { id?: string; metadata?: Record<string, unknown> | null } | null | undefined,
  expectedCclId: string
): boolean {
  if (!order) return false
  const marker = order.metadata?.[ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]
  return typeof marker === "string" && marker.trim() === expectedCclId
}

export async function ensureCartOrderBirthMarkerDurable(
  container: MedusaContainer,
  cartId: string,
  cclId: string
): Promise<void> {
  const cartModule = container.resolve(Modules.CART) as any
  if (!cartModule) {
    throw new Error("CART_MODULE_UNAVAILABLE")
  }

  const cart = await cartModule.retrieveCart(cartId, {
    select: ["id", "metadata"],
  })

  const inspection = inspectCartOrderBirthMarker(cart, cclId)

  if (inspection.state === "matches") {
    // Already matches: idempotent no-op
    return
  }

  if (inspection.state === "conflict") {
    throw new CartOrderBirthMarkerConflictError(
      cartId,
      inspection.existingCclId,
      cclId
    )
  }

  // Absent: persist through canonical Cart module
  const nextMetadata = {
    ...(cart.metadata ?? {}),
    [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: cclId,
  }

  if (typeof cartModule.updateCarts === "function") {
    if (cartModule.updateCarts.length === 1) {
      await cartModule.updateCarts({ id: cartId, metadata: nextMetadata })
    } else {
      await cartModule.updateCarts(cartId, { metadata: nextMetadata })
    }
  } else {
    throw new Error("CART_MODULE_UPDATE_UNAVAILABLE")
  }
}
