---
phase: 14-customer-auth-verification
plan: 17
subsystem: auth
tags: [password-change, current-password-proof, resume-only, credential-version, global-revoke]
status: remediated-awaiting-human-re-review
completed: 2026-08-17
requirements: [AUTH-03, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-16 reset proof protocol, 14-11 PostgreSQL access guard, 14-08 password-change limiter policy, 14-03 AuthCredentialState operation fields
provides:
  - Password-change domain with current-password proof before claim and same-key ambiguous resume-only
  - Controlled Store handler for POST /store/customers/me/password that remains DENY on the external surface
  - HTTP/fault evidence for 204/400/401/429/503, global revoke and resume-only isolation
affects: [14-18, customer-auth, store-surface]
---

# Phase 14: Customer Auth Verification — Plan 17 Summary

`14-17` is **EXECUTED — AWAITING HUMAN RE-REVIEW**. It is **not** HUMAN APPROVED.

Password change now requires a stable customer session and current-password provider proof before the operation claim. Ambiguous provider outcomes stay fail-closed and can resume only with the same `Idempotency-Key`, the originating lineage/SID and a re-presented `newPassword`. Success returns `204` only after provider proof, a monotonic credential-version bump and global lineage/refresh revoke, without minting a substitute session. `POST /store/customers/me/password` remains DENY on the external Store surface.

## Final governance status

```text
B14-17-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW

14-17-01: EXECUTED — AWAITING HUMAN RE-REVIEW
14-17-02: EXECUTED — AWAITING HUMAN RE-REVIEW
14-17-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
14-17: NOT YET HUMAN APPROVED

14-18: NOT AUTHORIZED
PASSWORD STORE SURFACE: DENY
PUSH: NONE
DEPLOY: NONE
REAL PROVIDERS: NONE
REMOTE DB/REDIS: NONE
```

AUTH-03 / AUTH-05 / AUTH-09 are **not globally closed** by this plan. Later Phase 14 plans, especially 14-18, remain required for reconciler/runtime publication.

## Task commits

1. **Task 14-17-01 RED:** `5751073` — `test(14-17): add password-change fault and resume proofs`
2. **Task 14-17-01 GREEN:** `1fa27ab` — `feat(14-17): implement guarded password-change domain`
3. **Task 14-17-02:** `d2a2064` — `feat(14-17): add controlled password-change handler`
4. **Execution summary:** `1b013d4` — `docs(14-17): record execution evidence`

Human-review remediation:

5. `16d3fa5` — `test(14-17): prove originating-lineage resume binding`
6. `19b9513` — `fix(14-17): bind password-change operation to originating lineage`
7. **Remediation summary:** this commit — `docs(14-17): record human-review remediation`

## Human-review remediation

```text
B14-17-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
```

Cause: `operation_id` was derived from HMAC(`Idempotency-Key`) only. Two lineages of the same identity/customer could present the same key and satisfy resume-only.

Fix: bind the password-change operation id cryptographically to the originating lineage/SID, reusing the existing `operation_id` field. No schema/migration and no additional plaintext lineage/SID persistence.

```text
HMAC(
  domain=customer-auth-password-change-operation|v2,
  Idempotency-Key,
  originating-lineage,
  originating-sid
)
```

The same derivation is used on fresh claim and on resume-only. Resume-only:

1. validates the presented JWT cryptographically;
2. locates the lineage for that JWT `sid`, including a revoked lineage for this binding only;
3. validates identity/customer/operation type/status;
4. recomputes the operation id from the presented key and the looked-up originating lineage/SID;
5. compares constant-time with the persisted `operation_id`.

Proved:

- JWT-A + same `Idempotency-Key` resume: PASS
- JWT-B, same identity/customer, different SID, same key: DENY
- JWT-A + different key: DENY
- JWT-B + different key: DENY
- different identity/customer: DENY
- after `after_revoke_before_response` fault: ordinary JWT-A access DENY; JWT-A same-key resume-only still identifies and can finish this operation; JWT-B remains DENY; me/verification/refresh/revoke stay fail-closed
- Store password surface remains DENY
- zero runtime publication
- no substitute session; access-guard was not relaxed

This does not reauthorize a revoked lineage for any other handler.

## Files created/modified

Created:

- `apps/backend/src/modules/customer-auth/password-change.ts` — current-password proof, HMAC operation binding to originating lineage/SID, fresh `update→verify`, same-key `verify→optional update→verify`, version CAS, global revoke, resume-only guard
- `apps/backend/src/api/store/customers/me/password/route.ts` — strict controlled handler; not published in the Store manifest
- `apps/backend/integration-tests/http/auth-password-change.spec.ts` — domain/fault/resume and HTTP public-matrix proofs
- `.planning/phases/14-customer-auth-verification/14-17-SUMMARY.md` — this evidence record

No other production files were modified.

## Accepted password-change contracts

### Initial request

Requires all of:

1. cryptographically valid customer access token / session
2. PostgreSQL access guard in `stable` state
3. `currentPassword` proved by the provider **before** any operation claim
4. valid `Idempotency-Key`
5. strict body `{ currentPassword, newPassword }`

Wrong current password:

- public `400 CURRENT_CREDENTIAL_INVALID`
- zero operation claim
- zero credential mutation
- zero provider update
- zero version bump
- zero lineage revoke
- zero session

`currentPassword` and `newPassword` remain request-memory only. No password fingerprint or password-derived capability is persisted.

### Operation claim

Only after a positive current-password proof:

- bind `operation_id` by HMAC(`Idempotency-Key` + originating lineage/SID)
- record `current_password_verified_at`
- bind version-before as the current `credential_version` (target = before + 1 via CAS increment)
- transition `AuthCredentialState` to `operation_type=password_change`, `operation_status=claimed`

Ordinary login / refresh / authenticated access then fail closed because `operation_status !== "stable"`. PostgreSQL remains validity authority. Redis never grants auth validity.

No new table was required; approved `AuthCredentialState` fields were sufficient.

### Fresh new-password proof

```text
updatePassword(newPassword)
→ verifyPassword(the same in-memory newPassword)
→ provider proof
```

The provider `update` return is not treated as proof. Only a positive verify creates provider proof. After proof:

1. monotonic `credential_version` bump/CAS
2. revoke all lineages for the identity
3. revoke corresponding refresh credentials
4. mark the operation complete and restabilize
5. return `204`

`204` never precedes provider proof + credential-version bump + global revoke. No replacement lineage/JWT/refresh is issued.

### Ambiguous / timeout

If provider update/verify times out or is ambiguous:

- do not mark `credential_updated`
- do not invent provider proof
- do not complete
- keep the operation fail-closed
- ordinary access/login/refresh remain blocked
- return `503 AUTH_RECOVERY_PENDING`

No secretless routine can verify/update a password, infer a provider result, invent proof or complete the operation. This plan does not introduce a password-change reconciler.

### Resume-only guard

After claim the original token is blocked by non-stable state. Only this handler has a resume-only path, requiring all of:

- original JWT cryptographically valid
- same originating lineage/SID
- same identity
- same customer
- same operation
- same operation key hash
- same `Idempotency-Key`

Identity/customer alone are not the origin binding. A sibling lineage of the same identity with the same `Idempotency-Key` is denied. Resume-only cannot authorize `GET /store/customers/me`, verification, refresh, revoke, another password-change operation, or any other handler. A different `Idempotency-Key` is denied and cannot assume the existing operation.

After global revoke, ordinary access of the original JWT remains denied. Resume-only may look up that revoked lineage strictly to recompute and match the originating operation id; it does not reauthorize the lineage for any other handler.

### Same-key retry

Retry requires the same `Idempotency-Key` and a re-presented `newPassword`:

```text
verifyPassword(re-presented newPassword)
→ if match: missing proof, do not repeat update
→ if mismatch: exactly one updatePassword
→ mandatory verifyPassword
```

A new timeout/ambiguous result stays pending/fail-closed with `503`. The original current-password proof remains bound to the claimed operation.

## HTTP public matrix

| Outcome | Status / code |
|---|---|
| success | `204` empty body |
| wrong current password | `400 CURRENT_CREDENTIAL_INVALID` |
| invalid auth / bearer | `401 AUTHENTICATION_REQUIRED` |
| rate limited | `429 RATE_LIMITED` |
| Redis outage | `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60` before mutation |
| legitimate same-key ambiguous | `503 AUTH_RECOVERY_PENDING` |
| extra fields / invalid schema | `400 INVALID_REQUEST` |

Responses never echo `currentPassword`, `newPassword`, internal operation id, credential-version internals, lineage ids, provider state or raw Customer internals.

Limiter: `5 / lineage / hour` after the guard, using the approved opaque HMAC derivation. Redis keys contain no raw lineage, password, token, IP or raw identity.

## Store surface remains DENY

```text
POST /store/customers/me/password → external Store manifest DENY / UNKNOWN
STORE_SURFACE_PHASE14_ENABLED_OPERATIONS does not include the password path
CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS does not include the password path
```

The handler was tested by invoking the controlled boundary directly. Manifests, `middlewares.ts`, BFF exact-set, API Docs and `medusa-config` were not edited. Runtime publication remains owned by 14-18.

## Invariants preserved

- currentPassword proof before claim
- wrong-current = zero-write
- newPassword memory-only; no password fingerprint
- fresh proof = update→verify
- recovery same-key = verify→optional update→verify
- ambiguous = fail-closed
- `credential_version` monotonic
- global revoke before 204
- no substitute session
- unverified remains unverified; verified remains verified
- PostgreSQL validity authority; Redis coordination only
- Store path remains DENY
- BFF architecture not weakened
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects

## Evidence

```text
Focused HTTP resume|lineage|fault:               PASS — 24/24 (6 HTTP matrix/store tests skipped by name filter)
auth-password-change.spec.ts:                    PASS — 30/30
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-reset.spec.ts:                              PASS — 19/19
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10 + container cleanup
BFF service auth unit:                           PASS — 10/10
combined focused Phase 14 HTTP:                  PASS — 100/100
  (customer 36 + verification 15 + reset 19 + password-change 30)
Backend build:                                   PASS
Direct ESLint on touched files:                  PASS — 0 errors
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
Real providers:                                  NONE
```

Repository lint wrapper remains the previously classified tooling issue:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No package/tooling modification was made to mask it.

Known Medusa ESLint warnings on generic `Error` in the controlled handler were not converted into `MedusaError`; that matches existing Phase 14 auth handlers and was not an authorized policy change.

## Deviations from Plan

None - plan executed exactly as written.

Local helper `buildAuthenticatedPasswordChangeKeys` lives in the authorized handler file so `rate-limit.ts` did not need an export/amendment. Resume-only authorization lives in `password-change.ts` so `access-guard.ts` was not edited. Originating lineage/SID is passed from the handler into the domain and folded into the existing `operation_id` HMAC; no new persistence field was added.

## Issues Encountered

Completion proof/bump/revoke originally lived in one transaction, which rolled intermediate markers back when a fault hook threw. They were split into sequential committed transactions so the required fault matrix could observe proof-before-bump, bump-before-revoke and revoke-before-response without premature `204`.

`auth-multiprocess.spec.ts` requires the existing disposable PostgreSQL harness; it was not run against remote Postgres.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`14-18` remains **NOT AUTHORIZED**. Do not start reconciler/job/runtime publication, Store manifest elevation, BFF exact-set addition or middleware publication without explicit human approval of this plan.

Human review should confirm:

- current-password proof before claim and wrong-current zero-write
- originating-lineage cryptographic binding of `operation_id`
- JWT-A same-key resume-only; JWT-B same identity/customer same-key DENY
- different-key denial
- post-revoke original JWT resume-only still works; ordinary access remains DENY
- resume-only cannot open me/verification/refresh/revoke
- `204` only after proof + version bump + global revoke
- no substitute session; verification state preserved
- Store password path still DENY

## Self-Check: PASSED

- Key files exist on disk
- Commits `5751073`, `1fa27ab`, `d2a2064`, `1b013d4`, `16d3fa5`, `19b9513` are present
- Focused and full `auth-password-change.spec.ts` acceptance passed
- Predecessor HTTP, multiprocess disposable PG and BFF unit regressions passed
- Build, direct ESLint (0 errors) and `git diff --check` passed
- STATE.md and ROADMAP.md were not updated
- HUMAN APPROVED was not declared
- 14-18 was not started

---
*Phase: 14-customer-auth-verification*
*Plan: 14-17*
*Completed: 2026-08-17*
*Human approval: NOT DECLARED*
