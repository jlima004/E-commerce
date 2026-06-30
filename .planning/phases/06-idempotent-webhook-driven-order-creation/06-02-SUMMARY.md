---
phase: 06-idempotent-webhook-driven-order-creation
plan: 02
subsystem: order-entrypoint
tags: [payment-attempt, webhook, eligibility-guard, stub-entrypoint, stripe]

requires:
  - phase: 06-idempotent-webhook-driven-order-creation
    plan: 01
    provides: CheckoutCompletionLog schema/contract helpers (not wired yet)
provides:
  - assertPaymentAttemptEligibleForOrderCreation guard
  - Internal createOrderFromConfirmedPaymentAttemptWorkflow skeleton (stub/no-op)
  - Stripe webhook integration point after payment_confirmed_by_webhook
  - Negative proofs for invalid statuses and absent Store completion route
affects: [06-03-blocked, manual-review-gate]

requirements_addressed: [ORD-01]
requirements-completed: [ORD-01]

completed: 2026-06-30
status: complete
---

# Phase 06 Plan 02 — PaymentAttempt Eligibility & Internal Entrypoint Summary

**O slice `06-02` endureceu a elegibilidade de `PaymentAttempt` para criação futura de Order, criou o entrypoint interno pós-webhook (stub/no-op) e conectou `/hooks/stripe` somente após `payment_confirmed_by_webhook` — sem criar Order real.**

## Arquivos criados/alterados

| Arquivo | Ação |
|---------|------|
| `apps/backend/src/modules/payment-attempt/state-machine.ts` | Adicionado `assertPaymentAttemptEligibleForOrderCreation` |
| `apps/backend/src/modules/payment-attempt/service.ts` | Removido `assertAttemptEligibleForFutureOrder`; re-export do guard |
| `apps/backend/src/modules/payment-attempt/__tests__/payment-attempt-order-eligibility.unit.spec.ts` | Criado — testes de elegibilidade |
| `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` | Criado — workflow/serviço interno stub |
| `apps/backend/src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts` | Criado — testes do entrypoint |
| `apps/backend/src/api/hooks/stripe/route.ts` | Integração pós-confirmação webhook → entrypoint |
| `apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts` | Criado — testes HTTP de roteamento/guards |
| `.planning/phases/06-idempotent-webhook-driven-order-creation/06-02-SUMMARY.md` | Este summary |

## O que foi entregue

### Guard `assertPaymentAttemptEligibleForOrderCreation`

Aceita **somente**:

- `status === "payment_confirmed_by_webhook"`
- `order_id === null`
- `provider === "stripe"`
- `provider_payment_intent_id` não vazio
- `amount > 0`
- `currency_code === "brl"` (case-insensitive)

Rejeita todos os demais status, incluindo: `created`, `provider_session_created`, `client_action_required`, `card_client_secret_created`, `payment_client_confirmed`, `payment_instructions_displayed`, `awaiting_pix_payment`, `awaiting_webhook_confirmation`, `pix_expired`, `payment_failed`, `payment_canceled`, `superseded`, `invalidated_by_cart_change`, além de `order_id` existente, provider não-Stripe, PI ausente, amount inválido e moeda não-BRL.

### Entrypoint interno `createOrderFromConfirmedPaymentAttemptWorkflow`

Contrato de input mínimo:

- `payment_attempt_id` (obrigatório)
- `payment_intent_id` (obrigatório)
- `stripe_event_id` (opcional)
- `correlation_id` (opcional)

Comportamento neste slice:

- Valida input
- Carrega/valida `PaymentAttempt`
- Aplica guard exato
- Retorna `{ status: "stub_no_op", order_id: null, ... }`
- **Não** chama `completeCartWorkflow`, `createOrderWorkflow` nem persiste `CheckoutCompletionLog`
- **Não** expõe rota Store
- **Não** aceita `idempotency_key` no contrato de input

### Integração webhook

`/hooks/stripe` chama o entrypoint quando:

1. Evento é `payment_intent.succeeded`
2. `updatedAttempt.status === payment_confirmed_by_webhook`
3. `updatedAttempt.order_id == null`

Isso inclui retry com `WebhookEventLog` ainda em `received` e `PaymentAttempt` já confirmado (crash parcial antes do entrypoint ou antes de fechar `processed`).

**Não** chama entrypoint para:

- Eventos unsupported (`charge.refunded`, etc.)
- `payment_intent.payment_failed` / `payment_intent.canceled`
- Tentativas stale/terminal
- Replay com `WebhookEventLog` já `processed` (early return)
- `PaymentAttempt` confirmado com `order_id` já vinculado

## Testes executados

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-attempt-order-eligibility.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
# PASS — 29/29 (re-run pós-review: 2026-06-30)

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "entrypoint|eligibility|invalid status|received|processed"
# PASS — 8/8 (re-run pós-review: 2026-06-30)

bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\\[id\\]/complete" -- src/api/store; status=$?; test $status -eq 1'
# PASS — sem matches (exit 1 do grep = prova negativa OK)
```

## Resultado dos testes

| Suite | Resultado |
|-------|-----------|
| `payment-attempt-order-eligibility.unit.spec.ts` | 20 passed (re-run pós-review) |
| `webhook-order-entrypoint.unit.spec.ts` | 9 passed (re-run pós-review) |
| `stripe-webhook-order-creation.spec.ts` (filtro entrypoint/eligibility/invalid status/received/processed) | 8 passed (re-run pós-review) |

## Resultado do git grep

Prova negativa de ausência de rota Store/checkout para completar cart:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\\[id\\]/complete" -- src/api/store; status=$?; test $status -eq 1'
```

**Resultado:** PASS — nenhum match em `src/api/store`.

## Confirmações de escopo

| Restrição | Status |
|-----------|--------|
| Apenas guard/entrypoint/stub criados | OK |
| Nenhuma Order criada | OK |
| `PaymentAttempt.order_id` não persistido | OK |
| Sem `purchase_completed` | OK |
| Sem Gelato / fulfillment | OK |
| Sem e-mail / `EmailDeliveryLog` | OK |
| Sem analytics / `AnalyticsEventLog` | OK |
| Sem refund | OK |
| Sem migrations aplicadas | OK |
| Sem Stripe CLI smoke | OK |
| `06-03` não iniciado | OK |

## Decisions Made

- Guard colocado em `state-machine.ts` junto aos demais asserts de `PaymentAttempt`; `service.ts` re-exporta para consumo externo.
- Entrypoint invocado quando `payment_intent.succeeded` resulta em `updatedAttempt.status === payment_confirmed_by_webhook` **e** `updatedAttempt.order_id == null` — independente de transição fresh, fechando janela de crash entre confirmação do `PaymentAttempt` e chamada do entrypoint.
- Replay com `WebhookEventLog.status === processed` continua saindo antes sem chamar entrypoint.
- Replay idempotente de webhook preserva `order_id` existente em `applyStripePaymentIntentWebhookToAttempt` (antes forçava `null`), para que tentativas já correlacionadas a Order não reinvocarem entrypoint no `06-03`.
- `runOrderEntrypoint` injetável via `RouteDeps` para testes HTTP isolados sem side effects.
- `assertAttemptEligibleForFutureOrder` removido de `service.ts`; lógica de invalidação por cart permanece local em `cart-invalidation.ts` (pré-Order).

## Post-review adjustment

Ajuste aplicado após review manual do critério de invocação do entrypoint.

### Problema identificado

Janela de crash parcial entre confirmação do `PaymentAttempt` e fechamento do `WebhookEventLog`:

1. `payment_intent.succeeded` confirma `PaymentAttempt`
2. Processo cai antes de chamar entrypoint ou antes de marcar log `processed`
3. Stripe redeliver encontra `PaymentAttempt` já `payment_confirmed_by_webhook`
4. Condição original (`previousStatus !== payment_confirmed_by_webhook`) **não** reinvocava entrypoint → risco de Order omitida no `06-03`

### Correção

**`route.ts`** — critério de invocação:

```ts
const shouldInvokeOrderEntrypoint =
  input.event.type === "payment_intent.succeeded" &&
  updatedAttempt.status === "payment_confirmed_by_webhook" &&
  updatedAttempt.order_id == null
```

**`service.ts`** — replay idempotente preserva `order_id` existente (antes forçava `null`), para que `updatedAttempt.order_id == null` distinga tentativa já correlacionada a Order.

Replay com `WebhookEventLog.status === processed` continua saindo antes (early return) — sem reprocessamento.

### Casos cobertos por teste HTTP

| Caso | Esperado | Status |
|------|----------|--------|
| `WebhookEventLog` duplicado `received` + attempt confirmado + `order_id = null` | chama entrypoint | PASS |
| `WebhookEventLog` final `processed` | não chama entrypoint | PASS |
| attempt confirmado com `order_id` existente | não chama entrypoint | PASS |
| `payment_intent.payment_failed` / `payment_intent.canceled` | não chama entrypoint | PASS |

### Re-verificação (2026-06-30)

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-attempt-order-eligibility.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
# PASS — 29/29

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/stripe-webhook-order-creation.spec.ts -t "entrypoint|eligibility|invalid status|received|processed"
# PASS — 8/8
```

Arquivos alterados no ajuste: `route.ts`, `service.ts`, `stripe-webhook-order-creation.spec.ts`, `06-02-SUMMARY.md`.

## Deviations from Plan

Nenhuma além do **Post-review adjustment** documentado acima (correção necessária para fechar janela de crash parcial antes do `06-03`).

## Next Phase Readiness

- Entrypoint interno e guard exatos prontos para review manual.
- `06-03` permanece bloqueado até aprovação humana pós-review deste summary.
- Próximo slice habilitará criação transacional de Order + `CheckoutCompletionLog` + correlação `PaymentAttempt.order_id`.

---
*Phase: 06-idempotent-webhook-driven-order-creation*
*Plan: 02*
*Completed: 2026-06-30*
*Manual review gate: STOP — review entrypoint and guard before enabling Order persistence.*
