# Phase 13: Storefront Contract Foundation & Surface Lockdown — Discussion Log

> **Audit trail only.** Do not use as input to RESEARCH, planning or execution.
> Binding decisions are captured in `13-CONTEXT.md`.

**Date:** 2026-08-07
**Phase:** 13-storefront-contract-foundation-surface-lockdown
**Areas resolved:** boundary, surface policy, errors, idempotency, concurrency,
OpenAPI foundation, threat model and manual gate

## Discussion mode

The authorization supplied a complete decision contract for this CONTEXT gate.
No interactive questions were asked because the choices below were already
explicitly selected, and reopening them would contradict the instruction to
close context without turning the gate into RESEARCH.

## Boundary and surface policy

| Alternative | Treatment |
|---|---|
| Browser calls Medusa directly | Rejected |
| BFF same-origin is the only storefront consumer | Selected |
| Permit undocumented/native routes by default | Rejected |
| Fail-closed allowlist with explicit route classification | Selected |
| Let a Store route create Order for convenience | Rejected |
| Preserve canonical Stripe-webhook-only Order creation | Selected |

## Error contract

| Alternative | Treatment |
|---|---|
| Frontend branches on message text | Rejected |
| Stable public code plus presentation message | Selected |
| Forward provider/internal details | Rejected |
| Minimal allowlisted error with sanitized correlation ID | Selected |
| Distinguish resource existence in authorization failures | Rejected |
| Non-enumerable authorization responses | Selected |

## Idempotency

| Alternative | Treatment |
|---|---|
| Global unscoped key | Rejected |
| Scope by operation, actor/ownership and resource | Selected |
| Replay any payload under a reused key | Rejected |
| Semantic fingerprint; incompatible intention fails | Selected |
| Persist secrets/PII to reproduce responses | Rejected |
| Finite retention with data minimization | Selected |
| Treat idempotency as a replacement for locks/constraints | Rejected |
| Keep mechanisms distinct and test concurrent retries | Selected |

## Optimistic concurrency

| Alternative | Treatment |
|---|---|
| Client-authored version or last-write-wins | Rejected |
| Server-authoritative monotonic version | Selected |
| Silent/destructive retry after stale mutation | Rejected |
| `ETag`/`If-Match`; stale mutation returns `412 CART_VERSION_MISMATCH` | Selected |
| Choose physical storage mechanism in CONTEXT | Deferred to RESEARCH |

## OpenAPI foundation

| Alternative | Treatment |
|---|---|
| Edit generated JSON manually | Rejected |
| Preserve TypeScript registry as source of truth | Selected |
| Keep Store target at the as-built draft | Rejected |
| Target Store contract `1.1.0` | Selected |
| Materialize every Phase 14–21 operation now | Rejected |
| Prepare only transversal foundations in Phase 13 | Selected |

## Agent discretion

None for scope, invariants, boundary, fail-closed policy, errors, idempotency,
concurrency, OpenAPI target or gate progression. Exact framework/persistence
techniques were deliberately left as Open Questions for a future authorized
RESEARCH gate.

## Deferred ideas

- auth and verification: Phase 14;
- guest capability and Cart mutations: Phase 15;
- merge/review: Phase 16;
- BR checkout/privacy: Phase 17;
- shipping: Phase 18;
- PaymentAttempt hardening: Phase 19;
- async confirmation: Phase 20;
- order/catalog handoff: Phase 21;
- contract kit/release: Phase 22;
- frontend/Next.js: outside this backend milestone.
