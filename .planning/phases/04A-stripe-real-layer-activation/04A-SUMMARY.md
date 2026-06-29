---
phase: 04A-stripe-real-layer-activation
status: manual-gate
completed: 2026-06-29
scope: stripe-real-test-mode-initiation-only
requires:
  - phase: 04-stripe-payments-payment-attempt
    state: implementation-test-complete-production-activation-blocked
provides:
  - RealStripeCardInitiationLayer
  - RealStripePixInitiationLayer
  - STRIPE_REAL_INITIATION_ENABLED safe internal registration
  - PaymentAttempt migration prepared-not-applied review
blocks:
  - phase: 05-stripe-webhook-ingestion-idempotency
---

# Gate 04A — Stripe Real Layer Activation Summary

## Outcome

Gate `04A-stripe-real-layer-activation` is complete and stopped at manual gate.

Stripe real initiation is now available only through the Phase 04 safe boundary:

- `RealStripeCardInitiationLayer` creates real/test-mode card PaymentIntents from server-derived cart amount/currency.
- `RealStripePixInitiationLayer` creates confirmed real/test-mode Pix PaymentIntents in BRL with configured TTL via `payment_method_options.pix.expires_after_seconds`.
- `STRIPE_CARD_INITIATION_LAYER` and `STRIPE_PIX_INITIATION_LAYER` are registered by an internal loader only when `STRIPE_REAL_INITIATION_ENABLED=true` and `STRIPE_SECRET_KEY` is a `sk_test_...` key.
- Native-first Medusa Stripe remains rejected; no Medusa Stripe provider activation was introduced.

## Boundary Guarantees

- Raw Stripe PaymentIntent is still filtered only by `stripe-safe.ts` before persistence.
- `PaymentAttempt` remains the only pre-webhook persistence record touched by card/Pix initiation.
- `client_secret`, Pix QR/copia-e-cola, hosted instructions, and integral `next_action` are response-only DTO concerns.
- `PaymentSession.data`, if consumed later, remains allowlist-only via the existing safe projection.
- `PaymentAttempt` is persisted before any successful HTTP response in the existing card/Pix routes; DB/migration/service failure aborts before success.

## Migration State

- `20260629000000-create-payment-attempt.ts` was reviewed and marked `PREPARED`.
- Migration was not applied by this gate.
- `npm run db:migrate:safe -- --check-only` passed with a direct/session `DATABASE_MIGRATION_URL` shape.
- A real database migration still requires human approval and a real direct/session migration URL.

## Verification

```bash
TMPDIR=/tmp npm run test:unit
# 18 suites passed, 288 tests passed

TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts
# 1 suite passed, 29 tests passed

HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully

DATABASE_MIGRATION_URL=postgresql://migrate:migrate@127.0.0.1:5432/medusa npm run db:migrate:safe -- --check-only
# PASS
```

Negative grep proof:

```bash
! rg -n "WebhookEventLog|CheckoutCompletionLog|purchase_completed|order\\.gelatoapis\\.com|gelato_order_id|completeCartWorkflow|createOrderWorkflow|completeCart" \
  src/modules/payment-attempt "src/api/store/carts/[id]/payment-attempts" src/loaders \
  --glob '!**/__tests__/**'

! rg -n "\\\"client_secret\\\"|client_secret:|clientSecret|pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+|next_action|pix_display_qr_code|copy_paste|qr_code|hosted_instructions_url|00020126" \
  src/modules/payment-attempt/models src/migrations/20260629000000-create-payment-attempt.ts

! rg -n "paymentIntents\\.create|new Stripe|payment_method_types|confirm: true" \
  src --glob '!src/modules/payment-attempt/stripe-real.ts' \
  --glob '!src/modules/payment-attempt/stripe-safe.ts' \
  --glob '!**/__tests__/**'

! rg -n "webhooks?/stripe|hooks/payment|WebhookEventLog|CheckoutCompletionLog" \
  src --glob '!**/__tests__/**'
# PASS
```

## Explicit Non-Scope Proof

- No Stripe webhook route was created.
- No Order creation path was created.
- No `WebhookEventLog` or `CheckoutCompletionLog` was created.
- No `purchase_completed` event was emitted or persisted.
- No Gelato code, call, webhook, or `gelato_order_id` path was introduced.
- Phase 05 was not started.

## Manual Gate

PARAR AQUI.

Next action requires human approval before any real DB migration execution, webhook ingestion, Order creation, analytics outbox, email, Gelato, or Phase 05 work.
