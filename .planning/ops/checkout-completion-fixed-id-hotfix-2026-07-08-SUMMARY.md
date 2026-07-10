# CheckoutCompletionLog Fixed ID Hotfix — 2026-07-08

Data de validação: 2026-07-09

## Resultado

Hotfix concluído e validado em testes/build e deploy.

## Problema

- Webhook `payment_intent.succeeded` falhou com:
  `Checkout completion log with id: chkcpl_order_entrypoint_pending, already exists.`
- Causa: ID fixo no `CheckoutCompletionLog` criado pelo order entrypoint.

## Correção

- Removido ID fixo do caminho runtime do `webhook-order-entrypoint`.
- Novo `CheckoutCompletionLog` passa a ser criado sem `id` explicito, deixando o model/service gerar a PK `chkcpl_*`.
- Idempotencia preservada por `idempotency_key = payment_intent_id`.
- Checkouts com `payment_intent_id` diferentes criam/reivindicam logs distintos sem colisao de primary key.
- Reuso idempotente de `completed + order_id` preservado sem nova Order.
- Retry controlado de `processing` ou `failed` sem `order_id` preservado.

## Validações

- testes:
  - `TMPDIR=/tmp npm run test:unit -- --runTestsByPath ...` no root falhou porque o root nao possui script `test:unit`.
  - Equivalente no workspace PASS:
    `TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts`
    Resultado: 2 suites PASS, 27 testes PASS.
  - Equivalente da suite order no workspace PASS:
    `TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runInBand src/workflows/order`
    Resultado: 6 suites PASS, 50 testes PASS.
- build:
  - `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend`
  - Resultado: PASS.
- diff check:
  - `git diff --check`
  - Resultado: PASS, sem saida.
- lockfiles:
  - `git diff --name-only package.json package-lock.json apps/backend/package.json`
  - Resultado: PASS, sem saida.
- grep:
  - `git grep -n "chkcpl_order_entrypoint_pending"`
  - Resultado: sem resultados.

## Escopo respeitado

- Sem Phase 12.
- Sem refund smoke.
- Sem refund Stripe.
- Sem `sk_live`.
- Sem Gelato/Correios.
- Sem Order manual.
- Sem migration nova.
- Sem alteracao em `package.json`, `package-lock.json` ou `apps/backend/package.json`.
- Sem delecao de logs processados.
- Sem chamadas reais via conector Stripe.
- Sem alteracao Supabase/schema/RLS/Data API.

## Registro de smoke final
Final clean smoke:
PI_ID=pi_3TrR4yQy1Qutz95t1baN4nbv
PAYMENT_ATTEMPT_ID=payatt_de07f78b4e094f77
CART_ID=cart_01KX4J50P2NKRF8KTRY5Z127P1
ORDER_ID=order_01KX4JDNE9NTXV4YA11Q5MENX9
WebhookEventLog.status=processed
CheckoutCompletionLog.status=completed
Stripe.status=succeeded
amount=9900
currency=brl
