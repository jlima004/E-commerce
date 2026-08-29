---
phase: 16-cart-merge-review
plan: 14
subsystem: cart-merge
tags: [cart-merge, openapi, ledger, review, attach, order-authority, leakage]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-13 HUMAN APPROVED — APPROVE-CONTRACT — PASS; Store registry approved for a single writer materialization."
provides:
  - "Store OpenAPI writer materialization exactly once from the approved registry."
  - "Task 16-14-02 PostgreSQL ledger remediations (timestamp serialization + MikroORM MetadataStorage isolation)."
  - "Task 16-14-03 remainder technical ledgers after sequential remediations B16-14-03-01..05."
  - "Documentary technical closeout of Plan 16-14 without closing MRG-01..MRG-08 or Phase 16."
affects: [Phase 16 human review, future storefront contract]

actuals:
  tokens: 9000
  tasks: 3
  technical_commits: 7

tech-stack:
  added: []
  patterns:
    - "Store OpenAPI writer lifetime = 1; openapi:check is read-only and never preceded by a writer in the same remainder."
    - "MRG-01..MRG-08 technical SATISFIED does not close global requirements; human/global reconciliation remains required."
    - "BASE for Phase 16 range review is PHASE16_BASE_COMMIT extracted from 16-01-SUMMARY.md, never inferred from HEAD."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-14-SUMMARY.md"
  modified:
    - "apps/backend/src/api-docs/generated/store.openapi.json"
    - "apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts"
    - "apps/backend/src/api/store/carts/serializers.ts"
    - "apps/backend/src/modules/cart-merge/review-guard.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"

key-decisions:
  - "Plan 16-14 technical execution: PASS."
  - "Task 16-14-03 technical ledger: PASS."
  - "Phase 16: HUMAN PHASE REVIEW REQUIRED."
  - "MRG-01..MRG-08: OPEN pending human/global reconciliation."
  - "Store writer lifetime remains 1; openapi:generate after Task 16-14-01 is 0; openapi:check #7 was not authorized and was not run."
  - "Historical gate failures are preserved: openapi:check #1 FAIL, #5 FAIL (clean-worktree precondition), G2 wrong lint surface, B16-14-03-01..04 remediations, B16-14-03-05 trailing EOF whitespace."

patterns-established:
  - "Final technical ledger reuses already-accepted global gates; remainder work does not rerun build/lint/unit/HTTP/modules/openapi:check."
  - "git diff --check BASE..HEAD is a Phase-wide integrity gate distinct from current-worktree git diff --check."

requirements-completed: []

coverage:
  - id: D1
    description: "Store OpenAPI materialized once by the approved writer; Admin/Webhooks byte-identical; hashes frozen."
    verification:
      - kind: other
        ref: "commit d132bcbc07614fcd60dc0d610130ae69b1e534d3; sha256 store/admin/webhooks frozen hashes"
        status: pass
    human_judgment: true
    rationale: "Writer output is accepted technical evidence; it does not close MRG-01..MRG-08 or Phase 16."
  - id: D2
    description: "PostgreSQL ledger remediations for timestamp serialization and MikroORM MetadataStorage isolation."
    verification:
      - kind: other
        ref: "commit 516eaacbdf4e1a9ea516d507f9891a496c92b3a8; historical Full Modules 64/64 916/916 PASS reused, not rerun in remainder"
        status: pass
    human_judgment: true
    rationale: "Task 16-14-02 PASS is reused evidence; global MRG rows remain OPEN."
  - id: D3
    description: "Security/leakage ledger PASS; Order-authority/zero-Order ledger PASS; Store surface/exact-set ledger PASS; repository integrity PASS after B16-14-03-05."
    verification:
      - kind: other
        ref: "Task 16-14-03 remainder subagents A–D; BASE..HEAD git diff --check PASS at HEAD 311e9611db7595fc4fe0dcfa93af35d791cc3d1e"
        status: pass
    human_judgment: true
    rationale: "Technical ledgers do not substitute human Phase 16 review."
  - id: D4
    description: "MRG-01..MRG-08 technical evidence SATISFIED for later human/global reconciliation."
    verification:
      - kind: other
        ref: "Subagent E mapping against 16-14-PLAN.md, runtime, focused suites, reused Full Unit/HTTP/Modules, OpenAPI, A/B/C/D ledgers"
        status: pass
    human_judgment: true
    rationale: "Technical SATISFIED is not requirement closure. MRG-01..MRG-08 remain OPEN."
  - id: D5
    description: "Plan 16-14 documentary technical closeout pending independent validator and human Phase 16 review."
    verification: []
    human_judgment: true
    rationale: "This SUMMARY records technical PASS only. Phase 16 remains IN PROGRESS — HUMAN PHASE REVIEW REQUIRED."

duration: not measured (remainder-only ledger after sequential remediations)
completed: 2026-08-29
status: technical-pass-awaiting-human-phase-review
---

# Plan 16-14 — Store OpenAPI materialization and final technical Phase 16 ledger

**Store writer ran once, sequential remediations closed historical blockers, and the remainder technical ledger is PASS. Phase 16 is not closed. MRG-01..MRG-08 remain OPEN.**

## Plan identity

```text
Plan:
16-14

Objective:
Materialize approved Store OpenAPI and execute final technical Phase16 ledger without automatically closing requirements or human gates.
```

```text
Plan16-14 technical execution:
PASS

Task16-14-03 technical ledger:
PASS

Phase16:
HUMAN PHASE REVIEW REQUIRED

MRG-01..MRG-08:
OPEN pending human/global reconciliation
```

This SUMMARY does **not** declare Phase 16 CLOSED, does **not** declare MRG-01..MRG-08 CLOSED, does **not** claim requirements complete, and does **not** claim human approval of Phase 16.

## Authoritative extraction

```text
BASE extraction source:
.planning/phases/16-cart-merge-review/16-01-SUMMARY.md field PHASE16_BASE_COMMIT

BASE:
c11823ae11d79b01d644df80f944b91ab75faf3d

Historical expected BASE:
c11823ae11d79b01d644df80f944b91ab75faf3d

BASE expected match:
YES

BASE exists:
PASS

BASE ancestor of HEAD:
PASS
```

## Task 16-14-01

```text
Store writer:
PASS

writer invocation lifetime:
1

commit:
d132bcbc07614fcd60dc0d610130ae69b1e534d3

Store generated hash:
7b28ac8b3b8174b2e546f504fd1d9ee725c02d2aa2dbbe53e1dfecf3afc5329c
```

Admin and Webhooks generated artifacts were not rewritten by the Store writer. Their frozen hashes remain:

```text
Admin:
6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a

Webhooks:
47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4
```

```text
openapi:generate after Task01:
0
```

No later remainder execution regenerated OpenAPI. Generated JSON was not edited manually.

## Task 16-14-02

```text
PASS

timestamp serialization remediation:
RESOLVED

MikroORM cross-realm MetadataStorage remediation:
RESOLVED

commit:
516eaacbdf4e1a9ea516d507f9891a496c92b3a8
```

Accepted PostgreSQL / modules evidence is **reused** and was **not rerun** in the Task 16-14-03 remainder:

```text
Historical Full Modules:
64/64 suites
916/916 tests
PASS
```

The 16-14-02 commit isolated test MetadataStorage (`apps/backend/integration-tests/helpers/mikro-orm-test-metadata.ts`) and stabilized timestamp serialization in `apps/backend/src/api/store/carts/serializers.ts`, with collateral test/contract updates. Disposable/local PostgreSQL remained the correctness authority; remote PostgreSQL was not contacted.

## Task 16-14-03 remainder — blocker history (preserved)

Task 16-14-03 was reopened remainder-only after R4 stopped at build. The following historical blockers and closures are authoritative and are not erased.

### B16-14-03-01

```text
native evidence fingerprint drift

remediation:
PASS

commit:
c276a9ec7a43aa2cbac220c313cc4e11073822d2
```

### B16-14-03-02

```text
stale API Docs expectations

remediation:
PASS

commit:
7b8de24ca3ea08aeb6baefa9d1f41bf6503fdd01
```

### B16-14-03-03

```text
stale HTTP fixtures/expectations

remediation:
PASS

commit:
444ded874e512b3b9a0471c5dae4853d130b8370
```

### B16-14-03-04

```text
Final build TypeScript diagnostics:
16 errors

5 independent root causes

6-file remediation

commit:
7916407dee1ac67a0c5174323ca3f593a2045bde

Build after remediation:
PASS
0 TypeScript errors

Independent remediation validator:
PASS
```

#### G1

```text
openapi:check #5 failed only because --require-clean saw authorized dirty remediation tree

process ordering corrected
```

#### G2

```text
root npm run lint was wrong lint surface

correct Plan lint:
cd apps/backend && npm run lint

correct lint result:
PASS
0 errors
482 warnings
```

Neither G1 nor G2 is hidden. Both are historical failures with recorded classification.

### B16-14-03-05

```text
BASE..HEAD git diff --check FAIL

apps/backend/src/modules/cart-merge/review-guard.ts:154
new blank line at EOF

HUMAN AUTHORIZED trailing EOF whitespace remediation

commit:
311e9611db7595fc4fe0dcfa93af35d791cc3d1e

message:
style(cart-merge): remove trailing EOF whitespace

scope:
1 file, 1 deletion, no logical change

BASE..HEAD git diff --check after remediation:
PASS
```

Current-worktree `git diff --check` was already PASS before this commit because the extra blank line was committed. The range check required the authorized one-line EOF normalization.

## Required global gate record

These gates were accepted earlier on the B16-14-03-04 lineage and **were not rerun** in the remainder after whitespace remediation:

```text
Focused API Docs:
3/3
217/217
PASS

Focused Payment:
1/1
33/33
PASS

Focused Line-item:
5/5
44/44
PASS

Build:
PASS
0 TS errors

openapi:check #6:
PASS

openapi:lint:
PASS

Correct Backend Lint:
PASS
0 errors
482 warnings

Full Unit:
104/104 suites
1902/1902 tests
1 snapshot
PASS

Full HTTP:
50/50 suites
682/682 tests
PASS

Historical Full Modules:
64/64 suites
916/916 tests
PASS
```

Remainder execution did **not** rerun `npm run build`, `npm run lint`, `npm run openapi:lint`, `npm run test:unit`, `npm run test:integration:http`, or `npm run test:integration:modules`.

## Required OpenAPI history

```text
#1 FAIL
#2 PASS
#3 PASS
#4 PASS
#5 FAIL — clean-worktree precondition
#6 PASS

#7:
NOT RUN
NOT AUTHORIZED

openapi:generate after Task01:
0

Store writer lifetime:
1
```

## Required final hashes

Verified after B16-14-03-05 at HEAD `311e9611db7595fc4fe0dcfa93af35d791cc3d1e`:

```text
Store:
7b28ac8b3b8174b2e546f504fd1d9ee725c02d2aa2dbbe53e1dfecf3afc5329c

Admin:
6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a

Webhooks:
47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4

Generated OpenAPI:
BYTE-IDENTICAL TO APPROVED POST-TASK01 MATERIALIZATION
```

## Security / Leakage

```text
Security / Leakage:
PASS
```

Subagent A (Grok 4.6) audited merge, review ACK, deprecated attach, guest capability, Customer cart authority, line-item mutation, card/Pix payment-start, and Store OpenAPI examples/schemas.

```text
JWT leakage:
NONE

Guest capability leakage:
NONE

Raw Idempotency-Key leakage:
NONE

BFF credential leakage:
NONE

Provider/payment secret leakage:
NONE

PII regression:
NONE
```

Concrete evidence includes:

- `apps/backend/src/api/store/customers/me/cart/merge/route.ts`
- `apps/backend/src/api/store/customers/me/cart/attach/route.ts`
- `apps/backend/src/api/store/carts/[id]/review/acknowledge/route.ts`
- `apps/backend/src/modules/cart-merge/service.ts`
- `apps/backend/src/modules/guest-cart-capability/service.ts`
- `apps/backend/src/modules/store-idempotency/service.ts`
- `apps/backend/src/api-docs/generated/store.openapi.json` (no `example` / `examples` keys; no secret values)
- `apps/backend/integration-tests/helpers/guest-cart-leakage.ts`
- `apps/backend/integration-tests/http/cart-merge-review.spec.ts` (C1–C6 eight-sink)

Capability and idempotency persist hashes only. Access logs record method/route/status/duration, not headers or bodies. Public cart projection remains the closed `PublicStoreCartPreOrder` shape, including masked federal tax id.

## Order Authority / Zero Order

```text
Order Authority / Zero Order:
PASS
```

Subagent B (Grok 4.6) confirmed Order delta = 0 on merge outcomes, replay, review ACK, stale If-Match, 409/412 conflicts, deprecated attach, native attach denial, guest and Customer line-item mutations, card/Pix payment-start, and race/conflict/replay paths.

```text
Merge creates Order:
NO

Review ACK creates Order:
NO

Attach adapter creates Order:
NO

Line-item mutation creates Order:
NO

Payment-start creates Order:
NO

Conflict/replay/race paths create Order:
NO

CUSTOMER_CART_PRESERVED:
reserved / enum-only / no positive branch

Positive Order birth authority:
payment_intent.succeeded canonical flow
PRESERVED
```

Concrete evidence includes:

- `apps/backend/src/api/hooks/stripe/route.ts` (`payment_intent.succeeded` only)
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/modules/cart-merge/service.ts` (no Order module create)
- `apps/backend/integration-tests/http/invariants-inv01-02-order-birth.spec.ts`
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts`
- `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts`

Remediations `516eaac`, `c276a9e`, `7b8de24`, `444ded8`, `7916407`, and `311e961` did not introduce a Phase 16 Order-create path.

## Store Surface / Exact Set

```text
Store Surface / Exact Set:
PASS
```

Subagent C (Composer 2.5) locked the exact sets against `apps/backend/src/api/store-surface/manifest.ts` and `apps/backend/src/api/store/carts/bff-protected-operations.ts`.

```text
Frontend M1 exact set:
14

BFF-protected exact set:
8

Canonical merge:
INCLUDED
POST /store/customers/me/cart/merge

Review ACK:
INCLUDED
POST /store/carts/{id}/review/acknowledge

Deprecated attach:
OUTSIDE_FRONTEND_M1
PRESERVE_LEGACY
disabled
OpenAPI excluded
compatibility facade over executeCartMerge
not a second merge engine

Native attach POST /store/carts/{id}/customer:
BLOCKED
DENY
OpenAPI excluded

Unexpected neighbor surfaces:
NONE

Swagger nonInteractive:
PRESERVED
```

Frontend M1 14:

1. `DELETE /store/carts/{id}/line-items`
2. `DELETE /store/carts/{id}/line-items/{line_id}`
3. `GET /store/carts/active`
4. `GET /store/customers/me`
5. `GET /store/customers/me/verify/status`
6. `POST /store/carts/active`
7. `POST /store/carts/{id}/line-items`
8. `POST /store/carts/{id}/line-items/{line_id}`
9. `POST /store/carts/{id}/review/acknowledge`
10. `POST /store/customers/me/cart/merge`
11. `POST /store/customers/me/password`
12. `POST /store/customers/me/verify`
13. `POST /store/customers/verify`
14. `POST /store/customers/verify/resend`

BFF-protected 8:

1. `GET /store/carts/active`
2. `POST /store/carts/active`
3. `POST /store/carts/:id/line-items`
4. `POST /store/carts/:id/line-items/:line_id`
5. `DELETE /store/carts/:id/line-items/:line_id`
6. `DELETE /store/carts/:id/line-items`
7. `POST /store/customers/me/cart/merge`
8. `POST /store/carts/:id/review/acknowledge`

Contract lock: `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts`.

## Repository Integrity

```text
Repository Integrity:
PASS
```

Subagent D rerun after B16-14-03-05 (Grok 4.6):

```text
HEAD at integrity rerun:
311e9611db7595fc4fe0dcfa93af35d791cc3d1e

Worktree:
CLEAN

Current git diff --check:
PASS

BASE..HEAD git diff --check:
PASS

STATE.md / ROADMAP.md / REQUIREMENTS.md:
UNCHANGED in BASE..HEAD

secrets in range:
NONE

deployment artifacts:
NONE

unexpected source outside Phase16 lineage:
NONE
```

The prior D BLOCKED finding (`review-guard.ts` extra EOF blank line) is closed by the authorized whitespace commit. OpenAPI hashes remain exact.

## MRG-01..MRG-08 Technical Evidence

```text
MRG-01..MRG-08 Technical Evidence:
PASS
```

Subagent E (Composer 2.5). Technical status is SATISFIED for later human review. **Human/global requirement status remains OPEN for all eight.**

| Requirement | Technical evidence (abbrev.) | Technical status | Human status |
|---|---|---|---|
| MRG-01 | Canonical `POST /store/customers/me/cart/merge` + `executeCartMerge` transactional/idempotent engine; HTTP `cart-merge-review.spec.ts`; PG `cart-merge-review.postgres.spec.ts` | SATISFIED | OPEN |
| MRG-02 | Five-outcome enum in `types.ts` / `decision.ts`; HTTP outcomes; `CUSTOMER_CART_PRESERVED` reserved; Store contract unit + OpenAPI | SATISFIED | OPEN |
| MRG-03 | Per-variant sum cap 99 in `decision.ts`; unit + HTTP partial 80+30→99; PG persist + replay no duplicate lines | SATISFIED | OPEN |
| MRG-04 | Closed rejection reasons; partial preservation; HTTP/PG `MERGED_PARTIAL` + `rejected_items` | SATISFIED | OPEN |
| MRG-05 | Single transaction manager; failpoint rollbacks; capability consumed only after commit; eight-sink leakage | SATISFIED | OPEN |
| MRG-06 | `CartMergeResult` / `CartReview` models; pending/acknowledged; HTTP/PG review persistence | SATISFIED | OPEN |
| MRG-07 | `assertNoPendingCartReview` on line-item and payment-start; ACK CAS/idempotent; checkout Card/Pix `REVIEW_REQUIRED` | SATISFIED | OPEN |
| MRG-08 | Attach facade over `executeCartMerge`; OUTSIDE_FRONTEND_M1 PRESERVE_LEGACY excluded; native attach DENY; session-only 404 | SATISFIED | OPEN |

This table is technical evidence mapping only. It does **not** close `REQUIREMENTS.md` counters.

## Task commits (technical)

1. **Task 16-14-01 Store writer** — `d132bcbc07614fcd60dc0d610130ae69b1e534d3` — `docs(api-docs): materialize approved phase 16 store contract`
2. **Task 16-14-02 PostgreSQL ledger** — `516eaacbdf4e1a9ea516d507f9891a496c92b3a8` — `fix(cart-merge): stabilize phase 16 postgres ledger`
3. **B16-14-03-01 fingerprints** — `c276a9ec7a43aa2cbac220c313cc4e11073822d2` — `fix(api-docs): refresh native evidence fingerprints`
4. **B16-14-03-02 API Docs expectations** — `7b8de24ca3ea08aeb6baefa9d1f41bf6503fdd01` — `test(api-docs): reconcile materialized Store contract expectations`
5. **B16-14-03-03 HTTP fixtures** — `444ded874e512b3b9a0471c5dae4853d130b8370` — `test(cart): reconcile phase 16 HTTP fixtures and expectations`
6. **B16-14-03-04 typing** — `7916407dee1ac67a0c5174323ca3f593a2045bde` — `fix(cart-merge): reconcile phase 16 build typing`
7. **B16-14-03-05 EOF whitespace** — `311e9611db7595fc4fe0dcfa93af35d791cc3d1e` — `style(cart-merge): remove trailing EOF whitespace`

The documentary commit of this file is separate from the technical list above.

## Deviations from Plan

Historical process deviations, all recorded rather than erased:

1. **openapi:check #1 FAIL** — first read-only check failed; later checks #2–#4 PASS.
2. **openapi:check #5 FAIL** — G1: `--require-clean` saw an authorized dirty remediation tree; process ordering corrected; #6 PASS.
3. **G2 wrong lint surface** — root `npm run lint` was not the Plan lint; correct surface `cd apps/backend && npm run lint` PASS 0 errors / 482 warnings.
4. **R4 remainder stop** — build typing diagnostics blocked the original remainder; B16-14-03-04 remediated 16 TypeScript errors to 0.
5. **Remainder D BLOCKED** — BASE..HEAD `git diff --check` failed on trailing EOF whitespace in `review-guard.ts`; B16-14-03-05 human-authorized one-line fix; D rerun PASS.

**Total deviations:** 5 historical process/blocker events, all closed or classified. **Impact:** no requirement closure, no OpenAPI regeneration after Task 01, no push/deploy.

## Issues Encountered

See blocker history B16-14-03-01..05 and OpenAPI/G1/G2 records above. No new functional, contractual, or security regression was identified in the remainder ledgers.

## User Setup Required

None — no external service configuration required. Remote PostgreSQL, Redis, Stripe, Gelato, Resend, PostHog, Sentry, Heroku, and Vercel were not contacted.

## Next Phase Readiness

```text
Task 16-14-03:
TECHNICAL PASS — COMPLETED

Plan 16-14:
TECHNICAL PASS — COMPLETED

Phase 16:
IN PROGRESS — HUMAN PHASE REVIEW REQUIRED

MRG-01..MRG-08:
OPEN — HUMAN/GLOBAL RECONCILIATION REQUIRED

Push:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Next permitted action:
HUMAN PHASE 16 REVIEW
```

This SUMMARY does not auto-authorize Phase 16 closure work, STATE/ROADMAP/REQUIREMENTS edits, push, deploy, or Plan 17+.

## Governance

- `.planning/STATE.md`: UNCHANGED by this remainder
- `.planning/ROADMAP.md`: UNCHANGED by this remainder
- `.planning/REQUIREMENTS.md`: UNCHANGED by this remainder
- MRG-01..MRG-08: OPEN
- Phase 16: IN PROGRESS — HUMAN PHASE REVIEW REQUIRED
