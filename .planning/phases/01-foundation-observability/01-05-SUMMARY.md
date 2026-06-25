---
phase: 01-foundation-observability
plan: "05"
subsystem: observability
tags: [sentry, sdk, scrubbing, error-handler, instrumentation, medusa]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "04"
    provides: Sanitized logger, grouping key, normalized route/job, correlation middleware
provides:
  - Official Sentry Node SDK pinned at 10.59.0
  - Safe instrumentation bootstrap with sendDefaultPii=false and scrub hooks
  - Medusa error handler delegation with single selective Sentry capture
  - Integration test suite covering scrubbing, instrumentation, capture policy, and middleware wiring
affects: [01-06, 01-07]

# Tech tracking
tech-stack:
  added:
    - "@sentry/node@10.59.0"
  patterns:
    - "Sentry init consumes validated env only and keeps tracesSampleRate at 0 in this phase"
    - "beforeSend and beforeBreadcrumb reuse the project-owned allowlist scrubber"
    - "HTTP error capture uses one fingerprint per sanitized grouping key and delegates response rendering to Medusa"

key-files:
  created:
    - apps/backend/src/observability/sentry-scrub.ts
    - apps/backend/integration-tests/http/sentry.spec.ts
  modified:
    - apps/backend/package.json
    - package-lock.json
    - apps/backend/instrumentation.ts
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Pin @sentry/node exactly at 10.59.0 after the human gate; no caret range"
  - "Keep local without DSN explicitly disabled via enabled=false, while production still fails fast in env parsing when SENTRY_DSN or APP_VERSION is absent"
  - "Capture only sanitized fingerprint/tags/extra and never attach req/res, body, headers, cookies, tokens, secrets, Stripe signatures, or unnecessary PII"

patterns-established:
  - "instrumentation.ts is the single Sentry bootstrap entrypoint and uses src/config/env.ts as the only config source"
  - "Sentry capture policy follows warn-expected drop / persistent-or-unexpected capture semantics"

requirements-completed:
  - OBS-01

# Metrics
duration: ~2h
completed: 2026-06-25
status: pending-review
---

# Plan 01-05: Sentry SDK Integration Summary

**Sentry Node SDK integrado com scrubbing allowlist-first, captura seletiva única no error handler do Medusa e testes sem rede cobrindo instrumentation e agrupamento**

## Performance

- **Duration:** ~2h
- **Started:** 2026-06-25T10:15:00-03:00 (aprox.)
- **Completed:** 2026-06-25T12:23:11-03:00
- **Tasks:** 3 de 3 técnicas concluídas após o gate humano do SDK
- **Files modified:** 6

## Accomplishments

- `@sentry/node@10.59.0` foi adicionado com pin exato no workspace do backend.
- `apps/backend/instrumentation.ts` passou a inicializar o SDK oficial com `sendDefaultPii=false`, `beforeSend`, `beforeBreadcrumb`, `tracesSampleRate: 0` e tags seguras de `service`/`process_role`.
- `apps/backend/src/api/middlewares.ts` ganhou um `errorHandler` Sentry-aware que captura uma vez quando a política permite e depois delega integralmente ao `errorHandler()` oficial do Medusa.
- `apps/backend/integration-tests/http/sentry.spec.ts` agora cobre scrubbing, política de captura, fingerprint estável, wiring de instrumentation e preservação do middleware existente.

## Files Created/Modified

- `apps/backend/src/observability/sentry-scrub.ts` - scrubbing de eventos/breadcrumbs, contexto de captura e política seletiva
- `apps/backend/integration-tests/http/sentry.spec.ts` - suíte do plano 01-05 sem rede
- `apps/backend/instrumentation.ts` - bootstrap oficial do SDK com env validado
- `apps/backend/src/api/middlewares.ts` - extensão do error handler com captura seletiva
- `apps/backend/package.json` / `package-lock.json` - pin exato do SDK e lock transitive

## Decisions Made

- O bootstrap do SDK depende exclusivamente de `src/config/env.ts`; nenhuma fonte paralela de DSN/release foi criada.
- O agrupamento do Sentry reaproveita a mesma semântica do logger (`error_class`, `operation`, `integration`, `route_or_job`) para manter cardinalidade estável.
- O middleware continua tratando `warn` esperado como não capturável por padrão, mas permite captura quando o erro é marcado como persistente.

## Deviations from Plan

None - o escopo ficou restrito ao SDK, scrubbing, middleware e testes do Plan 01-05.

## Verification Results

| Check | Result |
|-------|--------|
| `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/sentry.spec.ts` | PASS (12/12) |
| `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp npm run build` | PASS |

## External Smoke Status

O smoke externo com um `SENTRY_DSN` real continua dependente do operador e não foi executado nesta sessão. Nenhum DSN, token, cookie, header `Authorization`, assinatura Stripe, payload de webhook, Pix, PAN ou PII desnecessária foi registrado nos artefatos.

## Pending Review Actions

1. Revisar a integração do SDK em `instrumentation.ts` e `middlewares.ts`.
2. Executar o smoke manual com um DSN de teste/prod provisionado fora do Git, se desejado.
3. Aprovar o fechamento do Plan 01-05 antes de iniciar o Plan 01-06.

## Next Phase Readiness

- **Ready for approval:** o backend já compila e a suíte do plano prova scrubbing, política de captura, agrupamento e captura única.
- **Do not start automatically:** Plan 01-06 continua bloqueado até revisão humana.
- **Out of scope preserved:** nenhum endpoint de health, PM2, Nginx, runbook de deploy ou artefato operacional foi iniciado aqui.

---
*Phase: 01-foundation-observability*
*Plan: 01-05*
*Status: pending-review*
