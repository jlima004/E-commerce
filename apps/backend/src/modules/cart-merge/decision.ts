import {
  CartMergeStateConflictError,
  type CartMergeCartInput,
  type CartMergeDecision,
  type CartMergeDecisionInput,
  type CartMergeLineItemInput,
  type CartMergeRejectionReason,
  type CartMergeVariantAvailability,
  type CartMergeVariantAvailabilityMap,
  type NormalizedGuestIntentItem,
  type RejectedItem,
} from "./types"

export const CART_MERGE_MAX_QUANTITY = 99 as const

type ParsedLineItem = {
  variantId: string
  quantity: number
  comparableValues: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readItems(
  input: CartMergeCartInput | readonly CartMergeLineItemInput[] | null | undefined
): readonly CartMergeLineItemInput[] {
  if (Array.isArray(input)) {
    return input
  }

  if (input === null || input === undefined) {
    return []
  }

  if (!isRecord(input) || input.items === null || input.items === undefined) {
    throw new CartMergeStateConflictError("Persisted cart items are malformed")
  }

  if (!Array.isArray(input.items)) {
    throw new CartMergeStateConflictError("Persisted cart items are malformed")
  }

  return input.items
}

function readVariantId(item: CartMergeLineItemInput): string {
  const publicVariantId = item.variantId
  const persistedVariantId = item.variant_id

  if (
    publicVariantId !== undefined &&
    persistedVariantId !== undefined &&
    typeof publicVariantId === "string" &&
    typeof persistedVariantId === "string" &&
    publicVariantId.trim() !== persistedVariantId.trim()
  ) {
    throw new CartMergeStateConflictError(
      "Persisted cart variant identifiers are inconsistent"
    )
  }

  const candidate =
    publicVariantId !== undefined ? publicVariantId : persistedVariantId
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new CartMergeStateConflictError(
      "Persisted cart line is missing a safe variant identifier"
    )
  }

  return candidate.trim()
}

function readQuantity(item: CartMergeLineItemInput): number {
  if (
    typeof item.quantity !== "number" ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity <= 0
  ) {
    throw new CartMergeStateConflictError(
      "Persisted cart line has an invalid quantity"
    )
  }

  return item.quantity
}

function readComparableValues(
  item: CartMergeLineItemInput
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {}
  const fields: ReadonlyArray<readonly [string, unknown]> = [
    ["title", item.title],
    ["variantTitle", item.variantTitle ?? item.variant_title],
    ["unitPrice", item.unitPrice ?? item.unit_price],
    ["currencyCode", item.currencyCode ?? item.currency_code],
  ]

  for (const [field, value] of fields) {
    if (value !== undefined && value !== null) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new CartMergeStateConflictError(
          "Persisted cart line has an invalid compatibility field"
        )
      }
      values[field] = String(value)
    }
  }

  return values
}

function parseLineItem(item: CartMergeLineItemInput): ParsedLineItem {
  if (!isRecord(item)) {
    throw new CartMergeStateConflictError("Persisted cart line is malformed")
  }

  return {
    variantId: readVariantId(item),
    quantity: readQuantity(item),
    comparableValues: readComparableValues(item),
  }
}

function addQuantities(current: number, addition: number): number {
  if (current > Number.MAX_SAFE_INTEGER - addition) {
    throw new CartMergeStateConflictError("Cart quantity exceeds safe integer")
  }
  return current + addition
}

export function normalizeGuestIntent(
  input:
    | CartMergeCartInput
    | readonly CartMergeLineItemInput[]
    | null
    | undefined
): NormalizedGuestIntentItem[] {
  const quantities = new Map<string, number>()

  for (const rawItem of readItems(input)) {
    const item = parseLineItem(rawItem)
    quantities.set(
      item.variantId,
      addQuantities(quantities.get(item.variantId) ?? 0, item.quantity)
    )
  }

  return [...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variantId, quantity]) => ({ variantId, quantity }))
}

function normalizeCustomerQuantities(
  input: CartMergeCartInput | readonly CartMergeLineItemInput[] | null | undefined
): Map<string, number> {
  const quantities = new Map<string, number>()
  const compatibility = new Map<string, Readonly<Record<string, string>>>()

  for (const rawItem of readItems(input)) {
    const item = parseLineItem(rawItem)
    const previous = compatibility.get(item.variantId)
    if (previous) {
      for (const [field, value] of Object.entries(item.comparableValues)) {
        const previousValue = previous[field]
        if (previousValue !== undefined && previousValue !== value) {
          throw new CartMergeStateConflictError(
            "Customer cart has incompatible duplicate variant lines"
          )
        }
      }
      compatibility.set(item.variantId, {
        ...previous,
        ...item.comparableValues,
      })
    } else {
      compatibility.set(item.variantId, item.comparableValues)
    }

    quantities.set(
      item.variantId,
      addQuantities(quantities.get(item.variantId) ?? 0, item.quantity)
    )
  }

  return quantities
}

function readAvailability(
  input: CartMergeDecisionInput,
  variantId: string
): CartMergeVariantAvailability {
  const availability = input.variantAvailability ?? input.variantStates
  if (availability) {
    const value = availability instanceof Map
      ? availability.get(variantId)
      : availability[variantId]
    if (value === undefined) {
      return "valid"
    }
    return value
  }

  if (input.invalidVariantIds?.includes(variantId)) {
    return "invalid"
  }
  if (input.unavailableVariantIds?.includes(variantId)) {
    return "unavailable"
  }
  if (input.validVariantIds && !input.validVariantIds.includes(variantId)) {
    return "unavailable"
  }
  return "valid"
}

function rejectionReasonForAvailability(
  availability: CartMergeVariantAvailability
): Extract<CartMergeRejectionReason, "VARIANT_INVALID" | "VARIANT_UNAVAILABLE"> | null {
  if (availability === "invalid") {
    return "VARIANT_INVALID"
  }
  if (availability === "unavailable") {
    return "VARIANT_UNAVAILABLE"
  }
  return null
}

function rejectedItem(
  variantId: string,
  requestedQuantity: number,
  acceptedQuantity: number,
  reason: CartMergeRejectionReason
): RejectedItem {
  const rejectedQuantity = requestedQuantity - acceptedQuantity
  return {
    variantId,
    requestedQuantity,
    acceptedQuantity,
    rejectedQuantity,
    reason,
  }
}

export function buildCartMergeDecision(
  input: CartMergeDecisionInput
): CartMergeDecision {
  const guestSource =
    input.guestCart !== undefined ? input.guestCart : input.guestItems
  if (guestSource === undefined) {
    throw new CartMergeStateConflictError("Guest cart intent is missing")
  }

  const normalizedGuestIntent = normalizeGuestIntent(guestSource)
  const hasCustomerDestination =
    input.customerCart !== undefined || input.customerItems !== undefined
  const customerSource =
    input.customerCart !== undefined ? input.customerCart : input.customerItems
  const customerQuantities = hasCustomerDestination
    ? normalizeCustomerQuantities(customerSource)
    : new Map<string, number>()

  const decisions = normalizedGuestIntent.map((intent) => {
    const customerQuantityBefore = customerQuantities.get(intent.variantId) ?? 0
    const availability = readAvailability(input, intent.variantId)
    const availabilityReason = rejectionReasonForAvailability(availability)

    let acceptedQuantity = 0
    let reason: CartMergeRejectionReason | null = availabilityReason
    if (!availabilityReason) {
      const capacity = Math.max(
        0,
        CART_MERGE_MAX_QUANTITY - customerQuantityBefore
      )
      acceptedQuantity = Math.min(intent.quantity, capacity)
      if (acceptedQuantity < intent.quantity) {
        reason = "QUANTITY_LIMIT_EXCEEDED"
      }
    }

    const rejectedQuantity = intent.quantity - acceptedQuantity
    const customerQuantityAfter = hasCustomerDestination
      ? customerQuantityBefore + acceptedQuantity
      : acceptedQuantity

    return {
      variantId: intent.variantId,
      requestedQuantity: intent.quantity,
      acceptedQuantity,
      rejectedQuantity,
      customerQuantityBefore,
      customerQuantityAfter,
      reason,
    }
  })

  const acceptedItems = decisions
    .filter((decision) => decision.acceptedQuantity > 0)
    .map((decision) => ({
      variantId: decision.variantId,
      quantity: decision.acceptedQuantity,
    }))
  const rejectedItems = decisions
    .filter((decision) => decision.rejectedQuantity > 0)
    .map((decision) =>
      rejectedItem(
        decision.variantId,
        decision.requestedQuantity,
        decision.acceptedQuantity,
        decision.reason ?? "VARIANT_INVALID"
      )
    )

  const acceptedTotal = acceptedItems.reduce(
    (total, item) => total + item.quantity,
    0
  )
  const rejectedTotal = rejectedItems.reduce(
    (total, item) => total + item.rejectedQuantity,
    0
  )

  const outcome =
    acceptedTotal === 0
      ? "NO_ITEMS"
      : rejectedTotal > 0
        ? "MERGED_PARTIAL"
        : hasCustomerDestination
          ? "MERGED"
          : "GUEST_CART_ATTACHED"
  const requiresReview = outcome === "MERGED_PARTIAL"
  const review = {
    requiresReview,
    reviewRef: null,
    rejectedItems,
  }

  return {
    outcome,
    normalizedGuestIntent,
    decisions,
    acceptedItems,
    rejectedItems,
    review,
  }
}
