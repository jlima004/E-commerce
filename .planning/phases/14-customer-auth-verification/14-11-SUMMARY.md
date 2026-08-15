---
phase: 14-customer-auth-verification
plan: 11
subsystem: auth
tags: [jwt, postgres, refresh-token, lineage, multiprocess, fail-closed]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: database-authoritative session lineage, JWT, refresh rotation, and revocation
provides:
  - PostgreSQL-authoritative customer access guard
  - custom capability-bound refresh and guarded lineage revocation routes
  - cross-process revocation, replay, version, deadline, and outage evidence
affects: [14-12, authenticated-customer-surface]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-request PostgreSQL authorization, fail-closed auth middleware, exact-set auth surface]

key-files:
  created:
    - apps/backend/src/modules/customer-auth/access-guard.ts
    - apps/backend/src/api/auth/token/refresh/route.ts
    - apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts
  modified:
    - apps/backend/src/api/auth-surface/manifest.ts
    - apps/backend/src/api/middlewares.ts
    - apps/backend/integration-tests/http/auth-multiprocess.spec.ts

key-decisions:
  - "A cryptographically valid access JWT never grants access without a matching active PostgreSQL lineage and stable credential state."
  - "Only POST /auth/token/refresh and POST /auth/customer/emailpass/revoke-current-lineage are PHASE14_ENABLED."
  - "Database lookup errors return a generic temporary-unavailability denial before the protected handler."

patterns-established:
  - "Every authenticated Phase 14 operation verifies lineage status, identity/customer ownership, credential version, stable operation state, and absolute deadline in PostgreSQL."
  - "Redis may coordinate rate limits but never establishes access or refresh validity."

requirements-completed: []

# Metrics
duration: 11min
completed: 2026-08-14
status: checkpoint
---

# Phase 14 Plan 11: Access Guard and Auth Surface Summary

**Added a PostgreSQL-authoritative access guard plus exact custom refresh/revoke routes, with disposable cross-process proofs that stale, revoked, replayed, version-mismatched, and expired credentials fail closed.**

## Final status

- **14-11-01:** EXECUTED — AWAITING HUMAN REVIEW
- **14-11-02:** EXECUTED — AWAITING HUMAN REVIEW
- **B14-11-HR-01:** REMEDIATED — AWAITING HUMAN RE-REVIEW
- **14-11-03:** BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
- **14-11:** NOT YET HUMAN APPROVED
- **14-12:** NOT AUTHORIZED
- **Push / deploy:** NONE — NOT AUTHORIZED

`requirements-completed` remains empty until the blocking human checkpoint approves the plan.

## Remediation: B14-11-HR-01

- The PostgreSQL access guard still requires `lineage_status = active` by default.
- Only the exact `POST /auth/customer/emailpass/revoke-current-lineage` request is marked as the revoke operation by the middleware; that operation may pass a matching `revoked` lineage for idempotent completion.
- JWT cryptography, `sid`/lineage binding, auth identity, customer ownership, credential version, stable operation state, absolute deadline, and PostgreSQL lookup remain mandatory in both active and idempotent-revoke decisions.
- All other guarded operations continue to reject a revoked lineage. DB failures remain `503 AUTH_TEMPORARILY_UNAVAILABLE`; Redis is not consulted for validity.
- The focused HTTP worker now executes the real guard → revoke `POST` chain. It no longer calls `handleRevokeCurrentLineage()` with synthetic `customerAuth`.
- `apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts` was not changed; no manifest or auth-surface expansion was made.

## Accomplishments

- Validates access JWT cryptography, then requires one matching PostgreSQL lineage/credential record with active lineage, matching identity/customer ownership, matching credential version, stable operation state, and an unexpired absolute deadline.
- Fails closed on missing/inconsistent rows and database errors before the protected handler is reached.
- Exposes capability-bound custom refresh with mandatory `Idempotency-Key` and exactly empty body, plus guarded idempotent current-lineage revocation returning 204 through the authorization chain.
- Elevates only the two approved custom paths; native refresh/session, aliases, request/status/me/password, and all other deferred auth operations remain denied.
- Proves process-A revocation, replay, credential-version changes, and deadline expiry are rejected by process B without Redis granting validity.

## Task commits

1. **Task 14-11-01 RED: failing access-guard proofs** — `cab74d1`
2. **Task 14-11-01 GREEN: PostgreSQL access guard** — `6e79c56`
3. **Task 14-11-02 RED: failing refresh/revoke proofs** — `93d01fc`
4. **Task 14-11-02 GREEN: custom refresh/revoke exposure** — `dc63ffa`

## Files created or modified

- `apps/backend/src/modules/customer-auth/access-guard.ts` — JWT verification and PostgreSQL-authoritative authorization decision.
- `apps/backend/src/api/middlewares.ts` — fail-closed access middleware on current-lineage revocation.
- `apps/backend/src/api/auth/token/refresh/route.ts` — strict custom refresh contract, rate limiting, rotation, and response serialization.
- `apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts` — guarded idempotent lineage revocation.
- `apps/backend/src/api/auth-surface/manifest.ts` — exact two-path `PHASE14_ENABLED` override.
- `apps/backend/integration-tests/http/auth-multiprocess.spec.ts` — disposable PostgreSQL and multi-process acceptance matrix.

## Verification evidence

- Focused disposable PostgreSQL HTTP suite: **PASS — 8/8 tests**, with disposable database cleanup confirmed.
- Revoke chain evidence: first valid bearer revoke `204`; repeat with the same bearer after `revoked` lineage `204`; revoked bearer on normal protected operation `401`; ownership, credential-version, stable-state, deadline, and invalid-signature cases `401` before handler; DB outage `503` before handler; cross-process revoke valid.
- Exact-set evidence: only `POST /auth/token/refresh` and `POST /auth/customer/emailpass/revoke-current-lineage` remain `PHASE14_ENABLED`; native operations remain `DENY`.
- Backend build: **PASS — 0 TypeScript errors**.
- Repository lint command: **TOOLING FAILURE** — `npm run lint -w @dtc/backend` exited 2 because its JSON parser received an empty ESLint stream; it emitted no file diagnostics. No tooling or package changes were made.
- Direct local ESLint over the three remediation files with `--no-ignore`: **PASS — 0 errors**; two existing Medusa advisory warnings in `middlewares.ts`.
- IDE diagnostics over all six code/test files: **PASS — no errors**.
- `git diff --check`: **PASS**.
- Dependencies, package files, migrations, generated OpenAPI, persistent/remote services, real providers, push, PR, merge, and deploy: **NONE**.

## Explicit cross-process proofs

- A valid JWT without a matching PostgreSQL lineage is denied.
- Lineage revocation in process A is observed and denied in process B.
- Refresh replay/family revocation in process A invalidates subsequent use in process B.
- Credential-version bump in process A invalidates the old access JWT and refresh lineage in process B.
- Absolute-deadline expiry is rejected across processes.
- Empty or unavailable Redis does not grant access or refresh validity.
- Database outage returns fail-closed temporary unavailability before handler execution.
- The custom revoke operation is idempotent 204; custom refresh rejects missing capability, missing idempotency key, or a non-empty body.

## Decisions made

- PostgreSQL remains the only source of authorization truth; no positive validity cache was introduced.
- Database outage is distinguished as generic temporary unavailability while malformed, stale, mismatched, revoked, or expired credentials receive generic authentication denial.
- Human review remains mandatory before requirements are marked complete or Plan 14-12 begins.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Resolved framework service type incompatibility**
- **Found during:** Task 14-11-02 GREEN build verification.
- **Issue:** TypeScript rejected the narrowed customer-service interface cast returned by the Medusa container.
- **Fix:** Used an explicit `unknown` boundary before the local structural interface cast.
- **Files modified:** `apps/backend/src/api/auth/token/refresh/route.ts`
- **Verification:** Backend build passes.
- **Committed in:** `dc63ffa`

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type-only compatibility fix within authorized scope; no behavior or scope expansion.

## Issues encountered

- The repository `medusa lint` wrapper failed while parsing an empty JSON stream on two attempts. Direct local ESLint and IDE diagnostics confirmed zero errors in the scoped files. This tooling condition was not changed because lint tooling/package files are outside the authorized scope.

## Threat flags

| Flag | File | Description |
|---|---|---|
| threat_flag: authentication-endpoint | `apps/backend/src/api/auth/token/refresh/route.ts` | New custom refresh trust boundary, capability-bound and database-authoritative. |
| threat_flag: authentication-endpoint | `apps/backend/src/api/auth/customer/emailpass/revoke-current-lineage/route.ts` | New guarded current-lineage revocation trust boundary. |

## Scope and authorization boundary

Execution stops at Task 14-11-03. No human approval is claimed. Plan 14-12 and later plans remain unauthorized, and no push or deploy was performed.

## Self-check: PASSED

- All six authorized code/test files exist.
- RED/GREEN commits `cab74d1`, `6e79c56`, `93d01fc`, and `dc63ffa` exist locally in order.
- This summary exists at the authorized path.

---

*Plan: 14-11*
*Checkpoint: BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW*
