---
phase: 12-ops-audit-critical-tests
plan: 04
subsystem: audit
tags: [admin-action-log, append-only, strategy-b, reconciliation, postgresql]

requires:
  - phase: 12-ops-audit-critical-tests
    provides: PostgreSQL descartável aprovado no Plan 12-01
provides:
  - Módulo append-only AdminActionLog com migration Migration20260720000200
  - Actor guard user-only e helper Strategy B
  - Job worker-only de reconciliação factual de intents órfãos
affects: [12-04, OPS-02, 12-05]

tech-stack:
  added: []
  patterns:
    - Append-only PostgreSQL trigger + partial UNIQUE intent/terminal
    - Strategy B intent→domain(once)→outcome
    - Test-only beforeServerStart module registration

key-files:
  created:
    - apps/backend/src/modules/admin-action-log/models/admin-action-log.ts
    - apps/backend/src/modules/admin-action-log/migrations/Migration20260720000200.ts
    - apps/backend/src/modules/admin-action-log/service.ts
    - apps/backend/src/modules/admin-action-log/index.ts
    - apps/backend/src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts
    - apps/backend/src/jobs/admin-action-log-reconciliation.ts
    - apps/backend/src/jobs/__tests__/admin-action-log-reconciliation.unit.spec.ts
    - apps/backend/src/api/admin/_shared/require-admin-actor.ts
    - apps/backend/src/api/admin/_shared/audit-admin-action.ts
    - apps/backend/src/api/admin/_shared/__tests__/audit-admin-action.unit.spec.ts
  modified: []

key-decisions:
  - "Cardinalidade por attempt: 1 intent + 0|1 terminal (outcome ou reconciliation)."
  - "Conflito de UNIQUE parcial devolve o fato canônico; nunca overwrite."
  - "Ausência de RefundRequest/ExchangeRequest deixa o intent órfão; nunca infere failed."
  - "medusa-config.ts permanece intacto; registro runtime fica para 12-05."

requirements-completed: []

completed: 2026-07-22
status: passed
---

# Phase 12 Plan 04: AdminActionLog Primitives Summary

**PASS absoluto. Primitives append-only Strategy B e reconciliação factual estão prontos; instrumentação das rotas Admin permanece no 12-05. OPS-02 e Phase 12 globais permanecem incompletos.**

## Resultado e SHAs de controle

- **Status:** `passed`
- **Tasks:** `3/3`
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **PLAN12_04_BASE_SHA:** `f44d8950a986fc4b9ef5919fd87357ca3b3151da`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **OPS-02:** primitives entregues; requisito global incompleto porque a instrumentação factual das três rotas pertence ao `12-05`
- **12-03 e 12-05:** não iniciados e bloqueados para revisão/autorização humana
- **Push/deploy:** não executados

## Requisitos cobertos neste plano

- OPS-02 (parcial): persistência factual, actor user-only, Strategy B, job de reconciliação
- D12-09 / D12-10 / D12-11 / D12-12 / H12-04 / H12-05

Não marcados como complete:

- OPS-02 complete
- TEST-01 complete
- Phase 12 complete

## Arquivos criados (allowlist exata)

```text
apps/backend/src/modules/admin-action-log/models/admin-action-log.ts
apps/backend/src/modules/admin-action-log/migrations/Migration20260720000200.ts
apps/backend/src/modules/admin-action-log/service.ts
apps/backend/src/modules/admin-action-log/index.ts
apps/backend/src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts
apps/backend/src/jobs/admin-action-log-reconciliation.ts
apps/backend/src/jobs/__tests__/admin-action-log-reconciliation.unit.spec.ts
apps/backend/src/api/admin/_shared/require-admin-actor.ts
apps/backend/src/api/admin/_shared/audit-admin-action.ts
apps/backend/src/api/admin/_shared/__tests__/audit-admin-action.unit.spec.ts
```

Nenhum arquivo existente foi modificado. Em particular, `apps/backend/medusa-config.ts` e as rotas Admin de refund/exchange permanecem intactas.

## Schema AdminActionLog

- módulo/DI: `admin_action_log`
- tabela/model: `admin_action_log`
- ID prefix: `admact`
- migration: `Migration20260720000200`

Colunas:

```text
id, action_attempt_id, correlation_id, audit_stage,
admin_id, admin_email, action, entity_type, entity_id,
result, severity, reason, previous_state, new_state,
metadata, idempotency_key, created_at, updated_at, deleted_at
```

Enums:

```text
audit_stage: intent | outcome | reconciliation
result: requested | succeeded | failed | blocked
severity: info | warning | critical
action: refund_order | update_exchange | reject_exchange | cancel_exchange
entity_type: refund_request | exchange_request
```

`approve_exchange` e `reprocess_fulfillment` não existem. Severity de AdminActionLog permanece independente de OperationalAlert (`low|medium|high|critical`).

## Migration e UNIQUE parciais

`Migration20260720000200` foi descoberta e aplicada no PostgreSQL descartável.

```sql
CREATE UNIQUE INDEX "UQ_admin_action_log_attempt_intent"
ON admin_action_log (action_attempt_id)
WHERE audit_stage = 'intent';

CREATE UNIQUE INDEX "UQ_admin_action_log_attempt_terminal"
ON admin_action_log (action_attempt_id)
WHERE audit_stage IN ('outcome', 'reconciliation');
```

Índices de consulta:

```text
IDX_admin_action_log_actor_created
IDX_admin_action_log_entity_created
IDX_admin_action_log_attempt_created
IDX_admin_action_log_correlation_created
IDX_admin_action_log_idempotency_key (parcial, não UNIQUE)
IDX_admin_action_log_orphan_scan
```

Sem uniqueness global em `idempotency_key` ou `correlation_id`.

## Trigger append-only

```sql
CREATE FUNCTION reject_admin_action_log_mutation() ...
CREATE TRIGGER "TRG_admin_action_log_append_only"
BEFORE UPDATE OR DELETE ON admin_action_log
FOR EACH ROW EXECUTE FUNCTION reject_admin_action_log_mutation();
```

Provas PostgreSQL: UPDATE, DELETE e soft-delete (`deleted_at`) falham com `ADMIN_ACTION_LOG_APPEND_ONLY`. Down migration: drop trigger → drop function → drop table.

O service expõe somente `appendIntent`, `appendOutcome`, `appendReconciliation`, `listOrphanIntents` e `retrieveTerminalFact`. Não há wrappers de update/delete/soft-delete/restore/purge.

## Service, conflitos e fato canônico

- Intent exige `result=requested`.
- Conflito de intent ou terminal busca e devolve a linha canônica existente.
- Nenhuma linha é sobrescrita.
- Sanitização de reason, states, metadata, admin_email e IDs na borda do service.
- Metadata allowlisted: `order_id`, `request_id`, `correlation_id`, `action_attempt_id`, `audit_stage`, `idempotency_key`, `actor_type`, `reused_idempotency`, `error_code`.
- State allowlisted: `status`, `amount`, `currency_code`, campos Correios de reverse logistics.

## Actor guard

`requireAdminActor` aceita somente:

```text
req.auth_context.actor_type === "user"
trim(actor_id) !== ""
```

Falhas fechadas: auth ausente, api-key, actor_id vazio. Body spoof (`admin_id` / operator ids) nunca define ator. Erros: `ADMIN_ACTOR_REQUIRED` / `ADMIN_ACTOR_TYPE_FORBIDDEN`.

## Strategy B e failure contracts

Sequência: require actor → append intent → domínio (≤1) → append outcome.

| Falha | Domínio | Resposta | Audit |
|---|---|---|---|
| actor | não | erro saneado | nenhuma linha |
| intent | não | erro saneado | nenhuma linha confiável |
| domínio | uma vez | erro original do domínio | intent + failed/blocked; se outcome falhar, órfão |
| outcome após sucesso | uma vez | sucesso do domínio preservado | intent órfão + log saneado |

Callback de domínio nunca é reexecutado após falha de audit outcome.

## Job de reconciliação

```text
job: admin-action-log-reconciliation
cron: */5 * * * *
ADMIN_ACTION_ORPHAN_AFTER_MS: 15 * 60_000
worker-only / release migration no-op
batch=100, max pages=20, timeout=25s
keyset: (created_at, id)
```

Regras:

- RefundRequest existente → `reconciliation/requested`
- Exchange create existente → `reconciliation/succeeded`
- update/reject/cancel → `succeeded` só com `new_state` inequívoco
- ausência / divergência / ambiguidade → permanece órfão
- terminal existente → no-op
- nenhum provider e nenhuma mutação de domínio

## PostgreSQL real

Harness descartável 12-01. Wiring test-only via `hooks.beforeServerStart` registra `configModule.modules.admin_action_log = { resolve: "./src/modules/admin-action-log" }` antes das migrations. Evidência do hook + service resolvido + DDL/trigger/UNIQUE parciais + 6 disputas/retries.

```text
10/10 testes PostgreSQL PASS
Migration20260720000200 migrada
container/alvo removidos; 0 residual p12-pg-*
```

Cross-dyno: somente inferência da constraint compartilhada; sem execução distribuída alegada.

## Testes focados e baselines

| Gate | Resultado |
|---|---|
| Unit focado (helper + job) | 2 suites / 34 tests PASS |
| PostgreSQL real AdminActionLog | 10/10 PASS |
| Unit completo | **52/52 suites, 823/823 tests** (era 50/789) |
| Modules completo | **32/32 suites, 466/466 tests** (era 31/465) |
| HTTP completo | **15/15 suites, 195/195 tests** |
| lint | **0 errors, 207 warnings** |
| build | PASS |

## Negativas

- package/lock/Jest/medusa-config intactos no worktree e vs `PLAN12_04_BASE_SHA`
- sem instrumentação de rotas refund/exchange
- sem registro runtime de `admin_action_log` em `medusa-config.ts`
- sem scanner OperationalAlert / alteração OperationalAlert
- sem interceptor `/admin/*`
- sem API key como ator
- sem uniqueness global de `idempotency_key`
- sem `failed` inferido por entidade ausente
- sem update/delete/softDelete wrappers no módulo
- sem providers externos / Supabase / push / deploy
- allowlist de 10 paths técnicos respeitada

## Commits

1. `75d45700115cf4666455ea1c8fd7b7f6570c2564` — `feat(audit): add append-only admin action log`
2. `27b2ecaf6b92e3a907cabc83ea37d8e4548b85dc` — `test(audit): prove admin audit strategy and reconciliation`
3. `docs(12): close admin audit primitives plan` (commit documental deste summary)

## Divergência e worktree

```text
origin/main...HEAD = 0 20  (após este commit documental)
worktree limpo
12-03 não iniciado
12-05 não iniciado
sem push
sem deploy
```

## Sistemas externos

Stripe, Gelato, Resend, PostHog, Supabase e bancos remotos não foram contatados.

## Gate humano

Parar. Aprovação explícita libera o próximo plano autorizado (`12-03` na sequência operacional do implementation prompt). A instrumentação das três rotas Admin permanece no `12-05`.
