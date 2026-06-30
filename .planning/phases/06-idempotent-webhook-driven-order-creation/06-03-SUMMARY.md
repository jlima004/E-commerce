---
phase: 06-idempotent-webhook-driven-order-creation
plan: 03
subsystem: order-creation
tags: [order, checkout-completion, payment-attempt, gelato-snapshot, idempotency]

requires:
  - phase: 06-idempotent-webhook-driven-order-creation
    plan: 02
    provides: internal post-webhook entrypoint and strict PaymentAttempt eligibility
provides:
  - transactional claim/reuse semantics for CheckoutCompletionLog
  - mandatory Gelato snapshot persistence before internal cart completion
  - first real Order creation path from confirmed PaymentAttempt
  - correlation between Order, CheckoutCompletionLog and PaymentAttempt.order_id
  - replay / processing no-second-winner coverage

completed: 2026-06-30
status: complete
---

# Phase 06 Plan 03 — Transactional Order Creation & Required Snapshot Summary

**O slice `06-03` habilitou a criacao real de `Order` a partir do entrypoint interno pos-webhook, passou a exigir `LineItem.metadata.gelato_snapshot` antes da conclusao do cart e completou a correlacao entre `Order`, `CheckoutCompletionLog` e `PaymentAttempt.order_id`, mantendo Phase 07+ fora do escopo.**

## Arquivos alterados

| Arquivo | Ação |
|---------|------|
| `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` | substituido o stub por fluxo real com claim idempotente, snapshots obrigatorios, complete-cart interno, correlacao e status de retorno |
| `apps/backend/src/workflows/order/steps/create-order-from-confirmed-attempt.ts` | criado helper puro para validar cart/attempt, montar estado complementar da Order e sanitizar falhas |
| `apps/backend/src/workflows/order/steps/build-order-line-item-gelato-snapshots.ts` | criado helper puro para gerar `GelatoSnapshot v1` para todos os line items antes da Order nascer |
| `apps/backend/src/modules/checkout-completion/service.ts` | adicionados helpers puros de claim/retry/completed/failed para `CheckoutCompletionLog` |
| `apps/backend/src/modules/payment-attempt/service.ts` | adicionado helper estreito para correlacionar `PaymentAttempt.order_id` com Order confirmada |
| `apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts` | criado — cobre criacao, replay, processing concorrente, falha antes da Order e retry apos Order parcial |
| `apps/backend/src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts` | criado — cobre snapshot canonico, metadata preservada e falhas sanitizadas |
| `apps/backend/src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts` | atualizado — remove premissas obsoletas de stub do `06-02` e cobre contrato real do entrypoint |
| `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts` | reescrito para cobrir roteamento webhook -> entrypoint com criacao/replay/nao-criacao |
| `apps/backend/src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts` | ajustado para manter prova negativa sem falso positivo textual |
| `.planning/phases/06-idempotent-webhook-driven-order-creation/06-03-SUMMARY.md` | este summary |

## Estrategia de transacao e idempotencia

- O entrypoint continua **interno** e so aceita `PaymentAttempt` com:
  - `status = payment_confirmed_by_webhook`
  - `order_id = null`
  - `provider = stripe`
  - `provider_payment_intent_id` presente
  - `amount > 0`
  - `currency_code = brl`
- `CheckoutCompletionLog.idempotency_key` continua derivada de `payment_intent_id`.
- O claim do log agora segue quatro caminhos:
  - `completed + order_id` -> reusa a Order existente e cura `PaymentAttempt.order_id` se necessario
  - `processing + Order recuperavel por cart` -> completa a correlacao sem chamar `completeCartWorkflow` de novo
  - `processing` sem Order recuperavel -> retorna `already_processing`, sem segundo vencedor
  - `failed + order_id` -> recupera a Order ja criada e completa a correlacao
  - `failed + order_id = null` -> reabre para retry controlado
  - inexistente -> cria novo registro `processing`
- A criacao real de `Order` usa o workflow oficial `completeCartWorkflow` do Medusa, mas so depois de:
  - revalidar cart server-side
  - montar snapshots Gelato de todos os itens
  - persistir os snapshots nos line items do cart
- Em falha antes de `completeCartWorkflow` devolver `order_id`, o fluxo marca o `CheckoutCompletionLog` como `failed` com erro sanitizado.
- Depois que `completeCartWorkflow` devolve `order_id`, o fluxo nao marca o log como `failed`; o retry recupera a Order existente por log ou por `cart_id`, completa `CheckoutCompletionLog`, cura `Order.metadata` e so entao grava `PaymentAttempt.order_id`.
- `Cart.completed_at` nao bloqueia essa recuperacao porque o retry nao revalida o cart quando ja ha Order duravel recuperavel.

## Estrategia de snapshot obrigatorio

- Novo helper: `build-order-line-item-gelato-snapshots.ts`
- Cada item exige:
  - `variant` carregada
  - `variant.id`
  - `variant.sku`
  - `variant.metadata` valida para `buildGelatoSnapshot`
  - preco BRL valido
- Todos os itens da mesma Order usam o mesmo `captured_at` ISO.
- O helper preserva metadata segura existente do line item e acrescenta apenas:
  - `metadata.gelato_snapshot`
- Nenhuma Order passa para o `completeCartWorkflow` sem que todos os line items do cart ja tenham recebido o snapshot canonico `GelatoSnapshot v1`.

## Mapeamento de estados

- Como o core do Medusa cria a Order com semantica nativa propria, o slice persistiu o estado complementar em `Order.metadata`:
  - `metadata.order_status = confirmed`
  - `metadata.payment_status = captured`
- O resultado retornado pelo entrypoint tambem expõe:
  - `order_status = confirmed`
  - `payment_status = captured`
- Isso mantem o dominio desacoplado sem iniciar refund flow nem introduzir Phase 07.

## Testes executados

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-gelato-snapshot.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
# PASS — 13/13

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "idempotent|concurrent|correlation|statuses|gelato_snapshot|replay|Order|partial|retry"
# PASS — 3/3

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-store.spec.ts
# PASS — 10/10

bash -lc 'cd apps/backend && git grep -n -E "purchase_completed|AnalyticsEventLog|posthog|EmailDeliveryLog|resend|order\\.gelatoapis\\.com|gelato_order_id|refund" -- src/workflows/order src/modules/checkout-completion src/api/hooks/stripe; status=$?; test $status -eq 1'
# PASS — prova negativa verde
```

## Resultado dos testes

| Suite / prova | Resultado |
|---------------|-----------|
| `webhook-order-creation.unit.spec.ts` | PASS |
| `webhook-order-gelato-snapshot.unit.spec.ts` | PASS |
| `webhook-order-entrypoint.unit.spec.ts` | PASS |
| `stripe-webhook-order-creation.spec.ts` | PASS |
| `stripe-webhook-store.spec.ts` | PASS |
| grep exato solicitado | PASS |

## Evidencias confirmadas

| Invariante / efeito | Status |
|---------------------|--------|
| Replay do mesmo pagamento reusa a mesma Order | OK |
| `processing` concorrente nao permite segundo vencedor | OK |
| Falha apos `completeCartWorkflow` nao marca log como failed e retry nao cria segunda Order | OK |
| Retry recupera Order por `cart_id` sem bloquear em `Cart.completed_at` | OK |
| `CheckoutCompletionLog.completed` com `order_id` evita recriacao | OK |
| `PaymentAttempt.order_id` e correlacionado | OK |
| `CheckoutCompletionLog.completed` e persistido | OK |
| `order_status = confirmed` exposto pelo entrypoint e persistido em `Order.metadata` | OK |
| `payment_status = captured` exposto pelo entrypoint e persistido em `Order.metadata` | OK |
| Nenhuma Order pode nascer sem `LineItem.metadata.gelato_snapshot` | OK |

## Post-review adjustment

- Causa do blocker: o primeiro ajuste de `06-03` marcava `CheckoutCompletionLog` como `failed` no `catch` geral mesmo depois de `completeCartWorkflow` ja ter devolvido `order_id`. Isso deixava uma janela de sucesso parcial: o cart podia estar completado e a Order existir, mas o retry tentava passar de novo pelo caminho de cart aberto.
- Correcao aplicada: depois que `completeCartWorkflow` retorna `order_id`, o entrypoint nao marca mais o log como `failed`. O retry primeiro tenta recuperar Order existente por `CheckoutCompletionLog.order_id` ou por `cart_id`; se encontrar, completa `CheckoutCompletionLog.status = completed`, persiste `Order.metadata.order_status/payment_status` e grava `PaymentAttempt.order_id`, sem chamar `completeCartWorkflow` novamente.
- Retry apos falha parcial: se a falha ocorrer antes de Order existir, o log pode virar `failed` e reabrir para retry. Se a falha ocorrer apos Order criada, o log permanece recuperavel (`processing` ou com `order_id`) e o retry cura a correlacao; `Cart.completed_at` nao bloqueia porque o cart nao e revalidado nesse caminho.
- Testes novos/atualizados: `webhook-order-creation.unit.spec.ts` inclui prova de falha apos Order parcial com `runCompleteCart` chamado uma unica vez; `webhook-order-entrypoint.unit.spec.ts` foi atualizado para abandonar o stub do `06-02`; os testes HTTP do `06-03` e a regressao Phase 05 ficaram verdes.
- Prova negativa: o comando exato com `git grep` agora passa sem matches em `src/workflows/order`, `src/modules/checkout-completion` e `src/api/hooks/stripe`.
- Escopo: `06-04` nao foi iniciado; nao houve `purchase_completed`, `AnalyticsEventLog`, `EmailDeliveryLog`, chamada Gelato API, fulfillment, `gelato_order_id`, refund, Stripe CLI smoke ou migration manual.

## Desvio relevante do plano

- O path planejado `apps/backend/src/workflows/order/steps/create-order-from-confirmed-attempt.ts` nao existia no checkout. Em vez de bloquear a execucao, ele foi criado como helper puro e passou a concentrar a validacao/cart-state complementar do slice.

## Confirmacoes de escopo

| Restricao | Status |
|-----------|--------|
| Sem `purchase_completed` | OK |
| Sem `AnalyticsEventLog` | OK no runtime alterado |
| Sem email / `EmailDeliveryLog` | OK no runtime alterado |
| Sem chamada Gelato API | OK |
| Sem fulfillment | OK |
| Sem `gelato_order_id` | OK no runtime alterado |
| Sem refund | OK no runtime alterado |
| Sem Stripe CLI smoke | OK |
| Sem migration manual / `medusa db:migrate` real | OK |
| Sem endpoint Store para completar checkout | OK |
| `06-04` nao iniciado | OK |

## Manual gate

PARAR AQUI. O slice `06-03` termina neste summary. `06-04` nao foi iniciado.
