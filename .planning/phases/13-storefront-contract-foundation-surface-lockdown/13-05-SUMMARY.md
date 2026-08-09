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
  - Generic StoreResourceVersion module with lazy version-1 bootstrap and monotonic integer CAS
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
    - apps/backend/src/modules/store-resource-version/migrations/Migration20260809201808.ts
    - apps/backend/src/modules/store-resource-version/migrations/.snapshot-store-resource-version.json
    - apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts
  modified:
    - apps/backend/medusa-config.ts
    - apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts

key-decisions:
  - "P13-13-05-HCD-01 supersedes bigint plus non-partial UNIQUE with Medusa-DML-native integer plus partial UNIQUE"
  - "Migration20260809175009 is superseded, never remotely applied, and non-authoritative; Migration20260809201808 is the authoritative R2 CLI identity"
  - "All initialize/load/increment/CAS operations fail closed without a real shared transaction context"
  - "All five MedusaService-generated write methods are overridden fail-closed and cannot bypass the authoritative CAS surface"
  - "FND-06 is evidenced but remains incomplete until the Phase 13 human/phase-level gate"

patterns-established:
  - "Lazy bootstrap: INSERT ON CONFLICT with the partial-index predicate followed by SELECT FOR UPDATE in the same transaction"
  - "Stale CAS is returned before mutation; failure after mutation rolls back mutation, version bump, and first bootstrap row"

requirements-completed: []
requirements-evidenced: [FND-06]

duration: 21min
completed: 2026-08-09
status: r2-technical-pass-awaiting-human-review
---

# Phase 13 Plan 05: Store Resource Version Foundation Summary

**DML-native monotonic integer Store resource versions with a partial active-resource UNIQUE, transaction-required CAS, and real PostgreSQL proofs for concurrency, rollback, and Redis independence**

## Identity

- **Plan:** 13-05
- **Status:** P13-13-05-R2 TECHNICAL PASS — AWAITING HUMAN REVIEW
- **Branch:** `gsd/phase-13-storefront-contract-foundation-surface-lockdown`
- **Pre-13-05 HEAD:** `48437a4d20e63e01d1d085327c7320f296f183ec`
- **R1 technical implementation HEAD:** `d089694` (write-surface closure)
- **R2 technical correction HEAD:** `9a3f111` (DML-native contract alignment)
- **13-04:** HUMAN APPROVED — PASS
- **13-06..13-07:** NOT AUTHORIZED

## Performance

- **Duration:** ~21 min
- **Started:** 2026-08-09T17:38:35Z
- **Technical gates completed:** 2026-08-09T17:58:32Z
- **Tasks:** Tasks 1–2 R2 technically PASS; Task 3 remains the human-review checkpoint
- **R2 technical files:** model, service, migration identity, snapshot, PostgreSQL test plus three contract documents

## Accomplishments

- Applied `P13-13-05-HCD-01` without MikroORM-direct persistence: active contract is PostgreSQL `integer`, positive/default `1`, and UNIQUE partial `WHERE deleted_at IS NULL`.
- Aligned the internal service contract and CAS results to positive integer `number`; no `bigint` conversion remains in active runtime/test code.
- Replaced only the blocked R1 generation with exactly one factual CLI identity, `Migration20260809201808`, after configuration regression PASS; no rename or manual DDL patch occurred.
- Proved DML/snapshot/migration/catalog semantic consistency and all 9/9 PostgreSQL behaviors; configuration is 8/8 and backend build exits 0.

## P13-13-05-R2 Result

```text
P13-13-05-HCD-01: APPROVED / IMPLEMENTED
B13-05-R1-01: CLOSED — PASS
B13-05-R1-02: CLOSED — PASS
P13-13-05-R2: TECHNICAL PASS — AWAITING HUMAN REVIEW
13-05 HUMAN APPROVED — PASS: NOT GRANTED
13-06..13-07: NOT AUTHORIZED
```

### Human contract supersession

| Contract | R1 / old target | R2 / active target |
|---|---|---|
| `version` physical | PostgreSQL `bigint` | PostgreSQL `integer` |
| Internal service/CAS | `bigint` | positive integer `number` |
| Active resource uniqueness | non-partial UNIQUE | partial UNIQUE `WHERE deleted_at IS NULL` |
| Behavioral invariants | monotonic/CAS/rollback | unchanged |

`Migration20260809175009` is **SUPERSEDED / NEVER REMOTELY APPLIED / NOT AUTHORITATIVE**. Its historical evidence below is retained so the original target is not rewritten out of the record.

### R2 registration and generation chronology

```yaml
module_registration:
  store_idempotency_count: 1
  store_resource_version_count: 1
  redis_modules_preserved: 4
  config_regression: PASS
  registration_proven_before_db_generate: YES
  db_generate_executed_after_registration: YES
config_regression_before_db_generate:
  command: npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand
  exit_code: 0
  suites: 1/1
  tests: 8/8
pre_generation_exact_set: []
db_generate:
  command: npx medusa db:generate store_resource_version
  executions: 1
  exit_code: 0
post_generation_exact_set:
  migration: Migration20260809201808.ts
  snapshot: .snapshot-store-resource-version.json
  migration_delta: 1
manual_ddl_patch: NO
remote_migration: NO
```

### R2 migration and four-layer consistency

| Layer | Version | Active-resource UNIQUE | Result |
|---|---|---|---|
| DML | `model.number().default(1)` → integer | explicit `where: deleted_at IS NULL` | PASS |
| CLI snapshot | `type/mappedType=integer` | partial expression | PASS |
| Generated migration | `integer not null default 1` | partial index | PASS |
| PostgreSQL catalog | `udt_name=int4` | `indisunique=true`, predicate `deleted_at IS NULL` | PASS |

All four layers are **SEMANTICALLY CONSISTENT**. The generated migration identity is `Migration20260809201808` / timestamp `20260809201808`, later than the accepted 13-04 identity `Migration20260809161242`.

### R2 gates

- Configuration regression before generation: PASS (`8/8`).
- Disposable PostgreSQL: PASS (`9/9`), runner cleanup PASS.
- Initial/repeat/concurrent bootstrap: baseline `1`, one active row.
- Monotonic/stale/two writers: `1 → 2`, stale no mutation, one winner/one loser.
- Atomic rollback/shared transaction: PASS.
- Generated writes: `5/5` refused.
- Redis correctness: NONE.
- Build: PASS, zero errors; 297 non-blocking preexisting warnings.
- Package/lockfile, Cart, OpenAPI, 13-06, remote DB, Supabase, deploy, providers and frontend: unchanged/not exercised.

## Historical R1 evidence (superseded physical target preserved)

## P13-13-05-R1 Result

```text
B13-05-R1-01: OPEN — BLOCKER
BLOCKED — MODEL/MIGRATION CONTRACT DECISION REQUIRED

B13-05-R1-02: CLOSED — PASS
MedusaService generated writes fail closed: 5/5

13-05 HUMAN APPROVED — PASS: NOT GRANTED
13-06..13-07: NOT AUTHORIZED
```

### Schema consistency proof — BLOCKED

Evidence against the installed `@medusajs/framework@2.16.0` and
`@medusajs/utils@2.16.0`:

| Layer | `version` | resource unique |
|---|---|---|
| DML `model.number()` | `integer` | DML forces `WHERE deleted_at IS NULL` |
| CLI snapshot | `integer` / `mappedType=integer` | partial unique index |
| Physical migration/catalog | `bigint` / `int8` | non-partial unique index |

The installed DML implementation has only these numeric mappings:
`number → integer`, `float → real`, and `bigNumber → numeric` with an
additional `raw_*` property. Its index transformer unconditionally adds a
`deleted_at` predicate when none is supplied. There is no supported DML option
for a PostgreSQL `bigint` counter or for a non-partial unique index.

Consequently, regenerating the snapshot cannot make the three descriptions
equal. Editing the snapshot or migration by hand would only conceal the drift
and remains prohibited by the R1 contract. Changing to a direct/deprecated
MikroORM entity or changing the approved DB contract is an architectural
decision and was not inferred by the executor.

### Write-surface negative proof — PASS

- `createStoreResourceVersions`: throws `STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`.
- `updateStoreResourceVersions`: throws `STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`.
- `deleteStoreResourceVersions`: throws `STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`.
- `softDeleteStoreResourceVersions`: throws `STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`.
- `restoreStoreResourceVersions`: throws `STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`.
- The disposable PostgreSQL proof invokes all five with a valid shared
  transaction, observes five refusals, and confirms zero rows were written.
- The controlled rollback probe now uses the approved `initialize` primitive;
  the test suite no longer consumes an inherited CRUD bypass.

## Task Commits

1. **Task 1: model/service, registration, factual migration, build** — `86e6bcb` (`feat`)
2. **Task 2: disposable PostgreSQL atomicity/concurrency proofs** — `505e724` (`test`)
3. **R1 generated-write closure** — `d089694` (`fix`)
4. **R2 DML-native contract correction and factual regeneration** — `9a3f111` (`fix`)
5. **Task 3: human verification** — awaiting review; no auto-approval

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

### Physical DDL Review — PASS; model correspondence — BLOCKED

- Table `store_resource_version` with `resource_type`, `resource_id`, `version`, and Medusa timestamps/`deleted_at`.
- `version bigint not null default 1`.
- Named `CHECK (version > 0)`.
- Non-partial `UNIQUE (resource_type, resource_id)` so `ON CONFLICT` inference and first-access serialization are valid.
- Only the conventional partial `deleted_at` lookup index is additional; no unexpected DDL.
- `down` drops only `store_resource_version`; disposable down/reapply passed.

The CLI-generated filename/class/snapshot were retained. The original execution
manually corrected the generated integer/partial DDL to the approved
bigint/non-partial contract. R1 establishes that this makes the physical DDL
correct but model correspondence false; no R1 edit was made to the model,
snapshot, or migration to disguise that divergence.

## Service Contract

- `initialize` performs `INSERT ... ON CONFLICT DO NOTHING` and `SELECT ... FOR UPDATE` in the caller transaction, returning version `1` for a new/existing unversioned scope.
- `loadForUpdate`, `increment`, and `compareAndSwapWithMutation` require `__type: "MedusaContext"`, the same `manager`/`transactionManager`, and a real transaction context.
- Expected-version mismatch returns an explicit `stale` result before invoking the mutation.
- Successful mutation and version bump share the same transaction manager/txid.
- Failure after a successful inner CAS rolls back the controlled Medusa mutation, bump, and first bootstrap row.
- Redis is not read by the module; PostgreSQL row locks and conditional updates remain authoritative.
- Generated create/update/delete/soft-delete/restore methods all fail closed;
  only transaction-required custom primitives can write the version table.

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
Tests: 9 passed / 9 total
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
- Generated public write paths refused 5/5 operations under a valid shared
  transaction and left the table empty.

Historically, the first local execution found that an `OperationalAlert`
service cannot reuse another module's MikroORM manager metadata, and the
original proof temporarily used inherited MedusaService CRUD. R1 removed that
bypass entirely: the mutation probe now calls the approved transaction-required
`initialize` primitive, and the current suite passes 9/9.

### Final configuration regression

```text
Command: npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 8 passed / 8 total
Result: PASS
```

### R1 final build

```text
Command: ADMIN_DISABLED=true npm run build -w @dtc/backend
Exit: 0
TypeScript errors: 0
Result: PASS (Backend build completed successfully)
Lint: 298 warnings / 0 errors; warnings are non-blocking and were not widened into scope
```

## Historical R1 Files Created/Modified

- `apps/backend/src/modules/store-resource-version/index.ts` — module key/export.
- `apps/backend/src/modules/store-resource-version/service.ts` — lazy lock/bootstrap and transaction-required CAS APIs.
- `apps/backend/src/modules/store-resource-version/models/store-resource-version.ts` — model metadata and unique/check declarations.
- `apps/backend/src/modules/store-resource-version/migrations/Migration20260809175009.ts` — superseded R1 migration, never remotely applied and removed by authorized R2 regeneration.
- `apps/backend/src/modules/store-resource-version/migrations/.snapshot-store-resource-version.json` — canonical CLI snapshot.
- `apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts` — nine real PostgreSQL proofs.
- `apps/backend/medusa-config.ts` — exactly one module registration.
- `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts` — exact registration/provider/order/no-mutation regression.

## Historical R1 Scope Audit

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

R1 runtime/test delta is isolated in commit `d089694`: service, module export,
and the existing PostgreSQL spec only. R1 documentary changes are limited to
this SUMMARY and `.planning/STATE.md`. Model, snapshot, migration, config,
package/lockfiles, Cart, OpenAPI, providers, and frontend are unchanged by R1.

## R2 Deviations from Plan

- The original physical target was superseded by the explicit human decision
  `P13-13-05-HCD-01`; R2 followed the authorized corrective regeneration path.
  No unapproved architectural deviation or adjacent phase work occurred.

## Historical Issues Encountered

- Initial PostgreSQL run: 5/8 passed; three controlled-mutation cases failed because MikroORM correctly isolates entity metadata by module. The test mutation was moved to the new module's inherited MedusaService and the complete suite then passed 8/8.
- Build emits 293 warnings and zero errors. These warnings predate/extend beyond Plan 13-05 and are not a blocking gate.
- `B13-05-R1-01` was historically open because Medusa 2.16.0 DML cannot express
  the old `bigint` plus non-partial unique schema. `P13-13-05-HCD-01` superseded
  that physical target, and R2 closes the blocker with four-layer consistency.

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

- `FND-06`: EVIDENCED — NOT COMPLETE; R2 technical evidence is PASS, but 13-05 awaits human review.
- `requirements-completed: []`; `.planning/REQUIREMENTS.md` intentionally unchanged.
- Phase 13 requirements covered: 8/8.
- Phase 13 requirements complete: 0/8.
- Milestone requirements complete: 0/91.
- Plans human-approved executed: 4/7.
- 13-05: P13-13-05-R2 TECHNICAL PASS — AWAITING HUMAN REVIEW.
- 13-06: NOT AUTHORIZED.
- ETag/If-Match public behavior and guest Cart capability: NOT IMPLEMENTED (Phase 15 boundary).
- Deploy/frontend: NOT AUTHORIZED.

## Self-Check: R2 TECHNICAL PASS — HUMAN GATE PENDING

- All eight technical files exist.
- Task commits `86e6bcb` and `505e724` exist.
- Exactly one module migration exists: `Migration20260809201808.ts`.
- Package/lockfiles are unchanged from the authorized baseline.
- Summary records technical evidence only and does not mark human approval or FND-06 completion.
- R1 write-surface proof: PASS (5/5 generated writes refused; PostgreSQL 9/9).
- R2 schema-consistency proof: PASS (DML/snapshot/migration/catalog are integer + partial).
- `Migration20260809175009` is documented as superseded/never remotely applied/non-authoritative.
- 13-05 human approval is not inferred; 13-06 remains not authorized.

## Next Phase Readiness

Human review of `P13-13-05-R2` is required. Do not start 13-06, Phase 13 global
verification, deploy, push, PR, or frontend work.

---
*Phase: 13-storefront-contract-foundation-surface-lockdown*
*R2 assessed: 2026-08-09; technical PASS awaiting human review*
