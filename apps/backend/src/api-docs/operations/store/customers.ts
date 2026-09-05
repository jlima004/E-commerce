import type { ContractRegistryBundle } from "../../registry"
import { registerStoreAuthContractOperation } from "./auth"

/**
 * Store customer operations registry.
 *
 * POST /store/customers/me/cart/attach is intentionally NOT registered as a
 * public/executable Store OpenAPI operation: excluded deprecated compatibility
 * facade (OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY), not M1; removal requires a
 * future explicit HUMAN GATE. Handler + attach schemas remain as internal/
 * domain support knowledge; see ROUTE_EXCLUSIONS.
 */
export function registerStoreCustomerOperations(
  registry: ContractRegistryBundle
): void {
  registerStoreAuthContractOperation(registry, "current_auth_customer", {
    operationId: "storeCustomersGetMe",
    summary: "Get the current authenticated customer",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/me/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-customer.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/me/route.ts",
  })

  registerStoreAuthContractOperation(registry, "verification_request", {
    operationId: "storeCustomersRequestVerification",
    summary: "Request email verification for the current customer",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/me/verify/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-verification.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/me/verify/route.ts",
  })

  registerStoreAuthContractOperation(registry, "verification_resend", {
    operationId: "storeCustomersResendVerification",
    summary: "Resend email verification",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/verify/resend/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-verification.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/verify/resend/route.ts",
  })

  registerStoreAuthContractOperation(registry, "verification_confirm", {
    operationId: "storeCustomersConfirmVerification",
    summary: "Confirm email verification with a one-time capability",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/verify/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-verification.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/verify/route.ts",
  })

  registerStoreAuthContractOperation(registry, "verification_status", {
    operationId: "storeCustomersGetVerificationStatus",
    summary: "Get email verification status for the current customer",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/me/verify/status/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-verification.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/me/verify/status/route.ts",
  })

  registerStoreAuthContractOperation(registry, "password_change", {
    operationId: "storeCustomersChangePassword",
    summary: "Change the current customer password",
    tags: ["Customer"],
    sourceFiles: [
      "apps/backend/src/api/store/customers/me/password/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-password-change.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/store/customers/me/password/route.ts",
  })
}
