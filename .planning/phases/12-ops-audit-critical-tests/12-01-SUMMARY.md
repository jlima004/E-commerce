---
phase: 12-ops-audit-critical-tests
plan: 01
subsystem: testing
tags: [postgresql, docker, medusa-test-utils, integration-tests, fail-closed]

requires:
  - phase: 11-refunds-exchanges-admin
    provides: Backend MVP runtime fechado antes das provas críticas da Phase 12
provides:
  - Evidência BLOCKED do harness PostgreSQL descartável, com cleanup confirmado
  - Implementação não commitada restrita à allowlist para continuação após novo gate
affects: [12-01, TEST-01, disposable-postgres, phase-12]

tech-stack:
  added: []
  patterns: [PostgreSQL descartável em loopback, lifecycle fail-closed, DB_TEMP_NAME explícito]

key-files:
  created:
    - apps/backend/scripts/run-disposable-postgres-tests.mjs
    - apps/backend/integration-tests/postgres/disposable-postgres-harness.ts
    - apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts
    - apps/backend/src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts
  modified:
    - apps/backend/src/modules/gelato-fulfillment/migrations/Migration20260703000000.ts
    - apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts

key-decisions:
  - "Resultado BLOCKED: o smoke acionou módulos Redis reais do ambiente local, contrariando a negativa vinculante de Redis dobrado."
  - "Nenhum commit de implementação foi criado porque o gate PostgreSQL não ficou verde."

patterns-established:
  - "O runner externo controla container, porta, credenciais, sinais e confirmação residual; medusaIntegrationTestRunner mantém a chamada com DB_TEMP_NAME explícito."

requirements-completed: []

duration: 16 min
completed: 2026-07-22
status: blocked
---

# Phase 12 Plan 01: Disposable PostgreSQL Harness Summary

**Harness local fail-closed chegou a migrations reais e isolamento PostgreSQL, mas o plano ficou BLOCKED porque o bootstrap Medusa contatou Redis local real e a suíte terminou com 1 falha.**

## Resultado

**BLOCKED** — não existe PASS parcial.

- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **Divergência inicial `origin/main...HEAD`:** `0 10`
- **Implementação commitada:** não
- **Motivo:** o gate vinculante de PostgreSQL real terminou com 3/4 casos PASS e 1/4 FAIL após o bootstrap carregar Redis real local.
- **Próximo plano:** `12-02` permanece bloqueado.

## Performance

- **Duração:** 16 min
- **Início:** 2026-07-22T02:59:59Z
- **Término:** 2026-07-22T03:15:59Z
- **Tasks concluídos:** 0/2
- **Paths de implementação/teste tocados:** 7/7 da allowlist, contando rename antigo/novo

## Evidência executada

### Gate unitário do harness

Comando:

```text
cd apps/backend && TMPDIR=/tmp rtk npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts --runInBand
```

Resultado: **PASS — 1/1 suite, 9/9 testes**.

As guardas cobriram host não loopback, nome vazio/sem prefixo, alvo igual à manutenção, configuração alternativa incompleta, Docker indisponível, redaction, cleanup fora da allowlist, sinal e resíduo.

### Gate PostgreSQL real descartável

Comando repetido durante as correções limitadas:

```text
cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runTestsByPath src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts --runInBand
```

Resultado final: **FAIL — 1 suite; 3/4 testes PASS; 1/4 FAIL**.

Evidência positiva observada antes do blocker:

- container PostgreSQL 17 iniciou no database de manutenção `postgres`;
- readiness usou `docker exec ... pg_isready ... -d postgres`;
- `DB_TEMP_NAME` explícito tinha prefixo `p12_disposable_`;
- migrations reais foram aplicadas no banco descartável;
- o teste confirmou o database explicitamente nomeado;
- escrita do fixture passou;
- isolamento do caso seguinte passou;
- runner confirmou remoção do database alvo e do container após cada tentativa.

Falha terminal:

```text
Unhandled error: Connection is closed
origem: bullmq/ioredis durante o bootstrap do medusaIntegrationTestRunner
```

Os logs mostraram conexão aos módulos locais `event-bus-redis`, `cache`, `locking-redis` e `workflow-engine-redis`. Isso viola D12-15/SDD/VALIDATION, que exigem Redis dobrado e proíbem Redis real neste plano.

## Tentativas e cleanup

| Tentativa | Resultado | Cleanup |
|---|---|---|
| 1 | `@medusajs/test-utils@2.16.0` não resolveu seu import interno não declarado de `pg-god` | database/container ausentes |
| 2 | hook global padrão de 5 s expirou durante bootstrap | database/container ausentes |
| 3 | URL com `127.0.0.1` acionou a branch SSL remota do test-utils e esgotou o pool | database/container ausentes |
| 4, após a terceira correção | migrations reais + 3 casos PASS; 1 caso FAIL por Redis real local | database/container ausentes |

A inspeção final `rtk docker ps -a --filter name=p12-pg-` retornou vazia. Nenhum container Phase 12 permaneceu residual.

## Rename Gelato

- O path de trabalho foi renomeado via `git mv` para `Migration20260703000000.ts`.
- A classe de trabalho é `Migration20260703000000`.
- A referência literal do teste Gelato foi atualizada para o novo path.
- O diff normalizado contra o SHA-base foi vazio, provando que o DDL permanece equivalente e somente o nome da classe mudou no conteúdo.
- O teste unitário Gelato focado **não foi executado**, pois a condição de parada Redis ocorreu antes dos gates seguintes.

Essas mudanças permanecem não commitadas; não são alegadas como entrega concluída.

## Baselines

Não executadas após o blocker, conforme a regra de parada imediata:

- Unit completa: não executada;
- Modules completa: não executada;
- HTTP completa: não executada;
- lint: não executado;
- build: não executado.

## Negative proofs

| Prova | Resultado |
|---|---|
| Package/lockfile/Jest config sem diff em `PHASE12_EXECUTION_BASE_SHA...worktree` | PASS |
| `apps/backend/medusa-config.ts` sem diff | PASS |
| `git diff --check` | PASS |
| Apenas paths da allowlist + este summary | PASS |
| Sem Supabase/Heroku/provider externo/push/deploy | PASS |
| Sem Stripe/Gelato/Resend/PostHog/Correios real | PASS |
| Sem Redis real | **FAIL — Redis local foi carregado pelo bootstrap Medusa** |
| Sem container PostgreSQL residual | PASS |
| Sem database Phase 12 residual no container descartável | PASS |

Não houve uso de Supabase, Heroku, banco externo, migration remota, provider externo, push, deploy, tag, produção, alteração de package/lockfile/Jest config ou início do `12-02`.

## Commits

- Implementação: **não criado**, porque os gates não passaram.
- Documento: será versionado separadamente com este estado BLOCKED.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adaptador virtual para import interno ausente do test-utils**

- **Encontrado durante:** Task 2, primeira execução PostgreSQL.
- **Problema:** `@medusajs/test-utils@2.16.0` importa `pg-god`, mas o pacote publicado não o declara nem o inclui.
- **Correção:** o spec allowlisted fornece somente as operações create/drop esperadas, usando o driver `pg` já instalado e nome de database estritamente prefixado.
- **Arquivo:** `apps/backend/src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts`.
- **Verificação:** a tentativa final criou e removeu o database por meio do lifecycle do runner Medusa.

**2. [Rule 3 - Blocking] Timeout compatível com bootstrap Medusa**

- **Encontrado durante:** Task 2, segunda execução PostgreSQL.
- **Problema:** o hook de 5 s expirou antes das migrations.
- **Correção:** timeout local do spec elevado para 120 s, sem alterar Jest config.
- **Verificação:** a tentativa seguinte avançou até o bootstrap/migrations.

**3. [Rule 3 - Blocking] Literal localhost exigido pelo test-utils 2.16.0**

- **Encontrado durante:** Task 2, terceira execução PostgreSQL.
- **Problema:** a implementação instalada só desativa sua branch SSL remota quando a URL contém literalmente `localhost`; `127.0.0.1` esgotou o pool.
- **Correção:** o environment do child normaliza `127.0.0.1` para `localhost`, preservando loopback.
- **Verificação:** a tentativa final aplicou migrations e executou os quatro casos.

**Total deviations:** 3 correções bloqueantes, limite atingido.

## Issues Encountered

- **Blocker não resolvido:** o app completo carregado por `medusaIntegrationTestRunner` consumiu Redis local real e produziu erro assíncrono de conexão fechada.
- Corrigir isso exigiria uma quarta tentativa e novo isolamento explícito de Redis dentro da allowlist. O limite de correções foi atingido e a negativa já falhou, portanto o executor parou.

## User Setup Required

Nenhum. Não instalar dependência nem configurar serviço externo para este estado BLOCKED.

## Next Phase Readiness

- `12-01` requer novo gate humano para decidir se a continuação deve limpar/injetar os envs Redis antes do carregamento de `medusa-config.ts` ou revisar o desenho do spec.
- `12-02` não está autorizado.
- OPS-01, OPS-02 e TEST-01 permanecem incompletos.

## Self-Check: PASSED

- O summary existe no path obrigatório.
- O SHA-base, comandos, contagens, blocker e ausência de implementação commitada correspondem à evidência real.
- O cleanup final de containers Phase 12 foi confirmado.
- A classificação global do plano permanece **BLOCKED**.

---
*Phase: 12-ops-audit-critical-tests*
*Plan: 12-01*
*Recorded: 2026-07-22*
