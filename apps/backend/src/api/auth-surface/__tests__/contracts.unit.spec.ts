const loadContracts = () => require("../contracts")
const loadValidators = () => require("../validators")
const loadErrors = () => require("../errors")

describe("Phase 14 auth HTTP contract", () => {
  it("fixa exatamente as 12 operacoes BFF-to-backend", () => {
    const { AUTH_HTTP_CONTRACT } = loadContracts()

    expect(AUTH_HTTP_CONTRACT).toEqual([
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
        success: { status: 200, code: "AUTHENTICATED", body: "auth_session" },
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
        success: { status: 200, code: "AUTHENTICATED", body: "auth_session" },
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
        success: { status: 200, code: "PASSWORD_RESET_COMPLETED", body: "password_reset_result" },
        failures: [
          [400, "RESET_INVALID_OR_EXPIRED"],
          [429, "RATE_LIMITED"],
          [503, "AUTH_TEMPORARILY_UNAVAILABLE", { retryAfterSeconds: 60, stage: "pre_lookup" }],
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
    ])
  })

  it("usa envelopes de aceite byte-equivalentes", () => {
    const { REQUEST_ACCEPTED_RESPONSE, RESET_REQUEST_ACCEPTED_RESPONSE } =
      loadContracts()

    expect(JSON.stringify(REQUEST_ACCEPTED_RESPONSE)).toBe(
      JSON.stringify(RESET_REQUEST_ACCEPTED_RESPONSE)
    )
    expect(REQUEST_ACCEPTED_RESPONSE).toEqual({ code: "REQUEST_ACCEPTED" })
  })

  it("rejeita campos extras, limites e trim silencioso", () => {
    const {
      SignupRequestSchema,
      LoginRequestSchema,
      EmptyRequestSchema,
      VerificationTokenRequestSchema,
      ResetConfirmRequestSchema,
    } = loadValidators()

    expect(
      SignupRequestSchema.safeParse({
        email: "Pessoa@Example.test",
        password: "abcdefghijkl",
        firstName: "Pessoa",
        lastName: "Teste",
      }).data?.email
    ).toBe("Pessoa@Example.test")
    expect(LoginRequestSchema.safeParse({ email: "a@b.co", password: " short " }).success).toBe(false)
    expect(EmptyRequestSchema.safeParse({ unexpected: true }).success).toBe(false)
    expect(VerificationTokenRequestSchema.safeParse({ token: "x".repeat(42) }).success).toBe(false)
    expect(VerificationTokenRequestSchema.safeParse({ token: "x".repeat(513) }).success).toBe(false)
    expect(
      ResetConfirmRequestSchema.safeParse({
        token: "x".repeat(43),
        newPassword: "abcdefghijkl",
        provider: "emailpass",
      }).success
    ).toBe(false)
  })

  it("serializa sessao e current-state somente por allowlist", () => {
    const { serializeAuthSessionEnvelope, serializeCurrentAuthCustomer } =
      loadContracts()
    const source = {
      code: "AUTHENTICATED",
      accessToken: "synthetic-access-capability",
      accessExpiresAt: "2026-08-13T17:00:00.000Z",
      refreshToken: "synthetic-refresh-capability",
      refreshExpiresAt: "2026-08-20T17:00:00.000Z",
      originalAuthenticatedAt: "2026-08-13T16:00:00.000Z",
      absoluteExpiresAt: "2026-09-12T16:00:00.000Z",
      customer: {
        id: "cus_synthetic",
        email: "pessoa@example.test",
        firstName: "Pessoa",
        lastName: "Teste",
        metadata: { providerIdentityId: "forbidden" },
        password_hash: "forbidden",
      },
      verificationState: "pending",
      identityId: "forbidden",
      providerId: "forbidden",
      lineageId: "forbidden",
      credentialVersion: 7,
    }

    expect(serializeAuthSessionEnvelope(source, { bffAuthorized: false })).toBeNull()
    expect(serializeAuthSessionEnvelope(source, { bffAuthorized: true })).toEqual({
      code: "AUTHENTICATED",
      accessToken: "synthetic-access-capability",
      accessExpiresAt: "2026-08-13T17:00:00.000Z",
      refreshToken: "synthetic-refresh-capability",
      refreshExpiresAt: "2026-08-20T17:00:00.000Z",
      originalAuthenticatedAt: "2026-08-13T16:00:00.000Z",
      absoluteExpiresAt: "2026-09-12T16:00:00.000Z",
      customer: {
        id: "cus_synthetic",
        email: "pessoa@example.test",
        firstName: "Pessoa",
        lastName: "Teste",
      },
      verificationState: "pending",
    })
    expect(serializeCurrentAuthCustomer(source)).toEqual({
      customer: {
        id: "cus_synthetic",
        email: "pessoa@example.test",
        firstName: "Pessoa",
        lastName: "Teste",
      },
      auth: {
        verificationState: "pending",
        originalAuthenticatedAt: "2026-08-13T16:00:00.000Z",
        absoluteExpiresAt: "2026-09-12T16:00:00.000Z",
      },
    })
  })

  it("fecha erros internos e preserva a distincao dos dois 503 de reset", () => {
    const { toAuthErrorResponse } = loadErrors()

    expect(toAuthErrorResponse(new Error("provider identity db detail"), { correlationId: "corr-safe" })).toEqual({
      statusCode: 503,
      body: {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Authentication temporarily unavailable",
        retryable: true,
        correlationId: "corr-safe",
      },
    })
    expect(
      toAuthErrorResponse({ code: "RESET_INVALID_OR_EXPIRED", token: "must-not-echo" }, { correlationId: "corr-safe" })
    ).toEqual({
      statusCode: 400,
      body: {
        code: "RESET_INVALID_OR_EXPIRED",
        message: "Reset capability is invalid or expired",
        retryable: false,
        correlationId: "corr-safe",
      },
    })
    expect(
      toAuthErrorResponse({ code: "AUTH_TEMPORARILY_UNAVAILABLE", stage: "pre_lookup" }, { correlationId: "corr-safe", resetConfirm: true })
    ).toEqual({
      statusCode: 503,
      retryAfterSeconds: 60,
      body: {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Authentication temporarily unavailable",
        retryable: true,
        correlationId: "corr-safe",
      },
    })
    expect(
      toAuthErrorResponse({ code: "AUTH_RECOVERY_PENDING", stage: "correlated_recovery" }, { correlationId: "corr-safe", resetConfirm: true })
    ).toEqual({
      statusCode: 503,
      body: {
        code: "AUTH_RECOVERY_PENDING",
        message: "Authentication recovery is pending",
        retryable: true,
        correlationId: "corr-safe",
      },
    })
  })
})
