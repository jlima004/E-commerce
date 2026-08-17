import { createHash, timingSafeEqual } from "node:crypto"

export const CUSTOMER_AUTH_BFF_AUTH_HEADER = "x-indicio-bff-auth" as const

export const CUSTOMER_AUTH_BFF_SERVICE_SECRET_MIN_LENGTH = 32 as const

/**
 * Exact Phase 14 BFF→Medusa contracts protected by the service credential.
 * This list is closed: do not derive authorization from prefix matching.
 */
export const CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS = [
  "POST /auth/customer/emailpass/register",
  "POST /auth/customer/emailpass",
  "POST /auth/token/refresh",
  "POST /auth/customer/emailpass/revoke-current-lineage",
  "GET /store/customers/me",
  "POST /store/customers/me/verify",
  "POST /store/customers/verify/resend",
  "POST /store/customers/verify",
  "GET /store/customers/me/verify/status",
] as const

export type CustomerAuthBffProtectedOperation =
  (typeof CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS)[number]

export type BffServiceAuthDecision =
  | { outcome: "authorized" }
  | { outcome: "denied" }
  | { outcome: "unavailable" }

export type AuthenticateBffServiceRequestInput = {
  expectedSecret: unknown
  headerValue: unknown
}

const PLACEHOLDER_SECRETS = new Set([
  "supersecret",
  "changeme",
  "your-secret",
  "jwt_secret",
  "cookie_secret",
  "secret",
  "password",
])

export function isCustomerAuthBffServiceSecretConfigured(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.length >= CUSTOMER_AUTH_BFF_SERVICE_SECRET_MIN_LENGTH &&
    !PLACEHOLDER_SECRETS.has(value.toLowerCase())
  )
}

export function parseCustomerAuthBffServiceSecret(
  value: string | undefined,
  options: { required: boolean }
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    if (options.required) {
      throw new Error("Missing required variable: CUSTOMER_AUTH_BFF_SERVICE_SECRET")
    }
    return undefined
  }

  const normalized = trimmed.toLowerCase()
  if (
    trimmed.length < CUSTOMER_AUTH_BFF_SERVICE_SECRET_MIN_LENGTH ||
    PLACEHOLDER_SECRETS.has(normalized)
  ) {
    if (PLACEHOLDER_SECRETS.has(normalized)) {
      throw new Error(
        "Invalid CUSTOMER_AUTH_BFF_SERVICE_SECRET: placeholder values are not allowed"
      )
    }
    throw new Error(
      "Invalid CUSTOMER_AUTH_BFF_SERVICE_SECRET: must be at least 32 characters"
    )
  }

  return trimmed
}

function readSingleHeaderValue(value: unknown): string | null {
  if (Array.isArray(value) || typeof value !== "string" || value.includes(",")) {
    return null
  }

  return value
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest()
}

function secretsMatch(expectedSecret: string, receivedSecret: string): boolean {
  const expectedDigest = digestSecret(expectedSecret)
  const receivedDigest = digestSecret(receivedSecret)
  if (expectedDigest.length !== receivedDigest.length) {
    return false
  }
  return timingSafeEqual(expectedDigest, receivedDigest)
}

export function authenticateBffServiceRequest(
  input: AuthenticateBffServiceRequestInput
): BffServiceAuthDecision {
  if (!isCustomerAuthBffServiceSecretConfigured(input.expectedSecret)) {
    return { outcome: "unavailable" }
  }

  const presented = readSingleHeaderValue(input.headerValue)
  if (!presented) {
    return { outcome: "denied" }
  }

  if (!secretsMatch(input.expectedSecret, presented)) {
    return { outcome: "denied" }
  }

  return { outcome: "authorized" }
}
