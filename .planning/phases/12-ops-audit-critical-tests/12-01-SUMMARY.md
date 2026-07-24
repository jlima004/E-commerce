---
phase: 12-ops-audit-critical-tests
plan: 01
subsystem: testing
tags: [postgresql, docker, medusa-test-utils, integration-tests, fail-closed]

requires:
  - phase: 11-refunds-exchanges-admin
    provides: Backend MVP runtime fechado antes das provas críticas da Phase 12
provides:
  - Foundation TEST-01 com PostgreSQL 17 descartável e isolamento Redis local/in-memory
  - Probes determinísticos do contrato release migration DB-only
affects: [12-01, TEST-01, disposable-postgres, phase-12]

tech-stack:
  added: []
  patterns: [PostgreSQL descartável em loopback, lifecycle fail-closed, DB_TEMP_NAME explícito, stdout síncrono em subprocessos]

key-files:
  created:
    - apps/backend/scripts/run-disposable-postgres-tests.mjs
    - apps/backend/integration-tests/postgres/disposable-postgres-harness.ts
    - apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts
    - apps/backend/src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts
  modified:
    - apps/backend/src/infrastructure/__tests__/run-migrations.unit.spec.ts
    - apps/backend/src/modules/gelato-fulfillment/migrations/Migration20260703000000.ts
    - apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts

key-decisions:
  - "run-migrations.mjs permaneceu intacto: exports, check-only e CLI funcionaram nos probes diretos."
  - "Os snippets filhos do spec emitem JSON adicional com writeSync e falham com diagnóstico apenas estrutural, sem DSNs."
  - "A guarda loopback remove somente um par externo de colchetes e aceita [::1] como ::1."

patterns-established:
  - "O runner externo controla container, porta, credenciais, sinais e confirmação residual; medusaIntegrationTestRunner controla criação, migrations, isolamento e remoção do DB_TEMP_NAME."

requirements-completed: []

duration: 18 min
completed: 2026-07-22
status: passed
---

# Phase 12 Plan 01: Disposable PostgreSQL Harness Summary

**PASS absoluto. A foundation de PostgreSQL descartável de TEST-01 está completa; o requisito TEST-01 global permanece incompleto e nenhum plano posterior foi iniciado.**

## Resultado

- **Status:** `passed`
- **Tasks:** `2/2`
- **TEST-01 foundation:** `complete`
- **TEST-01 requirement:** `incomplete`
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **12-02:** bloqueado, pendente de revisão humana
- **Push/deploy:** não executados

## Histórico dos blockers

1. **Redis herdado no bootstrap:** a tentativa PostgreSQL anterior carregou módulos Redis locais reais e terminou `3/4`, portanto o plano permaneceu BLOCKED sem commit.
2. **Baseline Unit vermelho:** após isolar Redis, a Unit completa ficou vermelha por uma falha isolada em `run-migrations.unit.spec.ts`; os demais gates não foram promovidos.
3. **Probe de stdout não determinístico:** quatro casos do spec perderam os JSONs adicionais emitidos com `console.log`; a linha operacional `release_migration.infrastructure_mode`, escrita sincronamente pelo runtime, permaneceu presente.

Os três blockers foram resolvidos dentro da allowlist. Nenhum deles foi reclassificado como PASS parcial.

## Diagnóstico de run-migrations

### Falha antes da correção

O rerun único preservado em `/tmp/p12-run-migrations-before.log` terminou com:

- status `1`;
- `1/1` suíte FAIL;
- `4` testes FAIL e `1` PASS;
- stdout dos probes sem os JSONs adicionais esperados;
- stderr sem erro runtime do script;
- linha operacional `release_migration.infrastructure_mode` presente nos casos que chamam `runMigrations`.

### Probes diretos fora do Jest

Executados a partir de `apps/backend`:

| Probe | Status | stdout | stderr |
|---|---:|---:|---:|
| export puro + `console.log` | 0 | 37 bytes | 0 bytes |
| export puro + `writeSync(1, ...)` | 0 | 37 bytes | 0 bytes |
| CLI `node scripts/run-migrations.mjs --check-only` | 0 | 167 bytes | 0 bytes |

Os exports, `buildMigrationChildEnv`, `runMigrations({ checkOnly: true })` e o CLI funcionaram. Fora do Jest, ambos os canais emitiram; sob o subprocesso do Jest, somente a escrita síncrona já usada pela linha operacional foi determinística. A causa factual era a fragilidade do probe de teste, não defeito runtime.

### Correção

Somente `apps/backend/src/infrastructure/__tests__/run-migrations.unit.spec.ts` mudou:

- os quatro JSONs adicionais usam `writeSync(1, JSON.stringify(record) + "\\n")`;
- `stdio` ficou explícito como `ignore/pipe/pipe`;
- `encoding: "utf8"` foi preservado;
- timeout finito de `10_000` ms;
- falhas diagnosticam somente status, signal, error.code e comprimentos de stdout/stderr;
- nenhuma asserção ou cobertura foi removida;
- stdout vazio continua falha explícita.

`apps/backend/scripts/run-migrations.mjs` permaneceu sem qualquer diff.

Resultado isolado e repetido: **1/1 suíte, 5/5 testes PASS**.

## Guarda loopback IPv6

O harness agora normaliza somente um par externo de colchetes antes da comparação. São aceitos:

- `localhost`;
- `127.0.0.1`;
- `::1`;
- `[::1]`.

Continuam rejeitados `0.0.0.0`, `host.docker.internal`, `::ffff:127.0.0.1`, IPv6 externo e hostname externo. Os testes cobrem a URL WHATWG com `[::1]`, hostname normalizado, redaction IPv6 e todas as rejeições.

Resultado focado: **1/1 suíte, 23/23 testes PASS**.

## Isolamento Redis

O gate confirmou:

- `NODE_ENV=test`;
- `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL` e `WE_REDIS_URL` presentes e vazios;
- `DTC_RELEASE_MIGRATION_MODE` e child marker vazios;
- flags de Stripe, Resend e Gelato falsas;
- cache in-memory, event bus local, workflow engine in-memory e locking local;
- ausência dos cinco módulos Redis proibidos;
- ausência de URL Redis falsa e de container Redis;
- ausência de `bullmq`, `ioredis`, `Connection is closed`, `MaxRetriesPerRequestError` ou tentativa em porta 6379 no output capturado.

`apps/backend/medusa-config.ts` não mudou.

## PostgreSQL real descartável

O runner executou com Docker local e terminou **1/1 suíte, 6/6 testes PASS**:

- imagem `postgres:17-alpine`;
- maintenance DB `postgres`;
- target `p12_disposable_*`;
- readiness dentro do container;
- migrations Medusa reais aplicadas;
- WebhookEventLog, CheckoutCompletionLog e GelatoFulfillment descobertos;
- índices únicos esperados encontrados;
- fixture escrita e isolada no caso seguinte;
- database alvo removido;
- container `p12-pg-*` removido.

As verificações `docker ps -a --filter name=p12-pg-` antes e depois retornaram vazias. Nenhum skip ocorreu.

## Gelato e DDL

- Teste Gelato focado: **1/1 suíte, 17/17 testes PASS**.
- Migration descoberta pelo nome `Migration20260703000000`.
- O diff normalizado contra o SHA-base, substituindo apenas `MigrationTBDGelatoFulfillment` pelo nome timestamped, ficou vazio.
- O rename foi detectado pelo Git com similaridade de 98%; o DDL factual não mudou.

## Baselines finais

| Gate | Resultado |
|---|---|
| Run migrations focado | 1/1 suíte, 5/5 testes PASS |
| Harness unitário | 1/1 suíte, 23/23 testes PASS |
| Gelato focado | 1/1 suíte, 17/17 testes PASS |
| PostgreSQL real | 1/1 suíte, 6/6 testes PASS |
| Unit completa | 50/50 suítes, 789/789 testes PASS, 1 snapshot PASS |
| Integration Modules | 30/30 suítes, 464/464 testes PASS |
| Integration HTTP | 14/14 suítes, 172/172 testes PASS |
| Lint | 0 erros, 207 warnings |
| Build | PASS |

## Negative proofs

PASS para todas as negativas:

- nenhum diff base...HEAD ou WIP em `package.json`, `package-lock.json`, `apps/backend/package.json`, `apps/backend/jest.config.js` ou `apps/backend/medusa-config.ts`;
- nenhum diff em `apps/backend/scripts/run-migrations.mjs`;
- somente os paths da allowlist do P12-12-01-R3;
- `git diff --check` limpo;
- índice conferido antes de cada commit;
- nenhum Supabase, Heroku, provider externo, Redis real, push, deploy, tag, reset, restore, stash, clean ou amend;
- nenhum container PostgreSQL residual.

## Arquivos entregues

- `apps/backend/src/infrastructure/__tests__/run-migrations.unit.spec.ts`
- `apps/backend/scripts/run-disposable-postgres-tests.mjs`
- `apps/backend/integration-tests/postgres/disposable-postgres-harness.ts`
- `apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts`
- `apps/backend/src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts`
- `apps/backend/src/modules/gelato-fulfillment/migrations/Migration20260703000000.ts`
- `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts`
- `.planning/phases/12-ops-audit-critical-tests/12-01-SUMMARY.md`

O path histórico `apps/backend/src/modules/gelato-fulfillment/migrations/TBD-gelato-fulfillment.ts` foi renomeado, não mantido em paralelo.

## Commits

| Commit | Conteúdo |
|---|---|
| `8009f47` | `test(infrastructure): stabilize migration subprocess probes` |
| `a9ed6c4` | `test(infrastructure): add disposable postgres harness` |
| este commit documental | `docs(12): close disposable postgres harness plan` |

O commit BLOCKED `738edd2` foi preservado no histórico. Nenhum push foi executado.

## Próximo gate

`12-01` encerra em PASS no gate manual. `12-02` não foi iniciado e permanece bloqueado até revisão e autorização humana explícita. `STATE.md`, `ROADMAP.md` e requisitos globais não foram promovidos por este slice.

## Self-Check: PASSED

- `status: passed` e `tasks: 2/2` correspondem aos gates executados.
- TEST-01 foundation está completa; TEST-01 global permanece incompleto.
- Os três blockers históricos foram preservados.
- Runtime, manifests, lockfile, Jest config e medusa-config ficaram intactos.
- Cleanup PostgreSQL foi confirmado.
- O escopo termina neste summary; 12-02 não começou.

---
*Phase: 12-ops-audit-critical-tests*
*Plan: 12-01*
*Recorded: 2026-07-22*
