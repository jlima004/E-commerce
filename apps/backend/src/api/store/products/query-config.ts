import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

export const storeCatalogPublicFields = [
  "id",
  "title",
  "subtitle",
  "description",
  "handle",
  "thumbnail",
  "images.id",
  "images.url",
  "options.id",
  "options.title",
  "options.values.id",
  "options.values.value",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.metadata",
  "variants.prices.*",
  "variants.options.id",
  "variants.options.value",
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

export function applyStoreCatalogQueryConfig(
  req: QueryConfigRequest,
  fields: readonly string[] = storeCatalogPublicFields
): void {
  const normalizedFields = uniqueFields(fields)

  req.query.fields = normalizedFields.join(",")

  if (req.queryConfig) {
    req.queryConfig.fields = [...normalizedFields]
    req.remoteQueryConfig = req.queryConfig
  }
}

export function createStoreCatalogQueryConfigMiddleware(
  fields: readonly string[] = storeCatalogPublicFields
) {
  return function storeCatalogQueryConfigMiddleware(
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    applyStoreCatalogQueryConfig(req as QueryConfigRequest, fields)
    next()
  }
}

export const storeCatalogQueryConfigMiddleware =
  createStoreCatalogQueryConfigMiddleware()
