---
phase: 06
artifact: research
status: planning_manual_gate
generated_at: 2026-06-30T17:15:00-03:00
scope: planning-only-no-runtime-changes
phase_name: idempotent-webhook-driven-order-creation
---

# Phase 06 - Research

## Scope

Esta pesquisa cobre apenas o desenho de criacao idempotente de `Order` a partir de `PaymentAttempt` confirmado por webhook Stripe. Ela nao implementa runtime, nao aplica migrations, nao executa testes, nao cria `Order` e nao inicia fases downstream.

## Sources Read

- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-CONTEXT.md`
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-RESEARCH.md`
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-VALIDATION.md`
- `docs/DB_MODEL_v1.21.md`
- `docs/contracts/gelato-snapshot-v1.md`
- `apps/backend/src/api/hooks/stripe/route.ts`
- `apps/backend/src/modules/payment-attempt/models/payment-attempt.ts`
- `apps/backend/src/modules/payment-attempt/types.ts`
- `apps/backend/src/modules/payment-attempt/state-machine.ts`
- `apps/backend/src/modules/payment-attempt/service.ts`
- `apps/backend/src/modules/payment-attempt/migrations/Migration20260629000000.ts`
- `apps/backend/src/modules/webhooks/models/webhook-event-log.ts`
- `apps/backend/src/modules/webhooks/types.ts`
- `apps/backend/src/modules/checkout/checkout-data.ts`
- `apps/backend/src/api/store/carts/query-config.ts`
- `apps/backend/src/modules/catalog/gelato-snapshot.ts`
- `apps/backend/integration-tests/http/stripe-webhook-store.spec.ts`
- Context7 `/medusajs/medusa` docs for `completeCartWorkflow`, workflow locking and line-item metadata copy behavior.

## Current Runtime Boundary

`POST /hooks/stripe` currently:

1. Requires `STRIPE_WEBHOOK_INGESTION_ENABLED`.
2. Requires `STRIPE_WEBHOOK_SECRET`.
3. Requires raw body and `stripe-signature`.
4. Constructs the Stripe event from raw body.
5. Creates/dedupes `WebhookEventLog`.
6. For supported PaymentIntent events, finds `PaymentAttempt` by `provider_payment_intent_id`.
7. Applies `payment_intent.succeeded` -> `payment_confirmed_by_webhook`.
8. Marks the webhook log `processed` with `entity_type = payment_attempt`.

It does not call any cart completion or Order workflow today.

## PaymentAttempt Findings

### Model

`PaymentAttempt` has:

- `cart_id`
- `payment_collection_id`
- nullable `payment_session_id`
- nullable `provider_payment_intent_id`
- `payment_method_type = card | pix`
- `status`
- `amount`
- `currency_code`
- nullable `order_id`

The prepared migration has:

- unique partial index on `provider_payment_intent_id` when non-null.
- one-active-attempt-per-cart partial index where active statuses include `payment_confirmed_by_webhook`.
- `status` check including `payment_confirmed_by_webhook`.
- `currency_code = 'brl'`.

### State Machine

`payment_confirmed_by_webhook` is reachable from:

- `card_client_secret_created`
- `payment_client_confirmed`
- `awaiting_pix_payment`
- `awaiting_webhook_confirmation`

Today it can transition to:

- `superseded`
- `invalidated_by_cart_change`

This is acceptable before Order creation, but Phase 06 must re-check status inside the transaction because cart mutation or payment restart could stale a confirmed attempt before it is consumed.

### Guard Gap

`assertAttemptEligibleForFutureOrder` currently rejects only:

- `invalidated_by_cart_change`
- `superseded`

Phase 06 must replace or harden it so the only eligible shape is:

```text
status = payment_confirmed_by_webhook
order_id = null
provider = stripe
provider_payment_intent_id is not null
amount > 0
currency_code = brl
```

`assertOrderIdMustStayNull` and helpers like `withPaymentAttemptStatus` were correct for Phase 05 but must not keep forcing `order_id = null` for the final correlation step. The Phase 06 plan should introduce a narrow helper for "link confirmed attempt to order" rather than weakening all pre-Order guards.

## WebhookEventLog vs CheckoutCompletionLog

`WebhookEventLog` is already the external-event idempotency layer:

- Provider event deduplication.
- Signature-verified Stripe event audit.
- Status of ingestion/processing.

It does not prevent duplicate `Order` creation if different Stripe events or retried internal work reach the same confirmed `PaymentAttempt`. `CheckoutCompletionLog` is required as the internal operation idempotency layer:

- `operation = complete_checkout_create_order`
- `idempotency_key` unique.
- `cart_id`
- `payment_intent_id`
- `payment_attempt_id`
- `order_id`
- `status = processing | completed | failed`
- safe metadata such as `stripe_event_id` and `payment_method_type`

The recommended `idempotency_key` is `payment_intent_id`. If implementation discovers a real collision risk or local test factory ambiguity, use `cart_id + payment_intent_id`, but keep `payment_intent_id` independently indexed and tested.

## Medusa Order Creation Findings

Context7 docs confirm `completeCartWorkflow` is the canonical Medusa v2 cart-to-order flow and can be run as a workflow step. Docs also show `acquireLockStep` / `releaseLockStep` around cart/order workflows in custom flows, and show cart/item metadata copied to order/order line items when the order is placed.

Planning implication:

- Phase 06 may use `completeCartWorkflow.runAsStep({ input: { id: cart_id } })` only inside an internal workflow/service after the eligible `PaymentAttempt` is claimed.
- Phase 06 must not expose or call `/store/carts/:id/complete`.
- If Medusa core completion would create pending-payment semantics, the implementation must adapt or wrap it so the resulting local Order state is `order_status = confirmed` and `payment_status = captured` in the same transactional boundary.
- The plan must verify whether line item metadata can be prepared on cart items before completion or patched onto order line items immediately after order creation inside the same workflow transaction. The accepted invariant is the final persisted Order line items must have `metadata.gelato_snapshot`.

## Cart and Checkout Findings

`calculateCheckoutDataComplete` is derived and pre-Order only. It validates:

- BRL currency.
- BR region/country.
- non-empty positive quantity line items.
- sellable variants when variants are loaded.
- valid email.
- valid Brazil shipping address with CPF/CNPJ in metadata.

Phase 06 should not rely only on the historical payment-start eligibility. It should re-load the cart and relevant line item/variant graph at order time, because catalog metadata may have changed and because a missing variant in the query can bypass sellability checks. Snapshot builder failure must stop order creation.

The existing `storeCartPreOrderFields` includes the variant fields needed by the snapshot builder:

- `items.variant.id`
- `items.variant.sku`
- `items.variant.metadata`
- `items.variant.prices.*`

## Gelato Snapshot Findings

`buildGelatoSnapshot(variant, { capturedAt })`:

- calls `assertSellableVariantMetadata`.
- requires variant `id`.
- requires variant `sku`.
- returns a frozen `GelatoSnapshot`.
- includes `captured_at`.

The contract requires persisting exactly:

```text
LineItem.metadata.gelato_snapshot
```

No field rename, no enrichment, and no future fulfillment should read live `ProductVariant.metadata` for an existing order.

## Transaction and Concurrency Strategy

The planned safe flow is:

1. Webhook confirms `PaymentAttempt`.
2. Internal workflow/service loads the attempt by id or `provider_payment_intent_id`.
3. Transaction starts.
4. Re-check exact eligibility: `payment_confirmed_by_webhook` + `order_id = null`.
5. Insert/claim `CheckoutCompletionLog` with unique `idempotency_key`.
6. If existing completed log has `order_id`, return existing order and no-op.
7. If another transaction owns `processing`, respect lock/unique conflict and retry/no-op according to service contract.
8. Load cart with line items, addresses, payment collection/session and variant data.
9. Build Gelato snapshots for all items using one shared `capturedAt`.
10. Create Order internally.
11. Persist/patch line item snapshots.
12. Persist decoupled statuses: `order_status = confirmed`, `payment_status = captured`.
13. Update `CheckoutCompletionLog.order_id`, `status = completed`, `completed_at`.
14. Update `PaymentAttempt.order_id`.
15. Commit.

If any step after claiming the log fails before an `Order` exists, mark the log `failed` with sanitized error and no `order_id`. If an `Order` may have been created but correlation failed, the implementation must prefer fail-closed/reconciliation over creating a second Order.

## Risks

1. **Duplicate Order from replay/concurrency:** mitigated by unique `CheckoutCompletionLog.idempotency_key`, lock/transaction and tests for parallel calls.
2. **Order from invalid PaymentAttempt state:** mitigated by exact eligibility guard and negative tests for every non-eligible status.
3. **Storefront completion path slips in:** mitigated by no new Store completion endpoint and negative greps for route/core-flow usage outside the internal workflow.
4. **Partial correlation:** mitigated by one transaction for Order, log and attempt link.
5. **Snapshot missing or mutable:** mitigated by requiring `LineItem.metadata.gelato_snapshot` and tests proving later variant metadata edits do not change order line metadata.
6. **Phase creep into downstream effects:** mitigated by negative greps for `purchase_completed`, `AnalyticsEventLog`, `EmailDeliveryLog`, Gelato, refund and PostHog.
7. **Medusa core completion semantics mismatch:** mitigated by an early implementation slice to spike/lock the internal Order creation mechanism and tests that assert final statuses.

## Recommended Slice Breakdown

1. `06-01` - `CheckoutCompletionLog` schema/contract/idempotency key.
2. `06-02` - single internal entrypoint and exact PaymentAttempt eligibility.
3. `06-03` - transactional Order creation, mandatory Gelato snapshots on LineItems, decoupled statuses and correlation.
4. `06-04` - snapshot immutability, failure behavior, edge cases and hardening.
5. `06-05` - validation matrix and negative proofs.

Each slice must stop at a manual review gate. Execution remains blocked until the user explicitly approves it.
