---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 01
subsystem: api
tags: [store-surface, manifest, scanner, transaction, cas, postgres, medusa-2.16.0]

requires:
  - phase: 12
    provides: disposable PostgreSQL harness and CheckoutCompletionLog module used as controlled Medusa mutation subject
provides:
  - Closed Store surface manifest SSOT (58 ops, Medusa 2.16.0)
  - Exact-set installed-route scanner with Phase 13 M1 guards
  - Wave 0 proof that Medusa mutation + version CAS share one PostgreSQL TM/commit
affects:
  - 13-02-storefront-contract-foundation-surface-lockdown
  - 13-04-storefront-contract-foundation-surface-lockdown
  - 13-05-storefront-contract-foundation-surface-lockdown
  - 13-06-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - Dual classification/runtime_policy Store surface entries with per-route rationale
    - Disposable probe tables for transactional feasibility without product migrations
    - PostgreSQL CAS as truth; Redis locking optional and non-authoritative

key-files:
  created:
    - apps/backend/src/api/store-surface/manifest.ts
    - apps/backend/scripts/store-surface/scan-installed.ts
    - apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts
    - apps/backend/src/infrastructure/store-foundation-transaction-compatibility.ts
    - apps/backend/src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-01-SUMMARY.md
  modified: []

key-decisions:
  - "PRESERVE_LEGACY reserved for 7 Store 1.0.0-accepted routes; all other EXTENDED/OUTSIDE get DENY with individual rationale"
  - "attach remains BLOCKED+DENY despite prior Store 1.0.0 exposure (merge contract blocked)"
  - "Wave 0 uses CheckoutCompletionLog create as controlled Medusa mutation joining shared TM; probe tables only in disposable DB"
  - "Scanner verify uses npm exec ts-node because workspace hoisting omits apps/backend/node_modules/.bin/ts-node"

patterns-established:
  - "Store surface SSOT lives only in manifest.ts; scanners/guards/OpenAPI consume the same export"
  - "BLOCKED ⇒ DENY mandatory; EXTENDED/OUTSIDE never imply a universal runtime_policy"
  - "Transactional foundation feasibility proven before StoreResourceVersion module/migration"

# Evidence produced in 13-01 (not completion — Phase 13 still requires later plans):
# FND-01: 13-01 + 13-02 + 13-07
# FND-06: 13-01 + 13-05 + 13-07
requirements-completed: []
requirements-evidenced: [FND-01, FND-06]

duration: 7min
completed: 2026-08-08
status: r1-correction-complete-awaiting-human-re-review
---

# Phase 13 Plan 01: Surface Manifest & Feasibility Gate Summary

**Closed Medusa 2.16.0 Store surface SSOT (58 ops, 0/10/17/31, DENY=51/PRESERVE_LEGACY=7) plus Wave 0 proof that Medusa mutation and version CAS share one PostgreSQL transaction manager**

## Identity

Plan: 13-01  
Status: R1 CORRECTION COMPLETE / AWAITING HUMAN RE-REVIEW
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
PHASE13_EXECUTION_BASE_SHA: `1c6a1dfcea4c74db4dd988a733213f103b5447f4`  
Pre-plan HEAD: `1c6a1dfcea4c74db4dd988a733213f103b5447f4`  
Post-plan implementation commit(s):
- `0e93d9d` — feat(13-01): lock Store surface manifest and exact-set scanner
- `ce1ce38` — feat(13-01): prove Wave 0 shared transaction manager and CAS

Post-R1 correction commit(s):
- `aad75bc` — fix(13-01): prove CAS rollback after executed update

## Performance

- **Duration:** ~7 min
- **Started:** 2026-08-08T00:59:10Z
- **Completed:** 2026-08-08T01:06:30Z
- **Tasks:** 2 automated + 1 human checkpoint (awaiting review)
- **Files modified:** 5 product + 1 SUMMARY

## Accomplishments

- Materialized the closed 58-operation Store surface manifest as the single SSOT with independent `classification`, `runtime_policy`, `m1_enablement`, `openapi_m1_expectation`, and non-empty `rationale`.
- Added a read-only exact-set scanner that discovers 51 native + 7 local non-overlapping operations against Medusa 2.16.0 and fails closed on drift/invalid combos/M1_ENABLED.
- Proved Wave 0 binary feasibility: same transaction manager identity, same `txid_current()`, joint commit/rollback, exactly one CAS winner, Redis locking absent/failing.

## Surface inventory (exact counts)

| Metric | Count |
|---|---:|
| runtime Store operations | 58 |
| native (incl. native+local_extension) | 51 |
| local non-overlapping | 7 |
| native+local_extension (products) | 2 |
| AUTHORIZED | 0 |
| EXTENDED | 10 |
| BLOCKED | 17 |
| OUTSIDE_FRONTEND_M1 | 31 |
| UNKNOWN | 0 |
| runtime_policy DENY | 51 |
| runtime_policy PRESERVE_LEGACY | 7 |
| runtime_policy M1_ENABLED | 0 |
| m1_enablement enabled | 0 |

PRESERVE_LEGACY keys (Store 1.0.0 accepted v1.0 behavior only):

1. `GET /store/products` — EXTENDED
2. `GET /store/products/{id}` — EXTENDED
3. `GET /store/carts/active` — EXTENDED
4. `POST /store/carts/active` — EXTENDED
5. `POST /store/carts/{id}/payment-attempts/card` — EXTENDED
6. `POST /store/carts/{id}/payment-attempts/pix` — OUTSIDE_FRONTEND_M1
7. `POST /store/tracking/lookup` — OUTSIDE_FRONTEND_M1

Notable BLOCKED+DENY despite prior Store 1.0.0 exposure: `POST /store/customers/me/cart/attach`.  
Scaffold `GET /store/custom` is BLOCKED+DENY.

## Manifest invariants

- Exact-set 58/58; 0 duplicates; 0 unknown installed routes
- Distribution AUTHORIZED/EXTENDED/BLOCKED/OUTSIDE = 0/10/17/31
- Every entry has classification + runtime_policy + rationale + openapi_m1_expectation
- BLOCKED ⇒ DENY (mandatory)
- DENY + PRESERVE_LEGACY = 58
- Phase 13: M1_ENABLED policy count = 0; m1_enablement enabled = 0
- No class-wide inference for EXTENDED/OUTSIDE beyond individual DENY|PRESERVE_LEGACY decisions
- Medusa package version locked to `2.16.0`

## Wave 0 evidence

| Claim | Result | Evidence |
|---|---|---|
| Manager identity | PASS | `transactionManager === activeManager === mutationManager === casManager`; identity tokens equal |
| Same PostgreSQL transaction | PASS | `txid_current()` identical across mutation and CAS (`sameTransactionId=true`) |
| Single atomic commit | PASS | CheckoutCompletionLog row + probe mutation row + version bump all present after success |
| Atomic rollback | PASS | CAS successfully executed inside same transaction; injected failure occurred after successful CAS and before commit; external post-rollback reads prove Medusa row=0, probe mutation=0, version restored to original |
| CAS concurrency | PASS | Two writers same `expectedVersion` → exactly one winner, one `STORE_FOUNDATION_CAS_CONFLICT` |
| Redis independence | PASS | Disposable env Redis URLs empty; failing locking coordinator; CAS still correct |

Controlled Medusa mutation subject: `checkoutCompletion.createCheckoutCompletionLogs(..., sharedContext)`.  
Probe tables (`store_foundation_tx_probe_mutation`, `store_foundation_tx_probe_version`) created only in disposable DB — no product migration.

### Atomic rollback (R1 corrected contract)

```text
Atomic rollback: PASS

Evidence:
CAS successfully executed inside same transaction (onCasSucceeded + in-tx version read 3→4);
injected failure occurred after successful CAS and before commit (injectErrorAfterCas);
external post-rollback reads prove:
Medusa row=0,
probe mutation=0,
version restored to original (3).
```

## Tests

### Unit — manifest

```text
Command: cd apps/backend && npm run test:unit -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts --runInBand
Exit code: 0
Suites: 1 passed, 1 total
Tests: 7 passed, 7 total
Result: PASS
```

### Scanner — exact-set

```text
Command: cd apps/backend && npm exec -- ts-node --swc scripts/store-surface/scan-installed.ts --check
Exit code: 0
Output: medusa=2.16.0 discovered=58 manifest=58 authorized=0 extended=10 blocked=17 outside=31 deny=51 preserve_legacy=7 m1_enabled_policy=0 m1_enablement_enabled=0 STORE_SURFACE_SCAN_OK
Result: PASS
```

Note: plan path `./node_modules/.bin/ts-node` is missing under workspace hoisting (`apps/backend/node_modules` has no `.bin`). Equivalent project-standard invocation is `npm exec -- ts-node --swc ...` (same pattern as OpenAPI scripts).

### Integration — Wave 0 disposable PostgreSQL

```text
Command: cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts --runInBand
Exit code: 0
Suites: 1 passed, 1 total
Tests: 6 passed, 6 total
Result: PASS
```

## Scope

| Check | Result |
|---|---|
| Allowlisted product files only | YES — 5 files |
| Unexpected product files | NONE |
| package.json / package-lock.json | NOT MODIFIED |
| medusa-config.ts | NOT MODIFIED |
| Product migration | NONE |
| Remote DB | NONE (disposable only) |
| Provider / deploy / frontend | NONE |
| OpenAPI registry/JSON | NOT MODIFIED |
| npm install | NOT RUN |

## Git

Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
No push. No PR.

| Commit | Message |
|---|---|
| `0e93d9d` | feat(13-01): lock Store surface manifest and exact-set scanner |
| `ce1ce38` | feat(13-01): prove Wave 0 shared transaction manager and CAS |

Unrelated dirty file left untouched: `.planning/STATE.md` (begin-phase bookkeeping).

## Task Commits

1. **Task 1: Fixar manifest único e scanner exact-set** — `0e93d9d` (feat)
2. **Task 2: Executar Wave 0 binária de transação compartilhada e CAS** — `ce1ce38` (feat)
3. **Task 3: Revisar o resultado binário da Wave 0** — awaiting human review (checkpoint)

## Decisions Made

- PRESERVE_LEGACY limited to the seven Store 1.0.0-accepted routes listed above; all remaining EXTENDED/OUTSIDE individually DENY.
- `POST /store/customers/me/cart/attach` kept BLOCKED+DENY (merge contract not re-authorized).
- Wave 0 uses CheckoutCompletionLog as the controlled Medusa write joined via `sharedContext.transactionManager`; foundation probe tables stay disposable-only.
- Scanner CLI verified via `npm exec -- ts-node` due to workspace bin hoisting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Scanner path prefix omitted `/store`**
- **Found during:** Task 1 verification
- **Issue:** Canonicalization used apiRoot already ending at `.../store`, producing `/carts` instead of `/store/carts`.
- **Fix:** Prepend `/store` in `canonicalizePathTemplate`.
- **Files modified:** `apps/backend/scripts/store-surface/scan-installed.ts`
- **Committed in:** `0e93d9d`

**2. [Rule 3 - Blocking] Plan verify path `./node_modules/.bin/ts-node` missing**
- **Found during:** Task 1 verification
- **Issue:** npm workspaces hoist binaries to repo root; `apps/backend/node_modules/.bin` does not exist.
- **Fix:** Used `npm exec -- ts-node --swc ...` (established OpenAPI script pattern). No package/lockfile changes.
- **Files modified:** none (invocation only)
- **Committed in:** n/a (documented)

**Total deviations:** 2 auto-fixed (Rule 3 ×2)  
**Impact on plan:** Correctness-only; no scope creep; no architectural change.

## Issues Encountered

None beyond the deviations above.

## Known Stubs

None — manifest is complete; Wave 0 adapter is a feasibility probe (intentional non-product module) and does not stub StoreResourceVersion.

## Threat Flags

None beyond the plan threat model. Scanner is read-only; probe tables are disposable-only; no new network endpoints.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FND-01: 13-01 evidence produced (exact-set SSOT + scanner). Not complete — still requires 13-02 + 13-07.
- FND-06: Wave 0 prerequisite evidence produced (shared TM + CAS + corrected rollback). Not complete — still requires 13-05 + 13-07.
- Phase 13 requirements complete: 0/8
- Milestone requirements complete: 0/91
- Plans executed: 1/7
- **13-02 is NOT AUTHORIZED** until human re-review PASS on this R1 SUMMARY.
- Do not start lockdown middleware, idempotency module, resource-version module, OpenAPI 1.1.0, deploy, or Frontend M1.

## Human Review R1 Correction

Original human review: **R1 REQUIRED**

Blockers:
- B13-01-R1-01 rollback CAS proof
- B13-01-R1-02 premature requirement completion
- B13-01-R1-03 stale STATE/ROADMAP

Warning:
- W13-01-R1-01 catalog owner_phase reconciliation

### R1 corrections applied

| Finding | Result |
|---|---|
| B13-01-R1-01 | FIXED — `injectErrorAfterCas` after successful CAS; `onCasSucceeded` + in-tx version verify prove CAS executed; post-rollback Medusa/probe/version all restored |
| B13-01-R1-02 | FIXED — `requirements-completed: []`; FND-01/FND-06 recorded as evidenced only |
| B13-01-R1-03 | FIXED — STATE/ROADMAP current gate synchronized to 13-01 R1 awaiting human re-review |
| W13-01-R1-01 | CORRECTED WITH AUTHORITY — see Catalog owner_phase reconciliation |

### Catalog owner_phase reconciliation

```text
Catalog owner_phase reconciliation:
CORRECTED WITH AUTHORITY

Owner:
21

Previous (incorrect):
16

Authority:
- .planning/ROADMAP.md Phase 21 = Order Confirmation & Catalog Handoff (CAT-01..CAT-04)
- .planning/REQUIREMENTS.md Phase 21 CAT-01..CAT-04 (catalog handle/DTO/revalidation)
- 13-RESEARCH.md §18 Downstream Findings Phase 21 Order/Catalog:
  "Product routes preservam serializer atual"
- 13-SPEC.md / 13-CONTEXT.md: Phase 16 = merge/review only;
  Phase 21 = order summary / catalog revalidation

Reason:
No approved authority assigns GET /store/products or GET /store/products/{id}
to Phase 16 (Cart Merge & Review). Catalog M1 ownership and product-route
preservation are bound to Phase 21. Classification, runtime_policy,
m1_enablement, openapi expectation, and 58-route exact-set unchanged.
```

### R1 Wave 0 revalidation

```text
Command: cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts --runInBand
Exit code: 0
Suites: 1 passed, 1 total
Tests: 6 passed, 6 total
Result: PASS
```

### R1 manifest regression

```text
Command: cd apps/backend && npm run test:unit -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts --runInBand
Exit code: 0
Suites: 1 passed, 1 total
Tests: 8 passed, 8 total
Result: PASS

Scanner: STORE_SURFACE_SCAN_OK — 58/58, 0/10/17/31, DENY=51, PRESERVE_LEGACY=7, M1_ENABLED=0
```

## Gate

```text
P13-13-01-R1: COMPLETE / AWAITING HUMAN RE-REVIEW
13-01: NOT YET HUMAN-APPROVED
13-02: NOT AUTHORIZED
13-03..13-07: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
Frontend M1: BLOCKED
Phase 13 requirements complete: 0/8
Milestone requirements complete: 0/91
Plans executed: 1/7
```

Human must record PASS or BLOCKED on R1. Only PASS unlocks a separate authorization request for 13-02.

## Self-Check: PASSED

- [x] `apps/backend/src/api/store-surface/manifest.ts` FOUND
- [x] `apps/backend/scripts/store-surface/scan-installed.ts` FOUND
- [x] `apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts` FOUND
- [x] `apps/backend/src/infrastructure/store-foundation-transaction-compatibility.ts` FOUND
- [x] `apps/backend/src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts` FOUND
- [x] Commit `0e93d9d` FOUND
- [x] Commit `ce1ce38` FOUND

---
*Phase: 13-storefront-contract-foundation-surface-lockdown*
*Completed: 2026-08-08*
