---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 02
subsystem: api
tags: [store-surface, fail-closed, guard, lockdown, medusa-2.16.0]

requires:
  - phase: 13-01
    provides: Closed 58-op Store surface manifest SSOT and Wave 0 transaction proof
provides:
  - Global Store fail-closed guard consuming manifest.ts
  - Native complete defense-in-depth override
  - HTTP denial/bypass matrix and controlled legacy A/B/C transition
affects:
  - 13-03-storefront-contract-foundation-surface-lockdown
  - 13-07-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - Method-less /store* matcher in RoutesSorter global bucket before Store business handlers
    - Dual control: manifest guard + local complete route override
    - PRESERVE_LEGACY pass-through without M1 enablement

key-files:
  created:
    - apps/backend/src/api/store-surface/guard.ts
    - apps/backend/src/api/store/carts/[id]/complete/route.ts
    - apps/backend/src/api/store-surface/__tests__/guard.unit.spec.ts
    - apps/backend/integration-tests/http/store-surface-lockdown.spec.ts
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-02-SUMMARY.md
  modified:
    - apps/backend/src/api/middlewares.ts
    - apps/backend/integration-tests/http/cart-checkout-store.spec.ts
    - apps/backend/src/api-docs/coverage/exclusions.ts
    - apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts

key-decisions:
  - "Guard registered as method-less /store* so Medusa 2.16.0 RoutesSorter places it in the global bucket before static/params Store handlers"
  - "PRESERVE_LEGACY is next()-only inherited v1.0 pass-through; M1_ENABLED branch present but empty in Phase 13"
  - "Local complete/route.ts replaces native handler (last-writer-wins) and returns non-enumerating 404 without workflow resolve"
  - "OpenAPI exclusion for complete override required by AGENTS.md API Docs Contract (Rule 2 / rules precedence)"

patterns-established:
  - "Store lockdown decision is method+canonical-path lookup against manifest SSOT; UNKNOWN/BLOCKED/DENY short-circuit before handlers"
  - "HEAD never inferred from GET; OPTIONS only strict CORS preflight"
  - "Legacy B attach proofs stay at handler boundary; public DENY proven in store-surface-lockdown.spec.ts"

requirements-completed: []
requirements-evidenced: [FND-01, FND-02, FND-07]

duration: 8min
completed: 2026-08-08
status: r1-correction-complete-awaiting-human-re-review
---

# Phase 13 Plan 02: Fail-Closed Store Lockdown Summary

**Global `/store*` fail-closed guard + native complete override eliminate B13-01/02/03 at the HTTP boundary; PRESERVE_LEGACY keeps 7 inherited v1.0 routes; M1_ENABLED remains 0**

## Identity

Plan: 13-02  
Status: R1 CORRECTION COMPLETE / AWAITING HUMAN RE-REVIEW  
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
Pre-plan / Execution base SHA: `0a06b57d91954a330a16de508819d1769a149c18`
P13_13_02_R1_PRE_HEAD: `c4d19c69d4bf9dc6d433b997b1fc81fdbab391f3`

Post-execution commits:
- `e077e8d` — docs(13-02): lock legacy test impact inventory before edits
- `d2c8de7` — test(13-02): add failing Store surface guard unit specs
- `5d534be` — feat(13-02): enforce fail-closed Store surface lockdown
- `c4d19c6` — docs(13-02): complete Fail-Closed Store Lockdown plan (awaiting human review)
- `d07058c` — fix(13-02): reconcile fail-closed Store contract and loader proof

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-08T02:14:27Z
- **Completed (technical):** 2026-08-08T02:21:57Z
- **Tasks:** 2 automated complete; Task 3 human-verify pending
- **Files modified:** 9 product/test + SUMMARY (+ exclusions via AGENTS.md deviation)

## Accomplishments

- Enforced manifest-driven Store lockdown before business handlers (UNKNOWN/BLOCKED/DENY → 404; PRESERVE_LEGACY → `next()`).
- Added defense-in-depth local override for `POST /store/carts/{id}/complete` that never resolves workflow/Order.
- Locked and transitioned legacy exact-set (4 paths) with A/B/C classifications; attach domain proofs retained.
- Proved Medusa 2.16.0 RoutesSorter places method-less `/store*` in the global bucket before static/params Store routes.

## Requirements / blockers addressed

| ID | Evidence in 13-02 | Status |
| --- | --- | --- |
| FND-01 | Guard consumes approved 58-op manifest; scanner still 58/58 | Evidenced (still needs 13-07) |
| FND-02 | DENY matrix + complete/custom handler-zero + PRESERVE_LEGACY pass-through | Evidenced (still needs 13-07) |
| FND-07 | BFF-only assumption; CORS/publishable not treated as auth; synthetic canaries only | Evidenced (still needs 13-06/13-07) |
| B13-01 | complete DENY + local override + workflow spy zero | Eliminated at boundary |
| B13-02 | global `/store*` allowlist/guard | Eliminated at boundary |
| B13-03 | `/store/custom` DENY before local handler | Eliminated at boundary |

## Surface inventory (unchanged from 13-01)

| Metric | Count |
| --- | ---: |
| runtime Store operations | 58 |
| AUTHORIZED | 0 |
| EXTENDED | 10 |
| BLOCKED | 17 |
| OUTSIDE_FRONTEND_M1 | 31 |
| runtime_policy DENY | 51 |
| runtime_policy PRESERVE_LEGACY | 7 |
| runtime_policy M1_ENABLED | 0 |
| m1_enablement enabled | 0 |

## Router ordering evidence (Medusa 2.16.0)

| Fact | Result |
| --- | --- |
| `RoutesSorter` default order | `["global", "wildcard", "regex", "static", "params"]` |
| Method-less matcher bucket | `global` (`!methods && !method`) |
| `/store*` vs static `/store/carts/active` | `/store*` sorts first |
| Project registration | `middlewares.ts` places `/store*` after correlation `/.*/` and before specific Store matchers |
| Native → local complete | `RoutesLoader` last-writer-wins; local `complete/route.ts` replaces native POST |
| Monkey-patch | None |

## Legacy test impact inventory (pre-change)

exact_set_status: LOCKED_BEFORE_EDIT

Closed exact-set of unique legacy test paths (4 ≤ 4) within Store/checkout/payment/API Docs/invariants that reference operations now BLOCKED, OUTSIDE_FRONTEND_M1, or EXTENDED-disabled at runtime. No globs. No edits applied yet.

| Path | Case/describe/test | Family | Class | Reason | Coverage replacement |
| --- | --- | --- | --- | --- | --- |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > transfere apenas o guest cart autorizado, nao vazio, da sessao atual` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Handler-level attach success remains domain-required; public POST /store/customers/me/cart/attach is BLOCKED→DENY | Public DENY + handler/workflow/Order zero in `integration-tests/http/store-surface-lockdown.spec.ts`; retain handler-level attach proof in this file |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > rejeita cart_id no body quando nao corresponde a sessao atual` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Attach rejection rules stay mandatory internally while public route is denied | Same as above — internal rejection assertions retained; public surface covered by lockdown matrix |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > rejeita quando a sessao aponta para cart diferente do body` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Session/body mismatch invariant remains domain-required under DENY public policy | Same as above |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > preserva o customer cart util quando o guest cart da sessao esta vazio` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Empty-guest merge precedence remains internal invariant | Same as above |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > faz o guest cart nao vazio vencer no login e marca o cart antigo como superseded` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Non-empty guest wins / superseded marking remains internal invariant | Same as above |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart attach / transfer > usa customer.email como email final apos attach` | `http` | `B — STILL_VALID_INTERNAL_INVARIANT` | Email truth after attach remains internal invariant | Same as above |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart > POST /store/carts/active cria cart sem conta e sem email obrigatorio` | `http` | `C — MUST_REMAIN_GREEN` | PRESERVE_LEGACY v1.0 accepted active-cart create; no contract contradiction | - |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | `guest cart > GET /store/carts/active consulta o guest cart da sessao atual sem email` | `http` | `C — MUST_REMAIN_GREEN` | PRESERVE_LEGACY active-cart read | - |
| `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts` | `covers every included Store route and both native catalog extensions` | `unit` | `C — MUST_REMAIN_GREEN` | OpenAPI Store 1.0.0 registry still lists attach until 13-06; docs surface unchanged in 13-02 | - |
| `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts` | `keeps attach request cart_id optional without additionalProperties:false` | `unit` | `C — MUST_REMAIN_GREEN` | Schema documentation only; runtime DENY does not require OpenAPI rewrite in 13-02 | - |
| `apps/backend/src/api-docs/__tests__/security.unit.spec.ts` | `requires customer auth alternatives only on cart attach` | `unit` | `C — MUST_REMAIN_GREEN` | Documents historical OpenAPI security for attach; no runtime assertion of public success | - |
| `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts` | `allows exactly the two explicit scaffold exclusions with complete metadata` | `unit` | `C — MUST_REMAIN_GREEN` | GET /store/custom already OpenAPI-excluded; aligns with BLOCKED→DENY runtime | - |

### Exact-set identity

| Metric | Value |
| --- | --- |
| unique paths | 4 |
| inventory case rows | 12 |
| families present | http, unit |
| Class A rows | 0 (pre-change); post-change coverage/store-contract exclusion assertions updated under AGENTS.md deviation |
| Class B rows | 6 (all in cart-checkout-store; each has non-empty Coverage replacement) |
| Class C rows | 6 |
| paths outside Store/checkout/payment/API Docs/invariants | 0 |

### Transition applied (Task 2)

- **B (attach):** retained handler-level proofs; added public DENY assertion + `/store*` registration check; production-source grep skips `__tests__`.
- **C:** OpenAPI attach docs cases untouched in intent; coverage/store-contract exclusion lists updated only for new complete override discovery.
- **A:** none in pre-change inventory.

## Tests

### Unit — guard + money invariants

```text
Command: cd apps/backend && npm run test:unit -- --runTestsByPath src/api/store-surface/__tests__/guard.unit.spec.ts src/utils/__tests__/money-units.unit.spec.ts --runInBand
Exit code: 0
Suites: 2 passed, 2 total
Tests: 43 passed, 43 total
Result: PASS
```

### HTTP — lockdown matrix + order-birth invariants

```text
Command: cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/store-surface-lockdown.spec.ts integration-tests/http/invariants-inv01-02-order-birth.spec.ts --runInBand
Exit code: 0
Suites: 2 passed, 2 total
Tests: 17 passed, 17 total
Result: PASS
```

### Legacy exact-set by family (once per unique path)

```text
unit: store-contract + security + coverage → PASS (41 tests)
http: cart-checkout-store → PASS (25 tests)
Result: LEGACY_EXACT_SET_OK
```

### Scanner (drift check)

```text
Command: cd apps/backend && npm exec -- ts-node --swc scripts/store-surface/scan-installed.ts --check
Output: medusa=2.16.0 discovered=58 manifest=58 authorized=0 extended=10 blocked=17 outside=31 deny=51 preserve_legacy=7 m1_enabled_policy=0 m1_enablement_enabled=0 STORE_SURFACE_SCAN_OK
Result: PASS
```

## Security / negative proofs

- DENY responses are non-enumerating `{ type: "not_found", message: "Not Found" }` (StoreErrorResponse envelope deferred to 13-03).
- Synthetic canaries only (Authorization/cookie/client_secret/Pix/CPF); none appear in deny bodies.
- complete override: `scope.resolve` not called; workflow run not called; body has no Order.
- `/store/custom` denied before local handler invocation.
- HEAD not inferred from GET; invalid OPTIONS denied; valid CORS preflight `next()` only.
- No JWT/capability/provider secrets logged.

## Scope / allowlist

| Check | Result |
| --- | --- |
| Allowlisted product files | YES — guard, middlewares, complete/route, unit+http tests, legacy exact-set |
| exclusions.ts | YES — AGENTS.md API Docs Contract deviation (Rule 2 / rules precedence) |
| package.json / lockfile | NOT MODIFIED |
| OpenAPI generated JSON / registry ops | NOT MODIFIED (exclusion only) |
| Core Cart / CheckoutCompletionLog / Stripe webhook | NOT MODIFIED |
| npm install / migrate / remote DB / provider / deploy / frontend | NOT RUN |
| 13-03+ | NOT STARTED |

## External systems not contacted

None. No Stripe, Gelato, Supabase remote, Redis remote, Resend, PostHog, or deploy actions.

## Git

Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`

| Commit | Message |
| --- | --- |
| `e077e8d` | docs(13-02): lock legacy test impact inventory before edits |
| `d2c8de7` | test(13-02): add failing Store surface guard unit specs |
| `5d534be` | feat(13-02): enforce fail-closed Store surface lockdown |

## Task Commits

1. **Task 1: Inventariar impacto legado** — `e077e8d` (docs)
2. **Task 2: Guard + complete defense + matriz + transição legada** — `d2c8de7` (test RED) + `5d534be` (feat GREEN)
3. **Task 3: Revisar lockdown** — AWAITING HUMAN REVIEW

## Decisions Made

- Method-less `/store*` for global RoutesSorter precedence (proven against installed 2.16.0 sorter).
- PRESERVE_LEGACY = `next()` only; never M1 enablement / executable OpenAPI promotion.
- Local complete override returns 404 without importing `completeCartWorkflow`.
- OpenAPI exclusion for complete required by AGENTS.md when introducing an intentionally undocumented route.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 / AGENTS.md precedence] OpenAPI exclusion for complete override**
- **Found during:** Task 2 legacy exact-set verify
- **Issue:** Local `complete/route.ts` is discovered by OpenAPI AST coverage; Wave 1 exclusions allowed only two scaffolds → coverage/store-contract failed.
- **Fix:** Added explicit exclusion for `POST /store/carts/{id}/complete` with owner/reviewTrigger; updated coverage/store-contract expectations. No registry/JSON rewrite.
- **Files modified:** `apps/backend/src/api-docs/coverage/exclusions.ts`, coverage + store-contract unit specs
- **Committed in:** `5d534be`

**2. [Rule 1 - Bug] Phase 03 static grep false-positive on Wave 0 fixtures**
- **Found during:** Task 2 legacy cart-checkout run
- **Issue:** `collectSourceFiles` scanned `src/modules/checkout/__tests__` and matched `payment_intent` in Wave 0 disposable tests.
- **Fix:** Skip `__tests__` directories and `*.spec.ts` / `*.test.ts` in production-source grep.
- **Files modified:** `apps/backend/integration-tests/http/cart-checkout-store.spec.ts`
- **Committed in:** `5d534be`

**3. [Rule 3 - Blocking] RoutesSorter not public export**
- **Found during:** Task 2 GREEN unit run
- **Issue:** `@medusajs/framework/http` does not export `RoutesSorter`.
- **Fix:** Load installed `routes-sorter.js` via absolute path from repo `node_modules` for the ordering fact test; also assert `middlewares.ts` registration order.
- **Files modified:** `guard.unit.spec.ts`
- **Committed in:** `5d534be`

## Threat Flags

None beyond the plan threat model. Denial responses remain minimal until 13-03 StoreErrorResponse.

## Known Stubs

None that block the plan goal. StoreErrorResponse envelope is intentionally deferred to 13-03.

## Blocking failures / warnings

Human review R1 findings addressed in P13-13-02-R1. Human re-review is the remaining gate.

## Next gate

```text
P13-13-02-R1: COMPLETE / AWAITING HUMAN RE-REVIEW
13-02: NOT YET HUMAN-APPROVED
13-03: NOT AUTHORIZED
```

## Self-Check: PASSED

- [x] `apps/backend/src/api/store-surface/guard.ts` FOUND
- [x] `apps/backend/src/api/store/carts/[id]/complete/route.ts` FOUND
- [x] `apps/backend/integration-tests/http/store-surface-lockdown.spec.ts` FOUND
- [x] Commit `e077e8d` FOUND
- [x] Commit `d2c8de7` FOUND
- [x] Commit `5d534be` FOUND

## P13-13-02-R1 API Docs reconciliation inventory

status: LOCKED_BEFORE_R1_API_DOCS_EDIT

P13_13_02_R1_PRE_HEAD: `c4d19c69d4bf9dc6d433b997b1fc81fdbab391f3`

| Path | Role | Planned R1 action | Reason |
| --- | --- | --- | --- |
| `apps/backend/src/api-docs/coverage/exclusions.ts` | Closed-set route exclusions | Add attach exclusion; expand exact-set to 4 | Runtime DENY must not advertise public Store operation (B13-02-R1-01); complete exclusion already HUMAN ACCEPTED |
| `apps/backend/src/api-docs/operations/store/customers.ts` | TypeScript registry authority for attach `path+method` | Remove public/executable attach operation registration only | Sole registry file that registers `POST /store/customers/me/cart/attach` |
| `apps/backend/src/api-docs/operations/store/schemas.ts` | Attach support schemas | Preserve as TS support export; unregister from public OpenAPI | Keep `StoreCustomerCartAttach*` knowledge without path+method; Spectral rejects unused components |
| `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts` | Coverage/exclusion regressions | Update exact exclusion set + factual test names | W13-02-R1-02 + attach exclusion closed-set |
| `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts` | Store public operation exact-set | Remove attach from public ops; keep schema assertions; update exclusion names | B13-02-R1-01 + W13-02-R1-02 |
| `apps/backend/src/api-docs/__tests__/security.unit.spec.ts` | Store security regressions | Rewrite attach security case to assert public attach ABSENT; keep other business-route security | Direct consequence of removing attach public operation |
| `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts` | Generated Store path list | Remove attach from expected Store paths | Direct consequence of registry operation removal |
| `apps/backend/src/api-docs/generated/store.openapi.json` | Writer artifact (conditional) | Regenerate via `openapi:generate -- --surface store` only if bytes change | Narrow R1 exception; never hand-edit JSON |

## Human Review R1 Correction

Original review:
P13-13-02 HUMAN REVIEW — R1 REQUIRED

```text
B13-02-R1-01 API Docs runtime drift:
FIXED

B13-02-R1-02 RoutesLoader override proof:
FIXED

W13-02-R1-01 exact-set text:
FIXED

W13-02-R1-02 exclusion test names:
FIXED

W13-02-R1-03 Class C deviation:
DOCUMENTED / ACCEPTED

W13-02-R1-04 strict OPTIONS:
FIXED
```

## API Docs reconciliation evidence

```text
Attach runtime:
DENY

Attach public OpenAPI operation:
ABSENT

Attach exclusion:
PRESENT

Attach schema/support:
YES — TypeScript STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS retained;
not registered in public OpenAPI (Spectral oas3-unused-component would fail)

Complete runtime:
DENY

Complete exclusion:
PRESENT

Complete public OpenAPI:
ABSENT

Current exclusions exact-set:
4
(GET /admin/custom, GET /store/custom, POST /store/carts/{id}/complete,
 POST /store/customers/me/cart/attach)

Generated Store artifact:
REGENERATED BY WRITER

Writer:
EXECUTED (npm run openapi:generate -- --surface store)

openapi:lint:
PASS

openapi:check:
NOT EXECUTED

Runtime installed Store surface:
58

Manifest:
58

Current public Store OpenAPI operation count:
9

Attach path+method public:
NO

Complete path+method public:
NO

/store/custom public:
NO

Store OpenAPI version:
1.0.0 (unchanged)
```

## RoutesLoader evidence

```text
Medusa:
2.16.0

Loader source:
node_modules/@medusajs/framework/dist/http/routes-loader.js
(ApiLoader orchestration: node_modules/@medusajs/framework/dist/http/router.js;
sourceDir order: node_modules/@medusajs/medusa/dist/loaders/api.js)

Duplicate route semantics:
registerRoute last-writer-wins — trackedRoute[method] = route

Native load ordering:
Medusa core api first (join(__dirname, "../api"))

Local load ordering:
plugins after core; project-plugin (src) pushed last by getResolvedPlugins

Native complete discovered:
YES
(@medusajs/medusa/dist/api/store/carts/[id]/complete/route.js)

Local complete discovered:
YES
(apps/backend/src/api/store/carts/[id]/complete/route.ts)

Effective POST handler:
LOCAL OVERRIDE

Executable proof:
PASS (RoutesLoader createRoutePath + registerRoute + getRoutes identity)

Direct-function-only proof:
NO — loader resolution itself proven
```

## Human-accepted Class C contract-maintenance deviation

The pre-change Class C classification remains historically unchanged.

`coverage.unit.spec.ts`, `store-contract.unit.spec.ts`, `security.unit.spec.ts`,
and `generation.unit.spec.ts` were modified only because the new fail-closed
route behavior triggered the binding AGENTS.md API Docs Contract.

This is not:
- assertion relaxation
- coverage removal
- reclassification of the original inventory
- snapshot masking
- M1 enablement

Semantic coverage remains equal or stronger.

## Next gate (post-R1)

```text
P13-13-02-R1: COMPLETE / AWAITING HUMAN RE-REVIEW
13-02: NOT YET HUMAN-APPROVED
13-03: NOT AUTHORIZED
```
