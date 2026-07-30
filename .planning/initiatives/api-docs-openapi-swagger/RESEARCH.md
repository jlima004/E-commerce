# API-DOCS-01 — OpenAPI & Swagger UI Research

**Status:** Research corrected in R3; implementation remains blocked on final human review and explicit Wave 1 authorization
**Consulted on:** 2026-07-30
**Planning publication:** Committed and pushed through PR #13.
**Implementation publication:** None.
**Scope:** Technical research and planning only. No implementation, dependency installation, runtime change, migration, build, test, provider access, or deployment was published or performed.

## Executive Summary

API-DOCS-01 should use **OpenAPI 3.1.2**, three project-owned contracts, deterministic build-time generation, and a narrowly exposed Swagger UI:

- `GET /openapi/store.json`
- `GET /openapi/admin.json`
- `GET /openapi/webhooks.json`
- `GET /docs`, configured as one selector over the enabled contracts

The recommended source of truth is an **explicit TypeScript operation registry**. It should reuse a Zod schema only when that exact schema is also used by runtime request validation or response serialization. This distinction matters in the current repository: Zod 4.2.0 is installed, but application Zod usage is presently concentrated in environment parsing; the custom API routes mainly use handwritten validators and serializers. Therefore, API-DOCS-01 must not claim that existing route schemas can already be converted automatically.

Recommended tooling, subject to the human gate:

| Concern | Recommendation | Dependency class |
|---|---|---|
| OpenAPI assembly and Zod conversion | `@asteasolutions/zod-to-openapi` 9.1.0, using `OpenAPIRegistry` and `OpenApiGeneratorV31`; reuse one schema in both directions only when its Zod input and output shapes are equal | Development only |
| Lint and structural validation | `@stoplight/spectral-cli` 6.16.2 with root `.spectral.yaml` and local `spectral:oas` only | `devDependency` |
| Interactive rendering | `swagger-ui-dist` 5.32.11 | Runtime, because the web process serves local assets |
| Existing schema runtime | `zod` 4.2.0 | Existing runtime dependency |

The preferred converter does not expose a public input/output direction switch equivalent to Zod's `io` option. The registry must consequently use a shared Zod schema in both request and response positions only when `z.input<T>` and `z.output<T>` are equal. Coercions, transforms, preprocessing, and defaults that change direction require separately registered request and response schemas or explicit OpenAPI schemas. Depending on converter internals is prohibited.

`zod-openapi` is an evaluated alternative, is not selected for API-DOCS-01, is not installed, and is not part of the implementation plan. If the approved generator becomes unusable, API-DOCS-01 stops rather than switching generators automatically. Reconsideration requires a new human decision, compatibility and direction-behavior research, and an explicit version and Node gate.

The generator and linter must not run during application startup. They should emit stable JSON artifacts before packaging, and runtime routes should only serve those artifacts. The pipeline must prove route coverage, unique `operationId` values, resolved references, deterministic output, direction-safe schema registration, and no unreviewed diff.

Swagger UI must use local assets, must not call an external validator, must not persist authorization, and must disable interactivity unconditionally with `supportedSubmitMethods: []`. API-DOCS-01 defines no environment flag for interactivity. Any future executable profile is outside this initiative and requires a separate initiative and security review. Production exposure must be fail-closed and disabled by default. Admin and webhook contracts are internal material and must never become public merely because the Store contract is enabled.

The OpenAPI linter decision is final: install exactly `@stoplight/spectral-cli@6.16.2` as a development dependency, create only the root `.spectral.yaml`, extend only the locally installed `spectral:oas` ruleset, forbid remote rulesets and ignore files, and fail on warnings or errors with `--fail-severity warn`. Redocly is not installed, not configured, and not an implementation option.

## Current API Architecture

### Runtime and package baseline

The backend is a Medusa v2 application with file-based custom routes, central middleware registration, and distinct web/worker deployment processes.

| Fact | Repository evidence | Documentation consequence |
|---|---|---|
| Node is constrained to `>=22 <23` | `package.json:6`; `apps/backend/package.json:67` | Every proposed package must support Node 22, and packages with a higher 22.x minor floor require an explicit gate. |
| Medusa framework and application are exactly 2.16.0 | `apps/backend/package.json:34-35` | Native API links and overlays must be version-aware; copied native contracts would drift on Medusa upgrades. |
| Zod is exactly 4.2.0 | `apps/backend/package.json:46` | OAS 3.1 generation can use Zod 4 metadata and JSON Schema semantics, but only where runtime schemas exist. |
| TypeScript is `^5.6.2` | `apps/backend/package.json:62` | A typed registry and compile-time checks fit the existing toolchain. |
| JSON module resolution is enabled | `apps/backend/tsconfig.json:4-16` | Generated JSON can be imported by a small runtime adapter and included in the compiled server instead of being regenerated at startup. |
| No OpenAPI, Swagger UI, Spectral, or Zod-to-OpenAPI package is locked | `package-lock.json` package-name audit on 2026-07-30 | API-DOCS-01 requires a separately approved dependency change; this research installed nothing. |
| Heroku has separate `web` and `worker` processes | `apps/backend/Procfile:1-3` | Only the web process may expose documentation. The worker must not generate or serve it. |

### Route mechanics

Medusa maps exported HTTP method functions from `src/api/**/route.ts` to URLs. Project middleware in `apps/backend/src/api/middlewares.ts` adds cross-cutting behavior that cannot be inferred from a route function alone:

- correlation middleware applies globally;
- native Store product responses are extended at `apps/backend/src/api/middlewares.ts:272-287`;
- optional or required customer authentication is attached to cart routes at `apps/backend/src/api/middlewares.ts:288-326`;
- Stripe raw-body preservation is configured at `apps/backend/src/api/middlewares.ts:328-334`;
- the tracking guard is attached at `apps/backend/src/api/middlewares.ts:335-339`;
- native Admin product validation is extended at `apps/backend/src/api/middlewares.ts:340-359`.

This proves that pure route-file analysis cannot be the semantic source of truth. It can discover candidate method/path pairs, but authentication, raw-body behavior, response overlays, and native-route extensions require explicit metadata.

The current tree contains custom Store, Admin, webhook, and health route files. It also contains the scaffold/example routes `/store/custom` and `/admin/custom`. Both are already an explicit API-DOCS-01 exclusion in the route inventory and are not included in the initial contracts. Physical route removal is outside API-DOCS-01 and requires a separate cleanup decision. A generator must never silently skip an unclassified route.

### Current validation reality

`apps/backend/src/config/env.ts:2,273-313` uses Zod for environment validation. Custom API payloads, however, mainly use handwritten parsing:

- payment attempt parsing: `apps/backend/src/api/store/carts/payment-attempts/validators.ts`;
- tracking token parsing and forbidden identifier detection: `apps/backend/src/modules/tracking-access-token/lookup-body.ts:3-26,56-93`;
- Admin product validation adapters under `apps/backend/src/api/admin/products/_shared/`.

This is the key correction to the initial “reuse existing Zod” preference: reuse is architecturally desirable, but it is not broadly available today. The first implementation should document current runtime behavior faithfully and introduce shared Zod only where moving the runtime validator is explicitly in scope and behavior-preserving.

## Documentation Scope

The project should own only contracts for behavior that this repository owns or intentionally changes.

| API class | Included in project OpenAPI? | Authority and treatment |
|---|---:|---|
| Project custom Store routes | Yes | Full method, path, auth, request, response, and error contract in repository artifact `store.openapi.json`. |
| Project custom Admin routes | Yes | Full contract in repository artifact `admin.openapi.json`; internal exposure policy. |
| Stripe and Gelato ingress routes | Yes | Full ingress contract in repository artifact `webhooks.openapi.json`; signature and raw-body constraints; no executable UI. |
| Health routes | Yes | Include `GET /health/live` and `GET /health/ready` in `store.openapi.json` under the `Infrastructure` tag with `security: []`. No separate infrastructure document is part of API-DOCS-01. |
| Native Medusa route extended or overridden by project code | Yes, as a project overlay | Document the effective project behavior and link the upstream native contract. |
| Unchanged native Medusa route directly consumed by the future storefront | Cross-reference only | Maintain a versioned native-consumer manifest and link to Medusa 2.16 Store/Admin references; do not duplicate all schemas. |
| Unchanged native route not known to be consumed | No | The official Medusa reference remains authoritative. |
| Admin dashboard internals not changed by this project | No | Avoid cloning the full Admin API. |
| Example/scaffold routes | No | `/store/custom` and `/admin/custom` are explicit API-DOCS-01 exclusions: scaffold/example routes that are not included in the initial contracts. Physical removal is a separate cleanup decision. |
| Provider outbound APIs such as Stripe or Gelato APIs called by this backend | No | Link provider documentation separately. They are not this server’s ingress contract. |

The three contracts are intentionally separate:

- **Store** is the only candidate for controlled public documentation.
- **Admin** includes operational capabilities and must be internal.
- **Webhooks** contains security-sensitive ingress semantics and must be internal.

Repository artifact names and HTTP paths are deliberately different:

| Repository artifact | HTTP endpoint |
|---|---|
| `apps/backend/src/api-docs/generated/store.openapi.json` | `GET /openapi/store.json` |
| `apps/backend/src/api-docs/generated/admin.openapi.json` | `GET /openapi/admin.json` |
| `apps/backend/src/api-docs/generated/webhooks.openapi.json` | `GET /openapi/webhooks.json` |

Splitting the contracts reduces accidental disclosure, keeps tags and security schemes audience-specific, and allows public Store documentation without shipping Admin or webhook schemas to the browser.

## Native Medusa API Boundary

### Four explicit classifications

Every route relevant to API-DOCS-01 must have one of these classifications in the registry or a companion manifest:

1. `project-custom`: implemented in this repository; fully documented here.
2. `project-extension`: a native Medusa method/path whose validation or response is changed by this repository; document the effective overlay.
3. `project-override`: a native method/path replaced by project behavior; project contract is authoritative and must state that it overrides upstream.
4. `native-consumed`: unchanged native behavior directly used by the future storefront or operator workflow; link the exact Medusa version reference and do not copy the schema.

The observed Store product middleware and Admin product middleware belong to `project-extension`, not `native-consumed`.

### Why copying the complete native specification is rejected

Medusa already publishes official Store and Admin API references and downloadable OpenAPI material. Copying all native operations into project artifacts would:

- create an unowned fork of upstream schemas;
- make Medusa patch/minor upgrades appear safe even when copied docs are stale;
- overwhelm review diffs with operations this MVP does not use;
- blur which behavior is native and which behavior is a project guarantee.

The project should instead record the exact Medusa package version in generated metadata and fail a drift check when that version changes without review of `project-extension`, `project-override`, and `native-consumed` entries.

## OpenAPI Version Decision

### Decision: exact `openapi: 3.1.2`

Use **OpenAPI 3.1.2**, not a floating `3.1.x`.

Rationale:

- it is the latest 3.1 patch published by the OpenAPI Initiative;
- patch releases in the 3.1 line clarify the same feature set rather than introduce incompatible features;
- Swagger UI’s current 5.32 line declares support for OAS 3.1.2;
- the chosen Zod converter and Spectral ruleset support OAS 3.1;
- OpenAPI 3.2 exists, but adopting it would exceed the initiative’s 3.1 requirement and narrow tool compatibility without a project need.

### JSON Schema semantics

OAS 3.1 Schema Objects use the OpenAPI dialect based on JSON Schema Draft 2020-12. Contract authors must apply these rules:

- nullable scalar: `type: ["string", "null"]`, not the OAS 3.0-only `nullable: true`;
- optional property: omit the property name from `required`; optionality does not imply nullability;
- optional and nullable property: omit it from `required` and allow `null` in its schema;
- request and response representations may differ and must use direction-specific schemas;
- `readOnly` and `writeOnly` are annotations, not replacements for correct input/output schemas;
- unsupported runtime values such as functions, symbols, arbitrary class instances, or non-JSON values must never be silently converted.

Zod 4’s `z.toJSONSchema` uses Draft 2020-12 by default and has input/output modes. Those modes belong to Zod's native converter and are not exposed through the preferred `@asteasolutions/zod-to-openapi` 9.1.0 public API. A converter still needs explicit OpenAPI operation, parameter, response, security, and component registration.

### `operationId`

OAS requires each `operationId` to be unique within one OpenAPI description. This project should impose the stronger rule of global uniqueness across all three descriptions to prevent collisions if SDK or portal tooling later combines them.

Recommended convention:

```text
{audience}{Resource}{Action}
```

Examples:

- `storeCartGetActive`
- `storePaymentAttemptCreateCard`
- `adminExchangeCreate`
- `webhooksStripeReceiveEvent`

The registry should reject duplicates before document generation. Spectral provides the local OAS lint baseline, while the project TypeScript checker enforces global uniqueness across all three artifacts.

### Components and references

Use local references under `#/components/*` and deterministic component identifiers:

- `{Domain}{Resource}Request`
- `{Domain}{Resource}Response`
- `{Domain}{Resource}Error`
- `{Domain}{Resource}ListResponse`

Avoid anonymous repeated schemas. Avoid `$ref` siblings that depend on subtle override semantics; create a named composed schema using `allOf` when an overlay is required. Every generated document must be self-contained and pass an unresolved-reference check.

### Incoming webhook placement

Stripe and Gelato are callers of this backend, so their ingress endpoints belong under normal OpenAPI `paths`. The root-level OAS `webhooks` field describes callbacks initiated by the API provider and is therefore the wrong semantic direction for these two endpoints.

## Source-of-Truth Strategy

### Comparison of the six required strategies

| Strategy | Strengths | Failure modes in this repository | Decision |
|---|---|---|---|
| 1. Handwritten YAML | Human-readable, no generator dependency, fully explicit | Duplicates runtime types and handwritten validators; refactors do not fail; large indentation-sensitive diffs; easy 3.0/3.1 semantic mistakes | Reject as canonical source; generated YAML may be an optional presentation artifact later |
| 2. Route annotations | Metadata is near each handler; common in decorator frameworks | Medusa routes are exported functions, while auth/raw body/native extensions live in central middleware; annotations would pollute large handlers and still miss cross-cutting behavior | Reject |
| 3. Full route-file analysis | Can discover most custom method/path pairs with no manual list | Cannot reliably infer request schemas, responses, auth alternatives, errors, native extensions, raw body, or business invariants | Use only as a coverage/drift input |
| 4. Explicit TypeScript registry | Typed, reviewable, deterministic, handles middleware and native overlays | Schemas can drift when duplicated from runtime validation | Accept as the operation and metadata authority |
| 5. TypeScript registry reusing Zod | One direction-stable schema can govern validation and documentation; strong component reuse | Most current route validators are not Zod; the preferred converter has no public `io` direction switch; transforms/defaults/coercions and response serializers can diverge | Recommended hybrid only where runtime identity and input=output are proven; otherwise use separate direction schemas |
| 6. Test-generated contract | Captures observed examples and can prove behavior | Tests cover scenarios rather than complete schemas; mocks may differ from production; generation becomes order/fixture dependent | Reject as generator; use tests as verification evidence |

### Recommended hybrid

The canonical input should contain four layers:

1. **Operation registry:** method, normalized path, audience, `operationId`, summary, tags, security, parameters, request body, responses, and source classification.
2. **Schema registry:** shared Zod schemas where they truly govern runtime and input=output, separately named direction-stable request/response schemas where shapes diverge, plus explicit OpenAPI schemas for existing handwritten validators/serializers.
3. **Coverage manifest:** discovered custom route exports, explicit native overlays, native-consumed links, and reasoned exclusions.
4. **Generator:** deterministic transformation into three self-contained JSON documents.

Route discovery must never write semantic documentation automatically. It should only fail when a source operation lacks a registry entry or explicit exclusion.

## Zod Reuse Strategy

### Rules for safe reuse

A Zod schema may be reused by OpenAPI generation only when both runtime identity and direction safety are established:

1. the route parses the incoming value with that exact schema, a response serializer validates the outgoing value with that exact schema, or a contract test proves that a stable shared domain schema matches the runtime serializer; and
2. `z.input<T>` and `z.output<T>` describe the same JSON shape for every position in which that schema is registered.

If input and output differ, define separately named request and response schemas whose own converted shapes are direction-stable, or register explicit OpenAPI schemas for those directions. Do not create a “documentation-only Zod schema” and describe it as reused runtime validation. If a route remains manually parsed, an explicit OpenAPI schema is honest and preferable.

### Input and output direction

Zod's first-party JSON Schema API exposes an `io` option, but `@asteasolutions/zod-to-openapi` 9.1.0 does not expose a public equivalent direction selector. API-DOCS-01 must not call undocumented converter internals or assume that request/response placement provides the required direction semantics.

Consequently:

- the same Zod component may be used for a request and response only when a type-level equality guard establishes `z.input<T> = z.output<T>` and fixtures prove the JSON shape;
- a schema containing coercion, preprocessing, a transform, or a default that changes accepted input versus emitted output is not bidirectionally reusable;
- divergent request and response shapes require separately named, direction-stable Zod schemas or explicit OpenAPI schemas;
- generated component names must retain `Request` and `Response` suffixes when directions differ;
- the compile gate must prove that no generator adapter imports internal/non-exported converter APIs.

Particular care is required for dates, branded identifiers, discriminated unions, records, binary bodies, refinements, transformations, coercions, and defaults. A converter's successful output is not proof that runtime parsing or serialization matches it.

### Migration policy

API-DOCS-01 should not refactor every validator. Initial implementation may:

- reuse the existing Zod environment model only for documentation feature-flag parsing, not as an API schema;
- add a shared request/response Zod schema only when input=output is proven, otherwise add separately named direction-stable schemas, and only for a narrowly approved route where tests already lock behavior;
- represent the remaining current routes with explicit registry schemas and contract fixtures;
- record each manual schema as technical debt eligible for later runtime-Zod migration.

This preserves API behavior and avoids turning a documentation initiative into a broad validation refactor.

## Swagger UI Integration Options

### One selector versus separate UIs

| Option | Benefits | Risks | Recommendation |
|---|---|---|---|
| One `/docs` UI with Swagger UI `urls` selector | One discoverable entry point; minimal assets and middleware; audience label can select Store/Admin/Webhooks | A single browser surface can expose every configured URL; `supportedSubmitMethods` is broadly configured rather than operation-policy aware | Recommended only when the server supplies URLs allowed for the current environment/access policy |
| Separate `/docs/store`, `/docs/admin`, `/docs/webhooks` UIs | Strong audience isolation; permits different settings | More routes, assets, CSP tests, and user confusion | Reserve for a future approved Store-only “Try it out” surface |
| External hosted portal/CDN | Minimal local route code | External asset execution, CSP/privacy/supply-chain dependency, and possible contract upload | Reject |

The selected `/docs` page must construct its `urls` array server-side from enabled and authorized contracts. It must not render hidden internal URLs and rely on users not selecting them.

### Integration shape

Preferred implementation:

1. A small Medusa custom route returns a fixed local HTML shell at `/docs`.
2. A narrow Express-compatible handler registered through Medusa maps an exact, version-reviewed asset allowlist below `/docs/assets/`; it must not expose the `swagger-ui-dist` directory through `express.static` or an equivalent wildcard.
3. Three Medusa custom routes return imported, pre-generated JSON artifacts.
4. Feature and access middleware runs before any HTML, asset, or specification response.

This uses Medusa’s documented Express middleware support while retaining precise project control. `swagger-ui-express` is unnecessary and would add a wrapper without solving generation, policy, CSP, or drift.

The initial HTTP asset allowlist is fixed at four files:

- `swagger-ui.css`;
- `swagger-ui-bundle.js`;
- `swagger-ui-standalone-preset.js`;
- project-owned `api-docs-initializer.js`.

The initial manifest therefore contains three package assets and one project-owned asset. It contains no fonts. Every other `swagger-ui-dist` file returns `404`.

If the exact pinned `swagger-ui.css` references an additional runtime asset, Wave 5 blocks. The asset is not served automatically, and changing the manifest requires explicit human review.

The namespace handler may match `/docs/assets/*` for dispatch, but it must return `404` for every path not present in that exact manifest. In particular, it must not serve package-provided `index.html`, `swagger-initializer.js`, `oauth2-redirect.html`, source maps, directory listings, alternate bundles, favicons, or any other non-allowlisted file. It should resolve each approved basename from a constant mapping, set an explicit MIME type, and reject encoded/path-traversal variants before filesystem resolution.

### Mandatory Swagger UI configuration

```js
{
  urls: enabledAndAuthorizedSpecs,
  supportedSubmitMethods: [],
  persistAuthorization: false,
  validatorUrl: null,
  queryConfigEnabled: false,
  withCredentials: false,
  deepLinking: true
}
```

Additional rules:

- use local `swagger-ui-dist` assets only through the exact manifest above;
- do not fetch specifications from a different origin;
- do not pre-authorize credentials;
- do not include real credentials in examples;
- do not enable OAuth redirect support until an actual OAuth flow exists;
- set `Cache-Control: private, no-store` for UI and internal specs;
- set `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `frame-ancestors 'none'`;
- define a narrow CSP for self-hosted scripts/styles. If Swagger UI requires inline bootstrap code, prefer a nonce or a hashed fixed script rather than `unsafe-inline`;
- do not widen existing Store/Admin/Auth CORS configuration for docs.

### “Try it out”

It must be disabled for every contract in the first release. Reasons:

- Admin methods mutate operational state;
- webhook execution would produce invalid or dangerous synthetic ingress;
- Store payment methods can call provider-facing code;
- a multi-contract UI does not naturally express a robust per-audience mutation policy;
- browser-persisted credentials increase exposure.

Any future Store execution profile belongs to a separate initiative with an explicit safe-method allowlist and a dedicated security review. API-DOCS-01 exposes no environment flag that can enable Store, Admin, or webhook execution.

## Security and Exposure Model

### Proposed flags

The environment contract contains exactly four flags:

| Variable | Development | Test | Production |
|---|---:|---:|---:|
| `API_DOCS_ENABLED` | `true` | `true` | `false` |
| `API_DOCS_UI_ENABLED` | `true` | `false` | `false` |
| `API_DOCS_PUBLIC_ENABLED` | `true` | `true` | `false` |
| `API_DOCS_INTERNAL_ENABLED` | `true` | `true` | `false` |

All flags must be parsed by the existing Zod environment configuration, reject ambiguous values, and fail closed. `NODE_ENV` may provide defaults, but explicit configuration must be auditable.

Swagger UI interactivity is disabled unconditionally in API-DOCS-01 through `supportedSubmitMethods: []`. There is no environment flag for interactivity. A future executable profile is outside API-DOCS-01 and requires a separate initiative and security review.

### Environment matrix

| Environment | Generate/lint artifacts | Spec HTTP endpoints | UI | Store public | Admin/Webhooks | Try it out |
|---|---:|---:|---:|---:|---:|---:|
| Local development | Yes | Yes | Yes | Yes, local | Yes, trusted local only | No |
| Test/CI | Yes | Optional for endpoint tests | Off by default | No external exposure | No external exposure | No |
| Production | Yes during build/release validation | Off by default | Off | Off until separately approved | Off | No |

Generated files may exist in a production artifact even when routes are disabled. Therefore, runtime routing and packaging logs must not print or expose their contents.

### Exposure policy

- Disabled docs routes should behave as not found, not advertise that an internal contract exists.
- Enabling Store documentation must not implicitly enable Admin or Webhooks.
- If internal docs are ever enabled outside trusted local development, require the same user-grade Admin authentication used by operational routes or an equivalently reviewed network control.
- Do not rely solely on obscurity, a path prefix, CORS, or Swagger UI hiding.
- Do not add a new shared secret header merely for docs without a separate secret-management design.
- No UI or spec response may contain secret values, plaintext tracking tokens, real signatures, authorization headers, raw customer PII, provider payload samples, or production identifiers.

## Authentication Representation

### Security schemes

The registry should define audience-specific schemes and apply only schemes the runtime actually accepts.

| Scheme | OpenAPI type | Runtime meaning | Notes |
|---|---|---|---|
| `storePublishableApiKey` | `apiKey`, header `x-publishable-api-key` | Native Medusa Store publishable API key | Apply only where Medusa/project middleware requires it. |
| `customerBearer` | `http`, scheme `bearer` | Authenticated customer JWT/bearer | Store customer operations. |
| `customerSession` | `apiKey`, cookie session name documented from runtime | Authenticated customer session | Browser session alternative; do not include cookie examples. |
| `adminBearer` | `http`, scheme `bearer` | Authenticated Medusa user | Custom Admin operations where accepted. |
| `adminSession` | `apiKey`, cookie session name documented from runtime | Authenticated Medusa user session | Alternative to bearer where accepted. |
| `stripeSignature` | `apiKey`, header `stripe-signature` | Stripe webhook signature envelope | Description must require exact raw bytes and server-side verification. |
| `gelatoWebhookSecret` | `apiKey`, header name from configuration | Gelato shared webhook secret | Current default is `X-GELATO-WEBHOOK-SECRET`; state that deployments may configure a different name. |

Security Requirement Objects are OR alternatives when listed separately and AND requirements when schemes share one object. Examples:

- optional customer auth with no other required scheme: `{}`, `{ customerBearer: [] }`, `{ customerSession: [] }`;
- required publishable key with optional customer auth: publishable-only, publishable-plus-bearer, and publishable-plus-session alternatives;
- required customer auth: bearer and session alternatives, without `{}`.

The registry must mirror the middleware rather than infer a uniform rule for all Store routes.

### Custom Admin actor restriction

`apps/backend/src/api/admin/_shared/require-admin-actor.ts:34-74` accepts only an authenticated actor with `actor_type: "user"` and a non-empty actor ID. It rejects API-key actors. Therefore, custom operational Admin operations must be documented with user session/bearer schemes only. An Admin API key must not appear as a valid alternative for these project-owned routes.

### Tracking lookup token

The tracking lookup route accepts a sensitive JSON body containing a token, and its parser explicitly rejects identifier/PII alternatives (`apps/backend/src/modules/tracking-access-token/lookup-body.ts:3-26,56-93`). This token is not an OpenAPI `securityScheme`, because it is part of the operation body rather than a reusable header/cookie/query authentication mechanism.

Document it as:

- a required, `writeOnly` request property;
- never present in examples;
- never accepted in query or path parameters;
- never echoed in responses or errors;
- protected by the route’s existing guard/rate-limiting semantics.

## Webhook Documentation Constraints

### Stripe

The project route uses `stripe-signature` (`apps/backend/src/api/hooks/stripe/route.ts:43`) and the middleware preserves the raw request body (`apps/backend/src/api/middlewares.ts:328-334`). The contract must state:

- signature verification uses the exact received bytes before JSON mutation;
- documentation JSON examples are illustrative only and cannot be replayed as valid signed requests;
- the header value must never appear in examples;
- idempotent duplicate handling and accepted/rejected status codes must be described from route tests;
- Swagger UI execution is prohibited.

### Gelato

The environment default for the ingress header is `X-GELATO-WEBHOOK-SECRET` (`apps/backend/src/config/env.ts:389-392`). The OpenAPI description must not falsely freeze a configurable runtime header. The generated contract may use the approved deployment-standard header name, with a description that configuration must remain aligned, and a drift test must fail if the configured contract default changes.

No real provider payload, tracking URL, customer address, phone, email, secret, or token may be embedded. Examples must be synthetic and minimized.

### Common webhook rules

- Represent ingress under `paths`, not root `webhooks`.
- Set request media types and required headers exactly.
- Describe validation failure status codes without revealing verification detail.
- Document duplicate/retry semantics and safe acknowledgement behavior.
- Mark these operations internal and non-executable.
- Keep provider field passthrough schemas constrained; avoid unconstrained examples that normalize logging sensitive data.
- Treat raw event storage and redaction policy as implementation behavior, not as permission to publish stored event samples.

## Tooling Evaluation

Versions below are the versions or active version lines observed in the official primary sources on 2026-07-30. Implementation must pin exact approved versions in `package-lock.json`.

| Package / approach | Purpose | OAS 3.1 | Node 22 | ESM / CJS | Maintenance signal | Required at runtime? | Advantages | Limitations | Recommendation |
|---|---|---:|---|---|---|---:|---|---|---|
| Existing `zod` 4.2.0 `z.toJSONSchema` | Convert Zod schemas to JSON Schema | Schema dialect yes; does not assemble OpenAPI operations | Yes in current app | Existing project integration | Active first-party Zod 4 docs/repository | Already yes | No new schema converter for pure JSON Schema; input/output modes; registry metadata | No path, response, security, parameter, or OpenAPI component orchestration; current routes mostly lack Zod schemas | Use as a primitive or fallback, not the complete generator |
| `@asteasolutions/zod-to-openapi` 9.1.0 | Explicit OpenAPI registry and V3.1 generation from Zod 4 | Yes, `OpenApiGeneratorV31` | No incompatible engine declared; must prove on locked Node | Dual CJS/ESM entry points in official package | Active repository and 9.1.0 package observed | No | Best match for explicit registry; Zod 4 peer; component registration; 3.1 nullable output | Its public API does not expose Zod's input/output `io` direction switch; one schema is safe in both positions only when input=output; divergent directions need separately registered or explicit schemas; compatibility must be compile-tested | **Preferred devDependency**, with a direction-safety policy and no use of converter internals |
| `zod-openapi` 6.0.x | Generate OAS 3.1 using Zod 4 metadata | Yes | Requires `>=22.14.0` | Package is ESM with import/require exports | Active repository and 6.0.0 package observed | No | Clean Zod `.meta()` model; no prototype extension; strong 3.1 focus | Current project engine permits Node 22 minors below 22.14; document assembly is less aligned with the desired explicit operation registry | Evaluated alternative; **not selected for API-DOCS-01**, not installed, and not part of the implementation plan. Reconsideration requires a new human decision and new compatibility, direction-behavior, version, and Node gates |
| Custom TypeScript registry + native Zod conversion | Assemble OAS directly | Yes if implemented correctly | Yes | Project-controlled Node16 module output | Maintained by project | No | Zero converter dependency; exact behavior | High specification burden; easy to mishandle refs, nullability, directionality, and metadata | Not selected; any reconsideration requires a new human decision |
| `swagger-ui-dist` 5.32.11 | Browser UI assets | Official 5.32 line supports 3.1.2 | Server package is compatible; verify exact lock | Browser bundle plus Node package helpers | Official Swagger API project, active 5.32 line | **Yes**, if assets are served from installed package | Official UI; multi-spec `urls`; local assets; mature configuration | Distribution contains executable/support files the project does not need; exposing the directory would broaden attack surface; CSP requires care; global Try configuration is coarse | **Preferred exact-pinned runtime dependency**, served only through an exact minimal asset manifest |
| `swagger-ui-express` 5.0.2 | Express wrapper around Swagger UI | Delegates to `swagger-ui-dist` | Expected, but adds another compatibility surface | CommonJS-oriented Express wrapper | Maintained but much smaller wrapper project | Yes | Quick setup in plain Express | Medusa already accepts Express middleware; wrapper does not solve auth, generation, CSP, or deterministic assets | Reject |
| `@stoplight/spectral-cli` 6.16.2 | Ruleset-based OpenAPI lint | Yes | Official package supports modern Node including 22 | CLI/library packaging supports modern Node | Mature official Stoplight project | No | Compatible with the repository engine; customizable local OAS rules; deterministic local execution | Requires project checks for cross-document and repository-specific invariants | **Selected exact devDependency**, with root `.spectral.yaml`, local `spectral:oas` only, no remote ruleset, and `--fail-severity warn` |
| TypeScript Compiler API route scanner | Discover exported route methods for coverage | Not applicable | Existing toolchain | Existing TypeScript module configuration | Maintained by project on existing TypeScript | No | No additional parser; understands exports and re-exports; deterministic | Discovery cannot infer contract semantics | Required as a drift-check input |
| Test/fixture-generated OpenAPI | Generate schemas from observed responses | Partial | Yes | Project-controlled | Project-controlled | No | Mirrors selected observations | Incomplete and nondeterministic as authority | Reject as generator; retain fixtures for verification |

### Dependency classification

- `zod`: remains an existing runtime dependency because application environment parsing already uses it.
- `@asteasolutions/zod-to-openapi`: development-only; generator must run before runtime.
- `@stoplight/spectral-cli@6.16.2`: development-only and exclusively selected.
- `swagger-ui-dist`: runtime if the server resolves and serves its installed local files. Making it development-only would require a separately verified build step that copies and fingerprints every asset into the production package.
- `swagger-ui-express`: do not install.
- No database, Redis, provider, migration, or generated-client dependency is required.

### ESM/CJS decision

The backend compiles with TypeScript `module` and `moduleResolution` set to `Node16` (`apps/backend/tsconfig.json:4-7`). The preferred generator package exposes both CommonJS and ESM entry points, so registry code can remain TypeScript and use the project compiler.

- Generator execution: `ts-node --swc`.
- Additional generator `tsconfig`: none initially.
- TypeScript compilation directory: none.

No compiled-generator execution path is introduced. A reproduced incompatibility blocks API-DOCS-01 and requires a new human gate; the implementation must not add a parallel execution strategy automatically. This keeps generation independent of Medusa bootstrap and avoids database/container initialization.

## Generation and Drift Control

### Proposed repository shape

Subject to the human gate:

```text
apps/backend/src/api-docs/
  registry/
    operations/
      store.ts
      admin.ts
      webhooks.ts
    schemas/
    security.ts
    native-boundary.ts
    exclusions.ts
  generated/
    store.openapi.json
    admin.openapi.json
    webhooks.openapi.json
  runtime/
    flags.ts
    serve-spec.ts
    swagger-config.ts
apps/backend/scripts/openapi/
  discover-routes.ts
  generate.ts
  lint.ts
  check.ts
```

Putting generated JSON under `src` allows explicit JSON imports through the existing `resolveJsonModule` setting and gives the compiler/package step a concrete dependency. The implementation must still prove that all JSON and Swagger UI assets exist in `.medusa/server` before any production exposure is approved.

### Deterministic generation

Generated artifacts must:

- use `openapi: 3.1.2`;
- have stable path, method, tag, parameter, response, and component ordering;
- contain no generation timestamp, absolute filesystem path, random ID, host-specific URL, or secret-derived value;
- end with one newline and use a fixed indentation;
- include a stable project version and exact Medusa package version, but no build-time clock;
- use environment-neutral server descriptions or omit `servers` unless approved;
- be byte-identical on two consecutive generations from the same commit.

JSON is the preferred committed and served artifact. YAML would add serialization choices without improving the runtime contract. It may be generated later from the canonical JSON if humans require it.

### Route coverage

The coverage scanner should use the TypeScript Compiler API, not regular expressions, to:

1. enumerate `apps/backend/src/api/**/route.ts`;
2. detect named exports for supported HTTP methods, including re-exports;
3. normalize `[id]` filesystem segments to `{id}`;
4. compare discovered method/path pairs with project registry entries;
5. require an explicit exclusion containing owner, reason, and review condition;
6. compare the explicit native extension/override manifest with project middleware matchers;
7. reject a registry operation with no source classification.

The scanner discovers candidates only. It must not infer schemas or authentication.

### Checks

Recommended scripts:

```text
openapi:generate
openapi:lint
openapi:verify:foundation
openapi:verify:store
openapi:verify:admin
openapi:verify:webhooks
openapi:check
```

`openapi:check` is strictly in-memory and read-only. It:

1. requires a clean worktree and all three committed artifacts to be tracked;
2. builds all three documents in memory;
3. serializes them in memory with the canonical serializer;
4. builds and serializes all three documents a second time in memory;
5. compares both in-memory byte sequences;
6. compares the canonical bytes with the committed artifacts;
7. runs route and native-overlay coverage, Spectral with `--fail-severity warn`, global `operationId` uniqueness, local `$ref` resolution, security, and semantic-drift checks;
8. fails without invoking the writer, creating an output directory, or writing a contract to the filesystem.

`openapi:generate` is the only writer and explicitly updates committed artifacts. `openapi:verify:*` performs read-only scoped validation, `openapi:lint` is read-only, and `openapi:check` performs read-only global validation. `openapi:check` must not execute `openapi:generate`, directly or indirectly. Human review should see both registry changes and generated JSON diff.

Spectral is intentionally complemented by the read-only TypeScript checker for global `operationId` uniqueness, security declarations, reference resolution, Store/Admin/Webhooks separation, route coverage, sensitive examples, and deterministic drift.

### Suggested lint rules

At minimum:

- valid OAS version and structure;
- `operation-operationId`;
- `operation-operationId-unique`;
- no unresolved local references;
- path parameters defined and required;
- referenced security schemes defined;
- responses present for every operation;
- no empty descriptions on security-sensitive fields;
- no server URLs or examples matching secret/token/credential patterns;
- project rule: no `nullable: true`;
- project rule: no Admin/Webhook operation in `store.openapi.json`;
- project rule: no real-looking tracking token or signature example.

Future dependency changes must add root `package.json` configuration with `scarfSettings.enabled=false`, and installation plus CI must run with `SCARF_ANALYTICS=false`. No postinstall analytics is necessary for API-DOCS-01, and no installation occurs during this R3 editorial gate.

## Test Strategy

### Generator unit tests

- same registry produces byte-identical JSON twice;
- duplicate method/path or `operationId` fails;
- optional versus nullable Zod values produce correct OAS 3.1 schemas;
- a type-level registry guard rejects reuse of one component when `z.input<T>` and `z.output<T>` differ;
- separately named request and response schemas produce their expected direction-specific components;
- the generator adapter compiles using public package exports only and contains no import from converter internals;
- missing response, unresolved component, or unknown security scheme fails;
- document audience isolation prevents Admin/Webhook leakage into Store;
- excluded routes require a non-empty reason.

### Coverage tests

- every custom route method is registered or explicitly excluded;
- every registry path maps to a source route or native classification;
- middleware-backed native extensions remain represented;
- scaffold/example routes cannot disappear silently;
- exact Medusa version change causes a native-boundary review failure.

### Contract tests

For representative routes, validate synthetic runtime fixtures against generated schemas:

- success and stable error envelopes;
- optional authenticated versus guest cart behavior;
- Admin user actor acceptance and API-key actor rejection;
- tracking lookup request excludes PII/identifier alternatives and response excludes token;
- Stripe and Gelato headers are required but never logged or echoed;
- nullable values match actual serializers.

Tests verify the contract; they do not generate it.

### HTTP surface tests

- master flag off returns not found for UI, every allowlisted asset URL, the asset namespace fallback, and specs;
- public Store flag does not expose Admin/Webhooks;
- internal contract access is rejected before bytes are served;
- UI configuration has no external validator, no credential persistence, and no submit methods;
- each of the four exact asset manifest entries returns only its expected JS or CSS bytes with an explicit MIME type;
- `/docs/assets/index.html`, `/docs/assets/swagger-initializer.js`, `/docs/assets/oauth2-redirect.html`, every source map, alternate bundle, font, directory request, and arbitrary filename return `404`;
- CSP, cache, content type, nosniff, and referrer headers are present;
- docs routes do not change application CORS;
- path traversal cannot access arbitrary `swagger-ui-dist` or filesystem files;
- no docs endpoint is registered in worker-only mode.

### Non-requirements

Generation and structural tests must not require:

- PostgreSQL or a migration;
- Redis;
- Stripe, Gelato, Resend, Sentry, PostHog, Supabase, or Heroku access;
- real credentials or production data;
- starting the full Medusa container.

## Runtime and Deployment Impact

### Expected impact

- No schema migration or database data change.
- No Redis state or queue change.
- No provider call.
- No worker behavior change.
- The web artifact grows by the pinned Swagger UI dependency and three JSON documents, while only the reviewed minimal asset manifest is HTTP-accessible.
- The HTTP surface adds four logical read-only documentation endpoints (`/docs` plus three specs) and one constrained `/docs/assets/` namespace containing exactly four GET targets; the namespace fallback is always `404`.
- Build/CI gains deterministic generation and lint steps.

### Startup model

Runtime must import already generated JSON. It must not:

- walk route files;
- execute TypeScript generation;
- query the database;
- resolve the Medusa dependency container;
- contact a validator, CDN, package registry, or provider;
- rebuild the contract on every request.

If generated artifacts are missing or malformed, the build/check must fail. Production should not “recover” by dynamically generating them.

### Packaging proof

Before enabling any deployed UI, implementation tests must prove:

- imported JSON is present in `.medusa/server`;
- every local Swagger UI manifest asset is present and has an explicit expected digest/MIME mapping;
- package `index.html`, `swagger-initializer.js`, `oauth2-redirect.html`, source maps, non-manifest fonts, and every other distribution file remain unreachable;
- Node module-format resolution works in the built server;
- disabled flags produce no reachable route;
- rollback is only an environment-flag reversal and does not require database rollback.

## Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Documentation claims Zod reuse that runtime does not perform | High / High | Exact-schema identity rule; manual schemas labeled honestly; contract fixtures |
| Preferred converter emits the wrong direction for a schema with different input/output types | Medium / High | Reuse only input=output schemas; separately named request/response or explicit schemas; public-API compile gate |
| Native Medusa contract is copied and drifts | Medium / High | Boundary classification, upstream links, exact Medusa version drift gate |
| Middleware semantics are missed by route scanning | High / High | Explicit registry plus middleware/native overlay manifest |
| Admin or webhook spec leaks through the Store UI | Medium / High | Separate artifacts and flags; authorized URL list built server-side; isolation tests |
| Swagger UI enables state-changing requests | Medium / Critical | Immutable `supportedSubmitMethods: []`; no interactivity environment flag; future executable profiles require a separate initiative and security review |
| Credentials persist in browser storage | Medium / High | `persistAuthorization: false`; no examples; no pre-authorization |
| Browser sends schemas to external validator/CDN | Medium / High | `validatorUrl: null`; local assets; restrictive CSP |
| Raw webhook semantics are misrepresented | Medium / High | Explicit path metadata, raw-body descriptions, signature tests, no Try |
| Tracking tokens or PII appear in examples | Medium / Critical | No token examples; synthetic minimized fixtures; secret-pattern lint |
| Spectral configuration drifts to a remote ruleset or ignores warnings | Medium / High | Pin `@stoplight/spectral-cli@6.16.2`, use root `.spectral.yaml` with local `spectral:oas` only, forbid ignore files, and require `--fail-severity warn` |
| Dependency installation emits Scarf analytics | Medium / Medium | Set root `scarfSettings.enabled=false` and require `SCARF_ANALYTICS=false` for local and CI installation |
| `zod-openapi` requires a higher Node 22 minor than the current engine guarantees | High under current range / Medium | Evaluated and not selected for API-DOCS-01; reconsideration requires a new human decision plus compatibility, direction-behavior, version, and Node gates |
| Generated output changes nondeterministically | Low / Medium | Stable sort, no timestamps, double-generation byte comparison |
| Swagger assets/specs missing from Medusa build | Medium / Medium | Compile/package integration test before exposure |
| Whole `swagger-ui-dist` directory exposes initializer, OAuth redirect, source maps, or unused code | Medium / High | Constant exact asset manifest; no `express.static`; explicit `404` tests for all non-allowlisted paths |
| Generated artifacts become stale in Git | Medium / High | `openapi:check` byte comparison required in CI |
| OpenAPI 3.0 nullability idioms enter a 3.1 contract | Medium / Medium | Project lint forbids `nullable: true`; converter V31 |

## Recommended Architecture

### Final recommendation

1. Adopt exact OAS 3.1.2.
2. Create an explicit TypeScript operation registry split into Store, Admin, and Webhooks.
3. Use `@asteasolutions/zod-to-openapi` 9.1.0 in development for OAS 3.1 assembly, without depending on an undocumented input/output direction mode or any converter internal API. If it becomes unusable, stop API-DOCS-01; do not switch generators automatically.
4. Reuse one Zod schema across directions only where the same schema governs runtime and input=output is proven; otherwise register separately named direction-stable request/response schemas or explicit schemas plus contract fixtures.
5. Generate and commit three stable JSON artifacts under source control.
6. Use TypeScript AST discovery only to enforce custom-route coverage.
7. Maintain a separate native boundary manifest for project extensions, overrides, and directly consumed native routes.
8. Lint exclusively with exact `@stoplight/spectral-cli@6.16.2`, root `.spectral.yaml`, local `spectral:oas`, and `--fail-severity warn`.
9. Serve imported JSON and an exact minimal allowlist of pinned local `swagger-ui-dist` assets through narrow Medusa routes/middleware; every other distribution path returns `404`.
10. Present one `/docs` selector containing only contracts allowed for the current request/environment.
11. Disable external validation, credential persistence, and every submit method.
12. Default every production exposure flag to false.

### Contract ownership flow

```text
direction-safe runtime Zod (input=output) ─┐
separate request/response schemas ─────────┤
explicit OpenAPI schema otherwise ─────────┼─> typed operation registry
explicit auth/error metadata ──────────────┤
native boundary manifest ─────────────────┘
                                      |
                                      v
                          deterministic generator
                                      |
                         +------------+-------------+
                         |            |             |
              store.openapi.json admin.openapi.json webhooks.openapi.json
                         |            |             |
                         +----- lint / drift --------+
                                      |
                                      v
                         gated read-only HTTP serving
```

The registry, not the generated JSON and not the Swagger UI, is the editable semantic authority. Generated files are reviewable build products and runtime inputs.

## Rejected Alternatives

- **OpenAPI 3.0.x:** wrong nullability/JSON Schema model for the requested initiative and Zod 4.
- **OpenAPI 3.2 now:** newer but outside the stated 3.1 scope and less broadly supported by the selected converter/UI combination.
- **Manual YAML as authority:** duplicates runtime contracts and provides weak drift enforcement.
- **Annotations inside route handlers:** cannot capture central middleware/native overlay semantics cleanly.
- **Runtime route introspection:** cannot infer reliable schemas/auth and adds startup/runtime risk.
- **Tests as the generator:** observed fixtures are incomplete and potentially nondeterministic.
- **Assuming the preferred converter selects Zod input/output direction automatically:** its public 9.1.0 API exposes no equivalent of Zod's `io`; divergent shapes require separate schemas.
- **Automatic copy of Medusa’s full spec:** creates an unowned, stale fork.
- **One combined Store/Admin/Webhooks JSON:** increases accidental disclosure and prevents independent exposure.
- **Root-level OAS `webhooks` for Stripe/Gelato ingress:** semantically reversed; these providers call normal server paths.
- **`swagger-ui-express`:** unnecessary wrapper in a Medusa/Express-compatible stack.
- **Serving the whole `swagger-ui-dist` directory:** exposes unused HTML, initializer, OAuth redirect, source maps, and alternate bundles; only a constant minimal manifest is permitted.
- **CDN-hosted Swagger UI assets:** weakens CSP, privacy, availability, and supply-chain control.
- **External Swagger validator:** transmits internal contracts outside the service boundary.
- **Dynamic generation at startup or request time:** adds toolchain code to production and can require unavailable source files.
- **Production “Try it out”:** unacceptable for money, fulfillment, webhook, and Admin operations.
- **Persisted Swagger authorization:** leaves credentials in browser storage.
- **Immediate mass conversion of validators to Zod:** broad behavior-changing refactor outside a documentation gate.
- **`zod-openapi` for API-DOCS-01:** evaluated but not selected, not installed, and absent from the implementation plan. Reconsideration requires a new human decision and renewed compatibility, direction-behavior, version, and Node research.

## Official Sources

Only official/primary sources were used for external technical claims.

| URL | Consulted | Claim used | Project impact |
|---|---|---|---|
| https://spec.openapis.org/oas/v3.1.2.html | 2026-07-30 | Exact OAS 3.1.2 rules, JSON Schema 2020-12-derived dialect, unique `operationId`, components, security, paths, and root webhooks semantics | Sets the contract version and schema/security rules |
| https://github.com/OAI/OpenAPI-Specification/releases | 2026-07-30 | 3.1.2 is a 3.1 patch of clarifications/fixes | Supports exact 3.1.2 selection |
| https://docs.medusajs.com/learn/fundamentals/api-routes | 2026-07-30 | File-based custom route model and exported HTTP methods | Informs AST route discovery |
| https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares | 2026-07-30 | Medusa middleware is Express-compatible and supports method/path matchers | Supports narrow UI asset/access middleware |
| https://docs.medusajs.com/learn/fundamentals/api-routes/protected-routes | 2026-07-30 | User/customer session, bearer, and API-key protection patterns; constraints on native route auth | Informs security schemes and native boundary |
| https://docs.medusajs.com/api/store | 2026-07-30 | Official Store API reference and upstream OpenAPI download | Upstream authority for unchanged native Store operations |
| https://docs.medusajs.com/api/admin | 2026-07-30 | Official Admin API reference | Upstream authority for unchanged native Admin operations |
| https://zod.dev/json-schema | 2026-07-30 | Zod 4 JSON Schema conversion, Draft 2020-12 default, input/output modes, metadata, and conversion limits | Defines safe Zod reuse and 3.1 nullability handling |
| https://github.com/asteasolutions/zod-to-openapi | 2026-07-30 | Zod 4 support, explicit registry, `OpenApiGeneratorV31`, OAS 3.1 behavior, and the documented public API surface without a Zod `io`-equivalent direction switch | Preferred generator candidate with input=output restriction |
| https://github.com/asteasolutions/zod-to-openapi/blob/master/package.json | 2026-07-30 | 9.1.0 package metadata, Zod 4 peer, and dual CJS/ESM exports | Dependency and module compatibility evaluation |
| https://github.com/samchungy/zod-openapi | 2026-07-30 | Zod metadata-based OAS 3.1 document generation | Evaluated alternative |
| https://github.com/samchungy/zod-openapi/blob/master/package.json | 2026-07-30 | 6.0.0 metadata, Zod 4 peer, dual import/require exports, Node >=22.14 | Explains current engine mismatch |
| https://github.com/swagger-api/swagger-ui | 2026-07-30 | Official Swagger UI project and current OAS 3.1.2 support | Preferred renderer |
| https://registry.npmjs.org/swagger-ui-dist/latest | 2026-07-30 | Current exact package version is 5.32.11 | Pins the reviewed runtime asset package |
| https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/installation.md | 2026-07-30 | `swagger-ui-dist` is intended for server-side asset distribution; local and CDN installation patterns | Supports local runtime assets |
| https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/configuration.md | 2026-07-30 | `urls`, `supportedSubmitMethods`, `persistAuthorization`, `validatorUrl`, and `queryConfigEnabled` behavior | Defines secure UI configuration |
| https://github.com/scottie1984/swagger-ui-express | 2026-07-30 | Express wrapper behavior and dependency on Swagger UI assets | Supports rejection of the extra wrapper |
| https://github.com/stoplightio/spectral | 2026-07-30 | OAS 3.1-capable local ruleset/CLI and modern Node compatibility | Selected exclusive linter |
| https://registry.npmjs.org/@stoplight%2fspectral-cli/latest | 2026-07-30 | Current exact package version is 6.16.2 and its engine supports Node 22 | Pins the selected development tool |

## Open Questions

1. May the Store specification eventually be public in production, or must all production docs remain disabled?
2. If internal docs are enabled outside local development, which approved additional network control protects them?
3. Which unchanged native Medusa Store operations are directly consumed by the future storefront and therefore require cross-reference entries?
4. Which current handwritten validators may be migrated to shared Zod in a future behavior-preserving initiative?
5. Do the six official Medusa `2.16.0` URLs match the final selected native operations?
6. Do the six native-extension fingerprints still match their reviewed local evidence?

## Human Approval Gate

The R2 correction records these decisions as taken:

| Decision | Approved value |
|---|---|
| OpenAPI | `3.1.2` |
| Contract split | Store / Admin / Webhooks |
| Source of truth | Explicit TypeScript registry |
| Generator | `@asteasolutions/zod-to-openapi@9.1.0` |
| Linter | `@stoplight/spectral-cli@6.16.2`, root `.spectral.yaml`, local `spectral:oas` only |
| Swagger assets | `swagger-ui-dist@5.32.11` |
| Try it out | Not implemented in API-DOCS-01; `supportedSubmitMethods: []` unconditionally |
| Scaffold routes | `/store/custom` and `/admin/custom` are explicit API-DOCS-01 exclusions |
| Health | `GET /health/live` and `GET /health/ready` are in `store.openapi.json`, tagged `Infrastructure`, with `security: []` |
| Initial asset manifest | Exactly `swagger-ui.css`, `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js`, and `api-docs-initializer.js`; no fonts |
| `openapi:check` | In-memory and read-only; no writer invocation or filesystem contract generation |
| `zod-openapi` | Evaluated alternative; not selected, not installed, and not part of the implementation plan |
| Production | Disabled by default |
| Database changes | Not expected |
| Migration | Not expected |

Implementation remains blocked until all genuinely pending gates are satisfied:

1. final human review of the corrected R2 artifacts;
2. confirmation of the six official Medusa `2.16.0` URLs;
3. review of the six native-extension fingerprints and their local evidence;
4. explicit authorization to install dependencies and begin Wave 1;
5. separate approval for any package or runtime version change;
6. separate approval for any production exposure;
7. separate approval for deployment.

The scaffold-route, health-placement, initial-asset, check-mode, linter, generator, and Try-it-out decisions are closed for API-DOCS-01 and do not remain approval gates.

**Research recommendation:** keep implementation blocked until final R2 human review and explicit Wave 1 authorization. A future implementation gate should remain local and reversible, with generated-artifact, package, supply-chain, security, and route-coverage proof before any production exposure is considered.
