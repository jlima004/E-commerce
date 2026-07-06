# Stripe Controlled Order Fix — 2026-07-06

## Objetivo

Desbloquear o fluxo canônico de webhook Stripe (`payment_intent.succeeded` em test mode) para que:

1. persista `WebhookEventLog`;
2. confirme `PaymentAttempt`;
3. execute `CheckoutCompletionLog`;
4. crie `Order` somente após webhook confirmado;
5. gere massa válida para futuro Stripe refund smoke.

## Problema observado

- Stripe entregou `payment_intent.succeeded`, mas `POST /hooks/stripe` retornou **500**.
- Erro runtime: `AwilixResolutionError: Could not resolve 'webhooks'`.
- Módulos `webhooks` e `checkoutCompletion` **não estavam registrados** em `medusa-config.ts`.
- `PaymentAttempt` de cartão foi criado com `provider=stripe_safe_layer`.
- `webhook-order-entrypoint` exige `provider === "stripe"` — guard preservado.

## Solução implementada

### 1. Registro de módulos em `medusa-config.ts`

| Módulo | Key | Resolve |
|--------|-----|---------|
| WebhookEventLog | `webhooks` | `./src/modules/webhooks` |
| CheckoutCompletionLog | `checkoutCompletion` | `./src/modules/checkout-completion` |

### 2. Provider canônico na camada de cartão

Arquivo: `apps/backend/src/modules/payment-attempt/card.ts`

- `provider` persistido como **`stripe`** (canônico).
- Rastreabilidade da camada segura em metadata: `stripe_initiation_layer = "stripe_safe_layer"`.
- Guard `provider === "stripe"` em `webhook-order-entrypoint` **inalterado**.
- `PaymentAttempt` antigo com `stripe_safe_layer` **não corrigido retroativamente** (conforme escopo).

### 3. Ajuste de tipo (consequência do registro do módulo)

Arquivo: `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`

- Cast `as unknown as CheckoutCompletionModuleLike` para compatibilidade com tipos gerados pelo Medusa após registro do módulo.

## Arquivos alterados

```
apps/backend/medusa-config.ts
apps/backend/src/modules/payment-attempt/card.ts
apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
apps/backend/src/workflows/order/webhook-order-entrypoint.ts
```

## Fora de escopo (respeitado)

- Phase 12 não iniciada
- Refund smoke / refund Stripe real
- `sk_live`
- Gelato real / Correios
- Order manual no banco
- `package.json` / `package-lock.json`
- Novas migrations
- Relaxamento do guard de provider
- Correção retroativa de `PaymentAttempt` antigo
- Alteração em `pix.ts` (escopo limitado à camada de cartão)

## Validações locais

| Check | Resultado |
|-------|-----------|
| `card-initiation.unit.spec.ts` | **PASS** — `provider=stripe`, metadata `stripe_initiation_layer` |
| `payment-attempt-webhook.unit.spec.ts` | **PASS** |
| `payment-attempt-order-eligibility.unit.spec.ts` | **PASS** |
| `stripe-webhook-order-creation.spec.ts` (HTTP) | **PASS** — 21/21 |
| `npm run build -w @dtc/backend` | **PASS** |
| `git diff --check` | **PASS** |
| `git diff --name-only package.json package-lock.json apps/backend/package.json` | **vazio** |

### Observações de testes

- `stripe-webhook-store.spec.ts` (HTTP): 4 falhas **pré-existentes** — suite Phase 05 não injeta `runOrderEntrypoint` mock; com order entrypoint real o status retorna `failed` quando `checkoutCompletion` não está no scope do teste. Não é regressão deste fix.
- `webhook-order-entrypoint.unit.spec.ts` / `webhook-order-creation.unit.spec.ts`: falhas por mocks incompletos de `analytics_event_log` — drift pré-existente, fora do escopo mínimo.

## Manual gate — deploy validation

**Parar aqui.** Deploy somente após aprovação manual:

```bash
git push heroku HEAD:main
heroku releases -a espacoliminar | head -10
heroku releases:output <nova-release> -a espacoliminar
```

Confirmar:

- `/health/live` PASS com `APP_VERSION` novo
- `/health/ready` PASS — `postgres=up`, `redis=up`
- Release output **sem** `ECONNRESET` / `MaxRetriesPerRequestError`
- `web.1` e `worker.1` up

## Manual gate — smoke pós-fix (sem refund)

Após deploy aprovado, executar checkout controlado novo:

1. Criar novo checkout controlado (cartão, Stripe test mode)
2. Confirmar pagamento (`payment_intent.succeeded`)
3. Validar `WebhookEventLog` persistido (`status=processed`)
4. Validar `PaymentAttempt.status=payment_confirmed_by_webhook`
5. Validar `PaymentAttempt.provider=stripe`
6. Validar `PaymentAttempt.order_id` preenchido
7. Validar `Order` criada por webhook (não manual)
8. Validar `GelatoFulfillment = 0` ou sem dispatch real indevido

**Não executar:** refund smoke, `sk_live`, Gelato real, Correios.

## Próximo passo

Aguardar aprovação manual para deploy + smoke controlado acima.
