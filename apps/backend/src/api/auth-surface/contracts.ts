export type AuthVerificationState = "pending" | "verified"

export type AuthCustomer = {
  id: string
  email: string
  firstName: string
  lastName: string
}

export type AuthSessionEnvelope = {
  accessToken: string
  accessExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
  originalAuthenticatedAt: string
  absoluteExpiresAt: string
  customer: AuthCustomer
  verificationState: AuthVerificationState
}

export type AuthErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUEST_REJECTED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "VERIFICATION_INVALID_OR_EXPIRED"
  | "RESET_INVALID_OR_EXPIRED"
  | "CURRENT_CREDENTIAL_INVALID"
  | "RATE_LIMITED"
  | "AUTH_TEMPORARILY_UNAVAILABLE"
  | "AUTH_RECOVERY_PENDING"

export type AuthErrorResponse = {
  code: AuthErrorCode
  message: string
  retryable: boolean
  correlationId: string
}

export const REQUEST_ACCEPTED_RESPONSE = Object.freeze({
  code: "REQUEST_ACCEPTED" as const,
})

/** Same public bytes by design: reset request and verification resend are uniform. */
export const RESET_REQUEST_ACCEPTED_RESPONSE = REQUEST_ACCEPTED_RESPONSE

type AuthMethod = "GET" | "POST"
type AuthRequirement =
  | "public_bff"
  | "public_bff_no_session"
  | "access_bearer"
  | "refresh_header_and_idempotency_key"
  | "capability_and_idempotency_key"
  | "access_bearer_and_idempotency_key"
type RequestShape =
  | "none"
  | "empty"
  | "signup"
  | "login"
  | "email"
  | "verification_token"
  | "reset_confirm"
  | "password_change"
type ResponseShape =
  | "auth_session"
  | "empty"
  | "request_accepted"
  | "verification_result"
  | "verification_status"
  | "password_reset_result"
  | "current_auth_customer"

type Failure = readonly [
  status: 400 | 401 | 403 | 409 | 429 | 503,
  code: AuthErrorCode,
  detail?: Readonly<{
    retryAfterSeconds?: 60
    stage?: "pre_lookup" | "correlated_recovery"
  }>,
]

export type AuthHttpContractEntry = Readonly<{
  operation: string
  method: AuthMethod
  path: string
  auth: AuthRequirement
  request: RequestShape
  success: Readonly<{
    status: 200 | 201 | 202 | 204
    code:
      | "AUTHENTICATED"
      | "REQUEST_ACCEPTED"
      | "EMAIL_VERIFIED"
      | "PASSWORD_RESET_COMPLETED"
      | null
    body: ResponseShape
  }>
  failures: readonly Failure[]
  sensitive: readonly string[]
}>

export const AUTH_HTTP_CONTRACT = [
  {
    operation: "signup",
    method: "POST",
    path: "/auth/customer/emailpass/register",
    auth: "public_bff",
    request: "signup",
    success: { status: 201, code: "AUTHENTICATED", body: "auth_session" },
    failures: [
      [400, "INVALID_REQUEST"],
      [409, "AUTH_REQUEST_REJECTED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: ["password", "accessToken", "refreshToken"],
  },
  {
    operation: "login",
    method: "POST",
    path: "/auth/customer/emailpass",
    auth: "public_bff",
    request: "login",
    success: { status: 200, code: null, body: "auth_session" },
    failures: [
      [400, "INVALID_REQUEST"],
      [401, "INVALID_CREDENTIALS"],
      [403, "EMAIL_VERIFICATION_REQUIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: ["password", "accessToken", "refreshToken"],
  },
  {
    operation: "refresh",
    method: "POST",
    path: "/auth/token/refresh",
    auth: "refresh_header_and_idempotency_key",
    request: "empty",
    success: { status: 200, code: null, body: "auth_session" },
    failures: [
      [400, "INVALID_REQUEST"],
      [401, "AUTHENTICATION_REQUIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: ["x-indicio-refresh-token", "accessToken", "refreshToken"],
  },
  {
    operation: "revoke_current_lineage",
    method: "POST",
    path: "/auth/customer/emailpass/revoke-current-lineage",
    auth: "access_bearer",
    request: "empty",
    success: { status: 204, code: null, body: "empty" },
    failures: [
      [401, "AUTHENTICATION_REQUIRED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: [],
  },
  {
    operation: "verification_request",
    method: "POST",
    path: "/store/customers/me/verify",
    auth: "access_bearer",
    request: "empty",
    success: { status: 202, code: "REQUEST_ACCEPTED", body: "request_accepted" },
    failures: [
      [401, "AUTHENTICATION_REQUIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: [],
  },
  {
    operation: "verification_resend",
    method: "POST",
    path: "/store/customers/verify/resend",
    auth: "public_bff",
    request: "email",
    success: { status: 202, code: "REQUEST_ACCEPTED", body: "request_accepted" },
    failures: [[400, "INVALID_REQUEST"]],
    sensitive: [],
  },
  {
    operation: "verification_confirm",
    method: "POST",
    path: "/store/customers/verify",
    auth: "public_bff_no_session",
    request: "verification_token",
    success: { status: 200, code: "EMAIL_VERIFIED", body: "verification_result" },
    failures: [
      [400, "VERIFICATION_INVALID_OR_EXPIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: ["token"],
  },
  {
    operation: "verification_status",
    method: "GET",
    path: "/store/customers/me/verify/status",
    auth: "access_bearer",
    request: "none",
    success: { status: 200, code: null, body: "verification_status" },
    failures: [
      [401, "AUTHENTICATION_REQUIRED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: [],
  },
  {
    operation: "reset_request",
    method: "POST",
    path: "/auth/customer/emailpass/reset-password",
    auth: "public_bff",
    request: "email",
    success: { status: 202, code: "REQUEST_ACCEPTED", body: "request_accepted" },
    failures: [[400, "INVALID_REQUEST"]],
    sensitive: [],
  },
  {
    operation: "reset_confirm",
    method: "POST",
    path: "/auth/customer/emailpass/update",
    auth: "capability_and_idempotency_key",
    request: "reset_confirm",
    success: {
      status: 200,
      code: "PASSWORD_RESET_COMPLETED",
      body: "password_reset_result",
    },
    failures: [
      [400, "RESET_INVALID_OR_EXPIRED"],
      [429, "RATE_LIMITED"],
      [
        503,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        { retryAfterSeconds: 60, stage: "pre_lookup" },
      ],
      [503, "AUTH_RECOVERY_PENDING", { stage: "correlated_recovery" }],
    ],
    sensitive: ["token", "newPassword"],
  },
  {
    operation: "password_change",
    method: "POST",
    path: "/store/customers/me/password",
    auth: "access_bearer_and_idempotency_key",
    request: "password_change",
    success: { status: 204, code: null, body: "empty" },
    failures: [
      [400, "CURRENT_CREDENTIAL_INVALID"],
      [401, "AUTHENTICATION_REQUIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_RECOVERY_PENDING"],
    ],
    sensitive: ["currentPassword", "newPassword"],
  },
  {
    operation: "current_auth_customer",
    method: "GET",
    path: "/store/customers/me",
    auth: "access_bearer",
    request: "none",
    success: { status: 200, code: null, body: "current_auth_customer" },
    failures: [
      [401, "AUTHENTICATION_REQUIRED"],
      [503, "AUTH_TEMPORARILY_UNAVAILABLE"],
    ],
    sensitive: [],
  },
] as const satisfies readonly AuthHttpContractEntry[]

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === "string" ? value : ""
}

function serializeCustomer(value: unknown): AuthCustomer {
  const customer =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    id: readString(customer, "id"),
    email: readString(customer, "email"),
    firstName: readString(customer, "firstName"),
    lastName: readString(customer, "lastName"),
  }
}

function readVerificationState(value: unknown): AuthVerificationState {
  return value === "verified" ? "verified" : "pending"
}

export function serializeAuthSessionEnvelope(
  value: Record<string, unknown>,
  options: { bffAuthorized: boolean }
): AuthSessionEnvelope | null {
  if (!options.bffAuthorized) {
    return null
  }
  return {
    accessToken: readString(value, "accessToken"),
    accessExpiresAt: readString(value, "accessExpiresAt"),
    refreshToken: readString(value, "refreshToken"),
    refreshExpiresAt: readString(value, "refreshExpiresAt"),
    originalAuthenticatedAt: readString(value, "originalAuthenticatedAt"),
    absoluteExpiresAt: readString(value, "absoluteExpiresAt"),
    customer: serializeCustomer(value.customer),
    verificationState: readVerificationState(value.verificationState),
  }
}

export type CurrentAuthCustomer = {
  customer: AuthCustomer
  auth: {
    verificationState: AuthVerificationState
    originalAuthenticatedAt: string
    absoluteExpiresAt: string
  }
}

export function serializeCurrentAuthCustomer(
  value: Record<string, unknown>
): CurrentAuthCustomer {
  return {
    customer: serializeCustomer(value.customer),
    auth: {
      verificationState: readVerificationState(value.verificationState),
      originalAuthenticatedAt: readString(value, "originalAuthenticatedAt"),
      absoluteExpiresAt: readString(value, "absoluteExpiresAt"),
    },
  }
}
