# Roadmap: Milestone v1.1 — Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependências que impedem o Frontend Milestone 1 de começar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfície Store autorizada, autenticação, capability/concorrência de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmação assíncrona, confirmação de pedido/catálogo e kit contratual verificável.

**Core invariant:** `Order` continua existindo somente após confirmação confiável do pagamento pelo webhook Stripe canônico; nenhuma operação Store, BFF ou browser pode criá-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN — **2/10 phases closed**, **17/91 requirements complete**.

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
- Phase 15 está **AUTHORIZED — CONTEXT NOT STARTED**
- Phase-15 RESEARCH e gates posteriores permanecem não autorizados até revisão humana própria
- deploy, real Resend/real providers, remote infra e frontend permanecem não autorizados/bloqueados

## Milestones

| Milestone | Status | Phases | Requirements |
|---|---|---:|---:|
| v1.0 — Backend MVP | COMPLETE / CLOSED / ARCHIVED / IMMUTABLE | 13/13 | 45/45 |
| v1.1 — Backend Storefront Readiness | OPEN | **2/10 closed** | **17/91** |

O snapshot histórico de v1.0 permanece em `milestones/v1.0-ROADMAP.md`. A tag e a GitHub Release `v1.0` são imutáveis e não participam deste milestone.

## Phases

| Phase | Nome | Depends on | Requirements | Estado |
|---:|---|---|---:|---|
| 13 | Storefront Contract Foundation & Surface Lockdown | v1.0 | 8 | CLOSED — HUMAN APPROVED; 7/7 plans; 8/8 requirements |
| 14 | Customer Auth & Verification | 13 | 9 | **CLOSED — HUMAN APPROVED; 21/21 plans; 63/63 tasks; 9/9 requirements** |
| 15 | Guest Cart Capability & Concurrency | 14 | 9 | **AUTHORIZED — CONTEXT NOT STARTED** |
| 16 | Cart Merge & Review | 15 | 8 | Not started |
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
- Phase 15 CONTEXT AUTHORIZED / NOT STARTED.
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

**Status:** **AUTHORIZED — CONTEXT NOT STARTED.** Depends on Phase 14 CLOSED.

Authorization is limited to producing/reviewing the Phase-15 CONTEXT artifact. RESEARCH and later gates remain separately human-gated.

## Phase 16: Cart Merge & Review

**Goal:** substituir attach simples por merge transacional, idempotente, parcial e revisável.

**Status:** Not started. Depends on Phase 15.

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

Phase 15 CONTEXT is explicitly authorized by the human after Phase-14 closure. No later Phase-15 gate, provider real, infraestrutura remota, deploy ou frontend is automatically authorized.
