import type { ContractRegistryBundle } from "../registry"

export function registerStoreResponseHeaders(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "headers", "XCorrelationId", {
    schema: {
      type: "string",
    },
    description:
      "Server-sanitized correlation identifier returned on every response. Invalid or missing input is replaced, never echoed arbitrarily.",
  })

  registry.registerComponent("store", "headers", "ETag", {
    schema: { type: "string", minLength: 1 },
    description:
      "Opaque server-authoritative resource version. Cart runtime emission belongs to Phase 15.",
  })

  registry.registerComponent("store", "headers", "RetryAfter", {
    schema: {
      oneOf: [
        { type: "integer", minimum: 0 },
        { type: "string", format: "http-date" },
      ],
    },
    description:
      "Conditional retry delay emitted only when retryability is factual and no external effect is uncertain.",
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

export function registerWebhookResponseHeaders(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("webhooks", "headers", "WebhookXCorrelationId", {
    schema: {
      type: "string",
    },
    description:
      "Correlation identifier returned after the request reaches the project correlation middleware. This header is attached only to evidenced post-correlation webhook responses.",
  })
}

export const WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS = {
  "x-correlation-id": {
    $ref: "#/components/headers/WebhookXCorrelationId",
  },
} as const
