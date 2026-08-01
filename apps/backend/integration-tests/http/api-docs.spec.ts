import fs from "node:fs"
import path from "node:path"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  API_DOCS_CONTENT_SECURITY_POLICY,
  API_DOCS_CONTENT_TYPE_HTML,
  API_DOCS_CONTENT_TYPE_JSON,
} from "../../src/api-docs/runtime/security-headers"
import { getStoreOpenApiDocument } from "../../src/api-docs/runtime/documents"
import { SWAGGER_ASSET_NAMES } from "../../src/api-docs/runtime/swagger-assets"

const allEnabled = {
  API_DOCS_ENABLED: true,
  API_DOCS_UI_ENABLED: true,
  API_DOCS_PUBLIC_ENABLED: true,
  API_DOCS_INTERNAL_ENABLED: true,
}

const productionLike = {
  API_DOCS_ENABLED: false,
  API_DOCS_UI_ENABLED: false,
  API_DOCS_PUBLIC_ENABLED: false,
  API_DOCS_INTERNAL_ENABLED: false,
}

const userAuthContext = {
  actor_type: "user",
  actor_id: "user_123",
}

const INLINE_SCRIPT_BODY_PATTERN =
  /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i

type MockResponse = MedusaResponse & {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function createResponse(): MockResponse {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: jest.fn(function (this: MockResponse, code: number) {
      this.statusCode = code
      return this
    }),
    setHeader: jest.fn(function (this: MockResponse, name: string, value: string) {
      this.headers[name] = value
      return this
    }),
    send: jest.fn(function (this: MockResponse, payload: unknown) {
      this.body = payload
      return this
    }),
    end: jest.fn(function (this: MockResponse) {
      return this
    }),
    json: jest.fn().mockReturnThis(),
  }

  return res as MockResponse
}

function createRequest(authContext?: unknown): MedusaRequest {
  return { auth_context: authContext } as MedusaRequest
}

function expectSecurityHeaders(
  res: MockResponse,
  contentType: string
): void {
  expect(res.headers["Content-Type"]).toBe(contentType)
  expect(res.headers["Content-Security-Policy"]).toBe(
    API_DOCS_CONTENT_SECURITY_POLICY
  )
  expect(res.headers["X-Content-Type-Options"]).toBe("nosniff")
  expect(res.headers["Referrer-Policy"]).toBe("no-referrer")
  expect(res.headers["Cache-Control"]).toBe("no-store")
  for (const name of Object.keys(res.headers)) {
    expect(name.toLowerCase()).not.toMatch(/^access-control-/)
  }
}

function expectNotFound(res: MockResponse): void {
  expect(res.status).toHaveBeenCalledWith(404)
  expect(res.end).toHaveBeenCalledTimes(1)
  expect(res.status).not.toHaveBeenCalledWith(401)
  expect(res.status).not.toHaveBeenCalledWith(403)
}

const defaultEnvMock = {
  ...allEnabled,
  // Default runtime value (different casing from the OpenAPI contract name).
  GELATO_WEBHOOK_AUTH_HEADER_NAME: "X-GELATO-WEBHOOK-SECRET",
} as const

async function importWithEnvMocks<T>(
  modulePath: string,
  envOverrides: Record<string, boolean | string> = {}
): Promise<T> {
  jest.resetModules()
  jest.doMock("../../src/config/env", () => ({
    env: { ...defaultEnvMock, ...envOverrides },
  }))
  jest.doMock("../../src/api-docs/generation/build-documents", () => ({
    buildContracts: jest.fn(),
  }))
  jest.doMock("../../src/api-docs/registry", () => ({
    createFoundationRegistry: jest.fn(),
  }))

  return import(modulePath) as Promise<T>
}

afterEach(() => {
  jest.dontMock("../../src/config/env")
  jest.dontMock("../../src/api-docs/generation/build-documents")
  jest.dontMock("../../src/api-docs/registry")
  jest.resetModules()
})

describe("api docs HTTP routes", () => {
  describe("GET /openapi/store.json", () => {
    it("returns committed store artifact when enabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/openapi/store.json/route")>(
        "../../src/api/openapi/store.json/route"
      )
      const generation = await import("../../src/api-docs/generation/build-documents")
      const registry = await import("../../src/api-docs/registry")
      const res = createResponse()

      await route.GET(createRequest(), res)

      expect(res.status).toHaveBeenCalledWith(200)
      expectSecurityHeaders(res, API_DOCS_CONTENT_TYPE_JSON)
      expect(JSON.parse(String(res.body))).toEqual(getStoreOpenApiDocument())
      expect(generation.buildContracts).not.toHaveBeenCalled()
      expect(registry.createFoundationRegistry).not.toHaveBeenCalled()
    })

    it("returns 404 when master disabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/openapi/store.json/route")>(
        "../../src/api/openapi/store.json/route",
        { API_DOCS_ENABLED: false }
      )
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })

    it("returns 404 when public disabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/openapi/store.json/route")>(
        "../../src/api/openapi/store.json/route",
        { API_DOCS_PUBLIC_ENABLED: false }
      )
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })

    it("returns 404 under production-like defaults", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/openapi/store.json/route")>(
        "../../src/api/openapi/store.json/route",
        productionLike
      )
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })

    it("allows anonymous access when enabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/openapi/store.json/route")>(
        "../../src/api/openapi/store.json/route"
      )
      const res = createResponse()

      await route.GET(createRequest(), res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.status).not.toHaveBeenCalledWith(401)
      expect(res.status).not.toHaveBeenCalledWith(403)
    })
  })

  describe.each([
    ["admin", "../../src/api/openapi/admin.json/route"],
    ["webhooks", "../../src/api/openapi/webhooks.json/route"],
  ] as const)("%s.json", (_surface, modulePath) => {
    it("returns 200 for user session-like auth context", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath)
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)

      expect(res.status).toHaveBeenCalledWith(200)
      expectSecurityHeaders(res, API_DOCS_CONTENT_TYPE_JSON)
      expect(typeof res.body).toBe("string")
      expect(JSON.parse(String(res.body))).toHaveProperty("openapi")
    })

    it("returns 200 for bearer-like user auth context", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath)
      const res = createResponse()

      await route.GET(
        createRequest({
          ...userAuthContext,
          auth_identity_id: "auth_identity_123",
        }),
        res
      )

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it("returns 404 for anonymous requests", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath)
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })

    it("returns 404 for api-key actor", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath)
      const res = createResponse()

      await route.GET(
        createRequest({ actor_type: "api_key", actor_id: "apk_123" }),
        res
      )
      expectNotFound(res)
    })

    it("returns 404 for invalid or empty auth", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath)

      for (const authContext of [
        { actor_type: "user", actor_id: "" },
        { actor_type: "", actor_id: "user_123" },
        { actor_type: null, actor_id: "user_123" },
      ]) {
        const res = createResponse()
        await route.GET(createRequest(authContext), res)
        expectNotFound(res)
      }
    })

    it("returns 404 when internal disabled", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath, { API_DOCS_INTERNAL_ENABLED: false })
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)
      expectNotFound(res)
    })

    it("returns 404 when master disabled", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(modulePath, { API_DOCS_ENABLED: false })
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)
      expectNotFound(res)
    })
  })

  describe("GET /openapi/webhooks.json Gelato header contract guard", () => {
    const webhooksRoute =
      "../../src/api/openapi/webhooks.json/route" as const
    const adminRoute = "../../src/api/openapi/admin.json/route" as const
    const storeRoute = "../../src/api/openapi/store.json/route" as const

    it("returns 200 for canonical header with lowercase spelling", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(webhooksRoute, {
        GELATO_WEBHOOK_AUTH_HEADER_NAME: "x-gelato-webhook-secret",
      })
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it("returns 200 for canonical header with alternate casing", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(webhooksRoute, {
        GELATO_WEBHOOK_AUTH_HEADER_NAME: "X-Gelato-Webhook-Secret",
      })
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it("returns opaque 404 when configured header diverges from the contract", async () => {
      const route = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(webhooksRoute, {
        GELATO_WEBHOOK_AUTH_HEADER_NAME: "x-custom-gelato-secret",
      })
      const res = createResponse()

      await route.GET(createRequest(userAuthContext), res)
      expectNotFound(res)
    })

    it("does not affect admin or store surfaces when Gelato header is overridden", async () => {
      const admin = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(adminRoute, {
        GELATO_WEBHOOK_AUTH_HEADER_NAME: "x-custom-gelato-secret",
      })
      const store = await importWithEnvMocks<{
        GET: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
      }>(storeRoute, {
        GELATO_WEBHOOK_AUTH_HEADER_NAME: "x-custom-gelato-secret",
      })

      const adminRes = createResponse()
      await admin.GET(createRequest(userAuthContext), adminRes)
      expect(adminRes.status).toHaveBeenCalledWith(200)

      const storeRes = createResponse()
      await store.GET(createRequest(), storeRes)
      expect(storeRes.status).toHaveBeenCalledWith(200)
    })
  })

  describe("GET /docs", () => {
    it("returns Swagger UI shell when UI and master are enabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/docs/route")>(
        "../../src/api/docs/route"
      )
      const res = createResponse()

      await route.GET(createRequest(), res)

      expect(res.status).toHaveBeenCalledWith(200)
      expectSecurityHeaders(res, API_DOCS_CONTENT_TYPE_HTML)
      const html = String(res.body)
      expect(html).toContain('/docs/assets/swagger-ui.css')
      expect(html).toContain('/docs/assets/swagger-ui-bundle.js')
      expect(html).not.toMatch(INLINE_SCRIPT_BODY_PATTERN)
    })

    it("returns 404 when UI disabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/docs/route")>(
        "../../src/api/docs/route",
        { API_DOCS_UI_ENABLED: false }
      )
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })

    it("returns 404 when master disabled", async () => {
      const route = await importWithEnvMocks<typeof import("../../src/api/docs/route")>(
        "../../src/api/docs/route",
        { API_DOCS_ENABLED: false }
      )
      const res = createResponse()

      await route.GET(createRequest(), res)
      expectNotFound(res)
    })
  })

  describe("GET /docs/assets/{asset}", () => {
    it.each(SWAGGER_ASSET_NAMES)(
      "returns 200 with MIME and security headers for %s",
      async (assetName) => {
        const route = await importWithEnvMocks<
          typeof import("../../src/api/docs/assets/[asset]/route")
        >("../../src/api/docs/assets/[asset]/route")
        const res = createResponse()

        await route.GET(
          {
            ...createRequest(),
            params: { asset: assetName },
          } as MedusaRequest,
          res
        )

        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.body).toBeDefined()
        const expectedContentType = assetName.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8"
        expectSecurityHeaders(res, expectedContentType)
      }
    )

    it("returns 404 for unknown asset", async () => {
      const route = await importWithEnvMocks<
        typeof import("../../src/api/docs/assets/[asset]/route")
      >("../../src/api/docs/assets/[asset]/route")
      const res = createResponse()

      await route.GET(
        {
          ...createRequest(),
          params: { asset: "unknown.js" },
        } as MedusaRequest,
        res
      )
      expectNotFound(res)
    })

    it("returns 404 for nested-like asset param", async () => {
      const route = await importWithEnvMocks<
        typeof import("../../src/api/docs/assets/[asset]/route")
      >("../../src/api/docs/assets/[asset]/route")
      const res = createResponse()

      await route.GET(
        {
          ...createRequest(),
          params: { asset: "nested/swagger-ui.css" },
        } as MedusaRequest,
        res
      )
      expectNotFound(res)
    })

    it.each(["../swagger-ui.css", "..%2fswagger-ui.css"])(
      "returns 404 for traversal asset param %s",
      async (assetParam) => {
        const route = await importWithEnvMocks<
          typeof import("../../src/api/docs/assets/[asset]/route")
        >("../../src/api/docs/assets/[asset]/route")
        const res = createResponse()

        await route.GET(
          {
            ...createRequest(),
            params: { asset: assetParam },
          } as MedusaRequest,
          res
        )
        expectNotFound(res)
      }
    )

    it("returns 404 when UI disabled", async () => {
      const route = await importWithEnvMocks<
        typeof import("../../src/api/docs/assets/[asset]/route")
      >("../../src/api/docs/assets/[asset]/route", {
        API_DOCS_UI_ENABLED: false,
      })
      const res = createResponse()

      await route.GET(
        {
          ...createRequest(),
          params: { asset: "swagger-ui.css" },
        } as MedusaRequest,
        res
      )
      expectNotFound(res)
    })
  })

  describe("alias routes absent", () => {
    const apiRoot = path.resolve(__dirname, "../../src/api")

    it("does not expose /openapi/store alias route module", () => {
      expect(
        fs.existsSync(path.join(apiRoot, "openapi/store/route.ts"))
      ).toBe(false)
    })

    it("does not expose /openapi/admin alias route module", () => {
      expect(
        fs.existsSync(path.join(apiRoot, "openapi/admin/route.ts"))
      ).toBe(false)
    })

    it("does not expose /openapi/webhooks alias route module", () => {
      expect(
        fs.existsSync(path.join(apiRoot, "openapi/webhooks/route.ts"))
      ).toBe(false)
    })

    it("does not expose /docs/index.html static route", () => {
      expect(fs.existsSync(path.join(apiRoot, "docs/index.html"))).toBe(false)
    })
  })
})
