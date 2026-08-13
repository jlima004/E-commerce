import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  AUTH_SURFACE_MANIFEST,
  type AuthSurfaceEntry,
  type AuthSurfaceHttpMethod,
} from "./manifest"

const KNOWN_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
])

export type AuthSurfaceDecision =
  | { action: "deny"; reason: string }
  | { action: "allow"; entry: AuthSurfaceEntry }

function deny(reason: string): AuthSurfaceDecision {
  return { action: "deny", reason }
}

/** Accept canonical `/auth` paths only; query strings do not alter identity. */
export function normalizeAuthRequestPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null
  }

  const path = raw.split(/[?#]/, 1)[0] ?? ""
  if (path !== "/auth" && !path.startsWith("/auth/")) {
    return null
  }
  if (/%/.test(path) || path.includes("//")) {
    return null
  }
  if (path.length > 1 && path.endsWith("/")) {
    return null
  }

  const segments = path.split("/").filter(Boolean)
  if (segments[0] !== "auth") {
    return null
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null
  }
  return path
}

function pathMatchesTemplate(path: string, template: string): boolean {
  const actual = path.split("/").filter(Boolean)
  const expected = template.split("/").filter(Boolean)
  if (actual.length !== expected.length) {
    return false
  }

  return expected.every((segment, index) => {
    const value = actual[index] ?? ""
    if (segment.startsWith("{") && segment.endsWith("}")) {
      return value.length > 0
    }
    return value === segment
  })
}

/**
 * A native entry is never publicly enabled. Only a static local override that
 * an owner plan explicitly promoted to PHASE14_ENABLED may continue.
 */
export function decideAuthSurfaceAccess(
  method: string,
  rawPath: string,
  entries: readonly AuthSurfaceEntry[] = AUTH_SURFACE_MANIFEST
): AuthSurfaceDecision {
  const normalizedMethod = method.toUpperCase()
  if (!KNOWN_HTTP_METHODS.has(normalizedMethod)) {
    return deny("Unknown HTTP method")
  }
  if (normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") {
    return deny("Implicit auth methods are forbidden")
  }

  const path = normalizeAuthRequestPath(rawPath)
  if (!path) {
    return deny("Non-canonical auth path")
  }

  const matches = entries.filter(
    (entry) =>
      entry.method === (normalizedMethod as AuthSurfaceHttpMethod) &&
      pathMatchesTemplate(path, entry.pathTemplate)
  )
  if (matches.length === 0) {
    return deny("Unknown auth operation")
  }

  const enabledLocal = matches.find(
    (entry) =>
      entry.origin === "local" &&
      entry.runtimePolicy === "PHASE14_ENABLED" &&
      entry.pathTemplate === path
  )
  if (enabledLocal) {
    return { action: "allow", entry: enabledLocal }
  }

  return deny("Auth operation is denied")
}

function resolveRequestPath(req: MedusaRequest): string {
  const originalUrl = typeof req.originalUrl === "string" ? req.originalUrl : ""
  if (originalUrl === "/auth" || originalUrl.startsWith("/auth/")) {
    return originalUrl
  }
  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : ""
  const path = typeof req.path === "string" ? req.path : ""
  const joined = `${baseUrl}${path}`
  if (joined === "/auth" || joined.startsWith("/auth/")) {
    return joined
  }
  return typeof req.url === "string" ? req.url : joined
}

function writeDeniedResponse(res: MedusaResponse): void {
  if (!res.headersSent) {
    res.status(404).json({ type: "not_found", message: "Not Found" })
  }
}

export function createAuthSurfaceGuardMiddleware() {
  return function authSurfaceGuardMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const decision = decideAuthSurfaceAccess(
      req.method ?? "GET",
      resolveRequestPath(req)
    )
    if (decision.action === "deny") {
      writeDeniedResponse(res)
      return
    }
    next()
  }
}

export const authSurfaceGuardMiddleware = createAuthSurfaceGuardMiddleware()
