/**
 * Store surface fail-closed guard (FND-02 / D13-03 / D13-04).
 *
 * Consumes the closed 58-entry manifest SSOT. UNKNOWN / BLOCKED / DENY stop
 * before any Store business handler. PRESERVE_LEGACY is inherited v1.0
 * pass-through only — never M1 enablement.
 */

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  STORE_SURFACE_MANIFEST,
  lookupStoreSurfaceEntry,
  type StoreSurfaceEntry,
  type StoreSurfaceHttpMethod,
} from "./manifest"

const HTTP_METHODS = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
])

export type StoreSurfaceDecision =
  | {
      action: "deny"
      reason: string
      code: string
    }
  | {
      action: "allow"
      entry: StoreSurfaceEntry
      mode: "preserve_legacy" | "m1_enabled"
    }
  | {
      action: "options_preflight"
    }

function deny(reason: string, code = "STORE_SURFACE_DENIED"): StoreSurfaceDecision {
  return { action: "deny", reason, code }
}

/**
 * Normalize only the canonical Store path form.
 * Rejects trailing/double slash, encoded separators, case aliases, and escapes.
 */
export function normalizeStoreRequestPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null
  }

  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? ""
  if (!withoutQuery.startsWith("/store/") && withoutQuery !== "/store") {
    return null
  }

  // Encoded path separators and other percent-escapes are never canonical.
  if (/%2f/i.test(withoutQuery) || /%/.test(withoutQuery)) {
    return null
  }

  if (withoutQuery.includes("//")) {
    return null
  }

  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return null
  }

  // Reject non-canonical casing aliases for the /store prefix.
  if (!withoutQuery.startsWith("/store")) {
    return null
  }
  if (withoutQuery.slice(0, 6) !== "/store") {
    return null
  }

  const segments = withoutQuery.split("/").filter(Boolean)

  if (segments[0] !== "store") {
    return null
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return null
    }
  }

  return withoutQuery
}

function templateStaticScore(template: string): number {
  return template.split("/").filter((segment) => segment && !segment.startsWith("{"))
    .length
}

function pathMatchesTemplate(path: string, template: string): boolean {
  const pathSegments = path.split("/").filter(Boolean)
  const templateSegments = template.split("/").filter(Boolean)
  if (pathSegments.length !== templateSegments.length) {
    return false
  }
  for (let i = 0; i < templateSegments.length; i += 1) {
    const expected = templateSegments[i]!
    const actual = pathSegments[i]!
    if (expected.startsWith("{") && expected.endsWith("}")) {
      if (actual.length === 0) {
        return false
      }
      continue
    }
    if (expected !== actual) {
      return false
    }
  }
  return true
}

/**
 * Prefer static templates over parameterized ones (active vs {id}).
 */
export function matchStorePathToTemplate(
  path: string,
  templates: readonly string[]
): string | null {
  const matches = templates.filter((template) => pathMatchesTemplate(path, template))
  if (matches.length === 0) {
    return null
  }
  matches.sort((a, b) => templateStaticScore(b) - templateStaticScore(a))
  return matches[0] ?? null
}

function resolveRequestPath(req: MedusaRequest): string {
  const original = typeof req.originalUrl === "string" ? req.originalUrl : ""
  if (original.startsWith("/store")) {
    return original
  }

  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : ""
  const path = typeof req.path === "string" ? req.path : ""
  if (baseUrl || path) {
    const joined = `${baseUrl}${path}`
    if (joined.startsWith("/store")) {
      return joined
    }
  }

  const url = typeof req.url === "string" ? req.url : ""
  return url.startsWith("/store") ? url : `/store${path.startsWith("/") ? path : `/${path}`}`
}

function headerValue(
  headers: MedusaRequest["headers"],
  name: string
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0]
  }
  return undefined
}

/**
 * Strict CORS preflight: Origin + known ACR-Method must resolve to a
 * runtime-allowable Store operation (PRESERVE_LEGACY or enabled M1).
 * OPTIONS is never a business operation; HEAD is never inferred from GET.
 */
function decideOptionsPreflight(
  normalizedPath: string,
  options: {
    origin?: string
    accessControlRequestMethod?: string
  }
): StoreSurfaceDecision {
  const origin = options.origin?.trim()
  const requestMethod = options.accessControlRequestMethod?.trim().toUpperCase()

  if (
    !origin ||
    !requestMethod ||
    !HTTP_METHODS.has(requestMethod) ||
    requestMethod === "OPTIONS"
  ) {
    return deny("Invalid OPTIONS preflight", "STORE_SURFACE_OPTIONS_DENIED")
  }

  const templates = STORE_SURFACE_MANIFEST.filter(
    (entry) => entry.method === (requestMethod as StoreSurfaceHttpMethod)
  ).map((entry) => entry.pathTemplate)

  const matchedTemplate = matchStorePathToTemplate(normalizedPath, templates)
  if (!matchedTemplate) {
    return deny("UNKNOWN Store OPTIONS target", "STORE_SURFACE_OPTIONS_UNKNOWN")
  }

  const entry = lookupStoreSurfaceEntry(requestMethod, matchedTemplate)
  if (!entry) {
    return deny("UNKNOWN Store OPTIONS target", "STORE_SURFACE_OPTIONS_UNKNOWN")
  }

  if (entry.classification === "BLOCKED" || entry.runtime_policy === "DENY") {
    return deny("DENY Store OPTIONS target", "STORE_SURFACE_OPTIONS_DENIED")
  }

  if (entry.runtime_policy === "PRESERVE_LEGACY") {
    return { action: "options_preflight" }
  }

  if (
    entry.runtime_policy === "M1_ENABLED" &&
    entry.m1_enablement === "enabled"
  ) {
    return { action: "options_preflight" }
  }

  return deny("Fail-closed OPTIONS default", "STORE_SURFACE_OPTIONS_DENIED")
}

export function decideStoreSurfaceAccess(
  method: string,
  path: string,
  options: {
    origin?: string
    accessControlRequestMethod?: string
  } = {}
): StoreSurfaceDecision {
  const normalizedMethod = method.toUpperCase()
  if (!HTTP_METHODS.has(normalizedMethod)) {
    return deny("Unknown HTTP method", "STORE_SURFACE_UNKNOWN_METHOD")
  }

  const normalizedPath = normalizeStoreRequestPath(path)
  if (!normalizedPath) {
    return deny("Non-canonical Store path", "STORE_SURFACE_INVALID_PATH")
  }

  if (normalizedMethod === "OPTIONS") {
    return decideOptionsPreflight(normalizedPath, options)
  }

  // HEAD is never inferred from GET — only an explicit HEAD manifest entry would allow.
  const templates = STORE_SURFACE_MANIFEST.filter(
    (entry) => entry.method === (normalizedMethod as StoreSurfaceHttpMethod)
  ).map((entry) => entry.pathTemplate)

  const matchedTemplate = matchStorePathToTemplate(normalizedPath, templates)
  if (!matchedTemplate) {
    return deny("UNKNOWN Store operation", "STORE_SURFACE_UNKNOWN")
  }

  const entry = lookupStoreSurfaceEntry(normalizedMethod, matchedTemplate)
  if (!entry) {
    return deny("UNKNOWN Store operation", "STORE_SURFACE_UNKNOWN")
  }

  if (entry.classification === "BLOCKED") {
    return deny("BLOCKED Store operation", "STORE_SURFACE_BLOCKED")
  }

  if (entry.runtime_policy === "DENY") {
    return deny("DENY runtime policy", "STORE_SURFACE_DENY")
  }

  if (entry.runtime_policy === "PRESERVE_LEGACY") {
    // Inherited v1.0 only — never treat as M1 enablement.
    return {
      action: "allow",
      entry,
      mode: "preserve_legacy",
    }
  }

  if (entry.runtime_policy === "M1_ENABLED") {
    // Phase 13 has zero M1_ENABLED entries; branch exists for later owners.
    if (entry.m1_enablement !== "enabled") {
      return deny("M1 policy without enablement", "STORE_SURFACE_M1_DISABLED")
    }
    return {
      action: "allow",
      entry,
      mode: "m1_enabled",
    }
  }

  return deny("Fail-closed default", "STORE_SURFACE_DENIED")
}

function writeDeniedResponse(res: MedusaResponse): void {
  if (res.headersSent) {
    return
  }
  // Non-enumerating denial; StoreErrorResponse envelope arrives in 13-03.
  res.status(404).json({
    type: "not_found",
    message: "Not Found",
  })
}

export function createStoreSurfaceGuardMiddleware() {
  return function storeSurfaceGuardMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const decision = decideStoreSurfaceAccess(
      req.method ?? "GET",
      resolveRequestPath(req),
      {
        origin: headerValue(req.headers, "origin"),
        accessControlRequestMethod: headerValue(
          req.headers,
          "access-control-request-method"
        ),
      }
    )

    if (decision.action === "deny") {
      writeDeniedResponse(res)
      return
    }

    // options_preflight and allow both continue — never invoke business here.
    next()
  }
}

export const storeSurfaceGuardMiddleware = createStoreSurfaceGuardMiddleware()
