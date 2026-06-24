---
phase: 01-foundation-observability
plan: "01"
subsystem: infra
tags: [medusa, jest, bootstrap, node-22, tdd]

# Dependency graph
requires: []
provides:
  - Medusa v2.16.0 backend-only monorepo scaffold in apps/backend
  - Jest runner and integration setup (Wave 0 shared infra)
  - Walking Skeleton bootstrap contract test (admin.path /app, no storefront)
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07]

# Tech tracking
tech-stack:
  added: [Medusa 2.16.0, Jest 29.7, @swc/jest, turbo 2.x]
  patterns: [test-first bootstrap contract, backend-only workspace, static config assertions without external services]

key-files:
  created:
    - package.json
    - package-lock.json
    - apps/backend/package.json
    - apps/backend/jest.config.js
    - apps/backend/integration-tests/setup.js
    - apps/backend/integration-tests/http/bootstrap.spec.ts
  modified:
    - apps/backend/medusa-config.ts

key-decisions:
  - "Import create-medusa-app@2.16.0 output selectively; no storefront workspace package"
  - "Bootstrap contract uses static medusa-config.ts assertions — no HTTP boot or DB/Redis in Wave 0"
  - "All @medusajs/* direct dependencies pinned to 2.16.0; engines.node >=22 <23"

patterns-established:
  - "Wave 0: only jest.config.js, integration-tests/setup.js, and slice-owned bootstrap.spec.ts — no future-slice tests"
  - "RED → GREEN: bootstrap spec committed before scaffold fix; admin.path /app is the GREEN delta"

requirements-completed: [SETUP-01]

# Metrics
duration: ~45min
completed: 2026-06-24
status: pending-review
---

# Plan 01-01: Medusa Backend Scaffold Summary

**Medusa v2.16.0 backend-only monorepo with Jest Wave 0 runner and a test-first bootstrap contract proving Admin at `/app` and no storefront**

## Performance

- **Duration:** ~45 min (Task 1 gate + Task 2 scaffold/TDD)
- **Started:** 2026-06-24T18:06:46Z (RED commit)
- **Completed:** 2026-06-24T19:55:00Z
- **Tasks:** 2 (Task 1 human gate + Task 2 auto/TDD)
- **Files modified:** 31 in RED commit; 1 pending GREEN delta (`medusa-config.ts`)

## Accomplishments

- Supply-chain gate approved for official Medusa 2.16.0 packages (Task 1)
- Selective import of `create-medusa-app@2.16.0` scaffold without storefront
- `Walking Skeleton bootstrap` integration spec with static/isolated assertions (no external services)
- Jest runner (`jest.config.js`) and integration setup (`integration-tests/setup.js`) for Wave 0
- `admin.path: "/app"` configured in `medusa-config.ts` — bootstrap tests GREEN
- `npm run build` completes with exit code 0

## TDD Flow (RED → GREEN)

| Stage | Commit / state | Evidence |
|-------|----------------|----------|
| **RED** | `5cd21c0` — `test(01-01): import Medusa 2.16.0 scaffold with RED bootstrap contract` | Scaffold + `bootstrap.spec.ts` imported; `medusa-config.ts` lacked `admin.path` → test fails on `/app` assertion |
| **GREEN** | Working tree (uncommitted, pending review) | Added `admin: { path: "/app" }` to `medusa-config.ts`; bootstrap spec passes |

RED verification (reproducible): checkout `5cd21c0` and run bootstrap test — fails on `serves Medusa Admin at /app`.

GREEN verification (current tree):

```
PASS integration-tests/http/bootstrap.spec.ts
  Walking Skeleton bootstrap
    ✓ serves Medusa Admin at /app
    ✓ is a backend-only workspace without storefront packages
```

## Task Commits

1. **Task 1: [BLOCKING] Package legitimacy gate** — human-approved (no commit; gate logged at execution)
2. **Task 2: Scaffold + bootstrap TDD**
   - RED: `5cd21c0` (`test(01-01): import Medusa 2.16.0 scaffold with RED bootstrap contract`)
   - GREEN: pending review — `apps/backend/medusa-config.ts` (`admin.path: "/app"`)

## Files Created/Modified

- `package.json` — npm workspace root, turbo scripts, Node 22 engines
- `package-lock.json` — pinned dependency tree
- `apps/backend/package.json` — Medusa 2.16.0 deps, dev/build/test scripts
- `apps/backend/medusa-config.ts` — `admin.path: "/app"` (GREEN delta)
- `apps/backend/jest.config.js` — TEST_TYPE-based testMatch routing
- `apps/backend/integration-tests/setup.js` — sets `NODE_ENV=test`
- `apps/backend/integration-tests/http/bootstrap.spec.ts` — bootstrap contract suite

## Decisions Made

- Followed plan: static bootstrap assertions instead of live HTTP boot (Wave 0 scope)
- Preserved `.planning`, `docs`, `.codex`, `AGENTS.md`; no storefront directory or scripts
- No tests from plans 01-02..01-07 created

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Medusa build warns `redisUrl not found` (uses fake Redis during build) — expected for Wave 0; Redis wiring is plan 01-03
- Lint step skipped during build (`eslint` not installed in backend workspace) — scaffold default; lint tooling is out of 01-01 scope

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Bootstrap test | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/bootstrap.spec.ts` | PASS (2/2) |
| Runner files | `test -f jest.config.js && test -f integration-tests/setup.js` | PASS |
| Build | `cd apps/backend && npm run build` | PASS (exit 0) |
| No storefront | `find . -maxdepth 3 -type d -iname '*storefront*'` | PASS (empty) |
| Medusa versions | `npm ls @medusajs/medusa @medusajs/framework @medusajs/cli @medusajs/test-utils` | All 2.16.0 |
| Workspace | `npm ls --workspaces --depth=0` | Only `@dtc/backend` |

## Self-Check: PASSED

All plan acceptance criteria and verification commands pass on the current working tree.

## User Setup Required

None - no external service configuration required for this slice.

## Pending Review Actions

1. Review and commit GREEN delta: `apps/backend/medusa-config.ts` (`admin.path: "/app"`)
2. Optionally commit this SUMMARY and STATE update after approval
3. Confirm Wave 0 complete before starting 01-02

## Next Phase Readiness

- **Ready:** Jest runner, bootstrap contract, compilable Medusa 2.16.0 backend-only scaffold
- **Blocked until 01-02:** env validation, Supabase migration URL strategy, real Postgres/Redis smoke
- **Not in scope yet:** Redis providers, logger/redaction, Sentry, health endpoints, PM2/Nginx

---
*Phase: 01-foundation-observability*
*Plan: 01-01*
*Status: pending-review*
