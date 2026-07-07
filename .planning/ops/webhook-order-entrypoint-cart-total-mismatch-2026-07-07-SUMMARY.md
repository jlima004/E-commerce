# Webhook Order Entrypoint cart total mismatch gate — 2026-07-07

## Objetivo

Corrigir o gate tecnico `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH` no fluxo canonico `payment_intent.succeeded` -> `Order`, validando o valor pago no `PaymentAttempt` contra o total calculavel do carrinho sem depender de `Order.cart_id` nem de `cart.total` estar presente no objeto carregado.

## Problema observado

- `PaymentAttempt.amount = 9900`.
- Stripe `PaymentIntent.amount = 9900`.
- `cart_line_item.quantity = 1`.
- `cart_line_item.unit_price = 9900`.
- Total de itens = `9900`.
- A `Order` nao foi criada porque o entrypoint lancou `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH`.

## Solucao implementada

1. `ConfirmedAttemptCartRecord.total` deixou de ser obrigatorio para a validacao do entrypoint.
2. O entrypoint passou a carregar `items.unit_price` no Query Graph.
3. A validacao de valor agora calcula o total validavel dos line items:
   - `quantity * unit_price`;
   - normalizacao para `BigInt`;
   - suporte a valores inteiros como `number`, `bigint`, string inteira, `rawAmount`, `numeric`, `valueOf` e `toString`.
4. `PaymentAttempt.amount` tambem e normalizado para `BigInt` antes da comparacao.
5. `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH` continua sendo lancado quando o total calculado e invalido ou diverge de fato do valor pago.
6. O payload local de analytics/e-mail passa a preferir `items.unit_price`, mantendo fallback para preco da variant quando necessario nos contratos antigos.

Para o caso observado, `1 * 9900 = 9900`, que passa a bater com `PaymentAttempt.amount = 9900`.

## Arquivos alterados

```text
apps/backend/src/workflows/order/steps/create-order-from-confirmed-attempt.ts
apps/backend/src/workflows/order/webhook-order-entrypoint.ts
apps/backend/src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
```

## Validacao

```bash
TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
git diff --check
git diff --name-only -- package.json package-lock.json apps/backend/package.json apps/backend/package-lock.json apps/backend/src/modules apps/backend/src/api/admin apps/backend/src/api/hooks/gelato apps/backend/src/api/hooks/stripe apps/backend/src/jobs ops .planning/ROADMAP.md .planning/REQUIREMENTS.md .planning/STATE.md
```

Resultados:

- Unit focado: PASS — 2 suites / 14 testes.
- Build backend: PASS.
- `git diff --check`: PASS.
- `package*`, migrations, Admin, Stripe route, Gelato route, jobs, `ROADMAP.md`, `REQUIREMENTS.md` e `STATE.md`: sem alteracoes.

## Fora de escopo respeitado

- Phase 12 nao iniciada.
- Refund smoke nao executado.
- Refund Stripe nao criado.
- `sk_live` nao usado.
- Gelato real nao chamado.
- Correios nao chamado.
- Nenhuma `Order` manual criada no banco.
- Nenhuma migration nova criada ou aplicada.
- `package.json` / `package-lock.json` nao alterados.
- Mismatch real nao foi mascarado; o guard `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH` permanece ativo.
