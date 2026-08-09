/**
 * Store catalog query parameters derived from Medusa 2.16.0
 * `StoreGetProductsParams` (list + retrieve middlewares both use it).
 *
 * Evidence:
 * - `@medusajs/medusa/dist/api/store/products/validators.js`
 * - `@medusajs/medusa/dist/api/store/products/middlewares.js`
 * - `@medusajs/medusa/dist/api/utils/validators.js` (`createFindParams`, `createOperatorMap`)
 * - `@medusajs/medusa/dist/api/utils/common-validators/products/index.js`
 *
 * Nested filters use Medusa/Express `qs` bracket notation. Recursive `$and`/`$or`
 * filters (including variant-scoped forms) are intentionally omitted from the
 * narrower public OpenAPI contract.
 */

import type { ContractRegistryBundle } from "../registry"

export function registerStoreRequestParameters(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "parameters", "IdempotencyKey", {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      pattern: "^[!-~]+$",
    },
    description:
      "Server-side BFF retry identity only. It is NOT authentication, NOT authorization, NOT ownership, and NOT a capability.",
  })

  registry.registerComponent("store", "parameters", "IfMatch", {
    name: "If-Match",
    in: "header",
    required: true,
    schema: { type: "string", minLength: 1 },
    description:
      "Opaque server-issued resource version precondition. Cart enforcement and stale 412 behavior belong to Phase 15.",
  })

  registry.registerComponent("store", "parameters", "XCorrelationId", {
    name: "x-correlation-id",
    in: "header",
    required: false,
    schema: {
      type: "string",
      pattern: "^[A-Za-z0-9._-]{1,128}$",
      maxLength: 128,
    },
    description:
      "Optional correlation candidate. The server accepts only the closed format and replaces invalid or missing values; unsafe input is never echoed.",
  })
}

export const CORRELATION_ID_HEADER = {
  name: "x-correlation-id",
  in: "header",
  required: false,
  schema: {
    type: "string",
  },
  description:
    "Optional correlation candidate. The server validates the closed format and replaces invalid or missing values before returning x-correlation-id.",
} as const

export const STORE_CART_ID_PATH = {
  name: "id",
  in: "path",
  required: true,
  schema: {
    type: "string",
  },
  description: "Cart identifier.",
} as const

export const STORE_PRODUCT_ID_PATH = {
  name: "id",
  in: "path",
  required: true,
  schema: {
    type: "string",
  },
  description: "Product identifier.",
} as const

export const ADMIN_PRODUCT_ID_PATH = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Product identifier.",
} as const

export const ADMIN_VARIANT_ID_PATH = {
  name: "variant_id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Product variant identifier.",
} as const

export const ADMIN_PRODUCT_FIELDS_QUERY = {
  name: "fields",
  in: "query",
  required: false,
  schema: {
    type: "string",
  },
  description:
    "Fields selector accepted by the native Medusa 2.16.0 AdminGetProductParams validator.",
} as const

export const ADMIN_EXCHANGE_ID_PATH = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1 },
  description: "Exchange-request identifier.",
} as const

export const ADMIN_OPERATIONAL_ALERT_ID_PATH = {
  name: "id",
  in: "path",
  required: true,
  schema: {
    type: "string",
    maxLength: 128,
    pattern: "^opalert_[A-Za-z0-9_-]+$",
  },
  description: "Operational-alert identifier.",
} as const

export const ADMIN_OPERATIONAL_ALERT_LIST_QUERY = [
  queryParam("type", { type: "string", enum: ["payment_stuck", "fulfillment_failed"] }, "Filter by operational-alert type."),
  queryParam("status", { type: "string", enum: ["open", "acknowledged", "resolved", "ignored"] }, "Filter by operational-alert status."),
  queryParam("severity", { type: "string", enum: ["low", "medium", "high", "critical"] }, "Filter by operational-alert severity."),
  queryParam("entity_type", { type: "string", enum: ["payment_attempt", "fulfillment"] }, "Filter by safe entity type."),
  queryParam("entity_id", { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }, "Filter by entity identifier."),
  queryParam("last_seen_at_from", { type: "string", format: "date-time" }, "Include alerts last seen at or after this timestamp."),
  queryParam("last_seen_at_to", { type: "string", format: "date-time" }, "Include alerts last seen at or before this timestamp."),
  queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }, "Maximum number of alerts to return."),
  queryParam("offset", { type: "integer", minimum: 0, maximum: 100000, default: 0 }, "Number of alerts to skip."),
] as const

const stringOrStringArraySchema = {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } },
  ],
} as const

function queryParam(
  name: string,
  schema: Record<string, unknown>,
  description: string,
  style?: "form",
  explode?: boolean
) {
  return {
    name,
    in: "query" as const,
    required: false,
    schema,
    description,
    ...(style ? { style } : {}),
    ...(explode !== undefined ? { explode } : {}),
  }
}

function operatorMapBracketParams(prefix: string, label: string) {
  const repeatedValueDescription = (operator: string) =>
    `${label} ${operator} filter. Repeat this query key to provide multiple values.`
  const scalarDescription = (operator: string) =>
    `${label} ${operator} filter.`

  return [
    queryParam(
      `${prefix}[$eq]`,
      { ...stringOrStringArraySchema },
      repeatedValueDescription("$eq"),
      "form",
      true
    ),
    queryParam(
      `${prefix}[$ne]`,
      { ...stringOrStringArraySchema },
      repeatedValueDescription("$ne"),
      "form",
      true
    ),
    queryParam(
      `${prefix}[$in]`,
      { type: "array", items: { type: "string" } },
      repeatedValueDescription("$in"),
      "form",
      true
    ),
    queryParam(
      `${prefix}[$nin]`,
      { type: "array", items: { type: "string" } },
      repeatedValueDescription("$nin"),
      "form",
      true
    ),
    queryParam(
      `${prefix}[$like]`,
      { type: "string" },
      scalarDescription("$like")
    ),
    queryParam(
      `${prefix}[$ilike]`,
      { type: "string" },
      scalarDescription("$ilike")
    ),
    queryParam(
      `${prefix}[$re]`,
      { type: "string" },
      scalarDescription("$re")
    ),
    queryParam(
      `${prefix}[$contains]`,
      { type: "string" },
      scalarDescription("$contains")
    ),
    queryParam(
      `${prefix}[$gt]`,
      { type: "string" },
      scalarDescription("$gt")
    ),
    queryParam(
      `${prefix}[$gte]`,
      { type: "string" },
      scalarDescription("$gte")
    ),
    queryParam(
      `${prefix}[$lt]`,
      { type: "string" },
      scalarDescription("$lt")
    ),
    queryParam(
      `${prefix}[$lte]`,
      { type: "string" },
      scalarDescription("$lte")
    ),
  ]
}

function variantIdentityBracketParams() {
  const repeatedIdentityParam = (field: string, label: string) =>
    queryParam(
      `variants[${field}]`,
      { ...stringOrStringArraySchema },
      `Filter by variant ${label}. Repeat this query key to provide multiple values.`,
      "form",
      true
    )

  return [
    queryParam("variants[q]", { type: "string" }, "Variant search query."),
    repeatedIdentityParam("id", "id"),
    repeatedIdentityParam("sku", "SKU"),
    repeatedIdentityParam("ean", "EAN"),
    repeatedIdentityParam("upc", "UPC"),
    repeatedIdentityParam("barcode", "barcode"),
    queryParam(
      "variants[options][value]",
      { type: "string" },
      "Filter by variant option value."
    ),
    queryParam(
      "variants[options][option_id]",
      { type: "string" },
      "Filter by variant option id."
    ),
  ]
}

/**
 * Public query parameter set accepted by Medusa 2.16.0 `StoreGetProductsParams`.
 * Object filters are exposed as explicit bracket-notation leaves and recursive
 * logical operators are intentionally excluded. Used by BOTH GET /store/products
 * and GET /store/products/:id.
 */
export const STORE_PRODUCT_LIST_QUERY = [
  queryParam("fields", { type: "string" }, [
    "Native fields selector (createSelectParams / createFindParams).",
    "Project middleware replaces client-supplied fields with the closed public catalog field set.",
    "Nested filters use Medusa bracket notation; recursive $and/$or filters are intentionally omitted from the public contract.",
  ].join(" ")),
  queryParam(
    "limit",
    { type: "integer", minimum: 1, default: 50 },
    "Maximum number of products to return. Medusa StoreGetProductsParams default: 50."
  ),
  queryParam(
    "offset",
    { type: "integer", minimum: 0, default: 0 },
    "Number of products to skip. Medusa StoreGetProductsParams default: 0."
  ),
  queryParam(
    "order",
    { type: "string" },
    "Sort order expression accepted by createFindParams."
  ),
  queryParam(
    "with_deleted",
    { type: "boolean" },
    "When true, include soft-deleted records (createFindParams boolean preprocess)."
  ),
  queryParam(
    "region_id",
    { type: "string" },
    "Region context used by the native Medusa Store product query (cleared after pricing/tax context is applied)."
  ),
  queryParam(
    "country_code",
    { type: "string" },
    "Country context for pricing/tax normalization (cleared after context is applied)."
  ),
  queryParam(
    "province",
    { type: "string" },
    "Province/state context for pricing/tax normalization (cleared after context is applied)."
  ),
  queryParam(
    "cart_id",
    { type: "string" },
    "Cart context for pricing/tax normalization (cleared after context is applied)."
  ),
  queryParam(
    "sales_channel_id",
    { ...stringOrStringArraySchema },
    "Filter by sales channel id (string or string[])."
  ),
  queryParam("q", { type: "string" }, "Full-text search query."),
  queryParam(
    "id",
    { ...stringOrStringArraySchema },
    "Filter by product id (string or string[])."
  ),
  queryParam(
    "title",
    { ...stringOrStringArraySchema },
    "Filter by product title (string or string[])."
  ),
  queryParam(
    "handle",
    { ...stringOrStringArraySchema },
    "Filter by product handle (string or string[])."
  ),
  queryParam(
    "is_giftcard",
    {
      oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }],
    },
    "Filter gift-card products. Accepts boolean or boolean string (Medusa booleanString)."
  ),
  queryParam(
    "category_id",
    { ...stringOrStringArraySchema },
    "Filter by category id (string or string[])."
  ),
  queryParam(
    "external_id",
    { ...stringOrStringArraySchema },
    "Filter by external id (string or string[])."
  ),
  queryParam(
    "collection_id",
    { ...stringOrStringArraySchema },
    "Filter by collection id (string or string[])."
  ),
  queryParam(
    "tag_id",
    { ...stringOrStringArraySchema },
    "Filter by tag id (string or string[])."
  ),
  queryParam(
    "type_id",
    { ...stringOrStringArraySchema },
    "Filter by product type id (string or string[])."
  ),
  ...operatorMapBracketParams("created_at", "Created-at"),
  ...operatorMapBracketParams("updated_at", "Updated-at"),
  ...operatorMapBracketParams("deleted_at", "Deleted-at"),
  ...variantIdentityBracketParams(),
  ...operatorMapBracketParams(
    "variants[created_at]",
    "Variant created-at"
  ),
  ...operatorMapBracketParams(
    "variants[updated_at]",
    "Variant updated-at"
  ),
  ...operatorMapBracketParams(
    "variants[deleted_at]",
    "Variant deleted-at"
  ),
] as const

/**
 * Retrieve uses the same `StoreGetProductsParams` validator as list
 * (`validateAndTransformQuery(StoreGetProductsParams, retrieveProductQueryConfig)`).
 */
export const STORE_PRODUCT_RETRIEVE_QUERY = STORE_PRODUCT_LIST_QUERY
