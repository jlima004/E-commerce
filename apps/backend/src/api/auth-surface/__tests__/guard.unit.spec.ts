import {
  AUTH_SURFACE_MANIFEST,
  AUTH_SURFACE_NATIVE_OPERATIONS,
  AUTH_SURFACE_LOCAL_OPERATIONS,
  type AuthSurfaceEntry,
} from "../manifest"
import {
  createAuthSurfaceGuardMiddleware,
  decideAuthSurfaceAccess,
  normalizeAuthRequestPath,
} from "../guard"
import defaultMiddlewares from "../../middlewares"

describe("Phase 14 auth surface guard", () => {
  const nativeExpected = [
    ["GET", "/auth/{actor_type}/{auth_provider}"],
    ["POST", "/auth/{actor_type}/{auth_provider}"],
    ["GET", "/auth/{actor_type}/{auth_provider}/callback"],
    ["POST", "/auth/{actor_type}/{auth_provider}/callback"],
    ["POST", "/auth/{actor_type}/{auth_provider}/register"],
    ["POST", "/auth/{actor_type}/{auth_provider}/reset-password"],
    ["POST", "/auth/{actor_type}/{auth_provider}/update"],
    ["POST", "/auth/session"],
    ["DELETE", "/auth/session"],
    ["POST", "/auth/token/refresh"],
    ["POST", "/auth/verification/request"],
    ["POST", "/auth/verification/confirm"],
    ["POST", "/auth/mfa/challenges/{id}/verify"],
    ["GET", "/auth/mfa/factors"],
    ["POST", "/auth/mfa/factors"],
    ["DELETE", "/auth/mfa/factors/{id}"],
    ["POST", "/auth/mfa/factors/{id}/verify"],
    ["POST", "/auth/mfa/recovery-codes"],
  ]

  const localExpected = [
    ["POST", "/auth/customer/emailpass/register", "14-15"],
    ["POST", "/auth/customer/emailpass", "14-15"],
    ["POST", "/auth/token/refresh", "14-11"],
    ["POST", "/auth/customer/emailpass/revoke-current-lineage", "14-11"],
    ["POST", "/auth/customer/emailpass/reset-password", "14-16"],
    ["POST", "/auth/customer/emailpass/update", "14-16"],
  ]

  it("espelha o exact-set instalado de 18 operacoes nativas", () => {
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.map(({ method, pathTemplate }) => [
        method,
        pathTemplate,
      ])
    ).toEqual(nativeExpected)
  })

  it("enumera exatamente seis overrides locais com owners", () => {
    expect(
      AUTH_SURFACE_LOCAL_OPERATIONS.map(
        ({ method, pathTemplate, ownerPlan }) => [method, pathTemplate, ownerPlan]
      )
    ).toEqual(localExpected)
  })

  it("mantem as 24 entradas em DENY neste plano", () => {
    expect(AUTH_SURFACE_MANIFEST).toHaveLength(24)
    expect(AUTH_SURFACE_MANIFEST.filter((entry) => entry.origin === "native")).toHaveLength(18)
    expect(AUTH_SURFACE_MANIFEST.filter((entry) => entry.origin === "local")).toHaveLength(6)
    expect(AUTH_SURFACE_MANIFEST.every((entry) => entry.runtimePolicy === "DENY")).toBe(true)

    for (const entry of AUTH_SURFACE_MANIFEST) {
      const concrete = entry.pathTemplate
        .replace("{actor_type}", "customer")
        .replace("{auth_provider}", "emailpass")
        .replace("{id}", "synthetic-id")
      expect(decideAuthSurfaceAccess(entry.method, concrete).action).toBe("deny")
    }
  })

  it("rejeita percent encoding, slash/case aliases, HEAD e OPTIONS", () => {
    const invalidPaths = [
      "/auth/customer/emailpass/",
      "/auth//customer/emailpass",
      "/auth/customer%2Femailpass",
      "/Auth/customer/emailpass",
      "/api/auth/customer/emailpass",
      "/auth/customer/../emailpass",
    ]

    for (const path of invalidPaths) {
      expect(normalizeAuthRequestPath(path)).toBeNull()
      expect(decideAuthSurfaceAccess("POST", path).action).toBe("deny")
    }
    expect(decideAuthSurfaceAccess("HEAD", "/auth/customer/emailpass").action).toBe("deny")
    expect(decideAuthSurfaceAccess("OPTIONS", "/auth/customer/emailpass").action).toBe("deny")
  })

  it("nega session, callback, MFA, verification e refresh nativos", () => {
    const denied = [
      ["POST", "/auth/session"],
      ["DELETE", "/auth/session"],
      ["GET", "/auth/customer/emailpass/callback"],
      ["POST", "/auth/mfa/challenges/synthetic-id/verify"],
      ["POST", "/auth/verification/request"],
      ["POST", "/auth/verification/confirm"],
      ["POST", "/auth/token/refresh"],
      ["POST", "/auth/user/emailpass"],
      ["POST", "/auth/customer/github"],
    ]

    for (const [method, path] of denied) {
      expect(decideAuthSurfaceAccess(method, path).action).toBe("deny")
    }
  })

  it("permite somente override local exato explicitamente PHASE14_ENABLED", () => {
    const localEnabled: AuthSurfaceEntry = {
      ...AUTH_SURFACE_LOCAL_OPERATIONS[1],
      runtimePolicy: "PHASE14_ENABLED",
    }
    const nativeEnabled: AuthSurfaceEntry = {
      ...AUTH_SURFACE_NATIVE_OPERATIONS[1],
      runtimePolicy: "PHASE14_ENABLED",
    }

    expect(
      decideAuthSurfaceAccess("POST", "/auth/customer/emailpass", [
        nativeEnabled,
        localEnabled,
      ])
    ).toEqual({ action: "allow", entry: localEnabled })
    expect(
      decideAuthSurfaceAccess("POST", "/auth/admin/emailpass", [nativeEnabled])
        .action
    ).toBe("deny")
  })

  it("curto-circuita 404 antes de next ou container", () => {
    const middleware = createAuthSurfaceGuardMiddleware()
    const next = jest.fn()
    const status = jest.fn().mockReturnThis()
    const json = jest.fn().mockReturnThis()
    const req = {
      method: "POST",
      originalUrl: "/auth/customer/emailpass",
      baseUrl: "/auth",
      path: "/customer/emailpass",
      headers: {},
      get scope() {
        throw new Error("container must not be resolved")
      },
    }
    const res = { status, json, headersSent: false }

    middleware(req as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({ type: "not_found", message: "Not Found" })
  })

  it("registra o matcher method-less /auth* antes de handlers", () => {
    const routes = defaultMiddlewares.routes ?? []
    const guardIndex = routes.findIndex((route) => String(route.matcher) === "/auth*")
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(routes[guardIndex]?.method).toBeUndefined()
    expect(routes[guardIndex]?.middlewares).toContainEqual(
      expect.any(Function)
    )
  })
})
