import type { ContractRegistryBundle } from "../registry"
import { STORE_X_CORRELATION_ID_RESPONSE_HEADERS } from "./headers"

const nullableString = {
  type: ["string", "null"],
} as const

export function registerStoreErrorSchemas(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "schemas", "StoreError", {
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

export function storeErrorResponse(description: string) {
  return {
    description,
    headers: STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/StoreError",
        },
      },
    },
  }
}
