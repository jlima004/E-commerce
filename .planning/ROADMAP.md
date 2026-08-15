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
- `14-01`..`14-11` estão HUMAN APPROVED — PASS;
- `14-07`..`14-11` estão DOCUMENTALLY CLOSED;
- `14-12` está **AUTHORIZED FOR EXECUTION / NOT STARTED**;
- `14-13`..`14-21` permanecem **NOT AUTHORIZED**;
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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 11/21 plans HUMAN APPROVED — PASS; 33/63 tasks complete; 14-11 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-12 AUTHORIZED FOR EXECUTION |
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
**Manual blockers/gates:** não ativar cegamente política Medusa conflitante; decisão de módulo próprio e retenção exige os gates aprovados; cada plano mantém checkpoint próprio quando definido.

### Execution status

- 21 planos em 21 waves estritamente seriais (`14-01 → ... → 14-21`).
- 63 tasks totais / **33 complete**.
- **11/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-11 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `14-12 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-13..14-21 NOT AUTHORIZED`.
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
- [ ] `14-12-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
- [ ] `14-13-PLAN.md` — NOT AUTHORIZED
- [ ] `14-14-PLAN.md` — NOT AUTHORIZED
- [ ] `14-15-PLAN.md` — NOT AUTHORIZED
- [ ] `14-16-PLAN.md` — NOT AUTHORIZED
- [ ] `14-17-PLAN.md` — NOT AUTHORIZED
- [ ] `14-18-PLAN.md` — NOT AUTHORIZED
- [ ] `14-19-PLAN.md` — NOT AUTHORIZED
- [ ] `14-20-PLAN.md` — NOT AUTHORIZED
- [ ] `14-21-PLAN.md` — NOT AUTHORIZED

### 14-07 closure

`14-07` materializou a persistência customer-auth com collision audit persistido antes da geração final, migration CLI única `Migration20260814004448.ts`, exact-set 7/7, service-only CAS/`FOR UPDATE`, PostgreSQL descartável 9/9, focused unit 28/28, build PASS e checkpoint humano PASS. Nenhuma migration remota/persistente, provider real ou deploy foi executado.

### 14-08 closure

`14-08` fechou P14-D11 com policy map nominal de rate limit auth, HMAC domain-separated/versionado, normalização P14-D12, Redis atomic counters cross-process, thresholds exatos, outage fail-closed `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60`, matrizes públicas de 1000 amostras, median delta 0 ms, p95 38 ms sobre floor, focused unit 50/50, HTTP/Redis 27/27, negative proof de `newPassword`, `git diff --check` PASS e `14-08-03 HUMAN APPROVED — PASS`.

### 14-09 closure

`14-09` fechou o Auth Notification Outbox P14-D10 com outbox transacional PostgreSQL, capability auth rederivada somente em memória, recipient boundary sancionada com P14-D12 e constant-time hash check, dead-letter + canonical sanitized operational alert para recipient missing/mismatch, scope amendment do módulo operational-alert com `Migration20260814030000.ts`, retry/reconcile convergente, previous-key +24h operational retention invariant, Event Bus structural/runtime negative proof, focused unit 45/45, customer-auth unit 157/157, disposable PG 21/21, operational-alert 50/50, build/lint/diff PASS e `B14-09-HR-01..06 CLOSED — PASS`. Nenhuma chamada a provider real, deploy ou persistência remota foi executada.

### 14-10 closure

`14-10` fechou P14-D06/P14-D07 no domínio de session lineage/JWT/refresh antes de qualquer access guard HTTP:

- PostgreSQL permanece autoridade de validade; Redis não concede sessão/refresh;
- access JWT de 10 minutos com `sid`, `cv`, `jti`, identity/customer e deadline absoluto;
- refresh opaco de 32 bytes base64url com somente SHA-256 persistido;
- N single-use cria exatamente um N+1 sob concorrência;
- same-key recovery <=45s rederiva o mesmo N+1 enquanto unused e nunca cria N+2;
- replay divergente, fora da janela ou após uso do descendant revoga lineage/family;
- refresh inactivity de sete dias e absolute deadline de 30 dias preservam `originalAuthenticatedAt` em todas as rotações;
- `B14-10-HR-01` e `B14-10-HR-02` foram fechados sem editar migration/schema;
- final session unit 9/9 PASS;
- disposable PostgreSQL 4/4 PASS com cleanup;
- backend build/lint/diff PASS;
- `14-10-03 HUMAN APPROVED — PASS`;
- `14-10 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.

### 14-11 closure

`14-11` fechou o access guard PostgreSQL e a superfície custom refresh/revoke P14-D07:

- JWT válido isoladamente nunca concede acesso; PostgreSQL valida lineage, sid, identity/customer ownership, credential version, stable state e absolute deadline;
- DB outage/inconsistência falha fechado antes do handler;
- Redis vazio/outage não concede validade;
- revoke/replay/version bump/deadline são observados cross-process;
- somente `POST /auth/token/refresh` e `POST /auth/customer/emailpass/revoke-current-lineage` estão `PHASE14_ENABLED`;
- native refresh/session, aliases e demais operações auth permanecem `DENY`;
- `B14-11-HR-01 CLOSED — PASS`: revoke guardado foi corrigido para idempotência HTTP real, permitindo lineage já `revoked` apenas no exato `POST /auth/customer/emailpass/revoke-current-lineage`, preservando JWT/sid/ownership/cv/stable/deadline/PostgreSQL e mantendo acesso normal revogado em 401;
- focused HTTP disposable PostgreSQL 8/8 PASS com cleanup;
- backend build PASS;
- ESLint direto 0 erros; falha conhecida do wrapper `medusa lint` por JSON vazio foi aceita como tooling não bloqueante sem alteração de packages/tooling;
- `git diff --check` PASS;
- remote technical head pré-closure: `a73bb7e8d209f2780a3d49ab4c74c5310f42aa62`;
- `14-11-03 HUMAN APPROVED — PASS`;
- `14-11 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.

Nenhuma migration/schema, provider real, persistência remota ou deploy foi executado.

### 14-12 authorization

Por autorização humana explícita, `14-12-PLAN.md` está **AUTHORIZED FOR EXECUTION / NOT STARTED**.

A autorização cobre:
- `14-12-01`: implementar o domínio verification latest-wins/one-winner em `verification.ts` e unit tests no escopo exato do plano;
- `14-12-02`: executar prova local descartável PostgreSQL de concorrência/provider/leakage no arquivo de integração autorizado;
- criação de `14-12-SUMMARY.md` e validações locais previstas pelo plano.

`14-12-03` permanece **BLOCKING HUMAN VERIFY**. A execução deve parar nesse checkpoint antes de qualquer `14-13`.

Continuam proibidos:
- `14-13` ou planos posteriores;
- elevar endpoints de verification ou Store neste plano;
- native verification route/event/provider metadata;
- auto-chain;
- deploy/release;
- real Resend ou qualquer provider real;
- DB/Redis remoto ou persistente;
- frontend;
- instalação de dependências;
- migration/schema ou expansão de escopo sem autorização separada.

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

14-01..14-11:
HUMAN APPROVED — PASS

14-07..14-11:
DOCUMENTALLY CLOSED

14-11-03:
HUMAN APPROVED — PASS

B14-11-HR-01:
CLOSED — PASS

Phase 14 plans human-approved executed:
11/21

Phase 14 tasks complete:
33/63

14-12:
AUTHORIZED FOR EXECUTION / NOT STARTED

14-12-03:
BLOCKING HUMAN VERIFY after Tasks 14-12-01/02

14-13..14-21:
NOT AUTHORIZED

Next blocking gate:
14-12-03 human review

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
*Roadmap opened: 2026-08-06 · 10 phases · updated 2026-08-15 — Phase 13 HUMAN APPROVED — CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-11 HUMAN APPROVED — PASS; 21 plans/21 serial waves/63 tasks/33 complete; 14-07..14-11 DOCUMENTALLY CLOSED; 14-12 AUTHORIZED FOR EXECUTION; 14-13..14-21 NOT AUTHORIZED; deploy NOT AUTHORIZED; real providers NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated · no auto-chain*
