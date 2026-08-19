import { randomUUID } from "crypto"
import type { AuthErrorCode, AuthErrorResponse } from "./contracts"

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

const ERROR_DEFINITIONS: Record<
  AuthErrorCode,
  { statusCode: 400 | 401 | 403 | 409 | 429 | 503; message: string; retryable: boolean }
> = {
  INVALID_REQUEST: { statusCode: 400, message: "Invalid request", retryable: false },
  AUTH_REQUEST_REJECTED: {
    statusCode: 409,
    message: "Authentication request rejected",
    retryable: false,
  },
  INVALID_CREDENTIALS: {
    statusCode: 401,
    message: "Invalid credentials",
    retryable: false,
  },
  EMAIL_VERIFICATION_REQUIRED: {
    statusCode: 403,
    message: "Email verification required",
    retryable: false,
  },
  AUTHENTICATION_REQUIRED: {
    statusCode: 401,
    message: "Authentication required",
    retryable: false,
  },
  VERIFICATION_INVALID_OR_EXPIRED: {
    statusCode: 400,
    message: "Verification capability is invalid or expired",
    retryable: false,
  },
  RESET_INVALID_OR_EXPIRED: {
    statusCode: 400,
    message: "Reset capability is invalid or expired",
    retryable: false,
  },
  CURRENT_CREDENTIAL_INVALID: {
    statusCode: 400,
    message: "Current credential is invalid",
    retryable: false,
  },
  RATE_LIMITED: {
    statusCode: 429,
    message: "Too many requests",
    retryable: true,
  },
  AUTH_TEMPORARILY_UNAVAILABLE: {
    statusCode: 503,
    message: "Authentication temporarily unavailable",
    retryable: true,
  },
  AUTH_RECOVERY_PENDING: {
    statusCode: 503,
    message: "Authentication recovery is pending",
    retryable: true,
  },
}

const ERROR_CODE_SET = new Set<string>(Object.keys(ERROR_DEFINITIONS))

type AuthErrorLike = { code?: unknown; stage?: unknown }

export type AuthErrorNormalizationResult = {
  statusCode: number
  body: AuthErrorResponse
  retryAfterSeconds?: 60
}

function sanitizeCorrelationId(value: unknown): string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value)
    ? value
    : randomUUID()
}

function readError(value: unknown): AuthErrorLike {
  return typeof value === "object" && value !== null
    ? (value as AuthErrorLike)
    : {}
}

function resolveCode(error: AuthErrorLike): AuthErrorCode {
  return typeof error.code === "string" && ERROR_CODE_SET.has(error.code)
    ? (error.code as AuthErrorCode)
    : "AUTH_TEMPORARILY_UNAVAILABLE"
}

/**
 * Rebuilds public errors from the closed catalog. Raw provider, identity, DB,
 * capability and stack fields are never copied into the response.
 */
export function toAuthErrorResponse(
  value: unknown,
  options: { correlationId?: unknown; resetConfirm?: boolean } = {}
): AuthErrorNormalizationResult {
  const error = readError(value)
  const code = resolveCode(error)

  if (options.resetConfirm) {
    if (
      typeof error.code !== "string" ||
      !ERROR_CODE_SET.has(error.code)
    ) {
      throw new Error("Invalid reset-confirm error classification")
    }
    if (
      (code === "AUTH_TEMPORARILY_UNAVAILABLE" &&
        error.stage !== "pre_lookup") ||
      (code === "AUTH_RECOVERY_PENDING" &&
        error.stage !== "correlated_recovery")
    ) {
      throw new Error("Invalid reset-confirm error classification")
    }
  }

  const definition = ERROR_DEFINITIONS[code]
  const result: AuthErrorNormalizationResult = {
    statusCode: definition.statusCode,
    body: {
      code,
      message: definition.message,
      retryable: definition.retryable,
      correlationId: sanitizeCorrelationId(options.correlationId),
    },
  }

  if (
    options.resetConfirm &&
    code === "AUTH_TEMPORARILY_UNAVAILABLE" &&
    error.stage === "pre_lookup"
  ) {
    result.retryAfterSeconds = 60
  }

  return result
}
