import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

export const storeCartPreOrderFields = [
  "id",
  "email",
  "currency_code",
  "locale",
  "total",
  "subtotal",
  "item_total",
  "shipping_total",
  "tax_total",
  "discount_total",
  "region_id",
  "region.countries.iso_2",
  "created_at",
  "updated_at",
  "completed_at",
  "metadata",
  "customer.id",
  "customer.email",
  "items.id",
  "items.quantity",
  "items.title",
  "items.product_title",
  "items.variant_id",
  "items.variant_title",
  "items.unit_price",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.metadata",
  "items.variant.prices.*",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.company",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.postal_code",
  "shipping_address.country_code",
  "shipping_address.province",
  "shipping_address.phone",
  "shipping_address.metadata",
] as const

type QueryConfigRequest = MedusaRequest & {
  query: Record<string, unknown>
  queryConfig?: {
    fields: string[]
  }
  remoteQueryConfig?: {
    fields: string[]
  }
}

function uniqueFields(fields: readonly string[]): string[] {
  return [...new Set(fields)]
}

export function applyStoreCartPreOrderQueryConfig(
  req: QueryConfigRequest,
  fields: readonly string[] = storeCartPreOrderFields
): void {
  const normalizedFields = uniqueFields(fields)

  req.query.fields = normalizedFields.join(",")

  if (req.queryConfig) {
    req.queryConfig.fields = [...normalizedFields]
    req.remoteQueryConfig = req.queryConfig
  }
}

export function createStoreCartPreOrderQueryConfigMiddleware(
  fields: readonly string[] = storeCartPreOrderFields
) {
  return function storeCartPreOrderQueryConfigMiddleware(
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    applyStoreCartPreOrderQueryConfig(req as QueryConfigRequest, fields)
    next()
  }
}

export const storeCartPreOrderQueryConfigMiddleware =
  createStoreCartPreOrderQueryConfigMiddleware()
