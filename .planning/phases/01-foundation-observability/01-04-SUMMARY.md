---
phase: 01-foundation-observability
plan: "04"
subsystem: observability
tags: [logger, redaction, pino, medusa-logger, correlation-id, access-log]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "03"
    provides: Redis contracts and Medusa config wiring
provides:
  - Central sanitizeString / sanitizeError / sanitizeContext policy
  - Pino logger factory with production JSON and local pretty output
  - Deterministic route/job normalization and error grouping keys
  - Medusa Logger adapter wired in medusa-config.ts
  - Global correlation ID and safe HTTP access logging middleware
  - Negative tests for secret, token, URL, header, cookie, payment, webhook, and PII canaries
affects: [01-05, 01-06, 01-07]

# Tech tracking
tech-stack:
  added:
    - "pino@10.3.1"
    - "pino-pretty@13.1.3"
  patterns:
    - "Application logs only stdout/stderr; no application-managed log files"
    - "sanitizeContext is allowlist-first; request bodies, headers, cookies, query values, raw payloads, IP, and PII keys are dropped"
    - "HTTP access logs contain method, normalized route, status, duration_ms, and correlation_id only"
    - "Error grouping uses error class, operation, integration, and normalized route/job"

key-files:
  created:
    - apps/backend/src/observability/sanitize.ts
    - apps/backend/src/observability/logger.ts
    - apps/backend/src/observability/medusa-logger.ts
    - apps/backend/src/api/middlewares.ts
    - apps/backend/src/observability/__tests__/redaction.unit.spec.ts
    - apps/backend/src/observability/__tests__/logger.unit.spec.ts
  modified:
    - apps/backend/package.json
    - package-lock.json
    - apps/backend/medusa-config.ts

key-decisions:
  - "Use a project-owned allowlist sanitizer before logger output, not broad request/response serialization"
  - "Use an allowlisted error_chain field for sanitized cause chains because Pino's err serializer does not preserve custom nested cause data reliably"
  - "Keep pino and pino-pretty exact-pinned per the package checkpoint"
  - "Leave npm audit findings for review; automatic fixes would require broad/breaking dependency changes outside Plan 01-04"

requirements-covered:
  - SETUP-05
  - OBS-02

# Metrics
duration: resumed across blocked execution windows
status: complete
closed: true
---

# Plan 01-04: Logger & Redaction Summary

**Plan 01-04 is closed after manual review approval. Plan 01-05 was not started.**

## Accomplishments

- Added central redaction utilities for strings, context objects, errors, bounded causes, explicit IP masking, and user-agent summaries.
- Added structured Pino logging with production JSON, local pretty output, sanitized serializers/formatters, deterministic route/job normalization, and stable grouping keys.
- Added a Medusa `Logger` adapter and wired it through `medusa-config.ts`.
- Added global middleware for correlation ID propagation and allowlisted HTTP access logs.
- Added unit tests proving sensitive canaries are removed from sanitizer, logger output, adapter output, and HTTP access logs.

## Scope Guard

No Sentry, health endpoints, PM2, Nginx, deployment runbooks, or Plan 01-05 work was implemented.

## Verification

- `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/redaction.unit.spec.ts src/observability/__tests__/logger.unit.spec.ts`
  - PASS: 2 suites, 38 tests.
- `cd apps/backend && npm run build`
  - PASS: backend and frontend build completed successfully.
- Diagnostics check on edited files
  - PASS: no linter errors reported.
- Exact package pins verified:
  - `apps/backend/package.json`: `pino` is `10.3.1`; `pino-pretty` is `13.1.3`.
  - `package-lock.json`: `pino` resolves to `10.3.1`; `pino-pretty` resolves to `13.1.3`.

## Audit Checkpoint

`npm audit --workspace=@dtc/backend` returned exit code 1 with 116 advisories: 108 moderate and 8 high.

The reported paths are transitive through the existing Medusa/Jest/Admin toolchain, with suggested fixes requiring broad or breaking package changes. No automatic audit fix was applied in this plan.

## Review Notes

- Build output now goes through the local readable logger because `NODE_ENV` is not production during build.
- HTTP success logs for `/health/live` and `/health/ready` are skipped, but failure statuses still log as warnings/errors for future health work.
- Logs remain allowlist-based; full headers, cookies, raw bodies, query values, webhook payloads, payment data, and unnecessary PII are not logged.

*Status: complete; Plan 01-04 is closed.*
