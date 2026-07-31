/**
 * Store catalog query parameters derived from Medusa 2.16.0
 * `StoreGetProductsParams` (list + retrieve middlewares both use it).
 *
 * Evidence:
 * - `@medusajs/medusa/dist/api/store/products/validators.js`
 * - `@medusajs/medusa/dist/api/store/products/middlewares.js`
 * - `@medusajs/medusa/dist/api/utils/validators.js` (`createFindParams`, `createOperatorMap`)
 * - `@medusajs/medusa/dist/api/utils/common-validators/products/index.js`
 */

export const CORRELATION_ID_HEADER = {
  name: "x-correlation-id",
  in: "header",
  required: false,
  schema: {
    type: "string",
  },
  description:
    "Optional correlation identifier. When absent, the server may generate one and return it as x-correlation-id.",
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

const stringOrStringArraySchema = {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } },
  ],
} as const

/** Medusa `createOperatorMap()` — scalar, array, or operator object. */
const operatorMapSchema = {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } },
    {
      type: "object",
      properties: {
        $eq: stringOrStringArraySchema,
        $ne: stringOrStringArraySchema,
        $in: { type: "array", items: { type: "string" } },
        $nin: { type: "array", items: { type: "string" } },
        $like: { type: "string" },
        $ilike: { type: "string" },
        $re: { type: "string" },
        $contains: { type: "string" },
        $gt: { type: "string" },
        $gte: { type: "string" },
        $lt: { type: "string" },
        $lte: { type: "string" },
      },
      additionalProperties: false,
    },
  ],
} as const

const productVariantsFilterSchema = {
  type: "object",
  description:
    "Nested variant filters from StoreGetProductsParams (`variants`). Includes variant identity/options filters, date operator maps, and nested `$and`/`$or`.",
  properties: {
    q: { type: "string" },
    id: stringOrStringArraySchema,
    sku: stringOrStringArraySchema,
    ean: stringOrStringArraySchema,
    upc: stringOrStringArraySchema,
    barcode: stringOrStringArraySchema,
    options: {
      type: "object",
      properties: {
        value: { type: "string" },
        option_id: { type: "string" },
      },
      additionalProperties: false,
    },
    created_at: operatorMapSchema,
    updated_at: operatorMapSchema,
    deleted_at: operatorMapSchema,
    $and: {
      type: "array",
      items: { type: "object" },
    },
    $or: {
      type: "array",
      items: { type: "object" },
    },
  },
  additionalProperties: false,
} as const

function queryParam(
  name: string,
  schema: Record<string, unknown>,
  description: string
) {
  return {
    name,
    in: "query" as const,
    required: false,
    schema,
    description,
  }
}

/**
 * Complete top-level query parameter set accepted by Medusa 2.16.0
 * `StoreGetProductsParams` (createFindParams + StoreGetProductsParamsFields +
 * variants + $and/$or). Used by BOTH GET /store/products and GET /store/products/:id.
 */
export const STORE_PRODUCT_LIST_QUERY = [
  queryParam("fields", { type: "string" }, [
    "Native fields selector (createSelectParams / createFindParams).",
    "Project middleware replaces client-supplied fields with the closed public catalog field set.",
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
  queryParam(
    "created_at",
    { ...operatorMapSchema },
    "Created-at filter: scalar, array, or Medusa operator map ($eq, $gt, $lte, …)."
  ),
  queryParam(
    "updated_at",
    { ...operatorMapSchema },
    "Updated-at filter: scalar, array, or Medusa operator map ($eq, $gt, $lte, …)."
  ),
  queryParam(
    "deleted_at",
    { ...operatorMapSchema },
    "Deleted-at filter: scalar, array, or Medusa operator map ($eq, $gt, $lte, …)."
  ),
  queryParam(
    "$and",
    { type: "array", items: { type: "object" } },
    "Logical AND of StoreGetProductParamsDirectFields filter objects (applyAndAndOrOperators)."
  ),
  queryParam(
    "$or",
    { type: "array", items: { type: "object" } },
    "Logical OR of StoreGetProductParamsDirectFields filter objects (applyAndAndOrOperators)."
  ),
  queryParam(
    "variants",
    { ...productVariantsFilterSchema },
    "Nested variant filter object (options, sku/ean/upc/barcode/id/q, date operators, nested $and/$or)."
  ),
] as const

/**
 * Retrieve uses the same `StoreGetProductsParams` validator as list
 * (`validateAndTransformQuery(StoreGetProductsParams, retrieveProductQueryConfig)`).
 */
export const STORE_PRODUCT_RETRIEVE_QUERY = STORE_PRODUCT_LIST_QUERY
