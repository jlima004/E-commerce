# 07-03 Summary

## 1. Escopo executado

Executado somente o plano `07-03`, limitado aos arquivos autorizados para:

- implementar relay assíncrono de `AnalyticsEventLog` para PostHog;
- manter PostHog fora do gate de negócio;
- implementar retry/backoff/dead-letter;
- provar que falha de PostHog não bloqueia Order nem downstream local;
- rodar validação final da Phase 07;
- parar no manual gate antes de Phase 08/09.

Escopo explicitamente preservado:

- Phase 08 não iniciada;
- Phase 09 não iniciada;
- nenhum Email/Resend, Gelato, fulfillment, refund, tracking ou Store completion público introduzido;
- nenhuma migration aplicada;
- nenhum Stripe CLI smoke executado;
- nenhuma chamada real de PostHog em teste.

## 2. Arquivos alterados

- `apps/backend/package.json`
- `apps/backend/src/jobs/analytics-posthog-relay.ts` (novo)
- `apps/backend/src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts` (novo)
- `apps/backend/src/modules/analytics-event-log/service.ts`
- `apps/backend/src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts`
- `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts`
- `.planning/phases/07-analytics-outbox-purchase-completed/07-03-SUMMARY.md`

Lockfile:

- `apps/backend/package-lock.json` **não existe** no checkout de execução.
- `package-lock.json` na raiz do monorepo foi atualizado pelo `npm install -w @dtc/backend` para registrar `posthog-node`.

## 3. SDK/dependência adicionada

- Dependência: `posthog-node@^5.38.2` em `apps/backend/package.json`.
- Versão resolvida no workspace: `5.39.2`.
- Env vars do relay (fail-closed para envio externo apenas):
  - `POSTHOG_API_KEY` — ausente impede envio, não impede `AnalyticsEventLog.recorded`.
  - `POSTHOG_HOST` — opcional.

## 4. Job/relay criado

Arquivo: `apps/backend/src/jobs/analytics-posthog-relay.ts`

Comportamento:

- scheduled job Medusa (`config.schedule = "* * * * *"`, nome `analytics-posthog-relay`);
- seleciona eventos `recorded` e `failed` com `next_retry_at <= now`;
- claim local `queued` → `sending` antes da chamada externa;
- mapeia payload allowlist-only para `capture({ event, distinctId, properties })`;
- usa `order_id` como `distinctId` MVP;
- chama `shutdown()` do client ao final do batch;
- não altera `Order`, `PaymentAttempt` ou `CheckoutCompletionLog`.

Helpers de relay adicionados em `service.ts`:

- `computeAnalyticsRelayBackoffMs`
- `buildPostHogCaptureFromAnalyticsEvent`
- `buildAnalyticsRelayClaimUpdate` / `buildAnalyticsRelaySendingUpdate`
- `buildAnalyticsRelaySuccessUpdate`
- `buildAnalyticsRelayFailureUpdate`
- `isAnalyticsRelayDue` / `isAnalyticsRelayEligibleStatus`

## 5. Estratégia de config ausente

`resolvePostHogRelayConfig()` retorna `null` quando `POSTHOG_API_KEY` está ausente ou vazio.

Quando config ausente:

- relay retorna `skipped_missing_config: true`;
- nenhum evento é alterado;
- `AnalyticsEventLog.recorded` continua funcionando no fluxo de Order;
- gate local downstream continua baseado em existência durável local.

## 6. Estratégia de retry/backoff

- Base: 60s, exponencial (`2^(attempt-1)`), teto 1h.
- Falha transiente: `failed`, incrementa `attempt_count`, persiste erro sanitizado, define `next_retry_at`.
- Erros externos sanitizados via `sanitizeAnalyticsError`; token PostHog nunca é persistido.

## 7. Estratégia de dead-letter

- Limite padrão: 5 tentativas (`ANALYTICS_RELAY_MAX_ATTEMPTS`).
- Ao esgotar tentativas: `dead_letter`, `dead_lettered_at` preenchido, `next_retry_at = null`.
- Evento local permanece durável; Order não é revertida.

## 8. PostHog não é gate de negócio

Confirmado:

- Order creation não depende de PostHog.
- Downstream local depende da existência durável de `purchase_completed` local.
- `AnalyticsEventLog.status = sent` **não** é requisito para downstream.
- Statuses duráveis aceitos pelo gate local: `recorded | queued | sending | sent | failed | dead_letter`.

## 9. Verificações executadas

### Unit completo da Phase 07

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts \
  src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts
```

Resultado: PASS (`35/35`).

### HTTP integration filtrado

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "purchase_completed|analytics outbox|PostHog"
```

Resultado: PASS (`3/3` filtrados; demais casos skipped pelo filtro).

Cobertura adicional:

- `PostHog indisponivel nao bloqueia Order nem gate local de purchase_completed`.

### Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: PASS.

Observação: warning esperado de lint skip porque `eslint` não está instalado no workspace `@dtc/backend`.

### Provas negativas bloqueantes

Sem Email/Gelato/Fulfillment/Refund/Tracking:

```bash
bash -lc 'cd apps/backend && git grep -n -E "EmailDeliveryLog|resend|order\.gelatoapis\.com|gelato_order_id|create.*Fulfillment|Fulfillment|refund|Refund|ExchangeRequest|TrackingAccessToken|tracking_token" -- src/modules/analytics-event-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Resultado: PASS.

Sem dados proibidos no payload analytics bloqueante:

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/jobs; status=$?; test $status -eq 1'
```

Resultado: PASS.

Sem Store completion público:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\[id\]/complete" -- src/api/store; status=$?; test $status -eq 1'
```

Resultado: PASS.

Sem Stripe CLI/secrets/payload sensível em runtime do slice:

```bash
bash -lc 'cd apps/backend && git grep -n -E "stripe listen|stripe trigger|whsec_|sk_test_|sk_live_|pi_[A-Za-z0-9_]+_secret_|00020126[0-9A-Z]{20,}" -- src/modules/analytics-event-log src/jobs src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Resultado: PASS.

### Broad scan informativo

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts || true'
```

Resultado: matches apenas informativos — ocorrências legítimas de `gelato_snapshot` da Phase 06 em workflows/tests de Order, e asserções negativas no teste HTTP (`client_secret`, `gelato_snapshot`).

### Diff check

```bash
git diff --check
```

Resultado: PASS.

## 10. Confirmações explícitas

- PostHog real **não** foi chamado em testes (client fakeado/injetado).
- Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke e migration real **não** foram executados.
- Phase 08 **não** iniciada.
- Phase 09 **não** iniciada.

## 11. Gate manual

Parado exatamente no gate manual após `07-03-SUMMARY.md`.

Aguardando revisão humana antes de Phase 08 ou Phase 09.
