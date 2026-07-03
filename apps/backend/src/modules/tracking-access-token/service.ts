import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import { sanitizeString } from "../../observability/sanitize"
import TrackingAccessToken from "./models/tracking-access-token"
import {
  TRACKING_ACCESS_TOKEN_CREATED_FOR,
  TRACKING_ACCESS_TOKEN_STATUS,
  TRACKING_ACCESS_TOKEN_STATUSES,
  type CreateTrackingAccessTokenInput,
  type MintTrackingAccessTokenResult,
  type TrackingAccessTokenCreatedFor,
  type TrackingAccessTokenMetadata,
  type TrackingAccessTokenMetadataValue,
  type TrackingAccessTokenRecord,
  type TrackingAccessTokenStatus,
} from "./types"

export const TRACKING_ACCESS_TOKEN_RANDOM_BYTES = 32 as const

const ALLOWED_METADATA_KEYS = new Set([
  "correlation_id",
  "recovery_origin",
  "source",
])

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function buildPattern(source: string, flags?: string): RegExp {
  return new RegExp(source, flags)
}

const FORBIDDEN_OBJECT_KEYS = new Set([
  joinKey("authori", "zation"),
  joinKey("bear", "er"),
  joinKey("bill", "ing", "_", "address"),
  "cookie",
  joinKey("cookie", "s"),
  joinKey("client", "_", "secret"),
  joinKey("copy", "_", "paste"),
  joinKey("customer", "_", "email"),
  joinKey("full", "_", "name"),
  joinKey("full", "_", "address"),
  joinKey("federal", "_", "tax", "_", "id"),
  "headers",
  joinKey("hosted", "_", "instructions", "_", "url"),
  "ip",
  joinKey("session", "_", "id"),
  joinKey("payment", "_", "intent"),
  joinKey("pix", "_", "display", "_", "qr", "_", "code"),
  joinKey("pix", "_", "copy", "_", "paste"),
  "phone",
  "telephone",
  joinKey("qr", "_", "code"),
  joinKey("raw", "_", "body"),
  joinKey("raw", "body"),
  joinKey("recipient", "_", "email"),
  joinKey("re", "fund"),
  joinKey("ex", "change"),
  joinKey("ship", "ping", "_", "address"),
  joinKey("to", "_", "email"),
  joinKey("token", "_", "prefix"),
  joinKey("token", "_", "suffix"),
  "token",
  joinKey("track", "ing", "_", "token"),
  joinKey("tracking", "_", "url"),
  joinKey("tracking", "_", "code"),
  joinKey("gelato", "_", "snapshot"),
  joinKey("gelato", "_", "order", "_", "id"),
  joinKey("order", "_", "payload"),
  joinKey("gelato", "_", "payload"),
  joinKey("payment", "_", "data"),
  joinKey("c", "pf"),
  joinKey("cn", "pj"),
  joinKey("user", "_", "agent"),
  joinKey("x", "-", "api", "-", "key"),
])

const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/i,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "i"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "i"
  ),
  /\b00020126[0-9A-Z]+\b/i,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\(?(?:\+?55\s?)?(?:\d{2})\)?\s?(?:9?\d{4})-?\d{4}\b/,
]

const ERROR_REDACTION_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/gi,
  buildPattern(joinKey("\\bwh", "sec_[A-Za-z0-9_]+\\b"), "gi"),
  buildPattern(
    joinKey("\\bpi_[A-Za-z0-9]+", "_", "secret_[A-Za-z0-9]+\\b"),
    "gi"
  ),
  /000201[0-9A-Z.+-]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  /\(?(?:\+?55\s?)?(?:\d{2})\)?\s?(?:9?\d{4})-?\d{4}\b/g,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function containsForbiddenData(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenData(entry))
  }

  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, nested]) => {
      const normalizedKey = key.trim().toLowerCase()

      return (
        FORBIDDEN_OBJECT_KEYS.has(normalizedKey) || containsForbiddenData(nested)
      )
    })
  }

  return false
}

function sanitizeMetadataValue(
  value: unknown
): TrackingAccessTokenMetadataValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "string") {
    return sanitizeString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadataValue(entry))
  }

  return sanitizeString(JSON.stringify(value))
}

function normalizeRequiredString(
  value: string | null | undefined,
  errorCode: string,
  transform?: (input: string) => string
): string {
  const normalizedInput = value?.trim() ?? ""
  const normalized = transform
    ? transform(normalizedInput)
    : normalizedInput

  if (!normalized) {
    throw new Error(errorCode)
  }

  return normalized
}

function normalizeIsoDate(
  value: Date | string | null | undefined,
  errorCode: string
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error(errorCode)
  }

  return date.toISOString()
}

class TrackingAccessTokenModuleService extends MedusaService({
  TrackingAccessToken,
}) {}

export default TrackingAccessTokenModuleService

export function resolveTrackingTokenPepper(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): string {
  const pepper = env.TRACKING_TOKEN_PEPPER?.trim()

  if (!pepper) {
    if (env.NODE_ENV === "production") {
      throw new Error("Missing required variable: TRACKING_TOKEN_PEPPER")
    }

    throw new Error("TRACKING_TOKEN_PEPPER_NOT_CONFIGURED")
  }

  if (env.NODE_ENV === "production" && pepper.length < 32) {
    throw new Error("Invalid TRACKING_TOKEN_PEPPER: must be at least 32 characters")
  }

  return pepper
}

export function generateTrackingAccessToken(
  randomBytesFn: (size: number) => Buffer = randomBytes
): string {
  return randomBytesFn(TRACKING_ACCESS_TOKEN_RANDOM_BYTES)
    .toString("base64url")
}

export function hashTrackingAccessToken(
  token: string,
  pepper: string
): string {
  const normalizedToken = normalizeRequiredString(
    token,
    "TRACKING_ACCESS_TOKEN_REQUIRED"
  )
  const normalizedPepper = normalizeRequiredString(
    pepper,
    "TRACKING_TOKEN_PEPPER_NOT_CONFIGURED"
  )

  return createHmac("sha256", normalizedPepper)
    .update(normalizedToken)
    .digest("hex")
}

export function compareTrackingAccessTokenHash(
  storedHash: string,
  candidateHash: string
): boolean {
  const expectedBuffer = Buffer.from(
    normalizeRequiredString(storedHash, "TRACKING_ACCESS_TOKEN_HASH_REQUIRED")
  )
  const receivedBuffer = Buffer.from(
    normalizeRequiredString(
      candidateHash,
      "TRACKING_ACCESS_TOKEN_CANDIDATE_HASH_REQUIRED"
    )
  )

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

export function assertValidTrackingAccessTokenStatus(
  status: string
): asserts status is TrackingAccessTokenStatus {
  if (!TRACKING_ACCESS_TOKEN_STATUSES.includes(status as TrackingAccessTokenStatus)) {
    throw new Error("TRACKING_ACCESS_TOKEN_STATUS_INVALID")
  }
}

export function assertValidTrackingAccessTokenCreatedFor(
  createdFor: string
): asserts createdFor is TrackingAccessTokenCreatedFor {
  if (createdFor !== TRACKING_ACCESS_TOKEN_CREATED_FOR.GUEST_TRACKING) {
    throw new Error("TRACKING_ACCESS_TOKEN_CREATED_FOR_INVALID")
  }
}

export function isTrackingAccessTokenExpired(
  record: Pick<TrackingAccessTokenRecord, "expires_at">,
  now: Date = new Date()
): boolean {
  const expiresAt = new Date(record.expires_at)

  if (Number.isNaN(expiresAt.getTime())) {
    return true
  }

  return expiresAt.getTime() <= now.getTime()
}

export function assertActiveTrackingAccessToken(
  record: Pick<
    TrackingAccessTokenRecord,
    "status" | "expires_at" | "revoked_at"
  >,
  now: Date = new Date()
): void {
  if (record.status === TRACKING_ACCESS_TOKEN_STATUS.REVOKED) {
    throw new Error("TRACKING_ACCESS_TOKEN_REVOKED")
  }

  if (record.revoked_at) {
    throw new Error("TRACKING_ACCESS_TOKEN_REVOKED")
  }

  if (
    record.status === TRACKING_ACCESS_TOKEN_STATUS.EXPIRED ||
    isTrackingAccessTokenExpired(record, now)
  ) {
    throw new Error("TRACKING_ACCESS_TOKEN_EXPIRED")
  }

  if (record.status !== TRACKING_ACCESS_TOKEN_STATUS.ACTIVE) {
    throw new Error("TRACKING_ACCESS_TOKEN_NOT_ACTIVE")
  }
}

export function buildTrackingAccessTokenRevocationUpdate(
  at: Date = new Date()
): Pick<TrackingAccessTokenRecord, "status" | "revoked_at" | "updated_at"> {
  const iso = at.toISOString()

  return {
    status: TRACKING_ACCESS_TOKEN_STATUS.REVOKED,
    revoked_at: iso,
    updated_at: iso,
  }
}

export function buildTrackingAccessTokenExpiryUpdate(
  at: Date = new Date()
): Pick<TrackingAccessTokenRecord, "status" | "updated_at"> {
  return {
    status: TRACKING_ACCESS_TOKEN_STATUS.EXPIRED,
    updated_at: at.toISOString(),
  }
}

export function buildTrackingAccessTokenLastUsedUpdate(
  at: Date = new Date()
): Pick<TrackingAccessTokenRecord, "last_used_at" | "updated_at"> {
  const iso = at.toISOString()

  return {
    last_used_at: iso,
    updated_at: iso,
  }
}

export function assertNoSensitiveTrackingAccessTokenMetadata(
  metadata: Record<string, unknown> | null | undefined
): void {
  if (!metadata) {
    return
  }

  if (containsForbiddenData(metadata)) {
    throw new Error("TRACKING_ACCESS_TOKEN_METADATA_FORBIDDEN")
  }
}

export function sanitizeTrackingAccessTokenMetadata(
  metadata: Record<string, unknown> | null | undefined
): TrackingAccessTokenMetadata | null {
  if (!metadata) {
    return null
  }

  assertNoSensitiveTrackingAccessTokenMetadata(metadata)

  const output: TrackingAccessTokenMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }

    output[key] = sanitizeMetadataValue(value)
  }

  return Object.keys(output).length > 0 ? output : null
}

export function sanitizeTrackingAccessTokenError(error: unknown): {
  error_code: string | null
  error_message: string | null
} {
  const sanitizeErrorMessage = (value: string): string =>
    sanitizeTrackingAccessTokenErrorText(value)

  if (error instanceof Error) {
    return {
      error_code: sanitizeErrorMessage(error.name || "Error").slice(0, 120) || "Error",
      error_message: sanitizeErrorMessage(error.message).slice(0, 500) || null,
    }
  }

  if (typeof error === "string") {
    return {
      error_code: "Error",
      error_message: sanitizeErrorMessage(error).slice(0, 500) || null,
    }
  }

  return {
    error_code: "Error",
    error_message: null,
  }
}

export function sanitizeTrackingAccessTokenErrorText(value: string): string {
  let sanitized = sanitizeString(value)

  for (const pattern of ERROR_REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]")
  }

  return sanitized
}

export function buildTrackingAccessTokenRecord(
  input: CreateTrackingAccessTokenInput & { token_hash: string },
  id: string,
  at: Date = new Date()
): TrackingAccessTokenRecord {
  if ("token" in input || "plaintext_token" in input) {
    throw new Error("TRACKING_ACCESS_TOKEN_PLAINTEXT_FORBIDDEN")
  }

  if (containsForbiddenData(input)) {
    throw new Error("TRACKING_ACCESS_TOKEN_INPUT_FORBIDDEN")
  }

  const expiresAt =
    normalizeIsoDate(input.expires_at, "TRACKING_ACCESS_TOKEN_EXPIRES_AT_REQUIRED") ??
    (() => {
      throw new Error("TRACKING_ACCESS_TOKEN_EXPIRES_AT_REQUIRED")
    })()

  const createdFor =
    input.created_for ?? TRACKING_ACCESS_TOKEN_CREATED_FOR.GUEST_TRACKING

  assertValidTrackingAccessTokenCreatedFor(createdFor)

  const tokenHash = normalizeRequiredString(
    input.token_hash,
    "TRACKING_ACCESS_TOKEN_HASH_REQUIRED"
  )

  return {
    id,
    order_id: normalizeRequiredString(
      input.order_id,
      "TRACKING_ACCESS_TOKEN_ORDER_ID_REQUIRED"
    ),
    gelato_fulfillment_id: normalizeRequiredString(
      input.gelato_fulfillment_id,
      "TRACKING_ACCESS_TOKEN_GELATO_FULFILLMENT_ID_REQUIRED"
    ),
    token_hash: tokenHash,
    status: TRACKING_ACCESS_TOKEN_STATUS.ACTIVE,
    expires_at: expiresAt,
    revoked_at: null,
    last_used_at: null,
    created_for: createdFor,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
  }
}

export function mintTrackingAccessToken(
  input: CreateTrackingAccessTokenInput,
  options: {
    id: string
    pepper: string
    at?: Date
    randomBytesFn?: (size: number) => Buffer
  }
): MintTrackingAccessTokenResult {
  const plaintextToken = generateTrackingAccessToken(options.randomBytesFn)
  const tokenHash = hashTrackingAccessToken(plaintextToken, options.pepper)
  const record = buildTrackingAccessTokenRecord(
    {
      ...input,
      token_hash: tokenHash,
    },
    options.id,
    options.at
  )

  return {
    record,
    plaintext_token: plaintextToken,
  }
}

export function verifyTrackingAccessTokenCandidate(
  record: Pick<
    TrackingAccessTokenRecord,
    "token_hash" | "status" | "expires_at" | "revoked_at"
  >,
  candidateToken: string,
  pepper: string,
  now: Date = new Date()
): boolean {
  assertActiveTrackingAccessToken(record, now)

  const candidateHash = hashTrackingAccessToken(candidateToken, pepper)

  return compareTrackingAccessTokenHash(record.token_hash, candidateHash)
}
