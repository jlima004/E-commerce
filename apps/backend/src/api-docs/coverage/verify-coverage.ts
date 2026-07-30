import type { ContractSurface } from "../contracts"
import type { ContractRegistryBundle } from "../registry"
import { operationKey } from "../generation/validate"
import { ROUTE_EXCLUSIONS, validateRouteExclusions } from "./exclusions"
import { discoverRoutes, type DiscoveredRoute } from "./discover-routes"

export type CoverageScope = ContractSurface | "foundation" | "global"

function routeBelongsToSurface(route: DiscoveredRoute, surface: ContractSurface) {
  if (surface === "store") {
    return route.path.startsWith("/store/") || route.path.startsWith("/health/")
  }
  if (surface === "admin") {
    return route.path.startsWith("/admin/")
  }
  return route.path.startsWith("/hooks/")
}

export function verifyCoverage(
  scope: CoverageScope,
  registry: ContractRegistryBundle,
  discovered = discoverRoutes()
): void {
  validateRouteExclusions(discovered)
  if (scope === "foundation") {
    if (discovered.length === 0) {
      throw new Error("Route discovery returned no routes")
    }
    return
  }

  const exclusionKeys = new Set(ROUTE_EXCLUSIONS.map(operationKey))
  const registryKeys = new Set(registry.getOperations().map(operationKey))
  const expectedRoutes =
    scope === "global"
      ? discovered
      : discovered.filter((route) =>
          routeBelongsToSurface(route, scope as ContractSurface)
        )

  const missing = expectedRoutes
    .map(operationKey)
    .filter((key) => !registryKeys.has(key) && !exclusionKeys.has(key))

  if (missing.length > 0) {
    throw new Error(`OpenAPI route coverage is incomplete: ${missing.join(", ")}`)
  }
}
