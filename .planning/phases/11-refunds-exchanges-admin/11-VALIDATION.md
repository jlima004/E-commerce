---
phase: 11-refunds-exchanges-admin
status: planned
created_at: 2026-07-02
validation_scope: planned-for-future-execution
documentary_validation_this_cycle: git-diff-check-only
---

# Phase 11 Validation Plan

## Boundary For This Planning Cycle

Run only:

```bash
git diff --check
```

Do not run Jest, integration tests, build, migrations, deploy, Stripe real
calls, Gelato real calls, Correios API calls, Stripe CLI smoke, or Phase 12 work
during this planning cycle.

## Future Execution Validation Matrix

When Phase 11 execution is separately approved, validation must prove each
criterion below.

### Refund Request Validation

- Refund amount zero is rejected.
- Refund amount negative is rejected.
- Refund above locally available `captured_amount` is rejected.
- Refund currency diverging from payment currency is rejected.
- Refund request requires an existing Order already created by the accepted
  webhook-driven Order path.
- Refund request never creates an Order.
- Refund request does not mark local financial state as refunded.
- Refund request stores only safe local intent/reservation state.
- Stripe client is fake/injectable in tests; no real Stripe call occurs.

### Concurrency And Idempotency

- Repeating the same Admin refund request with the same idempotency key reuses
  one local `RefundRequest`.
- Concurrent refund requests cannot reserve more than captured amount.
- Concurrent webhook deliveries cannot confirm more refunded amount than
  captured amount.
- Duplicate Stripe refund webhook events are no-ops after the first accepted
  update.
- `charge.refunded` plus `refund.updated` cannot duplicate
  `confirmed_refunded_amount`; refund object events remain canonical for final
  financial truth.
- Failed/canceled refund events release or terminalize only the relevant local
  request and do not subtract confirmed refunded amount.

### Webhook-Confirmed Financial Truth

- `refund.created` or non-terminal refund states do not update final local
  financial truth.
- Local confirmed refunded amount updates only after trusted Stripe refund
  webhook confirmation.
- Local `payment_status` is recomputed transactionally with the refund
  confirmation.
- Partial refund yields partial financial state without changing operational
  status.
- Total refund yields total-refunded financial state without forcing
  `order_status = canceled`.
- Refund failure does not revert Order, Gelato fulfillment, tracking, email or
  analytics state.

### Order Status Separation

- Refund does not automatically change `order_status` to `canceled`.
- Total refund does not automatically change `order_status` to `canceled`.
- Existing decoupled `order_status/payment_status` metadata remains the
  contract.
- Any operational cancellation must remain a separate explicit operator flow,
  not a side effect of refund confirmation.

### ExchangeRequest

- Operator can create an `ExchangeRequest` for `defect`.
- Operator can create an `ExchangeRequest` for `wrong_product`.
- Exchange status transitions are validated.
- Exchange cannot create a refund automatically.
- Exchange cannot update local financial state.
- Exchange does not create an Order.
- Exchange does not trigger automatic Gelato dispatch/replacement.
- Exchange stores only safe affected-item summary and sanitized notes.

### Manual Correios Reverse Logistics

- Operator can enter a Correios/manual reverse tracking code.
- Operator can update return milestones manually.
- Backend does not call Correios API.
- Backend does not buy labels or quote shipping automatically.
- Backend does not poll Correios tracking automatically.

### Scope Negatives

- No broad `OperationalAlert` module is started.
- No broad `AdminActionLog` module is started.
- No Phase 12 invariant-test program is started.
- No alteration in Gelato dispatch.
- No alteration in Gelato tracking ingestion.
- No alteration in public tracking route.
- No alteration in Order birth rule.
- No Stripe CLI smoke real.
- No migration real applied unless a separate deployment gate approves it.
- No real Stripe refund call in tests.
- No real Gelato call.
- No real Correios API call.
- No Phase 12 start.

## Planned Future Unit Tests

Future execution should add focused tests for:

- `RefundRequest` amount/currency/status/idempotency helpers;
- local captured-amount availability calculation;
- transaction/concurrency guard for refund reservations;
- Stripe refund webhook handler correlation and terminal-state handling;
- `payment_status` recomputation that never mutates `order_status`;
- `ExchangeRequest` status transitions and manual reverse-logistics fields;
- sanitizers rejecting prohibited fields in refund/exchange metadata.

## Planned Future HTTP / Admin Integration Tests

Future execution should add filtered Admin/API tests for:

- Admin refund request happy path with fake Stripe boundary;
- zero/negative/over-captured/currency-mismatch rejections;
- idempotent replay of same refund request;
- webhook confirmation of partial refund;
- webhook confirmation of total refund without auto-canceling Order;
- webhook failure path;
- Admin exchange create/update for defect/wrong product;
- manual Correios code entry and milestone updates;
- exchange not creating refund and not calling Correios/Gelato.

## Build And Migration Policy

- Slices that alter module registration, environment contracts, Admin route
  registration, or Medusa runtime wiring must run build during future execution.
- This planning cycle must not run build.
- Future execution may create draft migrations for local models.
- No `medusa db:migrate` or real migration application is approved in this
  planning cycle.

## Planned Negative Greps

Future final validation should include scoped negative greps proving:

- no new checkout/storefront Order creation path;
- no automatic `order_status = canceled` from refund code;
- no exchange-triggered refund creation;
- no Correios API client/base URL/token usage;
- no real Stripe CLI smoke commands;
- no real Gelato dispatch/tracking changes;
- no Phase 12 `OperationalAlert` or `AdminActionLog` module start;
- no secrets, raw Stripe payloads, full headers, full customer PII, Pix QR,
  `client_secret`, or plaintext tracking token in persisted refund/exchange
  metadata.

Broad greps may be informational when they catch historical references. Blocking
greps must focus on files touched by Phase 11 and runtime surfaces that could
violate the invariants.

## Manual Gate

After all future Phase 11 slices are executed and their summaries are accepted,
stop at the Phase 11 manual gate. Do not start Phase 12.
