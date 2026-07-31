import {
  ADMIN_EXCHANGE_ID_PATH,
  ADMIN_USER_SECURITY,
  CORRELATION_ID_HEADER,
  adminErrorResponse,
  adminUnauthorizedResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { adminJsonResponse } from "./schemas"

const sourceFiles = [
  "apps/backend/src/api/admin/exchanges/route.ts",
  "apps/backend/src/api/admin/exchanges/[id]/route.ts",
  "apps/backend/src/api/admin/_shared/require-admin-actor.ts",
  "apps/backend/src/modules/exchange-request/service.ts",
  "apps/backend/src/modules/exchange-request/types.ts",
]
const testEvidence = [
  "apps/backend/integration-tests/http/admin-exchanges.spec.ts",
]

export function registerAdminExchangeOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/exchanges",
    operationId: "adminExchangesCreate",
    summary: "Create an Admin exchange request",
    description:
      "Creates an exchange request through a closed property allowlist. Some optional non-string values are normalized to null or ignored by the current runtime. Internal audit facts are appended without exposing an audit resource.",
    tags: ["Exchanges"],
    security: [...ADMIN_USER_SECURITY],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminExchangeCreateRequest" },
        },
      },
    },
    responses: {
      "201": adminJsonResponse(
        "Exchange request created.",
        "AdminExchangeResponse"
      ),
      "400": adminErrorResponse(
        "Invalid actor type, disabled feature, unknown/forbidden key, invalid reason/items/reverse logistics, or other evidenced domain rejection."
      ),
      "401": adminUnauthorizedResponse(),
      "404": adminErrorResponse("Order was not found or was not eligible."),
      "500": adminErrorResponse(
        "Early body-parser failure or later module, audit, or persistence failure. Correlation header presence is not guaranteed for this mixed response.",
        false
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/admin/exchanges/route.ts",
    inclusionReason:
      "Project-owned Admin exchange-create boundary required by the operator workflow.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/exchanges/{id}",
    operationId: "adminExchangesUpdate",
    summary: "Update an Admin exchange request",
    description:
      "Updates an exchange request with POST, not PATCH. At least one effective update must remain after normalization, and status changes follow the current transition graph. Internal audit facts are appended without exposing an audit resource.",
    tags: ["Exchanges"],
    security: [...ADMIN_USER_SECURITY],
    parameters: [CORRELATION_ID_HEADER, ADMIN_EXCHANGE_ID_PATH],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminExchangeUpdateRequest" },
        },
      },
    },
    responses: {
      "200": adminJsonResponse(
        "Exchange request updated.",
        "AdminExchangeResponse"
      ),
      "400": adminErrorResponse(
        "Invalid actor type, disabled feature, invalid/empty effective update, forbidden key, invalid provider, or invalid/terminal status transition."
      ),
      "401": adminUnauthorizedResponse(),
      "404": adminErrorResponse("Exchange request was not found."),
      "500": adminErrorResponse(
        "Early body-parser failure or later module, audit, or persistence failure. Correlation header presence is not guaranteed for this mixed response.",
        false
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/admin/exchanges/%5Bid%5D/route.ts",
    inclusionReason:
      "Project-owned Admin exchange-update boundary required by the operator workflow.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
