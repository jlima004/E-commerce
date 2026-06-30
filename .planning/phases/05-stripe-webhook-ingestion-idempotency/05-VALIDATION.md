---
phase: 05
slug: stripe-webhook-ingestion-idempotency
status: complete
nyquist_compliant: true
created: 2026-06-30
closed_at: 2026-06-30
manual_review_gate: true
human_review_accepted: true
---

# Phase 05 — Validation Strategy

> Contrato de validacao para Stripe Webhook Ingestion & Idempotency. Esta estrategia prova raw-body signature verification, DB-level dedup e atualizacao local de `PaymentAttempt`, preservando a ausencia de `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics e refund flow.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| Config file | `apps/backend/jest.config.js` |
| Unit command | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-webhook.unit.spec.ts src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts` |
| HTTP command | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts` |
| Build command | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |

## Required Coverage

| Area | Required proof |
|------|----------------|
| Raw body | `/hooks/stripe` route has `bodyParser: { preserveRawBody: true }`; handler passes `req.rawBody` to `constructEvent`. |
| Missing signature | HTTP 400; no `WebhookEventLog` write. |
| Invalid signature | HTTP 400; no `WebhookEventLog` write. |
| Valid signature | HTTP 200; one `WebhookEventLog` row. |
| Dedup | Replay and concurrent duplicate produce one log/mutation. |
| `payment_intent.succeeded` | Correlated `PaymentAttempt.status = payment_confirmed_by_webhook`; `order_id = null`. |
| `payment_intent.payment_failed` | Correlated `PaymentAttempt.status = payment_failed`; no Order. |
| `payment_intent.canceled` | Correlated `PaymentAttempt.status = payment_canceled`; no Order. |
| Unsupported event | `WebhookEventLog.status = ignored`; no business mutation. |
| Missing attempt | Event is recorded safely; no crash and no Order. |
| Amount/currency mismatch | Event is `failed` or safe no-op; no confirmation. |
| Terminal attempt | Superseded/invalidated/failed/canceled/expired attempt is not reactivated. |
| Sensitive data | No raw payload, `client_secret`, Pix QR/copia-e-cola, Authorization/cookies or Stripe secrets in persistence/log docs. |

## Per-Plan Verification Map

| Plan | Wave | Requirement | Test Type | Command | Gate |
|------|------|-------------|-----------|---------|------|
| 05-01 | 1 | WHK-02 | unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts src/config/__tests__/env.unit.spec.ts` | Review schema/config before route. |
| 05-02 | 2 | WHK-01, WHK-02 | unit + HTTP | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts -t "signature|ignored|duplicate"` | Review route before PaymentAttempt mutation. |
| 05-03 | 3 | WHK-02 | unit + HTTP | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-webhook.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts -t "payment_intent"` | Review confirmed state before final validation. |
| 05-04 | 4 | WHK-01, WHK-02 | full validation | Unit + HTTP + build + greps below | Manual gate before Phase 06. |

## Negative Proofs Required

```bash
cd apps/backend && ! rg -n "completeCartWorkflow|createOrderWorkflow|CheckoutCompletionLog|purchase_completed|order\\.gelatoapis\\.com|gelato_order_id|EmailDeliveryLog|AnalyticsEventLog" src/api/hooks src/modules/webhooks src/modules/payment-attempt
```

```bash
cd apps/backend && ! rg -n "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|Authorization|cookies|STRIPE_WEBHOOK_SECRET=.*whsec" src/modules/webhooks src/api/hooks/stripe .planning/phases/05-stripe-webhook-ingestion-idempotency
```

## Acceptance Criteria

- `WHK-01`: assinatura Stripe validada contra raw body; inválidos rejeitados antes de DB.
- `WHK-02`: todo evento válido é registrado em `WebhookEventLog` e deduplicado por unique `provider + deduplication_key`.
- Replays Stripe retornam 200 e não duplicam mutações.
- `payment_intent.succeeded` confirma apenas `PaymentAttempt` com `payment_confirmed_by_webhook`.
- `PaymentAttempt.order_id` segue `null`.
- Nenhum `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics ou refund flow é criado.
- `05-04-SUMMARY.md` encerra em manual gate antes da Phase 06.

## Manual-Only Verifications

| Behavior | Why Manual | Instruction |
|----------|------------|-------------|
| Migration application | Schema muda banco real. | Revisar migration e rodar apenas após aprovação humana. |
| Stripe CLI smoke | Requer secret local do CLI e PaymentIntent correspondente. | Não executar automaticamente; operador fornece env local fora do chat. |
| Phase 06 handoff | Order creation é nova fase. | Só iniciar Phase 06 depois do aceite de `05-04-SUMMARY.md`. |

## Stripe CLI Smoke Plan (Not Executed In Planning)

```bash
stripe listen --forward-to localhost:9001/hooks/stripe
stripe trigger payment_intent.succeeded
```

O smoke real deve ser adaptado para um `PaymentIntent` que corresponda a um `PaymentAttempt` real criado pela rota card/Pix segura. Não registrar `whsec_*`, `sk_*`, `client_secret`, QR Pix ou payload bruto no summary.

## Sign-Off State

Esta estratégia foi executada e encerrada pela Phase 05. A revisão humana foi aceita em 2026-06-30. A Phase 05 está completa no manual gate, e a Phase 06 está liberada.
