# API Docs operations

API Docs exposure is fail-closed. This runbook describes the implemented
controls; it does not authorize enabling documentation in production.

## Surfaces and flags

| Flag                        | Purpose                                        | Production default |
| --------------------------- | ---------------------------------------------- | ------------------ |
| `API_DOCS_ENABLED`          | Master gate for every docs route               | `false`            |
| `API_DOCS_UI_ENABLED`       | Enables `/docs` and its assets                 | `false`            |
| `API_DOCS_PUBLIC_ENABLED`   | Enables the Store specification                | `false`            |
| `API_DOCS_INTERNAL_ENABLED` | Enables Admin/Webhooks for authenticated users | `false`            |

The effective matrix is restrictive:

- a false master flag returns `404` for all documentation paths;
- Store requires master plus public enablement;
- Admin and Webhooks require master plus internal enablement and an
  authenticated user actor; API-key actors are rejected;
- `/docs` includes only surfaces authorized for the current request;
- Webhooks exposure returns `404` if the configured Gelato authentication
  header name differs from the committed contract.

## Paths and assets

The only specification paths are `/openapi/store.json`,
`/openapi/admin.json`, and `/openapi/webhooks.json`. Extensionless aliases
return `404`.

The UI entry point is `/docs`. Its asset namespace permits exactly:

- `/docs/assets/swagger-ui.css`;
- `/docs/assets/swagger-ui-bundle.js`;
- `/docs/assets/swagger-ui-standalone-preset.js`;
- `/docs/assets/api-docs-initializer.js`.

Package HTML, package initializer, OAuth redirect, source maps, nested paths,
fonts, images, directory listings and unknown assets return `404`.

## Local verification

After a clean install, the binary contract gate is:

```bash
npm run openapi:check
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath \
  src/api-docs/__tests__/generation.unit.spec.ts \
  src/api-docs/__tests__/coverage.unit.spec.ts \
  src/api-docs/__tests__/security.unit.spec.ts \
  src/api-docs/__tests__/exposure.unit.spec.ts \
  src/api-docs/__tests__/money-units.unit.spec.ts \
  src/api-docs/__tests__/native-extensions.unit.spec.ts
npm run test:integration:http -w @dtc/backend -- \
  --runTestsByPath integration-tests/http/api-docs.spec.ts
npm run lint -w @dtc/backend
npm run build -w @dtc/backend
git diff --check
test -z "$(git status --porcelain=v1)"
```

For local, non-production rendering only, set the necessary flags in the
process environment, never in a committed env file. Confirm the expected
`404`/`200` matrix and headers with the HTTP tests; do not use real credentials
or provider payloads.

## Security behavior

- Swagger UI cannot submit Store, Admin or Webhook operations.
- Authorization is not persisted; query configuration and external validation
  are disabled.
- Assets are same-origin and local. No CDN, remote font or external connection
  is allowed.
- HTML and JSON use `Cache-Control: no-store`, explicit content types,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive
  CSP and anti-framing policy.
- Documentation routes do not add a CORS origin.
- Disabled, unauthorized and asset-error paths must not log headers, cookies,
  query values, credentials or specification contents.

## Production approval and rollback

Any production enablement requires a separate human gate that reviews all four
flags, access policy, exact Gelato header contract, security headers, existing
business-route regressions and an explicit disable plan. API-DOCS-01 itself
performs no deployment and leaves every production flag absent or false.

Disable or rollback by setting all four flags to `false` or removing them, then
restart through the approved platform procedure. Verify `/docs`, every
`/docs/assets/*` path and every `/openapi/*` path return `404`; verify health and
business endpoints remain unchanged. Code rollback, deploy, restart or config
mutation is outside this repository gate and requires separate operational
authorization.
