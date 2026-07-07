# Stripe CheckoutCompletion retry/idempotency gate — 2026-07-07

## Objetivo

Corrigir o gate técnico do fluxo canônico `payment_intent.succeeded` -> `Order` para impedir `WebhookEventLog.status = processed` quando a criação/correlação de Order não terminou de forma terminal.

## Problema observado

- `PaymentAttempt` foi confirmado pelo webhook.
- `CheckoutCompletionLog` ficou em `processing` sem `order_id`.
- `WebhookEventLog` foi marcado como `processed`.
- Nenhuma `Order` foi criada.

## Solução implementada

1. `CheckoutCompletionLog.status = processing` sem `order_id` agora é tratado como retry controlado:
   - a tentativa anterior é marcada como `failed` com `CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER`;
   - o mesmo log é reclamado novamente como `processing`;
   - o entrypoint segue para nova tentativa de criação/correlação de Order.
2. A rota Stripe valida o retorno do entrypoint antes de marcar o webhook como `processed`.
   - `processed` só é permitido quando o entrypoint retorna `created` ou `reused_existing_order` com `order_id`.
   - retorno sem `order_id` falha explicitamente com `CHECKOUT_COMPLETION_NOT_TERMINAL`.
3. Idempotência preservada:
   - `PaymentAttempt.order_id` existente evita nova chamada ao entrypoint;
   - `CheckoutCompletionLog.completed` com `order_id` continua sendo reutilizado;
   - `processing` antigo sem `order_id` deixa de mascarar falha como sucesso terminal.

## Arquivos alterados

```text
apps/backend/src/api/hooks/stripe/route.ts
apps/backend/src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts
apps/backend/src/modules/checkout-completion/service.ts
apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts
apps/backend/src/workflows/order/webhook-order-entrypoint.ts
apps/backend/src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
```

## Validação

```bash
TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts
HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
git diff --check
git diff --name-only -- package.json package-lock.json apps/backend/package.json apps/backend/package-lock.json apps/backend/src/modules/checkout-completion/migrations apps/backend/src/modules/payment-attempt/migrations apps/backend/src/modules/webhooks/migrations
```

Resultados:

- Unit focado: PASS — 3 suites / 28 testes.
- Build backend: PASS.
- `git diff --check`: PASS.
- `package*` e migrations: sem alterações.

## Fora de escopo respeitado

- Phase 12 não iniciada.
- Refund smoke não executado.
- Refund Stripe não criado.
- `sk_live` não usado.
- Gelato real não chamado.
- Correios não chamado.
- Nenhuma `Order` manual criada no banco.
- Nenhuma migration nova criada ou aplicada.
- `package.json` / `package-lock.json` não alterados.
- Nenhum `WebhookEventLog.processed` foi deletado.
