---
phase: 04-stripe-payments-payment-attempt
plan: 06
subsystem: payments
tags: [stripe, payment-attempt, cart-invalidation, supersede, pay-01, pay-02, pay-03, pay-04, pre-order, store-api]

requires:
  - phase: 04-stripe-payments-payment-attempt
    provides: 04-02 PaymentAttempt, 04-03 eligibility, 04-04 card safe boundary, 04-05 Pix safe boundary
provides:
  - invalidateActivePaymentAttemptForCartChange / reconcileStalePaymentAttemptsForCartFingerprint
  - resolvePaymentAttemptCartFingerprint / resolvePaymentAttemptCartFingerprintFromStoreCart
  - PaymentAttemptInvalidationReason + cart_fingerprint metadata on attempts
  - HTTP integration proofs for retry/supersede/invalidation + Phase 04 negative proofs
affects: [manual-review-gate, phase-05-blocked]

tech-stack:
  added: []
  patterns:
    - "cart_fingerprint em metadata allowlist-only — itens, quantidade, email e shipping normalizado"
    - "retry mesmo fingerprint -> supersede; fingerprint stale -> invalidated_by_cart_change antes de nova tentativa"
    - "invalidacao local nao depende de cancelamento remoto Stripe"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/cart-invalidation.ts
    - apps/backend/src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts
  modified:
    - apps/backend/src/modules/payment-attempt/card.ts
    - apps/backend/src/modules/payment-attempt/pix.ts
    - apps/backend/src/modules/payment-attempt/service.ts
    - apps/backend/src/api/store/carts/serializers.ts
    - apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts
    - apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts
    - apps/backend/integration-tests/http/payment-attempt-store.spec.ts

key-decisions:
  - "Fingerprint derivado de email normalizado, itens (variant_id+quantity) e shipping (postal_code/province/city) — sem address_1/CPF cru"
  - "resolvePaymentAttemptCartFingerprintFromStoreCart vive em serializers; cart-invalidation permanece isolado de StoreCart"
  - "Rotas card/pix persistem invalidatedAttempts antes de supersede/create"
  - "Tentativas sem fingerprint anterior nao sao invalidadas automaticamente (compat retry legado em testes)"

patterns-established:
  - "reconcileStalePaymentAttemptsForCartFingerprint roda antes de createPaymentAttemptReplacingActive"
  - "assertInvalidatedAttemptCannotAdvanceToOrder bloqueia tentativa invalidated_by_cart_change/superseded para Order futuro"

requirements: [PAY-01, PAY-02, PAY-03, PAY-04]
requirements-completed: [PAY-01, PAY-02, PAY-03, PAY-04]

duration: 55min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 06 — Cart Invalidation & Final Negative Proofs Summary

**Invalidacao/supersede de PaymentAttempt por mudanca de cart com fingerprint seguro, retry HTTP card/Pix provado e Phase 04 fechada pre-Order com grep e suite completos.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3
- **Files created:** 2
- **Files modified:** 7

## Accomplishments

- **`cart-invalidation.ts`**: `resolvePaymentAttemptCartFingerprint`, `invalidateActivePaymentAttemptForCartChange`, `reconcileStalePaymentAttemptsForCartFingerprint`, `PaymentAttemptInvalidationReason`, leitura/gravacao de `cart_fingerprint` em metadata.
- **`card.ts` / `pix.ts`**: antes de supersede, reconciliam fingerprint stale → `invalidated_by_cart_change`; nova tentativa grava fingerprint atual; resultado inclui `invalidatedAttempts`.
- **Rotas card/pix**: persistem tentativas invalidadas via `updatePaymentAttempts` antes de supersede/create.
- **`serializers.ts`**: `resolvePaymentAttemptCartFingerprintFromStoreCart` para acoplamento minimo com StoreCart.
- **14 unit tests + 10 novos integration HTTP tests** (retry/supersede/invalidation + provas negativas finais).
- **89 unit + 29 integration HTTP Phase 04** verdes; build OK.

## Task Commits

Nenhum commit foi criado nesta execucao.

## Decision Coverage (D-01..D-47 relevantes)

| Decision | Prova |
|----------|-------|
| D-01..D-04 | Eligibility herdada 04-03; respostas card/Pix sem Order |
| D-13..D-19 | Uma ativa/cart; retry supersede; cart change → `invalidated_by_cart_change`; amount recalculado server-side |
| D-39 | Pix pending/expired/failed/canceled — integration negative proofs |
| D-40..D-43 | Fingerprint sem address_1/CPF; persistencia sem client_secret/QR/next_action |
| D-44..D-47 | Grep + HTTP proofs: sem webhook, Order, CheckoutCompletionLog, purchase_completed, Gelato |

## Verificacoes

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts \
  src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts \
  src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts
# 89 passed

cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/payment-attempt-store.spec.ts
# 29 passed

cd apps/backend && ! rg -n \
  "completeCartWorkflow|/store/carts/.*/complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|order\.gelatoapis\.com|gelato_order_id" \
  src/modules/payment-attempt --glob '!**/__tests__/**' \
  src/api/store/carts/payment-attempts
# PASS (producao)

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully
```

### Provas negativas finais registradas

- [x] Sem `completeCartWorkflow` / `/store/carts/:id/complete` em codigo de producao payment-attempt
- [x] Sem criacao/retorno de `Order` nas rotas card/Pix
- [x] Sem webhook Stripe runtime, `WebhookEventLog`, `CheckoutCompletionLog`
- [x] Sem `purchase_completed` nem Gelato (`order.gelatoapis.com`, `gelato_order_id`)
- [x] `PaymentAttempt.order_id` permanece `null` nos caminhos Phase 04
- [x] Persistencia sem `client_secret`, QR/copia-e-cola integral, `next_action`
- [x] Fingerprint nao persiste `address_1` nem CPF/CNPJ cru
- [x] `amount`/`currency` do body rejeitados (tests existentes 04-03/04-04/04-05)

**Nota grep:** strings forbidden aparecem apenas em `__tests__/**` como patterns de prova negativa — grep de producao limpo.

## Escopo respeitado

| Restricao | Status |
|-----------|--------|
| Sem Stripe config / secrets / webhook | OK |
| Sem Order / WebhookEventLog / CheckoutCompletionLog | OK |
| Sem `purchase_completed` / Gelato | OK |
| Sem `medusa db:migrate` / `db:generate` | OK |
| Sem avancar Phase 05 | OK |

## Migration Gate (herdado 04-02 — inalterado)

```
MIGRATION_STATUS=DRAFT_NOT_APPLIED
REQUIRES_HUMAN_APPROVAL_BEFORE_db:migrate=true
PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable
```

## Deviations from Plan

| Plano | Implementado | Motivo |
|-------|--------------|--------|
| `resolvePaymentAttemptCartFingerprintFromStoreCart` em `cart-invalidation.ts` | Funcao em `serializers.ts` importando helper de `cart-invalidation` | Evitar import circular serializers ↔ cart-invalidation |
| Grep plano inclui `__tests__` | Grep producao usa `--glob '!**/__tests__/**'` | Testes de prova negativa contem literals forbidden intencionalmente |

## Self-Check: PASSED

- key-files.created exist on disk
- Unit invalidation + full Phase 04 unit suite: PASS
- Integration retry/supersede/invalidation + negative proofs: PASS
- Build ADMIN_DISABLED=true: PASS
- Grep negativo producao: PASS
- Phase 05 nao iniciada

## Manual Review Gate

**PARAR AQUI.** Phase 04 money-path pre-Order esta completa para revisao humana.

Proximos passos operacionais (fora deste escopo):

1. Revisao humana deste summary + gates 04-01/04-02/04-04/04-05.
2. Decisao migration `TBD-payment-attempt.ts` + nullable `payment_session_id`.
3. Configurar camadas Stripe card/Pix reais (`STRIPE_*_INITIATION_LAYER`).
4. **Nao** iniciar Phase 05 (webhook/Order) ate aprovacao explicita.

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 06*
*Completed: 2026-06-29*
