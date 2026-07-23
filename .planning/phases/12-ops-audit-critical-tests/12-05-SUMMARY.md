---
phase: 12-ops-audit-critical-tests
plan: 05
subsystem: audit
tags: [admin-action-log, strategy-b, admin-routes, medusa-config, http]

requires:
  - phase: 12-ops-audit-critical-tests
    provides: AdminActionLog primitives, Strategy B helper, actor guard from Plan 12-04
provides:
  - Runtime registration of admin_action_log in medusa-config.ts
  - Explicit Strategy B wrappers on three custom Admin mutation routes
  - HTTP failure-mode proofs including outcome-after-success orphan path
  - Idempotent test-only beforeServerStart registration (P12-12-05-R1)
affects: [12-05, OPS-02, 12-06]

tech-stack:
  added: []
  patterns:
    - Runtime module key + resolve only in medusa-config allowlist
    - Strategy B intent→domain(once)→outcome on custom Admin routes
    - Idempotent fail-closed test registration when runtime already wires the module

key-files:
  created: []
  modified:
    - apps/backend/medusa-config.ts
    - apps/backend/src/api/admin/refunds/request/route.ts
    - apps/backend/src/api/admin/exchanges/route.ts
    - apps/backend/src/api/admin/exchanges/[id]/route.ts
    - apps/backend/src/modules/refund-request/service.ts
    - apps/backend/src/modules/exchange-request/service.ts
    - apps/backend/src/modules/exchange-request/types.ts
    - apps/backend/integration-tests/http/admin-refunds.spec.ts
    - apps/backend/integration-tests/http/admin-exchanges.spec.ts
    - apps/backend/src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts

key-decisions:
  - "admin_action_log is registered at runtime next to operational_alert; Redis/providers/health untouched."
  - "Actor identity comes only from auth_context user; operator body fields are rejected."
  - "Outcome audit failure after persisted domain preserves HTTP success and does not re-run domain."
  - "P12-12-05-R1: postgres beforeServerStart is idempotent for canonical runtime registration and fail-closed on divergent resolve."

requirements-completed: [OPS-02]

completed: 2026-07-22
status: passed
---

# Phase 12 Plan 05: Admin Action Instrumentation Summary

**PASS absoluto após P12-12-05-R1. As três rotas Admin customizadas estão auditadas com Strategy B; `admin_action_log` está no runtime; o spec PostgreSQL aceita registro canônico existente sem sobrescrever. `12-06` permanece bloqueado até revisão humana.**

## Resultado e SHAs de controle

- **Status:** `passed`
- **Tasks:** `3/3` + cascata R1
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **PLAN12_05_BASE_SHA:** `41c1b840fba75f3a5c3968ba5f02e33a273f2d5b`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **OPS-02:** instrumentação das três superfícies custom IN entregue; inventário nativo 76 OUT confirmado
- **12-06:** bloqueado até revisão humana deste summary
- **Push/deploy:** não executados

## Arquivos

### Modificados (allowlist 12-05 + cascata R1)

- `apps/backend/medusa-config.ts` — somente `{ key: "admin_action_log", resolve: "./src/modules/admin-action-log" }`
- `apps/backend/src/api/admin/refunds/request/route.ts`
- `apps/backend/src/api/admin/exchanges/route.ts`
- `apps/backend/src/api/admin/exchanges/[id]/route.ts`
- `apps/backend/src/modules/refund-request/service.ts`
- `apps/backend/src/modules/exchange-request/service.ts`
- `apps/backend/src/modules/exchange-request/types.ts`
- `apps/backend/integration-tests/http/admin-refunds.spec.ts`
- `apps/backend/integration-tests/http/admin-exchanges.spec.ts`
- `apps/backend/src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts` (**R1**)

### Documentação / allowlist

- `.planning/phases/12-ops-audit-critical-tests/12-05-PLAN.md` — allowlist reconciliada com o path R1
- `.planning/phases/12-ops-audit-critical-tests/12-IMPLEMENTATION-PROMPT.md` — allowlist reconciliada

## P12-12-05-R1 — registro test-only idempotente

### Causa do conflito

O Plan 12-04 registrou `admin_action_log` **somente** no `hooks.beforeServerStart` do PostgreSQL spec, e lançava `ADMIN_ACTION_LOG_ALREADY_REGISTERED` se a chave já existisse. O Plan 12-05 passou a registrar o módulo no `medusa-config.ts` (obrigatório para rotas HTTP/server+worker). Com isso, o hook do spec encontrava o registro runtime e falhava.

### Diferença 12-04 → 12-05

| Estado | `medusa-config.ts` | Spec PostgreSQL |
|--------|--------------------|-----------------|
| 12-04 | sem `admin_action_log` | registra test-only; rejeita se já presente |
| 12-05 + R1 | `admin_action_log` canônico | preserva canônico; registra só se ausente; rejeita divergente |

### Comportamento idempotente

`ensureAdminActionLogModuleRegistration`:

1. módulo ausente → registra `{ resolve: "./src/modules/admin-action-log" }`
2. módulo canônico existente → no-op (não sobrescreve)
3. módulo divergente (`resolve` diferente ou `disable: true`) → `ADMIN_ACTION_LOG_CONFLICTING_REGISTRATION`

### Spec PostgreSQL focado (disposable)

```text
13/13 PASS
(3 provas locais de idempotência + 10 provas PG de persistência/concorrência/append-only)
```

Assertions de persistência, concorrência, append-only e constraints **não** mudaram. A evidência do hook aceita `registered XOR alreadyPresent`.

### Primitives 12-04 intactas

Confirmado por `git diff` vazio em:

- `models/**`, `migrations/**`, `service.ts`
- `admin-action-log-reconciliation.ts`
- `audit-admin-action.ts`, `require-admin-actor.ts`
- `package.json`, lockfile, `jest.config.js`

## Instrumentação HTTP (12-05)

- Refund request: intent → domínio (ID pré-gerado) → outcome `requested`
- Exchange create/update: actor user-only; operator body rejeitado; outcomes factuais
- Falha de outcome após domínio persistido: HTTP de sucesso preservado; domínio não reexecuta; intent órfão
- Cast tipado de `MedusaRequest` + `auth_context` nas três rotas (mesmo padrão de `operational-alerts`) para build TypeScript

## Inventário de superfícies

- **3 IN** custom (refunds/request, exchanges POST, exchanges/:id)
- **76 OUT** nativos (`TOTAL=76` na travessia `@medusajs/medusa@2.16.0`)

## Baselines

| Gate | Resultado |
|------|-----------|
| Unit | **54/54 suítes, 877/877 testes** |
| Modules (comando do packet) | **33/33 suítes, 508/508 testes** (≥ 505; +3 provas R1) |
| Spec PG AdminActionLog (disposable focado) | **13/13 PASS** |
| HTTP focado refunds+exchanges | **39/39 PASS** |
| HTTP completo | **15/15 suítes, 212/212 testes** (≥ 195) |
| lint | **0 erros, 210 warnings** |
| build | **PASS** |

Nota: empilhar os três `medusaIntegrationTestRunner` no mesmo processo Jest sob disposable continua sujeito ao flaky conhecido `Map.prototype.set` entre suítes; o baseline decisivo do packet (sem disposable) e o spec focado disposable estão verdes.

## Negative proofs

- `git diff --check` limpo
- Diff de `medusa-config.ts` limitado ao registro `admin_action_log`
- Manifests/Jest/lockfile sem alteração neste plano
- Sem `approve_exchange` / `reprocess_fulfillment` emitidos
- Sem interceptor `/admin/*`
- Service/migration/job/Strategy B/actor guard do 12-04 não alterados

## Commits

1. `feat(audit): instrument admin routes with action log`
2. `test(audit): support runtime admin action log registration`
3. `docs(12): close admin action instrumentation plan`

## Próximo passo

Revisão humana do `12-05`. **Não** iniciar `12-06` sem autorização explícita.
