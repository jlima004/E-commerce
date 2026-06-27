---
phase: 03
slug: cart-checkout-pre-order
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-27
---

# Phase 03 — Validation Strategy

> Contrato de validação para Cart & Checkout (pre-Order). Esta estratégia prova coleta/normalização de dados e, principalmente, prova negativamente que checkout permanece pré-Order.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| **Config file** | `apps/backend/jest.config.js` |
| **Quick run command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts` |
| **Full suite command** | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |
| **Estimated runtime** | ~90-180 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task-specific unit or HTTP integration command listed below.
- **After every plan wave:** Run the full suite command.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 180 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CART-01, CART-02 | T-03-01 | Cart ativo por ator não confia em `customer_id` vindo do body e não cria Order/PaymentSession. | source + unit | `rg -n "completeCartWorkflow|ready_for_payment|PaymentAttempt|PaymentSession|stripe|pix|gelato|/hooks" apps/backend/src apps/backend/integration-tests/http` must show no Phase 03 activation path except explicit negative-test strings | W0 | pending |
| 03-02-01 | 02 | 1 | CART-01, CART-02 | T-03-02 | Attach usa somente o guest cart da sessão atual; guest cart vazio não sobrescreve cart útil do customer. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts -t "guest cart|authenticated|transfer"` | W0 | pending |
| 03-03-01 | 03 | 1 | CART-03 | T-03-03 | Email, CEP, CPF/CNPJ, UF e `country_code=BR` são normalizados/validados sem expor PII completa em erro/log. | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts -t "email|address|federal_tax_id|postal_code|province"` | W0 | pending |
| 03-04-01 | 04 | 2 | CART-03, CART-04 | T-03-04 | `checkout_data_complete` é derivado em resposta, recalculado a cada mutação e nunca persistido como status nominal. | unit + integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts -t "checkout_data_complete"` | W0 | pending |
| 03-05-01 | 05 | 2 | CART-04 | T-03-05 | Nenhum Order, PaymentAttempt, PaymentSession, webhook, Stripe/Pix ou Gelato é criado/disparado. | integration:http + source | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts -t "pre-Order"` plus static grep negatives | W0 | pending |

---

## Wave 0 Requirements

- [ ] `apps/backend/src/modules/checkout/checkout-data.ts` — helper puro para email, address Brasil/Gelato, `federal_tax_id` e cálculo derivado.
- [ ] `apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts` — matriz de normalização, validação estrutural e PII-safe errors.
- [ ] `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` — contratos HTTP para guest, customer autenticado, attach e prova pré-Order.
- [ ] `apps/backend/src/api/store/carts/serializers.ts` ou equivalente local — shaping de resposta com `checkout_data_complete` calculado.

---

## Negative Proofs Required

- [ ] Nenhum código de Phase 03 chama ou importa `completeCartWorkflow`, `sdk.store.cart.complete` ou `/store/carts/:id/complete`.
- [ ] Nenhum código de Phase 03 cria `Order`, `PaymentAttempt`, `PaymentSession`, webhook Stripe/Gelato, chamada Stripe/Pix ou chamada Gelato.
- [ ] A resposta de checkout completo pode conter `checkout_data_complete: true`, mas não contém `order`, `order_id`, `payment_session_id`, `payment_intent_id`, `payment_attempt_id` ou `gelato_order_id`.
- [ ] Nenhuma migration foi rodada; se a solução de cart "não ativo" exigir migration ou schema novo, execução deve parar para gate manual antes de qualquer implementação.
- [ ] Nenhum secret/config var/deploy foi alterado.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Escolha final de persistência do `federal_tax_id` | CART-03 | CPF/CNPJ completo é PII; a menor exposição aceitável precisa de revisão humana antes de execução se a solução não couber em campo core/address metadata já existente. | Revisar o plano correspondente antes da execução e confirmar que logs/Sentry mascaram/omitem documento completo. |
| Representação de cart antigo "não ativo" | CART-02 | Se a opção técnica exigir migration, a restrição desta fase exige parada manual. | Antes de executar o plano de attach, confirmar se ele usa mecanismo existente; se houver schema/migration, interromper e replanejar. |
| Contrato de sessão para guest cart atual | CART-01, CART-02 | A storefront futura ainda não existe; o backend precisa validar que o cart anexado pertence à sessão atual sem confiar só no body. | Revisar o contrato HTTP planejado para cookie/header/session token e aceitar explicitamente antes da execução. |

---

## Threat References

| Ref | Threat | Required Mitigation |
|-----|--------|---------------------|
| T-03-01 | Cart takeover por `customer_id`/cart id arbitrário no body. | Derivar customer da autenticação Medusa e validar posse/sessão do cart antes de qualquer attach. |
| T-03-02 | Sobrescrever cart útil do customer com guest cart vazio ou não pertencente à sessão atual. | Exigir guest cart atual, não vazio e validado antes de `transferCart`; caso contrário preservar cart ativo existente. |
| T-03-03 | Vazamento de email/endereço/CPF/CNPJ em logs, Sentry ou mensagens de erro. | Reusar allowlist de logs, não registrar body/query sensível e mascarar documento em erro. |
| T-03-04 | Estado `checkout_data_complete` stale ou persistido como status. | Calcular em helper puro/serializer a partir do cart atual; proibir `ready_for_payment`. |
| T-03-05 | Criação acidental de Order/pagamento/fulfillment no checkout. | Testes negativos e grep estático para completion, payment, webhook, Stripe/Pix e Gelato. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 180s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending manual review.
