---
phase: 14-customer-auth-verification
plan: 10
subsystem: auth
tags: [jwt, refresh-token, lineage, postgres, idempotency, security]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: auth credential state and transactional customer-auth persistence
provides:
  - database-authoritative session lineage issuance and revocation
  - single-use refresh rotation with bounded same-key recovery
  - deadline-bounded access JWT issuance and verification
  - disposable PostgreSQL concurrency and fault evidence
affects: [14-11]

# Tech tracking
tech-stack:
  added: []
  patterns: [row-lock/CAS refresh rotation, hash-only refresh persistence, family revoke on replay]

key-files:
  created:
    - apps/backend/src/modules/customer-auth/session.ts
    - apps/backend/src/modules/customer-auth/jwt.ts
    - apps/backend/src/modules/customer-auth/__tests__/session.unit.spec.ts
    - apps/backend/integration-tests/modules/auth-session.postgres.spec.ts
  modified: []

key-decisions:
  - "PostgreSQL row state is the sole refresh validity authority; Redis is not consulted."
  - "Recovery re-derives the committed descendant and never allocates a new generation."
  - "The absolute authentication deadline is carried unchanged through every rotation."
  - "auth_refresh_credential has no version column; concurrency is enforced by row locks, status/generation predicates and database uniqueness constraints."

patterns-established:
  - "Refresh credentials are opaque 32-byte base64url values; only SHA-256 hashes are persisted."
  - "Consumed-token divergence commits family revocation before returning a protocol error."

requirements-completed: [AUTH-02, AUTH-05, AUTH-06]

# Metrics
duration: not measured
completed: 2026-08-14
status: complete
---

# Phase 14 Plan 10 Summary

**Implemented and human-approved the database-authoritative lineage, JWT, and refresh rotation domain without exposing an authenticated endpoint.**

## Final status

- **14-10-01:** HUMAN APPROVED — PASS
- **14-10-02:** HUMAN APPROVED — PASS
- **14-10-03:** HUMAN APPROVED — PASS
- **14-10:** HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- **B14-10-HR-01:** CLOSED — PASS
- **B14-10-HR-02:** CLOSED — PASS
- **14-11:** AUTHORIZED FOR EXECUTION / NOT STARTED
- **14-12:** NOT AUTHORIZED
- **Deploy:** NOT AUTHORIZED

## Accomplishments

- Added 10-minute access JWT issuance/verification with `sid`, credential version, identity/customer claims, `jti`, `iat`, `exp`, immutable `original_authenticated_at`, and a 30-day absolute deadline.
- Added opaque 32-byte refresh issuance, SHA-256/request-key hashing, single-use N→N+1 rotation, 45-second same-key recovery, seven-day inactivity expiry, replay detection, and family revocation.
- Recovery of a committed response-loss re-derives exactly the committed N+1 and cannot allocate N+2.
- PostgreSQL is the refresh/session authority; Redis does not grant validity.
- No refresh plaintext, capability, raw idempotency key or sensitive secret is intentionally persisted or logged.

## Task commits

1. **Task 14-10-01: issuance/JWT/rotation/recovery** — `c57bf81`
2. **Task 14-10-02: PostgreSQL concurrency and faults** — `ad78778`
3. **Execution summary/checkpoint artifact** — `0d44549`
4. **Human-remediation: align refresh runtime and tests to materialized schema** — `fbbd819`

## Human review blockers and resolution

### B14-10-HR-01 — refresh credential schema drift — CLOSED — PASS

Initial review found that `session.ts` and the disposable PostgreSQL test modeled an `auth_refresh_credential.version` column that does not exist in the materialized migration `Migration20260814004448.ts`.

Remediation:
- removed `RefreshRow.version` and its parsing from runtime;
- removed refresh `version = version + 1` updates;
- removed the artificial `version` column/constraint from `auth-session.postgres.spec.ts`;
- preserved lineage `version`, row locks, status/generation predicates, recovery semantics, family revocation and database uniqueness constraints;
- did **not** modify the historical migration or expand the schema.

Result: disposable PostgreSQL evidence now exercises the actual refresh-credential schema contract.

### B14-10-HR-02 — unit harness schema drift / build failure — CLOSED — PASS

After HR-01, the unit harness still carried the removed refresh `version` field and lacked `MemoryLineage.deleted_at`, causing backend TypeScript build errors.

Remediation, limited to `session.unit.spec.ts`:
- added/initialized/cloned `MemoryLineage.deleted_at` and aligned reads to `deleted_at IS NULL`;
- removed `MemoryRefresh.version` and all artificial refresh version increments;
- preserved `MemoryLineage.version`, which belongs to the lineage schema.

Result: focused unit, disposable PostgreSQL, build, lint and diff check all pass.

## Final verification evidence

- Session unit: **PASS — 9/9**.
- Disposable PostgreSQL session protocol: **PASS — 4/4**; cleanup confirmed.
- Backend build: **PASS — 0 errors**.
- Lint: **PASS — 0 errors**; existing warnings only.
- `git diff --check`: **PASS**.
- Migration/schema change during remediation: **NONE**.
- Push performed manually by the human after approval; remote technical head: `fbbd819f1359012277556c3f631754979a1872e2`.
- Deploy: **NONE / NOT AUTHORIZED**.

## Accepted protocol invariants

- Refresh N is single-use and produces exactly one N+1 under concurrency.
- Same Idempotency-Key recovery at <=45 seconds returns the same N+1 while that descendant remains unused.
- Different key, recovery after the window, descendant already used, or divergent replay revokes the lineage/family.
- Pre-commit fault does not materialize an invalid descendant; post-commit response loss is recoverable only through the bounded recovery protocol.
- Access JWT lifetime is 10 minutes and is capped by the immutable absolute deadline.
- Refresh inactivity is seven days and is also capped by the same 30-day absolute deadline.
- Rotation never resets `originalAuthenticatedAt` or the absolute deadline.
- PostgreSQL remains authoritative; Redis absence/outage cannot grant validity.

## Scope and authorization boundary

`14-10` is now technically and documentally closed. By explicit human authorization, `14-11` may execute according to `14-11-PLAN.md`, including Tasks `14-11-01` and `14-11-02`, and must stop at blocking human checkpoint `14-11-03`.

This authorization does **not** authorize:
- `14-12` or any later Phase 14 plan;
- deploy/release;
- real Resend or other real-provider exercise;
- frontend work;
- auto-chain;
- changes outside the approved `14-11-PLAN.md` scope.

---

*Plan: 14-10*
*Human checkpoint: PASS*
*Documentary closure: COMPLETE — PASS*
*Next plan: 14-11 AUTHORIZED FOR EXECUTION / NOT STARTED*
