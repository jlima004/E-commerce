---
phase: 16-cart-merge-review
plan: 11
remediation: R2
subsystem: cart-merge
tags: [cart-merge, attach, bearer-only, session-deny, preserve-legacy, remediation]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-11 R1 TECHNICAL PASS (16-11-R1-SUMMARY.md); human re-review flagged B16-11-R1-HR-04..06."
provides:
  - "Deprecated attach requires Customer bearer ONLY; session cannot substitute even with a fully formed new-contract request."
  - "cart-checkout-store.spec.ts no longer asserts the retired session attach engine."
  - "Independent validator J EXECUTED — PASS after this SUMMARY existed; HR-06 closed without claiming J PASS before execution."
affects: [phase-16-cart-merge-review]

actuals:
  tokens: 4800
  tasks: 3
  technical_commits: 3
  docs_commit: this-file

tech-stack:
  added: []
  patterns:
    - "ATTACH AUTH: BFF + authenticate(customer, [bearer]) only; session.auth_context is not attach authority."
    - "FULL-CONTRACT SESSION BYPASS: valid BFF + valid session + guestCartId + capability + Idempotency-Key + If-Match without Authorization is denied at authenticate middleware before executeCartMerge."
    - "ATTACH ENGINE: executeCartMerge ONLY; no transferCartCustomerWorkflowId / updateCartWorkflowId on the public attach route."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-11-R2-SUMMARY.md"
  modified:
    - "apps/backend/src/api/middlewares.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts"
    - "apps/backend/integration-tests/http/cart-checkout-store.spec.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"

key-decisions:
  - "Middleware-only enforcement is sufficient: Medusa authenticate skips session unless authTypes includes session; attach handler never reads session for identity."
  - "Medusa authenticate deny is 401 Unauthorized (same as merge/ACK). Handler is not reached."
  - "PostgreSQL full-contract session proof invokes the production authenticate middleware, not the attach handler."
  - "16-11-R1-SUMMARY.md left unchanged as historical R1 evidence, including the documented J-pending contradiction that R2 closes."
  - "Plan 16-12, push e deploy permanecem NOT AUTHORIZED."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-11 R2 Summary

**Remediation R2 for human re-review of R1: attach Customer auth is bearer-only; full-contract session substitution is denied at middleware; cart-checkout-store no longer owns the retired session attach engine; independent validator J EXECUTED — PASS.**

> **Historical reference:** `16-11-SUMMARY.md` and `16-11-R1-SUMMARY.md` are preserved. This document records **R2 corrective remediation** only. R1 SUMMARY is not rewritten; the R1 “J pending” vs TECHNICAL PASS contradiction is superseded here.

## Status

| Gate | State |
|------|-------|
| **Plan 16-11 R2 technical remediation** | **TECHNICAL PASS** |
| **Plan 16-11 human closure** | **PENDING HUMAN RE-REVIEW** |
| **B16-11-HR-01** | **RESOLVED** (R1; no R2 regression) |
| **B16-11-HR-02** | **RESOLVED** (R1; no R2 regression) |
| **W16-11-HR-01** | **RESOLVED** (R1; no R2 regression) |
| **B16-11-R1-HR-04** | **RESOLVED** |
| **B16-11-R1-HR-05** | **RESOLVED** |
| **B16-11-R1-HR-06** | **RESOLVED** — J2 EXECUTED — PASS after this file existed |
| **MRG-01..MRG-08** | **OPEN / GLOBAL RECONCILIATION PENDING** |
| **Phase 16** | **IN PROGRESS** |
| **Plan 16-12** | **NOT AUTHORIZED** |
| **Push** | **NOT PERFORMED / NOT AUTHORIZED** |
| **Deploy** | **NOT PERFORMED / NOT AUTHORIZED** |
| **STATE, ROADMAP e counters** | **NOT UPDATED** |

Este documento **não** declara Plan 16-11 HUMAN APPROVED e **não** auto-autoriza Plan 16-12.

## Execution environment

| Field | Value |
|-------|-------|
| **Environment** | Cursor |
| **Orchestrator** | Grok 4.6 |
| **Subagents used** | YES |
| **Subagent execution mode** | Read-only A/B/D in parallel; implementation C/E in parallel; orchestrator ran focused/regression gates; I security review + J after this file |

### Actual subagent / model / task mapping

| ID | Name | Model | Task |
|----|------|-------|------|
| A | R2 preflight | Grok 4.6 | Read-only baseline; HR-04/05/06 causal map |
| B | Auth boundary design | Grok 4.6 | Medusa authenticate bearer-only is sufficient; no handler change |
| C | Auth implementation | Composer 2.5 fast | Attach bearer-only middleware + session full-contract tests |
| D | Legacy collateral audit | Grok 4.6 | Classify cart-checkout-store attach tests KEEP/REMOVE/REWRITE |
| E | Collateral implementation | Composer 2.5 fast | Remove/rewrite legacy attach engine tests |
| F | Focused HTTP validator | Grok 4.6 (orchestrator) | cart-merge-review + guest-cart-native-deny + cart-checkout-store |
| G | PostgreSQL / zero-Order | Grok 4.6 (orchestrator) | Disposable Docker Postgres C1–C8 + full-contract session case |
| H | Regression validator | Grok 4.6 (orchestrator) | Full unit + surface/BFF/contract suites |
| I | Security/diff review | Grok 4.6 | Full R2 diff vs `e91c48c` |
| J1 | Summary writer | Grok 4.6 (orchestrator) | this file; initial write marked J PENDING |
| J2 | Independent final validator | Grok 4.6 | EXECUTED — PASS after this file existed |

## R2 baseline and commits

**R2 baseline SHA:** `e91c48c501c6eaa57285fccf11a0774f48dbe7e7` — `docs(cart-merge): record plan 16-11 R1 remediation`

Historical Plan 16-11 commits preserved: `5dfbede` / `565e6ac` / `f4d95d8`.
R1 commits preserved: `00654cb` / `069971a` / `41bc8ca` / `e91c48c`.
No amend, squash, reset, or rewrite.

### R2 corrective commits

| SHA | Message |
|-----|---------|
| `54599d653054174e83dfdd9afaefb4c325dd81af` | `fix(cart-merge): require bearer authority for deprecated attach` |
| `b56609c127704272f538ab3f39acd307de9bf3bc` | `test(cart-merge): remove legacy session attach contract` |
| `68e529f6396e9e9b81319b79a16330b172b7a6c6` | `test(cart-merge): prove bearer-only adapter and zero-order` |
| (this file) | `docs(cart-merge): record plan 16-11 R2 remediation` |

### Files changed

Production:

- `apps/backend/src/api/middlewares.ts` — attach `authenticate("customer", ["bearer"])` only

Tests:

- `apps/backend/integration-tests/http/cart-merge-review.spec.ts` — full-contract session middleware deny + static attach proofs
- `apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts` — attach tuple length 4 (BFF + bearer + preorder)
- `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` — remove retired session attach engine
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` — middleware-level Order delta 0

No handler change. `attach/route.ts` remains `executeCartMerge` only.

## Findings

| ID | Severity | Status | Resolution |
|----|----------|--------|------------|
| **B16-11-R1-HR-04** | CRITICAL | **RESOLVED** | Attach matcher is Customer bearer-only. Full-contract session request (valid BFF + valid `session.auth_context` + guestCartId + capability + Idempotency-Key + If-Match, **no Authorization**) is denied at production authenticate middleware: `next()` not called, 401, `executeCartMerge` = 0 |
| **B16-11-R1-HR-05** | HIGH | **RESOLVED** | Six legacy attach-engine tests and the session `invokeAttachRoute` workflowRun proof removed from `cart-checkout-store.spec.ts`. Pre-Order body proof kept for guest GET active cart only |
| **B16-11-R1-HR-06** | MEDIUM | **RESOLVED** | Initial SUMMARY marked J PENDING; J2 then executed against committed source, tests, results, and this file — **PASS**. R1 SUMMARY left unchanged as historical evidence |

### Attach contract after R2

| Field | Value |
|-------|-------|
| **Classification** | `OUTSIDE_FRONTEND_M1` |
| **Runtime policy** | `PRESERVE_LEGACY` |
| **Owner phase** | 16 |
| **M1** | disabled / excluded |
| **BFF** | REQUIRED (`customerAuthBffServiceGuardMiddleware`) |
| **Customer auth** | **BEARER ONLY** |
| **Session authority** | **NOT AUTHORIZED / DENY** |
| **Bearer authority** | **REQUIRED** |
| **Capability** | REQUIRED where canonical merge contract requires it |
| **Idempotency-Key** | REQUIRED |
| **If-Match** | REQUIRED |
| **Business engine** | `executeCartMerge` ONLY |
| **Second attach engine** | **NONE** |
| **Session fallback** | **NONE** |
| **Removal** | future HUMAN GATE REQUIRED; invented removal date NONE |

Canonical merge remains bearer-only. ACK remains bearer-only.

## Legacy tests removed / rewritten

Removed from `cart-checkout-store.spec.ts` (class B — superseded by Phase 16):

1. `transfere apenas o guest cart autorizado, nao vazio, da sessao atual`
2. `rejeita cart_id no body quando nao corresponde a sessao atual`
3. `rejeita quando a sessao aponta para cart diferente do body`
4. `preserva o customer cart util quando o guest cart da sessao esta vazio`
5. `faz o guest cart nao vazio vencer no login e marca o cart antigo como superseded`
6. `usa customer.email como email final apos attach`
7. `nao resolve nem chama workflows/servicos de Order, PaymentSession ou fulfillment`

Rewritten:

- `responses de cart/checkout nao expoem campos de Order, payment ou Gelato` — guest GET `/store/carts/active` only; attach body owned by `expectPublicMergeBody` in `cart-merge-review.spec.ts`
- Stale `BLOCKED→DENY` comment replaced with PRESERVE_LEGACY facade ownership note

Kept:

- `public attach surface is PRESERVE_LEGACY while handler-level domain proofs remain`
- Unrelated checkout/payment/Order/line-item coverage
- Webhook-matcher and static pre-Order grep proofs

**Current owner suite for attach behavior:** `cart-merge-review.spec.ts` (`describe("Adaptador attach depreciado")`), with surface PRESERVE_LEGACY also in `guest-cart-native-deny.spec.ts` and a small surface invariant in `cart-checkout-store.spec.ts`.

Static negative proof (production-scoped, not whole-repo): attach `route.ts` contains `executeCartMerge` and does not contain `transferCartCustomerWorkflowId`, `updateCartWorkflowId`, or `request.session`. Attach middleware block contains `authenticate("customer", ["bearer"])` and not `"session"`.

## Exact-set (unchanged from R1)

| Contract | Actual |
|----------|--------|
| **M1 exact-set** | **14** (Phase 14 six + Phase 15 six + Phase 16 **merge + ACK only**) |
| **Phase 16 M1 additions** | `POST /store/customers/me/cart/merge`, `POST /store/carts/{id}/review/acknowledge` |
| **Unexpected M1 additions** | **NONE** |
| **BFF tuple** | **exactly 8** (Phase 15 six + merge + ACK); attach **absent** |
| **Native denial** | `POST /store/carts/{id}/customer` → DENY / 404 non-enumerating |
| **Prefix / alias denial** | DENY / NON-ENUMERATING |
| **Eight-sink regression** | **NONE** (R1 8/8 architecture not rewritten) |
| **Attach in Store executable OpenAPI** | still excluded (Plan 16-12 owns registration) |

## Order / leakage

- **Order delta:** **0** for C1–C8 and the new full-contract session middleware case (real SQL `select count(*)::int as count from "order"`).
- PostgreSQL harness cannot faithfully exercise authenticate by calling the attach **handler** (handler would merge if `auth_context` were planted). The new case invokes the **production authenticate middleware** from the attach tuple. C5 old-body handler denial is retained.
- Eight-sink exact-set and secret classes (`guest_capability`, `customer_jwt`, `raw_idempotency_key`) were not redesigned.

## Verification

### Focused HTTP

```bash
cd apps/backend && npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/cart-merge-review.spec.ts \
  integration-tests/http/guest-cart-native-deny.spec.ts \
  integration-tests/http/cart-checkout-store.spec.ts
```

| Metric | Result |
|--------|--------|
| Suites | 3 passed / 3 |
| Tests | 144 passed / 144 |
| Failed | 0 |
| Skipped | 0 |
| Exit | 0 |

Delta vs R1 two-suite 97/97: third suite included + HR-04 tests added + legacy checkout attach tests removed. Failed = 0 required; historical 97/97 not required.

### cart-checkout-store

| Metric | Result |
|--------|--------|
| Suites | 1 passed / 1 |
| Tests | 43 passed / 43 |
| Failed | 0 |
| Skipped | 0 |
| Exit | 0 |

### BFF / surface units

```bash
cd apps/backend && npm run test:unit -- --runTestsByPath \
  src/api/store/carts/__tests__/bff-protected-operations.unit.spec.ts \
  src/api/store-surface/__tests__/guard.unit.spec.ts \
  src/api/store-surface/__tests__/manifest.unit.spec.ts
```

| Metric | Result |
|--------|--------|
| Suites | 3 passed / 3 |
| Tests | 29 passed / 29 |
| Failed | 0 |
| Exit | 0 |

Attach matcher bearer-only proven in `guest-cart-native-deny` (`attach monta BFF + Customer bearer + preorder; sem access guard`). BFF tuple still exactly 8; attach absent; M1 remains 14.

### Additional contract HTTP

| Suite | Result |
|-------|--------|
| `store-surface-lockdown` | 9/9 PASS |
| `store-foundation-final` | 7/7 PASS |
| `guest-cart-bff-guard` | 5/5 PASS |
| `guest-cart-contract-matrix` | SSOT exact-set still present; **2 handler-harness failures PRE-EXISTING** (`createScope` missing since 16-07; documented in R1; unchanged / not R2-caused) |

### PostgreSQL Order authority (disposable local)

```bash
cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- \
  npm run test:integration:modules -- \
  --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts
```

| Metric | Result |
|--------|--------|
| PostgreSQL | DISPOSABLE LOCAL (`mode=docker` host=127.0.0.1 target=`p12_disposable_b7a090c8e814f9dc`) |
| Docker | USED |
| Suites | 1 passed / 1 |
| Tests | 27 passed / 27 (R1 was 26; +1 full-contract session middleware case) |
| Failed | 0 |
| Skipped | 0 |
| Exit | 0 |
| Order delta | **0** including `full-contract session attach is denied at authenticate middleware with Order delta 0` |

### Full unit

```bash
cd apps/backend && npm run test:unit
```

| Metric | Result |
|--------|--------|
| Suites | 103 passed / 1 failed / 104 total |
| Tests | 1888 passed / 2 failed / 1890 total |
| **R2-caused regressions** | **0** |
| **Known pre-existing failures** | **1 suite / 2 tests** — `native-extensions.unit.spec.ts` fingerprint drift on `apps/backend/src/api/middlewares.ts` (`GET /store/products`). Same class as R1; fingerprint refresh not authorized in R2 |

## Security / diff review

Reviewed range `e91c48c...HEAD`. Production diff is one authenticate authTypes change on the attach matcher. Merge/ACK remain `authenticate("customer", ["bearer"])`. Payment-attempts still `session|bearer` with `allowUnauthenticated`. BFF tuple/M1/manifest/OpenAPI registry untouched. Tests remove the retired session attach engine and add middleware-level session denial; no `.skip`/`.only`.

The Cursor `security-review` subagent could not compute a default-base-branch diff in this workspace. The authorized R2 review was performed by the orchestrator (Grok 4.6) on the explicit R2 range.

| Check | Result |
|-------|--------|
| session auth bypass | PASS — attach bearer-only; `session.auth_context` does not call `next()` |
| bearer weakening | PASS — merge/ACK unchanged; attach tightened |
| BFF bypass | PASS — BFF guard still first on attach |
| capability bypass | PASS — validators unchanged |
| prefix authorization | PASS — no matcher widening |
| native attach | PASS — `/store/carts/{id}/customer` unchanged DENY |
| second attach engine | NONE |
| legacy workflow resurrection | NONE |
| Order authority | PASS — postgres Order delta 0 |
| leakage regression | NONE |
| OpenAPI/manifest drift | NONE |
| scope creep | NONE — authorized files only |
| test weakening | NONE |

**OVERALL: PASS**

`git diff --check`: **PASS** (empty).

## Independent final validator J

```
Independent final validator:
EXECUTED

Model:
Grok 4.6

B16-11-R1-HR-04:
RESOLVED

B16-11-R1-HR-05:
RESOLVED

B16-11-R1-HR-06:
RESOLVED

Original HR-01 regression:
NONE

Original HR-02 regression:
NONE

Native denial regression:
NONE

M1 exact-set regression:
NONE

Order authority regression:
NONE

Overall:
PASS
```

J2 inspected actual diff, source, tests, recorded results, and this SUMMARY after it existed. SUMMARY vs repo mismatches: NONE.

## Worktree / push / next

| Field | Value |
|-------|-------|
| **Worktree after technical commits** | CLEAN at `68e529f` before this docs file |
| **Push** | **NOT PERFORMED** |
| **Deploy** | **NOT PERFORMED** |
| **Phase 16** | **IN PROGRESS** |
| **Plan 16-11 human status** | **PENDING HUMAN RE-REVIEW** |
| **Plan 16-12 authorization** | **NOT STARTED / NOT AUTHORIZED** |
| **Next permitted action** | **HUMAN RE-REVIEW OF PLAN 16-11** |

---
*Phase: 16-cart-merge-review*
*Plan: 16-11 R2*
*Technical remediation: PASS; human re-review pending*
*Independent final validator (J): EXECUTED — PASS*
