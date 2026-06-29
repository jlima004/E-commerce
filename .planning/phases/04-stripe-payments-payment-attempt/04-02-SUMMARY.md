---
phase: 04-stripe-payments-payment-attempt
plan: 02
subsystem: payments
tags: [payment-attempt, medusa-module, state-machine, migration-draft, pay-04]

requires:
  - phase: 04-stripe-payments-payment-attempt
    provides: Stripe provider gate flags from 04-01
provides:
  - PaymentAttempt Medusa custom module (model, service, state machine)
  - Module links to Cart, PaymentCollection, PaymentSession
  - Reviewable TBD migration draft (not applied)
  - Unit tests for status vocabulary and single-active-per-cart invariants
affects: [04-03, 04-04, 04-05, 04-06]

tech-stack:
  added: []
  patterns:
    - "Custom Medusa module paymentAttempt with pre-webhook status enum"
    - "Partial unique indexes planned in TBD migration for PI id + one active/cart"
    - "Pure service helpers testable without DB for active-attempt orchestration"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/models/payment-attempt.ts
    - apps/backend/src/modules/payment-attempt/state-machine.ts
    - apps/backend/src/modules/payment-attempt/service.ts
    - apps/backend/src/modules/payment-attempt/types.ts
    - apps/backend/src/modules/payment-attempt/index.ts
    - apps/backend/src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts
    - apps/backend/src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts
    - apps/backend/src/migrations/TBD-payment-attempt.ts
    - apps/backend/src/links/payment-attempt-cart.ts
    - apps/backend/src/links/payment-attempt-payment-collection.ts
    - apps/backend/src/links/payment-attempt-payment-session.ts
  modified:
    - apps/backend/medusa-config.ts

key-decisions:
  - "Status enum usa vocabulario operacional pre-webhook; proibe paid/succeeded/captured/confirmed_payment"
  - "order_id permanece sempre null nesta fase — enforced em helpers e testes"
  - "Migration TBD-payment-attempt.ts e draft humano — nenhum db:migrate executado"
  - "Uma tentativa ativa por cart via helper + partial unique index planejado na migration"
  - "currency_code persistido em minúsculas (brl); migration usa check (currency_code = 'brl') alinhado ao service"
  - "payment_session_id nullable na migration — status created pode existir antes da sessão provider; preenchido na transição para provider_session_created"
  - "PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable — model/types/helpers alinhados à migration nullable"

patterns-established:
  - "assertNoSensitivePaymentAttemptMetadata bloqueia client_secret, QR/copia-e-cola integral, CPF/CNPJ e endereco em metadata"
  - "createPaymentAttemptReplacingActive supersede tentativa ativa sem reutilizar registro antigo"

requirements_addressed: [PAY-04]
requirements-completed: []

duration: 45min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 02 — PaymentAttempt Module Summary

**Módulo customizado `PaymentAttempt` implementado com state machine pré-webhook, guard de uma tentativa ativa por cart e migration draft bloqueada para revisão humana.**

## Performance

- **Duration:** 45 min
- **Tasks:** 3/3
- **Files modified:** 12

## Accomplishments

- Modelo `PaymentAttempt` com campos canônicos (`provider_payment_intent_id`, `order_id` nullable, timestamps operacionais).
- State machine com 13 status locais, transições validadas e proibição de labels financeiros finais.
- Service helpers para supersede, invalidação por mudança de cart e criação de nova tentativa sem reuso.
- Module links Cart ↔ PaymentAttempt, PaymentCollection ↔ PaymentAttempt, PaymentAttempt ↔ PaymentSession.
- 25 testes unitários verdes; build Medusa OK.

## Task Commits

1. **Task 04-02-01: Modelo + migration revisável** — `d87fda7` (feat)
2. **Task 04-02-02: State machine** — `ddabc7a` (feat)
3. **Task 04-02-03: Uma tentativa ativa por cart** — `e4430a9` (feat)

## Migration Gate (MANUAL REVIEW)

```
MIGRATION_STATUS=DRAFT_NOT_APPLIED
MIGRATION_FILE=apps/backend/src/migrations/TBD-payment-attempt.ts
REQUIRES_HUMAN_APPROVAL_BEFORE_db:migrate=true
```

A migration inclui:
- Unique parcial em `provider_payment_intent_id` quando não nulo
- Unique parcial em `cart_id` para status ativos (uma tentativa ativa por cart)
- `amount bigint not null check (amount > 0)` — menor unidade monetária (centavos BRL)
- `check (currency_code = 'brl')` — MVP single-currency; alinhado ao `toLowerCase()` do service
- `check (status in (...))` — 13 status canônicos da Phase 04
- `payment_session_id` nullable — tentativa em `created` pode preceder sessão provider; rotas 04-03+ devem preencher antes de `provider_session_created`

**PAY-04:** endereçado por esta plan (base do módulo), mas não concluído — rotas card/Pix e provas finais da Phase 04 ainda pendentes.

**Não executar** `medusa db:migrate` ou `medusa db:generate` em produção até revisão explícita.

## Post-Review Decision

```
PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable
```

Decisão humana aplicada antes de 04-04: `payment_session_id` é nullable/opcional no model, types e helpers para permitir uma tentativa local auditável em status `created` antes da criação ou associação da sessão provider.

## Verificações

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts
# 25 passed

npm run build
# Backend build completed successfully
```

Proibições respeitadas: sem Order, webhook, WebhookEventLog, CheckoutCompletionLog, purchase_completed, Gelato, ou secrets persistidos.

## Self-Check: PASSED

- key-files.created exist on disk
- Commits `04-02` present in git log
- Acceptance criteria re-run: PASS
- Plan verification greps: PASS

## Deviations from Plan

None — plan executed as written. Migration permanece draft conforme manual_review_gate.

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 02*
*Completed: 2026-06-29*
