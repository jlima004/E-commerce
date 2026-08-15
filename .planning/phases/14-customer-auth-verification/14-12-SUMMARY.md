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
status: complete
---

# Phase 14: Customer Auth Verification — Plan 12 Summary

**Transactional email verification has human-approved latest-wins resend, one-winner confirmation, exact 30-minute expiry, hash-only persistence, and provider-independent delivery state.**

## Final status

- **14-12-01:** HUMAN APPROVED — PASS
- **14-12-02:** HUMAN APPROVED — PASS
- **14-12-03:** HUMAN APPROVED — PASS
- **14-12:** HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- **14-13:** AUTHORIZED FOR EXECUTION / NOT STARTED
- **14-14..14-21:** NOT AUTHORIZED
- **Deploy:** NOT AUTHORIZED
- **Real Resend / real providers:** NOT AUTHORIZED
- **Frontend:** BLOCKED

Milestone-level requirements remain unchanged at `8/91`; this closure does not independently close global milestone requirements.

## Accomplishments

- Implemented auto-request, latest-wins resend, one-winner confirm, uniform invalid/expired handling, already-verified behavior, and verification status.
- Bound intent and `AuthNotificationOutbox` creation to one custom transaction; provider timeout, 5xx, and ambiguous outcomes only changed outbox delivery state.
- Added sanitized unit and disposable PostgreSQL proofs for concurrency, exact TTL, key rotation, hash-only persistence, no native event, no session/lineage/refresh/JWT, no Order/Stripe effect, and verification paths remaining `DENY`.
- Confirmed the materialized `auth_verification_intent` schema matches the runtime contract used by the domain; no migration/schema drift was introduced.
- Confirmed the four Store verification paths planned for 14-13 remain closed before endpoint elevation.

## Technical commit

- Remote technical head after human approval and manual push: `040fbbfc1d4a947f96de7314ff8f340c29a7dd49` — `feat(14-12): implement customer auth verification domain`.

No deploy or real-provider execution accompanied the push.

## Files created

- `apps/backend/src/modules/customer-auth/verification.ts` — verification domain and PostgreSQL transaction adapter.
- `apps/backend/src/modules/customer-auth/__tests__/verification.unit.spec.ts` — 12 deterministic unit tests with an in-memory transactional database.
- `apps/backend/integration-tests/modules/auth-verification.postgres.spec.ts` — 9 disposable PostgreSQL integration tests using provider and leakage fakes.

## Accepted validation evidence

- Unit: **PASS — 12/12**.
- Disposable PostgreSQL: **PASS — 9/9**; cleanup confirmed.
- Backend build: **PASS**.
- Changed production source ESLint: **0 errors, 0 warnings**.
- Changed test files with `--no-ignore`: **0 errors**, two existing style warnings.
- Repository lint wrapper: known JSON-parser/tooling failure with empty ESLint stream; accepted as non-blocking because direct scoped ESLint and build passed and no tooling/package change was made.
- `git diff --check`: **PASS**.
- Provider timeout/5xx/ambiguous outcomes: verification intent remains pending; only outbox delivery changes.
- Concurrent resend: exactly one latest pending generation survives.
- Concurrent confirm: exactly one winner; loser fails uniformly.
- Exact TTL: 30 minutes; expiry terminal state commits before uniform invalid-or-expired response.
- Capability persistence: hash-only; no plaintext capability in DB/outbox/sanitized sinks.
- Key rotation: previous-key capability remains valid according to the approved keyring contract.
- Isolation: zero lineage/JWT/session/refresh creation; zero Order/Stripe side effect; zero native verification event.
- Verification HTTP/Store endpoints: not elevated in 14-12 and remain DENY until 14-13 execution.

## Issues encountered

- The first exact-expiry implementation rolled back the `expired` transition because it threw inside the transaction callback. The callback now returns a non-error sentinel, commits the terminal state, and the public function raises the uniform error after commit.
- The backend `npm run lint -w @dtc/backend` wrapper exited during JSON parsing, while the build-integrated lint and direct ESLint validation produced zero errors. No lint configuration or out-of-scope file was changed.

## Authorization boundary for 14-13

By explicit human authorization, `14-13-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The authorization is limited to the approved 14-13 plan:
- Task `14-13-01` may implement the four verification HTTP handlers with the already-approved PostgreSQL access guard, rate limiting, uniform envelopes/timing, and focused HTTP evidence.
- Task `14-13-02` may elevate exactly the four approved Store verification method/path pairs only after the Task 14-13-01 HTTP evidence passes.
- Task `14-13-03` remains a **BLOCKING HUMAN VERIFY** checkpoint; execution must stop there.

This authorization does **not** authorize:
- `14-14` or later plans;
- any fifth verification path, raw Customer path, native auth verification route, alias, or unrelated Store surface;
- auto-chain;
- deploy/release;
- real Resend or any real provider;
- remote/persistent DB or Redis changes;
- migration/schema or dependency changes unless a separate explicit scope amendment is granted;
- frontend work.

## Next step

Execute `14-13-01` and `14-13-02` strictly according to `14-13-PLAN.md`, then stop at `14-13-03` for blocking human review.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-12*
*Status: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED*
