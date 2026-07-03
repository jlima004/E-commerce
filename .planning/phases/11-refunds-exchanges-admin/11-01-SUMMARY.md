---
phase: 11-refunds-exchanges-admin
plan: 11-01
status: complete-awaiting-manual-review
executed_at: 2026-07-03
branch: gsd/phase-11-refunds-exchanges-admin
requirements: [REF-01, REF-02]
manual_review_gate: true
correction: reservation-concurrency-hardening
---

# 11-01 Summary — RefundRequest Contract, Model, and Admin-Safe Request Command

## Scope Executed

Only plan `11-01` was executed. Plans `11-02`, `11-03`, `11-04`, and Phase 12 were **not** started.

This cycle applied the **reservation concurrency correction** only: branch rename, per-order reservation claim, concurrent tests, and summary update. No changes to `11-02`..`11-04`, Phase 12, Stripe real, Gelato, Correios, migration application, deploy, or package/lockfile.

## Branch Correction

| Before | After |
|--------|-------|
| `gsd/phase-11-refunds-&-exchanges-admin` | `gsd/phase-11-refunds-exchanges-admin` |

Renamed with `git branch -m gsd/phase-11-refunds-exchanges-admin` to match `11-CONTEXT.md` / `STATE.md` phase branch policy.

## Files Changed (this correction)

| Path | Action |
|------|--------|
| `apps/backend/src/modules/refund-request/reservation-claim.ts` | created — per-order async claim |
| `apps/backend/src/api/admin/refunds/request/route.ts` | modified — availability + create inside claim |
| `apps/backend/src/modules/refund-request/__tests__/refund-request.unit.spec.ts` | modified — concurrent reservation tests |
| `apps/backend/integration-tests/http/admin-refunds.spec.ts` | modified — concurrent HTTP test |
| `.planning/phases/11-refunds-exchanges-admin/11-01-SUMMARY.md` | updated |

Prior `11-01` files remain in place (module, model, route, tests). `env.ts` and `medusa-config.ts` were **not** modified in this correction cycle.

No other files were modified. `package.json` and lockfile have **no diff**.

## Canonical Local Financial Source (Pre-Runtime Gate)

**Blocker status: none — source identified and implemented.**

| Field | Canonical local source | Eligibility gates |
|-------|------------------------|-------------------|
| `captured_amount` | `PaymentAttempt.amount` for the Order-linked attempt with `status = payment_confirmed_by_webhook` | `amount > 0`, `provider = stripe`, `currency_code = brl` |
| `currency_code` | `PaymentAttempt.currency_code` (normalized lowercase `brl`) | same attempt as above |
| `payment_intent_id` | `PaymentAttempt.provider_payment_intent_id` | non-empty, same attempt as above |

**Order eligibility (Phase 06 accepted state):**

- `Order.metadata.order_status = "confirmed"`
- `Order.metadata.payment_status = "captured"`

Implementation: `apps/backend/src/modules/refund-request/captured-truth.ts`

## RefundRequest Contract

### Model fields

- `id` (`refreq` prefix)
- `order_id`, `payment_intent_id`, `payment_attempt_id`
- `stripe_refund_id` nullable, unique when present
- `idempotency_key` unique
- `amount`, `currency_code`
- `reason`, `operator_note`, `requested_by_operator_id`
- `status` vocabulary (see below)
- `failure_code`, `failure_message`
- `confirmed_at`, `failed_at`, `canceled_at`, `rejected_at`
- `metadata` (allowlist-only)
- timestamps / soft delete

### Status vocabulary

Full enum (migration draft): `requested | rejected | stripe_create_pending | stripe_created | confirmation_pending | confirmed | failed | canceled`

**Slice `11-01` runtime create status:** `requested` only.

**Reservation statuses (subtract from availability):** `requested`, `stripe_create_pending`, `stripe_created`, `confirmation_pending`

**Confirmed financial statuses:** `confirmed` exists in schema for future `11-02` but is **never written** in this slice.

### Admin route

- `POST /admin/refunds/request`
- Gated by `ADMIN_REFUND_REQUEST_ENABLED` (default `true`)
- Records local request/reservation only; does **not** call Stripe real
- Injectable Stripe boundary available for tests/future slices (`stripe-refund-boundary.ts`)

## Migration

- Draft: `apps/backend/src/modules/refund-request/migrations/TBD-refund-request.ts`
- **Not applied** — no `medusa db:migrate` executed

## Guards Implemented

| Guard | Error code |
|-------|------------|
| Zero amount | `REFUND_REQUEST_AMOUNT_INVALID` |
| Negative amount | `REFUND_REQUEST_AMOUNT_INVALID` |
| Over captured availability | `REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED` |
| Currency mismatch | `REFUND_REQUEST_CURRENCY_MISMATCH` |
| Order not confirmed/captured | `REFUND_REQUEST_ORDER_STATUS_NOT_ELIGIBLE` / `REFUND_REQUEST_PAYMENT_STATUS_NOT_ELIGIBLE` |
| Missing/invalid PaymentAttempt | `REFUND_REQUEST_PAYMENT_ATTEMPT_NOT_FOUND` / linkage errors |

### Captured availability formula

```
available_amount = captured_amount
  - sum(confirmed refunds)
  - sum(non-terminal reservations)
```

Post-create response reflects availability **after** the new reservation is included.

## Idempotency / Concurrency

### Idempotency

- Unique `idempotency_key` on model + migration draft
- Repeated Admin request with same key returns existing `RefundRequest` (`reused_idempotency: true`, HTTP 200)
- No duplicate reservation on idempotent replay (including concurrent replay under claim)

### Concurrency (corrected)

**Problem fixed:** prior route read existing reservations, validated availability, then created — a non-atomic read-then-create race allowed two concurrent requests with different idempotency keys to over-reserve `captured_amount`.

**Solution:** `withOrderRefundReservationClaim(order_id, fn)` in `reservation-claim.ts` serializes availability re-read + validation + create per order within the current Node process. The Admin route wraps the full list → validate → persist path inside this claim.

| Property | Detail |
|----------|--------|
| Scope | Process-local per `order_id` |
| Cross-worker | Not covered in `11-01`; Redis locking module exists in infra but is not wired here. Future slice or production hardening should add Redis claim or DB invariant if multi-dyno over-reserve must be impossible. |
| Blocker | **None** for slice scope — local claim + unique `idempotency_key` is sufficient for single-process tests and manual gate evidence. |

## Sanitizers

- Metadata allowlist: `correlation_id`, `recovery_origin`, `source`
- Forbidden keys/values blocked (secrets, PII, payment payloads)
- Error redaction via `sanitizeRefundRequestError`

## Tests and Results

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/refund-request/__tests__/refund-request.unit.spec.ts
# PASS — 22/22

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/admin-refunds.spec.ts
# PASS — 8/8
```

New/updated coverage:

- Unit: two concurrent requests (different idempotency keys, 6000+6000 vs 9900 captured) — one succeeds, one fails; store length 1
- Unit: concurrent idempotent replay — single reservation, reuse flag on replay
- HTTP: concurrent over-captured rejection with claim wired through route deps

## Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# PASS — Backend build completed successfully
```

## Negative Proofs

| Proof | Result |
|-------|--------|
| Zero/negative refund rejected | unit + HTTP integration |
| Over-captured rejected | unit + HTTP integration |
| Currency mismatch rejected | unit + HTTP integration |
| Idempotent request does not duplicate reservation | unit + HTTP integration |
| Concurrent reservations cannot exceed captured | unit + HTTP integration (corrected) |
| Refund request does not create Order | unit + HTTP integration |
| Refund request does not alter `order_status` | unit + HTTP integration (metadata unchanged) |
| Refund request does not mark final financial truth | status stays `requested`; no `confirmed_at`; no `payment_status` mutation |
| Stripe client fake/injectable in tests | `createFakeStripeRefundCreationLayer` |
| No real Stripe | no Stripe SDK calls in module/route |
| No Stripe CLI smoke | not run |
| No ExchangeRequest | not implemented |
| No Gelato | not referenced in refund path |
| No Correios | not referenced |
| No Phase 12 | not started |
| `11-02` / `11-03` / `11-04` | not started |
| `package.json` / lockfile diff | none |
| `git diff --check` | PASS |

## Manual Gate

Execution stops here for human review of `11-01` only (including reservation concurrency correction).

**Next permitted step after approval:** plan `11-02` (Stripe refund webhook confirmation and transactional financial recomputation) — separate explicit approval required.

**Deferred from this slice:** cross-dyno Redis reservation lock; DB-level over-reservation invariant beyond unique `idempotency_key`.
