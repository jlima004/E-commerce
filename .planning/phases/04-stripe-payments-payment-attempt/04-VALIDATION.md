---
phase: 04
slug: stripe-payments-payment-attempt
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
manual_review_gate: true
---

# Phase 04 — Validation Strategy

> Contrato de validacao para Stripe Payments & PaymentAttempt. Esta estrategia prova iniciacao segura de cartao/Pix e prova negativamente que a Phase 04 permanece pre-Order, sem webhook, sem Order e sem Gelato.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| **Config file** | `apps/backend/jest.config.js` |
| **Quick run command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts` |
| **Full suite command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |
| **Estimated runtime** | ~120-240 seconds after Phase 04 tests exist |

---

## Sampling Rate

- **After 04-01:** run the provider/Pix gate test and review `04-01-SUMMARY.md` manually before any runtime payment implementation.
- **After every task commit:** run the task-specific unit or HTTP integration command listed below.
- **After every plan wave:** run all Phase 04 unit tests plus the relevant HTTP integration slice.
- **Before `$gsd-verify-work`:** full suite, build and negative greps must be green.
- **Max feedback latency:** 240 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PAY-01, PAY-02 | T-04-01-I | `PaymentSession.data` persistence and `client_secret` leakage are proven before native-first. | spike + unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts` | planned | pending |
| 04-01-02 | 01 | 1 | PAY-02, PAY-03 | T-04-01-T | Pix native path exposes QR/`expires_at` safely or blocks for custom provider/layer. | spike + source | `rg -n "PIX_NATIVE_SAFE|CUSTOM_PROVIDER_OR_LAYER_REQUIRED|STOP_BEFORE_04_05" .planning/phases/04-stripe-payments-payment-attempt/04-01-SUMMARY.md` | planned | pending |
| 04-02-02 | 02 | 2 | PAY-04 | T-04-02-R | State machine has canonical pre-webhook states and no financial-truth labels. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts` | planned | pending |
| 04-02-03 | 02 | 2 | PAY-04 | T-04-02-T | One active attempt per cart; `superseded` preserves history. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts` | planned | pending |
| 04-03-01 | 03 | 2 | PAY-01, PAY-02 | T-04-03-E | Payment start requires derived `checkout_data_complete=true`, BR/BRL, valid items/email/shipping. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts` | planned | pending |
| 04-03-02 | 03 | 2 | PAY-01, PAY-02 | T-04-03-T | `amount`/`currency` from body are rejected or ignored and never source of truth. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts -t "amount|currency|money"` | planned | pending |
| 04-04-01 | 04 | 3 | PAY-01, PAY-04 | T-04-04-I | Card initiation returns `client_secret` only immediately and never persists/logs it. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts` | planned | pending |
| 04-04-02 | 04 | 3 | PAY-01 | T-04-04-T | HTTP card initiation in BRL returns no Order. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "card"` | planned | pending |
| 04-05-01 | 05 | 4 | PAY-02 | T-04-05-I | Pix implementation is blocked unless the 04-01 gate approves native path or replan approves custom path. | manual + source | `rg -n "PIX_NATIVE_SAFE=true|CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true|PIX_GATE_INCONCLUSIVE=true" .planning/phases/04-stripe-payments-payment-attempt/04-01-SUMMARY.md` | planned | pending |
| 04-05-02 | 05 | 4 | PAY-02, PAY-03 | T-04-05-E | Pix returns QR/instructions + `expires_at`, persists partial safe state, and creates no Order. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts` | planned | pending |
| 04-05-03 | 05 | 4 | PAY-02, PAY-03 | T-04-05-T | HTTP Pix initiation in BRL returns no Order and does not accept amount/currency body values. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "pix"` | planned | pending |
| 04-06-01 | 06 | 5 | PAY-03, PAY-04 | T-04-06-T | Cart mutation marks active attempt as `invalidated_by_cart_change`. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts` | planned | pending |
| 04-06-02 | 06 | 5 | PAY-04 | T-04-06-E | Retry/supersede creates one active attempt and historical attempts remain auditably inactive. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "supersede|invalidated_by_cart_change|retry"` | planned | pending |
| 04-06-03 | 06 | 5 | PAY-01, PAY-02, PAY-03, PAY-04 | T-04-06-I | Final negative proofs: no Order/webhook/completion/purchase/Gelato and no sensitive leakage. | unit + integration:http + source | Full suite command plus negative grep below | planned | pending |

---

## Wave 0 / Manual Gate Requirements

- [ ] `04-01-SUMMARY.md` must answer whether `PaymentSession.data` persists the full PaymentIntent.
- [ ] `04-01-SUMMARY.md` must answer whether `client_secret` can leak through `PaymentSession.data`.
- [ ] `04-01-SUMMARY.md` must answer whether Medusa Stripe v2.16.0 exposes Pix QR/instructions/`expires_at` safely.
- [ ] `04-01-SUMMARY.md` must state native-first pure accepted vs custom provider/layer required.
- [ ] If `PaymentAttempt` migration is generated, execution remains blocked until human review before any `db:migrate`.
- [ ] If any Stripe secret/config is required, it is recorded as future setup only; no secrets/config vars are created in Phase 04 planning.

---

## Required Unit Tests

- State machine for `PaymentAttempt`, including canonical statuses and forbidden financial-truth labels.
- One active attempt per cart, `superseded`, and `invalidated_by_cart_change`.
- Rejection/ignore of `amount`, `currency`, `currency_code`, `total`, `subtotal` from request body.
- Sanitization of `client_secret`, `pi_*_secret_*`, QR/copia-e-cola, raw CPF/CNPJ and complete address.
- Card initiation helper never receives raw card data and never persists `client_secret`.
- Pix initiation helper persists `expires_at` and safe IDs only; QR/copia-e-cola full payload is response-only unless a gate explicitly approves otherwise.

---

## Required Integration HTTP Tests

- `POST /store/carts/:id/payment-attempts/card` starts card payment in BRL and does not return `order` or `order_id`.
- `POST /store/carts/:id/payment-attempts/pix` starts Pix payment in BRL, returns immediate QR/instructions and `expires_at`, and does not return `order` or `order_id`.
- Incomplete checkout, wrong actor/cart ownership, non-BR/BRL cart and malicious amount/currency body values fail or are ignored safely.
- Retry/supersede across card/Pix leaves exactly one active attempt for the cart.
- Mutating item, quantity, email or shipping address marks the old active attempt as `invalidated_by_cart_change`.
- `awaiting_pix_payment`, `pix_expired`, `payment_failed` and `payment_canceled` never create or return Order.

---

## Negative Proofs Required

- [ ] No Phase 04 code calls or imports `completeCartWorkflow`.
- [ ] No Phase 04 code calls `/store/carts/:id/complete` or `sdk.store.cart.complete`.
- [ ] No Phase 04 code creates or returns `Order`.
- [ ] No Phase 04 code implements Stripe webhook runtime.
- [ ] No Phase 04 code creates `WebhookEventLog`.
- [ ] No Phase 04 code creates `CheckoutCompletionLog`.
- [ ] No Phase 04 code emits `purchase_completed`.
- [ ] No Phase 04 code calls Gelato or references `order.gelatoapis.com`.
- [ ] `PaymentAttempt.order_id` remains `null` in Phase 04 paths.
- [ ] `client_secret` appears only in tests proving immediate response behavior and never in persisted metadata/log/Sentry/error paths.
- [ ] QR/copia-e-cola full payload is not persisted unless `04-01-SUMMARY.md` documents explicit need and safe design.
- [ ] `amount` and `currency` never come from the client body.

Suggested final grep:

```bash
cd apps/backend && ! rg -n "completeCartWorkflow|/store/carts/.*/complete|sdk\\.store\\.cart\\.complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|order\\.gelatoapis\\.com|gelato_order_id" src/modules/payment-attempt src/api/store/carts/payment-attempts
```

Suggested sensitive-data grep/review:

```bash
cd apps/backend && rg -n "client_secret|pi_.*_secret|pix_display_qr_code|copy_paste|federal_tax_id|address_1" src/modules/payment-attempt src/api/store/carts/payment-attempts integration-tests/http/payment-attempt-store.spec.ts
```

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `PaymentSession.data` persistence | PAY-01, PAY-02 | Native-first can leak `client_secret` indirectly if PaymentIntent is persisted wholesale. | Review `04-01-SUMMARY.md`; if leakage exists, block native-first and replan custom provider/layer. |
| Pix native safe surface | PAY-02, PAY-03 | Medusa provider local has no explicit Pix service; QR/`expires_at` safety must be proven before use. | Review gate flags `PIX_NATIVE_SAFE`, `CUSTOM_PROVIDER_OR_LAYER_REQUIRED`, `STOP_BEFORE_04_05`. |
| PaymentAttempt migration | PAY-04 | New custom entity changes schema; execution requires human approval before applying migrations. | Review generated migration/indexes; do not run `medusa db:migrate` until approved. |
| Stripe setup/config | PAY-01, PAY-02 | Phase 04 planning cannot create secrets/config vars. | Record required env/setup in summary only; do not edit secrets or deployment config. |

---

## Threat References

| Ref | Threat | Required Mitigation |
|-----|--------|---------------------|
| T-04-01-I | `client_secret` leaks via `PaymentSession.data` or provider-returned PaymentIntent. | Spike/gate blocks native-first unless persistence is filtered/safe. |
| T-04-02-T | Multiple active attempts or stale retry creates ambiguous money path. | Unique/lock/helper for one active attempt per cart and supersede history. |
| T-04-03-T | Client tampers with amount/currency. | Derive amount/currency from cart server-side and reject/ignore body fields. |
| T-04-04-I | Card `client_secret` lands in persistence/log/Sentry/error. | Response-only secret, sanitizer tests and grep. |
| T-04-05-I | Pix QR/copia-e-cola full payload is stored or logged. | Persist only `expires_at`, IDs and optional hash/preview after gate. |
| T-04-06-E | Pix pending/expired/failed or invalidated attempt creates Order. | State machine, integration tests and negative grep keep Phase 04 pre-Order. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or explicit manual gate.
- [ ] Sampling continuity: no 3 consecutive implementation tasks without automated verify.
- [ ] 04-01 gate blocks unsafe native-first assumptions before 04-04/04-05.
- [ ] PaymentAttempt migration is explicitly manual-review gated.
- [ ] No watch-mode flags.
- [ ] Feedback latency target < 240s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending manual review after Phase 04 plan generation. Execution remains blocked.
