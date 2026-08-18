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
- `14-01..14-17` estão HUMAN APPROVED — PASS
- `14-07..14-17` estão DOCUMENTALLY CLOSED
- `B14-13-HR-01`, `B14-14-HR-01`, `B14-15-HR-01..04`, `B14-16-HR-01..03` e `B14-17-HR-01` estão CLOSED — PASS
- `14-18` está **AUTHORIZED FOR EXECUTION / NOT STARTED**
- `14-19..14-21` permanecem **NOT AUTHORIZED**
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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 17/21 plans HUMAN APPROVED — PASS; 51/63 tasks complete; 14-17 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-18 AUTHORIZED FOR EXECUTION |
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
- 63 tasks totais / **51 complete**.
- **17/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-17 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `B14-17-HR-01 CLOSED — PASS`.
- `14-18 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-19..14-21 NOT AUTHORIZED`.
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
- [ ] `14-18-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
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
- `14-17-SUMMARY.md` — current-password proof, originating-lineage-bound resume-only, global credential invalidation and controlled password-change handler

### 14-15 closure

`14-15` publicou signup/login/current-state sem abrir raw Customer/Auth e estabeleceu o BFF service authentication boundary explícito. Browser-direct Phase 14 calls são negados antes de business handler; CORS/publishable permanecem defense-in-depth, not authorization. `CUSTOMER_AUTH_BFF_SERVICE_SECRET` + `x-indicio-bff-auth` formam a caller credential server-side. O login finaliza timing at-most-once e os predecessor exact-sets permanecem estritos.

Human-pushed technical head antes da closure 14-15: `10d7022cfd79781f52676d496454d9b4962f6072`.

### 14-16 closure

`14-16` materializou e fechou o password reset composto sem enfraquecer o BFF boundary.

Accepted reset invariants incluem anti-enumeration uniforme, capability hash-only/TTL 15m, 14-08 pre/post/dummy antes de trabalho protegido, fresh `update → verify`, ambiguous same-key `verify → optional update → verify`, global revoke, no-session, unverified-stays-unverified, reconciler secretless e lease PostgreSQL exclusiva.

```text
B14-16-HR-01: CLOSED — PASS
B14-16-HR-02: CLOSED — PASS
B14-16-HR-03: CLOSED — PASS
```

Human-pushed execution/remediation head before documentary closure: `c2c0ef43121d5f2d884951dffd5257e6aebf6ec5`.

### 14-17 closure

`14-17` materializou password change sem publicar a rota antes do runtime gate.

Accepted invariants:

- stable access + current-password proof antes do claim;
- wrong-current = zero-write;
- fresh new password = `update → verify`;
- ambiguous permanece fail-closed;
- recovery exige same `Idempotency-Key`, originating lineage/SID e `newPassword` reapresentada;
- operation id usa HMAC domain v2 com binding criptográfico ao originador;
- sibling lineage da mesma identity/customer não pode assumir recovery;
- post-revoke, somente o JWT/lineage originador pode usar resume-only para sua própria operação;
- `204` somente após provider proof + credential-version bump + global lineage/refresh revoke;
- no substitute session e verification state preservado;
- Store password path ainda DENY no fechamento 14-17;
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects.

Human-review blocker fechado:

```text
B14-17-HR-01: CLOSED — PASS
```

Final evidence:

```text
password-change focused: PASS — 24/24
password-change full: PASS — 30/30
auth-customer: PASS — 36/36
auth-verification: PASS — 15/15
auth-reset: PASS — 19/19
auth-multiprocess: PASS — 10/10 + cleanup
BFF unit: PASS — 10/10
combined focused Phase 14 HTTP: PASS — 100/100
build: PASS
ESLint direto: 0 errors
git diff --check: PASS
remote infra/providers: NONE
lint wrapper: KNOWN TOOLING FAILURE — empty JSON / EOF
```

Human-pushed execution/remediation head before documentary closure: `46d90ba4514e5e40ae0bf47aaae91b1df77689d3`.

No migration/schema/dependency, provider real, remote persistence, deploy ou frontend work foi autorizado por esta closure.

### 14-18 authorization

By explicit human authorization, `14-18-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The plan closes credential-operation reconciliation and the final Phase-14 runtime exact-set:

- `14-18-01`: implement generic secretless reset/password-change reconciler, reset delegation, worker-only job and disposable-PostgreSQL claim/lease/CAS/backoff/reclaim evidence;
- `14-18-02`: only after the PostgreSQL PASS, elevate exactly `POST /store/customers/me/password` and close final Store/Auth manifests, middleware and config defenses;
- `14-18-03`: **BLOCKING HUMAN VERIFY**; execution stops there.

Binding restrictions:

- reconciler never calls provider update/verify, invents proof or completes an ambiguous operation without request-side secret proof;
- reset delegation preserves reset-specific prohibitions;
- batch 25, lease 2m, operation-version CAS and approved backoff remain PostgreSQL-authoritative;
- two workers must converge to one claimant; reclaim only after expiry;
- job does not execute scanner work outside worker mode;
- password path elevation is forbidden before the required disposable-PostgreSQL PASS;
- password change is the only new runtime elevation in 14-18;
- raw customers, native session/callback/MFA/verification/refresh/reset and aliases remain DENY;
- API Docs/JSON generated contracts remain untouched;
- `14-19..14-21` remain NOT AUTHORIZED;
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

14-01..14-17: HUMAN APPROVED — PASS
14-07..14-17: DOCUMENTALLY CLOSED

Phase 14 plans human-approved executed: 17/21
Phase 14 tasks complete: 51/63

B14-15-HR-01..HR-04: CLOSED — PASS
B14-16-HR-01..HR-03: CLOSED — PASS
B14-17-HR-01: CLOSED — PASS

14-18: AUTHORIZED FOR EXECUTION / NOT STARTED
14-18-01: AUTHORIZED
14-18-02: AUTHORIZED only after prerequisite 14-18-01 disposable-PostgreSQL PASS
14-18-03: BLOCKING HUMAN VERIFY

14-19..14-21: NOT AUTHORIZED

Next blocking gate: 14-18-03 human review
Milestone requirements complete: 8/91
Deploy: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
Frontend Milestone 1: BLOCKED / not started / not authorized
```

---
*Roadmap updated: 2026-08-17 — Phase 13 CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-17 HUMAN APPROVED — PASS; 17/21 plans / 51/63 tasks; 14-07..14-17 DOCUMENTALLY CLOSED; B14-17-HR-01 CLOSED — PASS; 14-18 AUTHORIZED FOR EXECUTION; 14-19..14-21 NOT AUTHORIZED; deploy/providers/remote infra NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated; no auto-chain*
