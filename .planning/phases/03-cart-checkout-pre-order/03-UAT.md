---
status: complete
phase: 03-cart-checkout-pre-order
source:
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
  - 03-05-SUMMARY.md
started: 2026-06-27T21:25:00Z
updated: 2026-06-27T21:32:00Z
scope: automated verification only; no new code, migrations, deploy, install, secrets/config changes, or Phase 04 scope
---

# Phase 03 UAT — Cart & Checkout (pre-Order)

## Current Test

[automated verification complete — manual human closeout gate pending before phase closure or Phase 04]

## Tests

### 1. 03-01 Active cart guest/customer contract (CART-01, CART-02, CART-04)
expected: Helper puro de cart ativo, rota `/store/carts/active`, sessão guest via `req.session.active_cart_id`, resposta pre-Order sem payment/order; nenhuma migration ou config nova.
result: pass
evidence:
  - `03-01-SUMMARY.md` records `requirements-completed: [CART-01, CART-02, CART-04]`.
  - Key files: `apps/backend/src/modules/checkout/active-cart.ts`, `apps/backend/src/api/store/carts/active/route.ts`.
  - Unit: `active-cart.unit.spec.ts` — 8 passed (suite total 40/40).
  - Cart superseded via metadata nativa `active_for_checkout=false` + `superseded_by_cart_id` — sem model/migration novo.

### 2. 03-02 Secure guest cart attach (CART-01, CART-02, CART-04)
expected: Attach usa prova server-side `req.session.active_cart_id`; `cart_id` no body só vale se coincidir com sessão; guest vazio preserva cart útil; email normalizado para `customer.email`; sem payment/order.
result: pass
evidence:
  - `03-02-SUMMARY.md` records D-02, D-04, D-05, D-06, D-08, D-09 covered.
  - `resolveCurrentSessionGuestCart` rejeita `requestedCartId !== sessionGuestCartId` (`attach-guest-cart.ts:67-71`).
  - HTTP: 5 attach tests passed including body/session mismatch rejection and preserve useful customer cart.
  - Unit: `attach-guest-cart.unit.spec.ts` — 7 passed.

### 3. 03-03 Brasil checkout data validation (CART-03, CART-04)
expected: Email, CEP, UF, CPF/CNPJ normalizados/validados estruturalmente; `federal_tax_id` em `shipping_address.metadata`; resposta/erros PII-safe com máscara; sem integração externa postal.
result: pass
evidence:
  - `03-03-SUMMARY.md` records D-08..D-22 covered.
  - `validateBrazilShippingAddress` persiste documento normalizado em metadata (`checkout-data.ts:390-391`); erros usam `masked_federal_tax_id` (`checkout-data.ts:362-364`).
  - Serializer expõe apenas `masked_federal_tax_id` na resposta pública (`serializers.ts:201`); lê de `address.metadata.federal_tax_id` (`serializers.ts:117,188`).
  - Unit: `checkout-data.unit.spec.ts` — 25 passed.

### 4. 03-04 Derived checkout_data_complete (CART-01..CART-04)
expected: `checkout_data_complete` calculado em serializer/middleware a cada resposta; nunca persistido como status; `ready_for_payment` ausente; recalcula após mutação; reutiliza `isSellableVariant`.
result: pass
evidence:
  - `03-04-SUMMARY.md` records D-23..D-33 covered.
  - `serializeStoreCartPreOrder` injeta `checkout_data_complete: withCheckoutDataComplete(cart)` em memória (`serializers.ts:220`); nenhum update de cart/metadata persiste prontidão.
  - `calculateCheckoutDataComplete` retorna boolean + `incomplete_reasons` (`checkout-data.ts:429,499`).
  - Grep produção: zero ocorrências de `ready_for_payment` em `src/modules/checkout`, `src/api/store/carts`, `src/api/store/customers`.
  - Unit: 12 testes `checkout_data_complete` passed; HTTP recalculo test passed.

### 5. 03-05 Pre-Order HTTP contract & negative proofs (CART-04)
expected: Integration tests HTTP consolidados; respostas sem Order/payment/Gelato; grep estático limpo; build verde; Phase 04 não iniciada.
result: pass
evidence:
  - `03-05-SUMMARY.md` records 24 HTTP tests.
  - Integration: `cart-checkout-store.spec.ts` — **24/24 passed** (2026-06-27 verify run).
  - Negative proofs: sem `order_id`, `payment_session_id`, `payment_intent_id`, `gelato_order_id` nas respostas; sem workflows proibidos.
  - Grep produção (escopo Phase 03): **exit 0 (clean)**.
  - Build: `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` — **Backend build completed successfully**.

### 6. Decisions D-01..D-33 coverage matrix
expected: Todas as decisões de `03-CONTEXT.md` refletidas em código e/ou testes sem violar fronteira pre-Order.
result: pass
evidence:
  - D-01..D-07: `active-cart.ts`, `attach-guest-cart.ts`, HTTP attach tests.
  - D-08..D-12: `resolveCheckoutEmail` / email guest vs customer + unit tests.
  - D-13..D-22: `validateBrazilShippingAddress`, normalizers, PII-safe errors + unit tests.
  - D-23..D-28: derived `checkout_data_complete`, no `ready_for_payment`, no Order/payment side effects.
  - D-29..D-33: `calculateCheckoutDataComplete` + `isSellableVariant` reuse + BRL context checks.

### 7. Requirements CART-01..CART-04
expected: CART-01 guest cart; CART-02 authenticated cart + attach; CART-03 email/address validation; CART-04 no Order until payment.
result: pass
evidence:
  - All five plan summaries list `requirements-completed` covering CART-01..CART-04.
  - Automated suite: 64 tests total (40 unit + 24 integration) green.
  - `REQUIREMENTS.md` traceability table still shows Pending — **not updated** (manual closeout gate).

### 8. Phase boundary & prohibitions
expected: Sem migrations Phase 03, sem deploy/install, sem secrets/config vars novos, sem artefatos Phase 04, sem Order/PaymentAttempt/PaymentSession/webhook/Stripe/Pix/Gelato.
result: pass
evidence:
  - Zero migrations em `apps/backend/src/modules/checkout/`.
  - Zero diretório `.planning/phases/04*`.
  - Grep produção limpo para completion/payment/webhook/fulfillment patterns no escopo checkout.
  - Summaries confirmam nenhum commit/closeout Git/STATE/ROADMAP durante execução.

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Automated Commands (2026-06-27)

```text
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts
→ 24 passed

cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/checkout/__tests__/active-cart.unit.spec.ts \
  src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts \
  src/modules/checkout/__tests__/checkout-data.unit.spec.ts
→ 40 passed

cd apps/backend && ! rg -n "completeCartWorkflow|sdk\.store\.cart\.complete|PaymentAttempt|PaymentSession|payment_intent|order\.gelatoapis\.com|gelato_order_id|/hooks|ready_for_payment" \
  src/modules/checkout src/api/store/carts src/api/store/customers
→ exit 0 (clean)

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
→ Backend build completed successfully (10.81s)
```

## Gaps

[none]

## Manual Gate

Phase 03 implementation and automated verification are **complete**. Per project execution policy:

- **Do not** mark phase closed in ROADMAP/STATE/REQUIREMENTS until human review approves.
- **Do not** start Phase 04 (Stripe/PaymentAttempt/PaymentSession).
- Next permitted steps after human approval: phase closure documentation and/or `/gsd-execute-phase 4` planning only.
