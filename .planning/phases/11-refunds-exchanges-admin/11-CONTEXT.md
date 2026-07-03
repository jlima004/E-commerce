---
phase: 11-refunds-exchanges-admin
status: planned-manual-gate
created_at: 2026-07-02
scope: planning-only
depends_on: 06-idempotent-webhook-driven-order-creation
after_phase_gate: 10-secure-guest-tracking-closed
requirements: [REF-01, REF-02, EXC-01, EXC-02]
manual_review_gate: true
branch: gsd/phase-11-refunds-exchanges-admin
---

# Phase 11 Context - Refunds & Exchanges (Admin)

## Objective

Plan Phase 11 only. Do not implement runtime, do not run tests, do not build,
do not run real migrations, do not deploy, do not call Stripe, do not call
Gelato, do not call Correios, do not run Stripe CLI smoke, and do not start
Phase 12.

Phase 11 will later add an Admin-only refund and exchange surface. Refund
requests are operator-initiated, but local financial truth only changes after
the canonical Stripe webhook confirms the refund. Exchanges are operational
support workflows and remain separate from financial state.

## Dependency State

Phase 10 is closed in:

- `.planning/phases/10-secure-guest-tracking/10-CLOSURE.md`

Accepted upstream facts that Phase 11 depends on:

- Phase 06 created the accepted Order birth rule: an `Order` exists only after
  the canonical, signature-verified, idempotent Stripe webhook confirms
  payment.
- Phase 06 accepted decoupled local `order_status` and `payment_status`.
- Phase 07 accepted durable local `purchase_completed`.
- Phase 08 accepted confirmation email after confirmed Order.
- Phase 09 accepted Gelato fulfillment and tracking as separate from refund and
  exchange work.
- Phase 10 accepted secure public tracking and explicitly did not start
  refund, exchange, Admin ops, or Phase 11.

## Requirements

- `REF-01`: Operator can issue/request a refund from the Admin; local financial
  state updates only after a reliable Stripe webhook confirms it.
- `REF-02`: A refund never automatically sets `order_status` to canceled.
- `EXC-01`: Operator can manage operational exchanges (`ExchangeRequest`) for
  defective or wrong prints from the Admin.
- `EXC-02`: Reverse logistics use a manual/semi-automatic Correios flow
  (tracking codes entered in Admin), with no automated Correios API
  integration.

## Implementation Decisions

### D11-01 - Planning Gate

This cycle creates planning artifacts only and updates `.planning/STATE.md`.
No runtime, tests, build, real migration, deploy, Stripe real call, Gelato real
call, Correios real call, Stripe CLI smoke, or Phase 12 work is approved.

Phase 11 branch is `gsd/phase-11-refunds-exchanges-admin`.

### D11-02 - Order Birth Rule Preserved

Refund and exchange flows must never create an `Order`. They operate only on
Orders already born through the accepted Phase 06 post-Stripe-webhook path.

### D11-03 - Refund Request Is Not Financial Truth

An Admin refund request may create local intent/reservation state and may later
call Stripe through an injectable boundary, but it must not mark local money as
refunded until a trusted Stripe refund webhook confirms the final refund state.

### D11-04 - Webhook-Confirmed Financial Truth

Local `payment_status`, confirmed refunded amount, and refund terminal state
are recomputed transactionally only from accepted Stripe webhook evidence. A
direct Stripe create-refund response is not sufficient financial truth.

### D11-05 - Refund Does Not Cancel Order

No refund, including a total refund, may automatically set
`order_status = canceled`. Operational cancellation remains a separate manual
workflow outside automatic refund confirmation.

### D11-06 - Captured Amount Guard

Refund requests must reject zero or negative amounts, currency mismatch, and any
amount exceeding the locally available captured amount. Available amount is
computed from captured local payment truth minus confirmed refunds and
non-terminal refund reservations.

Execution of `11-01` must stop before runtime implementation if the local
canonical source for `captured_amount`, currency, and payment reference is not
clearly identified from accepted repository state.

### D11-07 - Concurrent Refund Guard

Concurrent refund requests and webhook replays must be idempotent and must not
allow cumulative confirmed or reserved refund amounts to exceed the captured
amount. The guard must use transaction-level local claims/locks or an equivalent
database-level invariant.

### D11-08 - Stripe Refund Webhook Scope

The refund confirmation slice should reuse the existing Stripe webhook ingest
and `WebhookEventLog` pattern. It should handle Stripe refund events with
`data.object.object = refund`, including `refund.updated` and failure events,
and must preserve fail-closed behavior for unknown or insufficient payloads.
Refund object events are the canonical source for final local financial truth.
`charge.refunded` must not generate duplicate accounting; if processed at all,
it must be informational/idempotent and subordinate to the refund object.

### D11-09 - Exchange Is Operational

`ExchangeRequest` is an Admin/support object for defective or wrong products.
It does not create a refund automatically, does not change financial state, and
does not imply automatic Gelato redispatch.

### D11-10 - Reverse Logistics Is Manual/Semi-Automatic

Reverse logistics for the MVP stores Correios/postal codes and operator notes
entered through Admin. Phase 11 must not integrate with the Correios API,
purchase labels automatically, or call an external shipping provider.

### D11-11 - Gelato Boundary

Phase 11 must not alter Gelato dispatch, Gelato webhook ingestion, or public
tracking behavior. Exchange planning may reference the already delivered Order
and fulfillment state for operator context, but no automatic Gelato replacement
dispatch is part of this phase.

### D11-12 - Phase 12 Boundary

Broad `OperationalAlert`, `AdminActionLog`, and invariant regression-test
programs belong to Phase 12. Phase 11 may keep narrow local operator fields or
timestamps necessary for its own models, but must not start the Phase 12 audit
module or broad alerting module.

## Planned Local Models

### RefundRequest

Planned fields:

- `id`;
- `order_id`;
- `payment_intent_id`;
- `payment_id` or accepted local payment reference when available;
- `stripe_refund_id` nullable until Stripe accepts creation;
- `idempotency_key`;
- `amount`;
- `currency_code`;
- `reason`;
- `operator_note`;
- `status`: `requested | rejected | stripe_create_pending | stripe_created |
  confirmation_pending | confirmed | failed | canceled`;
- `failure_code`;
- `failure_message`;
- `requested_by_operator_id` nullable/safe;
- `confirmed_at`;
- `failed_at`;
- `created_at`;
- `updated_at`;
- `deleted_at`.

Planned indexes/invariants:

- unique `idempotency_key`;
- unique nullable `stripe_refund_id` when present;
- index `order_id`;
- index `payment_intent_id`;
- index `status`;
- transactional amount guard over confirmed and non-terminal reservations.

### ExchangeRequest

Planned fields:

- `id`;
- `order_id`;
- `reason`: `defect | wrong_product`;
- `status`: `opened | awaiting_customer_return | return_in_transit |
  return_received | replacement_review | resolved | rejected | canceled`;
- `affected_items` safe structured summary;
- `customer_visible_note` optional sanitized text;
- `operator_note` optional sanitized text;
- `reverse_logistics_provider`: `correios_manual | other_manual`;
- `reverse_tracking_code`;
- `reverse_authorization_code`;
- `reverse_label_reference`;
- `return_received_at`;
- `resolved_at`;
- `created_by_operator_id` nullable/safe;
- `created_at`;
- `updated_at`;
- `deleted_at`.

No refund id, Gelato dispatch id, or replacement external order id should imply
automatic side effects. If future support needs replacement production, it must
be a separate explicit gate.

## Canonical References

Downstream planning/execution must read:

- `.planning/ROADMAP.md` - Phase 11 goal, dependencies and success criteria.
- `.planning/STATE.md` - manual gate and current project state.
- `.planning/REQUIREMENTS.md` - `REF-01`, `REF-02`, `EXC-01`, `EXC-02`.
- `.planning/phases/06-idempotent-webhook-driven-order-creation/06-CLOSURE.md`
  - accepted Order birth rule and decoupled `order_status/payment_status`.
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-CLOSURE.md`
  - accepted Stripe webhook and `WebhookEventLog` pattern.
- `.planning/phases/09-gelato-fulfillment-webhook/09-CLOSURE.md`
  - Gelato boundary that Phase 11 must not alter.
- `.planning/phases/10-secure-guest-tracking/10-CLOSURE.md`
  - Phase 10 closed state and explicit non-start of Phase 11.
- `apps/backend/src/modules/payment-attempt/**` - accepted local Stripe payment
  state.
- `apps/backend/src/modules/webhooks/**` - existing webhook ingestion and
  dedupe pattern.
- `apps/backend/src/api/admin/**` - existing Admin route conventions.

## Manual Gate

This planning cycle stops after the Phase 11 planning artifacts and
`git diff --check`. Phase 11 execution remains blocked until explicit human
approval. Phase 12 remains not started.
