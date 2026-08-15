---
phase: 14-customer-auth-verification
plan: 14
subsystem: auth
tags: [registration, coordinator, postgres, concurrency, scrypt, verification-outbox]

# Dependency graph
requires:
  - phase: 14-customer-auth-verification
    provides: RegistrationIntent schema, 14-03 transaction capability matrix, session lineage primitives, verification/outbox primitives, and DENY signup/login surfaces
provides:
  - Registration coordinator/domain and register-customer workflow orchestration
  - Unit and disposable PostgreSQL evidence for recovery, mismatch zero-write, concurrency, TTL, lineage and verification/outbox
affects: [14-15, customer-auth, auth-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PostgreSQL advisory lock plus CAS version on RegistrationIntent
    - Reconcilable recovery across RECONCILIATION_REQUIRED auth/customer seams
    - Intra-module session/verification writes bound to the registration transaction via AsyncLocalStorage
    - emailpass scrypt-kdf verify for password compatibility without persisted password material

key-files:
  created:
    - apps/backend/src/modules/customer-auth/registration.ts
    - apps/backend/src/workflows/customer-auth/register-customer.ts
    - apps/backend/src/modules/customer-auth/__tests__/registration.unit.spec.ts
    - apps/backend/integration-tests/modules/auth-registration.postgres.spec.ts
  modified: []

key-decisions:
  - "Password never enters the semantic HMAC; compatibility is proved only by the emailpass scrypt primitive."
  - "auth_provider and customer_workflow remain RECONCILIATION_REQUIRED; recovery states resume instead of rolling back confirmed external effects."
  - "Session and verification share the custom registration transaction; provider delivery is never invoked by the coordinator."
  - "Signup/login HTTP remains DENY; this plan is domain/workflow only."

patterns-established:
  - "Claim the active RegistrationIntent by normalized email hash, then progress pending_identity → pending_customer → completed, using failed_reconcilable after unproven customer/lineage/verification seams."
  - "Incompatible semantic or password retries are zero-write and never call register."

requirements-completed: []

# Metrics
duration: 50min
completed: 2026-08-15
status: executed-awaiting-review
---

# Phase 14: Customer Auth Verification — Plan 14 Summary

**The registration coordinator now recovers partial identity/Customer work, rejects incompatible retries with zero writes, and converges concurrent compatible signups to one identity, one Customer, one lineage and one verification/outbox pair — without elevating signup/login HTTP.**

## Final status

```text
14-14-01:
EXECUTED — AWAITING HUMAN REVIEW

14-14-02:
EXECUTED — AWAITING HUMAN REVIEW

14-14-03:
BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW

14-14:
NOT YET HUMAN APPROVED

14-15:
NOT AUTHORIZED

SIGNUP/LOGIN HTTP:
DENY / NOT ELEVATED

PUSH:
NONE

DEPLOY:
NONE

REAL PROVIDERS:
NONE
```

This summary does **not** close AUTH-01/AUTH-02/AUTH-09 globally and does **not** declare 14-14 human-approved.

Milestone-level requirements remain unchanged. Frontend remains BLOCKED.

## Files changed

Created:

- `apps/backend/src/modules/customer-auth/registration.ts` — coordinator, semantic HMAC, PostgreSQL claim/CAS/credential writes, scoped transaction binding.
- `apps/backend/src/workflows/customer-auth/register-customer.ts` — workflow/step orchestration over existing auth, customer, session and verification primitives.
- `apps/backend/src/modules/customer-auth/__tests__/registration.unit.spec.ts` — RED-then-GREEN unit suite.
- `apps/backend/integration-tests/modules/auth-registration.postgres.spec.ts` — disposable PostgreSQL concurrency/recovery suite.
- `.planning/phases/14-customer-auth-verification/14-14-SUMMARY.md` — this document.

Not changed (authorized exclusion):

- migration/schema/models
- `service.ts`, `verification.ts`, `session.ts`
- access guard, middleware, Store/auth manifests, validators, rate-limit policy
- provider package, env, `package.json`, lockfile
- `.planning/STATE.md`, `.planning/ROADMAP.md` (outside the authorized documentary file set)

## Local commits

1. `7fbbfa86386f4832fbe968a6cfae9805220bdfe8` — `test(14-14-01): add red registration coordinator coverage`
2. `4b39a9a` — `feat(14-14): implement customer registration coordinator`
3. `0c96d0f` — `test(14-14): prove registration recovery and concurrency on disposable PostgreSQL`
4. this SUMMARY commit, created after the technical commits

No push, PR, merge, deploy or release.

## State machine implemented

Approved progression:

```text
pending_identity
  → pending_customer          (identity present)
  → failed_reconcilable       (Customer present; unproven lineage/verification seam)
  → completed                 (canonical Customer + lineage + verification/outbox)
pending_identity|pending_customer|failed_reconcilable
  → expired                   (TTL 24h)
```

Recovery resumes the same intent. Canonical identity/Customer rows are never deleted to "start over".

## Semantic HMAC contract

`deriveRegistrationSemanticPayloadHmac` covers only:

- schema `customer-registration-v1`
- normalized email
- normalized `first_name` / `last_name`

Password is excluded. Compatible retries with a different password still match the HMAC; name changes do not.

## Password compatibility proof

Inspected `@medusajs/auth-emailpass` `EmailPassAuthService`:

- `register` hashes with `scrypt-kdf.kdf`
- `authenticate` verifies with `scrypt-kdf.verify`
- `register` on a claimable identity (empty `app_metadata`) would overwrite the password

The coordinator therefore:

- calls `register` only when `findIdentity` returns none
- proves compatible retries with `authenticate` / scrypt verify
- treats failed verify as `CUSTOMER_REGISTRATION_PASSWORD_MISMATCH` with zero writes

PostgreSQL tests use the same `scrypt-kdf` primitive. A second `register` against an existing identity throws `EMAILPASS_REGISTER_WOULD_OVERWRITE`, so an accidental overwrite cannot pass silently.

## Concurrency

PostgreSQL is the authority:

- `pg_advisory_xact_lock` keyed by normalized email hash
- `SELECT … FOR UPDATE` on the active intent
- partial unique indexes already present on active hash/identity/customer
- CAS `version` on transitions

Wave 0 `contendForExclusiveClaim` ran as a real two-connection barrier. Three concurrent compatible coordinator calls then converged to one identity, one Customer, one intent, one lineage, one verification intent and one outbox.

In-memory mutexes and Redis were not used as registration truth.

## Fault / recovery points

| Boundary | Persist after fault | Retry |
|---|---|---|
| before identity | `pending_identity` | create identity and continue |
| after identity, before Customer | `pending_customer` | authenticate, create/find one Customer |
| after Customer, before lineage | `failed_reconcilable` | issue or recover one lineage |
| after lineage, before verification | `failed_reconcilable` | auto-request verification/outbox |
| after verification/outbox, before completion | `failed_reconcilable` | mark `completed` |

Confirmed external auth/customer effects are not rolled back. Recovery never deletes the canonical identity or Customer.

## TTL 24h

`CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS = 86400`. An expired active intent is marked `expired` and is not reused. The expired-path test used a new password and proved `register` was not called and the original scrypt hash still verified the old password.

## One identity / one Customer / one result

Unit and PostgreSQL suites both proved:

- exactly one auth identity
- exactly one Customer
- exactly one completed RegistrationIntent
- exactly one canonical result identity/Customer/intent triple under concurrency

## Initial lineage

Lineage is issued only after Customer and credential state exist. Concurrent and retry paths produced exactly one `auth_session_lineage` row. Completed retry recovers the same lineage; it does not mint a second unverified relogin lineage.

## Verification + outbox

Valid completion calls the approved `autoRequestVerification` primitive exactly once semantically. Persistence remains hash-only. Auto replay of an already-pending intent returns the same intent id; the outbox row remains exactly one. No native Medusa verification event is emitted.

## Provider independence

`providerDelivery` is part of the coordinator contract only to make independence explicit. Completion does not invoke it. A synthetic thrower was supplied in unit and PostgreSQL tests: call count stayed `0` and registration truth remained `completed`.

REAL RESEND was not used.

## Zero Order / Payment / Stripe / Gelato

Explicit negative asserts in both suites:

- Order = 0
- Payment = 0
- Stripe = 0
- Gelato = 0
- cart = 0
- checkout = 0
- fulfillment = 0

Registration does not create an Order. The Stripe-webhook birth invariant is unchanged.

## Signup / login remain DENY

PostgreSQL suite asserted:

- `POST /auth/customer/emailpass/register` → deny
- `POST /auth/customer/emailpass` → deny
- `POST /store/customers` → deny

No route, manifest, middleware or OpenAPI file was modified.

## Validation evidence

### Unit (14-14-01)

```text
npm run test:unit -w @dtc/backend -- \
  --runTestsByPath src/modules/customer-auth/__tests__/registration.unit.spec.ts
```

**PASS — 14/14 in 1.791s** (target <30s).

Coverage: happy path, compatible retry, semantic mismatch, password mismatch, expired intent, all five fault boundaries, concurrent convergence, provider independence, commerce isolation, semantic HMAC.

### Disposable PostgreSQL (14-14-02)

```text
node apps/backend/scripts/run-disposable-postgres-tests.mjs -- \
  npm run test:integration:modules -w @dtc/backend -- \
  --runTestsByPath integration-tests/modules/auth-registration.postgres.spec.ts
```

**PASS — 14/14 in 4.393s.**

Cleanup confirmed:

```text
[P12_DISPOSABLE_POSTGRES_CLEAN] target=p12_disposable_8f2494f8f6f46238 container=p12-pg-8f2494f8f6f46238
```

### Backend build

`npm run build -w @dtc/backend` — **PASS**.

### ESLint

Direct scoped ESLint on production files: **0 errors, 0 warnings**.

Direct ESLint `--no-ignore` on the two test files: **0 errors**, 9 advisory `@medusajs/use-medusa-error-not-generic-error` warnings in test harnesses (same class as prior Phase 14 test suites).

### Lint wrapper

`npm run lint -w @dtc/backend` — **KNOWN TOOLING FAILURE**:

```text
ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)
```

Accepted non-blocking. No tooling or package change.

### `git diff --check`

**PASS**.

## Zero / forbidden work

- Real Resend / real providers: **NONE**
- Migration/schema: **NONE**
- Dependency install/upgrade: **NONE**
- Endpoint elevation: **NONE**
- Push / PR / merge: **NONE**
- Deploy / release: **NONE**
- Frontend: **NONE**
- Auto-chain: **NONE**
- 14-15: **NOT STARTED**

## Decisions made

- Use the existing RegistrationIntent schema and 14-03 `RECONCILIATION_REQUIRED` matrix; do not invent a strong cross-module transaction.
- Bind intra-module session/verification writes to the current registration transaction through `AsyncLocalStorage`, not a shared mutable stack.
- Prove password compatibility with the real `scrypt-kdf` API used by emailpass, without constructing the Medusa provider service or calling a live provider.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Concurrent shared-transaction stack mixed connections**

- **Found during:** Task 14-14-02
- **Issue:** A process-wide `scopes` array made concurrent registrations use another connection's `raw`, deadlocking advisory-lock waiters.
- **Fix:** Replaced the stack with `AsyncLocalStorage` so each transaction keeps its own connection. PostgreSQL remains the registration authority.
- **Files modified:** `registration.ts`, `register-customer.ts`, `auth-registration.postgres.spec.ts`
- **Verification:** disposable PostgreSQL concurrency test PASS
- **Committed in:** `4b39a9a` / `0c96d0f`

**2. [Rule 1 - Test] Completed retry is canonical by persisted ids, not JWT envelope equality**

- **Found during:** Task 14-14-02
- **Issue:** Recovered completion re-issues access JWT `jti`, marks rotation `recovered`, and `autoRequestVerification` returns `outbox: null` when a pending intent already exists.
- **Fix:** Assert one identity/Customer/lineage/intent/outbox row and matching canonical ids. Do not require byte-identical first-response envelopes.
- **Files modified:** `auth-registration.postgres.spec.ts`
- **Verification:** PostgreSQL suite 14/14 PASS
- **Committed in:** `0c96d0f`

---

**Total deviations:** 2 auto-fixed (correctness/test assertion).
**Impact on plan:** No scope expansion. No schema, HTTP or provider change.

## Issues encountered

The first disposable PostgreSQL run hung because concurrent coordinator calls shared one `scopes` array. The runner was terminated, the container cleaned, and the ALS binding fixed before the passing rerun.

`STATE.md` / `ROADMAP.md` were not updated because they were outside the authorized file set. Human review should sync those documents if desired.

## User setup required

None — no external service configuration required.

## Next phase readiness

14-15 remains **NOT AUTHORIZED**. Signup/login HTTP elevation is still DENY and belongs to a later authorized plan after 14-14-03 human approval.

Do not start 14-15, push, deploy, or exercise real providers from this checkpoint.

## Self-Check: PASSED

- Authorized technical files exist on disk.
- Local commits `7fbbfa8`, `4b39a9a`, `0c96d0f` are present.
- Unit acceptance: 14/14 PASS <30s.
- Disposable PostgreSQL acceptance: 14/14 PASS with cleanup.
- Build PASS, direct ESLint 0 errors, `git diff --check` PASS.
- No 14-15 work, no HTTP elevation, no push/deploy, no real providers.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-14*
*Completed: 2026-08-15*
