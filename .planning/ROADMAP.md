# Roadmap: Milestone v1.1 — Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependências que impedem o Frontend Milestone 1 de começar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfície Store autorizada, autenticação, capability/concorrência de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmação assíncrona, confirmação de pedido/catálogo e kit contratual verificável.

**Core invariant:** `Order` continua existindo somente após confirmação confiável do pagamento pelo webhook Stripe canônico; nenhuma operação Store, BFF ou browser pode criá-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN — 1/10 phases closed (Phase 13 HUMAN APPROVED — CLOSED), 8/91 requirements complete.

## Governança

- `mode = interactive`;
- `workflow.auto_advance = false`;
- `workflow._auto_chain_active = false`;
- `parallelization = false`;
- sequência obrigatória: `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`;
- cada gate CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW e CLOSURE permanece sujeito à revisão humana aplicável;
- Phase 13 está CLOSED — HUMAN APPROVED, FND-01..FND-08 COMPLETE;
- Phase 14 CONTEXT, RESEARCH, PLAN, SPEC/SDD e Implementation Prompt estão HUMAN APPROVED — PASS;
- execução Phase 14 permanece estritamente serial e manual-gated;
- `14-01`..`14-14` estão HUMAN APPROVED — PASS;
- `14-07`..`14-14` estão DOCUMENTALLY CLOSED;
- `B14-13-HR-01` e `B14-14-HR-01` estão CLOSED — PASS;
- `14-15` está **AUTHORIZED FOR EXECUTION / NOT STARTED**;
- `14-16`..`14-21` permanecem **NOT AUTHORIZED**;
- deploy, real Resend/real providers e frontend permanecem não autorizados/bloqueados.

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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 14/21 plans HUMAN APPROVED — PASS; 42/63 tasks complete; 14-14 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-15 AUTHORIZED FOR EXECUTION |
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
- 63 tasks totais / **42 complete**.
- **14/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-14 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `B14-14-HR-01 CLOSED — PASS`.
- `14-15 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-16..14-21 NOT AUTHORIZED`.
- Deploy NOT AUTHORIZED.
- Real Resend / real providers NOT AUTHORIZED.
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
- [ ] `14-15-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
- [ ] `14-16-PLAN.md` — NOT AUTHORIZED
- [ ] `14-17-PLAN.md` — NOT AUTHORIZED
- [ ] `14-18-PLAN.md` — NOT AUTHORIZED
- [ ] `14-19-PLAN.md` — NOT AUTHORIZED
- [ ] `14-20-PLAN.md` — NOT AUTHORIZED
- [ ] `14-21-PLAN.md` — NOT AUTHORIZED

### Accepted closure references

Detailed accepted evidence is preserved in the corresponding summaries:

- `14-07-SUMMARY.md` — persistence/collision audit/migration exact-set;
- `14-08-SUMMARY.md` — auth rate limits/timing/Redis fail-closed;
- `14-09-SUMMARY.md` — auth notification outbox/reconciliation;
- `14-10-SUMMARY.md` — session/JWT/refresh rotation;
- `14-11-SUMMARY.md` — PostgreSQL access guard/custom refresh-revoke surface;
- `14-12-SUMMARY.md` — verification latest-wins/one-winner domain;
- `14-13-SUMMARY.md` — exact verification Store surface and HTTP contracts;
- `14-14-SUMMARY.md` — registration coordinator/recovery/concurrency/completed-terminal contract.

### 14-14 closure

`14-14` fechou o domínio/workflow de registration antes de qualquer elevação HTTP de signup/login:

- partial identity/Customer recovery por 24h;
- semantic HMAC sem password;
- password mismatch e semantic mismatch zero-write;
- PostgreSQL advisory lock + `FOR UPDATE` + CAS para convergência;
- `AsyncLocalStorage` como binding seguro da transaction seam por execução;
- exatamente uma identity, um Customer, um completed intent, uma credential state, uma initial lineage/refresh e um verification/outbox pair;
- provider delivery independente da completion;
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effect;
- `B14-14-HR-01 CLOSED — PASS`: completed signup deixa de ser recovery/login e agora rejeita `CUSTOMER_REGISTRATION_ALREADY_COMPLETED` sem authenticate, Customer/session/verification ou write;
- completed semantic mismatch continua `CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH`;
- unit final 15/15 PASS;
- disposable PostgreSQL final 14/14 PASS com cleanup;
- backend build PASS;
- ESLint direto 0 erros; wrapper lint mantém falha conhecida de JSON vazio/EOF, aceita como tooling não bloqueante;
- `git diff --check` PASS;
- remote head pré-closure: `84eb8c41b32521d22feb2beb07e6cb054101ea53`;
- `14-14-03 HUMAN APPROVED — PASS`;
- `14-14 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.

As falhas intermediárias de build e deadlock estão preservadas no SUMMARY como históricas/superseded pela evidência final PASS.

Nenhuma migration/schema, dependency, provider real, persistência remota ou deploy foi executado.

### 14-15 authorization

Por autorização humana explícita, `14-15-PLAN.md` está **AUTHORIZED FOR EXECUTION / NOT STARTED**.

A autorização cobre somente o plano aprovado:

- `14-15-01`: implementar `login.ts` e os handlers signup/login/current-state com TDD/HTTP evidence; signup deve aplicar HMAC buckets `5/IP/15m + 3/e-mail/h` antes de lookup/coordinator/write; login deve aplicar `10/(IP,e-mail)/15m + 30/IP/15m` antes do provider/identity lookup; Redis outage deve retornar 503 antes de mutation; missing/wrong/valid login devem preservar dummy scrypt/envelope/timing equivalentes; initial signup não verificado pode retornar sua initial lineage, mas novo login não verificado deve retornar `EMAIL_VERIFICATION_REQUIRED` sem criar lineage; verified login pode criar lineage; `GET /store/customers/me` deve usar o access guard PostgreSQL e DTO allowlisted;
- `14-15-02`: somente após a evidência HTTP da task anterior passar, elevar exatamente signup/login e `GET /store/customers/me` nos manifests/middleware aprovados; raw `POST /store/customers`, aliases, session/callback/MFA e browser-direct continuam DENY;
- criação de `14-15-SUMMARY.md` e validações locais previstas pelo plano.

`14-15-03` permanece **BLOCKING HUMAN VERIFY**. A execução deve parar nesse checkpoint antes de qualquer `14-16`.

Regras vinculantes:

- antes da execução/elevation do próprio 14-15, signup/login/me permanecem DENY;
- limiter deve executar antes de qualquer lookup/write nos caminhos signup/login;
- novo login de conta não verificada não pode criar lineage;
- `GET me` não pode vazar identity/provider/lineage/version/token metadata;
- raw Customer, aliases e native auth session/callback/MFA permanecem DENY;
- browser direct Origin/CORS continua negado; BFF permanece o boundary aprovado;
- zero Order/Stripe side effect;
- `14-16` ou planos posteriores não estão autorizados;
- auto-chain proibido;
- deploy/release não autorizado;
- real Resend ou qualquer provider real não autorizado;
- DB/Redis remoto ou persistente não autorizado;
- frontend bloqueado;
- dependency install, migration/schema ou expansão de escopo exigem autorização separada.

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

Phase 13:
CLOSED — HUMAN APPROVED
7/7 plans
FND-01..FND-08 COMPLETE

Phase 14 prerequisites:
CONTEXT: HUMAN APPROVED — PASS
RESEARCH: HUMAN APPROVED — PASS
PLAN: HUMAN APPROVED — PASS
SPEC/SDD: HUMAN APPROVED — PASS
IMPLEMENTATION PROMPT: HUMAN APPROVED — PASS

14-01..14-14:
HUMAN APPROVED — PASS

14-07..14-14:
DOCUMENTALLY CLOSED

B14-13-HR-01:
CLOSED — PASS

B14-14-HR-01:
CLOSED — PASS

Phase 14 plans human-approved executed:
14/21

Phase 14 tasks complete:
42/63

14-15:
AUTHORIZED FOR EXECUTION / NOT STARTED

14-15-01:
AUTHORIZED

14-15-02:
AUTHORIZED after Task 14-15-01 HTTP evidence PASS

14-15-03:
BLOCKING HUMAN VERIFY

14-16..14-21:
NOT AUTHORIZED

Next blocking gate:
14-15-03 human review

Milestone requirements complete:
8/91

Deploy:
NOT AUTHORIZED

REAL RESEND / REAL PROVIDERS:
NOT AUTHORIZED

Frontend Milestone 1:
BLOCKED / not started / not authorized
```

---
*Roadmap opened: 2026-08-06 · 10 phases · updated 2026-08-15 — Phase 13 HUMAN APPROVED — CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-14 HUMAN APPROVED — PASS; 21 plans/21 serial waves/63 tasks/42 complete; 14-07..14-14 DOCUMENTALLY CLOSED; B14-13-HR-01 and B14-14-HR-01 CLOSED — PASS; 14-15 AUTHORIZED FOR EXECUTION; 14-16..14-21 NOT AUTHORIZED; deploy NOT AUTHORIZED; real providers NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated · no auto-chain*
