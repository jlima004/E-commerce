import {
  API_DOCS_INITIALIZER_JS,
  SWAGGER_UI_HTML,
} from "../runtime/swagger-config"

const EXTERNAL_URL_PATTERN = /https?:\/\//
const INLINE_SCRIPT_BODY_PATTERN = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i
const INLINE_STYLE_ATTR_PATTERN = /\sstyle\s*=/i

function parseInitializerConfig(source: string) {
  const urlsMatch = source.match(/urls:\s*\[([\s\S]*?)\],/)
  const supportedSubmitMethodsMatch = source.match(
    /supportedSubmitMethods:\s*(\[[^\]]*\])/
  )
  const persistAuthorizationMatch = source.match(
    /persistAuthorization:\s*(true|false)/
  )
  const validatorUrlMatch = source.match(/validatorUrl:\s*(null|"[^"]*")/)
  const queryConfigEnabledMatch = source.match(
    /queryConfigEnabled:\s*(true|false)/
  )
  const withCredentialsMatch = source.match(/withCredentials:\s*(true|false)/)
  const tryItOutEnabledMatch = source.match(/tryItOutEnabled:\s*(true|false)/)

  return {
    urlsBlock: urlsMatch?.[1] ?? "",
    supportedSubmitMethods: supportedSubmitMethodsMatch?.[1],
    persistAuthorization: persistAuthorizationMatch?.[1],
    validatorUrl: validatorUrlMatch?.[1],
    queryConfigEnabled: queryConfigEnabledMatch?.[1],
    withCredentials: withCredentialsMatch?.[1],
    tryItOutEnabled: tryItOutEnabledMatch?.[1],
  }
}

describe("swagger-config", () => {
  describe("API_DOCS_INITIALIZER_JS", () => {
    const config = parseInitializerConfig(API_DOCS_INITIALIZER_JS)

    it("lists three same-origin local OpenAPI urls", () => {
      expect(config.urlsBlock).toContain('url: "/openapi/store.json"')
      expect(config.urlsBlock).toContain('url: "/openapi/admin.json"')
      expect(config.urlsBlock).toContain('url: "/openapi/webhooks.json"')
      expect(config.urlsBlock.match(/url:/g)).toHaveLength(3)
    })

    it("disables interactive and auth features", () => {
      expect(config.supportedSubmitMethods).toBe("[]")
      expect(config.persistAuthorization).toBe("false")
      expect(config.validatorUrl).toBe("null")
      expect(config.queryConfigEnabled).toBe("false")
      expect(config.withCredentials).toBe("false")
      expect(config.tryItOutEnabled).toBe("false")
    })

    it("does not reference oauth redirect or preauthorize hooks", () => {
      expect(API_DOCS_INITIALIZER_JS).not.toMatch(/oauth2RedirectUrl/i)
      expect(API_DOCS_INITIALIZER_JS).not.toMatch(/preauthorize/i)
    })

    it("contains no external http(s) URLs", () => {
      expect(API_DOCS_INITIALIZER_JS).not.toMatch(EXTERNAL_URL_PATTERN)
    })
  })

  describe("SWAGGER_UI_HTML", () => {
    it("loads scripts via src= only (no inline executable script bodies)", () => {
      expect(SWAGGER_UI_HTML).not.toMatch(INLINE_SCRIPT_BODY_PATTERN)
      expect(SWAGGER_UI_HTML).toMatch(
        /<script src="\/docs\/assets\/swagger-ui-bundle\.js"><\/script>/
      )
      expect(SWAGGER_UI_HTML).toMatch(
        /<script src="\/docs\/assets\/swagger-ui-standalone-preset\.js"><\/script>/
      )
      expect(SWAGGER_UI_HTML).toMatch(
        /<script src="\/docs\/assets\/api-docs-initializer\.js"><\/script>/
      )
    })

    it("has no inline style attributes", () => {
      expect(SWAGGER_UI_HTML).not.toMatch(INLINE_STYLE_ATTR_PATTERN)
    })

    it("references only local asset paths and contains no external URLs", () => {
      expect(SWAGGER_UI_HTML).not.toMatch(EXTERNAL_URL_PATTERN)
      expect(SWAGGER_UI_HTML).toContain('href="/docs/assets/swagger-ui.css"')
    })
  })
})
