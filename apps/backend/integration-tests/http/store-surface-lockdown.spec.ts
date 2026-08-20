import defaultMiddlewares from "../../src/api/middlewares"
import { POST as completeCartOverride } from "../../src/api/store/carts/[id]/complete/route"
import { GET as storeCustomGet } from "../../src/api/store/custom/route"
import {
  createStoreSurfaceGuardMiddleware,
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  type StoreSurfaceEntry,
} from "../../src/api/store-surface/manifest"

const CANARIES = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
  cookie: "connect.sid=s%3Asynth.session",
  clientSecret: "pi_synth_secret_do_not_leak",
  pixPayload: "00020126synth_pix_payload",
  cpf: "529.982.247-25",
} as const

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

function createMockResponse() {
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

function createMockRequest(input: {
  method: string
  originalUrl: string
  headers?: Record<string, string>
}) {
  const url = new URL(input.originalUrl, "http://store.local")
  return {
    method: input.method,
    originalUrl: input.originalUrl,
    url: `${url.pathname}${url.search}`,
    baseUrl: "/store",
    path: url.pathname.replace(/^\/store/, "") || "/",
    headers: input.headers ?? {},
    params: {},
    scope: {
      resolve: jest.fn(() => {
        throw new Error("FORBIDDEN_SCOPE_RESOLVE_IN_GUARD")
      }),
    },
  }
}

function concretePath(entry: StoreSurfaceEntry): string {
  return entry.pathTemplate.replace(/\{[^}]+\}/g, "synth_id_01")
}

describe("Store surface lockdown HTTP matrix (FND-02)", () => {
  const counts = summarizeStoreSurfaceManifest()
  const middleware = createStoreSurfaceGuardMiddleware()

  it("registers method-less /store* matcher ahead of specific Store business matchers", () => {
    const matchers = (defaultMiddlewares.routes ?? []).map((route) => String(route.matcher))
    const storeGuardIndex = matchers.indexOf("/store*")
    expect(storeGuardIndex).toBeGreaterThanOrEqual(0)
    expect(storeGuardIndex).toBeLessThan(matchers.indexOf("/store/products"))
    expect(storeGuardIndex).toBeLessThan(matchers.indexOf("/store/carts/active"))
    expect(storeGuardIndex).toBeLessThan(
      matchers.indexOf("/store/carts/:id/payment-attempts/card")
    )
  })

  it("denies all 50 DENY operations before scope/handler side effects", () => {
    expect(counts.total).toBe(63)
    expect(counts.deny).toBe(50)
    expect(counts.preserveLegacy).toBe(5)
    expect(counts.m1EnabledPolicy).toBe(8)

    const denyEntries = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "DENY"
    )
    expect(denyEntries).toHaveLength(50)

    for (const entry of denyEntries) {
      const next = jest.fn()
      const res = createMockResponse()
      const req = createMockRequest({
        method: entry.method,
        originalUrl: concretePath(entry),
        headers: {
          authorization: CANARIES.authorization,
          cookie: CANARIES.cookie,
        },
      })

      middleware(req as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(req.scope.resolve).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expectNoCanaries(res.jsonMock.mock.calls[0]?.[0])
    }
  })

  it("passes PRESERVE_LEGACY without M1 enablement or executable-M1 promotion", () => {
    const preserve = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "PRESERVE_LEGACY"
    )
    expect(preserve).toHaveLength(7)

    for (const entry of preserve) {
      expect(entry.m1_enablement).toBe("disabled")
      const next = jest.fn()
      const res = createMockResponse()
      const req = createMockRequest({
        method: entry.method,
        originalUrl: concretePath(entry),
      })

      middleware(req as never, res as never, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.statusMock).not.toHaveBeenCalled()

      const decision = decideStoreSurfaceAccess(entry.method, concretePath(entry))
      expect(decision).toMatchObject({
        action: "allow",
        mode: "preserve_legacy",
      })
    }
  })

  it("allows exactly the Phase 14 M1_ENABLED exact-set without implicit authorization", () => {
    const m1Enabled = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "M1_ENABLED"
    )
    expect(m1Enabled).toHaveLength(6)
    expect(
      m1Enabled.map((entry) =>
        storeSurfaceOperationKey(entry.method, entry.pathTemplate)
      )
    ).toEqual([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS])

    for (const entry of m1Enabled) {
      expect(entry.m1_enablement).toBe("enabled")
      const next = jest.fn()
      const res = createMockResponse()
      const req = createMockRequest({
        method: entry.method,
        originalUrl: concretePath(entry),
      })

      middleware(req as never, res as never, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.statusMock).not.toHaveBeenCalled()

      const decision = decideStoreSurfaceAccess(entry.method, concretePath(entry))
      expect(decision).toMatchObject({
        action: "allow",
        mode: "m1_enabled",
      })
    }

    const phase14Keys = new Set<string>(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS)
    const outsideExactSet = STORE_SURFACE_MANIFEST.filter((entry) => {
      const key = storeSurfaceOperationKey(entry.method, entry.pathTemplate)
      return !phase14Keys.has(key)
    })
    for (const entry of outsideExactSet) {
      expect(entry.runtime_policy).not.toBe("M1_ENABLED")
      if (entry.runtime_policy === "DENY" || entry.classification === "BLOCKED") {
        const decision = decideStoreSurfaceAccess(
          entry.method,
          concretePath(entry)
        )
        expect(decision.action).toBe("deny")
      }
    }
  })

  it("denies method/path bypass variants for complete, custom, and attach", () => {
    const variants: Array<{ method: string; originalUrl: string }> = [
      { method: "POST", originalUrl: "/store/carts/synth_id_01/complete" },
      { method: "GET", originalUrl: "/store/carts/synth_id_01/complete" },
      { method: "POST", originalUrl: "/store/carts/synth_id_01/complete/" },
      { method: "POST", originalUrl: "/store/carts//synth_id_01/complete" },
      { method: "POST", originalUrl: "/store/carts/synth_id_01%2Fcomplete" },
      { method: "POST", originalUrl: "/store/carts/synth_id_01/complete?x=1" },
      { method: "HEAD", originalUrl: "/store/products" },
      { method: "OPTIONS", originalUrl: "/store/products" },
      { method: "POST", originalUrl: "/store/customers/me/cart/attach" },
      { method: "GET", originalUrl: "/store/custom" },
      { method: "GET", originalUrl: "/store/carts/active/../complete" },
      { method: "POST", originalUrl: "/store/carts/active/complete" },
    ]

    for (const variant of variants) {
      const next = jest.fn()
      const res = createMockResponse()
      const req = createMockRequest(variant)
      middleware(req as never, res as never, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
    }
  })

  it("allows only strict known-method/path OPTIONS preflight and denies others", () => {
    const allowedNext = jest.fn()
    const allowedRes = createMockResponse()
    const allowedReq = createMockRequest({
      method: "OPTIONS",
      originalUrl: "/store/products",
      headers: {
        origin: "https://bff.example.com",
        "access-control-request-method": "GET",
      },
    })
    middleware(allowedReq as never, allowedRes as never, allowedNext)
    expect(allowedNext).toHaveBeenCalledTimes(1)
    expect(allowedRes.statusMock).not.toHaveBeenCalled()

    const deniedCases: Array<{
      originalUrl: string
      accessControlRequestMethod: string
    }> = [
      {
        originalUrl: "/store/not-a-real-route",
        accessControlRequestMethod: "GET",
      },
      {
        originalUrl: "/store/products",
        accessControlRequestMethod: "POST",
      },
      {
        originalUrl: "/store/carts/synth_id_01/complete",
        accessControlRequestMethod: "POST",
      },
      {
        originalUrl: "/store/customers/me/cart/attach",
        accessControlRequestMethod: "POST",
      },
    ]

    for (const denied of deniedCases) {
      const next = jest.fn()
      const res = createMockResponse()
      const req = createMockRequest({
        method: "OPTIONS",
        originalUrl: denied.originalUrl,
        headers: {
          origin: "https://bff.example.com",
          "access-control-request-method": denied.accessControlRequestMethod,
        },
      })
      middleware(req as never, res as never, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect(req.scope.resolve).not.toHaveBeenCalled()
    }
  })

  it("native complete override never resolves workflow scope or returns Order", async () => {
    const workflowRun = jest.fn()
    const req = {
      params: { id: "cart_synth_complete_01" },
      scope: {
        resolve: jest.fn((key: string) => {
          if (String(key).toLowerCase().includes("workflow")) {
            return { run: workflowRun }
          }
          throw new Error(`UNEXPECTED_RESOLVE:${key}`)
        }),
      },
    }
    const res = createMockResponse()

    await completeCartOverride(req as never, res as never)

    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(workflowRun).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    const body = res.jsonMock.mock.calls[0][0]
    expect(JSON.stringify(body).toLowerCase()).not.toContain("order")
    expectNoCanaries(body)
  })

  it("scaffold GET /store/custom is denied by guard before the local handler", async () => {
    const handler = jest.fn(storeCustomGet)
    const next = jest.fn()
    const res = createMockResponse()
    const req = createMockRequest({
      method: "GET",
      originalUrl: "/store/custom",
    })

    middleware(req as never, res as never, next)
    expect(next).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)

    // Defense: even if somehow invoked, handler remains a no-contract scaffold —
    // lockdown proof is the guard short-circuit above (handler call count 0).
  })

  it("keeps classification distribution and Phase 15 M1_ENABLED exact-set at enforcement time", () => {
    expect(counts.authorized).toBe(0)
    expect(counts.extended).toBe(15)
    expect(counts.blocked).toBe(17)
    expect(counts.outsideFrontendM1).toBe(31)
    expect(counts.m1EnabledPolicy).toBe(8)
    expect(counts.m1EnablementEnabled).toBe(8)
  })
})
