---
phase: 04-stripe-payments-payment-attempt
plan: 05
subsystem: payments
tags: [stripe, pix, safe-boundary, payment-attempt, pay-02, pay-03, pay-04, store-api, brl]

requires:
  - phase: 04-stripe-payments-payment-attempt
    provides: 04-01 gate (Pix native-first bloqueado), 04-02 PaymentAttempt, 04-03 eligibility, 04-04 safe boundary
provides:
  - splitStripePixPaymentIntent / extractImmediatePixInstructions em stripe-safe.ts
  - startPixPaymentAttempt / markPixExpired / markPixFailed / markPixCanceled
  - POST /store/carts/:id/payment-attempts/pix
  - Unit + integration HTTP tests Pix sem Order
affects: [04-06]

tech-stack:
  added: []
  patterns:
    - "splitStripePixPaymentIntent separa persistivel vs DTO imediato (QR/copia-e-cola response-only)"
    - "StripePixInitiationLayer injetada — runtime fail-closed sem layer Stripe Pix configurada"
    - "expires_at efetivo do provider persistido; QR/copia-e-cola/next_action nunca gravados"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/pix.ts
    - apps/backend/src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts
    - apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts
  modified:
    - apps/backend/src/modules/payment-attempt/stripe-safe.ts
    - apps/backend/src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts
    - apps/backend/integration-tests/http/payment-attempt-store.spec.ts
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Estrategia reutilizada de 04-04: filtering_wrapper + stripe_safe_layer (nao native-first Medusa Stripe Pix)"
  - "QR/copia-e-cola/hosted_instructions_url existem apenas em SafeStripeImmediatePixAction / PixPaymentAttemptResponse"
  - "PaymentSession.data, se usado, permanece allowlist-only via toSafeStripePaymentSessionData"
  - "Runtime Pix resolve STRIPE_PIX_INITIATION_LAYER; ausencia falha fechada"
  - "Status pos-iniciacao: awaiting_pix_payment; helpers locais pix_expired/payment_failed/payment_canceled sem Order"
  - "Persistencia fail-closed: nenhum 201 sem trilha auditavel PaymentAttempt"
  - "client_secret opcional na resposta imediata Pix quando presente no PI bruto; nunca persistido"

patterns-established:
  - "StripePixInitiationLayer injetavel — mesma boundary obrigatoria de 04-04 antes de persistencia"
  - "Erros de iniciacao Pix sanitizados (pi_*_secret_* e payload EMV 00020126 redacted)"

requirements_addressed: [PAY-02, PAY-03, PAY-04]
requirements-completed: []

duration: 50min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 05 — Pix Initiation Safe Stripe Boundary Summary

**Iniciacao de Pix pre-Order em BRL via boundary Stripe allowlist-only reutilizada de 04-04: QR/copia-e-cola somente na resposta imediata, `expires_at` persistido, estados locais assincronos sem Order e sem provider native-first.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 5/5
- **Files created:** 3
- **Files modified:** 4

## Accomplishments

- **`stripe-safe.ts`**: `splitStripePixPaymentIntent` e `extractImmediatePixInstructions` separam `SafeStripePaymentData` (persistivel com `expires_at`) de `SafeStripeImmediatePixAction` (response-only); asserts bloqueiam `next_action`, QR/copia-e-cola integral, PI bruto e metadata sensivel.
- **`pix.ts`**: `startPixPaymentAttempt` reutiliza eligibility 04-03, supersede tentativa ativa, usa `StripePixInitiationLayer` + boundary, valida amount/currency; `markPixExpired`/`markPixFailed`/`markPixCanceled` mantêm `order_id=null`.
- **Store API**: `POST /store/carts/:id/payment-attempts/pix` valida posse do cart, rejeita body monetario, resolve layer Stripe Pix injetada, fail-closed sem layer/persistencia e retorna DTO com instrucoes Pix — sem Order, sem `payment_session.data` bruto.
- **33 unit tests + 8 integration HTTP tests Pix** verdes; build Medusa OK.

## Task Commits

Nenhum commit foi criado nesta execucao.

## Gate 04-01 confirmado (Task 04-05-01)

```
PIX_NATIVE_SAFE=false
CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true
PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true
BOUNDARY_STRATEGY=filtering_wrapper
STRIPE_LAYER=stripe_safe_layer
```

Native-first Pix puro permanece **bloqueado**. Runtime Pix usa camada propria/wrapper aprovada em 04-04 — nunca `@medusajs/payment-stripe` native-first.

## Estrategia de boundary Pix

| Camada | Papel |
|--------|-------|
| `splitStripePixPaymentIntent` | Filtra PI Stripe-like Pix antes de persistencia/log |
| `extractImmediatePixInstructions` | Extrai QR/copia-e-cola/hosted URL response-only |
| `toSafeStripePaymentSessionData` | Allowlist-only se PaymentSession.data for usado |
| `STRIPE_PIX_INITIATION_LAYER` | Ponto de injecao da camada Stripe Pix real/segura; ausencia falha fechada |
| Synthetic test layer | Restrita a unit/integration tests; nao usada pela rota runtime |
| Medusa `@medusajs/payment-stripe` native-first Pix | **Nao usado** |

## Migration Gate (herdado de 04-02 — inalterado)

```
MIGRATION_STATUS=DRAFT_NOT_APPLIED
MIGRATION_FILE=apps/backend/src/migrations/TBD-payment-attempt.ts
REQUIRES_HUMAN_APPROVAL_BEFORE_db:migrate=true
PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable
```

A rota persiste via `paymentAttempt` module e falha fechada se a tentativa auditavel nao puder ser registrada. Testes HTTP usam mock do module; runtime real nao deve retornar `201` sem persistencia.

## Setup futuro (requer decisao humana)

| Item | Status |
|------|--------|
| Stripe API key / Pix dashboard | **Nao configurado** — registrar layer real em `STRIPE_PIX_INITIATION_LAYER` |
| Provider registration em medusa-config | **Nao feito** — custom provider ou camada propria Stripe Pix pendente |
| `medusa db:migrate` | **Nao executado** |
| Webhook Stripe / Order / Gelato | **Reservados** para Phase 05/06 |

## Verificacoes

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts \
  src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts
# 33 passed

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/payment-attempt-store.spec.ts -t "pix"
# 8 passed

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully

# Grep negativo producao (exit 0 = clean)
! rg -n "client_secret.*metadata|copy_paste.*metadata|pix_display_qr_code.*metadata|next_action.*metadata|completeCartWorkflow|/store/carts/.*/complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|gelato|order\.gelatoapis\.com" \
  apps/backend/src/modules/payment-attempt/stripe-safe.ts \
  apps/backend/src/modules/payment-attempt/pix.ts \
  apps/backend/src/api/store/carts/\[id\]/payment-attempts/pix/route.ts
```

## Escopo respeitado

| Restricao | Status |
|-----------|--------|
| Sem Pix native-first puro | OK |
| Sem persistir QR/copia-e-cola/`next_action`/`client_secret`/PI bruto | OK |
| Sem `medusa db:migrate` / `db:generate` | OK |
| Sem Stripe config / secrets / webhook | OK |
| Sem Order / WebhookEventLog / CheckoutCompletionLog | OK |
| Sem `purchase_completed` / Gelato | OK |
| Sem executar 04-06 | OK |
| Fail-closed sem PaymentAttempt auditavel | OK |
| Fail-closed sem layer Pix configurada | OK |

## Self-Check: PASSED

- key-files.created exist on disk
- Unit + integration acceptance criteria: PASS
- Build: PASS
- Grep negativo producao: PASS
- Gate 04-01/04-04 boundary confirmado antes da implementacao
- Migration nullable decision documentada; migration nao executada (conforme instrucao)

## Deviations from Plan

| Plano | Implementado | Motivo |
|-------|--------------|--------|
| `apps/backend/src/api/store/carts/payment-attempts/pix/route.ts` | `apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts` | Medusa file-based routing exige `[id]` para `/store/carts/:id/...` |
| `client_secret` ausente do DTO Pix | `client_secret` opcional na resposta quando PI bruto inclui | Boundary 04-04 permite response-only; nunca persistido |

## Manual Review Gate

**PARAR AQUI.** Proximo passo operacional:

1. Revisao humana deste summary + gate migration 04-02.
2. Substituir synthetic layer por camada Stripe Pix real ou custom provider com boundary allowlist-only.
3. Aplicar migration `TBD-payment-attempt.ts` apos aprovacao.
4. 04-06 permanece fora deste escopo (webhook/Order).

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 05*
*Completed: 2026-06-29*
