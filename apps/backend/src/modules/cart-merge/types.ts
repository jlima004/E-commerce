import type { PublicStoreCartPreOrder } from "../../api/store/carts/serializers"

export const CART_MERGE_OUTCOMES = [
  "MERGED",
  "MERGED_PARTIAL",
  "GUEST_CART_ATTACHED",
  "CUSTOMER_CART_PRESERVED",
  "NO_ITEMS",
] as const

export type CartMergeOutcome = (typeof CART_MERGE_OUTCOMES)[number]

export const CART_MERGE_REJECTION_REASONS = [
  "VARIANT_INVALID",
  "VARIANT_UNAVAILABLE",
  "QUANTITY_LIMIT_EXCEEDED",
] as const

export type CartMergeRejectionReason =
  (typeof CART_MERGE_REJECTION_REASONS)[number]

export type NormalizedGuestIntentItem = {
  variantId: string
  quantity: number
}

export type RejectedItem = {
  variantId: string
  requestedQuantity: number
  acceptedQuantity: number
  rejectedQuantity: number
  reason: CartMergeRejectionReason
}

export type CartReviewState = {
  requiresReview: boolean
  reviewRef: string | null
  rejectedItems: RejectedItem[]
}

export type CartMergeResponse = {
  outcome: CartMergeOutcome
  cart: PublicStoreCartPreOrder | null
  review: CartReviewState
}

export type CartReviewAcknowledgeResponse = {
  cart: PublicStoreCartPreOrder | null
  review: CartReviewState
}

export type CanonicalCustomerCartAuthorityResult =
  | {
      type: "none"
      customerId: string
    }
  | {
      type: "single"
      customerId: string
      cartId: string
      authorityId: string
    }
  | {
      type: "ambiguous"
      customerId: string
    }
  | {
      type: "conflict"
      customerId: string
    }

/**
 * Input projection accepted by the pure decision engine. The snake_case
 * aliases exist only for persisted Medusa rows and never cross a public
 * serializer.
 */
export type CartMergeLineItemInput = {
  id?: unknown
  variantId?: unknown
  variant_id?: unknown
  quantity?: unknown
  title?: unknown
  variantTitle?: unknown
  variant_title?: unknown
  unitPrice?: unknown
  unit_price?: unknown
  currencyCode?: unknown
  currency_code?: unknown
}

export type CartMergeCartInput = {
  items?: readonly CartMergeLineItemInput[] | null
}

export type CartMergeVariantAvailability =
  | "valid"
  | "invalid"
  | "unavailable"

export type CartMergeVariantAvailabilityMap =
  | ReadonlyMap<string, CartMergeVariantAvailability>
  | Readonly<Record<string, CartMergeVariantAvailability>>

export type CartMergeDecisionInput = {
  guestCart?: CartMergeCartInput | null
  guestItems?: readonly CartMergeLineItemInput[] | null
  customerCart?: CartMergeCartInput | null
  customerItems?: readonly CartMergeLineItemInput[] | null
  variantAvailability?: CartMergeVariantAvailabilityMap
  variantStates?: CartMergeVariantAvailabilityMap
  validVariantIds?: readonly string[]
  invalidVariantIds?: readonly string[]
  unavailableVariantIds?: readonly string[]
}

export type CartMergeVariantDecision = {
  variantId: string
  requestedQuantity: number
  acceptedQuantity: number
  rejectedQuantity: number
  customerQuantityBefore: number
  customerQuantityAfter: number
  reason: CartMergeRejectionReason | null
}

export type CartMergeDecision = {
  outcome: CartMergeOutcome
  normalizedGuestIntent: NormalizedGuestIntentItem[]
  decisions: CartMergeVariantDecision[]
  acceptedItems: NormalizedGuestIntentItem[]
  rejectedItems: RejectedItem[]
  review: CartReviewState
}

export class CartMergeStateConflictError extends Error {
  readonly code = "CART_MERGE_STATE_CONFLICT"
  readonly statusCode = 409
  readonly status = 409

  constructor(message = "Persisted cart state is inconsistent") {
    super(message)
    this.name = "CartMergeStateConflictError"
  }
}
