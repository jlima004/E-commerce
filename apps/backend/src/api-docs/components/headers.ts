import type { ContractRegistryBundle } from "../registry"

export function registerStoreResponseHeaders(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "headers", "XCorrelationId", {
    schema: {
      type: "string",
    },
    description:
      "Correlation identifier returned by the server on every response. Echoes the request x-correlation-id when provided; otherwise a server-generated value.",
  })
}

export const STORE_X_CORRELATION_ID_RESPONSE_HEADERS = {
  "x-correlation-id": {
    $ref: "#/components/headers/XCorrelationId",
  },
} as const

export function registerAdminResponseHeaders(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("admin", "headers", "AdminXCorrelationId", {
    schema: {
      type: "string",
    },
    description:
      "Correlation identifier returned after the request reaches the project correlation middleware. Early framework responses, including authentication failures, can omit this header.",
  })
}

export const ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS = {
  "x-correlation-id": {
    $ref: "#/components/headers/AdminXCorrelationId",
  },
} as const
