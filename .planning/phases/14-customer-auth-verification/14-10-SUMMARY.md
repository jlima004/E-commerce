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
affects: [14-10-03, 14-11]

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

patterns-established:
  - "Refresh credentials are opaque 32-byte base64url values; only SHA-256 hashes are persisted."
  - "Consumed-token divergence commits family revocation before returning a protocol error."

requirements-completed: [AUTH-02, AUTH-05, AUTH-06] # implemented evidence; human approval remains pending

# Metrics
duration: not measured
completed: 2026-08-15
status: awaiting-human-review
---

# Phase 14 Plan 10 Summary

**Implemented the database-authoritative lineage, JWT, and refresh rotation domain without exposing an endpoint.**

## Execution status

- **14-10-01:** EXECUTED — AWAITING HUMAN REVIEW
- **14-10-02:** EXECUTED — AWAITING HUMAN REVIEW
- **14-10-03:** BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW
- **14-10:** NOT YET HUMAN APPROVED
- **14-11:** NOT AUTHORIZED
- **Deploy/push:** none

## Accomplishments

- Added 10-minute access JWT issuance/verification with `sid`, credential version, identity/customer claims, `jti`, `iat`, `exp`, immutable `original_authenticated_at`, and a 30-day absolute deadline.
- Added opaque refresh issuance, SHA-256/request-key hashing, single-use N→N+1 rotation, 45-second same-key recovery, inactivity/absolute expiry, replay detection, and family revocation.
- Added unit and disposable PostgreSQL evidence for concurrency, 44-second recovery, 46-second/different-key divergence, descendant use, pre/post-commit faults, deadline capping, Redis absence, and hash-only persistence.

## Task commits

1. **Task 14-10-01: issuance/JWT/rotation/recovery** — `c57bf81`
2. **Task 14-10-02: PostgreSQL concurrency and faults** — `ad78778`

## Verification evidence

- `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/customer-auth/__tests__/session.unit.spec.ts` — PASS, 9 tests.
- `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/auth-session.postgres.spec.ts` — PASS, 4 tests; disposable database cleanup confirmed.
- `git diff --check` — PASS.
- Linter diagnostics for all four authorized code files — none.

All evidence is sanitized. No refresh token, capability, raw idempotency key, sensitive hash, provider credential, or canary value is included in this artifact.

## Files created

- `apps/backend/src/modules/customer-auth/session.ts` — session lineage and refresh protocol.
- `apps/backend/src/modules/customer-auth/jwt.ts` — access JWT contract.
- `apps/backend/src/modules/customer-auth/__tests__/session.unit.spec.ts` — deterministic protocol tests.
- `apps/backend/integration-tests/modules/auth-session.postgres.spec.ts` — disposable PostgreSQL integration tests.

## Issues encountered and resolved

- The disposable runner requires the official PostgreSQL harness to provision the target database; the integration spec now uses that harness and cleans it up.
- PostgreSQL rejected a nullable replay-exclusion placeholder with `42P18`; the family-revoke query now uses separate typed SQL paths for replay and non-replay revocation.
- The terminal-deadline assertion was corrected to count only active descendants.

## Next phase readiness

The implementation is stopped at the mandatory human checkpoint. Human review must confirm the N/N+1 traces, recovery boundary, 10m/7d/30d invariants, family revocation, and zero plaintext persistence before any access guard or 14-11 work begins.

---

*Plan: 14-10*
*Completed execution: 2026-08-15*
*Checkpoint: PENDING HUMAN REVIEW*
