---
phase: 14-customer-auth-verification
plan: 13
subsystem: auth
tags: [medusa, customer-auth, verification, postgres, redis, http]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: "Gates 14-11 (PostgreSQL access guard) and 14-12 (latest-wins/one-winner verification domain)"
provides:
  - "Four exact Store verification handlers with authenticated guard enforcement and public anti-enumeration contracts"
  - "Exact Store-surface elevation for the four Phase 14 verification paths"
affects: [14-14, storefront-contracts, auth-http]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard authenticated Store verification before handler execution"
    - "HMAC/domain-separated pre/post rate-limit buckets with fail-closed Redis behavior"
    - "Fixed public verification envelopes with sanitized DTOs"

key-files:
  created:
    - apps/backend/src/api/store/customers/me/verify/route.ts
    - apps/backend/src/api/store/customers/me/verify/status/route.ts
    - apps/backend/src/api/store/customers/verify/route.ts
    - apps/backend/src/api/store/customers/verify/resend/route.ts
    - apps/backend/integration-tests/http/auth-verification.spec.ts
  modified:
    - apps/backend/src/api/store-surface/manifest.ts
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Only the four approved Store method/path pairs are M1_ENABLED; raw Customer, aliases, and native verification remain denied."
  - "The public resend path absorbs limiter, lookup, and provider failures into the same 202 REQUEST_ACCEPTED response."
  - "The public confirm path never resolves a session or emits JWT/refresh material; successful output is limited to EMAIL_VERIFIED and state."
  - "No real provider call, dependency installation, migration, push, deploy, or release was performed."

patterns-established:
  - "Authenticated request/status depend on customerAuthAccessGuardMiddleware registered on their exact routes."
  - "Verification request consumes lineage and network buckets before email lookup or verification writes."
  - "Verification confirm consumes pre-token and post-intent/dummy buckets before confirmation mutation."

requirements-completed: []

# Metrics
duration: "approximately 10 min in this execution turn"
completed: 2026-08-15
status: awaiting-human-review
---

# Phase 14: Customer Auth Verification — Plan 13 Summary

**Four exact Store email-verification contracts are implemented; B14-13-HR-01 is remediated and awaiting human re-review. The plan is not approved and no later phase is authorized.**

## Execution state

- Branch: `gsd/phase-14-customer-auth-verification`
- `git pull --ff-only`: up to date before implementation.
- Task 14-13-01: `EXECUTED — AWAITING HUMAN RE-REVIEW`
- Task 14-13-02: `EXECUTED — AWAITING HUMAN RE-REVIEW`
- B14-13-HR-01: `REMEDIATED — AWAITING HUMAN RE-REVIEW`
- Task 14-13-03: `BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW`
- Plan 14-13: `NOT YET HUMAN APPROVED`
- Plan 14-14: `NOT AUTHORIZED`

## Remediation — B14-13-HR-01

- **Root cause:** `runCustomerAuthVerificationResendRoute(...)` caught a failure from `openCustomerAuthVerificationRuntime(...)` before handler entry and wrote `202 REQUEST_ACCEPTED` directly, bypassing the public resend timing envelope.
- **Correction:** the route runner records the temporal start before runtime acquisition and, only when acquisition fails, invokes the existing `finishAuthTiming` path backed by `applyAuthTimingEnvelope` before writing the accepted response. Successful acquisition keeps the handler's existing timing logic; the acquisition flag prevents double application.
- **Runtime-acquisition proof:** the new HTTP test calls `runCustomerAuthVerificationResendRoute(...)`, forces the runtime opener to reject, and verifies exactly `202` with exactly `{ code: "REQUEST_ACCEPTED" }`, one deterministic 350 ms envelope application, handler non-entry, and no verification lookup/write, provider, session/JWT/refresh/lineage, Order, payment, cart, or checkout side effect.

## Accomplishments

- Added authenticated request/status handlers using the approved PostgreSQL access context, with verification-request lineage/IP buckets, sanitized responses, and no service reachability when the guard or limiter rejects.
- Added public resend and confirm handlers with normalization, pre/post HMAC-derived rate-limit material, fixed anti-enumeration responses, hash-only capability lookup, and no session/JWT/Order/payment/cart side effects.
- Elevated exactly:
  - `POST /store/customers/me/verify`
  - `POST /store/customers/verify/resend`
  - `POST /store/customers/verify`
  - `GET /store/customers/me/verify/status`
- Registered the access guard only for the two authenticated exact paths.
- Kept raw Customer paths, native `/auth/verification/*`, trailing-slash/case aliases, and unknown Customer paths denied.

## Sanitized evidence

Focused command:

`npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/auth-verification.spec.ts`

Result after remediation: **12 passed, 0 skipped**.

The suite covers:

- missing bearer, revoked lineage, stale credential version, expired absolute deadline, PostgreSQL guard outage, and handler non-reachability;
- verification-request hits 1–3, lineage hit 4, IP hits 1–10, IP hit 11, Redis outage with `Retry-After: 60`, and no service call after denial;
- uniform resend behavior for unknown, verified, accepted, limited, and provider-failure cases;
- normalized resend input and strict invalid schema handling;
- valid, expired, used, superseded, unknown, missing, and malformed confirm capabilities;
- no session/JWT/refresh authentication and no internal fields in confirm/status output;
- exact four-entry surface and explicit deny matrix;
- manifest self-validation with no violations.
- runtime acquisition failure in the real resend route runner, including timing-envelope and zero-side-effect assertions.

Additional validation:

- Backend build: **PASS** — backend and frontend build completed successfully.
- Direct ESLint on the remediation files with `--no-ignore`: **0 errors, 7 warnings** in 2 files. Warnings are existing Medusa lint-policy warnings and synthetic-error fixtures; no lint error was introduced.
- `git diff --check`: PASS.
- The `npm run lint -w @dtc/backend` wrapper reproduced the known tooling failure: empty ESLint JSON (`EOF while parsing a value`). Tooling and packages were not changed.

## Scope and governance

The blocker remediation changed only `apps/backend/src/api/store/customers/me/verify/route.ts`, `apps/backend/integration-tests/http/auth-verification.spec.ts`, and this summary. `store-surface/manifest.ts` and `middlewares.ts` were not altered by the remediation. No migration/schema, remote DB/Redis, real Resend/provider, frontend, dependency installation, push, PR, merge, deploy, release, or auto-chain was performed.

The API-docs registry was intentionally not changed because it is outside the explicitly authorized file scope of this plan; any documentation promotion requires a separate scope amendment/owner plan.

## Issues encountered

- The initial RED run failed because the four route modules did not exist, as expected.
- The first build exposed two local type mismatches in the new handler dependency boundary; both were corrected without scope expansion.
- The lint wrapper failed while parsing empty JSON; direct scoped ESLint was run as required.

## Final governance state after remediation

- `B14-13-HR-01`: `REMEDIATED — AWAITING HUMAN RE-REVIEW`
- `14-13-01`: `EXECUTED — AWAITING HUMAN RE-REVIEW`
- `14-13-02`: `EXECUTED — AWAITING HUMAN RE-REVIEW`
- `14-13-03`: `BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW`
- `14-13`: `NOT YET HUMAN APPROVED`
- `14-14`: `NOT AUTHORIZED`
- `PUSH`: `NOT AUTHORIZED / NONE`
- `DEPLOY`: `NOT AUTHORIZED / NONE`
- `REAL RESEND / REAL PROVIDERS`: `NOT AUTHORIZED / NONE`

## Next phase readiness

No next phase is authorized. Human re-review must verify the runtime-acquisition fallback, the four-path surface, guard/limiter evidence, and the sanitized HTTP contracts before any decision about 14-14.

---

*Phase: 14-customer-auth-verification*
*Plan: 14-13*
*Status: AWAITING HUMAN RE-REVIEW — STOPPED AT 14-13-03*
