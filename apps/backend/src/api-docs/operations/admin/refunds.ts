import {
  ADMIN_USER_SECURITY,
  CORRELATION_ID_HEADER,
  adminErrorResponse,
  adminUnauthorizedResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { adminJsonResponse } from "./schemas"

export function registerAdminRefundOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/refunds/request",
    operationId: "adminRefundRequestCreate",
    summary: "Create or replay an Admin refund request",
    description:
      "Creates an idempotent refund request using integer BRL minor units. The authenticated Admin user is the operator; client-supplied operator identity is forbidden. The operation appends internal audit facts without exposing an audit resource.",
    tags: ["Refunds"],
    security: [...ADMIN_USER_SECURITY],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminRefundRequestCreate" },
        },
      },
    },
    responses: {
      "200": adminJsonResponse(
        "Existing refund request returned for the same idempotency key.",
        "AdminRefundRequestResponse"
      ),
      "201": adminJsonResponse(
        "New refund request created.",
        "AdminRefundRequestResponse"
      ),
      "400": adminErrorResponse(
        "Invalid actor type, disabled feature, invalid request, unavailable refund amount, or other evidenced domain rejection."
      ),
      "401": adminUnauthorizedResponse(),
      "404": adminErrorResponse(
        "Order, captured PaymentAttempt, or eligible payment state was not found."
      ),
      "500": adminErrorResponse(
        "Early body-parser failure or later module, audit, or persistence failure. Correlation header presence is not guaranteed for this mixed response.",
        false
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/admin/refunds/request/route.ts",
      "apps/backend/src/api/admin/_shared/require-admin-actor.ts",
      "apps/backend/src/modules/refund-request/service.ts",
      "apps/backend/src/modules/refund-request/types.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/admin-refunds.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/admin/refunds/request/route.ts",
    inclusionReason:
      "Project-owned idempotent Admin refund boundary required by the operator workflow.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
