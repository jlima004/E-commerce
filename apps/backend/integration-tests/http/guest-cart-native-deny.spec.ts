import { existsSync } from "fs"
import { resolve } from "path"
import {
  ROUTE_EXCLUSIONS,
  EXPECTED_EXCLUSION_KEYS,
} from "../../src/api-docs/coverage/exclusions"
import { STORE_CART_BFF_PROTECTED_OPERATIONS } from "../../src/api/store/carts/bff-protected-operations"
import {
  createStoreSurfaceGuardMiddleware,
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"
import {
  lookupStoreSurfaceEntry,
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_M1_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE16_CART_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  validateStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"
import { GUEST_CART_CAPABILITY_HEADER } from "../../src/modules/guest-cart-capability/types"
import defaultMiddlewares, {
  customerAuthAccessGuardMiddleware,
  customerAuthBffServiceGuardMiddleware,
} from "../../src/api/middlewares"
import * as Sentry from "@sentry/node"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import {
  assertPublicSurfaceDoesNotEncodeSecrets,
  createGuestCartLeakageCollector,
  PHASE16_CUSTOMER_JWT_CANARY,
  PHASE16_GUEST_CAPABILITY_CANARY,
  PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
  readStoreOpenApiDocumentForLeakageScan,
  unusedSinkEvidence,
} from "../helpers/guest-cart-leakage"

function response() {
  const json = jest.fn().mockReturnThis()
  const status = jest.fn().mockReturnThis()
  return {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      this.statusCode = code
      status(code)
      return this
    },
    json(body: unknown) {
      json(body)
      this.headersSent = true
      return this
    },
    statusMock: status,
    jsonMock: json,
  }
}

function request(method: string, originalUrl: string) {
  return {
    method,
    originalUrl,
    url: originalUrl,
    baseUrl: "/store",
    path: originalUrl.replace(/^\/store/, ""),
    headers: {},
    scope: { resolve: jest.fn() },
  }
}

function expectSurfaceDenied(method: string, path: string) {
  expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
  const middleware = createStoreSurfaceGuardMiddleware()
  const next = jest.fn()
  const req = request(method, path)
  const res = response()

  middleware(req as never, res as never, next)

  expect(next).not.toHaveBeenCalled()
  expect(req.scope.resolve).not.toHaveBeenCalled()
  expect(res.statusCode).toBe(404)
  expect(res.jsonMock).toHaveBeenCalledWith({
    type: "not_found",
    message: "Not Found",
  })
}

function expectSurfaceAllowedM1(method: string, path: string) {
  expect(decideStoreSurfaceAccess(method, path).action).toBe("allow")
}

function phase16DeniedRequestHeaders() {
  return {
    authorization: `Bearer ${PHASE16_CUSTOMER_JWT_CANARY}`,
    [GUEST_CART_CAPABILITY_HEADER]: PHASE16_GUEST_CAPABILITY_CANARY,
    "idempotency-key": PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
    "if-match": '"1"',
  }
}

const NATIVE_DENY_LEAKAGE_RESOLVE_KEYS = [
  Modules.CACHE,
  Modules.EVENT_BUS,
  Modules.WORKFLOW_ENGINE,
  Modules.ORDER,
  ContainerRegistrationKeys.LOGGER,
  "locking",
  ANALYTICS_EVENT_LOG_MODULE,
  "analytics_event_log",
] as const

function countResolveCalls(
  resolveSpy: jest.SpyInstance,
  keys: readonly unknown[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of keys) {
    const label = String(key)
    counts[label] = resolveSpy.mock.calls.filter(
      ([resolved]) => resolved === key
    ).length
  }
  return counts
}

function recordNativeDenyLeakageSnapshots(
  collector: ReturnType<typeof createGuestCartLeakageCollector>,
  res: ReturnType<typeof response>,
  options: {
    method: string
    path: string
    next: jest.Mock
    req: ReturnType<typeof request>
    resolveSpy: jest.SpyInstance
    sentryCaptureExceptionSpy: jest.SpyInstance
    sentryCaptureMessageSpy: jest.SpyInstance
    consoleDeltas: {
      console_log: number
      console_info: number
      console_warn: number
      console_error: number
    }
  }
) {
  const attachExclusion = ROUTE_EXCLUSIONS.find(
    (item) =>
      item.method === "POST" &&
      item.path === "/store/customers/me/cart/attach"
  )
  const attachEntry = lookupStoreSurfaceEntry(
    "POST",
    "/store/customers/me/cart/attach"
  )
  const resolveCounts = countResolveCalls(
    options.resolveSpy,
    NATIVE_DENY_LEAKAGE_RESOLVE_KEYS
  )

  collector.record("fixtures_snapshots", {
    body: res.jsonMock.mock.calls[0]?.[0],
    statusCode: res.statusCode,
    path: options.path,
    method: options.method,
    attachExclusion,
    attachManifestEntry: attachEntry,
    manifestMergeEntry: lookupStoreSurfaceEntry(
      "POST",
      "/store/customers/me/cart/merge"
    ),
    manifestAckEntry: lookupStoreSurfaceEntry(
      "POST",
      "/store/carts/{id}/review/acknowledge"
    ),
  })
  collector.record("openapi", readStoreOpenApiDocumentForLeakageScan())
  collector.record(
    "db_plaintext",
    unusedSinkEvidence({
      next: options.next.mock.calls.length,
      scope_resolve: options.resolveSpy.mock.calls.length,
      order: resolveCounts[String(Modules.ORDER)] ?? 0,
    })
  )
  collector.record(
    "logs",
    unusedSinkEvidence({
      logger_resolve:
        resolveCounts[String(ContainerRegistrationKeys.LOGGER)] ?? 0,
      console_log: options.consoleDeltas.console_log,
      console_info: options.consoleDeltas.console_info,
      console_warn: options.consoleDeltas.console_warn,
      console_error: options.consoleDeltas.console_error,
    })
  )
  collector.record("persisted_provider_payload", {
    nextCalled: options.next.mock.calls.length,
    scopeResolveCalled: options.resolveSpy.mock.calls.length,
  })
  collector.record(
    "redis_keys_jobs",
    unusedSinkEvidence({
      cache: resolveCounts[String(Modules.CACHE)] ?? 0,
      event_bus: resolveCounts[String(Modules.EVENT_BUS)] ?? 0,
      workflow_engine: resolveCounts[String(Modules.WORKFLOW_ENGINE)] ?? 0,
      locking: resolveCounts.locking ?? 0,
    })
  )
  collector.record(
    "sentry",
    unusedSinkEvidence({
      captureException: options.sentryCaptureExceptionSpy.mock.calls.length,
      captureMessage: options.sentryCaptureMessageSpy.mock.calls.length,
    })
  )
  collector.record(
    "analytics",
    unusedSinkEvidence({
      analytics_event_log_module:
        resolveCounts[String(ANALYTICS_EVENT_LOG_MODULE)] ?? 0,
      analytics_event_log: resolveCounts.analytics_event_log ?? 0,
    })
  )
}

describe("Guest cart native bypass denial (D15-08 / Phase 16 exact-set)", () => {
  const nativeDenyOperations = [
    ["POST", "/store/carts"],
    ["GET", "/store/carts/cart_native_deny_01"],
    ["POST", "/store/carts/cart_native_deny_01/complete"],
    ["POST", "/store/carts/cart_native_deny_01/shipping-methods"],
    ["POST", "/store/carts/cart_native_deny_01/customer"],
  ] as const

  it.each(nativeDenyOperations)("mantém %s %s em DENY", (method, path) => {
    expectSurfaceDenied(method, path)
  })

  it("não confunde as quatro rotas cart M1 com identidade nativa duplicada", () => {
    for (const [method, path] of [
      ["POST", "/store/carts/cart_01/line-items"],
      ["POST", "/store/carts/cart_01/line-items/line_01"],
      ["DELETE", "/store/carts/cart_01/line-items/line_01"],
      ["DELETE", "/store/carts/cart_01/line-items"],
    ] as const) {
      expectSurfaceAllowedM1(method, path)
    }
  })

  it("permite POST /store/customers/me/cart/merge exacto como M1_ENABLED (Phase 16)", () => {
    expectSurfaceAllowedM1("POST", "/store/customers/me/cart/merge")
    const entry = lookupStoreSurfaceEntry(
      "POST",
      "/store/customers/me/cart/merge"
    )
    expect(entry?.runtime_policy).toBe("M1_ENABLED")
    expect(entry?.m1_enablement).toBe("enabled")
    expect(entry?.owner_phase).toBe("16")
  })

  it("permite POST /store/carts/:id/review/acknowledge exacto como M1_ENABLED (Phase 16)", () => {
    const path = "/store/carts/cart_native_deny_01/review/acknowledge"
    expectSurfaceAllowedM1("POST", path)
    const entry = lookupStoreSurfaceEntry(
      "POST",
      "/store/carts/{id}/review/acknowledge"
    )
    expect(entry?.runtime_policy).toBe("M1_ENABLED")
    expect(entry?.m1_enablement).toBe("enabled")
    expect(entry?.owner_phase).toBe("16")
  })

  it.each([
    ["GET", "/store/customers/me/cart/merge"],
    ["PUT", "/store/customers/me/cart/merge"],
    ["PATCH", "/store/customers/me/cart/merge"],
    ["DELETE", "/store/customers/me/cart/merge"],
    ["HEAD", "/store/customers/me/cart/merge"],
    ["GET", "/store/carts/cart_native_deny_01/review/acknowledge"],
    ["PUT", "/store/carts/cart_native_deny_01/review/acknowledge"],
    ["PATCH", "/store/carts/cart_native_deny_01/review/acknowledge"],
    ["DELETE", "/store/carts/cart_native_deny_01/review/acknowledge"],
    ["HEAD", "/store/carts/cart_native_deny_01/review/acknowledge"],
  ] as const)(
    "nega método incorreto %s %s com 404 não enumerante",
    (method, path) => {
      expectSurfaceDenied(method, path)
    }
  )

  it.each([
    ["POST", "/store/customers/me/cart/merge-extra"],
    ["POST", "/store/customers/me/cart/merge/foo"],
    ["POST", "/store/customers/me/cart/merge/"],
    ["POST", "/store/customers/me/cart/Merge"],
    ["POST", "/store/customers/me/cart"],
  ] as const)("nega vizinho de merge %s %s", (method, path) => {
    expectSurfaceDenied(method, path)
  })

  it.each([
    ["POST", "/store/carts/cart_native_deny_01/review/acknowledge-extra"],
    ["POST", "/store/carts/cart_native_deny_01/review/foo/acknowledge"],
    ["POST", "/store/carts/cart_native_deny_01/acknowledge/foo"],
    ["POST", "/store/carts/cart_native_deny_01/acknowledge"],
    ["POST", "/store/carts/cart_native_deny_01/review"],
    ["GET", "/store/carts/cart_native_deny_01/review/acknowledge"],
  ] as const)("nega vizinho de acknowledge %s %s", (method, path) => {
    expectSurfaceDenied(method, path)
  })

  it("mantém attach fora do M1 como facade PRESERVE_LEGACY", () => {
    const entry = lookupStoreSurfaceEntry(
      "POST",
      "/store/customers/me/cart/attach"
    )
    expect(entry?.classification).toBe("OUTSIDE_FRONTEND_M1")
    expect(entry?.runtime_policy).toBe("PRESERVE_LEGACY")
    expect(entry?.m1_enablement).not.toBe("enabled")
    expect(entry?.openapi_m1_expectation).toBe("exclude")
    expect(
      decideStoreSurfaceAccess("POST", "/store/customers/me/cart/attach")
    ).toMatchObject({ action: "allow", mode: "preserve_legacy" })
  })

  it("attach permanece rota controlada deprecada com exclusão Phase 16", () => {
    const attachRoute = resolve(
      process.cwd(),
      "src/api/store/customers/me/cart/attach/route.ts"
    )
    expect(existsSync(attachRoute)).toBe(true)

    const attachEntry = lookupStoreSurfaceEntry(
      "POST",
      "/store/customers/me/cart/attach"
    )
    expect(attachEntry?.runtime_policy).toBe("PRESERVE_LEGACY")
    expect(attachEntry?.classification).toBe("OUTSIDE_FRONTEND_M1")

    const attachExclusion = ROUTE_EXCLUSIONS.find(
      (item) =>
        item.method === "POST" &&
        item.path === "/store/customers/me/cart/attach"
    )
    expect(attachExclusion).toBeDefined()
    expect(attachExclusion?.owner).toContain("Phase 16")
  })

  it.each([
    ["POST", "/store/cart/link"],
    ["POST", "/store/carts/cart_native_deny_01/merge"],
    ["POST", "/store/carts/cart_native_deny_01/attach"],
    ["POST", "/store/customer/attach"],
    ["POST", "/store/merge/acknowledge"],
    ["POST", "/store/review/ack"],
  ] as const)("nega alias desconhecido %s %s", (method, path) => {
    expectSurfaceDenied(method, path)
  })

  it("M1 exact-set deriva do manifest vivo com exatamente duas adições Phase 16", () => {
    const counts = summarizeStoreSurfaceManifest()
    const m1Entries = STORE_SURFACE_MANIFEST.filter(
      (entry) =>
        entry.runtime_policy === "M1_ENABLED" && entry.m1_enablement === "enabled"
    )
    const m1Keys = m1Entries.map((entry) =>
      storeSurfaceOperationKey(entry.method, entry.pathTemplate)
    )
    const prior = [
      ...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
      ...STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS,
    ]
    const phase16 = [...STORE_SURFACE_PHASE16_CART_ENABLED_OPERATIONS]
    const additions = m1Keys.filter((key) => !prior.includes(key))

    expect(additions.sort()).toEqual([...phase16].sort())
    expect(additions).toHaveLength(2)
    expect(m1Keys.sort()).toEqual([...prior, ...phase16].sort())
    expect(m1Keys).not.toContain("POST /store/customers/me/cart/attach")
    expect(counts.m1EnabledPolicy).toBe(m1Entries.length)
    expect(counts.m1EnabledPolicy).toBe(14)
    expect(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS).toHaveLength(6)
    expect(STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS).toHaveLength(6)
  })

  it("BFF tuple fechado tem 8 entradas Phase 15(6)+Phase 16(2) sem curinga", () => {
    expect(STORE_CART_BFF_PROTECTED_OPERATIONS).toHaveLength(8)
    expect(STORE_CART_BFF_PROTECTED_OPERATIONS).toEqual([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/:id/line-items",
      "POST /store/carts/:id/line-items/:line_id",
      "DELETE /store/carts/:id/line-items/:line_id",
      "DELETE /store/carts/:id/line-items",
      "POST /store/customers/me/cart/merge",
      "POST /store/carts/:id/review/acknowledge",
    ])

    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      expect(operation).not.toMatch(/[*?]/)
      expect(operation).not.toMatch(/^\/store\*/)
    }

    const neighborPaths = [
      "/store/customers/me/cart/merge-extra",
      "/store/carts/:id/review/acknowledge-extra",
      "/store/customers/me/cart/attach",
    ]
    for (const neighbor of neighborPaths) {
      expect(
        STORE_CART_BFF_PROTECTED_OPERATIONS.some((operation) =>
          operation.endsWith(neighbor.replace("/store", ""))
        )
      ).toBe(false)
    }

    const routes = (defaultMiddlewares.routes ?? []) as Array<{
      matcher: unknown
      method?: unknown
      middlewares?: unknown[]
    }>

    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      const matchingRoutes = routes.filter((route) => {
        const matchesPath = String(route.matcher) === path
        const matchesMethod =
          route.method === undefined ||
          (Array.isArray(route.method) &&
            route.method.includes(method as "GET" | "POST" | "DELETE")) ||
          route.method === method
        return matchesMethod && matchesPath
      })
      expect(matchingRoutes.length).toBeGreaterThan(0)
      for (const route of matchingRoutes) {
        expect(String(route.matcher)).toBe(path)
        expect(String(route.matcher)).not.toMatch(/[*?^$[]/)
      }
    }
  })

  it("merge e ACK montam BFF + Customer bearer; Phase 15 seis permanecem BFF-only", () => {
    const routes = (defaultMiddlewares.routes ?? []) as Array<{
      matcher: unknown
      method?: unknown
      middlewares?: unknown[]
    }>

    const phase16Matchers = [
      "/store/customers/me/cart/merge",
      "/store/carts/:id/review/acknowledge",
    ]
    const phase15Matchers = [
      "/store/carts/active",
      "/store/carts/:id/line-items",
      "/store/carts/:id/line-items/:line_id",
    ]

    for (const matcher of phase16Matchers) {
      const route = routes.find((item) => String(item.matcher) === matcher)
      expect(route).toBeDefined()
      expect(route?.middlewares).toHaveLength(2)
      expect(route?.middlewares?.[0]).toBe(customerAuthBffServiceGuardMiddleware)
      expect(typeof route?.middlewares?.[1]).toBe("function")
      expect(route?.middlewares).not.toContain(customerAuthAccessGuardMiddleware)
    }

    for (const matcher of phase15Matchers) {
      const route = routes.find((item) => String(item.matcher) === matcher)
      expect(route).toBeDefined()
      expect(route?.middlewares).toEqual([customerAuthBffServiceGuardMiddleware])
      expect(route?.middlewares).not.toContain(customerAuthAccessGuardMiddleware)
    }
  })

  it("exclusão attach: owner Phase 16, reason deprecated+outside M1, reviewTrigger humano sem data", () => {
    const attachExclusion = ROUTE_EXCLUSIONS.find(
      (item) =>
        item.method === "POST" &&
        item.path === "/store/customers/me/cart/attach"
    )
    expect(attachExclusion).toBeDefined()
    expect(attachExclusion?.owner).toContain("Phase 16")
    expect(attachExclusion?.reason.toLowerCase()).toContain("deprecated")
    expect(attachExclusion?.reason.toLowerCase()).toContain("outside")
    expect(attachExclusion?.reason.toLowerCase()).toContain("m1")
    expect(attachExclusion?.reviewTrigger.toLowerCase()).toContain("human")
    expect(attachExclusion?.reviewTrigger).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(attachExclusion?.reviewTrigger).not.toMatch(/2026/)
    expect(attachExclusion?.reviewTrigger).not.toMatch(/Q[1-4]/i)
    expect(attachExclusion?.reviewTrigger).not.toMatch(/by \d{4}/i)
    expect(attachExclusion?.reviewTrigger).not.toMatch(/remove on/i)
    expect(ROUTE_EXCLUSIONS).toHaveLength(4)
    expect(EXPECTED_EXCLUSION_KEYS.size).toBe(4)
  })

  it("validateStoreSurfaceManifest() retorna lista vazia", () => {
    expect(validateStoreSurfaceManifest()).toEqual([])
  })

  it("STORE_SURFACE_M1_ENABLED_OPERATIONS permanece alinhado ao manifest", () => {
    const enabledFromManifest = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "M1_ENABLED"
    ).map((entry) => storeSurfaceOperationKey(entry.method, entry.pathTemplate))

    expect(enabledFromManifest).toEqual([...STORE_SURFACE_M1_ENABLED_OPERATIONS])
  })

  describe("Phase 16 eight-sink leakage (C7–C8)", () => {
    it("C7 native denial POST /store/carts/:id/customer keeps Phase 16 canaries out of sinks", () => {
      const middleware = createStoreSurfaceGuardMiddleware()
      const next = jest.fn()
      const path = "/store/carts/cart_native_deny_01/customer"
      const req = {
        ...request("POST", path),
        headers: phase16DeniedRequestHeaders(),
      }
      const res = response()
      const resolveSpy = jest.spyOn(req.scope, "resolve")
      const sentryCaptureExceptionSpy = jest.spyOn(Sentry, "captureException")
      const sentryCaptureMessageSpy = jest.spyOn(Sentry, "captureMessage")
      const consoleLogSpy = jest.spyOn(console, "log")
      const consoleInfoSpy = jest.spyOn(console, "info")
      const consoleWarnSpy = jest.spyOn(console, "warn")
      const consoleErrorSpy = jest.spyOn(console, "error")
      const logsBefore = {
        log: consoleLogSpy.mock.calls.length,
        info: consoleInfoSpy.mock.calls.length,
        warn: consoleWarnSpy.mock.calls.length,
        error: consoleErrorSpy.mock.calls.length,
      }

      try {
        middleware(req as never, res as never, next)

        expect(next).not.toHaveBeenCalled()
        expect(req.scope.resolve).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(404)

        const collector = createGuestCartLeakageCollector()
        recordNativeDenyLeakageSnapshots(collector, res, {
          method: "POST",
          path,
          next,
          req,
          resolveSpy,
          sentryCaptureExceptionSpy,
          sentryCaptureMessageSpy,
          consoleDeltas: {
            console_log: consoleLogSpy.mock.calls.length - logsBefore.log,
            console_info: consoleInfoSpy.mock.calls.length - logsBefore.info,
            console_warn: consoleWarnSpy.mock.calls.length - logsBefore.warn,
            console_error: consoleErrorSpy.mock.calls.length - logsBefore.error,
          },
        })
        collector.assertExactEightSinksNoCanaries()
        assertPublicSurfaceDoesNotEncodeSecrets({
          body: res.jsonMock.mock.calls[0]?.[0],
          statusCode: res.statusCode,
        })
      } finally {
        resolveSpy.mockRestore()
        sentryCaptureExceptionSpy.mockRestore()
        sentryCaptureMessageSpy.mockRestore()
        consoleLogSpy.mockRestore()
        consoleInfoSpy.mockRestore()
        consoleWarnSpy.mockRestore()
        consoleErrorSpy.mockRestore()
      }
    })

    it.each([
      ["POST", "/store/cart/link"],
      ["POST", "/store/carts/cart_native_deny_01/merge"],
      ["POST", "/store/carts/cart_native_deny_01/attach"],
      ["POST", "/store/customer/attach"],
      ["POST", "/store/merge/acknowledge"],
      ["POST", "/store/review/ack"],
    ] as const)(
      "C8 prefix/unknown denial %s %s keeps Phase 16 canaries out of sinks",
      (method, path) => {
        const middleware = createStoreSurfaceGuardMiddleware()
        const next = jest.fn()
        const req = {
          ...request(method, path),
          headers: phase16DeniedRequestHeaders(),
        }
        const res = response()
        const resolveSpy = jest.spyOn(req.scope, "resolve")
        const sentryCaptureExceptionSpy = jest.spyOn(Sentry, "captureException")
        const sentryCaptureMessageSpy = jest.spyOn(Sentry, "captureMessage")
        const consoleLogSpy = jest.spyOn(console, "log")
        const consoleInfoSpy = jest.spyOn(console, "info")
        const consoleWarnSpy = jest.spyOn(console, "warn")
        const consoleErrorSpy = jest.spyOn(console, "error")
        const logsBefore = {
          log: consoleLogSpy.mock.calls.length,
          info: consoleInfoSpy.mock.calls.length,
          warn: consoleWarnSpy.mock.calls.length,
          error: consoleErrorSpy.mock.calls.length,
        }

        try {
          middleware(req as never, res as never, next)

          expect(next).not.toHaveBeenCalled()
          expect(req.scope.resolve).not.toHaveBeenCalled()
          expect(res.statusCode).toBe(404)

          const collector = createGuestCartLeakageCollector()
          recordNativeDenyLeakageSnapshots(collector, res, {
            method,
            path,
            next,
            req,
            resolveSpy,
            sentryCaptureExceptionSpy,
            sentryCaptureMessageSpy,
            consoleDeltas: {
              console_log: consoleLogSpy.mock.calls.length - logsBefore.log,
              console_info: consoleInfoSpy.mock.calls.length - logsBefore.info,
              console_warn: consoleWarnSpy.mock.calls.length - logsBefore.warn,
              console_error:
                consoleErrorSpy.mock.calls.length - logsBefore.error,
            },
          })
          collector.assertExactEightSinksNoCanaries()
          assertPublicSurfaceDoesNotEncodeSecrets({
            body: res.jsonMock.mock.calls[0]?.[0],
            statusCode: res.statusCode,
          })
        } finally {
          resolveSpy.mockRestore()
          sentryCaptureExceptionSpy.mockRestore()
          sentryCaptureMessageSpy.mockRestore()
          consoleLogSpy.mockRestore()
          consoleInfoSpy.mockRestore()
          consoleWarnSpy.mockRestore()
          consoleErrorSpy.mockRestore()
        }
      }
    )
  })
})
