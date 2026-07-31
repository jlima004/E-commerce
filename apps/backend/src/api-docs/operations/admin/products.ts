import {
  ADMIN_NATIVE_SECURITY,
  ADMIN_PRODUCT_FIELDS_QUERY,
  ADMIN_PRODUCT_ID_PATH,
  ADMIN_VARIANT_ID_PATH,
  CORRELATION_ID_HEADER,
  adminErrorResponse,
  adminUnauthorizedResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { adminJsonResponse } from "./schemas"

const sourceFiles = [
  "apps/backend/src/api/middlewares.ts",
  "apps/backend/src/api/admin/products/sellable-gate-middleware.ts",
  "apps/backend/src/api/admin/products/validators.ts",
]
const testEvidence = [
  "apps/backend/integration-tests/http/catalog-admin.spec.ts",
]

function productResponses(includeNotFound: boolean) {
  return {
    "200": adminJsonResponse(
      "Native Medusa Admin product response after the project sellable gate.",
      "AdminProductResponse"
    ),
    "400": adminErrorResponse(
      "Native validation or project sellable-gate rejection. Draft incompleteness remains allowed; published products and variants must satisfy the local sellability contract."
    ),
    "401": adminUnauthorizedResponse(),
    ...(includeNotFound
      ? { "404": adminErrorResponse("Product or variant was not found.") }
      : {}),
    "500": adminErrorResponse(
      "Early body-parser failure or later workflow/handler failure. Correlation header presence is not guaranteed for this mixed response.",
      false
    ),
  }
}

export function registerAdminProductOperations(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/products",
    operationId: "adminProductsCreate",
    summary: "Create an Admin product",
    description:
      "Extends the native Medusa 2.16.0 create operation with the project sellable-product gate. Incomplete drafts remain valid; publication requires a sellable variant, Gelato metadata, and a positive BRL price.",
    tags: ["Products"],
    security: [...ADMIN_NATIVE_SECURITY],
    parameters: [CORRELATION_ID_HEADER, ADMIN_PRODUCT_FIELDS_QUERY],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminProductCreateRequest" },
        },
      },
    },
    responses: productResponses(false),
    sourceClassification: "project-extension",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/route.ts",
    inclusionReason:
      "Project middleware changes the observable Medusa 2.16.0 contract.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}",
    operationId: "adminProductsUpdate",
    summary: "Update an Admin product",
    description:
      "Extends the native Medusa 2.16.0 update operation by validating the resulting product against the project sellable-product gate when it is published.",
    tags: ["Products"],
    security: [...ADMIN_NATIVE_SECURITY],
    parameters: [
      CORRELATION_ID_HEADER,
      ADMIN_PRODUCT_ID_PATH,
      ADMIN_PRODUCT_FIELDS_QUERY,
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminProductUpdateRequest" },
        },
      },
    },
    responses: productResponses(true),
    sourceClassification: "project-extension",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/route.ts",
    inclusionReason:
      "Project middleware changes the observable Medusa 2.16.0 contract.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}/variants",
    operationId: "adminProductVariantsCreate",
    summary: "Create an Admin product variant",
    description:
      "Extends the native Medusa 2.16.0 variant-create operation with the project sellable-variant gate. No operation-specific HTTP coverage is claimed beyond the recorded validator/module evidence.",
    tags: ["Products"],
    security: [...ADMIN_NATIVE_SECURITY],
    parameters: [
      CORRELATION_ID_HEADER,
      ADMIN_PRODUCT_ID_PATH,
      ADMIN_PRODUCT_FIELDS_QUERY,
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminProductVariantCreateRequest" },
        },
      },
    },
    responses: productResponses(true),
    sourceClassification: "project-extension",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/variants/route.ts",
    inclusionReason:
      "Project middleware changes the observable Medusa 2.16.0 contract.",
    interactiveCandidate: false,
    nonInteractive: true,
  })

  registry.registerOperation({
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}/variants/{variant_id}",
    operationId: "adminProductVariantsUpdate",
    summary: "Update an Admin product variant",
    description:
      "Extends the native Medusa 2.16.0 variant-update operation with the project sellable-variant gate. No operation-specific HTTP coverage is claimed beyond the recorded validator/module evidence.",
    tags: ["Products"],
    security: [...ADMIN_NATIVE_SECURITY],
    parameters: [
      CORRELATION_ID_HEADER,
      ADMIN_PRODUCT_ID_PATH,
      ADMIN_VARIANT_ID_PATH,
      ADMIN_PRODUCT_FIELDS_QUERY,
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AdminProductVariantUpdateRequest" },
        },
      },
    },
    responses: productResponses(true),
    sourceClassification: "project-extension",
    sourceFiles,
    testEvidence,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/variants/%5Bvariant_id%5D/route.ts",
    inclusionReason:
      "Project middleware changes the observable Medusa 2.16.0 contract.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
