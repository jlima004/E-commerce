/**
 * Store-only public error contract (FND-03 / D13-08..D13-12).
 *
 * Envelope is allowlist-first. message is presentation only.
 * Never derive public fields from raw provider/DB/stack detail.
 */

import { randomUUID } from "crypto"
import { MedusaError } from "@medusajs/utils"

export const STORE_CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

export const STORE_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
  DOMAIN_ERROR: "DOMAIN_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const

export type StoreErrorCode =
  (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES]

/**
 * Public request-field names eligible for fieldErrors.
 * Non-allowlisted keys are dropped — never echoed from raw validators.
 */
export const STORE_PUBLIC_FIELD_ALLOWLIST = new Set<string>([
  "email",
  "password",
  "phone",
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "country_code",
  "province",
  "postal_code",
  "shipping_address",
  "billing_address",
  "items",
  "quantity",
  "variant_id",
  "product_id",
  "region_id",
  "cart_id",
  "token",
  "order_id",
])

export type StoreErrorResponse = {
  code: StoreErrorCode | string
  message: string
  retryable: boolean
  correlationId?: string
  fieldErrors?: Record<string, string>
  /** Optional safe snapshot only; concrete Cart contract is Phase 15. */
  cart?: Record<string, unknown>
}

export type StoreErrorNormalizationResult = {
  statusCode: number
  body: StoreErrorResponse
  retryAfterSeconds?: number
}

export type ToStoreErrorResponseOptions = {
  correlationId?: unknown
  fieldErrors?: Record<string, unknown>
  /** Only attach when caller already has a safe allowlisted snapshot. */
  cart?: Record<string, unknown>
}

type ErrorLike = {
  type?: unknown
  name?: unknown
  message?: unknown
  code?: unknown
  statusCode?: unknown
  status?: unknown
  integration?: unknown
  providerUnavailable?: unknown
  uncertainSideEffect?: unknown
  retryAfterSeconds?: unknown
  retryable?: unknown
}

const SAFE_MESSAGES: Record<StoreErrorCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  UNAUTHORIZED: "Authentication required",
  NOT_FOUND: "Not Found",
  CONFLICT: "Conflict",
  PRECONDITION_FAILED: "Precondition Failed",
  DOMAIN_ERROR: "Request could not be processed",
  RATE_LIMITED: "Too Many Requests",
  INTERNAL_ERROR: "Internal Server Error",
  SERVICE_UNAVAILABLE: "Service Unavailable",
}

function asRecord(value: unknown): ErrorLike {
  if (typeof value === "object" && value !== null) {
    return value as ErrorLike
  }
  return { message: value }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function sanitizeStoreCorrelationId(value: unknown): string {
  if (typeof value === "string" && STORE_CORRELATION_ID_PATTERN.test(value)) {
    return value
  }

  if (Array.isArray(value)) {
    const candidate = value.find(
      (entry) =>
        typeof entry === "string" && STORE_CORRELATION_ID_PATTERN.test(entry)
    )
    if (typeof candidate === "string") {
      return candidate
    }
  }

  return randomUUID()
}

export function filterStoreFieldErrors(
  fieldErrors: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return undefined
  }

  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (!STORE_PUBLIC_FIELD_ALLOWLIST.has(key)) {
      continue
    }
    if (typeof value !== "string") {
      continue
    }
    // Presentation only — never echo secret-shaped content.
    if (value.length === 0 || value.length > 200) {
      continue
    }
    filtered[key] = value
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

export function isStoreErrorResponse(value: unknown): value is StoreErrorResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const body = value as Record<string, unknown>
  if (typeof body.code !== "string" || body.code.length === 0) {
    return false
  }
  if (typeof body.message !== "string" || body.message.length === 0) {
    return false
  }
  if (typeof body.retryable !== "boolean") {
    return false
  }
  for (const key of Object.keys(body)) {
    if (
      key !== "code" &&
      key !== "message" &&
      key !== "retryable" &&
      key !== "correlationId" &&
      key !== "fieldErrors" &&
      key !== "cart"
    ) {
      return false
    }
  }
  return true
}

function resolveType(error: ErrorLike): string {
  return (
    readString(error.type) ??
    readString(error.code) ??
    readString(error.name) ??
    ""
  ).toLowerCase()
}

function resolveStatusHint(error: ErrorLike): number | undefined {
  return readNumber(error.statusCode) ?? readNumber(error.status)
}

function isProviderUnavailable(error: ErrorLike, type: string): boolean {
  if (error.providerUnavailable === true) {
    return true
  }
  return (
    type === "provider_unavailable" ||
    type === "service_unavailable" ||
    type.includes("unavailable")
  )
}

function isProviderShaped(error: ErrorLike, type: string): boolean {
  const integration = readString(error.integration)?.toLowerCase()
  if (integration === "stripe" || integration === "gelato") {
    return true
  }
  return (
    type.includes("provider") ||
    type.includes("stripe") ||
    type.includes("gelato")
  )
}

function isRateLimit(error: ErrorLike, type: string, statusHint?: number): boolean {
  if (statusHint === 429) {
    return true
  }
  return (
    type === "rate_limit" ||
    type === "rate_limited" ||
    type.includes("too_many_requests")
  )
}

function isPreconditionFailed(
  error: ErrorLike,
  type: string,
  statusHint?: number
): boolean {
  if (statusHint === 412) {
    return true
  }
  return (
    type === "precondition_failed" ||
    type === "preconditionfailederror" ||
    type.includes("precondition")
  )
}

function classify(
  error: unknown
): {
  statusCode: number
  code: StoreErrorCode
  retryable: boolean
  retryAfterSeconds?: number
} {
  const err = asRecord(error)
  const type = resolveType(err)
  const statusHint = resolveStatusHint(err)
  const medusaType = readString(err.type)

  if (isRateLimit(err, type, statusHint)) {
    const retryAfterSeconds = readNumber(err.retryAfterSeconds)
    return {
      statusCode: 429,
      code: STORE_ERROR_CODES.RATE_LIMITED,
      retryable: true,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    }
  }

  if (isPreconditionFailed(err, type, statusHint)) {
    return {
      statusCode: 412,
      code: STORE_ERROR_CODES.PRECONDITION_FAILED,
      retryable: false,
    }
  }

  if (isProviderUnavailable(err, type) || statusHint === 503) {
    return {
      statusCode: 503,
      code: STORE_ERROR_CODES.SERVICE_UNAVAILABLE,
      // Known unavailable without uncertain side-effect marker → safe retry.
      retryable: err.uncertainSideEffect !== true,
    }
  }

  if (isProviderShaped(err, type)) {
    return {
      statusCode: 500,
      code: STORE_ERROR_CODES.INTERNAL_ERROR,
      // Uncertain external side effects must never advertise safe retry.
      retryable: false,
    }
  }

  switch (medusaType) {
    case MedusaError.Types.INVALID_DATA:
    case MedusaError.Types.INVALID_ARGUMENT:
    case MedusaError.Types.NOT_ALLOWED:
      return {
        statusCode: 400,
        code: STORE_ERROR_CODES.VALIDATION_ERROR,
        retryable: false,
      }
    case MedusaError.Types.UNAUTHORIZED:
      return {
        statusCode: 401,
        code: STORE_ERROR_CODES.UNAUTHORIZED,
        retryable: false,
      }
    case MedusaError.Types.NOT_FOUND:
    case MedusaError.Types.FORBIDDEN:
      // Non-enumerating: ownership and unknown resource share one public shape.
      return {
        statusCode: 404,
        code: STORE_ERROR_CODES.NOT_FOUND,
        retryable: false,
      }
    case MedusaError.Types.CONFLICT:
      return {
        statusCode: 409,
        code: STORE_ERROR_CODES.CONFLICT,
        retryable: false,
      }
    case MedusaError.Types.DUPLICATE_ERROR:
    case MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR:
    case MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR:
      return {
        statusCode: 422,
        code: STORE_ERROR_CODES.DOMAIN_ERROR,
        retryable: false,
      }
    default:
      break
  }

  // Legacy guard / complete override body: { type: "not_found", message: "Not Found" }
  if (type === "not_found" || statusHint === 404) {
    return {
      statusCode: 404,
      code: STORE_ERROR_CODES.NOT_FOUND,
      retryable: false,
    }
  }

  if (statusHint === 401 || type === "unauthorized") {
    return {
      statusCode: 401,
      code: STORE_ERROR_CODES.UNAUTHORIZED,
      retryable: false,
    }
  }

  if (statusHint === 409 || type === "conflict") {
    return {
      statusCode: 409,
      code: STORE_ERROR_CODES.CONFLICT,
      retryable: false,
    }
  }

  if (statusHint === 422) {
    return {
      statusCode: 422,
      code: STORE_ERROR_CODES.DOMAIN_ERROR,
      retryable: false,
    }
  }

  if (statusHint === 400) {
    return {
      statusCode: 400,
      code: STORE_ERROR_CODES.VALIDATION_ERROR,
      retryable: false,
    }
  }

  return {
    statusCode: 500,
    code: STORE_ERROR_CODES.INTERNAL_ERROR,
    retryable: false,
  }
}

function buildBody(
  code: StoreErrorCode,
  correlationId: string,
  fieldErrors?: Record<string, string>,
  cart?: Record<string, unknown>
): StoreErrorResponse {
  const body: StoreErrorResponse = {
    code,
    message: SAFE_MESSAGES[code],
    retryable: false,
    correlationId,
  }

  // retryable overwritten by caller via returned classification
  if (fieldErrors) {
    body.fieldErrors = fieldErrors
  }
  if (cart) {
    body.cart = cart
  }
  return body
}

/**
 * Normalize any Store failure into the closed public envelope.
 * Never copies err.message / provider payload / stack into public fields.
 */
export function toStoreErrorResponse(
  error: unknown,
  options: ToStoreErrorResponseOptions = {}
): StoreErrorNormalizationResult {
  const correlationId = sanitizeStoreCorrelationId(options.correlationId)
  const classification = classify(error)
  const fieldErrors = filterStoreFieldErrors(options.fieldErrors)

  const body = buildBody(
    classification.code,
    correlationId,
    fieldErrors,
    options.cart
  )
  body.retryable = classification.retryable

  return {
    statusCode: classification.statusCode,
    body,
    ...(classification.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: classification.retryAfterSeconds }
      : {}),
  }
}
