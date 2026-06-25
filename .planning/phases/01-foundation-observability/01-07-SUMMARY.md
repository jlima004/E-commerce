---
phase: 01-foundation-observability
plan: "07"
subsystem: infra
tags: [pm2, nginx, certbot, logrotate, deploy, tls, worker-mode]

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
  - "Task 3 VPS/TLS/reboot validation deferred to operator checkpoint — code and contract tests complete"

patterns-established:
  - "Ops artifacts use placeholders only (__API_HOST__, __ADMIN_HOST__, APP_ROOT, APP_USER)"
  - "Selective rate limit targets auth routes via medusa_auth zone — never global"
  - "Production deploy order: APP_VERSION → build → db:migrate:safe → pm2 reload → smoke"

requirements-completed:
  - SETUP-03
  - SETUP-04

# Metrics
duration: 18 min
completed: 2026-06-25
status: pending-review
---

# Phase 01 Plan 07: Production Ops Templates Summary

**PM2 server/worker ecosystem, Nginx API/Admin vhost templates, logrotate policy, and Portuguese deploy runbook — all parameterized with contract tests, no committed secrets**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-25T16:05:00Z
- **Completed:** 2026-06-25T16:23:00Z
- **Tasks:** 2 of 3 complete (Task 3 blocked on operator VPS checkpoint)
- **Files modified:** 6 created

## Accomplishments

- Added `ops/pm2/ecosystem.config.cjs` with `medusa-server` (loopback `127.0.0.1:9000`, Admin enabled) and `medusa-worker` (Admin disabled, no HTTP bind).
- Added `ops/nginx/medusa.conf.template` with separate API/Admin hosts, security headers, body limits (2m/10m), timeouts, selective auth rate limit, health without rate limit, and raw webhook body preservation.
- Added `ops/logrotate/medusa` for daily rotation, seven compressed archives, maxsize 100M.
- Added `ops/DEPLOY.md` runbook covering local dev, production deploy, migration gate, TLS, firewall, smoke, rollback, reboot checkpoint, and staging as future convention only.
- Added contract tests proving PM2 topology and Nginx host isolation.

## Task Commits

Pending operator review — commits not created in this session unless requested.

1. **Task 1: PM2 and Nginx contract tests (RED→GREEN)** — pending commit
2. **Task 2: Templates and runbook** — pending commit
3. **Task 3: [BLOCKING] VPS/TLS/reboot validation** — **not started** (requires operator)

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
- Task 3 remains a blocking human gate — no VPS evidence recorded in this session.

## Deviations from Plan

None - plan executed as written for Tasks 1–2. Task 3 intentionally paused per manual-review gating and blocking checkpoint specification.

## Issues Encountered

- PM2 contract test initially checked resolved `APP_VERSION` value instead of source pattern — fixed to assert `APP_VERSION: process.env.APP_VERSION` in ecosystem source.
- Nginx smoke test had escaped regex characters in fixed-string grep patterns — corrected for `location ^~ /hooks` matching.
- `nginx -t` skipped locally (binary not installed); structural assertions pass.

## User Setup Required

**Task 3 requires operator action on a production VPS.** See `ops/DEPLOY.md` checklist:

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

## Next Phase Readiness

- **Plan 01-07 Tasks 1–2:** Ready for human review.
- **Plan 01-07 Task 3:** Blocked — operator must deploy to VPS, validate TLS/reboot/isolation, and approve before Phase 01 closure.
- **Phase 02:** Must not start until Phase 01 is explicitly approved and closed.

---
*Phase: 01-foundation-observability*
*Completed: 2026-06-25*
