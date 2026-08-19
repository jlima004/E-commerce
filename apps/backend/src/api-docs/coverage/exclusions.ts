import { AUTH_SURFACE_NATIVE_OPERATIONS } from "../../api/auth-surface/manifest"
import { STORE_SURFACE_MANIFEST } from "../../api/store-surface/manifest"
import type { HttpMethod } from "../contracts"
import type { DiscoveredRoute } from "./discover-routes"

export type RouteExclusion = {
  sourceFile: string
  method: HttpMethod
  path: string
  reason: string
  owner: string
  reviewTrigger: string
}

/**
 * Documentation-only DENY inventory for auth/customer surfaces that are not
 * discovered AST routes (or must not enter ROUTE_EXCLUSIONS). Never pass this
 * list to validateRouteExclusions.
 */
export type AuthDocumentationDenyExclusion = {
  key: string
  method: string
  path: string | null
  origin: "documentation" | "native" | "store-native" | "alias"
  owner: string
  rationale: string
  reviewTrigger: string
  provenance: string
  localOverrideDocumentsSamePath?: boolean
}

const SCAFFOLD_EXCLUSION_REASON =
  "scaffold/example route; not part of initial API-DOCS-01 contracts; physical removal is a separate cleanup decision"

const COMPLETE_LOCKDOWN_EXCLUSION_REASON =
  "Phase 13 fail-closed defense-in-depth override for native cart complete; BLOCKED→DENY; not part of executable Store OpenAPI; owner review when Phase 15+ checkout surface is authorized"

const ATTACH_LOCKDOWN_EXCLUSION_REASON =
  "Phase 13 fail-closed lockdown; BLOCKED→DENY; handler retained only as internal/domain invariant boundary until Phase 16 merge owner flow."

export const ROUTE_EXCLUSIONS: RouteExclusion[] = [
  {
    sourceFile: "apps/backend/src/api/store/custom/route.ts",
    method: "GET",
    path: "/store/custom",
    reason: SCAFFOLD_EXCLUSION_REASON,
    owner: "API-DOCS-01",
    reviewTrigger: "route purpose, handler, or ownership changes",
  },
  {
    sourceFile: "apps/backend/src/api/admin/custom/route.ts",
    method: "GET",
    path: "/admin/custom",
    reason: SCAFFOLD_EXCLUSION_REASON,
    owner: "API-DOCS-01",
    reviewTrigger: "route purpose, handler, or ownership changes",
  },
  {
    sourceFile: "apps/backend/src/api/store/carts/[id]/complete/route.ts",
    method: "POST",
    path: "/store/carts/{id}/complete",
    reason: COMPLETE_LOCKDOWN_EXCLUSION_REASON,
    owner: "FND-02 / Phase 13-02",
    reviewTrigger:
      "complete override removed, reclassified, or checkout M1 enablement authorized",
  },
  {
    sourceFile: "apps/backend/src/api/store/customers/me/cart/attach/route.ts",
    method: "POST",
    path: "/store/customers/me/cart/attach",
    reason: ATTACH_LOCKDOWN_EXCLUSION_REASON,
    owner: "FND-02 / Phase 13-02",
    reviewTrigger:
      "route reclassified/enabled, Phase 16 merge contract materialized, or public attach deprecation/removal decision",
  },
]

const EXPECTED_EXCLUSION_KEYS = new Set([
  "GET /store/custom",
  "GET /admin/custom",
  "POST /store/carts/{id}/complete",
  "POST /store/customers/me/cart/attach",
])

export function validateRouteExclusions(
  discovered: DiscoveredRoute[],
  exclusions: RouteExclusion[] = ROUTE_EXCLUSIONS
): void {
  const actualKeys = new Set<string>()
  const discoveredKeys = new Set(
    discovered.map((route) => `${route.method} ${route.path} ${route.sourceFile}`)
  )

  if (exclusions.length !== EXPECTED_EXCLUSION_KEYS.size) {
    throw new Error(
      `Route exclusions must contain exactly ${EXPECTED_EXCLUSION_KEYS.size} explicit entries`
    )
  }

  for (const exclusion of exclusions) {
    for (const [field, value] of Object.entries(exclusion)) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Route exclusion is missing ${field}`)
      }
    }

    const key = `${exclusion.method} ${exclusion.path}`
    if (!EXPECTED_EXCLUSION_KEYS.has(key)) {
      throw new Error(`Unauthorized route exclusion: ${key}`)
    }
    if (actualKeys.has(key)) {
      throw new Error(`Duplicate route exclusion: ${key}`)
    }
    actualKeys.add(key)

    const sourceKey = `${key} ${exclusion.sourceFile}`
    if (!discoveredKeys.has(sourceKey)) {
      throw new Error(`Excluded route was not discovered: ${sourceKey}`)
    }
  }
}

const AUTH_DOCUMENTATION_DENY_OWNER = "auth-surface / AUTH-03"
const AUTH_DOCUMENTATION_DENY_REVIEW =
  "auth-surface or Store customer runtimePolicy is promoted from DENY with OpenAPI documentation authorization"
const BFF_LOGOUT_OWNER = "BFF / AUTH-03"
const RAW_CUSTOMER_OWNER = "store-surface / AUTH-03"

const AUTH_NATIVE_REFRESH_KEY = "native POST /auth/token/refresh"

const AUTH_DOCUMENTATION_DENY_ALIASES: Array<
  Pick<AuthDocumentationDenyExclusion, "method" | "path" | "rationale">
> = [
  {
    method: "GET",
    path: "/auth/token/refresh",
    rationale:
      "Native refresh aliases are outside the BFF one-time rotation contract.",
  },
  {
    method: "POST",
    path: "/auth/refresh",
    rationale:
      "Native refresh aliases are outside the BFF one-time rotation contract.",
  },
  {
    method: "POST",
    path: "/auth/token",
    rationale:
      "Native refresh aliases are outside the BFF one-time rotation contract.",
  },
  {
    method: "POST",
    path: "/auth/customer/emailpass/reset",
    rationale:
      "Native reset aliases bypass the composed Phase 14 reset confirmation contract.",
  },
  {
    method: "GET",
    path: "/auth/customer/emailpass",
    rationale:
      "Native auth session primitives and method aliases are not BFF login.",
  },
  {
    method: "PUT",
    path: "/auth/customer/emailpass",
    rationale:
      "Native auth session primitives and method aliases are not BFF login.",
  },
  {
    method: "POST",
    path: "/auth/customer/google",
    rationale:
      "Non-emailpass providers are outside the customer/emailpass BFF contract.",
  },
  {
    method: "POST",
    path: "/auth/user/emailpass",
    rationale:
      "User/admin actor aliases are outside the customer BFF contract.",
  },
]

function documentationDenyEntry(
  exclusion: Omit<AuthDocumentationDenyExclusion, "reviewTrigger"> & {
    reviewTrigger?: string
  }
): AuthDocumentationDenyExclusion {
  return {
    reviewTrigger: AUTH_DOCUMENTATION_DENY_REVIEW,
    ...exclusion,
  }
}

/**
 * Deny documentation for browser logout, native auth primitives, MFA,
 * callbacks, aliases, and raw Customer. This list is NOT a ROUTE_EXCLUSIONS
 * input: validateRouteExclusions requires discovered AST routes, and these
 * surfaces are either undiscovered or already covered by the closed 4-entry
 * route exclusion set.
 */
export const AUTH_DOCUMENTATION_DENY_EXCLUSIONS: AuthDocumentationDenyExclusion[] =
  [
    documentationDenyEntry({
      key: "browser-raw-logout",
      method: "N/A",
      path: null,
      origin: "documentation",
      owner: BFF_LOGOUT_OWNER,
      rationale:
        "No Store or Auth browser logout endpoint exists. Browser logout remains BFF cookie ownership. The BFF internally calls POST /auth/customer/emailpass/revoke-current-lineage. Do not invent a browser logout operation.",
      reviewTrigger:
        "Frontend BFF logout contract is materialized or a legitimate Store logout operation is authorized",
      provenance:
        "AUTH-03; 14-SPEC.md; AUTH_HTTP_CONTRACT documents revoke_current_lineage only",
    }),
    ...AUTH_SURFACE_NATIVE_OPERATIONS.map((entry) => {
      const isDocumentedLocalRefresh =
        entry.method === "POST" && entry.pathTemplate === "/auth/token/refresh"
      return documentationDenyEntry({
        key: isDocumentedLocalRefresh
          ? AUTH_NATIVE_REFRESH_KEY
          : `${entry.method} ${entry.pathTemplate}`,
        method: entry.method,
        path: entry.pathTemplate,
        origin: "native",
        owner: AUTH_DOCUMENTATION_DENY_OWNER,
        rationale: isDocumentedLocalRefresh
          ? `${entry.rationale} The documented Store operation is the local Phase 14 override, not the native primitive.`
          : entry.rationale,
        provenance: "AUTH_SURFACE_NATIVE_OPERATIONS",
        localOverrideDocumentsSamePath: isDocumentedLocalRefresh,
      })
    }),
    ...AUTH_DOCUMENTATION_DENY_ALIASES.map((entry) =>
      documentationDenyEntry({
        key: `${entry.method} ${entry.path}`,
        method: entry.method,
        path: entry.path,
        origin: "alias",
        owner: AUTH_DOCUMENTATION_DENY_OWNER,
        rationale: entry.rationale,
        provenance:
          "AUTH_HTTP_CONTRACT exact-set; coverage unsupported auth aliases",
      })
    ),
    ...STORE_SURFACE_MANIFEST.filter(
      (entry) =>
        entry.pathTemplate.startsWith("/store/customers") &&
        entry.runtime_policy === "DENY"
    ).map((entry) =>
      documentationDenyEntry({
        key: `${entry.method} ${entry.pathTemplate}`,
        method: entry.method,
        path: entry.pathTemplate,
        origin: "store-native",
        owner: RAW_CUSTOMER_OWNER,
        rationale: entry.rationale,
        provenance: "STORE_SURFACE_MANIFEST runtime_policy DENY",
      })
    ),
  ]
