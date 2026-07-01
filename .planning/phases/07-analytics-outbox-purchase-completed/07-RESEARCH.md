---
phase: 07
artifact: research
status: planning_manual_gate
generated_at: 2026-07-01T00:00:00-03:00
scope: planning-only
phase_name: analytics-outbox-purchase-completed
---

# Phase 07 - Research

## Research Question

Como adicionar `purchase_completed` como outbox local duravel depois da `Order` confirmada, preservando a regra de nascimento da `Order`, a idempotencia de Phase 06 e a independencia de PostHog?

## Local Findings

### Existing Order Creation Boundary

O ponto natural para Phase 07 e `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`.

Esse fluxo ja:

- carrega `PaymentAttempt` por id;
- valida `provider_payment_intent_id`;
- exige `payment_confirmed_by_webhook`;
- cria/recupera `CheckoutCompletionLog`;
- cria ou recupera `Order`;
- persiste `Order.metadata.order_status = confirmed`;
- persiste `Order.metadata.payment_status = captured`;
- correlaciona `PaymentAttempt.order_id`;
- recupera falhas parciais quando `Order` ja existe.

Phase 07 deve adicionar o outbox nessa fronteira, sem criar outro entrypoint de `Order` e sem chamar Store completion fora do fluxo aceito.

### Existing Module Pattern

`CheckoutCompletionLog` estabelece o padrao local para:

- `model.define(...)` em modulo customizado;
- unique/indexes no model e migration draft;
- helper puro para idempotency key;
- allowlist de metadata;
- erro sanitizado;
- unit tests focados no contrato;
- migration draft sem aplicar `medusa db:migrate` automaticamente.

`AnalyticsEventLog` deve seguir esse padrao em vez de criar uma dependencia direta em PostHog ou em outro modulo.

### Dependency State

`apps/backend/package.json` ainda nao contem `posthog-node`.

Implicacao para planejamento:

- `07-01` e `07-02` nao precisam instalar PostHog; eles entregam o outbox local e o gate duravel.
- `07-03` deve isolar a instalacao/configuracao do SDK e o relay, porque ANL-03 e separado de ANL-01/ANL-02.
- O relay deve ser opcional/fail-closed em configuracao ausente para nao impedir o registro local.

## Documentation Findings

### Medusa v2

A documentacao atual do Medusa v2 descreve custom features como composicao de modulo, workflow e API route, e tambem mostra workflows sendo executados a partir de API routes, subscribers e scheduled jobs. A mesma fonte descreve o workflow engine como responsavel por registrar transacoes/status de workflows, com Redis recomendado em producao para execucao confiavel.

Uso para Phase 07:

- `AnalyticsEventLog` deve ser modulo customizado local.
- A gravacao transacional do outbox deve viver no workflow/entrypoint de Order, nao em callback externo.
- O relay assincrono pode ser um scheduled job ou worker/subscriber, mas nao deve ser parte do caminho bloqueante do nascimento da Order.

Fonte consultada via Context7: `/medusajs/medusa`, query sobre custom modules, workflows, subscribers, scheduled jobs e workflow engine.

### PostHog Node

A documentacao atual de PostHog para Node mostra captura de evento via cliente Node com `event`, `distinctId`, `properties` e `shutdown()` para drenar eventos. A documentacao tambem indica opcoes de batching como `flushAt` e `flushInterval`; o lifecycle do cliente deve ser gerido pela aplicacao.

Uso para Phase 07:

- `07-03` deve mapear `AnalyticsEventLog.payload` para `client.capture(...)`.
- `distinctId` deve ser nao-PII, preferencialmente `order_id` ou `customer_id` somente se ja for aceito e nao expuser dado sensivel; para MVP, planejar `order_id`.
- `properties` deve vir do payload allowlist-only.
- `shutdown()`/flush deve ser tratado no job/worker para nao perder eventos ao encerrar processo.
- Falha PostHog deve atualizar status local para `failed`, nunca reverter `Order` ou impedir downstream local.

Fonte consultada via Context7: `/websites/posthog` e `/posthog/posthog-js`, queries sobre Node SDK capture, properties, flush/shutdown e batching.

## Proposed Architecture

### Local Module

Criar futuro modulo:

```text
apps/backend/src/modules/analytics-event-log/
  index.ts
  models/analytics-event-log.ts
  service.ts
  types.ts
  migrations/Migration*.ts
  __tests__/analytics-event-log.unit.spec.ts
```

Modelo planejado:

```text
analytics_event_log
- id
- event_name
- event_version
- idempotency_key
- order_id
- cart_id
- payment_attempt_id
- checkout_completion_log_id
- payment_intent_id
- status
- payload
- metadata
- attempt_count
- last_error_code
- last_error_message
- next_retry_at
- recorded_at
- queued_at
- sending_started_at
- sent_at
- failed_at
- dead_lettered_at
- timestamps/deleted_at
```

Indexes/constraints planejados:

- unique `event_name + idempotency_key`;
- unique parcial/logico para `event_name + order_id` quando `event_name = purchase_completed`;
- index por `status + next_retry_at`;
- index por `order_id`;
- index por `payment_attempt_id`;
- index por `checkout_completion_log_id`;
- check/enum de `event_name`, `status` e `event_version`.

### Local Recording

`purchase_completed` deve ser gravado:

1. Depois que a `Order` existe e foi validada como `confirmed/captured`.
2. Depois que `PaymentAttempt.order_id` foi correlacionado ou no mesmo bloco de recovery.
3. Com referencia ao `CheckoutCompletionLog` completo.
4. Antes de retornar sucesso final do entrypoint Phase 07.

Se o fluxo recuperar uma `Order` existente, deve procurar ou criar `AnalyticsEventLog` idempotentemente.

### Downstream Gate

O contrato local para downstream:

```text
canProceedAfterPurchase(order_id) =
  exists AnalyticsEventLog where
    event_name = purchase_completed
    order_id = order_id
    status in recorded|queued|sending|sent|failed|dead_letter
```

Nao usar:

```text
status = sent
PostHog delivery success
PostHog event id
frontend analytics event
```

### Relay

Relay assincrono planejado para `07-03`:

- selecionar `recorded` e `failed` com `next_retry_at <= now`;
- marcar `queued`/`sending` com lock local;
- enviar `purchase_completed` para PostHog;
- marcar `sent` em sucesso;
- marcar `failed` com backoff em falha transiente;
- marcar `dead_letter` em falha persistente;
- nao alterar `Order`, `PaymentAttempt` ou `CheckoutCompletionLog`;
- nao acionar Email, Gelato ou refund.

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Duplicar evento por replay/concurrency | Unique em `event_name + idempotency_key`, guard por `event_name + order_id`, helper puro e teste concorrente. |
| PostHog virar gate de negocio | Separar `recorded` de `sent`; downstream depende de existencia local, nao de delivery. |
| PII/secrets em analytics | Payload allowlist-only, sanitizacao, greps negativos para secrets, Pix instructions, CPF/CNPJ, email e endereco. |
| Order existente sem outbox por falha parcial | Recovery idempotente no entrypoint cria evento faltante antes de considerar sucesso Phase 07. |
| Relay duplicado por jobs concorrentes | Status `sending`, lock/claimed_at e rechecagem por idempotency key. |
| Escopo vazar para Email/Gelato/refund | Greps negativos obrigatorios no runtime scope de Phase 07. |

## Recommendation

Planejar Phase 07 em tres slices:

1. `07-01` - Contrato/modelo/helpers de `AnalyticsEventLog`, payload allowlist e migration draft nao aplicada.
2. `07-02` - Gravacao transacional/idempotente de `purchase_completed` no entrypoint de Order, com gate local para downstream.
3. `07-03` - Relay assincrono PostHog isolado, com retry/backoff e provas de que PostHog nao bloqueia Order/downstream local.

## Manual Gate

Esta pesquisa e planejamento-only. Nenhum codigo, teste, runtime, migration, Stripe CLI smoke, PostHog real, Email, Gelato, fulfillment, refund ou tracking foi executado.
