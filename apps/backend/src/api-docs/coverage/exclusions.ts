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

const SCAFFOLD_EXCLUSION_REASON =
  "scaffold/example route; not part of initial API-DOCS-01 contracts; physical removal is a separate cleanup decision"

const COMPLETE_LOCKDOWN_EXCLUSION_REASON =
  "Phase 13 fail-closed defense-in-depth override for native cart complete; BLOCKED→DENY; not part of executable Store OpenAPI; owner review when Phase 15+ checkout surface is authorized"

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
]

const EXPECTED_EXCLUSION_KEYS = new Set([
  "GET /store/custom",
  "GET /admin/custom",
  "POST /store/carts/{id}/complete",
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
