import { createHmac } from "node:crypto"

export const AUTH_TEST_HARNESS_FORBIDDEN = "AUTH_TEST_HARNESS_FORBIDDEN"

export const AUTH_PROVIDER_OUTCOMES = [
  "success",
  "timeout",
  "5xx",
  "ambiguous",
] as const

export type AuthProviderKind = "emailpass" | "resend"
export type AuthProviderOutcome = (typeof AUTH_PROVIDER_OUTCOMES)[number]

export type AuthProviderMockInput = {
  provider: AuthProviderKind
  seed: string
  outcome: AuthProviderOutcome
}

export type AuthProviderMockResponse = {
  provider: AuthProviderKind
  outcome: AuthProviderOutcome
  ok: boolean
  statusCode: number | null
  retryable: boolean
  ambiguous: boolean
  errorCode: string | null
  mockRequestId: string
}

export type AuthProviderMock = {
  invoke(): AuthProviderMockResponse
}

type AuthTestHarnessError = Error & { code: string }

function assertAuthTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(AUTH_TEST_HARNESS_FORBIDDEN) as AuthTestHarnessError
    error.code = AUTH_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertAuthTestHarnessAllowed()

function deriveMockRequestId(input: AuthProviderMockInput): string {
  return createHmac("sha256", input.seed)
    .update(`auth-provider-mock:${input.provider}:${input.outcome}`)
    .digest("hex")
}

function buildOutcomeResponse(
  input: AuthProviderMockInput
): AuthProviderMockResponse {
  const mockRequestId = deriveMockRequestId(input)

  if (input.outcome === "success") {
    return {
      provider: input.provider,
      outcome: "success",
      ok: true,
      statusCode: 200,
      retryable: false,
      ambiguous: false,
      errorCode: null,
      mockRequestId,
    }
  }

  if (input.outcome === "timeout") {
    return {
      provider: input.provider,
      outcome: "timeout",
      ok: false,
      statusCode: null,
      retryable: true,
      ambiguous: false,
      errorCode: "AUTH_PROVIDER_TIMEOUT",
      mockRequestId,
    }
  }

  if (input.outcome === "5xx") {
    return {
      provider: input.provider,
      outcome: "5xx",
      ok: false,
      statusCode: 503,
      retryable: true,
      ambiguous: false,
      errorCode: "AUTH_PROVIDER_5XX",
      mockRequestId,
    }
  }

  return {
    provider: input.provider,
    outcome: "ambiguous",
    ok: false,
    statusCode: null,
    retryable: true,
    ambiguous: true,
    errorCode: "AUTH_PROVIDER_AMBIGUOUS",
    mockRequestId,
  }
}

export function createAuthProviderMock(
  input: AuthProviderMockInput
): AuthProviderMock {
  const response = buildOutcomeResponse(input)

  return {
    invoke(): AuthProviderMockResponse {
      return { ...response }
    },
  }
}

export function createEmailpassAuthProviderMock(
  input: Omit<AuthProviderMockInput, "provider">
): AuthProviderMock {
  return createAuthProviderMock({ ...input, provider: "emailpass" })
}

export function createResendAuthProviderMock(
  input: Omit<AuthProviderMockInput, "provider">
): AuthProviderMock {
  return createAuthProviderMock({ ...input, provider: "resend" })
}
