---
phase: 01-foundation-observability
plan: "03"
subsystem: infra
tags: [medusa, redis, ioredis, caching-redis, locking-redis, env-schema, workflow-engine]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "02"
    provides: Typed fail-fast env schema with four Redis contract names in .env.template
provides:
  - buildRedisModules / uniqueRedisUrls / resolveProjectRedisUrl wired in medusa-config.ts
  - Production fail-fast tests for all four Redis contract names
  - Pinned @medusajs/caching-redis@2.16.0 and ioredis@5.11.1 runtime dependencies
  - Locking module via @medusajs/medusa/locking-redis using REDIS_URL (no fifth contract)
affects: [01-04, 01-06, 01-07]

# Tech tracking
tech-stack:
  added:
    - "@medusajs/caching-redis@2.16.0"
    - "ioredis@5.11.1"
  patterns:
    - "Redis module descriptors built from CACHE/EVENTS/WE contracts; REDIS_URL for projectConfig + locking (D-11)"
    - "Local omits Redis modules when module contracts absent; production always wires Redis after parseEnv (D-12/D-13)"
    - "medusa-config.ts spreads buildRedisModules(env) and sets projectConfig.redisUrl via resolveProjectRedisUrl"

key-files:
  created:
    - apps/backend/src/infrastructure/redis-config.ts
    - apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts
  modified:
    - apps/backend/package.json
    - package-lock.json
    - apps/backend/medusa-config.ts
    - apps/backend/src/config/__tests__/env.unit.spec.ts

key-decisions:
  - "buildRedisModules uses redis.redisUrl for workflow engine per Medusa 2.16 Pitfall 1"
  - "Locking uses REDIS_URL via @medusajs/medusa/locking-redis — no LOCKING_REDIS_URL in Phase 01"
  - "resolveProjectRedisUrl maps REDIS_URL to projectConfig.redisUrl when Redis modules are wired"
  - "Exact version pins (no caret) for caching-redis and ioredis per SUS gate approval"

patterns-established:
  - "Infrastructure wiring isolated in redis-config.ts; medusa-config spreads buildRedisModules(env)"
  - "uniqueRedisUrls deduplicates probe endpoints without collapsing contract validation"

requirements-completed:
  - SETUP-02

# Metrics
duration: ~70min
completed: 2026-06-24
status: pending-checkpoint
---

# Plan 01-03: Redis Contracts & Provider Wiring Summary

**Durable Redis infrastructure connected — runtime human-check passed**

## Performance

- **Duration:** ~70 min (Tasks 1–3 + runtime remediation)
- **Started:** 2026-06-24T23:30:00Z
- **Completed:** 2026-06-24T20:45:00Z
- **Tasks:** 3 of 3 complete (automated + runtime human-check)
- **Files modified:** 6

## Accomplishments

- `@medusajs/caching-redis@2.16.0` and `ioredis@5.11.1` pinned and installed
- `projectConfig.redisUrl` set from `REDIS_URL` via `resolveProjectRedisUrl(env)` when Redis modules wire
- Four Redis-backed modules wired: caching, locking, event bus, workflow engine
- Locking uses `@medusajs/medusa/locking-redis` with `REDIS_URL` (no fifth contract)
- 19/19 filtered unit tests pass; build exits 0; runtime smoke passes all acceptance criteria

## Task Status

| Task | Status | Notes |
|------|--------|-------|
| **Task 1: SUS package + provisioning gate** | Complete ✓ | Human approved |
| **Task 2: Redis contracts + testable builder** | Complete ✓ | 34 total unit tests |
| **Task 3: Install + wiring + runtime check** | Complete ✓ | All acceptance criteria met |

## Verification (automated)

```bash
cd apps/backend && npm run test:unit -- --runTestsByPath \
  src/infrastructure/__tests__/redis-config.unit.spec.ts \
  src/config/__tests__/env.unit.spec.ts -t "Redis|provider|fallback|projectConfig|locking"
# → 19 passed, 15 skipped

npm ls @medusajs/caching-redis ioredis @medusajs/locking-redis
# → caching-redis@2.16.0, ioredis@5.11.1, locking-redis@2.16.0 (via @medusajs/medusa)

npm run build
# → exit 0 (no fake Redis warning during build)
```

## Runtime Human-Check (sanitized evidence)

**Command:** `cd apps/backend && npm run dev` with local `.env` loaded (four Redis contract names set; values not recorded).

| Criterion | Result | Sanitized evidence |
|-----------|--------|-------------------|
| No fake Redis log | **PASS** | No `fake redis instance` lines in startup log |
| No Local Event Bus fallback | **PASS** | No `Local Event Bus`; `Connection to Redis in module 'event-bus-redis' established` |
| No in-memory locking fallback | **PASS** | No `in-memory` locking default; `Connection to Redis in "locking-redis" provider established` |
| Admin at `127.0.0.1:9000/app` | **PASS** | `GET /app` → HTTP **200**; `Server is ready on port: 9000` |

**Module connections confirmed (same run):** caching Redis, event-bus-redis, workflow-engine-redis (+ PubSub), locking-redis provider.

## Files Created/Modified

- `apps/backend/src/infrastructure/redis-config.ts` — added `resolveProjectRedisUrl`, locking module wiring
- `apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts` — locking + projectConfig tests
- `apps/backend/medusa-config.ts` — `projectConfig.redisUrl` + `buildRedisModules(env)`
- `apps/backend/package.json` / `package-lock.json` — pinned Redis dependencies
- `apps/backend/src/config/__tests__/env.unit.spec.ts` — production Redis contract tests

## Deviations from Plan

- Added `resolveProjectRedisUrl` helper and locking module wiring to resolve runtime findings (within Plan 01-03 scope; no fifth Redis contract)

## Issues Encountered

- Initial runtime smoke showed fake Redis warnings and in-memory locking — resolved by mapping `REDIS_URL` to `projectConfig.redisUrl` and wiring `@medusajs/medusa/locking-redis`

## Next Phase Readiness

- **Awaiting human review** to close Plan 01-03
- **Do not start Plan 01-04** until approved
- **Downstream:** Plan 01-06 can use `uniqueRedisUrls` for readiness probes

---
*Phase: 01-foundation-observability*
*Plan: 03 — ready for human closure*
