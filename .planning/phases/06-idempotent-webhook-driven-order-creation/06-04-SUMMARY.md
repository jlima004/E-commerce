---
phase: 06-idempotent-webhook-driven-order-creation
plan: 04
subsystem: order-creation
tags: [order, gelato-snapshot, checkout-completion, idempotency]

requires:
  - phase: 06-idempotent-webhook-driven-order-creation
    plan: 03
    provides: transactional Order creation with mandatory LineItem gelato_snapshot
provides:
  - exact GelatoSnapshot v1 shape guard before LineItem snapshot persistence
  - expanded snapshot helper edge-case coverage
  - HTTP integration proof for snapshot immutability after ProductVariant mutation
  - HTTP integration proof that snapshot failure records sanitized CheckoutCompletionLog.failed without partial Order
affects: [phase-07-purchase-completed, phase-09-gelato-fulfillment]

tech-stack:
  added: []
  patterns:
    - runtime shape guard for persisted GelatoSnapshot v1
    - route-level integration doubles around the real post-webhook Order entrypoint

key-files:
  created:
    - .planning/phases/06-idempotent-webhook-driven-order-creation/06-04-SUMMARY.md
  modified:
    - apps/backend/src/workflows/order/steps/build-order-line-item-gelato-snapshots.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts
    - apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts

key-decisions:
  - "Order LineItem snapshot persistence now fails closed if the generated snapshot does not match the exact GelatoSnapshot v1 runtime shape."
  - "HTTP immutability proof copies cart line metadata into the Order double, then mutates ProductVariant metadata and verifies the persisted Order line snapshot is unchanged."
  - "Snapshot failures remain pre-Order failures: CheckoutCompletionLog is marked failed with sanitized error details and retry does not call completeCartWorkflow."

patterns-established:
  - "Exact snapshot shape is checked at the Order workflow boundary, not only by TypeScript."
  - "Snapshot failure retry tests must assert no Order, no PaymentAttempt.order_id and no complete-cart call."

requirements-completed: [ORD-01, ORD-02, CAT-04]

duration: 45min
completed: 2026-06-30
status: complete
---

# Phase 06 Plan 04 - Snapshot Hardening Summary

**Gelato snapshots are now guarded for exact v1 shape at the Order boundary, with tests proving edge cases, immutability, failure/retry behavior and no Gelato fulfillment scope.**

## Arquivos alterados

| Arquivo | Acao |
|---------|------|
| `apps/backend/src/workflows/order/steps/build-order-line-item-gelato-snapshots.ts` | adicionou guard runtime para o shape exato `GelatoSnapshot v1` antes de montar o patch de metadata |
| `apps/backend/src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts` | expandiu edge cases do helper de snapshot |
| `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts` | adicionou testes HTTP com entrypoint real em memoria para imutabilidade e falha/retry |
| `.planning/phases/06-idempotent-webhook-driven-order-creation/06-04-SUMMARY.md` | este summary |

`apps/backend/src/workflows/order/webhook-order-entrypoint.ts` estava permitido pelo plano, mas nao precisou ser alterado: a logica do `06-03` ja marcava falhas pre-Order como `CheckoutCompletionLog.failed` e recuperava Order existente sem reconstruir snapshot.

## Edge cases cobertos

- Carrinho multi-line com snapshots para todos os line items.
- Merge de `LineItem.metadata` preservando campos seguros existentes (`safe_note`, `gift_wrap`, `custom_flag`) e adicionando somente `gelato_snapshot`.
- `variant` ausente falha antes de snapshot.
- SKU ausente falha com erro sanitizado.
- Metadata Gelato invalida falha com erro sanitizado.
- `captured_at` invalido falha com erro sanitizado.
- Um unico `captured_at` por Order/captura.
- Shape exato `GelatoSnapshot v1` com chaves de topo e `gelato_variant_options` sem enriquecimento.

## Estrategia de imutabilidade

- O helper continua construindo snapshots a partir do estado do `ProductVariant` no momento da Order.
- O novo guard valida que o objeto persistido no line item tem exatamente:
  - `gelato_product_uid`
  - `gelato_template_id`
  - `gelato_variant_options.size`
  - `gelato_variant_options.color`
  - `template_mode`
  - `source_product_variant_id`
  - `source_product_variant_sku`
  - `captured_at`
- O teste HTTP cria uma Order em memoria copiando metadata do cart line item ja snapshotado, altera depois `ProductVariant.metadata` e confirma que `Order.items[].metadata.gelato_snapshot` permanece identico ao snapshot persistido.

## Estrategia de falha/retry

- Snapshot invalido acontece antes de `completeCartWorkflow`.
- O entrypoint marca o `CheckoutCompletionLog` como `failed`, com:
  - `order_id = null`
  - `error_code = ORDER_GELATO_METADATA_INCOMPLETE`
  - `error_message = Nao foi possivel gerar o snapshot Gelato para o item do carrinho.`
- O retry usa novo evento Stripe para o mesmo PaymentIntent, reabre o log falho de forma controlada, falha novamente pelo mesmo snapshot invalido e nao chama `completeCartWorkflow`.
- `PaymentAttempt.order_id` permanece `null`.
- Nenhuma Order parcial e inserida no double de Order.

## Testes executados

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts \
  src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts
# PASS - 2 suites, 11 tests
```

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "gelato_snapshot|immutability|snapshot failure|edge"
# PASS - 1 suite, 2 matched tests passed, 3 skipped by filter
```

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|X-API-KEY|gelato_order_id|create.*Fulfillment|Fulfillment" -- src/workflows/order src/modules/checkout-completion integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
# PASS - no matches
```

Prova negativa adicional para efeitos Phase 07+:

```bash
bash -lc 'cd apps/backend && git grep -n -E "purchase_completed|AnalyticsEventLog|posthog|EmailDeliveryLog|resend|refund|Refund" -- src/workflows/order src/modules/checkout-completion integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
# PASS - no matches
```

## Resultados confirmados

| Confirmacao | Status |
|-------------|--------|
| Snapshots seguem shape exato `GelatoSnapshot v1` | OK |
| Alteracao futura de `ProductVariant.metadata` nao altera snapshot ja persistido no Order LineItem | OK |
| Falha de snapshot nao cria Order parcial | OK |
| Retry nao cria Order sem snapshot | OK |
| `CheckoutCompletionLog.failed` e sanitizado em falha de snapshot | OK |
| Nenhuma Order pode existir sem `LineItem.metadata.gelato_snapshot` no caminho novo | OK |
| Sem chamada Gelato API | OK |
| Sem fulfillment | OK |
| Sem `gelato_order_id` | OK |
| Sem `purchase_completed` | OK |
| Sem e-mail / `EmailDeliveryLog` | OK |
| Sem analytics / `AnalyticsEventLog` / PostHog | OK |
| Sem refund | OK |
| Sem Stripe CLI smoke | OK |
| Sem migration manual | OK |
| Sem endpoint Store/checkout completion | OK |
| `06-05` nao iniciado | OK |
| Phase 07 nao iniciada | OK |

## Desvios do plano

Nenhum desvio de escopo. O arquivo `webhook-order-entrypoint.ts` foi lido e estava autorizado, mas nao precisou de alteracao porque o comportamento esperado ja estava coberto pelo fluxo existente do `06-03`; o hardening ficou no guard do helper e nas provas unit/HTTP.

## Manual gate

PARAR AQUI. O slice `06-04` termina neste summary. `06-05` nao foi iniciado e Phase 07 permanece bloqueada ate aprovacao humana separada.
