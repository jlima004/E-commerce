---
phase: 16-cart-merge-review
plan: 09
subsystem: cart-merge
tags: [cart-merge, review, postgres, payment, concurrency]

requires:
  - phase: 16-cart-merge-review
    provides: "ACK versionado e idempotente do Plan 16-08, com pending review como estado público fechado."
provides:
  - "Guard transacional compartilhado assertNoPendingCartReview como barreira backend de pending review."
  - "Bloqueio 409 REVIEW_REQUIRED de add/update/delete/clear, novo merge e início de pagamento Card/Pix durante pending."
  - "Evidência HTTP/PostgreSQL isolada de ACK races, autoridade de pagamento e zero Order."
affects: [phase-16-cart-merge-review, plan-16-10]

actuals:
  tasks: 2
  technical_commits: 11

tech-stack:
  added: []
  patterns:
    - "assertNoPendingCartReview(cartId, sharedContext) lê pending na mesma transação e falha 409 REVIEW_REQUIRED antes de qualquer efeito."
    - "Início Card/Pix amarra lock, reread e snapshot de elegibilidade à transação do cart; pending produz providerCalls=0 e Order=0."
    - "Evidência PostgreSQL normativa deste plano é isolated-execution; combined-suite harness/process contamination confirmed, exact mechanism unproven."

key-files:
  created:
    - "apps/backend/src/modules/cart-merge/review-guard.ts"
  modified:
    - "apps/backend/src/modules/cart-merge/__tests__/review-guard.unit.spec.ts"
    - "apps/backend/src/api/store/carts/line-item-mutation.ts"
    - "apps/backend/src/modules/cart-merge/service.ts"
    - "apps/backend/src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/http/cart-checkout-store.spec.ts"
    - "apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"
    - "apps/backend/integration-tests/helpers/cart-merge-postgres.ts"
    - "apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts"
    - "apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts"

key-decisions:
  - "Pending review bloqueia add, update, delete, clear, novo merge e payment start Card/Pix depois de locks/ownership e antes de claim, workflow, CAS/bump, invalidation, capability consume, provider, PaymentAttempt e Order."
  - "Somente ACK válido limpa pending; mutações posteriores não reativam review antigo."
  - "B16-09-HR-07 Card e Pix compartilham autoridade transacional no cart, sem equivalência arquitetural plena entre os dois fluxos."
  - "eligibility.ts do módulo payment-attempt não foi alterado no intervalo 16-09; a remediação de pagamento ocorreu nas rotas Card/Pix."
  - "Combined invocation A1: combined-suite harness/process contamination confirmed; exact mechanism unproven. PostgreSQL normativo: PASS BY HUMAN-APPROVED ISOLATED EXECUTION."
  - "MRG-06 e MRG-07 têm EVIDENCE COMPLETE FOR PLAN 16-09; MRG-01..MRG-08 permanecem OPEN / GLOBAL RECONCILIATION PENDING."
  - "Plan 16-10, push e deploy permanecem NOT AUTHORIZED; este SUMMARY não auto-autoriza o Plan 16-10."

patterns-established:
  - "Guard compartilhado transacional; 409 sanitizado sem reviewRef/IDs internos; mutação não limpa pending."
  - "Prova PostgreSQL deste plano aceita isolated disposable process como equivalente humano da invocação combinada original."

coverage:
  - id: D1
    description: "Pending review bloqueia mutação estrutural, novo merge e início de pagamento Card/Pix sem efeitos."
    requirement: MRG-07
    verification:
      - kind: unit
        ref: "apps/backend/src/modules/cart-merge/__tests__/review-guard.unit.spec.ts + apps/backend/src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts — 2/2 suites, 37/37 PASS"
        status: pass
      - kind: integration
        ref: "apps/backend/integration-tests/http/cart-merge-review.spec.ts + cart-checkout-store.spec.ts — 2/2 suites, 75/75 PASS"
        status: pass
      - kind: integration
        ref: "cart-merge-review.postgres.spec.ts isolado — 33/33 PASS; guest-cart-order-invariants.postgres.spec.ts isolado — 18/18 PASS; total 51/51 PASS isolated"
        status: pass
    human_judgment: false
  - id: D2
    description: "ACK races serializam; somente ACK válido limpa pending; zero Order nos blockers e no ciclo de review."
    requirement: MRG-06
    verification:
      - kind: integration
        ref: "HTTP ACK-vs-line-item / ACK-vs-merge / ACK-vs-payment + PostgreSQL isolado 51/51 PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "Closeout humano do Plan 16-09 e disposição A1 da invocação PostgreSQL combinada."
    verification: []
    human_judgment: true
    rationale: "Plan 16-09 human closure permanece PENDING HUMAN REVIEW. A invocação combinada original falha no bootstrap da segunda suite; combined-suite harness/process contamination confirmed e exact mechanism unproven. A evidência normativa isolada já foi human-approved, mas não substitui o closeout humano do plano."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-09 Summary

**TECHNICAL PASS — HUMAN CLOSEOUT PENDING.** Review pendente virou barreira backend transacional para mutação, merge e início de pagamento, com evidência isolada PostgreSQL de races e zero Order.

## Status

- **Plan 16-09 execution:** **TECHNICAL PASS**
- **Plan 16-09 human closure:** **PENDING HUMAN REVIEW**
- **Task 16-09-01:** **PASS**
- **Task 16-09-02:** **PASS**
- **B16-09-HR-03..HR-08:** **HUMAN APPROVED — CLOSED — PASS**
- **MRG-06:** **EVIDENCE COMPLETE FOR PLAN 16-09**
- **MRG-07:** **EVIDENCE COMPLETE FOR PLAN 16-09**
- **MRG-01..MRG-08:** **OPEN / GLOBAL RECONCILIATION PENDING**
- **Phase 16:** **IN PROGRESS**
- **Plan 16-10:** **NOT AUTHORIZED**
- **Push:** **NOT AUTHORIZED**
- **Deploy:** **NOT AUTHORIZED**
- **STATE, ROADMAP e counters:** **NOT UPDATED**
- **SUMMARY creation does NOT auto-authorize Plan 16-10.**

Este documento registra **Plan 16-09: TECHNICAL PASS**. Não registra Plan 16-09 CLOSED.

## Objective / outcome

Tornar `requiresReview=true` uma barreira backend autoritativa, não apenas um campo de resposta. Enquanto pending existir, add/update/delete/clear, novo merge e payment start Card/Pix falham `409 REVIEW_REQUIRED` com zero efeito. O bloqueio ocorre depois de locks/ownership e antes de idempotency claim, workflow, CAS/version bump, invalidation, capability consume, provider, persistência de PaymentAttempt e Order. Somente ACK válido limpa pending; mutações posteriores não reativam review antigo. Partial merge, blockers, ACK/no-op/replay/stale/conflict e races preservam zero Order real.

## Tasks completed

- **Task 16-09-01: Bloquear mutation, merge e checkout durante pending** — **PASS.** Guard compartilhado `assertNoPendingCartReview`; integração em line-item mutation, `executeCartMerge` e início de pagamento Card/Pix.
- **Task 16-09-02: Provar ACK races e Order authority em HTTP/PostgreSQL** — **PASS** na evidência isolada human-authorized. ACK-vs-line-item, ACK-vs-merge e ACK-vs-payment serializam; zero Order preservado.

## Runtime changes consolidated

Plan 16-09 technical history reviewed from `8513fb444d3a10eaca4debecf08de96c0ebba603` through `55d381bc7e55489045db22848b424a9e9658eccb` inclusive.

Criado:

- `apps/backend/src/modules/cart-merge/review-guard.ts`

Modificado:

- `apps/backend/src/modules/cart-merge/__tests__/review-guard.unit.spec.ts`
- `apps/backend/src/api/store/carts/line-item-mutation.ts`
- `apps/backend/src/modules/cart-merge/service.ts`
- `apps/backend/src/modules/payment-attempt/__tests__/payment-eligibility.unit.spec.ts`
- `apps/backend/integration-tests/http/cart-merge-review.spec.ts`
- `apps/backend/integration-tests/http/cart-checkout-store.spec.ts`
- `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts`
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts`
- `apps/backend/integration-tests/helpers/cart-merge-postgres.ts` (expansão humana da allowlist original do PLAN; não estava na lista documental do PLAN; não é erro de path do PLAN)
- `apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts` (HR-08, HR-07 Card)
- `apps/backend/src/api/store/carts/[id]/payment-attempts/pix/route.ts` (HR-08, HR-07 Pix)

O PLAN listou `apps/backend/src/modules/payment-attempt/eligibility.ts`. O git **não** modificou esse arquivo no intervalo 16-09. As remediações de autoridade de pagamento ocorreram nas rotas Card/Pix. Isso é desvio plan-vs-git, não falha da entrega.

## Review guard integration

`assertNoPendingCartReview(cartId, sharedContext)` consulta a row autoritativa na transação compartilhada e lança o erro público estável `REVIEW_REQUIRED`.

- Line-item mutation: depois de locks/ownership; antes de idempotency claim, CAS/version bump e workflow.
- `executeCartMerge`: antes de decidir/aplicar.
- Mutação **não** limpa nem supersede pending. ACK permanece a única transição que limpa.
- Resposta `409` sanitizada, sem `reviewRef` e sem IDs internos.

## Payment Card/Pix authority remediation

Não se afirma equivalência arquitetural plena entre Card e Pix.

**HR-07 Card authority final (human-authorized), checkpoint `a1384e99ed287b2a286cfaf97d25bd1053fd60ae`:**

- lock and cart reread use the same transaction
- eligibility snapshot transaction-bound
- region/countries transaction-bound
- variants/metadata/prices transaction-bound
- ownership before review/provider
- pending review providerCalls=0
- allowed providerCalls=1
- Order=0

**HR-07 Pix authority final (human-authorized), checkpoint `55d381bc7e55489045db22848b424a9e9658eccb` (HEAD):**

- lock and cart reread use the same transaction
- eligibility snapshot transaction-bound
- region/countries transaction-bound
- variants/metadata/prices transaction-bound
- no authoritative REMOTE_QUERY cart reread
- ownership before review/provider
- pending review providerCalls=0
- allowed providerCalls=1
- PaymentCollection added=NO
- PaymentSession added=NO
- Order=0

**HR-08** (`789443a43bad2496338f5ef36e0b730e05c3b4e9`) aplica o review guard antes do payment start nas rotas Card e Pix.

## ACK/payment/line/merge race evidence

ACK versus mutação serializa sob a ordem global de locks:

- ACK winner libera mutação posterior.
- Mutação nunca atravessa pending.
- Somente ACK válido limpa pending.
- ACK no-op, replay, stale e `reviewRef` conflict não liberam o cart indevidamente.
- Stale ACK mantém pending; replay terminal compatível não faz bump estrutural.
- ACK-vs-line-item, ACK-vs-merge e ACK-vs-payment não atravessam a barreira.
- Mutações posteriores não reativam review antigo.

## Zero-Order authority evidence

**Zero Order authority: PRESERVED.**

Estes caminhos **não** criam Order:

- partial merge
- REVIEW_REQUIRED blockers
- ACK valid
- ACK no-op
- ACK replay
- stale ACK
- reviewRef conflict
- ACK-vs-line-item race
- ACK-vs-merge race
- ACK-vs-payment race
- Card payment initiation
- Pix payment initiation

A autoridade positiva existente continua: Order é criado somente após o fluxo canônico confiável `payment_intent.succeeded`. Esta evidência não expande além do já comprovado.

## HR blockers ledger

Todos os itens abaixo são **HUMAN APPROVED — CLOSED — PASS**.

### B16-09-HR-03

- **HUMAN APPROVED — CLOSED — PASS**
- `a78ddce091de6f82a466da98bc33f862e5059b8c` (`a78ddce`)
- `CHECKPOINT B16-09-HR-03 REMEDIATION`

### B16-09-HR-04

- **HUMAN APPROVED — CLOSED — PASS**
- `79a661f347f5441bfe228473b901c2a9b4c0265a`
- `test(cart-merge): prove review race serialization`

### B16-09-HR-05

- **HUMAN APPROVED — CLOSED — PASS**
- `44ebd5ecd2ed81e68deb854ac048641e4dd93055` (`44ebd5e`)
- `test(cart-merge): prove line-item post-lock review authority`
- Chronology: this SHA is AFTER HR-08 in linear history.

### B16-09-HR-06

- **HUMAN APPROVED — CLOSED — PASS**
- `04c929e0196adf6da291e8046f40cdae11bb8e7e` (`04c929e`)
- `test(cart-merge): prove review zero-order authority`

### B16-09-HR-07 (global HR-07)

- **HUMAN APPROVED — CLOSED — PASS**
- Card: **CLOSED — PASS**, checkpoint `a1384e99ed287b2a286cfaf97d25bd1053fd60ae` (`a1384e9`) — `fix(cart-merge): bind card eligibility to cart transaction`
- Pix: **CLOSED — PASS**, checkpoint `55d381bc7e55489045db22848b424a9e9658eccb` (`55d381b`) = HEAD — `fix(cart-merge): bind pix eligibility to cart transaction`

### B16-09-HR-08

- **HUMAN APPROVED — CLOSED — PASS**
- `789443a43bad2496338f5ef36e0b730e05c3b4e9` (`789443a`)
- `fix(cart-merge): enforce review guard before payment start`
- Chronology: BEFORE HR-05 SHA.

## Relevant checkpoints

Somente SHAs comprovados. Nenhum SHA adicional foi inventado.

Checkpoints técnicos anteriores do Plan 16-09 (proven, not HR-named in PLAN):

1. `8513fb444d3a10eaca4debecf08de96c0ebba603` — `test(16-09): define pending review backend barrier`
2. `3fdbb8c81aa960df6f4fdaaafb95291af8288b66` — `feat(16-09): enforce review barrier before cart effects`
3. `7ee9bf693ec8178bb8b1f785588970ba7aba2cd8` — `feat(16-09): guard payment initiation during review`
4. `7f355a2fcebf0d79233202fe4dd8f657a13404dc` — `test(16-09): align HTTP transaction fixtures`

HR checkpoints: `a78ddce`, `79a661f`, `789443a`, `44ebd5e`, `04c929e`, `a1384e9`, `55d381b` (HEAD), conforme o ledger acima.

Todos são commits locais. Nenhum amend, push ou deploy.

## Final verification matrix

Human-authorized; not rerun for this SUMMARY.

- **Unit:** 2/2 suites, 37/37 PASS, Failed=0, Exit=0 (`review-guard.unit.spec.ts` + `payment-eligibility.unit.spec.ts`)
- **HTTP:** 2/2 suites, 75/75 PASS, Failed=0, Skipped=0, Exit=0 (`cart-merge-review.spec.ts` + `cart-checkout-store.spec.ts`)
- **PostgreSQL isolated:**
  - `guest-cart-order-invariants.postgres.spec.ts`: 18/18 PASS, Failed=0, Skipped=0, Exit=0, cleanup PASS
  - `cart-merge-review.postgres.spec.ts`: 33/33 PASS, Failed=0, Skipped=0, Exit=0, cleanup PASS
  - total: 51/51 PASS isolated, Failed=0, Skipped=0
- **Disposable PostgreSQL cleanup:** PASS + PASS
- **`git diff --check`:** PASS

**PostgreSQL normative evidence: PASS BY HUMAN-APPROVED ISOLATED EXECUTION**

## PostgreSQL combined harness exception

ORIGINAL NORMATIVE EXECUTION: `cart-merge-review.postgres.spec.ts` THEN `guest-cart-order-invariants.postgres.spec.ts` in same Jest invocation.

Reproduced:

- first suite `cart-merge-review.postgres.spec.ts`: PASS
- second suite `guest-cart-order-invariants.postgres.spec.ts`: FAIL DURING MEDUSA APPLICATION BOOTSTRAP
- Combined invocation: FAIL during second-suite bootstrap
- First error: `Loaders for module Stock_location failed: Method Map.prototype.set called on incompatible receiver #<Map>`
- Error occurred BEFORE Order assertions
- Later teardown: `Cannot read properties of null (reading 'resolve')` in `waitWorkflowExecutions`

Classification: A1 — **combined-suite harness/process contamination confirmed**

- Combined-suite process contamination: PROVEN
- Exact mechanism: UNPROVEN

A categoria diagnóstica "stale singleton" permanece apenas como categoria diagnóstica plausível. Não está comprovada.

Disposition: **HUMAN-APPROVED ISOLATED-EXECUTION EQUIVALENCE**

## Human-approved isolated-execution equivalence

HUMAN-APPROVED EQUIVALENT: suite A in own disposable PostgreSQL/process + suite B in own disposable PostgreSQL/process.

Justification:

- both suites pass fully isolated
- no tests removed
- no tests skipped
- no tests altered
- combined failure occurs at second-suite bootstrap
- Order assertions are not reached in combined failure
- runtime defect was not observed
- Order invariant defect was not observed

cart-merge-review.postgres.spec.ts: 33/33 PASS isolated
guest-cart-order-invariants.postgres.spec.ts: 18/18 PASS isolated
total: 51/51 PASS isolated

## Cleanup evidence

Cada suíte PostgreSQL isolada encerrou com cleanup disposable **PASS**. As duas execuções isoladas somam cleanup **PASS + PASS**. Nenhum database remoto, Redis remoto, provider live, push ou deploy foi usado para esta evidência.

## Security / leakage invariants

Invariantes do threat model do PLAN 16-09, reafirmados como contrato (sem scan de leakage 16-09 reivindicado):

- **T-16-09-01:** nenhum path estrutural ou financeiro ignora o guard transacional `REVIEW_REQUIRED`.
- **T-16-09-02:** ACK/mutation race serializa pela ordem de locks Customer/cart/version/review.
- **T-16-09-03:** erro `REVIEW_REQUIRED` estável e não enumerante, sem `reviewRef`/IDs internos.
- **T-16-09-04:** delta real de Order permanece zero em blockers, ciclo de review e races.
- **T-16-09-SC:** nenhuma instalação de pacote ocorreu.

Mutação não consome capability, não faz claim de idempotency e não persiste PaymentAttempt enquanto pending. Tokens de tracking, secrets e dados de cartão não entram neste closeout como superfície nova.

## Requirements

- **MRG-06:** **EVIDENCE COMPLETE FOR PLAN 16-09**
- **MRG-07:** **EVIDENCE COMPLETE FOR PLAN 16-09**

`requirements-completed` permanece `[]`. MRG-06/MRG-07 **não** estão fechados globalmente. MRG-01..MRG-08 permanecem **OPEN / GLOBAL RECONCILIATION PENDING**. A reconciliação global da Phase 16 é posterior.

## Deviations / diagnostic note

1. **Plan-vs-git (pagamento):** o PLAN listou `apps/backend/src/modules/payment-attempt/eligibility.ts`; o git não o modificou. A integração transacional Card/Pix materializou-se nas rotas específicas `card/route.ts` e `pix/route.ts` (HR-08 / HR-07). Não é falha da entrega.
2. **Helper allowlist expansion:** `apps/backend/integration-tests/helpers/cart-merge-postgres.ts` foi incluído depois por autorização humana para evidência/races; não estava na allowlist original do PLAN. Não é erro de path do PLAN.
3. **Combined-suite harness/process contamination confirmed.** Combined invocation FAIL during second-suite bootstrap. **exact mechanism unproven.** A evidência normativa é isolated execution, human-approved.

## Remaining gates

- Plan 16-09 execution: **TECHNICAL PASS**
- Plan 16-09 human closure: **PENDING HUMAN REVIEW**
- MRG-01..MRG-08: **OPEN / GLOBAL RECONCILIATION PENDING**
- Phase 16: **IN PROGRESS**
- Plan 16-10: **NOT AUTHORIZED**
- Push: **NOT AUTHORIZED**
- Deploy: **NOT AUTHORIZED**
- SUMMARY creation does NOT auto-authorize Plan 16-10.

O próximo passo permitido é **HUMAN CLOSEOUT REVIEW OF PLAN 16-09**. Este SUMMARY não inicia nem autoriza o Plan 16-10.

---
*Phase: 16-cart-merge-review*
*Plan: 16-09*
*Technical execution: PASS; human closeout pending*
