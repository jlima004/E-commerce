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
import type { OpenApiDocument } from "../contracts"
import {
  STORE_SURFACE_MANIFEST,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  validateStoreSurfaceManifest,
  type StoreSurfaceEntry,
  type StoreSurfaceHttpMethod,
} from "../../api/store-surface/manifest"

export type CoverageScope = ContractSurface | "foundation" | "global"

type InstalledStoreOperation = {
  method: StoreSurfaceHttpMethod
  pathTemplate: string
  source: "native" | "local"
}

export type StoreSurfaceExactSetEvidence = {
  runtime: { native: number; local: number; total: number }
  manifest: {
    total: number
    authorized: number
    extended: number
    blocked: number
    outsideFrontendM1: number
    m1Enabled: number
  }
  executableStoreBusinessKeys: string[]
  documentStoreBusinessKeys: string[]
  healthSupportKeys: string[]
}

const DOCUMENT_HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
])

function documentOperationKeys(
  document: OpenApiDocument,
  pathPrefix: string
): string[] {
  const keys: string[] = []
  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    if (!routePath.startsWith(pathPrefix)) continue
    for (const method of Object.keys(pathItem)) {
      if (DOCUMENT_HTTP_METHODS.has(method)) {
        keys.push(storeSurfaceOperationKey(method, routePath))
      }
    }
  }
  return keys.sort()
}

export function verifyStoreSurfaceExactSets(
  registry: ContractRegistryBundle,
  storeDocument: OpenApiDocument | undefined,
  installed: readonly InstalledStoreOperation[],
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): StoreSurfaceExactSetEvidence {
  if (!storeDocument) {
    throw new Error("Store document is required for exact-set coverage")
  }

  const runtimeKeys = installed.map((operation) =>
    storeSurfaceOperationKey(operation.method, operation.pathTemplate)
  )
  if (new Set(runtimeKeys).size !== runtimeKeys.length) {
    throw new Error("Duplicate runtime Store operation")
  }

  const manifestViolations = validateStoreSurfaceManifest(manifest)
  if (manifestViolations.length > 0) {
    throw new Error(
      `Store manifest exact-set violation: ${manifestViolations
        .map((violation) => `${violation.code}:${violation.message}`)
        .join("; ")}`
    )
  }

  const manifestKeys = manifest.map((entry) =>
    storeSurfaceOperationKey(entry.method, entry.pathTemplate)
  )
  const runtimeSet = new Set(runtimeKeys)
  const manifestSet = new Set(manifestKeys)
  const missingFromManifest = runtimeKeys.filter((key) => !manifestSet.has(key))
  const missingFromRuntime = manifestKeys.filter((key) => !runtimeSet.has(key))
  if (
    runtimeKeys.length !== 58 ||
    missingFromManifest.length > 0 ||
    missingFromRuntime.length > 0
  ) {
    throw new Error(
      `Store runtime exact-set mismatch: runtime=${runtimeKeys.length}; ` +
        `missingFromManifest=${missingFromManifest.join(",") || "none"}; ` +
        `missingFromRuntime=${missingFromRuntime.join(",") || "none"}`
    )
  }

  const native = installed.filter((operation) => operation.source === "native").length
  const local = installed.filter((operation) => operation.source === "local").length
  if (native !== 51 || local !== 7) {
    throw new Error(
      `Store runtime origin drift: expected native=51/local=7, found ${native}/${local}`
    )
  }

  const eligibleEntries = manifest.filter(
    (entry) =>
      entry.m1_enablement === "enabled" &&
      entry.runtime_policy === "M1_ENABLED" &&
      entry.openapi_m1_expectation === "include_executable_m1" &&
      (entry.classification === "AUTHORIZED" ||
        entry.classification === "EXTENDED")
  )
  const expectedExecutable = new Set(
    eligibleEntries.map((entry) =>
      storeSurfaceOperationKey(entry.method, entry.pathTemplate)
    )
  )
  const documentStoreKeys = documentOperationKeys(storeDocument, "/store/")
  const registryStoreKeys = new Set(
    registry
      .getOperations("store")
      .filter((operation) => operation.path.startsWith("/store/"))
      .map((operation) => storeSurfaceOperationKey(operation.method, operation.path))
  )

  for (const key of documentStoreKeys) {
    const entry = manifest.find(
      (candidate) =>
        storeSurfaceOperationKey(candidate.method, candidate.pathTemplate) === key
    )
    if (!entry) {
      throw new Error(`Unknown Store OpenAPI business operation: ${key}`)
    }
    if (!expectedExecutable.has(key)) {
      throw new Error(`Disabled Store operation exposed as executable M1: ${key}`)
    }
  }

  for (const key of expectedExecutable) {
    if (!registryStoreKeys.has(key) || !documentStoreKeys.includes(key)) {
      throw new Error(`Enabled Store M1 operation missing from registry/document: ${key}`)
    }
  }

  const counts = summarizeStoreSurfaceManifest(manifest)
  return {
    runtime: { native, local, total: installed.length },
    manifest: {
      total: counts.total,
      authorized: counts.authorized,
      extended: counts.extended,
      blocked: counts.blocked,
      outsideFrontendM1: counts.outsideFrontendM1,
      m1Enabled: counts.m1EnablementEnabled,
    },
    executableStoreBusinessKeys: [...expectedExecutable].sort(),
    documentStoreBusinessKeys: documentStoreKeys,
    healthSupportKeys: documentOperationKeys(storeDocument, "/health/"),
  }
}

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
