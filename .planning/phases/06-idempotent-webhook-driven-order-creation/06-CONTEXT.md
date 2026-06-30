---
phase: 06
artifact: context
status: planning_manual_gate
generated_at: 2026-06-30T17:15:00-03:00
scope: context-research-plan-only
phase_name: idempotent-webhook-driven-order-creation
---

# Phase 06 - Idempotent Webhook-Driven Order Creation - Context

## Phase Boundary

Criar `Order` de forma idempotente somente a partir da confirmacao financeira local deixada pela Phase 05:

```text
PaymentAttempt.status = payment_confirmed_by_webhook
PaymentAttempt.order_id = null
```

Esse e o unico estado consumivel pela Phase 06. Nenhum outro estado de `PaymentAttempt` pode criar `Order`, e nenhum endpoint de checkout/storefront pode concluir cart ou criar pedido.

## In Scope

- `CheckoutCompletionLog` como entidade customizada de idempotencia interna da operacao `complete_checkout_create_order`.
- Um unico ponto de entrada backend, chamado apenas apos o webhook Stripe canonico confirmar o `PaymentAttempt`.
- Idempotency key por `payment_intent_id` preferencialmente, ou `cart_id + payment_intent_id` se a implementacao provar necessidade operacional.
- Criacao de `Order` a partir do cart confirmado, sem expor rota storefront de completion.
- Correlacao transacional entre `Order`, `CheckoutCompletionLog`, `PaymentAttempt.order_id` e dados financeiros capturados.
- Estados desacoplados no `Order`: `order_status = confirmed` e `payment_status = captured` no nascimento do pedido.
- Persistencia de `LineItem.metadata.gelato_snapshot` com o shape canonico de `buildGelatoSnapshot`.
- Testes unitarios, integracao HTTP e provas negativas para replay/concurrency e fronteiras de fase.

## Explicitly Out of Scope

- Executar codigo, aplicar migration ou rodar `medusa db:migrate` durante planejamento.
- Criar `Order` em runtime durante planejamento.
- Criar endpoint de checkout/storefront que conclua cart ou crie `Order`.
- Iniciar Phase 07.
- Implementar ou persistir `purchase_completed`.
- Implementar Gelato fulfillment, Gelato API, Gelato webhook ou `gelato_order_id`.
- Implementar e-mail, Resend ou `EmailDeliveryLog`.
- Implementar analytics outbox, PostHog ou `AnalyticsEventLog`.
- Implementar refund, exchange ou Admin refund flow.
- Executar Stripe CLI smoke real.

## Accepted Input State From Phase 05

Phase 05 foi aceita no manual gate. O webhook Stripe atual:

- Verifica assinatura com raw body em `POST /hooks/stripe`.
- Deduplica eventos em `WebhookEventLog` por `provider + deduplication_key`.
- Para `payment_intent.succeeded`, atualiza somente `PaymentAttempt.status = payment_confirmed_by_webhook`.
- Mantem `PaymentAttempt.order_id = null`.
- Nao cria `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, email, analytics ou refund.

## Existing Code Facts

- `apps/backend/src/modules/payment-attempt/models/payment-attempt.ts` ja possui `order_id` nullable e indices por `cart_id`, `status` e `provider_payment_intent_id`.
- `apps/backend/src/modules/payment-attempt/types.ts` ja define `payment_confirmed_by_webhook`.
- `apps/backend/src/modules/payment-attempt/state-machine.ts` trata `payment_confirmed_by_webhook` como ativo e ainda proibe `order_id` por helpers de Phase 05.
- `apps/backend/src/modules/payment-attempt/service.ts` tem `assertAttemptEligibleForFutureOrder`, mas hoje ele so rejeita `superseded` e `invalidated_by_cart_change`; Phase 06 deve endurecer para exigir exatamente `payment_confirmed_by_webhook` + `order_id = null`.
- `apps/backend/src/api/hooks/stripe/route.ts` atualiza `PaymentAttempt` e marca `WebhookEventLog` como `processed`; ali esta o ponto natural para acionar o workflow interno, depois da confirmacao local.
- `apps/backend/src/modules/catalog/gelato-snapshot.ts` fornece `buildGelatoSnapshot`, que deve ser chamado no momento de criacao do pedido.
- `apps/backend/src/api/store/carts/query-config.ts` lista os campos de cart/variant necessarios para checkout pre-Order; Phase 06 deve garantir variant `id`, `sku` e `metadata` ao montar snapshots.

## Implementation Decisions

- **D-01:** O ponto unico de entrada planejado e um workflow/service interno de Order creation acionado apenas pelo caminho canonico pos-webhook, nunca por rota Store.
- **D-02:** A precondicao deve ser atomica: `PaymentAttempt.status = payment_confirmed_by_webhook AND order_id IS NULL`.
- **D-03:** Qualquer tentativa em `created`, `awaiting_pix_payment`, `payment_failed`, `payment_canceled`, `pix_expired`, `superseded`, `invalidated_by_cart_change` ou outro estado deve falhar/no-op sem `Order`.
- **D-04:** `CheckoutCompletionLog` e camada de idempotencia interna, distinta de `WebhookEventLog`.
- **D-05:** `CheckoutCompletionLog.idempotency_key` deve ser unica e derivada de `provider_payment_intent_id` (`payment_intent_id`) por padrao.
- **D-06:** Em replay com `CheckoutCompletionLog.status = completed`, retornar/reusar `order_id` existente e nao criar novo `Order`.
- **D-07:** Em concorrencia, o banco/lock transacional vence; nao confiar em check-then-act em memoria.
- **D-08:** A criacao de `Order`, atualizacao de `CheckoutCompletionLog` e `PaymentAttempt.order_id` deve ocorrer em uma unica transacao ou workflow step transacional equivalente.
- **D-09:** O nascimento do pedido deve registrar `order_status = confirmed` e `payment_status = captured`; refunds futuros nao podem alterar automaticamente `order_status`.
- **D-10:** `LineItem.metadata.gelato_snapshot` deve ser preenchido no momento da Order usando o contrato `Gelato Snapshot v1`.
- **D-11:** Se snapshot Gelato falhar para qualquer line item, nao criar `Order` parcial; registrar falha em `CheckoutCompletionLog`.
- **D-12:** `purchase_completed` fica totalmente fora da Phase 06; a Phase 07 adicionara o outbox depois.

## Canonical References

- `.planning/STATE.md` - Phase 06 planning permitted, execution blocked.
- `.planning/ROADMAP.md` - Phase 06 goal, ORD-01..ORD-03 and success criteria.
- `.planning/REQUIREMENTS.md` - ORD-01, ORD-02, ORD-03 pending.
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-CLOSURE.md` - accepted handoff state.
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-VALIDATION.md` - negative proof boundary before Phase 06.
- `docs/DB_MODEL_v1.21.md` sections 4.3, 4.4, 4.5, 4.8 and 5.2 - PaymentAttempt, CheckoutCompletionLog, WebhookEventLog, Order statuses and LineItem snapshot.
- `docs/contracts/gelato-snapshot-v1.md` - immutable snapshot payload.
- `apps/backend/src/api/hooks/stripe/route.ts` - current webhook stop point.
- `apps/backend/src/modules/payment-attempt/*` - state machine, service and model.
- `apps/backend/src/modules/catalog/gelato-snapshot.ts` - canonical snapshot builder.

## Scope Fence

Planning may describe runtime files to be created later, but this cycle must create only planning artifacts. Execution must stop after these documents until explicit human approval.
