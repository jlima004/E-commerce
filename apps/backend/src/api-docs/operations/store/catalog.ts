import {
  CORRELATION_ID_HEADER,
  STORE_OPTIONAL_CUSTOMER,
  STORE_PRODUCT_ID_PATH,
  storeErrorResponse,
} from "../../components"
import {
  STORE_PRODUCT_LIST_QUERY,
  STORE_PRODUCT_RETRIEVE_QUERY,
} from "../../components/parameters"
import { NATIVE_EXTENSIONS } from "../../coverage/native-routes"
import type { ContractRegistryBundle } from "../../registry"
import { storeJsonResponse } from "./schemas"

function storeNative(path: string) {
  const entry = NATIVE_EXTENSIONS.find(
    (item) => item.surface === "store" && item.path === path
  )
  if (!entry) {
    throw new Error(`Missing Store native extension entry for ${path}`)
  }
  return entry
}

export function registerStoreCatalogOperations(
  registry: ContractRegistryBundle
): void {
  const list = storeNative("/store/products")
  const retrieve = storeNative("/store/products/{id}")

  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/store/products",
    operationId: "storeProductsList",
    summary: "List sellable Store catalog products",
    tags: ["Catalog"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [CORRELATION_ID_HEADER, ...STORE_PRODUCT_LIST_QUERY],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Sellable products with the public Store catalog serializer applied.",
        "StoreProductsListResponse"
      ),
      "400": storeErrorResponse("Native query validation failure."),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "500": storeErrorResponse("Upstream or framework failure."),
    },
    sourceClassification: "project-extension",
    sourceFiles: list.evidenceFiles,
    testEvidence: [
      "apps/backend/integration-tests/http/catalog-store.spec.ts",
    ],
    officialReference: list.officialReference,
    inclusionReason: list.inclusionReason,
    interactiveCandidate: true,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "store",
    method: "GET",
    path: "/store/products/{id}",
    operationId: "storeProductsRetrieve",
    summary: "Retrieve a sellable Store catalog product",
    tags: ["Catalog"],
    security: [...STORE_OPTIONAL_CUSTOMER],
    parameters: [
      CORRELATION_ID_HEADER,
      STORE_PRODUCT_ID_PATH,
      ...STORE_PRODUCT_RETRIEVE_QUERY,
    ],
    requestBody: null,
    responses: {
      "200": storeJsonResponse(
        "Sellable product with the public Store catalog serializer applied.",
        "StoreProductResponse"
      ),
      "400": storeErrorResponse("Native query validation failure."),
      "401": storeErrorResponse(
        "Missing or invalid publishable API key."
      ),
      "404": storeErrorResponse(
        "Product not found, or product has no sellable variant after project serialization."
      ),
      "500": storeErrorResponse("Upstream or framework failure."),
    },
    sourceClassification: "project-extension",
    sourceFiles: retrieve.evidenceFiles,
    testEvidence: [
      "apps/backend/integration-tests/http/catalog-store.spec.ts",
    ],
    officialReference: retrieve.officialReference,
    inclusionReason: retrieve.inclusionReason,
    interactiveCandidate: true,
    nonInteractive: true,
  })
}
