---
phase: 09
plan: 01
status: completed
manual_review_gate: true
updated_at: 2026-07-02T12:40:11-03:00
---

# 09-01 - GelatoFulfillment Contract, Local Model, Idempotency And Single-Active Guard

## Decisao explicita de branch

Branch decision B preservada: `gsd/phase-09-gelato-fulfillment-webhook`.

## Escopo executado

Executado somente o plano `.planning/phases/09-gelato-fulfillment-webhook/09-01-PLAN.md`.

## Arquivos criados/alterados

- `apps/backend/src/modules/gelato-fulfillment/index.ts`
- `apps/backend/src/modules/gelato-fulfillment/models/gelato-fulfillment.ts`
- `apps/backend/src/modules/gelato-fulfillment/service.ts`
- `apps/backend/src/modules/gelato-fulfillment/types.ts`
- `apps/backend/src/modules/gelato-fulfillment/migrations/TBD-gelato-fulfillment.ts`
- `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts`
- `.planning/phases/09-gelato-fulfillment-webhook/09-01-SUMMARY.md`

## Contrato do modelo

Modulo local criado: `gelato-fulfillment`

Tabela/modelo `gelato_fulfillment`:

- `id` com prefixo `gelful`
- `order_id`
- `cart_id`
- `payment_attempt_id`
- `checkout_completion_log_id`
- `analytics_event_log_id`
- `email_delivery_log_id`
- `idempotency_key`
- `order_reference_id`
- `customer_reference_id`
- `status`
- `gelato_primary_order_id`
- `connected_order_ids`
- `request_hash`
- `request_summary`
- `response_summary`
- `tracking_summary`
- `metadata`
- `attempt_count`
- `last_error_code`
- `last_error_message`
- `next_retry_at`
- `requires_operator_attention`
- `operator_alert_code`
- `operator_alert_message`
- `operator_alerted_at`
- `recorded_at`
- `queued_at`
- `dispatching_started_at`
- `submitted_at`
- `accepted_at`
- `failed_at`
- `dead_lettered_at`
- `created_at`
- `updated_at`
- `deleted_at`

## Status lifecycle

Statuses locais implementados:

- `recorded`
- `eligible`
- `queued`
- `dispatching`
- `submitted`
- `accepted`
- `in_production`
- `partially_shipped`
- `shipped`
- `delivered`
- `failed`
- `dead_letter`
- `canceled`

Classificacao pura implementada:

- ativos: `recorded`, `eligible`, `queued`, `dispatching`, `submitted`, `accepted`, `in_production`, `partially_shipped`, `shipped`
- terminais: `delivered`, `failed`, `dead_letter`, `canceled`

## Idempotency key

Helper puro criado:

```text
buildGelatoDispatchIdempotencyKey({ order_id })
=> gelato-dispatch:{order_id}
```

## Single-active guard e connected_order_ids

Regra MVP implementada:

- helper puro `assertSingleActiveGelatoFulfillmentForOrder(...)`
- mesma `order_id` com fulfillment existente ativo rejeita com `GELATO_FULFILLMENT_ORDER_ALREADY_ACTIVE`
- mesma `order_id` com fulfillment terminal ja registrado rejeita com `GELATO_FULFILLMENT_ORDER_ALREADY_RECORDED`
- o modelo/migration draft tambem preservam a regra com `unique(order_id)`

Tratamento de `connected_order_ids`:

- helper puro normaliza `trim`, remove vazio, remove duplicado e nao cria novo fulfillment local
- `order_id` principal nao e repetido em `connected_order_ids`
- quando o campo top-level nao vier separado, o aggregate reaproveita o conjunto normalizado vindo de `request_summary`

## Request/response/tracking summaries

Builders allowlist-only implementados:

- `buildGelatoFulfillmentRequestSummary(...)`
- `buildGelatoFulfillmentResponseSummary(...)`
- `buildGelatoFulfillmentTrackingSummary(...)`

Persistencia permitida nos summaries locais:

- `order_id`
- `cart_id`
- `payment_attempt_id`
- `checkout_completion_log_id`
- `analytics_event_log_id`
- `email_delivery_log_id`
- `idempotency_key`
- `request_hash`
- `item_count`
- `currency_code`
- `status`
- `connected_order_ids`
- `provider`
- `provider_status`
- `provider_reference_id`
- `gelato_primary_order_id`
- `tracking_status` local

Tracking permaneceu estritamente local:

- sem tracking publico
- sem token publico
- sem URL publica
- sem `TrackingAccessToken`

## Alerta operacional minimo

Campos minimos implementados no proprio aggregate:

- `requires_operator_attention`
- `operator_alert_code`
- `operator_alert_message`
- `operator_alerted_at`

Helper puro implementado para falha persistente:

```text
buildGelatoDeadLetterUpdate(...)
=> status = dead_letter
=> requires_operator_attention = true
```

Codigo e mensagem de alerta/erro passam por sanitizacao/redaction antes da persistencia.

## Politica de sanitizacao

Bloqueio fail-closed implementado para metadata, request summary, response summary, tracking summary e surfaces de erro/alerta.

Persistencia proibida/rejeitada:

- `X-API-KEY`
- `GELATO_API_KEY`
- `Authorization`
- `Bearer`
- `Cookie` / headers integrais
- `raw_body` / `rawBody`
- payload Gelato completo
- `client_secret`
- Pix QR
- Pix copia-e-cola
- hosted instructions URL
- CPF/CNPJ puro
- shipping/billing/full address
- e-mail completo
- telefone
- tracking token
- tracking URL/codigo publico
- `gelato_snapshot` integral
- refund
- exchange
- Stripe CLI

Metadata permitida permaneceu allowlist-only:

- `correlation_id`
- `recovery_origin`
- `source`

## Migration draft revisavel

Migration draft criada em:

- `apps/backend/src/modules/gelato-fulfillment/migrations/TBD-gelato-fulfillment.ts`

Constraints/checks incluidos:

- `check ("status" in (...))`
- `check ("attempt_count" >= 0)`
- campos de alerta operacional minimo

Indexes/uniques incluidos:

- `unique(order_id)`
- `unique(idempotency_key)`
- `index(status, next_retry_at)`
- `index(order_id)`
- `index(analytics_event_log_id)`
- `index(email_delivery_log_id)`
- `index(payment_attempt_id)`
- `index(checkout_completion_log_id)`

Observacao: migration permaneceu somente como draft revisavel e nao foi aplicada.

## Testes executados

Unit focado solicitado:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts
```

Diagnostico do ambiente:

- `npm` do `PATH` apontava para `/mnt/c/Program Files/nodejs/npm`
- `node` Linux nao estava no `PATH`
- runtime Linux valido encontrado em `/home/jlima/node`

Comando efetivo executado:

```bash
cd apps/backend && env TMPDIR=/tmp TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules /home/jlima/node ../../node_modules/jest/bin/jest.js --config jest.config.js --runTestsByPath src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts
```

Cobertura do unit focado:

- `buildGelatoDispatchIdempotencyKey`
- status set valido
- active vs terminal status
- single-active guard por `order_id`
- `connected_order_ids` agregados no mesmo fulfillment
- `request_summary` allowlist-only
- `response_summary` allowlist-only
- `tracking_summary` local sem tracking publico
- metadata sanitizada
- erro sanitizado
- operator-alert fields
- `dead_letter + requires_operator_attention`
- rejeicao/redaction de payload proibido
- source checks de migration/model

## Resultado dos testes e provas

- Unit focado: PASS (`17 passed, 17 total`)
- Prova negativa de chamada/rota/job Gelato real no slice: PASS
- `medusa-config.ts` inalterado: PASS
- `webhook-order-entrypoint.ts` inalterado: PASS
- `env.ts` inalterado: PASS
- `package.json` inalterado: PASS
- lockfile inalterado: PASS
- `git diff --check`: PASS

Comandos de prova executados:

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|/hooks/gelato|gelato-dispatch-relay|fetch\\(|stripe listen|stripe trigger|TrackingAccessToken|tracking_token|create.*Fulfillment|refund|Refund|ExchangeRequest" -- src/modules/gelato-fulfillment; status=$?; test $status -eq 1'
```

```bash
bash -lc 'cd apps/backend && git diff -- medusa-config.ts src/workflows/order/webhook-order-entrypoint.ts src/config/env.ts --exit-code'
```

```bash
bash -lc 'cd apps/backend && git diff -- package.json --exit-code && cd ../.. && git diff -- package-lock.json --exit-code'
```

```bash
git diff --check
```

## Confirmacoes de escopo

- `09-02` nao foi iniciado
- `09-03` nao foi iniciado
- `09-04` nao foi iniciado
- `09-05` nao foi iniciado
- `medusa-config.ts` nao foi alterado
- `webhook-order-entrypoint.ts` nao foi alterado
- `env.ts` nao foi alterado
- `package.json` nao foi alterado
- lockfile nao foi alterado
- migration real nao foi aplicada
- `medusa db:migrate` nao foi executado
- Gelato real nao foi chamado
- webhook Gelato nao foi criado
- relay/job nao foi criado
- rota `/hooks/gelato` nao foi criada
- client real da Gelato nao foi criado
- pedido Gelato real nao foi criado
- `gelato_order_id` real nao foi persistido
- Resend real nao foi chamado
- PostHog real nao foi chamado
- tracking publico nao foi implementado
- refund nao foi implementado
- exchange nao foi implementado
- Stripe CLI smoke nao foi executado
- Phase 10 nao foi iniciada

## Manual gate

Parando no manual gate apos `09-01-SUMMARY.md`.
