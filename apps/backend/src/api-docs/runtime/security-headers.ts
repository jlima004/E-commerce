import type { MedusaResponse } from "@medusajs/framework/http"

export const API_DOCS_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'; media-src 'none'; manifest-src 'none'"

export const API_DOCS_CONTENT_TYPE_HTML = "text/html; charset=utf-8"
export const API_DOCS_CONTENT_TYPE_JSON = "application/json; charset=utf-8"
export const API_DOCS_CONTENT_TYPE_CSS = "text/css; charset=utf-8"
export const API_DOCS_CONTENT_TYPE_JS = "text/javascript; charset=utf-8"

/**
 * Apply fail-closed security headers for API docs HTML/JS/CSS/JSON responses.
 * Does not set or widen CORS.
 */
export function applyApiDocsSecurityHeaders(
  res: MedusaResponse,
  contentType: string
): void {
  res.setHeader("Content-Type", contentType)
  res.setHeader("Content-Security-Policy", API_DOCS_CONTENT_SECURITY_POLICY)
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Cache-Control", "no-store")
}

/**
 * Opaque 404 for hidden docs surfaces — never 401/403.
 */
export function sendApiDocsNotFound(res: MedusaResponse): void {
  res.status(404).end()
}
