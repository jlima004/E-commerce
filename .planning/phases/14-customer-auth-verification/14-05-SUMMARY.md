---
phase: 14-customer-auth-verification
plan: 05
subsystem: auth
tags: [medusa, dml, postgres, registration, session-lineage, refresh-rotation, tdd]

requires:
  - phase: 14-03
    provides: DB_MODEL reconciliado e baseline fail-closed de transações auth
  - phase: 14-04
    provides: normalizador P14-D12 e collision gate read-only human-approved
provides:
  - RegistrationIntent com coordenação hash-only, estados fechados, TTL/CAS e unique parcial ativa
  - AuthCredentialState com estado 1:1, recovery reset/password-change e proof markers ordenados
  - AuthSessionLineage com teto absoluto original de 30 dias e revogação fechada
  - AuthRefreshCredential hash-only com rotação por geração, uma active por lineage e recovery de 45 segundos
affects:
  - 14-06-customer-auth-verification
  - 14-07-customer-auth-verification
  - 14-10-customer-auth-verification
  - 14-14-registration
  - 14-16-password-reset
  - 14-17-password-change

tech-stack:
  added: []
  patterns:
    - Medusa DML com enums, partial unique indexes e checks declarativos
    - PostgreSQL como autoridade de unicidade, lifecycle, CAS e deadlines auth
    - Capability e credenciais persistidas somente como hashes/HMACs versionados

key-files:
  created:
    - apps/backend/src/modules/customer-auth/index.ts
    - apps/backend/src/modules/customer-auth/types.ts
    - apps/backend/src/modules/customer-auth/models/registration-intent.ts
    - apps/backend/src/modules/customer-auth/models/auth-credential-state.ts
    - apps/backend/src/modules/customer-auth/models/auth-session-lineage.ts
    - apps/backend/src/modules/customer-auth/models/auth-refresh-credential.ts
    - apps/backend/src/modules/customer-auth/__tests__/customer-auth-core-models.unit.spec.ts
  modified: []

key-decisions:
  - "O módulo exporta apenas o boundary de models/types neste plano; service, migration e setters de transição permanecem fora de 14-05."
  - "AuthSessionLineage fixa absolute_expires_at em original_authenticated_at + 30 dias e usa motivos de revogação fechados."
  - "AuthRefreshCredential registra somente hashes/nonces versionados, generation e recovery_until de 45 segundos; capability e Idempotency-Key plaintext são proibidas."

patterns-established:
  - "TDD de model contract: RED comprova ausência do schema; GREEN inspeciona DML parseado para fields, enums, indexes e checks."
  - "Completion de credencial exige markers separados de provider proof, credential update e revogação."
  - "Uma refresh active por lineage e uma generation por lineage são constraints declaradas no model."

requirements-completed: [AUTH-01, AUTH-02, AUTH-05, AUTH-06]

duration: 28 min
completed: 2026-08-13
status: complete
---

# Phase 14 Plan 05: Customer Auth Core Models Summary

**Quatro models Medusa DML materializam registration recovery, credential recovery, lineage absoluta e refresh hash-only com constraints PostgreSQL declaradas e zero capability plaintext.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-08-13T19:56:27Z
- **Completed:** 2026-08-13T20:25:17Z
- **Tasks:** 3/3
- **Files modified:** 7

## Accomplishments

- Definiu RegistrationIntent com estados pending_identity|pending_customer|completed|expired|failed_reconcilable, unique parcial por hash normalizado ativo, TTL finito, CAS e completion condicionada a Identity + Customer.
- Definiu AuthCredentialState 1:1 por Identity com versões monotônicas, recovery genérico de reset/password-change, lease/retry e checks de ordem proof → credential update → revogação → completion.
- Definiu AuthSessionLineage com estados/reasons fechados e absolute_expires_at = original_authenticated_at + 30 days.
- Definiu AuthRefreshCredential com token_hash, generation única, uma active por lineage, inatividade máxima de 7 dias e recovery de resposta perdida de 45 segundos.
- Provou os quatro contratos com suite focada de 16 testes e obteve aprovação humana explícita de 4/4 models.

## Task Commits

1. **Task 14-05-01 RED: contratos de Registration/CredentialState** — fc0cf37
2. **Task 14-05-01 GREEN: Registration/CredentialState** — 3db8da1
3. **Task 14-05-02 RED: contratos de Lineage/Refresh** — 9c8fe7c
4. **Task 14-05-02 GREEN: Lineage/Refresh** — 5de35d0
5. **Correção mecânica: normalização de EOF** — 161a861

## Files Created/Modified

- apps/backend/src/modules/customer-auth/index.ts — boundary de exports dos quatro models, constantes e tipos.
- apps/backend/src/modules/customer-auth/types.ts — enums fechados e TTLs canônicos de registration/session/refresh.
- apps/backend/src/modules/customer-auth/models/registration-intent.ts — coordinator persistente hash-only para identity + Customer.
- apps/backend/src/modules/customer-auth/models/auth-credential-state.ts — estado autoritativo de credencial e operação reconciliável.
- apps/backend/src/modules/customer-auth/models/auth-session-lineage.ts — lineage opaca com versão de credencial e deadline absoluto.
- apps/backend/src/modules/customer-auth/models/auth-refresh-credential.ts — refresh single-use hash-only, generation e recovery window.
- apps/backend/src/modules/customer-auth/__tests__/customer-auth-core-models.unit.spec.ts — testes de shape, enums, indexes, checks e ausência de plaintext.

## Verification Evidence

~~~text
Focused unit suite:
PASS — 16/16

git diff --check 6b814e792bbc3c6828319724fc77dabe2c3c5971..HEAD:
PASS

Changed-file allowlist:
PASS — exactly 7/7 plan-owned files before this SUMMARY

Migration generated/applied:
NONE
~~~

## Human Verification

~~~text
Task 14-05-03:
HUMAN VERIFY — PASS

Models reviewed:
4/4 APPROVED

14-05:
HUMAN APPROVED — PASS
~~~

## Decisions Made

- index.ts permanece um boundary de models/types; não existe MedusaService ou setter genérico neste plano que possa saltar as transições.
- Os vínculos auth_identity_id e customer_id são IDs lógicos Medusa, sem foreign key ou acesso direto a tabelas core.
- Os motivos de revogação de lineage ficam allowlisted como logout|refresh_replay|password_reset|password_change|security_revocation.
- replacement_used_at preserva evidência necessária para distinguir recuperação de resposta perdida de replay sem persistir a capability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removidas linhas em branco extras no EOF**
- **Found during:** gate final após Task 14-05-02.
- **Issue:** git diff --check contra a base reportou new blank line at EOF em quatro models e types.ts.
- **Fix:** removida exclusivamente a linha em branco adicional ao final dos cinco arquivos.
- **Files modified:** auth-credential-state.ts, auth-refresh-credential.ts, auth-session-lineage.ts, registration-intent.ts, types.ts.
- **Verification:** suite focada 16/16, git diff --check PASS e worktree limpo.
- **Committed in:** 161a861.

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking).
**Impact on plan:** correção estritamente mecânica, sem mudança de schema ou comportamento.

## Issues Encountered

Nenhum issue aberto. O único bloqueio mecânico de whitespace foi corrigido e reverificado.

## Known Stubs

Nenhum. Os models possuem contratos DML completos para o escopo 14-05; service e migration pertencem explicitamente a planos posteriores e não são stubs deste plano.

## User Setup Required

None — nenhum provider, secret, migration ou ambiente externo foi configurado.

## Next Phase Readiness

- O plano 14-05 está completo e human-approved.
- O plano 14-06 **não está autorizado e não foi iniciado**; exige autorização humana separada.
- Nenhuma migration foi gerada ou aplicada.
- Deploy permanece **NOT AUTHORIZED**.
- Frontend permanece **BLOCKED**.
- STATE.md e ROADMAP.md não foram alterados neste worktree; a integração central é responsabilidade do orquestrador.

## Self-Check: PASSED

- Oito arquivos declarados existem (sete artefatos técnicos + este SUMMARY).
- Os cinco commits técnicos/corretivos estão presentes no histórico.
- Suite focada: PASS — 16/16.
- git diff --check: PASS.
- STATE.md e ROADMAP.md permanecem inalterados; migration permanece ausente.

---
*Phase: 14-customer-auth-verification*
*Completed: 2026-08-13*
