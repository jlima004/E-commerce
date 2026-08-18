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
- `14-01..14-19` estão HUMAN APPROVED — PASS
- `14-07..14-19` estão DOCUMENTALLY CLOSED
- blockers humanos fechados até `B14-19-HR-01`; `B14-19-PUSH-01` também está CLOSED — PASS
- `14-20` está **AUTHORIZED FOR EXECUTION / NOT STARTED**
- `14-21` permanece **NOT AUTHORIZED / NOT STARTED**
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
| 14 | Customer Auth & Verification | 13 | 9 | EXECUTING — SERIAL / MANUAL-GATED; 19/21 plans HUMAN APPROVED — PASS; 57/63 tasks complete; 14-19 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-20 AUTHORIZED FOR EXECUTION |
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
- 63 tasks totais / **57 complete**.
- **19/21 plans HUMAN APPROVED — PASS**.
- AUTH coverage planejada: 9/9.
- D14 coverage planejada: 16/16.
- P14-D coverage planejada: 14/14.
- `14-19 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED`.
- `B14-19-HR-01 CLOSED — PASS`.
- `B14-19-PUSH-01 CLOSED — PASS`.
- `14-20 AUTHORIZED FOR EXECUTION / NOT STARTED`.
- `14-21 NOT AUTHORIZED / NOT STARTED`.
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
- [ ] `14-20-PLAN.md` — AUTHORIZED FOR EXECUTION / NOT STARTED
- [ ] `14-21-PLAN.md` — NOT AUTHORIZED / NOT STARTED

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
- `14-15-SUMMARY.md` — signup/login/me surface and BFF service authentication boundary
- `14-16-SUMMARY.md` — composed password reset and guarded recovery
- `14-17-SUMMARY.md` — current-password proof and originating-lineage-bound password-change recovery
- `14-18-SUMMARY.md` — secretless reconciliation and final Phase-14 runtime exact-set
- `14-19-SUMMARY.md` — API Docs registry, exact `/auth` documentation partition, BFF OpenAPI caller authority and Push Protection remediation

### 14-19 closure

`14-19` materializou e fechou a autoridade TypeScript do Store API Docs para os 12 contratos BFF/backend aprovados da Phase 14.

Accepted invariants:

- registry Phase 14 = exact 12, sem 13ª operation/wildcard/prefix;
- seis `/auth` method+path pairs são Store-document owned, mas continuam Auth runtime;
- `/auth/session`, callbacks, MFA, aliases nativos, raw Customer e browser logout permanecem DENY/not invented;
- `bffServiceCredential` (`x-indicio-bff-auth`) documenta a caller authority BFF e é AND-composed com publishable e customer bearer quando aplicável;
- publishable permanece defense-in-depth / Store hop, não caller auth;
- Swagger e as 12 operações permanecem non-interactive;
- sensitive walker não foi enfraquecido;
- generated Store/Admin/Webhooks JSON permaneceu byte-unchanged; writer não rodou;
- `B14-19-HR-01` foi remediado e fechado;
- `B14-19-PUSH-01` foi fechado após remoção de fixture sintética `sk_test_*` do histórico não publicado sem bypass/force e push fast-forward bem-sucedido.

Human-pushed execution/remediation head before documentary closure:

`394b7d49f68c31c331f14873f26dc9ef863832ad`

### 14-20 authorization

By explicit human authorization, `14-20-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The plan owns only the generated Store OpenAPI artifact after the 14-19 registry approval:

- `14-20-01`: execute only `npm run openapi:generate -w @dtc/backend -- --surface store`; diff must be only `apps/backend/src/api-docs/generated/store.openapi.json`; Admin/Webhooks remain byte-identical;
- `14-20-02`: repeat the Store writer to prove deterministic bytes and run auth-contract/sensitive-walker/OpenAPI lint validation;
- `14-20-03`: **BLOCKING HUMAN VERIFY**; stop before 14-21.

Binding restrictions:

- no manual JSON edit;
- no Admin/Webhooks writer drift;
- no sensitive example or Swagger interactivity;
- no global `openapi:check` in 14-20 — plan 21 owns the clean-check gate;
- no dependency/package/env/runtime/schema/migration changes;
- no auto-chain;
- `14-21` remains NOT AUTHORIZED;
- deploy/release, real providers, remote DB/Redis and frontend remain unauthorized.

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

O milestone só pode fechar quando houver evidência PASS para todos os gates previstos: contratos Store/OpenAPI, autenticação, capability/concorrência e merge de carrinho, checkout BR/privacidade, Gelato shipping, PaymentAttempt/confirmation, order/catalog handoff, kit types/Zod/fixtures/mocks, contract tests, suites backend, migrations/constraints, drift/lint/build, security negative proofs e release verification aplicável.

Nenhum fechamento de plano individual autoriza automaticamente o próximo plano, provider real, infraestrutura remota, deploy ou frontend. A progressão permanece serial e human-gated.
