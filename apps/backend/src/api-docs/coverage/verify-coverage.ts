import type {
  ContractSurface,
  OperationMetadata,
  SourceClassification,
} from "../contracts"
import type { ContractRegistryBundle } from "../registry"
import { operationKey } from "../generation/validate"
import { ROUTE_EXCLUSIONS, validateRouteExclusions } from "./exclusions"
import { discoverRoutes, type DiscoveredRoute } from "./discover-routes"
import { NATIVE_EXTENSIONS } from "./native-routes"

export type CoverageScope = ContractSurface | "foundation" | "global"

/**
 * Meta documentation routes serve committed OpenAPI artifacts / Swagger UI.
 * They are not Store/Admin/Webhooks business-contract operations and must be
 * omitted from bidirectional OpenAPI coverage matching.
 */
export function isOpenApiDocumentationRoute(route: DiscoveredRoute): boolean {
  return (
    route.path === "/docs" ||
    route.path.startsWith("/docs/") ||
    route.path.startsWith("/openapi/")
  )
}

function routeBelongsToSurface(route: DiscoveredRoute, surface: ContractSurface) {
  if (surface === "store") {
    return route.path.startsWith("/store/") || route.path.startsWith("/health/")
  }
  if (surface === "admin") {
    return route.path.startsWith("/admin/")
  }
  return route.path.startsWith("/hooks/")
}

function operationIdentity(
  operation: Pick<OperationMetadata, "surface" | "method" | "path">
): string {
  return `${operation.surface} ${operationKey(operation)}`
}

function routeSurface(route: DiscoveredRoute): ContractSurface {
  if (route.path.startsWith("/store/") || route.path.startsWith("/health/")) {
    return "store"
  }
  if (route.path.startsWith("/admin/")) {
    return "admin"
  }
  if (route.path.startsWith("/hooks/")) {
    return "webhooks"
  }
  throw new Error(`Discovered route has an incompatible surface: ${operationKey(route)}`)
}

function isNativeClassification(
  classification: SourceClassification
): boolean {
  return classification === "project-extension" ||
    classification === "native-consumed"
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
  }

  const contractRoutes = discovered.filter(
    (route) => !isOpenApiDocumentationRoute(route)
  )
  const exclusionKeys = new Set(ROUTE_EXCLUSIONS.map(operationKey))
  const operations = registry.getOperations()
  const discoveredIdentities = new Set(
    contractRoutes.map((route) =>
      operationIdentity({ ...route, surface: routeSurface(route) })
    )
  )
  const nativeIdentities = new Set(
    NATIVE_EXTENSIONS.map(operationIdentity)
  )

  for (const operation of operations) {
    const identity = operationIdentity(operation)
    const expectedIdentities = isNativeClassification(
      operation.sourceClassification
    )
      ? nativeIdentities
      : discoveredIdentities

    if (!expectedIdentities.has(identity)) {
      throw new Error(
        `OpenAPI operation has no matching ${
          isNativeClassification(operation.sourceClassification)
            ? "native extension"
            : "local AST route"
        }: ${identity}`
      )
    }
  }

  if (scope === "foundation") {
    return
  }

  const registryIdentities = new Set(operations.map(operationIdentity))
  const expectedRoutes =
    scope === "global"
      ? contractRoutes
      : contractRoutes.filter((route) =>
          routeBelongsToSurface(route, scope as ContractSurface)
        )

  const expectedNativeExtensions =
    scope === "global"
      ? NATIVE_EXTENSIONS
      : NATIVE_EXTENSIONS.filter(
          (entry) => entry.surface === scope
        )

  const missingLocal = expectedRoutes
    .filter((route) => !exclusionKeys.has(operationKey(route)))
    .map((route) =>
      operationIdentity({ ...route, surface: routeSurface(route) })
    )
    .filter((identity) => !registryIdentities.has(identity))

  const missingNative = expectedNativeExtensions
    .map(operationIdentity)
    .filter((identity) => !registryIdentities.has(identity))
  const missing = [...missingLocal, ...missingNative]

  if (missing.length > 0) {
    throw new Error(`OpenAPI route coverage is incomplete: ${missing.join(", ")}`)
  }
}
