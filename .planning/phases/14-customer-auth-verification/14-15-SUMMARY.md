---
phase: 14-customer-auth-verification
plan: 15
subsystem: auth
tags: [signup, login, current-state, jwt, rate-limit, anti-enumeration, access-guard, bff-only]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: registration coordinator, session/JWT/refresh primitives, verification/outbox, access guard, HMAC rate-limit, timing envelope, DENY-by-default auth/store manifests
provides:
  - HTTP signup, login and GET /store/customers/me handlers
  - loginCustomer domain that gates new lineage on email_verified_at
  - Exact-set elevation of POST register, POST emailpass and GET me
affects: [14-16, customer-auth, auth-surface, store-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pre-lookup HMAC rate-limit consume before coordinator/provider/write
    - Redis fail-closed 503 before lookup
    - emailpass scrypt-kdf dummy verify for missing-account anti-enumeration
    - Exact method+path manifest promotion; no prefix allow

key-files:
  created:
    - apps/backend/src/modules/customer-auth/login.ts
    - apps/backend/src/api/auth/customer/emailpass/register/route.ts
    - apps/backend/src/api/auth/customer/emailpass/route.ts
    - apps/backend/src/api/store/customers/me/route.ts
    - apps/backend/integration-tests/http/auth-customer.spec.ts
    - .planning/phases/14-customer-auth-verification/14-15-SUMMARY.md
  modified:
    - apps/backend/src/api/auth-surface/manifest.ts
    - apps/backend/src/api/store-surface/manifest.ts
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Completed signup maps CUSTOMER_REGISTRATION_ALREADY_COMPLETED to public 409 AUTH_REQUEST_REJECTED and never recovers session/login."
  - "Unverified valid login returns EMAIL_VERIFICATION_REQUIRED with zero new lineage, JWT or refresh."
  - "GET /store/customers/me is bound to customerAuthAccessGuard and skipped from Store error rewriting so Auth envelopes stay intact."
  - "AUTH-01..03/09 are not globally closed; later Phase 14 plans remain required."

patterns-established:
  - "Signup serializes AuthSessionEnvelope at 201 only after Customer + credential + initial lineage + verification intent/outbox."
  - "Login missing-account dummy scrypt uses the emailpass default hashConfig; 401/403 apply the approved 14-08 timing envelope."
  - "Exact-set elevation is method + canonical path only; aliases, trailing slash, case variants and native session/callback/MFA stay DENY."

requirements-completed: []

# Metrics
duration: 21min
completed: 2026-08-17
status: awaiting-human-review
---

# Phase 14: Customer Auth Verification — Plan 15 Summary

**Signup, login and GET /store/customers/me are published on the BFF exact-set: initial signup may return an unverified lineage, unverified relogin cannot mint a new session, and current-state is allowlisted behind the PostgreSQL access guard.**

This document records execution evidence. It does **not** declare 14-15 HUMAN APPROVED.

## Final governance status

```text
14-15-01:
EXECUTED — AWAITING HUMAN REVIEW

14-15-02:
EXECUTED — AWAITING HUMAN REVIEW

14-15-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW

14-15:
NOT YET HUMAN APPROVED

14-16..14-21:
NOT AUTHORIZED

AUTH-01 / AUTH-02 / AUTH-03 / AUTH-09:
NOT GLOBALLY CLOSED
(plan 14-15 published the runtime surface; later Phase 14 gates remain)

DEPLOY:
NONE

REAL RESEND / REAL PROVIDERS:
NONE

DB / REDIS REMOTO OU PERSISTENTE:
NONE

FRONTEND:
BLOCKED

PUSH:
NONE

PR / MERGE:
NONE
```

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-17T19:39:05Z
- **Completed:** 2026-08-17T19:59:44Z
- **Tasks:** 14-15-01 and 14-15-02 executed; 14-15-03 is the blocking human checkpoint
- **Files modified:** 9 authorized files (8 production/test + this summary)

## Accomplishments

- Signup HTTP uses the approved registration coordinator, HMAC pre-lookup limiters, and serializes success only after Customer + lineage + verification/outbox.
- Login HTTP reuses session primitives, dummy scrypt + timing envelope anti-enumeration, and refuses new lineage for unverified accounts.
- `GET /store/customers/me` requires `customerAuthAccessGuard` and returns the allowlisted current-state DTO.
- Exact manifests promote only the three contracted method/path pairs; raw Customer, native session, callback, MFA and aliases remain DENY.

## Task commits

1. **Task 14-15-01 RED** — `0c42b5c` (`test(14-15): add failing signup, login and me HTTP proofs`)
2. **Task 14-15-01 GREEN** — `e6e439a` (`feat(14-15): implement signup, login and current-state handlers`)
3. **Task 14-15-02** — `7187381` (`feat(14-15): elevate exact signup, login and me surfaces`)
4. **Plan metadata** — this SUMMARY commit (docs)

14-15-03 is a blocking human verify checkpoint and has no production commit.

## Files created / modified

- `apps/backend/src/modules/customer-auth/login.ts` — `loginCustomer` + `runEmailpassDummyScrypt`
- `apps/backend/src/api/auth/customer/emailpass/register/route.ts` — signup handler
- `apps/backend/src/api/auth/customer/emailpass/route.ts` — login handler
- `apps/backend/src/api/store/customers/me/route.ts` — current-state handler
- `apps/backend/src/api/auth-surface/manifest.ts` — signup/login `PHASE14_ENABLED`
- `apps/backend/src/api/store-surface/manifest.ts` — `GET /store/customers/me` `M1_ENABLED`
- `apps/backend/src/api/middlewares.ts` — access guard + Auth error-envelope skip for GET me
- `apps/backend/integration-tests/http/auth-customer.spec.ts` — focused HTTP proofs
- `.planning/phases/14-customer-auth-verification/14-15-SUMMARY.md` — this record

Unchanged by design: migrations, models/schema, `registration.ts`, `session.ts`, `verification.ts`, `access-guard.ts`, rate-limit policy map, package.json/lockfile, provider package, env, frontend.

## Login implementation

`loginCustomer` is the only new domain. It does not implement JWT, refresh, credential_version authority or a parallel timing algorithm.

Flow:

```text
normalize email
→ findIdentity
→ missing: dummy scrypt-kdf.verify → invalid_credentials
→ present: emailpass authenticate
→ reject missing Customer / non-stable credential / bad credential_version as invalid_credentials
→ email_verified_at absent → email_verification_required (no session.issue)
→ verified → session.issue (wired to issueInitialAuthSession)
```

Dummy scrypt uses `scrypt-kdf` with the inspected emailpass default `{ logN: 15, r: 8, p: 1 }`. Login never returns `AUTH_RECOVERY_PENDING`. Redis is not a validity authority.

## Signup / login / me contracts

### Signup — `POST /auth/customer/emailpass/register`

1. Validate `SignupRequestSchema`.
2. Normalize email only for HMAC key derivation.
3. Consume pre-lookup buckets **before** coordinator/lookup/write.
4. Call the approved `registerCustomer` coordinator.
5. Serialize `AuthSessionEnvelope` at **201** only when Customer id, access token, refresh token, verification `intentId` and `outboxId` are all present.
6. `bffAuthorized !== false`; serializer returning null yields `AUTHENTICATION_REQUIRED` with no tokens.

Public error map (internal codes are not leaked):

| Internal | Public |
|---|---|
| schema / normalize failure | 400 `INVALID_REQUEST` |
| `CUSTOMER_REGISTRATION_INVALID_REQUEST` | 400 `INVALID_REQUEST` |
| `CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH` | 409 `AUTH_REQUEST_REJECTED` |
| `CUSTOMER_REGISTRATION_PASSWORD_MISMATCH` | 409 `AUTH_REQUEST_REJECTED` |
| `CUSTOMER_REGISTRATION_ALREADY_COMPLETED` | 409 `AUTH_REQUEST_REJECTED` |
| other registration/recovery | 503 `AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After` |
| Redis outage | 503 before coordinator, zero mutation |
| limiter block | 429 `RATE_LIMITED` |

Completed signup is **not** login. The handler does not call `loginCustomer` or recover a session as fallback (B14-14-HR-01 remains binding).

### Login — `POST /auth/customer/emailpass`

- Schema then normalize then pre-lookup limiters **before** provider/identity lookup.
- Missing / wrong password / identity without Customer → 401 `INVALID_CREDENTIALS` after dummy or real scrypt work.
- Unverified valid password → 403 `EMAIL_VERIFICATION_REQUIRED`; zero new lineage, JWT, refresh, credential_version bump, extra verification, Order/Payment.
- Verified login → 200 `AuthSessionEnvelope` via approved session primitives (PostgreSQL authority, credential_version, originalAuthenticatedAt, absolute deadline, single-use refresh).
- 401/403 apply `applyAuthTimingEnvelope` (approved 350ms floor + CSPRNG 0..50ms). 400/429/503 do not mimic success/credential timing.

### Current state — `GET /store/customers/me`

Allowlisted DTO from `serializeCurrentAuthCustomer`:

```text
{
  customer: { id, email, firstName, lastName },
  auth: { verificationState, originalAuthenticatedAt, absoluteExpiresAt }
}
```

Omitted: auth identity id, provider id/metadata, lineage id, sid, credential version, operation internals, refresh metadata, token hashes, verification capability, internal DB fields.

Handler requires `customerAuth.authorized === true`. Guard deny (missing bearer, invalid JWT, revoked lineage, stale credential version, absolute deadline, ownership mismatch, DB outage) is fail-closed. Redis cannot grant validity.

## Limiter ordering and exact thresholds

Rate-limit keys remain HMAC/domain-separated via `buildPreLookupRateLimitKeys`. No raw email, raw IP, token or PII in keys/logs. Policy map was not modified.

| Operation | Buckets | Allowed | Block |
|---|---|---|---|
| signup | 5/IP/15m + 3/email/h | IP 1..5, email 1..3 | IP hit 6 → 429; email hit 4 → 429 |
| login | 10/(IP,email)/15m + 30/IP/15m | up to those ceilings | next hit → 429 |

Ordering:

```text
schema → normalize → consumeRateLimitBuckets → coordinator/provider/write
```

Limiter failure never becomes 2xx. Signup/login rate-limit/outage is not absorbed as success.

## Redis outage

Both handlers catch `AuthRateLimitUnavailableError` **before** lookup/coordinator/provider/write:

- 503 `AUTH_TEMPORARILY_UNAVAILABLE`
- `Retry-After` from the existing rate-limit contract
- zero Customer/credential/lineage/session mutation
- login does not call provider `retrieve`/`authenticate`
- 503 is fail-closed and does not imitate credential-success timing

## Anti-enumeration / timing

Reuses 14-08 primitives. No new `sleep`, no `Math.random` jitter, no reduced floor, no parallel crypto.

- Missing account: dummy `scrypt-kdf.verify` (same hashConfig as emailpass).
- Wrong password: real provider `authenticate` (scrypt).
- Valid unverified / invalid credentials: same public envelope family until policy diverges; 401/403 wait on `applyAuthTimingEnvelope`.
- Provider rejection is not an existence oracle.
- Redis outage is 503 before lookup and does not need success-timing imitation.

## Initial signup vs new login

- **Initial signup** may create and return the initial lineage after Customer + credential + lineage + verification/outbox. The account may still be unverified.
- **New login of an unverified account** does not create lineage, refresh or access JWT. Public code is `EMAIL_VERIFICATION_REQUIRED`. Existence of the signup lineage does not authorize relogin.
- **Verified login** may issue a new lineage through `issueInitialAuthSession`.

## Me DTO allowlist and access-guard evidence

- Production matcher: `GET /store/customers/me` → `customerAuthAccessGuardMiddleware`.
- `"GET /store/customers/me"` is in `CUSTOMER_AUTH_VERIFICATION_CONTRACTS` so `attachStoreErrorEnvelope` does not rewrite Auth 401/503 into Store errors.
- HTTP proofs: valid access → allowlisted DTO; missing bearer / revoked lineage / stale credential version / absolute deadline / DB outage → deny; no identity/provider/lineage/version/token leak.

## BFF-only evidence

- Envelope serialization requires `bffAuthorized !== false`.
- Unauthorized BFF serialization returns `AUTHENTICATION_REQUIRED` with no tokens.
- Origin/CORS and browser-direct restrictions were not relaxed.
- Browser logout remains a BFF responsibility using the already-approved revoke path.
- No browser-direct flow was implemented.

## Exact-set manifest

Promoted in 14-15-02 **after** 14-15-01 HTTP PASS:

| Method | Path | Policy |
|---|---|---|
| POST | `/auth/customer/emailpass/register` | `PHASE14_ENABLED` |
| POST | `/auth/customer/emailpass` | `PHASE14_ENABLED` |
| GET | `/store/customers/me` | `M1_ENABLED` + `m1_enablement: "enabled"` |

Auth local `PHASE14_ENABLED` is now exactly:

1. `POST /auth/customer/emailpass/register`
2. `POST /auth/customer/emailpass`
3. `POST /auth/token/refresh` (14-11, unchanged)
4. `POST /auth/customer/emailpass/revoke-current-lineage` (14-11, unchanged)

Store `M1_ENABLED` is now exactly:

1. `GET /store/customers/me`
2. the four 14-13 verification operations (unchanged)

`POST /auth/customer/emailpass/reset-password` and `POST /auth/customer/emailpass/update` remain DENY (14-16, not authorized). No prefix allow. No family-of-paths promotion. Manifest self-validation remains PASS in the focused suite.

## Deny matrix

Still DENY:

- `POST /store/customers`
- `POST /store/customers/me`
- raw Customer primitives not approved
- native auth session (`POST`/`DELETE /auth/session`)
- callback routes
- MFA routes
- aliases, trailing-slash variants, case variants
- method mismatch (`GET` signup/login)
- unknown `/auth/customer/*` and `/store/customers/unknown`
- browser-direct paths
- any route outside the 14-15 exact-set plus already-enabled 14-11/14-13 contracts

## Order / Payment / Stripe / Gelato negatives

Focused suite asserts zero Order, Payment, Stripe, Gelato, cart, checkout and fulfillment side effects on the signup/login/me path.

## Focused HTTP result

```text
npm run test:integration:http -w @dtc/backend -- \
  --runTestsByPath integration-tests/http/auth-customer.spec.ts
```

**PASS — 26/26.** 14-15-02 did not start until this suite passed on the 14-15-01 handlers. After exact-set elevation it passed again at 26/26.

Covered at minimum: invalid schema; valid signup with initial lineage + verification/outbox; signup IP/email thresholds; Redis 503 before write; completed account is not login; missing/wrong/unverified/verified login; login rate 10/(IP,email) and 30/IP; Redis 503 before provider lookup; timing/envelope; me allowlist and guard denies; deny matrix; commerce zeros.

## Build / lint / diff

- `npm run build -w @dtc/backend`: **PASS** after `as unknown as` casts on Medusa module resolves in the login and me production POST/GET (same pattern as refresh/register-customer). First build failed on TS2352; that is a type-boundary fix, not a behavior change.
- Direct ESLint on touched source files: **0 errors**, 6 known Medusa advisory warnings (`use-medusa-error-not-generic-error` on the existing auth generic-Error pattern; one pre-existing `import-from-framework-not-internal` on `middlewares.ts`).
- Direct ESLint `--no-ignore` on `auth-customer.spec.ts`: **0 errors**, 3 advisory warnings.
- `npm run lint -w @dtc/backend`: **KNOWN TOOLING FAILURE** — `ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)`; packages/tooling unchanged.
- `git diff --check`: **PASS**.

## Zero migration / schema / dependencies / providers / deploy / 14-16

- Zero migration or schema change.
- Zero package.json / lockfile / provider package change.
- Zero real Resend or real provider traffic.
- Zero remote/persistent DB or Redis use in this execution (limiters/fakes in HTTP tests).
- Zero frontend work.
- Zero deploy / release.
- Zero push / PR / merge.
- Zero 14-16 work.

## Predecessor snapshot drift (out of 14-15 authorized files)

Not edited. They will fail if run as-is because they snapshot pre-14-15 enablement:

- `apps/backend/integration-tests/http/auth-verification.spec.ts` — expects Store `M1_ENABLED` to be exactly the four verification paths and `GET /store/customers/me` DENY.
- `apps/backend/integration-tests/http/auth-multiprocess.spec.ts` — expects auth `PHASE14_ENABLED` to be only refresh + revoke.

Stale Phase 13 unit tests (`store-surface`/`auth-surface` `__tests__`) already expected 0 M1 / all DENY before 14-15. They were not part of the 14-15 focused gate.

## Decisions made

- Keep B14-14-HR-01 public mapping at 409 `AUTH_REQUEST_REJECTED` for completed + semantic-compatible signup; do not authenticate.
- Bind GET me into the verification Auth-envelope skip set so Store middleware cannot rewrite Auth errors.
- Use `as unknown as` for Medusa AUTH/CUSTOMER module resolves so the build matches existing 14-11/14-14 wiring.

## Deviations from plan

None of scope. The only extra code change inside authorized files after GREEN was:

1. Exact-set elevation and deny-matrix tests (Task 14-15-02, planned).
2. Type-boundary casts required for `medusa build` (authorized handler files).
3. Middleware identity assertion instead of `route.method === ["GET"]` because `defineMiddlewares` does not expose `method` on the compiled route object.

**Total deviations:** 0 scope expansions.
**Impact on plan:** none. No additional files, no migrations, no dependencies.

## Issues encountered

- First `medusa build` failed with TS2352 on `IAuthModuleService` / `ICustomerModuleService` direct casts. Fixed with `as unknown as`, matching refresh and register-customer.
- Middleware test first looked up `route.method`; compiled routes omit `method`. Assertion now checks `customerAuthAccessGuardMiddleware` identity on matcher `/store/customers/me`.

## User setup required

None — no external service configuration required. Real Resend and real providers remain unauthorized.

## Next phase readiness

14-15 execution is ready for **human review at 14-15-03**. Do not start 14-16, reset-password, or further surface elevation until 14-15 is HUMAN APPROVED.

STATE.md and ROADMAP.md were **not** updated: they are outside the authorized file list, and 14-15 is not HUMAN APPROVED.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-15*
*Status: EXECUTED — AWAITING HUMAN REVIEW*
