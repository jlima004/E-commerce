---
phase: 03-cart-checkout-pre-order
plan: 02
subsystem: api
tags: [medusa, cart, checkout, attach, auth, session, store-api, testing]
requires:
  - phase: 03-cart-checkout-pre-order
    provides: active-cart contract and session-backed guest cart anchor from 03-01
provides:
  - helper puro de attach seguro do guest cart
  - testes unitarios cobrindo transferencia, preservacao e rejeicao saneada
  - rota autenticada /store/customers/me/cart/attach sem payment/order
affects: [03-05 negative-proofs, storefront-login-cart-attach]
tech-stack:
  added: []
  patterns:
    - prova de posse do guest cart por req.session.active_cart_id ja existente
    - attach deterministico sem merge complexo de linhas
    - normalizacao final de email para customer.email
key-files:
  created:
    - apps/backend/src/modules/checkout/attach-guest-cart.ts
    - apps/backend/src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts
    - apps/backend/src/api/store/customers/me/cart/attach/route.ts
  modified:
    - apps/backend/src/api/middlewares.ts
key-decisions:
  - "A prova server-side do guest cart continuou ancorada em `req.session.active_cart_id`; nenhum secret ou config var novo foi necessario."
  - "O cart ativo anterior do customer passa a ser marcado como superseded via metadata existente do core cart, sem model novo, schema novo ou migration."
  - "A rota de attach exige autenticacao customer e nao aceita `customer_id` do body como fonte de verdade; `cart_id` do body, quando presente, so vale se coincidir com a sessao atual."
patterns-established:
  - "Attach pre-Order: decide entre transferir, preservar cart util ou rejeitar attach nao autorizado com resposta saneada."
  - "Normalizacao de identidade: customer autenticado sempre dita o email final do cart anexado."
requirements-completed: [CART-01, CART-02, CART-04]
duration: 19 min
completed: 2026-06-27
status: complete
---

# Phase 03 Plan 02: Secure Guest Cart Attach Summary

**Attach seguro do guest cart da sessao atual no login, preservando cart util do customer e mantendo a fase estritamente pre-Order**

## Performance

- **Duration:** 19 min
- **Started:** 2026-06-27T20:34:00Z
- **Completed:** 2026-06-27T20:53:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Helper puro `attach-guest-cart.ts` passou a resolver o guest cart autorizado da sessao atual, decidir entre `transfer`, `preserve_customer_cart` e `reject_unauthorized_guest_cart`, e carregar a normalizacao final de email para `customer.email`.
- Testes unitarios `attach-guest-cart.unit.spec.ts` cobriram D-02, D-04, D-05, D-06, D-08 e D-09, incluindo rejeicao de `cart_id` body-only, preservacao do cart util e attach sem merge complexo.
- Rota autenticada `POST /store/customers/me/cart/attach` foi adicionada sem payment/order: autentica customer, lê apenas o guest cart da sessao atual, transfere ownership com workflow Medusa, normaliza email do cart anexado e marca o cart antigo como superseded via metadata existente.

## Task Commits

Nenhum commit foi criado nesta execucao. O plano foi interrompido no gate manual solicitado pelo usuario apos gerar este summary, sem seguir para closeout Git/STATE/ROADMAP.

## Files Created/Modified

- `apps/backend/src/modules/checkout/attach-guest-cart.ts` - helper puro de decisao do attach seguro.
- `apps/backend/src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts` - cobertura unitária para transferencia, preservacao e rejeicao saneada.
- `apps/backend/src/api/store/customers/me/cart/attach/route.ts` - rota Store API autenticada para attach pos-login.
- `apps/backend/src/api/middlewares.ts` - wiring da autenticacao customer para `/store/customers/me/cart/attach`.

## Decisions Made

- O contrato existente de sessao guest (`req.session.active_cart_id`) foi suficiente como prova server-side; nenhum secret/config var novo foi exigido, entao o gate manual por config nova nao foi disparado.
- A representacao de cart antigo nao ativo continuou usando somente metadata do core cart por `markCartSupersededInput`; nenhum schema/model/migration novo foi exigido, entao o gate manual por persistencia nova nao foi disparado.
- A rota nao confia em `customer_id` do body e trata `cart_id` apenas como dica opcional que precisa coincidir com a sessao atual; se nao coincidir, responde com erro saneado sem revelar IDs de terceiros.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts`
- `cd apps/backend && ! rg -n "completeCartWorkflow|sdk\\.store\\.cart\\.complete|PaymentAttempt|PaymentSession|payment_intent|order\\.gelatoapis\\.com|gelato_order_id|/hooks" src/modules/checkout src/api/store/customers`
- `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build`

## Issues Encountered

None

## User Setup Required

None - nenhum secret, config var, migration ou deploy foi necessario.

## Next Phase Readiness

- `03-02` terminou com a suite unitária alvo verde, grep negativo limpo e `medusa build` verde.
- Nenhuma migration, deploy, install, webhook, Stripe/Pix, Gelato, `PaymentAttempt`, `PaymentSession`, `completeCartWorkflow`, `/store/carts/:id/complete` ou `ready_for_payment` foi introduzido.
- O attach seguro ficou limitado ao guest cart provado por sessao server-side existente e normaliza o email final para `customer.email`.
- Execucao para aqui no gate manual solicitado. `03-03` **nao** foi iniciado.
- `STATE.md`, `ROADMAP.md` e `REQUIREMENTS.md` **nao** foram alterados nesta execucao por pedido explicito de parar no `03-02-SUMMARY.md`.

---
*Phase: 03-cart-checkout-pre-order*
*Completed: 2026-06-27*
