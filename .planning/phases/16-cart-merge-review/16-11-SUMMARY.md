---
phase: 16-cart-merge-review
plan: 11
subsystem: cart-merge
tags: [cart-merge, exact-set, bff, manifest, leakage, native-deny, idempotency]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-10 HUMAN APPROVED — CLOSED — PASS; deprecated attach facade delegating to canonical executeCartMerge."
provides:
  - "Merge e ACK no exact-set Cart M1 com owner Phase 16; attach deprecated preservado fora M1 com exclusão controlada."
  - "BFF tuple 8 operações (6 Phase 15 + merge + ACK); Customer bearer em merge/ACK; capability somente no merge/adapter."
  - "Native attach e aliases/prefixos desconhecidos DENY/non-enumerating; sem session fallback ou second attach engine."
  - "Prova eight-sink leakage ZERO para guest_capability, customer_jwt e raw_idempotency_key; Order delta zero em C1–C8."
affects: [phase-16-cart-merge-review, plan-16-12]

actuals:
  tokens: 4800
  tasks: 2
  technical_commits: 2

tech-stack:
  added: []
  patterns:
    - "EXACT-SET M1: POST /store/customers/me/cart/merge e POST /store/carts/:id/review/acknowledge como M1_ENABLED owner Phase 16; prefix auth NONE."
    - "ATTACH OUTSIDE M1: DEPRECATED / PRESERVED com exclusion owner FND-02 / Phase 13-02 / Phase 16; removal trigger HUMAN GATE REQUIRED."
    - "NATIVE DENY: POST /store/carts/{id}/customer DENY; unknown aliases/prefixes DENY / NON-ENUMERATING; session fallback NONE."
    - "EIGHT-SINK LEAKAGE: helper guest-cart-leakage.ts com canários por classe (guest_capability, customer_jwt, raw_idempotency_key); zero matches; failure output sanitizado."
    - "ORDER AUTHORITY: REAL SQL count(*) from order; delta 0 para adapter/native/session/denial paths C1–C8."

key-files:
  created: []
  modified:
    - "apps/backend/src/api/store/carts/bff-protected-operations.ts"
    - "apps/backend/src/api/middlewares.ts"
    - "apps/backend/src/api/store-surface/manifest.ts"
    - "apps/backend/src/api-docs/coverage/exclusions.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts"
    - "apps/backend/integration-tests/helpers/guest-cart-leakage.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"

key-decisions:
  - "Merge e ACK entram no exact-set M1_ENABLED Phase 16; attach permanece DEPRECATED/PRESERVED fora M1 com exclusão explícita e gatilho humano de remoção (sem data inventada)."
  - "Customer bearer (não session) em merge e ACK; ACK não exige capability; capability somente no merge/adapter."
  - "Nenhuma prefix match autoriza vizinhos; native POST /store/carts/{id}/customer e aliases desconhecidos permanecem DENY/non-enumerating."
  - "MRG-01, MRG-02, MRG-05 e MRG-08 têm EVIDENCE COMPLETE FOR PLAN 16-11; reconciliação global permanece pendente."
  - "Plan 16-12, push e deploy permanecem NOT AUTHORIZED; este SUMMARY não auto-autoriza Plan 16-12."

patterns-established:
  - "Exact-set fail-closed: duas operações Phase 16 no BFF/manifest; attach fora M1 com classificação e exclusão coerentes."
  - "Eight-sink leakage matrix: canários por classe secreta; zero matches; falhas reportam sink e classe sanitizada, nunca valores canário."
  - "Order authority via SQL real em disposable Postgres; delta zero em adapter, native denial e session denial."

coverage:
  - id: D1
    description: "Merge e ACK no exact-set Cart M1_ENABLED owner Phase 16; BFF tuple 8 (6 Phase 15 + merge + ACK); prefix auth NONE; Customer bearer em ambos."
    requirement: MRG-01
    verification:
      - kind: integration
        ref: "cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts integration-tests/http/guest-cart-native-deny.spec.ts — 98/98 PASS"
        status: pass
    human_judgment: false
  - id: D2
    description: "Attach DEPRECATED/PRESERVED fora M1 com exclusion owner FND-02/Phase 13-02/Phase 16 e removal trigger HUMAN GATE REQUIRED; native attach e aliases DENY/non-enumerating."
    requirement: MRG-02
    verification:
      - kind: integration
        ref: "guest-cart-native-deny.spec.ts native denial inventory — 98/98 PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "Eight-sink leakage ZERO para guest_capability, customer_jwt e raw_idempotency_key após merge, adapter, replay, conflict e denial."
    requirement: MRG-05
    verification:
      - kind: integration
        ref: "guest-cart-leakage.ts helper + cart-merge-review.spec.ts + guest-cart-native-deny.spec.ts — 98/98 PASS"
        status: pass
    human_judgment: false
  - id: D4
    description: "Adapter/native/session denial paths criam zero Order real; Order delta 0 em C1–C8 via SQL count(*) from order."
    requirement: MRG-08
    verification:
      - kind: integration
        ref: "cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts — 26/26 PASS"
        status: pass
    human_judgment: false
  - id: D5
    description: "Closeout humano do Plan 16-11 após TECHNICAL PASS."
    verification: []
    human_judgment: true
    rationale: "Plan 16-11 human closure permanece PENDING HUMAN REVIEW. Evidência HTTP/PostgreSQL automatizada não substitui revisão humana do slice exact-set/leakage nem autoriza Plan 16-12, push ou deploy."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-11 Summary

**Exact-set BFF/manifest for merge and ACK (M1_ENABLED Phase 16), attach deprecated outside M1 with controlled exclusion, native denial inventory, eight-sink leakage ZERO, and real-SQL Order delta zero — no prefix auth, no session fallback, no second attach engine.**

## Status

- **Plan 16-11 execution:** **TECHNICAL PASS**
- **Plan 16-11 human closure:** **PENDING HUMAN REVIEW**
- **Task 16-11-01:** **PASS**
- **Task 16-11-02:** **PASS**
- **Plan 16-10:** **HUMAN APPROVED — CLOSED — PASS** (não reaberto; 16-10-SUMMARY.md não editado)
- **MRG-01:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-02:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-05:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-08:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-01..MRG-08:** **OPEN / GLOBAL RECONCILIATION PENDING**
- **Phase 16:** **IN PROGRESS**
- **Plan 16-12:** **NOT AUTHORIZED**
- **Push:** **NOT AUTHORIZED**
- **Deploy:** **NOT AUTHORIZED**
- **STATE, ROADMAP e counters:** **NOT UPDATED**
- **SUMMARY creation does NOT auto-authorize Plan 16-12.**

Este documento registra **Plan 16-11: TECHNICAL PASS**. Não registra Plan 16-11 CLOSED.

## Objective / outcome

Fechar a superfície exact-set da Phase 16 e provar que o adapter deprecated não cria bypass, leakage ou Order. Merge e ACK entram no exact-set Cart M1 com owner Phase 16; attach permanece DEPRECATED/PRESERVED fora M1 com exclusão controlada. Native attach e aliases/prefixos desconhecidos permanecem DENY/non-enumerating. Prova eight-sink leakage ZERO para as classes `guest_capability`, `customer_jwt` e `raw_idempotency_key`; Order authority via SQL real com delta zero em todos os casos C1–C8.

## Tasks completed

- **Task 16-11-01: Fechar exact-set BFF, manifest e native denial** — **PASS.** Merge e ACK adicionados ao vocabulário BFF protegido e matchers exatos; manifest M1_ENABLED Phase 16; attach reclassificado fora M1 com exclusão completa; native denial inventory mantida.
- **Task 16-11-02: Provar leakage ZERO e Order authority no adapter** — **PASS.** Helper `guest-cart-leakage.ts` estendido para oito sinks; canários por classe secreta com zero matches; Order delta zero via disposable Postgres; failure output sanitizado.

## Runtime changes consolidated

Baseline start HEAD: `4a7c684` — `docs(cart-merge): record plan 16-10 remediation`.

### Technical commits

- `5dfbede802887b7afeffa99330cb076b9b55ad56` (`5dfbede`) — `feat(store-surface): enable phase 16 merge exact-set`
- `565e6acfc86af7d2dd568f082f7ef3b9f1ec6db0` (`565e6ac`) — `test(cart-merge): prove leakage and zero-order invariants`

HEAD: `565e6acfc86af7d2dd568f082f7ef3b9f1ec6db0`

Modificado:

- `apps/backend/src/api/store/carts/bff-protected-operations.ts` — exact operation BFF guard para merge e ACK
- `apps/backend/src/api/middlewares.ts` — method/path exact-set sem prefix authorization
- `apps/backend/src/api/store-surface/manifest.ts` — duas operações Phase 16 M1_ENABLED; attach fora M1
- `apps/backend/src/api-docs/coverage/exclusions.ts` — exclusão controlled/deprecated do attach
- `apps/backend/integration-tests/http/cart-merge-review.spec.ts` — suíte estendida com leakage e surface cases
- `apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts` — native denial inventory atualizada
- `apps/backend/integration-tests/helpers/guest-cart-leakage.ts` — helper Phase 15 estendido para oito sinks e canários por classe secreta (sem exibir valores)
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` — Order authority C1–C8

- Worktree após commits técnicos: **CLEAN** (exceto este SUMMARY)
- Execution environment: **Cursor**; orchestrator **Grok 4.6**; subagents sequenciais reais via Cursor Task

## Architecture

```
EXACT-SET M1 (Phase 16)
├── POST /store/customers/me/cart/merge     → M1_ENABLED owner Phase 16
└── POST /store/carts/:id/review/acknowledge → M1_ENABLED owner Phase 16

OUTSIDE M1
└── POST /store/customers/me/cart/attach    → DEPRECATED / PRESERVED
    exclusion owner: FND-02 / Phase 13-02 / Phase 16
    removal trigger: HUMAN GATE REQUIRED (later PLAN / consumer migration)
    invented date: NO

NATIVE DENY
├── POST /store/carts/{id}/customer         → DENY
└── unknown aliases/prefixes                  → DENY / NON-ENUMERATING

BFF TUPLE: 6 Phase 15 + merge + ACK = 8
Auth: Customer bearer (not session) on merge/ACK
Capability: merge/adapter only; ACK does not require capability
Prefix auth: NONE
Session fallback: NONE
Second attach engine: NONE
Unexpected M1: NONE
```

## Verification matrix

### Task 16-11-01 HTTP (before 16-11-02 test additions)

- **Command:** `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts integration-tests/http/guest-cart-native-deny.spec.ts`
- **Test Suites:** 2 passed, 2 total
- **Tests:** 85 passed, 85 total
- **Failed:** 0
- **Skipped:** 0
- **Exit:** 0
- **Time:** 5.689s

### Task 16-11-02 HTTP (full suite)

- **Command:** `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts integration-tests/http/guest-cart-native-deny.spec.ts`
- **Test Suites:** 2 passed, 2 total
- **Tests:** 98 passed, 98 total
- **Failed:** 0
- **Skipped:** 0
- **Exit:** 0
- **Time:** 7.031s

### PostgreSQL Order authority (disposable local)

- **Command:** `cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts`
- **PostgreSQL:** DISPOSABLE LOCAL (mode=docker host=127.0.0.1); Docker: USED
- **Test Suites:** 1 passed, 1 total
- **Tests:** 26 passed, 26 total
- **Failed:** 0
- **Skipped:** 0
- **Exit:** 0
- **Jest Time:** 194.039s; runner 206.657s
- **Order authority:** REAL SQL `select count(*)::int as count from "order"`
- **Order delta:** 0 for C1–C8

## Security / threat model invariants

- **Eight-sink leakage:** ZERO for `guest_capability`, `customer_jwt`, `raw_idempotency_key` across merge, adapter, replay, conflict and denial paths.
- **Redis sink:** NOT EXERCISED — runtime path does not use Redis in this harness.
- **Sentry:** NOT EXERCISED on merge path.
- **Analytics:** NOT EXERCISED on merge/adapter/ACK/denial.
- **Provider-mock:** workflow `mock.calls` scanned; Stripe/Gelato/Resend NOT called.
- **Failure output:** SANITIZED — no canary values in test failure output; only sink and sanitized class reported.
- **reviewRef/ETag/fingerprint encoding:** NONE — no capability or raw key encoded in reviewRef, ETag or fingerprint.

## Requirements

- **MRG-01:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-02:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-05:** **EVIDENCE COMPLETE FOR PLAN 16-11**
- **MRG-08:** **EVIDENCE COMPLETE FOR PLAN 16-11**

`requirements-completed` permanece `[]`. MRG-01/02/05/08 **não** estão fechados globalmente. MRG-01..MRG-08 permanecem **OPEN / GLOBAL RECONCILIATION PENDING**. A reconciliação global da Phase 16 é posterior.

## Deviations from Plan

1. **Collateral unit/HTTP suites outside the 8-path allowlist** ainda fixam BFF length 6 Phase 15 / totais de manifest anteriores. **Não foram modificados.** Focused gates passaram. Validador independente aceitou como fora do file set do plano, não reabertura do 16-10.
2. **Preflight encontrou 16-10-SUMMARY ainda com PENDING HUMAN REVIEW.** Autorização humana atual (Plan 16-10 HUMAN APPROVED — CLOSED — PASS) supersedeu isso para início do 16-11. **16-10-SUMMARY não reescrito** (fora do allowlist).

Nenhum outro desvio material. Plano executado conforme escopo autorizado.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Exact-set BFF/manifest fechado para merge e ACK; attach fora M1 com exclusão controlada; native denial inventory completa.
- Eight-sink leakage ZERO comprovado; Order delta zero em disposable Postgres.
- Plan 16-12 **não autorizado** até closeout humano do Plan 16-11.
- Push e deploy **não autorizados**.

## Remaining gates

- Plan 16-11 execution: **TECHNICAL PASS**
- Plan 16-11 human closure: **PENDING HUMAN REVIEW**
- Phase 16: **IN PROGRESS**
- Plan 16-12: **NOT AUTHORIZED**
- Push: **NOT AUTHORIZED**
- Deploy: **NOT AUTHORIZED**

Next permitted action: **HUMAN REVIEW OF PLAN 16-11**

Do not auto-authorize Plan 16-12.

---
*Phase: 16-cart-merge-review*
*Plan: 16-11*
*Technical execution: PASS; human closeout pending*
