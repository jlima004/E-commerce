import { ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS } from "../../components"
import type { ContractRegistryBundle } from "../../registry"

const nullableString = { type: ["string", "null"] } as const
const nullableNumber = { type: ["number", "null"] } as const
const nullableInteger = { type: ["integer", "null"] } as const
const dateTimeString = { type: "string", format: "date-time" } as const
const nullableDateTime = {
  type: ["string", "null"],
  format: "date-time",
} as const

const productStatuses = ["draft", "proposed", "published", "rejected"]
const exchangeReasons = ["defect", "wrong_product"]
const exchangeStatuses = [
  "opened",
  "awaiting_customer_return",
  "return_in_transit",
  "return_received",
  "replacement_review",
  "resolved",
  "rejected",
  "canceled",
]
const reverseLogisticsProviders = ["correios_manual", "other_manual"]
const refundStatuses = [
  "requested",
  "rejected",
  "stripe_create_pending",
  "stripe_created",
  "confirmation_pending",
  "confirmed",
  "failed",
  "canceled",
]

const additionalData = {
  oneOf: [
    { type: "object", additionalProperties: true },
    { type: "null" },
  ],
  description: "Optional Medusa additional_data object.",
} as const

const normalizableString = (description: string) => ({
  description,
  oneOf: [
    { type: "string" },
    { type: "null" },
    { type: "number" },
    { type: "boolean" },
    { type: "object", additionalProperties: true },
    { type: "array", items: {} },
  ],
})

const normalizableEnum = (values: string[], description: string) => ({
  description,
  oneOf: [
    { type: "string", enum: values },
    { type: "null" },
    { type: "number" },
    { type: "boolean" },
    { type: "object", additionalProperties: true },
    { type: "array", items: {} },
  ],
})

export function adminJsonResponse(
  description: string,
  schemaName: string
) {
  return {
    description,
    headers: ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
  }
}

function registerProductSchemas(registry: ContractRegistryBundle): void {
  registry.registerComponent("admin", "schemas", "AdminProductVariantPriceCreate", {
    type: "object",
    additionalProperties: false,
    required: ["currency_code", "amount"],
    properties: {
      currency_code: { type: "string" },
      amount: { type: "number" },
      min_quantity: nullableNumber,
      max_quantity: nullableNumber,
      rules: { type: "object", additionalProperties: { type: "string" } },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminProductVariantPriceUpdate", {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      currency_code: { type: "string" },
      amount: { type: "number" },
      min_quantity: nullableNumber,
      max_quantity: nullableNumber,
      rules: { type: "object", additionalProperties: { type: "string" } },
    },
  })

  const createVariantProperties = {
    title: { type: "string" },
    sku: nullableString,
    ean: nullableString,
    upc: nullableString,
    barcode: nullableString,
    hs_code: nullableString,
    mid_code: nullableString,
    allow_backorder: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }], default: false },
    manage_inventory: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }], default: true },
    variant_rank: { type: "number" },
    weight: nullableNumber,
    length: nullableNumber,
    height: nullableNumber,
    width: nullableNumber,
    origin_country: nullableString,
    material: nullableString,
    metadata: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    prices: { type: "array", items: { $ref: "#/components/schemas/AdminProductVariantPriceCreate" } },
    options: { type: "object", additionalProperties: { type: "string" } },
    inventory_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["inventory_item_id", "required_quantity"],
        properties: {
          inventory_item_id: { type: "string" },
          required_quantity: { type: "number" },
        },
      },
    },
  }

  const updateVariantProperties = {
    id: { type: "string" },
    title: { type: "string" },
    sku: nullableString,
    ean: nullableString,
    upc: nullableString,
    barcode: nullableString,
    hs_code: nullableString,
    mid_code: nullableString,
    thumbnail: nullableString,
    allow_backorder: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] },
    manage_inventory: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] },
    variant_rank: { type: "number" },
    weight: nullableNumber,
    length: nullableNumber,
    height: nullableNumber,
    width: nullableNumber,
    origin_country: nullableString,
    material: nullableString,
    metadata: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    prices: { type: "array", items: { $ref: "#/components/schemas/AdminProductVariantPriceUpdate" } },
    options: { type: "object", additionalProperties: { type: "string" } },
  }

  registry.registerComponent("admin", "schemas", "AdminProductVariantCreateInput", {
    type: "object",
    additionalProperties: false,
    required: ["title", "prices"],
    properties: createVariantProperties,
  })

  registry.registerComponent("admin", "schemas", "AdminProductVariantCreateRequest", {
    type: "object",
    additionalProperties: false,
    required: ["title", "prices"],
    properties: {
      ...createVariantProperties,
      additional_data: additionalData,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminProductVariantUpdateInput", {
    type: "object",
    additionalProperties: false,
    properties: updateVariantProperties,
  })

  registry.registerComponent("admin", "schemas", "AdminProductVariantUpdateRequest", {
    type: "object",
    additionalProperties: false,
    properties: {
      ...updateVariantProperties,
      additional_data: additionalData,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminProductCreateRequest", {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string" },
      subtitle: nullableString,
      description: nullableString,
      is_giftcard: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }], default: false },
      discountable: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }], default: true },
      images: { type: "array", items: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } } },
      thumbnail: nullableString,
      handle: { type: "string" },
      status: { oneOf: [{ type: "string", enum: productStatuses }, { type: "null" }], default: "draft" },
      external_id: nullableString,
      type_id: nullableString,
      collection_id: nullableString,
      categories: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      tags: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      options: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "values"], properties: { title: { type: "string" }, values: { type: "array", items: { type: "string" } } } } },
      variants: { type: "array", items: { $ref: "#/components/schemas/AdminProductVariantCreateInput" } },
      sales_channels: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      shipping_profile_id: { type: "string" },
      weight: nullableNumber,
      length: nullableNumber,
      height: nullableNumber,
      width: nullableNumber,
      hs_code: nullableString,
      mid_code: nullableString,
      origin_country: nullableString,
      material: nullableString,
      metadata: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
      additional_data: additionalData,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminProductUpdateRequest", {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      subtitle: nullableString,
      description: nullableString,
      is_giftcard: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] },
      discountable: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] },
      images: { type: "array", items: { type: "object", additionalProperties: false, required: ["url"], properties: { id: { type: "string" }, url: { type: "string" } } } },
      thumbnail: nullableString,
      handle: { type: "string" },
      status: { type: "string", enum: productStatuses },
      external_id: nullableString,
      type_id: nullableString,
      collection_id: nullableString,
      categories: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      tags: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      options: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, title: { type: "string" }, values: { type: "array", items: { type: "string" } } } } },
      variants: { type: "array", items: { $ref: "#/components/schemas/AdminProductVariantUpdateInput" } },
      sales_channels: { type: "array", items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
      shipping_profile_id: nullableString,
      weight: nullableNumber,
      length: nullableNumber,
      height: nullableNumber,
      width: nullableNumber,
      hs_code: nullableString,
      mid_code: nullableString,
      origin_country: nullableString,
      material: nullableString,
      metadata: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
      additional_data: additionalData,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminProductResponse", {
    type: "object",
    additionalProperties: false,
    required: ["product"],
    properties: {
      product: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: true,
        description: "Native Medusa 2.16.0 Admin product selected by the route response query.",
      },
    },
  })
}

function registerRefundSchemas(registry: ContractRegistryBundle): void {
  registry.registerComponent("admin", "schemas", "AdminBrlMinorAmount", {
    type: "integer",
    minimum: 1,
    description: "Amount in integer BRL minor units (centavos).",
    "x-money-unit": "brl-minor",
  })

  registry.registerComponent("admin", "schemas", "AdminRefundRequestCreate", {
    type: "object",
    required: ["order_id", "amount", "currency_code", "idempotency_key"],
    propertyNames: {
      not: {
        enum: ["requested_by_operator_id", "admin_id", "actor_id", "admin_email"],
      },
    },
    additionalProperties: true,
    description: "Unknown non-identity top-level properties are ignored by the current parser. Authenticated operator identity is never client supplied.",
    properties: {
      order_id: { type: "string", minLength: 1 },
      amount: { $ref: "#/components/schemas/AdminBrlMinorAmount" },
      currency_code: { type: "string", pattern: "^[Bb][Rr][Ll]$" },
      idempotency_key: { type: "string", minLength: 1 },
      reason: normalizableString("Optional reason. Non-string values are normalized to null."),
      operator_note: normalizableString("Optional operator note. Non-string values are normalized to null."),
      metadata: {
        oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
        description: "Optional metadata object. Runtime keeps only its safe allowlist and rejects sensitive values.",
      },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminRefundRequest", {
    type: "object",
    additionalProperties: false,
    required: ["id", "order_id", "payment_intent_id", "payment_attempt_id", "stripe_refund_id", "idempotency_key", "amount", "currency_code", "reason", "operator_note", "status", "requested_by_operator_id", "metadata"],
    properties: {
      id: { type: "string" },
      order_id: { type: "string" },
      payment_intent_id: { type: "string" },
      payment_attempt_id: { type: "string" },
      stripe_refund_id: nullableString,
      idempotency_key: { type: "string" },
      amount: { $ref: "#/components/schemas/AdminBrlMinorAmount" },
      currency_code: { type: "string", const: "brl" },
      reason: nullableString,
      operator_note: nullableString,
      status: { type: "string", enum: refundStatuses },
      requested_by_operator_id: nullableString,
      metadata: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              correlation_id: {},
              recovery_origin: {},
              source: {},
            },
          },
          { type: "null" },
        ],
      },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminRefundAvailability", {
    type: "object",
    additionalProperties: false,
    required: ["captured_amount", "confirmed_refunded_amount", "reserved_amount", "available_amount", "currency_code"],
    properties: {
      captured_amount: { $ref: "#/components/schemas/AdminBrlMinorAmount" },
      confirmed_refunded_amount: { type: "integer", minimum: 0, "x-money-unit": "brl-minor" },
      reserved_amount: { type: "integer", minimum: 0, "x-money-unit": "brl-minor" },
      available_amount: { type: "integer", minimum: 0, "x-money-unit": "brl-minor" },
      currency_code: { type: "string", const: "brl" },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminRefundRequestResponse", {
    type: "object",
    additionalProperties: false,
    required: ["refund_request", "reused_idempotency", "availability"],
    properties: {
      refund_request: { $ref: "#/components/schemas/AdminRefundRequest" },
      reused_idempotency: { type: "boolean" },
      availability: { $ref: "#/components/schemas/AdminRefundAvailability" },
    },
  })
}

function registerExchangeSchemas(registry: ContractRegistryBundle): void {
  registry.registerComponent("admin", "schemas", "AdminExchangeAffectedItemRequest", {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      line_item_id: normalizableString("Optional line-item identifier. Non-string values are ignored."),
      product_title: normalizableString("Optional product title. Non-string values are ignored."),
      variant_title: normalizableString("Optional variant title. Non-string values are ignored."),
      quantity: { type: "integer", minimum: 1 },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminExchangeAffectedItem", {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      line_item_id: nullableString,
      product_title: nullableString,
      variant_title: nullableString,
      quantity: nullableInteger,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminExchangeCreateRequest", {
    type: "object",
    additionalProperties: false,
    required: ["order_id", "reason", "affected_items"],
    properties: {
      order_id: { type: "string", minLength: 1 },
      reason: { type: "string", enum: exchangeReasons },
      affected_items: { type: "array", minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/AdminExchangeAffectedItemRequest" } },
      customer_visible_note: normalizableString("Optional customer-visible note. Non-string values are normalized to null."),
      operator_note: normalizableString("Optional operator note. Non-string values are normalized to null."),
      reverse_logistics_provider: normalizableEnum(reverseLogisticsProviders, "Optional reverse-logistics provider. Non-string values are normalized to null."),
      reverse_tracking_code: normalizableString("Optional reverse tracking code. Non-string values are normalized to null."),
      reverse_authorization_code: normalizableString("Optional reverse authorization code. Non-string values are normalized to null."),
      reverse_label_reference: normalizableString("Optional reverse label reference. Non-string values are normalized to null."),
    },
  })

  registry.registerComponent("admin", "schemas", "AdminExchangeUpdateRequest", {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    description: "At least one effective update must remain after runtime normalization. Some optional non-string values are ignored or normalized to null rather than rejected.",
    properties: {
      status: { type: "string", enum: exchangeStatuses },
      customer_visible_note: normalizableString("Non-string values are normalized to null."),
      operator_note: normalizableString("Non-string values are normalized to null."),
      reverse_logistics_provider: normalizableEnum(reverseLogisticsProviders, "Non-string values are ignored by the update parser."),
      reverse_tracking_code: normalizableString("Non-string values are normalized to null."),
      reverse_authorization_code: normalizableString("Non-string values are normalized to null."),
      reverse_label_reference: normalizableString("Non-string values are normalized to null."),
    },
  })

  registry.registerComponent("admin", "schemas", "AdminExchangeRequest", {
    type: "object",
    additionalProperties: false,
    required: ["id", "order_id", "reason", "status", "affected_items", "customer_visible_note", "operator_note", "reverse_logistics_provider", "reverse_tracking_code", "reverse_authorization_code", "reverse_label_reference", "return_received_at", "resolved_at", "created_by_operator_id", "created_at", "updated_at"],
    properties: {
      id: { type: "string" },
      order_id: { type: "string" },
      reason: { type: "string", enum: exchangeReasons },
      status: { type: "string", enum: exchangeStatuses },
      affected_items: { type: "array", items: { $ref: "#/components/schemas/AdminExchangeAffectedItem" } },
      customer_visible_note: nullableString,
      operator_note: nullableString,
      reverse_logistics_provider: { oneOf: [{ type: "string", enum: reverseLogisticsProviders }, { type: "null" }] },
      reverse_tracking_code: nullableString,
      reverse_authorization_code: nullableString,
      reverse_label_reference: nullableString,
      return_received_at: nullableDateTime,
      resolved_at: nullableDateTime,
      created_by_operator_id: nullableString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminExchangeResponse", {
    type: "object",
    additionalProperties: false,
    required: ["exchange_request"],
    properties: {
      exchange_request: { $ref: "#/components/schemas/AdminExchangeRequest" },
    },
  })
}

function registerOperationalAlertSchemas(registry: ContractRegistryBundle): void {
  registry.registerComponent("admin", "schemas", "AdminOperationalAlertMetadata", {
    type: "object",
    additionalProperties: false,
    properties: {
      payment_attempt_id: { type: ["string", "number", "boolean"] },
      payment_intent_id: { type: ["string", "number", "boolean"] },
      checkout_completion_log_id: { type: ["string", "number", "boolean"] },
      webhook_event_log_id: { type: ["string", "number", "boolean"] },
      fulfillment_id: { type: ["string", "number", "boolean"] },
      order_id: { type: ["string", "number", "boolean"] },
      detector_code: { type: ["string", "number", "boolean"] },
      source_status: { type: ["string", "number", "boolean"] },
      operator_alert_code: { type: ["string", "number", "boolean"] },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminOperationalAlert", {
    type: "object",
    additionalProperties: false,
    required: ["id", "type", "severity", "status", "entity_type", "entity_id", "message_code", "message", "error_code", "metadata", "first_seen_at", "last_seen_at", "occurrence_count", "acknowledged_at", "acknowledged_by", "resolved_at", "resolved_by", "ignored_at", "ignored_by", "created_at", "updated_at"],
    properties: {
      id: { type: "string", pattern: "^opalert_[A-Za-z0-9_-]+$" },
      type: { type: "string", enum: ["payment_stuck", "fulfillment_failed"] },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      status: { type: "string", enum: ["open", "acknowledged", "resolved", "ignored"] },
      entity_type: { type: "string", enum: ["payment_attempt", "fulfillment"] },
      entity_id: { type: "string", maxLength: 128 },
      message_code: { type: "string", maxLength: 128 },
      message: { type: "string" },
      error_code: nullableString,
      metadata: { oneOf: [{ $ref: "#/components/schemas/AdminOperationalAlertMetadata" }, { type: "null" }] },
      first_seen_at: dateTimeString,
      last_seen_at: dateTimeString,
      occurrence_count: { type: "integer", minimum: 1 },
      acknowledged_at: nullableDateTime,
      acknowledged_by: nullableString,
      resolved_at: nullableDateTime,
      resolved_by: nullableString,
      ignored_at: nullableDateTime,
      ignored_by: nullableString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
  })

  registry.registerComponent("admin", "schemas", "AdminOperationalAlertsListResponse", {
    type: "object",
    additionalProperties: false,
    required: ["operational_alerts", "count", "limit", "offset"],
    properties: {
      operational_alerts: { type: "array", items: { $ref: "#/components/schemas/AdminOperationalAlert" } },
      count: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0, maximum: 100000 },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminOperationalAlertResponse", {
    type: "object",
    additionalProperties: false,
    required: ["operational_alert"],
    properties: {
      operational_alert: { $ref: "#/components/schemas/AdminOperationalAlert" },
    },
  })
}

export function registerAdminSchemas(registry: ContractRegistryBundle): void {
  registerProductSchemas(registry)
  registerRefundSchemas(registry)
  registerExchangeSchemas(registry)
  registerOperationalAlertSchemas(registry)
}
