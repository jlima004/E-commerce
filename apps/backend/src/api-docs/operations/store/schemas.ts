import { PAYMENT_ATTEMPT_STATUSES } from "../../../modules/payment-attempt/types"
import type { ContractRegistryBundle } from "../../registry"

const nullableString = {
  type: ["string", "null"],
} as const

const nullableNumber = {
  type: ["number", "null"],
} as const

const nullableInteger = {
  type: ["integer", "null"],
} as const

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

export function storeJsonResponse(statusDescription: string, schemaName: string) {
  return {
    description: statusDescription,
    ...jsonSchemaRef(schemaName),
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
        type: "number",
        description:
          "Sellable catalog price amount exposed by the public Store serializer.",
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
      },
    },
  })

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

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCustomerCartAttachRequest",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        cart_id: {
          type: "string",
          description:
            "Optional guest cart id. When supplied, it must match the guest cart owned by the current session.",
        },
      },
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCustomerCartAttachPreserveResponse",
    {
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
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCustomerCartAttachTransferResponse",
    {
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
    }
  )

  registry.registerComponent(
    "store",
    "schemas",
    "StoreCustomerCartAttachResponse",
    {
      oneOf: [
        {
          $ref: "#/components/schemas/StoreCustomerCartAttachPreserveResponse",
        },
        {
          $ref: "#/components/schemas/StoreCustomerCartAttachTransferResponse",
        },
      ],
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
          enum: [...PAYMENT_ATTEMPT_STATUSES],
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
          enum: [...PAYMENT_ATTEMPT_STATUSES],
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
}
