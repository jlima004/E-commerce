---
phase: 16-cart-merge-review
plan: 10
subsystem: cart-merge
tags: [cart-merge, attach, deprecation, idempotency]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-09 review barrier — HUMAN APPROVED — CLOSED — PASS."
provides:
  - "Deprecated attach facade delegating to executeCartMerge with merge-equivalent serializer."
  - "Session-only / missing contract headers denial with zero side effects before executeCartMerge."
  - "HTTP parity evidence for attach adapter cases A–N plus existing merge/ACK suite."
affects: [phase-16-cart-merge-review, plan-16-11]

actuals:
  tokens: 4150
  tasks: 1
  technical_commits: 1

tech-stack:
  added: []
  patterns:
    - "DEPRECATED FACADE → CANONICAL CART_MERGE: attach route gates on isAttachNewContractPresent, reuses parseCartMerge* validators, executeCartMerge, and merge-equivalent serializer."
    - "Session-only / missing Idempotency-Key / If-Match / capability-without-replay: MedusaError NOT_FOUND before executeCartMerge; zero capability touch, claim, cart/version/review/Order effect."
    - "Committed replay identity: same key/fingerprint via attach or merge yields same CART_MERGE receipt; no parallel cart_attach idempotency namespace."

key-files:
  created: []
  modified:
    - "apps/backend/src/api/store/customers/me/cart/attach/route.ts"
    - "apps/backend/src/modules/checkout/attach-guest-cart.ts"
    - "apps/backend/src/api/store/carts/merge-review-validators.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"

key-decisions:
  - "Attach não mantém motor próprio: rota elegível delega exclusivamente a executeCartMerge e serializer merge-equivalente (Cache-Control no-store, formatCartEtag, outcome/cart/review)."
  - "Native attach permanece DENY; não alterado neste slice."
  - "Rota canônica merge e cart-merge/service.ts não foram modificados."
  - "MRG-01, MRG-02, MRG-05 e MRG-08 têm EVIDENCE COMPLETE FOR PLAN 16-10; reconciliação global permanece pendente."
  - "Plan 16-11, push e deploy permanecem NOT AUTHORIZED; este SUMMARY não auto-autoriza o Plan 16-11."

patterns-established:
  - "Attach como shell deprecated seguro: parity byte-semântica com merge para outcome, cart, review e ETag."
  - "Denial estável NOT_FOUND para contrato legado/sessão antes de qualquer efeito no motor canônico."

coverage:
  - id: D1
    description: "Attach elegível delega a executeCartMerge com parity de status, outcome, cart, review e ETag versus merge canônico."
    requirement: MRG-01
    verification:
      - kind: integration
        ref: "cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts — attach adapter cases A–N; 39/39 PASS"
        status: pass
    human_judgment: false
  - id: D2
    description: "Session-only e ausência de Idempotency-Key / If-Match / capability-replay retornam erro estável NOT_FOUND com zero efeito antes de executeCartMerge."
    requirement: MRG-02
    verification:
      - kind: integration
        ref: "cart-merge-review.spec.ts session-only / missing-contract denial cases — 39/39 PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replay committed bidirecional: mesmo key/fingerprint via attach ou merge usa o mesmo receipt CART_MERGE; sem namespace idempotente paralelo cart_attach."
    requirement: MRG-05
    verification:
      - kind: integration
        ref: "cart-merge-review.spec.ts committed replay both directions — 39/39 PASS"
        status: pass
    human_judgment: false
  - id: D4
    description: "Attach adapter não cria Order; outcomes reutilizados MERGED, MERGED_PARTIAL, GUEST_CART_ATTACHED, NO_ITEMS; CUSTOMER_CART_PRESERVED reservado/não exercitado."
    requirement: MRG-08
    verification:
      - kind: integration
        ref: "cart-merge-review.spec.ts attach adapter suite — 39/39 PASS; zero Order path"
        status: pass
    human_judgment: false
  - id: D5
    description: "Closeout humano do Plan 16-10 após TECHNICAL PASS."
    verification: []
    human_judgment: true
    rationale: "Plan 16-10 human closure permanece PENDING HUMAN REVIEW. Evidência HTTP automatizada não substitui revisão humana do slice nem autoriza Plan 16-11, push ou deploy."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-10 Summary

**Deprecated attach facade delegates to canonical `executeCartMerge` with merge-equivalent serializer, stable session-only denial, and committed replay identity — no parallel attach engine.**

## Status

- **Plan 16-10 execution:** **TECHNICAL PASS**
- **Plan 16-10 human closure:** **PENDING HUMAN REVIEW**
- **Task 16-10-01:** **PASS**
- **Plan 16-09:** **HUMAN APPROVED — CLOSED — PASS** (não reaberto)
- **MRG-01:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-02:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-05:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-08:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-01..MRG-08:** **OPEN / GLOBAL RECONCILIATION PENDING**
- **Phase 16:** **IN PROGRESS**
- **Plan 16-11:** **NOT AUTHORIZED**
- **Push:** **NOT AUTHORIZED**
- **Deploy:** **NOT AUTHORIZED**
- **STATE, ROADMAP e counters:** **NOT UPDATED**
- **SUMMARY creation does NOT auto-authorize Plan 16-11.**

Este documento registra **Plan 16-10: TECHNICAL PASS**. Não registra Plan 16-10 CLOSED.

## Objective / outcome

Converter `POST /store/customers/me/cart/attach` em adaptador deprecated controlado do motor único de cart merge. Quando o contrato novo está presente, a rota reutiliza os mesmos validators, authority, operation `CART_MERGE`, `executeCartMerge` e serializer da rota canônica. Session-only e contratos legados/incompletos retornam `MedusaError` `NOT_FOUND` ("Not Found") **antes** de `executeCartMerge`, sem touch de capability, claim, cart/version/review ou Order. Native attach permanece DENY. Exact-set, native denial inventory, eight-sink leakage e reconciliação global de superfície ficam no slice serial Plan 16-11.

## Tasks completed

- **Task 16-10-01: Substituir attach por delegação semântica única** — **PASS.** Rota attach reduzida a facade deprecated; parity HTTP cases A–N; session-only denial estável; committed replay bidirecional com mesmo receipt `CART_MERGE`.

## Runtime changes consolidated

Baseline start HEAD: `61995b927907dd5bcc1c166d5d14823c90611782` — `docs(cart-merge): close plan 16-09 review barrier`.

Technical commit (único, após validator independente PASS):

- `489376ff7af63bcb71a34ce60ad5b41df107dabd` (`489376f`) — `feat(cart-merge): delegate deprecated attach to canonical merge`
- 4 files changed, 1061 insertions(+), 240 deletions(-)
- Worktree após commit técnico: **CLEAN**
- Branch: `gsd/phase-16-cart-merge-review`

Modificado (allowlist exata do commit):

- `apps/backend/src/api/store/customers/me/cart/attach/route.ts` — facade deprecated; gate `isAttachNewContractPresent`; delegação a `parseCartMerge*` + `executeCartMerge` + serializer merge-equivalente
- `apps/backend/src/api/store/carts/merge-review-validators.ts` — validators compartilhados expostos/reutilizados pelo attach adapter
- `apps/backend/src/modules/checkout/attach-guest-cart.ts` — residual de tipos/deprecation mapping para spec unitário fora da allowlist de produção
- `apps/backend/integration-tests/http/cart-merge-review.spec.ts` — 14 attach adapter cases A–N acrescentados à suíte existente

**Não modificados neste slice:**

- Rota canônica merge
- `apps/backend/src/modules/cart-merge/service.ts`
- Native attach DENY path (inalterado)

## Architecture

```
DEPRECATED FACADE → CANONICAL CART_MERGE
```

Fluxo elegível:

1. `isAttachNewContractPresent` gate
2. `parseCartMerge*` validators (body `{guestCartId}`, headers obrigatórios, dual authority)
3. `executeCartMerge` (mesmo service/operation da rota canônica)
4. Serializer merge-equivalente: `Cache-Control: no-store`, `formatCartEtag`, `outcome` / `cart` / `review`

Fluxo negado (session-only / missing Idempotency-Key / If-Match / capability-without-replay):

- `MedusaError` `NOT_FOUND` ("Not Found") **antes** de `executeCartMerge`
- Zero side effects: sem capability touch, idempotency claim, cart/version/review mutation ou Order

Outcomes reutilizados com parity comprovada: `MERGED`, `MERGED_PARTIAL`, `GUEST_CART_ATTACHED`, `NO_ITEMS`. `CUSTOMER_CART_PRESERVED` permanece reservado/não exercitado como fixture.

Explicitamente **não** reintroduzidos como autoridade de execução:

- `session.active_cart_id` authority
- timestamp winner selection
- transfer / update / supersede diretos na rota attach
- legacy outcome mapping executável
- Order path
- provider network
- instalação de pacotes

## Helper residual (deviation note)

`attach-guest-cart.ts` conserva tipos/funções legadas de decisão **somente** para o spec unitário fora da allowlist de produção. A rota `attach/route.ts` de produção **não** importa esse motor. O engine legado **não** é executável a partir da rota attach. Isso é desvio factual documentado, não motor attach residual em runtime.

## Verification matrix

Focused HTTP (wave 6 oficial; não rerun para este SUMMARY):

- **Command:** `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts`
- **Test Suites:** 1 passed, 1 total
- **Tests:** 39 passed, 39 total
- **Failed:** 0
- **Skipped:** 0
- **Exit:** 0
- **Time:** 3.542 s
- **Composição:** 25 testes originais merge/ACK + 14 attach adapter cases A–N = 39

## Security / threat model invariants

Invariantes do threat model do PLAN 16-10, reafirmados como contrato (sem scan eight-sink — Plan 16-11):

- **T-16-10-01:** session-only attach não reintroduz posse por sessão; denial zero-effect antes do motor.
- **T-16-10-02:** um único operation/service `CART_MERGE`; sem second attach engine executável.
- **T-16-10-03:** serializer compartilhado e erro estável de depreciação; prova de leakage em sinks segue no 16-11.
- **T-16-10-SC:** nenhuma instalação de pacote ocorreu.

## Requirements

- **MRG-01:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-02:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-05:** **EVIDENCE COMPLETE FOR PLAN 16-10**
- **MRG-08:** **EVIDENCE COMPLETE FOR PLAN 16-10**

`requirements-completed` permanece `[]`. MRG-01/02/05/08 **não** estão fechados globalmente. MRG-01..MRG-08 permanecem **OPEN / GLOBAL RECONCILIATION PENDING**. A reconciliação global da Phase 16 é posterior.

## Deviations from Plan

1. **Helper residual em `attach-guest-cart.ts`:** tipos/funções legadas mantidos para spec unitário fora da allowlist; produção não importa; motor não executável pela rota attach. Não é falha da entrega — é nota factual de residual de teste.
2. **Exact-set / native denial inventory / eight-sink leakage:** explicitamente fora de escopo deste plano; serializados no Plan 16-11 conforme PLAN.

Nenhum outro desvio material. Plano executado conforme escopo autorizado.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Attach deprecated facade com parity merge comprovada em HTTP; session-only denial estável; replay/receipt identity bidirecional.
- Plan 16-11 (surface exact-set, native denial inventory, leakage) **não autorizado** até closeout humano do Plan 16-10.
- Push e deploy **não autorizados**.

## Remaining gates

- Plan 16-10 execution: **TECHNICAL PASS**
- Plan 16-10 human closure: **PENDING HUMAN REVIEW**
- Phase 16: **IN PROGRESS**
- Plan 16-11: **NOT AUTHORIZED**
- Push: **NOT AUTHORIZED**
- Deploy: **NOT AUTHORIZED**

Next permitted action: **HUMAN REVIEW OF PLAN 16-10**

Do not auto-authorize Plan 16-11.

---
*Phase: 16-cart-merge-review*
*Plan: 16-10*
*Technical execution: PASS; human closeout pending*
