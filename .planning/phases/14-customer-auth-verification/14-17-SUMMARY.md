---
phase: 14-customer-auth-verification
plan: 17
subsystem: auth
tags: [password-change, current-password-proof, resume-only, credential-version, global-revoke]
status: complete
completed: 2026-08-17
requirements: [AUTH-03, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-16 reset proof protocol, 14-11 PostgreSQL access guard, 14-08 password-change limiter policy, 14-03 AuthCredentialState operation fields
provides:
  - Password-change domain with current-password proof before claim and originating-lineage-bound ambiguous resume-only
  - Controlled Store handler for POST /store/customers/me/password, still externally DENY pending 14-18 runtime publication
  - HTTP/fault evidence for 204/400/401/429/503, global revoke and resume-only isolation
affects: [14-18, customer-auth, store-surface]
---

# Phase 14: Customer Auth Verification — Plan 17 Summary

`14-17` is **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.

This closure supersedes the awaiting-re-review status at human-pushed technical head `46d90ba4514e5e40ae0bf47aaae91b1df77689d3`. Detailed execution and remediation history remains preserved in Git history through that commit.

## Final governance status

```text
B14-17-HR-01: CLOSED — PASS

14-17-01: HUMAN APPROVED — PASS
14-17-02: HUMAN APPROVED — PASS
14-17-03: HUMAN APPROVED — PASS
14-17: HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

14-18: AUTHORIZED FOR EXECUTION / NOT STARTED
14-19..14-21: NOT AUTHORIZED

PASSWORD STORE SURFACE: DENY until 14-18 runtime-elevation gate passes
DEPLOY: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```

AUTH-03 / AUTH-05 / AUTH-09 are **not globally closed** by this plan. Later Phase 14 plans remain required.

## Accepted password-change contract

The human-approved implementation establishes:

- initial password change requires cryptographically valid customer access, PostgreSQL `stable` access state, strict `{ currentPassword, newPassword }`, and a valid `Idempotency-Key`;
- `currentPassword` is proved by the emailpass provider before operation claim;
- wrong current password returns `400 CURRENT_CREDENTIAL_INVALID` with zero claim/write/provider-update/version-bump/revoke/session side effects;
- fresh new-password proof is `updatePassword(newPassword) → verifyPassword(the same in-memory newPassword)`; update return alone is never authoritative proof;
- provider timeout/ambiguity returns `503 AUTH_RECOVERY_PENDING` and keeps ordinary login/refresh/access fail-closed;
- same-operation recovery requires the same `Idempotency-Key`, the originating lineage/SID and a re-presented `newPassword`;
- recovery is `verify → optional one update → mandatory verify`;
- `204` requires provider proof, monotonic credential-version bump and global lineage/refresh revoke;
- no substitute lineage/JWT/refresh is minted;
- verification state is preserved;
- current/new passwords remain request-memory only; no password fingerprint or password-derived capability is persisted;
- PostgreSQL remains validity authority; Redis coordinates only rate limiting;
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects.

## B14-17-HR-01 accepted remediation

Human review found that the original operation binding used only HMAC(`Idempotency-Key`), allowing a sibling lineage of the same identity/customer to recompute the same operation id.

The accepted remediation binds the existing `operation_id` cryptographically to the origin:

```text
HMAC(
  domain=customer-auth-password-change-operation|v2,
  Idempotency-Key,
  originating-lineage,
  originating-sid
)
```

No new persistence field, schema or migration was introduced.

Resume-only now:

1. validates the presented JWT cryptographically;
2. locates the lineage for that JWT `sid`;
3. validates identity/customer and in-flight password-change state;
4. recomputes the v2 operation id using the presented key plus that lineage/SID;
5. compares constant-time with the persisted operation id.

Accepted proofs:

- JWT-A + originating lineage/SID + same key → resume allowed;
- JWT-B from a sibling lineage of the same identity/customer + same key → DENY;
- different key → DENY;
- different identity/customer → DENY;
- after `after_revoke_before_response`, ordinary access of JWT-A remains DENY while JWT-A same-key resume-only may identify and finish only its own operation;
- JWT-B remains DENY after global revoke;
- me/verification/refresh/revoke do not gain resume-only authority;
- the generic access guard was not relaxed.

```text
B14-17-HR-01: CLOSED — PASS
```

## HTTP public matrix

| Outcome | Status / code |
|---|---|
| success | `204` empty body |
| wrong current password | `400 CURRENT_CREDENTIAL_INVALID` |
| invalid auth / bearer | `401 AUTHENTICATION_REQUIRED` |
| rate limited | `429 RATE_LIMITED` |
| Redis outage | `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60` before mutation |
| legitimate same-operation ambiguous recovery | `503 AUTH_RECOVERY_PENDING` |
| extra fields / invalid schema | `400 INVALID_REQUEST` |

Limiter remains `5 / lineage / hour` with opaque HMAC-derived Redis keys.

## Store/runtime state at 14-17 closure

`POST /store/customers/me/password` is implemented but remains **DENY** on the external Store surface at this closure.

```text
STORE_SURFACE_PHASE14_ENABLED_OPERATIONS: password path absent
CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS: password path absent
middleware runtime publication: absent
```

`14-18` owns the reconciler/job/runtime publication and may elevate the password path only after its required disposable-PostgreSQL reconciliation proof passes.

## Final accepted evidence

```text
Focused HTTP resume|lineage|fault:               PASS — 24/24
auth-password-change.spec.ts:                    PASS — 30/30
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-reset.spec.ts:                              PASS — 19/19
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10 + cleanup
BFF service auth unit:                           PASS — 10/10
combined focused Phase 14 HTTP:                  PASS — 100/100
Backend build:                                   PASS
Direct ESLint:                                   PASS — 0 errors
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
Real providers:                                  NONE
Repository lint wrapper:                         KNOWN TOOLING FAILURE — empty JSON / EOF
```

Human-pushed execution/remediation head before documentary closure:

`46d90ba4514e5e40ae0bf47aaae91b1df77689d3`

No migration/schema/dependency, provider real, remote persistence, deploy or frontend work was authorized by this closure.

## 14-18 authorization

By explicit human authorization, `14-18-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

Authorized sequence:

- `14-18-01`: implement and prove the generic secretless credential-operation reconciler, reset delegation and worker-only job using disposable PostgreSQL;
- `14-18-02`: only after the required PostgreSQL PASS, elevate exactly `POST /store/customers/me/password` and close the final Phase-14 runtime exact-set/config/middleware contract;
- `14-18-03`: **BLOCKING HUMAN VERIFY**; execution must stop there.

Binding restrictions:

- reconciler remains secretless and never calls password provider update/verify;
- ambiguous operations without authoritative provider proof never complete;
- authoritative proof may permit only the plan-defined idempotent revocation progression; request same-key with re-presented secret remains the completion authority;
- reset delegation must preserve all accepted reset prohibitions;
- claim/lease/CAS/backoff/reclaim are PostgreSQL-authoritative;
- job is worker-only and must not execute scanner work in server mode;
- password Store path may be elevated only after the required PostgreSQL reconciler proof passes;
- password change is the only new runtime elevation authorized in 14-18;
- raw customers, native session/callback/MFA/verification/refresh/reset aliases remain DENY;
- API Docs remain untouched in 14-18;
- `14-19..14-21` remain NOT AUTHORIZED;
- deploy, real providers, remote infrastructure and frontend remain unauthorized.

## Next

Execute `14-18-01` according to `14-18-PLAN.md`; proceed to `14-18-02` only after its prerequisite PostgreSQL evidence; stop at `14-18-03` for explicit human review.

Do not automatically start `14-19`.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-17*
*Completed: 2026-08-17*
*Human approval: PASS*
*Documentary closure: COMPLETE*
