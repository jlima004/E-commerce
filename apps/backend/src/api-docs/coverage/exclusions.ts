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

const EXCLUSION_REASON =
  "scaffold/example route; not part of initial API-DOCS-01 contracts; physical removal is a separate cleanup decision"

export const ROUTE_EXCLUSIONS: RouteExclusion[] = [
  {
    sourceFile: "apps/backend/src/api/store/custom/route.ts",
    method: "GET",
    path: "/store/custom",
    reason: EXCLUSION_REASON,
    owner: "API-DOCS-01",
    reviewTrigger: "route purpose, handler, or ownership changes",
  },
  {
    sourceFile: "apps/backend/src/api/admin/custom/route.ts",
    method: "GET",
    path: "/admin/custom",
    reason: EXCLUSION_REASON,
    owner: "API-DOCS-01",
    reviewTrigger: "route purpose, handler, or ownership changes",
  },
]

export function validateRouteExclusions(
  discovered: DiscoveredRoute[],
  exclusions: RouteExclusion[] = ROUTE_EXCLUSIONS
): void {
  const expectedKeys = new Set(["GET /store/custom", "GET /admin/custom"])
  const actualKeys = new Set<string>()
  const discoveredKeys = new Set(
    discovered.map((route) => `${route.method} ${route.path} ${route.sourceFile}`)
  )

  if (exclusions.length !== 2) {
    throw new Error("Wave 1 must contain exactly two explicit route exclusions")
  }

  for (const exclusion of exclusions) {
    for (const [field, value] of Object.entries(exclusion)) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Route exclusion is missing ${field}`)
      }
    }

    const key = `${exclusion.method} ${exclusion.path}`
    if (!expectedKeys.has(key)) {
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
