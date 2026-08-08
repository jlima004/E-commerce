/**
 * Store-only public error contract (FND-03 / D13-08..D13-12).
 *
 * Envelope is allowlist-first and fail-closed. message is presentation only.
 * Never derive public fields from raw provider/DB/stack detail.
 * Never trust a pre-shaped body that merely looks like StoreErrorResponse.
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

const STORE_ERROR_CODE_SET = new Set<string>(Object.values(STORE_ERROR_CODES))

/** Closed public field-error presentation — never echo raw validator/input text. */
export const STORE_PUBLIC_FIELD_ERROR_MESSAGE = "Invalid value"

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
  code: StoreErrorCode
  message: string
  retryable: boolean
  correlationId?: string
  fieldErrors?: Record<string, string>
}

export type StoreErrorNormalizationResult = {
  statusCode: number
  body: StoreErrorResponse
  retryAfterSeconds?: number
}

export type ToStoreErrorResponseOptions = {
  correlationId?: unknown
  fieldErrors?: Record<string, unknown>
  /** HTTP status already chosen by the writer (e.g. early DENY). */
  statusCode?: number
  /**
   * Ignored in Phase 13 R1. Concrete Cart DTO is Phase 15; unknown cart
   * input must never be exposed on the public Store error envelope.
   */
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
  fieldErrors?: unknown
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

export function isStoreErrorCode(value: unknown): value is StoreErrorCode {
  return typeof value === "string" && STORE_ERROR_CODE_SET.has(value)
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

/**
 * Keep allowlisted field names only. Values are replaced with a closed
 * public presentation string — raw validator/input text never reaches clients.
 */
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
    // Presence of a string (or non-empty) signal is enough; never echo value.
    if (value === undefined || value === null) {
      continue
    }
    if (typeof value === "string" && value.length === 0) {
      continue
    }
    filtered[key] = STORE_PUBLIC_FIELD_ERROR_MESSAGE
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

/**
 * Structural + catalog check for a fully rebuilt public Store error body.
 * Presence of `cart` or unknown keys fails closed.
 */
export function isStoreErrorResponse(value: unknown): value is StoreErrorResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const body = value as Record<string, unknown>
  if (!isStoreErrorCode(body.code)) {
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
      key !== "fieldErrors"
    ) {
      return false
    }
  }
  if (body.correlationId !== undefined) {
    if (
      typeof body.correlationId !== "string" ||
      !STORE_CORRELATION_ID_PATTERN.test(body.correlationId)
    ) {
      return false
    }
  }
  if (body.fieldErrors !== undefined) {
    if (
      typeof body.fieldErrors !== "object" ||
      body.fieldErrors === null ||
      Array.isArray(body.fieldErrors)
    ) {
      return false
    }
    for (const [key, fieldMessage] of Object.entries(
      body.fieldErrors as Record<string, unknown>
    )) {
      if (!STORE_PUBLIC_FIELD_ALLOWLIST.has(key)) {
        return false
      }
      if (fieldMessage !== STORE_PUBLIC_FIELD_ERROR_MESSAGE) {
        return false
      }
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

/** Known unavailable category — not merely HTTP 503. */
function isKnownServiceUnavailable(error: ErrorLike, type: string): boolean {
  if (error.providerUnavailable === true) {
    return true
  }
  return (
    type === "provider_unavailable" ||
    type === "service_unavailable" ||
    type === STORE_ERROR_CODES.SERVICE_UNAVAILABLE.toLowerCase()
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
    type === STORE_ERROR_CODES.RATE_LIMITED.toLowerCase() ||
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

/**
 * retryable=true only for a known-safe category with certain safe retry
 * and no uncertain side-effect marker. Absence of the marker alone is never
 * enough for unknown/generic statuses.
 */
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
  const uncertainSideEffect = err.uncertainSideEffect === true

  if (isRateLimit(err, type, statusHint)) {
    const retryAfterSeconds = readNumber(err.retryAfterSeconds)
    return {
      statusCode: 429,
      code: STORE_ERROR_CODES.RATE_LIMITED,
      // Known RATE_LIMITED category: retry is safe unless side effect is uncertain.
      retryable: !uncertainSideEffect,
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

  if (isKnownServiceUnavailable(err, type)) {
    return {
      statusCode: 503,
      code: STORE_ERROR_CODES.SERVICE_UNAVAILABLE,
      retryable: !uncertainSideEffect,
    }
  }

  // Generic/unknown 503 — public SERVICE_UNAVAILABLE, never auto-retryable.
  if (statusHint === 503) {
    return {
      statusCode: 503,
      code: STORE_ERROR_CODES.SERVICE_UNAVAILABLE,
      retryable: false,
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
  retryable: boolean,
  fieldErrors?: Record<string, string>
): StoreErrorResponse {
  const body: StoreErrorResponse = {
    code,
    message: SAFE_MESSAGES[code],
    retryable,
    correlationId,
  }

  if (fieldErrors) {
    body.fieldErrors = fieldErrors
  }
  return body
}

function extractFieldErrorsFromUnknown(
  error: unknown
): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined
  }
  const candidate = (error as ErrorLike).fieldErrors
  if (
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  ) {
    return candidate as Record<string, unknown>
  }
  return undefined
}

/**
 * Normalize any Store failure into the closed public envelope.
 * Never copies err.message / provider payload / stack / arbitrary cart into
 * public fields. Never trusts a pre-shaped envelope without rebuild.
 */
export function toStoreErrorResponse(
  error: unknown,
  options: ToStoreErrorResponseOptions = {}
): StoreErrorNormalizationResult {
  const correlationId = sanitizeStoreCorrelationId(options.correlationId)
  const errorForClassify =
    options.statusCode !== undefined &&
    typeof error === "object" &&
    error !== null
      ? {
          ...(error as Record<string, unknown>),
          statusCode:
            readNumber((error as ErrorLike).statusCode) ?? options.statusCode,
        }
      : options.statusCode !== undefined
        ? { message: error, statusCode: options.statusCode }
        : error

  const classification = classify(errorForClassify)
  const fieldErrors = filterStoreFieldErrors(
    options.fieldErrors ?? extractFieldErrorsFromUnknown(error)
  )

  // options.cart is intentionally ignored — Phase 13 has no approved Cart DTO.
  void options.cart

  const body = buildBody(
    classification.code,
    correlationId,
    classification.retryable,
    fieldErrors
  )

  return {
    statusCode: classification.statusCode,
    body,
    ...(classification.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: classification.retryAfterSeconds }
      : {}),
  }
}

type JsonWritableResponse = {
  statusCode?: number
  headersSent?: boolean
  status: (code: number) => JsonWritableResponse
  json: (body: unknown) => unknown
  setHeader?: (name: string, value: string) => void
}

type CorrelationReadableRequest = {
  correlationId?: string
}

/**
 * Wrap Store response writers so early DENY/direct JSON errors become
 * StoreErrorResponse without altering guard classification logic.
 *
 * Fail-closed: every error status is rebuilt from the normalizer. A body that
 * merely looks like StoreErrorResponse is never passed through.
 */
export function attachStoreErrorEnvelope(
  req: CorrelationReadableRequest,
  res: JsonWritableResponse
): void {
  const originalJson = res.json.bind(res)

  res.json = (body: unknown) => {
    const statusCode = res.statusCode ?? 200
    if (statusCode < 400) {
      return originalJson(body)
    }

    const correlationId = sanitizeStoreCorrelationId(req.correlationId)
    const normalized = toStoreErrorResponse(body, {
      correlationId,
      statusCode,
      fieldErrors: extractFieldErrorsFromUnknown(body),
    })

    res.setHeader?.("x-correlation-id", correlationId)
    if (normalized.retryAfterSeconds !== undefined) {
      res.setHeader?.("Retry-After", String(normalized.retryAfterSeconds))
    }
    res.statusCode = normalized.statusCode
    res.status(normalized.statusCode)
    return originalJson(normalized.body)
  }
}
