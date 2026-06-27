import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { isSellableVariant } from "../../../workflows/catalog/validate-sellable-variant"

type StoreCatalogPrice = {
  currency_code: string
  amount: number
}

type StoreCatalogOptionValue = {
  id?: string | null
  value?: string | null
}

type StoreCatalogOption = {
  id: string
  title?: string | null
  values?: StoreCatalogOptionValue[] | null
}

type StoreCatalogVariant = {
  id: string
  title?: string | null
  sku?: string | null
  metadata?: Record<string, unknown> | null
  prices?: StoreCatalogPrice[] | null
  options?: StoreCatalogOptionValue[] | null
}

type StoreCatalogImage = {
  id?: string | null
  url?: string | null
}

type StoreCatalogProduct = {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  thumbnail?: string | null
  images?: StoreCatalogImage[] | null
  options?: StoreCatalogOption[] | null
  variants?: StoreCatalogVariant[] | null
}

export type PublicStoreCatalogVariant = {
  id: string
  title: string | null
  sku: string | null
  is_sellable: true
  price: {
    currency_code: "brl"
    amount: number
  }
  options: Array<{
    name: string
    value: string
  }>
}

export type PublicStoreCatalogProduct = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  handle: string | null
  thumbnail: string | null
  images: Array<{
    id: string | null
    url: string
  }>
  options: Array<{
    id: string
    title: string
    values: string[]
  }>
  variants: PublicStoreCatalogVariant[]
}

type StoreProductsListResponse = {
  products: StoreCatalogProduct[]
  count?: number
  offset?: number
  limit?: number
  estimate_count?: number
}

type StoreProductResponse = {
  product: StoreCatalogProduct
}

type JsonResponse = StoreProductsListResponse | StoreProductResponse | Record<string, unknown>

type JsonMethod = MedusaResponse["json"]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function toNullableString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null
}

function normalizeImages(images?: StoreCatalogImage[] | null) {
  return (images ?? [])
    .filter((image): image is StoreCatalogImage & { url: string } =>
      isNonEmptyString(image?.url)
    )
    .map((image) => ({
      id: toNullableString(image.id),
      url: image.url.trim(),
    }))
}

function normalizeProductOptions(options?: StoreCatalogOption[] | null) {
  return (options ?? [])
    .filter(
      (option): option is StoreCatalogOption =>
        isNonEmptyString(option?.id) && isNonEmptyString(option?.title)
    )
    .map((option) => ({
      id: option.id,
      title: option.title!.trim(),
      values: [...new Set(
        (option.values ?? [])
          .map((value) => toNullableString(value?.value))
          .filter((value): value is string => value !== null)
      )],
    }))
}

function getVisibleVariantOptions(
  product: StoreCatalogProduct,
  variant: StoreCatalogVariant
) {
  const productOptions = normalizeProductOptions(product.options)

  return (variant.options ?? [])
    .map((option, index) => {
      const value = toNullableString(option?.value)

      if (!value) {
        return null
      }

      return {
        name: productOptions[index]?.title ?? `option_${index + 1}`,
        value,
      }
    })
    .filter((option): option is { name: string; value: string } => option !== null)
}

function getBrlPrice(
  variant: StoreCatalogVariant
): PublicStoreCatalogVariant["price"] | null {
  const price = (variant.prices ?? []).find(
    (entry) => entry.currency_code.toLowerCase() === "brl"
  )

  if (!price || !Number.isInteger(price.amount)) {
    return null
  }

  return {
    currency_code: "brl",
    amount: price.amount,
  }
}

function serializeVariant(
  product: StoreCatalogProduct,
  variant: StoreCatalogVariant
): PublicStoreCatalogVariant | null {
  if (
    !isSellableVariant({
      id: variant.id,
      sku: variant.sku ?? undefined,
      metadata: variant.metadata ?? null,
      prices: variant.prices ?? undefined,
    })
  ) {
    return null
  }

  const price = getBrlPrice(variant)

  if (!price) {
    return null
  }

  return {
    id: variant.id,
    title: toNullableString(variant.title),
    sku: toNullableString(variant.sku),
    is_sellable: true,
    price,
    options: getVisibleVariantOptions(product, variant),
  }
}

export function serializeStoreCatalogProduct(
  product: StoreCatalogProduct
): PublicStoreCatalogProduct | null {
  const variants = (product.variants ?? [])
    .map((variant) => serializeVariant(product, variant))
    .filter((variant): variant is PublicStoreCatalogVariant => variant !== null)

  if (variants.length === 0) {
    return null
  }

  return {
    id: product.id,
    title: product.title,
    subtitle: toNullableString(product.subtitle),
    description: toNullableString(product.description),
    handle: toNullableString(product.handle),
    thumbnail: toNullableString(product.thumbnail),
    images: normalizeImages(product.images),
    options: normalizeProductOptions(product.options),
    variants,
  }
}

export function serializeStoreProductsResponse(body: StoreProductsListResponse) {
  const products = body.products
    .map((product) => serializeStoreCatalogProduct(product))
    .filter((product): product is PublicStoreCatalogProduct => product !== null)

  return {
    ...body,
    products,
    count: typeof body.count === "number" ? products.length : body.count,
    estimate_count:
      typeof body.estimate_count === "number" ? products.length : body.estimate_count,
  }
}

export function serializeStoreProductResponse(body: StoreProductResponse) {
  const product = serializeStoreCatalogProduct(body.product)

  if (!product) {
    return null
  }

  return {
    product,
  }
}

function isStoreProductsListResponse(
  body: JsonResponse
): body is StoreProductsListResponse {
  return Array.isArray((body as StoreProductsListResponse)?.products)
}

function isStoreProductResponse(body: JsonResponse): body is StoreProductResponse {
  return typeof (body as StoreProductResponse)?.product === "object"
}

export function createStoreCatalogResponseMiddleware() {
  return function storeCatalogResponseMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const originalJson = res.json.bind(res) as JsonMethod

    res.json = ((body: JsonResponse) => {
      if (isStoreProductsListResponse(body)) {
        return originalJson(serializeStoreProductsResponse(body))
      }

      if (isStoreProductResponse(body)) {
        const responseBody = serializeStoreProductResponse(body)

        if (!responseBody) {
          res.status(404)
          return originalJson({
            type: "not_found",
            message: `Product with id: ${req.params.id} was not found`,
          })
        }

        return originalJson(responseBody)
      }

      return originalJson(body)
    }) as JsonMethod

    next()
  }
}

export const storeCatalogResponseMiddleware =
  createStoreCatalogResponseMiddleware()
