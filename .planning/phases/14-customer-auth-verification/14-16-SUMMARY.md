---
phase: 14-customer-auth-verification
plan: 16
subsystem: auth
tags: [password-reset, latest-wins, idempotency, bff-service-guard, rate-limit, timing, anti-enumeration]
status: complete
completed: 2026-08-17
requirements: [AUTH-04, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-08 reset-confirm limiter/timing, 14-03 recovery fields, 14-15 BFF service guard exact-set
provides:
  - Composed password reset with latest-wins request, in-memory newPassword proof and fail-closed ambiguous recovery
  - Exclusive PostgreSQL recovery lease with secretless reconciler that cannot complete password update
  - Guarded BFF→Medusa reset request/confirm HTTP contracts
  - Exactly-once reset-request timing finalization

affects: [14-17, customer-auth, auth-surface]
---

# Phase 14: Customer Auth Verification — Plan 16 Summary

`14-16` is **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.

This closure supersedes the awaiting-re-review status recorded at the human-pushed execution/remediation head `c2c0ef43121d5f2d884951dffd5257e6aebf6ec5`. Detailed execution and remediation history remains preserved in Git history through that commit.

## Final governance status

```text
B14-16-HR-01: CLOSED — PASS
B14-16-HR-02: CLOSED — PASS
B14-16-HR-03: CLOSED — PASS

14-16-01: HUMAN APPROVED — PASS
14-16-02: HUMAN APPROVED — PASS
14-16-03: HUMAN APPROVED — PASS
14-16: HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

14-17: AUTHORIZED FOR EXECUTION / NOT STARTED
14-18..14-21: NOT AUTHORIZED

DEPLOY: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```

AUTH-04 / AUTH-05 / AUTH-09 are **not globally closed** by this plan. Later Phase 14 plans remain required.

## Accepted reset contracts

### Reset request

`POST /auth/customer/emailpass/reset-password`

- Body `{email}`.
- Known, unknown, limited, Redis outage and provider-delivery failure preserve the uniform public `202 {code:"REQUEST_ACCEPTED"}` envelope without distinguishable `Retry-After`.
- Invalid schema remains `400 INVALID_REQUEST`.
- Only an eligible identity creates an intent/outbox.
- Reset request never creates a session and never changes email-verification state.

### Reset confirm

`POST /auth/customer/emailpass/update`

- Body `{token,newPassword}` plus `Idempotency-Key`.
- The approved 14-08 `reset-confirm` protocol runs before protected work: `30/IP/15m + 10/(IP,presented token)/15m`, then `10/(IP,reset-intent)/15m` only after a legitimate intent; invalid/missing/unknown capability uses the dummy post path.
- Public matrix remains `200 PASSWORD_RESET_COMPLETED`, `400 RESET_INVALID_OR_EXPIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60`, or correlated `503 AUTH_RECOVERY_PENDING`.
- `AUTH_RECOVERY_PENDING` is reserved for the legitimate same-key ambiguous operation and is not used for malformed/unknown capability or Redis outage.

## Accepted domain invariants

- Reset intent is latest-wins with exact 15-minute TTL and hash-only capability persistence.
- A new eligible request supersedes an unclaimed pending generation; an in-flight recovery blocks a replacement while public request response remains uniform.
- `newPassword` remains request-memory only; no password fingerprint or plaintext capability is persisted.
- PostgreSQL remains auth/recovery validity authority.
- Unverified identities remain unverified after reset.
- Reset never issues a replacement session/JWT/refresh credential.
- Success requires provider proof, monotonic `credential_version` increment, global lineage/refresh revocation and consumed/completed reset intent before returning success.
- Different `Idempotency-Key` cannot assume an in-flight operation.

## Provider-proof protocol

Human review closed `B14-16-HR-01` by separating fresh execution from ambiguous recovery:

```text
fresh claim:
updatePassword(newPassword)
→ verifyPassword(the same in-memory newPassword)
→ provider proof

same-key recovery:
verifyPassword(re-presented newPassword)
→ if match: provider proof without repeating update
→ if mismatch: exactly one updatePassword
→ mandatory verifyPassword
→ provider proof only on match
```

The fresh path still performs an update even if the provider already accepts `newPassword`. A timeout/ambiguous provider result records no `credential_updated_at` proof and remains fail-closed/reconcilable.

## Exclusive recovery lease

Human review closed `B14-16-HR-02` by making reconciler ownership exclusive in PostgreSQL.

Candidate eligibility requires both:

```text
(lease_until IS NULL OR lease_until <= now)
AND
(next_retry_at IS NULL OR next_retry_at <= now)
```

Lease acquisition uses existing-row CAS predicates on `id`, `version`, expected status/operation status, `completed_at IS NULL` and a still-claimable lease. Intent and credential leases must both succeed in one transaction; loss of the second acquisition rolls back the first.

Accepted disposable-PostgreSQL concurrency proof demonstrates:

- exactly one winner when two reconcilers race for the same recovery;
- the loser cannot overwrite `lease_owner`, extend the winner's lease or increment ownership/attempt counters;
- a fresh lease remains blocked through `lease_until - 1 ms`;
- reclaim is allowed at the contract boundary `lease_until <= now`;
- no secretless reconciler verifies/updates a password or completes a recovery without provider proof.

No Redis distributed lock, migration or schema change was introduced.

## Secretless reconciler limits

The reconciler MAY claim/renew an eligible lease, complete non-secret DB transitions, repeat global revoke once `credential_updated_at` is already authoritative, and emit a sanitized operational warning.

It MUST NOT verify/update passwords, infer a provider result, manufacture provider proof, mark an unproved password update completed, consume the reset operation as completed, or restore ordinary access without the approved proof path.

## Exactly-once reset-request timing

Human review closed `B14-16-HR-03` by memoizing the timing Promise per request. A resolved or rejected timing primitive is invoked once; catch handling reuses the same Promise instead of starting a second timing envelope.

The approved floor/jitter implementation in `timing.ts` was not changed: 350 ms floor with CSPRNG jitter 0..50 ms.

## BFF service boundary

The 14-15 architecture carry-forward remains binding. Both newly enabled reset contracts are protected by the exact BFF service operation set:

- `POST /auth/customer/emailpass/reset-password`
- `POST /auth/customer/emailpass/update`

Missing/invalid `x-indicio-bff-auth` is denied generically before limiter, lookup, claim, provider or mutation. Native reset/update remain DENY; no password-change route from 14-17 was published by this plan.

CORS/publishable remain defense-in-depth only and are not caller authorization.

## Human-review blockers closed

```text
B14-16-HR-01: CLOSED — PASS
  fresh update→verify is distinct from recovery verify→update→verify

B14-16-HR-02: CLOSED — PASS
  recovery lease is exclusive with AND eligibility + PostgreSQL CAS

B14-16-HR-03: CLOSED — PASS
  reset-request timing primitive is structurally invoked exactly once
```

## Final accepted evidence

```text
reset.unit.spec.ts:                              PASS — 13/13
auth-reset.postgres.spec.ts (disposable PG):     PASS — 6/6 + cleanup
  including concurrent exclusive-lease proof
auth-reset.spec.ts:                              PASS — 19/19
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10
BFF service auth unit:                           PASS — 10/10
combined focused Phase 14 HTTP:                  PASS — 70/70
Backend build:                                   PASS
Direct ESLint on touched source:                 PASS — 0 errors
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Local ecommerce-redis:                           HEALTHY
Remote infrastructure:                           NONE
```

Repository lint wrapper remains the previously classified tooling issue:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No package/tooling modification was made to mask it.

## Scope / deviations accepted

1. The original 14-16 plan predated the BFF service-boundary remediation in 14-15. The explicitly authorized scope amendment added only the two reset contracts to the BFF protected exact-set and predecessor exact-set tests; the BFF algorithm/header/secret policy was not redesigned.
2. `access-guard.ts` did not require an edit because the existing `operation_status === "stable"` rule already fails login/refresh/authenticated access closed during non-stable recovery.
3. After composed completion the credential returns to `stable` with operation markers cleared; the reset intent remains `completed` and old lineages are revoked.
4. Human-review lease remediation stayed inside existing reset-domain persistence fields; no migration/schema/dependency was needed.
5. No real provider, remote persistence, deploy, frontend or 14-17 password-change implementation occurred in 14-16.

## Commits before documentary closure

Initial execution:

1. `5a742b3` — `feat(14-16): implement composed password reset recovery`
2. `6c6510f` — `feat(14-16): expose guarded reset request and confirm contracts`
3. `220b38d` — `docs(14-16): record execution evidence`

Human-review remediation:

4. `ff76cfc` — `fix(14-16): separate fresh and recovery password proof`
5. `a4935ce` — `fix(14-16): make reset recovery lease exclusive`
6. `9e3bb69` — `fix(14-16): make reset request timing exactly once`
7. `c2c0ef4` — `docs(14-16): record human-review remediation`

Human-pushed execution/remediation head before this documentary closure:

`c2c0ef43121d5f2d884951dffd5257e6aebf6ec5`

## 14-17 authorization

By explicit human authorization, `14-17-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The authorization is limited to the approved plan:

- `14-17-01`: implement password-change domain with stable access + current-password proof before claim, same-key ambiguous resume and global lineage revoke;
- `14-17-02`: implement/prove the strict Store handler while the external password path remains DENY;
- `14-17-03`: **BLOCKING HUMAN VERIFY**; execution must stop there.

Binding restrictions:

- password change remains unpublished in the external Store manifest during 14-17;
- wrong current password is zero-write;
- ordinary access remains fail-closed after operation claim;
- ambiguous recovery can resume only through the same operation/key with `newPassword` re-presented;
- 204 cannot precede provider proof + credential-version bump + global lineage revoke;
- no substitute session may be minted;
- secretless code cannot complete password change;
- 14-18 and later are not authorized;
- deploy, real providers, remote infrastructure and frontend remain unauthorized.

## Next

`14-16` is documentally closed. The next permitted step is execution of `14-17-01` according to `14-17-PLAN.md`, proceeding serially through `14-17-02` only after prerequisite evidence and then stopping at `14-17-03` for blocking human review.
