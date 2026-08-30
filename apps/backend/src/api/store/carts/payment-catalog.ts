import type { MedusaRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import type { CatalogVariantInput } from "../../../modules/catalog/types"
import { storeCartPreOrderFields } from "./query-config"
import type { StoreCartPreOrderRecord } from "./serializers"

type PaymentCartProjection = {
  id?: unknown
  region?: {
    countries?: Array<{ iso_2?: unknown }> | null
  } | null
  items?: Array<{
    variant_id?: unknown
    variant?: {
      id?: unknown
      sku?: unknown
      metadata?: unknown
      prices?: unknown
    } | null
  }> | null
}

type QueryGraphService = {
  graph?: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type RemoteQueryService = (
  input: unknown
) => Promise<unknown>

export type PaymentCartCatalog = {
  region: StoreCartPreOrderRecord["region"]
  variantsById: Map<string, CatalogVariantInput>
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function asAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const amount = Number(value)
    return Number.isFinite(amount) ? amount : undefined
  }

  return undefined
}

function mapVariant(value: unknown): CatalogVariantInput | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const variant = value as {
    id?: unknown
    sku?: unknown
    metadata?: unknown
    prices?: unknown
  }
  const id = asNonEmptyString(variant.id)
  if (!id) {
    return null
  }

  const prices = Array.isArray(variant.prices)
    ? variant.prices.flatMap((value) => {
        if (!value || typeof value !== "object") {
          return []
        }

        const price = value as {
          currency_code?: unknown
          amount?: unknown
        }
        const currencyCode = asNonEmptyString(price.currency_code)
        const amount = asAmount(price.amount)
        if (!currencyCode || amount === undefined) {
          return []
        }

        return [{ currency_code: currencyCode, amount }]
      })
    : undefined

  return {
    id,
    sku: asNonEmptyString(variant.sku) ?? undefined,
    metadata: asMetadata(variant.metadata),
    prices,
  }
}

function mapProjection(value: unknown): PaymentCartProjection | null {
  if (!value || typeof value !== "object") {
    return null
  }

  return value as PaymentCartProjection
}

async function queryCartProjection(
  req: MedusaRequest,
  cartId: string
): Promise<PaymentCartProjection | null> {
  let query: QueryGraphService | undefined
  try {
    query = req.scope.resolve(
      ContainerRegistrationKeys.QUERY
    ) as QueryGraphService
  } catch {
    query = undefined
  }

  if (typeof query?.graph === "function") {
    const result = await query.graph({
      entity: "cart",
      fields: [...storeCartPreOrderFields],
      filters: { id: cartId },
    })
    return mapProjection(result?.data?.[0])
  }

  const remoteQuery = req.scope.resolve(
    ContainerRegistrationKeys.REMOTE_QUERY
  ) as RemoteQueryService
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id: cartId } },
    fields: [...storeCartPreOrderFields],
  })
  const result = await remoteQuery(queryObject)
  return mapProjection(Array.isArray(result) ? result[0] : null)
}

/**
 * Resolves linked Region/Product/Pricing data through Medusa's Query boundary.
 * The Cart module remains responsible for the transaction-bound Cart snapshot;
 * this projection supplies only the cross-module fields that Cart cannot
 * retrieve through its public service API.
 */
export async function resolvePaymentCartCatalog(
  req: MedusaRequest,
  lockedCart: {
    id: string
    items?: Array<{ variant_id?: unknown }> | null
  }
): Promise<PaymentCartCatalog> {
  const projection = await queryCartProjection(req, lockedCart.id)
  if (asNonEmptyString(projection?.id) !== lockedCart.id) {
    throw new Error("PAYMENT_CART_CATALOG_PROJECTION_UNAVAILABLE")
  }

  const variantsById = new Map<string, CatalogVariantInput>()
  for (const item of projection?.items ?? []) {
    const variantId = asNonEmptyString(item.variant_id)
    const variant = mapVariant(item.variant)
    if (!variantId || !variant) {
      continue
    }
    if (variant.id !== variantId) {
      throw new Error("PAYMENT_CART_CATALOG_PROJECTION_CONFLICT")
    }
    if (variantsById.has(variantId)) {
      throw new Error("PAYMENT_CART_CATALOG_PROJECTION_CONFLICT")
    }
    variantsById.set(variantId, variant)
  }

  for (const item of lockedCart.items ?? []) {
    const variantId = asNonEmptyString(item.variant_id)
    if (variantId && !variantsById.has(variantId)) {
      throw new Error("PAYMENT_CART_CATALOG_PROJECTION_UNAVAILABLE")
    }
  }

  const countries = Array.isArray(projection?.region?.countries)
    ? projection.region.countries.map((country) => ({
        iso_2: asNonEmptyString(country.iso_2),
      }))
    : null

  return {
    region: projection?.region
      ? { countries }
      : null,
    variantsById,
  }
}
