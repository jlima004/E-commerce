---
phase: 01-foundation-observability
plan: "02"
subsystem: infra
tags: [medusa, zod, postgres, supabase, migrations, env-schema]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "01"
    provides: Medusa 2.16.0 scaffold, Jest runner, bootstrap contract
provides:
  - Typed fail-fast environment schema (local/production)
  - DATABASE_MIGRATION_URL guard and db:migrate:safe subprocess isolation
  - .env.template contract including SENTRY_DSN and APP_VERSION
affects: [01-03, 01-04, 01-05, 01-06, 01-07]

# Tech tracking
tech-stack:
  added: [zod env validation, run-migrations.mjs subprocess guard]
  patterns: [parseEnv before defineConfig, migration URL isolated to child process, error messages without secret values]

key-files:
  created:
    - apps/backend/src/config/env.ts
    - apps/backend/src/config/__tests__/env.unit.spec.ts
    - apps/backend/scripts/run-migrations.mjs
  modified:
    - apps/backend/.env.template
    - apps/backend/medusa-config.ts
    - apps/backend/package.json

key-decisions:
  - "Runtime uses DATABASE_URL; migrations use DATABASE_MIGRATION_URL only in subprocess (D-09/D-10)"
  - "Production fail-fast requires SENTRY_DSN and APP_VERSION; local defaults APP_VERSION to dev"
  - "Transaction pooler port 6543 rejected before any migration subprocess starts"

patterns-established:
  - "env.ts is first config import; medusa-config maps validated env only"
  - "Migration smoke evidence recorded without URLs, credentials, or hostnames"

requirements-completed: [SETUP-01]

# Metrics
duration: ~2h
completed: 2026-06-24
status: pending-review
---

# Plan 01-02: Supabase/Postgres Env & Migration Strategy Summary

**Typed Zod fail-fast env schema with production SENTRY/APP_VERSION gates and a migration subprocess that rejects transaction pooler port 6543**

## Performance

- **Duration:** ~2h (Tasks 1–2 automated + Task 3 human smoke)
- **Started:** 2026-06-24T21:00:00Z (after 01-01 close)
- **Completed:** 2026-06-24T23:00:00Z
- **Tasks:** 3 (2 auto/TDD + 1 blocking human-action)
- **Files modified:** 7 in feat commit `6330853`

## Accomplishments

- `parseEnv()` / `env` with local vs production rules (D-08, D-13)
- `medusa-config.ts` consumes validated env before `defineConfig` (database, worker mode, CORS, admin)
- `.env.template` documents full contract without real secrets
- `scripts/run-migrations.mjs` with `assertMigrationUrl`, `buildMigrationChildEnv`, `--check-only`
- `npm run db:migrate:safe` script added
- 15 unit tests covering environment, SENTRY/APP_VERSION, and migration guard
- Task 3 human smoke: real Postgres + Redis, migration exit 0, Admin at loopback `/app`, no prepared-statement errors

## TDD Flow (RED → GREEN)

| Stage | Commit / state | Evidence |
|-------|----------------|----------|
| **Tasks 1–2 GREEN** | `6330853` — `feat(01-02): add fail-fast env schema and migration guard` | env.unit.spec.ts RED-first; 15/15 unit tests pass; build pass |
| **Task 3 smoke** | Human-confirmed (not committed) | See External Smoke Evidence below |

## Task Commits

1. **Task 1: Environment schema** — included in `6330853`
2. **Task 2: Migration guard** — included in `6330853`
3. **Task 3: Postgres/Redis smoke** — human-confirmed; evidence in summary only

## Files Created/Modified

- `apps/backend/src/config/env.ts` — `parseEnv`, `env`, production fail-fast
- `apps/backend/src/config/__tests__/env.unit.spec.ts` — environment + migration guard tests
- `apps/backend/scripts/run-migrations.mjs` — migration URL guard and subprocess runner
- `apps/backend/.env.template` — local/production variable contract
- `apps/backend/medusa-config.ts` — validated env wiring
- `apps/backend/package.json` — `db:migrate:safe` script

## Decisions Made

- Error messages cite variable names and rules only — never connection string values (T-01-05)
- Migration tests invoke `run-migrations.mjs` via Node subprocess to avoid Jest ESM `.mjs` import limits without changing Wave 0 jest.config.js
- Redis provider wiring deferred to Plan 01-03 per scope boundary

## Deviations from Plan

None - plan executed exactly as written.

## External Smoke Evidence (Task 3)

Sanitized record per plan acceptance criteria — no URLs, credentials, DSNs, or hostnames.

| Field | Value |
|-------|-------|
| Date | 2026-06-24 |
| Infrastructure | Postgres and Redis containers available (Docker/WSL) |
| Command | `cd apps/backend && npm run db:migrate:safe` |
| Migration exit code | 0 |
| Dev server | `npm run dev -- --host 127.0.0.1 --port 9000` |
| Admin check | Loaded at loopback `/app` after refresh |
| Prepared statements | No errors observed |
| Guard regression | Unit suite 15/15 pass |

## Verification Results

| Check | Result |
|-------|--------|
| Unit tests (full env suite) | PASS (15/15) |
| `node scripts/run-migrations.mjs --check-only` (with valid URL in env) | PASS |
| `npm run build` | PASS (prior to feat commit) |
| Real migration smoke | PASS (human-confirmed, exit 0) |
| Admin `/app` on loopback | PASS (human-confirmed) |

## Self-Check: PASSED

All plan acceptance criteria met including Task 3 blocking checkpoint.

## User Setup Required

Local `.env` (gitignored) must supply database and Redis URLs for development smoke. Values are never committed. See `apps/backend/.env.template`.

## Pending Review Actions

1. Review `6330853` and this summary
2. Approve plan closure before starting Plan 01-03 (Redis providers)

## Next Phase Readiness

- **Ready for 01-03:** env schema, migration guard, `.env.template`, validated medusa-config database wiring
- **01-03 scope:** Redis-backed cache, event bus, workflow engine providers
- **Not in 01-02:** logger, Sentry, health endpoints, PM2, Nginx

---
*Phase: 01-foundation-observability*
*Plan: 01-02*
*Status: pending-review*
