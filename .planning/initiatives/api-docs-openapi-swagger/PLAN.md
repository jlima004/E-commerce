# API-DOCS-01 — Implementation Plan

## Goal

Implement a verifiable OpenAPI contract and a locally served Swagger UI for the
completed backend MVP, without changing business behavior.

The implementation will:

- publish three OpenAPI `3.1.2` contracts: Store, Admin, and Webhooks;
- use an explicit TypeScript registry as the documentation source of truth;
- reuse a Zod schema only when that same schema governs the runtime contract;
- require explicit operation metadata for every documented operation;
- generate three deterministic, committed JSON artifacts outside the runtime;
- serve those generated artifacts at:
  - `GET /openapi/store.json`;
  - `GET /openapi/admin.json`;
  - `GET /openapi/webhooks.json`;
- serve one local-assets-only Swagger UI at `GET /docs`;
- render every operation as non-interactive in the initial UI;
- keep UI and specification routes disabled in production by default;
- fail CI when registry output, route coverage, security classification, or
  committed artifacts drift.

This plan is implementation planning only. No implementation, dependency
installation, test execution, migration, deployment, or provider operation is
authorized by this artifact.

## Non-Goals

- Do not reopen, retag, or otherwise modify milestone `v1.0`.
- Do not create Phase 13, a new milestone, or storefront code.
- Do not copy the complete Medusa native Store/Admin API reference.
- Do not infer request schemas, response schemas, authentication, headers, or
  status codes from route names.
- Do not replace existing manual validators merely to make documentation
  generation convenient.
- Do not change payment, Order creation, refund, exchange, fulfillment,
  tracking, health, webhook, or audit behavior.
- Do not expose internal data models such as `WebhookEventLog`,
  `AdminActionLog`, or tracking-token hashes as public API schemas.
- Do not enable `Try it out` for Store, Admin, or Webhook operations in this
  initiative.
- Do not use a CDN, `swagger-ui-express`, runtime registry generation, or an
  external Swagger validator.
- Do not add database tables, columns, indexes, constraints, migrations, seed
  data, Redis keys, jobs, or provider calls.
- Do not deploy or enable documentation in production during implementation.

## Preconditions

Implementation may start only when all of the following are true:

1. Human review explicitly approves:
   - `.planning/initiatives/api-docs-openapi-swagger/RESEARCH.md`;
   - `.planning/initiatives/api-docs-openapi-swagger/ROUTE-INVENTORY.md`;
   - this plan.
2. The implementation branch is created from the approved `main` baseline and
   the worktree is clean.
3. `apps/backend/package.json` still pins Medusa to `2.16.0`, Zod to `4.2.0`,
   and Node to `>=22 <23`; any version drift requires renewed compatibility
   review before dependency changes.
4. The lint toolchain decision is fixed: install exactly
   `@stoplight/spectral-cli@6.16.2` as a `devDependency`, create only the root
   `.spectral.yaml`, extend only the locally installed `spectral:oas` ruleset,
   forbid remote rulesets and ignore files, and invoke every artifact
   explicitly with `--fail-severity warn`. Redocly is not installed, not
   configured, and not an implementation option.
5. The route inventory has no unresolved authentication, request, response, or
   status-code gaps for an operation proposed for the initial contract. An
   operation with missing evidence remains explicitly excluded; its contract
   must not be invented.
   `/store/custom` and `/admin/custom` are already explicit API-DOCS-01
   exclusions because they are scaffold/example routes. They are not included
   in the initial contracts. Physical removal is outside this initiative and
   requires a separate cleanup decision.
6. The missing per-operation Medusa `2.16.0` official-reference URLs are an
   explicit, currently unsatisfied Wave 1 documentary task, not an assumed
   precondition. Wave 2 is blocked until all six local native extensions have
   reviewed URLs, inclusion reasons, local evidence, and committed
   fingerprints.
7. `swagger-ui-dist@5.32.11` is the exact approved UI asset package. Any proposed
   patch change requires human review before Wave 1; installation must never
   use a version range or `latest`.
8. Package versions are installed exactly as approved below and recorded in
   `package-lock.json`; no unpinned `latest` install is allowed.
9. Production documentation remains disabled until a later, explicit human
   operational approval.

## Architecture Decision

### Confirmed baseline

- Medusa routes are file-based under `apps/backend/src/api/**/route.ts`.
- Explicit HTTP exports currently use `GET` and `POST`; route discovery must
  nevertheless support every Medusa-supported method.
- `apps/backend/src/api/middlewares.ts` both protects custom Store operations
  and changes native Store/Admin behavior.
- Existing custom-route validation is predominantly manual. The current local
  Zod usage in `apps/backend/src/config/env.ts` is environment validation, not
  an API request/response contract.
- The Store catalog and cart responses are changed by local query-config and
  serializer middleware, so the native Medusa response alone is insufficient.
- Stripe requires `stripe-signature` plus the preserved raw body.
- Gelato uses the configured header name whose code default is
  `X-GELATO-WEBHOOK-SECRET`.
- Admin refund, exchange, and operational-alert handlers require a real user
  actor and reject API-key actors at the application layer.
- `AdminActionLog` has no standalone HTTP read route in the current inventory;
  its relevant API surface is the audit side effect of sensitive Admin
  operations.
- PaymentAttempt and refund amounts are integer BRL minor units; Cart and
  PaymentSession monetary amounts are BRL major units. Documentation must not
  collapse that existing boundary.

### Selected architecture

1. **Specification:** emit OpenAPI `3.1.2` and JSON Schema 2020-12 semantics.
   Nullable values use JSON Schema unions that include `null`; the OpenAPI 3.0
   `nullable` keyword is forbidden.
2. **Source of truth:** use three explicit TypeScript registries under
   `apps/backend/src/api-docs/registry.ts`, populated by domain-specific
   operation modules.
3. **Schema policy:**
   - reuse a Zod schema only when the same exported schema is used by runtime
     validation or serialization;
   - because `@asteasolutions/zod-to-openapi@9.1.0` does not expose a public
     input/output (`io`) selector, reuse one schema for request and response
     only when runtime input and output are provably identical;
   - when input and output differ because of transforms, defaults, stripping,
     serializers, or response enrichment, register separately named
     `*Request` and `*Response` schemas and prove both with contract tests;
   - retain an explicit OpenAPI schema when the runtime contract is manual,
     deriving every field from handlers, serializers, tests, and the approved
     inventory;
   - add characterization tests before any optional extraction of a manual
     validator into shared Zod;
   - block publication when evidence is incomplete.
4. **Operation policy:** every operation declares method, normalized path,
   `operationId`, tags, summary, security, parameters, request body where
   applicable, all evidenced responses, provenance, inclusion reason, and
   non-interactive classification. The four Store operations marked by the
   approved inventory as possible future interaction candidates remain
   documentary metadata only; no executable allowlist is emitted by this plan.
5. **Reusable components:** register shared schemas, parameters, responses, and
   security schemes once, then emit self-contained documents with internal
   `$ref` values. Do not maintain a parallel hand-written components tree.
6. **Contract split:**
   - Store: public/custom Store operations, selected native Store contracts,
     and `GET /health/live` plus `GET /health/ready`, tagged
     `Infrastructure` with `security: []`;
   - Admin: custom Admin operations and only the locally extended or explicitly
     selected native Admin contracts;
   - Webhooks: Stripe and Gelato inbound contracts.
   No separate infrastructure document is part of API-DOCS-01.
7. **Generation:** build the three documents in a fixed registry order,
   canonicalize all object keys and operation collections, and write UTF-8 JSON
   with two-space indentation, LF endings, and one terminal newline.
8. **Runtime:** generated JSON is committed below
   `apps/backend/src/api-docs/generated/` and imported by the HTTP handlers.
   Registry/generator packages remain development-only and are not invoked by
   web or worker processes. Medusa's file-based route segments are named
   `store.json`, `admin.json`, and `webhooks.json`, so the runtime paths are
   exactly `/openapi/store.json`, `/openapi/admin.json`, and
   `/openapi/webhooks.json`; extensionless aliases must return `404`.
9. **Swagger UI:** use `swagger-ui-dist` local assets, one `/docs` shell with
   Store/Admin/Webhooks selection, no CDN, no external validator, no persisted
   authorization, no query-string configuration, and
   `supportedSubmitMethods: []` at the shared root configuration.
10. **Generator selection:** use
    `@asteasolutions/zod-to-openapi@9.1.0`. `zod-openapi` is an evaluated
    alternative, not selected for API-DOCS-01, not installed, and not part of
    this implementation plan. If the approved generator becomes unusable, the
    initiative stops. Reconsideration requires a new human decision,
    compatibility and direction-behavior research, and explicit version and
    Node gates.
11. **Native Medusa boundary:** do not discover or copy all routes from
    `node_modules`. Track the approved native subset in a versioned manifest
    tied to Medusa `2.16.0`. The six local native extensions use conservative
    full-file evidence fingerprints and focused contract tests; any package or
    evidence-file change invalidates the manifest and requires human review.

### Rejected implementation approaches

- Hand-written YAML is rejected because it duplicates runtime contracts and
  provides weak drift detection.
- Route annotations are rejected because operation/security metadata would be
  scattered through business handlers.
- Filesystem heuristics as the complete generator are rejected because they
  cannot prove runtime schemas, authentication, or status codes.
- Test snapshots as the sole source are rejected because examples do not define
  complete contracts.
- Runtime OpenAPI generation is rejected because documentation remains a build
  artifact and generator dependencies must not affect web/worker startup.
- `swagger-ui-express` and CDN assets are rejected in favor of the smaller,
  auditable `swagger-ui-dist` asset surface.

## Proposed File Structure

```text
apps/backend/src/api-docs/
├── registry.ts
├── document.ts
├── contracts.ts
├── components/
│   ├── errors.ts
│   ├── parameters.ts
│   ├── responses.ts
│   └── security-schemes.ts
├── operations/
│   ├── store/
│   │   ├── catalog.ts
│   │   ├── carts.ts
│   │   ├── customers.ts
│   │   ├── payment-attempts.ts
│   │   ├── tracking.ts
│   │   └── health.ts
│   ├── admin/
│   │   ├── products.ts
│   │   ├── refunds.ts
│   │   ├── exchanges.ts
│   │   └── operational-alerts.ts
│   └── webhooks/
│       ├── stripe.ts
│       └── gelato.ts
├── coverage/
│   ├── discover-routes.ts
│   ├── exclusions.ts
│   ├── native-routes.ts
│   └── native-fingerprints.ts
├── generation/
│   ├── build-documents.ts
│   ├── canonicalize.ts
│   └── serialize.ts
├── runtime/
│   ├── exposure.ts
│   ├── documents.ts
│   └── swagger-assets.ts
├── generated/
│   ├── store.openapi.json
│   ├── admin.openapi.json
│   └── webhooks.openapi.json
└── __tests__/
    ├── generation.unit.spec.ts
    ├── coverage.unit.spec.ts
    ├── security.unit.spec.ts
    ├── exposure.unit.spec.ts
    ├── money-units.contract.spec.ts
    └── native-extensions.contract.spec.ts

apps/backend/scripts/openapi/
├── generate.ts
├── check.ts
├── lint.ts
└── toolchain.ts

apps/backend/src/api/docs/
├── route.ts
└── assets/[asset]/route.ts

apps/backend/src/api/openapi/
├── store.json/route.ts
├── admin.json/route.ts
└── webhooks.json/route.ts

apps/backend/integration-tests/http/
└── api-docs.spec.ts

docs/openapi/
└── README.md

ops/
└── API_DOCS.md

.github/workflows/
└── api-docs.yml

root linter config:
└── .spectral.yaml
```

Differences from the initial illustrative structure are intentional:

- generated JSON lives inside backend source so `medusa build` includes it and
  runtime handlers do not depend on repository-relative filesystem paths;
- there is no hand-maintained `docs/openapi/components/` tree because the
  TypeScript registry owns components;
- there are exactly three committed generated specifications, matching the
  three served JSON endpoints;
- literal `.json` route-directory names are required by Medusa's file-based
  routing; `/openapi/store`, `/openapi/admin`, and `/openapi/webhooks` are not
  aliases;
- `docs/openapi/README.md` documents maintenance but is not a second contract
  source.

## Dependency Changes

All changes below occur only after the human approval gate.

| Manifest | Package | Classification | Exact selection | Purpose |
| --- | --- | --- | --- | --- |
| `apps/backend/package.json` | `@asteasolutions/zod-to-openapi` | `devDependency` | `9.1.0` | Explicit registry and OpenAPI 3.1 document generation from Zod/raw components |
| `apps/backend/package.json` | `@stoplight/spectral-cli` | `devDependency` | `6.16.2` exactly | Selected local OpenAPI 3.1 lint baseline |
| `apps/backend/package.json` | `swagger-ui-dist` | runtime `dependency` | `5.32.11` exactly | Local Swagger UI HTML/JS/CSS assets |

The future dependency change must also add this root manifest setting:

```json
{
  "scarfSettings": {
    "enabled": false
  }
}
```

Local installation and CI must apply `SCARF_ANALYTICS=false` to the approved
install command. Scarf postinstall analytics is not necessary for the
implementation and no installation is authorized by this R3 editorial gate.

Additional rules:

- Keep existing `zod@4.2.0`; do not add a second Zod major or import
  package-private Medusa schemas.
- Use the already declared `ts-node` development tool for TypeScript generator
  scripts. A reproduced incompatibility blocks API-DOCS-01 and requires a new
  human gate; do not add a new script runner automatically.
- Update `package-lock.json` only through the approved workspace install.
- Do not add `swagger-ui-express`, a YAML source package, an external validator
  client, or another OpenAPI linter.
- The committed `toolchain.ts`, package manifest, lockfile, root
  `.spectral.yaml`, scripts, and CI command must agree on exact Spectral
  `6.16.2`.
- Create root `.spectral.yaml`, extend only local `spectral:oas`, configure the
  reviewed rules, and invoke `--fail-severity warn` over the three explicit
  generated JSON paths; do not reference remote URLs or create an ignore file.
- `scripts/openapi/lint.ts` verifies the committed selection and exact package
  version, invokes only the selected local binary without a
  shell or network access, and fails on configuration mismatch, warning/error,
  invalid OpenAPI 3.1 structure, unresolved `$ref`, missing/duplicate
  `operationId`, or invalid security reference. The custom read-only checker
  complements Spectral with global `operationId` uniqueness, security,
  reference, contract-partition, route-coverage, sensitive-example, and
  deterministic-drift checks.

Database and infrastructure impact:

```text
database schema changes:
  not expected

migration:
  not expected

Redis changes:
  not expected

provider changes:
  not expected
```

Any discovered need for persistence, migration, Redis, or a provider call
blocks API-DOCS-01 and requires a separate human gate.

## Environment Contract

Add exactly the following four booleans to `apps/backend/src/config/env.ts` and
document them in `apps/backend/.env.template`:

| Variable | Development default | Test default | Production default | Meaning |
| --- | ---: | ---: | ---: | --- |
| `API_DOCS_ENABLED` | `true` | `true` | `false` | Master switch for specification routes |
| `API_DOCS_UI_ENABLED` | `true` | `false` | `false` | Enables `/docs` |
| `API_DOCS_PUBLIC_ENABLED` | `true` | `true` | `false` | Enables the Store document endpoint |
| `API_DOCS_INTERNAL_ENABLED` | `true` | `true` | `false` | Enables Admin/Webhook documents, subject to protection |

Exposure rules:

1. If `API_DOCS_ENABLED=false`, every `/docs` and `/openapi/*` route returns
   `404` without loading Swagger assets or a specification.
2. Subordinate flags cannot bypass the master switch.
3. Production keeps all flags false when variables are absent.
4. Production Store exposure requires both `API_DOCS_ENABLED=true` and
   `API_DOCS_PUBLIC_ENABLED=true`.
5. Production Admin/Webhook exposure requires
   `API_DOCS_INTERNAL_ENABLED=true` and authenticated Medusa user access using
   session or bearer authentication. API-key actors are not accepted for this
   documentation surface.
6. In development and test, internal visibility may be enabled for local
   verification, but every UI document remains non-interactive.
7. Swagger UI interactivity is not configurable in API-DOCS-01 and is disabled
   unconditionally through `supportedSubmitMethods: []`. No environment flag
   exists for interactivity. Any future executable profile requires a separate
   initiative and security review.
8. No flag contains a token or secret, and no new documentation-specific secret
   is introduced.
9. The web process serves documentation routes; the worker does not generate,
   load, or serve Swagger UI.

## Implementation Waves

Execution is strictly linear:

| Wave | Depends on | Deliverable | Exit gate |
| --- | --- | --- | --- |
| 1 — Foundation | approved planning | registry, components, generator, selected linter, native evidence | foundation-only check and deterministic skeletons pass |
| 2 — Store API | Wave 1 | Store contract | Store-only evidence and coverage pass |
| 3 — Admin API | Wave 2 | Admin contract | Admin-only evidence/security/coverage pass |
| 4 — Webhooks | Wave 3 | Webhook contract | Webhook-only signature/raw-body/idempotency/coverage pass |
| 5 — Swagger UI | Wave 4 | guarded JSON endpoints and `/docs` | HTTP/security/CSP tests pass |
| 6 — Gates | Wave 5 | CI, drift/coverage gates, docs, runbook | full binary acceptance gate |

No wave may consume an artifact from a later wave.

Unless a command block says otherwise, run every command with
`cwd=/home/jlima/Projetos/ecommerce/Backend` (the repository root).
Unqualified `npm run openapi:*` commands target root scripts; commands carrying
`-w @dtc/backend` explicitly target the backend workspace. The workflow must
not depend on a local agent-only command wrapper.

### Wave 1 — Foundation

#### Changes

1. Install only the approved dependencies and record the lockfile change. Add
   root `scarfSettings.enabled=false`, and run the approved install with
   `SCARF_ANALYTICS=false`; no postinstall analytics is required.
2. Add root wrappers to `package.json`:

   ```text
   openapi:generate          -> npm run openapi:generate -w @dtc/backend
   openapi:lint              -> npm run openapi:lint -w @dtc/backend
   openapi:verify:foundation -> npm run openapi:verify:foundation -w @dtc/backend
   openapi:verify:store      -> npm run openapi:verify:store -w @dtc/backend
   openapi:verify:admin      -> npm run openapi:verify:admin -w @dtc/backend
   openapi:verify:webhooks   -> npm run openapi:verify:webhooks -w @dtc/backend
   openapi:check             -> npm run openapi:check -w @dtc/backend
   ```

3. Add backend scripts to `apps/backend/package.json`:

   ```text
   openapi:generate          -> ts-node --swc scripts/openapi/generate.ts --write
   openapi:lint              -> ts-node --swc scripts/openapi/lint.ts
   openapi:verify:foundation -> ts-node --swc scripts/openapi/check.ts --coverage-scope foundation --allow-untracked
   openapi:verify:store      -> ts-node --swc scripts/openapi/check.ts --coverage-scope store --allow-untracked
   openapi:verify:admin      -> ts-node --swc scripts/openapi/check.ts --coverage-scope admin --allow-untracked
   openapi:verify:webhooks   -> ts-node --swc scripts/openapi/check.ts --coverage-scope webhooks --allow-untracked
   openapi:check             -> ts-node --swc scripts/openapi/check.ts --coverage-scope global --require-tracked --require-clean
   ```

   These `ts-node --swc` commands are the initial generator execution path.
   No additional generator `tsconfig` or TypeScript compilation directory is
   created. A reproduced incompatibility blocks API-DOCS-01 and requires a new
   human gate; no alternate execution path is added automatically.

   The writer accepts only `--surface all|store|admin|webhooks`; Wave 1 uses
   `all`, and Waves 2–4 use only their named surface. Omitted or unknown scope
   fails instead of rewriting an unintended artifact.

4. Commit the approved `toolchain.ts` and root `.spectral.yaml`. Extend only the
   locally installed `spectral:oas`, forbid remote rulesets and ignore files,
   list all three generated JSON artifacts explicitly, and fail on warnings or
   errors with `--fail-severity warn`. The `openapi:lint` script invokes only
   exact local Spectral `6.16.2`.
5. Create Store, Admin, and Webhook registries with shared component helpers.
6. Pin document metadata:
   - `openapi: 3.1.2`;
   - fixed contract titles;
   - an explicitly versioned contract value, never a timestamp or machine SHA;
   - relative same-origin server URLs;
   - stable tag order.
7. Define an operation metadata type that makes provenance, authentication
   evidence, inclusion decision, and non-interactive/candidate classification
   mandatory.
8. Implement canonical serialization:
   - fixed contract order: Store, Admin, Webhooks;
   - lexicographic path, component, and schema-key order;
   - canonical HTTP-method order;
   - two-space JSON indentation;
   - LF and one final newline;
   - no dates, absolute paths, environment URLs, or nondeterministic values.
9. Implement TypeScript-AST route discovery using the existing TypeScript
   compiler dependency. It must recognize exported function declarations,
   exported handler constants, and local re-exports.
10. Create explicit custom-route exclusions and a separate native-route
    manifest. Scaffold examples are exclusions, not documented business APIs.
11. Resolve the currently missing official Medusa `2.16.0` reference URL for
    each of exactly six native extensions:
    - two Store catalog operations;
    - four Admin product operations.
    Each entry records method/path, official URL, inclusion reason, local
    evidence paths, owning contract, and Medusa version. Human documentary
    review of all six entries is required before Wave 2.
12. Add conservative native-extension fingerprints: hash LF-normalized full
    bytes for every listed local middleware, query-config, serializer, and
    validator evidence file, bind the digest set to the method/path and
    `@medusajs/*@2.16.0`, and add focused contract-test fixtures. False-positive
    review is acceptable; silently accepting an evidence-file change is not.
13. Add generation tests proving that Astea 9.1 schema reuse occurs only when
    runtime input equals output; transformations or serializers require
    separately named request/response schemas.
14. Generate three structurally valid skeleton documents with
    `npm run openapi:generate -- --surface all`. Do not add Swagger UI routes in
    this wave.

#### Script fail conditions

- `openapi:generate` fails on duplicate method/path, duplicate component name,
  duplicate `operationId`, missing mandatory operation metadata,
  unrepresentable schema, unstable output, unsafe example, or write failure.
- `openapi:lint` fails on any configured warning/error, unresolved `$ref`,
  invalid OpenAPI 3.1 structure, missing or duplicate `operationId`, invalid
  security reference, config/version mismatch, remote ruleset, missing
  `--fail-severity warn`, or attempted network use. No blanket suppression or
  ignore file is allowed.
- `openapi:verify:foundation` is read-only: it builds all skeleton documents
  twice in memory, byte-compares them with the present artifacts, tests route
  discovery/exclusion/native-manifest mechanics, and deliberately does not
  demand business-route completeness.
- Surface verifiers are read-only and require full coverage only for their
  named surface. They never treat later-wave surfaces as covered or excluded.
- Only Wave 6 runs global `openapi:check`. It requires all three artifacts to be
  tracked and the worktree to be clean before its in-memory build and global
  route/security/drift checks.

#### Verification

```bash
npm run openapi:verify:foundation
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts src/api-docs/__tests__/coverage.unit.spec.ts
git diff --check
```

#### Exit criteria

- Three deterministic skeleton JSON documents exist.
- Two consecutive in-memory builds are byte-identical.
- Spectral `6.16.2`, the local-only ruleset, registry, and component tests pass.
- All six native extensions have reviewed Medusa `2.16.0` URLs, provenance,
  conservative fingerprints, and contract-test fixtures.
- Foundation-only coverage passes without claiming Store, Admin, or Webhook
  completeness.
- No `/docs` or `/openapi/*` runtime route exists yet.

### Wave 2 — Store API

#### Scope

Register only operations confirmed by the approved inventory, including:

- locally extended native catalog:
  - `GET /store/products`;
  - `GET /store/products/{id}`;
- custom cart:
  - `GET /store/carts/active`;
  - `POST /store/carts/active`;
- customer cart attachment:
  - `POST /store/customers/me/cart/attach`;
- payment attempts:
  - `POST /store/carts/{id}/payment-attempts/card`;
  - `POST /store/carts/{id}/payment-attempts/pix`;
- guest tracking:
  - `POST /store/tracking/lookup`;
- health:
  - `GET /health/live`;
  - `GET /health/ready`;
- only additional native Store routes explicitly marked as direct future
  storefront contracts in `ROUTE-INVENTORY.md`.

`apps/backend/src/api/store/custom/route.ts` remains an explicit scaffold
exclusion unless its business purpose is separately approved.

#### Changes

1. Register explicit Store operation metadata with source-file/test
   provenance.
2. Derive catalog response schemas from the actual query-config and serializer,
   not the unmodified native Medusa response.
3. Derive cart response schemas from `storeCartPreOrderFields` and
   `serializeStoreCartPreOrder`. Cart totals and PaymentSession amounts remain
   BRL **major units** exactly as exposed by runtime.
4. Preserve the observed customer-auth alternatives:
   optional session/bearer where the middleware allows guests, and required
   session/bearer for `/store/customers/me/cart/attach`.
5. Represent the tracking token as a sensitive request credential, never as a
   query/path parameter and never with a usable example.
6. Document PaymentAttempt monetary amounts as BRL **minor units** (integer
   centavos), never by reusing a Cart or PaymentSession major-unit schema.
   Contract tests must prove representative boundaries such as `10.90` major
   units corresponding to `1090` minor units and `0.01` corresponding to `1`,
   while rejecting fractional minor-unit values.
7. Record only status codes and error shapes confirmed in handlers or tests.
8. Mark every Store operation non-interactive. Preserve exactly the four
   inventory-marked future interaction candidates as metadata and assert their
   count/provenance in tests, but emit no Swagger method allowlist or executable
   profile.
9. Regenerate only `store.openapi.json` through
   `npm run openapi:generate -- --surface store` after reviewing the in-memory
   Store document.

#### Verification

```bash
npm run openapi:verify:store
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts src/api-docs/__tests__/coverage.unit.spec.ts src/api-docs/__tests__/security.unit.spec.ts src/api-docs/__tests__/money-units.contract.spec.ts src/api-docs/__tests__/native-extensions.contract.spec.ts
```

#### Fail conditions

- A Store schema differs from the serializer or existing HTTP-test evidence.
- A native Medusa schema/status/auth detail lacks an official `2.16.0`
  reference.
- A cart or catalog response leaks internal metadata excluded by the existing
  serializer.
- A PaymentAttempt amount is non-integer, described as a major-unit amount, or
  shares a schema with Cart/PaymentSession monetary fields.
- A tracking example contains a token, token hash, order ID credential, address,
  document number, payment identifier, or private fulfillment identifier.
- A Store route is neither registered nor explicitly excluded. Routes assigned
  to later Admin/Webhook waves do not fail this surface-only gate.

#### Exit criteria

- Every included Store operation has verified metadata and schema provenance.
- Store-only route coverage is complete against the approved inventory; no
  claim of Admin/Webhook completeness is made.
- PaymentAttempt minor-unit and Cart/PaymentSession major-unit contract tests
  pass.
- Exactly four future interaction candidates remain metadata-only and every
  emitted Store operation is non-interactive.
- The generated Store contract is deterministic and lint-clean.

### Wave 3 — Admin API

#### Scope

Register the confirmed custom Admin operations:

- `POST /admin/refunds/request`;
- `POST /admin/exchanges`;
- `POST /admin/exchanges/{id}`;
- `GET /admin/operational-alerts`;
- `GET /admin/operational-alerts/{id}`.

Register the locally extended native product operations represented in
`apps/backend/src/api/middlewares.ts`:

- `POST /admin/products`;
- `POST /admin/products/{id}`;
- `POST /admin/products/{id}/variants`;
- `POST /admin/products/{id}/variants/{variant_id}`.

Add other native Admin operations only when the inventory explicitly includes
them. `apps/backend/src/api/admin/custom/route.ts` remains a scaffold exclusion.

#### Changes

1. Require Admin security metadata on every Admin operation.
2. Represent the stricter application rule on refunds, exchanges, and
   operational-alert reads: the actor must be a Medusa user; API-key actors are
   rejected by current code/tests.
3. Derive product-extension errors from
   `apps/backend/src/api/admin/products/validators.ts` and the sellable-gate
   middleware while linking the base request/response contract to the official
   Medusa `2.16.0` reference.
4. Derive refund/exchange request and response schemas from their handlers,
   domain types, serializers, and HTTP tests. Do not derive persisted entity
   fields from `DB_MODEL_v1.21.md` when runtime differs.
5. Document refund amounts as BRL **minor units** (integer centavos). Keep
   Cart/PaymentSession major-unit schemas separate, forbid cross-reuse, and add
   contract tests for exact conversions and rejection of fractional minor
   units.
6. Run the native-extension contract tests for all four Admin product
   operations against their reviewed provenance and fingerprints.
7. Describe audit behavior on sensitive Admin operations without publishing
   the internal `AdminActionLog` table as an HTTP resource.
8. Record explicitly that no standalone audit read contract exists in the
   current API inventory.
9. Mark all Admin operations non-interactive in Swagger UI.
10. Regenerate only `admin.openapi.json` through
    `npm run openapi:generate -- --surface admin` after reviewing the in-memory
    Admin document.

#### Verification

```bash
npm run openapi:verify:admin
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts src/api-docs/__tests__/coverage.unit.spec.ts src/api-docs/__tests__/security.unit.spec.ts src/api-docs/__tests__/money-units.contract.spec.ts src/api-docs/__tests__/native-extensions.contract.spec.ts
```

#### Fail conditions

- An Admin operation lacks an explicit security requirement.
- API-key authentication is advertised where current application logic rejects
  API-key actors.
- The contract exposes internal audit, webhook-log, provider payload, secret,
  or raw operational metadata fields.
- Native product behavior is copied from generic Medusa docs without the local
  middleware extension.
- A refund amount is non-integer, described in major units, or reuses a
  Cart/PaymentSession monetary schema.
- Any of the four Admin native-extension provenance/fingerprint/contract tests
  drifts.
- A response/status is based only on an old PRD/SRS statement rather than
  current code/test evidence.

#### Exit criteria

- Admin operations and native extensions are fully evidence-linked.
- Audit side effects are described without inventing an audit endpoint.
- Admin-only route coverage and refund minor-unit tests pass without claiming
  Webhook completeness.
- The generated Admin contract is deterministic, lint-clean, and non-interactive.

### Wave 4 — Webhooks

#### Scope

- `POST /hooks/stripe`;
- `POST /hooks/gelato`.

#### Changes

1. Document Stripe's required `stripe-signature` header and preserved raw-body
   requirement exactly as implemented in the route and middleware.
2. Document only Stripe event families and responses confirmed in
   `apps/backend/src/api/hooks/stripe/route.ts`,
   `apps/backend/src/api/hooks/stripe/refund-events.ts`, and their tests.
3. Document the Gelato authentication-header contract, including the canonical
   code default `X-GELATO-WEBHOOK-SECRET`, while noting that runtime exposure of
   the webhook document must be disabled if a configured header-name override
   would make the committed contract inaccurate.
4. Describe signature/authentication failure before persistence or domain side
   effects.
5. Describe deduplication and idempotent replay responses from current
   implementation evidence, without exposing internal deduplication keys or
   raw stored payloads.
6. Model the webhook request body as observed provider input. Do not reuse a
   transformed Store/Admin schema and do not imply that Swagger UI sends a
   signature-valid request.
7. Mark both webhook operations permanently non-interactive; API-DOCS-01 has no
   environment flag capable of changing this policy.
8. Use synthetic, redacted examples only; omit examples when safe realism would
   require a signature, secret, token, personal data, or provider payload not
   present in official evidence.
9. Regenerate only `webhooks.openapi.json` through
   `npm run openapi:generate -- --surface webhooks` after reviewing the
   in-memory Webhook document.

#### Verification

```bash
npm run openapi:verify:webhooks
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts src/api-docs/__tests__/coverage.unit.spec.ts src/api-docs/__tests__/security.unit.spec.ts
```

#### Fail conditions

- Stripe is documented without raw body or signature verification.
- Gelato is documented without its authentication-header requirement.
- A webhook operation is marked interactive.
- An example contains a valid-looking secret, signature, API key, payment
  client secret, Pix payload, tracking token, address, email, phone, CPF/CNPJ,
  or provider production identifier.
- Replay semantics, event support, or response codes are not supported by
  current route/test evidence.

#### Exit criteria

- Webhook-only coverage is complete; this is the last surface-local gate and
  still does not substitute for Wave 6 global coverage.
- Both webhook contracts are complete, non-interactive, and security-reviewed.
- The generated Webhook contract is deterministic and lint-clean.

### Wave 5 — Swagger UI

#### Changes

1. Add the four environment flags and pure exposure-policy helpers. Update
   parser/default tests and every complete `AppEnv` object/factory discovered by
   a TypeScript-AST search before editing. The mandatory set includes
   `env.unit.spec.ts`, `medusa-config.unit.spec.ts`, and the Sentry HTTP test
   whenever it constructs a complete `AppEnv`; a fixture inventory test fails
   when any discovered constructor omits the new fields.
2. Add generated-document loaders that import the committed JSON artifacts and
   do not invoke the registry at runtime.
3. Add guarded routes:
   - `apps/backend/src/api/openapi/store.json/route.ts` ->
     `/openapi/store.json`;
   - `apps/backend/src/api/openapi/admin.json/route.ts` ->
     `/openapi/admin.json`;
   - `apps/backend/src/api/openapi/webhooks.json/route.ts` ->
     `/openapi/webhooks.json`;
   - `apps/backend/src/api/docs/route.ts` -> `/docs`;
   - an allowlisted `/docs/assets/{asset}` handler.
   Assert that `/openapi/store`, `/openapi/admin`, and `/openapi/webhooks`
   return `404`.
4. Allow exactly these asset names:
   - package asset `swagger-ui.css`;
   - package asset `swagger-ui-bundle.js`;
   - package asset `swagger-ui-standalone-preset.js`;
   - project-owned `api-docs-initializer.js`.
   Return `404` for `/docs/index.html`, `/docs/assets/index.html`,
   `/docs/assets/swagger-initializer.js`,
   `/docs/assets/oauth2-redirect.html`, every source map (`*.map`),
   favicon/image/font assets, path traversal, nested paths, and every other
   package or unknown file. Do not expose the `swagger-ui-dist` directory
   through a generic static file server.
   If the exact pinned `swagger-ui.css` references an additional runtime asset,
   Wave 5 blocks. The asset is not served automatically, and changing the
   manifest requires explicit human review.
5. Use one `/docs` shell with separate Store/Admin/Webhook selections and
   one immutable shared configuration:
   - `persistAuthorization: false`;
   - `validatorUrl: null`;
   - `queryConfigEnabled: false`;
   - `withCredentials: false`;
   - `supportedSubmitMethods: []` for every selected document.
   The four inventory-marked candidates may be displayed as descriptive
   metadata only. No interactivity environment flag exists, and a future
   executable profile requires a separate initiative and security review.
6. Serve the project-owned `api-docs-initializer.js` rather than inline
   executable script or the package's `swagger-initializer.js`.
7. Add response headers:
   - restrictive CSP with `default-src 'none'`, same-origin scripts/styles,
     no objects, no framing, and no external connections;
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy: no-referrer`;
   - `Cache-Control: no-store` for HTML and specifications;
   - explicit content types.
8. Keep CORS same-origin; do not add a new documentation origin to Store/Admin
   CORS.
9. Return `404` for disabled surfaces and for unauthorized internal discovery
   where doing so does not conflict with Medusa's authenticated-route behavior.
10. Add `api-docs.spec.ts` covering the complete flag/auth matrix without
    database, Redis, or provider access.

#### Verification

```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/exposure.unit.spec.ts src/api-docs/__tests__/security.unit.spec.ts
npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/api-docs.spec.ts
npm run openapi:verify:webhooks
npm run openapi:lint
```

#### Fail conditions

- Any documentation route is reachable with production defaults.
- Internal documents are reachable in production without the explicit internal
  flag and required user authentication.
- Swagger UI loads a CDN, external validator, remote font, or remote script.
- Authorization persists across refresh/close, query parameters override UI
  configuration, `supportedSubmitMethods` is non-empty, or any Store,
  Admin, or Webhook request can be executed.
- Any non-allowlisted package asset, `index.html`, package initializer,
  OAuth redirect helper, source map, nested path, or extensionless OpenAPI
  alias returns anything other than `404`.
- The exact pinned `swagger-ui.css` references an additional runtime asset.
  Wave 5 must block rather than serving it or changing the manifest
  automatically.
- CSP requires broad `unsafe-inline` or `unsafe-eval` without a separate human
  security review.
- Documentation routing changes any existing business route or global CORS
  contract.

#### Exit criteria

- Local UI renders all enabled contracts from local assets.
- Production-default requests to all documentation paths return `404`.
- Internal protection, headers, CSP, cache, the exact four-file asset allowlist,
  extensionless-alias rejection, and globally non-interactive behavior pass
  HTTP tests.

### Wave 6 — Gates

#### Changes

1. Enable global custom-route coverage only now, after Store, Admin, and
   Webhooks are registered. Global coverage fails on any route not registered
   or explicitly excluded; partial Wave 1–4 allowances are invalid here.
2. Finalize the exactly six-entry native Medusa manifest and add mechanical
   tests for package version, full evidence-file fingerprints, provenance,
   official-reference URLs, and operation-specific local contract behavior.
   Any change requires review and an explicitly regenerated fingerprint; tests
   never auto-accept a new digest.
3. Add a CI workflow at `.github/workflows/api-docs.yml`. The repository
   currently has no workflow directory, so this is a new, explicit surface.
4. CI uses the approved repository Node 22 line and exact Spectral `6.16.2`.
   It validates root `scarfSettings.enabled=false` and runs:
   - `SCARF_ANALYTICS=false npm ci`;
   - read-only global `openapi:check` first, before any writer;
   - selected-toolchain lint;
   - focused API-docs unit and HTTP tests;
   - repository lint;
   - backend build;
   - tracked-artifact and empty-worktree assertions.
5. Update maintenance and exposure documentation:
   - root `README.md`;
   - `AGENTS.md`;
   - `apps/backend/src/api/README.md`;
   - `docs/openapi/README.md`;
   - `ops/API_DOCS.md`.
6. Document generation, operation registration, explicit exclusions, native
   Medusa review, security review, production enablement, and disable/rollback.
7. Run the complete binary gate below from a clean checkout containing the
   reviewed implementation commit and stop for human review. Do not deploy.
   If drift is reported, leave the failed gate, run the explicit writer only in
   an implementation workspace, review and commit the result, then restart the
   gate from a fresh clean checkout. Never generate immediately before or
   inside the drift check.

#### Final verification commands

Run these commands with `cwd=/home/jlima/Projetos/ecommerce/Backend`.
Workspace-scoped commands keep `-w @dtc/backend`; all other commands are root
package or repository commands.

```bash
npm run openapi:check
npm run openapi:lint
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts src/api-docs/__tests__/coverage.unit.spec.ts src/api-docs/__tests__/security.unit.spec.ts src/api-docs/__tests__/exposure.unit.spec.ts
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/money-units.contract.spec.ts src/api-docs/__tests__/native-extensions.contract.spec.ts
npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/api-docs.spec.ts
npm run lint -w @dtc/backend
npm run build -w @dtc/backend
git ls-files --error-unmatch apps/backend/src/api-docs/generated/store.openapi.json apps/backend/src/api-docs/generated/admin.openapi.json apps/backend/src/api-docs/generated/webhooks.openapi.json
git diff --check
test -z "$(git status --porcelain=v1)"
```

#### Binary fail conditions

The Wave 6 gate is `BLOCKED` if any command is non-zero, any generated artifact
is untracked/missing/byte-different, the worktree is non-empty, a route is
uncovered, an exclusion lacks a reason, any of the six native provenance,
version, fingerprint, or contract tests drifts, a `$ref` is unresolved, an
`operationId` is missing/duplicated, a sensitive example is found, internal
docs are exposed by default, any UI operation is executable, or the build does
not include the generated JSON and exact local UI assets.

#### Exit criteria

- All six waves pass in order.
- CI reproduces generation and verification from a clean checkout.
- Documentation and operational runbook are complete.
- Production remains disabled and no deployment has occurred.

## Tests

| Layer | Planned file/gate | Required proof |
| --- | --- | --- |
| Unit — generation | `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts` | fixed metadata, OpenAPI 3.1.2, nullable semantics, ordering, byte stability, duplicate rejection, Astea input/output separation |
| Unit — coverage | `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts` | foundation/Store/Admin/Webhook partial scopes, Wave 6 global scope, route discovery, bracket normalization, methods, re-exports, exclusions |
| Unit — security | `apps/backend/src/api-docs/__tests__/security.unit.spec.ts` | auth schemes, no sensitive examples, internal partitioning, Store/Admin/Webhook non-interactive |
| Unit — exposure | `apps/backend/src/api-docs/__tests__/exposure.unit.spec.ts` | environment defaults and complete flag matrix |
| Contract — monetary units | `apps/backend/src/api-docs/__tests__/money-units.contract.spec.ts` | PaymentAttempt/refund integer BRL minor units remain distinct from Cart/PaymentSession major units |
| Contract — six native extensions | `apps/backend/src/api-docs/__tests__/native-extensions.contract.spec.ts` | official provenance, conservative fingerprints, and local behavior for two Store plus four Admin operations |
| Existing env/config fixtures | `env.unit.spec.ts`, `medusa-config.unit.spec.ts`, and every discovered complete `AppEnv` fixture including Sentry HTTP when applicable | four defaults parse correctly and no complete fixture silently omits the new flags |
| HTTP | `apps/backend/integration-tests/http/api-docs.spec.ts` | exact `.json` paths, extensionless `404`, auth, headers, JSON bodies, globally non-interactive UI, exact assets, CSP, disabled production |
| Contract characterization | existing route/serializer tests plus focused additions only where needed | registry schema matches actual accepted input and serialized output |
| Static | exact Spectral `6.16.2` + custom read-only check | OpenAPI structure, `$ref`, operation IDs, scoped/global route coverage, tracked artifacts, clean-tree drift |
| Build | existing backend build | generated JSON imports and Swagger asset resolution compile into `.medusa/server` |

Test fixtures must be synthetic. These tests do not require PostgreSQL, Redis,
Stripe, Gelato, Resend, PostHog, Supabase, Heroku, or network access.

## Security Gates

All gates are binary:

1. **Partition gate:** Store, Admin, and Webhooks have separate documents; no
   internal schema is pulled into Store through a shared `$ref`.
2. **Authentication gate:** every protected operation has an evidence-backed
   security declaration. Optional customer auth is represented as optional, not
   as required or public-only.
3. **Internal exposure gate:** Admin/Webhook documents are disabled by default
   in production and require explicit enablement plus user authentication.
4. **Webhook gate:** Stripe raw body/signature and Gelato authentication header
   are mandatory; both operations are always non-interactive.
5. **Tracking gate:** tracking credentials appear only in the request body
   schema, are never persisted in UI, and have no usable example.
6. **Example gate:** generated files contain no secrets, tokens, signatures,
   client secrets, Pix QR/copy-paste values, personal addresses, documents,
   email addresses, phone numbers, or production identifiers.
7. **UI gate:** local assets only, external validation off, query configuration
   off, authorization persistence off, and shared immutable
   `supportedSubmitMethods: []`; Store, Admin, and Webhook submission is
   impossible and no interactivity environment flag exists.
8. **Browser-header gate:** CSP, anti-framing, MIME sniffing, referrer, and cache
   headers are asserted over HTTP.
9. **CORS gate:** no new public origin or wildcard is introduced.
10. **Logging gate:** disabled/unauthorized requests and asset errors never log
    headers, cookies, credentials, query values, or specification contents.
11. **Asset gate:** only `swagger-ui.css`, `swagger-ui-bundle.js`,
    `swagger-ui-standalone-preset.js`, and project-owned
    `api-docs-initializer.js` are served; package HTML, initializer, OAuth
    redirect helper, maps, nested paths, and all other assets return `404`.
12. **Supply-chain gate:** root `scarfSettings.enabled` is `false`, CI and local
    installation use `SCARF_ANALYTICS=false`, and no postinstall analytics is
    treated as required behavior.

Any failed security gate blocks release of API-DOCS-01.

## Drift Gates

### Generated artifact drift

Global `openapi:check` is strictly read-only and runs only in Wave 6 or CI. In
this order it:

1. requires `git status --porcelain=v1` to return no output;
2. runs the equivalent of `git ls-files --error-unmatch` for exactly:
   - `apps/backend/src/api-docs/generated/store.openapi.json`;
   - `apps/backend/src/api-docs/generated/admin.openapi.json`;
   - `apps/backend/src/api-docs/generated/webhooks.openapi.json`;
3. fails if the generated directory contains a fourth artifact;
4. reads the three committed byte sequences;
5. builds all documents in memory without calling the writer;
6. serializes them in memory with the canonical serializer;
7. builds and serializes all documents a second time in memory;
8. byte-compares both in-memory outputs;
9. byte-compares the canonical output with the committed bytes;
10. runs global coverage, security, metadata, and semantic-drift checks.

Missing, untracked, additional, or byte-changed artifacts fail. The checker
never invokes the writer, creates an output directory, writes a contract,
formats, stages, or regenerates a file. `openapi:generate` is the only writer
and explicitly updates committed artifacts; it is a separate remediation
command and must not run before or from the check in the same final-gate
sequence. `openapi:verify:*` is read-only scoped validation, `openapi:lint` is
read-only, and `openapi:check` is read-only global validation.

### Scoped versus global coverage

- Wave 1 uses `foundation` scope only for generator, discovery, exclusion, and
  native-manifest mechanics.
- Wave 2 requires complete Store coverage only.
- Wave 3 requires complete Admin coverage only.
- Wave 4 requires complete Webhook coverage only.
- Wave 5 may repeat the Webhook-local check but cannot claim global coverage.
- Wave 6 is the first and only global check; every custom route must then be
  registered or explicitly excluded.

Partial scopes cannot create exclusions for later-wave routes and cannot return
a global PASS.

### Custom route coverage

The coverage scanner:

1. discovers `apps/backend/src/api/**/route.ts`;
2. finds exported `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD`
   through the TypeScript AST;
3. converts `[id]` and other bracket segments to `{id}`;
4. compares normalized method/path pairs with registry operations;
5. accepts only entries in `coverage/exclusions.ts` with source file, reason,
   owner, and review trigger;
6. fails on a new, removed, renamed, ambiguous, or undocumented route.

Handling rules:

- Native Medusa routes are not discovered from `node_modules`; approved native
  operations live in `native-routes.ts`.
- A local route that overrides a native path is discovered normally and marked
  `native-override`.
- Middleware-only extensions are listed in `native-routes.ts` with middleware
  and test evidence.
- Scaffold examples are explicit exclusions.
- Conditional handlers still count because their exported HTTP surface exists.
- Framework-generated `OPTIONS` does not count unless `OPTIONS` is explicitly
  exported.
- Local re-exports are resolved; a dynamic or external re-export that cannot be
  resolved fails coverage.
- Routes without a request body explicitly omit `requestBody`; they are not
  treated as missing schemas.
- The future `/docs`, asset, and `/openapi/*` infrastructure routes are explicit
  internal documentation exclusions from the business contracts.

### Native Medusa drift

The native manifest contains exactly six entries: two Store catalog extensions
and four Admin product extensions. Each entry stores:

- Medusa version;
- method/path;
- official reference URL;
- inclusion reason;
- full local middleware/query-config/serializer/validator evidence paths;
- SHA-256 fingerprints over each evidence file's complete LF-normalized bytes;
- owning Store/Admin contract.

The fingerprint input includes the method/path and exact
`@medusajs/*@2.16.0` version so entries cannot be exchanged. Focused contract
tests assert the six local extension semantics. A change to any direct
`@medusajs/*` version or complete evidence file fails mechanically, even if the
change appears unrelated. Updating a fingerprint is never automatic: review
the official URL, local diff, contract tests, and generated schema, then obtain
human approval.

### Schema and metadata drift

- A reused Zod schema is accepted only if runtime imports the same symbol and
  its input and output are identical.
- Astea 9.1 has no public `io` selector; divergent transforms, defaults,
  stripping, serializers, or response enrichment require separately named
  request and response schemas with focused contract tests.
- Explicit schemas include provenance paths and are covered by characterization
  tests.
- Every operation has exactly one globally unique `operationId` following the
  `<surface><Verb><Resource>` convention.
- Every component name is stable and contract-qualified where collision is
  possible.
- All `$ref` values are internal and resolvable in each self-contained document.
- No generated value may depend on current time, random values, absolute path,
  environment hostname, object-discovery order, or Git state.

### Monetary-unit drift

- PaymentAttempt and refund monetary amounts are integer BRL minor units.
- Cart totals and PaymentSession monetary amounts are BRL major units.
- Separate component names and contract tests prevent schema reuse across that
  boundary and prove exact representative conversions.

### Linter-toolchain drift

`toolchain.ts`, exact `@stoplight/spectral-cli@6.16.2`, `package-lock.json`,
root `.spectral.yaml`, root/backend scripts, and CI must identify the same
toolchain. Spectral proves a local-only `spectral:oas` ruleset,
`--fail-severity warn`, three explicit artifact inputs, no remote ruleset, and
no ignore file. Mismatch, a second linter/config, or an unapproved version
fails.

## Documentation Updates

Future implementation updates:

- `README.md`:
  - list the three contracts and `/docs`;
  - state production-disabled defaults;
  - point to maintenance and operational runbooks.
- `AGENTS.md`:
  - declare the TypeScript registry as authority;
  - require `openapi:generate`, `openapi:lint`, and `openapi:check` for route or
    serializer changes;
  - require an explicit exclusion for intentionally undocumented routes.
- `apps/backend/src/api/README.md`:
  - explain route-to-registry registration and native-route handling.
- `docs/openapi/README.md`:
  - explain source-of-truth, generation, contract partitions, component reuse,
    request/response schema separation, scoped/global checks, selected
    Spectral toolchain, Scarf analytics opt-out, and contributor workflow.
- `ops/API_DOCS.md`:
  - document flags, exposure matrix, local usage, production approval,
    globally non-interactive behavior, exact JSON/asset paths, security checks,
    cache/CSP behavior, disable procedure, and rollback.

Documentation must not contain real credentials, production examples, provider
payloads, or instructions to enable production without a human gate.

## Deployment Strategy

No deployment occurs in this initiative's implementation gate.

A later deployment gate should:

1. confirm all six waves and CI are green;
2. deploy code with all production API-docs flags absent or false;
3. verify existing business and health endpoints are unchanged;
4. verify `/docs` and all `/openapi/*` paths return `404`;
5. verify web startup does not run the generator and worker startup does not
   load Swagger UI;
6. stop for human review.

Optional production exposure is a separate decision:

- public Store documentation requires explicit approval and both master/public
  flags;
- Admin/Webhook documentation requires explicit approval, the internal flag,
  and verified user authentication;
- Swagger UI requires its own explicit flag;
- `Try it out` remains disabled in every environment. Enabling an executable
  profile for any of the four metadata-only candidates is outside API-DOCS-01
  and requires a separate initiative and human security gate.

No database migration, release-phase migration change, Redis action, provider
exercise, Heroku config mutation, restart, scale, or deploy is part of this
plan's current authorization.

## Rollback / Disable Strategy

The first rollback is configuration-only:

1. set `API_DOCS_ENABLED=false` or remove the flag;
2. restart only the web process through the separately approved operational
   procedure;
3. verify `/docs` and `/openapi/*` return `404`;
4. verify business APIs and health remain available.

If code rollback is required, roll back the application release to the previous
known-good version. Because generated contracts are static and no database,
Redis, or provider state changes are expected, no data rollback or compensating
migration exists.

Rollback is `BLOCKED` if disabling documentation changes a business route,
health behavior, worker behavior, or requires a database/provider action.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Manual route validators are mistaken for reusable Zod schemas | Reuse only identical runtime symbols; otherwise use explicit evidence-backed schemas and characterization tests |
| A transformed Zod schema is reused for both directions despite Astea 9.1 lacking public `io` | Reuse only input=output; otherwise register distinct request/response schemas and contract-test both |
| Zod/OpenAPI library changes nullable or `$ref` output | Pin `@asteasolutions/zod-to-openapi@9.1.0`, assert representative schemas, and byte-check artifacts |
| Spectral dependency/config/scripts/CI drift apart | Pin exact `@stoplight/spectral-cli@6.16.2`, root `.spectral.yaml`, local `spectral:oas`, three explicit artifacts, and `--fail-severity warn`; reject a second linter or config |
| Dependency installation emits Scarf analytics | Set root `scarfSettings.enabled=false`, require `SCARF_ANALYTICS=false` locally and in CI, and treat postinstall analytics as unnecessary |
| Native Medusa contracts drift | Pin exactly six entries to Medusa `2.16.0`, hash complete evidence files, and require focused contract tests plus human review |
| Generated JSON is stale | Start the clean Wave 6 gate with read-only in-memory comparison; require all three artifacts tracked and an empty worktree |
| BRL amounts cross the major/minor boundary | Separate PaymentAttempt/refund minor-unit components from Cart/PaymentSession major-unit components and contract-test exact conversions |
| Internal schemas become public through shared components | Generate self-contained partitioned documents and run cross-contract leakage tests |
| Swagger UI enables dangerous calls | Use one immutable `supportedSubmitMethods: []`, define no interactivity environment flag, and defer every executable profile to a separate initiative and security review |
| UI leaks authorization | `persistAuthorization=false`, no query overrides, no examples with credentials, and HTTP/browser tests |
| Swagger package exposes extra files | Allow exactly three package assets plus one project initializer and return `404` for package HTML, initializer, OAuth helper, maps, and all others |
| CSP conflicts with Swagger assets | Serve the exact local allowlist and project initializer; require a focused CSP test before relaxing policy |
| Build omits generated JSON or assets | Import committed JSON through TypeScript and test built-server asset/document resolution |
| Configurable Gelato header makes committed docs inaccurate | Share the canonical default and disable Webhook-document exposure when runtime override differs |
| Documentation adds runtime latency | Serve static imported JSON, cache immutable process data, and avoid generator imports/runtime execution |
| Route coverage scanner misses an export pattern | Use the TypeScript AST, fixture every supported export form, and fail on ambiguous forms |

## Acceptance Criteria

API-DOCS-01 implementation is acceptable only when:

- OpenAPI is exactly `3.1.2`.
- Store, Admin, and Webhooks are separate self-contained JSON documents.
- The TypeScript registry is the only editable contract source.
- Generated JSON is deterministic across consecutive clean runs.
- Existing runtime Zod is reused only through identical exported symbols.
- One Zod schema is shared across request/response only when input equals output;
  divergent shapes have distinct tested schemas.
- Explicit schemas have handler/serializer/test provenance.
- Every documented operation has a unique `operationId`, tags, security,
  parameters, request/response definitions, and evidence.
- Every custom route is documented or explicitly excluded.
- Exactly six native Medusa extensions have official-version URLs,
  conservative full-evidence fingerprints, and focused contract tests.
- `$ref` resolution and exact Spectral `6.16.2` lint pass for all three
  documents through root `.spectral.yaml`, local `spectral:oas`, and
  `--fail-severity warn`.
- Root `scarfSettings.enabled=false` and `SCARF_ANALYTICS=false` are enforced
  for dependency installation and CI.
- Foundation/Store/Admin/Webhook partial checks pass in their waves and global
  coverage runs only in Wave 6.
- Global `openapi:check` is read-only, begins before any writer, proves all
  three artifacts tracked, byte-compares in memory, and requires an empty
  worktree.
- PaymentAttempt/refund integer BRL minor-unit schemas remain separate from
  Cart/PaymentSession major-unit schemas and contract tests pass.
- Stripe raw body/signature and Gelato authentication are documented.
- Store, Admin, and Webhook operations cannot execute from Swagger UI;
  `supportedSubmitMethods: []` is immutable and no interactivity environment
  flag exists.
- Production defaults expose no documentation route.
- Internal documents require explicit enablement and protection.
- The three `.json` routes resolve exactly; extensionless aliases return `404`.
- Exactly three package assets plus `api-docs-initializer.js` are served; all
  package HTML/initializer/OAuth/map/unknown assets return `404`, and
  CSP/security headers pass.
- Root/backend scripts and clean-checkout CI pass.
- Focused unit/HTTP tests, repository lint, and backend build pass.
- README, AGENTS, API-route guide, contributor guide, and operational runbook
  are updated.
- Database schema changes remain `not expected`.
- Migration remains `not expected`.
- No Redis, provider, production, release, tag, milestone, Phase 13, or
  storefront action occurs.
- Implementation stops at a human review gate before deployment or production
  enablement.

## Files Expected to Change

Expected existing-file changes:

- `package.json`;
- `package-lock.json`;
- `apps/backend/package.json`;
- `apps/backend/src/config/env.ts`;
- `apps/backend/src/config/__tests__/env.unit.spec.ts`;
- `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts`;
- every additional existing test/helper that constructs a complete `AppEnv`
  object or factory, as found by the mandatory AST inventory, including the
  existing `apps/backend/integration-tests/http/*sentry*.spec.ts` file when it
  constructs that fixture;
- `apps/backend/.env.template`;
- `apps/backend/src/api/middlewares.ts`;
- `apps/backend/src/api/README.md`;
- `README.md`;
- `AGENTS.md`.

Expected linter file:

- `.spectral.yaml` at the repository root;
- no second linter configuration.

Expected new files/directories:

- `.github/workflows/api-docs.yml`;
- `apps/backend/src/api-docs/**`;
- `apps/backend/src/api-docs/__tests__/money-units.contract.spec.ts`;
- `apps/backend/src/api-docs/__tests__/native-extensions.contract.spec.ts`;
- `apps/backend/scripts/openapi/generate.ts`;
- `apps/backend/scripts/openapi/check.ts`;
- `apps/backend/scripts/openapi/lint.ts`;
- `apps/backend/scripts/openapi/toolchain.ts`;
- `apps/backend/src/api/docs/route.ts`;
- `apps/backend/src/api/docs/assets/[asset]/route.ts`;
- `apps/backend/src/api/openapi/store.json/route.ts`;
- `apps/backend/src/api/openapi/admin.json/route.ts`;
- `apps/backend/src/api/openapi/webhooks.json/route.ts`;
- `apps/backend/integration-tests/http/api-docs.spec.ts`;
- `docs/openapi/README.md`;
- `ops/API_DOCS.md`.

Existing route, serializer, validator, or query-config files may change only
when a focused characterization-backed Zod extraction is explicitly approved
within the relevant wave. They are not blanket-authorized by this plan.

Files and surfaces not expected to change:

- database models and migrations;
- Medusa module registrations unrelated to docs;
- `medusa-config.ts`;
- Redis, cache, event-bus, workflow-engine, or locking configuration;
- `Procfile`;
- payment, Order, analytics, email, fulfillment, tracking, refund, exchange,
  operational-alert, or audit domain behavior;
- provider configuration;
- milestone, roadmap, state, release, tag, Phase 13, or storefront artifacts.

## Human Approval Gate

Implementation status: **not started**.

Decisions already taken by the corrected R2 plan:

- OpenAPI `3.1.2`;
- Store / Admin / Webhooks contract split;
- explicit TypeScript registry as source of truth;
- `@asteasolutions/zod-to-openapi@9.1.0`;
- `@stoplight/spectral-cli@6.16.2` with root `.spectral.yaml`;
- `swagger-ui-dist@5.32.11`;
- no Try-it-out implementation in API-DOCS-01;
- `/store/custom` and `/admin/custom` are explicit API-DOCS-01 exclusions;
- health operations are in `store.openapi.json`, tagged `Infrastructure`, with
  `security: []`;
- the initial Swagger asset manifest contains exactly `swagger-ui.css`,
  `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js`, and
  `api-docs-initializer.js`, with no fonts;
- `openapi:check` is in-memory and read-only, invokes no writer, and generates
  no contract on the filesystem;
- `zod-openapi` is evaluated but not selected, not installed, and not part of
  the implementation plan;
- production disabled by default;
- database changes and migrations not expected.

Human approval is still required before:

1. accepting the final corrected R2 artifacts;
2. accepting all six Medusa URLs and native-extension fingerprints;
3. installing dependencies, modifying manifests/source, and executing Wave 1;
4. changing any approved package/runtime version;
5. enabling Store, Admin, Webhook, or Swagger UI documentation in production;
6. deploying.

Approval of this plan authorizes only the explicitly reviewed implementation
scope. It does not authorize deployment, production flags, provider access,
database/Redis work, a new milestone, Phase 13, or storefront work.
