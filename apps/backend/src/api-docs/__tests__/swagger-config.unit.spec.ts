import { buildApiDocsInitializerJs, SWAGGER_UI_HTML } from "../runtime/swagger-config"

const EXTERNAL_URL_PATTERN = /https?:\/\//
const INLINE_SCRIPT_BODY_PATTERN = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i
const INLINE_STYLE_ATTR_PATTERN = /\sstyle\s*=/i

const ALL_URLS = [
  { name: "Store" as const, url: "/openapi/store.json" as const },
  { name: "Admin" as const, url: "/openapi/admin.json" as const },
  { name: "Webhooks" as const, url: "/openapi/webhooks.json" as const },
]

function parseInitializerConfig(source: string) {
  const urlsMatch = source.match(/urls:\s*(\[[\s\S]*?\]),/)
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
  describe("buildApiDocsInitializerJs", () => {
    it("lists only the provided same-origin OpenAPI urls", () => {
      const source = buildApiDocsInitializerJs(ALL_URLS)
      const config = parseInitializerConfig(source)

      expect(config.urlsBlock).toContain('url: "/openapi/store.json"')
      expect(config.urlsBlock).toContain('url: "/openapi/admin.json"')
      expect(config.urlsBlock).toContain('url: "/openapi/webhooks.json"')
      expect(config.urlsBlock.match(/url:/g)).toHaveLength(3)
    })

    it("emits an empty urls array when no surfaces are authorized", () => {
      const source = buildApiDocsInitializerJs([])
      const config = parseInitializerConfig(source)

      expect(config.urlsBlock).toBe("[]")
      expect(source).not.toContain("Store")
      expect(source).not.toContain("Admin")
      expect(source).not.toContain("Webhooks")
      expect(source).not.toContain("/openapi/")
    })

    it("lists only Store when that is the sole authorized entry", () => {
      const source = buildApiDocsInitializerJs([ALL_URLS[0]])
      const config = parseInitializerConfig(source)

      expect(config.urlsBlock).toContain('name: "Store"')
      expect(config.urlsBlock).toContain('url: "/openapi/store.json"')
      expect(config.urlsBlock).not.toContain("Admin")
      expect(config.urlsBlock).not.toContain("Webhooks")
      expect(config.urlsBlock.match(/url:/g)).toHaveLength(1)
    })

    it("escapes names and urls via JSON.stringify", () => {
      const source = buildApiDocsInitializerJs([
        { name: 'Evil");alert(1)//', url: '/openapi/store.json"\n//' },
      ])

      expect(source).toContain(JSON.stringify('Evil");alert(1)//'))
      expect(source).toContain(JSON.stringify('/openapi/store.json"\n//'))
      expect(source).not.toContain('name: Evil");alert')
    })

    it("disables interactive and auth features", () => {
      const config = parseInitializerConfig(buildApiDocsInitializerJs(ALL_URLS))

      expect(config.supportedSubmitMethods).toBe("[]")
      expect(config.persistAuthorization).toBe("false")
      expect(config.validatorUrl).toBe("null")
      expect(config.queryConfigEnabled).toBe("false")
      expect(config.withCredentials).toBe("false")
      expect(config.tryItOutEnabled).toBe("false")
    })

    it("does not reference oauth redirect or preauthorize hooks", () => {
      const source = buildApiDocsInitializerJs(ALL_URLS)

      expect(source).not.toMatch(/oauth2RedirectUrl/i)
      expect(source).not.toMatch(/preauthorize/i)
    })

    it("contains no external http(s) URLs", () => {
      expect(buildApiDocsInitializerJs(ALL_URLS)).not.toMatch(EXTERNAL_URL_PATTERN)
    })

    it("contains no credentials or actor data", () => {
      const source = buildApiDocsInitializerJs(ALL_URLS)

      expect(source).toContain("persistAuthorization: false")
      expect(source).not.toMatch(/Bearer\s/i)
      expect(source).not.toMatch(/cookie/i)
      expect(source).not.toMatch(/actor_/i)
      expect(source).not.toMatch(/connect\.sid/i)
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
