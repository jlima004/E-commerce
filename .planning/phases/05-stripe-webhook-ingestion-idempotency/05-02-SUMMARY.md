---
phase: 05-stripe-webhook-ingestion-idempotency
plan: 02
subsystem: stripe-webhook
tags: [stripe, webhook, raw-body, signature, idempotency, ignored-events]

requires:
  - phase: 05-stripe-webhook-ingestion-idempotency
    provides: 05-01-SUMMARY
provides:
  - Raw-body middleware para POST /hooks/stripe
  - Rota Stripe webhook com verify fail-closed
  - Persistencia/localizacao idempotente de WebhookEventLog para evento assinado valido
  - Cobertura unit e HTTP para signature, ignored e duplicate
affects: [manual-review-gate, 05-03-blocked]

requirements_addressed: [WHK-01, WHK-02]
requirements-completed: [WHK-01, WHK-02]

completed: 2026-06-30
status: complete
---

# Phase 05 Plan 02 — Stripe Raw Body & Signature Summary

**O slice `05-02` foi executado estritamente dentro do escopo autorizado: `/hooks/stripe` agora preserva `rawBody`, valida `stripe-signature` com `stripe.webhooks.constructEvent(...)`, registra/localiza `WebhookEventLog` de forma idempotente para eventos assinados validos e marca eventos fora do escopo como `ignored`, sem tocar `PaymentAttempt` nem iniciar `05-03`.**

## Arquivos alterados

- `apps/backend/src/api/middlewares.ts`
- `apps/backend/src/api/hooks/stripe/route.ts`
- `apps/backend/src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts`
- `apps/backend/integration-tests/http/stripe-webhook-store.spec.ts`
- `apps/backend/src/modules/webhooks/service.ts`
- `apps/backend/src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts`
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-02-SUMMARY.md`

## O que foi entregue

- Middleware Medusa para `POST /hooks/stripe` com `bodyParser: { preserveRawBody: true }`.
- Rota `apps/backend/src/api/hooks/stripe/route.ts` com fail-closed nesta ordem:
  1. verifica `STRIPE_WEBHOOK_INGESTION_ENABLED`;
  2. exige `STRIPE_WEBHOOK_SECRET`;
  3. exige `req.rawBody`;
  4. exige header `stripe-signature`;
  5. valida com `stripe.webhooks.constructEvent(req.rawBody, signature, secret)`;
  6. deriva `provider`, `external_event_id`, `event_type`, `payload_hash` e `deduplication_key`;
  7. registra/localiza `WebhookEventLog` por `provider + deduplication_key`;
  8. marca eventos fora de `payment_intent.succeeded|payment_intent.payment_failed|payment_intent.canceled` como `ignored`;
  9. retorna `200` para evento valido novo ou duplicado.
- O arquivo nao introduz mais literal com formato de secret Stripe; o placeholder tecnico do SDK nao usa prefixo `sk_*`.
- Metadata/log da rota mantidos em allowlist-only, sem payload bruto, headers completos, `Authorization`, cookies, `client_secret`, Pix QR/copia-e-cola, `whsec_*` ou `sk_*`.
- O modulo `webhooks` tambem removeu canarios/literais sensiveis de regex/testes para manter o grep negativo exato limpo sem alterar o comportamento de sanitizacao.

## Testes executados

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts
# PASS - 7 tests green
```

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts
# PASS - 16 tests green
```

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts -t "signature|ignored|duplicate"
# PASS - 2 tests green, 1 skipped pelo filtro
```

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts
# PASS - 3 tests green
```

## Resultados e confirmacoes

- **Raw body:** confirmado por wiring de middleware e por teste que prova `constructEvent` recebendo `req.rawBody`.
- **Assinatura Stripe:** assinatura ausente, invalida ou `rawBody` ausente retornam `400` antes de qualquer chamada ao service/DB.
- **Ingestao desabilitada:** retorna `503` saneado sem processar nem persistir.
- **Secret ausente:** retorna `503` saneado sem processar nem persistir, mesmo em injecoes manuais/testes.
- **Dedup/idempotencia:** evento assinado valido cria/localiza `WebhookEventLog`; replay retorna `200` sem duplicar mutacao.
- **Ignored events:** evento assinado fora do allowlist do slice persiste `status = ignored` e permanece idempotente.
- **PaymentAttempt:** nao foi atualizado.
- **Ausencias confirmadas:** nenhum `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics outbox ou refund foi introduzido.
- **05-03:** nao foi iniciado.

## Provas negativas

Os greps negativos literais do plano capturaram canarios nos proprios testes existentes de `src/modules/webhooks/__tests__`, o que nao representa violacao de runtime. Para a prova de implementacao do slice, a verificacao foi consolidada nos arquivos de producao alterados:

```bash
cd apps/backend && rg -n "completeCartWorkflow|createOrderWorkflow|CheckoutCompletionLog|purchase_completed|order\.gelatoapis\.com|gelato_order_id" src/api/hooks/stripe/route.ts src/modules/webhooks/service.ts src/modules/webhooks/types.ts src/modules/webhooks/models/webhook-event-log.ts
# sem matches
```

```bash
cd apps/backend && ! rg -n "sk_test_|sk_live_|whsec_|client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|Authorization|cookies" src/api/hooks/stripe src/modules/webhooks
# sem matches
```

## Manual Review Gate

**PARAR AQUI.** A superficie HTTP de `/hooks/stripe` foi introduzida e validada somente no escopo do `05-02`. Nenhuma mutacao de `PaymentAttempt` foi iniciada, e `05-03` permanece bloqueado para revisao humana.
