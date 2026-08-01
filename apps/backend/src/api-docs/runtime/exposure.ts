export type ApiDocsSurface = "ui" | "store" | "admin" | "webhooks"

export type ApiDocsFlags = {
  API_DOCS_ENABLED: boolean
  API_DOCS_UI_ENABLED: boolean
  API_DOCS_PUBLIC_ENABLED: boolean
  API_DOCS_INTERNAL_ENABLED: boolean
}

/**
 * Actor identity for internal documentation surfaces.
 * Prefer injecting a plain object from the request auth context —
 * never read the env singleton inside these policy helpers.
 */
export type ApiDocsActor = {
  authenticated?: boolean
  actor_type?: string | null
  actor_id?: string | null
  auth_via?: "session" | "bearer" | string
} | null | undefined

const PRODUCTION_DEFAULTS: ApiDocsFlags = {
  API_DOCS_ENABLED: false,
  API_DOCS_UI_ENABLED: false,
  API_DOCS_PUBLIC_ENABLED: false,
  API_DOCS_INTERNAL_ENABLED: false,
}

/**
 * NODE_ENV-aware defaults for the four API docs flags.
 * Unknown environments fail closed (same as production).
 */
export function resolveApiDocsFlagDefaults(nodeEnv: string): ApiDocsFlags {
  if (nodeEnv === "development") {
    return {
      API_DOCS_ENABLED: true,
      API_DOCS_UI_ENABLED: true,
      API_DOCS_PUBLIC_ENABLED: true,
      API_DOCS_INTERNAL_ENABLED: true,
    }
  }

  if (nodeEnv === "test") {
    return {
      API_DOCS_ENABLED: true,
      API_DOCS_UI_ENABLED: false,
      API_DOCS_PUBLIC_ENABLED: true,
      API_DOCS_INTERNAL_ENABLED: true,
    }
  }

  return { ...PRODUCTION_DEFAULTS }
}

function isAuthenticatedAdminUser(actor: ApiDocsActor): boolean {
  if (!actor || actor.authenticated !== true) {
    return false
  }

  if (actor.actor_type !== "user") {
    return false
  }

  // Require a non-empty user identity; auth_via never substitutes.
  if (typeof actor.actor_id !== "string" || actor.actor_id.trim().length === 0) {
    return false
  }

  return true
}

/**
 * Pure exposure policy for API documentation surfaces.
 * Master flag always prevails. No HTTP, OpenAPI, or env singleton access.
 */
export function canExposeApiDocs(
  flags: ApiDocsFlags,
  surface: ApiDocsSurface,
  actor?: ApiDocsActor
): boolean {
  if (!flags.API_DOCS_ENABLED) {
    return false
  }

  if (surface === "ui") {
    return flags.API_DOCS_UI_ENABLED
  }

  if (surface === "store") {
    return flags.API_DOCS_PUBLIC_ENABLED
  }

  // admin | webhooks — internal only, user actor required
  if (!flags.API_DOCS_INTERNAL_ENABLED) {
    return false
  }

  return isAuthenticatedAdminUser(actor)
}
