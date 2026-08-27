import { AUTH_HTTP_CONTRACT } from "../../../api/auth-surface/contracts"
import { CLIENT_MONEY_BODY_FIELDS } from "../../../api/store/carts/payment-attempts/validators"
import {
  STORE_AUTH_HEADERS_BY_REQUIREMENT,
  STORE_AUTH_SECURITY_BY_REQUIREMENT,
} from "../../components/security-schemes"
import { STORE_X_CORRELATION_ID_RESPONSE_HEADERS } from "../../components/headers"
import type {
  ComponentTypeOf,
  ContractRegistryBundle,
} from "../../registry"
import {
  CART_MERGE_OUTCOMES,
  CART_MERGE_REJECTION_REASONS,
} from "../../../modules/cart-merge/types"

const nullableString = {
  type: ["string", "null"],
} satisfies ComponentTypeOf<"schemas">

const nullableNumber = {
  type: ["number", "null"],
} satisfies ComponentTypeOf<"schemas">

const nullableInteger = {
  type: ["integer", "null"],
} satisfies ComponentTypeOf<"schemas">

function jsonSchemaRef(name: string) {
  return {
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${name}`,
        },
      },
    },
  }
}

/**
 * Attach schema support knowledge retained for Phase 16 merge-owner flow.
 * Not registered into public Store OpenAPI while attach remains BLOCKED→DENY.
 */
export const STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS = {
  StoreCustomerCartAttachRequest: {
    type: "object",
    properties: {
      cart_id: {
        type: "string",
        description:
          "Optional guest cart id. When supplied, it must match the guest cart owned by the current session.",
      },
    },
  },
  StoreCustomerCartAttachPreserveResponse: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "reason", "cart"],
    properties: {
      outcome: {
        type: "string",
        const: "preserve_customer_cart",
      },
      reason: {
        type: "string",
        enum: [
          "missing_session_guest_cart",
          "guest_cart_not_found",
          "guest_cart_empty_or_not_usable",
          "guest_cart_already_customer_cart",
        ],
      },
      cart: {
        oneOf: [
          {
            $ref: "#/components/schemas/PublicStoreCartPreOrder",
          },
          { type: "null" },
        ],
        description:
          "Existing customer cart, or null when the customer has no cart to preserve.",
      },
    },
  },
  StoreCustomerCartAttachTransferResponse: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "cart"],
    properties: {
      outcome: {
        type: "string",
        const: "attached_guest_cart",
      },
      cart: {
        $ref: "#/components/schemas/PublicStoreCartPreOrder",
      },
    },
  },
  StoreCustomerCartAttachResponse: {
    oneOf: [
      {
        $ref: "#/components/schemas/StoreCustomerCartAttachPreserveResponse",
      },
      {
        $ref: "#/components/schemas/StoreCustomerCartAttachTransferResponse",
      },
    ],
  },
} as const

export function storeJsonResponse(statusDescription: string, schemaName: string) {
  return {
    description: statusDescription,
    headers: STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
    ...jsonSchemaRef(schemaName),
  }
}

const omittedCredential = {
  type: "string",
  minLength: 12,
  maxLength: 128,
  description:
    "Credential bytes, 12 to 128 characters, without silent trim. OpenAPI examples are omitted.",
} satisfies ComponentTypeOf<"schemas">

const omittedCapability = {
  type: "string",
  minLength: 43,
  maxLength: 512,
  pattern: "^[A-Za-z0-9_-]+$",
  description:
    "One-time capability, 43 to 512 characters. Never echoed. OpenAPI examples are omitted.",
} satisfies ComponentTypeOf<"schemas">

const omittedEmail = {
  type: "string",
  format: "email",
  minLength: 3,
  maxLength: 320,
  description:
    "Caller-supplied address bytes. Canonicalization is owned by the runtime normalizer. OpenAPI examples are omitted.",
} satisfies ComponentTypeOf<"schemas">

const verificationStateSchema = {
  type: "string",
  enum: ["pending", "verified"],
} satisfies ComponentTypeOf<"schemas">

export const STORE_AUTH_REQUEST_FIELDS = {
  none: [] as const,
  empty: [] as const,
  signup: ["email", "password", "firstName", "lastName"] as const,
  login: ["email", "password"] as const,
  email: ["email"] as const,
  verification_token: ["token"] as const,
  reset_confirm: ["token", "newPassword"] as const,
  password_change: ["currentPassword", "newPassword"] as const,
} as const

export const STORE_AUTH_SUCCESS_FIELDS = {
  auth_session: [
    "accessToken",
    "accessExpiresAt",
    "refreshToken",
    "refreshExpiresAt",
    "originalAuthenticatedAt",
    "absoluteExpiresAt",
    "customer",
    "verificationState",
  ] as const,
  empty: [] as const,
  request_accepted: ["code"] as const,
  verification_result: ["code", "state"] as const,
  verification_status: ["state"] as const,
  password_reset_result: ["code"] as const,
  current_auth_customer: ["customer", "auth"] as const,
} as const

export const STORE_AUTH_REQUEST_SCHEMA_NAMES = {
  none: null,
  empty: "StoreAuthEmptyRequest",
  signup: "StoreAuthSignupRequest",
  login: "StoreAuthLoginRequest",
  email: "StoreAuthEmailRequest",
  verification_token: "StoreAuthVerificationConfirmRequest",
  reset_confirm: "StoreAuthResetConfirmRequest",
  password_change: "StoreAuthPasswordChangeRequest",
} as const

export const STORE_AUTH_SUCCESS_SCHEMA_NAMES = {
  auth_session: "StoreAuthSessionEnvelope",
  empty: null,
  request_accepted: "StoreAuthRequestAccepted",
  verification_result: "StoreAuthVerificationResult",
  verification_status: "StoreAuthVerificationStatus",
  password_reset_result: "StoreAuthPasswordResetResult",
  current_auth_customer: "StoreAuthCurrentCustomer",
} as const

const AUTH_PUBLIC_ERROR_CODES = [
  ...new Set(
    AUTH_HTTP_CONTRACT.flatMap((entry) =>
      entry.failures.map((failure) => failure[1])
    )
  ),
].sort()

export const STORE_AUTH_SCHEMAS = {
  StoreAuthCustomer: {
    type: "object",
    additionalProperties: false,
    required: ["id", "email", "firstName", "lastName"],
    description:
      "Minimized public customer. Internal identifiers and credentials are omitted.",
    properties: {
      id: { type: "string" },
      email: {
        type: "string",
        description:
          "Minimized public customer address. OpenAPI examples are omitted.",
      },
      firstName: { type: "string" },
      lastName: { type: "string" },
    },
  },
  StoreAuthEmptyRequest: {
    type: "object",
    additionalProperties: false,
    properties: {},
    description: "Exactly empty JSON object. Extra fields are rejected.",
  },
  StoreAuthSignupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password", "firstName", "lastName"],
    properties: {
      email: omittedEmail,
      password: omittedCredential,
      firstName: { type: "string", minLength: 1, maxLength: 128 },
      lastName: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
  StoreAuthLoginRequest: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email: omittedEmail,
      password: omittedCredential,
    },
  },
  StoreAuthEmailRequest: {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: {
      email: omittedEmail,
    },
  },
  StoreAuthVerificationConfirmRequest: {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
      token: omittedCapability,
    },
  },
  StoreAuthResetConfirmRequest: {
    type: "object",
    additionalProperties: false,
    required: ["token", "newPassword"],
    properties: {
      token: omittedCapability,
      newPassword: omittedCredential,
    },
  },
  StoreAuthPasswordChangeRequest: {
    type: "object",
    additionalProperties: false,
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: omittedCredential,
      newPassword: omittedCredential,
    },
  },
  StoreAuthSessionEnvelope: {
    type: "object",
    additionalProperties: false,
    required: [
      "accessToken",
      "accessExpiresAt",
      "refreshToken",
      "refreshExpiresAt",
      "originalAuthenticatedAt",
      "absoluteExpiresAt",
      "customer",
      "verificationState",
    ],
    description:
      "Server-to-server BFF-to-Medusa session envelope. The browser never receives this envelope; it is not the future same-origin BFF browser session contract. Token examples are omitted.",
    properties: {
      accessToken: {
        type: "string",
        description:
          "Access material for the BFF-to-Medusa hop. OpenAPI examples are omitted.",
      },
      accessExpiresAt: { type: "string", format: "date-time" },
      refreshToken: {
        type: "string",
        description:
          "Refresh material for the BFF-to-Medusa hop. OpenAPI examples are omitted.",
      },
      refreshExpiresAt: { type: "string", format: "date-time" },
      originalAuthenticatedAt: { type: "string", format: "date-time" },
      absoluteExpiresAt: { type: "string", format: "date-time" },
      customer: {
        $ref: "#/components/schemas/StoreAuthCustomer",
      },
      verificationState: verificationStateSchema,
    },
  },
  StoreAuthRequestAccepted: {
    type: "object",
    additionalProperties: false,
    required: ["code"],
    properties: {
      code: {
        type: "string",
        const: "REQUEST_ACCEPTED",
      },
    },
  },
  StoreAuthVerificationResult: {
    type: "object",
    additionalProperties: false,
    required: ["code", "state"],
    properties: {
      code: {
        type: "string",
        const: "EMAIL_VERIFIED",
      },
      state: {
        type: "string",
        const: "verified",
      },
    },
  },
  StoreAuthVerificationStatus: {
    type: "object",
    additionalProperties: false,
    required: ["state"],
    properties: {
      state: verificationStateSchema,
    },
  },
  StoreAuthPasswordResetResult: {
    type: "object",
    additionalProperties: false,
    required: ["code"],
    properties: {
      code: {
        type: "string",
        const: "PASSWORD_RESET_COMPLETED",
      },
    },
  },
  StoreAuthCurrentCustomer: {
    type: "object",
    additionalProperties: false,
    required: ["customer", "auth"],
    description:
      "Minimized public customer and auth state. Internal identifiers and credentials are omitted.",
    properties: {
      customer: {
        $ref: "#/components/schemas/StoreAuthCustomer",
      },
      auth: {
        type: "object",
        additionalProperties: false,
        required: [
          "verificationState",
          "originalAuthenticatedAt",
          "absoluteExpiresAt",
        ],
        properties: {
          verificationState: verificationStateSchema,
          originalAuthenticatedAt: { type: "string", format: "date-time" },
          absoluteExpiresAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  StoreAuthErrorResponse: {
    type: "object",
    additionalProperties: false,
    required: ["code", "message", "retryable", "correlationId"],
    description:
      "Closed public auth error. Clients must branch on code, not message.",
    properties: {
      code: {
        type: "string",
        enum: AUTH_PUBLIC_ERROR_CODES,
        description: "Stable machine-readable public auth error code.",
      },
      message: {
        type: "string",
        description:
          "Fixed presentation message; clients must branch on code, not message.",
      },
      retryable: {
        type: "boolean",
      },
      correlationId: {
        type: "string",
        pattern: "^[A-Za-z0-9._-]{1,128}$",
        description:
          "Server-sanitized correlation identifier. OpenAPI examples are omitted.",
      },
    },
  },
} as const satisfies Record<string, ComponentTypeOf<"schemas">>

type AuthHttpOperation = (typeof AUTH_HTTP_CONTRACT)[number]["operation"]

export const STORE_AUTH_SCHEMA_CONTRACT = Object.fromEntries(
  AUTH_HTTP_CONTRACT.map((entry) => [
    entry.operation,
    {
      method: entry.method,
      path: entry.path,
      auth: entry.auth,
      request: entry.request,
      success: entry.success,
      failures: entry.failures,
      sensitive: entry.sensitive,
      requestSchemaName: STORE_AUTH_REQUEST_SCHEMA_NAMES[entry.request],
      successSchemaName: STORE_AUTH_SUCCESS_SCHEMA_NAMES[entry.success.body],
      errorSchemaName: "StoreAuthErrorResponse" as const,
      headerNames: STORE_AUTH_HEADERS_BY_REQUIREMENT[entry.auth],
      security: STORE_AUTH_SECURITY_BY_REQUIREMENT[entry.auth],
    },
  ])
) as {
  [Operation in AuthHttpOperation]: {
    method: (typeof AUTH_HTTP_CONTRACT)[number]["method"]
    path: (typeof AUTH_HTTP_CONTRACT)[number]["path"]
    auth: (typeof AUTH_HTTP_CONTRACT)[number]["auth"]
    request: (typeof AUTH_HTTP_CONTRACT)[number]["request"]
    success: (typeof AUTH_HTTP_CONTRACT)[number]["success"]
    failures: (typeof AUTH_HTTP_CONTRACT)[number]["failures"]
    sensitive: (typeof AUTH_HTTP_CONTRACT)[number]["sensitive"]
    requestSchemaName:
      (typeof STORE_AUTH_REQUEST_SCHEMA_NAMES)[keyof typeof STORE_AUTH_REQUEST_SCHEMA_NAMES]
    successSchemaName:
      (typeof STORE_AUTH_SUCCESS_SCHEMA_NAMES)[keyof typeof STORE_AUTH_SUCCESS_SCHEMA_NAMES]
    errorSchemaName: "StoreAuthErrorResponse"
    headerNames: (typeof STORE_AUTH_HEADERS_BY_REQUIREMENT)[keyof typeof STORE_AUTH_HEADERS_BY_REQUIREMENT]
    security: (typeof STORE_AUTH_SECURITY_BY_REQUIREMENT)[keyof typeof STORE_AUTH_SECURITY_BY_REQUIREMENT]
  }
}

export function registerStoreSchemas(registry: ContractRegistryBundle): void {
  registry.registerComponent("store", "schemas", "StoreCatalogPrice", {
    type: "object",
    additionalProperties: false,
    required: ["currency_code", "amount"],
    properties: {
      currency_code: {
        type: "string",
        const: "brl",
        description: "Catalog sellable price currency. Always BRL.",
      },
      amount: {
        type: "integer",
        description:
          "Sellable catalog price amount in BRL major units.",
        "x-money-unit": "brl-major",
      },
    },
  })

  registry.registerComponent("store", "schemas", "StoreCatalogVariantOption", {
    type: "object",
    additionalProperties: false,
    required: ["name", "value"],
    properties: {
      name: { type: "string" },
      value: { type: "string" },
    },
  })

  registry.registerComponent("store", "schemas", "StoreCatalogVariant", {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "sku", "is_sellable", "price", "options"],
    properties: {
      id: { type: "string" },
      title: nullableString,
      sku: nullableString,
      is_sellable: {
        type: "boolean",
        const: true,
        description: "Public catalog variants are always sellable.",
      },
      price: {
        $ref: "#/components/schemas/StoreCatalogPrice",
      },
      options: {
        type: "array",
        items: {
          $ref: "#/components/schemas/StoreCatalogVariantOption",
        },
      },
    },
  })

  registry.registerComponent("store", "schemas", "StoreCatalogImage", {
    type: "object",
    additionalProperties: false,
    required: ["id", "url"],
    properties: {
      id: nullableString,
      url: { type: "string" },
    },
  })

  registry.registerComponent("store", "schemas", "StoreCatalogOption", {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "values"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      values: {
        type: "array",
        items: { type: "string" },
      },
    },
  })

  registry.registerComponent("store", "schemas", "PublicStoreCatalogProduct", {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "subtitle",
      "description",
      "handle",
      "thumbnail",
      "images",
      "options",
      "variants",
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      subtitle: nullableString,
      description: nullableString,
      handle: nullableString,
      thumbnail: nullableString,
      images: {
        type: "array",
        items: {
          $ref: "#/components/schemas/StoreCatalogImage",
        },
      },
      options: {
        type: "array",
        items: {
          $ref: "#/components/schemas/StoreCatalogOption",
        },
      },
      variants: {
        type: "array",
        items: {
          $ref: "#/components/schemas/StoreCatalogVariant",
        },
      },
    },
  })

  registry.registerComponent("store", "schemas", "StoreProductsListResponse", {
    type: "object",
    additionalProperties: false,
    required: ["products"],
    properties: {
      products: {
        type: "array",
        items: {
          $ref: "#/components/schemas/PublicStoreCatalogProduct",
        },
      },
      count: { type: "integer" },
      offset: { type: "integer" },
      limit: { type: "integer" },
      estimate_count: { type: "integer" },
    },
  })

  registry.registerComponent("store", "schemas", "StoreProductResponse", {
    type: "object",
    additionalProperties: false,
    required: ["product"],
    properties: {
      product: {
        $ref: "#/components/schemas/PublicStoreCatalogProduct",
      },
    },
  })

  registry.registerComponent(
    "store",
    "schemas",
    "PublicStoreCartShippingAddress",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "first_name",
        "last_name",
        "company",
        "address_1",
        "address_2",
        "city",
        "postal_code",
        "country_code",
        "province",
        "phone",
        "masked_federal_tax_id",
      ],
      properties: {
        first_name: nullableString,
        last_name: nullableString,
        company: nullableString,
        address_1: nullableString,
        address_2: nullableString,
        city: nullableString,
        postal_code: nullableString,
        country_code: nullableString,
        province: nullableString,
        phone: nullableString,
        masked_federal_tax_id: {
          ...nullableString,
          description:
            "Masked federal tax identifier. Full CPF/CNPJ values are never returned.",
        },
      },
    }
  )

  registry.registerComponent("store", "schemas", "PublicStoreCartItem", {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "quantity",
      "title",
      "variant_id",
      "variant_title",
      "unit_price",
    ],
    properties: {
      id: nullableString,
      quantity: { type: "number" },
      title: nullableString,
      variant_id: nullableString,
      variant_title: nullableString,
      unit_price: {
        ...nullableNumber,
        description: "Line item unit price in BRL major units.",
        "x-money-unit": "brl-major",
      },
    },
  })

  registry.registerComponent(
    "store",
    "schemas",
    "StoreAddCartLineItemRequest",
    {
      type: "object",
      additionalProperties: false,
      required: ["variant_id", "quantity"],
      properties: {
        variant_id: {
          type: "string",
          minLength: 1,
          description: "Sellable catalog variant identifier.",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          maximum: 99,
          description: "Quantity to add; integer from 1 through 99.",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreUpdateCartLineItemRequest",
    {
      type: "object",
      additionalProperties: false,
      required: ["quantity"],
      properties: {
        quantity: {
          type: "integer",
          minimum: 0,
          maximum: 99,
          description:
            "Replacement quantity; integer from 0 through 99. Zero removes the line item.",
        },
      },
    }
  )

  registry.registerComponent("store", "schemas", "PublicStoreCartPreOrder", {
    type: "object",
    additionalProperties: false,
    required: [
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
      "created_at",
      "updated_at",
      "checkout_data_complete",
      "customer",
      "items",
      "shipping_address",
    ],
    description:
      "Public pre-order cart. Monetary totals are BRL major units, not integer centavos.",
    properties: {
      id: { type: "string" },
      email: nullableString,
      currency_code: nullableString,
      locale: nullableString,
      total: {
        ...nullableNumber,
        description: "Cart total in BRL major units.",
        "x-money-unit": "brl-major",
      },
      subtotal: {
        ...nullableNumber,
        description: "Cart subtotal in BRL major units.",
        "x-money-unit": "brl-major",
      },
      item_total: {
        ...nullableNumber,
        "x-money-unit": "brl-major",
      },
      shipping_total: {
        ...nullableNumber,
        "x-money-unit": "brl-major",
      },
      tax_total: {
        ...nullableNumber,
        "x-money-unit": "brl-major",
      },
      discount_total: {
        ...nullableNumber,
        "x-money-unit": "brl-major",
      },
      region_id: nullableString,
      created_at: nullableString,
      updated_at: nullableString,
      checkout_data_complete: { type: "boolean" },
      customer: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "email"],
            properties: {
              id: nullableString,
              email: nullableString,
            },
          },
          { type: "null" },
        ],
      },
      items: {
        type: "array",
        items: {
          $ref: "#/components/schemas/PublicStoreCartItem",
        },
      },
      shipping_address: {
        oneOf: [
          {
            $ref: "#/components/schemas/PublicStoreCartShippingAddress",
          },
          { type: "null" },
        ],
      },
    },
  })

  registry.registerComponent("store", "schemas", "StoreCartResponse", {
    type: "object",
    additionalProperties: false,
    required: ["cart"],
    properties: {
      cart: {
        $ref: "#/components/schemas/PublicStoreCartPreOrder",
      },
    },
  })

  registry.registerComponent("store", "schemas", "CartMergeRequest", {
    type: "object",
    additionalProperties: false,
    required: ["guestCartId"],
    description:
      "Guest cart source identifier. The Customer destination is resolved server-side.",
    properties: {
      guestCartId: {
        type: "string",
        minLength: 1,
      },
    },
  })

  registry.registerComponent("store", "schemas", "CartMergeOutcome", {
    type: "string",
    enum: [...CART_MERGE_OUTCOMES],
    description:
      "Closed merge outcome. CUSTOMER_CART_PRESERVED is reserved and has no positive branch until a future deterministic rule is approved.",
  })

  registry.registerComponent("store", "schemas", "CartMergeRejectedItem", {
    type: "object",
    additionalProperties: false,
    required: [
      "variantId",
      "requestedQuantity",
      "acceptedQuantity",
      "rejectedQuantity",
      "reason",
    ],
    description:
      "Rejected guest intent grouped by public variant. requestedQuantity equals acceptedQuantity plus rejectedQuantity.",
    properties: {
      variantId: {
        type: "string",
        minLength: 1,
      },
      requestedQuantity: {
        type: "integer",
        minimum: 1,
        description: "Original normalized guest quantity for the variant.",
      },
      acceptedQuantity: {
        type: "integer",
        minimum: 0,
        maximum: 99,
        description: "Quantity incorporated into the canonical cart.",
      },
      rejectedQuantity: {
        type: "integer",
        minimum: 0,
        description:
          "Quantity not incorporated; acceptedQuantity plus rejectedQuantity equals requestedQuantity.",
      },
      reason: {
        type: "string",
        enum: [...CART_MERGE_REJECTION_REASONS],
      },
    },
  })

  registry.registerComponent("store", "schemas", "CartReviewState", {
    type: "object",
    additionalProperties: false,
    required: ["requiresReview", "reviewRef", "rejectedItems"],
    description:
      "Public review state. requiresReview is true if and only if outcome is MERGED_PARTIAL.",
    properties: {
      requiresReview: {
        type: "boolean",
      },
      reviewRef: {
        type: ["string", "null"],
        minLength: 1,
      },
      rejectedItems: {
        type: "array",
        items: {
          $ref: "#/components/schemas/CartMergeRejectedItem",
        },
      },
    },
  })

  const nullablePublicStoreCart = {
    oneOf: [
      { $ref: "#/components/schemas/PublicStoreCartPreOrder" },
      { type: "null" },
    ],
  } as const

  registry.registerComponent("store", "schemas", "CartMergeResponse", {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "cart", "review"],
    properties: {
      outcome: {
        $ref: "#/components/schemas/CartMergeOutcome",
      },
      cart: nullablePublicStoreCart,
      review: {
        $ref: "#/components/schemas/CartReviewState",
      },
    },
  })

  registry.registerComponent(
    "store",
    "schemas",
    "CartReviewAcknowledgeRequest",
    {
      type: "object",
      additionalProperties: false,
      required: ["reviewRef"],
      properties: {
        reviewRef: {
          type: ["string", "null"],
          minLength: 1,
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "CartReviewAcknowledgeResponse",
    {
      type: "object",
      additionalProperties: false,
      required: ["cart", "review"],
      properties: {
        cart: nullablePublicStoreCart,
        review: {
          $ref: "#/components/schemas/CartReviewState",
        },
      },
    }
  )

  // Attach schemas: see STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS (not public).

  registry.registerComponent(
    "store",
    "schemas",
    "StorePaymentAttemptStartRequest",
    {
      type: "object",
      description:
        "Optional JSON body for card/Pix payment-attempt start. Body may be omitted or `{}`. Payment method is defined by the path (`/card` or `/pix`), not by a body field. Matches runtime rejectClientMoneyFields: CLIENT_MONEY_BODY_FIELDS are structurally forbidden via propertyNames; unknown non-money keys are ignored (additionalProperties is intentionally true).",
      propertyNames: {
        not: {
          enum: [...CLIENT_MONEY_BODY_FIELDS],
        },
      },
      additionalProperties: true,
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StorePaymentAttemptAmountMinor",
    {
      type: "integer",
      minimum: 1,
      description:
        "PaymentAttempt amount in integer BRL minor units (centavos). Distinct from Cart and PaymentSession major-unit amounts.",
      "x-money-unit": "brl-minor",
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCardPaymentAttemptResponse",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "payment_attempt_id",
        "payment_method_type",
        "status",
        "amount",
        "currency_code",
        "provider_payment_intent_id",
        "client_secret",
      ],
      properties: {
        payment_attempt_id: { type: "string" },
        payment_method_type: {
          type: "string",
          const: "card",
        },
        status: {
          type: "string",
          const: "card_client_secret_created",
        },
        amount: {
          $ref: "#/components/schemas/StorePaymentAttemptAmountMinor",
        },
        currency_code: {
          type: "string",
          const: "BRL",
        },
        provider_payment_intent_id: nullableString,
        client_secret: {
          type: "string",
          description:
            "Ephemeral Stripe client secret. Never logged or used as an OpenAPI example.",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StorePixPaymentAttemptResponse",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "payment_attempt_id",
        "payment_method_type",
        "status",
        "amount",
        "currency_code",
        "provider_payment_intent_id",
        "expires_at",
        "qr_code",
        "copy_paste",
        "hosted_instructions_url",
      ],
      properties: {
        payment_attempt_id: { type: "string" },
        payment_method_type: {
          type: "string",
          const: "pix",
        },
        status: {
          type: "string",
          const: "awaiting_pix_payment",
        },
        amount: {
          $ref: "#/components/schemas/StorePaymentAttemptAmountMinor",
        },
        currency_code: {
          type: "string",
          const: "BRL",
        },
        provider_payment_intent_id: nullableString,
        expires_at: {
          type: "string",
          format: "date-time",
        },
        qr_code: {
          type: "string",
          description:
            "Pix QR payload. Sensitive payment material; OpenAPI examples are omitted.",
        },
        copy_paste: {
          type: "string",
          description:
            "Pix copy-and-paste payload. Sensitive payment material; OpenAPI examples are omitted.",
        },
        hosted_instructions_url: nullableString,
        client_secret: {
          type: "string",
          description:
            "Optional Stripe client secret when returned by the provider layer.",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCardPaymentAttemptEnvelope",
    {
      type: "object",
      additionalProperties: false,
      required: ["payment_attempt"],
      properties: {
        payment_attempt: {
          $ref: "#/components/schemas/StoreCardPaymentAttemptResponse",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StorePixPaymentAttemptEnvelope",
    {
      type: "object",
      additionalProperties: false,
      required: ["payment_attempt"],
      properties: {
        payment_attempt: {
          $ref: "#/components/schemas/StorePixPaymentAttemptResponse",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreTrackingLookupRequest",
    {
      type: "object",
      additionalProperties: false,
      required: ["token"],
      properties: {
        token: {
          type: "string",
          minLength: 1,
          description:
            "Opaque tracking capability token. Accepted only in the JSON body; never in path or query. Examples are intentionally omitted.",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "PublicTrackingLookupResponse",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "order_reference",
        "order_status",
        "fulfillment_status",
        "tracking_status",
        "item_count",
        "item_labels",
        "updated_at",
        "message",
      ],
      properties: {
        order_reference: nullableString,
        order_status: nullableString,
        fulfillment_status: nullableString,
        tracking_status: nullableString,
        item_count: nullableInteger,
        item_labels: {
          type: "array",
          items: { type: "string" },
        },
        updated_at: nullableString,
        message: nullableString,
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreTrackingLookupEnvelope",
    {
      type: "object",
      additionalProperties: false,
      required: ["tracking"],
      properties: {
        tracking: {
          $ref: "#/components/schemas/PublicTrackingLookupResponse",
        },
      },
    }
  )

  registry.registerComponent("store", "schemas", "StoreHealthLiveResponse", {
    type: "object",
    additionalProperties: false,
    required: ["status", "service", "timestamp", "version"],
    properties: {
      status: {
        type: "string",
        const: "live",
      },
      service: { type: "string" },
      timestamp: {
        type: "string",
        format: "date-time",
      },
      version: { type: "string" },
    },
  })

  registry.registerComponent("store", "schemas", "StoreHealthChecks", {
    type: "object",
    additionalProperties: false,
    required: ["postgres", "redis"],
    properties: {
      postgres: {
        type: "string",
        enum: ["up", "down"],
      },
      redis: {
        type: "string",
        enum: ["up", "down"],
      },
    },
  })

  registry.registerComponent("store", "schemas", "StoreHealthReadyResponse", {
    type: "object",
    additionalProperties: false,
    required: ["status", "service", "timestamp", "version", "checks"],
    properties: {
      status: {
        type: "string",
        enum: ["ready", "not_ready"],
      },
      service: { type: "string" },
      timestamp: {
        type: "string",
        format: "date-time",
      },
      version: { type: "string" },
      checks: {
        $ref: "#/components/schemas/StoreHealthChecks",
      },
    },
  })

  for (const [name, schema] of Object.entries(STORE_AUTH_SCHEMAS)) {
    registry.registerComponent("store", "schemas", name, schema)
  }
}
