import {
  CORRELATION_ID_HEADER,
  STORE_OPTIONAL_CUSTOMER,
  storeErrorResponse,
} from "../../components"
import {
  STORE_ETAG_RESPONSE_HEADERS,
  STORE_GUEST_CART_TOKEN_RESPONSE_HEADERS,
  STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
} from "../../components/headers"
import {
  STORE_CART_ID_PATH,
  STORE_CART_LINE_ID_PATH,
  STORE_GUEST_CART_TOKEN_HEADER_REF,
} from "../../components/parameters"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

const STORE_IDEMPOTENCY_KEY_REF = {
  $ref: "#/components/parameters/IdempotencyKey",
} as const

const STORE_IF_MATCH_REF = {
  $ref: "#/components/parameters/IfMatch",
} as const

const CART_M1_SOURCE_ROOT = "apps/backend/src/api/store/carts"
const CART_M1_TEST_ROOT = "apps/backend/integration-tests/http"

function cartJsonResponse(
  description: string,
  extraHeaders: Record<string, unknown> = {}
) {
  const response = storeJsonResponse(description, "StoreCartResponse")
  return {
    ...response,
    headers: {
      ...STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
      ...STORE_ETAG_RESPONSE_HEADERS,
      ...extraHeaders,
    },
  }
}

function cartMutationErrorResponses() {
  return {
    "400": storeErrorResponse(
      "Invalid line-item payload or missing/malformed cart precondition header."
    ),
    "401": storeErrorResponse("Missing or invalid publishable API key."),
    "404": storeErrorResponse(
      "Cart or line item was not found for the current actor."
    ),
    "409": storeErrorResponse(
      "Idempotency key conflict or operation currently in progress."
    ),
    "412": storeErrorResponse(
      "CART_VERSION_MISMATCH: the If-Match precondition is stale; the response cart is the current PublicStoreCartPreOrder snapshot."
    ),
    "500": storeErrorResponse("Cart line-item workflow failure."),
    "503": storeErrorResponse(
      "Customer authentication authority is temporarily unavailable."
    ),
  }
}

type LineItemOperationConfig = {
  method: "POST" | "DELETE"
  path: string
  operationId: string
  summary: string
  sourceFile: string
  testFile: string
  lineId: boolean
  requestBody: unknown
  inclusionReason: string
}

function registerLineItemOperation(
  registry: ContractRegistryBundle,
  config: LineItemOperationConfig
): void {
  registry.registerOperation({
    surface: "store",
    method: config.method,
    path: config.path,
    operationId: config.operationId,
    summary: config.summary,
    tags: ["Cart"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [
      CORRELATION_ID_HEADER,
      STORE_CART_ID_PATH,
      STORE_GUEST_CART_TOKEN_HEADER_REF,
      STORE_IF_MATCH_REF,
      STORE_IDEMPOTENCY_KEY_REF,
      ...(config.lineId ? [STORE_CART_LINE_ID_PATH] : []),
    ],
    requestBody: config.requestBody,
    responses: {
      "200": cartJsonResponse(
        "Cart mutation completed. Monetary totals are BRL major units."
      ),
      ...cartMutationErrorResponses(),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      `${CART_M1_SOURCE_ROOT}/${config.sourceFile}`,
      `${CART_M1_SOURCE_ROOT}/line-item-mutation.ts`,
      `${CART_M1_SOURCE_ROOT}/serializers.ts`,
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [`${CART_M1_TEST_ROOT}/${config.testFile}`],
    officialReference: `https://github.com/jlima004/E-commerce/blob/main/${CART_M1_SOURCE_ROOT}/${config.sourceFile}`,
    inclusionReason: config.inclusionReason,
    interactiveCandidate: false,
    nonInteractive: true,
  })
}

export function registerStoreCartOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/store/carts/active",
    operationId: "getActiveStoreCart",
    summary: "Get the active Store cart",
    tags: ["Cart"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER, STORE_GUEST_CART_TOKEN_HEADER_REF],
    requestBody: null,
    responses: {
      "200": cartJsonResponse(
        "Active cart serialized as PublicStoreCartPreOrder. Monetary totals are BRL major units."
      ),
      "401": storeErrorResponse("Missing or invalid publishable API key."),
      "404": storeErrorResponse(
        "Current guest capability or authenticated customer has no active cart."
      ),
      "500": storeErrorResponse("Cart retrieval failure."),
      "503": storeErrorResponse(
        "Customer authentication authority is temporarily unavailable."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      `${CART_M1_SOURCE_ROOT}/active/route.ts`,
      `${CART_M1_SOURCE_ROOT}/serializers.ts`,
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      `${CART_M1_TEST_ROOT}/cart-checkout-store.spec.ts`,
      `${CART_M1_TEST_ROOT}/guest-cart-active.spec.ts`,
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
    operationId: "createActiveStoreCart",
    summary: "Create or reuse the active Store cart",
    tags: ["Cart"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [
      CORRELATION_ID_HEADER,
      STORE_GUEST_CART_TOKEN_HEADER_REF,
      STORE_IDEMPOTENCY_KEY_REF,
    ],
    requestBody: null,
    responses: {
      "200": cartJsonResponse(
        "Existing active cart reused or replayed. No guest capability response header is emitted. Monetary totals are BRL major units."
      ),
      "201": cartJsonResponse(
        "New BRL cart created. ETag is returned; x-indicio-guest-cart-token is returned only for the guest capability mint path and is omitted for Customer creation.",
        STORE_GUEST_CART_TOKEN_RESPONSE_HEADERS
      ),
      "400": storeErrorResponse(
        "Missing or invalid Idempotency-Key header."
      ),
      "401": storeErrorResponse("Missing or invalid publishable API key."),
      "404": storeErrorResponse(
        "Presented guest capability is invalid, expired, revoked, consumed, or has no active cart."
      ),
      "500": storeErrorResponse(
        "Session, customer, capability, or cart workflow failure."
      ),
      "503": storeErrorResponse(
        "Customer authentication authority is temporarily unavailable."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      `${CART_M1_SOURCE_ROOT}/active/route.ts`,
      `${CART_M1_SOURCE_ROOT}/serializers.ts`,
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      `${CART_M1_TEST_ROOT}/cart-checkout-store.spec.ts`,
      `${CART_M1_TEST_ROOT}/guest-cart-active.spec.ts`,
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/carts/active/route.ts",
    inclusionReason:
      "Project-owned active-cart create/reuse mutation used by checkout, with guest capability minting only on a new guest cart.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registerLineItemOperation(registry, {
    method: "POST",
    path: "/store/carts/{id}/line-items",
    operationId: "addCartLineItem",
    summary: "Add a line item to a Store cart",
    sourceFile: "[id]/line-items/route.ts",
    testFile: "guest-cart-line-item-add.spec.ts",
    lineId: false,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/StoreAddCartLineItemRequest",
          },
        },
      },
    },
    inclusionReason:
      "Phase 15 guest/customer Cart M1 add wrapper with capability, idempotency, If-Match and CAS contracts.",
  })

  registerLineItemOperation(registry, {
    method: "POST",
    path: "/store/carts/{id}/line-items/{line_id}",
    operationId: "updateCartLineItem",
    summary: "Update a Store cart line item",
    sourceFile: "[id]/line-items/[line_id]/route.ts",
    testFile: "guest-cart-line-item-update.spec.ts",
    lineId: true,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/StoreUpdateCartLineItemRequest",
          },
        },
      },
    },
    inclusionReason:
      "Phase 15 guest/customer Cart M1 update wrapper with quantity-zero removal, capability, idempotency, If-Match and CAS contracts.",
  })

  registerLineItemOperation(registry, {
    method: "DELETE",
    path: "/store/carts/{id}/line-items/{line_id}",
    operationId: "removeCartLineItem",
    summary: "Remove a line item from a Store cart",
    sourceFile: "[id]/line-items/[line_id]/route.ts",
    testFile: "guest-cart-line-item-delete.spec.ts",
    lineId: true,
    requestBody: null,
    inclusionReason:
      "Phase 15 guest/customer Cart M1 delete wrapper with capability, idempotency, If-Match and CAS contracts.",
  })

  registerLineItemOperation(registry, {
    method: "DELETE",
    path: "/store/carts/{id}/line-items",
    operationId: "clearCartLineItems",
    summary: "Clear all line items from a Store cart",
    sourceFile: "[id]/line-items/route.ts",
    testFile: "guest-cart-line-item-clear.spec.ts",
    lineId: false,
    requestBody: null,
    inclusionReason:
      "Phase 15 guest/customer Cart M1 clear-all wrapper with capability, idempotency, If-Match and CAS contracts.",
  })
}
