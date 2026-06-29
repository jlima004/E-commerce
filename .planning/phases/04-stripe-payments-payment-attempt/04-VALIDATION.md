---
phase: 04
slug: stripe-payments-payment-attempt
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-29
closed_at: 2026-06-29
manual_review_gate: true
---

# Phase 04 — Validation Strategy

> Contrato de validacao para Stripe Payments & PaymentAttempt. Esta estrategia prova iniciacao segura de cartao/Pix somente por boundary Stripe allowlist-only e prova negativamente que a Phase 04 permanece pre-Order, sem webhook, sem Order e sem Gelato.

---

## Final Validation Result

Phase 04 is **validated complete** for the pre-Order money-path scope, based on the executed summaries `04-01` through `04-06`.

Final evidence recorded in `04-06-SUMMARY.md`:

- Unit suite: **89/89 passed**.
- HTTP integration suite: **29/29 passed**.
- Build: **Backend build completed successfully** with `ADMIN_DISABLED=true`.
- Production negative grep: clean for Order, webhook, completion, `purchase_completed`, and Gelato paths outside tests.
- Closure verification is documentary-only; no tests, migrations, Stripe config, webhooks, Orders, `purchase_completed`, or Gelato work were run during closure.

Production activation remains blocked by the manual gates documented below: `TBD-payment-attempt.ts` not applied, `medusa db:migrate` blocked, Stripe real card/Pix not configured, and `STRIPE_CARD_INITIATION_LAYER` / `STRIPE_PIX_INITIATION_LAYER` still requiring real safe layers or custom providers.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| **Config file** | `apps/backend/jest.config.js` |
| **Quick run command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts` |
| **Full suite command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |
| **Estimated runtime** | ~120-240 seconds after Phase 04 tests exist |

---

## Sampling Rate

- **After 04-01:** review `04-01-SUMMARY.md`; native-first card/Pix is blocked by `PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true`.
- **Before 04-04 runtime work:** run boundary tests proving `PaymentSession.data` allowlist-only or stop for replan.
- **Before 04-05 runtime work:** confirm `04-04-SUMMARY.md` records the chosen safe strategy and allowlist evidence.
- **After every task commit:** run the task-specific unit or HTTP integration command listed below.
- **After every plan wave:** run all Phase 04 unit tests plus the relevant HTTP integration slice.
- **Before `$gsd-verify-work`:** full suite, build and negative greps must be green.
- **Max feedback latency:** 240 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PAY-01, PAY-02 | T-04-01-I | `PaymentSession.data` persistence and `client_secret` leakage are proven before native-first. | spike + unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts` | complete | complete |
| 04-01-02 | 01 | 1 | PAY-02, PAY-03 | T-04-01-T | Pix native path is blocked because QR/`next_action`/secret would persist unsafely. | spike + source | `rg -n "PIX_NATIVE_SAFE=false|CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true|PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true" .planning/phases/04-stripe-payments-payment-attempt/04-01-SUMMARY.md` | complete | complete |
| 04-02-02 | 02 | 2 | PAY-04 | T-04-02-R | State machine has canonical pre-webhook states and no financial-truth labels. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts` | complete | complete |
| 04-02-03 | 02 | 2 | PAY-04 | T-04-02-T | One active attempt per cart; `superseded` preserves history. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts` | complete | complete |
| 04-03-01 | 03 | 2 | PAY-01, PAY-02 | T-04-03-E | Payment start requires derived `checkout_data_complete=true`, BR/BRL, valid items/email/shipping. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts` | complete | complete |
| 04-03-02 | 03 | 2 | PAY-01, PAY-02 | T-04-03-T | `amount`/`currency` from body are rejected or ignored and never source of truth. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts -t "amount|currency|money"` | complete | complete |
| 04-04-01 | 04 | 3 | PAY-01, PAY-04 | T-04-04-I | Safe Stripe boundary separates immediate secrets from allowlist-only persisted data. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts` | complete | complete |
| 04-04-02 | 04 | 3 | PAY-01, PAY-04 | T-04-04-I | Card initiation uses only custom provider/layer/wrapper and never persists `client_secret` or PaymentIntent raw. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts` | complete | complete |
| 04-04-03 | 04 | 3 | PAY-01 | T-04-04-T | HTTP card initiation in BRL returns no Order and no raw `PaymentSession.data`. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "card"` | complete | complete |
| 04-04-04 | 04 | 3 | PAY-01, PAY-04 | T-04-04-R | Client-side confirmation is local UX state only and awaits webhook. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts -t "payment_client_confirmed"` | complete | complete |
| 04-05-01 | 05 | 4 | PAY-02 | T-04-05-I | Pix implementation is blocked unless 04-04 proves a safe strategy. | manual + source | `rg -n "custom_provider|stripe_layer|filtering_wrapper|allowlist-only" .planning/phases/04-stripe-payments-payment-attempt/04-04-SUMMARY.md` | complete | complete |
| 04-05-02 | 05 | 4 | PAY-02, PAY-03 | T-04-05-I | Pix QR/copy/`next_action` are response-only and not persistible. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-safe-boundary.unit.spec.ts -t "pix|next_action|copy_paste|client_secret"` | complete | complete |
| 04-05-03 | 05 | 4 | PAY-02, PAY-03 | T-04-05-E | Pix returns instructions + `expires_at`, persists partial safe state, and creates no Order. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts` | complete | complete |
| 04-05-04 | 05 | 4 | PAY-02, PAY-03 | T-04-05-T | HTTP Pix initiation in BRL returns no Order and does not accept amount/currency body values. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "pix"` | complete | complete |
| 04-05-05 | 05 | 4 | PAY-03, PAY-04 | T-04-05-E | Local Pix expired/failed/canceled states never create Order. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/pix-initiation.unit.spec.ts -t "expired|failed|canceled|Order"` | complete | complete |
| 04-06-01 | 06 | 5 | PAY-03, PAY-04 | T-04-06-T | Cart mutation marks active attempt as `invalidated_by_cart_change`. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/payment-attempt-invalidation.unit.spec.ts` | complete | complete |
| 04-06-02 | 06 | 5 | PAY-04 | T-04-06-E | Retry/supersede creates one active attempt and historical attempts remain auditably inactive. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts -t "supersede|invalidated_by_cart_change|retry"` | complete | complete |
| 04-06-03 | 06 | 5 | PAY-01, PAY-02, PAY-03, PAY-04 | T-04-06-I | Final negative proofs: no Order/webhook/completion/purchase/Gelato and no sensitive leakage. | unit + integration:http + source | Full suite command plus negative grep below | complete | complete |

---

## Wave 0 / Manual Gate Requirements

- [x] `04-01-SUMMARY.md` answers that `PaymentSession.data` persists the full PaymentIntent.
- [x] `04-01-SUMMARY.md` answers that `client_secret` can leak through `PaymentSession.data`.
- [x] `04-01-SUMMARY.md` answers that Medusa Stripe v2.16.0 does not expose Pix QR/instructions/`expires_at` safely through native-first pure.
- [x] `04-01-SUMMARY.md` states native-first pure is blocked and custom provider/layer/wrapper is required.
- [x] `04-04-SUMMARY.md` records the chosen safe strategy and proves allowlist-only before `04-05` runtime.
- [x] `PaymentAttempt` migration remains a draft and execution remains blocked until human review before any `db:migrate`.
- [x] Stripe secrets/config are recorded as future setup only; no secrets/config vars were created in Phase 04.

---

## Required Unit Tests

- State machine for `PaymentAttempt`, including canonical statuses and forbidden financial-truth labels.
- One active attempt per cart, `superseded`, and `invalidated_by_cart_change`.
- Rejection/ignore of `amount`, `currency`, `currency_code`, `total`, `subtotal` from request body.
- Safe Stripe boundary tests proving persisted shapes exclude `client_secret`, raw PaymentIntent, `next_action`, QR/copia-e-cola, raw CPF/CNPJ and complete address.
- Card initiation helper never receives raw card data and never persists `client_secret`.
- Pix initiation helper persists `expires_at` and safe IDs only; QR/copia-e-cola/`next_action` full payload is response-only.

---

## Required Integration HTTP Tests

- `POST /store/carts/:id/payment-attempts/card` starts card payment in BRL and does not return `order`, `order_id`, raw `PaymentSession.data` or PaymentIntent payload.
- `POST /store/carts/:id/payment-attempts/pix` starts Pix payment in BRL, returns immediate QR/instructions and `expires_at`, and does not return `order`, `order_id`, raw `PaymentSession.data` or `next_action` integral.
- Incomplete checkout, wrong actor/cart ownership, non-BR/BRL cart and malicious amount/currency body values fail or are ignored safely.
- Retry/supersede across card/Pix leaves exactly one active attempt for the cart.
- Mutating item, quantity, email or shipping address marks the old active attempt as `invalidated_by_cart_change`.
- `awaiting_pix_payment`, `pix_expired`, `payment_failed` and `payment_canceled` never create or return Order.

---

## Negative Proofs Required

- [x] No Phase 04 code calls or imports `completeCartWorkflow`.
- [x] No Phase 04 code calls `/store/carts/:id/complete` or `sdk.store.cart.complete`.
- [x] No Phase 04 code creates or returns `Order`.
- [x] No Phase 04 code implements Stripe webhook runtime.
- [x] No Phase 04 code creates `WebhookEventLog`.
- [x] No Phase 04 code creates `CheckoutCompletionLog`.
- [x] No Phase 04 code emits `purchase_completed`.
- [x] No Phase 04 code calls Gelato or references `order.gelatoapis.com`.
- [x] `PaymentAttempt.order_id` remains `null` in Phase 04 paths.
- [x] `PaymentSession.data`, if used, is allowlist-only and never contains raw PaymentIntent, `client_secret`, QR/copia-e-cola or `next_action` integral.
- [x] `client_secret` appears only in tests proving immediate response behavior and immediate DTO behavior, and never in persisted metadata/log/Sentry/error paths.
- [x] QR/copia-e-cola/`next_action` full payload is not persisted.
- [x] `amount` and `currency` never come from the client body.

Suggested final grep:

```bash
cd apps/backend && ! rg -n "completeCartWorkflow|/store/carts/.*/complete|sdk\\.store\\.cart\\.complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|order\\.gelatoapis\\.com|gelato_order_id" src/modules/payment-attempt src/api/store/carts/payment-attempts
```

Suggested sensitive-data grep/review:

```bash
cd apps/backend && rg -n "client_secret|pi_.*_secret|next_action|pix_display_qr_code|copy_paste|payment_session\\.data|PaymentIntent|federal_tax_id|address_1" src/modules/payment-attempt src/api/store/carts/payment-attempts integration-tests/http/payment-attempt-store.spec.ts
```

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `PaymentSession.data` persistence | PAY-01, PAY-02 | Native-first leaks `client_secret`/Pix payload indirectly if PaymentIntent is persisted wholesale. | Review `04-01-SUMMARY.md`; native-first remains blocked. |
| Safe strategy selection | PAY-01, PAY-02, PAY-04 | Custom provider/layer/wrapper choice affects future config, provider registration and maintenance. | `04-04-SUMMARY.md` and `04-05-SUMMARY.md` record `filtering_wrapper` + injectable Stripe layers; real provider/config remains future setup. |
| Pix native safe surface | PAY-02, PAY-03 | Medusa provider local has no explicit Pix service; QR/`expires_at` safety must be proven through the chosen safe boundary. | Review gate flags `PIX_NATIVE_SAFE=false`, `CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true`, `STOP_BEFORE_04_05` behavior. |
| PaymentAttempt migration | PAY-04 | New custom entity changes schema; execution requires human approval before applying migrations. | `TBD-payment-attempt.ts` remains draft; do not run `medusa db:migrate` until approved. |
| `payment_session_id` nullable decision | PAY-04 | The model/types/helpers and migration draft need the same nullable contract. | Decision recorded as `PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable`; migration still not applied. |
| Stripe setup/config | PAY-01, PAY-02 | Phase 04 planning cannot create secrets/config vars. | Record required env/setup in summary only; do not edit secrets or deployment config. |

---

## Threat References

| Ref | Threat | Required Mitigation |
|-----|--------|---------------------|
| T-04-01-I | `client_secret` leaks via `PaymentSession.data` or provider-returned PaymentIntent. | Gate blocks native-first; 04-04 introduces allowlist-only boundary. |
| T-04-02-T | Multiple active attempts or stale retry creates ambiguous money path. | Unique/lock/helper for one active attempt per cart and supersede history. |
| T-04-03-T | Client tampers with amount/currency. | Derive amount/currency from cart server-side and reject/ignore body fields. |
| T-04-04-I | Card `client_secret` lands in persistence/log/Sentry/error. | Response-only secret, boundary tests and grep. |
| T-04-05-I | Pix QR/copia-e-cola/`next_action` full payload is stored or logged. | Persist only `expires_at`, IDs and metadata saneada; DTO imediato separado. |
| T-04-06-E | Pix pending/expired/failed or invalidated attempt creates Order. | State machine, integration tests and negative grep keep Phase 04 pre-Order. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or explicit manual gate.
- [x] Sampling continuity: no 3 consecutive implementation tasks without automated verify.
- [x] 04-01 gate blocks unsafe native-first assumptions before 04-04/04-05.
- [x] 04-04 boundary proves safe strategy before card route/helper and before 04-05.
- [x] PaymentAttempt migration is explicitly manual-review gated.
- [x] `payment_session_id` nullable decision is recorded as `model_and_migration_nullable`; migration application remains blocked.
- [x] No watch-mode flags.
- [x] Feedback latency target < 240s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** Phase 04 validation complete. Phase 05 remains blocked pending human approval after closure review; do not create Stripe webhook, Order, `purchase_completed`, or Gelato work from this phase.
