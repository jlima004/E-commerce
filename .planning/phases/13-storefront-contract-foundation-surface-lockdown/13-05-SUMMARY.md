---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 05
subsystem: database
tags: [store-resource-version, postgres, optimistic-concurrency, cas, medusa-2.16.0]

requires:
  - phase: 13-01
    provides: shared Medusa transaction adapter and disposable PostgreSQL harness
  - phase: 13-04
    provides: approved Store idempotency foundation and factual migration identity Migration20260809161242

provides:
  - Generic StoreResourceVersion module with lazy version-1 bootstrap and monotonic bigint CAS
  - Transaction-required Medusa mutation + version update with one PostgreSQL commit or rollback
  - CLI-generated migration and disposable PostgreSQL concurrency/rollback evidence

affects:
  - 15-guest-cart-capability-concurrency
  - 13-07-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - PostgreSQL UNIQUE plus INSERT ON CONFLICT and SELECT FOR UPDATE serialize lazy bootstrap
    - CAS and controlled Medusa mutation require one caller-owned MedusaContext transaction
    - Redis can coordinate but never decides version correctness

key-files:
  created:
    - apps/backend/src/modules/store-resource-version/index.ts
    - apps/backend/src/modules/store-resource-version/service.ts
    - apps/backend/src/modules/store-resource-version/models/store-resource-version.ts
    - apps/backend/src/modules/store-resource-version/migrations/Migration20260809175009.ts
    - apps/backend/src/modules/store-resource-version/migrations/.snapshot-store-resource-version.json
    - apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts
  modified:
    - apps/backend/medusa-config.ts
    - apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts

key-decisions:
  - "Migration20260809175009 is the authoritative CLI identity and is later than approved 13-04 identity Migration20260809161242"
  - "The physical DDL uses bigint and non-partial uniqueness even though the Medusa DML model uses model.number for runtime compatibility"
  - "All initialize/load/increment/CAS operations fail closed without a real shared transaction context"
  - "FND-06 is evidenced but remains incomplete until the Phase 13 human/phase-level gate"

patterns-established:
  - "Lazy bootstrap: INSERT ON CONFLICT DO NOTHING followed by SELECT FOR UPDATE in the same transaction"
  - "Stale CAS is returned before mutation; failure after mutation rolls back mutation, version bump, and first bootstrap row"

requirements-completed: []
requirements-evidenced: [FND-06]

duration: 21min
completed: 2026-08-09
status: technical-pass-awaiting-human-review
---

# Phase 13 Plan 05: Store Resource Version Foundation Summary

**Generic monotonic bigint Store resource versions with serialized lazy bootstrap, transaction-required CAS, and real PostgreSQL proofs for concurrency, rollback, and Redis independence**

## Identity

- **Plan:** 13-05
- **Status:** TECHNICAL PASS — AWAITING HUMAN REVIEW
- **Branch:** `gsd/phase-13-storefront-contract-foundation-surface-lockdown`
- **Pre-13-05 HEAD:** `48437a4d20e63e01d1d085327c7320f296f183ec`
- **Technical implementation HEAD:** `505e7242c61879905f2ffb7ccefad4bebcbfcb44`
- **13-04:** HUMAN APPROVED — PASS
- **13-06..13-07:** NOT AUTHORIZED

## Performance

- **Duration:** ~21 min
- **Started:** 2026-08-09T17:38:35Z
- **Technical gates completed:** 2026-08-09T17:58:32Z
- **Tasks:** 2/3 complete; Task 3 awaits human verification
- **Technical files:** 8

## Accomplishments

- Added the registered `store_resource_version` Medusa module with one row per `(resource_type, resource_id)`, positive bigint versions, lazy baseline `1`, monotonic increment, explicit stale results, and no standalone/two-commit fallback.
- Generated exactly one migration after the registration regression passed; accepted CLI identity `Migration20260809175009`, later than `Migration20260809161242` from 13-04.
- Proved 8/8 behaviors on disposable real PostgreSQL: exact catalog DDL, fail-closed transaction use, repeated/concurrent bootstrap, monotonic/stale CAS, one winner among two writers, shared manager/txid rollback, Redis independence, and migration down/reapply.
- Revalidated configuration (8/8) and the backend build (exit 0, zero TypeScript errors).

## Task Commits

1. **Task 1: model/service, registration, factual migration, build** — `86e6bcb` (`feat`)
2. **Task 2: disposable PostgreSQL atomicity/concurrency proofs** — `505e724` (`test`)
3. **Task 3: human verification** — awaiting review; no auto-approval

## Registration and Generation Chronology

```yaml
registration:
  store_idempotency_count: 1
  store_resource_version_count: 1
  redis_modules_preserved: 4
config_regression_before_db_generate:
  command: npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand
  exit_code: 0
  suites: 1/1
  tests: 8/8
  result: PASS
pre_generation_capture:
  timestamp: 2026-08-09T17:50:01Z
  exact_set: []
  migration_count: 0
db_generate:
  command: npx medusa db:generate store_resource_version
  executions: 1
  exit_code: 0
  executed_after_registration_pass: true
post_generation_capture:
  exact_set:
    - Migration20260809175009.ts
  snapshot:
    - .snapshot-store-resource-version.json
  migration_delta: 1
```

No retry, copy, manual rename, package change, or remote migration occurred.

## Migration Evidence

| Field | Value |
|---|---|
| Module | `store_resource_version` |
| CLI command | `npx medusa db:generate store_resource_version` |
| CLI exit | 0 |
| Source file | `apps/backend/src/modules/store-resource-version/migrations/Migration20260809175009.ts` |
| Exported class | `Migration20260809175009` |
| Framework/history identity | `Migration20260809175009` / timestamp `20260809175009` |
| 13-04 identity | `Migration20260809161242` |
| New identity later | YES |
| Manual rename | NO |
| Remote migration | NO |

### DDL Review — PASS

- Table `store_resource_version` with `resource_type`, `resource_id`, `version`, and Medusa timestamps/`deleted_at`.
- `version bigint not null default 1`.
- Named `CHECK (version > 0)`.
- Non-partial `UNIQUE (resource_type, resource_id)` so `ON CONFLICT` inference and first-access serialization are valid.
- Only the conventional partial `deleted_at` lookup index is additional; no unexpected DDL.
- `down` drops only `store_resource_version`; disposable down/reapply passed.

The CLI-generated filename/class/snapshot were retained. DDL review corrected the generated integer column to the approved bigint contract and removed the generated partial predicate from the resource unique index; no identity was renamed or synthesized.

## Service Contract

- `initialize` performs `INSERT ... ON CONFLICT DO NOTHING` and `SELECT ... FOR UPDATE` in the caller transaction, returning version `1` for a new/existing unversioned scope.
- `loadForUpdate`, `increment`, and `compareAndSwapWithMutation` require `__type: "MedusaContext"`, the same `manager`/`transactionManager`, and a real transaction context.
- Expected-version mismatch returns an explicit `stale` result before invoking the mutation.
- Successful mutation and version bump share the same transaction manager/txid.
- Failure after a successful inner CAS rolls back the controlled Medusa mutation, bump, and first bootstrap row.
- Redis is not read by the module; PostgreSQL row locks and conditional updates remain authoritative.

## Test Evidence

### Registration precondition — before generation

```text
Command: npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 8 passed / 8 total
Result: PASS BEFORE db:generate
```

### Task 1 build

```text
Command: ADMIN_DISABLED=true npm run build -w @dtc/backend
Exit: 0
TypeScript errors: 0
Result: PASS
```

### Disposable PostgreSQL

```text
Command: node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 8 passed / 8 total
Result: PASS
Disposable Docker database/container: cleaned by runner
```

Observed behaviors:

- Baseline/repeated/concurrent bootstrap: `1`; same-resource race rows: `1`.
- Different resource type/id scopes remain isolated.
- Monotonic sequence: `1 → 2`; stale expected `1` at actual `2` returns `stale` with zero mutation.
- Two writers from expected `1`: one updated winner, one stale loser, final version `2`.
- Shared manager and PostgreSQL `txid_current()` identity matched through the controlled Medusa mutation.
- Failure injection left no business mutation, no version bump, and no first bootstrap row.
- Empty Redis URLs did not affect bootstrap/CAS/winner truth.
- Core Cart was never mutated and `checkout_completion_log` remained empty.

The first local test execution found that an `OperationalAlert` service cannot reuse another module's MikroORM manager metadata. The test-only mutation was narrowed to the registered module's inherited MedusaService under a synthetic `mutation_probe` resource, retaining the same-transaction proof and avoiding cross-module coupling; the required second execution passed 8/8.

### Final configuration regression

```text
Command: npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 8 passed / 8 total
Result: PASS
```

### Final build

```text
Command: ADMIN_DISABLED=true npm run build -w @dtc/backend
Exit: 0
TypeScript errors: 0
Result: PASS (Backend build completed successfully)
Lint: 293 warnings / 0 errors; warnings are pre-existing/non-blocking and were not widened into scope
```

## Files Created/Modified

- `apps/backend/src/modules/store-resource-version/index.ts` — module key/export.
- `apps/backend/src/modules/store-resource-version/service.ts` — lazy lock/bootstrap and transaction-required CAS APIs.
- `apps/backend/src/modules/store-resource-version/models/store-resource-version.ts` — model metadata and unique/check declarations.
- `apps/backend/src/modules/store-resource-version/migrations/Migration20260809175009.ts` — sole CLI-generated migration identity and reviewed DDL.
- `apps/backend/src/modules/store-resource-version/migrations/.snapshot-store-resource-version.json` — canonical CLI snapshot.
- `apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts` — eight real PostgreSQL proofs.
- `apps/backend/medusa-config.ts` — exactly one module registration.
- `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts` — exact registration/provider/order/no-mutation regression.

## Scope Audit

```text
git diff --name-only 48437a4d20e63e01d1d085327c7320f296f183ec..505e7242c61879905f2ffb7ccefad4bebcbfcb44
apps/backend/medusa-config.ts
apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts
apps/backend/src/modules/store-resource-version/index.ts
apps/backend/src/modules/store-resource-version/migrations/.snapshot-store-resource-version.json
apps/backend/src/modules/store-resource-version/migrations/Migration20260809175009.ts
apps/backend/src/modules/store-resource-version/models/store-resource-version.ts
apps/backend/src/modules/store-resource-version/service.ts

Unexpected technical paths: NONE
package.json: UNCHANGED
package-lock.json: UNCHANGED
apps/backend/package.json: UNCHANGED
git diff --check: PASS
```

## Deviations from Plan

None in product scope. The test-only cross-module metadata limitation described above was resolved inside the sole authorized Task 2 test path; no runtime architecture, dependency, or contract changed.

## Issues Encountered

- Initial PostgreSQL run: 5/8 passed; three controlled-mutation cases failed because MikroORM correctly isolates entity metadata by module. The test mutation was moved to the new module's inherited MedusaService and the complete suite then passed 8/8.
- Build emits 293 warnings and zero errors. These warnings predate/extend beyond Plan 13-05 and are not a blocking gate.

## Known Stubs

None. The generic primitive is deliberately not wired to public Cart/ETag/If-Match behavior; that boundary is assigned to Phase 15 and is not a stub in this plan.

## Threat Surface Scan

No unplanned threat surface. The plan introduces one internal database table/module only; no network endpoint, authentication path, provider call, file-access boundary, or secret persistence was added. Transaction fail-closed behavior, DB constraints, and Redis independence are covered by tests.

## Remote Effects

- Supabase: NO
- Remote database: NO
- Heroku/deploy: NO
- Providers: NO
- Push/PR: NO
- Local disposable PostgreSQL Docker only; runner cleaned its database/container.

## Requirements / Governance

- `FND-06`: EVIDENCED — NOT COMPLETE.
- `requirements-completed: []`; `.planning/REQUIREMENTS.md` intentionally unchanged.
- Phase 13 requirements covered: 8/8.
- Phase 13 requirements complete: 0/8.
- Milestone requirements complete: 0/91.
- Plans human-approved executed: 4/7.
- 13-05: TECHNICAL PASS — AWAITING HUMAN REVIEW.
- 13-06: NOT AUTHORIZED.
- ETag/If-Match public behavior and guest Cart capability: NOT IMPLEMENTED (Phase 15 boundary).
- Deploy/frontend: NOT AUTHORIZED.

## Self-Check: PASSED

- All eight technical files exist.
- Task commits `86e6bcb` and `505e724` exist.
- Exactly one module migration exists: `Migration20260809175009.ts`.
- Package/lockfiles are unchanged from the authorized baseline.
- Summary records technical evidence only and does not mark human approval or FND-06 completion.

## Next Phase Readiness

Task 3 is awaiting explicit human verification. Do not start 13-06, Phase 13 global verification, deploy, push, PR, or frontend work without separate authorization.

---
*Phase: 13-storefront-contract-foundation-surface-lockdown*
*Technical gates completed: 2026-08-09; awaiting human review*
