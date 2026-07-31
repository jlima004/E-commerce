import {
  GELATO_WEBHOOK_SECRET_SECURITY,
  WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
  webhookControlledOrFrameworkErrorResponse,
  webhookErrorResponse,
  webhookFrameworkErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"

export function registerGelatoWebhookOperation(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "webhooks",
    method: "POST",
    path: "/hooks/gelato",
    operationId: "webhookGelatoReceive",
    summary: "Receive an authenticated Gelato webhook",
    description:
      "Authenticates Gelato webhook payloads and supports only order_status_updated. The canonical authentication header is x-gelato-webhook-secret and runtime can override it through GELATO_WEBHOOK_AUTH_HEADER_NAME. The committed OpenAPI contract documents the canonical default header name. Future runtime exposure of this document must remain disabled when a configured header-name override would make the committed contract inaccurate. Authentication compares equal-length secret values with timingSafeEqual; a length mismatch rejects immediately, so the entire rejection path is not claimed to be constant-time. Unsupported or missing event types are acknowledged as ignored without persistence. A final event replay returns duplicate true and the stored status without a new fulfillment update. A non-final duplicate returns duplicate true if it completes but may continue processing; this endpoint does not claim a broad duplicate no-op.",
    tags: ["Gelato Webhooks"],
    security: [...GELATO_WEBHOOK_SECRET_SECURITY],
    parameters: [],
    requestBody: {
      required: true,
      description:
        "Authenticated Gelato webhook object. Only the order_status_updated variant is processed.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/GelatoWebhookRequest",
          },
        },
      },
    },
    responses: {
      "200": {
        description:
          "Authenticated event acknowledged. Unsupported or missing events are ignored without persistence; supported events return their processed, ignored, or failed terminal status.",
        headers: WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
        content: {
          "application/json": {
            schema: {
              oneOf: [
                {
                  $ref: "#/components/schemas/GelatoWebhookAcknowledgementResponse",
                },
                {
                  $ref: "#/components/schemas/GelatoWebhookIgnoredResponse",
                },
              ],
            },
          },
        },
      },
      "400": webhookControlledOrFrameworkErrorResponse(
        "Route-level controlled rejection when the body is null or not an object, or a supported event has malformed required fields (codes gelato_webhook_payload_invalid or the lowercase parser code). Framework-level invalid-data failure when webhook module resolution or record update rejects the request with the Medusa error envelope."
      ),
      "401": webhookErrorResponse(
        "The canonical Gelato authentication header is absent. The code is gelato_webhook_auth_header_required."
      ),
      "403": webhookErrorResponse(
        "The canonical Gelato authentication header value is invalid. The code is gelato_webhook_auth_header_invalid."
      ),
      "500": webhookFrameworkErrorResponse(
        "Unexpected framework or infrastructure failure outside the route's controlled webhook rejection envelope.",
        false
      ),
      "503": webhookErrorResponse(
        "The Gelato webhook verification secret is not configured. The code is gelato_webhook_secret_not_configured."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/hooks/gelato/route.ts",
      "apps/backend/src/modules/gelato-fulfillment/service.ts",
    ],
    testEvidence: [
      "apps/backend/src/api/hooks/gelato/__tests__/gelato-webhook-route.unit.spec.ts",
      "apps/backend/integration-tests/http/gelato-webhook.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/hooks/gelato/route.ts",
    inclusionReason:
      "Project-owned authenticated Gelato status boundary required to update local fulfillment state.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
