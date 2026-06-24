export const REDACTED = "[REDACTED]"

const MAX_CAUSE_DEPTH = 5

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/g,
  /\bwhsec_[A-Za-z0-9_]+\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g,
  /postgres(?:ql)?:\/\/[^\s"'`,]+/gi,
  /redis(?:s)?:\/\/[^\s"'`,]+/gi,
  /\bt=\d+,v1=[a-f0-9]+\b/gi,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /(?:^|[;\s])(?:session|auth|token|sid|connect\.sid)=[^;\s]+(?:;\s*[^;\s]+=[^;\s]+)*/gi,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,}"']+/gi,
  /https:\/\/[a-f0-9]+@[a-z0-9.]+\.ingest\.(?:sentry\.io|de\.sentry\.io)\/\d+/gi,
  /\bpix_[A-Za-z0-9]+\b/g,
  /\bpi_[A-Za-z0-9]+\b/g,
]

export const ALLOWLISTED_CONTEXT_KEYS = new Set([
  "correlation_id",
  "method",
  "route",
  "status",
  "duration_ms",
  "operation",
  "integration",
  "error_class",
  "grouping_key",
  "service",
  "level",
  "order_id",
  "cart_id",
  "payment_intent_id",
  "payment_attempt_id",
  "customer_id",
  "entity_id",
  "entity_type",
  "activity_id",
  "message",
  "error_chain",
])

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "body",
  "headers",
  "cookies",
  "authorization",
  "cookie",
  "req",
  "res",
  "request",
  "response",
  "query",
  "rawbody",
  "raw_body",
  "payload",
  "email",
  "phone",
  "cpf",
  "user_agent",
  "ip",
])

export type SanitizedError = {
  name: string
  message: string
  stack?: string
  cause?: SanitizedError
}

export function sanitizeString(value: string): string {
  let result = value
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED)
  }
  return result
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === "string") {
    return sanitizeString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (value instanceof Error) {
    return sanitizeError(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, depth + 1))
  }

  if (typeof value === "object") {
    if (depth > 2) {
      return REDACTED
    }
    return sanitizeContext(value as Record<string, unknown>)
  }

  return REDACTED
}

function sanitizeErrorLike(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return sanitizeError(value)
  }

  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === "string") {
    return sanitizeString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeErrorLike(entry, depth + 1))
  }

  if (typeof value !== "object" || depth > MAX_CAUSE_DEPTH) {
    return REDACTED
  }

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}

  for (const key of ["name", "message", "stack", "cause"]) {
    if (key in input) {
      output[key] = sanitizeErrorLike(input[key], depth + 1)
    }
  }

  return output
}

export function sanitizeContext(
  input: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase()

    if (FORBIDDEN_CONTEXT_KEYS.has(normalizedKey)) {
      continue
    }

    if (!ALLOWLISTED_CONTEXT_KEYS.has(key)) {
      continue
    }

    if (key === "error_chain") {
      output[key] = sanitizeErrorLike(value)
      continue
    }

    output[key] = sanitizeUnknown(value)
  }

  return output
}

export function sanitizeError(
  error: Error,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): SanitizedError {
  if (seen.has(error)) {
    return {
      name: "Error",
      message: "[CIRCULAR]",
    }
  }

  seen.add(error)

  const sanitized: SanitizedError = {
    name: error.name,
    message: sanitizeString(error.message),
    stack: error.stack ? sanitizeString(error.stack) : undefined,
  }

  if (depth < MAX_CAUSE_DEPTH) {
    const cause = (error as Error & { cause?: unknown }).cause

    if (cause instanceof Error) {
      sanitized.cause = sanitizeError(cause, seen, depth + 1)
    }
  }

  return sanitized
}

function simpleHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(16)
}

export function maskIpAddress(ip: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".")
    return `${parts[0]}.${parts[1]}.xxx.xxx`
  }

  if (ip.includes(":")) {
    return `ipv6:hash:${simpleHash(ip).slice(0, 8)}`
  }

  return REDACTED
}

export function summarizeUserAgent(userAgent: string): string {
  let browser = "other"
  let os = "other"

  if (/Edg\//i.test(userAgent)) {
    browser = "edge"
  } else if (/Chrome\//i.test(userAgent)) {
    browser = "chrome"
  } else if (/Firefox\//i.test(userAgent)) {
    browser = "firefox"
  } else if (/Safari\//i.test(userAgent)) {
    browser = "safari"
  }

  if (/Windows/i.test(userAgent)) {
    os = "windows"
  } else if (/Mac OS X/i.test(userAgent)) {
    os = "macos"
  } else if (/Android/i.test(userAgent)) {
    os = "android"
  } else if (/iPhone|iPad/i.test(userAgent)) {
    os = "ios"
  } else if (/Linux/i.test(userAgent)) {
    os = "linux"
  }

  return `${browser}/${os}`
}
