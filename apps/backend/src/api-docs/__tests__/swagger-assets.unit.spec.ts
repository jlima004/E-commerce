import {
  SWAGGER_ASSET_NAMES,
  resolveSwaggerAsset,
} from "../runtime/swagger-assets"

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

  it.each(SWAGGER_ASSET_NAMES)(
    "resolves allowlisted asset %s with correct MIME",
    (name) => {
      const asset = resolveSwaggerAsset(name)

      expect(asset).not.toBeNull()
      expect(asset?.name).toBe(name)
      expect(asset?.body.length).toBeGreaterThan(0)

      if (name.endsWith(".css")) {
        expect(asset?.contentType).toBe("text/css; charset=utf-8")
      } else {
        expect(asset?.contentType).toBe("text/javascript; charset=utf-8")
      }
    }
  )

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
