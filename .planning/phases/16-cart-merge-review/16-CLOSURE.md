---
phase: 16-cart-merge-review
artifact: closure
status: closed-human-approved
prepared_at: 2026-08-29
requirements_completed:
  - MRG-01
  - MRG-02
  - MRG-03
  - MRG-04
  - MRG-05
  - MRG-06
  - MRG-07
  - MRG-08
plans_completed: 14
human_review: approved
closure_gate: passed
closed_at: 2026-08-29
---

# Phase 16 Closure — Cart Merge & Review

## Identity

```text
Phase:
16 — Cart Merge & Review

Status:
HUMAN APPROVED — CLOSED — PASS

Closure date:
2026-08-29

Primary plans:
14/14 COMPLETE

Requirements:
MRG-01..MRG-08
8/8 COMPLETE
```

This artifact is the authoritative Phase 16 closure record. It materializes
an already-made human Product Owner decision. It does not rerun technical
gates, does not alter runtime, tests, OpenAPI, providers or remote
infrastructure, and does **not** authorize Phase 17.

## Human approval

```text
Human Phase 16 Review:
PASS

Human closure decision:
APPROVE PHASE 16 CLOSURE
```

```text
Phase 16:
HUMAN APPROVED — CLOSED — PASS

MRG-01..MRG-08:
HUMAN APPROVED — COMPLETE
```

Closure is human-approved. It is not an automatic documentary inference
from technical ledgers.

## Requirement closure

```text
MRG-01 COMPLETE
MRG-02 COMPLETE
MRG-03 COMPLETE
MRG-04 COMPLETE
MRG-05 COMPLETE
MRG-06 COMPLETE
MRG-07 COMPLETE
MRG-08 COMPLETE
```

| ID | Criterion (abbrev.) | Evidence mapping (abbrev.) | Status |
|---|---|---|---|
| MRG-01 | Replace simple attach as the principal contract with authenticated, transactional, idempotent merge. | Canonical `POST /store/customers/me/cart/merge` + `executeCartMerge`; HTTP `cart-merge-review.spec.ts`; PG `cart-merge-review.postgres.spec.ts` | COMPLETE |
| MRG-02 | Return exactly `MERGED`, `MERGED_PARTIAL`, `GUEST_CART_ATTACHED`, `CUSTOMER_CART_PRESERVED` or `NO_ITEMS`. | Five-outcome enum in `types.ts` / `decision.ts`; HTTP outcomes; `CUSTOMER_CART_PRESERVED` reserved; Store contract unit + OpenAPI | COMPLETE |
| MRG-03 | Sum quantities per variant up to 99 without duplicating items on retry. | Per-variant sum cap 99 in `decision.ts`; unit + HTTP partial 80+30→99; PG persist + replay no duplicate lines | COMPLETE |
| MRG-04 | Reject invalid/unavailable variants individually and preserve valid items in a partial merge. | Closed rejection reasons; partial preservation; HTTP/PG `MERGED_PARTIAL` + `rejected_items` | COMPLETE |
| MRG-05 | Full rollback on failure; consume/revoke capability only after successful commit. | Single transaction manager; failpoint rollbacks; capability consumed only after commit; eight-sink leakage | COMPLETE |
| MRG-06 | Persist `requiresReview`, rejected items and versioned acknowledgment. | `CartMergeResult` / `CartReview` models; pending/acknowledged; HTTP/PG review persistence | COMPLETE |
| MRG-07 | Block checkout while `requiresReview=true` and allow idempotent acknowledge. | `assertNoPendingCartReview` on line-item and payment-start; ACK CAS/idempotent; checkout Card/Pix `REVIEW_REQUIRED` | COMPLETE |
| MRG-08 | Controlled deprecation of `/store/customers/me/cart/attach` without silent removal or merge bypass. | Attach facade over `executeCartMerge`; OUTSIDE_FRONTEND_M1 PRESERVE_LEGACY excluded; native attach DENY; session-only 404 | COMPLETE |

## Plan inventory

Primary plans (serial count = 14; do not increment `total_plans`):

```text
16-01 COMPLETE
16-02 COMPLETE
16-03 COMPLETE
16-04 COMPLETE
16-05 COMPLETE
16-06 COMPLETE
16-07 COMPLETE
16-08 COMPLETE
16-09 COMPLETE
16-10 COMPLETE
16-11 COMPLETE
16-12 COMPLETE
16-13 COMPLETE
16-14 COMPLETE
```

```text
Primary plans:
14/14 COMPLETE
```

Remediation history (supporting artifacts, **not** additional serial-plan count):

```text
16-11-R1
16-11-R2
16-13-R1
```

## Final technical evidence

Authoritative accepted evidence reused from Plan 16-14 / Task 16-14-03.
Technical gates were **not** rerun for this documentary closure.

```text
Security / Leakage:
PASS

Order Authority / Zero Order:
PASS

Store Surface / Exact Set:
PASS

Repository Integrity:
PASS

Build:
PASS
0 TypeScript errors

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

Independent Task16-14-03 validator:
PASS

Human Phase 16 Review:
PASS

Final recommendation:
APPROVE PHASE 16 CLOSURE
```

Technical HEAD consumed by this closure:

`56fcefc6ffc7ce2f4685f151c75de0740f5ae5f8`

Authoritative Phase 16 BASE:

`c11823ae11d79b01d644df80f944b91ab75faf3d`

## OpenAPI

Recorded exactly; `openapi:check` / `openapi:generate` were **not** rerun
for this documentary closure.

```text
Store writer lifetime:
1

openapi:generate after Task 16-14-01:
0

openapi:check:
#1 FAIL
#2 PASS
#3 PASS
#4 PASS
#5 FAIL — clean-worktree precondition
#6 PASS
#7 NOT RUN / NOT AUTHORIZED

openapi:lint:
PASS
```

Hashes:

```text
Store:
7b28ac8b3b8174b2e546f504fd1d9ee725c02d2aa2dbbe53e1dfecf3afc5329c

Admin:
6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a

Webhooks:
47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4
```

## Order authority

```text
Merge:
0 Orders

Review ACK:
0 Orders

Attach adapter:
0 Orders

Line-item mutation:
0 Orders

Payment-start:
0 Orders

Conflict/replay/race paths:
0 Orders

Positive Order-birth authority:
canonical payment_intent.succeeded flow
```

Synchronous Phase-16 cart paths create zero Orders. Canonical
`payment_intent.succeeded` remains the sole accepted Order-birth authority.

## Surface authority

```text
Frontend M1 exact set:
14

BFF-protected exact set:
8

Deprecated attach:
OUTSIDE_FRONTEND_M1
PRESERVE_LEGACY
OpenAPI excluded
facade over canonical merge

Native attach:
DENY
OpenAPI excluded
```

Canonical merge `POST /store/customers/me/cart/merge` and review ACK
`POST /store/carts/{id}/review/acknowledge` are included in the Frontend M1
exact set. Native attach `POST /store/carts/{id}/customer` remains DENY and
OpenAPI-excluded.

## Historical blockers — MUST PRESERVE

These events are closed historical evidence. They are not erased by this
closure.

```text
Plan 16-13:
historical REVISE-CONTRACT

16-13-R1:
targeted remediation

Plan 16-13 final:
APPROVE-CONTRACT — CLOSED — PASS

B16-14-03-01:
native evidence fingerprint drift
CLOSED — PASS

B16-14-03-02:
stale API Docs expectations
CLOSED — PASS

B16-14-03-03:
stale HTTP fixtures
CLOSED — PASS

B16-14-03-04:
16 TypeScript errors
remediated to 0
CLOSED — PASS

B16-14-03-04-G1:
clean-worktree ordering issue
CLOSED — PASS

B16-14-03-04-G2:
wrong lint surface
CLOSED — PASS

B16-14-03-05:
BASE..HEAD trailing EOF whitespace
CLOSED — PASS
```

Historical `openapi:check` failures #1 and #5 remain recorded as FAIL.
`openapi:check` #7 remains NOT RUN / NOT AUTHORIZED.

## Counters after closure

```text
Phases:
4/10 closed

Requirements:
34/91 complete
57 open

Plans:
50/50 complete

Progress:
40%
```

```text
total_phases:
10

total_plans:
50

total_requirements:
91
```

Phase 16 primary plans were already included in `total_plans: 50`.
Remediations `16-11-R1`, `16-11-R2` and `16-13-R1` are not additional
serial plans.

Arithmetic:

```text
26 + 8 = 34 complete
91 - 34 = 57 open
34 + 57 = 91
36 + 14 = 50 plans
3 + 1 = 4 phases
```

## Next phase

```text
Next roadmap position:
Phase 17 — Authenticated BR Checkout & Privacy

Status:
NOT STARTED — NOT AUTHORIZED

Next permitted action:
Human decision on Phase 17 CONTEXT
```

Phase 16 closure does **not** authorize Phase 17 CONTEXT, RESEARCH, PLAN
or EXECUTION. Do not create `17-CONTEXT.md`, `17-RESEARCH.md` or
`17-PLAN.md` unless a future human prompt explicitly authorizes it.

```text
Phase 17 CONTEXT:
NOT AUTHORIZED

Phase 17 RESEARCH:
NOT AUTHORIZED

Phase 17 PLAN:
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED
```

## Global restrictions (preserved)

```text
Push:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Real providers:
NOT AUTHORIZED

Remote infrastructure:
NOT AUTHORIZED

Frontend:
BLOCKED
```

This documentary closure is Git-local. It does not push, deploy, contact
remote providers, or start Phase 17.
