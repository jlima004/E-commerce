import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { buildApiDocsInitializerJs } from "./swagger-config"
import type { ApiDocsSelectorUrl } from "./exposure"

const requirePackage = createRequire(__filename)

export const SWAGGER_ASSET_NAMES = [
  "swagger-ui.css",
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js",
  "api-docs-initializer.js",
] as const

export type SwaggerAssetName = (typeof SWAGGER_ASSET_NAMES)[number]

export type ResolvedSwaggerAsset = {
  name: SwaggerAssetName
  contentType: "text/css; charset=utf-8" | "text/javascript; charset=utf-8"
  body: Buffer
}

export type ResolveSwaggerAssetOptions = {
  /**
   * Required when resolving api-docs-initializer.js.
   * May be an empty array when no surfaces are authorized.
   */
  initializerUrls?: ReadonlyArray<ApiDocsSelectorUrl>
}

const ALLOWED_ASSETS = new Set<string>(SWAGGER_ASSET_NAMES)

const PACKAGE_ASSET_RESOLVERS: Record<
  Exclude<SwaggerAssetName, "api-docs-initializer.js">,
  string
> = {
  "swagger-ui.css": "swagger-ui-dist/swagger-ui.css",
  "swagger-ui-bundle.js": "swagger-ui-dist/swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js":
    "swagger-ui-dist/swagger-ui-standalone-preset.js",
}

function isExactAllowlistedAssetName(value: string): value is SwaggerAssetName {
  if (typeof value !== "string" || value.length === 0) {
    return false
  }

  // Reject path segments, traversal, encoding tricks, and null bytes.
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("%") ||
    value.includes("\0") ||
    value.includes("\u0000")
  ) {
    return false
  }

  return ALLOWED_ASSETS.has(value)
}

function contentTypeForAsset(
  name: SwaggerAssetName
): ResolvedSwaggerAsset["contentType"] {
  if (name.endsWith(".css")) {
    return "text/css; charset=utf-8"
  }

  return "text/javascript; charset=utf-8"
}

/**
 * Resolve a swagger UI asset by exact allowlisted basename only.
 * Returns null for unknown, nested, traversal, maps, oauth, favicons, etc.
 *
 * `api-docs-initializer.js` is dynamic: callers must pass `initializerUrls`
 * (authorized surfaces for the current request). Static package assets ignore it.
 */
export function resolveSwaggerAsset(
  assetParam: unknown,
  options?: ResolveSwaggerAssetOptions
): ResolvedSwaggerAsset | null {
  if (typeof assetParam !== "string" || !isExactAllowlistedAssetName(assetParam)) {
    return null
  }

  if (assetParam === "api-docs-initializer.js") {
    if (!options || !Array.isArray(options.initializerUrls)) {
      return null
    }

    return {
      name: assetParam,
      contentType: contentTypeForAsset(assetParam),
      body: Buffer.from(
        buildApiDocsInitializerJs(options.initializerUrls),
        "utf8"
      ),
    }
  }

  const packagePath = PACKAGE_ASSET_RESOLVERS[assetParam]
  const absolutePath = requirePackage.resolve(packagePath)
  const body = readFileSync(absolutePath)

  return {
    name: assetParam,
    contentType: contentTypeForAsset(assetParam),
    body,
  }
}
