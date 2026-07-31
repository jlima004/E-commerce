import {
  CORRELATION_ID_HEADER,
  STORE_OPTIONAL_CUSTOMER,
  storeErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

export function registerStoreCartOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/store/carts/active",
    operationId: "storeCartGetActive",
    summary: "Get the active Store cart",
    tags: ["Cart"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Active cart serialized as PublicStoreCartPreOrder. Monetary totals are BRL major units.",
        "StoreCartResponse"
      ),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "404": storeErrorResponse(
        "Current guest session or authenticated customer has no active cart."
      ),
      "500": storeErrorResponse("Cart retrieval failure."),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/carts/active/route.ts",
      "apps/backend/src/api/store/carts/serializers.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/cart-checkout-store.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/carts/active/route.ts",
    inclusionReason:
      "Project-owned active-cart read used by the future storefront checkout flow.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "store",
    method: "POST",
    path: "/store/carts/active",
    operationId: "storeCartCreateOrGetActive",
    summary: "Create or reuse the active Store cart",
    tags: ["Cart"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Existing active cart reused. Monetary totals are BRL major units.",
        "StoreCartResponse"
      ),
      "201": storeJsonResponse(
        "New BRL cart created for the current actor. Monetary totals are BRL major units.",
        "StoreCartResponse"
      ),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "500": storeErrorResponse(
        "Session, customer, or cart workflow failure."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/carts/active/route.ts",
      "apps/backend/src/api/store/carts/serializers.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/cart-checkout-store.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/carts/active/route.ts",
    inclusionReason:
      "Project-owned active-cart create/reuse mutation used by checkout.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
