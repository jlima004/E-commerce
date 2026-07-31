import {
  ADMIN_OPERATIONAL_ALERT_ID_PATH,
  ADMIN_OPERATIONAL_ALERT_LIST_QUERY,
  ADMIN_USER_SECURITY,
  CORRELATION_ID_HEADER,
  adminErrorResponse,
  adminUnauthorizedResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { adminJsonResponse } from "./schemas"

export function registerAdminOperationalAlertOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "admin",
    method: "GET",
    path: "/admin/operational-alerts",
    operationId: "adminOperationalAlertsList",
    summary: "List operational alerts",
    description:
      "Lists the safe, allowlisted operational-alert DTO. Alert contents remain operationally sensitive and the operation is non-interactive.",
    tags: ["Operational Alerts"],
    security: [...ADMIN_USER_SECURITY],
    parameters: [CORRELATION_ID_HEADER, ...ADMIN_OPERATIONAL_ALERT_LIST_QUERY],
    requestBody: null,
    responses: {
      "200": adminJsonResponse(
        "Operational alerts and pagination metadata.",
        "AdminOperationalAlertsListResponse"
      ),
      "400": adminErrorResponse(
        "Invalid actor type or query key, enum, entity identifier, date range, or pagination value."
      ),
      "401": adminUnauthorizedResponse(),
      "500": adminErrorResponse(
        "Early body-parser failure or later module/query failure. Correlation header presence is not guaranteed for this mixed response.",
        false
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/admin/operational-alerts/route.ts",
      "apps/backend/src/api/admin/_shared/require-admin-actor.ts",
      "apps/backend/src/modules/operational-alert/service.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/admin-operational-alerts.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/admin/operational-alerts/route.ts",
    inclusionReason:
      "Project-owned read-only Admin operational-alert list boundary.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "admin",
    method: "GET",
    path: "/admin/operational-alerts/{id}",
    operationId: "adminOperationalAlertsRetrieve",
    summary: "Retrieve an operational alert",
    description:
      "Retrieves one safe, allowlisted operational-alert DTO. Alert contents remain operationally sensitive and the operation is non-interactive.",
    tags: ["Operational Alerts"],
    security: [...ADMIN_USER_SECURITY],
    parameters: [CORRELATION_ID_HEADER, ADMIN_OPERATIONAL_ALERT_ID_PATH],
    requestBody: null,
    responses: {
      "200": adminJsonResponse(
        "Operational alert detail.",
        "AdminOperationalAlertResponse"
      ),
      "400": adminErrorResponse(
        "Invalid actor type or operational-alert identifier."
      ),
      "401": adminUnauthorizedResponse(),
      "404": adminErrorResponse("Operational alert was not found."),
      "500": adminErrorResponse(
        "Early body-parser failure or later module/query failure. Correlation header presence is not guaranteed for this mixed response.",
        false
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/admin/operational-alerts/[id]/route.ts",
      "apps/backend/src/api/admin/_shared/require-admin-actor.ts",
      "apps/backend/src/modules/operational-alert/service.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/admin-operational-alerts.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/admin/operational-alerts/%5Bid%5D/route.ts",
    inclusionReason:
      "Project-owned read-only Admin operational-alert detail boundary.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
