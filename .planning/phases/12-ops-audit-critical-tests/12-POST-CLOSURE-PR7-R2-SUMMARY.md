# P12-POST-CLOSURE-PR7-R2 Summary

## Gate

```text
gate: P12-POST-CLOSURE-PR7-R2
PR: https://github.com/jlima004/E-commerce/pull/7
reviewer: chatgpt-codex-connector
reviewed commit: 4ed9fc86be9833f85716c1df3a3ef8d66942e231
priority: P2 (authorized)
P1: classified false positive by Product Manager — out of technical scope
```

## Base SHA

```text
4ed9fc86be9833f85716c1df3a3ef8d66942e231
```

## Finding in scope

```text
Use one portable Docker invocation strategy in the disposable PostgreSQL harness.
```

## Technical diagnosis

The versioned disposable PostgreSQL runner invoked Docker through the Codex agent
wrapper:

```js
run("rtk", ["docker", "info"])
run("rtk", ["docker", ...args])
```

That made `rtk` a runtime dependency of project code. On Cursor/WSL2 Ubuntu 24.04
(and any machine with Docker but without `rtk`), `spawn("rtk")` fails with
`ENOENT` and disposable PostgreSQL never starts.

`RTK.md` remains valid Codex-agent orientation. It does **not** make `rtk` a
versioned runtime dependency.

### Binding distinction

```text
Agent wrapper (Codex optional external prefix):
  rtk npm ...
  rtk git ...
  rtk docker ...

Versioned project harness (canonical):
  docker info
  docker run
  docker exec
  docker port
  docker inspect
  docker rm
```

```text
rtk: optional external Codex agent wrapper
docker: canonical runtime dependency of the harness
Cursor: runs the runner directly (no rtk)
Codex: may prefix the outer shell command with rtk; the script still calls docker
```

## Correction

In `apps/backend/scripts/run-disposable-postgres-tests.mjs`:

- `dockerIsAvailable()` → `run("docker", ["info"], { capture: true })` with
  `ENOENT` → unavailable
- `dockerRun(args)` → `run("docker", args, { capture })`
- No `P12_DOCKER_BIN` override (not required)
- Preserved: `spawn` without `shell: true`, argv arrays, redaction, cleanup,
  signals, loopback-only, disposable names, external vs Docker mode, error codes

Unit regression in
`apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts`
proves the runner source:

- calls `docker` directly
- does not call `rtk`
- does not use `shell: true`
- keeps `spawn(command, args, …)` argv separation
- retains provisioning/cleanup/Medusa isolation contracts

## Environment proof (Cursor / WSL2)

```text
OS/WSL: available (Ubuntu 24.04 on WSL2)
Docker CLI: present (/usr/bin/docker)
Docker daemon: reachable
Docker context: available
Node: 22.x
Runtime dependency on rtk: none
```

## Focused tests

```text
node --check run-disposable-postgres-tests.mjs: PASS
Focused harness unit: PASS (24)
Disposable smoke (direct docker, no rtk): PASS
PostgreSQL serial disposable (5/5, one process per spec): PASS
Residual containers p12-pg-*: 0 after each run and at end
```

Serial paths:

1. `webhook-event-log.postgres.spec.ts`
2. `checkout-completion-log.postgres.spec.ts`
3. `gelato-fulfillment.postgres.spec.ts`
4. `operational-alert.postgres.spec.ts`
5. `admin-action-log.postgres.spec.ts`

## Full regression

```text
Full Unit: PASS (54 suites / 890 tests)
Full Modules: PASS (36 suites / 511 tests)
Full HTTP: PASS (19 suites / 236 tests)
Lint: PASS (0 errors / 210 pre-existing warnings)
Build: PASS (ADMIN_DISABLED=true)
```

## Negative proofs

```text
rg run("rtk"|spawn("rtk"|rtk.*docker) on runner: empty
rg run("docker") on runner: present
rg shell: true on runner: empty
git diff --check: empty
package/lockfile/medusa-config/jest/RTK.md/AGENTS.md vs base: no diff
schema/migrations/providers/frontend/Phase 12.1/Phase 13: absent
secrets / raw provider payloads displayed: no
```

## Files changed

### Technical allowlist

```text
apps/backend/scripts/run-disposable-postgres-tests.mjs
apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts
```

`apps/backend/integration-tests/postgres/disposable-postgres-harness.ts` unchanged
(executable swap only; adapter not required).

### Documentary allowlist

```text
.planning/phases/12-ops-audit-critical-tests/12-POST-CLOSURE-PR7-R2-SUMMARY.md
.planning/phases/12-ops-audit-critical-tests/12-CLOSURE.md
.planning/phases/12-ops-audit-critical-tests/12-DISCUSSION-LOG.md
.planning/ROADMAP.md
.planning/STATE.md
```

## Commits

```text
technical: fix(testing): remove agent wrapper dependency from PG harness
documentary: docs(12): record PR7 Docker harness portability fix
```

## Limits

No push, deploy, GitHub thread mutation, Codex re-review request, Phase 12.1,
Phase 13, milestone closeout, frontend, or external providers.

Historical PLAN/SUMMARY commands that document Codex invoking via `rtk` remain
as historical execution records; they are not runtime contracts.

## Result

```text
P12-POST-CLOSURE-PR7-R2: PASS
P1 classification: false positive (PM) — no runtime changes
P2 classification: valid — corrected
Phase 12 closure: reaffirmed
Phase 12.1: not started / blocked until separate push + PR replies + Codex re-review
```

## Next permitted step

Separate authorization to push, reply to the P1/P2 threads, and request Codex
re-review.
