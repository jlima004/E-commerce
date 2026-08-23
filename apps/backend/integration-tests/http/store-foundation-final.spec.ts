import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { POST as completeCartOverride } from "../../src/api/store/carts/[id]/complete/route"
import {
  createStoreSurfaceGuardMiddleware,
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_M1_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  validateStoreSurfaceManifest,
  type StoreSurfaceEntry,
} from "../../src/api/store-surface/manifest"
import { createFoundationRegistry } from "../../src/api-docs/registry"
import { buildContracts } from "../../src/api-docs/generation/build-documents"
import { verifyStoreSurfaceExactSets } from "../../src/api-docs/coverage/verify-coverage"
import { scanInstalledStoreSurface } from "../../scripts/store-surface/scan-installed"

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      this.headersSent = true
      return this
    },
  }
  return res as unknown as MedusaResponse & typeof res
}

function request(method: string, originalUrl: string, headers = {}) {
  const url = new URL(originalUrl, "http://store.local")
  return {
    method,
    originalUrl,
    url: `${url.pathname}${url.search}`,
    baseUrl: "/store",
    path: url.pathname.replace(/^\/store/, "") || "/",
    headers,
    params: {},
    scope: { resolve: jest.fn() },
  } as unknown as MedusaRequest & {
    scope: { resolve: jest.Mock }
  }
}

function concretePath(entry: StoreSurfaceEntry): string {
  return entry.pathTemplate.replace(/\{[^}]+\}/g, "synth_id_13_07")
}

describe("Phase 13 final Store foundation gate", () => {
  it("locks runtime, manifest and executable OpenAPI as three independent exact sets", () => {
    const scan = scanInstalledStoreSurface()
    const registry = createFoundationRegistry()
    const contracts = buildContracts(registry)
    const store = contracts.find((contract) => contract.surface === "store")
    const evidence = verifyStoreSurfaceExactSets(
      registry,
      store?.document,
      scan.discovered
    )
    const counts = summarizeStoreSurfaceManifest()

    expect(scan.ok).toBe(true)
    expect(scan.duplicatesInstalled).toEqual([])
    expect(scan.missingFromManifest).toEqual([])
    expect(scan.missingFromInstalled).toEqual([])
    expect(evidence.runtime).toEqual({ native: 51, local: 13, total: 64 })
    expect(evidence.manifest).toEqual({
      total: 64,
      authorized: 0,
      extended: 16,
      blocked: 17,
      outsideFrontendM1: 31,
      m1Enabled: 12,
    })
    expect(counts.m1EnabledPolicy).toBe(12)
    expect(validateStoreSurfaceManifest()).toEqual([])
    expect(evidence.executableStoreBusinessKeys).toEqual(
      [...STORE_SURFACE_M1_ENABLED_OPERATIONS].sort()
    )
    expect(evidence.documentStoreBusinessKeys).toEqual(
      [...STORE_SURFACE_M1_ENABLED_OPERATIONS].sort()
    )
    expect(
      evidence.executableStoreBusinessKeys.every(
        (key) =>
          key.startsWith("GET /store/") ||
          key.startsWith("POST /store/") ||
          key.startsWith("DELETE /store/")
      )
    ).toBe(true)
    expect(
      evidence.documentStoreBusinessKeys.some((key) => key.includes("/auth/"))
    ).toBe(false)
    expect(evidence.healthSupportKeys).toEqual([
      "GET /health/live",
      "GET /health/ready",
    ])
    expect(store?.document.info.version).toBe("1.1.0")
    expect(
      contracts.find((contract) => contract.surface === "admin")?.document.info
        .version
    ).toBe("1.0.0")
    expect(
      contracts.find((contract) => contract.surface === "webhooks")?.document.info
        .version
    ).toBe("1.0.0")

    const m1EnabledKeys = new Set<string>(STORE_SURFACE_M1_ENABLED_OPERATIONS)
    const manifestM1EnabledKeys = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "M1_ENABLED"
    ).map((entry) => storeSurfaceOperationKey(entry.method, entry.pathTemplate))
    expect(manifestM1EnabledKeys).toEqual([
      ...STORE_SURFACE_M1_ENABLED_OPERATIONS,
    ])

    for (const entry of STORE_SURFACE_MANIFEST) {
      expect(entry.classification).toBeTruthy()
      expect(entry.runtime_policy).toBeTruthy()
      expect(entry.rationale).toBeTruthy()
      expect(entry.openapi_m1_expectation).toBeTruthy()
      expect(entry.classification).not.toBe(entry.runtime_policy)

      const key = storeSurfaceOperationKey(entry.method, entry.pathTemplate)
      if (m1EnabledKeys.has(key)) {
        expect(entry.runtime_policy).toBe("M1_ENABLED")
        expect(entry.m1_enablement).toBe("enabled")
        continue
      }

      expect(entry.runtime_policy).not.toBe("M1_ENABLED")
      expect(entry.m1_enablement).not.toBe("enabled")

      if (entry.classification === "BLOCKED") {
        expect(entry.runtime_policy).toBe("DENY")
      }
      if (entry.runtime_policy === "PRESERVE_LEGACY") {
        expect(entry.m1_enablement).toBe("disabled")
      }
    }
  })

  it("fails closed on version/runtime drift and forbidden executable exposure", () => {
    const scan = scanInstalledStoreSurface()
    const registry = createFoundationRegistry()
    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )?.document

    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, scan.discovered.slice(1))
    ).toThrow(/exact-set/i)
    expect(() =>
      verifyStoreSurfaceExactSets(registry, store, [
        ...scan.discovered,
        scan.discovered[0],
      ])
    ).toThrow(/duplicate/i)

    const injected = structuredClone(store!)
    injected.paths["/store/carts/{id}/complete"] = {
      post: { operationId: "forbiddenComplete" },
    }
    expect(() =>
      verifyStoreSurfaceExactSets(registry, injected, scan.discovered)
    ).toThrow(/disabled Store operation/i)
  })

  it("rejects DENY and UNKNOWN before handler/workflow resolution", () => {
    const middleware = createStoreSurfaceGuardMiddleware()
    const attempts = [
      ...STORE_SURFACE_MANIFEST.filter(
        (entry) => entry.runtime_policy === "DENY"
      ).map((entry) => [entry.method, concretePath(entry)] as const),
      ["POST", "/store/not-a-real-route"] as const,
      ["TRACE", "/store/products"] as const,
    ]

    for (const [method, path] of attempts) {
      const req = request(method, path)
      const res = response()
      const next = jest.fn()
      middleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(req.scope.resolve).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain("order")
    }
  })

  it("covers normalization, method, preflight and static/parameter bypass families", () => {
    const denied = [
      ["GET", "/store/carts/synth/complete"],
      ["POST", "/store/carts/synth/complete/"],
      ["POST", "/store/carts//synth/complete"],
      ["POST", "/store/carts/synth%2Fcomplete"],
      ["HEAD", "/store/products"],
      ["DELETE", "/store/products"],
      ["GET", "/Store/products"],
      ["GET", "/api/store/products"],
      ["GET", "/store/../products"],
      ["POST", "/store/carts/active/complete"],
    ] as const

    for (const [method, path] of denied) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
    }
    expect(decideStoreSurfaceAccess("GET", "/store/products?locale=pt-BR").action)
      .toBe("allow")
    expect(
      decideStoreSurfaceAccess("OPTIONS", "/store/products", {
        origin: "https://same-origin-bff.test",
        accessControlRequestMethod: "GET",
      }).action
    ).toBe("options_preflight")
    expect(
      decideStoreSurfaceAccess("OPTIONS", "/store/products", {
        origin: "https://same-origin-bff.test",
        accessControlRequestMethod: "POST",
      }).action
    ).toBe("deny")
  })

  it("keeps PRESERVE_LEGACY runtime-only and never executable M1", () => {
    const preserved = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "PRESERVE_LEGACY"
    )
    expect(preserved).toHaveLength(5)
    for (const entry of preserved) {
      expect(decideStoreSurfaceAccess(entry.method, concretePath(entry))).toEqual(
        expect.objectContaining({ action: "allow", mode: "preserve_legacy" })
      )
      expect(entry.m1_enablement).toBe("disabled")
      expect(entry.runtime_policy).not.toBe("M1_ENABLED")
    }
  })

  it("native complete defense returns before completeCartWorkflow/Order birth", async () => {
    const req = {
      params: { id: "cart_synth_13_07" },
      scope: { resolve: jest.fn() },
    }
    const res = response()

    await completeCartOverride(req as never, res)

    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("order")
  })

  it("keeps the BFF-only authority statement and Store/Admin/Webhooks isolation", () => {
    const contracts = buildContracts(createFoundationRegistry())
    const store = contracts.find((contract) => contract.surface === "store")!
    const serializedStore = JSON.stringify(store.document)
    const admin = contracts.find((contract) => contract.surface === "admin")!
    const webhooks = contracts.find((contract) => contract.surface === "webhooks")!

    expect(serializedStore).toMatch(/same-origin Next\.js BFF/i)
    expect(serializedStore).toMatch(/server-to-server/i)
    expect(serializedStore).toMatch(/browser.*not.*authorized.*direct Medusa/i)
    expect(admin.document.info.version).toBe("1.0.0")
    expect(webhooks.document.info.version).toBe("1.0.0")
    expect(Object.keys(admin.document.paths).some((key) => key.startsWith("/admin/")))
      .toBe(true)
    expect(Object.keys(webhooks.document.paths).some((key) => key.startsWith("/hooks/")))
      .toBe(true)
  })
})
