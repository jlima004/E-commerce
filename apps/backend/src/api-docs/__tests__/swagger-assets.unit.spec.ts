import {
  SWAGGER_ASSET_NAMES,
  resolveSwaggerAsset,
} from "../runtime/swagger-assets"

const FULL_INITIALIZER_URLS = [
  { name: "Store" as const, url: "/openapi/store.json" as const },
  { name: "Admin" as const, url: "/openapi/admin.json" as const },
  { name: "Webhooks" as const, url: "/openapi/webhooks.json" as const },
]

describe("resolveSwaggerAsset", () => {
  it("has exactly four allowlisted asset names", () => {
    expect(SWAGGER_ASSET_NAMES).toHaveLength(4)
    expect([...SWAGGER_ASSET_NAMES]).toEqual([
      "swagger-ui.css",
      "swagger-ui-bundle.js",
      "swagger-ui-standalone-preset.js",
      "api-docs-initializer.js",
    ])
  })

  it.each(
    SWAGGER_ASSET_NAMES.filter((name) => name !== "api-docs-initializer.js")
  )("resolves allowlisted static asset %s with correct MIME", (name) => {
    const asset = resolveSwaggerAsset(name)

    expect(asset).not.toBeNull()
    expect(asset?.name).toBe(name)
    expect(asset?.body.length).toBeGreaterThan(0)

    if (name.endsWith(".css")) {
      expect(asset?.contentType).toBe("text/css; charset=utf-8")
    } else {
      expect(asset?.contentType).toBe("text/javascript; charset=utf-8")
    }
  })

  it.each(
    SWAGGER_ASSET_NAMES.filter((name) => name !== "api-docs-initializer.js")
  )("returns the same cached buffer for repeated static asset %s requests", (name) => {
    const first = resolveSwaggerAsset(name)
    const second = resolveSwaggerAsset(name)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.body.length).toBeGreaterThan(0)
    expect(second!.body.length).toBeGreaterThan(0)
    expect(first!.body).toBe(second!.body)
  })

  it("resolves initializer only when authorized urls are provided", () => {
    expect(resolveSwaggerAsset("api-docs-initializer.js")).toBeNull()

    const empty = resolveSwaggerAsset("api-docs-initializer.js", {
      initializerUrls: [],
    })
    expect(empty).not.toBeNull()
    expect(empty?.contentType).toBe("text/javascript; charset=utf-8")
    expect(empty?.body.toString("utf8")).toContain("urls: []")
    expect(empty?.body.toString("utf8")).not.toContain("Store")

    const full = resolveSwaggerAsset("api-docs-initializer.js", {
      initializerUrls: FULL_INITIALIZER_URLS,
    })
    expect(full).not.toBeNull()
    const body = full!.body.toString("utf8")
    expect(body).toContain('name: "Store"')
    expect(body).toContain('name: "Admin"')
    expect(body).toContain('name: "Webhooks"')
    expect(body).not.toMatch(/https?:\/\//)
    expect(empty!.body).not.toBe(full!.body)
    expect(empty!.body.toString("utf8")).not.toBe(body)
  })

  it("returns null for unknown asset names", () => {
    expect(resolveSwaggerAsset("unknown.js")).toBeNull()
    expect(resolveSwaggerAsset("")).toBeNull()
    expect(resolveSwaggerAsset(null)).toBeNull()
    expect(resolveSwaggerAsset(undefined)).toBeNull()
  })

  it.each([
    "../swagger-ui.css",
    "nested/swagger-ui.css",
    "..%2fswagger-ui.css",
    "%2e%2e%2fswagger-ui.css",
    "swagger-ui.css%00",
    "swagger-ui.css%2f",
    "swagger-ui.css\\",
    "swagger-ui.css..",
    "oauth2-redirect.html",
    "swagger-initializer.js",
    "favicon.ico",
    "swagger-ui-bundle.js.map",
    "swagger-ui-bundle.js.map.json",
  ])("returns null for rejected asset param %s", (param) => {
    expect(resolveSwaggerAsset(param)).toBeNull()
  })
})
