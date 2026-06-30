---
phase: 06
slug: idempotent-webhook-driven-order-creation
status: planning_manual_gate
created: 2026-06-30
manual_review_gate: true
---

# Phase 06 - Validation Strategy

> Contrato de validacao para criacao idempotente de `Order` pos-webhook. Esta estrategia deve provar que somente `PaymentAttempt.status = payment_confirmed_by_webhook` com `order_id = null` cria `Order`, que replay/concurrency geram exatamente um pedido, e que nenhum efeito de Phase 07+ foi introduzido.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| Config file | `apps/backend/jest.config.js` |
| Unit command | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-order-eligibility.unit.spec.ts src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` |
| HTTP command | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts` |
| Build command | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |

## Required Coverage

| Area | Required proof |
|------|----------------|
| Entry point | Only the internal post-webhook workflow/service can create Order; no Store checkout completion route exists. |
| Eligibility | Only `payment_confirmed_by_webhook` + `order_id = null` passes. Every other status fails/no-ops without Order. |
| Idempotency key | `CheckoutCompletionLog.idempotency_key` is deterministic, unique and derived from `payment_intent_id` or explicitly `cart_id + payment_intent_id`. |
| Replay | Replaying the same Stripe success/event returns existing `order_id` and creates no second Order. |
| Concurrency | Parallel attempts to consume the same confirmed PaymentAttempt produce one completed log, one Order and one `PaymentAttempt.order_id`. |
| Transaction | Order creation, completed `CheckoutCompletionLog`, and `PaymentAttempt.order_id` update commit together or fail together. |
| State decoupling | New Order has `order_status = confirmed` and `payment_status = captured`; refund logic is absent. |
| Snapshot | Every Order LineItem has immutable `metadata.gelato_snapshot` matching contract v1. |
| Snapshot failure | Invalid/missing Gelato metadata blocks Order creation and records sanitized `CheckoutCompletionLog.failed`. |
| Webhook continuity | Existing Phase 05 webhook guarantees remain green: raw body, signature, WebhookEventLog dedup and PaymentAttempt confirmation. |
| Downstream absence | No `purchase_completed`, Gelato, email, analytics outbox, refund or Stripe CLI real smoke. |

## Per-Plan Verification Map

| Plan | Wave | Requirement | Test Type | Command | Gate |
|------|------|-------------|-----------|---------|------|
| 06-01 | 1 | ORD-02 | unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts` | Review schema/contract before Order entrypoint. |
| 06-02 | 2 | ORD-01 | unit + source grep | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-order-eligibility.unit.spec.ts src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts` | Review exact eligibility and single internal entrypoint before creating Order. |
| 06-03 | 3 | ORD-01, ORD-02, ORD-03, CAT-04 | unit + HTTP | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "idempotent|concurrent|statuses|correlation|gelato_snapshot"` | Review transactional Order creation that already requires LineItem snapshots. |
| 06-04 | 4 | ORD-01, ORD-02, CAT-04 | unit + HTTP | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "gelato_snapshot|immutability|snapshot failure|edge"` | Review snapshot immutability, failure and edge-case hardening before final validation. |
| 06-05 | 5 | ORD-01, ORD-02, ORD-03 | full validation | Unit + HTTP + build + greps below | Manual gate before Phase 07. |

## Negative Proofs Required

For negative `git grep` proofs, interpret exit codes as: `1` = PASS/no matches, `0` = FAIL/matches found, `2` = command/path error.

**Shell note:** The `status=$?; test $status -eq 1` idiom is Bash syntax. Wrap every negative grep in `bash -lc '...'` so proofs run correctly from Fish (or any non-Bash shell).

No Storefront checkout completion or public Order creation path:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\\[id\\]/complete|createOrderWorkflow|completeCartWorkflow" -- src/api/store src/modules/checkout; status=$?; test $status -eq 1'
```

No downstream Phase 07+ effects in Phase 06 runtime scope:

```bash
bash -lc 'cd apps/backend && git grep -n -E "purchase_completed|AnalyticsEventLog|posthog|EmailDeliveryLog|resend|order\\.gelatoapis\\.com|gelato_order_id|create.*Fulfillment|refund|Refund" -- src/api/hooks src/modules src/workflows integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

No Stripe CLI smoke or prohibited payload persistence in Phase 06 runtime/tests (vocabulary grep — excludes `.planning` so docs may describe prohibitions without false positives):

```bash
bash -lc 'cd apps/backend && git grep -n -E "stripe listen|stripe trigger|whsec_|sk_test_|sk_live_|client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|Authorization|cookies" -- src/modules/checkout-completion src/workflows/order src/api/hooks/stripe integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

No real secrets embedded in Phase 06 planning docs (shape grep — allows docs to say "do not persist `client_secret`" but fails on actual `whsec_…`, `sk_test_…`, etc.):

```bash
bash -lc 'git grep -n -E "whsec_[A-Za-z0-9]{8,}|sk_(test|live)_[A-Za-z0-9]{8,}|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]{8,}|00020126[0-9A-Z]{20,}" -- .planning/phases/06-idempotent-webhook-driven-order-creation; status=$?; test $status -eq 1'
```

Positive source proof that completion is internal-only:

```bash
cd apps/backend && git grep -n -E "payment_confirmed_by_webhook|CheckoutCompletionLog|checkout_completion|gelato_snapshot|order_status|payment_status" -- src/modules src/workflows integration-tests/http/stripe-webhook-order-creation.spec.ts
```

## Required Unit Tests

- `buildCheckoutCompletionIdempotencyKey` is deterministic and rejects missing `payment_intent_id`.
- `CheckoutCompletionLog` statuses and sanitized metadata reject secrets/raw payloads.
- Unique/idempotency behavior returns existing `order_id` for completed log.
- `assertPaymentAttemptEligibleForOrderCreation` accepts only `payment_confirmed_by_webhook` + `order_id = null`.
- Every non-eligible `PaymentAttempt` status is tested as negative.
- Confirmed attempt with existing `order_id` is idempotent/no-op, not second Order.
- Concurrent consumers of same idempotency key produce one winner.
- Snapshot builder is invoked for every item and failures block Order creation.
- State recomputation sets `order_status = confirmed` and `payment_status = captured` independently.

## Required HTTP Integration Tests

- Valid `payment_intent.succeeded` webhook for eligible attempt creates one Order.
- Duplicate webhook event does not create a second Order.
- Two concurrent webhook deliveries create one Order and one completed `CheckoutCompletionLog`.
- Stale/invalid status attempts do not create Order.
- Failed/canceled/Pix-expired attempts never create Order.
- Cart changed/invalidated attempt never creates Order.
- Created Order correlates back to `PaymentAttempt.order_id`.
- `CheckoutCompletionLog` correlates `cart_id`, `payment_intent_id`, `payment_attempt_id`, `order_id`.
- Order line items include `metadata.gelato_snapshot`.
- Later variant metadata edit does not alter existing order line item snapshot.
- No `purchase_completed`, Gelato, email, analytics or refund records/strings appear in the response/evidence.

## Acceptance Criteria

- ORD-01: `Order` is created only by the canonical post-webhook internal flow.
- ORD-02: `CheckoutCompletionLog` prevents duplicate `Order` creation under replay and concurrency.
- ORD-03: `order_status` and `payment_status` are decoupled and transactionally recomputed for the new `Order`.
- `PaymentAttempt.order_id` is set only in the same transaction as Order creation/completion log.
- All Order LineItems have immutable Gelato snapshot metadata.
- Phase 07+ effects are absent and proved by greps/tests.
- `06-05-SUMMARY.md` stops at manual gate before Phase 07.

## Manual-Only Verifications

| Behavior | Why Manual | Instruction |
|----------|------------|-------------|
| Migration application | Schema changes real DB. | Review generated migration and apply only after explicit human approval. |
| Stripe CLI smoke | Requires local Stripe CLI secret and real/test PaymentIntent alignment. | Do not run in Phase 06 planning or automated execution unless separately approved. |
| Phase 07 start | `purchase_completed` is a new phase. | Start only after human acceptance of Phase 06 summary/closure. |

## Sign-Off State

This validation document is planning-only. No tests were executed during planning. Execution remains blocked until explicit user approval.
