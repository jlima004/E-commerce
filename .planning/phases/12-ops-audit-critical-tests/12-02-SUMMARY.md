---
phase: 12-ops-audit-critical-tests
plan: 02
subsystem: operations
tags: [operational-alert, postgresql, admin-api, concurrency, read-only]

requires:
  - phase: 12-ops-audit-critical-tests
    provides: PostgreSQL descartável aprovado no Plan 12-01
provides:
  - Fundação persistente e sanitizada de OperationalAlert
  - Upsert PostgreSQL atômico com deduplicação, contador e severity monotônica
  - API Admin read-only de listagem e detalhe
affects: [12-02, OPS-01, TEST-01, operational-alert]

tech-stack:
  added: []
  patterns: [PostgreSQL ON CONFLICT, DTO seguro explícito, Admin API read-only, paginação offset]

key-files:
  created:
    - apps/backend/src/modules/operational-alert/models/operational-alert.ts
    - apps/backend/src/modules/operational-alert/migrations/Migration20260720000100.ts
    - apps/backend/src/modules/operational-alert/service.ts
    - apps/backend/src/modules/operational-alert/index.ts
    - apps/backend/src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts
    - apps/backend/src/api/admin/operational-alerts/route.ts
    - apps/backend/src/api/admin/operational-alerts/[id]/route.ts
    - apps/backend/integration-tests/http/admin-operational-alerts.spec.ts
  modified:
    - apps/backend/medusa-config.ts

key-decisions:
  - "A chave lógica total é (type, entity_type, entity_id), sem predicate de deleted_at."
  - "Toda ocorrência usa um único INSERT ON CONFLICT DO UPDATE RETURNING; não há read-modify-write em memória."
  - "Uma repetição acknowledged preserva status e dados de acknowledgement; resolved e ignored reabrem para open e limpam todo o lifecycle."
  - "Cross-dyno é somente uma inferência da constraint PostgreSQL compartilhada; nenhuma execução distribuída foi alegada."

requirements-completed: []

completed: 2026-07-22
status: passed
---

# Phase 12 Plan 02: OperationalAlert Foundation Summary

**PASS absoluto. A fundação de OperationalAlert e sua API Admin read-only estão completas; OPS-01, TEST-01 e a Phase 12 globais permanecem incompletos.**

## Resultado e SHAs de controle

- **Status:** `passed`
- **Tasks:** `3/3`
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **PLAN12_02_BASE_SHA:** `542a9f9ee3eb56503db5a371eb45904796132d94`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **OPS-01:** foundation entregue; requisito global incompleto porque detecção e promoção pertencem ao `12-03`
- **TEST-01:** provas deste slice entregues; requisito global não promovido
- **12-03 e 12-04:** não iniciados e bloqueados para revisão/autorização humana
- **Push/deploy:** não executados

## Schema e migration

A migration descoberta `Migration20260720000100` cria `operational_alert` com:

```text
id, type, severity, status,
entity_type, entity_id,
message_code, message, error_code, metadata,
first_seen_at, last_seen_at, occurrence_count,
acknowledged_at, acknowledged_by,
resolved_at, resolved_by,
ignored_at, ignored_by,
created_at, updated_at, deleted_at
```

- `type`: `payment_stuck | fulfillment_failed`;
- `severity`: `low | medium | high | critical`;
- `status`: `open | acknowledged | resolved | ignored`;
- `entity_type`: `payment_attempt | fulfillment`;
- defaults provados: `status='open'`, `occurrence_count=1`, `first_seen_at=now()` e `last_seen_at=now()`;
- checks provados para os quatro enums, `entity_id` e `occurrence_count >= 1`;
- `deleted_at` existe somente por compatibilidade Medusa, não é retornado e não há API de delete;
- `sent_at` não foi criado.

Constraint lógica total:

```text
UQ_operational_alert_logical_key (type, entity_type, entity_id)
```

Índices provados no catálogo PostgreSQL:

```text
IDX_operational_alert_status_severity (status, severity)
IDX_operational_alert_entity (entity_type, entity_id)
IDX_operational_alert_type_last_seen (type, last_seen_at DESC)
IDX_operational_alert_last_seen_id (last_seen_at DESC, id DESC)
```

## Upsert, concorrência e lifecycle

`OperationalAlertModuleService.upsertAlert` executa uma única instrução parametrizada:

```sql
INSERT INTO operational_alert (...)
VALUES (...)
ON CONFLICT (type, entity_type, entity_id)
DO UPDATE SET ...
RETURNING *
```

O conflito:

- incrementa `occurrence_count = operational_alert.occurrence_count + 1`;
- preserva `first_seen_at`;
- usa `GREATEST` para impedir regressão de `last_seen_at` e `updated_at`;
- atualiza somente message/error/metadata previamente saneados e allowlisted;
- promove severity pela ordem `low=1 < medium=2 < high=3 < critical=4` e nunca rebaixa;
- preserva `acknowledged` e seus campos;
- reabre `resolved` e `ignored` como `open`, limpando todos os campos de ack/resolve/ignore;
- retorna a linha canônica produzida pelo banco.

O teste concorrente executou múltiplos upserts reais e terminou com uma linha, contador igual ao total de ocorrências e severity máxima `critical`. Isso prova a semântica no PostgreSQL compartilhado; cross-dyno permanece inferência arquitetural, não execução distribuída real.

## DTO seguro e redaction

`upsertAlert`, `listSafe` e `retrieveSafe` validam enums, IDs internos, códigos, timestamps e paginação. A metadata persistida aceita somente:

```text
payment_attempt_id, payment_intent_id, checkout_completion_log_id,
webhook_event_log_id, fulfillment_id, order_id,
detector_code, source_status, operator_alert_code
```

O DTO de saída é montado por allowlist explícita do SPEC. Payload bruto, request/response body, authorization, cookie, segredo, token, `client_secret`, Pix QR/copia-e-cola, CPF/CNPJ, endereço completo, email, stack e `deleted_at` não são expostos. Texto sensível é saneado antes da persistência e novamente ao serializar metadata.

## API Admin read-only

Foram criadas somente:

- `GET /admin/operational-alerts`;
- `GET /admin/operational-alerts/:id`.

A listagem exige contexto Admin autenticado antes de consultar o service e aceita os filtros fechados `type`, `status`, `severity`, `entity_type`, `entity_id`, `last_seen_at_from` e `last_seen_at_to`. Usa `limit=20`, máximo `100`, `offset=0`, máximo `100000`, `count` antes de paginação e ordenação fixa `last_seen_at DESC, id DESC`. Enum, query key, intervalo ou limite inválido retorna o contrato `400`.

O detalhe valida `opalert_*`, retorna `200` com `{ operational_alert }`, `404 OPERATIONAL_ALERT_NOT_FOUND` quando ausente e `400 OPERATIONAL_ALERT_ID_INVALID` para ID malformado. Sem autenticação, list e detail falham antes do lookup do service.

Não existem POST, PUT, PATCH, DELETE, acknowledge, resolve ou ignore endpoints.

## PostgreSQL real descartável

O runner aprovado no `12-01` executou a suíte focada em PostgreSQL 17 local descartável:

- **1/1 suíte, 15/15 testes PASS**;
- migration e tabela descobertas;
- checks, unique, índices e defaults conferidos no catálogo real;
- criação e repetição atômica;
- concorrência com cardinalidade e contador exatos;
- `first_seen_at` preservado e `last_seen_at` avançado;
- promoção concorrente e tentativa de redução;
- reopen de `resolved` e `ignored` com limpeza integral;
- `acknowledged` preservado;
- linha canônica e metadata segura;
- filtros, count, ordenação e resultado vazio.

O target `p12_disposable_558bc1e8970af81d` e o container `p12-pg-558bc1e8970af81d` foram removidos pelo runner. A verificação final `docker ps -a --filter name=p12-pg-` retornou vazia. Não houve skip, banco remoto, Supabase, SQLite ou mock para constraints/concorrência.

## Testes e baselines

| Gate | Resultado |
|---|---|
| OperationalAlert PostgreSQL focado | 1/1 suíte, 15/15 testes PASS |
| Admin OperationalAlert HTTP focado | 1/1 suíte, 23/23 testes PASS |
| Unit completa | 50/50 suítes, 789/789 testes PASS, 1 snapshot PASS |
| Integration Modules | 31/31 suítes, 465/465 testes PASS |
| Integration HTTP | 15/15 suítes, 195/195 testes PASS |
| Lint | 0 erros, 207 warnings |
| Build | PASS; backend compilado com sucesso |

As contagens não regrediram. Nenhum teste deste plano depende de Stripe, Gelato, Resend, PostHog ou outro provider externo.

## Registro Medusa

O único diff em `apps/backend/medusa-config.ts` foi:

```ts
{
  key: "operational_alert",
  resolve: "./src/modules/operational-alert",
},
```

Database, URLs Redis, cache, event bus, workflow engine, locking, providers, health, logger, worker mode e release migration mode permaneceram intactos. `admin_action_log` não foi registrado.

## Negative proofs

PASS para todas as negativas:

- intervalo `PLAN12_02_BASE_SHA...HEAD` restrito aos nove paths técnicos allowlisted;
- nenhum diff base ou WIP em `package.json`, `package-lock.json`, `apps/backend/package.json` ou `apps/backend/jest.config.js`;
- `git diff --check` limpo;
- índice conferido antes de cada commit;
- nenhum detector `payment_stuck`, promoção Gelato, scanner, job, cron, AdminActionLog, instrumentação refund/exchange, alert email ou dashboard;
- nenhum endpoint de mutação de alerta;
- nenhum diff em Redis, cache, event bus, workflow engine, locking, health, providers, run-migrations, harness PostgreSQL descartável ou migration Gelato;
- nenhum Supabase, Heroku, provider externo, dependência, push ou deploy;
- nenhum container `p12-pg-*` residual.

## Arquivos entregues

- `apps/backend/src/modules/operational-alert/models/operational-alert.ts`
- `apps/backend/src/modules/operational-alert/migrations/Migration20260720000100.ts`
- `apps/backend/src/modules/operational-alert/service.ts`
- `apps/backend/src/modules/operational-alert/index.ts`
- `apps/backend/src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts`
- `apps/backend/src/api/admin/operational-alerts/route.ts`
- `apps/backend/src/api/admin/operational-alerts/[id]/route.ts`
- `apps/backend/integration-tests/http/admin-operational-alerts.spec.ts`
- `apps/backend/medusa-config.ts`
- `.planning/phases/12-ops-audit-critical-tests/12-02-SUMMARY.md`

## Commits e estado final

| Commit | Conteúdo |
|---|---|
| `cb1d857` | `feat(operations): add operational alert persistence` |
| `4d6cdf9` | `test(operations): prove operational alert admin contract` |
| este commit documental | `docs(12): close operational alert foundation plan` |

- divergência antes do commit documental: `origin/main...HEAD = 0 16`;
- divergência final após o commit documental: `origin/main...HEAD = 0 17`;
- worktree final após o commit documental: limpo;
- nenhum push ou deploy foi realizado;
- nenhum sistema externo de aplicação/provider foi contatado; somente Docker/PostgreSQL local descartável e o `git fetch origin` exigido pelo gate foram usados;
- `STATE.md`, `ROADMAP.md` e requisitos globais não foram promovidos.

## Próximo gate

O `12-02` encerra em PASS e para neste summary. `12-03` e `12-04` não começaram; permanecem bloqueados para revisão humana e autorização explícita. A detecção de `payment_stuck` e a promoção Gelato continuam reservadas ao `12-03`.

## Self-Check: PASSED

- schema, migration, constraints e índices correspondem ao SDD;
- upsert é PostgreSQL único e atômico;
- concorrência, severity monotônica e lifecycle passaram no banco real;
- API contém somente GET list/detail autenticados e sanitizados;
- focados, baselines, lint e build passaram;
- allowlist e negativas foram preservadas;
- OPS-01, TEST-01 e Phase 12 não foram marcados completos;
- o escopo termina neste summary.

---
*Phase: 12-ops-audit-critical-tests*
*Plan: 12-02*
*Recorded: 2026-07-22*
