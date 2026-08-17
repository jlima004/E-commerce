---
phase: 14-customer-auth-verification
plan: 16
subsystem: auth
tags: [password-reset, latest-wins, idempotency, bff-service-guard, rate-limit, timing, anti-enumeration]
status: complete-awaiting-human-review
completed: 2026-08-17
requirements: [AUTH-04, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-08 reset-confirm limiter/timing, 14-03 recovery fields, 14-15 BFF service guard exact-set
provides:
  - Composed password reset with latest-wins request, in-memory newPassword proof, fail-closed ambiguous recovery
  - Secretless reconciler that cannot complete password update
  - Guarded BFF→Medusa reset request/confirm HTTP contracts
affects: [14-17, customer-auth, auth-surface]
---

# Phase 14: Customer Auth Verification — Plan 16 Summary

`14-16` is **EXECUTED — AWAITING HUMAN REVIEW**. It is **not** human-approved.

Authorization ended at `14-16-03`. `14-17` was not started.

## Governance status

```text
14-16-01: EXECUTED — AWAITING HUMAN REVIEW
14-16-02: EXECUTED — AWAITING HUMAN REVIEW
14-16-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW
14-16: NOT YET HUMAN APPROVED

14-17: NOT AUTHORIZED
PUSH: NONE
DEPLOY: NONE
REAL PROVIDERS: NONE
REMOTE DB/REDIS: NONE
```

AUTH-04 / AUTH-05 / AUTH-09 remain **not globally closed**. Later Phase 14 plans remain required.

## Task commits

1. **Task 14-16-01** — `5a742b3` — `feat(14-16): implement composed password reset recovery`
2. **Task 14-16-02** — `6c6510f` — `feat(14-16): expose guarded reset request and confirm contracts`
3. **Task 14-16-03** — this file — `docs(14-16): record execution evidence`

Local only. No push, PR, merge or deploy.

## Files created/modified

Created:

- `apps/backend/src/modules/customer-auth/reset.ts` — request/confirm/retry domain, hash-only capability, composed complete
- `apps/backend/src/jobs/auth-reset-reconcile.ts` — secretless lease/revoke/alert job
- `apps/backend/src/modules/customer-auth/__tests__/reset.unit.spec.ts` — unit proofs
- `apps/backend/integration-tests/modules/auth-reset.postgres.spec.ts` — disposable PostgreSQL proofs
- `apps/backend/src/api/auth/customer/emailpass/reset-password/route.ts` — public reset request override
- `apps/backend/src/api/auth/customer/emailpass/update/route.ts` — composed reset confirm override
- `apps/backend/integration-tests/http/auth-reset.spec.ts` — HTTP, timing, BFF boundary proofs
- `.planning/phases/14-customer-auth-verification/14-16-SUMMARY.md` — this evidence

Modified:

- `apps/backend/src/api/auth-surface/manifest.ts` — elevate the two custom reset locals to `PHASE14_ENABLED`
- `apps/backend/src/modules/customer-auth/bff-service-auth.ts` — add only those two paths to the BFF exact-set
- `apps/backend/src/modules/customer-auth/__tests__/bff-service-auth.unit.spec.ts` — exact-set proof
- `apps/backend/integration-tests/http/auth-customer.spec.ts` — cumulative enabled-local exact-set
- `apps/backend/integration-tests/http/auth-multiprocess.spec.ts` — cumulative enabled-local exact-set
- `apps/backend/integration-tests/modules/auth-reset.postgres.spec.ts` — custom reset entries are `PHASE14_ENABLED` after elevation

Not modified (existing contracts already sufficient):

- `apps/backend/src/modules/customer-auth/access-guard.ts` — login/refresh/access already fail-closed unless `operation_status === "stable"`
- `apps/backend/src/modules/customer-auth/security/timing.ts` — thresholds unchanged
- `apps/backend/src/api/middlewares.ts` — BFF matchers still derived from the exact-set; reset paths get BFF-only (no customer access guard)

## State machine

Intent statuses: `pending` → `claimed` → `credential_updated` → `revocation_committed` → `completed`, with `superseded` / `expired` / `failed_reconcilable` exits.

Credential operation fields stay on `AuthCredentialState` (no eighth table). After a composed complete, credential returns to `stable` with operation markers cleared so login/refresh/access can proceed; the intent remains `completed`.

## Latest-wins

- TTL 15 minutes; one active pending/claimed intent per identity.
- A new eligible request supersedes a pending generation and creates N+1.
- In-flight (`claimed|credential_updated|revocation_committed|failed_reconcilable`) blocks a new request while still returning the uniform public accept envelope.
- Capability is hash-only. No password, password fingerprint or plaintext capability is persisted.

## Provider proof

After `updateProvider`, the same in-memory `newPassword` is verified read-only. Only that positive verification is `provider_password_proof`. Success is emitted only after:

1. credential password proof
2. `credential_version` increment (monotonic)
3. revoke of **all** lineages
4. token consumed
5. intent `completed`

## Ambiguous path

Provider timeout/ambiguous does **not** set `credential_updated_at`. Identity stays fail-closed (`provider_outcome_ambiguous` / `failed_reconcilable`). HTTP maps that correlated same-key state to `503 AUTH_RECOVERY_PENDING` (no `Retry-After: 60`).

`AUTH_RECOVERY_PENDING` is never used for Redis outage, invalid/unknown token, missing intent or malformed input.

## Secretless reconciler limits

MAY: claim/renew lease, complete non-secret DB transitions, repeat revoke if `credential_updated_at` is already set, emit a sanitized alert.

MUST NOT: password verify/update, infer provider result, mark password persisted / `credential_updated` / `completed`, consume token.

## Same-key retry

Only the same `Idempotency-Key` plus re-presented `newPassword` may resume. Retry verifies first; a match is proof. A mismatch may perform one update for that retry, then must verify. Another timeout remains recovery pending. A different Idempotency-Key is `RESET_INVALID_OR_EXPIRED` and cannot assume the operation.

## HTTP contracts

`POST /auth/customer/emailpass/reset-password`

- Body `{email}`
- Known / unknown / limited / Redis outage / provider-delivery failure → uniform `202 {code:"REQUEST_ACCEPTED"}` with no distinguishable `Retry-After`
- Schema invalid → `400 INVALID_REQUEST`
- Only an eligible identity creates intent/outbox
- No session, no email verification, no account-existence leak

`POST /auth/customer/emailpass/update`

- Body `{token,newPassword}` + `Idempotency-Key`
- Before any lookup/claim/token/provider/write: 14-08 `reset-confirm` pre buckets `30/IP/15m` + `10/(IP,presented token)/15m`
- Legitimate intent → post `10/(IP,reset-intent)/15m`
- Malformed/missing/unknown → dummy post derived from the pre-digest
- Public matrix: `200 PASSWORD_RESET_COMPLETED` / `400 RESET_INVALID_OR_EXPIRED` / `429 RATE_LIMITED` / `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60` / `503 AUTH_RECOVERY_PENDING`

## BFF exact-set

Authorized 14-15 amendment applied only to add:

- `POST /auth/customer/emailpass/reset-password`
- `POST /auth/customer/emailpass/update`

Header `x-indicio-bff-auth` / env `CUSTOMER_AUTH_BFF_SERVICE_SECRET` unchanged. Missing/invalid credential → generic `404` before limiter, lookup, claim, provider or mutation. Correct secret starts the reset protocol.

Preserved enabled locals: register, login, refresh, revoke, plus Store verification/me. Native reset/update/session/callback/MFA remain `DENY`. No 14-17 password-change path was opened.

## Limiter / timing matrix

Unchanged `timing.ts`: floor 350 ms + CSPRNG jitter 0..50 ms. HTTP 40-sample public matrix: median delta ≤ 50 ms, p95 delta ≤ 75 ms. Equivalent classes share Redis increment count (pre 2 buckets + post 1), one dummy HMAC, one timing envelope and one HTTP response.

## Password sink-negative

`newPassword` is request-memory only. Proofs cover DB rows, logs, Redis keys/digests, errors, HTTP bodies and fixtures. No password fingerprint is stored.

## Invariants preserved

- Reset unverified stays unverified (`email_verified_at` untouched)
- Reset never creates a session / JWT / refresh
- Reset never verifies email
- Old lineages are revoked before completed success
- PostgreSQL remains validity authority
- Zero Order / Payment / Stripe / Gelato / cart / checkout / fulfillment side effects
- Zero real Resend / real emailpass mutation in this execution (HTTP provider is injected; PG tests use a recording provider)

## Validation

```text
reset.unit.spec.ts:                              PASS — 11/11
auth-reset.postgres.spec.ts (disposable PG):     PASS — 5/5 + container cleanup
auth-reset.spec.ts:                              PASS — 18/18
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10
BFF service auth unit:                           PASS — 10/10
Backend build:                                   PASS
Direct ESLint on touched source:                 PASS — 0 errors
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
```

Known Medusa ESLint warnings on the new routes (generic `Error` instead of `MedusaError`; Zod import source on confirm) match the existing login/register/verify handlers. They were not treated as errors.

Repository lint wrapper:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No package/tooling change was made to mask it.

Local `ecommerce-redis` was already running and was left healthy. Disposable `p12-pg-*` containers from this plan were removed after each run.

## Deviations from plan

1. **BFF exact-set files** — PLAN 14-16 was written before 14-15 remediation. Execution used the user-authorized amendment to add only the two 14-16 paths to `bff-service-auth.ts` plus predecessor exact-set tests. Algorithm/header/secret/policy were not changed. No 14-17 route was added.
2. **`access-guard.ts` not edited** — existing `operation_status === "stable"` fail-closed already covers login/refresh/authenticated access during non-stable credential recovery.
3. **Credential returns to `stable` after composed complete** — required by the already-approved access/login/refresh predicate; intent stays `completed`.
4. **Missing `AuthResetDatabase` type import in the unit spec** — build-only TypeScript hole; added so `medusa build` compiles the spec that lives under `src/`.

No extra migration, schema, dependency, remote provider or 14-17 password-change work.

## Human verify (14-16-03)

Present for review:

- 14-08 pre/post/dummy protocol on confirm
- Public matrix 200 / 400 / 429 / two distinct 503s
- Pre/post-call states, every timeout fail-closed
- Secretless reconciler limits
- Same-key re-presented password proof
- Composed completed predicate (proof + consume + global revoke)
- No-session and unverified-stays-unverified
- BFF deny-before-handler on the two new paths

Do **not** start 14-17 until this plan is human-approved.

## Next

Blocked on human review of 14-16. `STATE.md` and `ROADMAP.md` were not updated.
