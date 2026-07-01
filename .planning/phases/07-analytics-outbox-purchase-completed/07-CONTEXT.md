---
phase: 07
artifact: context
status: planning_manual_gate
generated_at: 2026-07-01T00:00:00-03:00
scope: context-research-plan-only
phase_name: analytics-outbox-purchase-completed
---

# Phase 07 - Analytics Outbox (`purchase_completed`) - Context

## Phase Boundary

Planejar a criacao de um evento local duravel `purchase_completed` apos uma `Order` confirmada pela Phase 06.

A Phase 07 nao muda a regra de nascimento da `Order`: pedido continua nascendo somente pelo caminho interno pos-webhook canonico Stripe, consumindo `PaymentAttempt.status = payment_confirmed_by_webhook` com `PaymentAttempt.order_id = null` e usando `CheckoutCompletionLog` como idempotencia da criacao de `Order`.

## Accepted Input State From Phase 06

Phase 06 esta completa e aceita no manual gate. A Phase 07 deve assumir como verdade:

- `Order` so nasce via webhook canonico Stripe.
- `CheckoutCompletionLog` garante idempotencia da criacao de `Order`.
- `PaymentAttempt.order_id` esta correlacionado ao `Order`.
- `Order.metadata.order_status = confirmed`.
- `Order.metadata.payment_status = captured`.
- `LineItem.metadata.gelato_snapshot` e obrigatorio e imutavel.

## In Scope

- Definir o modulo/modelo `AnalyticsEventLog` como outbox local duravel.
- Definir o contrato do evento `purchase_completed`.
- Definir idempotency key local para `purchase_completed`.
- Planejar quando o evento e gravado em relacao a `Order`, `PaymentAttempt` e `CheckoutCompletionLog`.
- Definir payload minimo permitido, sem PII e sem payload bruto de Stripe/Pix.
- Definir status locais do outbox.
- Definir que downstream futuro depende da existencia local duravel do evento, nao de PostHog.
- Planejar relay assincrono para PostHog em plano separado.
- Definir falhas, retry e recuperacao quando a `Order` ja existe mas o outbox ainda nao foi registrado.
- Definir greps negativos contra Email, Gelato, refund, tracking e fulfillment nesta fase.

## Explicitly Out of Scope

- Implementar codigo durante este ciclo de planejamento.
- Alterar runtime durante este ciclo de planejamento.
- Alterar testes durante este ciclo de planejamento.
- Criar migration real durante este ciclo de planejamento.
- Aplicar migration ou rodar `medusa db:migrate`.
- Executar Stripe CLI smoke.
- Chamar PostHog real.
- Criar relay real durante este ciclo de planejamento.
- Enviar email, criar `EmailDeliveryLog` ou chamar Resend.
- Chamar Gelato, criar fulfillment, `gelato_order_id` ou webhook Gelato.
- Implementar refund, exchange, tracking ou Admin refund flow.
- Iniciar execucao de qualquer plano `07-*`.

## Required Event Contract

Evento canonico:

```text
event_name = purchase_completed
event_version = 1
```

Idempotency key primaria planejada:

```text
purchase_completed:stripe:{payment_intent_id}
```

Regras:

- A key deriva do `PaymentAttempt.provider_payment_intent_id` aceito pela Phase 06.
- Deve haver unique local em `event_name + idempotency_key`.
- Deve haver protecao adicional para `event_name + order_id`, para detectar divergencia em retry/recovery.
- O evento local e considerado gate de negocio quando existe em status `recorded` ou posterior.
- PostHog nao participa da decisao de Order criada, Order valida, Email, Gelato, fulfillment ou downstream.

## Minimal Allowed Payload

Payload minimo permitido para `AnalyticsEventLog.payload`:

```json
{
  "event_name": "purchase_completed",
  "event_version": 1,
  "occurred_at": "ISO-8601",
  "order_id": "order_...",
  "cart_id": "cart_...",
  "payment_attempt_id": "payatt_...",
  "checkout_completion_log_id": "chkcpl_...",
  "payment_intent_id": "pi_...",
  "payment_method_type": "card|pix",
  "amount": 9900,
  "currency_code": "brl",
  "order_status": "confirmed",
  "payment_status": "captured",
  "item_count": 1,
  "items": [
    {
      "variant_id": "variant_...",
      "sku": "SKU",
      "quantity": 1,
      "unit_price": 9900,
      "subtotal": 9900
    }
  ]
}
```

`payment_intent_id` e permitido como correlacao operacional porque ja e a chave canonica da idempotencia do dinheiro; nao persistir `client_secret` nem payload Stripe bruto.

## Forbidden Payload Data

`AnalyticsEventLog.payload`, `metadata`, erros, logs, testes e docs de exemplo nao podem conter:

- `client_secret`, secrets Stripe, `whsec_*`, `sk_test_*`, `sk_live_*`, assinatura Stripe ou raw headers.
- Payload bruto Stripe, `PaymentIntent` completo, `next_action`, QR Pix, copia-e-cola Pix, hosted instructions URL.
- Dados completos de cartao.
- CPF/CNPJ, `federal_tax_id`, endereco completo, telefone, email completo, nome completo.
- Cookies, Authorization, session id, IP, user-agent bruto.
- Tracking token em texto puro.
- `LineItem.metadata.gelato_snapshot` completo dentro do payload de analytics.
- Gelato API key, Gelato payload, `gelato_order_id`.
- Refund payloads ou dados de Admin refund/exchange.

## Planned Local Statuses

`AnalyticsEventLog.status`:

- `recorded`: evento local gravado de forma duravel; este e o gate minimo para downstream.
- `queued`: relay selecionou o evento para entrega assincrona.
- `sending`: tentativa em andamento; usado para concorrencia/lock.
- `sent`: PostHog aceitou a entrega.
- `failed`: falha transiente; elegivel para retry.
- `dead_letter`: falha persistente apos limite; nao bloqueia Order nem downstream que depende somente do evento local.

## Relationship With Existing Phase 06 State

- `Order`: fonte de `order_id`, `order_status`, `payment_status`, totais e itens.
- `PaymentAttempt`: fonte de `payment_attempt_id`, `provider_payment_intent_id`, `payment_method_type`, `amount`, `currency_code` e correlacao `order_id`.
- `CheckoutCompletionLog`: fonte de idempotencia da criacao de Order e referencia para recovery; `AnalyticsEventLog` nao substitui `CheckoutCompletionLog`.
- `AnalyticsEventLog`: outbox de dominio para `purchase_completed`; e posterior a Order confirmada, mas deve ser gravado na mesma unidade transacional planejada da conclusao do nascimento aceito da Order.

## Implementation Decisions

- **D-01:** `AnalyticsEventLog` e um modulo customizado isolado, nao uma tabela solta dentro de `checkout-completion`.
- **D-02:** `purchase_completed` e um evento de dominio backend, nao evento frontend e nao callback de PostHog.
- **D-03:** Idempotency key primaria: `purchase_completed:stripe:{payment_intent_id}`.
- **D-04:** Unique local: `event_name + idempotency_key`; unique/guard adicional: `event_name + order_id`.
- **D-05:** A gravacao local do outbox acontece somente depois de `Order` confirmada e correlacionada, nunca antes de `Order` existir.
- **D-06:** A unidade de sucesso de Phase 07 e `Order` confirmada + `AnalyticsEventLog.recorded`; sucesso PostHog nao faz parte desse gate.
- **D-07:** Downstream futuro consulta existencia local duravel do evento, com `status in recorded|queued|sending|sent|failed|dead_letter`, nunca `status = sent`.
- **D-08:** Relay para PostHog fica em plano separado e nao pode bloquear Order creation, Email, Gelato ou downstream.
- **D-09:** Payload e allowlist-only, minimo, sem PII, secrets, Pix instructions, Stripe raw payload, Gelato payload ou refund data.
- **D-10:** Falhas transientes de PostHog marcam `failed` e incrementam retry, sem reverter `Order` e sem remover o gate local.
- **D-11:** Se uma `Order` ja existir por recovery da Phase 06 e faltar `AnalyticsEventLog`, retry deve criar o evento local idempotentemente antes de considerar a Phase 07 completa para aquela Order.
- **D-12:** Phase 07 nao inicia Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke ou migration real neste ciclo de planejamento.

## Canonical References

- `.planning/ROADMAP.md` - Phase 07 goal, ANL-01..ANL-03 and success criteria.
- `.planning/REQUIREMENTS.md` - ANL-01, ANL-02, ANL-03.
- `.planning/STATE.md` - Phase 07 planning-ready, execution blocked.
- `.planning/phases/06-idempotent-webhook-driven-order-creation/06-CLOSURE.md` - accepted Phase 06 handoff.
- `.planning/phases/06-idempotent-webhook-driven-order-creation/06-05-SUMMARY.md` - final validation and negative proofs.
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` - current canonical Order creation entrypoint.
- `apps/backend/src/modules/checkout-completion/*` - existing idempotency/outbox-like local pattern.
- `apps/backend/src/modules/payment-attempt/*` - accepted payment attempt state and `order_id` correlation.

## Scope Fence

Este ciclo cria somente artefatos de planejamento. Nenhum plano `07-*` deve ser executado antes de revisao humana explicita.
