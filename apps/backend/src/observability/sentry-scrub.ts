import { REDACTED, sanitizeError, sanitizeString } from "./sanitize"
import { buildErrorGroupingKey, normalizeRouteOrJob } from "./logger"

type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike }

export type SentryEventLike = {
  event_id?: string
  timestamp?: string | number
  platform?: string
  environment?: string
  release?: string
  level?: string
  logger?: string
  message?: string
  exception?: JsonRecord
  extra?: JsonRecord
  tags?: Record<string, unknown>
  request?: unknown
  user?: unknown
  contexts?: unknown
  breadcrumbs?: SentryBreadcrumbLike[]
  fingerprint?: string[]
  [key: string]: unknown
}

export type SentryBreadcrumbLike = {
  category?: string
  level?: string
  type?: string
  message?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

type JsonRecord = Record<string, JsonLike>

export type CapturePolicyInput = {
  level: "warn" | "error"
  expected?: boolean
  persistent?: boolean
}

export type SentryGroupingInput = {
  errorClass: string
  operation: string
  integration?: string
  routeOrJob: string
}

export type SentryCaptureContextInput = SentryGroupingInput & {
  correlationId?: string
  processRole?: string
  service?: string
}

const ALLOWED_EVENT_FIELDS = new Set([
  "event_id",
  "timestamp",
  "platform",
  "environment",
  "release",
  "level",
  "logger",
  "message",
  "exception",
  "extra",
  "tags",
  "breadcrumbs",
  "fingerprint",
])

const ALLOWED_EXTRA_KEYS = new Set(["correlation_id"])
const ALLOWED_TAG_KEYS = new Set([
  "service",
  "process_role",
  "error_class",
  "operation",
  "integration",
  "route_or_job",
])
const ALLOWED_BREADCRUMB_DATA_KEYS = new Set([
  "correlation_id",
  "operation",
  "integration",
  "route_or_job",
  "service",
  "process_role",
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeTagValue(key: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined
  }

  if (key === "route_or_job") {
    return normalizeRouteOrJob(value)
  }

  return sanitizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9:@_./-]/g, "_")
    .slice(0, 120)
}

function sanitizeExceptionValue(value: unknown): JsonLike {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "string") {
    return sanitizeString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (value instanceof Error) {
    return sanitizeError(value) as unknown as JsonLike
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeExceptionValue(entry))
  }

  if (!isPlainObject(value)) {
    return REDACTED
  }

  const output: JsonRecord = {}

  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "vars" ||
      key === "data" ||
      key === "request" ||
      key === "response" ||
      key === "raw_body" ||
      key === "body"
    ) {
      continue
    }

    output[key] = sanitizeExceptionValue(entry)
  }

  return output
}

function sanitizeTags(tags: unknown): Record<string, string> | undefined {
  if (!isPlainObject(tags)) {
    return undefined
  }

  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(tags)) {
    if (!ALLOWED_TAG_KEYS.has(key)) {
      continue
    }

    const normalized = normalizeTagValue(key, value)

    if (normalized) {
      output[key] = normalized
    }
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function sanitizeExtra(extra: unknown): JsonRecord | undefined {
  if (!isPlainObject(extra)) {
    return undefined
  }

  const output: JsonRecord = {}

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_EXTRA_KEYS.has(key) || typeof value !== "string") {
      continue
    }

    output[key] = sanitizeString(value).slice(0, 128)
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function sanitizeBreadcrumbData(
  data: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!data) {
    return undefined
  }

  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_BREADCRUMB_DATA_KEYS.has(key)) {
      continue
    }

    const normalized =
      key === "route_or_job"
        ? normalizeTagValue(key, String(value))
        : typeof value === "string"
          ? sanitizeString(value).slice(0, 120)
          : undefined

    if (normalized) {
      output[key] = normalized
    }
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function shouldDropBreadcrumb(category: string | undefined): boolean {
  return typeof category === "string" && /(http|fetch|xhr|request|webhook)/i.test(category)
}

export function scrubBreadcrumb(
  breadcrumb: SentryBreadcrumbLike | null | undefined
): SentryBreadcrumbLike | null {
  if (!breadcrumb) {
    return null
  }

  if (shouldDropBreadcrumb(breadcrumb.category)) {
    return null
  }

  const scrubbed: SentryBreadcrumbLike = {}

  if (breadcrumb.category) {
    scrubbed.category = sanitizeString(breadcrumb.category).slice(0, 80)
  }

  if (breadcrumb.level) {
    scrubbed.level = sanitizeString(breadcrumb.level).toLowerCase().slice(0, 16)
  }

  if (breadcrumb.type) {
    scrubbed.type = sanitizeString(breadcrumb.type).toLowerCase().slice(0, 32)
  }

  if (breadcrumb.message) {
    scrubbed.message = sanitizeString(breadcrumb.message).slice(0, 240)
  }

  const data = sanitizeBreadcrumbData(breadcrumb.data)
  if (data) {
    scrubbed.data = data
  }

  return Object.keys(scrubbed).length > 0 ? scrubbed : null
}

export function buildSentryCaptureContext(input: SentryCaptureContextInput): {
  fingerprint: string[]
  tags: Record<string, string>
  extra?: JsonRecord
  groupingKey: string
} {
  const groupingKey = buildErrorGroupingKey({
    errorClass: input.errorClass,
    operation: input.operation,
    integration: input.integration,
    routeOrJob: input.routeOrJob,
  })

  const tags = sanitizeTags({
    service: input.service ?? "@dtc/backend",
    process_role: input.processRole ?? "server",
    error_class: input.errorClass,
    operation: input.operation,
    integration: input.integration ?? "core",
    route_or_job: input.routeOrJob,
  }) ?? {
    service: "@dtc/backend",
    process_role: "server",
    error_class: "error",
    operation: "unknown",
    integration: "core",
    route_or_job: "/unknown",
  }

  const extra = sanitizeExtra({
    correlation_id: input.correlationId,
  })

  return {
    fingerprint: [groupingKey],
    tags,
    extra,
    groupingKey,
  }
}

export function shouldCaptureError(input: CapturePolicyInput): boolean {
  if (input.level === "warn") {
    return input.persistent === true && input.expected !== true
  }

  if (input.expected === true && input.persistent !== true) {
    return false
  }

  return true
}

export function scrubEvent(
  event: SentryEventLike | null | undefined
): SentryEventLike | null {
  if (!event) {
    return null
  }

  const scrubbed: SentryEventLike = {}

  for (const [key, value] of Object.entries(event)) {
    if (!ALLOWED_EVENT_FIELDS.has(key)) {
      continue
    }

    if (key === "message" && typeof value === "string") {
      scrubbed.message = sanitizeString(value).slice(0, 240)
      continue
    }

    if (key === "exception") {
      scrubbed.exception = sanitizeExceptionValue(value) as JsonRecord
      continue
    }

    if (key === "extra") {
      const extra = sanitizeExtra(value)
      if (extra) {
        scrubbed.extra = extra
      }
      continue
    }

    if (key === "tags") {
      const tags = sanitizeTags(value)
      if (tags) {
        scrubbed.tags = tags
      }
      continue
    }

    if (key === "breadcrumbs" && Array.isArray(value)) {
      const breadcrumbs = value
        .map((entry) => scrubBreadcrumb(entry as SentryBreadcrumbLike))
        .filter((entry): entry is SentryBreadcrumbLike => entry !== null)

      if (breadcrumbs.length > 0) {
        scrubbed.breadcrumbs = breadcrumbs
      }
      continue
    }

    if (key === "fingerprint" && Array.isArray(value)) {
      scrubbed.fingerprint = value.map((entry) => sanitizeString(String(entry)).slice(0, 160))
      continue
    }

    if (
      key === "event_id" ||
      key === "platform" ||
      key === "environment" ||
      key === "release" ||
      key === "level" ||
      key === "logger" ||
      key === "timestamp"
    ) {
      scrubbed[key] =
        typeof value === "string" ? sanitizeString(value) : (value as never)
    }
  }

  return scrubbed
}
