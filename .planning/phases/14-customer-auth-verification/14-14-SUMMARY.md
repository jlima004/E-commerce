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
  - Terminal completed-registration rejection that cannot be reused as login/session recovery
affects: [14-15, customer-auth, auth-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PostgreSQL advisory lock plus CAS version on RegistrationIntent
    - Reconcilable recovery across RECONCILIATION_REQUIRED auth/customer seams
    - Intra-module session/verification writes bound to the registration transaction via AsyncLocalStorage
    - emailpass scrypt-kdf verify for partial-registration password compatibility without persisted password material

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
  - "A completed RegistrationIntent is terminal for signup: semantic-compatible retry returns CUSTOMER_REGISTRATION_ALREADY_COMPLETED with zero auth/Customer/session/verification side effects."
  - "14-14 remains domain/workflow only; signup/login HTTP stayed DENY throughout its execution."

patterns-established:
  - "Claim active RegistrationIntent by normalized email hash and progress pending_identity → pending_customer → failed_reconcilable → completed."
  - "Incompatible semantic or password retries are zero-write and never replace pending credential truth."
  - "Semantic mismatch is evaluated before completed rejection; completed registration is never login/session recovery."

requirements-completed: []

# Metrics
duration: 50min plus human-review remediation
completed: 2026-08-15
status: complete
---

# Phase 14: Customer Auth Verification — Plan 14 Summary

**Plan 14-14 is HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED. The registration coordinator safely recovers partial identity/Customer work, converges concurrency to one canonical registration, and rejects completed signup retries without authentication or mutation. Plan 14-15 is authorized for execution but not started.**

## Final governance status

```text
B14-14-HR-01:
CLOSED — PASS

14-14-01:
HUMAN APPROVED — PASS

14-14-02:
HUMAN APPROVED — PASS

14-14-03:
HUMAN APPROVED — PASS

14-14:
HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

14-15:
AUTHORIZED FOR EXECUTION
NOT STARTED

14-16..14-21:
NOT AUTHORIZED

CURRENT SIGNUP/LOGIN HTTP SURFACE:
DENY until 14-15 execution reaches and passes its exact-set elevation task

DEPLOY:
NOT AUTHORIZED

REAL RESEND / REAL PROVIDERS:
NOT AUTHORIZED

FRONTEND:
BLOCKED
```

This closure does **not** independently close AUTH-01/AUTH-02/AUTH-09 globally. Milestone requirements remain **8/91** pending the later Phase 14 gates.

## Accepted registration contract

Approved state progression:

```text
pending_identity
  → pending_customer
  → failed_reconcilable
  → completed

pending_identity|pending_customer|failed_reconcilable
  → expired after 24h
```

- Recovery resumes the same intent and never deletes canonical identity/Customer effects merely to restart.
- PostgreSQL is the registration authority; advisory transaction lock, `FOR UPDATE`, existing uniqueness constraints and CAS versioning drive convergence.
- Redis and process-local mutexes do not grant registration truth.
- Semantic HMAC covers schema + normalized email + normalized names; password is excluded.
- Partial-registration password compatibility is proved through the emailpass/scrypt path, never a persisted password fingerprint/HMAC.
- Password mismatch and semantic mismatch are zero-write.
- Completion creates/reuses exactly one credential state, initial lineage/refresh and verification intent/outbox according to the already-approved session/verification domains.
- Provider delivery is independent and is never invoked by the registration coordinator.
- Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects remain zero.

## B14-14-HR-01 — CLOSED

### Root cause

The original completed-intent path incorrectly treated a semantically compatible signup retry as registration recovery: it authenticated the password, recovered Customer/session state, re-issued an access JWT and replayed verification.

### Accepted correction

After claim/lock and the semantic HMAC check, `intent.status === "completed"` now rejects immediately with:

`CUSTOMER_REGISTRATION_ALREADY_COMPLETED`

The ordering is intentionally:

```text
claim/lock
→ semantic compatibility check
→ completed terminal rejection
→ only partial states may enter password/provider/Customer/session/verification recovery
```

Therefore:

- completed + semantic mismatch → `CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH`;
- completed + semantic match → `CUSTOMER_REGISTRATION_ALREADY_COMPLETED`;
- completed retry does not authenticate password;
- does not call `register`;
- does not find/create Customer;
- does not ensure credential state;
- does not recover/issue session or JWT/refresh material;
- does not call verification/outbox/provider delivery;
- does not mutate RegistrationIntent, lineage, refresh credential or verification truth.

`B14-14-HR-01: CLOSED — PASS`.

## Concurrency and recovery evidence

The accepted unit/PostgreSQL evidence proves:

- one auth identity;
- one Customer;
- one completed RegistrationIntent;
- one credential state;
- one initial lineage;
- one active refresh credential;
- one verification intent;
- one notification outbox row;
- partial recovery across all five approved fault boundaries;
- 24h intent expiry without old password/payload reuse;
- completed late/concurrent callers receive `CUSTOMER_REGISTRATION_ALREADY_COMPLETED` rather than a second signup success;
- commerce canaries stay at zero.

The transaction-context fix uses `AsyncLocalStorage`; the superseded process-wide `scopes` array is not present in the accepted implementation.

## Final validation evidence

### Unit

```text
npm run test:unit -w @dtc/backend -- \
  --runTestsByPath src/modules/customer-auth/__tests__/registration.unit.spec.ts
```

**PASS — 15/15 in 3.501s**.

### Disposable PostgreSQL

```text
node apps/backend/scripts/run-disposable-postgres-tests.mjs -- \
  npm run test:integration:modules -w @dtc/backend -- \
  --runTestsByPath integration-tests/modules/auth-registration.postgres.spec.ts
```

**PASS — 14/14 in 3.21s**.

Cleanup:

```text
[P12_DISPOSABLE_POSTGRES_CLEAN] target=p12_disposable_8ba407310f183ba4 container=p12-pg-8ba407310f183ba4
```

### Build / lint / diff

- Backend build: **PASS**.
- Direct ESLint `registration.ts`: **0 errors, 0 warnings**.
- Direct ESLint `--no-ignore` test files: **0 errors**, 9 known advisory Medusa warnings.
- Repository lint wrapper: **KNOWN TOOLING FAILURE** — empty JSON / EOF while parsing; accepted non-blocking because direct ESLint/build pass and packages/tooling were unchanged.
- `git diff --check`: **PASS**.

## Historical superseded failures

These are preserved for traceability but are **not current blockers**:

1. An intermediate `register-customer.ts` type error occurred before the final implementation; the final build passed.
2. The first disposable PostgreSQL run deadlocked because a process-wide `scopes` array mixed transaction connections; it was replaced with `AsyncLocalStorage`, and subsequent disposable PostgreSQL runs passed with cleanup.
3. The original test expectation that completed retry could return a canonical success was superseded by `B14-14-HR-01`; completed signup is now terminal and zero-write.

## Remote / scope evidence

Technical/remediation work was pushed manually before closure.

Remote head immediately before this documentary closure:

`84eb8c41b32521d22feb2beb07e6cb054101ea53`

Relevant remediation lineage includes:

- `a4fba2f35a84acd7cf15d17eb4bff4e671e3144f` — technical completed-retry remediation;
- `84eb8c41b32521d22feb2beb07e6cb054101ea53` — remediation summary/evidence.

No migration/schema, dependency install/upgrade, real provider, deployment/release or frontend work was performed by 14-14.

## 14-15 authorization

By explicit human authorization, `14-15-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The authorization is limited to the approved plan:

- `14-15-01`: implement signup/login/current-state with the approved flexible policy, limiter-before-lookup/write, unverified relogin denial, verified login lineage issuance, allowlisted `me` DTO, BFF-only/Order-zero evidence;
- `14-15-02`: only after the first task's HTTP evidence passes, elevate exactly signup/login/`GET /store/customers/me` in the approved manifests/middleware and keep raw Customer, aliases, native session/callback/MFA and browser-direct paths denied;
- `14-15-03`: **BLOCKING HUMAN VERIFY** — execution must stop here.

`14-16` and later plans are **NOT AUTHORIZED**. Deploy/release and real providers remain **NOT AUTHORIZED**. Frontend remains **BLOCKED**.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-14*
*Status: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED · 14-15 AUTHORIZED FOR EXECUTION*
