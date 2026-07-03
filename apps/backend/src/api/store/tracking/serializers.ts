import { GELATO_FULFILLMENT_STATUS } from "../../../modules/gelato-fulfillment/types"
import type { GelatoFulfillmentTrackingSummary } from "../../../modules/gelato-fulfillment/types"

const PUBLIC_TRACKING_RESPONSE_KEYS = [
  "order_reference",
  "order_status",
  "fulfillment_status",
  "tracking_status",
  "item_count",
  "item_labels",
  "updated_at",
  "message",
] as const

export type PublicTrackingLookupResponse = {
  order_reference: string | null
  order_status: string | null
  fulfillment_status: string | null
  tracking_status: string | null
  item_count: number | null
  item_labels: string[]
  updated_at: string | null
  message: string | null
}

export type TrackingLookupOrderSnapshot = {
  display_id?: string | number | null
  metadata?: Record<string, unknown> | null
  updated_at?: string | null
  items?: Array<{
    title?: string | null
    product_title?: string | null
  }> | null
}

export type TrackingLookupFulfillmentSnapshot = {
  status?: string | null
  tracking_summary?: GelatoFulfillmentTrackingSummary | null
  request_summary?: {
    item_count?: number | null
  } | null
  updated_at?: string | null
}

const TRACKING_NOT_AVAILABLE_MESSAGE =
  "Rastreio ainda nao disponivel. Tente novamente em breve."

const FORBIDDEN_PUBLIC_RESPONSE_SUBSTRINGS = [
  "trackingcode",
  "trackingurl",
  "client_secret",
  "token_hash",
  "gelato_primary_order_id",
  "payment_intent",
  "federal_tax_id",
  "address_1",
  "postal_code",
  "copia-e-cola",
] as const

function normalizeOptionalStatus(value: unknown, maxLength = 64): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  return normalized.slice(0, maxLength)
}

export function buildSafePublicOrderReference(
  order: TrackingLookupOrderSnapshot | null | undefined
): string | null {
  if (!order) {
    return null
  }

  const displayId = order.display_id

  if (typeof displayId === "number" && Number.isFinite(displayId)) {
    return String(displayId)
  }

  if (typeof displayId === "string" && displayId.trim().length > 0) {
    return displayId.trim()
  }

  return null
}

function resolveOrderStatusSummary(
  order: TrackingLookupOrderSnapshot | null | undefined
): string | null {
  const metadata = order?.metadata

  if (metadata && typeof metadata === "object") {
    const fromMetadata = normalizeOptionalStatus(metadata.order_status)

    if (fromMetadata) {
      return fromMetadata
    }
  }

  return null
}

function resolveItemLabels(
  order: TrackingLookupOrderSnapshot | null | undefined
): string[] {
  const items = order?.items

  if (!Array.isArray(items)) {
    return []
  }

  const labels: string[] = []

  for (const item of items) {
    const label =
      normalizeOptionalStatus(item?.title, 120) ??
      normalizeOptionalStatus(item?.product_title, 120)

    if (label) {
      labels.push(label)
    }
  }

  return labels
}

function resolveUpdatedAt(
  order: TrackingLookupOrderSnapshot | null | undefined,
  fulfillment: TrackingLookupFulfillmentSnapshot | null | undefined
): string | null {
  const candidates = [fulfillment?.updated_at, order?.updated_at]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => b.getTime() - a.getTime())
  return candidates[0]?.toISOString() ?? null
}

function resolveTrackingStatusSummary(
  fulfillment: TrackingLookupFulfillmentSnapshot | null | undefined
): string | null {
  return normalizeOptionalStatus(
    fulfillment?.tracking_summary?.tracking_status ?? null,
    120
  )
}

function resolveSafeTrackingMessage(input: {
  fulfillmentStatus: string | null
  trackingStatus: string | null
}): string | null {
  if (input.trackingStatus) {
    return null
  }

  if (
    input.fulfillmentStatus === GELATO_FULFILLMENT_STATUS.SHIPPED ||
    input.fulfillmentStatus === GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED ||
    input.fulfillmentStatus === GELATO_FULFILLMENT_STATUS.DELIVERED
  ) {
    return null
  }

  return TRACKING_NOT_AVAILABLE_MESSAGE
}

export function serializePublicTrackingLookupResponse(input: {
  order: TrackingLookupOrderSnapshot | null | undefined
  fulfillment: TrackingLookupFulfillmentSnapshot | null | undefined
}): PublicTrackingLookupResponse {
  const fulfillmentStatus = normalizeOptionalStatus(input.fulfillment?.status ?? null)
  const trackingStatus = resolveTrackingStatusSummary(input.fulfillment)
  const itemCount =
    typeof input.fulfillment?.request_summary?.item_count === "number"
      ? input.fulfillment.request_summary.item_count
      : null

  return {
    order_reference: buildSafePublicOrderReference(input.order),
    order_status: resolveOrderStatusSummary(input.order),
    fulfillment_status: fulfillmentStatus,
    tracking_status: trackingStatus,
    item_count: itemCount,
    item_labels: resolveItemLabels(input.order),
    updated_at: resolveUpdatedAt(input.order, input.fulfillment),
    message: resolveSafeTrackingMessage({
      fulfillmentStatus,
      trackingStatus,
    }),
  }
}

export function getPublicTrackingLookupResponseKeys(): readonly string[] {
  return PUBLIC_TRACKING_RESPONSE_KEYS
}

export function assertPublicTrackingLookupResponseAllowlisted(
  value: unknown
): asserts value is PublicTrackingLookupResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PUBLIC_TRACKING_RESPONSE_INVALID")
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const allowed = [...PUBLIC_TRACKING_RESPONSE_KEYS].sort()

  if (keys.join("|") !== allowed.join("|")) {
    throw new Error("PUBLIC_TRACKING_RESPONSE_KEYS_FORBIDDEN")
  }

  const serialized = JSON.stringify(record).toLowerCase()

  for (const forbidden of FORBIDDEN_PUBLIC_RESPONSE_SUBSTRINGS) {
    if (serialized.includes(forbidden)) {
      throw new Error("PUBLIC_TRACKING_RESPONSE_FORBIDDEN_FIELD")
    }
  }
}
