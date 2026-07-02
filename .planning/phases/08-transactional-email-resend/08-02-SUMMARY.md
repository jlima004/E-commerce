---
phase: 08
plan: 02
status: completed
manual_review_gate: true
updated_at: 2026-07-01T21:28:00-03:00
---

# 08-02 - Local Confirmation-Email Enqueue After Order And `purchase_completed`

## Escopo executado

Executado somente o plano `.planning/phases/08-transactional-email-resend/08-02-PLAN.md`.

Parada no manual gate após este summary. `08-03` não foi iniciado.

## Arquivos alterados

- `apps/backend/medusa-config.ts`
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts` (criado)
- `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts`
- `apps/backend/src/modules/email-delivery-log/service.ts`
- `.planning/phases/08-transactional-email-resend/08-02-SUMMARY.md`

`apps/backend/src/modules/analytics-event-log/service.ts` não precisou de alteração neste slice.

## Registro runtime `email_delivery_log`

Registrado em `apps/backend/medusa-config.ts` com a key exigida (sem hífen):

```ts
{
  key: "email_delivery_log",
  resolve: "./src/modules/email-delivery-log",
}
```

O módulo continua exportando `EMAIL_DELIVERY_LOG_MODULE = "email-delivery-log"`. O entrypoint resolve ambas as keys em runtime:

```text
email_delivery_log
email-delivery-log
```

## Onde `EmailDeliveryLog` local é criado/reusado

Integração no entrypoint interno pós-webhook:

- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- Função `finalizePostOrderLocalRecords(...)` orquestra:
  1. `ensurePurchaseCompletedRecorded(...)` (precondição)
  2. `ensureOrderConfirmationEmailRecorded(...)` (enqueue local)
- Chamada em todos os caminhos de sucesso:
  - Order criada (`created`)
  - Order reutilizada (`reused_existing_order`)
  - recovery de Order existente (processing / checkout completion reuse / existing order recovery)

Validação fail-closed do módulo ocorre **antes** de `completeCartWorkflow`:

```text
resolveAnalyticsEventLogModule(container)
resolveEmailDeliveryLogModule(container)
```

Erro estável quando ausente/mal configurado:

```text
ORDER_ENTRYPOINT_EMAIL_DELIVERY_LOG_MODULE_UNAVAILABLE
Modulo de email_delivery_log nao configurado.
```

## Idempotency key

```text
buildOrderConfirmationEmailIdempotencyKey({ order_id })
=> order-confirmation/{order_id}
```

Persistida em `EmailDeliveryLog.idempotency_key`.

## Registro local criado

Depois de Order confirmada + `CheckoutCompletionLog` completed + `PaymentAttempt.order_id` correlacionado + `purchase_completed` local durável:

```text
email_type = order_confirmation
template_key = order_confirmation_v1
template_version = 1
provider = resend
idempotency_key = order-confirmation/{order_id}
status = recorded
```

Sem chamada Resend. Sem envio real.

## Precondição `purchase_completed`

`ensureOrderConfirmationEmailRecorded(...)` só executa quando `purchaseCompletedEvent` existe **e** `isPurchaseCompletedLocallyRecorded(...)` é verdadeiro.

Statuses duráveis aceitos (via gate reutilizado de analytics):

```text
recorded | queued | sending | sent | failed | dead_letter
```

Não exige `AnalyticsEventLog.status = sent`, PostHog success, PostHog event id nem evento frontend.

Se `purchase_completed` local durável estiver ausente, **não** cria `EmailDeliveryLog`.

## Fonte canônica `Order.email`

Destinatário lido somente de `Order.email` via `loadOrderForEmailConfirmation` + `extractCanonicalOrderEmail`.

Persistência de auditoria:

```text
recipient_email_hash  (sha256 do e-mail normalizado)
recipient_email_domain
```

E-mail completo **não** entra em `payload`, `metadata`, `last_error_code`, `last_error_message` nem fixtures deste slice.

`support_email` no payload vem de `process.env.SUPPORT_EMAIL` via `resolveOrderConfirmationSupportEmail()` (contato da loja, não destinatário).

## Recovery / replay / concorrência

| Cenário | Comportamento |
|---------|---------------|
| Order existente + `purchase_completed` existente + `EmailDeliveryLog` ausente | retry cria `EmailDeliveryLog` idempotentemente |
| Order existente + `purchase_completed` existente + `EmailDeliveryLog` existente | reuse (sem duplicar) |
| Replay do mesmo webhook | não duplica Order, `AnalyticsEventLog` nem `EmailDeliveryLog` |
| Concorrência | unique constraints + read-after-conflict tratam como idempotência |
| Estados não elegíveis | não criam Order nem `EmailDeliveryLog` |
| `purchase_completed` ausente | não cria `EmailDeliveryLog` |
| Módulo e-mail ausente/mal configurado | erro estável; não chama `completeCartWorkflow`; não chama Resend; não inicia Gelato |

## Fail-closed

- Módulo ausente/mal configurado → `OrderCreationEntrypointError` sanitizado
- Webhook/order entrypoint **não** é tratado como completamente processado
- Sem Resend, sem Gelato, sem fulfillment
- Caso elegível permanece disponível para retry/recovery posterior

## Testes executados

Runtime efetivo (npm do PATH apontava para Windows; usado Node Linux portable):

```bash
export PATH="/tmp/node22/bin:$PATH"
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts
```

Resultado: **8/8 PASS**

Inclui obrigatoriamente:

```text
EmailDeliveryLog module missing or misconfigured -> no silent success
```

Cobertura: não chama Resend; não inicia Gelato; não retorna sucesso de enqueue; erro estável/sanitizado; não chama `completeCartWorkflow` quando módulo ausente.

```bash
export PATH="/tmp/node22/bin:$PATH"
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|EmailDeliveryLog|purchase_completed"
```

Resultado: **5/5 PASS** (5 skipped fora do filtro)

```bash
export PATH="/tmp/node22/bin:$PATH"
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts
```

Resultado: **16/16 PASS** (regressão módulo)

```bash
export PATH="/tmp/node22/bin:$PATH"
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: **PASS** (`Backend build completed successfully`)

## Provas negativas (greps)

| Check | Resultado |
|-------|-----------|
| Sem Resend/Gelato/Fulfillment/Refund/Tracking/Stripe CLI em superfícies do slice | **PASS** (exit 1 = sem matches) |
| Sem Store completion público | **PASS** |
| Sem payload proibido em superfícies de e-mail do slice | **FAIL esperado/informativo** — matches apenas em `src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts` (testes de sanitização herdados de `08-01`) e padrões de redaction em `service.ts` (`phone`, `telephone`, regex `Bearer`). **Nenhum match** em `webhook-order-email-enqueue.unit.spec.ts`. |
| Sem e-mail literal completo nas superfícies do slice | **PASS** (exit 1 = sem matches) |
| `git diff --check` | **PASS** |

### Broad scan informativo

Ocorrências legítimas herdadas fora da superfície de payload de e-mail local:

- `gelato_snapshot` em workflows de Order (Phase 06) e testes HTTP de snapshot
- `cpf`/`cnpj` em testes de sanitização do módulo `08-01`
- asserções negativas (`not.toContain("client_secret")`, etc.) em testes HTTP

Nenhuma ocorrência nova de Resend real, Gelato API, fulfillment, refund, exchange ou tracking neste slice.

## Confirmações de escopo

- Resend **não** instalado
- Resend **não** chamado
- `package.json` **não** alterado
- lockfile **não** alterado
- migration real **não** aplicada (`medusa db:migrate` **não** executado)
- PostHog real **não** chamado
- Gelato **não** chamado
- fulfillment **não** criado
- refund / exchange / tracking **não** implementados
- Stripe CLI smoke **não** executado
- endpoint Store `/store/carts/*/complete` **não** criado
- regra de nascimento da Order **preservada**
- `08-03` **não** iniciado

## Manual gate

PARAR AQUI. Revisar enqueue local, precondição `purchase_completed`, registro runtime e fail-closed antes de autorizar `08-03` (relay Resend async).
