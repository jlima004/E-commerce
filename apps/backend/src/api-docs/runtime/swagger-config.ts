/**
 * Swagger UI shell — no inline script or style.
 * Assets and initializer are loaded from same-origin /docs/assets/*.
 */
export const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API Docs</title>
<link rel="stylesheet" href="/docs/assets/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
<script src="/docs/assets/api-docs-initializer.js"></script>
</body>
</html>
`

export type ApiDocsInitializerUrl = {
  name: string
  url: string
}

/**
 * Project-owned Swagger UI initializer (non-interactive).
 * Forbidden: try-it-out, oauth redirect, preauthorize, auth injection,
 * response interceptors that expose content, external URLs, query configUrl.
 *
 * The urls array must contain only surfaces authorized for the current request.
 * Names and URLs are embedded via JSON.stringify — never interpolate raw strings.
 */
export function buildApiDocsInitializerJs(
  urls: ReadonlyArray<ApiDocsInitializerUrl>
): string {
  const urlsLiteral =
    urls.length === 0
      ? "[]"
      : `[\n${urls
          .map(
            (entry) =>
              `      { name: ${JSON.stringify(entry.name)}, url: ${JSON.stringify(entry.url)} }`
          )
          .join(",\n")}\n    ]`

  return `"use strict";
window.onload = function () {
  window.ui = SwaggerUIBundle({
    urls: ${urlsLiteral},
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
    supportedSubmitMethods: [],
    tryItOutEnabled: false,
    persistAuthorization: false,
    validatorUrl: null,
    queryConfigEnabled: false,
    withCredentials: false
  });
};
`
}
