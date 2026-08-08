---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 02
subsystem: api
tags: [store-surface, fail-closed, guard, lockdown, medusa-2.16.0]
status: in-progress
---

# Phase 13 Plan 02: Fail-Closed Store Lockdown Summary

**IN PROGRESS — Task 1 inventory locked; implementation pending**

## Legacy test impact inventory (pre-change)

exact_set_status: LOCKED_BEFORE_EDIT

Closed exact-set of unique legacy test paths (3 ≤ 4) within Store/checkout/payment/API Docs/invariants that reference operations now BLOCKED, OUTSIDE_FRONTEND_M1, or EXTENDED-disabled at runtime. No globs. No edits applied yet.

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
| unique paths | 3 |
| inventory case rows | 12 |
| families present | http, unit |
| Class A rows | 0 |
| Class B rows | 6 (all in cart-checkout-store; each has non-empty Coverage replacement) |
| Class C rows | 6 |
| paths outside Store/checkout/payment/API Docs/invariants | 0 |

### Transition plan (authorized for Task 2 only)

- **B (attach handler cases):** keep/clarify as internal handler invariant proofs; do not delete, skip, or relax assertions; public DENY proven in new `store-surface-lockdown.spec.ts`.
- **C:** no convenience edits.
- **A:** none identified — no legacy suite asserted public HTTP success for a now-denied route via the real middleware stack (existing suites invoke handlers directly).
