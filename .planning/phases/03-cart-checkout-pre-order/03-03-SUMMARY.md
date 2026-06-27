---
phase: 03-cart-checkout-pre-order
plan: 03
subsystem: api
tags: [medusa, checkout, validation, brazil, pii, testing]
requires:
  - phase: 03-cart-checkout-pre-order
    provides: active cart pre-order boundary and secure attach flow from 03-01/03-02
provides:
  - helper puro de normalizacao/validacao para email e shipping address Brasil
  - validacao estrutural de CPF/CNPJ com digitos verificadores e mascaramento PII
  - testes unitarios do contrato CART-03 sem side effects de pagamento/order
affects: [03-04 checkout_data_complete wiring, 03-05 negative-proofs]
tech-stack:
  added: []
  patterns:
    - normalizacao deterministica para email, CEP, UF e documento fiscal sem integracao externa
    - persistencia minima de PII em shipping_address.metadata com resposta/erros mascarados
key-files:
  created:
    - apps/backend/src/modules/checkout/checkout-data.ts
    - apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts
  modified: []
key-decisions:
  - "Gate de persistencia confirmado sem schema novo: `federal_tax_id` pode ficar em `shipping_address.metadata.federal_tax_id` porque os tipos Medusa de cart/address aceitam `metadata` no shipping address update DTO."
  - "A opcao `additional_data.federal_tax_id` nao foi adotada neste plano: o contrato tipado de update cart ja suporta shipping_address metadata e permite menor exposicao local ao endereco, sem migration/config nova."
  - "Erros de validacao ficam saneados por codigo/campo com documento mascarado; CPF/CNPJ cru nunca entra em mensagem de erro."
patterns-established:
  - "Checkout data helper pattern: funcoes puras para normalizar e validar dados BR sem chamada externa"
  - "PII-first validation pattern: documento fiscal cru restrito ao metadata server-side e saida publica mascarada"
requirements-completed: [CART-03, CART-04]
duration: 24 min
completed: 2026-06-27
status: complete
---

# Phase 03 Plan 03: Checkout Data Validation Summary

**Helper puro de checkout para email/endereco Brasil com CPF/CNPJ validado e PII saneada, mantendo a fase estritamente pre-Order**

## Performance

- **Duration:** 24 min
- **Started:** 2026-06-27T20:36:00Z
- **Completed:** 2026-06-27T20:59:57Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Criado `checkout-data.ts` com normalizadores/exports do plano: email guest vs `customer.email`, CEP, UF, CPF/CNPJ (com digitos verificadores), mascara de documento e calculo derivado de `checkout_data_complete`.
- Criado `checkout-data.unit.spec.ts` cobrindo D-08, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21 e D-22, incluindo erros PII-safe sem documento completo em mensagens.
- Confirmado gate obrigatorio de persistencia com menor exposicao: `federal_tax_id` ficou em `shipping_address.metadata.federal_tax_id` (sem schema/model/migration/config/secrets novos), com resposta mascarada por `maskedFederalTaxId`.

## Task Commits

Nenhum commit foi criado nesta execucao. O plano foi encerrado no gate manual solicitado pelo usuario apos gerar este summary, sem seguir para closeout Git/STATE/ROADMAP.

## Files Created/Modified

- `apps/backend/src/modules/checkout/checkout-data.ts` - helper puro de normalizacao, validacao estrutural e contrato PII-safe para checkout Brasil.
- `apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts` - matriz unitária de email/endereco/documento/completude derivada com foco em erros saneados.

## Decisions Made

- A persistencia de `federal_tax_id` foi confirmada em `shipping_address.metadata.federal_tax_id` porque os tipos Medusa em `@medusajs/types/dist/cart` aceitam `shipping_address?: CreateAddressDTO | UpdateAddressDTO` e `metadata?: Record<string, unknown> | null` no address/cart update, dispensando schema novo.
- Nao foi necessario adotar `additional_data.federal_tax_id` neste recorte, pois o alvo no metadata do shipping address e mais restrito ao dado de entrega e reduz dispersao de PII.
- Mensagens de erro usam codigos/campos saneados (`CHECKOUT_*`) e, quando necessario, apenas `masked_federal_tax_id`; nenhum CPF/CNPJ cru e serializado.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - nenhum secret, config var, migration ou deploy foi necessario.

## Next Phase Readiness

- `03-03` terminou com testes unitarios alvo verdes e grep negativo de proibicoes limpo.
- Nenhuma migration, schema/model novo, install, deploy ou alteracao de secret/config foi introduzido.
- Nenhum Order, PaymentAttempt, PaymentSession, webhook, Stripe/Pix, Gelato, `completeCartWorkflow`, `/store/carts/:id/complete` ou `ready_for_payment` foi adicionado.
- Gate manual solicitado foi respeitado com este `03-03-SUMMARY.md`; `03-04` nao foi iniciado.
- `STATE.md`, `ROADMAP.md` e `REQUIREMENTS.md` nao foram alterados nesta execucao por pedido explicito de parar no gate manual.

---
*Phase: 03-cart-checkout-pre-order*
*Completed: 2026-06-27*
