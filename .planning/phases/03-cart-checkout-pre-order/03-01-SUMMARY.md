---
phase: 03-cart-checkout-pre-order
plan: 01
subsystem: api
tags: [medusa, cart, checkout, session, store-api, testing]
requires:
  - phase: 02-catalog-media
    provides: sellable-variant boundary reused by active cart helper
provides:
  - helper puro de cart ativo guest/customer
  - testes unitarios do contrato pre-Order de cart ativo
  - rota Store API minima /store/carts/active com auth opcional e sessao guest existente
affects: [03-02 attach-guest-cart, 03-05 negative-proofs, storefront-cart-contract]
tech-stack:
  added: []
  patterns:
    - helper puro de cart ativo reaproveitando isSellableVariant
    - guest cart atual ancorado em req.session existente, sem nova config
    - resposta Store API enxuta sem campos de payment/order
key-files:
  created:
    - apps/backend/src/modules/checkout/active-cart.ts
    - apps/backend/src/modules/checkout/__tests__/active-cart.unit.spec.ts
    - apps/backend/src/api/store/carts/active/route.ts
  modified:
    - apps/backend/src/api/middlewares.ts
key-decisions:
  - "Cart antigo nao ativo cabe em metadata nativa do core cart (`active_for_checkout=false` + `superseded_by_cart_id`), sem model novo e sem migration."
  - "Guest cart atual usa `req.session.active_cart_id` sobre o cookie/session já existentes do projeto; nenhum secret ou config var novo foi necessario."
  - "A rota `/store/carts/active` responde com shape pre-Order explicitamente serializado, omitindo payment collection, sessions e qualquer campo de Order."
patterns-established:
  - "Cart ativo pre-Order: identidade customer vem de `auth_context`; guest vem da sessao server-side."
  - "Negative proof local: helper e rota nao importam completion, webhook, Stripe/Pix nem fulfillment."
requirements-completed: [CART-01, CART-02, CART-04]
duration: 13 min
completed: 2026-06-27
status: complete
---

# Phase 03 Plan 01: Active Cart Guest/Customer Summary

**Contrato inicial de cart ativo pre-Order com helper puro, testes unitarios e rota Store API minima usando sessao guest existente**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-27T20:20:00Z
- **Completed:** 2026-06-27T20:33:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Helper puro `active-cart.ts` entrega derivacao de identidade guest/customer, verificacao de cart utilizavel, marcacao de cart superseded por metadata existente e guarda pre-Order.
- Testes unitarios `active-cart.unit.spec.ts` provaram CART-01/CART-02/CART-04, incluindo guest sem email, customer sem body spoofing, cart superseded e reutilizacao da fronteira `isSellableVariant`.
- Rota `GET/POST /store/carts/active` foi adicionada com auth opcional para customer, sessao guest server-side ja existente e resposta enxuta sem campos de payment/order.

## Task Commits

Nenhum commit foi criado nesta execucao. O plano foi interrompido no gate manual solicitado pelo usuario apos gerar este summary, sem seguir para closeout Git/STATE/ROADMAP.

## Files Created/Modified

- `apps/backend/src/modules/checkout/active-cart.ts` - helper puro do contrato de cart ativo pre-Order.
- `apps/backend/src/modules/checkout/__tests__/active-cart.unit.spec.ts` - cobertura unitária de guest/customer/superseded/pre-Order.
- `apps/backend/src/api/store/carts/active/route.ts` - rota Store API minima para recuperar/criar cart ativo.
- `apps/backend/src/api/middlewares.ts` - wiring da autenticacao opcional para `/store/carts/active`.

## Decisions Made

- Metadata nativa do cart foi confirmada como suficiente para representar cart antigo nao ativo; nenhuma migration/model novo foi necessario.
- `COOKIE_SECRET`/sessao ja existentes no app sao suficientes para guardar `active_cart_id` do guest; nenhum secret/config var novo foi introduzido.
- A rota foi mantida pequena e serializa apenas o shape pre-Order necessario, evitando expor `payment_collection`, `payment_sessions`, `order_id` ou completion paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Build quebrou com import interno e tipos estreitos da rota**
- **Found during:** Task 03-01-03 (Expor rota de cart ativo pre-Order)
- **Issue:** O primeiro rascunho da rota importava um helper interno do build do Medusa e usava tipos de item/cart estreitos demais para compilar no `medusa build`.
- **Fix:** O refetch do cart foi internalizado via `remoteQueryObjectFromString`, `auth_context` foi tipado localmente, e o shape de `CheckoutCartLike`/items foi ampliado apenas para o contrato pre-Order.
- **Files modified:** `apps/backend/src/api/store/carts/active/route.ts`, `apps/backend/src/modules/checkout/active-cart.ts`
- **Verification:** `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build`
- **Committed in:** none

**2. [Rule 3 - Blocking] Verificacao estatica do plano referenciava diretorio ainda inexistente**
- **Found during:** Task 03-01-03 (Expor rota de cart ativo pre-Order)
- **Issue:** O comando literal do plano incluia `src/api/store/customers`, mas essa arvore ainda nao existe no repo; o `rg` falhava por path ausente antes de avaliar o grep negativo.
- **Fix:** Foi executado o equivalente seguro apenas nas arvores existentes (`src/modules/checkout` e `src/api/store/carts`) para validar a ausencia de completion/payment/webhook/fulfillment.
- **Files modified:** none
- **Verification:** grep negativo equivalente retornou limpo
- **Committed in:** none

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Ambos os ajustes preservaram o escopo do plano, sem schema novo, sem config nova e sem introduzir fluxo financeiro ou de Order.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `03-01` terminou com as verificacoes locais pedidas: teste unitario verde, grep negativo limpo nas arvores existentes e `medusa build` verde.
- Nenhuma migration, deploy, install, webhook, Stripe/Pix, Gelato, `PaymentAttempt`, `PaymentSession`, `completeCartWorkflow` ou `ready_for_payment` foi introduzido.
- Execucao para aqui no gate manual solicitado. `03-02` **nao** foi iniciado.
- `STATE.md`, `ROADMAP.md` e `REQUIREMENTS.md` **nao** foram alterados nesta execucao por pedido explicito de parar no `03-01-SUMMARY.md`.

---
*Phase: 03-cart-checkout-pre-order*
*Completed: 2026-06-27*
