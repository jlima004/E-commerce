# Roadmap: Milestone v1.1 — Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependências que impedem o Frontend Milestone 1 de começar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfície Store autorizada, autenticação, capability/concorrência de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmação assíncrona, confirmação de pedido/catálogo e kit contratual verificável.

**Core invariant:** `Order` continua existindo somente após confirmação confiável do pagamento pelo webhook Stripe canônico; nenhuma operação Store, BFF ou browser pode criá-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN — 0/10 phases, 0/91 requirements.

## Governança

- `mode = interactive`;
- `workflow.auto_advance = false`;
- `workflow._auto_chain_active = false`;
- `parallelization = false`;
- sequência obrigatória: `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`;
- cada gate CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW e CLOSURE para revisão humana;
- Phase 13 CONTEXT, RESEARCH, PLAN R5, SPEC/SDD R1 e Implementation Prompt estão aprovados; P13-13-01-R1 recebeu HUMAN RE-REVIEW PASS; 13-01 está HUMAN APPROVED — PASS; P13-13-02-R1 technical human re-review PASS; P13-13-02-R2 human re-review PASS; 13-02 está HUMAN APPROVED — PASS; 2/7 planos human-approved executed; 13-03 está TECHNICAL PASS — AWAITING HUMAN REVIEW; 13-04..13-07, deploy e frontend permanecem não autorizados/bloqueados.

## Milestones

| Milestone | Status | Phases | Requirements |
|---|---|---:|---:|
| v1.0 — Backend MVP | COMPLETE / CLOSED / ARCHIVED / IMMUTABLE | 13/13 | 45/45 |
| v1.1 — Backend Storefront Readiness | OPEN | 0/10 | 0/91 |

O snapshot histórico de v1.0 permanece em [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md). A tag e a GitHub Release `v1.0` são imutáveis e não participam deste milestone.

## Phases

| Phase | Nome | Depends on | Requirements | Estado |
|---:|---|---|---:|---|
| 13 | Storefront Contract Foundation & Surface Lockdown | v1.0 | 8 | 2/7 human-approved; 13-03 awaiting human review / In Progress |
| 14 | Customer Auth & Verification | 13 | 9 | Not started |
| 15 | Guest Cart Capability & Concurrency | 14 | 9 | Not started |
| 16 | Cart Merge & Review | 15 | 8 | Not started |
| 17 | Authenticated BR Checkout & Privacy | 16 | 10 | Not started |
| 18 | Gelato Shipping Quote & Selection | 17 | 8 | Not started |
| 19 | Storefront PaymentAttempt Hardening | 18 | 9 | Not started |
| 20 | Async Payment Confirmation | 19 | 10 | Not started |
| 21 | Order Confirmation & Catalog Handoff | 20 | 8 | Not started |
| 22 | Contract Kit, Verification & Release | 21 | 12 | Not started |

## Phase Details

### Phase 13: Storefront Contract Foundation & Surface Lockdown

**Goal:** conhecer e bloquear a superfície Store real antes de adicionar contratos, garantindo que nenhuma rota nativa incompatível contorne as regras storefront ou crie `Order`.

**Depends on:** milestone v1.0 fechado; iniciativa API-DOCS-01 fechada.
**Requirements:** FND-01–FND-08.
**Deliverables:** inventário/allowlist da superfície nativa, política de bloqueio/extensão, `StoreErrorResponse`, catálogo de códigos, infraestrutura de idempotência e concorrência, fundação Store OpenAPI `1.1.0`.
**Exit criteria:** inventário cobre a versão Medusa instalada; allowlist é fail-closed; teste negativo de native-route bypass passa; nenhum caminho Store/BFF cria `Order`; headers/security/money/error primitives estão definidos e testados.
**Manual blockers/gates:** qualquer dúvida sobre rota nativa, persistência transversal ou incompatibilidade Medusa resulta em `BLOCKED`; parar após cada artefato GSD para revisão humana.

### Phase 14: Customer Auth & Verification

**Goal:** entregar identidade/Customer, login, reset, refresh e verificação sem contrariar a política de sessão inicial não verificada.

**Depends on:** Phase 13 closed.
**Requirements:** AUTH-01–AUTH-09.
**Deliverables:** operações auth/Customer, política flexível, estado/token de verificação, outbox auth quando necessário, rate limits e anti-enumeração.
**Exit criteria:** cadastro coordenado; sessão inicial compra; novo login não verificado bloqueado; reset/update revogam credenciais antigas; refresh inválido falha; tokens são hash-only/uso único/expiráveis.
**Manual blockers/gates:** não ativar cegamente política Medusa conflitante; decisão de módulo próprio e retenção exige RESEARCH/PLAN aprovado.

### Phase 15: Guest Cart Capability & Concurrency

**Goal:** substituir a sessão como prova principal de posse por capability opaca e tornar mutações concorrentes seguras.

**Depends on:** Phase 14 closed.
**Requirements:** CART-01–CART-09.
**Deliverables:** `GuestCartAccess` equivalente, header sensível, lazy cart, quatro mutações, quantidade 1..99, versão/`ETag`/`If-Match`, invalidação de dependências.
**Exit criteria:** capability CSPRNG/hash-only; nenhum vazamento em JSON/URL/telemetry; ownership/expiry/revocation provados; stale mutation retorna 412; rota nativa não contorna regras.
**Manual blockers/gates:** revisar persistência no DB Model antes de migration; preservar operações Medusa nativas quando seguras.

### Phase 16: Cart Merge & Review

**Goal:** substituir attach simples por merge transacional, idempotente, parcial e revisável.

**Depends on:** Phase 15 closed.
**Requirements:** MRG-01–MRG-08.
**Deliverables:** operação de merge, outcomes fechados, rejeições por item, `CartReview`, acknowledge e plano de depreciação do attach.
**Exit criteria:** soma/teto 99; rollback integral; capability não consumida em abort e consumida após commit; `requiresReview` bloqueia checkout até acknowledge; retry não duplica.
**Manual blockers/gates:** depreciação não remove compatibilidade sem evidência e gate humano.

### Phase 17: Authenticated BR Checkout & Privacy

**Goal:** crir checkout autenticado para pessoa física no Brasil sem armazenar CPF cru no caminho atual.

**Depends on:** Phase 16 closed.
**Requirements:** CHK-01–CHK-10.
**Deliverables:** draft/final checkout, endereço BR, armazenamento criptografado/versionado, purge, snapshot de Order, masking, consent receipts e field errors.
**Exit criteria:** guest rejeitado; validação final atômica; CPF inválido não persiste; banco/logs/providers não contêm CPF cru; purge 7 dias passa; consentimentos são versionados; CNPJJ ausente.
**Manual blockers/gates:** `docs/DB_MODEL_v1.21.md` deve ser atualizado antes de qualquer migration; retenção jurídica permanece gate externo.

### Phase 18: Gelato Shipping Quote & Selection

**Goal:** substituir frete operacional fixo por cotação e seleção autoritativas preservadas até o dispatch.

**Depends on:** Phase 17 closed.
**Requirements:** SHP-01–SHP-08.
**Deliverables:** pesquisa de API/provider, quote, opções saneadas, TTL, selection, total autoritativo, snapshot no Order e mapeamento ao dispatch Gelato.
**Exit criteria:** quote vinculada a cart/address/items/version; opção expirada/estrangeira falha; mudança revoga; total incorpora frete; dispatch usa escolha real; indisponibilidade não cria fallback.
**Manual blockers/gates:** provider/endpoint real só pode ser exercitado em gate explicitamente autorizado; ausência de confirmação técnica bloqueia o PLAN/execução correspondente.

### Phase 19: Storefront PaymentAttempt Hardening

**Goal:** endurecer o módulo existente para cartão autenticado M1, mantendo todo o fluxo pré-Order.

**Depends on:** Phase 18 closed.
**Requirements:** PAY-01–PAY-09.
**Deliverables:** contrato customer-only, idempotência, contexto compatível, DTO saneado, status, invalidação e retry seguro.
**Exit criteria:** request não aceita dinheiro/provider IDs autoritativos; `client_secret` é efêmero/sensível; tentativa vincula snapshots; erro incerto é consultável; invalidação é idempotente; nenhum endpoint cria `Order`.
**Manual blockers/gates:** Pix e guest payment não entram no novo contrato M1; webhook v1.0 só evolui se estritamente necessário.

### Phase 20: Async Payment Confirmation

**Goal:** materializar confirmação BFF-only recuperável, rate-limited e financeiramente segura sob refresh, múltiplas abas e sucesso tardio.

**Depends on:** Phase 19 closed.
**Requirements:** CONF-01–CONF-10.
**Deliverables:** token/sessão de confirmação, exchange/status POST, estados públicos, backoff/rate limit, reconciliação e alerta crítico.
**Exit criteria:** token hash-only/uso único/TTL; exchange idempotente; polling não enumera; concorrência não duplica cobrança/Order; late success invalidado vira reconciliação; `ORDER_CONFIRMED` só pós-Order.
**Manual blockers/gates:** nenhuma lógica browser/Stripe client-side pode confirmar pedido; divergência financeira resulta em `BLOCKED`/alerta, nunca nova cobrança automática.

### Phase 21: Order Confirmation & Catalog Handoff

**Goal:** entregar confirmação de pedido segura e catálogo resolvível/revalidável para o BFF.

**Depends on:** Phase 20 closed.
**Requirements:** ORD-01–ORD-04, CAT-01–CAT-04.
**Deliverables:** referência pública, resumo reduzido, ownership/TTL, resolução exata por handle, evento/outbox de revalidação e webhook outbound HMAC.
**Exit criteria:** enumeração não concede acesso; non-owner/TTL falham com resposta segura; DTO não contém provider/PII interna; handle não é fuzzy; HMAC/timestamp/dedup/retry passam; falha não bloqueia mutação Admin.
**Manual blockers/gates:** domínio/secret do receiver Next.js e validação externa permanecem posteriores e autorizados separadamente.

### Phase 22: Contract Kit, Verification & Release

**Goal:** provar que o backend está pronto e entregar o kit que permite ao frontend desenvolver sem inventar contrato.

**Depends on:** Phase 21 closed.
**Requirements:** KIT-01–KIT-12.
**Deliverables:** OpenAPI, types, Zod, fixtures, mocks, contract tests, testes backend, checks de migration/constraints, security proofs, README/version e gates de release.
**Exit criteria:** 54/54 FE ligados a responsabilidade/operação/schema/evidência; kit completo; todos os gates locais PASS; provider/release somente com prova autorizada; nenhum dado proibido.
**Manual blockers/gates:** falha relevante é `BLOCKED`, sem `PASS WITH KNOWN DEBTS`; deploy/Heroku e autorização do frontend exigem gate humano posterior explícito.

## Definition of Done

O milestone só pode fechar quando houver evidência `PASS` para todos os itens:

| Gate | Required result |
|---|---|
| PRD/SRS/Traceability | PASS |
| DB model atualizado | PASS |
| Native Store surface audit | PASS |
| Store OpenAPI 1.1.0 | PASS |
| Webhooks OpenAPI atualizado | PASS |
| Auth/verificação/reset | PASS |
| Guest capability | PASS |
| Cart mutations/merge/ETag | PASS |
| Checkout BR/CPF/consent | PASS |
| Gelato quote/select | PASS |
| PaymentAttempt hardened | PASS |
| Async confirmation | PASS |
| Order confirmation summary | PASS |
| Catalog handle/revalidation | PASS |
| Types/Zod handoff | PASS |
| Fixtures/mocks | PASS |
| Contract tests | PASS |
| Unit | PASS |
| HTTP integration | PASS |
| Modules | PASS |
| PostgreSQL migrations/constraints | PASS |
| OpenAPI drift | PASS |
| Lint | PASS |
| Build | PASS |
| `git diff --check` | PASS |
| Security negative proofs | PASS |
| Controlled provider validation | PASS |
| Authorized release validation | PASS |

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
Milestone v1.1: opened

Phase 13 CONTEXT: APPROVED
Phase 13 RESEARCH: APPROVED
Phase 13 PLAN R5: APPROVED
Phase 13 SPEC/SDD R1: APPROVED
Phase 13 Implementation Prompt: APPROVED

P13-13-01-R1:
HUMAN RE-REVIEW PASS

13-01:
HUMAN APPROVED — PASS

P13-13-02-R1:
TECHNICAL HUMAN RE-REVIEW PASS

P13-13-02-R2:
HUMAN RE-REVIEW PASS

13-02:
HUMAN APPROVED — PASS

13-03:
TECHNICAL PASS — AWAITING HUMAN REVIEW

Plans human-approved executed:
2/7

- [x] 13-01-PLAN.md (HUMAN APPROVED — PASS)
- [x] 13-02-PLAN.md (HUMAN APPROVED — PASS)
- [ ] 13-03-PLAN.md (TECHNICAL PASS — AWAITING HUMAN REVIEW)
- [ ] 13-04-PLAN.md
- [ ] 13-05-PLAN.md
- [ ] 13-06-PLAN.md
- [ ] 13-07-PLAN.md

Phase 13 requirements covered:
8/8

Phase 13 requirements complete:
0/8

Milestone requirements complete:
0/91

13-04..13-07: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
Frontend Milestone 1: BLOCKED / not started / not authorized
```

---
*Roadmap opened: 2026-08-06 · 10 phases · 91 open requirements · manual-review gated · no auto-chain*
