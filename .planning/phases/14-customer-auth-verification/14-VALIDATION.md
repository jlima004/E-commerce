---
phase: 14
slug: customer-auth-verification
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-11
revised: 2026-08-12
---

# Phase 14 — Validation Strategy

> Contrato de validação futura. Não autoriza execução, testes, infraestrutura,
> provider real, migration, deploy ou gate posterior ao PLAN.

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Jest 29.7 + `@medusajs/test-utils` 2.16.0 |
| Config | `apps/backend/jest.config.js` |
| Wave 0 unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/customer-auth/__tests__/auth-validation-foundation.unit.spec.ts` |
| Wave 0 PostgreSQL | `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-validation-foundation.spec.ts` |
| Quick final | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/customer-auth/__tests__/auth-state-machines.unit.spec.ts src/lib/__tests__/auth-security.unit.spec.ts` — alvo `<30 s` |
| Focused PostgreSQL | Ledger serial abaixo: exatamente um spec por processo disposable, nunca dois paths no mesmo Jest |
| Focused HTTP | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/auth-rate-limit.spec.ts integration-tests/http/auth-multiprocess.spec.ts integration-tests/http/auth-verification.spec.ts integration-tests/http/auth-customer.spec.ts integration-tests/http/auth-reset.spec.ts integration-tests/http/auth-password-change.spec.ts integration-tests/http/auth-contract-matrix.spec.ts integration-tests/http/auth-security.spec.ts` |
| Contract | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/auth-contract.unit.spec.ts && npm run openapi:lint -w @dtc/backend`; em checkout limpo posterior ao writer: `npm run openapi:check -w @dtc/backend` |
| Full phase | Command ledger serial completo abaixo; orçamento máximo explícito de 90 minutos; stop no primeiro exit não zero |
| Feedback target | `<30 s` para `<verify><automated>` imediato; suites PG/Redis, sampling de 40 amostras e regressão completa ficam em gates longos de plano/fase |

Todos os paths acima são criados por `14-01..14-21`. Arquivo ausente é blocker;
nenhum nome agregado inexistente substitui as suites proprietárias.

## Serial Disposable PostgreSQL Command Ledger

Contrato herdado P12-12-06-R1: suites que usam `medusaIntegrationTestRunner`
não podem ser empilhadas no mesmo processo Jest. O gate executa estritamente em
série; cada linha abaixo inicia um processo disposable independente com exatamente
um path em `--runTestsByPath`, espera seu término e confirma cleanup antes da linha
seguinte. Nenhum loop pode esconder, juntar ou paralelizar as invocações; a
evidência registra comando, exit, duração e cleanup de cada linha nominal.

1. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-validation-foundation.spec.ts`
2. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/customer-auth-transaction-compatibility.postgres.spec.ts`
3. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/customer-auth-email-collision.postgres.spec.ts`
4. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/customer-auth-models.postgres.spec.ts`
5. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-notification-outbox.postgres.spec.ts`
6. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-session.postgres.spec.ts`
7. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-verification.postgres.spec.ts`
8. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-registration.postgres.spec.ts`
9. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-reset.postgres.spec.ts`
10. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-password-change-reconcile.postgres.spec.ts`
11. `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-order-invariants.postgres.spec.ts`

O gate PostgreSQL PASS exige 11/11 exits zero e 11/11 confirmações de cleanup.
Uma linha ausente, skipped, agrupada com outro spec, executada em paralelo ou sem
cleanup classifica o gate como `BLOCKED`.

## Quick versus Long Gates

- Task verify imediato: um unit/smoke determinístico e focado, alvo `<30 s`.
- Plan 14-08 timing gate: suite HTTP separada prova nominalmente
  verification-confirm, reset-confirm e refresh, com clock/jitter controlados,
  40 amostras por classe e orçamento de até 5 minutos; sem sleeps reais de
  350 ms. Para reset-confirm cobre missing/malformed semantic capability/
  expired/used/superseded/valid-invalid-password-provider quando aplicável.
- Plan 14-21 focused gate: quick unit, HTTP matrices e a linha 11 do ledger,
  cada etapa registrada separadamente.
- Full phase gate: orçamento de até 90 minutos, execução serial, stop no primeiro
  failure e esta ordem: checkout clean + `openapi:check`; quick unit; Focused HTTP;
  linhas 1–11 do ledger; regressões Unit/Modules/HTTP normais; OpenAPI lint; lint;
  build; negative scans; `git diff --check`.
- O `<verify><automated>` da Task 14-21-02 valida documentariamente o ledger em
  menos de 30 s. A ação da task é o gate longo e não pode ser representada como
  um único comando rápido nem criar o SUMMARY antes do checkpoint humano.

## Sampling Rate

- Depois de cada tarefa: executar exatamente o `<automated>` do PLAN owner.
- Depois de cada plano: repetir a suite focada do slice e `git diff --check`.
- Depois de cada gate humano: o próximo plano só inicia com autorização explícita.
- No plano 21: executar quick final, todas as suites focadas, OpenAPI read-only em
  checkout limpo, regressões, lint, build, negative scans e diff check.
- Execução é serial (`parallelization=false`); technical PASS não aprova o plano seguinte.

## Per-Task Verification Map

| ID | Plan/task owners | Workstream | Requirements | Secure behavior | Actual automated artifacts |
|---|---|---|---|---|---|
| V14-W0 | 01/01-01..02 | harness | AUTH-01..09 | deterministic clock/entropy/HMAC, PG, Redis, two-process, provider faults, leakage | `auth-validation-foundation.unit.spec.ts`; `auth-validation-foundation.spec.ts` |
| V14-CTR | 02/02-01..02 | HTTP contracts/deny | AUTH-03,07,09 | exact contract; raw auth DENY | `contracts.unit.spec.ts`; `guard.unit.spec.ts` |
| V14-DB | 03-07 | DB_MODEL→normalizer→models→migration/service | AUTH-01,02,04,05,06,07,08 | same normalizer before audit/migration; PG constraints | `customer-auth-transaction-compatibility.postgres.spec.ts`; `auth-security.unit.spec.ts`; `customer-auth-email-collision.postgres.spec.ts`; `customer-auth-core-models.unit.spec.ts`; `customer-auth-intent-models.unit.spec.ts`; `customer-auth-models.postgres.spec.ts` |
| V14-LIM | 08/08-01..02 | limiter/timing | AUTH-01,04,06,07,09 | policies nominais verification-confirm/reset-confirm/refresh; reset-confirm 30/IP/15m +10/(IP,presented-token)/15m pre, 10/(IP,intent)/15m post/dummy; key_version/domain separation; 429/503 TEMP before lookup/claim/consume/provider/write; Redis/dummy/HTTP/timing equivalentes e newPassword ausente de sinks | `rate-limit.unit.spec.ts`; `auth-rate-limit.spec.ts` |
| V14-OUT | 09/09-01..02 | auth outbox | AUTH-07,08,09 | CAS/lease; recipient identity resolvida por Query graph; hash constant-time; rederive in-memory/no native event | `auth-notification-outbox.unit.spec.ts`; `auth-notification-outbox.postgres.spec.ts` |
| V14-SES | 10-11/10-01..02,11-01..02 | lineage/refresh/guard | AUTH-02,03,05,06 | N→N+1, 45s recovery, replay revoke, PG guard cross-process | `session.unit.spec.ts`; `auth-session.postgres.spec.ts`; `auth-multiprocess.spec.ts` |
| V14-VER | 12-13/12-01..02,13-01..02 | verification/domain+HTTP | AUTH-07,08,09 | latest-wins/one-winner; authenticated endpoints use approved guard | `verification.unit.spec.ts`; `auth-verification.postgres.spec.ts`; `auth-verification.spec.ts` |
| V14-REG | 14-15/14-01..02,15-01..02 | registration/login/me | AUTH-01,02,03,09 | partial recovery, one Customer, mismatch zero-write, flexible login | `registration.unit.spec.ts`; `auth-registration.postgres.spec.ts`; `auth-customer.spec.ts` |
| V14-RST | 16/16-01..02 | reset | AUTH-04,05,09 | protocolo reset-confirm 14-08 integral; latest-wins; same operation/Idempotency-Key + newPassword reapresentada; composed proof+consume+revoke; secretless reconciler cannot complete; no session; unverified stays unverified; dois 503 distintos | `reset.unit.spec.ts`; `auth-reset.postgres.spec.ts`; `auth-reset.spec.ts`; reutiliza `rate-limit.unit.spec.ts` e `auth-rate-limit.spec.ts` como evidência V14-LIM |
| V14-CHG | 17-18/17-01..02,18-01..02 | password change + reconciler/runtime surface | AUTH-03,04,05,09 | current proof e resume-only no 17; generic secretless scan/claim/lease/CAS/backoff, reset delegation, job e exact runtime set no 18 | `auth-password-change.spec.ts`; `auth-password-change-reconcile.postgres.spec.ts` |
| V14-DOC | 19-20/19-01..02,20-01 | API Docs registry/artifact | AUTH-03,07,09 | registry authority, safe examples, writer-only generated JSON | `auth-contract.unit.spec.ts`; OpenAPI lint; Store writer artifact |
| V14-NEG | 21/21-01..02 | final invariants | AUTH-01..09 | all matrices, canaries, zero auth Order, positive canonical webhook; 11-spec serial PG ledger + regressions | `auth-state-machines.unit.spec.ts`; `auth-security.unit.spec.ts`; `auth-contract-matrix.spec.ts`; `auth-security.spec.ts`; `auth-order-invariants.postgres.spec.ts` |

## Wave 0 Requirements

- [ ] `apps/backend/src/modules/customer-auth/__tests__/support/deterministic-auth.ts`
  — deterministic clock, entropy and synthetic versioned HMAC/HKDF capabilities.
- [ ] `apps/backend/src/modules/customer-auth/__tests__/auth-validation-foundation.unit.spec.ts`
  — self-tests for deterministic primitives/provider faults/leakage collectors.
- [ ] `apps/backend/integration-tests/helpers/auth-postgres.ts` — disposable PG,
  concurrency barriers and hash-only inspection.
- [ ] `apps/backend/integration-tests/helpers/auth-redis.ts` — isolated namespace,
  outage and job/key inspection.
- [ ] `apps/backend/integration-tests/helpers/auth-multiprocess.ts` — two Medusa
  processes sharing disposable PG/Redis.
- [ ] `apps/backend/integration-tests/helpers/auth-providers.ts` — emailpass/Resend
  success, timeout, 5xx and ambiguous mocks.
- [ ] `apps/backend/integration-tests/helpers/auth-faults.ts` — boundaries for
  identity→Customer, refresh commit→response, password update→proof→revoke.
- [ ] `apps/backend/integration-tests/helpers/auth-leakage.ts` — DB/Redis/log/Sentry/
  OpenAPI/snapshot/analytics/provider canaries.
- [ ] `apps/backend/integration-tests/modules/auth-validation-foundation.spec.ts`
  — PG/Redis/two-process/cleanup self-test.

## Required Future Proofs

1. O normalizador testado em 14-04 é importado pelo collision audit; o audit
   retorna zero antes do model/migration gate de 14-07 e nunca escreve.
2. Verification-confirm, reset-confirm e refresh possuem pre-lookup input HMAC,
   post-lookup intent/lineage e dummy post-path equivalente para malformed/missing.
   Reset-confirm prova nominalmente 30/IP/15 min e 10/(IP,presented reset token)/
   15 min antes de lookup/claim/consumo/provider/write; 10/(IP,reset-intent)/
   15 min somente após intent legítima; HMACs versionados/domain-separated;
   post dummy derivado do pre-digest; 429 sem lookup; Redis outage 503
   `AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60`; `AUTH_RECOVERY_PENDING`
   somente para mesma operation/Idempotency-Key já ambígua. Missing/malformed
   semantic capability/expired/used/superseded/valid-invalid-password-provider
   quando aplicável têm Redis-call count, dummy work, envelope e timing dentro
   de floor 350 ms+jitter CSPRNG 0..50 ms, 40 amostras, mediana <=50 ms e p95
   <=75 ms; IP/token/hash persistido/IDs puros e newPassword não aparecem em
   key/log/telemetry/persistência/fingerprint.
3. `customerAuthAccessGuard` é aprovado em 14-11 antes de qualquer request/status/
   me/password autenticado ser elevado; DB outage nega e Redis nunca concede.
4. Reset/password change em timeout ficam ambiguous e bloqueados. Reconciler sem
   segredo faz scan/claim/lease/CAS/backoff, pode confirmar somente efeitos
   autoritativos já provados e revogar/alertar, mas nunca provar senha ou completar; only
   same-key retry com `newPassword` reapresentada e provider verification autoriza
   `credential_updated`, revoke-completion e success. Para reset, V14-RST referencia
   e reutiliza integralmente as provas V14-LIM de reset-confirm; latest-wins,
   composed reset, no-session e unverified-stays-unverified são obrigatórios.
5. Signup/login/refresh/verification/reset/logout/password change criam zero
   `Order`; expiry/revoke preserva checkout e canonical Stripe webhook segue a
   única autoridade de Order birth.
6. Capability canaries não aparecem em DB plaintext, Redis/jobs, logs, Sentry,
   OpenAPI, snapshots, analytics ou provider payload persistence.

## Manual-Only Verifications

| Behavior | Why manual | Instruction |
|---|---|---|
| Review between plans | project policy | stop after each SUMMARY; only explicit approval unlocks next plan |
| Provider real | explicitly out of scope | do not call Resend/Stripe/Gelato/Supabase/Heroku/PostHog/Correios |
| Retention legal | external decision absent | do not add destructive retention beyond operational TTLs |

## Validation Sign-Off

- [x] Paths/commands correspond exactly to files owned by plans 01-21.
- [x] Wave 0 creates both named self-test suites before downstream use.
- [x] Every production-code task has focused automated proof.
- [x] Normalization precedes collision audit/model/migration.
- [x] Access guard precedes authenticated verification elevation.
- [x] Reset/change ambiguous protocol and secretless reconciler limits are tested.
- [x] As 63 tasks possuem `read_first` e `acceptance_criteria`; checkpoint não lê o SUMMARY do próprio plano.
- [x] Os 11 specs PostgreSQL são serializados em 11 processos independentes, um spec por processo.
- [x] Outbox resolve identity no envio e compara recipient hash constant-time; limiter cobre signup/login/verification-request antes de lookup/write.
- [x] V14-LIM e V14-RST cobrem nominalmente reset-confirm pre/post/dummy, thresholds, outage/429, timing, dois 503, newPassword somente em memória e composed reset latest-wins/no-session/unverified-stays-unverified.
- [x] No watch mode, provider real, deploy or execution is authorized by this file.

**Approval:** Checker R4.1 PASS — 0 blockers / 0 warnings. Validation strategy documentally complete — awaiting human review. Phase 14 PLAN is not human-approved. SPEC/SDD and all later gates remain blocked. Execution and deploy are NOT AUTHORIZED.
