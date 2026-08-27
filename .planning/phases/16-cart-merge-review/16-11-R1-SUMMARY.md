---
phase: 16-cart-merge-review
plan: 11
remediation: R1
subsystem: cart-merge
tags: [cart-merge, exact-set, bff, manifest, leakage, native-deny, preserve-legacy, remediation]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-11 TECHNICAL PASS (historical 16-11-SUMMARY.md); human review flagged B16-11-HR-01..03 and W16-11-HR-01."
provides:
  - "Attach reclassified OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY; owner_phase 16; not in M1 exact-set."
  - "Eight-sink leakage 8/8 exact with zero-call spies for unused paths; full OpenAPI scan (not first-4096 truncation)."
  - "Collateral store-surface/BFF/manifest counts reconciled; attach PRESERVE_LEGACY assertion retained."
  - "Human review findings B16-11-HR-01..03 and W16-11-HR-01 RESOLVED at technical level."
affects: [phase-16-cart-merge-review, plan-16-12]

actuals:
  tokens: 5200
  tasks: 3
  technical_commits: 3
  docs_commit: this-file

tech-stack:
  added: []
  patterns:
    - "ATTACH OUTSIDE_FRONTEND_M1: classification OUTSIDE_FRONTEND_M1, runtime_policy PRESERVE_LEGACY, owner_phase 16, M1 disabled/excluded."
    - "EIGHT-SINK LEAKAGE 8/8: exact registered set; unused sinks proven via zero-call spies (no {exercised:false})."
    - "OPENAPI LEAKAGE: full store.openapi.json scanned (raw + parsed), not first 4096 bytes."
    - "M1 EXACT-SET: Phase 16 additions ONLY merge + ACK; attach NOT in BFF tuple (still 8 = Phase 15 six + merge + ACK)."
    - "NATIVE DENY: POST /store/carts/{id}/customer DENY/non-enumerating; unknown aliases/prefix neighbors DENY."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-11-R1-SUMMARY.md"
  modified:
    - "apps/backend/src/api/store-surface/manifest.ts"
    - "apps/backend/src/api/middlewares.ts"
    - "apps/backend/src/api-docs/coverage/exclusions.ts"
    - "apps/backend/src/api-docs/coverage/verify-coverage.ts"
    - "apps/backend/scripts/store-surface/scan-installed.ts"
    - "apps/backend/src/api-docs/operations/store/customers.ts"
    - "apps/backend/integration-tests/helpers/guest-cart-leakage.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"

key-decisions:
  - "Attach OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY; removal trigger future explicit HUMAN GATE (no invented date); session fallback NONE; second attach engine NONE."
  - "BFF guard prepended on attach matcher; attach NOT in BFF tuple; M1 total 14 (Phase 14 six + Phase 15 six + Phase 16 two)."
  - "Eight sinks exact 8/8; unused paths proven zero-call (LOGGER, Sentry, analytics, redis, native C7–C8) — no {exercised:false} on Phase 16 closeout."
  - "Merge/ACK M1_ENABLED in manifest but NOT in Store OpenAPI registry — Plan 16-12 owns registration; do not claim documented."
  - "Plan 16-12, push e deploy permanecem NOT AUTHORIZED; este SUMMARY não auto-autoriza Plan 16-12."

patterns-established:
  - "PRESERVE_LEGACY attach facade delegates to executeCartMerge; reachable behind controlled exclusion, not M1 exact-set."
  - "Leakage helper: full-document OpenAPI scan + zero-call spy evidence for unused sinks."
  - "Collateral contract reconciliation: manifest counts, BFF tuple, attach assertions aligned post-R1."

coverage:
  - id: R1-D1
    description: "B16-11-HR-01 RESOLVED — attach OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY, owner_phase 16, not in M1."
    verification:
      - kind: integration
        ref: "store-surface-lockdown 9/9 PASS; guest-cart-native-deny PRESERVE_LEGACY assertion"
        status: pass
    human_judgment: false
  - id: R1-D2
    description: "B16-11-HR-02 RESOLVED — eight sinks 8/8 exact; unusedSinkEvidence zero-call spies; full OpenAPI scan."
    verification:
      - kind: integration
        ref: "cart-merge-review + guest-cart-native-deny — 97/97 PASS"
        status: pass
    human_judgment: false
  - id: R1-D3
    description: "B16-11-HR-03 RESOLVED — collateral counts/BFF/attach assertions updated."
    verification:
      - kind: unit
        ref: "store-foundation-final 7/7; guest-cart-bff-guard 5/5; guest-cart-contract-matrix SSOT exact-set PASSED"
        status: pass
    human_judgment: false
  - id: R1-D4
    description: "W16-11-HR-01 RESOLVED — OpenAPI full document scan; canary past byte 4096 detected in unit proof."
    verification:
      - kind: unit
        ref: "guest-cart-leakage OpenAPI canary unit proof"
        status: pass
    human_judgment: false
  - id: R1-D5
    description: "Plan 16-11 human re-review after R1 TECHNICAL PASS."
    verification: []
    human_judgment: true
    rationale: "R1 technical remediation PASS does not substitute human re-review of exact-set/leakage evidence nor authorize Plan 16-12, push or deploy."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-11 R1 Summary

**Remediation R1 for human-review findings on Plan 16-11: attach reclassified OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY, eight-sink leakage 8/8 with zero-call unused-path proof, full OpenAPI scan, collateral contract reconciliation — merge/ACK remain M1 exact-set; native denial intact; Order delta zero.**

> **Historical reference:** `16-11-SUMMARY.md` preserved as original Plan 16-11 TECHNICAL PASS evidence. This document records **R1 corrective remediation** only.

## Status

| Gate | State |
|------|-------|
| **Plan 16-11 R1 technical remediation** | **TECHNICAL PASS** |
| **Plan 16-11 human closure** | **PENDING HUMAN RE-REVIEW** |
| **Plan 16-10** | **HUMAN APPROVED — CLOSED — PASS** (não reaberto; 16-10-SUMMARY.md não editado) |
| **MRG-01** | **EVIDENCE COMPLETE FOR PLAN 16-11** (R1 collateral reconciled) |
| **MRG-02** | **EVIDENCE COMPLETE FOR PLAN 16-11** (attach PRESERVE_LEGACY proven) |
| **MRG-05** | **EVIDENCE COMPLETE FOR PLAN 16-11** (8/8 sinks exact) |
| **MRG-08** | **EVIDENCE COMPLETE FOR PLAN 16-11** (Order delta 0 C1–C8) |
| **MRG-01..MRG-08** | **OPEN / GLOBAL RECONCILIATION PENDING** |
| **Phase 16** | **IN PROGRESS** |
| **Plan 16-12** | **NOT AUTHORIZED** |
| **Push** | **NOT PERFORMED / NOT AUTHORIZED** |
| **Deploy** | **NOT PERFORMED / NOT AUTHORIZED** |
| **STATE, ROADMAP e counters** | **NOT UPDATED** |

Este documento registra **Plan 16-11 R1: TECHNICAL PASS**. Não registra Plan 16-11 CLOSED. Não declara aprovação humana.

## Execution

| Field | Value |
|-------|-------|
| **Environment** | Cursor |
| **Orchestrator** | Grok 4.6 |
| **Subagents used** | YES |
| **Mode** | Sequential, except independent read-only designs (B+D parallel) and independent test vs review (G+H parallel) |

### Subagent roster

| ID | Name | Model | Task |
|----|------|-------|------|
| A | Preflight/baseline | Grok 4.6 | git/SSOT/leakage/collateral map; no edits |
| B | Surface contract design | Grok 4.6 | attach PRESERVE_LEGACY design; no edits |
| C | Surface implementation | Composer 2.5 fast | manifest/middleware/exclusions/collateral |
| D | Leakage proof design | Grok 4.6 | 8/8 design; no edits |
| E | Leakage implementation | Composer 2.5 fast | helper + merge/native/postgres 8/8 |
| E2 | Unused-sink follow-up | Composer 2.5 fast | replace remaining `{exercised:false}` with zero-call spies |
| F | Focused validation | Grok 4.6 | independent HTTP/PG/unit; flagged HR-02 native deny sentinels |
| G | Regression validator | Grok 4.6 | full unit + contract suites; piecewise OpenAPI workaround |
| H | Security/diff reviewer | Grok 4.6 | complete R1 diff; **OVERALL PASS** |
| I | Summary writer | Composer 2.5 fast | this document |
| J | Independent final validator | Grok 4.6 | runs AFTER this file exists |

## Human review findings (R1 resolution)

| ID | Severity | Status | Resolution |
|----|----------|--------|------------|
| **B16-11-HR-01** | CRITICAL | **RESOLVED** | Attach reclassified **OUTSIDE_FRONTEND_M1** + **PRESERVE_LEGACY**; `owner_phase` 16; not in M1 exact-set |
| **B16-11-HR-02** | HIGH | **RESOLVED** (after E2) | Exact 8/8 sinks; `unusedSinkEvidence` zero-call spies; full OpenAPI scan; no `{exercised:false}` on Phase 16 closeout |
| **B16-11-HR-03** | HIGH | **RESOLVED** | Collateral counts/BFF/attach assertions updated |
| **W16-11-HR-01** | LOW | **RESOLVED** | Was OpenAPI first-4096 truncation; now full document scan + unit proof a canary past byte 4096 is detected |

## Objective / outcome

Remediar achados de revisão humana do Plan 16-11 sem reabrir Plan 16-10 nem iniciar Plan 16-12. Attach preservado como facade deprecated fora do M1 exact-set com política PRESERVE_LEGACY; merge e ACK permanecem as únicas adições Phase 16 no M1. Prova eight-sink 8/8 exact com evidência zero-call para sinks não exercitados. Contratos colaterais de store-surface reconciliados com contagens pós-R1.

## Runtime changes consolidated

Baseline R1 start: `f4d95d8` — `docs(cart-merge): record plan 16-11 surface security evidence` (historical 16-11 commits `5dfbede` / `565e6ac` preserved; do not amend).

### Corrective commits (after historical 16-11)

| SHA | Message |
|-----|---------|
| `00654cb69f473b278317fe2b5790d784bc9cd35f` | `fix(store-surface): preserve deprecated phase 16 attach facade` |
| `069971a559b913d731b516650fdb5ef220ec4856` | `test(cart-merge): close eight-sink leakage evidence` |
| `41bc8caa2a5306d558f5f6f0af0498e99ae5c3c0` | `test(store-surface): reconcile phase 16 collateral contracts` |
| (this file) | `docs(cart-merge): record plan 16-11 R1 remediation` |

**Worktree before this file:** CLEAN at `41bc8ca`. Docs commit created after write.

### Files changed (R1)

Production / SSOT:
- `apps/backend/src/api/store-surface/manifest.ts` — attach OUTSIDE_FRONTEND_M1 + PRESERVE_LEGACY; validator BLOCKED=16 / OUTSIDE=32
- `apps/backend/src/api/middlewares.ts` — BFF guard prepended on attach matcher only; attach NOT in BFF tuple
- `apps/backend/src/api-docs/coverage/exclusions.ts` — attach exclusion reason aligned (HUMAN GATE, no invented date)
- `apps/backend/src/api-docs/coverage/verify-coverage.ts` — `STORE_RUNTIME_EXACT_SET` `{ native: 51, local: 15, total: 66 }`
- `apps/backend/scripts/store-surface/scan-installed.ts` — installed count 66 / local 15
- `apps/backend/src/api-docs/operations/store/customers.ts` — comment: attach excluded deprecated facade

Leakage:
- `apps/backend/integration-tests/helpers/guest-cart-leakage.ts` — exact 8/8 closeout; unusedSinkEvidence; full OpenAPI scan
- `apps/backend/integration-tests/http/cart-merge-review.spec.ts` — C1–C6 eight-sink recorder + spies
- `apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts` — C7–C8 8/8 + attach PRESERVE_LEGACY
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` — C1–C8 Order delta 0 + 8/8
- `apps/backend/src/modules/guest-cart-capability/__tests__/guest-cart-validation-foundation.unit.spec.ts` — strict helper unit tests

Collateral contracts:
- `apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts`
- `apps/backend/src/api/store-surface/__tests__/guard.unit.spec.ts`
- `apps/backend/src/api/store/carts/__tests__/bff-protected-operations.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts`
- `apps/backend/integration-tests/helpers/guest-cart-exact-set.ts`
- `apps/backend/integration-tests/http/guest-cart-bff-guard.spec.ts`
- `apps/backend/integration-tests/http/store-surface-lockdown.spec.ts`
- `apps/backend/integration-tests/http/store-foundation-final.spec.ts`
- `apps/backend/integration-tests/http/guest-cart-contract-matrix.spec.ts`
- `apps/backend/integration-tests/http/cart-checkout-store.spec.ts`
- `apps/backend/src/modules/checkout-completion/__tests__/store-order-birth-canonical.postgres.spec.ts`

Unchanged (already correct on 16-11 HEAD): `apps/backend/src/api/store/carts/bff-protected-operations.ts` (tuple length 8; attach absent).

## Architecture

```
M1 EXACT-SET — Phase 16 additions ONLY
├── POST /store/customers/me/cart/merge          → M1_ENABLED owner Phase 16
└── POST /store/carts/:id/review/acknowledge     → M1_ENABLED owner Phase 16
Unexpected additions: NONE
Prefix authorization: NONE

OUTSIDE M1 — ATTACH
└── POST /store/customers/me/cart/attach
    classification: OUTSIDE_FRONTEND_M1
    runtime_policy: PRESERVE_LEGACY
    owner_phase: 16
    M1: disabled / exclude / NOT in exact-set
    removal trigger: future explicit HUMAN GATE (no invented date)
    session fallback: NONE
    second attach engine: NONE (delegates to executeCartMerge)
    BFF: guard prepended on attach matcher; attach NOT in BFF tuple

M1 TOTALS
├── Phase 14: 6
├── Phase 15: 6
├── Phase 16: 2
└── M1 total: 14

MANIFEST COUNTS (after R1)
├── total: 66
├── BLOCKED: 16
├── OUTSIDE: 32
├── DENY: 46
├── PRESERVE_LEGACY: 6
├── M1: 14
├── local: 15
└── native-like: 51

NATIVE DENY
├── POST /store/carts/{id}/customer    → DENY / 404 non-enumerating
└── unknown aliases / prefix neighbors → DENY / NON-ENUMERATING

BFF TUPLE: 6 Phase 15 + merge + ACK = 8 (attach excluded)
Auth: Customer bearer on merge/ACK; merge bearer-only
Attach authenticate: session|bearer (16-10 leftover, reachable behind PRESERVE_LEGACY)
Capability: merge/adapter only; ACK does not require capability
```

### Known coupling (not Plan 16-12 start)

Merge e ACK são **M1_ENABLED** no manifest mas **NOT** no Store OpenAPI registry/document. Testes assertam que são undocumented. `verifyStoreSurfaceExactSets` não é usado como happy-path gate. **Plan 16-12** owns registration. Não claim merge/ACK documented.

Attach `authenticate` ainda lista `session|bearer` (16-10 leftover agora reachable behind PRESERVE_LEGACY). Session-only sem new-contract fields ainda 404s. Merge permanece bearer-only. Nota humana opcional, não stop.

## Eight sinks (exact 8/8)

**Registered sinks:** 8/8 — **missing:** NONE — **unexpected:** NONE

| # | Sink | Phase 16 closeout evidence |
|---|------|---------------------------|
| 1 | `db_plaintext` | **NO LEAK** — merge/postgres table/in-memory rows scanned; native C7–C8 **NOT USED — PROVEN ZERO CALL** (next=0, scope.resolve=0, Modules.ORDER=0) |
| 2 | `redis_keys_jobs` | **NOT USED — PROVEN ZERO CALL/RESOLUTION** (cache/event_bus/workflow_engine/locking resolve counts 0) |
| 3 | `logs` | **NO LEAK** — merge boot.logEntries scanned; native/postgres unused path **NOT USED — PROVEN ZERO CALL** (LOGGER resolve 0 + console spy deltas 0) |
| 4 | `sentry` | **NOT USED — PROVEN ZERO CALL** (captureException/captureMessage 0) |
| 5 | `openapi` | **NO LEAK** — full `store.openapi.json` scanned (raw + parsed), not first 4096 bytes |
| 6 | `fixtures_snapshots` | **NO LEAK** — bodies/headers/reviewRef/error envelopes |
| 7 | `analytics` | **NOT USED — PROVEN ZERO CALL** (ANALYTICS_EVENT_LOG_MODULE resolve 0) |
| 8 | `persisted_provider_payload` | **NO LEAK** — workflow mock call counts scanned; native next/resolve 0 |

### Secret classes and leakage surfaces

- **Secret classes:** `guest_capability`, `customer_jwt`, `raw_idempotency_key`
- **Failure output:** **SANITIZED** (`sink=` and `secret_class=` only)
- **reviewRef/ETag/fingerprint:** no reversible encoding (raw/base64/base64url/hex/URI). HMAC/SHA256 one-way hashes of secrets in DB are **NOT** treated as leaks.

## Verification matrix

### HTTP focused

```bash
cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts integration-tests/http/guest-cart-native-deny.spec.ts
```

| Metric | Result |
|--------|--------|
| Test Suites | 2 passed / 2 |
| Tests | 97 passed / 97 |
| Failed | 0 |
| Skipped | 0 |
| Exit | 0 |

**Delta vs historical 16-11 baseline:** 98/98 → 97/97 (−1). Legitimate: attach removed from `nativeDenyOperations` `it.each` after reclass; dedicated PRESERVE_LEGACY assertion remains. Not a dropped case without replacement.

### PostgreSQL Order authority (disposable local)

```bash
cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts
```

| Metric | Result |
|--------|--------|
| PostgreSQL | DISPOSABLE LOCAL (mode=docker host=127.0.0.1) |
| Docker | USED |
| Test Suites | 1 passed / 1 |
| Tests | 26 passed / 26 (≥ previous 26) |
| Failed | 0 |
| Skipped | 0 |
| Exit | 0 |
| Order authority | REAL SQL `select count(*)::int as count from "order"` |
| Order delta | 0 for C1–C8 |

Re-run AFTER unused-sink fix (E2): same 26/26 PASS (target `p12_disposable_2b45c469a5efcd8d`).

### Full unit

```bash
cd apps/backend && npm run test:unit
```

| Metric | Result |
|--------|--------|
| Suites | 103 passed / 1 failed / 104 total |
| Tests | 1888 passed / 2 failed / 1890 total |

The 1 failed suite is **PRE-EXISTING** native fingerprint drift in `native-extensions.unit.spec.ts` (would fail on historical HEAD `f4d95d8` because 16-11 `middlewares.ts` changed without fingerprint refresh). **Not R1-causal** remaining defect. R1 SSOT unit files all passed.

### Additional contract suites

| Suite | Result |
|-------|--------|
| `store-surface-lockdown` | 9/9 PASS |
| `store-foundation-final` | 7/7 PASS |
| `guest-cart-bff-guard` | 5/5 PASS |
| `guest-cart-contract-matrix` | SSOT exact-set PASSED; 2 handler-harness failures **PRE-EXISTING** (`createScope` missing since 16-07; unchanged vs `f4d95d8`) |

### git diff --check

**PASS**

## Security / threat model invariants

- **Eight-sink leakage:** ZERO for `guest_capability`, `customer_jwt`, `raw_idempotency_key` across merge, adapter, replay, conflict and denial paths.
- **Unused sinks:** proven via zero-call spies — no `{exercised:false}` placeholders on Phase 16 closeout.
- **OpenAPI:** full document scan; canary past byte 4096 detected in unit proof (W16-11-HR-01).
- **Native denial:** POST `/store/carts/{id}/customer` and unknown aliases/prefix neighbors DENY/non-enumerating.
- **Attach:** PRESERVE_LEGACY facade delegates to `executeCartMerge`; no second attach engine; no session fallback.
- **Order authority:** delta 0 for adapter/native/session/denial paths C1–C8 via real SQL.
- **Security/diff reviewer (H):** complete R1 diff — **OVERALL PASS**.

## Requirements

- **MRG-01:** **EVIDENCE COMPLETE FOR PLAN 16-11** (R1 collateral reconciled)
- **MRG-02:** **EVIDENCE COMPLETE FOR PLAN 16-11** (attach PRESERVE_LEGACY proven)
- **MRG-05:** **EVIDENCE COMPLETE FOR PLAN 16-11** (8/8 sinks exact)
- **MRG-08:** **EVIDENCE COMPLETE FOR PLAN 16-11** (Order delta 0)

`requirements-completed` permanece `[]`. MRG-01..MRG-08 permanecem **OPEN / GLOBAL RECONCILIATION PENDING**.

## Deviations from R1 plan

None material. R1 executed per authorized scope. Historical 16-11 commits (`5dfbede`, `565e6ac`, `f4d95d8`) not amended.

## Issues encountered

- **HR-02 native deny sentinels** flagged during focused validation (F); resolved by E2 unused-sink follow-up.
- **HTTP test count −1** vs 16-11 baseline: intentional reclass of attach from native-deny `it.each` to dedicated PRESERVE_LEGACY assertion.

## User setup required

None.

## Remaining gates

```
Plan 16-11 R1 technical remediation: TECHNICAL PASS
Plan 16-11 human closure:           PENDING HUMAN RE-REVIEW
Plan 16-12:                         NOT AUTHORIZED
Phase 16:                           IN PROGRESS
Push:                               NOT PERFORMED / NOT AUTHORIZED
Deploy:                             NOT PERFORMED / NOT AUTHORIZED
```

**Next permitted action:** **HUMAN RE-REVIEW OF PLAN 16-11**

Do not auto-authorize Plan 16-12.

---
*Phase: 16-cart-merge-review*
*Plan: 16-11 R1*
*Technical remediation: PASS; human re-review pending*
*Independent final validator (J): pending — runs after this file exists*
