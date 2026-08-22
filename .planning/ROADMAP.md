# Roadmap: Milestone v1.1 — Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependências que impedem o Frontend Milestone 1 de começar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfície Store autorizada, autenticação, capability/concorrência de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmação assíncrona, confirmação de pedido/catálogo e kit contratual verificável.

**Core invariant:** `Order` continua existindo somente após confirmação confiável do pagamento pelo webhook Stripe canônico; nenhuma operação Store, BFF ou browser pode criá-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN — **3/10 phases closed**, **26/91 requirements complete**.

## Governança

- `mode = interactive`
- `workflow.auto_advance = false`
- `workflow._auto_chain_active = false`
- `parallelization = false`
- sequência obrigatória: `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`
- cada gate CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW e CLOSURE permanece sujeito à revisão humana aplicável
- Phase 13 está **CLOSED — HUMAN APPROVED**, FND-01..FND-08 COMPLETE
- Phase 14 está **CLOSED — HUMAN APPROVED**, AUTH-01..AUTH-09 COMPLETE
- `14-01..14-21` estão HUMAN APPROVED — PASS
- `14-07..14-21` estão DOCUMENTALLY CLOSED
- `B14-21-HR-01..HR-05` estão CLOSED — PASS
- Phase 15 CONTEXT está **HUMAN APPROVED — PASS**
- Phase 15 RESEARCH está **HUMAN APPROVED — PASS**
- Phase 15 PLAN está **HUMAN APPROVED — PASS** (8 plans / 8 serial waves)
- Phase 15 está **CLOSED — HUMAN APPROVED**; Plans `15-01`..`15-08` estão **8/8 HUMAN APPROVED — PASS**, `15-07` e `15-08` estão documentally closed, e CART-01..CART-09 estão **9/9 COMPLETE**
- Phase 16 está **AUTHORIZED — CONTEXT NOT STARTED**; RESEARCH e gates posteriores da Phase 16 permanecem não autorizados até revisão humana própria; Phase 17+ permanecem não autorizadas
- A remediação pós-closure do PR #27 recebeu PASS humano; B15-PR27-HR-01..HR-06 estão CLOSED — PASS e a suspensão temporária da execução do CONTEXT da Phase 16 foi levantada; RESEARCH e gates posteriores continuam não autorizados
- deploy, real Resend/real providers, remote infra e frontend permanecem não autorizados/bloqueados

## Milestones

| Milestone | Status | Phases | Requirements |
|---|---|---:|---:|
| v1.0 — Backend MVP | COMPLETE / CLOSED / ARCHIVED / IMMUTABLE | 13/13 | 45/45 |
| v1.1 — Backend Storefront Readiness | OPEN | **3/10 closed** | **26/91** |

O snapshot histórico de v1.0 permanece em `milestones/v1.0-ROADMAP.md`. A tag e a GitHub Release `v1.0` são imutáveis e não participam deste milestone.

## Phases

| Phase | Nome | Depends on | Requirements | Estado |
|---:|---|---|---:|---|
| 13 | Storefront Contract Foundation & Surface Lockdown | v1.0 | 8 | CLOSED — HUMAN APPROVED; 7/7 plans; 8/8 requirements |
| 14 | Customer Auth & Verification | 13 | 9 | **CLOSED — HUMAN APPROVED; 21/21 plans; 63/63 tasks; 9/9 requirements** |
| 15 | Guest Cart Capability & Concurrency | 14 | 9 | **CLOSED — HUMAN APPROVED; 8/8 plans; CART-01..CART-09 = 9/9 COMPLETE** |
| 16 | Cart Merge & Review | 15 | 8 | **AUTHORIZED — CONTEXT NOT STARTED** |
| 17 | Authenticated BR Checkout & Privacy | 16 | 10 | Not started |
| 18 | Gelato Shipping Quote & Selection | 17 | 8 | Not started |
| 19 | Storefront PaymentAttempt Hardening | 18 | 9 | Not started |
| 20 | Async Payment Confirmation | 19 | 10 | Not started |
| 21 | Order Confirmation & Catalog Handoff | 20 | 8 | Not started |
| 22 | Contract Kit, Verification & Release | 21 | 12 | Not started |

## Phase 13: Storefront Contract Foundation & Surface Lockdown

**Goal:** conhecer e bloquear a superfície Store real antes de adicionar contratos, garantindo que nenhuma rota nativa incompatível contorne as regras storefront ou crie `Order`.

**Status:** CLOSED — HUMAN APPROVED. 7/7 plans; FND-01..FND-08 COMPLETE.

Closure authority: `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md`.

## Phase 14: Customer Auth & Verification

**Goal:** entregar identidade/Customer, login, reset, refresh e verificação sem contrariar a política de sessão inicial não verificada.

**Depends on:** Phase 13 closed.  
**Requirements:** AUTH-01–AUTH-09.  
**Deliverables:** operações auth/Customer, política flexível, estado/token de verificação, outbox auth, rate limits, anti-enumeração, BFF-only surface e final Order-authority proof.  
**Exit criteria:** cadastro coordenado; sessão inicial compra; novo login não verificado bloqueado; reset/update revogam credenciais antigas; refresh inválido falha; tokens são hash-only/uso único/expiráveis; full regression e final human verify PASS.

### Closure status

- 21 planos em 21 waves seriais (`14-01 → ... → 14-21`).
- **63/63 tasks complete**.
- **21/21 plans HUMAN APPROVED — PASS**.
- **AUTH-01..AUTH-09 = 9/9 COMPLETE**.
- **D14-01..D14-16 = 16/16 PASS**.
- research blockers = **4/4 CLOSED**.
- MUST findings = **8/8 PASS**.
- `14-21 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `Phase 14 HUMAN APPROVED — CLOSED`.
- Phase 15 CONTEXT HUMAN APPROVED — PASS.
- Phase 15 RESEARCH HUMAN APPROVED — PASS.
- Phase 15 PLAN HUMAN APPROVED — PASS (8 plans / 8 serial waves).
- Phase 15 CLOSED — HUMAN APPROVED; Plans 15-01..15-08 HUMAN APPROVED — PASS (8/8); 15-07 e 15-08 DOCUMENTALLY CLOSED; CART-01..CART-09 = 9/9 COMPLETE.
- Deploy NOT AUTHORIZED.
- Real Resend / real providers NOT AUTHORIZED.
- Remote DB/Redis changes NOT AUTHORIZED.
- Frontend BLOCKED.

### Phase 14 plans

- [x] `14-01-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-02-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-03-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-04-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-05-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-06-PLAN.md` — HUMAN APPROVED — PASS
- [x] `14-07-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-08-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-09-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-10-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-11-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-12-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-13-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-14-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-15-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-16-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-17-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-18-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-19-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-20-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- [x] `14-21-PLAN.md` — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED

### Accepted closure references

Detailed accepted evidence is preserved in:

- `14-07-SUMMARY.md` — persistence/collision audit/migration exact-set
- `14-08-SUMMARY.md` — auth rate limits/timing/Redis fail-closed
- `14-09-SUMMARY.md` — auth notification outbox/reconciliation
- `14-10-SUMMARY.md` — session/JWT/refresh rotation
- `14-11-SUMMARY.md` — PostgreSQL access guard/custom refresh-revoke surface
- `14-12-SUMMARY.md` — verification latest-wins/one-winner domain
- `14-13-SUMMARY.md` — exact verification Store surface and HTTP contracts
- `14-14-SUMMARY.md` — registration coordinator/recovery/concurrency
- `14-15-SUMMARY.md` — signup/login/me surface and BFF service boundary
- `14-16-SUMMARY.md` — composed password reset and guarded recovery
- `14-17-SUMMARY.md` — current-password proof and lineage-bound password change
- `14-18-SUMMARY.md` — secretless reconciliation and final runtime exact-set
- `14-19-SUMMARY.md` — API Docs registry and BFF OpenAPI caller authority
- `14-20-SUMMARY.md` — writer-generated Store artifact and deterministic bytes
- `14-21-SUMMARY.md` — final AUTH/Order/regression gate and human verify
- `14-CLOSURE.md` — Phase-14 closure authority

### Phase 14 final authority

Final accepted Store runtime:

```text
total: 63
native identity: 51
local-only: 12
DENY: 50
PRESERVE_LEGACY: 7
M1_ENABLED: 6
```

Final Phase-14 Store `M1_ENABLED` exact-set:

- `GET /store/customers/me`
- `POST /store/customers/me/verify`
- `POST /store/customers/verify/resend`
- `POST /store/customers/verify`
- `GET /store/customers/me/verify/status`
- `POST /store/customers/me/password`

Final approved local Auth exact-set:

- `POST /auth/customer/emailpass/register`
- `POST /auth/customer/emailpass`
- `POST /auth/token/refresh`
- `POST /auth/customer/emailpass/revoke-current-lineage`
- `POST /auth/customer/emailpass/reset-password`
- `POST /auth/customer/emailpass/update`

Native Auth primitives and raw `POST /store/customers` remain DENY; `/auth/session`, callbacks, MFA and social/passwordless aliases remain absent/denied as applicable.

Final 14-21 regression authority:

```text
openapi:check: PASS
quick units: 16/16 PASS
focused HTTP: 144/144 PASS
dedicated multiprocess: 10/10 PASS + cleanup
PG ledger: 11/11 PASS + 11/11 cleanup
Full Unit: 89/89 suites / 1648/1648 PASS
Modules: 52/52 suites / 749/749 PASS
HTTP combined: 37/37 suites / 478/478 accounted for
API Docs units: 6 suites / 258 tests PASS
openapi:lint: PASS
lint: 0 errors
build: PASS
negative/leakage scans: PASS
```

Canonical Order invariant remains: all 12 Phase-14 operations create zero Orders; canonical `payment_intent.succeeded` is the positive Order-birth control and replay remains one Order.

Technical head consumed by closure:

`3d12565d74e9688883d6e042fdebca79ffebf7de`

## Phase 15: Guest Cart Capability & Concurrency

**Goal:** substituir a sessão como prova principal de posse por capability opaca e tornar mutações concorrentes seguras.

**Status:** **CLOSED — HUMAN APPROVED (CONTEXT, RESEARCH, PLAN and EXECUTION PASS; 15-01..15-08 HUMAN APPROVED — PASS, 8/8; 15-07 e 15-08 DOCUMENTALLY CLOSED; CART-01..CART-09 = 9/9 COMPLETE).** Depends on Phase 14 CLOSED.

**Plans:** 8 plans / 8 serial waves (replaces the superseded 18-plan set)

Plans:
**Wave 0**

- [x] 15-01-PLAN.md — HUMAN APPROVED — PASS — Validation Foundation & PLAN locks P15-D01..P15-D10

**Wave 1** *(blocked on Wave 0 completion)*

- [x] 15-02-PLAN.md — HUMAN APPROVED — PASS — Guest Capability Domain & Persistence

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 15-03-PLAN.md — HUMAN APPROVED — PASS — Active Cart M1 Boundary & Tracer (Guest + Customer)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 15-04-PLAN.md — HUMAN APPROVED — PASS — Active Cart Lifecycle, Idempotency & Concurrency

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 15-05-PLAN.md — HUMAN APPROVED — PASS — Line-Item Mutation Core: Add & Update

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 15-06-PLAN.md — HUMAN APPROVED — PASS — Delete, Clear & Final Cart Surface

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 15-07-PLAN.md — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED — Store API Contract (B15-07-HR-01 CLOSED — PASS)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 15-08-PLAN.md — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED — Final Phase Verification (mandatory ledger)

The accepted Phase-15 CONTEXT, RESEARCH, human-approved PLAN and closure
artifact are the authorities for this phase. Plans `15-01` through `15-08`
are **8/8 HUMAN APPROVED — PASS**; Plans `15-07` and `15-08` are documentally
closed, with `B15-07-HR-01` CLOSED — PASS. Plan `15-08` technical ledger 01–17
and final human checkpoint are PASS. The final Store authority is
`64/51/13/16/47/5/12`, with Auth M1 6 intact, Cart M1 6 and Global M1 12. Cart
Store/BFF synchronous Order birth is zero, the canonical
`payment_intent.succeeded` webhook remains the only accepted Order-birth
authority, and capability leakage is ZERO. No deploy, provider or remote
infrastructure action is authorized. A separate human decision authorizes
**Phase 16 CONTEXT only**; Phase-16 RESEARCH and all later gates remain
separately human-gated and unauthorized.

### Post-closure PR #27 governance

Phase 15 remains **CLOSED — HUMAN APPROVED** as historical closure status.
PR #27 post-closure remediation is **HUMAN APPROVED — PASS**;
B15-PR27-HR-01..HR-06 are **CLOSED — PASS**. Phase-16 CONTEXT is
**AUTHORIZED — NOT STARTED** and its temporary execution suspension is lifted.
Phase-16 RESEARCH and later gates remain unauthorized; milestone counters are unchanged.

Milestone counters: phases closed `3/10`; requirements `26/91`; open
requirements `65`; plans `36/36`; percent `30`.

### Accepted Phase-15 evidence

- `15-08-SUMMARY.md` — final CART/Order/regression/leakage ledger and human verify
- `15-CLOSURE.md` — human-approved Phase-15 closure authority
- `15-PR27-REMEDIATION.md` — human-approved post-closure PR #27 remediation (6/6 CLOSED — PASS)

## Phase 16: Cart Merge & Review

**Goal:** substituir attach simples por merge transacional, idempotente, parcial e revisável.

**Status:** **AUTHORIZED — CONTEXT NOT STARTED.** Depends on Phase 15 CLOSED. Phase-16 RESEARCH and later gates remain separately unauthorized.

## Phase 17: Authenticated BR Checkout & Privacy

**Goal:** criar checkout autenticado para pessoa física no Brasil sem armazenar CPF cru no caminho atual.

**Status:** Not started. Depends on Phase 16.

## Phase 18: Gelato Shipping Quote & Selection

**Goal:** substituir frete operacional fixo por cotação e seleção autoritativas preservadas até o dispatch.

**Status:** Not started. Depends on Phase 17.

## Phase 19: Storefront PaymentAttempt Hardening

**Goal:** endurecer o módulo existente para cartão autenticado M1, mantendo todo o fluxo pré-Order.

**Status:** Not started. Depends on Phase 18.

## Phase 20: Async Payment Confirmation

**Goal:** materializar confirmação BFF-only recuperável, rate-limited e financeiramente segura sob refresh, múltiplas abas e sucesso tardio.

**Status:** Not started. Depends on Phase 19.

## Phase 21: Order Confirmation & Catalog Handoff

**Goal:** entregar confirmação de pedido segura e catálogo resolvível/revalidável para o BFF.

**Status:** Not started. Depends on Phase 20.

## Phase 22: Contract Kit, Verification & Release

**Goal:** provar que o backend está pronto e entregar o kit que permite ao frontend desenvolver sem inventar contrato.

**Status:** Not started. Depends on Phase 21.

## Definition of Done

O milestone só pode fechar quando houver evidência PASS para todos os gates previstos: contratos Store/OpenAPI, autenticação, capability/concorrência e merge de carrinho, checkout BR/privacidade, Gelato shipping, PaymentAttempt/confirmation, order/catalog handoff, kit types/Zod/fixtures/mocks, contract tests, suites backend, migrations/constraints, drift/lint/build, security negative proofs e release verification aplicável.

Phase 15 CONTEXT, RESEARCH, PLAN and closure are HUMAN APPROVED — PASS;
Plans 15-01..15-08 are **8/8 HUMAN APPROVED — PASS** and Plans 15-07 and
15-08 are DOCUMENTALLY CLOSED. CART-01..CART-09 are 9/9 COMPLETE. Phase 16
CONTEXT is **AUTHORIZED — NOT STARTED**; Phase-16 RESEARCH and later gates,
provider real, infraestrutura remota, deploy and frontend remain unauthorized.
