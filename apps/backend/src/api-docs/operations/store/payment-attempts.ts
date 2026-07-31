import {
  CORRELATION_ID_HEADER,
  STORE_CART_ID_PATH,
  STORE_OPTIONAL_CUSTOMER,
  storeErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

export function registerStorePaymentAttemptOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "POST",
    path: "/store/carts/{id}/payment-attempts/card",
    operationId: "storePaymentAttemptCreateCard",
    summary: "Start a card PaymentAttempt for a cart",
    tags: ["Payment"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER, STORE_CART_ID_PATH],
    requestBody: null,
    responses: {
      "201": storeJsonResponse(
        "Card PaymentAttempt created. amount is integer BRL minor units; client_secret is ephemeral.",
        "StoreCardPaymentAttemptEnvelope"
      ),
      "400": storeErrorResponse(
        "Client money fields were supplied, or the cart is ineligible/incomplete."
      ),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "403": storeErrorResponse(
        "Actor is not authorized for the target cart."
      ),
      "404": storeErrorResponse("Cart was not found."),
      "500": storeErrorResponse(
        "Stripe, module, or persistence failure."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts",
      "apps/backend/src/api/store/carts/payment-attempts/validators.ts",
      "apps/backend/src/modules/payment-attempt/card.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/payment-attempt-store.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/carts/%5Bid%5D/payment-attempts/card/route.ts",
    inclusionReason:
      "Project-owned card payment initiation boundary. Order creation is not part of this route.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "store",
    method: "POST",
    path: "/store/carts/{id}/payment-attempts/pix",
    operationId: "storePaymentAttemptCreatePix",
    summary: "Start a Pix PaymentAttempt for a cart",
    tags: ["Payment"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER, STORE_CART_ID_PATH],
    requestBody: null,
    responses: {
      "201": storeJsonResponse(
        "Pix PaymentAttempt created. amount is integer BRL minor units; QR/copy-paste material is sensitive.",
        "StorePixPaymentAttemptEnvelope"
      ),
      "400": storeErrorResponse(
        "Client money fields were supplied, or the cart is ineligible/incomplete."
      ),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "403": storeErrorResponse(
        "Actor is not authorized for the target cart."
      ),
      "404": storeErrorResponse("Cart was not found."),
      "500": storeErrorResponse(
        "Stripe, module, or persistence failure."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts",
      "apps/backend/src/api/store/carts/payment-attempts/validators.ts",
      "apps/backend/src/modules/payment-attempt/pix.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/payment-attempt-store.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/carts/%5Bid%5D/payment-attempts/pix/route.ts",
    inclusionReason:
      "Project-owned Pix payment initiation boundary. Order creation is not part of this route.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
