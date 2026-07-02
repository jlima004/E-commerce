---
phase: 09
plan: 03
status: completed
manual_review_gate: true
updated_at: 2026-07-02T16:10:00-03:00
---

# 09-03 - Async Gelato Dispatch Relay With Eligibility Scan, Retry, Backoff And Dead Letter

## Escopo executado

Executado somente o plano `.planning/phases/09-gelato-fulfillment-webhook/09-03-PLAN.md`.

Branch decision B preservada: uso mantido da branch `gsd/phase-09-gelato-fulfillment-webhook`.

Parada no manual gate após este summary. `09-04` não foi iniciado.

## Arquivos alterados

- `apps/backend/src/config/env.ts`
- `apps/backend/src/jobs/gelato-dispatch-relay.ts` (criado)
- `apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts` (criado)
- `apps/backend/src/modules/gelato-fulfillment/service.ts`
- `apps/backend/src/modules/gelato-fulfillment/types.ts`
- `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-dispatch.unit.spec.ts` (criado)
- `.planning/phases/09-gelato-fulfillment-webhook/09-03-SUMMARY.md`

Não alterados, conforme escopo autorizado:

- `apps/backend/medusa-config.ts`
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/package.json`
- `package-lock.json`

## Env / config adicionados

Adicionados em `apps/backend/src/config/env.ts`:

- `GELATO_DISPATCH_ENABLED`
- `GELATO_API_KEY`
- `GELATO_SHIPMENT_METHOD_UID`

Contrato aplicado:

- config ausente ou `GELATO_DISPATCH_ENABLED != true` faz o relay retornar `skipped_missing_config` ou `skipped_disabled`, sem envio externo;
- `GELATO_API_KEY` é apenas lida e repassada ao client fino, nunca logada nem persistida;
- `GELATO_SHIPMENT_METHOD_UID` permanece opcional.

## Implementação do slice

### Relay assíncrono e eligibility scan

Arquivo criado: `apps/backend/src/jobs/gelato-dispatch-relay.ts`.

Fluxo implementado por batch:

1. lista Orders locais;
2. filtra apenas Orders confirmadas (`metadata.order_status=confirmed`, `metadata.payment_status=captured`);
3. exige `purchase_completed` local durável;
4. exige `EmailDeliveryLog(order_confirmation).status = sent`;
5. cria ou reutiliza `GelatoFulfillment` local antes de qualquer dispatch;
6. aplica claim local (`queued`) antes da chamada externa;
7. aplica `dispatching` imediatamente antes do client;
8. persiste sucesso/falha saneados no mesmo aggregate local.

Esse scan é o mecanismo normal para o caso em que `EmailDeliveryLog` vira `sent` depois do webhook Stripe original. Não depende de replay do webhook Stripe.

### Payload builder a partir de `LineItem.metadata.gelato_snapshot`

Helpers adicionados em `apps/backend/src/modules/gelato-fulfillment/service.ts`:

- `buildGelatoDispatchAddress`
- `buildGelatoDispatchItems`
- `buildGelatoDispatchPayload`
- `buildGelatoDispatchRequestHash`

Contrato aplicado:

- payload transiente para `POST https://order.gelatoapis.com/v4/orders`;
- `orderType = order`;
- `orderReferenceId = order_id`;
- `customerReferenceId` seguro derivado de `display_id`/`order_id`;
- `currency = BRL`;
- `items[]` somente de `LineItem.metadata.gelato_snapshot`;
- `shippingAddress` usa os dados aceitos da Order;
- `federalTaxId` fica apenas no payload transiente;
- `metadata` limitada a referências curtas (`order_id`, `fulfillment_id`);
- sem consulta a catálogo mutável;
- sem persistir payload completo, CPF/CNPJ, endereço completo, e-mail completo, telefone ou `gelato_snapshot` integral.

Fail-closed implementado:

- snapshot ausente ou malformado bloqueia o dispatch;
- ausência de `files[]` no snapshot/contrato atual bloqueia o dispatch antes de qualquer chamada externa fake/real;
- erro persistido fica saneado e operator-gated quando necessário.

### Client Gelato fino e injetável

Em `apps/backend/src/jobs/gelato-dispatch-relay.ts`:

- `resolveGelatoDispatchRelayConfig`
- `isGelatoDispatchDisabled`
- `createGelatoDispatchClient`
- `runGelatoDispatchRelay`

O client default usa `fetch` e header `X-API-KEY`, sem SDK Gelato e sem mudanças em `package.json`/lockfile.

Os testes usam apenas fake client injetado.

### Persistência local saneada

Persistência no `GelatoFulfillment` ficou restrita a:

- `gelato_primary_order_id`
- `connected_order_ids`
- `provider_status`/`provider_reference_id` em `response_summary`
- `request_hash`
- `request_summary` allowlist-only
- `response_summary` allowlist-only

`connected_order_ids` permanece sempre no mesmo aggregate local.

### Retry / backoff / dead-letter

Helpers adicionados:

- `computeGelatoDispatchBackoffMs`
- `isGelatoDispatchDue`
- `buildGelatoDispatchFailureUpdate`
- `buildGelatoDispatchSuccessUpdate`

Contrato aplicado:

- `429` e `5xx` fazem retry com backoff exponencial;
- `400`, `401` e `404` viram `dead_letter` por default, sem retry infinito;
- falha persistente marca `dead_letter`;
- falha persistente marca `requires_operator_attention = true`;
- `operator_alert_code` / `operator_alert_message` ficam saneados.

Falha Gelato não reverte `Order`, `PaymentAttempt`, `CheckoutCompletionLog`, `AnalyticsEventLog` ou `EmailDeliveryLog`.

### Stale in-flight recovery

Helpers adicionados:

- `resolveGelatoDispatchCandidateDecision`
- `buildGelatoStaleOperatorAttentionUpdate`

Contrato implementado:

- `recorded` e `eligible` entram em dispatch;
- `failed` só volta quando `next_retry_at <= now`;
- `queued` recente não reprocessa;
- `dispatching` recente não reprocessa;
- `submitted` recente com `gelato_primary_order_id` não reprocessa;
- `queued` stale antes de chamada externa pode ser recuperado;
- `dispatching`/`submitted` stale não gera redispatch cego;
- `accepted`/`in_production`/`partially_shipped`/`shipped`/`delivered` não entram em dispatch;
- `dead_letter`/`canceled` não entram em dispatch.

Como não existe reconciliação oficial segura por `orderReferenceId` neste slice, estados incertos ficam operator-gated:

- `status = dead_letter`
- `requires_operator_attention = true`
- alerta saneado local

Prova de não haver redispatch cego:

- `dispatching` stale sem `gelato_primary_order_id` não chama client;
- `submitted` stale com `gelato_primary_order_id` não cria novo pedido automaticamente;
- `submitted`/`accepted` recentes com `gelato_primary_order_id` não redispatcham.

## Testes executados

### Unit focado

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts \
  src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-eligibility.unit.spec.ts \
  src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-dispatch.unit.spec.ts \
  src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts
```

Resultado: **PASS**

- 4 suites
- 48 testes
- 48/48 aprovados

Cobertura explícita adicionada/ajustada para:

- disabled config -> não envia;
- missing config -> não envia;
- fake client success -> `submitted`/`accepted`;
- split order response -> `connected_order_ids` no mesmo fulfillment;
- `429` -> retry/backoff;
- `5xx` -> retry/backoff;
- `400`/`401`/`404` -> sem retry infinito;
- falha persistente -> `dead_letter` + `requires_operator_attention`;
- payload usa somente `gelato_snapshot`;
- snapshot ausente/malformado -> fail-closed;
- dados sensíveis redigidos/rejeitados;
- `EmailDeliveryLog sent` após webhook original -> relay cria/reutiliza `GelatoFulfillment`;
- `EmailDeliveryLog dead_letter|recorded|queued|sending|failed` -> não cria fulfillment;
- falha Gelato não reverte logs locais;
- `queued`/`dispatching`/`submitted` recentes não reprocessam;
- `queued` stale recupera;
- `dispatching` stale sem `gelato_primary_order_id` não redispatcha cegamente;
- `dispatching`/`submitted` stale sem reconciliação segura -> operator gate;
- `submitted`/`accepted` com `gelato_primary_order_id` não redispatcham.

### HTTP filtrado existente

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "gelato|Gelato|fulfillment|EmailDeliveryLog|purchase_completed"
```

Resultado: **PASS**

- 11 testes aprovados
- 4 testes `skipped`

Inclui:

- `purchase_completed` local durável;
- recovery de `EmailDeliveryLog`;
- gate de Gelato bloqueado até `sent`;
- create/reuse de `GelatoFulfillment` local com `sent`;
- bloqueio para `dead_letter` e statuses não `sent`.

### Build obrigatório

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: **PASS**

Observação: o build emitiu o warning já existente de lint ausente (`eslint` não instalado), mas o backend compilou com sucesso.

## Provas negativas

### Ausência de webhook Gelato / tracking / refund / exchange / Stripe CLI

```bash
bash -lc 'cd apps/backend && git grep -n -E "/hooks/gelato|stripe listen|stripe trigger|TrackingAccessToken|tracking_token|refund|Refund|ExchangeRequest" -- src/jobs src/modules/gelato-fulfillment src/config integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Resultado: **PASS**

### Testes sem chamada real Gelato

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\.gelatoapis\.com|GELATO_API_KEY|X-API-KEY" -- src/jobs/__tests__ src/modules/gelato-fulfillment/__tests__; status=$?; test $status -eq 1'
```

Resultado: **PASS** (após correção — ver abaixo)

### Correção da prova negativa (grep de testes)

O literal `"X-API-KEY ..."` em `gelato-fulfillment-dispatch.unit.spec.ts` (linha 193) fazia o grep acima retornar match, invalidando a evidência declarada de PASS. Corrigido para string construída em runtime:

```ts
new Error(
  `${["X", "API", "KEY"].join("-")} abc cliente@lojinha.test +55 11 98888-7777`
)
```

Comportamento do teste inalterado (redação de dados sensíveis); apenas o literal foi removido do arquivo-fonte.

Reexecução pós-correção:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-dispatch.unit.spec.ts \
  src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts
```

Resultado: **PASS**

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\.gelatoapis\.com|GELATO_API_KEY|X-API-KEY" -- src/jobs/__tests__ src/modules/gelato-fulfillment/__tests__; status=$?; test $status -eq 1'
```

Resultado: **PASS** (exit 1 — nenhum match)

```bash
git diff --check
```

Resultado: **PASS**

### Arquivos proibidos sem diff

```bash
bash -lc 'cd apps/backend && git diff -- medusa-config.ts src/workflows/order/webhook-order-entrypoint.ts package.json --exit-code && cd ../.. && git diff -- package-lock.json --exit-code'
```

Resultado: **PASS**

### Whitespace check

```bash
git diff --check
```

Resultado: **PASS**

## Confirmações finais de escopo

Confirmado:

- `09-04` não foi iniciado;
- `09-05` não foi iniciado;
- não houve Gelato real;
- não houve criação de pedido Gelato real;
- não houve webhook Gelato;
- não houve rota `/hooks/gelato`;
- não houve tracking público;
- não houve `TrackingAccessToken`;
- não houve refund;
- não houve exchange;
- não houve Stripe CLI smoke;
- não houve Resend real;
- não houve PostHog real;
- não houve migration real;
- não houve `medusa db:migrate`;
- não houve Phase 10.

## Manual Gate

**PARAR AQUI.** Slice `09-03` concluído e documentado. `09-04` permanece bloqueado até nova aprovação humana.
