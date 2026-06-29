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
