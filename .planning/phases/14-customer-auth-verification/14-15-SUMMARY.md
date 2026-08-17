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

No external configuration is required at this checkpoint.

Production will require `CUSTOMER_AUTH_BFF_SERVICE_SECRET` (server-side only; min 32 chars; never browser, log, persistence, or response). The future Next.js BFF must hold the same credential server-side only. Real Resend and real providers remain unauthorized.

## Next phase readiness

14-15 execution is ready for **human review at 14-15-03**. Do not start 14-16, reset-password, or further surface elevation until 14-15 is HUMAN APPROVED.

STATE.md and ROADMAP.md were **not** updated: they are outside the authorized file list, and 14-15 is not HUMAN APPROVED.

## Human-review remediation

Human review of 14-15-03 failed with three blockers. This section records the authorized remediation only. It does **not** declare 14-15 HUMAN APPROVED.

```text
B14-15-HR-01:
REMEDIATED — AWAITING HUMAN RE-REVIEW

B14-15-HR-02:
REMEDIATED — AWAITING HUMAN RE-REVIEW

B14-15-HR-03:
REMEDIATED — AWAITING HUMAN RE-REVIEW

14-15-01:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-02:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW

14-15:
NOT YET HUMAN APPROVED

14-16:
NOT AUTHORIZED

PUSH:
NONE

DEPLOY:
NONE

REAL PROVIDERS:
NONE
```

### B14-15-HR-01

REMEDIATED — AWAITING HUMAN RE-REVIEW

**Root cause:** `handleCustomerAuthLogin` applied `finish()` for `invalid_credentials`, `email_verification_required`, serializer denial and the credential-path exception catch, but the verified success path serialized the envelope and returned `200` without awaiting the approved timing envelope.

**Correction:** after session issuance and envelope serialization, and only when the serializer returns an envelope, the handler now `await finish()` exactly once and then returns `200`. Serializer denial still finishes once and returns `AUTHENTICATION_REQUIRED`. No second `finish()`, no new sleep, no `Math.random`, no `timing.ts` / 14-08 policy change.

**Proof** in `auth-customer.spec.ts` (`toHaveBeenCalledTimes(1)`):

- missing account → timing once, `401 INVALID_CREDENTIALS`
- wrong password → timing once, `401 INVALID_CREDENTIALS`
- valid unverified → timing once, `403 EMAIL_VERIFICATION_REQUIRED`, `session.issue` = 0
- valid verified → timing once, `session.issue` = 1, `200` envelope
- BFF serializer rejection after verified login → timing once, `401 AUTHENTICATION_REQUIRED`, no tokens
- exception after credential-path entry (`session.issue` throw) → timing once, `503 AUTH_TEMPORARILY_UNAVAILABLE`

### B14-15-HR-02

REMEDIATED — AWAITING HUMAN RE-REVIEW

**Existing boundary (no new authorization policy):** Phase 13/14 treat native CORS / publishable context as AS-BUILT and **not** authorization. The approved primitive that differentiates browser-direct from BFF/server-to-server on `/auth` is the already-mounted `authSurfaceGuardMiddleware` (`/auth*`): OPTIONS/HEAD are denied as implicit methods, so a browser JSON CORS preflight never reaches signup/login handlers. Elevation of `POST` signup/login does not elevate OPTIONS. `bffAuthorized` remains a serializer safety check, not the security authority. Middleware, CORS and publishable guards were not changed.

**Browser-direct DENY proof:** `authSurfaceGuardMiddleware` is invoked for `OPTIONS` on `POST /auth/customer/emailpass/register` and `POST /auth/customer/emailpass` with `Origin` + `Access-Control-Request-Method: POST`. Result: `404 { type: "not_found", message: "Not Found" }`, `next`/handler not called, no `accessToken`/`refreshToken`, zero coordinator/provider/session/lineage calls, container not resolved.

**BFF positive proof:** the same guard allows Origin-less server-to-server `POST` on those exact paths; handlers then return `201`/`200` `AuthSessionEnvelope`. Existing signup/login success tests remain the authorized-BFF envelope proofs.

No new header/secret was invented.

### B14-15-HR-03

REMEDIATED — AWAITING HUMAN RE-REVIEW

**Stale assertions found:**

- `auth-verification.spec.ts` still required Store `M1_ENABLED` to be exactly the four 14-13 verification paths and treated `GET /store/customers/me` as DENY.
- `auth-multiprocess.spec.ts` still required Auth `PHASE14_ENABLED` to be only refresh + revoke.

**Cumulative exact-set now asserted (no predecessor contract change):**

Store `M1_ENABLED`:

1. `GET /store/customers/me`
2. `POST /store/customers/me/verify`
3. `POST /store/customers/verify/resend`
4. `POST /store/customers/verify`
5. `GET /store/customers/me/verify/status`

Auth `PHASE14_ENABLED`:

1. `POST /auth/customer/emailpass/register`
2. `POST /auth/customer/emailpass`
3. `POST /auth/token/refresh`
4. `POST /auth/customer/emailpass/revoke-current-lineage`

Verification request/resend/confirm/status, rate limits, timing, no-session confirm, deny aliases, raw Customer DENY, refresh/replay/revoke, Redis coordination and PostgreSQL authority were not changed. Exact-set equality was kept; no `contains`, skip, `.only` or manifest rollback.

**Regression results:**

- `auth-verification.spec.ts`: PASS — 12/12
- `auth-multiprocess.spec.ts`: PASS — 8/8 (local disposable PostgreSQL via existing Docker harness `p12_disposable_*`; Redis local-only via existing `p14-auth-redis-*` harness; cleanup `P12_DISPOSABLE_POSTGRES_CLEAN` confirmed)

### Remediation validation

```text
Focused auth-customer:
PASS — 30/30

Predecessor verification:
PASS — 12/12

Predecessor multiprocess (local disposable PostgreSQL + local Redis):
PASS — 8/8
cleanup = PASS

Combined focused regression (three suites, local disposable PostgreSQL):
PASS — 50/50
cleanup = PASS

Backend build:
PASS

Direct ESLint route.ts:
PASS — 0 errors, 1 known Medusa advisory warning
(use-medusa-error-not-generic-error)

Direct ESLint --no-ignore test files:
PASS — 0 errors
auth-customer.spec.ts = 4 known advisory Medusa warnings
auth-verification.spec.ts = 4 known advisory Medusa warnings
auth-multiprocess.spec.ts = 0 warnings

Repository lint wrapper:
KNOWN TOOLING FAILURE — empty JSON / EOF while parsing
accepted non-blocking; no tooling/package changes

git diff --check:
PASS
```

Scope kept:

- PostgreSQL/Redis: local disposable Docker only; no remote DB/Redis
- no real Resend / real providers
- no migration/schema
- no package.json / lockfile
- no push / PR / merge / deploy
- no 14-16
- no STATE.md / ROADMAP.md update
- no login.ts / signup / me / manifests / middlewares / access-guard / rate-limit / timing / registration / session / verification changes except the authorized login handler `finish()` on verified success

## Second human-review remediation

Human re-review of 14-15-03 failed again on HR-01 and HR-02. HR-03 remains closed. This section records the second authorized remediation only. It does **not** declare 14-15 HUMAN APPROVED.

```text
B14-15-HR-01:
REMEDIATED — AWAITING HUMAN RE-REVIEW

B14-15-HR-02:
BLOCKED — CORS DOES NOT ENFORCE NO-DIRECT-BROWSER-SIDE-EFFECT CONTRACT

B14-15-HR-03:
CLOSED — PASS

14-15-01:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-02:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW

14-15:
NOT YET HUMAN APPROVED

14-16:
NOT AUTHORIZED

PUSH:
NONE

DEPLOY:
NONE

REAL PROVIDERS:
NONE
```

### B14-15-HR-01

REMEDIATED — AWAITING HUMAN RE-REVIEW

**Root cause of the remaining double-call:** the first remediation awaited `finish()` on every credential path, including verified success. `finish` was `() => timing(startedAtMs)`. If that first `await finish()` rejected, control entered the existing `catch`, which executed `await finish().catch(...)`. Timing resolve therefore invoked the function once; timing reject could invoke it twice.

**Correction:** the login handler now memoizes the first timing Promise per request:

```text
let finishPromise: Promise<number> | undefined
const finishOnce = (): Promise<number> => {
  finishPromise ??= timing(startedAtMs)
  return finishPromise
}
```

Every previous `finish()` call is now `finishOnce()` / `finishOnce().catch(...)`. `timing(startedAtMs)` is invoked only inside that primitive. A resolved Promise is reused; a rejected Promise is reused; a cached rejection is still one execution. No boolean-before-await window. Public error classes are unchanged: a timing rejection still surfaces as `503 AUTH_TEMPORARILY_UNAVAILABLE` after the catch swallows the cached rejection. `timing.ts`, floor, and jitter were not edited.

**Proof** in `auth-customer.spec.ts` (`toHaveBeenCalledTimes(1)`):

- missing account → timing once, `401 INVALID_CREDENTIALS`
- wrong password → timing once, `401 INVALID_CREDENTIALS`
- valid unverified → timing once, `403 EMAIL_VERIFICATION_REQUIRED`, `session.issue` = 0
- valid verified → timing once, `session.issue` = 1, `200` envelope
- BFF serializer rejection after verified login → timing once, `401 AUTHENTICATION_REQUIRED`, no tokens
- exception after credential-path entry (`session.issue` throw) → timing once, `503 AUTH_TEMPORARILY_UNAVAILABLE`
- **new:** `timing = jest.fn().mockRejectedValue(new Error("synthetic timing failure"))` on a path that reaches timing → timing once after handler error handling, `503 AUTH_TEMPORARILY_UNAVAILABLE`

### B14-15-HR-02

BLOCKED — CORS DOES NOT ENFORCE NO-DIRECT-BROWSER-SIDE-EFFECT CONTRACT

**STOP — HUMAN ARCHITECTURE DECISION REQUIRED**

No production boundary change was implemented. No new header, secret, API key, middleware, CORS, publishable, env, or proxy primitive was invented.

#### Documentary definition used

`14-SPEC.md` hard invariant 8 and §3:

> BFF-only — browser never receives backend session JWT, backend refresh credential, or internal auth/session capabilities **and never calls Medusa directly**.
>
> Browser never calls Medusa directly.

`14-SDD.md` §1 repeats the same sentence and labels native CORS / publishable context **AS-BUILT; not authorization**. `14-IMPLEMENTATION-PROMPT.md` §4.2 is the same topology: `Browser → same-origin BFF → Medusa` and `Browser → Medusa directly = FORBIDDEN`. Path C (token non-exposure only) is therefore **not** the approved contract. The contract requires absence of browser-direct **side effects**, not only unreadability of `AuthSessionEnvelope`.

#### Real boundary found

| Layer | What it actually does | Distinguishes BFF vs browser-direct POST? |
|---|---|---|
| Native Medusa `authCors` (`@medusajs/framework` `router.js` + `cors` with `preflightContinue: false`) | For OPTIONS, answers the preflight itself (204) and may omit `Access-Control-Allow-Origin` when Origin is outside `AUTH_CORS`. For actual POST, **always `next()`s**. Disallowed Origin only skips the ACAO header. | No. CORS is browser response-exposure, not a server-side execution gate. |
| `authSurfaceGuardMiddleware` (`/auth*`) | Method + canonical path + exact-set policy. OPTIONS/HEAD are implicit DENY. Enabled POST signup/login are ALLOW. Origin is not read. | No. It is not a BFF identity check. |
| Publishable key | Applied only to `/store`. `/auth` has no publishable middleware. | No. |
| `bffAuthorized` | Hardcoded `true` in the production POST handlers; serializer safety only. | No. |
| Same-origin Next.js BFF | `FUTURE OWNER-PHASE`. Not present in this backend. | Not implemented. |

Three cases are not equivalent:

1. **Request not sent by the browser** — only some preflighted JSON `fetch` calls, and only when the browser itself withholds POST after a preflight without ACAO.
2. **Request sent but JS cannot read the response** — native AUTH CORS for a disallowed Origin: POST still executes; ACAO is absent.
3. **Request sent and server-side mutation runs** — Origin-bearing POST of signup/login. This is the live runtime.

A form/`text/plain` simple POST never preflights. A JSON POST whose preflight is answered 204 without ACAO is still not a server-side block: any non-browser client, and the Medusa CORS middleware itself, will execute the POST.

#### Tests

- Renamed the insufficient proof to `"keeps browser CORS preflight OPTIONS outside the exact auth surface"`. It remains deny-matrix evidence that OPTIONS is not an elevated business method. It is **not** a complete BFF-only proof. In the real Medusa stack, OPTIONS on an enabled POST route is answered by the `cors` package **before** this guard.
- Added `"records that native AUTH CORS does not stop Origin-bearing POST from executing signup and login handlers"`: realistic browser `Origin` + `Content-Type: application/json`, chained through the installed `cors` options (`origin: parseCorsOrigins(AUTH_CORS)`, `credentials: true`, `preflightContinue: false`) and then `authSurfaceGuardMiddleware`. Result: guard allows, signup coordinator runs, login `session.issue` runs, `201`/`200` token bodies are produced, ACAO is absent.
- Kept Origin-less server-to-server POST as the positive BFF-shaped path: same routes work without Origin.

Observed side effects on browser-direct POST: handler executes; coordinator executes; session.issue executes; AuthSessionEnvelope tokens are in the body. CORS may hide that body from browser JS; it does not prevent mutation.

#### Why this cannot be closed in the authorized scope

Closing the SPEC contract would require a production boundary that does not exist today (middleware/CORS/config/header/publishable/proxy). Those files are outside the authorized production allowlist. Inventing a BFF secret would also violate the stop conditions.

Evidence:

- browser-direct POST can reach handler
- response exposure may be denied, but server-side mutation can occur

### B14-15-HR-03

CLOSED — PASS

Not reopened. Predecessor suites were re-run only as regression:

- `auth-verification.spec.ts`: PASS — 12/12
- `auth-multiprocess.spec.ts`: PASS — 8/8

Exact-set cumulativo inalterado:

- AUTH: register, login, refresh, revoke
- STORE: GET me + four verification contracts

### Second-remediation validation

```text
Focused auth-customer:
PASS — 32/32

Predecessor verification:
PASS — 12/12

Predecessor multiprocess (local disposable PostgreSQL + local Redis):
PASS — 8/8
cleanup = PASS
[P12_DISPOSABLE_POSTGRES_CLEAN] confirmed

Combined focused regression (three suites, local disposable PostgreSQL):
PASS — 52/52
cleanup = PASS
[P12_DISPOSABLE_POSTGRES_CLEAN] confirmed

Backend build:
PASS

Direct ESLint route.ts:
PASS — 0 errors, 1 known Medusa advisory warning
(use-medusa-error-not-generic-error)

Direct ESLint --no-ignore auth-customer.spec.ts:
PASS — 0 errors, 4 known advisory Medusa warnings
(use-medusa-error-not-generic-error)

Repository lint wrapper:
KNOWN TOOLING FAILURE — empty JSON / EOF while parsing
accepted non-blocking; no tooling/package changes

git diff --check:
PASS
```

Scope kept:

- PostgreSQL/Redis: local disposable Docker only; no remote DB/Redis
- no real Resend / real providers
- no migration/schema
- no package.json / lockfile
- no push / PR / merge / deploy
- no 14-16
- no STATE.md / ROADMAP.md update
- production edit limited to `apps/backend/src/api/auth/customer/emailpass/route.ts` (`finishOnce`)
- no middlewares.ts / medusa-config / CORS / auth-surface guard / headers / env / proxy / publishable changes

## BFF service boundary architecture remediation

Human architecture decision accepted the HR-02 diagnosis and authorized a backend BFF service authentication boundary. This section records that remediation only. It does **not** declare 14-15 HUMAN APPROVED.

```text
B14-15-HR-01:
CLOSED — PASS

B14-15-HR-02:
REMEDIATED — AWAITING HUMAN RE-REVIEW

B14-15-HR-03:
CLOSED — PASS

14-15-01:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-02:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW

14-15:
NOT YET HUMAN APPROVED

14-16:
NOT AUTHORIZED

PUSH:
NONE

DEPLOY:
NONE

REAL PROVIDERS:
NONE

REMOTE DB/REDIS:
NONE
```

**Root cause HR-02:** CORS and `authSurfaceGuardMiddleware` do not authenticate the caller. Origin-bearing POST could reach signup/login handlers and produce side effects. Hiding the JavaScript-readable response is not a deny-before-mutation boundary. The SPEC requires `Browser → Medusa directly = FORBIDDEN`.

**Human decision:** introduce an explicit BFF service authentication boundary.

```text
Browser → same-origin Next.js BFF → BFF service credential → Medusa
Browser → Medusa directly → DENY before business handler / mutation
```

The Next.js BFF remains FUTURE OWNER-PHASE. It was not implemented.

**Secret / env / header:**

- env: `CUSTOMER_AUTH_BFF_SERVICE_SECRET`
- header: `x-indicio-bff-auth`
- opaque high-entropy server-side secret
- never sent to the browser, never returned, never persisted, never logged, never sent to Sentry/PostHog
- independent of Customer JWT, refresh, verification/reset capability, publishable key, Redis, and PostgreSQL
- `Authorization` remains reserved for the customer bearer JWT
- no new npm dependency

**Constant-time comparison:** `sha256(expected)` and `sha256(received)` compared with `node:crypto.timingSafeEqual`. No direct `===` on secrets.

**Exact protected operation set:**

- `POST /auth/customer/emailpass/register`
- `POST /auth/customer/emailpass`
- `POST /auth/token/refresh`
- `POST /auth/customer/emailpass/revoke-current-lineage`
- `GET /store/customers/me`
- `POST /store/customers/me/verify`
- `POST /store/customers/verify/resend`
- `POST /store/customers/verify`
- `GET /store/customers/me/verify/status`

Reset/update remain DENY. No new route was enabled.

**Middleware ordering (Medusa `RoutesSorter` + registered arrays):**

```text
Native CORS / publishable
  → defense-in-depth only; NOT authorization

AUTH:  authSurfaceGuard → BFF service guard → customer access guard when present → handler
STORE: storeSurfaceGuard → BFF service guard → customer access guard when present → handler
```

Method-less `/auth*` and `/store*` stay in the global bucket before exact BFF matchers. The BFF guard is not mounted on `/auth*` or `/store*` indiscriminately.

**Fail-closed contract:**

- valid backend secret + correct header → PASS, continue
- missing header → generic 404, no handler
- invalid header → generic 404, no handler
- missing/invalid runtime config → 503 `AUTH_TEMPORARILY_UNAVAILABLE`, no handler

No fallback to Origin, CORS, publishable key, localhost, `NODE_ENV`, IP, User-Agent, or `bffAuthorized: true`.

**Browser-direct:** Origin-bearing POST without the service header is denied before the handler. A curl without Origin and without the service secret is also denied. Zero coordinator/provider/limiter/session/verification/JWT side effects.

**BFF positive path:** request with the correct service secret passes the BFF guard whether or not Origin is present. Origin is not authority. The real browser never has this secret.

**CORS:** remains defense-in-depth / framework behavior only.

**No secret leaks:** missing/invalid/unavailable responses contain neither the presented secret, the expected secret, the env var name, nor a digest. Middleware does not log request headers wholesale.

**Validation:**

```text
BFF service auth unit:
PASS — 10/10

Focused auth-customer:
PASS — 36/36

Predecessor verification:
PASS — 15/15

Predecessor multiprocess (local disposable PostgreSQL + local Redis):
PASS — 10/10
cleanup = PASS
[P12_DISPOSABLE_POSTGRES_CLEAN] confirmed

Combined focused regression (three suites, local disposable PostgreSQL):
PASS — 61/61
cleanup = PASS
[P12_DISPOSABLE_POSTGRES_CLEAN] confirmed

Backend build:
PASS

Direct ESLint production files:
PASS — 0 errors
known advisory Medusa warnings only

Direct ESLint --no-ignore test files:
PASS — 0 errors
known advisory Medusa warnings only

Repository lint wrapper:
KNOWN TOOLING FAILURE — empty JSON / EOF while parsing
accepted non-blocking; no tooling/package changes

git diff --check:
PASS
```

Scope kept:

- PostgreSQL/Redis: local disposable Docker only; leftover containers none
- no remote DB/Redis
- no real Resend / real providers
- no migration/schema
- no package.json / lockfile
- no push / PR / merge / deploy
- no 14-16
- no STATE.md / ROADMAP.md update
- no frontend / Next.js BFF implementation
- no Heroku env change
- handlers signup/login/me/verification/refresh/revoke were not edited

## Config contract cleanup (B14-15-HR-04)

Human re-review of 14-15-03 closed HR-01, HR-02 and HR-03, then opened B14-15-HR-04 for config-contract cleanup. This section records that remediation only. It does **not** declare 14-15 HUMAN APPROVED.

```text
B14-15-HR-01:
CLOSED — PASS

B14-15-HR-02:
CLOSED — PASS

B14-15-HR-03:
CLOSED — PASS

B14-15-HR-04:
REMEDIATED — AWAITING HUMAN RE-REVIEW

14-15-01:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-02:
EXECUTED — AWAITING HUMAN RE-REVIEW

14-15-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW

14-15:
NOT YET HUMAN APPROVED

14-16:
NOT AUTHORIZED

PUSH:
NONE

DEPLOY:
NONE

REAL PROVIDERS:
NONE
```

**Root cause:** `.env.template` defined `CUSTOMER_AUTH_BFF_SERVICE_SECRET=` twice. The template unit test used `toMatch` and therefore accepted a duplicate assignment. `User setup required: None` understated the production/future-BFF credential contract.

**Correction:**

- `.env.template` now contains exactly one `CUSTOMER_AUTH_BFF_SERVICE_SECRET=` assignment, with the canonical server-side documentation (production required, min 32 chars, never browser/log/persistence/response).
- `env.unit.spec.ts` asserts that assignment string occurs exactly once (count, not `toMatch`).
- This SUMMARY records that no external configuration is required at this checkpoint, while production will require `CUSTOMER_AUTH_BFF_SERVICE_SECRET` and the future Next.js BFF must hold the same credential server-side only.

Unchanged by design: `env.ts`, middleware, BFF guard, handlers, manifests, SDD, PLAN, STATE.md, ROADMAP.md, packages/dependencies.

**Validation:**

```text
Focused env.unit.spec.ts:
PASS — 84/84

Backend build:
PASS

Direct ESLint env.unit.spec.ts:
PASS — 0 errors, 11 known advisory Medusa warnings
(use-medusa-error-not-generic-error)

Repository lint wrapper:
KNOWN TOOLING FAILURE — empty JSON / EOF while parsing
accepted non-blocking; no tooling/package changes

git diff --check:
PASS
```

Scope kept:

- no env.ts / middleware / BFF guard / handlers / manifests
- no SDD / PLAN / STATE.md / ROADMAP.md
- no package.json / lockfile
- no push / PR / merge / deploy
- no 14-16

---
*Phase: 14-customer-auth-verification*
*Plan: 14-15*
*Status: EXECUTED — AWAITING HUMAN RE-REVIEW; HR-04 REMEDIATED*
