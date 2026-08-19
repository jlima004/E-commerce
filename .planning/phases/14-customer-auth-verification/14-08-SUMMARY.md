---
phase: 14-customer-auth-verification
plan: 08
subsystem: auth
tags: [redis, rate-limit, timing, anti-enumeration, hmac, customer-auth, tdd]

requires:
  - phase: 14-07
    provides: customer-auth persistence, CAS/row-lock service boundary and approved PostgreSQL authority
provides:
  - P14-D11 rate-limit policy map with HMAC-domain-separated pre/authenticated/post keys
  - cross-process Redis atomic thresholds with fail-closed outage behavior
  - controlled timing envelope for public auth failure classes
  - complete verification/reset/refresh state matrices with real and dummy post-lookup paths
  - P14-D12 email normalization reuse before email bucket hash/HMAC
affects:
  - 14-09-customer-auth-verification
  - 14-13-customer-auth-verification
  - 14-14-registration
  - 14-15-email-verification
  - 14-16-password-reset
  - 14-17-password-change

tech-stack:
  added: []
  patterns:
    - Redis counters are coordination/abuse-control only; PostgreSQL remains auth validity authority
    - HMAC domain separation includes key version, operation and purpose
    - pre-lookup buckets derive only from presented input; resolved identity enters only post-lookup
    - public failure classes use equalized Redis/dummy/timing envelopes

key-files:
  created:
    - apps/backend/src/modules/customer-auth/security/rate-limit.ts
    - apps/backend/src/modules/customer-auth/security/timing.ts
    - apps/backend/src/modules/customer-auth/__tests__/rate-limit.unit.spec.ts
    - apps/backend/integration-tests/http/auth-rate-limit.spec.ts
  modified: []

key-decisions:
  - "E-mail rate-limit sempre passa pelo normalizador canônico P14-D12 antes do hash/HMAC."
  - "Verification/reset post real usa network prefix normalizado + intent; refresh post real permanece lineage-only."
  - "Redis outage falha fechado antes de lookup/mutação com 503 + Retry-After: 60, exceto reset request/resend públicos que absorvem em 202 conforme contrato."
  - "newPassword permanece fora de Redis keys, logs, telemetry, persistência e fingerprints."

patterns-established:
  - "verification-confirm: 10/(IP,input-token)/15m pre + 10/(IP,intent)/15m post."
  - "reset-confirm: 30/IP/15m + 10/(IP,token)/15m pre + 10/(IP,intent)/15m post."
  - "refresh: 60/IP/15m + 10/(IP,token)/min pre + 10/lineage/min post."
  - "Timing: floor 350 ms + jitter CSPRNG 0..50 ms; 40 samples per public class."

completed: 2026-08-13
status: complete
---

# Phase 14 Plan 08: Auth Rate Limit and Timing Summary

**P14-D11 está aprovado com limiter Redis atômico cross-process, keys HMAC pre/post sem PII, fail-closed outage e equivalência pública mensurada para verification-confirm, reset-confirm e refresh.**

## Performance

- **Completed:** 2026-08-13 — human gate
- **Tasks:** 3/3
- **Files in plan scope:** 4
- **Remote technical head reviewed:** `8cc5d9b`

## Accomplishments

- Implementou policy map nominal para signup, login, reset request/resend, verification request/confirm, reset confirm, refresh e password change.
- Implementou derivação HMAC domain-separated e versionada para buckets pre-lookup, authenticated e post-lookup sem e-mail, IP, token, intent ou lineage em plaintext na Redis key.
- Reutilizou `normalizeCustomerAuthEmail` P14-D12 antes da derivação dos buckets de e-mail e adicionou fail-closed para input inválido.
- Implementou counters Redis atômicos compartilhados por dois processos OS e thresholds fechados exatos.
- Implementou `AUTH_TEMPORARILY_UNAVAILABLE` com `Retry-After: 60` antes de lookup/mutação quando Redis falha; reset request/resend públicos continuam indistinguíveis em 202.
- Implementou envelope temporal de 350 ms + jitter CSPRNG de 0..50 ms e dummy work HMAC.
- Materializou matrizes públicas completas para verification-confirm, reset-confirm e refresh, incluindo classes inválidas, resolved failures e caminhos reais resolvidos.
- Provou ausência de `newPassword` nos sinks percorridos e preservou PostgreSQL como autoridade de validade.

## Task Commits

1. **RED unitário do limiter** — `aa42c9a` — policies, vetores HMAC, thresholds, dummy work e timing controlado.
2. **GREEN limiter pre/post** — `053c569` — policies nominais, buckets atômicos fail-closed, dummy work e envelope temporal.
3. **RED gate HTTP/Redis** — `64b5a71` — thresholds cross-process, fail-closed e equivalência temporal.
4. **GREEN protocolo HTTP** — `5111cd3` — pre → lookup → post real/dummy, counters, outage e envelopes públicos.
5. **Correção do envelope refresh** — `a4c937b` — `401 AUTHENTICATION_REQUIRED` para refresh inválido, mantendo 400 nos confirms.
6. **Hardening/final corrections** — `8cc5d9b` — normalização P14-D12, matriz real/dummy completa e correção final do binding post-lookup IP+intent.

## Verification Evidence

~~~text
Focused rate-limit unit:
PASS — 50/50

Controlled-clock smoke:
PASS

HTTP/Redis gate:
PASS — 27/27

Public timing matrices:
verification-confirm — 8 classes x 40
reset-confirm        — 9 classes x 40
refresh              — 8 classes x 40
Total                — 1000 samples

Median delta across classes:
0 ms

p95 over 350 ms floor:
38 ms

Cross-process Redis counters:
PASS — two OS workers share atomic counters

Closed thresholds:
PASS — exact blocking hits including post-intent/post-lineage hit 11

Redis outage:
PASS — 503 AUTH_TEMPORARILY_UNAVAILABLE + Retry-After: 60 before lookup/mutation

P14-D12 email normalization before hash/HMAC:
PASS

newPassword negative proof:
PASS — absent from response/observation/Redis keys/logs/telemetry/persistence/fingerprints

Plaintext key negative proof:
PASS — no email/IP/token/intent/lineage plaintext

git diff --check:
PASS

Remote/persistent Redis or DB:
NONE
Provider real calls:
NONE
Deploy:
NONE
~~~

## Human Verification

~~~text
Initial 14-08-03 review:
BLOCKED — localized correction required

Closed blockers:
- P14-D12 email normalization was not enforced inside bucket derivation — CLOSED — PASS
- timing/public matrix did not fully prove real resolved paths — CLOSED — PASS
- B14-08-HR-03 post-intent omitted IP for verification/reset — CLOSED — PASS

Final 14-08-03:
HUMAN APPROVED — PASS

14-08:
HUMAN APPROVED — PASS
~~~

## Decisions Made

- O rate limiter normaliza e-mail internamente com o normalizador P14-D12 já aprovado, evitando dependência implícita de callers corretamente normalizados.
- `verification-confirm` e `reset-confirm` particionam o post real por network prefix normalizado + intent; IP diferente com o mesmo intent gera bucket distinto.
- `refresh` particiona o post real apenas por lineage; mudança de IP não altera a post key da mesma lineage.
- Missing/malformed/unresolved usam post dummy derivado somente de material pre-lookup e preservam contagem Redis, dummy work e timing envelope equivalentes.
- `AUTH_RECOVERY_PENDING` não é reutilizado como resposta de outage do limiter.

## Deviations from Plan

O plano descrevia o post dummy como derivado do `pre-digest`. A implementação final recompõe material opaco a partir de network prefix normalizado + token apresentado, ambos disponíveis pre-lookup, e então aplica HMAC domain-separated.

A revisão humana classificou essa diferença como **desvio implementacional não bloqueante**, pois preserva o comportamento de segurança exigido: zero account dependence, nenhuma identidade resolvida, mesmo número de operações Redis, mesmo dummy work e mesmo envelope temporal.

## Issues Encountered

O checkpoint exigiu três correções antes do PASS final:

1. normalização P14-D12 precisava ocorrer dentro da derivação de bucket de e-mail;
2. matrizes precisavam incluir caminhos reais/resolvidos completos, não apenas failure classes dummy;
3. verification/reset post-intent precisava materializar o threshold contratual `(IP,intent)` em vez de intent-only.

Todos foram corrigidos e re-revisados antes da aprovação humana.

## Known Stubs

Nenhum blocker conhecido permanece no escopo P14-D11. O wiring das primitives de limiter/timing nas rotas/workflows de auth permanece nos planos posteriores definidos pela decomposição da Phase 14.

## User Setup Required

None.

## Non-Actions

- Nenhum provider real foi chamado.
- Nenhum Redis ou banco remoto/persistente foi usado.
- Nenhuma dependency foi instalada.
- Nenhum deploy, PR ou merge foi executado pelo plano.
- `14-09` não foi executado durante o fechamento de `14-08`.
- Frontend permanece bloqueado.

## Next Phase Readiness

- **14-08 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED.**
- **14-09 EXECUTION AUTHORIZED — NOT STARTED.** A autorização é específica para o plano aprovado `14-09-PLAN.md`, respeitando suas stop conditions, Resend real proibido, NO DEPLOY e checkpoint bloqueante `14-09-03`.
- **14-10 NOT AUTHORIZED.** A autorização do `14-09` não permite auto-chain.
- **Deploy NOT AUTHORIZED.**
- **Frontend BLOCKED.**
- Workflow continua `mode=interactive`, `workflow.auto_advance=false`, `workflow._auto_chain_active=false`, `parallelization=false`.

## Self-Check: PASSED

- P14-D11 policy map e derivação pre/authenticated/post existem.
- P14-D12 é reutilizado nos buckets de e-mail.
- verification/reset post real = network + intent; refresh post real = lineage-only.
- Unit 50/50 e HTTP/Redis 27/27: PASS.
- 1000 amostras de timing dentro das tolerâncias: PASS.
- Cross-process, outage, threshold e leakage gates: PASS.
- `git diff --check`: PASS.
- `14-08-03`: HUMAN APPROVED — PASS.
- `14-09` está autorizado, porém não iniciado por este fechamento documental.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-08 HUMAN APPROVED — PASS*
*Completed: 2026-08-13*
