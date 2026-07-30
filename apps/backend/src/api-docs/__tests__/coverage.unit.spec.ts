import fs from "fs"
import os from "os"
import path from "path"
import { discoverRoutes } from "../coverage/discover-routes"
import {
  ROUTE_EXCLUSIONS,
  validateRouteExclusions,
} from "../coverage/exclusions"
import { verifyCoverage } from "../coverage/verify-coverage"
import { createFoundationRegistry } from "../registry"

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
})
