import {
  CORRELATION_ID_HEADER,
  STORE_REQUIRED_CUSTOMER,
  storeErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

export function registerStoreCustomerOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "POST",
    path: "/store/customers/me/cart/attach",
    operationId: "storeCustomerCartAttach",
    summary: "Attach the guest session cart to the authenticated customer",
    tags: ["Customer"],
    security: [...STORE_REQUIRED_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER],
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/StoreCustomerCartAttachRequest",
          },
        },
      },
    },
    responses: {
      "200": storeJsonResponse(
        "Either preserves the customer cart or attaches the authorized guest cart.",
        "StoreCustomerCartAttachResponse"
      ),
      "400": storeErrorResponse("Invalid attach request body."),
      "401": storeErrorResponse(
        "Missing publishable API key or authenticated customer actor."
      ),
      "403": storeErrorResponse(
        "Guest cart is not authorized for the current session."
      ),
      "404": storeErrorResponse(
        "Authenticated customer or referenced cart was not found."
      ),
      "500": storeErrorResponse("Attach workflow failure."),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/customers/me/cart/attach/route.ts",
      "apps/backend/src/modules/checkout/attach-guest-cart.ts",
      "apps/backend/src/api/store/carts/serializers.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/cart-checkout-store.spec.ts",
      "apps/backend/src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/me/cart/attach/route.ts",
    inclusionReason:
      "Authenticated customer cart attachment contract required by storefront login/checkout.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
