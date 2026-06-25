---
phase: 01-foundation-observability
plan: "06"
subsystem: observability
tags: [health, readiness, liveness, postgres, redis, medusa-api]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "03"
    provides: Redis contracts and uniqueRedisUrls helper
  - phase: 01-foundation-observability
    plan: "04"
    provides: allowlisted logger and sanitized warning path
  - phase: 01-foundation-observability
    plan: "05"
    provides: Sentry capture policy that leaves expected warnings uncaptured by default
provides:
  - Public GET /health/live liveness endpoint
  - Public GET /health/ready readiness endpoint
  - Parallel Postgres SELECT 1 and deduplicated Redis PING readiness probes
  - 1500 ms per-check timeout and 2000 ms global readiness timeout
  - Sanitized dependency-down warnings without response detail leakage
affects: [01-07, setup, observability, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Health responses expose only status, service, timestamp, version, and generic checks where applicable"
    - "Readiness checks only Postgres and Redis; Stripe, Gelato, Resend, PostHog, and Sentry are excluded"
    - "Expected dependency failures are warn-level, allowlisted, and do not include host, URL, stack, or raw error message"

key-files:
  created:
    - apps/backend/src/infrastructure/health.ts
    - apps/backend/src/api/health/live/route.ts
    - apps/backend/src/api/health/ready/route.ts
    - apps/backend/integration-tests/http/health.spec.ts
  modified:
    - apps/backend/src/observability/sanitize.ts

key-decisions:
  - "Live returns process liveness only and never resolves Postgres or Redis"
  - "Ready aggregates all unique Redis endpoints into a single public redis check"
  - "Probe logs include only check, operation, correlation_id, and error_class"
  - "No new packages were installed for Plan 01-06"

patterns-established:
  - "Probe helpers accept injected fakes for deterministic timeout and route contract tests"
  - "Health routes read version only from env.APP_VERSION"

requirements-completed:
  - OBS-03

# Metrics
duration: 8 min
completed: 2026-06-25
status: pending-review
---

# Phase 01 Plan 06: Health Endpoints Summary

**Public liveness/readiness endpoints with parallel Postgres and Redis probes, minimal safe responses, and sanitized dependency warnings**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-25T15:42:29Z
- **Completed:** 2026-06-25T15:50:29Z
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments

- Added `checkPostgres`, `checkRedis`, `checkReadiness`, and `withTimeout` in `apps/backend/src/infrastructure/health.ts`.
- Added `GET /health/live` returning process liveness without dependency probes.
- Added `GET /health/ready` returning `200 ready` only when Postgres and Redis are up, and `503 not_ready` when either required dependency is down.
- Added integration tests for probe parallelism, timeout boundaries, Postgres query shape, Redis URL deduplication, sanitized warning payloads, and route response shape.
- Kept Stripe, Gelato, Resend, PostHog, Sentry, secrets, DSNs, URLs, stack traces, and raw exception messages out of readiness responses.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Health probe contract tests** - `b147dcc` (test)
2. **Task 1 GREEN: Dependency health probes** - `56250b4` (feat)
3. **Task 2: Live and ready routes** - `7032040` (feat)
4. **Task 2 fix: Injected probe logger typing** - `cf03903` (fix)

**Plan metadata:** pending this summary commit.

## Files Created/Modified

- `apps/backend/src/infrastructure/health.ts` - Parallel Postgres/Redis readiness probes, timeouts, and sanitized warning behavior.
- `apps/backend/src/api/health/live/route.ts` - Public liveness response using `env.APP_VERSION`.
- `apps/backend/src/api/health/ready/route.ts` - Public readiness response using `checkReadiness(req.scope)`.
- `apps/backend/integration-tests/http/health.spec.ts` - Probe and route contract coverage.
- `apps/backend/src/observability/sanitize.ts` - Allows the safe `check` field in structured warning context.

## Decisions Made

- Redis readiness deduplicates endpoint URLs and exposes only one generic `redis` state publicly.
- Expected dependency failures return `down` and emit sanitized warnings; they do not throw into the Sentry error middleware by default.
- Liveness has no `checks` object because it is intentionally process-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adjusted injected logger typing**
- **Found during:** Plan-level build verification
- **Issue:** `logAllowlisted` requires a full Pino logger, while tests inject a minimal `warn` logger.
- **Fix:** `health.ts` now calls injected `warn` directly and uses `logAllowlisted(appLogger, ...)` for production logging.
- **Files modified:** `apps/backend/src/infrastructure/health.ts`
- **Verification:** Health spec and backend build passed.
- **Committed in:** `cf03903`

---

**Total deviations:** 1 auto-fixed blocking issue.
**Impact on plan:** No scope expansion; the fix preserves sanitized production logging and deterministic test injection.

## Issues Encountered

- Initial Jest run tried to create cache under the Windows temp location and failed in the sandbox; reran with `TMPDIR=/tmp`.
- Initial Medusa build tried to write CLI config under `/home/jlima/.config/medusa`; reran with `XDG_CONFIG_HOME=/tmp/medusa-config`.
- Sandboxed build hit `listen EPERM 0.0.0.0` during Admin bundling; reran with approved escalation and the build passed.
- The real `curl` checks were attempted against `127.0.0.1:9000`, but no local Medusa server was running. No server was started and no real dependency URLs or secrets were recorded.

## Verification

```bash
TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/health.spec.ts
# PASS: 1 suite, 8 tests

TMPDIR=/tmp XDG_CONFIG_HOME=/tmp/medusa-config npm run build
# PASS: backend and frontend build completed successfully

curl -fsS http://127.0.0.1:9000/health/live
curl -fsS http://127.0.0.1:9000/health/ready
# Not run against a live server: connection refused because no local server was listening
```

## User Setup Required

None - no new packages, secrets, external accounts, URLs, DSNs, or deployment artifacts were introduced.

## Next Phase Readiness

Plan 01-06 is ready for human review. Plan 01-07 remains not started and is still gated.

---
*Phase: 01-foundation-observability*
*Completed: 2026-06-25*
