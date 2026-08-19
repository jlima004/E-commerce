---
phase: 14-customer-auth-verification
plan: 06
subsystem: auth
tags: [medusa, dml, postgres, verification, password-reset, outbox, tdd]

requires:
  - phase: 14-05
    provides: quatro models core de registration, credential recovery, session lineage e refresh rotation
provides:
  - AuthVerificationIntent com latest-wins, token hash-only, uma intent ativa e TTL exato de 30 minutos
  - AuthResetIntent com operação composta reconciliável, one-winner e TTL exato de 15 minutos
  - AuthNotificationOutbox com recipient_identity_id opaco, evidência hash/domain e delivery idempotente sem e-mail plaintext
affects:
  - 14-07-customer-auth-verification
  - 14-09-customer-auth-verification
  - 14-15-email-verification
  - 14-16-password-reset

tech-stack:
  added: []
  patterns:
    - Medusa DML com estados fechados, partial unique indexes e checks declarativos
    - Intents one-time hash-only com generation latest-wins e deadlines PostgreSQL exatos
    - Outbox auth separado do delivery de Order com destinatário resolvido somente no relay

key-files:
  created:
    - apps/backend/src/modules/customer-auth/models/auth-verification-intent.ts
    - apps/backend/src/modules/customer-auth/models/auth-reset-intent.ts
    - apps/backend/src/modules/customer-auth/models/auth-notification-outbox.ts
    - apps/backend/src/modules/customer-auth/__tests__/customer-auth-intent-models.unit.spec.ts
  modified: []

key-decisions:
  - "Verification e reset usam token_hash, nonce, key_version e generation; capability, token e credential plaintext permanecem fora da persistência."
  - "O reset só pode chegar a completed após claim, provider proof, credential update e revocation commit, preservados por markers separados."
  - "AuthNotificationOutbox exige recipient_identity_id opaco e registra somente recipient_hash/domain para auditoria; o e-mail será resolvido pelo relay posterior."

patterns-established:
  - "Latest-wins: unique por identity/generation e no máximo uma intent ativa por identity."
  - "Reset composto: operation_id único e completion condicionada aos três efeitos persistidos após o claim."
  - "Outbox allowlisted: templates, estados, leases, retries e failure reasons fechados; body, capability, e-mail e metadata arbitrária não existem no schema."

requirements-completed: [AUTH-04, AUTH-07, AUTH-08]

duration: 18 min
completed: 2026-08-13
status: complete
---

# Phase 14 Plan 06: Verification, Reset and Auth Notification Outbox Summary

**Três models Medusa DML completam intents de verificação/reset hash-only e um outbox auth idempotente com destinatário opaco, TTLs exatos e reset composto fail-closed.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-13T20:55:06Z
- **Completed:** 2026-08-13T21:12:50Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- Definiu AuthVerificationIntent com estados pending|claimed|confirmed|superseded|expired|dead_letter, unique por token hash e identity/generation, uma intent ativa por identity e TTL exato de 30 minutos.
- Definiu AuthResetIntent com estados separados para claim, credential update, revocation commit e completion, operation_id único, lease/retry, uma operação ativa e TTL exato de 15 minutos.
- Definiu AuthNotificationOutbox como sibling separado do outbox de Order, com templates/estados/falhas fechados, idempotência, lease de 2 minutos, até seis tentativas e recipient_identity_id obrigatório e opaco.
- Provou que os schemas não persistem capability, token, senha, body, e-mail completo nem metadata arbitrária; recipient_hash e recipient_domain preservam somente a evidência autorizada.
- Com os quatro models do 14-05, os sete models planejados estão completos e receberam aprovação humana explícita, ainda sem migration.

## Task Commits

1. **Task 14-06-01 RED: contratos de verification/reset intents** — `cfb560b`
2. **Task 14-06-01 GREEN: verification/reset intents** — `8848662`
3. **Task 14-06-02 RED: contratos do auth notification outbox** — `aa10fbb`
4. **Task 14-06-02 GREEN: auth notification outbox** — `ec7d1f1`
5. **Task 14-06-03: revisão humana de intents/outbox** — HUMAN APPROVED — PASS (sem commit técnico)

## Files Created/Modified

- `apps/backend/src/modules/customer-auth/models/auth-verification-intent.ts` — intent latest-wins com capability hash-only, generation, states e TTL de 30 minutos.
- `apps/backend/src/modules/customer-auth/models/auth-reset-intent.ts` — state machine reconciliável com operation_id, markers compostos, lease/retry e TTL de 15 minutos.
- `apps/backend/src/modules/customer-auth/models/auth-notification-outbox.ts` — delivery auth idempotente com referência opaca de identity e evidência hash/domain.
- `apps/backend/src/modules/customer-auth/__tests__/customer-auth-intent-models.unit.spec.ts` — 12 contratos focados de schemas, states, indexes, checks e ausência de plaintext proibido.

## Verification Evidence

~~~text
Focused unit suite:
PASS — 12/12

git diff --check:
PASS

Technical changed-file allowlist before this SUMMARY:
PASS — exactly 4/4 plan-owned files

Models reviewed across 14-05 + 14-06:
PASS — 7/7

Migration generated/applied:
NONE
~~~

## Human Verification

~~~text
Task 14-06-03:
HUMAN VERIFY — PASS

14-06:
HUMAN APPROVED — PASS
~~~

## Decisions Made

- Os TTLs são checks físicos exatos: verification em `created_at + 30 minutes` e reset em `created_at + 15 minutes`.
- O reset persiste `claimed_at`, `provider_proved_at`, `credential_updated_at` e `revocation_committed_at` separadamente; `completed_at` não é válido sem todos os predecessores.
- O relay futuro resolverá `recipient_identity_id` via Query graph/API de módulo somente no envio; o outbox não duplica endereço de e-mail nem payload do provider.
- `provider_message_id` é opcional, único quando presente e limitado ao formato sanitizado; dados completos do provider permanecem fora do schema.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

Nenhum. Os três models e seus contratos DML estão completos para o escopo 14-06; service, relay e migration pertencem explicitamente a planos posteriores e não foram antecipados.

## User Setup Required

None — nenhum provider, secret, migration ou ambiente externo foi configurado.

## Non-Actions

- `14-07` não foi iniciado nem autorizado.
- `db:generate`, migration e qualquer alteração de schema persistido não foram executados.
- Deploy, push, PR, merge, testes com PostgreSQL/Redis/Docker e chamadas reais a providers não foram executados.
- Frontend permanece BLOCKED e nenhum trabalho de frontend foi iniciado.
- `REQUIREMENTS.md`, código, testes, configurações e package/lockfiles não foram alterados durante o fechamento documental.

## Next Phase Readiness

- **14-06 HUMAN APPROVED — PASS.**
- **14-07 NOT AUTHORIZED**; não iniciar sem autorização humana nova e específica.
- **Migration/db:generate/deploy não autorizados.**
- **Frontend BLOCKED.**
- O workflow permanece manual: `mode=interactive`, `workflow.auto_advance=false`, `workflow._auto_chain_active=false` e `parallelization=false`.

## Self-Check: PASSED

- Os quatro artefatos técnicos e este SUMMARY existem.
- Os quatro commits TDD `cfb560b`, `8848662`, `aa10fbb` e `ec7d1f1` estão presentes no histórico.
- Suite focal aceita: PASS — 12/12.
- `git diff --check`: PASS.
- Changed-file allowlist documental: exatamente SUMMARY, STATE e ROADMAP.
- Migration/db:generate/deploy não foram executados; 14-07 não foi iniciado.

---
*Phase: 14-customer-auth-verification*
*Completed: 2026-08-13*
