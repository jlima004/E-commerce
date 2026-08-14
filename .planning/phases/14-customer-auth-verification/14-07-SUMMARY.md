---
phase: 14-customer-auth-verification
plan: 07
subsystem: auth
tags: [medusa, postgres, migration, cas, row-lock, customer-auth, tdd]

requires:
  - phase: 14-04
    provides: normalizador aprovado e collision gate read-only
  - phase: 14-06
    provides: sete models customer-auth completos e human-approved
provides:
  - CustomerAuthModuleService com transições CAS/row-lock de domínio e writes gerados bloqueados
  - migration CLI única do módulo customer_auth alinhada a model, snapshot e DB_MODEL
  - collision audit PASS persistido antes da geração final da migration
  - state machine de reset composta com provider proof persistível antes de credential update
affects:
  - 14-08-customer-auth-verification
  - 14-10-customer-auth-verification
  - 14-14-registration
  - 14-16-password-reset
  - 14-17-password-change

tech-stack:
  added: []
  patterns:
    - PostgreSQL como autoridade de validade, unicidade e concorrência auth
    - service-only CAS com FOR UPDATE e predicates de estado
    - migration Medusa CLI precedida por collision audit persistido e sanitizado
    - reset composto vinculando AuthResetIntent e AuthCredentialState por identity e operation_id

key-files:
  created:
    - .planning/phases/14-customer-auth-verification/14-07-COLLISION-AUDIT-EVIDENCE.json
    - apps/backend/src/modules/customer-auth/service.ts
    - apps/backend/src/modules/customer-auth/migrations/Migration20260814004448.ts
    - apps/backend/src/modules/customer-auth/migrations/.snapshot-customer-auth.json
    - apps/backend/integration-tests/modules/customer-auth-models.postgres.spec.ts
  modified:
    - apps/backend/medusa-config.ts
    - apps/backend/src/modules/customer-auth/models/auth-reset-intent.ts
    - apps/backend/src/modules/customer-auth/__tests__/customer-auth-intent-models.unit.spec.ts
    - docs/DB_MODEL_v1.21.md

key-decisions:
  - "O audit PASS persistido precede a migration final; a tentativa anterior sem evidência cronológica foi revertida explicitamente e preservada no histórico Git."
  - "AuthResetIntent mantém o status claimed e admite dois substates válidos: antes e depois de provider_proved_at, sempre antes de credential_updated_at."
  - "AuthResetIntent e AuthCredentialState avançam em operações compostas vinculadas pela mesma identity/operação; divergência falha sem estado parcial."
  - "Redis não participa da autoridade de validade/unicidade e nenhuma migration foi aplicada a banco remoto ou persistente."

patterns-established:
  - "Audit → evidência persistida → db:generate → verificação PostgreSQL descartável."
  - "Claim → provider proof → credential update → revocation committed → completed é persistível e CAS-safe."
  - "Generated CRUD writes do Medusa permanecem proibidos; transições de domínio explícitas são a fronteira de escrita."

requirements-completed: [AUTH-01, AUTH-02, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08]

completed: 2026-08-13
status: complete
---

# Phase 14 Plan 07: Customer Auth Persistence Summary

**Persistência customer-auth aprovada com collision gate auditável, uma migration Medusa CLI para 7/7 models e state machines PostgreSQL executáveis por CAS/`FOR UPDATE`.**

## Performance

- **Duration:** multi-session remediation; exact duration not recorded
- **Completed:** 2026-08-13 — human gate
- **Tasks:** 3/3
- **Technical files changed:** 9
- **Remote branch head reviewed:** `78a1af2`

## Accomplishments

- Persistiu evidência sanitizada do collision audit com `status=PASS`, `blockers=[]`, `collision_count=0`, `BEGIN READ ONLY`, zero writes e cleanup do PostgreSQL local descartável.
- Registrou o módulo `customer_auth` e materializou uma única migration CLI final, `Migration20260814004448.ts`, com snapshot alinhado.
- Provou exact-set model/snapshot/migration/DB_MODEL em 7/7 models e PostgreSQL como autoridade de constraints/validade.
- Implementou `CustomerAuthModuleService` com transaction-required, CAS, `FOR UPDATE`, predicates de domínio e rejeição de generated writes.
- Corrigiu a state machine de `AuthResetIntent` para persistir provider proof enquanto `status='claimed'`, antes de credential update, sem introduzir novo status.
- Vinculou o fluxo composto de `AuthResetIntent` e `AuthCredentialState` pela mesma identity e operação, com rollback em divergência.
- Cobriu fluxo completo de reset, terminais `superseded|expired|failed_reconcilable`, combinações ilegais, concorrência e rollback.

## Task / Remediation Commits

1. **PostgreSQL RED tests** — `ac345fa`
2. **Service CAS/row-lock baseline** — `b851bce`
3. **Tentativa original de migration, preservada historicamente** — `254d0f4`
4. **Reversão integral da tentativa sem evidência cronológica persistida** — `ddd5286`
5. **Collision audit PASS persistido** — `f473221`
6. **Migration/regeneration e verificação PostgreSQL após audit** — `df1e74b`
7. **Correção estrutural final e hardening** — `3bade24`, `310c96c`, `ca3344e`, `78a1af2`

## Files Created/Modified

- `.planning/phases/14-customer-auth-verification/14-07-COLLISION-AUDIT-EVIDENCE.json` — evidência sanitizada e persistida do precondition audit.
- `apps/backend/src/modules/customer-auth/service.ts` — CAS/locks/transições compostas e bloqueio de writes gerados.
- `apps/backend/src/modules/customer-auth/migrations/Migration20260814004448.ts` — migration CLI final e única do módulo.
- `apps/backend/src/modules/customer-auth/migrations/.snapshot-customer-auth.json` — snapshot final 7/7.
- `apps/backend/integration-tests/modules/customer-auth-models.postgres.spec.ts` — constraints, CAS, rollback, fluxo composto e adversarial.
- `apps/backend/medusa-config.ts` — registro do módulo `customer_auth`.
- `apps/backend/src/modules/customer-auth/models/auth-reset-intent.ts` — `claimed` com substate de provider proof persistível.
- `apps/backend/src/modules/customer-auth/__tests__/customer-auth-intent-models.unit.spec.ts` — contratos focados atualizados.
- `docs/DB_MODEL_v1.21.md` — reconciliação mínima do lifecycle corrigido.

## Verification Evidence

~~~text
Collision audit persisted:
PASS
status = PASS
blockers = []
collision_count = 0
transaction = BEGIN READ ONLY
writes = 0
local disposable PostgreSQL only
cleanup = PASS

Final migration:
Migration20260814004448.ts
single CLI migration = PASS
single snapshot = PASS
exact-set model/snapshot/migration/DB_MODEL = 7/7

Disposable PostgreSQL:
PASS — 9/9

Focused unit:
PASS — 28/28

Backend/Admin build:
PASS — 0 errors

git diff --check:
PASS

Disposable cleanup:
PASS — no remaining container

Remote/persistent database mutation:
NONE
~~~

## Human Verification

~~~text
Task 14-07-03:
HUMAN VERIFY — PASS

14-07:
HUMAN APPROVED — PASS

Final review:
0 blockers / 0 warnings
~~~

## Decisions Made

- A falta de evidência cronológica da primeira geração foi tratada como blocker real: a tentativa foi revertida, o audit PASS foi persistido e somente depois a migration final foi gerada.
- O collision audit não foi reexecutado durante a correção estrutural final porque normalizador, audit semantics e collision winner não mudaram.
- O lifecycle de reset não ganhou novo status: `claimed` representa tanto pre-proof quanto post-proof/pre-update, distinguido por `provider_proved_at`.
- O service executa operações compostas sobre reset intent + credential state na mesma transação e rejeita links divergentes de identity/operação.
- A migration final substitui a migration anterior na árvore corrente; não existe segunda migration incremental do módulo.

## Deviations from Plan

Duas correções controladas foram necessárias antes do PASS humano:

1. o primeiro `db:generate` não possuía evidência persistida suficiente para provar historicamente `audit PASS → db:generate`; a tentativa foi explicitamente revertida e refeita após o audit persistido;
2. a revisão humana encontrou que o CHECK inicial de `AuthResetIntent` não permitia persistir provider proof separadamente do credential update; model/DDL/snapshot/service/testes foram corrigidos e a migration CLI foi regenerada.

As correções permaneceram dentro do objetivo do `14-07` e não anteciparam `14-08`.

## Issues Encountered

- Uma tentativa de `db:generate` encontrou `ECONNREFUSED` e não gerou artefatos; a CLI foi depois executada no PostgreSQL descartável autorizado.
- Uma execução intermediária da suite PostgreSQL terminou 4/5; o defeito localizado foi corrigido e a suite final passou 9/9 após o hardening estrutural.
- Nenhum desses eventos resultou em banco remoto/persistente, provider real ou deploy.

## Known Stubs

Nenhum blocker conhecido permanece no escopo de persistência do `14-07`. Rate limit/timing, runtime registration/login/verification/reset e demais behaviors continuam pertencendo aos planos posteriores da Phase 14.

## User Setup Required

None.

## Non-Actions

- Nenhuma migration foi aplicada a banco remoto ou persistente.
- Nenhum provider real, dependency install ou deploy foi executado.
- Nenhum trabalho de frontend foi iniciado.
- `14-08` não foi executado durante o fechamento do `14-07`.

## Next Phase Readiness

- **14-07 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED.**
- **14-08 EXECUTION AUTHORIZED — NOT STARTED.** Esta autorização humana é específica para executar o plano `14-08` aprovado, respeitando seu checkpoint `14-08-03` e stop conditions.
- **14-09 NOT AUTHORIZED.** A autorização do `14-08` não autoriza avanço automático além de seu checkpoint.
- **Deploy NOT AUTHORIZED.**
- **Frontend BLOCKED.**
- O workflow permanece manual: `mode=interactive`, `workflow.auto_advance=false`, `workflow._auto_chain_active=false`, `parallelization=false`.

## Self-Check: PASSED

- Collision audit PASS está persistido antes da migration final no histórico.
- Migration CLI final única: `Migration20260814004448.ts`.
- Model/snapshot/migration/DB_MODEL: 7/7.
- PostgreSQL descartável: 9/9 PASS.
- Unit focado: 28/28 PASS.
- Backend/Admin build e `git diff --check`: PASS.
- Cleanup descartável: PASS.
- Checkpoint `14-07-03`: HUMAN APPROVED — PASS.
- `14-08` está autorizado, mas ainda não iniciado por este fechamento documental.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-07 HUMAN APPROVED — PASS*
*Completed: 2026-08-13*
