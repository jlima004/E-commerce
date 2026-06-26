---
phase: 01-foundation-observability
plan: "07"
subsystem: infra
tags: [pm2, nginx, certbot, logrotate, deploy, tls, worker-mode, heroku]

# Dependency graph
requires:
  - phase: 01-foundation-observability
    plan: "02"
    provides: DATABASE_URL runtime and db:migrate:safe migration gate
  - phase: 01-foundation-observability
    plan: "03"
    provides: Four Redis contracts and production fail-fast wiring
  - phase: 01-foundation-observability
    plan: "05"
    provides: Sentry release tagging via APP_VERSION
  - phase: 01-foundation-observability
    plan: "06"
    provides: /health/live and /health/ready endpoints for Nginx and PM2 probes
provides:
  - PM2 ecosystem template with medusa-server and medusa-worker roles
  - Nginx virtual host template separating API and Admin subdomains
  - OS logrotate policy for PM2-managed stdout/stderr
  - Production deployment runbook covering local and production with staging as future convention
  - Contract tests for PM2 bind/worker isolation and Nginx host routing
  - Heroku/Supabase/Redis production checkpoint for app espacoliminar release v27
affects: [phase-01-closure, phase-02-catalog]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PM2 server binds 127.0.0.1:9000; worker runs medusa start without HTTP bind flags"
    - "Nginx is sole public edge; API blocks /app; Admin blocks /hooks and /webhooks"
    - "Webhook locations preserve raw body via proxy_pass_request_body and signature header forwarding"
    - "APP_VERSION exported once at deploy time and passed through PM2 without literal fallback"
    - "db:migrate:safe runs before PM2 reload on every production deploy"

key-files:
  created:
    - ops/pm2/ecosystem.config.cjs
    - ops/nginx/medusa.conf.template
    - ops/logrotate/medusa
    - ops/DEPLOY.md
    - ops/tests/pm2-config.test.mjs
    - ops/tests/nginx-routing-smoke.sh
  modified: []

key-decisions:
  - "Worker runs medusa start without --host/--port; WORKER_MODE=worker suppresses HTTP listener per Medusa production docs"
  - "Nginx uses named upstream medusa_upstream block instead of inline proxy_pass for keepalive efficiency"
  - "The original Task 3 VPS/TLS/reboot checkpoint was superseded for this cycle by the Heroku/Supabase/Redis production checkpoint"
  - "Current production target for this cycle is Heroku app espacoliminar instead of the original VPS/PM2/Nginx route"
  - "Redis cache provider is temporarily disabled by REDIS_CACHE_PROVIDER_DISABLED=true on Heroku; Redis remains active for health and remaining Redis-backed modules"

patterns-established:
  - "Ops artifacts use placeholders only (__API_HOST__, __ADMIN_HOST__, APP_ROOT, APP_USER)"
  - "Selective rate limit targets auth routes via medusa_auth zone — never global"
  - "Production deploy order: APP_VERSION → build → db:migrate:safe → pm2 reload → smoke"

requirements-completed:
  - SETUP-03
  - SETUP-04

# Metrics
duration: 18 min
completed: 2026-06-26
status: complete
---

# Phase 01 Plan 07: Production Ops Templates Summary

**PM2 server/worker ecosystem, Nginx API/Admin vhost templates, logrotate policy, and Portuguese deploy runbook — all parameterized with contract tests, no committed secrets**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-25T16:05:00Z
- **Completed:** 2026-06-26T00:00:00Z
- **Tasks:** 3 of 3 complete for the current Heroku production target; the original VPS checkpoint remains as a portable blueprint only
- **Files modified:** 6 created

## Accomplishments

- Added `ops/pm2/ecosystem.config.cjs` with `medusa-server` (loopback `127.0.0.1:9000`, Admin enabled) and `medusa-worker` (Admin disabled, no HTTP bind).
- Added `ops/nginx/medusa.conf.template` with separate API/Admin hosts, security headers, body limits (2m/10m), timeouts, selective auth rate limit, health without rate limit, and raw webhook body preservation.
- Added `ops/logrotate/medusa` for daily rotation, seven compressed archives, maxsize 100M.
- Added `ops/DEPLOY.md` runbook covering local dev, production deploy, migration gate, TLS, firewall, smoke, rollback, reboot checkpoint, and staging as future convention only.
- Added contract tests proving PM2 topology and Nginx host isolation.

## Heroku/Supabase/Redis Checkpoint (2026-06-26)

This cycle replaces the original VPS/PM2/Nginx production route with Heroku as the current production target. No runtime changes, secrets, config vars, deploys, migrations, or functional smoke tests were performed while documenting this checkpoint.

Validated state supplied by the operator:

- Heroku app: `espacoliminar`
- Release: `v27`
- Deployed commit: `d02fd70`
- Local branch: `gsd/phase-01-foundation-observability`
- `origin/gsd-...` synchronized with `d02fd70`
- `heroku/main` synchronized with `d02fd70`
- `APP_VERSION=d02fd70`
- `/health/live` returns 200
- `/health/ready` returns 200
- `/health/ready` shows Postgres `up` and Redis `up`
- `web.1` is up
- `worker.1` is up
- `git status` is clean

Operational decisions recorded:

- Heroku is the current runtime.
- Supabase Postgres is used through the pooler.
- Heroku Redis is used with TLS.
- `REDIS_CACHE_PROVIDER_DISABLED=true` keeps `@medusajs/caching-redis` temporarily disabled to avoid the Heroku TLS/self-signed loop.
- Redis remains active for health and the remaining Redis-backed modules.
- Heroku release phase remains active for migrations:

```Procfile
release: cd apps/backend && npm run db:migrate:safe
web: cd apps/backend/.medusa/server && WORKER_MODE=server ADMIN_DISABLED=false npm run start -- --host 0.0.0.0 --port $PORT
worker: cd apps/backend/.medusa/server && WORKER_MODE=worker ADMIN_DISABLED=true npm run start
```

Expected validation commands/results recorded for this checkpoint:

```bash
git status --short
# expected: no output

heroku releases --app espacoliminar
# expected: current release v27 at commit d02fd70

heroku config:get APP_VERSION --app espacoliminar
# expected: d02fd70

curl -fsS https://<production-host>/health/live
# expected: HTTP 200

curl -fsS https://<production-host>/health/ready
# expected: HTTP 200 with postgres: up and redis: up

heroku ps --app espacoliminar
# expected: web.1 up and worker.1 up

heroku logs --app espacoliminar --dyno web --tail=false --num 1500 | grep -E "Redis cache connection error|self-signed certificate|MaxRetriesPerRequestError|ECONNRESET"
# expected: no output

heroku logs --app espacoliminar --dyno worker --tail=false --num 1500 | grep -E "Redis cache connection error|self-signed certificate|MaxRetriesPerRequestError|ECONNRESET"
# expected: no output
```

Known minor technical debt:

- The release dyno may still emit `ECONNRESET`/`ioredis` during `db:migrate:safe`.
- This does not block release `v27` and does not appear in web/worker runtime logs.
- Later investigation: whether `db:migrate:safe` can run without initializing unnecessary Redis providers during migrations.

## Checkpoint Status

No commit was created in this documentation checkpoint unless requested by the operator.

1. **Task 1: PM2 and Nginx contract tests (RED→GREEN)** — completed as portable VPS/PM2/Nginx contract assets.
2. **Task 2: Templates and runbook** — completed as portable VPS/PM2/Nginx blueprint.
3. **Task 3: Production checkpoint** — superseded for this cycle by the validated Heroku/Supabase/Redis deployment checkpoint.

## Files Created/Modified

- `ops/pm2/ecosystem.config.cjs` — Two-process PM2 ecosystem parameterized by `APP_ROOT`; `APP_VERSION` from `process.env` only.
- `ops/nginx/medusa.conf.template` — TLS-ready API/Admin vhosts with placeholder hosts and loopback upstream.
- `ops/logrotate/medusa` — OS-level log rotation for PM2 stdout/stderr paths.
- `ops/DEPLOY.md` — Full deploy/runbook in Portuguese with placeholders throughout.
- `ops/tests/pm2-config.test.mjs` — Node test runner contract for server/worker roles and env passthrough.
- `ops/tests/nginx-routing-smoke.sh` — Structural smoke for host isolation, headers, limits, and webhook body policy.

## Decisions Made

- Worker uses `medusa start` without `--host`/`--port` (Medusa worker mode); contract test verifies absence of HTTP bind flags rather than a separate CLI subcommand.
- Nginx upstream uses a named `medusa_upstream` block for keepalive; smoke test accepts either direct or upstream-block proxy patterns.
- The original VPS validation path remains documented, but it is not the current production target for this cycle.
- Heroku is the current runtime target; release `v27` at commit `d02fd70` is the stabilized checkpoint.

## Deviations from Plan

The original Plan 01-07 production checkpoint expected VPS/TLS/reboot evidence. In this cycle, that route was replaced by Heroku as the current production target, so the checkpoint evidence is Heroku app/release/dyno/health/log validation instead of VPS/Nginx validation.

## Issues Encountered

- PM2 contract test initially checked resolved `APP_VERSION` value instead of source pattern — fixed to assert `APP_VERSION: process.env.APP_VERSION` in ecosystem source.
- Nginx smoke test had escaped regex characters in fixed-string grep patterns — corrected for `location ^~ /hooks` matching.
- `nginx -t` skipped locally (binary not installed); structural assertions pass.

## User Setup Required

No additional setup is required to close this checkpoint. The VPS checklist below remains retained in `ops/DEPLOY.md` as a portable blueprint, not as the current production target:

- DNS for `api.__DOMAIN__` and `admin.__DOMAIN__`
- Production env file with all contracts from `apps/backend/.env.template`
- `APP_VERSION` exported once per release before build/start
- Firewall 22/80/443 only; Postgres/Redis private
- Certbot TLS + `certbot renew --dry-run`
- Post-reboot verification of PM2 restoration and host isolation

No secrets, domains, or DSNs should be recorded in Git or this summary.

## Verification

```bash
node --test ops/tests/pm2-config.test.mjs
# PASS: 6 tests

bash ops/tests/nginx-routing-smoke.sh
# PASS (nginx -t skipped — binary not installed)

cd apps/backend && TMPDIR=/tmp npm run test:unit
# PASS: 4 suites, 72 tests
```

## Next Cycle Readiness

- **Heroku/Supabase/Redis checkpoint:** Documented and stabilized.
- **Next allowed cycle:** Smoke Test backend em produção.
- **Phase 02:** Must not start until the production backend smoke cycle is explicitly completed and Phase 01 is closed.

---
*Phase: 01-foundation-observability*
*Completed: 2026-06-26*
