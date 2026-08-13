export const AUTH_SURFACE_MEDUSA_VERSION = "2.16.0" as const

export const AUTH_SURFACE_RUNTIME_POLICIES = [
  "DENY",
  "INTERNAL_PRIMITIVE",
  "PHASE14_ENABLED",
] as const

export type AuthSurfaceRuntimePolicy =
  (typeof AUTH_SURFACE_RUNTIME_POLICIES)[number]
export type AuthSurfaceHttpMethod = "GET" | "POST" | "DELETE"
export type AuthSurfaceOrigin = "native" | "local"

export type AuthSurfaceEntry = Readonly<{
  method: AuthSurfaceHttpMethod
  pathTemplate: string
  origin: AuthSurfaceOrigin
  runtimePolicy: AuthSurfaceRuntimePolicy
  ownerPlan?: string
  rationale: string
  medusaVersion: typeof AUTH_SURFACE_MEDUSA_VERSION
}>

function nativeEntry(
  method: AuthSurfaceHttpMethod,
  pathTemplate: string,
  rationale: string
): AuthSurfaceEntry {
  return {
    method,
    pathTemplate,
    origin: "native",
    runtimePolicy: "DENY",
    rationale,
    medusaVersion: AUTH_SURFACE_MEDUSA_VERSION,
  }
}

function localEntry(
  method: AuthSurfaceHttpMethod,
  pathTemplate: string,
  ownerPlan: string,
  rationale: string
): AuthSurfaceEntry {
  return {
    method,
    pathTemplate,
    origin: "local",
    runtimePolicy: "DENY",
    ownerPlan,
    rationale,
    medusaVersion: AUTH_SURFACE_MEDUSA_VERSION,
  }
}

/** Exact inventory of the 18 operations loaded from medusa@2.16.0. */
export const AUTH_SURFACE_NATIVE_OPERATIONS: readonly AuthSurfaceEntry[] = [
  nativeEntry("GET", "/auth/{actor_type}/{auth_provider}", "Native provider authentication may return a raw token."),
  nativeEntry("POST", "/auth/{actor_type}/{auth_provider}", "Native provider authentication lacks Phase 14 lineage wrapping."),
  nativeEntry("GET", "/auth/{actor_type}/{auth_provider}/callback", "OAuth callback is outside the customer/emailpass scope."),
  nativeEntry("POST", "/auth/{actor_type}/{auth_provider}/callback", "OAuth callback is outside the customer/emailpass scope."),
  nativeEntry("POST", "/auth/{actor_type}/{auth_provider}/register", "Raw registration creates identity without the coordinated Customer contract."),
  nativeEntry("POST", "/auth/{actor_type}/{auth_provider}/reset-password", "Native reset request bypasses the Phase 14 outbox and limiter contract."),
  nativeEntry("POST", "/auth/{actor_type}/{auth_provider}/update", "Native reset consumes capability before the composed Phase 14 operation."),
  nativeEntry("POST", "/auth/session", "Medusa session is a parallel browser session forbidden by the BFF-only contract."),
  nativeEntry("DELETE", "/auth/session", "Medusa session deletion does not revoke a Phase 14 lineage."),
  nativeEntry("POST", "/auth/token/refresh", "Native refresh has no one-time rotation or replay detection."),
  nativeEntry("POST", "/auth/verification/request", "Native verification exposes internal state and emits capability-bearing events."),
  nativeEntry("POST", "/auth/verification/confirm", "Native verification does not prove one-time concurrent confirmation."),
  nativeEntry("POST", "/auth/mfa/challenges/{id}/verify", "MFA is outside the milestone and may emit a raw token."),
  nativeEntry("GET", "/auth/mfa/factors", "MFA is outside the milestone."),
  nativeEntry("POST", "/auth/mfa/factors", "MFA is outside the milestone."),
  nativeEntry("DELETE", "/auth/mfa/factors/{id}", "MFA is outside the milestone."),
  nativeEntry("POST", "/auth/mfa/factors/{id}/verify", "MFA is outside the milestone."),
  nativeEntry("POST", "/auth/mfa/recovery-codes", "MFA recovery capabilities are outside the milestone."),
]

/**
 * Planned local overrides. Every entry starts DENY and can be promoted only by
 * its owner plan after the corresponding implementation and evidence exist.
 */
export const AUTH_SURFACE_LOCAL_OPERATIONS: readonly AuthSurfaceEntry[] = [
  localEntry("POST", "/auth/customer/emailpass/register", "14-15", "Coordinated signup override."),
  localEntry("POST", "/auth/customer/emailpass", "14-15", "Customer/emailpass login wrapper."),
  localEntry("POST", "/auth/token/refresh", "14-11", "One-time custom refresh rotation override."),
  localEntry("POST", "/auth/customer/emailpass/revoke-current-lineage", "14-11", "Current-lineage revocation for the BFF."),
  localEntry("POST", "/auth/customer/emailpass/reset-password", "14-16", "Uniform custom reset request override."),
  localEntry("POST", "/auth/customer/emailpass/update", "14-16", "Composed custom reset confirmation override."),
]

export const AUTH_SURFACE_MANIFEST: readonly AuthSurfaceEntry[] = [
  ...AUTH_SURFACE_NATIVE_OPERATIONS,
  ...AUTH_SURFACE_LOCAL_OPERATIONS,
]

export function authSurfaceOperationKey(
  method: string,
  pathTemplate: string,
  origin?: AuthSurfaceOrigin
): string {
  return `${method.toUpperCase()} ${pathTemplate}${origin ? ` ${origin}` : ""}`
}
