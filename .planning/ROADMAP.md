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
- `14-01`..`14-09` estão HUMAN APPROVED — PASS;
- `14-07` está DOCUMENTALLY CLOSED;
- `14-08` está DOCUMENTALLY CLOSED;
- `14-09` está DOCUMENTALLY CLOSED;
- `14-10`..`14-21` permanecem **NOT AUTHORIZED**;
- deploy, real Resend e frontend permanecem não autorizados/bloqueados.

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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 9/21 plans HUMAN APPROVED — PASS; 27/63 tasks complete; 14-09 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-10 NOT AUTHORIZED |
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
- 63 tasks totais / **27 complete**.
- **9/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-09 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `14-10..14-21 NOT AUTHORIZED`.
- Deploy NOT AUTHORIZED.
- Real Resend NOT AUTHORIZED.
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
- [ ] `14-10-PLAN.md` — NOT AUTHORIZED
- [ ] `14-11-PLAN.md` — NOT AUTHORIZED
- [ ] `14-12-PLAN.md` — NOT AUTHORIZED
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

`14-08` fechou P14-D11 com:

- policy map nominal de rate limit auth;
- HMAC domain-separated e versionado para pre/authenticated/post buckets;
- normalização P14-D12 antes de buckets de e-mail;
- verification/reset post real vinculado a network prefix + intent;
- refresh post real vinculado somente à lineage;
- Redis atomic counters compartilhados por dois processos OS;
- thresholds fechados exatos;
- outage fail-closed `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60` antes de lookup/mutação;
- reset request/resend públicos absorvidos em 202 conforme contrato;
- matrizes públicas completas: verification-confirm 8x40, reset-confirm 9x40, refresh 8x40 = 1000 amostras;
- median delta 0 ms; p95 38 ms sobre floor;
- focused unit 50/50 PASS;
- HTTP/Redis 27/27 PASS;
- `newPassword` ausente dos sinks auditados;
- `git diff --check` PASS;
- `B14-08-HR-03 CLOSED — PASS`;
- `14-08-03 HUMAN APPROVED — PASS`.

O post dummy recompõe material apenas de input pre-lookup em vez de consumir literalmente um campo `preDigest`; a revisão humana aceitou isso como desvio implementacional não bloqueante porque contagem Redis, dummy work, timing e ausência de account dependence permanecem equivalentes.

### 14-09 closure

`14-09` fechou o Auth Notification Outbox P14-D10 com:

- outbox transacional PostgreSQL com state machine CAS (`recorded` -> `claimed` -> `sent` / `failed` -> `dead_letter`) e lease de 2 minutos;
- rederivação de capability de autenticação exclusivamente in-memory (zero capability no Event Bus, Redis, banco ou logs);
- boundary sancionada de resolução de destinatário (`notification-recipient.ts`) com normalização canônica P14-D12 e verificação constant-time de hash (`crypto.timingSafeEqual`) antes do provider;
- missing/mismatch de destinatário falha fechado para `dead_letter` com emissão de alerta operacional sanitizado sem PII;
- scope amendment aprovado humanamente para o módulo `operational-alert` com adição do tipo `auth_notification_failed`, entidade `auth_notification_outbox`, allowlist estrita de metadata e migração `Migration20260814030000.ts`;
- inserção transacional atômica com intents de autenticação (`recordNotificationOutboxInTransaction`) mantendo o baseline de `service.ts` do customer-auth;
- reconciler periódico de leases expiradas e transição a dead-letter de intents terminais sem reabertura de capability;
- semântica efetiva de retry: 1m / 5m / 30m / 2h / 6h -> dead_letter na 6ª falha;
- invariant operacional vinculado de retenção de chaves anteriores (+24h após estado terminal de todos os intents/outboxes da versão);
- mitigação contra vazamento de erro em caso de falha de criação de alerta (`OPERATIONAL_ALERT_CREATION_FAILED` estruturado);
- provas negativas estruturais e de runtime contra dependência do Event Bus;
- suítes completas: focused unit 45/45 PASS, customer-auth unit 157/157 PASS (6 suites), disposable PostgreSQL 21/21 PASS, operational-alert 50/50 PASS, build/lint/diff check PASS;
- `B14-09-HR-01..B14-09-HR-06: CLOSED — PASS`;
- `14-09-03: HUMAN APPROVED — PASS`;
- `14-09: HUMAN APPROVED — PASS`.

Nenhuma chamada a provider real, deploy ou persistência remota foi executada.

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

14-01..14-09:
HUMAN APPROVED — PASS

14-07:
DOCUMENTALLY CLOSED

14-08:
DOCUMENTALLY CLOSED

14-09-03:
HUMAN APPROVED — PASS

B14-09-HR-01..B14-09-HR-06:
CLOSED — PASS

14-09:
HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

Phase 14 plans human-approved executed:
9/21

Phase 14 tasks complete:
27/63

14-10:
NOT AUTHORIZED / NOT STARTED

14-10..14-21:
NOT AUTHORIZED

Next blocking gate:
14-10 human authorization

Milestone requirements complete:
8/91

Deploy:
NOT AUTHORIZED

REAL RESEND:
NOT AUTHORIZED

Frontend Milestone 1:
BLOCKED / not started / not authorized
```

---
*Roadmap opened: 2026-08-06 · 10 phases · updated 2026-08-14 — Phase 13 HUMAN APPROVED — CLOSED; Phase 14 prerequisites HUMAN APPROVED — PASS; 14-01..14-09 HUMAN APPROVED — PASS; 21 plans/21 serial waves/63 tasks/27 complete; 14-07..14-09 DOCUMENTALLY CLOSED; 14-10..14-21 NOT AUTHORIZED; deploy NOT AUTHORIZED; real Resend NOT AUTHORIZED; Frontend BLOCKED; 8/91 requirements; manual-review gated · no auto-chain*
