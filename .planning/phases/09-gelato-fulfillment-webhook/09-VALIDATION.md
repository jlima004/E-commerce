---
phase: 09-gelato-fulfillment-webhook
status: planned-validation
created_at: 2026-07-02
manual_review_gate: true
runtime_executed: false
---

# Phase 09 Validation Strategy

## Scope

Este arquivo define a validacao esperada quando a Phase 09 for executada futuramente. Durante este planejamento, nenhum teste, build, runtime, migration, Stripe CLI smoke, webhook real ou chamada Gelato real foi executado.

## Required Unit Tests

- `GelatoFulfillment` model/service helpers:
  - status lifecycle valido;
  - idempotency key `gelato-dispatch:{order_id}`;
  - single-active guard por `order_id`;
  - `connectedOrderIds` agregados no mesmo fulfillment local;
  - campos minimos de alerta operacional no proprio fulfillment (`requires_operator_attention`, `operator_alert_code`, `operator_alert_message`, `operator_alerted_at`);
  - sanitizacao de metadata/logs;
  - erro ao tentar persistir raw body, Authorization, cookies, `X-API-KEY`, CPF/CNPJ puro, endereco completo, e-mail completo, telefone, `client_secret`, Pix QR/copia-e-cola, tracking token ou `gelato_snapshot` integral.
- Gelato payload builder:
  - usa somente `LineItem.metadata.gelato_snapshot`;
  - falha se snapshot ausente/malformado;
  - nao consulta catalogo mutavel;
  - inclui somente payload transiente permitido para Gelato;
  - requer/propaga `federalTaxId` para BR apenas no payload transiente.
- Eligibility gate:
  - bloqueia sem `Order` confirmada;
  - bloqueia sem `purchase_completed` local;
  - nao depende de PostHog;
  - nao exige `AnalyticsEventLog.status = sent`;
  - bloqueia se `EmailDeliveryLog(order_confirmation).status != sent`;
  - bloqueia `dead_letter`;
  - nao implementa override operacional automatico.
- Runtime module registration:
  - `gelato_fulfillment` registrado no runtime real do Medusa;
  - modulo ausente/mal configurado nao chama Gelato, nao cria fulfillment externo, nao retorna sucesso silencioso, emite erro estavel/sanitizado, nao reverte `Order`, `purchase_completed` ou `EmailDeliveryLog` ja gravados, e deixa o caso recuperavel por retry/recovery.
- Relay Gelato:
  - eligibility scan encontra Orders confirmadas;
  - exige `purchase_completed` local duravel;
  - exige `EmailDeliveryLog(order_confirmation).status = sent`;
  - cria ou reutiliza `GelatoFulfillment` local antes de dispatch;
  - stale in-flight recovery para `queued`/`dispatching`/`submitted`;
  - `queued` recente nao e reprocessado;
  - `dispatching` recente nao e reprocessado;
  - `queued` stale pode ser recuperado sem chamada externa duplicada;
  - `dispatching`/`submitted` stale nao gera redispatch cego;
  - ausencia de reconciliacao oficial segura gera `requires_operator_attention`;
  - Gelato relay nao cria pedido externo duplicado apos crash entre claim e persistencia;
  - nao exige replay do webhook Stripe quando e-mail vira `sent` depois do webhook original;
  - nao cria fulfillment quando e-mail esta `dead_letter`;
  - nao cria fulfillment quando e-mail esta `recorded`, `queued`, `sending` ou `failed`;
  - claim local antes da chamada externa;
  - fake client injetavel;
  - retry/backoff para `429`/`5xx`;
  - nao retry infinito para `400`/`401`/`404`;
  - falha persistente marca `dead_letter` e `requires_operator_attention = true` no fulfillment;
  - Gelato falho nao reverte `Order`, `PaymentAttempt`, `CheckoutCompletionLog`, `AnalyticsEventLog` ou `EmailDeliveryLog`.
- Webhook Gelato:
  - autenticidade via HTTP Header confirmada documentalmente (dashboard Gelato: Authorization Type = HTTP Header, Header Name/Value configuraveis);
  - header dedicado `X-GELATO-WEBHOOK-SECRET`; env `GELATO_WEBHOOK_AUTH_HEADER_NAME` + `GELATO_WEBHOOK_SECRET`; nao reutilizar `GELATO_API_KEY`;
  - rejeitar antes de qualquer DB side effect se header ausente/incorreto (fail-closed);
  - aceitar apenas `order_status_updated` no MVP; demais eventos Gelato (underscores) fora do escopo salvo decisao futura;
  - dedupe por event `id`; `payload_hash` apenas fallback seguro;
  - replay sequencial e concorrente idempotente;
  - update de status/tracking por `orderReferenceId`/`orderId`;
  - eventos de split order atualizam o mesmo fulfillment;
  - evento desconhecido/fora de ordem nao corrompe status terminal.

## Required HTTP / Integration Tests

Filtrar suites para Phase 09, sem chamadas externas reais:

- Fluxo pos-webhook Stripe existente cria `Order` e logs locais, mas dispatch Gelato fica bloqueado ate e-mail `sent`.
- Quando e-mail esta `sent`, enqueue/claim de Gelato cria exatamente um fulfillment local.
- Quando e-mail vira `sent` depois do webhook/Order original, o relay cria/reutiliza `GelatoFulfillment` sem exigir replay do webhook Stripe.
- Quando e-mail esta `dead_letter`, o relay nao cria `GelatoFulfillment`.
- Quando e-mail esta `recorded`, `queued`, `sending` ou `failed`, o relay nao cria `GelatoFulfillment`.
- Replay/concurrency do mesmo caminho nao cria segundo fulfillment ativo.
- Fake Gelato client sucesso registra `gelato_primary_order_id`, `connected_order_ids` e status local saneado.
- Fake Gelato client falha transiente marca retry sem reverter `Order`.
- Fake Gelato client falha persistente marca `dead_letter` e `requires_operator_attention = true`.
- Webhook Gelato fake com HTTP Header autentico atualiza status/tracking.
- Webhook Gelato duplicado retorna `2xx`/no-op e mantem um unico evento processado.
- Webhook Gelato sem header autentico valido rejeita antes de efeito persistente.
- Webhook Gelato com evento fora do MVP (`order_item_status_updated`, etc.) rejeita ou ignora sem efeito persistente.

## Build

Build obrigatorio em slices que alterarem runtime/config/module registration:

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Nao rodar build durante planejamento.

Obrigatorio especificamente para:

- `09-02`, porque altera o runtime Order entrypoint e registra modulo em `medusa-config.ts`.
- `09-03`, porque altera `env.ts` e cria scheduled job runtime.

## Migration Policy

- Pode criar migration draft nos slices futuros quando implementarem modelo.
- Nao rodar `medusa db:migrate` na Phase 09 sem gate separado.
- `09-VALIDATION.md` exige prova documental de que migration real nao foi aplicada durante cada slice, salvo aprovacao humana explicita.

## Negative Greps Required

Executar greps focados nos slices futuros para provar ausencia de escopo proibido:

- Store completion / checkout Order creation publica.
- Refund: `refund`, `Refund`, `REF-`, rotas/admin refund.
- Exchange: `exchange`, `ExchangeRequest`.
- Tracking publico: `TrackingAccessToken`, public tracking route, token publico.
- Stripe CLI smoke: `stripe listen`, `stripe trigger`, `STRIPE_CLI`.
- Secrets/payloads: `X-API-KEY`, `Authorization`, `Cookie`, `raw_body`, `rawBody`, `client_secret`, Pix QR/copia-e-cola, CPF/CNPJ puro, tracking token, payload Gelato completo.
- Real calls in tests: garantir fake Gelato client, sem chamada a `order.gelatoapis.com` em suites.

Broad scans podem ser informativos quando pegarem falsos positivos historicos, mas a validacao bloqueante deve focar arquivos tocados e runtime surface da Phase 09.

## Invariant Proofs

- `FUL-01`: Gelato so elegivel com `Order` confirmada + `purchase_completed` local + e-mail `sent`.
- `FUL-02`: replay/concurrency/manual retry nao cria mais de um fulfillment ativo por `Order`.
- `FUL-03`: webhook Gelato idempotente atualiza fulfillment local com status/tracking.
- `FUL-04`: falhas transientes retry; falhas persistentes `dead_letter` + `requires_operator_attention = true` no proprio `GelatoFulfillment`.
- `WHK-03`: webhook Gelato usa ingestao persistida, deduplicada e autenticada/fail-closed via HTTP Header (auth confirmada documentalmente via dashboard Gelato; implementacao deve verificar fail-closed).
- Gelato falho nao reverte `Order`.
- Gelato relay stale in-flight recovery does not cause blind duplicate Gelato dispatch.
- `EmailDeliveryLog.dead_letter` nao permite Gelato automatico.
- PostHog continua fora do gate.
- Phase 10 tracking publico nao e iniciado.

## Manual Gate

Quando todos os slices planejados estiverem executados e summaries aceitos, parar em manual gate. Nao iniciar Phase 10.
