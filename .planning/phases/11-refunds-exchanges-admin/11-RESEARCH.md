---
phase: 11-refunds-exchanges-admin
status: research-complete
created_at: 2026-07-02
scope: planning-only
external_calls_executed: false
---

# Phase 11 Research - Refunds & Exchanges (Admin)

## Research Boundary

This research supports planning only. It did not execute runtime code, tests,
builds, migrations, deploys, Stripe API calls, Gelato calls, Correios API calls,
or Stripe CLI smoke.

## Sources Consulted

- Repo planning truth:
  - `.planning/ROADMAP.md`
  - `.planning/STATE.md`
  - `.planning/REQUIREMENTS.md`
  - `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-CLOSURE.md`
  - `.planning/phases/06-idempotent-webhook-driven-order-creation/06-CLOSURE.md`
  - `.planning/phases/09-gelato-fulfillment-webhook/09-CLOSURE.md`
  - `.planning/phases/10-secure-guest-tracking/10-CLOSURE.md`
- Stripe official docs checked for planning facts:
  - Refunds API: `https://docs.stripe.com/api/refunds`
  - Refund object: `https://docs.stripe.com/api/refunds/object`
  - Create refund: `https://docs.stripe.com/api/refunds/create`
  - Event types: `https://docs.stripe.com/api/events/types`

No Correios API documentation was needed because the MVP decision is explicitly
manual/semi-automatic, with codes entered by an operator.

## Stripe Refund Findings

- Stripe refund objects have `amount`, `currency`, `payment_intent`,
  `charge`, and `status`.
- Stripe refund statuses include `pending`, `requires_action`, `succeeded`,
  `failed`, and `canceled`.
- Stripe documents `refund.created`, `refund.updated`, and `refund.failed`
  events. It also documents `charge.refunded` for charge-level refund updates,
  including partial refunds.
- Refund object events are the planned canonical source for final local
  financial truth. `charge.refunded` is not an independent source for confirmed
  refunded accounting; if future runtime processes it, the handling must be
  informational/idempotent and subordinate to the refund object event.
- Stripe create-refund supports partial refunds up to the remaining unrefunded
  amount. Stripe will reject attempts above the remaining amount, but Phase 11
  still needs a local pre-call guard because the project invariant requires
  deterministic local behavior and no over-reservation under concurrency.
- A create-refund response is useful for correlation, but this project requires
  local financial truth only after trusted webhook confirmation.

## Local Architecture Implications

### Refund Request Contract

Phase 11 should model a local `RefundRequest` before treating any money as
refunded. The request command should validate:

- existing Order born by the accepted webhook path;
- local captured payment truth exists;
- amount is positive;
- currency matches the local payment currency;
- requested amount does not exceed locally available captured amount;
- concurrent/pending reservations cannot overrun the captured amount;
- idempotency key maps repeated operator attempts to one local request.

The future Stripe boundary should be injectable/fakeable in tests. Tests must
not call Stripe real.

### Refund Webhook Confirmation

Webhook processing should reuse the existing Stripe raw-body verification and
`WebhookEventLog` dedupe pattern. The refund confirmation path should:

- correlate by `stripe_refund_id` and/or `payment_intent`;
- treat `refund.created` and non-terminal statuses as non-final;
- prevent `charge.refunded` plus `refund.updated` from duplicating confirmed
  refunded amount;
- mark local financial refund truth only when Stripe refund status is confirmed
  as terminal success;
- mark failed/canceled refund attempts without subtracting confirmed refunded
  amount;
- recompute `payment_status` transactionally without changing
  `order_status`;
- be idempotent under replay and concurrency.

### Payment And Order State

The accepted Phase 06 state split is the anchor:

- `order_status` remains operational.
- `payment_status` remains financial.
- Refund confirmation may update financial metadata/status only.
- Full refund does not imply `order_status = canceled`.
- Refund failure does not revert Order, Gelato, email, analytics, or tracking.

## Exchange Research

`ExchangeRequest` should be a separate Admin/support aggregate. It is not a
refund and does not carry financial truth.

Recommended MVP scope:

- reasons: `defect` and `wrong_product`;
- status lifecycle from opened to resolved/rejected/canceled;
- safe affected-item summary;
- manual reverse-logistics fields;
- operator notes with sanitization;
- no automatic refund;
- no automatic Gelato replacement dispatch;
- no public storefront self-service exchange.

## Correios Reverse Logistics

The roadmap and requirements explicitly choose manual/semi-automatic reverse
logistics for MVP:

- operator obtains/enters Correios code outside the system or through a manual
  support process;
- Admin stores `reverse_tracking_code`, optional authorization/label reference,
  and return milestones;
- backend does not call Correios API;
- backend does not buy labels, quote shipping, or poll tracking from Correios.

## Open Questions For Future Execution Gate

These are not blockers for planning, but must be answered before runtime
implementation starts:

- Exact Admin UI extension surface to use in this Medusa v2 checkout for
  refund and exchange actions.
- Whether local confirmed payment amount is stored in a single canonical place
  or must be recomputed from `PaymentAttempt` plus Order metadata.
- Exact final `payment_status` vocabulary for partial vs total refund in the
  accepted local metadata contract.
- Whether Phase 11 execution should include only backend/Admin API contracts or
  also Medusa Admin widgets/forms.

## Planning Conclusion

Proceed with four manual-review-gated slices:

1. `11-01` - local refund request contract/model/Admin-safe command, with no
   final financial state mutation.
2. `11-02` - Stripe refund webhook confirmation and transactional financial
   recomputation.
3. `11-03` - operational `ExchangeRequest` Admin workflow and manual Correios
   reverse logistics.
4. `11-04` - final documentary validation, negative proofs, and manual gate
   before Phase 12.
