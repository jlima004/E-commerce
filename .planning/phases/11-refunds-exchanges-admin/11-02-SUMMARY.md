---
phase: 11-refunds-exchanges-admin
plan: 11-02
status: correction-complete-awaiting-manual-review
executed_at: 2026-07-03
corrected_at: 2026-07-03
branch: gsd/phase-11-refunds-exchanges-admin
requirements: [REF-01, REF-02]
manual_review_gate: true
---

# 11-02 Summary — Stripe Refund Webhook Confirmation and Transactional Financial Recomputation

## Scope Executed

Only plan `11-02` was executed, including a targeted correction to harden the `refund.created` path. Plans `11-03`, `11-04`, and Phase 12 were **not** started.

## Correction Applied (2026-07-03)

**Problem:** The non-finalizing webhook path (`refund.created`, non-terminal `refund.updated`) incorrectly called `applyTerminalRefundWebhookToRefundRequest`, which could write `status=confirmed`, `confirmed_at`, and `finalizes_financial_state=true` when the Stripe refund object arrived with `status=succeeded` — even though `refund.created` must never finalize financial truth.

**Fix:**

1. Added `applyNonFinalizingRefundWebhookLink(...)` — link-only helper for `refund.created` and non-terminal refund statuses. Permits `stripe_refund_id` correlation and local `confirmation_pending`; never writes `confirmed`, `confirmed_at`, or recomputes financial state.
2. Kept `applyTerminalRefundWebhookToRefundRequest(...)` exclusively for terminal `refund.updated` / `refund.failed` paths with terminal Stripe statuses (`succeeded` / `failed` / `canceled`).
3. Updated `stripe-refund-webhook-entrypoint.ts` non-finalizing branch to use `applyNonFinalizingRefundWebhookLink` instead of the terminal helper.

## Files Changed

| Path | Action |
|------|--------|
| `apps/backend/src/modules/refund-request/stripe-refund-webhook.ts` | modified — added `applyNonFinalizingRefundWebhookLink`; separated link vs terminal helpers |
| `apps/backend/src/workflows/refund/stripe-refund-webhook-entrypoint.ts` | modified — non-finalizing path uses link-only helper |
| `apps/backend/src/modules/refund-request/__tests__/refund-stripe-webhook.unit.spec.ts` | modified — added `refund.created` + `status=succeeded` proofs |
| `apps/backend/integration-tests/http/stripe-refund-webhook.spec.ts` | modified — HTTP proof for `refund.created` + `status=succeeded` + deferred `refund.updated` confirmation |
| `.planning/phases/11-refunds-exchanges-admin/11-02-SUMMARY.md` | updated |

Prior 11-02 files remain unchanged by this correction slice:

- `apps/backend/src/api/hooks/stripe/route.ts`
- `apps/backend/src/api/hooks/stripe/refund-events.ts`
- `apps/backend/src/modules/refund-request/captured-truth.ts`
- `apps/backend/src/modules/refund-request/financial-recomputation.ts`
- `apps/backend/src/modules/webhooks/service.ts`

No changes to `package.json`, lockfile, `medusa-config.ts`, `env.ts`, migrations, Gelato, tracking, Order birth rule, or Admin create-refund route.

## Stripe Events Handled

| Event | Behavior |
|-------|----------|
| `refund.created` | Accepted through existing signature-verified + `WebhookEventLog` dedupe path; links `stripe_refund_id` when correlatable; **never** finalizes financial state — even when Stripe object carries `status=succeeded` |
| `refund.updated` | Canonical terminal handler when refund object status is terminal (`succeeded` / `failed` / `canceled`); non-terminal statuses do not finalize financial state |
| `refund.failed` | Same refund-object terminal path as `refund.updated` with failed status |
| `charge.refunded` | Accepted and marked processed as **informational/idempotent**; subordinate to refund object; **does not** mutate `confirmed_refunded_amount` or `payment_status` |

## Helper Separation

| Helper | Used for | Writes |
|--------|----------|--------|
| `linkRefundRequestToStripeRefund(...)` | Low-level link primitive | `stripe_refund_id`, optional `confirmation_pending` |
| `applyNonFinalizingRefundWebhookLink(...)` | `refund.created`, non-terminal refund statuses | link fields only; `finalizes_financial_state=false` |
| `applyTerminalRefundWebhookToRefundRequest(...)` | `refund.updated` / `refund.failed` with terminal Stripe status | terminal request status + optional financial finalization on `succeeded` |

## Refund Object as Canonical Financial Truth

- Final local financial truth updates **only** from Stripe refund object events with terminal status `succeeded` on **`refund.updated` / `refund.failed`** paths.
- `refund.created` never confirms money locally — regardless of Stripe object status.
- Non-terminal refund statuses (`pending`, `requires_action`) never confirm money locally.
- Direct Stripe create-refund responses are not used in this slice.
- `charge.refunded` never independently increments confirmed refunded accounting.

## Correlation with `RefundRequest`

Correlation order:

1. `stripe_refund_id` (unique index from 11-01)
2. `payment_intent_id` + local reservation/request row (amount match when needed)
3. Missing correlation → webhook marked ignored/failed without financial side effects

On non-final events, local row may receive `stripe_refund_id` and move to `confirmation_pending` without confirming money.

## Transactional Financial Recomputation

On terminal `succeeded` via `refund.updated` / `refund.failed`:

1. Serialize per-order work via existing process-local `withOrderRefundReservationClaim` (11-01 limitation preserved; no Redis/DB global lock added).
2. Mark `RefundRequest.status = confirmed`, set `confirmed_at`.
3. Recompute `confirmed_refunded_amount` from sum of confirmed requests vs `PaymentAttempt.amount`.
4. Recompute `Order.metadata.payment_status`:
   - `captured` when confirmed refunded = 0
   - `partially_refunded` when 0 < confirmed < captured
   - `refunded` when confirmed >= captured
5. Preserve `Order.metadata.order_status` unchanged (never auto-set `canceled`).

## Tests and Results

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/refund-request/__tests__/*.spec.ts
# PASS — 45/45

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-refund-webhook.spec.ts
# PASS — 8/8
```

## Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# PASS — Backend build completed successfully
```

## Negative Proofs

| Proof | Result |
|-------|--------|
| `refund.created` does not finalize money (including `status=succeeded`) | unit + HTTP |
| `refund.created` does not write `confirmed_at` | unit + HTTP |
| `refund.created` does not alter `payment_status` | unit + HTTP |
| `refund.created` does not alter `order_status` | unit + HTTP |
| `refund.updated` succeeded after `refund.created` confirms exactly once | HTTP |
| Non-terminal refund states do not finalize money | unit |
| `charge.refunded` does not duplicate `confirmed_refunded_amount` | unit + HTTP |
| Confirmed refund does not alter `order_status` | unit + HTTP |
| Total refund does not force `order_status = canceled` | unit + HTTP |
| Replay/concurrency does not duplicate confirmed amount for same refund | unit + HTTP |
| Webhook does not create Order | HTTP harness (`ordersCreated = 0`) |
| Webhook does not call Stripe real | constructEvent stub only |
| No Stripe CLI smoke | not run |
| Webhook does not call Gelato | HTTP negative harness unchanged |
| Webhook does not call Correios | not referenced |
| Webhook does not create `ExchangeRequest` | HTTP negative grep/harness |
| Phase 12 not started | confirmed |
| `11-03` / `11-04` not started | confirmed |
| `package.json` / lockfile diff | none |
| `git diff --check` | PASS |

## Process-Local Limitation (Documented)

Financial confirmation reuses the 11-01 process-local per-order claim (`withOrderRefundReservationClaim`). Cross-dyno/global Redis or DB invariant for concurrent webhook confirmation was **not** added in this slice — requires separate approval.

## Manual Gate

Execution stops here for human review of `11-02` correction only.

**Next permitted step after approval:** plan `11-03` (ExchangeRequest Admin workflow) — separate explicit approval required.
