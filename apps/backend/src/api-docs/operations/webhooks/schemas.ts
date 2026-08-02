import { WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS } from "../../components"
import type {
  ComponentTypeOf,
  ContractRegistryBundle,
} from "../../registry"

const terminalWebhookStatusSchema = {
  type: "string",
  enum: ["processed", "ignored", "failed"],
} satisfies ComponentTypeOf<"schemas">
const GELATO_SUPPORTED_EVENT_PATTERN =
  "^\\s*order_status_updated\\s*$"

export function webhookJsonResponse(
  description: string,
  schemaName: string
) {
  return {
    description,
    headers: WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
  }
}

export function registerWebhookSchemas(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("webhooks", "schemas", "StripeWebhookEventRequest", {
    type: "object",
    additionalProperties: true,
    required: ["id", "type"],
    description:
      "Conservative subset of a verified Stripe event after signature verification. id and type are the only top-level fields required for persistence and acknowledgement. data and data.object are optional at the ingress boundary: a verified unsupported event may omit them and still be acknowledged as ignored, while supported processors inspect data.object when present. Unknown Stripe properties are retained rather than modeled as a complete Stripe.Event.",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description: "Stripe event identifier.",
      },
      type: {
        type: "string",
        "x-supported-event-types": [
          "payment_intent.succeeded",
          "payment_intent.payment_failed",
          "payment_intent.canceled",
          "refund.created",
          "refund.updated",
          "refund.failed",
          "charge.refunded",
        ],
        description:
          "Supported event types. A correctly signed event with another type is acknowledged as ignored.",
      },
      account: {
        type: ["string", "null"],
        description: "Optional connected Stripe account identifier.",
      },
      livemode: {
        type: "boolean",
        description: "Optional Stripe live-mode marker.",
      },
      data: {
        type: "object",
        additionalProperties: true,
        description:
          "Optional Stripe event data envelope. Omitted or incomplete data is accepted at the route boundary for verified unsupported events.",
        properties: {
          object: {
            description:
              "Optional provider object inspected by supported event processors. Provider-specific fields are intentionally not expanded here.",
          },
        },
      },
    },
  })

  registry.registerComponent(
    "webhooks",
    "schemas",
    "StripeWebhookAcknowledgementResponse",
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "duplicate", "event_id", "event_type", "status"],
      properties: {
        ok: { type: "boolean", const: true },
        duplicate: {
          type: "boolean",
          description:
            "True when an existing persisted event was found. Only a terminal replay is guaranteed to short-circuit; a nonterminal or concurrent duplicate may continue processing.",
        },
        event_id: {
          type: ["string", "null"],
          description: "Stripe event identifier when available.",
        },
        event_type: { type: "string" },
        status: terminalWebhookStatusSchema,
      },
    }
  )

  registry.registerComponent("webhooks", "schemas", "GelatoWebhookRequest", {
    type: "object",
    additionalProperties: true,
    description:
      "Authenticated Gelato webhook object. The supported order_status_updated variant requires id, orderId, orderReferenceId, and fulfillmentStatus as non-whitespace strings and event as order_status_updated with optional surrounding whitespace. Authenticated objects with a missing or unsupported event are acknowledged as ignored without persistence and may carry null, malformed, or omitted supported-event fields. connectedOrderIds may be null or an array; non-array values are rejected only for the supported variant, and non-string array entries are filtered by the parser.",
    properties: {
      id: {
        description:
          "Gelato event identifier. Required as a non-empty string only for the supported order_status_updated variant.",
      },
      event: {
        description:
          "Provider event type. Values other than order_status_updated, including missing or blank values, are ignored without persistence.",
      },
      orderId: {
        description:
          "Gelato order identifier. Required as a non-empty string only for the supported variant.",
      },
      orderReferenceId: {
        description:
          "Merchant order reference. Required as a non-empty string only for the supported variant.",
      },
      fulfillmentStatus: {
        description:
          "Provider fulfillment status. Required as a non-empty string only for the supported variant.",
      },
      connectedOrderIds: {
        description:
          "Optional connected Gelato order identifiers. On unsupported or missing events this field is not validated. For the supported variant, null or an array is accepted, a non-array value is rejected, and non-string array entries are filtered.",
      },
    },
    oneOf: [
      {
        title: "Supported order status update",
        required: [
          "id",
          "event",
          "orderId",
          "orderReferenceId",
          "fulfillmentStatus",
        ],
        properties: {
          id: { type: "string", minLength: 1, pattern: "\\S" },
          event: {
            type: "string",
            pattern: GELATO_SUPPORTED_EVENT_PATTERN,
          },
          orderId: { type: "string", minLength: 1, pattern: "\\S" },
          orderReferenceId: { type: "string", minLength: 1, pattern: "\\S" },
          fulfillmentStatus: { type: "string", minLength: 1, pattern: "\\S" },
          connectedOrderIds: {
            oneOf: [
              {
                type: "array",
                items: {
                  oneOf: [
                    {
                      type: "string",
                      pattern: "\\S",
                    },
                    {
                      not: {
                        type: "string",
                      },
                    },
                  ],
                },
              },
              {
                type: "null",
              },
            ],
          },
        },
      },
      {
        title: "Unsupported or missing event",
        not: {
          required: ["event"],
          properties: {
            event: {
              type: "string",
              pattern: GELATO_SUPPORTED_EVENT_PATTERN,
            },
          },
        },
      },
    ],
  })

  registry.registerComponent(
    "webhooks",
    "schemas",
    "GelatoWebhookAcknowledgementResponse",
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "duplicate", "event_id", "event_type", "status"],
      properties: {
        ok: { type: "boolean", const: true },
        duplicate: {
          type: "boolean",
          description:
            "True when an existing persisted event was found. A final replay is a no-op, but a non-final duplicate may continue processing.",
        },
        event_id: {
          type: ["string", "null"],
          description: "Gelato event identifier when available.",
        },
        event_type: {
          type: "string",
          const: "order_status_updated",
        },
        status: terminalWebhookStatusSchema,
      },
    }
  )

  registry.registerComponent(
    "webhooks",
    "schemas",
    "GelatoWebhookIgnoredResponse",
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "duplicate", "status", "event_type", "code"],
      properties: {
        ok: { type: "boolean", const: true },
        duplicate: { type: "boolean", const: false },
        status: { type: "string", const: "ignored" },
        event_type: {
          type: ["string", "null"],
          description: "Unsupported event type, or null when it was missing.",
        },
        code: {
          type: "string",
          const: "gelato_webhook_event_unsupported",
        },
      },
    }
  )
}
