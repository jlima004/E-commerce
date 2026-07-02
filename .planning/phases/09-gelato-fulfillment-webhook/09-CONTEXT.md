---
phase: 09-gelato-fulfillment-webhook
status: ready-for-planning
created_at: 2026-07-02
manual_review_gate: true
scope: planning-only
branch_decision: "B) Criar/usar branch gsd/phase-09-gelato-fulfillment-webhook"
---

# Phase 09: Gelato Fulfillment & Webhook - Context

## Branch Decision

Decisao registrada antes dos artefatos de planejamento:

```text
B) Criar/usar branch gsd/phase-09-gelato-fulfillment-webhook
```

Branch observada no inicio do planejamento: `gsd/phase-09-gelato-fulfillment-webhook`.

Esta decisao deve permanecer visivel em summaries futuros e no estado documental futuro da Phase 09. A Phase 09 nao deve ser executada em branch cumulativa antiga sem nova decisao humana explicita.

## Phase Boundary

Planejar a Phase 09 sem executar runtime, testes, migrations, instalacao, chamada real Gelato, webhook real, fulfillment real, tracking publico, refund, exchange ou Stripe CLI smoke.

A Phase 09 define como disparar producao Gelato de forma idempotente e auditavel somente depois de:

1. `Order` confirmada.
2. `purchase_completed` local duravel existente em `AnalyticsEventLog`.
3. `EmailDeliveryLog(order_confirmation).status = sent`.
4. Ou uma decisao operacional futura explicita, ainda nao implementada nesta fase.

## Locked Inputs From Previous Phases

- Phase 06 completa:
  - `Order` nasce somente via webhook canonico Stripe.
  - `CheckoutCompletionLog` garante idempotencia de criacao da `Order`.
  - `PaymentAttempt.order_id` esta correlacionado.
  - `LineItem.metadata.gelato_snapshot` e obrigatorio e imutavel.
- Phase 07 completa:
  - `purchase_completed` local e gravado em `AnalyticsEventLog`.
  - Downstream depende da existencia local duravel de `purchase_completed`.
  - PostHog nao e gate.
  - `AnalyticsEventLog.status = sent` nao e requisito downstream.
- Phase 08 completa:
  - `EmailDeliveryLog(order_confirmation)` e gravado localmente.
  - Resend nao e gate de `Order`.
  - `EmailDeliveryLog.status = sent` nao valida `Order`.
  - Gelato automatico futuro exige `EmailDeliveryLog(order_confirmation).status = sent` ou decisao operacional explicita.
  - `dead_letter` de e-mail nao autoriza Gelato automatico.
- Phase 08 hardening:
  - corrigiu create real de `EmailDeliveryLog` sem id fixo;
  - corrigiu fallback de SKU no e-mail;
  - corrigiu stale recovery para `queued`/`sending` no relay Resend.

## Implementation Decisions

### D09-01 - Branch

Usar a branch `gsd/phase-09-gelato-fulfillment-webhook` para planejamento e futura execucao, salvo nova decisao humana explicita.

### D09-02 - Order Birth Rule

A Phase 09 nao muda a regra de nascimento da `Order`: somente o fluxo interno pos-webhook Stripe canonico pode criar `Order`.

### D09-03 - Fulfillment Local Aggregate

Modelar um agregado local de fulfillment Gelato por `Order`, planejado como `GelatoFulfillment`/`gelato_fulfillment`, com idempotency key, status local, referencias auditaveis e resposta Gelato saneada.

### D09-04 - Single-Active Guard

Uma `Order` nao pode ter mais de um fulfillment Gelato ativo. `connectedOrderIds` da Gelato representam partes conectadas de um unico fulfillment local, nao multiplos fulfillments independentes.

### D09-05 - Dispatch Idempotency

A idempotency key local do dispatch Gelato sera `gelato-dispatch:{order_id}`. Como a documentacao consultada nao confirmou um header oficial de idempotencia Gelato, a deduplicacao primaria sera local e transacional.

### D09-06 - Snapshot Source

O payload transiente para Gelato deve ser construido somente a partir de `LineItem.metadata.gelato_snapshot` capturado na Phase 06, nunca de metadata mutavel do catalogo atual.

### D09-07 - Eligibility Gate

Dispatch automatico para Gelato so fica elegivel quando existirem `Order` confirmada, `purchase_completed` local duravel e `EmailDeliveryLog(order_confirmation).status = sent`.

### D09-08 - Email Failure

`EmailDeliveryLog.status = dead_letter` nao autoriza Gelato automatico. `recorded`, `queued`, `sending` e `failed` tambem bloqueiam dispatch automatico.

### D09-09 - Operational Override Future

Um override operacional futuro pode autorizar Gelato sem e-mail `sent`, mas a Phase 09 deve apenas reservar o contrato documental e bloquear a execucao automatica sem implementa-lo.

### D09-10 - Async Dispatch And Minimal Operator Alert

Dispatch Gelato deve ser assincrono, com eligibility scan, claim local, chamada externa injetavel/fake em testes, retry/backoff e dead-letter para falha persistente.

Para fechar `FUL-04` sem iniciar o modulo amplo `OperationalAlert` da Phase 12, a Phase 09 implementa alerta operacional minimo no proprio `GelatoFulfillment`:

- `requires_operator_attention`
- `operator_alert_code`
- `operator_alert_message`
- `operator_alerted_at`

Contrato: falha persistente de Gelato deve marcar `status = dead_letter` e `requires_operator_attention = true`, com codigo/mensagem saneados e recuperacao futura por retry/recovery operacional. Isso nao cria o modulo `OperationalAlert` amplo da Phase 12.

### D09-11 - Gelato Webhook

Webhook Gelato deve reutilizar o padrao `WebhookEventLog` com `provider = gelato`, dedupe por event `id` quando presente, fallback por hash somente quando permitido, e update idempotente do fulfillment local por `orderReferenceId`/`orderId`.

Eventos oficiais Gelato usam underscores. Para Phase 09 MVP aceitar apenas `order_status_updated`. Demais eventos documentados (`order_item_status_updated`, `order_item_tracking_code_updated`, `order_delivery_estimate_updated`, `store_product_template_*`, `store_product_*`) permanecem fora do MVP, salvo decisao futura explicita.

### D09-12 - Webhook Authenticity (Resolved Documentally)

**Resolvido documentalmente (2026-07-02)** via dashboard/API Portal Gelato:

- Dashboard Gelato possui Authorization checkbox, Authorization Type **HTTP Header**, Header Name e Header Value configuraveis.
- Nao ha HMAC/signature/timestamp confirmado.
- Nao reutilizar `GELATO_API_KEY` como webhook secret.

Mecanismo escolhido:

- Header dedicado: `X-GELATO-WEBHOOK-SECRET`
- Env backend: `GELATO_WEBHOOK_AUTH_HEADER_NAME`
- Env backend: `GELATO_WEBHOOK_SECRET`

Contrato de implementacao (`09-04`):

- Rejeitar antes de qualquer DB side effect se header ausente ou incorreto (fail-closed).
- Replay/dedupe via `WebhookEventLog` usando `payload.id`; `payload_hash` apenas fallback seguro.
- Execucao de `09-04` permanece bloqueada ate aprovacao humana explicita, mas o blocker de autenticidade documental esta resolvido.

### D09-13 - Canonical Status And Tracking

A fonte canonica local para status/tracking sera o registro de fulfillment Gelato, atualizado pelo webhook Gelato validado. Phase 09 nao expoe tracking publico; Phase 10 continua responsavel por rota publica tokenizada.

### D09-14 - Sensitive Data

Nao persistir raw body, Authorization, cookies, headers integrais, `X-API-KEY`, payload Gelato completo, `client_secret`, Pix QR/copia-e-cola, CPF/CNPJ puro, endereco completo, e-mail completo, telefone, tracking token ou `gelato_snapshot` integral em metadata/logs. Dados obrigatorios para Gelato, como `federalTaxId` no Brasil, podem existir apenas no payload transiente de saida e devem ficar fora dos registros persistidos.

### D09-15 - Out Of Scope

Refund, exchange, tracking publico, Stripe CLI smoke, PostHog real, Resend real, Gelato real, migrations reais e Phase 10 permanecem fora do escopo.

### D09-16 - Gelato Relay Stale In-Flight Recovery

O relay Gelato deve tratar estados in-flight stale de forma conservadora.
`queued` e `dispatching`/`submitted` nao podem gerar redispatch cego se houver risco de chamada externa ja realizada.

Se o estado indicar possivel chamada externa sem `gelato_primary_order_id` persistido, o fluxo deve:

- tentar reconciliacao oficial por `orderReferenceId` quando suportado e documentado;
- ou marcar o `GelatoFulfillment` para atencao operacional;
- nunca criar outro pedido Gelato automaticamente sem prova de que nenhum pedido externo foi aceito.

## Requirements Covered

- `FUL-01`
- `FUL-02`
- `FUL-03`
- `FUL-04`
- `WHK-03`

## Canonical References

Downstream planning/execution must read:

- `.planning/ROADMAP.md` - Phase 09 goal, dependencies and success criteria.
- `.planning/STATE.md` - manual gate, branch policy and previous phase state.
- `.planning/REQUIREMENTS.md` - `FUL-01..FUL-04`, `WHK-03`, invariant requirements.
- `.planning/phases/06-idempotent-webhook-driven-order-creation/06-CLOSURE.md` - accepted Order birth rule and immutable Gelato snapshot.
- `.planning/phases/07-analytics-outbox-purchase-completed/07-CLOSURE.md` - durable local `purchase_completed` downstream gate.
- `.planning/phases/08-transactional-email-resend/08-CLOSURE.md` - email sent gate and dead-letter exclusion for future Gelato.
- `.planning/phases/08-transactional-email-resend/08-HARDENING-SUMMARY.md` - Phase 08 hardening reference for real `EmailDeliveryLog` create, SKU fallback and Resend relay stale recovery.
- `apps/backend/src/modules/webhooks/*` - existing `WebhookEventLog` pattern.
- `apps/backend/src/modules/analytics-event-log/*` - `purchase_completed` local gate pattern.
- `apps/backend/src/modules/email-delivery-log/*` - confirmation email status and relay pattern.
- `apps/backend/src/jobs/email-resend-relay.ts` - scheduled job claim/send/failure style to mirror.
- `apps/backend/src/modules/catalog/gelato-snapshot.ts` - immutable snapshot shape consumed by Order line items.

## Manual Gate

Produzir somente planejamento completo da Phase 09 e parar. Nenhum plano desta fase pode ser executado sem aprovacao humana explicita.
