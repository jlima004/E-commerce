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
  - cross-process revocation, replay, version, deadline, outage, and idempotent-revoke evidence
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
  - "A cryptographically valid access JWT never grants access without a matching PostgreSQL lineage and stable credential state."
  - "Normal authenticated operations require an active lineage; only the exact guarded current-lineage revoke operation may accept the same already-revoked lineage for idempotent 204 completion."
  - "Only POST /auth/token/refresh and POST /auth/customer/emailpass/revoke-current-lineage are PHASE14_ENABLED."
  - "Database lookup errors return a generic temporary-unavailability denial before the protected handler."

patterns-established:
  - "Every authenticated Phase 14 operation verifies lineage status, identity/customer ownership, credential version, stable operation state, and absolute deadline in PostgreSQL."
  - "Redis may coordinate rate limits but never establishes access or refresh validity."
  - "Revoke idempotency is operation-scoped and cannot authorize a revoked lineage for normal protected operations."

requirements-completed: [AUTH-03, AUTH-05, AUTH-06]

# Metrics
duration: 11min + human-review remediation
completed: 2026-08-15
status: complete
---

# Phase 14 Plan 11: Access Guard and Auth Surface Summary

**Implemented and human-approved a PostgreSQL-authoritative access guard plus exact custom refresh/revoke routes, with cross-process proofs for revocation, replay, version, deadline, outage, and guarded revoke idempotency.**

## Final status

- **14-11-01:** HUMAN APPROVED — PASS
- **14-11-02:** HUMAN APPROVED — PASS
- **14-11-03:** HUMAN APPROVED — PASS
- **B14-11-HR-01:** CLOSED — PASS
- **14-11:** HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- **14-12:** AUTHORIZED FOR EXECUTION / NOT STARTED
- **14-13:** NOT AUTHORIZED
- **Deploy:** NOT AUTHORIZED

## Accomplishments

- Validates access JWT cryptography and then requires one matching PostgreSQL lineage/credential record with matching identity/customer ownership, matching credential version, stable operation state, and an unexpired absolute deadline.
- Normal protected operations require an active lineage; a revoked lineage remains denied everywhere except the exact current-lineage revoke operation, where the same valid bearer may complete idempotently with 204.
- Fails closed on missing/inconsistent rows and database errors before the protected handler is reached.
- Exposes capability-bound custom refresh with mandatory `Idempotency-Key` and exactly empty body, plus guarded idempotent current-lineage revocation.
- Elevates only the two approved custom paths; native refresh/session, aliases, request/status/me/password, and all other deferred auth operations remain denied.
- Proves process-A revocation, replay, credential-version changes, and deadline expiry are rejected by process B without Redis granting validity.

## Task commits

1. **Task 14-11-01 RED: failing access-guard proofs** — `cab74d1`
2. **Task 14-11-01 GREEN: PostgreSQL access guard** — `6e79c56`
3. **Task 14-11-02 RED: failing refresh/revoke proofs** — `93d01fc`
4. **Task 14-11-02 GREEN: custom refresh/revoke exposure** — `dc63ffa`
5. **Human-review remediation: operation-scoped idempotent revoke through real guard chain** — remote technical head `a73bb7e8d209f2780a3d49ab4c74c5310f42aa62`

## Human review blocker and resolution

### B14-11-HR-01 — guarded revoke was not HTTP-idempotent — CLOSED — PASS

Initial human review found that the isolated revoke handler returned 204 twice, but the real middleware chain rejected the second call because the generic access guard required `lineage_status = active` before the handler.

Remediation:
- added an explicit `revoke-current-lineage` operation option to the access decision;
- preserved active-lineage enforcement for every normal protected operation;
- allowed `revoked` only for the exact canonical `POST /auth/customer/emailpass/revoke-current-lineage` middleware path;
- preserved JWT signature, sid, identity/customer ownership, credential version, stable operation state, timestamp/deadline, and PostgreSQL checks in that idempotent path;
- changed the focused HTTP evidence to execute the real guard → handler chain rather than synthetically pre-populating `customerAuth`;
- did not change the revoke route, manifest, schema, migration, packages, or auth-surface exact set.

Result: first revoke returns 204, repeated revoke with the same valid bearer after lineage revocation returns 204, while the same revoked bearer remains 401 for a normal protected operation.

## Final verification evidence

- Focused disposable PostgreSQL HTTP suite: **PASS — 8/8 tests**; cleanup confirmed.
- Guarded revoke: first call `204`; repeated call with the same bearer after lineage is revoked `204`.
- Revoked bearer on normal protected operation: `401` before handler.
- Ownership, credential-version, stable-state, deadline, and invalid-signature failures: `401` before handler.
- Database outage: `503 AUTH_TEMPORARILY_UNAVAILABLE` before handler.
- Cross-process revoke/replay/version bump/deadline enforcement: **PASS**.
- Redis empty/outage: does not grant access or refresh validity.
- Exact auth surface: only custom refresh/revoke are `PHASE14_ENABLED`; native operations remain `DENY`.
- Backend build: **PASS — 0 TypeScript errors**.
- Direct scoped ESLint: **PASS — 0 errors**; existing advisory warnings only.
- Repository `medusa lint` wrapper: known tooling failure (exit 2 / empty JSON stream), accepted as non-blocking because it emitted no file diagnostics and no tooling/package changes were made.
- `git diff --check`: **PASS**.
- Migration/schema/dependencies/provider/remote persistence/deploy: **NONE**.
- Technical changes were pushed manually by the human; remote technical head before documentary closure: `a73bb7e8d209f2780a3d49ab4c74c5310f42aa62`.

## Accepted invariants

- PostgreSQL is the sole authorization/session validity authority; Redis never grants validity.
- Cryptographically valid JWT alone never grants authenticated access.
- Every protected decision validates sid, identity/customer ownership, credential version, stable state, lineage state, and absolute deadline.
- Revocation/replay/version/deadline changes are observed cross-process.
- Database outage/inconsistency fails closed before the protected handler.
- Revoke idempotency is restricted to the exact current-lineage revoke operation and does not reopen normal access for a revoked lineage.
- Native refresh/session and aliases remain denied; only the exact custom refresh/revoke paths are enabled.

## Scope and authorization boundary

`14-11` is technically and documentally closed. By explicit human authorization, `14-12` may execute according to `14-12-PLAN.md`, including Tasks `14-12-01` and `14-12-02`, and must stop at blocking human checkpoint `14-12-03`.

This authorization does **not** authorize:
- `14-13` or any later Phase 14 plan;
- endpoint elevation beyond the currently approved auth surface;
- deploy/release;
- real Resend or any real-provider exercise;
- remote/persistent DB or Redis changes;
- frontend work;
- dependency installation;
- migrations/schema changes unless separately authorized;
- auto-chain or scope expansion outside `14-12-PLAN.md`.

---

*Plan: 14-11*
*Human checkpoint: PASS*
*Documentary closure: COMPLETE — PASS*
*Next plan: 14-12 AUTHORIZED FOR EXECUTION / NOT STARTED*
