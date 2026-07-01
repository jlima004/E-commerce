# 07-02 Summary

## 1. Escopo executado

Executado somente o plano `07-02`, limitado aos arquivos autorizados para:

- gravar ou reutilizar `purchase_completed` localmente no fluxo interno aceito de criacao de `Order`;
- manter o gate local baseado em `AnalyticsEventLog.status`;
- curar o caso de `Order` existente sem outbox local;
- adicionar cobertura unit e HTTP focada em replay, recovery, concorrencia logica e ausencia de efeitos externos;
- parar no gate manual deste slice.

Escopo explicitamente preservado:

- `07-03` nao iniciado;
- nenhum relay/job/PostHog real implementado;
- nenhum Email/Resend, Gelato, fulfillment, refund, tracking ou Store completion publico introduzido;
- nenhuma migration aplicada;
- nenhum `package.json` ou lockfile alterado.

## 2. Arquivos alterados

- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts`
- `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts`
- `apps/backend/src/modules/analytics-event-log/service.ts`
- `apps/backend/src/modules/analytics-event-log/types.ts`
- `apps/backend/src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts`
- `apps/backend/medusa-config.ts`
- `.planning/phases/07-analytics-outbox-purchase-completed/07-02-SUMMARY.md`

## 3. Onde `purchase_completed` local e gravado/reusado

### Success path

Em `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`, depois de:

- `Order` confirmada;
- `CheckoutCompletionLog` completado;
- `PaymentAttempt.order_id` correlacionado;

o entrypoint agora chama `ensurePurchaseCompletedRecorded(...)`, que:

- resolve `AnalyticsEventLog` no container como requisito fail-closed do fluxo;
- deriva a `idempotency_key` canonica `purchase_completed:stripe:{payment_intent_id}`;
- monta payload allowlist-only com IDs operacionais, totais BRL, estados confirmados e resumo minimo de itens;
- grava `status = recorded`;
- reutiliza um evento local existente quando o gate duravel ja estiver satisfeito.

### Recovery / replay

O mesmo helper agora cobre os caminhos:

- `claim.status === "processing"` com `Order` ja existente;
- `claim.status === "completed"` com `Order` ja conhecida;
- recovery por `existingOrderId` antes de tentar `completeCartWorkflow`.

Nesses casos:

- se existir `purchase_completed` local em status duravel, ele e reusado;
- se a `Order` existir e o outbox estiver ausente, o retry cria o evento local faltante antes do retorno de sucesso;
- conflitos por unique retornam ao read-path e resolvem como reuse seguro.

## 4. Gate local downstream

O helper `isPurchaseCompletedLocallyRecorded(...)` foi adicionado ao modulo `analytics-event-log` e aceita como gate local duravel:

- `recorded`
- `queued`
- `sending`
- `sent`
- `failed`
- `dead_letter`

Ele nao consulta PostHog e nao exige `status = sent`.

## 5. Verificacoes executadas

### Unit focado do slice

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts
```

Resultado: PASS (`4/4`).

Cobertura exercitada:

- criacao de `purchase_completed` no nascimento aceito da `Order`;
- replay/reuse sem duplicar evento;
- recovery de `Order` existente sem outbox;
- estados nao elegiveis nao criam `Order` nem outbox.

### Regressao unit do modulo analytics

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts
```

Resultado: PASS (`16/16`).

Cobertura adicional:

- helper de gate local aceita todos os statuses duraveis planejados;
- helper continua rejeitando estados fora do vocabulario local.

### HTTP integration filtrado

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "purchase_completed|analytics outbox"
```

Resultado: PASS (`2/2`, com demais casos do arquivo explicitamente skipped pelo filtro).

Cobertura exercitada:

- `purchase_completed` local gravado no fluxo aceito da `Order` sem chamar analytics externo;
- recovery HTTP/entrypoint cria outbox ausente para `Order` existente.

### Provas negativas bloqueantes

Sem PostHog/Email/Gelato/Fulfillment/Refund/Tracking no runtime do slice:

```bash
bash -lc 'cd apps/backend && git grep -n -E "PostHog|posthog\.capture|EmailDeliveryLog|resend|order\.gelatoapis\.com|gelato_order_id|create.*Fulfillment|refund|Refund|TrackingAccessToken" -- src/workflows/order src/modules/analytics-event-log integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Resultado: PASS.

Sem Store completion publico:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\[id\]/complete" -- src/api/store; status=$?; test $status -eq 1'
```

Resultado: PASS.

Sem dados proibidos no payload analytics (superficie bloqueante do modulo + teste unit especifico):

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts; status=$?; test $status -eq 1'
```

Resultado: PASS.

### Broad scan informativo

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/workflows/order integration-tests/http/stripe-webhook-order-creation.spec.ts || true'
```

Resultado: matches apenas informativos:

- ocorrencias legitimas herdadas da Phase 06 em `gelato_snapshot` no fluxo/testes de `Order`;
- assercoes negativas do teste HTTP novo (`client_secret`, `gelato_snapshot`) fora da superficie bloqueante do payload do modulo.

### Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: PASS.

Observacao: o build continuou emitindo apenas o warning esperado de lint skip porque `eslint` nao esta instalado no projeto.

## 6. Decisoes locais confirmadas

- `purchase_completed` continua com `idempotency_key = purchase_completed:stripe:{payment_intent_id}`.
- O gate local downstream ficou independente de PostHog e aceita qualquer status local duravel planejado.
- Recovery de `Order` existente sem outbox agora e curado por retry do mesmo entrypoint interno.
- O payload local continua allowlist-only, sem persistir secrets Stripe/Pix, raw payload, PII completa, tracking token ou `gelato_snapshot`.
- A regra de nascimento da `Order` nao mudou: o fluxo continua falhando fechado em `PaymentAttempt.status = payment_confirmed_by_webhook` e `order_id = null`.

## 7. Post-review adjustment

- causa do blocker: o summary original do `07-02` deixou um risco residual valido. O entrypoint aceitava `AnalyticsEventLog` como opcional e os testes provavam o comportamento so com injecao manual do modulo, mas o runtime real do app ainda nao tinha o modulo registrado.
- arquivo de configuracao alterado: `apps/backend/medusa-config.ts`.
- como o modulo foi registrado: foi adicionada uma entrada em `modules` apontando para `./src/modules/analytics-event-log`, com `key: "analytics_event_log"` para atender a restricao do registry do Medusa de aceitar apenas nomes alfanumericos/underscore.
- mudanca de fail-closed para modulo ausente: `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` agora valida `AnalyticsEventLog` antes de prosseguir com criacao/recovery de `Order`. Se o modulo estiver ausente ou mal configurado, o fluxo falha com `ORDER_ENTRYPOINT_ANALYTICS_EVENT_LOG_MODULE_UNAVAILABLE` e nao chama `completeCartWorkflow`.
- compatibilidade de runtime/testes: o resolver do entrypoint aceita a chave real de runtime `analytics_event_log` e tambem o token usado nos testes existentes, preservando a cobertura local sem reabrir o escopo de outros arquivos.
- teste adicionado: `AnalyticsEventLog module missing -> no completeCartWorkflow call` em `apps/backend/src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts`.
- validacoes rerodadas apos o ajuste:
  - unit do slice: PASS (`5/5`);
  - regressao unit do modulo analytics: PASS (`16/16`);
  - HTTP filtrado `purchase_completed|analytics outbox`: PASS (`2/2`);
  - build: PASS;
  - grep negativo PostHog/Email/Gelato/Fulfillment/Refund/Tracking: PASS;
  - grep negativo Store completion: PASS;
  - grep negativo payload analytics: PASS;
  - `git diff --check`: PASS.
- confirmacao explicita: `07-03` nao foi iniciado.
- confirmacao explicita: PostHog, Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke e migration real nao foram executados.

## 8. Gate manual

Parado exatamente no gate manual apos `07-02-SUMMARY.md`.

Nao iniciado deliberadamente:

- `07-03`;
- relay/job assicrono;
- chamada real de PostHog;
- qualquer fase de Email/Gelato/fulfillment/refund/tracking.
