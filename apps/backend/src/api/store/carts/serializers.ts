import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { CatalogVariantInput } from "../../../modules/catalog/types"
import {
  calculateCheckoutDataComplete,
  maskFederalTaxId,
  type BrazilShippingAddressInput,
  type CheckoutLineItemSnapshot,
} from "../../../modules/checkout/checkout-data"
import {
  resolvePaymentAttemptCartFingerprint,
  type PaymentAttemptCartFingerprintSource,
} from "../../../modules/payment-attempt/cart-invalidation"
import type { CheckoutCartLike } from "../../../modules/checkout/active-cart"
import type {
  CartMergeOutcome,
  CartMergeResponse,
  CartReviewAcknowledgeResponse,
  CartReviewState,
  RejectedItem,
} from "../../../modules/cart-merge/types"

type StoreCartShippingAddress = {
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
  metadata?: Record<string, unknown> | null
}

type StoreCartItem = {
  id?: string
  quantity?: number | null
  title?: string | null
  product_title?: string | null
  variant_id?: string | null
  variant_title?: string | null
  unit_price?: number | null
  variant?: CatalogVariantInput | null
}

export type StoreCartPreOrderRecord = CheckoutCartLike & {
  total?: number | null
  subtotal?: number | null
  item_total?: number | null
  shipping_total?: number | null
  tax_total?: number | null
  discount_total?: number | null
  created_at?: string
  updated_at?: string
  region_id?: string | null
  locale?: string | null
  customer?: {
    id?: string
    email?: string
  } | null
  items?: StoreCartItem[] | null
  shipping_address?: StoreCartShippingAddress | null
  region?: {
    countries?: Array<{ iso_2?: string | null }> | null
  } | null
}

export type PublicStoreCartShippingAddress = {
  first_name: string | null
  last_name: string | null
  company: string | null
  address_1: string | null
  address_2: string | null
  city: string | null
  postal_code: string | null
  country_code: string | null
  province: string | null
  phone: string | null
  masked_federal_tax_id: string | null
}

export type PublicStoreCartPreOrder = {
  id: string
  email: string | null
  currency_code: string | null
  locale: string | null
  total: number | null
  subtotal: number | null
  item_total: number | null
  shipping_total: number | null
  tax_total: number | null
  discount_total: number | null
  region_id: string | null
  created_at: string | null
  updated_at: string | null
  checkout_data_complete: boolean
  customer: {
    id: string | null
    email: string | null
  } | null
  items: Array<{
    id: string | null
    quantity: number
    title: string | null
    variant_id: string | null
    variant_title: string | null
    unit_price: number | null
  }>
  shipping_address: PublicStoreCartShippingAddress | null
}

type CartResponseBody = {
  cart: StoreCartPreOrderRecord | PublicStoreCartPreOrder | null
  [key: string]: unknown
}

type SerializedCartResponseBody = {
  cart: PublicStoreCartPreOrder | null
  [key: string]: unknown
}

type JsonMethod = MedusaResponse["json"]

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readFederalTaxId(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }

  return asTrimmedString(metadata.federal_tax_id)
}

export function mapCartShippingAddressToBrazilInput(
  address: StoreCartShippingAddress | null | undefined
): BrazilShippingAddressInput | null {
  if (!address) {
    return null
  }

  const fullName = [address.first_name, address.last_name]
    .map((part) => asTrimmedString(part))
    .filter((part): part is string => Boolean(part))
    .join(" ")

  return {
    full_name: fullName || undefined,
    address_1: address.address_1,
    address_2: address.address_2,
    city: address.city,
    province: address.province,
    postal_code: address.postal_code,
    country_code: address.country_code,
    phone: address.phone,
    company: address.company,
    federal_tax_id: readFederalTaxId(address.metadata),
  }
}

function resolveRegionCountryCode(cart: StoreCartPreOrderRecord): string | null {
  const country = cart.region?.countries?.[0]?.iso_2
  return asTrimmedString(country)?.toLowerCase() ?? null
}

function resolveCheckoutActorType(
  cart: StoreCartPreOrderRecord
): "guest" | "customer" {
  return cart.customer?.id ? "customer" : "guest"
}

function toLineItemSnapshots(items: StoreCartItem[] | null | undefined): CheckoutLineItemSnapshot[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    quantity: item.quantity,
    variant_id: item.variant_id,
    variant: item.variant ?? undefined,
  }))
}

export function withCheckoutDataComplete(cart: StoreCartPreOrderRecord): boolean {
  const actorType = resolveCheckoutActorType(cart)
  const result = calculateCheckoutDataComplete({
    actorType,
    guestEmail: cart.email,
    customerEmail: cart.customer?.email,
    shippingAddress: mapCartShippingAddressToBrazilInput(cart.shipping_address),
    lineItems: toLineItemSnapshots(cart.items),
    currencyCode: cart.currency_code,
    regionCountryCode: resolveRegionCountryCode(cart) ?? "br",
  })

  return result.checkout_data_complete
}

function serializeShippingAddress(
  address: StoreCartShippingAddress | null | undefined
): PublicStoreCartShippingAddress | null {
  if (!address) {
    return null
  }

  const rawTaxId = readFederalTaxId(address.metadata)

  return {
    first_name: address.first_name ?? null,
    last_name: address.last_name ?? null,
    company: address.company ?? null,
    address_1: address.address_1 ?? null,
    address_2: address.address_2 ?? null,
    city: address.city ?? null,
    postal_code: address.postal_code ?? null,
    country_code: address.country_code ?? null,
    province: address.province ?? null,
    phone: address.phone ?? null,
    masked_federal_tax_id: rawTaxId ? maskFederalTaxId(rawTaxId) : null,
  }
}

export function serializeStoreCartPreOrder(
  cart: StoreCartPreOrderRecord | null
): PublicStoreCartPreOrder | null {
  if (!cart) {
    return null
  }

  return {
    id: cart.id,
    email: cart.email ?? null,
    currency_code: cart.currency_code ?? null,
    locale: cart.locale ?? null,
    total: cart.total ?? null,
    subtotal: cart.subtotal ?? null,
    item_total: cart.item_total ?? null,
    shipping_total: cart.shipping_total ?? null,
    tax_total: cart.tax_total ?? null,
    discount_total: cart.discount_total ?? null,
    region_id: cart.region_id ?? null,
    created_at: cart.created_at ?? null,
    updated_at: cart.updated_at ?? null,
    checkout_data_complete: withCheckoutDataComplete(cart),
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
    shipping_address: serializeShippingAddress(cart.shipping_address),
  }
}

function isCartResponseBody(body: unknown): body is CartResponseBody {
  return typeof body === "object" && body !== null && "cart" in body
}

export function serializeCartResponseBody(body: CartResponseBody): SerializedCartResponseBody {
  const cart =
    body.cart && "checkout_data_complete" in body.cart
      ? (body.cart as PublicStoreCartPreOrder)
      : serializeStoreCartPreOrder(body.cart as StoreCartPreOrderRecord | null)

  return {
    ...body,
    cart,
  }
}

export function createStoreCartPreOrderResponseMiddleware() {
  return function storeCartPreOrderResponseMiddleware(
    _req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const originalJson = res.json.bind(res) as JsonMethod

    res.json = ((body: unknown) => {
      if (isCartResponseBody(body)) {
        return originalJson(serializeCartResponseBody(body))
      }

      return originalJson(body)
    }) as JsonMethod

    next()
  }
}

export const storeCartPreOrderResponseMiddleware =
  createStoreCartPreOrderResponseMiddleware()

export function resolvePaymentAttemptCartFingerprintFromStoreCart(
  cart: StoreCartPreOrderRecord
): string {
  const source: PaymentAttemptCartFingerprintSource = {
    actorType: cart.customer?.id ? "customer" : "guest",
    email: cart.email,
    customerEmail: cart.customer?.email,
    items: cart.items,
    shippingAddress: mapCartShippingAddressToBrazilInput(cart.shipping_address),
  }

  return resolvePaymentAttemptCartFingerprint(source)
}

type CartReviewRecordInput = {
  status: "pending" | "acknowledged"
  review_ref: string | null
  rejected_items: readonly RejectedItem[]
}

type CartMergeResponseInput = {
  outcome: CartMergeOutcome
  cart: StoreCartPreOrderRecord | PublicStoreCartPreOrder | null
  review: CartReviewState | CartReviewRecordInput
}

function serializeRejectedItems(
  items: readonly RejectedItem[]
): RejectedItem[] {
  return items.map((item) => serializeCartMergeRejectedItem(item))
}

export function serializeCartMergeRejectedItem(
  item: RejectedItem
): RejectedItem {
  return {
    variantId: item.variantId,
    requestedQuantity: item.requestedQuantity,
    acceptedQuantity: item.acceptedQuantity,
    rejectedQuantity: item.rejectedQuantity,
    reason: item.reason,
  }
}

export function serializeCartReviewState(
  review: CartReviewState | CartReviewRecordInput
): CartReviewState {
  if ("requiresReview" in review) {
    return {
      requiresReview: review.requiresReview,
      reviewRef: review.requiresReview ? review.reviewRef : null,
      rejectedItems: serializeRejectedItems(review.rejectedItems),
    }
  }

  const pending = review.status === "pending"
  return {
    requiresReview: pending,
    reviewRef: pending ? review.review_ref : null,
    rejectedItems: pending ? serializeRejectedItems(review.rejected_items) : [],
  }
}

function serializePublicCartSnapshot(
  cart: PublicStoreCartPreOrder
): PublicStoreCartPreOrder {
  return {
    id: cart.id,
    email: cart.email,
    currency_code: cart.currency_code,
    locale: cart.locale,
    total: cart.total,
    subtotal: cart.subtotal,
    item_total: cart.item_total,
    shipping_total: cart.shipping_total,
    tax_total: cart.tax_total,
    discount_total: cart.discount_total,
    region_id: cart.region_id,
    created_at: cart.created_at,
    updated_at: cart.updated_at,
    checkout_data_complete: cart.checkout_data_complete,
    customer: cart.customer
      ? {
          id: cart.customer.id,
          email: cart.customer.email,
        }
      : null,
    items: cart.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      title: item.title,
      variant_id: item.variant_id,
      variant_title: item.variant_title,
      unit_price: item.unit_price,
    })),
    shipping_address: cart.shipping_address
      ? {
          first_name: cart.shipping_address.first_name,
          last_name: cart.shipping_address.last_name,
          company: cart.shipping_address.company,
          address_1: cart.shipping_address.address_1,
          address_2: cart.shipping_address.address_2,
          city: cart.shipping_address.city,
          postal_code: cart.shipping_address.postal_code,
          country_code: cart.shipping_address.country_code,
          province: cart.shipping_address.province,
          phone: cart.shipping_address.phone,
          masked_federal_tax_id:
            cart.shipping_address.masked_federal_tax_id,
        }
      : null,
  }
}

function serializeCartMergeCart(
  cart: StoreCartPreOrderRecord | PublicStoreCartPreOrder | null
): PublicStoreCartPreOrder | null {
  if (!cart) {
    return null
  }

  if ("checkout_data_complete" in cart) {
    return serializePublicCartSnapshot(cart)
  }

  return serializeStoreCartPreOrder(cart)
}

export function serializeCartMergeResponse(
  response: CartMergeResponseInput
): CartMergeResponse {
  return {
    outcome: response.outcome,
    cart: serializeCartMergeCart(response.cart),
    review: serializeCartReviewState(response.review),
  }
}

export function serializeCartReviewAcknowledgeResponse(
  response: Omit<CartMergeResponseInput, "outcome">
): CartReviewAcknowledgeResponse {
  return {
    cart: serializeCartMergeCart(response.cart),
    review: serializeCartReviewState(response.review),
  }
}
