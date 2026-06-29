---
phase: 04-stripe-payments-payment-attempt
plan: 03
subsystem: payments
tags: [payment-eligibility, checkout_data_complete, brl, amount-derivation, pay-01, pay-02, pay-04]

requires:
  - phase: 04-stripe-payments-payment-attempt
    provides: PaymentAttempt module from 04-02, checkout_data_complete from Phase 03
provides:
  - assertPaymentStartEligible / evaluatePaymentStartEligibility
  - derivePaymentAmountFromCart (server-side centavos BRL)
  - rejectClientMoneyFields / normalizePaymentStartRequestBody
  - Unit tests de eligibility e anti-tampering monetario
affects: [04-04, 04-05]

tech-stack:
  added: []
  patterns:
    - "Gate de pagamento reutiliza calculateCheckoutDataComplete da Phase 03"
    - "Total/moeda derivados exclusivamente do cart; body monetario rejeitado"
    - "Erros saneados sem ecoar valores do body, CPF/CNPJ ou endereco completo"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/eligibility.ts
    - apps/backend/src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts
    - apps/backend/src/api/store/carts/payment-attempts/validators.ts
  modified: []

key-decisions:
  - "checkout_data_complete=true e precondicao obrigatoria via calculateCheckoutDataComplete reutilizado"
  - "amount deriva de cart.total quando presente; fallback soma line items + shipping/tax - discount"
  - "currency_code retornado como BRL (uppercase); persistencia PaymentAttempt continua brl lowercase (04-02)"
  - "Body com amount/total/subtotal/currency/currency_code/region_currency e rejeitado com mensagem fixa saneada"
  - "Eligibility nao cria Order, PaymentSession, PaymentAttempt nem chama Stripe"
  - "Model PaymentAttempt inalterado — blocker migration payment_session_id nullable permanece em 04-02"
  - "Guest exige sessionActiveCartId presente e igual a cart.id; ausente/vazio/diferente => CART_ACCESS_DENIED"
  - "Region gate sem fallback br em eligibility; region ausente/invalida => INVALID_REGION via calculateCheckoutDataComplete"

patterns-established:
  - "PaymentStartEligibilityInput/Result como contrato puro testavel antes das rotas 04-04/04-05"
  - "normalizePaymentStartRequestBody como unico ponto de parse do body de inicio de pagamento"

requirements_addressed: [PAY-01, PAY-02, PAY-04]
requirements-completed: []

duration: 35min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 03 — Payment Start Eligibility Summary

**Gate de eligibility para iniciar pagamento: exige `checkout_data_complete=true` derivado do cart, deriva `amount`/moeda server-side e rejeita campos monetarios no body — sem Order, webhook ou iniciação Stripe real.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2
- **Files created:** 3

## Accomplishments

- `evaluatePaymentStartEligibility` / `assertPaymentStartEligible` reutilizam `calculateCheckoutDataComplete`, validam acesso ao cart (guest session / customer), bloqueiam cart concluido e exigem total positivo em centavos BRL.
- `derivePaymentAmountFromCart` usa `cart.total` quando definido; fallback soma line items com ajustes de frete/taxa/desconto.
- `rejectClientMoneyFields` e `normalizePaymentStartRequestBody` rejeitam `amount`, `total`, `subtotal`, `currency`, `currency_code`, `region_currency` e overrides monetarios com mensagem fixa que nao ecoa valores do body.
- 25 testes unitarios verdes cobrindo cart incompleto, sem itens, sem shipping/email, fora de BR/BRL, total invalido, guest sem sessionActiveCartId, cart sem region/countries e anti-tampering monetario.
- Build Medusa OK; greps negativos limpos em `eligibility.ts` e `validators.ts`.

## Task Commits

Nenhum commit foi criado nesta execucao.

## Migration Gate (herdado de 04-02 — inalterado)

```
MIGRATION_STATUS=DRAFT_NOT_APPLIED
MIGRATION_FILE=apps/backend/src/migrations/TBD-payment-attempt.ts
REQUIRES_HUMAN_APPROVAL_BEFORE_db:migrate=true
PAYMENT_SESSION_ID_NULLABLE_BLOCKER=REGISTERED_NOT_RESOLVED
```

04-03 **nao alterou** o model `PaymentAttempt` nem a migration draft. O desalinhamento `payment_session_id` nullable (model vs migration) permanece registrado como blocker de migration em 04-02.

## Verificacoes

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts
# 25 passed

cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-attempt-state.unit.spec.ts \
  src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts \
  src/modules/payment-attempt/__tests__/payment-attempt-active.unit.spec.ts
# 63 passed (inclui 04-01/04-02 suites)

HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully

# Grep positivo (artefatos presentes)
rg -n "amount|currency|currency_code|checkout_data_complete|BRL|brl" \
  apps/backend/src/modules/payment-attempt/eligibility.ts \
  apps/backend/src/api/store/carts/payment-attempts/validators.ts

# Grep negativo (produção — exit 1 = clean)
rg -n "completeCartWorkflow|/store/carts/.*/complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|gelato|order\.gelatoapis\.com" \
  apps/backend/src/modules/payment-attempt/eligibility.ts \
  apps/backend/src/api/store/carts/payment-attempts/validators.ts
```

## Escopo respeitado

| Restricao | Status |
|-----------|--------|
| Sem `medusa db:migrate` / `db:generate` | OK |
| Sem Stripe config / secrets / webhook | OK |
| Sem Order / WebhookEventLog / CheckoutCompletionLog | OK |
| Sem `purchase_completed` / Gelato | OK |
| Sem iniciação real cartão/Pix (rotas 04-04/04-05) | OK |
| Native-first puro bloqueado (04-01) — nao contornado | OK |

## Self-Check: PASSED

- key-files.created exist on disk
- Acceptance criteria re-run: PASS
- Plan verification greps: PASS (producao)
- Migration blocker documentado e nao resolvido (conforme instrucao)

## Deviations from Plan

None — plan executed as written. `rejectClientMoneyFields` implementado em `validators.ts` conforme task 04-03-02.

## Post-Review Correction (2026-06-29)

Correcoes aplicadas apos revisao humana do gate 04-03:

| Finding | Fix |
|---------|-----|
| Guest access permitia `sessionActiveCartId` ausente | `assertCartAccess`: guest exige `sessionActiveCartId` presente e igual a `cart.id`; ausente/vazio/diferente retorna `CART_ACCESS_DENIED` |
| Region gate com fallback `?? "br"` mascarava region ausente | Removido fallback `"br"` em `evaluatePaymentStartEligibility`; region ausente/invalida passa `""` para `calculateCheckoutDataComplete` => `INVALID_REGION` |

Testes adicionados:
- guest sem `sessionActiveCartId` (undefined e vazio)
- cart sem `region` ou sem `region.countries`

Arquivos alterados: `eligibility.ts`, `payment-eligibility.unit.spec.ts`, este summary.

## Manual Review Gate

**PARAR AQUI.** Proximos passos (`04-04`, `04-05`) permanecem bloqueados ate:

1. Revisao humana deste summary e do gate de migration 04-02.
2. Replanejamento da estrategia de provider/camada propria (flags 04-01: `CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true`, `PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true`).

04-03 entrega apenas helpers e validators testados; rotas HTTP de iniciação de pagamento ficam para 04-04/04-05.

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 03*
*Completed: 2026-06-29*
