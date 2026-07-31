import {
  CORRELATION_ID_HEADER,
  STORE_PUBLISHABLE_ONLY,
  storeErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

export function registerStoreTrackingOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "POST",
    path: "/store/tracking/lookup",
    operationId: "storeTrackingLookup",
    summary: "Lookup public order tracking with a capability token",
    tags: ["Tracking"],
    security: [...STORE_PUBLISHABLE_ONLY],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/StoreTrackingLookupRequest",
          },
        },
      },
    },
    responses: {
      "200": storeJsonResponse(
        "Allowlisted public tracking summary.",
        "StoreTrackingLookupEnvelope"
      ),
      "400": storeErrorResponse(
        "Malformed body or rejected non-token identifier fields."
      ),
      "401": storeErrorResponse(
        "Invalid, expired, revoked, or unavailable tracking token. The error body is intentionally indistinguishable."
      ),
      "429": storeErrorResponse("Tracking lookup rate limit exceeded."),
      "500": storeErrorResponse("Internal tracking lookup failure."),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/tracking/lookup/route.ts",
      "apps/backend/src/api/store/tracking/serializers.ts",
      "apps/backend/src/modules/tracking-access-token/lookup-body.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/tracking-access-token.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/tracking/lookup/route.ts",
    inclusionReason:
      "Capability-token Store tracking lookup. Token belongs only in the request body.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
