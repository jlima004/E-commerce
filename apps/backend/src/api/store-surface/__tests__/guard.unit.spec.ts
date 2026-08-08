import path from "path"
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
import defaultMiddlewares from "../../middlewares"
import { POST as localCompletePost } from "../../store/carts/[id]/complete/route"

const repoNodeModules = path.join(process.cwd(), "../../node_modules")

// RoutesSorter / RoutesLoader are not public @medusajs/framework/http exports;
// load the installed 2.16.0 implementations directly for executable facts.
const { RoutesSorter } = require(
  path.join(repoNodeModules, "@medusajs/framework/dist/http/routes-sorter.js")
) as {
  RoutesSorter: new (routes: unknown[]) => { sort: () => Array<{ matcher: unknown }> }
}

const { RoutesLoader } = require(
  path.join(repoNodeModules, "@medusajs/framework/dist/http/routes-loader.js")
) as {
  RoutesLoader: new () => {
    createRoutePath: (relativePath: string) => string
    registerRoute: (route: {
      matcher: string
      method: string
      handler: unknown
      absolutePath: string
      relativePath: string
      isRoute?: boolean
    }) => void
    getRoutes: () => Array<{
      matcher: string
      method: string
      handler: unknown
      absolutePath: string
    }>
  }
}

const { POST: nativeCompletePost } = require(
  path.join(
    repoNodeModules,
    "@medusajs/medusa/dist/api/store/carts/[id]/complete/route.js"
  )
) as { POST: unknown }

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
      ]).sort()

      const matchers = sorted.map((route) => String(route.matcher))
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

    it("registers /store* in middlewares.ts before specific Store business matchers", () => {
      const matchers = defaultMiddlewares.routes.map((route) =>
        String(route.matcher)
      )
      const guardIndex = matchers.indexOf("/store*")
      expect(guardIndex).toBeGreaterThanOrEqual(0)
      expect(guardIndex).toBeLessThan(matchers.indexOf("/store/products"))
      expect(guardIndex).toBeLessThan(matchers.indexOf("/store/carts/active"))
    })

    it("RoutesLoader last-writer-wins selects local complete override over native", () => {
      const nativeRelative = path.join(
        "store",
        "carts",
        "[id]",
        "complete",
        "route.js"
      )
      const localRelative = path.join(
        "store",
        "carts",
        "[id]",
        "complete",
        "route.ts"
      )
      const nativeAbsolute = path.join(
        repoNodeModules,
        "@medusajs/medusa/dist/api",
        nativeRelative
      )
      const localAbsolute = path.join(
        process.cwd(),
        "src/api/store/carts/[id]/complete/route.ts"
      )

      const loader = new RoutesLoader()
      const nativeMatcher = loader.createRoutePath(nativeRelative)
      const localMatcher = loader.createRoutePath(localRelative)
      expect(nativeMatcher).toBe("/store/carts/:id/complete")
      expect(localMatcher).toBe(nativeMatcher)
      expect(typeof nativeCompletePost).toBe("function")
      expect(typeof localCompletePost).toBe("function")
      expect(nativeCompletePost).not.toBe(localCompletePost)

      // Factual Medusa 2.16.0 load order (api.js): core api first, then plugins
      // with project-plugin (src) last → local registerRoute overwrites native.
      loader.registerRoute({
        matcher: nativeMatcher,
        method: "POST",
        handler: nativeCompletePost,
        absolutePath: nativeAbsolute,
        relativePath: `/${nativeRelative}`,
        isRoute: true,
      })
      loader.registerRoute({
        matcher: localMatcher,
        method: "POST",
        handler: localCompletePost,
        absolutePath: localAbsolute,
        relativePath: `/${localRelative}`,
        isRoute: true,
      })

      const postRoutes = loader
        .getRoutes()
        .filter(
          (route) =>
            route.matcher === "/store/carts/:id/complete" &&
            route.method === "POST"
        )
      expect(postRoutes).toHaveLength(1)
      expect(postRoutes[0]?.handler).toBe(localCompletePost)
      expect(postRoutes[0]?.absolutePath).toBe(localAbsolute)
      expect(postRoutes[0]?.handler).not.toBe(nativeCompletePost)

      // Prove overwrite direction: native-after-local would win if order flipped.
      const reverse = new RoutesLoader()
      reverse.registerRoute({
        matcher: localMatcher,
        method: "POST",
        handler: localCompletePost,
        absolutePath: localAbsolute,
        relativePath: `/${localRelative}`,
        isRoute: true,
      })
      reverse.registerRoute({
        matcher: nativeMatcher,
        method: "POST",
        handler: nativeCompletePost,
        absolutePath: nativeAbsolute,
        relativePath: `/${nativeRelative}`,
        isRoute: true,
      })
      const reversed = reverse
        .getRoutes()
        .find(
          (route) =>
            route.matcher === "/store/carts/:id/complete" &&
            route.method === "POST"
        )
      expect(reversed?.handler).toBe(nativeCompletePost)
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

    it("allows only strict known-method/path CORS OPTIONS preflight", () => {
      const invalid = decideStoreSurfaceAccess("OPTIONS", "/store/products")
      expect(invalid.action).toBe("deny")

      const valid = decideStoreSurfaceAccess("OPTIONS", "/store/products", {
        origin: "https://bff.example.com",
        accessControlRequestMethod: "GET",
      })
      expect(valid.action).toBe("options_preflight")

      expect(
        decideStoreSurfaceAccess("OPTIONS", "/store/not-a-real-route", {
          origin: "https://bff.example.com",
          accessControlRequestMethod: "GET",
        }).action
      ).toBe("deny")

      expect(
        decideStoreSurfaceAccess("OPTIONS", "/store/products", {
          origin: "https://bff.example.com",
          accessControlRequestMethod: "POST",
        }).action
      ).toBe("deny")

      expect(
        decideStoreSurfaceAccess(
          "OPTIONS",
          "/store/carts/cart_synth_01/complete",
          {
            origin: "https://bff.example.com",
            accessControlRequestMethod: "POST",
          }
        ).action
      ).toBe("deny")

      expect(
        decideStoreSurfaceAccess("OPTIONS", "/store/customers/me/cart/attach", {
          origin: "https://bff.example.com",
          accessControlRequestMethod: "POST",
        }).action
      ).toBe("deny")
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
