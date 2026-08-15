---
phase: 14-customer-auth-verification
plan: 09
subsystem: auth
tags: [customer-auth, outbox, resend, capability, in-memory, reconciliation, idempotency, disposable-postgres, tdd, operational-alert, migration]

requires:
  - phase: 14-08
    provides: rate-limit policy map, cross-process Redis limiter and controlled timing envelope
provides:
  - P14-D10 auth notification outbox with CAS state machine and 2-minute lease window
  - sanctioned recipient boundary resolution and constant-time hash verification
  - in-memory capability rederivation and zero capability leakage in database/Redis/logs
  - durable verification and password-reset email relay with stable idempotency keys
  - reconciler for expired worker leases and terminal intent cleanup
  - operational-alert module extension for auth_notification_failed and auth_notification_outbox
  - Migration20260814030000 expanding operational alert CHECK constraints
affects:
  - 14-10-customer-auth-verification
  - 14-14-registration
  - 14-15-email-verification
  - 14-16-password-reset

tech-stack:
  added: []
  patterns:
    - Capability is derived strictly in memory during relay send and NEVER stored in database, Redis, or logs
    - Outbox records only recipient_hash (HKDF+HMAC) and recipient_domain; authoritative email is resolved dynamically at send time
    - Constant-time HMAC comparison (crypto.timingSafeEqual) must match before any provider invocation
    - Missing identity or changed email fails closed to dead_letter with sanitized operational alert (no PII)
    - Resend relay uses stable idempotency key format auth/{template}/{intentId}/g{generation} <= 256 chars
    - Scheduled reconciler reclaims expired leases for pending intents and cleans up defunct intents
    - Transactional outbox insertion via recordNotificationOutboxInTransaction ensures atomic commit/rollback with auth intents
    - OperationalAlertModuleService handles auth_notification_failed alerts via canonical service API with strict metadata allowlist

key-files:
  created:
    - apps/backend/src/modules/customer-auth/notification-outbox.ts
    - apps/backend/src/modules/customer-auth/notification-recipient.ts
    - apps/backend/src/modules/customer-auth/auth-email-templates.ts
    - apps/backend/src/jobs/auth-notification-relay.ts
    - apps/backend/src/jobs/auth-notification-reconcile.ts
    - apps/backend/src/modules/customer-auth/__tests__/auth-notification-outbox.unit.spec.ts
    - apps/backend/integration-tests/modules/auth-notification-outbox.postgres.spec.ts
    - apps/backend/src/modules/operational-alert/migrations/Migration20260814030000.ts
  modified:
    - apps/backend/src/modules/operational-alert/models/operational-alert.ts
    - apps/backend/src/modules/operational-alert/service.ts
    - apps/backend/src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts

key-decisions:
  - "Capability auth nunca atravessa Redis Event Bus ou banco; rederivação in-memory usa nonce e token_hash da tabela de intent."
  - "Outbox armazena apenas recipient_hash (HKDF+HMAC-SHA256) e recipient_domain; e-mail autoritativo é resolvido via query.graph/container."
  - "Comparação de hash antes do envio usa crypto.timingSafeEqual com buffers de 32 bytes; mismatch/ausência gera dead_letter sem chamada ao provider."
  - "Backoff efetivo de 6 tentativas: attempt 1 (+1m), 2 (+5m), 3 (+30m), 4 (+2h), 5 (+6h), attempt 6 -> dead_letter."
  - "Reconciler limpa leases e marca dead_letter para intents terminais (confirmed, completed, superseded, expired, missing) sem reabrir capability."
  - "Operational-alert estendido canonicamente para type auth_notification_failed e entity_type auth_notification_outbox via Migration20260814030000 com metadata estritamente allowlisted."
  - "Retenção de chaves anteriores (+24h após estado terminal) é um invariant operacional/deployment, não controlado automaticamente pelo runtime."
  - "Falhas no despacho do operational alert registram apenas metadata estruturada sanitizada (OPERATIONAL_ALERT_CREATION_FAILED) sem vazar error.message/stack ou PII."

patterns-established:
  - "Idempotency key: auth/{template}/{intentId}/g{generation}"
  - "Lease window: 2 minutes; Batch size: 25; Max attempts: 6"
  - "Effective retry backoff: +1m, +5m, +30m, +2h, +6h, dead_letter on 6th failure"
  - "Failure reasons: recipient_missing, recipient_mismatch, provider_transient, provider_permanent"
  - "Operational alert metadata allowlist: outbox_id, intent_id, recipient_identity_id, template, generation, attempt_count, failure_reason, detector_code"

completed: 2026-08-14
status: complete
---

# Phase 14 Plan 09: Auth Notification Outbox Summary

**P14-D10 está HUMAN APPROVED — PASS com outbox transacional CAS em PostgreSQL, boundary sancionada de resolução/verificação de destinatário com hash constant-time, rederivação in-memory de capability, relay mockável com idempotency key estável, reconciler de leases e extensão canônica de operational_alert via Migration20260814030000.**

## Status Final

- **14-09:** COMPLETE / HUMAN APPROVED — PASS
- **14-09-03:** HUMAN APPROVED — PASS
- **Blockers:** B14-09-HR-01..B14-09-HR-06 ALL CLOSED — PASS
- **Deploy:** NOT AUTHORIZED (ZERO)
- **Real Resend:** NOT AUTHORIZED (ZERO)
- **14-10:** NOT AUTHORIZED / NOT STARTED

## Performance

- **Completed:** 2026-08-14 — human gate
- **Tasks:** 3/3 (Task 14-09-01, Task 14-09-02, Task 14-09-03)
- **Files created/modified:** 11 (8 created, 3 modified in operational-alert)
- **Focused auth-notification-outbox unit:** 45/45 PASS
- **Customer-auth full unit:** 157/157 PASS (6 suites)
- **Disposable PostgreSQL auth-notification-outbox:** 21/21 PASS
- **Operational-alert suite:** 50/50 PASS (33 unit, 17 disposable PG)
- **Migration test:** PASS (up/down validated in disposable PG across 2 suites)
- **Backend build:** PASS (0 errors)
- **Lint:** PASS (0 errors)
- **git diff --check:** PASS

## Accomplishments

- **P14-D10 Auth Notification Outbox Core (`notification-outbox.ts`):**
  - Constantes nominais (`AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE = 25`, `AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS = 6`, `AUTH_NOTIFICATION_OUTBOX_LEASE_MS = 120_000`, schedule nominal `[1m, 5m, 30m, 2h, 6h, 12h]`).
  - Semântica efetiva de retry: attempt 1 (+1m), attempt 2 (+5m), attempt 3 (+30m), attempt 4 (+2h), attempt 5 (+6h), attempt 6 -> `dead_letter` (sem retry de 12h pós-esgotamento).
  - Idempotency key estável `auth/{template}/{intentId}/g{generation}` <= 256 caracteres.
  - Derivação de recipient hash via HKDF + HMAC-SHA256 (`deriveCustomerAuthRecipientHash`) versionada e domain-separated.
  - Validação estrita `assertNoSensitiveOutboxPayload` rejeitando campos sensíveis (`capability`, `token`, `password`, `secret`, `rawkey`, e-mails em texto puro).
  - Primitiva transacional `recordNotificationOutboxInTransaction(knex, ...)` provada atômica com o intent de autenticação (mesma transação COMMIT -> ambos persistidos; ROLLBACK -> nenhum persistido), mantendo o baseline de `service.ts` do customer-auth intocado.

- **Sanctioned Recipient Boundary (`notification-recipient.ts`):**
  - Resolução via `query.graph` ou container sem importação direta de services internos.
  - Fontes autoritativas reconciliadas: provider identities (`entity_id`/`email`), `app_metadata.email`, `user_metadata.email`, `customer.email`.
  - Normalização canônica via `normalizeCustomerAuthEmail` (P14-D12).
  - Boundary contract:
    - 0 e-mails canônicos -> `recipient_missing` (fail-closed, 0 envios).
    - 1 e-mail canônico -> candidato válido.
    - >1 e-mails canônicos divergentes -> `recipient_mismatch` (fail-closed, 0 envios).
  - Verificação pré-envio: derivação de recipient hash candidate e comparação em tempo constante (`crypto.timingSafeEqual`) com buffers de 32 bytes e validação do domínio do destinatário.

- **Templates & In-Memory Rederivation (`auth-email-templates.ts`, `auth-notification-relay.ts`):**
  - DTOs allowlisted para `email_verification_v1` e `password_reset_v1`.
  - Rederivação de capability exclusivamente in-memory na stack do worker relay usando `nonce` + `key_version` e validação contra `token_hash`.
  - Client Resend injetável/mockado com idempotency key estável.
  - Persistência exclusiva do `provider_message_id` sanitizado após envio com sucesso.
  - Falha do provider não altera o estado de negócio na tabela de intent de autenticação.

- **Reconciler Periódico (`auth-notification-reconcile.ts`):**
  - Reconciliação atômica CAS de leases expiradas (`lease_until < now`) para registros não terminais.
  - Transição imediata para `dead_letter` e liberação de lease para outbox associado a intents terminais (`confirmed`, `completed`, `superseded`, `expired`) ou intents ausentes, com incremento de versão e rejeição de CAS de workers concorrentes sem reabrir capability.

- **Scope Amendment de Operational Alert & Migration (`operational-alert`):**
  - Scope amendment aprovado humanamente para acomodar falhas de notificação de auth sem poluir categorias de payment/fulfillment.
  - Extensão canônica: `type: auth_notification_failed`, `entity_type: auth_notification_outbox`.
  - Metadata allowlisted: `outbox_id`, `intent_id`, `recipient_identity_id`, `template`, `generation`, `attempt_count`, `failure_reason`, `detector_code`.
  - Despacho de alerta via `OperationalAlertModuleService.upsertAlert` canônico (sem raw-SQL fallback de negócio).
  - Adicionada `Migration20260814030000.ts` expandindo as constraints `CK_operational_alert_type` e `CK_operational_alert_entity_type`.
  - Migration validada rigorosamente em PostgreSQL descartável (old schema -> rejeita novos valores -> migration up -> aceita novos valores -> valores inválidos continuam rejeitados -> migration down -> rejeita novamente -> valores históricos preservados).

- **Hardening de Sanitização em Falhas de Alerta:**
  - Caso a resolução ou chamada de `OperationalAlertModuleService.upsertAlert` falhe, o relay emite log de aviso estruturado `OPERATIONAL_ALERT_CREATION_FAILED`.
  - O log contém apenas metadata estruturada sanitizada (`outbox_id`, `intent_id`, `recipient_identity_id`, `error_code`, `failure_reason`, `error_name`).
  - Nenhum `error.message` cru, `error.stack`, PII, capability, token ou connection string é emitido.
  - O status `dead_letter` já persistido no outbox nunca é revertido ou silenciado.

- **Event Bus Negative Proof:**
  - Provado por auditoria estrutural e teste runtime que o relay de notificações de autenticação opera com dependência ZERO do Redis Event Bus.
  - `EVENT BUS DEPENDENCY IN AUTH NOTIFICATION RELAY: NONE`.
  - `CAPABILITY IN EVENT BUS: ZERO`.

- **Key Rotation & Invariant Operacional de Retenção:**
  - Suporte a entrega com chave anterior (previous-key): PASS.
  - Chave anterior ausente/removida: fail-closed PASS (`AUTH_NOTIFICATION_RECIPIENT_KEY_UNAVAILABLE` -> `dead_letter`).
  - Recuperação pós-restart: PASS.
  - Invariant operacional vinculante:
    > "Customer-auth runtime does not automatically remove previous capability keys. `CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS` is operator-controlled configuration. A previous key MUST NOT be removed until every intent/outbox referencing that `key_version` has remained terminal for at least 24 hours. Early removal is a deployment/operator stop condition."
  - O runtime não implementa retenção temporal de 24h automaticamente; a retenção é responsabilidade estrita do operador/deployment.

## Verification Evidence

```text
Focused auth-notification-outbox unit suite:
PASS — 45/45 passed

Full Customer-Auth Unit test suite:
PASS — 6 suites, 157/157 tests passed
- auth-notification-outbox.unit.spec.ts
- customer-auth-core-models.unit.spec.ts
- auth-security.unit.spec.ts
- customer-auth-intent-models.unit.spec.ts
- auth-validation-foundation.unit.spec.ts
- rate-limit.unit.spec.ts

Disposable PostgreSQL Integration suite (auth-notification-outbox.postgres.spec.ts):
PASS — 21/21 passed
- Cross-worker CAS claiming (single claimant / atomic mutually exclusive update)
- End-to-End Relay Delivery and In-Memory Capability Rederivation
- Sanctioned Recipient Boundary Fail-Closed (recipient_missing / recipient_mismatch)
- Transactional atomicity: recordNotificationOutboxInTransaction COMMIT/ROLLBACK
- Transient Provider Failure, Backoff and Replay Convergence
- Reconciler Expired Lease Recovery and Terminal Intent Dead-Letter
- Previous Key Rotation delivery and fail-closed missing key
- Operational Alert Emission via OperationalAlertModuleService (sanitized metadata)
- Alert creation failure hardening (OPERATIONAL_ALERT_CREATION_FAILED without PII/leakage)
- Negative proof against native event bus capability transport

Operational-Alert test suite:
PASS — 50/50 passed (33 unit, 17 disposable PG)

Migration20260814030000 validation:
PASS — Up and down migrations verified on disposable PostgreSQL across 2 test suites

Backend build:
PASS — 0 errors

Lint:
PASS — 0 errors

git diff --check:
PASS

Security Invariants & Negative Proofs Verified:
- Event Bus dependency in auth notification relay: NONE
- Capability in Redis Event Bus: ZERO (derivation occurs in-memory only)
- Capability in Database / Outbox table: ZERO (never stored)
- Plaintext email in outbox table: ZERO (only recipient_hash + domain)
- Real Resend API calls: ZERO (mock client only)
- Remote/persistent DB or Redis mutations: ZERO
- Deployment / External mutations: NONE (NO DEPLOY)
```

## Human Verification & Checkpoint Resolution

```text
Initial 14-09-03 review:
BLOCKED — localized corrections and operational alert scope amendment required

Closed Blockers:
- B14-09-HR-01: Transactional outbox record primitive / scope hygiene — CLOSED — PASS
- B14-09-HR-02: Operational alert canonical integration, migration, observability e final hardening de sanitização de error logging — CLOSED — PASS
- B14-09-HR-03: Event Bus structural/runtime negative proof — CLOSED — PASS
- B14-09-HR-04: Recipient boundary / authoritative identity consistency — CLOSED — PASS
- B14-09-HR-05: Previous-key rotation / fail-closed / +24h operational invariant — CLOSED — PASS
- B14-09-HR-06: Terminal reconciliation / stale-worker CAS — CLOSED — PASS

Final 14-09-03:
HUMAN APPROVED — PASS

14-09:
HUMAN APPROVED — PASS
```

## Decisions Made

- A capability é derivada exclusivamente em memória na stack do worker relay e imediatamente descartada após a chamada ao client; nunca entra em Redis, outbox ou logs.
- O outbox persiste apenas `recipient_hash` e `recipient_domain`; o e-mail real é resolvido no momento do envio e validado com comparação de hash em tempo constante (`crypto.timingSafeEqual`).
- Caso o e-mail do cliente tenha sido alterado ou a identidade não exista mais, o relay transiciona o outbox imediatamente para `dead_letter` (`recipient_mismatch` / `recipient_missing`), dispara alerta sanitizado e NÃO chama o provider de e-mail.
- Falhas do provider de e-mail entram em backoff progressivo (tentativas 1..5) sem alterar o estado do intent na tabela de negócios; na sexta falha o outbox é marcado como `dead_letter`.
- O módulo `operational-alert` foi canonicamente estendido via `Migration20260814030000` para incluir `auth_notification_failed` / `auth_notification_outbox`, permitindo governança centralizada de alertas operacionais de autenticação sem reaproveitar indevidamente tipos de pagamento ou fulfillment.
- A retenção de chaves anteriores (`CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS`) por pelo menos 24 horas após a transição terminal de todos os intents/outboxes daquela versão é uma invariante operacional de deployment vinculante.

## Deviations from Plan

- **Human-Approved Scope Amendment for Operational Alert:** A remediação do checkpoint `14-09-03` identificou que o modelo inicial de `operational-alert` suportava apenas entidades de pagamento e fulfillment. Foi aprovada a extensão canônica do módulo com o novo tipo `auth_notification_failed`, entidade `auth_notification_outbox`, allowlist estrita de metadata e a respectiva migração `Migration20260814030000.ts`.
- **Customer-Auth Service Baseline Reversion:** Modificações temporárias introduzidas em `service.ts` do customer-auth foram revertidas antes da aprovação final, mantendo o service no baseline previamente aprovado em 14-07 e implementando a persistência transacional de outbox via helper dedicado `recordNotificationOutboxInTransaction`.

## Issues Encountered & Remediated

- O checkpoint `14-09-03` levantou 6 blockers técnicos e de governança (HR-01 a HR-06). Todos foram integralmente remediados, testados em PostgreSQL descartável com provas unitárias/integração e aprovados pela revisão humana.

## Known Stubs

Nenhum stub no escopo P14-D10. O acionamento do outbox a partir dos endpoints e workflows de registro, verificação de e-mail e redefinição de senha será integrado nos planos 14-14, 14-15 e 14-16.

## Non-Actions

- Nenhum provider real (Resend) foi chamado.
- Nenhum banco ou Redis de produção/remoto foi utilizado.
- Nenhuma dependência externa foi instalada.
- Nenhum deploy, PR ou merge foi realizado.
- O plano 14-10 NÃO foi iniciado e NÃO está autorizado.

## Next Phase Readiness

- **14-09 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED.**
- **14-10 NOT AUTHORIZED / NOT STARTED.**
- **Deploy NOT AUTHORIZED.**
- **Real Resend NOT AUTHORIZED.**
- **Frontend BLOCKED.**
- Workflow continua `mode=interactive`, `workflow.auto_advance=false`, `workflow._auto_chain_active=false`, `parallelization=false`.

## Self-Check: PASSED

- P14-D10 state machine, outbox e relay validados.
- Recipient boundary com `normalizeCustomerAuthEmail` e `timingSafeEqual`: PASS.
- In-memory capability rederivation e negative proof de Event Bus: PASS.
- Operational-alert amendment e `Migration20260814030000.ts`: PASS.
- Invariant operacional de retenção (+24h) documentado: PASS.
- Unit 45/45, customer-auth unit 157/157, disposable PG 21/21, op-alert 50/50: PASS.
- `git diff --check`: PASS.
- `14-09-03`: HUMAN APPROVED — PASS.
- `14-09`: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED.
- `14-10`: NOT AUTHORIZED.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-09 HUMAN APPROVED — PASS*
*Completed: 2026-08-14*
