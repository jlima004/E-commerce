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
import { verifyCoverage } from "../coverage/verify-coverage"
import {
  NATIVE_EXTENSIONS,
  type NativeExtensionEntry,
} from "../coverage/native-routes"
import {
  ContractRegistryBundle,
  createFoundationRegistry,
} from "../registry"

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

const SCAFFOLD_ROUTES: DiscoveredRoute[] = [
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

describe("OpenAPI route coverage foundation", () => {
  it("discovers all current route files and bracket segments through the TypeScript AST", () => {
    const routes = discoverRoutes()
    expect(routes).toHaveLength(17)
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/store/carts/{id}/payment-attempts/card",
          exportKind: "function",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/hooks/stripe",
          exportKind: "const",
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

  it("allows exactly the two explicit scaffold exclusions with complete metadata", () => {
    expect(ROUTE_EXCLUSIONS.map(({ method, path: routePath }) => `${method} ${routePath}`))
      .toEqual(["GET /store/custom", "GET /admin/custom"])
    expect(() => validateRouteExclusions(discoverRoutes())).not.toThrow()

    expect(() =>
      validateRouteExclusions(discoverRoutes(), [
        { ...ROUTE_EXCLUSIONS[0], reason: "" },
        ROUTE_EXCLUSIONS[1],
      ])
    ).toThrow("missing reason")
  })

  it("keeps foundation verification independent of business route coverage", () => {
    expect(() =>
      verifyCoverage("foundation", createFoundationRegistry())
    ).not.toThrow()
    expect(() => verifyCoverage("store", createFoundationRegistry())).toThrow(
      "coverage is incomplete"
    )
  })

  it("accepts bidirectional local and native Store coverage", () => {
    expect(() =>
      verifyCoverage(
        "store",
        completeStoreRegistry(),
        [...SCAFFOLD_ROUTES, LOCAL_STORE_ROUTE]
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
        [...SCAFFOLD_ROUTES, LOCAL_STORE_ROUTE]
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
        [...SCAFFOLD_ROUTES, LOCAL_STORE_ROUTE]
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
        [...SCAFFOLD_ROUTES, LOCAL_STORE_ROUTE]
      )
    ).toThrow(expected)
  })
})
