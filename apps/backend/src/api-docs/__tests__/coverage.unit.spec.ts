import fs from "fs"
import os from "os"
import path from "path"
import type { OperationMetadata } from "../contracts"
import {
  discoverRoutes,
  type DiscoveredRoute,
} from "../coverage/discover-routes"
import {
  ROUTE_EXCLUSIONS,
  validateRouteExclusions,
} from "../coverage/exclusions"
import {
  routeBelongsToSurface,
  routeSurface,
  STORE_DOCUMENTATION_AUTH_OPERATIONS,
  STORE_RUNTIME_EXACT_SET,
  verifyCoverage,
  verifyStoreSurfaceExactSets,
} from "../coverage/verify-coverage"
import { validateSurfacePartition } from "../generation/validate"
import { AUTH_HTTP_CONTRACT } from "../../api/auth-surface/contracts"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../api/auth-surface/manifest"
import {
  NATIVE_EXTENSIONS,
  type NativeExtensionEntry,
} from "../coverage/native-routes"
import {
  ContractRegistryBundle,
  createFoundationRegistry,
} from "../registry"
import { buildContracts } from "../generation/build-documents"
import { scanInstalledStoreSurface } from "../../../scripts/store-surface/scan-installed"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  type StoreSurfaceEntry,
} from "../../api/store-surface/manifest"

function fixtureRoot(): { repositoryRoot: string; apiRoot: string } {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-docs-routes-"))
  const apiRoot = path.join(repositoryRoot, "apps/backend/src/api")
  fs.mkdirSync(apiRoot, { recursive: true })
  return { repositoryRoot, apiRoot }
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, "utf8")
}

const EXCLUDED_ROUTES: DiscoveredRoute[] = [
  {
    sourceFile: "apps/backend/src/api/store/custom/route.ts",
    method: "GET",
    path: "/store/custom",
    exportKind: "function",
  },
  {
    sourceFile: "apps/backend/src/api/admin/custom/route.ts",
    method: "GET",
    path: "/admin/custom",
    exportKind: "function",
  },
  {
    sourceFile: "apps/backend/src/api/store/carts/[id]/complete/route.ts",
    method: "POST",
    path: "/store/carts/{id}/complete",
    exportKind: "const",
  },
  {
    sourceFile: "apps/backend/src/api/store/customers/me/cart/attach/route.ts",
    method: "POST",
    path: "/store/customers/me/cart/attach",
    exportKind: "function",
  },
]

const LOCAL_STORE_ROUTE: DiscoveredRoute = {
  sourceFile: "apps/backend/src/api/store/local/route.ts",
  method: "GET",
  path: "/store/local",
  exportKind: "function",
}

function operation(
  overrides: Partial<OperationMetadata> = {}
): OperationMetadata {
  return {
    surface: "store",
    method: "GET",
    path: "/store/local",
    operationId: "storeLocalGet",
    summary: "Local Store operation",
    tags: ["Store"],
    security: [],
    parameters: [],
    requestBody: null,
    responses: { "200": { description: "Success" } },
    sourceClassification: "project-custom",
    sourceFiles: ["apps/backend/src/api/store/local/route.ts"],
    testEvidence: ["src/api-docs/__tests__/coverage.unit.spec.ts"],
    officialReference: "https://example.test/local",
    inclusionReason: "Coverage fixture",
    interactiveCandidate: false,
    nonInteractive: true,
    ...overrides,
  }
}

function nativeOperation(
  entry: NativeExtensionEntry,
  index: number
): OperationMetadata {
  return operation({
    surface: entry.surface,
    method: entry.method,
    path: entry.path,
    operationId: `nativeExtension${index}`,
    sourceClassification: "project-extension",
    sourceFiles: entry.evidenceFiles,
    officialReference: entry.officialReference,
  })
}

function completeStoreRegistry(): ContractRegistryBundle {
  const registry = new ContractRegistryBundle()
  registry.registerOperation(operation())
  NATIVE_EXTENSIONS
    .filter((entry) => entry.surface === "store")
    .forEach((entry, index) =>
      registry.registerOperation(nativeOperation(entry, index))
    )
  return registry
}

function discoveredRoute(
  method: DiscoveredRoute["method"],
  routePath: string
): DiscoveredRoute {
  return {
    sourceFile: "apps/backend/src/api/fixture/route.ts",
    method,
    path: routePath,
    exportKind: "function",
  }
}

const APPROVED_STORE_DOCUMENTATION_AUTH_ROUTES: DiscoveredRoute[] =
  STORE_DOCUMENTATION_AUTH_OPERATIONS.map((key) => {
    const [method, ...pathParts] = key.split(" ")
    return discoveredRoute(
      method as DiscoveredRoute["method"],
      pathParts.join(" ")
    )
  })

const UNSUPPORTED_AUTH_ROUTES: DiscoveredRoute[] = [
  discoveredRoute("POST", "/auth/session"),
  discoveredRoute("DELETE", "/auth/session"),
  discoveredRoute("GET", "/auth/{actor_type}/{auth_provider}/callback"),
  discoveredRoute("POST", "/auth/{actor_type}/{auth_provider}/callback"),
  discoveredRoute("POST", "/auth/mfa/challenges/{id}/verify"),
  discoveredRoute("GET", "/auth/mfa/factors"),
  discoveredRoute("POST", "/auth/mfa/factors"),
  discoveredRoute("POST", "/auth/verification/request"),
  discoveredRoute("POST", "/auth/verification/confirm"),
  discoveredRoute("POST", "/auth/{actor_type}/{auth_provider}/reset-password"),
  discoveredRoute("POST", "/auth/{actor_type}/{auth_provider}/update"),
  discoveredRoute("POST", "/auth/{actor_type}/{auth_provider}/register"),
  discoveredRoute("GET", "/auth/token/refresh"),
  discoveredRoute("POST", "/auth/token"),
  discoveredRoute("POST", "/auth/refresh"),
  discoveredRoute("POST", "/auth/customer/emailpass/reset"),
  discoveredRoute("POST", "/auth/customer/emailpass/"),
  discoveredRoute("GET", "/auth/customer/emailpass"),
  discoveredRoute("POST", "/Auth/customer/emailpass"),
  discoveredRoute("POST", "/auth/customer/google"),
  discoveredRoute("POST", "/auth/user/emailpass"),
  discoveredRoute("PUT", "/auth/customer/emailpass"),
]

describe("OpenAPI route coverage foundation", () => {
  it("discovers all current route files and bracket segments through the TypeScript AST", () => {
    const routes = discoverRoutes()
    expect(routes).toHaveLength(35)
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/store/carts/{id}/payment-attempts/card",
          exportKind: "function",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/store/carts/{id}/complete",
          exportKind: "const",
          sourceFile: "apps/backend/src/api/store/carts/[id]/complete/route.ts",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/hooks/stripe",
          exportKind: "const",
        }),
        expect.objectContaining({
          method: "GET",
          path: "/docs",
          exportKind: "function",
        }),
        expect.objectContaining({
          method: "GET",
          path: "/openapi/store.json",
          exportKind: "function",
        }),
        ...STORE_DOCUMENTATION_AUTH_OPERATIONS.map((key) => {
          const [method, ...pathParts] = key.split(" ")
          return expect.objectContaining({
            method,
            path: pathParts.join(" "),
          })
        }),
      ])
    )
  })

  it("recognizes every supported method, handler constants, and local re-exports", () => {
    const fixture = fixtureRoot()
    const route = path.join(fixture.apiRoot, "fixtures/[resource]/route.ts")
    const handlers = path.join(fixture.apiRoot, "fixtures/[resource]/handlers.ts")
    write(
      route,
      [
        "export function GET() {}",
        "export const POST = () => {}",
        "export function PUT() {}",
        "export const PATCH = () => {}",
        "export function DELETE() {}",
        "export const OPTIONS = () => {}",
        'export { handler as HEAD } from "./handlers"',
      ].join("\n")
    )
    write(handlers, "export const handler = () => {}\n")

    const routes = discoverRoutes(fixture)
    expect(routes.map((item) => item.method)).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ])
    expect(routes.every((item) => item.path === "/fixtures/{resource}")).toBe(true)
    expect(routes.at(-1)?.exportKind).toBe("reexport")

    fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true })
  })

  it("recognizes a local handler exported under an HTTP method alias", () => {
    const fixture = fixtureRoot()
    write(
      path.join(fixture.apiRoot, "alias/route.ts"),
      "const handler = () => {}\nexport { handler as GET }\n"
    )

    expect(discoverRoutes(fixture)).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/alias",
        exportKind: "reexport",
      }),
    ])

    fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true })
  })

  it("fails on external or ambiguous re-exports", () => {
    const external = fixtureRoot()
    write(
      path.join(external.apiRoot, "external/route.ts"),
      'export { GET } from "external-package"\n'
    )
    expect(() => discoverRoutes(external)).toThrow("External route re-export")
    fs.rmSync(external.repositoryRoot, { recursive: true, force: true })

    const ambiguous = fixtureRoot()
    write(
      path.join(ambiguous.apiRoot, "ambiguous/route.ts"),
      'export * from "./handlers"\n'
    )
    write(
      path.join(ambiguous.apiRoot, "ambiguous/handlers.ts"),
      "export const GET = () => {}\n"
    )
    expect(() => discoverRoutes(ambiguous)).toThrow("Ambiguous route re-export")
    fs.rmSync(ambiguous.repositoryRoot, { recursive: true, force: true })
  })

  it("allows exactly the explicit route exclusions with complete metadata", () => {
    expect(
      ROUTE_EXCLUSIONS.map(({ method, path: routePath }) => `${method} ${routePath}`).sort()
    ).toEqual(
      [
        "GET /admin/custom",
        "GET /store/custom",
        "POST /store/carts/{id}/complete",
        "POST /store/customers/me/cart/attach",
      ].sort()
    )
    expect(() => validateRouteExclusions(discoverRoutes())).not.toThrow()

    expect(() =>
      validateRouteExclusions(discoverRoutes(), [
        { ...ROUTE_EXCLUSIONS[0], reason: "" },
        ROUTE_EXCLUSIONS[1],
        ROUTE_EXCLUSIONS[2],
        ROUTE_EXCLUSIONS[3],
      ])
    ).toThrow("missing reason")
  })

  it("passes foundation, admin, and webhooks coverage before Store auth registration", () => {
    const registry = createFoundationRegistry()
    expect(() => verifyCoverage("foundation", registry)).not.toThrow()
    expect(() => verifyCoverage("admin", registry)).not.toThrow()
    expect(() => verifyCoverage("webhooks", registry)).not.toThrow()
  })

  it("requires the Phase-14 Store documentation exact-set for store and global coverage", () => {
    const registry = createFoundationRegistry()
    expect(() => verifyCoverage("store", registry)).not.toThrow()
    expect(() => verifyCoverage("global", registry)).not.toThrow()
  })

  it("locks installed Store runtime inventory at 63 = 51 native + 12 local", () => {
    const scan = scanInstalledStoreSurface()
    const native = scan.discovered.filter(
      (operation) => operation.source === "native"
    ).length
    const local = scan.discovered.filter(
      (operation) => operation.source === "local"
    ).length

    expect(scan.discovered).toHaveLength(STORE_RUNTIME_EXACT_SET.total)
    expect(native).toBe(STORE_RUNTIME_EXACT_SET.native)
    expect(local).toBe(STORE_RUNTIME_EXACT_SET.local)
  })

  it("proves runtime, manifest, and executable Store M1 as separate exact sets", () => {
    const registry = createFoundationRegistry()
    const scan = scanInstalledStoreSurface()
    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )
    const evidence = verifyStoreSurfaceExactSets(
      registry,
      store?.document,
      scan.discovered
    )

    expect(evidence.runtime).toEqual({ ...STORE_RUNTIME_EXACT_SET })
    expect(evidence.manifest).toEqual({
      total: 63,
      authorized: 0,
      extended: 15,
      blocked: 17,
      outsideFrontendM1: 31,
      m1Enabled: 6,
    })
    expect(evidence.executableStoreBusinessKeys).toEqual(
      [...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS].sort()
    )
    expect(evidence.documentStoreBusinessKeys).toEqual(
      [...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS].sort()
    )
    expect(evidence.healthSupportKeys).toEqual([
      "GET /health/live",
      "GET /health/ready",
    ])
    expect(
      evidence.executableStoreBusinessKeys.every((key) =>
        key.startsWith("GET /store/") || key.startsWith("POST /store/")
      )
    ).toBe(true)
    expect(
      evidence.executableStoreBusinessKeys.some((key) =>
        key.includes("/auth/")
      )
    ).toBe(false)
  })

  it.each([
    ["PRESERVE_LEGACY", (entry: StoreSurfaceEntry) =>
      entry.runtime_policy === "PRESERVE_LEGACY"],
    ["EXTENDED disabled", (entry: StoreSurfaceEntry) =>
      entry.classification === "EXTENDED" && entry.m1_enablement === "disabled"],
    ["BLOCKED", (entry: StoreSurfaceEntry) => entry.classification === "BLOCKED"],
    ["OUTSIDE_FRONTEND_M1", (entry: StoreSurfaceEntry) =>
      entry.classification === "OUTSIDE_FRONTEND_M1"],
  ])("rejects a %s operation injected into the public Store document", (_label, predicate) => {
    const registry = createFoundationRegistry()
    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )?.document
    const discovered = scanInstalledStoreSurface().discovered
    const entry = STORE_SURFACE_MANIFEST.find(predicate)

    expect(store).toBeDefined()
    expect(entry).toBeDefined()
    const injected = structuredClone(store!)
    injected.paths[entry!.pathTemplate] = {
      [entry!.method.toLowerCase()]: { operationId: "injectedStoreOperation" },
    }

    expect(() =>
      verifyStoreSurfaceExactSets(registry, injected, discovered)
    ).toThrow(/Disabled Store operation exposed as executable M1/i)
  })

  it("rejects an unknown Store operation injected into the public document", () => {
    const registry = createFoundationRegistry()
    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )?.document
    const discovered = scanInstalledStoreSurface().discovered
    const injected = structuredClone(store!)
    injected.paths["/store/unknown-r2"] = {
      get: { operationId: "unknownStoreR2" },
    }

    expect(() =>
      verifyStoreSurfaceExactSets(registry, injected, discovered)
    ).toThrow(/Unknown Store OpenAPI business operation/i)
  })

  it("fails closed on runtime drift, duplicate/unknown manifest, and invalid exposure", () => {
    const registry = createFoundationRegistry()
    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )?.document
    const discovered = scanInstalledStoreSurface().discovered

    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, discovered.slice(1))
    ).toThrow(/runtime exact-set/i)
    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, [
        ...discovered,
        discovered[0],
      ])
    ).toThrow(/duplicate runtime/i)

    const duplicateManifest = [
      ...STORE_SURFACE_MANIFEST,
      STORE_SURFACE_MANIFEST[0],
    ]
    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, discovered, duplicateManifest)
    ).toThrow(/manifest/i)

    const invalidPreserve = STORE_SURFACE_MANIFEST.map((entry, index) =>
      index === 42
        ? {
            ...entry,
            m1_enablement: "enabled",
          }
        : entry
    ) as readonly StoreSurfaceEntry[]
    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, discovered, invalidPreserve)
    ).toThrow(/PRESERVE_LEGACY|manifest/i)
  })

  it("accepts bidirectional local and native Store coverage", () => {
    expect(() =>
      verifyCoverage(
        "store",
        completeStoreRegistry(),
        [...EXCLUDED_ROUTES, LOCAL_STORE_ROUTE]
      )
    ).not.toThrow()
  })

  it("rejects an expected local route or native extension without documentation", () => {
    const missingLocal = completeStoreRegistry()
    const localOperation = missingLocal.getOperations("store")[0]
    const withoutLocal = new ContractRegistryBundle()
    for (const documented of missingLocal.getOperations("store")) {
      if (documented !== localOperation) {
        withoutLocal.registerOperation(documented)
      }
    }
    expect(() =>
      verifyCoverage(
        "store",
        withoutLocal,
        [...EXCLUDED_ROUTES, LOCAL_STORE_ROUTE]
      )
    ).toThrow("store GET /store/local")

    const withoutNative = new ContractRegistryBundle()
    withoutNative.registerOperation(operation())
    withoutNative.registerOperation(
      nativeOperation(
        NATIVE_EXTENSIONS.find(
          (entry) => entry.path === "/store/products"
        ) as NativeExtensionEntry,
        0
      )
    )
    expect(() =>
      verifyCoverage(
        "store",
        withoutNative,
        [...EXCLUDED_ROUTES, LOCAL_STORE_ROUTE]
      )
    ).toThrow("store GET /store/products/{id}")
  })

  it.each([
    {
      label: "orphan path",
      value: operation({ path: "/store/orphan" }),
      expected: "local AST route",
    },
    {
      label: "wrong method",
      value: operation({ method: "POST" }),
      expected: "local AST route",
    },
    {
      label: "incompatible surface",
      value: operation({ surface: "admin" }),
      expected: "local AST route",
    },
    {
      label: "local classification without AST",
      value: operation({
        path: "/store/products",
        sourceClassification: "project-custom",
      }),
      expected: "local AST route",
    },
    {
      label: "native classification without manifest",
      value: operation({
        sourceClassification: "project-extension",
      }),
      expected: "native extension",
    },
  ])("rejects $label", ({ value, expected }) => {
    const registry = new ContractRegistryBundle()
    registry.registerOperation(value)

    expect(() =>
      verifyCoverage(
        "foundation",
        registry,
        [...EXCLUDED_ROUTES, LOCAL_STORE_ROUTE]
      )
    ).toThrow(expected)
  })
})

describe("Store documentation /auth exact-set (fail-closed)", () => {
  it("keeps the documentation allowlist equal to AUTH_HTTP_CONTRACT /auth entries and local auth-surface ops", () => {
    expect([...STORE_DOCUMENTATION_AUTH_OPERATIONS]).toHaveLength(6)
    expect(
      AUTH_HTTP_CONTRACT.filter((entry) => entry.path.startsWith("/auth/"))
        .map((entry) => `${entry.method} ${entry.path}`)
        .sort()
    ).toEqual([...STORE_DOCUMENTATION_AUTH_OPERATIONS].sort())
    expect(
      AUTH_SURFACE_LOCAL_OPERATIONS.map(
        (entry) => `${entry.method} ${entry.pathTemplate}`
      ).sort()
    ).toEqual([...STORE_DOCUMENTATION_AUTH_OPERATIONS].sort())
  })

  it("maps only the approved /auth exact-set onto the Store documentation surface", () => {
    for (const route of APPROVED_STORE_DOCUMENTATION_AUTH_ROUTES) {
      expect(routeBelongsToSurface(route, "store")).toBe(true)
      expect(routeSurface(route)).toBe("store")
      expect(routeBelongsToSurface(route, "admin")).toBe(false)
      expect(routeBelongsToSurface(route, "webhooks")).toBe(false)
    }
  })

  it("keeps session, callbacks, MFA, native aliases, and variants outside Store documentation", () => {
    const nativeUnsupported = AUTH_SURFACE_NATIVE_OPERATIONS.filter(
      (entry) =>
        `${entry.method} ${entry.pathTemplate}` !==
        "POST /auth/token/refresh"
    )
    expect(nativeUnsupported.length).toBe(AUTH_SURFACE_NATIVE_OPERATIONS.length - 1)

    for (const entry of nativeUnsupported) {
      const route = discoveredRoute(entry.method, entry.pathTemplate)
      expect(routeBelongsToSurface(route, "store")).toBe(false)
      expect(() => routeSurface(route)).toThrow(/incompatible surface/i)
      expect(() =>
        validateSurfacePartition("store", {
          [entry.pathTemplate]: { [entry.method.toLowerCase()]: {} },
        })
      ).toThrow(/Contract partition violation/i)
    }

    for (const route of UNSUPPORTED_AUTH_ROUTES) {
      expect(routeBelongsToSurface(route, "store")).toBe(false)
      expect(() => routeSurface(route)).toThrow(/incompatible surface/i)
      expect(() =>
        validateSurfacePartition("store", {
          [route.path]: { [route.method.toLowerCase()]: {} },
        })
      ).toThrow(/Contract partition violation/i)
    }
  })

  it("accepts Store partition for /store, /health, and the approved /auth exact-set only", () => {
    expect(() =>
      validateSurfacePartition("store", {
        "/store/customers/me": { get: {} },
        "/health/live": { get: {} },
        "/health/ready": { get: {} },
        "/auth/customer/emailpass/register": { post: {} },
        "/auth/customer/emailpass": { post: {} },
        "/auth/customer/emailpass/revoke-current-lineage": { post: {} },
        "/auth/customer/emailpass/reset-password": { post: {} },
        "/auth/customer/emailpass/update": { post: {} },
        "/auth/token/refresh": { post: {} },
      })
    ).not.toThrow()

    expect(() =>
      validateSurfacePartition("store", {
        "/auth/customer/emailpass": { post: {}, get: {} },
      })
    ).toThrow("Contract partition violation: store GET /auth/customer/emailpass")
    expect(() =>
      validateSurfacePartition("store", {
        "/auth/session": { post: {} },
      })
    ).toThrow("Contract partition violation: store POST /auth/session")
    expect(() =>
      validateSurfacePartition("store", {
        "/auth/customer/emailpass/": { post: {} },
      })
    ).toThrow("Contract partition violation: store POST /auth/customer/emailpass/")
  })

  it("requires every approved /auth operation in store coverage and rejects omitting one", () => {
    const discovered = [
      ...EXCLUDED_ROUTES,
      LOCAL_STORE_ROUTE,
      ...APPROVED_STORE_DOCUMENTATION_AUTH_ROUTES,
    ]

    expect(() =>
      verifyCoverage("store", completeStoreRegistry(), discovered)
    ).toThrow(/OpenAPI route coverage is incomplete: .*store POST \/auth\/customer\/emailpass/)

    const registry = completeStoreRegistry()
    APPROVED_STORE_DOCUMENTATION_AUTH_ROUTES.forEach((route, index) => {
      registry.registerOperation(
        operation({
          method: route.method,
          path: route.path,
          operationId: `storeAuthExact${index}`,
        })
      )
    })
    expect(() => verifyCoverage("store", registry, discovered)).not.toThrow()

    const omitted = new ContractRegistryBundle()
    for (const documented of registry.getOperations("store")) {
      if (documented.path !== "/auth/token/refresh") {
        omitted.registerOperation(documented)
      }
    }
    expect(() => verifyCoverage("store", omitted, discovered)).toThrow(
      "store POST /auth/token/refresh"
    )
  })

  it("does not treat `/auth/*` as a supported documentation prefix", () => {
    expect(
      STORE_DOCUMENTATION_AUTH_OPERATIONS.some((key) =>
        key.endsWith("/auth/*")
      )
    ).toBe(false)
    expect(
      routeBelongsToSurface(discoveredRoute("POST", "/auth/anything-else"), "store")
    ).toBe(false)
    expect(() =>
      validateSurfacePartition("store", {
        "/auth/anything-else": { post: {} },
      })
    ).toThrow(/Contract partition violation/i)
  })
})
