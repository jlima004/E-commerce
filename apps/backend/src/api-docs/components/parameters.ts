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

export const STORE_PRODUCT_LIST_QUERY = [
  {
    name: "limit",
    in: "query",
    required: false,
    schema: {
      type: "integer",
      minimum: 1,
      default: 50,
    },
    description: "Maximum number of products to return.",
  },
  {
    name: "offset",
    in: "query",
    required: false,
    schema: {
      type: "integer",
      minimum: 0,
      default: 0,
    },
    description: "Number of products to skip.",
  },
  {
    name: "region_id",
    in: "query",
    required: false,
    schema: {
      type: "string",
    },
    description:
      "Region context used by the native Medusa Store product query.",
  },
  {
    name: "fields",
    in: "query",
    required: false,
    schema: {
      type: "string",
    },
    description:
      "Native fields selector. Project middleware replaces client-supplied fields with the closed public catalog field set.",
  },
] as const
