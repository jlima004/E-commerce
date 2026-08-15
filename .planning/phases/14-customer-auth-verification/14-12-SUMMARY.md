---
phase: 14-customer-auth-verification
plan: 12
subsystem: auth
tags: [email-verification, postgres, concurrency, hash-only, outbox]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: Auth verification intent/outbox schema, capability keyring, notification outbox primitive, and DENY auth-surface manifest
provides:
  - Transactional email-verification request/resend/confirm/status domain
  - PostgreSQL evidence for latest-wins, one-winner, TTL, provider independence, key rotation, leakage, and isolation
affects: [14-13, customer-auth, auth-surface]

# Tech tracking
tech-stack:
  added: []
  patterns: [credential-row locking, conditional status CAS, hash-only capability persistence, transactional intent plus outbox]

key-files:
  created:
    - apps/backend/src/modules/customer-auth/verification.ts
    - apps/backend/src/modules/customer-auth/__tests__/verification.unit.spec.ts
    - apps/backend/integration-tests/modules/auth-verification.postgres.spec.ts
  modified: []

key-decisions:
  - "Serialize resend and confirm through the PostgreSQL credential row lock; use conditional intent updates for one-winner confirmation."
  - "Return an invalid sentinel from the confirm transaction so exact-TTL expiry commits before the uniform invalid-or-expired error is returned."
  - "Keep verification independent from provider delivery, native verification events, sessions, lineage, refresh credentials, orders, and Stripe state."

patterns-established:
  - "Persist only capability hash, nonce, key version, and non-sensitive intent metadata; derive the capability in memory."
  - "Create the verification intent and notification outbox record in the same custom transaction."

requirements-completed: []
duration: 11min
completed: 2026-08-15
status: awaiting-human-review
---

# Phase 14: Customer Auth Verification — Plan 12 Summary

**Transactional email verification now has latest-wins resend, one-winner confirmation, exact 30-minute expiry, hash-only persistence, and provider-independent delivery state.**

## Execution status

- **14-12-01:** EXECUTED — AWAITING HUMAN REVIEW
- **14-12-02:** EXECUTED — AWAITING HUMAN REVIEW
- **14-12-03:** BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW
- **14-12:** NOT YET HUMAN APPROVED
- **14-13:** NOT AUTHORIZED

No push, deploy, real provider call, migration, dependency change, endpoint elevation, or frontend change was performed.

## Accomplishments

- Implemented auto-request, latest-wins resend, one-winner confirm, uniform invalid/expired handling, already-verified behavior, and verification status.
- Bound intent and `AuthNotificationOutbox` creation to one custom transaction; provider timeout, 5xx, and ambiguous outcomes only changed outbox delivery state.
- Added sanitized unit and disposable PostgreSQL proofs for concurrency, exact TTL, key rotation, hash-only persistence, no native event, no session/lineage/refresh/JWT, no Order/Stripe effect, and verification paths remaining `DENY`.

## Task commits

No local commit was created; the work remains available for the blocking human review.

## Files created

- `apps/backend/src/modules/customer-auth/verification.ts` — verification domain and PostgreSQL transaction adapter.
- `apps/backend/src/modules/customer-auth/__tests__/verification.unit.spec.ts` — 12 deterministic unit tests with an in-memory transactional database.
- `apps/backend/integration-tests/modules/auth-verification.postgres.spec.ts` — 9 disposable PostgreSQL integration tests using provider and leakage fakes.

## Validation evidence

- Unit: `12 passed, 0 failed`.
- Disposable PostgreSQL: `9 passed, 0 failed`; disposable database cleanup confirmed.
- Backend build: passed after type validation; existing project lint emitted warnings only.
- Changed production source ESLint: `0 errors, 0 warnings`.
- Changed test files with `--no-ignore`: `0 errors, 2 style warnings`.
- `git diff --check`: passed.

All evidence is sanitized and does not print capability values, hashes, secrets, credentials, or personal data.

## Issues encountered

- The first exact-expiry implementation rolled back the `expired` transition because it threw inside the transaction callback. The callback now returns a non-error sentinel, commits the terminal state, and the public function raises the uniform error after commit.
- The backend `npm run lint -w @dtc/backend` wrapper exited during JSON parsing, while the build-integrated lint completed with zero errors and direct ESLint validation of the changed production source passed. No lint configuration or out-of-scope file was changed.

## Next phase readiness

The implementation and automated evidence are ready for human review at Task 14-12-03. Stop here until explicit human approval; do not start 14-13.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-12*
*Completed: 2026-08-15*
