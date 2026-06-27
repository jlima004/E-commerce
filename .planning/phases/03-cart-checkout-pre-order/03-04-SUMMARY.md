---
phase: 03-cart-checkout-pre-order
plan: 04
subsystem: api
tags: [medusa, checkout, cart, serializer, derived-state, brazil, brl]

requires:
  - phase: 03-cart-checkout-pre-order
    provides: active cart contract, guest attach, and Brasil checkout data helpers from 03-01/03-02/03-03
provides:
  - calculateCheckoutDataComplete como funcao pura com razoes seguras de incompletude
  - serializeStoreCartPreOrder / withCheckoutDataComplete com checkout_data_complete derivado
  - query-config e middleware Store API para cart pre-Order
  - testes unitarios ampliados para D-23..D-33
affects: [03-05 negative-proofs, future storefront cart consumer]

tech-stack:
  added: []
  patterns:
    - completude derivada recalculada por resposta via serializer/middleware, nunca persistida
    - reutilizacao de isSellableVariant da Phase 02 para gate de line items
    - PII-safe shipping address com masked_federal_tax_id na resposta publica

key-files:
  created:
    - apps/backend/src/api/store/carts/serializers.ts
    - apps/backend/src/api/store/carts/query-config.ts
  modified:
    - apps/backend/src/modules/checkout/checkout-data.ts
    - apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts
    - apps/backend/src/api/middlewares.ts
    - apps/backend/src/api/store/carts/active/route.ts
    - apps/backend/src/api/store/customers/me/cart/attach/route.ts

key-decisions:
  - "checkout_data_complete retorna { checkout_data_complete, incomplete_reasons } — razoes sao codigos deterministicos sem PII, nunca persistidos."
  - "Resposta publica expoe masked_federal_tax_id no shipping_address; federal_tax_id cru permanece apenas em metadata server-side e nunca e serializado."
  - "Query config ampliada com items.variant.* e shipping_address.metadata usando campos Medusa existentes — nenhum schema/migration novo."

patterns-established:
  - "Derived checkout readiness: calculateCheckoutDataComplete + serializer/middleware, sem status nominal no cart"
  - "Cart pre-Order response shaping: omissao de payment/order fields, mascara de documento fiscal, injecao de checkout_data_complete"

requirements-completed: [CART-01, CART-02, CART-03, CART-04]

duration: 28 min
completed: 2026-06-27
status: complete
---

# Phase 03 Plan 04: Derived checkout_data_complete Summary

**Campo calculado `checkout_data_complete` no contrato HTTP de cart, recalculado a cada resposta a partir de itens vendaveis, email, endereco BR e contexto BRL — sem persistencia nem prontidao de pagamento**

## Performance

- **Duration:** 28 min
- **Started:** 2026-06-27T21:10:00Z
- **Completed:** 2026-06-27T21:38:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Ampliado `calculateCheckoutDataComplete` para validar line items (quantidade positiva, variante vendavel via `isSellableVariant`), email, endereco Brasil, `country_code=BR` e contexto BRL/regiao, retornando boolean + `incomplete_reasons` seguros.
- Criados `serializers.ts` e `query-config.ts` para cart pre-Order: injetam `checkout_data_complete` derivado, omitem campos proibidos e expoem `masked_federal_tax_id` em vez de documento cru.
- Registrados middlewares em `/store/carts/active` e `/store/customers/me/cart/attach`; rotas passam a usar field selection compartilhada e delegam shaping de resposta ao middleware.
- Matriz unitaria ampliada cobrindo D-23..D-33, recalculo pos-mutacao e ausencia de export `ready_for_payment`.

## Task Commits

Nenhum commit foi criado nesta execucao (conforme instrucao do usuario).

## Files Created/Modified

- `apps/backend/src/modules/checkout/checkout-data.ts` — calculador derivado com tipos de snapshot, razoes de incompletude e reutilizacao de `isSellableVariant`.
- `apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts` — 12 testes em `checkout_data_complete` cobrindo matriz de completude e anti-export de prontidao Phase 04.
- `apps/backend/src/api/store/carts/serializers.ts` — `serializeStoreCartPreOrder`, `withCheckoutDataComplete`, middleware de resposta e mascara PII.
- `apps/backend/src/api/store/carts/query-config.ts` — field selection minima incluindo variant metadata/prices e shipping metadata.
- `apps/backend/src/api/middlewares.ts` — wiring query-config + response middleware nas rotas de cart.
- `apps/backend/src/api/store/carts/active/route.ts` — usa query fields compartilhados; resposta raw delegada ao middleware.
- `apps/backend/src/api/store/customers/me/cart/attach/route.ts` — idem active route.

## Decisions Made

- `checkout_data_complete` e calculado exclusivamente em memoria no serializer/middleware; nenhum update de cart, metadata ou coluna persiste prontidao.
- Documento fiscal na resposta publica usa `masked_federal_tax_id`; metadata interna com valor normalizado nao e exposta na API Store.
- Variante vendavel reutiliza fronteira Phase 02 (`isSellableVariant`) somente quando dados de variante estao presentes no snapshot — sem duplicar parser Gelato.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Build TypeScript inicial falhou em `serializeCartResponseBody` por incompatibilidade de tipos entre record interno e shape publico; corrigido com tipos `SerializedCartResponseBody` e guard contra double-serialization.

## User Setup Required

None - nenhum secret, config var, migration ou deploy foi necessario.

## Verification

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts -t "checkout_data_complete"
# 12 passed

cd apps/backend && ! rg -n "ready_for_payment|completeCartWorkflow|sdk\.store\.cart\.complete|PaymentAttempt|PaymentSession|payment_intent|order\.gelatoapis\.com|gelato_order_id|/hooks" src/modules/checkout src/api/store/carts src/api/middlewares.ts
# exit 0 (clean)

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# Backend build completed successfully
```

## Next Phase Readiness

- 03-05 pode consumir serializer/middleware existentes para provas negativas HTTP e grep ampliado.
- Storefront futura pode ler `checkout_data_complete` como sinal derivado pre-Order; pagamento/Order permanecem fora de escopo.

---
*Phase: 03-cart-checkout-pre-order*
*Completed: 2026-06-27*
