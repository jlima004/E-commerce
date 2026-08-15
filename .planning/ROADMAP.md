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
- `14-01`..`14-13` estão HUMAN APPROVED — PASS;
- `14-07`..`14-13` estão DOCUMENTALLY CLOSED;
- `B14-13-HR-01` está CLOSED — PASS;
- `14-14` está **AUTHORIZED FOR EXECUTION / NOT STARTED**;
- `14-15`..`14-21` permanecem **NOT AUTHORIZED**;
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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 13/21 plans HUMAN APPROVED — PASS; 39/63 tasks complete; 14-13 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-14 AUTHORIZED FOR EXECUTION |
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
- 63 tasks totais / **39 complete**.
- **13/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-13 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `B14-13-HR-01 CLOSED — PASS`.
- `14-14 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-15..14-21 NOT AUTHORIZED`.
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
- [ ] `14-14-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
- [ ] `14-15-PLAN.md` — NOT AUTHORIZED
- [ ] `14-16-PLAN.md` — NOT AUTHORIZED
- [ ] `14-17-PLAN.md` — NOT AUTHORIZED
- [ ] `14-18-PLAN.md` — NOT AUTHORIZED
- [ ] `14-19-PLAN.md` — NOT AUTHORIZED
- [ ] `14-20-PLAN.md` — NOT AUTHORIZED
- [ ] `14-21-PLAN.md` — NOT AUTHORIZED

### Accepted closure references

Detailed accepted evidence is preserved in the corresponding summaries, especially:

- `14-07-SUMMARY.md` — persistence/collision audit/migration exact-set;
- `14-08-SUMMARY.md` — auth rate limits/timing/Redis fail-closed;
- `14-09-SUMMARY.md` — auth notification outbox/reconciliation;
- `14-10-SUMMARY.md` — session/JWT/refresh rotation;
- `14-11-SUMMARY.md` — PostgreSQL access guard/custom refresh-revoke surface;
- `14-12-SUMMARY.md` — verification latest-wins/one-winner domain;
- `14-13-SUMMARY.md` — exact verification Store surface and HTTP contracts.

### 14-13 closure

`14-13` fechou a superfície HTTP de verification após os gates de access guard e domínio:

- exatamente quatro Store operations estão `M1_ENABLED`:
  - `POST /store/customers/me/verify`
  - `POST /store/customers/verify/resend`
  - `POST /store/customers/verify`
  - `GET /store/customers/me/verify/status`
- request/status autenticados passam pelo `customerAuthAccessGuard` PostgreSQL;
- request usa limiter `3/lineage/h + 10/IP/h`, com HMAC-derived keys e Redis outage fail-closed;
- resend público preserva `202 REQUEST_ACCEPTED` uniforme e timing anti-enumeração;
- confirm público permanece no-session e não emite JWT/refresh;
- raw Customer, native `/auth/verification/*`, aliases e unknown Customer paths continuam DENY;
- `B14-13-HR-01 CLOSED — PASS`: runtime-acquisition failure do resend agora recebe exatamente uma aplicação do timing envelope antes do `202`, sem double timing;
- focused HTTP final 12/12 PASS;
- backend build PASS;
- ESLint direto 0 erros, 7 advisory/existing warnings;
- wrapper lint mantém falha conhecida por JSON vazio/EOF, aceita como tooling não bloqueante;
- `git diff --check` PASS;
- remote technical head pós-aprovação/push manual: `ff8036fb596eb937d51f229ae43b24eedce80373`;
- `14-13-03 HUMAN APPROVED — PASS`;
- `14-13 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.

Nenhuma migration/schema, dependency, provider real, persistência remota ou deploy foi executado.

### 14-14 authorization

Por autorização humana explícita, `14-14-PLAN.md` está **AUTHORIZED FOR EXECUTION / NOT STARTED**.

A autorização cobre somente o registration domain/workflow previsto no plano:

- `14-14-01`: implementar coordinator/recovery/mismatch em `registration.ts`, workflow `register-customer.ts` e unit/fault tests;
- `14-14-02`: executar prova PostgreSQL descartável de concorrência, partial recovery, mismatch/TTL e zero Order;
- criação de `14-14-SUMMARY.md` e validações locais previstas pelo plano.

`14-14-03` permanece **BLOCKING HUMAN VERIFY**. A execução deve parar nesse checkpoint antes de qualquer `14-15`.

Regras vinculantes:

- signup/login HTTP continuam DENY durante 14-14;
- identity sem Customer deve retomar por 24h e concorrência deve convergir para um único Customer/result;
- payload/password incompatível deve produzir zero write e nunca substituir senha pendente;
- completion pode criar initial lineage/refresh e verification intent+outbox exatamente uma vez, conforme contratos aprovados;
- provider delivery não pode bloquear completion;
- zero Order/Payment/Stripe/Gelato side effect;
- `14-15` ou planos posteriores não estão autorizados;
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

14-01..14-13:
HUMAN APPROVED — PASS

14-07..14-13:
DOCUMENTALLY CLOSED

B14-13-HR-01:
CLOSED — PASS

Phase 14 plans human-approved executed:
13/21

Phase 14 tasks complete:
39/63

14-14:
AUTHORIZED FOR EXECUTION / NOT STARTED

14-14-03:
BLOCKING HUMAN VERIFY after Tasks 14-14-01/02

14-15..14-21:
NOT AUTHORIZED

Next blocking gate:
14-14-03 human review

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
*Roadmap opened: 2026-08-06 · 10 phases · updated 2026-08-15 — Phase 13 HUMAN APPROVED — CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-13 HUMAN APPROVED — PASS; 21 plans/21 serial waves/63 tasks/39 complete; 14-07..14-13 DOCUMENTALLY CLOSED; B14-13-HR-01 CLOSED — PASS; 14-14 AUTHORIZED FOR EXECUTION; 14-15..14-21 NOT AUTHORIZED; deploy NOT AUTHORIZED; real providers NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated · no auto-chain*
