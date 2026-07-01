---
phase: 08
artifact: context
status: planning_manual_gate
generated_at: 2026-07-01T00:00:00-03:00
scope: context-research-plan-only
phase_name: transactional-email-resend
---

# Phase 08 - Transactional Email (Resend) - Context

## Phase Boundary

Planejar o e-mail transacional de confirmacao de pedido via Resend, depois de uma `Order` confirmada e depois da existencia duravel local de `purchase_completed` em `AnalyticsEventLog`.

A Phase 08 nao muda a regra de nascimento da `Order`: pedido continua nascendo somente pelo caminho interno pos-webhook canonico Stripe, consumindo `PaymentAttempt.status = payment_confirmed_by_webhook` com `PaymentAttempt.order_id = null`, usando `CheckoutCompletionLog` como idempotencia da criacao de `Order`, e preservando `LineItem.metadata.gelato_snapshot` obrigatorio e imutavel.

## Accepted Input State From Phase 07

Phase 07 esta completa e aceita no manual gate. A Phase 08 deve assumir como verdade:

- `Order` so nasce via webhook canonico Stripe.
- `CheckoutCompletionLog` garante idempotencia da criacao de `Order`.
- `PaymentAttempt.order_id` esta correlacionado ao `Order`.
- `LineItem.metadata.gelato_snapshot` e obrigatorio e imutavel.
- `AnalyticsEventLog.purchase_completed` e gravado localmente.
- Downstream depende da existencia duravel local de `purchase_completed`.
- PostHog nao e gate de negocio.
- `AnalyticsEventLog.status = sent` nao e requisito downstream.

## In Scope

- Definir modulo/modelo/contrato de `EmailDeliveryLog`.
- Definir registro runtime real do modulo `EmailDeliveryLog` no Medusa.
- Definir o e-mail canonico de confirmacao de pedido.
- Definir idempotency key local e Resend-safe para confirmacao.
- Planejar quando o registro local de e-mail e criado.
- Planejar quando o envio Resend ocorre.
- Definir payload minimo permitido para o e-mail.
- Definir dados proibidos em payload, metadata, logs e exemplos.
- Definir fonte canonica do e-mail do cliente.
- Definir template e variaveis permitidas.
- Definir retry/backoff/dead-letter.
- Definir regra de nao duplicidade em replay/concurrency.
- Definir comportamento fail-closed quando o modulo `EmailDeliveryLog` estiver ausente ou mal configurado.
- Definir que e-mail nao e gate para `Order`.
- Definir que e-mail ocorre depois de `purchase_completed` local duravel.
- Definir que Gelato so podera ser tentado em fase futura depois do e-mail de confirmacao, sem chamar Gelato nesta fase.
- Definir greps negativos contra Gelato, fulfillment, refund, tracking e Stripe CLI nesta fase.

## Explicitly Out of Scope

- Implementar codigo durante este ciclo de planejamento.
- Alterar runtime durante este ciclo de planejamento.
- Alterar testes durante este ciclo de planejamento.
- Instalar `resend`.
- Alterar `package.json`.
- Alterar lockfile.
- Criar ou aplicar migration real.
- Rodar `medusa db:migrate`.
- Chamar Resend real.
- Enviar e-mail real.
- Chamar PostHog real.
- Executar Stripe CLI smoke.
- Chamar Gelato.
- Criar fulfillment.
- Persistir `gelato_order_id`.
- Implementar refund.
- Implementar exchange.
- Implementar tracking.
- Iniciar Phase 09.
- Executar qualquer plano `08-*`.

## Required Email Contract

E-mail canonico:

```text
email_type = order_confirmation
template_key = order_confirmation_v1
template_version = 1
provider = resend
```

Idempotency key planejada:

```text
order-confirmation/{order_id}
```

Regras:

- O modulo runtime deve ser registrado com key sem hifen:

```text
key: "email_delivery_log"
resolve: "./src/modules/email-delivery-log"
```

- Se o registry real do projeto exigir outra forma, a implementacao deve documentar a forma usada e preservar `key: "email_delivery_log"`.
- `EmailDeliveryLog` deve existir no container real do app, nao apenas por injecao em testes.
- A key deriva do `Order.id` confirmado e e segura para a API Resend.
- Deve haver unique local em `email_type + idempotency_key`.
- Deve haver guard adicional para `email_type + order_id`, evitando mais de uma confirmacao ativa por `Order`.
- O registro local deve ser criado somente depois que `purchase_completed` local existir em status duravel aceito por Phase 07.
- O envio Resend deve usar a mesma idempotency key.
- Replay/concurrency deve reusar o mesmo `EmailDeliveryLog`, nunca enviar duplicado.
- `EmailDeliveryLog.status = sent` nao valida `Order`; `Order` ja e valida antes do e-mail.
- Phase 09 Gelato deve esperar o e-mail de confirmacao ter ocorrido com sucesso (`sent`) ou uma decisao operacional futura explicita. Phase 08 nao implementa essa decisao nem chama Gelato.

## Planned Local Statuses

`EmailDeliveryLog.status`:

- `recorded`: registro local duravel criado; envio externo ainda nao chamado.
- `queued`: relay selecionou o e-mail para entrega.
- `sending`: tentativa em andamento.
- `sent`: Resend aceitou a entrega e retornou um id de mensagem.
- `failed`: falha transiente; elegivel para retry.
- `dead_letter`: falha persistente apos limite; nao bloqueia `Order`, mas bloqueia Gelato automatico ate decisao operacional futura.

## When The Local Email Record Is Created

O registro local `EmailDeliveryLog` deve ser criado:

1. Depois que a `Order` existe e esta confirmada.
2. Depois que `PaymentAttempt.order_id` esta correlacionado.
3. Depois que `CheckoutCompletionLog` esta completo.
4. Depois que `purchase_completed` local existe em `AnalyticsEventLog` com status duravel aceito pela Phase 07.
5. Antes de qualquer tentativa futura de Gelato.
6. Antes de qualquer chamada Resend.

Se uma `Order` ja existir por recovery e `purchase_completed` local existir, mas `EmailDeliveryLog` ainda nao existir, retry deve criar/reusar o registro de e-mail idempotentemente antes de considerar a Phase 08 localmente enfileirada para aquela `Order`.

Se o modulo `EmailDeliveryLog` estiver ausente ou mal configurado, o fluxo deve falhar de forma estavel/sanitizada. Esse caso nao pode ser sucesso silencioso, nao pode considerar o webhook/order entrypoint completamente processado, nao pode chamar Resend, nao pode iniciar Gelato e deve permitir retry/recovery posterior. Quando possivel, o modulo deve ser validado antes de chamar `completeCartWorkflow`.

Para recovery de `Order` existente: `Order` existente + `purchase_completed` existente + `EmailDeliveryLog` ausente + modulo indisponivel tambem deve falhar de forma estavel, sem sucesso silencioso.

## When Resend Sending Occurs

O envio Resend ocorre somente em relay assincrono futuro:

1. Selecionar `EmailDeliveryLog.status in recorded|failed` com `next_retry_at <= now`.
2. Resolver a `Order` por `order_id`.
3. Ler o e-mail canonico do cliente a partir de `Order.email`.
4. Montar payload transitorio allowlist-only para Resend.
5. Chamar `resend.emails.send(..., { idempotencyKey })`.
6. Marcar `sent` com `provider_message_id` quando Resend aceitar.
7. Marcar `failed`/`dead_letter` com erro sanitizado quando falhar.

Ausencia de config Resend nao deve reverter `Order`, nao deve apagar `purchase_completed` e nao deve iniciar Gelato. Ela deve impedir apenas o envio externo e manter o registro local auditavel para retry quando aprovado/configurado.

## Canonical Customer Email Source

Fonte canonica:

```text
Order.email
```

Regras:

- Usar somente o e-mail persistido na `Order` confirmada.
- Nao usar Stripe `billing_details`, webhook payload, request body, cookie, session, header, PaymentAttempt metadata ou Cart como fonte canonica do destinatario.
- Se `Order.email` estiver ausente ou invalido, nao chamar Resend; registrar falha sanitizada em `EmailDeliveryLog`.
- `EmailDeliveryLog` nao deve persistir o e-mail completo. Para auditoria, usar `recipient_email_hash` e opcionalmente `recipient_email_domain`, se aprovado no plano de execucao.

## Minimal Allowed Email Payload

Payload transitorio permitido para Resend:

```json
{
  "from": "<RESEND_FROM_EMAIL>",
  "to": ["<Order.email resolved at send time>"],
  "subject": "Pedido confirmado",
  "html": "<template renderizado allowlist-only>",
  "text": "template em texto allowlist-only"
}
```

Variaveis permitidas no template:

```json
{
  "order_id": "order_...",
  "order_reference": "order_...",
  "amount": 9900,
  "currency_code": "brl",
  "item_count": 1,
  "items": [
    {
      "sku": "SKU",
      "quantity": 1,
      "unit_price": 9900,
      "subtotal": 9900
    }
  ],
  "support_email": "<SUPPORT_EMAIL>"
}
```

Observacao: o destinatario completo e necessario para chamada Resend, mas deve ser payload transitorio do relay, nao campo persistido em `EmailDeliveryLog.payload`/`metadata`.

## Forbidden Data

`EmailDeliveryLog`, payload persistido, metadata, erros, logs, testes e docs de exemplo nao podem persistir:

- `RESEND_API_KEY` ou Authorization header.
- E-mail completo do cliente em payload/metadata/log.
- Nome completo, telefone, CPF/CNPJ, `federal_tax_id`, endereco completo, shipping/billing address.
- `client_secret`, secrets Stripe, `whsec_*`, `sk_test_*`, `sk_live_*`, assinatura Stripe ou raw headers.
- Payload bruto Stripe, `PaymentIntent` completo, `next_action`, QR Pix, copia-e-cola Pix, hosted instructions URL.
- Dados completos de cartao.
- Cookies, session id, IP, user-agent bruto.
- Tracking token em texto puro.
- `LineItem.metadata.gelato_snapshot` completo no payload de e-mail ou log.
- Gelato API key, Gelato payload, `gelato_order_id`.
- Refund, exchange ou Admin operational payloads.

## Implementation Decisions

- **D-01:** `EmailDeliveryLog` e um modulo customizado isolado, nao uma extensao de `AnalyticsEventLog`.
- **D-02:** O e-mail de confirmacao depende de `Order` confirmada e de `purchase_completed` local duravel.
- **D-03:** PostHog nao participa do gate de e-mail; `AnalyticsEventLog.status = sent` nao e requisito.
- **D-04:** Idempotency key canonica: `order-confirmation/{order_id}`.
- **D-05:** Unique local: `email_type + idempotency_key`; guard adicional: `email_type + order_id`.
- **D-06:** `EmailDeliveryLog.recorded` e criado antes de qualquer chamada Resend.
- **D-07:** Resend e chamado somente por relay assincrono, nunca no caminho que valida `Order`.
- **D-08:** `Order.email` e a unica fonte canonica do destinatario.
- **D-09:** E-mail completo do cliente nao deve ser persistido no `EmailDeliveryLog`; usar hash para auditoria.
- **D-10:** Payload/template e allowlist-only e nao contem dados sensiveis, Pix, Stripe raw, Gelato, tracking, refund ou endereco.
- **D-11:** Falha Resend nao reverte `Order`, nao remove `purchase_completed` e nao chama Gelato.
- **D-12:** Gelato automatico futuro deve ocorrer somente depois do e-mail de confirmacao enviado (`sent`) ou de uma decisao operacional futura explicita; Phase 08 nao implementa Gelato.
- **D-13:** Phase 08 nao instala dependencia, nao altera runtime, nao executa testes, nao aplica migration e nao chama servicos externos durante este planejamento.
- **D-14:** `EmailDeliveryLog` deve ser registrado no runtime real do Medusa com `key: "email_delivery_log"`; ausencia ou ma configuracao do modulo e falha estavel, nunca sucesso silencioso.

## Canonical References

- `.planning/ROADMAP.md` - Phase 08 goal, EMAIL-01..EMAIL-02 and Phase 09 dependency.
- `.planning/REQUIREMENTS.md` - EMAIL-01 and EMAIL-02.
- `.planning/STATE.md` - Phase 07 complete; Phase 08 planning-ready.
- `.planning/phases/07-analytics-outbox-purchase-completed/07-CLOSURE.md` - accepted Phase 07 handoff.
- `.planning/phases/07-analytics-outbox-purchase-completed/07-03-SUMMARY.md` - final `purchase_completed` and PostHog non-gate evidence.
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` - current canonical Order creation and local downstream gate boundary.
- `apps/backend/src/modules/analytics-event-log/*` - accepted `purchase_completed` local gate pattern.
- `apps/backend/src/jobs/analytics-posthog-relay.ts` - accepted async relay/retry/dead-letter pattern.

## Scope Fence

Este ciclo cria somente artefatos de planejamento. Nenhum plano `08-*` deve ser executado antes de revisao humana explicita.
