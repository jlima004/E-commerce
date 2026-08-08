import { RoutesSorter } from "@medusajs/framework/http"
import {
  STORE_SURFACE_MANIFEST,
  summarizeStoreSurfaceManifest,
} from "../manifest"
import {
  createStoreSurfaceGuardMiddleware,
  decideStoreSurfaceAccess,
  matchStorePathToTemplate,
  normalizeStoreRequestPath,
} from "../guard"

describe("Store surface guard (FND-02)", () => {
  const counts = summarizeStoreSurfaceManifest()

  describe("Medusa 2.16.0 middleware ordering fact", () => {
    it("places method-less /store* in the global bucket before static/params Store handlers", () => {
      const sorted = new RoutesSorter([
        {
          matcher: "/store/carts/active",
          methods: ["GET"],
          method: "GET",
          handler: () => undefined,
        },
        {
          matcher: "/store*",
          handler: () => undefined,
        },
        {
          matcher: "/store/carts/:id/complete",
          methods: ["POST"],
          method: "POST",
          handler: () => undefined,
        },
        {
          matcher: "/store/products/:id",
          methods: ["GET"],
          method: "GET",
          handler: () => undefined,
        },
      ] as never[]).sort()

      const matchers = sorted.map((route) => String((route as { matcher: string }).matcher))
      expect(matchers[0]).toBe("/store*")
      expect(matchers.indexOf("/store*")).toBeLessThan(
        matchers.indexOf("/store/carts/active")
      )
      expect(matchers.indexOf("/store*")).toBeLessThan(
        matchers.indexOf("/store/carts/:id/complete")
      )
      expect(matchers.indexOf("/store*")).toBeLessThan(
        matchers.indexOf("/store/products/:id")
      )
    })
  })

  describe("normalizeStoreRequestPath", () => {
    it("accepts canonical Store paths", () => {
      expect(normalizeStoreRequestPath("/store/carts/active")).toBe(
        "/store/carts/active"
      )
      expect(normalizeStoreRequestPath("/store/products/prod_01")).toBe(
        "/store/products/prod_01"
      )
    })

    it("strips only a single query string without altering the path identity", () => {
      expect(normalizeStoreRequestPath("/store/carts/active?x=1")).toBe(
        "/store/carts/active"
      )
    })

    it("rejects trailing slash, double slash, encoded separators, and aliases", () => {
      expect(normalizeStoreRequestPath("/store/carts/active/")).toBeNull()
      expect(normalizeStoreRequestPath("/store//carts/active")).toBeNull()
      expect(normalizeStoreRequestPath("/store/carts%2factive")).toBeNull()
      expect(normalizeStoreRequestPath("/store/carts%2Factive")).toBeNull()
      expect(normalizeStoreRequestPath("/Store/carts/active")).toBeNull()
      expect(normalizeStoreRequestPath("/api/store/carts/active")).toBeNull()
      expect(normalizeStoreRequestPath("/store/../carts/active")).toBeNull()
    })
  })

  describe("matchStorePathToTemplate", () => {
    it("prefers static templates over parameterized ones", () => {
      const templates = [
        "/store/carts/{id}",
        "/store/carts/active",
        "/store/carts/{id}/complete",
      ]
      expect(matchStorePathToTemplate("/store/carts/active", templates)).toBe(
        "/store/carts/active"
      )
      expect(
        matchStorePathToTemplate("/store/carts/cart_synth_01", templates)
      ).toBe("/store/carts/{id}")
      expect(
        matchStorePathToTemplate(
          "/store/carts/cart_synth_01/complete",
          templates
        )
      ).toBe("/store/carts/{id}/complete")
    })
  })

  describe("decideStoreSurfaceAccess", () => {
    it("denies UNKNOWN method/path combinations before any business allow", () => {
      const unknown = decideStoreSurfaceAccess("POST", "/store/not-a-real-route")
      expect(unknown.action).toBe("deny")
      expect(unknown.reason).toMatch(/UNKNOWN|absent/i)

      const wrongMethod = decideStoreSurfaceAccess("DELETE", "/store/carts/active")
      expect(wrongMethod.action).toBe("deny")
    })

    it("does not infer HEAD from GET", () => {
      const headProducts = decideStoreSurfaceAccess("HEAD", "/store/products")
      expect(headProducts.action).toBe("deny")
      expect(
        STORE_SURFACE_MANIFEST.some(
          (entry) => entry.method === "GET" && entry.pathTemplate === "/store/products"
        )
      ).toBe(true)
    })

    it("allows only strict CORS OPTIONS preflight and never as business allow", () => {
      const invalid = decideStoreSurfaceAccess("OPTIONS", "/store/products")
      expect(invalid.action).toBe("deny")

      const valid = decideStoreSurfaceAccess("OPTIONS", "/store/products", {
        origin: "https://bff.example.com",
        accessControlRequestMethod: "GET",
      })
      expect(valid.action).toBe("options_preflight")
    })

    it("denies every runtime_policy DENY and BLOCKED entry from the closed 58-set", () => {
      expect(counts.deny).toBe(51)
      expect(counts.blocked).toBe(17)

      for (const entry of STORE_SURFACE_MANIFEST) {
        if (entry.runtime_policy !== "DENY" && entry.classification !== "BLOCKED") {
          continue
        }
        const concrete = entry.pathTemplate.replace(/\{[^}]+\}/g, "synth_id_01")
        const decision = decideStoreSurfaceAccess(entry.method, concrete)
        expect(decision.action).toBe("deny")
      }
    })

    it("allows PRESERVE_LEGACY only as inherited v1.0 pass-through without M1 enablement", () => {
      expect(counts.preserveLegacy).toBe(7)
      expect(counts.m1EnabledPolicy).toBe(0)

      for (const entry of STORE_SURFACE_MANIFEST) {
        if (entry.runtime_policy !== "PRESERVE_LEGACY") {
          continue
        }
        expect(entry.m1_enablement).toBe("disabled")
        const concrete = entry.pathTemplate.replace(/\{[^}]+\}/g, "synth_id_01")
        const decision = decideStoreSurfaceAccess(entry.method, concrete)
        expect(decision).toEqual({
          action: "allow",
          entry,
          mode: "preserve_legacy",
        })
      }
    })

    it("keeps EXTENDED and OUTSIDE_FRONTEND_M1 M1-disabled regardless of classification alone", () => {
      for (const entry of STORE_SURFACE_MANIFEST) {
        if (
          entry.classification !== "EXTENDED" &&
          entry.classification !== "OUTSIDE_FRONTEND_M1"
        ) {
          continue
        }
        expect(entry.m1_enablement).toBe("disabled")
        expect(entry.runtime_policy).not.toBe("M1_ENABLED")
      }
    })
  })

  describe("createStoreSurfaceGuardMiddleware", () => {
    it("short-circuits DENY without calling next", () => {
      const middleware = createStoreSurfaceGuardMiddleware()
      const next = jest.fn()
      const status = jest.fn().mockReturnThis()
      const json = jest.fn().mockReturnThis()
      const req = {
        method: "POST",
        path: "/carts/cart_synth_01/complete",
        baseUrl: "/store",
        originalUrl: "/store/carts/cart_synth_01/complete",
        headers: {},
      }
      const res = { status, json, headersSent: false }

      middleware(req as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(status).toHaveBeenCalledWith(404)
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "not_found",
          message: "Not Found",
        })
      )
      const body = JSON.stringify(json.mock.calls[0][0])
      expect(body).not.toMatch(/Authorization|cookie|client_secret|pix_|JWT/i)
    })

    it("calls next for PRESERVE_LEGACY", () => {
      const middleware = createStoreSurfaceGuardMiddleware()
      const next = jest.fn()
      const req = {
        method: "GET",
        path: "/products",
        baseUrl: "/store",
        originalUrl: "/store/products",
        headers: {},
      }
      const res = { status: jest.fn(), json: jest.fn(), headersSent: false }

      middleware(req as never, res as never, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })
  })
})
