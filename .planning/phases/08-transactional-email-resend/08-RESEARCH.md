---
phase: 08
artifact: research
status: planning_manual_gate
generated_at: 2026-07-01T00:00:00-03:00
scope: planning-only
phase_name: transactional-email-resend
---

# Phase 08 - Research

## Research Question

Como adicionar e-mail transacional de confirmacao via Resend depois de `Order` confirmada e depois de `purchase_completed` local duravel, preservando idempotencia, auditoria, privacidade, a regra de nascimento da `Order`, e a separacao antes de Gelato?

## Local Findings

### Existing Order And Downstream Boundary

O ponto natural para criar o registro local `EmailDeliveryLog` e o mesmo limite onde a Phase 07 ja garante `purchase_completed` local:

```text
apps/backend/src/workflows/order/webhook-order-entrypoint.ts
```

Esse fluxo ja:

- carrega `PaymentAttempt`;
- exige `payment_confirmed_by_webhook`;
- cria/reusa `CheckoutCompletionLog`;
- cria/reusa `Order`;
- correlaciona `PaymentAttempt.order_id`;
- grava/reusa `AnalyticsEventLog.purchase_completed`;
- define gate local downstream independente de PostHog.

Phase 08 deve adicionar o enqueue local de e-mail depois do gate `purchase_completed`, sem criar outro entrypoint de `Order` e sem chamar Resend nesse caminho.

### Existing Local Module Pattern

`CheckoutCompletionLog` e `AnalyticsEventLog` estabelecem o padrao local para:

- modulo customizado isolado;
- `model.define(...)`;
- service/helper puro;
- types explicitos;
- migration draft revisavel;
- unique/idempotency key;
- payload allowlist-only;
- erro sanitizado;
- testes unitarios de contrato;
- relay assincrono com retry/dead-letter quando ha chamada externa.

`EmailDeliveryLog` deve seguir o padrao de `AnalyticsEventLog`, adaptado para e-mail:

- registro local primeiro;
- relay externo depois;
- status local auditavel;
- idempotency key compartilhada com Resend;
- proibicao de dados sensiveis persistidos.

O modulo tambem deve ser registrado no runtime real do Medusa, nao apenas injetado em testes. O contrato planejado para `medusa-config.ts` e:

```text
key: "email_delivery_log"
resolve: "./src/modules/email-delivery-log"
```

Se o registry real do projeto exigir outra forma, a execucao deve documentar a forma usada e manter a key sem hifen.

### Dependency State

`apps/backend/package.json` ainda nao contem `resend`.

Implicacao para planejamento:

- `08-01` e `08-02` nao devem instalar Resend.
- `08-03` e o unico plano que podera adicionar `resend` quando execucao futura for aprovada.
- Este ciclo de planejamento nao altera `package.json` nem lockfile.

### Canonical Email Source

O e-mail a enviar deve vir de `Order.email` porque:

- a `Order` ja e o objeto confirmado e aceito depois do webhook canonico;
- a Phase 08 roda depois da criacao da `Order`;
- Stripe/webhook payload nao e fonte de dados de cliente para comunicacao;
- request body, session e headers nao sao fontes confiaveis nesse ponto.

Para auditoria, `EmailDeliveryLog` deve evitar persistir o e-mail completo. O log pode armazenar hash do destinatario e metadados nao sensiveis, mas o relay deve resolver `Order.email` no momento da chamada Resend.

## Documentation Findings

### Resend

A documentacao atual da Resend mostra envio via Node SDK com `resend.emails.send(...)` e suporte a idempotency key. O exemplo usa `idempotencyKey` junto da chamada de envio, e a API tambem aceita `Idempotency-Key` para evitar duplicidade em retries. A documentacao indica key unica por request e limite de ate 256 caracteres; o formato recomendado e do tipo `<event-type>/<entity-id>`.

Uso para Phase 08:

- usar `order-confirmation/{order_id}` como key curta, deterministica e especifica;
- passar a mesma key para Resend;
- registrar `provider_message_id` apenas em sucesso;
- nao persistir API key ou headers;
- tratar retorno `{ id }` como identificador do provider, nao como gate de `Order`.

Fonte consultada via Context7: `/websites/resend`, query sobre Node SDK, `emails.send`, `idempotencyKey`, response fields e retries.

### Medusa v2

A documentacao atual do Medusa v2 mostra subscribers executando workflows e side effects, incluindo exemplo de workflow de confirmacao de pedido chamado a partir de evento `order.placed`. Tambem preserva o modelo modular de custom features via modules, workflows/subscribers/jobs.

Uso para Phase 08:

- manter `EmailDeliveryLog` como modulo customizado;
- usar workflow/job/subscriber apenas como mecanismo de orquestracao, sem criar novo caminho de Order;
- preferir relay assincrono em worker/scheduled job para chamada Resend;
- manter chamada externa fora do caminho que valida `Order`.

Fonte consultada via Context7: `/medusajs/medusa`, query sobre custom modules, subscribers, workflows, scheduled jobs e side effects de e-mail.

## Proposed Architecture

### Local Module

Criar futuro modulo:

```text
apps/backend/src/modules/email-delivery-log/
  index.ts
  models/email-delivery-log.ts
  service.ts
  types.ts
  migrations/Migration*.ts
  __tests__/email-delivery-log.unit.spec.ts
```

Modelo planejado:

```text
email_delivery_log
- id
- email_type
- template_key
- template_version
- provider
- idempotency_key
- order_id
- cart_id
- payment_attempt_id
- checkout_completion_log_id
- analytics_event_log_id
- payment_intent_id
- status
- recipient_email_hash
- recipient_email_domain
- payload
- metadata
- provider_message_id
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

- unique `email_type + idempotency_key`;
- unique/guard `email_type + order_id`;
- index por `status + next_retry_at`;
- index por `order_id`;
- index por `analytics_event_log_id`;
- index por `payment_attempt_id`;
- check/enum de `email_type`, `provider`, `status` e `template_version`.

### Local Enqueue

`EmailDeliveryLog` deve ser gravado:

1. Depois que `Order` existe.
2. Depois que `purchase_completed` local existe e satisfaz o gate da Phase 07.
3. Com referencia ao `AnalyticsEventLog` local.
4. Com idempotency key `order-confirmation/{order_id}`.
5. Com `status = recorded`.
6. Sem chamar Resend.

Se o fluxo recuperar `Order` existente e `purchase_completed` local, deve procurar ou criar `EmailDeliveryLog` idempotentemente.

Antes do enqueue local, a execucao deve validar que o modulo `EmailDeliveryLog` esta disponivel no runtime real. Quando possivel, validar antes de chamar `completeCartWorkflow`. Se o modulo estiver ausente ou mal configurado, o resultado deve ser falha estavel/sanitizada: nao considerar o webhook/order entrypoint completamente processado, nao chamar Resend, nao iniciar Gelato e permitir retry/recovery posterior. O mesmo vale para recovery com `Order` existente + `purchase_completed` existente + `EmailDeliveryLog` ausente + modulo indisponivel.

### Resend Relay

Relay assincrono planejado para `08-03`:

- selecionar `recorded` e `failed` com `next_retry_at <= now`;
- marcar `queued`/`sending` com lock local;
- resolver `Order.email`;
- montar payload transitorio do template;
- chamar `resend.emails.send` com `idempotencyKey`;
- marcar `sent` com `provider_message_id` em sucesso;
- marcar `failed` com backoff em falha transiente;
- marcar `dead_letter` em falha persistente;
- nao alterar `Order`, `PaymentAttempt`, `CheckoutCompletionLog` ou `AnalyticsEventLog`;
- nao chamar Gelato, fulfillment, refund, tracking ou Stripe CLI.

### Gelato Boundary

Phase 08 nao chama Gelato e nao cria fulfillment.

Contrato planejado para Phase 09:

```text
Automatic Gelato dispatch is eligible only after:
  Order confirmed
  purchase_completed local exists
  EmailDeliveryLog(order_confirmation).status = sent
```

`dead_letter` nao valida envio automatico. Uma decisao operacional futura podera definir override manual, mas isso nao e Phase 08.

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| E-mail duplicado por replay/concurrency | Unique `email_type + idempotency_key`, guard `email_type + order_id`, Resend `idempotencyKey`, teste concorrente. |
| Resend virar gate de Order | Criar `EmailDeliveryLog` depois de `Order` e tratar falha Resend sem reverter Order. |
| Gelato iniciar antes do e-mail | Registrar contrato para Phase 09 exigir `EmailDeliveryLog.status = sent` antes do dispatch automatico. |
| PII em log de e-mail | Nao persistir e-mail completo; usar hash/domain opcional; payload allowlist-only. |
| Fonte errada do destinatario | Usar somente `Order.email`; rejeitar Stripe payload, request body, session, headers. |
| Resend indisponivel | Retry/backoff/dead-letter; erro sanitizado; `Order` e `purchase_completed` permanecem intactos. |
| `EmailDeliveryLog` existe apenas em teste e nao no runtime real | Registrar modulo no `medusa-config.ts`, exigir build no `08-02` e teste unitario `EmailDeliveryLog module missing or misconfigured -> no silent success`. |
| Modulo `EmailDeliveryLog` ausente/mal configurado vira sucesso silencioso | Falhar de forma estavel/sanitizada, nao retornar sucesso de enqueue, nao chamar Resend, nao iniciar Gelato e preservar retry/recovery. |
| Escopo vazar para Gelato/refund/tracking | Greps negativos obrigatorios no runtime scope de Phase 08. |

## Recommendation

Planejar Phase 08 em tres slices:

1. `08-01` - Contrato/modelo/helpers de `EmailDeliveryLog`, idempotencia, payload/template allowlist e migration draft nao aplicada.
2. `08-02` - Enqueue local de confirmacao depois de `Order` + `purchase_completed` local, sem Resend.
3. `08-03` - Relay assincrono Resend, retry/backoff/dead-letter e validacao final da Phase 08.

## Manual Gate

Esta pesquisa e planning-only. Nenhum codigo, teste, runtime, migration, Stripe CLI smoke, PostHog real, Resend real, e-mail real, Gelato, fulfillment, refund ou tracking foi executado.
