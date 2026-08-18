# Roadmap: Milestone v1.1 — Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependências que impedem o Frontend Milestone 1 de começar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfície Store autorizada, autenticação, capability/concorrência de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmação assíncrona, confirmação de pedido/catálogo e kit contratual verificável.

**Core invariant:** `Order` continua existindo somente após confirmação confiável do pagamento pelo webhook Stripe canônico; nenhuma operação Store, BFF ou browser pode criá-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN — 1/10 phases closed (Phase 13 HUMAN APPROVED — CLOSED), 8/91 requirements complete.

## Governança

- `mode = interactive`
- `workflow.auto_advance = false`
- `workflow._auto_chain_active = false`
- `parallelization = false`
- sequência obrigatória: `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`
- cada gate CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW e CLOSURE permanece sujeito à revisão humana aplicável
- Phase 13 está CLOSED — HUMAN APPROVED, FND-01..FND-08 COMPLETE
- Phase 14 CONTEXT, RESEARCH, PLAN, SPEC/SDD e Implementation Prompt estão HUMAN APPROVED — PASS
- execução Phase 14 permanece estritamente serial e manual-gated
- `14-01..14-16` estão HUMAN APPROVED — PASS
- `14-07..14-16` estão DOCUMENTALLY CLOSED
- `B14-13-HR-01`, `B14-14-HR-01`, `B14-15-HR-01..04` e `B14-16-HR-01..03` estão CLOSED — PASS
- `14-17` está **AUTHORIZED FOR EXECUTION / NOT STARTED**
- `14-18..14-21` permanecem **NOT AUTHORIZED**
- deploy, real Resend/real providers, remote infra e frontend permanecem não autorizados/bloqueados

## Milestones

| Milestone | Status | Phases | Requirements |
|---|---|---:|---:|
| v1.0 — Backend MVP | COMPLETE / CLOSED / ARCHIVED / IMMUTABLE | 13/13 | 45/45 |
| v1.1 — Backend Storefront Readiness | OPEN | 1/10 closed | 8/91 |

O snapshot histórico de v1.0 permanece em `milestones/v1.0-ROADMAP.md`. A tag e a GitHub Release `v1.0` são imutáveis e não participam deste milestone.

## Phases

| Phase | Nome | Depends on | Requirements | Estado |
|---:|---|---|---:|---|
| 13 | Storefront Contract Foundation & Surface Lockdown | v1.0 | 8 | CLOSED — HUMAN APPROVED; 7/7 plans; 8/8 requirements |
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 16/21 plans HUMAN APPROVED — PASS; 48/63 tasks complete; 14-16 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-17 AUTHORIZED FOR EXECUTION |
| 15 | Guest Cart Capability & Concurrency | 14 | 9 | Not started |
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

## Phase 14: Customer Auth & Verification

**Goal:** entregar identidade/Customer, login, reset, refresh e verificação sem contrariar a política de sessão inicial não verificada.

**Depends on:** Phase 13 closed.  
**Requirements:** AUTH-01–AUTH-09.  
**Deliverables:** operações auth/Customer, política flexível, estado/token de verificação, outbox auth quando necessário, rate limits e anti-enumeração.  
**Exit criteria:** cadastro coordenado; sessão inicial compra; novo login não verificado bloqueado; reset/update revogam credenciais antigas; refresh inválido falha; tokens são hash-only/uso único/expiráveis.  
**Manual blockers/gates:** cada plano mantém checkpoint próprio; nenhuma autorização avança automaticamente.

### Execution status

- 21 planos em 21 waves estritamente seriais (`14-01 → ... → 14-21`).
- 63 tasks totais / **48 complete**.
- **16/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-16 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `B14-16-HR-01..03 CLOSED — PASS`.
- `14-17 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-18..14-21 NOT AUTHORIZED`.
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
- [ ] `14-17-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
- [ ] `14-18-PLAN.md` — NOT AUTHORIZED
- [ ] `14-19-PLAN.md` — NOT AUTHORIZED
- [ ] `14-20-PLAN.md` — NOT AUTHORIZED
- [ ] `14-21-PLAN.md` — NOT AUTHORIZED

### Accepted closure references

Detailed accepted evidence is preserved in the corresponding summaries:

- `14-07-SUMMARY.md` — persistence/collision audit/migration exact-set
- `14-08-SUMMARY.md` — auth rate limits/timing/Redis fail-closed
- `14-09-SUMMARY.md` — auth notification outbox/reconciliation
- `14-10-SUMMARY.md` — session/JWT/refresh rotation
- `14-11-SUMMARY.md` — PostgreSQL access guard/custom refresh-revoke surface
- `14-12-SUMMARY.md` — verification latest-wins/one-winner domain
- `14-13-SUMMARY.md` — exact verification Store surface and HTTP contracts
- `14-14-SUMMARY.md` — registration coordinator/recovery/concurrency/completed-terminal contract
- `14-15-SUMMARY.md` — signup/login/me surface, exactly-once timing remediation, BFF service authentication boundary, predecessor exact-set regressions and config-contract cleanup
- `14-16-SUMMARY.md` — composed password reset, fresh/recovery provider-proof split, exclusive PostgreSQL recovery lease, exactly-once request timing and guarded reset surface

### 14-15 closure

`14-15` publicou signup/login/current-state sem abrir raw Customer/Auth e estabeleceu o BFF service authentication boundary explícito. Browser-direct Phase 14 calls são negados antes de business handler; CORS/publishable permanecem defense-in-depth, não authorization. `CUSTOMER_AUTH_BFF_SERVICE_SECRET` + `x-indicio-bff-auth` formam a caller credential server-side. O login finaliza timing at-most-once e os predecessor exact-sets permanecem estritos.

Human-pushed technical head antes da closure 14-15: `10d7022cfd79781f52676d496454d9b4962f6072`.

### 14-16 closure

`14-16` materializou e fechou o password reset composto sem enfraquecer o BFF boundary ou abrir password-change 14-17.

Accepted reset invariants:

- request anti-enumerável com envelope uniforme `202 REQUEST_ACCEPTED` para known/unknown/limited/Redis-outage/provider-delivery failure;
- capability hash-only e TTL exato de 15 minutos;
- `newPassword` somente em memória;
- confirm usa o protocolo 14-08 pre/post/dummy antes de lookup/claim/provider/write;
- fresh reset é obrigatoriamente `update → verify`;
- ambiguous same-key recovery é `verify → optional one update → verify`;
- different key não assume recovery;
- provider ambiguity não cria proof autoritativa e mantém login/refresh/access fail-closed;
- success exige provider proof + credential-version bump + global revoke + reset intent completed/consumed;
- reset nunca emite sessão e nunca verifica e-mail;
- secretless reconciler não pode verificar/atualizar password nem completar sem proof;
- recovery lease é exclusiva no PostgreSQL, com eligibility `lease claimable AND retry due` e CAS por versão/status;
- fresh lease bloqueia outro worker e reclaim só ocorre em `lease_until <= now`;
- reset-request timing é exactly-once mesmo quando a Promise de timing rejeita;
- reset request/update estão no exact-set BFF e native reset/update permanecem DENY;
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects.

Human-review blockers fechados:

```text
B14-16-HR-01: CLOSED — PASS
B14-16-HR-02: CLOSED — PASS
B14-16-HR-03: CLOSED — PASS
```

Final evidence:

```text
reset unit: PASS — 13/13
reset PostgreSQL: PASS — 6/6 + cleanup, incluindo two-worker lease proof
reset HTTP: PASS — 19/19
auth-customer: PASS — 36/36
auth-verification: PASS — 15/15
auth-multiprocess: PASS — 10/10
BFF unit: PASS — 10/10
combined focused HTTP: PASS — 70/70
build: PASS
ESLint direto: 0 errors
git diff --check: PASS
local Redis: HEALTHY
remote infra: NONE
lint wrapper: KNOWN TOOLING FAILURE — empty JSON / EOF
```

Human-pushed execution/remediation head before documentary closure: `c2c0ef43121d5f2d884951dffd5257e6aebf6ec5`.

No migration/schema/dependency, provider real, remote persistence, deploy ou frontend work foi autorizado por esta closure.

### 14-17 authorization

By explicit human authorization, `14-17-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The plan remains intentionally pre-publication:

- `14-17-01`: implement password-change domain with stable access + current-password proof before claim, same-key ambiguous resume and global revoke;
- `14-17-02`: implement/prove the strict Store handler while `POST /store/customers/me/password` remains DENY in the external Store manifest;
- `14-17-03`: **BLOCKING HUMAN VERIFY**; execution stops there.

Binding restrictions:

- wrong current password is zero-write;
- after claim, ordinary access/login/refresh remains fail-closed;
- ambiguous resume is limited to the same identity/customer/operation key and same `Idempotency-Key` with `newPassword` re-presented;
- resume-only authorization cannot open another handler;
- 204 requires provider proof, credential-version bump and global lineage revoke;
- no substitute session;
- secretless code cannot prove/update/complete password change;
- Store password path remains externally DENY throughout 14-17;
- reconciler/job/runtime publication remains for a later explicitly authorized plan, notably 14-18;
- `14-18..14-21` remain NOT AUTHORIZED;
- auto-chain forbidden; deploy/release, real providers, remote infrastructure and frontend remain unauthorized.

## Phase 15: Guest Cart Capability & Concurrency

**Goal:** substituir a sessão como prova principal de posse por capability opaca e tornar mutações concorrentes seguras.

**Status:** Not started. Depends on Phase 14 closed.

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

O milestone só pode fechar quando houver evidência `PASS` para todos os gates previstos no milestone: PRD/SRS/traceability, DB model, Store/OpenAPI/contracts, auth, cart/merge, checkout BR/privacidade, Gelato shipping, payment/confirmation, order/catalog handoff, kit types/Zod/fixtures/mocks, contract tests, suites backend, migrations/constraints, drift/lint/build, security negative proofs, controlled provider validation e authorized release validation.

Somente após todos os gates e revisão humana:

```text
Backend Storefront Readiness: PASS
PASS DOCUMENTAL: PASS
PASS PARA MOCK DEVELOPMENT: PASS
PASS PARA INTEGRAÇÃO: PASS
Frontend Milestone 1: AUTHORIZED TO START
```

## Current Gate

```text
Milestone v1.0: archived / immutable
Milestone v1.1: OPEN — NOT CLOSED

Phase 13: CLOSED — HUMAN APPROVED
7/7 plans
FND-01..FND-08 COMPLETE

Phase 14 prerequisites:
CONTEXT: HUMAN APPROVED — PASS
RESEARCH: HUMAN APPROVED — PASS
PLAN: HUMAN APPROVED — PASS
SPEC/SDD: HUMAN APPROVED — PASS
IMPLEMENTATION PROMPT: HUMAN APPROVED — PASS

14-01..14-16: HUMAN APPROVED — PASS
14-07..14-16: DOCUMENTALLY CLOSED

Phase 14 plans human-approved executed: 16/21
Phase 14 tasks complete: 48/63

B14-15-HR-01..HR-04: CLOSED — PASS
B14-16-HR-01..HR-03: CLOSED — PASS

14-17: AUTHORIZED FOR EXECUTION / NOT STARTED
14-17-01: AUTHORIZED
14-17-02: AUTHORIZED after prerequisite 14-17-01 evidence
14-17-03: BLOCKING HUMAN VERIFY

14-18..14-21: NOT AUTHORIZED

Next blocking gate: 14-17-03 human review
Milestone requirements complete: 8/91
Deploy: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
Frontend Milestone 1: BLOCKED / not started / not authorized
```

---
*Roadmap updated: 2026-08-17 — Phase 13 CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-16 HUMAN APPROVED — PASS; 16/21 plans / 48/63 tasks; 14-07..14-16 DOCUMENTALLY CLOSED; B14-16-HR-01..03 CLOSED — PASS; 14-17 AUTHORIZED FOR EXECUTION; 14-18..14-21 NOT AUTHORIZED; deploy/providers/remote infra NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated; no auto-chain*
