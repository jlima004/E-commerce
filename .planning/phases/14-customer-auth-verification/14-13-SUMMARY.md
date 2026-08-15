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
    - "Runtime-acquisition fallback preserves the same public resend timing envelope"

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
  - "The public resend path absorbs limiter, lookup, provider and runtime-acquisition failures into the same 202 REQUEST_ACCEPTED response and timing class."
  - "The public confirm path never resolves a session or emits JWT/refresh material; successful output is limited to EMAIL_VERIFIED and state."
  - "B14-13-HR-01 was closed by applying the approved timing envelope exactly once when runtime acquisition fails before handler entry."

patterns-established:
  - "Authenticated request/status depend on customerAuthAccessGuardMiddleware registered on their exact routes."
  - "Verification request consumes lineage and network buckets before email lookup or verification writes."
  - "Verification confirm consumes pre-token and post-intent/dummy buckets before confirmation mutation."

requirements-completed: []

# Metrics
duration: "approximately 10 min plus focused remediation"
completed: 2026-08-15
status: complete
---

# Phase 14: Customer Auth Verification — Plan 13 Summary

**The four exact Store email-verification contracts are human-approved, B14-13-HR-01 is closed, and Plan 14-13 is documentally closed. Plan 14-14 is authorized for execution but not started.**

## Final status

- **14-13-01:** HUMAN APPROVED — PASS
- **14-13-02:** HUMAN APPROVED — PASS
- **14-13-03:** HUMAN APPROVED — PASS
- **B14-13-HR-01:** CLOSED — PASS
- **14-13:** HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
- **14-14:** AUTHORIZED FOR EXECUTION / NOT STARTED
- **14-15..14-21:** NOT AUTHORIZED
- **Deploy:** NOT AUTHORIZED
- **Real Resend / real providers:** NOT AUTHORIZED
- **Frontend:** BLOCKED

Milestone-level requirements remain unchanged at `8/91`; this closure does not independently close global milestone requirements.

## Accomplishments

- Added authenticated verification request/status handlers behind the approved PostgreSQL `customerAuthAccessGuard`.
- Added public resend/confirm handlers with normalized inputs, HMAC-derived pre/post rate limits, sanitized envelopes and anti-enumeration timing behavior.
- Elevated exactly:
  - `POST /store/customers/me/verify`
  - `POST /store/customers/verify/resend`
  - `POST /store/customers/verify`
  - `GET /store/customers/me/verify/status`
- Kept raw Customer paths, native `/auth/verification/*`, trailing-slash/case aliases and unknown Customer paths denied.
- Preserved zero session/JWT/refresh creation from confirm and zero Order/payment/cart/checkout side effects.

## B14-13-HR-01 closure

**Root cause:** `runCustomerAuthVerificationResendRoute(...)` could fail during runtime acquisition before handler entry and return `202 REQUEST_ACCEPTED` without the public resend timing envelope.

**Correction:** the runner now records the timing start before runtime acquisition and applies the existing `applyAuthTimingEnvelope` path only when acquisition fails. Successful acquisition leaves timing to the handler, preventing double application.

**Accepted proof:** the focused test traverses the real route runner, forces runtime acquisition failure, verifies exactly one deterministic 350 ms envelope application, exact `202 { code: "REQUEST_ACCEPTED" }`, handler non-entry and zero verification/provider/session/Order/payment/cart/checkout side effects.

`B14-13-HR-01: CLOSED — PASS`.

## Accepted validation evidence

Focused command:

`npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/auth-verification.spec.ts`

Final result: **PASS — 12/12**.

Coverage includes:

- missing bearer, revoked lineage, stale credential version, expired absolute deadline and PostgreSQL guard outage;
- verification-request hits 1–3, lineage hit 4, IP hits 1–10, IP hit 11, Redis outage + `Retry-After: 60`, and no service reachability after denial;
- uniform public resend for unknown, verified, accepted, limited, provider/internal failure and runtime-acquisition failure;
- valid, expired, used, superseded, unknown, missing and malformed confirm capabilities;
- no session/JWT/refresh authentication and no internal fields in confirm/status output;
- exact four-entry Store surface and explicit deny matrix;
- manifest self-validation with no violations.

Additional evidence:

- Backend build: **PASS**.
- Direct ESLint: **0 errors**, 7 advisory/existing warnings after remediation.
- Repository lint wrapper: known empty-JSON `EOF while parsing` tooling failure; accepted non-blocking because direct ESLint and build passed and tooling/packages were unchanged.
- `git diff --check`: **PASS**.

## Technical push

Remote technical head after human approval and manual push:

`ff8036fb596eb937d51f229ae43b24eedce80373` — `feat(14-13): implement customer auth verification handlers`

No deploy or real-provider execution accompanied the push.

## Scope and governance

No migration/schema, remote DB/Redis, real Resend/provider, frontend, dependency installation, PR, merge, deploy, release or auto-chain was performed.

The API-docs registry remains unchanged because it was outside the authorized file scope of this plan; its promotion belongs to its owning plan/scope.

## 14-14 authorization

By explicit human authorization, `14-14-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

Authorization is limited to the plan's registration-domain scope:

- `14-14-01`: registration coordinator/recovery/mismatch domain and unit evidence;
- `14-14-02`: disposable PostgreSQL concurrency/partial-recovery evidence;
- `14-14-03`: **BLOCKING HUMAN VERIFY**; execution must stop there.

Signup/login HTTP routes are not elevated by 14-14. Provider delivery must remain independent; no Order/Payment/Stripe/Gelato side effect is authorized.

`14-15` and later plans remain NOT AUTHORIZED.

---

*Phase: 14-customer-auth-verification*
*Plan: 14-13*
*Status: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED*
