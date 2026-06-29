---
phase: 04-stripe-payments-payment-attempt
plan: 04
subsystem: payments
tags: [stripe, card, client_secret, safe-boundary, payment-attempt, pay-01, pay-04, store-api]

requires:
  - phase: 04-stripe-payments-payment-attempt
    provides: 04-01 gate (native-first bloqueado), 04-02 PaymentAttempt, 04-03 eligibility
provides:
  - stripe-safe.ts boundary allowlist-only (filtering_wrapper + stripe_safe_layer)
  - startCardPaymentAttempt / markCardClientConfirmed
  - POST /store/carts/:id/payment-attempts/card
  - Unit + integration HTTP tests card sem Order
affects: [04-05, 04-06]

tech-stack:
  added: []
  patterns:
    - "splitStripeCardPaymentIntent separa persistivel vs DTO imediato (client_secret response-only)"
    - "StripeCardInitiationLayer injetada — runtime fail-closed sem layer Stripe card configurada"
    - "PaymentSession.data allowlist-only via toSafeStripePaymentSessionData quando usado"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/stripe-safe.ts
    - apps/backend/src/modules/payment-attempt/card.ts
    - apps/backend/src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts
    - apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
    - apps/backend/src/modules/payment-attempt/__tests__/fixtures/payment-start-cart.ts
    - apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts
    - apps/backend/integration-tests/http/payment-attempt-store.spec.ts
  modified:
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Estrategia escolhida: filtering_wrapper + stripe_safe_layer (nao native-first Medusa Stripe)"
  - "client_secret existe apenas em SafeStripeImmediateCardAction / CardPaymentAttemptResponse"
  - "PaymentSession.data, se usado, limitado a 7 chaves allowlist — nunca PaymentIntent bruto"
  - "Runtime card resolve STRIPE_CARD_INITIATION_LAYER; sem layer configurada falha fechada"
  - "payment_client_confirmed implementado como helper local (markCardClientConfirmed); sem rota HTTP extra nesta fase"
  - "Persistencia DB via PaymentAttempt module e fail-closed; payment start nao retorna 201 sem trilha auditavel"
  - "Retorno Stripe-like validado contra eligibility: amount e currency_code devem bater com o cart"

patterns-established:
  - "StripeCardInitiationLayer injetavel — boundary obrigatoria antes de qualquer persistencia"
  - "Erros de iniciacao card sanitizados (pi_*_secret_* redacted antes de sanitizeString)"

requirements_addressed: [PAY-01, PAY-04]
requirements-completed: []

duration: 55min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 04 — Card Initiation Safe Stripe Boundary Summary

**Iniciacao de cartao pre-Order via boundary Stripe allowlist-only: `client_secret` somente na resposta imediata, `PaymentAttempt` persiste IDs seguros, rota Store API sem Order e sem provider native-first.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 4/4
- **Files created:** 7
- **Files modified:** 1

## Accomplishments

- **`stripe-safe.ts`**: `splitStripeCardPaymentIntent` produz `SafeStripePaymentData` (persistivel), `SafeStripeImmediateCardAction` (response-only) e `paymentSessionData` allowlist-only; asserts bloqueiam `client_secret`, `next_action`, PI bruto e metadata sensivel.
- **`card.ts`**: `startCardPaymentAttempt` reutiliza eligibility 04-03, supersede tentativa ativa, usa `StripeCardInitiationLayer` + boundary, valida amount/currency do retorno Stripe-like contra o cart; `markCardClientConfirmed` registra estado local nao-financeiro.
- **Store API**: `POST /store/carts/:id/payment-attempts/card` valida posse do cart, rejeita body monetario, resolve layer Stripe card injetada, falha fechada sem layer/persistencia e retorna DTO minimo com `client_secret` — sem Order, sem `payment_session.data` bruto.
- **23 unit tests + 11 integration HTTP tests** verdes; build Medusa OK.

## Task Commits

Nenhum commit foi criado nesta execucao.

## Estrategia de boundary (04-01 gate)

```
BOUNDARY_STRATEGY=filtering_wrapper
STRIPE_LAYER=stripe_safe_layer
NATIVE_CARD_SAFE=false
CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true
PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=mitigated_by_boundary
```

| Camada | Papel |
|--------|-------|
| `splitStripeCardPaymentIntent` | Filtra PI Stripe-like antes de persistencia/log |
| `toSafeStripePaymentSessionData` | Allowlist-only se PaymentSession.data for usado |
| `STRIPE_CARD_INITIATION_LAYER` | Ponto de injecao da camada Stripe card real/segura; ausencia falha fechada |
| Synthetic test layer | Restrita a unit/integration tests; nao usada pela rota runtime |
| Medusa `@medusajs/payment-stripe` native-first | **Nao usado** |

## Migration Gate (herdado de 04-02 — inalterado)

```
MIGRATION_STATUS=DRAFT_NOT_APPLIED
MIGRATION_FILE=apps/backend/src/migrations/TBD-payment-attempt.ts
REQUIRES_HUMAN_APPROVAL_BEFORE_db:migrate=true
PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable
```

A rota persiste via `paymentAttempt` module e falha fechada se a tentativa auditavel nao puder ser registrada. Enquanto a migration nao for aplicada, testes HTTP usam mock do module; runtime real nao deve retornar `201` sem persistencia.

## Correcao pos-review

- Synthetic layer removida da rota runtime; helper sintetico permanece apenas nos testes.
- Persistencia agora e fail-closed: erro ao resolver/criar/atualizar `PaymentAttempt` retorna erro saneado, nao `201`.
- `amount` e `currency_code` do retorno Stripe-like sao validados contra eligibility antes de criar o `PaymentAttempt`.
- Leitura de tentativas existentes agora e fail-closed: erro ao resolver `PaymentAttempt`, ausencia de `listPaymentAttempts` ou falha na listagem abortam com mensagem saneada.
- Stripe layer nao e chamada se o historico `PaymentAttempt` do cart nao puder ser consultado.

## Setup futuro (requer decisao humana)

| Item | Status |
|------|--------|
| Stripe API key / webhook secret | **Nao configurado** — registrar layer real segura em `STRIPE_CARD_INITIATION_LAYER` |
| Provider registration em medusa-config | **Nao feito** — custom provider ou camada propria Stripe pendente |
| `medusa db:migrate` | **Nao executado** |
| Rota callback `payment_client_confirmed` | **Reservada** — helper existe; rota HTTP nao exposta nesta fase |

## Verificacoes

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts \
  src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
# 23 passed

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/payment-attempt-store.spec.ts -t "card"
# 11 passed

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully

# Grep negativo producao (exit 1 = clean)
rg -n "completeCartWorkflow|/store/carts/:id/complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|gelato|order\.gelatoapis\.com" \
  apps/backend/src/modules/payment-attempt/stripe-safe.ts \
  apps/backend/src/modules/payment-attempt/card.ts \
  apps/backend/src/api/store/carts/\[id\]/payment-attempts/card/route.ts
```

## Escopo respeitado

| Restricao | Status |
|-----------|--------|
| Sem native-first Stripe Medusa puro | OK |
| Sem persistir `client_secret` / PI bruto / `next_action` | OK |
| Sem PAN/CVC/dados brutos de cartao | OK |
| Sem `medusa db:migrate` / `db:generate` | OK |
| Sem Stripe config / secrets / webhook | OK |
| Sem Order / WebhookEventLog / CheckoutCompletionLog | OK |
| Sem `purchase_completed` / Gelato | OK |
| Sem executar 04-05 (Pix) | OK |

## Self-Check: PASSED

- key-files.created exist on disk
- Unit + integration acceptance criteria: PASS
- Build: PASS
- Grep negativo producao: PASS
- Migration nullable decision documentada; migration nao executada (conforme instrucao)

## Deviations from Plan

| Plano | Implementado | Motivo |
|-------|--------------|--------|
| `apps/backend/src/api/store/carts/payment-attempts/card/route.ts` | `apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts` | Medusa file-based routing exige `[id]` para `/store/carts/:id/...` |

## Manual Review Gate

**Stripe real pendente.** Proximo passo operacional:

1. Revisao humana deste summary + gate migration 04-02.
2. Substituir `createSyntheticStripeCardLayer` por camada Stripe real ou custom provider com boundary allowlist-only.
3. Aplicar migration `TBD-payment-attempt.ts` apos aprovacao.
4. 04-05 (Pix) permanece fora deste escopo.

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 04*
*Completed: 2026-06-29*
