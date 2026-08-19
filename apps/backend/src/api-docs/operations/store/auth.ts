import {
  STORE_CORRELATION_ID_HEADER,
} from "../../components"
import { STORE_X_CORRELATION_ID_RESPONSE_HEADERS } from "../../components/headers"
import {
  STORE_AUTH_IDEMPOTENCY_KEY_REF,
  STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE,
  STORE_AUTH_REFRESH_HEADER_REF,
  STORE_AUTH_SECURITY_BY_REQUIREMENT,
} from "../../components/security-schemes"
import type { ContractRegistryBundle } from "../../registry"
import {
  STORE_AUTH_SCHEMA_CONTRACT,
  storeJsonResponse,
} from "./schemas"

const BFF_HOP_DESCRIPTION =
  "Browser traffic stays on the same-origin Next.js BFF. The BFF presents a service credential to Medusa. The browser is not an authorized Medusa client and must not call this operation directly."

const INCLUSION_REASON =
  "BFF/backend contract; browser must not call Medusa directly"

const GITHUB_BLOB =
  "https://github.com/jlima004/E-commerce/blob/main/"

type AuthOperationName = keyof typeof STORE_AUTH_SCHEMA_CONTRACT

type AuthOperationPresentation = {
  operationId: string
  summary: string
  tags: string[]
  sourceFiles: string[]
  testEvidence: string[]
  officialReference: string
  description?: string
}

function authRequestBody(schemaName: string | null, request: string) {
  if (request === "none" || schemaName === null) {
    return null
  }

  return {
    required: true as const,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
  }
}

function authParameters(
  auth: keyof typeof STORE_AUTH_SECURITY_BY_REQUIREMENT
) {
  const parameters: unknown[] = [STORE_CORRELATION_ID_HEADER]
  if (auth === "refresh_header_and_idempotency_key") {
    parameters.push(
      STORE_AUTH_REFRESH_HEADER_REF,
      STORE_AUTH_IDEMPOTENCY_KEY_REF
    )
  } else if (
    auth === "capability_and_idempotency_key" ||
    auth === "access_bearer_and_idempotency_key"
  ) {
    parameters.push(STORE_AUTH_IDEMPOTENCY_KEY_REF)
  }
  return parameters
}

function authErrorResponse(description: string) {
  return storeJsonResponse(description, "StoreAuthErrorResponse")
}

function authEmptySuccess(description: string) {
  return {
    description,
    headers: STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
  }
}

export function registerStoreAuthContractOperation(
  registry: ContractRegistryBundle,
  operation: AuthOperationName,
  presentation: AuthOperationPresentation
): void {
  const docs = STORE_AUTH_SCHEMA_CONTRACT[operation]
  const responses: Record<
    string,
    ReturnType<typeof storeJsonResponse> | ReturnType<typeof authEmptySuccess>
  > = {}

  const successKey = String(docs.success.status)
  if (docs.successSchemaName === null) {
    responses[successKey] = authEmptySuccess(
      docs.success.code
        ? `Completed with public code ${docs.success.code}. Empty body.`
        : "Completed with an empty body."
    )
  } else {
    responses[successKey] = storeJsonResponse(
      docs.success.code
        ? `Success with public code ${docs.success.code}. Server-to-server BFF material only.`
        : "Success. Server-to-server BFF material only.",
      docs.successSchemaName
    )
  }

  const failuresByStatus = new Map<number, (typeof docs.failures)[number][]>()
  for (const failure of docs.failures) {
    const [status] = failure
    const group = failuresByStatus.get(status) ?? []
    group.push(failure)
    failuresByStatus.set(status, group)
  }

  for (const [status, group] of failuresByStatus) {
    const retryAfter = group.some((failure) => {
      const detail = failure[2]
      return (
        detail != null &&
        "retryAfterSeconds" in detail &&
        detail.retryAfterSeconds === 60
      )
    })
    const codes = group.map((failure) => failure[1])
    const codeDescription =
      codes.length === 1
        ? `Public auth failure with code ${codes[0]}.`
        : `Public auth failure. Codes ${codes.join(" or ")}.`
    const description = retryAfter
      ? `${codeDescription} Retry-After is 60 seconds when AUTH_TEMPORARILY_UNAVAILABLE is returned at pre_lookup.`
      : codeDescription
    responses[String(status)] = authErrorResponse(description)
  }

  const description =
    docs.auth === "public_bff_no_session"
      ? `${BFF_HOP_DESCRIPTION} ${STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE}`
      : presentation.description ?? BFF_HOP_DESCRIPTION

  registry.registerOperation({
    surface: "store",
    method: docs.method,
    path: docs.path,
    operationId: presentation.operationId,
    summary: presentation.summary,
    description,
    tags: presentation.tags,
    security: [...STORE_AUTH_SECURITY_BY_REQUIREMENT[docs.auth]],
    parameters: authParameters(docs.auth),
    requestBody: authRequestBody(docs.requestSchemaName, docs.request),
    responses,
    sourceClassification: "project-custom",
    sourceFiles: presentation.sourceFiles,
    testEvidence: presentation.testEvidence,
    officialReference: presentation.officialReference,
    inclusionReason: INCLUSION_REASON,
    interactiveCandidate: false,
    nonInteractive: true,
  })
}

export function registerStoreAuthOperations(
  registry: ContractRegistryBundle
): void {
  registerStoreAuthContractOperation(registry, "signup", {
    operationId: "storeAuthRegisterCustomer",
    summary: "Register a customer with email and password",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/customer/emailpass/register/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-customer.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/customer/emailpass/register/route.ts`,
  })

  registerStoreAuthContractOperation(registry, "login", {
    operationId: "storeAuthLoginCustomer",
    summary: "Authenticate a customer with email and password",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/customer/emailpass/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-customer.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/customer/emailpass/route.ts`,
  })

  registerStoreAuthContractOperation(registry, "refresh", {
    operationId: "storeAuthRefreshToken",
    summary: "Rotate the BFF refresh capability",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/token/refresh/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-multiprocess.spec.ts",
      "apps/backend/integration-tests/http/auth-customer.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/token/refresh/route.ts`,
  })

  registerStoreAuthContractOperation(registry, "revoke_current_lineage", {
    operationId: "storeAuthRevokeCurrentLineage",
    summary: "Revoke the current BFF session",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-multiprocess.spec.ts",
      "apps/backend/integration-tests/http/auth-customer.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts`,
  })

  registerStoreAuthContractOperation(registry, "reset_request", {
    operationId: "storeAuthRequestPasswordReset",
    summary: "Accept a password-reset request",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/customer/emailpass/reset-password/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-reset.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/customer/emailpass/reset-password/route.ts`,
  })

  registerStoreAuthContractOperation(registry, "reset_confirm", {
    operationId: "storeAuthConfirmPasswordReset",
    summary: "Confirm a password reset with a one-time capability",
    tags: ["Auth"],
    sourceFiles: [
      "apps/backend/src/api/auth/customer/emailpass/update/route.ts",
      "apps/backend/src/api/middlewares.ts",
    ],
    testEvidence: [
      "apps/backend/integration-tests/http/auth-reset.spec.ts",
    ],
    officialReference: `${GITHUB_BLOB}apps/backend/src/api/auth/customer/emailpass/update/route.ts`,
  })
}
