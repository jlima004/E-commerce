# 05-03 Summary

## 1. Arquivos alterados

- `apps/backend/src/modules/payment-attempt/types.ts`
- `apps/backend/src/modules/payment-attempt/state-machine.ts`
- `apps/backend/src/modules/payment-attempt/migrations/Migration20260629000000.ts`
- `apps/backend/src/modules/payment-attempt/service.ts`
- `apps/backend/src/modules/payment-attempt/__tests__/payment-attempt-webhook.unit.spec.ts`
- `apps/backend/src/api/hooks/stripe/route.ts`
- `apps/backend/integration-tests/http/stripe-webhook-store.spec.ts`
- `.planning/phases/05-stripe-webhook-ingestion-idempotency/05-03-SUMMARY.md`

Observacao: `apps/backend/src/modules/payment-attempt/models/payment-attempt.ts` nao precisou de diff porque o model ja consome `PAYMENT_ATTEMPT_STATUS` importado de `types.ts`; ao ampliar o enum de origem, o model passou a refletir o novo estado sem mudanca textual adicional.

## 2. Estado novo adicionado

- `payment_confirmed_by_webhook`

Contrato implementado:

- significa apenas confirmacao local por webhook Stripe assinado, validado e idempotente;
- nao significa Order criado;
- `PaymentAttempt.order_id` permanece `null`;
- o estado foi mantido como ativo para bloquear nova tentativa antes da Phase 06;
- nao foram introduzidos labels proibidos como `paid`, `succeeded`, `captured` ou `confirmed_payment`.

## 3. Transicoes implementadas

- `payment_intent.succeeded -> payment_confirmed_by_webhook`
- `payment_intent.payment_failed -> payment_failed`
- `payment_intent.canceled -> payment_canceled`

Transicoes liberadas para confirmacao por webhook:

- `card_client_secret_created -> payment_confirmed_by_webhook`
- `payment_client_confirmed -> payment_confirmed_by_webhook`
- `awaiting_pix_payment -> payment_confirmed_by_webhook`
- `awaiting_webhook_confirmation -> payment_confirmed_by_webhook`

Estados terminais/stale continuam sem reativacao; quando um evento chega fora de ordem para tentativa ja terminal, o handler responde `200` seguro e registra `WebhookEventLog` como `ignored`.

Ajuste pos-review aplicado no dedup:

- duplicata so vira no-op quando o `WebhookEventLog` existente ja esta em estado final: `processed`, `ignored` ou `failed`;
- duplicata ainda em `received` continua processamento normal;
- duplicata de evento nao suportado ainda em `received` e fechada como `ignored`, em vez de ficar em no-op permanente.

## 4. Validacoes de PaymentIntent implementadas

Antes de atualizar `PaymentAttempt`, o fluxo agora valida:

- `payment_intent.id` presente;
- existencia de tentativa correlata por `provider_payment_intent_id`;
- transicao permitida pela state machine para o evento recebido;
- `amount_received` ou `amount` igual a `PaymentAttempt.amount`;
- `currency` igual a `PaymentAttempt.currency_code`;
- `metadata.cart_id`, quando presente, igual a `PaymentAttempt.cart_id`;
- compatibilidade entre `payment_method_types` do Stripe e `PaymentAttempt.payment_method_type`.

Casos divergentes implementados:

- tentativa inexistente -> `WebhookEventLog.status = failed`
- tentativa stale/terminal -> `WebhookEventLog.status = ignored`
- amount divergente -> `WebhookEventLog.status = failed`
- currency divergente -> `WebhookEventLog.status = failed`
- cart divergente -> `WebhookEventLog.status = failed`
- metodo divergente -> `WebhookEventLog.status = failed`

Todos retornam resposta Stripe segura (`200` para evento assinado), nao criam Order, nao crasham o handler e nao logam payload bruto.

## 5. Testes executados e resultado

Executado:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-webhook.unit.spec.ts
```

Resultado:

- `PASS src/modules/payment-attempt/__tests__/payment-attempt-webhook.unit.spec.ts`
- `13 passed, 13 total`

Cobertura provada no unit:

- `payment_intent.succeeded` confirma para `payment_confirmed_by_webhook`;
- `payment_intent.payment_failed` marca `payment_failed`;
- `payment_intent.canceled` marca `payment_canceled`;
- `order_id` permanece `null`;
- tentativa ja no status-alvo do mesmo evento e tratada como idempotente;
- tentativa inexistente falha saneada;
- tentativa terminal nao e reativada;
- amount divergente nao confirma;
- currency divergente nao confirma;
- cart divergente nao confirma;
- metodo divergente nao confirma;
- replay do mesmo evento em status terminal vira no-op idempotente;
- evento diferente tentando reativar estado terminal continua stale/ignored.

Executado:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-store.spec.ts -t "payment_intent"
```

Resultado:

- `PASS integration-tests/http/stripe-webhook-store.spec.ts`
- `8 passed, 8 matched by filter`
- ficaram `skipped` apenas cenarios fora do filtro (`preserveRawBody` e evento nao suportado), sem relacao com o slice `05-03`.

Cobertura provada no integration HTTP:

- `payment_intent.succeeded` atualiza exatamente uma tentativa;
- `payment_intent.payment_failed` atualiza somente `PaymentAttempt`;
- `payment_intent.canceled` atualiza somente `PaymentAttempt`;
- tentativa inexistente nao cria Order e nao crasha;
- tentativa terminal nao e reativada;
- replay deduplicado nao duplica mutacao.
- `WebhookEventLog` duplicado ainda em `received` continua processamento e fecha como `processed`;
- `WebhookEventLog` duplicado ja em `processed` retorna `duplicate=true` sem chamar `updatePaymentAttempts`.

## 6. Confirmacao de idempotencia/replay

- a dedup continua baseada em `WebhookEventLog`;
- replay do mesmo evento retorna `200`;
- duplicata com log final responde `duplicate: true`;
- duplicata com log ainda em `received` continua processamento e fecha o log;
- a mutacao de `PaymentAttempt` ocorre uma unica vez quando o log ja esta final;
- reaplicacao do mesmo evento com tentativa ja no status-alvo vira no-op idempotente, preservando `order_id = null`;
- tentativa terminal nao sofre nova mutacao por replay/out-of-order.

## 7. Confirmacao de `PaymentAttempt.order_id = null`

Confirmado em implementacao e testes:

- helpers de mutacao (`payment_confirmed_by_webhook`, `payment_failed`, `payment_canceled`) sempre preservam `order_id: null`;
- unit tests verificam `order_id = null` nos tres caminhos suportados;
- integration tests verificam `order_id = null` no estado persistido em memoria.

## 8. Confirmacao de ausencia de Order

Nao ha criacao de Order no slice `05-03`.

Prova negativa:

- grep focado nos arquivos de runtime alterados passou sem ocorrencias para `completeCartWorkflow`, `createOrderWorkflow`, `CheckoutCompletionLog`, `purchase_completed`, `order.gelatoapis.com`, `gelato_order_id`, `EmailDeliveryLog` e `AnalyticsEventLog`.

Comando focado:

```bash
cd apps/backend && ! rg -n "completeCartWorkflow|createOrderWorkflow|CheckoutCompletionLog|purchase_completed|order\.gelatoapis\.com|gelato_order_id|EmailDeliveryLog|AnalyticsEventLog" src/api/hooks/stripe/route.ts src/modules/payment-attempt/types.ts src/modules/payment-attempt/state-machine.ts src/modules/payment-attempt/models/payment-attempt.ts src/modules/payment-attempt/migrations/Migration20260629000000.ts src/modules/payment-attempt/service.ts src/modules/webhooks/service.ts
```

## 9. Confirmacao de ausencia de `CheckoutCompletionLog`

Confirmado: nenhuma referencia introduzida em runtime do slice `05-03`.

## 10. Confirmacao de ausencia de `purchase_completed`

Confirmado: nenhuma emissao ou persistencia introduzida em runtime do slice `05-03`.

## 11. Confirmacao de ausencia de Gelato, e-mail, analytics e refund

Confirmado:

- sem Gelato;
- sem e-mail;
- sem analytics outbox;
- sem refund.

### Nota sobre os greps literais solicitados

Execucao literal:

```bash
cd apps/backend && ! rg -n "completeCartWorkflow|createOrderWorkflow|CheckoutCompletionLog|purchase_completed|order\.gelatoapis\.com|gelato_order_id|EmailDeliveryLog|AnalyticsEventLog" src/api/hooks src/modules/payment-attempt src/modules/webhooks
```

Esse grep falhou por canarios/pre-existentes fora do runtime do slice:

- `src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts`
- `src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts`

Execucao literal:

```bash
cd apps/backend && ! rg -n "sk_test_|sk_live_|whsec_|client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|Authorization|cookies" src/api/hooks/stripe src/modules/webhooks src/modules/payment-attempt
```

Esse grep tambem falhou, mas por dois motivos diferentes:

- canarios/test fixtures pre-existentes fora do slice;
- vocabulario defensivo legitimo em runtime ja existente, como o status `card_client_secret_created` e a blocklist de chaves sensiveis em `state-machine.ts`.

Para separar risco real de falso positivo, rodei provas negativas focadas nos arquivos de runtime alterados que realmente carregam a logica de `05-03`:

```bash
cd apps/backend && ! rg -n "sk_test_|sk_live_|whsec_|pi_[A-Za-z0-9_]+_secret_|Authorization|cookies" src/api/hooks/stripe/route.ts src/modules/payment-attempt/service.ts src/modules/webhooks/service.ts
```

```bash
cd apps/backend && ! rg -n "client_secret|pix_display_qr_code|copy_paste|hosted_instructions_url" src/api/hooks/stripe/route.ts src/modules/payment-attempt/service.ts src/modules/webhooks/service.ts
```

Ambos passaram sem ocorrencias.

## 12. Confirmacao de que `05-04` nao foi iniciado

Confirmado: o trabalho foi encerrado no manual gate de `05-03-SUMMARY.md`; nenhuma alteracao de `05-04` foi iniciada.
