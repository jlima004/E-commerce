# PaymentCollection Initiation Hotfix — Summary

Data de validação: 2026-07-09

## Objetivo

Corrigir somente o fluxo Store API `POST /store/carts/:id/payment-attempts/card` para que um checkout novo crie/reuse uma `PaymentCollection` Medusa real, crie uma `PaymentSession` Medusa real, grave esses IDs reais no `PaymentAttempt`, preserve um único Stripe PaymentIntent e permita que o webhook `payment_intent.succeeded` alimente `completeCartWorkflow` sem cair em `Payment collection has not been initiated for cart`.

## Resultado

Hotfix local concluído e validado em testes/build, sem deploy.

- A rota card consulta `cart_payment_collection` e cria a collection via `createPaymentCollectionForCartWorkflowId` quando necessário.
- A rota cria uma `PaymentSession` real no Payment Module com provider `pp_stripe_stripe`.
- `startCardPaymentAttempt` recebe os IDs reais da sessão Medusa e os usa em `PaymentAttempt.payment_collection_id` e `PaymentAttempt.payment_session_id`.
- O Stripe layer recebe `payment_session_id` real e passa esse ID como `metadata.session_id`, preservando o fallback antigo para fluxos que ainda não passam sessão real.
- Após criar o Stripe PaymentIntent único pelo wrapper seguro existente, a rota atualiza a `PaymentSession` com `data.id = provider_payment_intent_id` e dados allowlist-only.
- `client_secret`, `next_action`, QR/copia-e-cola e payload Stripe bruto continuam fora da persistência e aparecem somente na resposta imediata quando aplicável.
- O Payment Stripe provider foi registrado condicionalmente quando `STRIPE_REAL_INITIATION_ENABLED` e `STRIPE_SECRET_KEY` existem, para que `completeCartWorkflow` consiga autorizar a sessão real.
- Revisão local do provider `@medusajs/payment-stripe` confirmou que `authorizePayment` chama `paymentIntents.retrieve(id)`, usando o `PaymentSession.data.id` existente; essa ponte não cria um segundo PaymentIntent.

## Arquivos Alterados

- `.planning/STATE.md`
- `apps/backend/medusa-config.ts`
- `apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts`
- `apps/backend/src/modules/payment-attempt/card.ts`
- `apps/backend/src/modules/payment-attempt/stripe-real.ts`
- `apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts`
- `apps/backend/src/modules/payment-attempt/__tests__/stripe-real.unit.spec.ts`
- `apps/backend/integration-tests/http/payment-attempt-store.spec.ts`
- `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts`
- `.planning/ops/payment-collection-initiation-hotfix-2026-07-08-SUMMARY.md`

## Validação

Passou:

```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend
```

Resultado: build PASS.

Passou:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
```

Resultado: 2 suites PASS, 19 testes PASS.

Passou:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runInBand src/modules/payment-attempt
```

Resultado: 11 suites PASS, 164 testes PASS.

Passou:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runInBand src/workflows/order
```

Resultado: 6 suites PASS, 50 testes PASS.

Passou:

```bash
TMPDIR=/tmp npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts integration-tests/http/stripe-webhook-order-creation.spec.ts
```

Resultado: 2 suites PASS, 46 testes PASS.

Observação: a primeira tentativa desse HTTP revelou fixtures antigas em `stripe-webhook-order-creation.spec.ts` com soma de itens divergente de `PaymentAttempt.amount`. A correção foi restrita aos dados de teste para refletir a validação atual por `quantity * unit_price`, sem enfraquecer o runtime.

## Negativas Preservadas

- Phase 12 não foi iniciada.
- Refund smoke não foi executado.
- Nenhum refund Stripe foi criado.
- `sk_live` não foi usado.
- Gelato real não foi chamado.
- Correios não foi chamado.
- Nenhuma Order foi criada manualmente no banco.
- Nenhum insert manual foi feito em `payment_collection`, `payment_session` ou link tables.
- Nenhuma migration nova foi aplicada.
- `package.json`, `package-lock.json` e `apps/backend/package.json` não foram alterados.
- Erro de `completeCartWorkflow` não foi mascarado.
- Nenhum PI antigo foi tentado via SQL manual.
- Deploy não foi executado.

## Riscos/Notas

- O hotfix ainda cobre somente card; Pix permanece fora deste gate.
- A rota usa `createPaymentSession_`, método interno do Payment Module. A escolha foi mantida para evitar `createPaymentSessionsWorkflow`, que chamaria o provider Stripe e poderia criar um segundo PaymentIntent e persistir payload mais amplo em `PaymentSession.data`.
- A ativação real continua dependente de configuração segura de Stripe test/prod e de validação manual em ambiente controlado.

## Gate

Parar aqui para revisão manual. Próximo passo operacional, se aprovado separadamente, é smoke controlado de novo checkout card em ambiente seguro, sem deploy automático a partir deste summary.
