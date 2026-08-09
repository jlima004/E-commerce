import type {
  ComponentTypeOf,
  ContractRegistryBundle,
} from "../registry"
import { STORE_X_CORRELATION_ID_RESPONSE_HEADERS } from "./headers"
import { ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS } from "./headers"
import { WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS } from "./headers"

const nullableString = {
  type: ["string", "null"],
} satisfies ComponentTypeOf<"schemas">

export function registerStoreErrorSchemas(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "schemas", "StoreErrorResponse", {
    type: "object",
    additionalProperties: false,
    required: ["code", "message", "retryable"],
    properties: {
      code: {
        type: "string",
        description: "Stable machine-readable public Store error code.",
      },
      message: {
        type: "string",
        description:
          "Sanitized presentation message; clients must branch on code, not message.",
      },
      correlationId: {
        type: "string",
        pattern: "^[A-Za-z0-9._-]{1,128}$",
        description:
          "Server-sanitized correlation identifier matching the response header when present.",
      },
      retryable: {
        type: "boolean",
        description:
          "True only when a retry is factually safe and no external effect is uncertain.",
      },
      fieldErrors: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Allowlisted public field names mapped to sanitized messages.",
      },
      cart: {
        description:
          "Optional safe primitive cart reference. The canonical Cart snapshot belongs to Phase 15.",
        oneOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
        ],
      },
    },
  })
}

export function storeErrorResponse(description: string) {
  return {
    description,
    headers: STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/StoreErrorResponse",
        },
      },
    },
  }
}

export function registerAdminErrorSchemas(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("admin", "schemas", "AdminError", {
    type: "object",
    additionalProperties: false,
    required: ["type", "message"],
    properties: {
      type: {
        type: "string",
        description: "Medusa or project error type code.",
      },
      message: {
        type: "string",
        description: "Human-readable sanitized error message.",
      },
      code: {
        ...nullableString,
        description: "Optional machine-readable error code when present.",
      },
    },
  })

  registry.registerComponent("admin", "schemas", "AdminUnauthorized", {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
      message: {
        type: "string",
        const: "Unauthorized",
      },
    },
  })
}

export function adminErrorResponse(
  description: string,
  correlationHeaderGuaranteed = true
) {
  return {
    description,
    ...(correlationHeaderGuaranteed
      ? { headers: ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS }
      : {}),
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/AdminError",
        },
      },
    },
  }
}

export function adminUnauthorizedResponse() {
  return {
    description:
      "Authentication failed before the request reached the project correlation middleware.",
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/AdminUnauthorized",
        },
      },
    },
  }
}

export function registerWebhookErrorSchemas(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("webhooks", "schemas", "WebhookErrorResponse", {
    type: "object",
    additionalProperties: false,
    required: ["ok", "code"],
    properties: {
      ok: {
        type: "boolean",
        const: false,
      },
      code: {
        type: "string",
        description: "Stable machine-readable webhook rejection code.",
      },
    },
  })

  registry.registerComponent("webhooks", "schemas", "WebhookFrameworkError", {
    type: "object",
    additionalProperties: false,
    required: ["type", "message"],
    properties: {
      type: {
        type: "string",
        description: "Medusa or project error type code.",
      },
      message: {
        type: "string",
        description: "Human-readable sanitized error message.",
      },
      code: {
        ...nullableString,
        description: "Optional machine-readable error code when present.",
      },
    },
  })
}

export function webhookErrorResponse(description: string) {
  return {
    description,
    headers: WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/WebhookErrorResponse",
        },
      },
    },
  }
}

export function webhookControlledOrFrameworkErrorResponse(description: string) {
  return {
    description,
    headers: WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          oneOf: [
            { $ref: "#/components/schemas/WebhookErrorResponse" },
            { $ref: "#/components/schemas/WebhookFrameworkError" },
          ],
        },
      },
    },
  }
}

export function webhookFrameworkErrorResponse(
  description: string,
  correlationHeaderGuaranteed = true
) {
  return {
    description,
    ...(correlationHeaderGuaranteed
      ? { headers: WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS }
      : {}),
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/WebhookFrameworkError",
        },
      },
    },
  }
}
