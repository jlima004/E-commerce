---
phase: 08
plan: 03
status: completed
manual_review_gate: true
updated_at: 2026-07-01T21:55:00-03:00
---

# 08-03 - Async Resend Relay, Retry, Dead Letter And Final Validation

## Escopo executado

Executado somente o plano `.planning/phases/08-transactional-email-resend/08-03-PLAN.md`.

Parada no manual gate após este summary. Phase 09 não foi iniciada.

## Arquivos alterados

- `apps/backend/package.json`
- `package-lock.json`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/jobs/email-resend-relay.ts` (criado)
- `apps/backend/src/jobs/__tests__/email-resend-relay.unit.spec.ts` (criado)
- `apps/backend/src/modules/email-delivery-log/service.ts`
- `apps/backend/src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts`
- `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts`
- `.planning/phases/08-transactional-email-resend/08-03-SUMMARY.md`

Não alterados (conforme escopo):

- `apps/backend/medusa-config.ts`
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/modules/email-delivery-log/migrations/*`
- `apps/backend/src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts` (já coberto; sem diff necessário)

## Dependência `resend`

| Campo | Valor |
|-------|-------|
| Versão declarada | `^4.8.0` (`apps/backend/package.json`) |
| Versão resolvida | `4.8.0` (`package-lock.json`) |
| Lockfile alterado | Sim — `package-lock.json` na raiz do monorepo |

Instalação via workspace Linux (Node `v22.16.0` em `/tmp/node-v22.16.0-linux-x64/bin`) porque o `npm` do `PATH` apontava para Windows e falhava com `EISDIR` ao symlinkar o workspace WSL.

Comando efetivo:

```bash
export PATH="/tmp/node-v22.16.0-linux-x64/bin:$PATH"
cd /home/jlima/Projetos/ecommerce/Backend
npm install resend@^4 --workspace=@dtc/backend --no-audit --no-fund
```

## Configuração Resend usada

Adicionada em `apps/backend/src/config/env.ts`:

| Variável | Papel |
|----------|-------|
| `RESEND_API_KEY` | API key opcional; ausência impede apenas relay externo |
| `RESEND_FROM_EMAIL` | Remetente allowlist-only |
| `RESEND_ORDER_CONFIRMATION_ENABLED` | Gate explícito (`true`/`false`, default `false`) |
| `RESEND_REPLY_TO` | Opcional |

Resolução runtime do relay em `resolveResendRelayConfig()` / `isResendRelayDisabled()` (`apps/backend/src/jobs/email-resend-relay.ts`).

## Job / relay criado

Arquivo: `apps/backend/src/jobs/email-resend-relay.ts`

- scheduled job Medusa (`config.name = "email-resend-relay"`, `schedule = "* * * * *"`);
- seleciona `EmailDeliveryLog.status in recorded|failed` com `next_retry_at <= now`;
- claim local (`queued`/`sending`) antes da chamada externa;
- resolve destinatário somente de `Order.email` via `Modules.ORDER.listOrders`;
- monta payload transiente allowlist-only (`buildOrderConfirmationResendSendPayload`);
- chama provider injetável/`Resend` com `idempotencyKey = EmailDeliveryLog.idempotency_key` (`order-confirmation/{order_id}`);
- sucesso → `sent` + `provider_message_id`;
- falha → `failed` + `attempt_count` + erro sanitizado + `next_retry_at`;
- limite → `dead_letter`;
- não altera `Order`, `PaymentAttempt`, `CheckoutCompletionLog` ou `AnalyticsEventLog`;
- não chama Gelato, fulfillment, refund, exchange, tracking, Stripe CLI ou PostHog real.

## Estratégia config ausente / desabilitada

| Cenário | Comportamento |
|---------|---------------|
| `RESEND_ORDER_CONFIRMATION_ENABLED != true` | Relay retorna `skipped_disabled: true`; nenhum evento alterado |
| Habilitado mas `RESEND_API_KEY` ou `RESEND_FROM_EMAIL` ausentes | Relay retorna `skipped_missing_config: true`; nenhum evento alterado |
| Config injetada em teste (`deps.config`) | Bypass do gate de env disabled para permitir fake client |

Order creation, `purchase_completed` local, `EmailDeliveryLog.recorded` e PostHog local/relay permanecem independentes.

## Estratégia retry / backoff

Helpers em `apps/backend/src/modules/email-delivery-log/service.ts`:

- `buildEmailResendRelayClaimUpdate`
- `buildEmailResendRelaySendingUpdate`
- `buildEmailResendRelaySuccessUpdate`
- `buildEmailResendRelayFailureUpdate`
- `computeEmailResendRelayBackoffMs`
- `isEmailResendRelayDue`
- `isEmailResendRelayEligibleStatus`

Parâmetros (espelhando PostHog relay):

- `EMAIL_RESEND_RELAY_MAX_ATTEMPTS = 5`
- backoff exponencial: base `60_000ms`, teto `3_600_000ms`
- elegível: `recorded|failed` + due
- não selecionado: `queued|sending|sent|dead_letter`

## Estratégia dead-letter

Após `attempt_count >= maxAttempts`, status → `dead_letter`, `dead_lettered_at` preenchido, `next_retry_at = null`, erro sanitizado persistido.

`dead_letter` **não** autoriza Gelato automático (Phase 09 futura exige `sent` ou decisão operacional explícita).

## IdempotencyKey repassada ao provider

`client.send(payload, { idempotencyKey: event.idempotency_key })` com valor canônico `order-confirmation/{order_id}`.

## Fonte canônica `Order.email`

Única fonte do destinatário: `resolveOrderRecipientEmail()` sobre `Order.email` carregado por `order_id`. Ausência/invalidade → falha sanitizada local, sem chamada Resend.

## Prova: e-mail completo não persistido

- `EmailDeliveryLog` continua com `recipient_email_hash` + `recipient_email_domain` apenas;
- payload persistido allowlist-only (sem `to`/`recipient_email`);
- testes unitários/HTTP assertam `JSON.stringify(record)` sem endereço literal;
- erro externo sanitizado via `sanitizeEmailDeliveryError`.

## Prova: Resend não é gate de Order

- Order nasce somente no entrypoint pós-webhook (testes HTTP existentes + novos);
- relay Resend roda depois de `EmailDeliveryLog.recorded`;
- falha Resend marca `failed`/`dead_letter` sem reverter Order nem apagar log local;
- HTTP: `Resend indisponivel does not block Order depois de EmailDeliveryLog.recorded` — PASS.

## Prova: `sent` não é requisito para validar Order

`isOrderConfirmationEmailLocallyRecorded()` aceita `recorded|queued|sending|sent|failed|dead_letter`. Order e gate local permanecem válidos sem `sent`.

## Gelato automático não iniciado

Nenhuma referência runtime nova a Gelato/fulfillment/refund/exchange/tracking nos arquivos deste slice. Greps negativos PASS.

## Testes executados

### Unit (Phase 08)

```bash
export PATH="/tmp/node-v22.16.0-linux-x64/bin:$PATH"
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts \
  src/jobs/__tests__/email-resend-relay.unit.spec.ts
```

**Resultado:** 3 suites, **41/41 PASS**

### HTTP filtrado

```bash
export PATH="/tmp/node-v22.16.0-linux-x64/bin:$PATH"
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|Resend|does not block"
```

**Resultado:** **4/4 PASS**

- `EmailDeliveryLog local e gravado depois de purchase_completed sem chamar Resend`
- `email recovery cria EmailDeliveryLog ausente para Order e purchase_completed existentes`
- `Resend indisponivel does not block Order depois de EmailDeliveryLog.recorded`
- `EmailDeliveryLog replay remains idempotent when Resend relay fails`

### Build

```bash
export PATH="/tmp/node-v22.16.0-linux-x64/bin:$PATH"
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

**Resultado:** PASS (`Backend build completed successfully`)

## Greps negativos

| Check | Resultado |
|-------|-----------|
| Gelato/Fulfillment/Refund/Exchange/Tracking/Stripe CLI | PASS (exit 0) |
| Store completion público | PASS (exit 0) |
| E-mail literal completo em relay/enqueue tests | PASS (exit 0) |
| Secrets/payload proibido no relay | PASS (exit 0) |
| `git diff --check` | PASS (exit 0) |

## Broad scan informativo (não bloqueante)

Matches legítimos herdados documentados:

- `gelato_snapshot` em testes HTTP/unit de Order snapshot (Phase 06);
- sanitizers de `email-delivery-log` referenciam `Bearer`, `cpf`, `cnpj`, `phone` como padrões de redaction;
- testes de erro usam `joinKey()` para evitar endereços literais em source.

Nenhum match novo proibido introduzido pelo relay.

## Confirmações de não-execução

| Item | Status |
|------|--------|
| Resend real / e-mail real | Não executado (fake client injetado) |
| PostHog real | Não executado |
| Gelato | Não iniciado |
| Fulfillment / refund / exchange / tracking | Não iniciado |
| Stripe CLI smoke | Não executado |
| Migration real | Não aplicada |
| Phase 09 | Não iniciada |

## Manual Gate

**PARAR AQUI.** Revisar relay assíncrono, retry/dead-letter, provas de não-gate de Order e ausência de Gelato antes de autorizar Phase 09.
