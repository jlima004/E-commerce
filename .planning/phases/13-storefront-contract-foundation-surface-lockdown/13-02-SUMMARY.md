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
    - apps/backend/src/api-docs/operations/store/customers.ts
    - apps/backend/src/api-docs/operations/store/schemas.ts
    - apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/security.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/generation.unit.spec.ts
    - apps/backend/src/api-docs/generated/store.openapi.json

key-decisions:
  - "Guard registered as method-less /store* so Medusa 2.16.0 RoutesSorter places it in the global bucket before static/params Store handlers"
  - "PRESERVE_LEGACY is next()-only inherited v1.0 pass-through; M1_ENABLED branch present but empty in Phase 13"
  - "Local complete/route.ts replaces native handler (last-writer-wins) and returns non-enumerating 404 without workflow resolve"
  - "OpenAPI exclusion for complete override required by AGENTS.md API Docs Contract (Rule 2 / rules precedence)"
  - "Blocked attach absent from current public Store operation registry; attach support schemas retained in TypeScript only"
  - "Explicit attach route exclusion is part of the closed exclusion set (4 total)"
  - "Medusa 2.16.0 RoutesLoader duplicate resolution proven executable as last-writer-wins; local complete override is effective POST"
  - "OPTIONS preflight fail-closed: permitted only for known runtime-allowable method/path targets"

patterns-established:
  - "Store lockdown decision is method+canonical-path lookup against manifest SSOT; UNKNOWN/BLOCKED/DENY short-circuit before handlers"
  - "HEAD never inferred from GET; OPTIONS only strict CORS preflight"
  - "Legacy B attach proofs stay at handler boundary; public DENY proven in store-surface-lockdown.spec.ts"

requirements-completed: []
requirements-evidenced: [FND-01, FND-02, FND-07]

duration: 8min
completed: 2026-08-08
status: human-approved-pass
---

# Phase 13 Plan 02: Fail-Closed Store Lockdown Summary

**Global `/store*` fail-closed guard + native complete override eliminate B13-01/02/03 at the HTTP boundary; PRESERVE_LEGACY keeps 7 inherited v1.0 routes; M1_ENABLED remains 0**

## Identity

Plan: 13-02  
Technical implementation: PASS  
P13-13-02-R1 technical human re-review: PASS  
P13-13-02-R2 human re-review: PASS  
13-02: HUMAN APPROVED — PASS  
13-03: NOT AUTHORIZED  
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
Pre-plan / Execution base SHA: `0a06b57d91954a330a16de508819d1769a149c18`  
P13_13_02_R1_PRE_HEAD: `c4d19c69d4bf9dc6d433b997b1fc81fdbab391f3`  
P13_13_02_R2_PRE_HEAD: `2dc572cd6515ed42bbcf40b3f42b1e16da744642`

Post-execution commits:
- `e077e8d` — docs(13-02): lock legacy test impact inventory before edits
- `d2c8de7` — test(13-02): add failing Store surface guard unit specs
- `5d534be` — feat(13-02): enforce fail-closed Store surface lockdown
- `c4d19c6` — docs(13-02): complete Fail-Closed Store Lockdown plan (awaiting human review) |
| `d07058c` | fix(13-02): reconcile fail-closed Store contract and loader proof |
| `2dc572c` | docs(13-02): record R1 review corrections |

## Task Commits

1. **Task 1: Inventariar impacto legado** — `e077e8d` (docs)
2. **Task 2 RED:** `d2c8de7` (test)
3. **Task 2 GREEN:** `5d534be` (feat)
4. **Initial technical summary:** `c4d19c6` (docs)
5. **Human-review R1 technical correction:** `d07058c` (fix)
6. **R1 documentation synchronization:** `2dc572c` (docs)
7. **Task 3: Revisar lockdown** — HUMAN APPROVED — PASS

## Decisions Made

- Method-less `/store*` for global RoutesSorter precedence (proven against installed 2.16.0 sorter).
- PRESERVE_LEGACY = `next()` only; never M1 enablement / executable OpenAPI promotion.
- Local complete override returns 404 without importing `completeCartWorkflow`.
- OpenAPI exclusion for complete required by AGENTS.md when introducing an intentionally undocumented route.
- API Docs Contract requires blocked attach to be absent from current public Store operation registry while retaining useful TS support knowledge.
- Explicit attach route exclusion is part of the closed exclusion set.
- Medusa 2.16.0 RoutesLoader duplicate resolution proven executable as last-writer-wins; project local complete override is the effective POST.
- OPTIONS preflight is fail-closed and permitted only for known runtime-allowable method/path targets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 / AGENTS.md precedence] OpenAPI exclusion for complete override**
- **Found during:** Task 2 legacy exact-set verify
- **Issue:** Local `complete/route.ts` is discovered by OpenAPI AST coverage; Wave 1 exclusions allowed only two scaffolds → coverage/store-contract failed.
- **Fix (initial Task 2):** Added explicit exclusion for `POST /store/carts/{id}/complete` with owner/reviewTrigger; updated coverage/store-contract expectations.
- **R1 extension (human accepted):** attach registry operation removal + TS-only support schemas + generated Store artifact regeneration + affected contract/security/generation tests. This did not enable M1, change Store classification, change runtime policy, implement 13-06 OpenAPI 1.1.0, or relax coverage.
- **Files modified:** `exclusions.ts`, `customers.ts`, `schemas.ts`, coverage + store-contract + security + generation unit specs, `store.openapi.json`
- **Committed in:** `5d534be` (initial complete exclusion); `d07058c` (R1 attach/registry reconciliation)

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

### Deviation accepted by human review

API Docs maintenance exceeded original 13-02 PLAN allowlist because AGENTS.md requires every HTTP contract change to update registry/evidence or explicit route exclusion metadata.

**R1 extension:** attach registry operation removal + TS-only support schemas + generated Store artifact regeneration + affected contract/security/generation tests.

**This did not:** enable M1; change Store classification; change runtime policy; implement 13-06 OpenAPI 1.1.0; relax coverage.

## Threat Flags

None beyond the plan threat model. Denial responses remain minimal until 13-03 StoreErrorResponse.

## Known Stubs

None that block the plan goal. StoreErrorResponse envelope is intentionally deferred to 13-03.

## Blocking failures / warnings

Human review R1 findings addressed in P13-13-02-R1 (technical re-review PASS). P13-13-02-R2 human re-review PASS; 13-02 is HUMAN APPROVED — PASS. 13-03 remains NOT AUTHORIZED.

## P13-13-02-R2 Documentary Correction

status: HUMAN RE-REVIEW PASS

P13_13_02_R2_PRE_HEAD: `2dc572cd6515ed42bbcf40b3f42b1e16da744642`

Scope: reconcile stale pre-R1 wording in this SUMMARY against factual R1 final state. No runtime, registry, generated JSON, test, or governance file changes.

Corrections applied:
- key-files modified exact-set aligned to 0a06b57..2dc572c factual diff
- Performance file counts recalculated (17 total across runtime/tests/API Docs/planning)
- Transition section split into initial Task 2 vs human-review R1 correction
- Scope/allowlist updated for registry modification and generated JSON regeneration
- Test evidence temporally labeled (initial 43 vs R1 final 44)
- Post-execution commit lineage and Task Commits extended through R1
- Decisions, deviations, and Human Review R1 sections consolidated with R2 gate status
- Pre-change A/B/C inventory preserved unchanged

## Human Approval

```text
P13-13-02-R1 technical human re-review: PASS
P13-13-02-R2 human re-review: PASS
13-02: HUMAN APPROVED — PASS
13-03: NOT AUTHORIZED
```

Requirements remain evidence-only in Phase 13: `requirements-completed: []`.

## Next gate

```text
P13-13-02-R1 technical human re-review: PASS
P13-13-02-R2 human re-review: PASS
13-02: HUMAN APPROVED — PASS
13-03: NOT AUTHORIZED
```

## Self-Check: PASSED

- [x] `apps/backend/src/api/store-surface/guard.ts` FOUND
- [x] `apps/backend/src/api/store/carts/[id]/complete/route.ts` FOUND
- [x] `apps/backend/integration-tests/http/store-surface-lockdown.spec.ts` FOUND
- [x] Commit `e077e8d` FOUND
- [x] Commit `d2c8de7` FOUND
- [x] Commit `5d534be` FOUND
- [x] Commit `c4d19c6` FOUND
- [x] Commit `d07058c` FOUND
- [x] Commit `2dc572c` FOUND

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
DOCUMENTED / HUMAN ACCEPTED

W13-02-R1-04 strict OPTIONS:
FIXED

P13-13-02-R1 technical human re-review:
PASS

P13-13-02-R2:
HUMAN RE-REVIEW PASS
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

## Next gate (post-R2)

```text
P13-13-02-R1 technical human re-review: PASS
P13-13-02-R2 human re-review: PASS
13-02: HUMAN APPROVED — PASS
13-03: NOT AUTHORIZED
```
