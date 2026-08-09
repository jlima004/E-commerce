---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 04
subsystem: database
tags: [store-idempotency, postgres, migration, lifecycle-job, hmac, ttl, medusa-2.16.0]

requires:
  - phase: 13-01
    provides: disposable PostgreSQL harness and foundation transaction patterns
  - phase: 13-04-task-1-2
    provides: frozen StoreIdempotencyRecord model/service, env pepper contract, DB Model v1.22, module registration

provides:
  - CLI-generated Store idempotency migration applied on disposable PostgreSQL
  - Real PostgreSQL proof of claim/replay/conflict/lease/CAS/cleanup
  - Medusa scheduled lifecycle driver `store-idempotency-lifecycle` (* * * * *)

affects:
  - 13-05-storefront-contract-foundation-surface-lockdown
  - 13-07-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - PostgreSQL UNIQUE + ON CONFLICT for initial claim; locked_at lease only via claimLifecycleRow
    - Processing stale via state_deadline_at (5m); lifecycle-worker lease via locked_at (15m)
    - Thin scheduled job orchestration over service methods; phase13 harness ops only

key-files:
  created:
    - apps/backend/src/modules/store-idempotency/migrations/Migration20260809161242.ts
    - apps/backend/src/modules/store-idempotency/migrations/.snapshot-store-idempotency.json
    - apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts
    - apps/backend/src/jobs/store-idempotency-lifecycle.ts
    - apps/backend/src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-04-SUMMARY.md
  modified: []

key-decisions:
  - "CLI migration identity Migration20260809161242 is authoritative; class/filename not renamed"
  - "Post-review CHECKs for hash_version/pepper_version/state_version added to match DB Model v1.22"
  - "Unique index made non-partial so frozen claim() ON CONFLICT matches PostgreSQL inference"
  - "Initial claim locked_at=null; lifecycle lease starts only at claimLifecycleRow (15m)"
  - "Phase 13 lifecycle acts only on phase13.local-mutation and phase13.uncertain-effect-simulation"

patterns-established:
  - "Disposable PG suite is required proof for Store idempotency correctness; mock harness alone insufficient"
  - "Lifecycle job is thin: listDue → claimLifecycleRow → act if claimed → cleanupExpiredTerminals"
  - "Cron cadence (* * * * *) is not lease authority"

requirements-completed: []
requirements-evidenced: [FND-04, FND-05]

duration: 10min
completed: 2026-08-09
status: technical-pass-awaiting-human-re-review
---

# Phase 13 Plan 04: Store Idempotency Migration & Lifecycle Summary

**CLI-generated `store_idempotency_record` migration plus disposable PostgreSQL proofs for claim/lease/CAS/cleanup and a 1-minute Medusa lifecycle driver over phase13 harness operations only**

## Identity

Plan: 13-04
Status: TECHNICAL PASS — AWAITING HUMAN RE-REVIEW
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`
Pre-Task-3 HEAD: `c065cd920c9cb8f414fd4e3ab114214950f9c536`
Post-Task-3 HEAD: `19b0ff14f12b2d5139185f064c838f00f48052ec`
Pre-R1 HEAD: `8d28cf3cc562660e4fbe096e04f9d8a8490f0d0a`

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-09T16:11:50Z
- **Completed:** 2026-08-09T16:21:29Z
- **Tasks:** Task 3 complete (Task 1+2 already human-approved)
- **Files modified:** 5 technical paths (+ bookkeeping)

## Accomplishments

- Generated exactly one Medusa migration via `npx medusa db:generate store_idempotency` (exit 0).
- Proved 18/18 disposable PostgreSQL scenarios including concurrent claim, lease T+15m boundary, restart recovery, Redis independence, CAS, cleanup, retention, and hash-only persistence.
- Added scheduled lifecycle driver `store-idempotency-lifecycle` with unit proofs (12/12).
- Build `ADMIN_DISABLED=true npm run build -w @dtc/backend` exit 0 / 0 TS errors.
- Frozen Task-2 contract files unchanged; package.json/lock unchanged; no remote DB/deploy.

## Migration Evidence

| Field | Value |
|---|---|
| Module | `store_idempotency` |
| CLI command | `npx medusa db:generate store_idempotency` |
| CLI exit code | 0 |
| Before count (module migrations) | 0 |
| After count (migration TS files) | 1 |
| Source filename | `apps/backend/src/modules/store-idempotency/migrations/Migration20260809161242.ts` |
| Exported class | `Migration20260809161242` |
| Snapshot companion | `.snapshot-store-idempotency.json` (CLI artifact; not a second migration) |
| Framework/history identity | `Migration20260809161242` / timestamp `20260809161242` |

### DDL Review (PASS)

- Table `store_idempotency_record` with all model fields + Medusa timestamps/`deleted_at`
- UNIQUE via non-partial index `UQ_store_idempotency_record_claim_scope` on `(operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash)` — required for frozen `ON CONFLICT` without predicate
- CHECK state ∈ six approved states
- CHECK `hash_version = 'hmac-sha256-v1'`, `pepper_version = 1`, `state_version >= 1` (post-review additions)
- Indexes: `(state, state_deadline_at)`, `next_retry_at`, `expires_at`
- `locked_at` nullable (no default lease on insert)
- No plaintext secret columns

### R1-01 — Exact PostgreSQL Catalog DDL (PASS)

Verified on disposable PostgreSQL after migration apply (catalog + behavioral rejects):

```text
Claim unique:
UNIQUE: true (indisunique)
PARTIAL: false (indpred NULL; no WHERE deleted_at IS NULL)
ORDERED COLUMNS:
  1. operation
  2. actor_scope_hash
  3. resource_scope_hash
  4. idempotency_key_hash
COMPETING PARTIAL INDEX: NONE

State CHECK exact-set: PASS
  {processing, completed, failed_retryable, failed_terminal,
   reconciliation_required, reconciliation_unresolved}

hash_version CHECK: hash_version = 'hmac-sha256-v1' PASS
pepper_version CHECK: pepper_version = 1 PASS
state_version CHECK: state_version >= 1 PASS
Behavioral rejects: wrong hash_version / pepper_version=2 / state_version=0 / bogus state → DB rejects
```

## Task Commits

1. **Migration generate** — `21796e8` feat(13-04): generate Store idempotency migration
2. **Unique index fix** — `9d92a63` fix(13-04): use non-partial unique for Store idempotency claim
3. **PostgreSQL suite** — `4618e24` test(13-04): prove idempotency foundation on PostgreSQL
4. **Lifecycle job** — `895122a` feat(13-04): add Store idempotency lifecycle driver
5. **Lifecycle unit** — `16f2c75` test(13-04): prove lifecycle driver orchestration
6. **TS build fix** — `19b0ff1` fix(13-04): satisfy TypeScript for Task 3 test suites

## Test Evidence

### Real PostgreSQL (disposable) — Task 3 baseline (historical)

```text
Command: node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 18 passed / 18 total
```

Scenarios covered (Task 3): migration DDL (nominal); concurrent claim; same-intent replay; conflict; scope isolation; initial claim locked_at null + deadline T0+5m; due at T+5m; Worker A/B lease race; T+15m stale boundary; restart recovery; Redis empty env; CAS; terminal replay; cleanup lease boundary (completed only); finite lifecycle; retention 24h/30d/override; sensitive canaries; hash-only persistence.

### Real PostgreSQL (disposable) — P13-13-04-T3-R1

```text
Command: node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 18 passed / 18 total
```

R1 strengthened scenarios (same suite count; deeper assertions):

- Exact UNIQUE catalog proof (`indisunique` / `indpred` / ordered columns / no competing partial)
- Exact six-state CHECK set + version CHECK catalog + behavioral rejects
- Cleanup matrix for all terminal states + non-terminal preservation + lease + idempotence

### R1-03 — PostgreSQL Cleanup Matrix (PASS)

```text
expired completed: DELETED PASS
expired failed_terminal: DELETED PASS
expired reconciliation_unresolved: DELETED PASS
non-terminal (processing) preserved: PASS
fresh lifecycle lease terminal: PRESERVED PASS
exact stale-boundary terminal (T+15m): DELETED PASS
idempotent second cleanup → 0: PASS
```

### Lifecycle unit — Task 3 baseline (historical)

```text
Command: npm run test:unit -- --runTestsByPath src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 12 passed / 12 total
```

### Lifecycle unit — P13-13-04-T3-R1

```text
Command: npm run test:unit -- --runTestsByPath src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts --runInBand
Exit: 0
Suites: 1 passed / 1 total
Tests: 18 passed / 18 total
```

### R1-02 — failed_retryable 8/24h matrix (PASS)

```text
future next_retry_at: PASS (not eligible / no transition)
due below cap: PASS → markCompleted (phase13.local-mutation)
attempt cap (=8): PASS → markFailedTerminal
23h59m59s: PASS → markCompleted (still eligible)
24h exact boundary: PASS → markFailedTerminal
infinite retry possible: NO
```

### Frozen Task-2 regressions — P13-13-04-T3-R1

```text
env.unit.spec.ts + medusa-config.unit.spec.ts + guard.unit.spec.ts + lifecycle unit:
Exit: 0 | Suites 4 | Tests 119 passed

store-foundation-transaction-compatibility.spec.ts (disposable PG / integration:modules):
Exit: 0 | Suites 1 | Tests 6 passed
```

### Build — P13-13-04-T3-R1

```text
Command: ADMIN_DISABLED=true npm run build -w @dtc/backend
Exit: 0
TS errors: 0
Result: Backend build completed successfully
```

### Diff check

```text
git diff --check (R1 working tree) → PASS
Migration/runtime vs Pre-R1 HEAD 8d28cf3 → UNCHANGED
```

## Lifecycle Job

- Path: `apps/backend/src/jobs/store-idempotency-lifecycle.ts`
- `config.name`: `store-idempotency-lifecycle`
- `config.schedule`: `* * * * *` (≠ 15m lease)
- Flow: `listDueLifecycleRows` → `claimLifecycleRow` → act only if claimed → `cleanupExpiredTerminals`
- Ops: `phase13.local-mutation`, `phase13.uncertain-effect-simulation` only
- No Stripe/Gelato/Resend/Order/Cart business mutation; no Redis correctness; no in-memory ownership Set

## Frozen Files (unchanged)

```text
docs/DB_MODEL_v1.22.md
apps/backend/src/modules/store-idempotency/service.ts
apps/backend/src/modules/store-idempotency/models/store-idempotency-record.ts
apps/backend/src/modules/store-idempotency/index.ts
apps/backend/src/config/env.ts
apps/backend/.env.template
apps/backend/medusa-config.ts
package.json / package-lock.json / apps/backend/package.json
```

`git diff --exit-code` against Pre-Task-3 HEAD: PASS for all frozen paths and lockfiles.

## Scope Audit

```text
git diff --name-only c065cd920c9cb8f414fd4e3ab114214950f9c536
apps/backend/src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts
apps/backend/src/jobs/store-idempotency-lifecycle.ts
apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts
apps/backend/src/modules/store-idempotency/migrations/.snapshot-store-idempotency.json
apps/backend/src/modules/store-idempotency/migrations/Migration20260809161242.ts
(+ bookkeeping docs after this SUMMARY commit)
```

## Remote Effects

- No Supabase/Heroku/remote DB mutation
- No deploy / push / PR
- Disposable Docker PostgreSQL only for proof (`p12-pg-*` cleaned after suite)

## Requirements / Governance

- Evidence: FND-04, FND-05
- `requirements-completed: []` (awaiting human approval — unchanged by R1)
- `requirements-evidenced: [FND-04, FND-05]`
- Plans human-approved executed remain **3/7** (`STATE.md` front matter `completed_plans: 3`)
- Phase 13 requirements complete remain **0/8**
- 13-04 is NOT human-approved
- 13-05..13-07: NOT AUTHORIZED
- Deploy: NOT AUTHORIZED

## P13-13-04-T3-R1

Human-review blockers closed with evidence-only changes (no migration/runtime/DDL edits):

| ID | Finding | Disposition |
|---|---|---|
| B13-04-T3-R1-01 | Exact post-CLI UNIQUE/CHECK DDL proof incomplete | CLOSED — catalog + behavioral |
| B13-04-T3-R1-02 | failed_retryable next_retry_at + 8/24h lifecycle proof incomplete | CLOSED — Cases A–E executed |
| B13-04-T3-R1-03 | Real PostgreSQL cleanup proof incomplete | CLOSED — full terminal matrix |
| B13-04-T3-R1-04 | STATE `completed_plans=4` vs 3/7 human-approved | CLOSED — front matter = 3 |

R1 authorized paths only: postgres.spec.ts, lifecycle.unit.spec.ts, 13-04-SUMMARY.md, STATE.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Version CHECKs missing from CLI DDL**
- **Found during:** Task 3 DDL review
- **Issue:** MikroORM emit included defaults for `hash_version`/`pepper_version`/`state_version` but not DB Model CHECKs
- **Fix:** Added table CHECKs in authorized migration file (no frozen model/service change)
- **Files modified:** `Migration20260809161242.ts`
- **Commit:** `21796e8`

**2. [Rule 1 - Bug] Partial unique index broke frozen ON CONFLICT**
- **Found during:** Task 3 disposable PG proof
- **Issue:** CLI unique index used `WHERE deleted_at IS NULL`; PostgreSQL rejected `ON CONFLICT (cols)` without matching predicate (frozen service)
- **Fix:** Non-partial unique index matching DB Model UNIQUE + frozen claim SQL
- **Files modified:** `Migration20260809161242.ts`
- **Commit:** `9d92a63`

**3. [Rule 1 - Bug] TypeScript build errors in Task 3 tests**
- **Found during:** required build gate
- **Issue:** overly narrow helper typing + dynamic import under node16 resolution
- **Fix:** `LifecycleClaimResult` typing; static import
- **Files modified:** postgres + lifecycle unit specs
- **Commit:** `19b0ff1`

**Total deviations:** 3 auto-fixed (1× Rule 2, 2× Rule 1)  
**Impact on plan:** Necessary for DB Model / frozen service / build correctness. No scope creep. No frozen-file edits.

R1 introduced no runtime/DDL deviation; evidence gaps only.

## Issues Encountered

- First disposable PG run failed on ON CONFLICT vs partial unique — fixed in authorized migration only (Task 3 provenance preserved).
- User-listed `guard.unit.spec.ts` / foundation paths differ from filesystem (`store-surface` / integration modules); correct factual paths used.
- R1 PG catalog proof: knex returns `json_agg` as parseable JSON; PostgreSQL rewrites state `IN` to `ANY(ARRAY[...])` — exact-set parser handles both.

## Self-Check: PASSED

- [x] Migration file exists: `Migration20260809161242.ts`
- [x] Postgres suite file exists
- [x] Lifecycle job + unit suite exist
- [x] Commits present: `21796e8`, `9d92a63`, `4618e24`, `895122a`, `16f2c75`, `19b0ff1`
- [x] Frozen files unchanged (migration/service/lifecycle/DB Model/package)
- [x] Build exit 0 / 0 TS errors
- [x] Status is technical-pass-awaiting-human-re-review (not human-approved-pass)
- [x] P13-13-04-T3-R1 evidence blockers closed; `completed_plans: 3`
)
