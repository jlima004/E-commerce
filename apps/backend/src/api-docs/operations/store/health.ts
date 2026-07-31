import {
  CORRELATION_ID_HEADER,
  storeErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

export function registerStoreHealthOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/health/live",
    operationId: "storeHealthGetLive",
    summary: "Liveness probe",
    tags: ["Infrastructure"],
    security: [],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Process is live.",
        "StoreHealthLiveResponse"
      ),
      "500": storeErrorResponse(
        "Unhandled framework or infrastructure failure."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/health/live/route.ts",
      "apps/backend/src/infrastructure/health.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/health.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/health/live/route.ts",
    inclusionReason:
      "Public liveness probe documented in the Store contract under Infrastructure.",
    interactiveCandidate: true,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/health/ready",
    operationId: "storeHealthGetReady",
    summary: "Readiness probe",
    tags: ["Infrastructure"],
    security: [],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Process is ready to accept traffic.",
        "StoreHealthReadyResponse"
      ),
      "503": storeJsonResponse(
        "One or more required dependencies are not ready.",
        "StoreHealthReadyResponse"
      ),
      "500": storeErrorResponse(
        "Unhandled framework or infrastructure failure."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/health/ready/route.ts",
      "apps/backend/src/infrastructure/health.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/health.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/health/ready/route.ts",
    inclusionReason:
      "Public readiness probe documented in the Store contract under Infrastructure.",
    interactiveCandidate: true,
    nonInteractive: true,
  })
}
