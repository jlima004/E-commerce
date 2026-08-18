---
phase: 14-customer-auth-verification
plan: 18
subsystem: auth
tags: [credential-reconciler, secretless, lease, cas, password-change, reset-delegation, exact-set, bff-service-guard, worker-only]
status: complete-awaiting-human-review
completed: 2026-08-17
requirements: [AUTH-03, AUTH-04, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-17 password-change protocol still DENY pending runtime elevation, 14-16 secretless reset reconciler, 14-09 backoff/lease/batch canonical
provides:
  - Generic secretless credential-operation reconciler for reset and password change
  - Reset job delegation of scan/claim/lease/CAS/backoff/alert primitives without relaxing 14-16
  - Worker-only Medusa job auth-credential-operation-reconcile on */2 * * * *
  - Final Phase 14 runtime exact-set elevating only POST /store/customers/me/password behind BFF
affects: [14-19, customer-auth, store-surface, auth-surface]

tech-stack:
  added: []
  patterns:
    - Secretless credential reconciliation is PostgreSQL-authoritative one-winner lease/CAS
    - Eligibility is OPERATION DUE AND LEASE CLAIMABLE, never the historical OR
    - Password Store publication happens only after disposable PostgreSQL reconciler PASS
    - Phase 14 published routes stay behind BFF service credential before handler

key-files:
  created:
    - apps/backend/src/jobs/auth-credential-operation-reconcile.ts
    - apps/backend/integration-tests/modules/auth-password-change-reconcile.postgres.spec.ts
    - .planning/phases/14-customer-auth-verification/14-18-SUMMARY.md
  modified:
    - apps/backend/src/jobs/auth-reset-reconcile.ts
    - apps/backend/src/api/store-surface/manifest.ts
    - apps/backend/src/api/middlewares.ts
    - apps/backend/medusa-config.ts
    - apps/backend/src/modules/customer-auth/bff-service-auth.ts
    - apps/backend/src/modules/customer-auth/__tests__/bff-service-auth.unit.spec.ts
    - apps/backend/integration-tests/http/auth-password-change.spec.ts
    - apps/backend/integration-tests/http/auth-verification.spec.ts
    - apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
    - apps/backend/src/modules/customer-auth/password-change.ts

key-decisions:
  - "Generic reconciler covers reset and password_change; reset keeps its domain function via operationTypes: ['reset']."
  - "Password-change generic path lives in the job file; password-change.ts / reset.ts / service.ts were not weakened."
  - "Max attempts 6 comes from the 14-09 canonical; exhaustion stays fail-closed without inventing dead_letter on credential status."
  - "POST /store/customers/me/password is BFF-only; the handler owns stable-or-resume and must not inherit the stable-only access guard."
  - "authMethodsPerActor.customer = ['emailpass'] is defense-in-depth; surface guard + BFF remain authorities."
  - "API Docs, schema/migrations, STATE.md and ROADMAP.md were not modified."
  - "Human-review remediação B14-18-HR-01: password-change version bump persists revocation_pending, not credential_updated."
  - "Human-review remediação B14-18-HR-02: medusa-config unit exact-set includes ./src/modules/customer-auth/service once."
---

# Phase 14: Customer Auth Verification — Plan 18 Summary

Secretless PostgreSQL-authoritative credential-operation reconciliation with one-winner lease/CAS, reset primitive delegation, worker-only job, and final Phase 14 runtime elevation of only `POST /store/customers/me/password` behind the BFF service guard.

## Governance status — AWAITING HUMAN RE-REVIEW

```text
B14-18-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
B14-18-HR-02: REMEDIATED — AWAITING HUMAN RE-REVIEW

14-18-01: EXECUTED — AWAITING HUMAN RE-REVIEW
14-18-02: EXECUTED — AWAITING HUMAN RE-REVIEW
14-18-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
14-18: NOT YET HUMAN APPROVED

14-19..14-21: NOT AUTHORIZED
API DOCS: UNCHANGED
PUSH: NONE
DEPLOY: NONE
REAL PROVIDERS: NONE
REMOTE DB/REDIS: NONE
```

This execution stops at checkpoint `14-18-03`. `14-19` was not started. STATE.md and ROADMAP.md were not updated. This summary does **not** declare HUMAN APPROVED.

AUTH-03 / AUTH-04 / AUTH-05 / AUTH-09 are **not globally closed** by this plan.

## Task commits

1. **Task 14-18-01 proofs** — `8e01452d05d9fbe8e53ef74b9603f4010ef8ab5c` `test(14-18): add credential-operation reconciliation postgres proofs`
2. **Task 14-18-01 reconciler + job** — `fd0e74a6d20c26951992d934f84e250cac475c95` `feat(14-18): implement secretless credential-operation reconciler`
3. **Task 14-18-01 reset delegation** — `f098b252f16d07977a2fa6a00ca29cb538afba5e` `refactor(14-18): delegate reset reconciliation primitives`
4. **Task 14-18-02 runtime exact-set** — `58ea8be48a45a582410ca260b5e748257b7f93b7` `feat(14-18): close phase-14 runtime exact-set`
5. **Task 14-18-02 surface proofs** — `2fe8bc6b4bf3c17c5a033d46b5dfe8bfb92195ac` `test(14-18): prove final auth store and bff surfaces`
6. **Plan metadata** — this file, `docs(14-18): record execution evidence`

## Files created / modified

Created:

- `apps/backend/src/jobs/auth-credential-operation-reconcile.ts` — generic secretless scanner, claim/lease/CAS/backoff, worker-only Medusa job
- `apps/backend/integration-tests/modules/auth-password-change-reconcile.postgres.spec.ts` — disposable PostgreSQL matrix and runtime exact-set proofs

Modified:

- `apps/backend/src/jobs/auth-reset-reconcile.ts` — delegates common primitives with `operationTypes: ["reset"]`
- `apps/backend/src/api/store-surface/manifest.ts` — elevates only `POST /store/customers/me/password`
- `apps/backend/src/api/middlewares.ts` — password path remains BFF-only (stable-or-resume stays in the handler)
- `apps/backend/medusa-config.ts` — `authMethodsPerActor.customer = ["emailpass"]`; `workerMode` still from `env.WORKER_MODE`
- `apps/backend/src/modules/customer-auth/bff-service-auth.ts` — password path enters the BFF protected exact-set
- predecessor exact-set tests listed above

Modified during human-review remediação:

- `apps/backend/src/modules/customer-auth/password-change.ts` — version bump persists `revocation_pending`

Unchanged on purpose:

- `apps/backend/src/api/auth-surface/manifest.ts` — Auth enabled-set already complete after 14-16
- `apps/backend/src/modules/customer-auth/reset.ts`
- `apps/backend/src/modules/customer-auth/service.ts`
- OpenAPI / API Docs / generated JSON / Zod docs kit
- schema / migrations / package.json / lockfile / env

## Generic reconciler architecture

The generic job scans `auth_credential_state` for `password_change` and, via reset delegation, `reset`.

Due statuses:

```text
claimed
provider_outcome_ambiguous
credential_proved
revocation_pending
```

Eligibility is **AND**, never the historical OR bug:

```text
attempt_count < 6
AND (lease_until IS NULL OR lease_until <= now)
AND (next_retry_at IS NULL OR next_retry_at <= now)
```

Bindings:

| Binding | Value |
|---|---|
| batch size | 25 |
| lease | 2 minutes (`120_000` ms) |
| claim owner | unique `lease_owner` |
| CAS | `operation_version` + expected status + still-claimable lease/retry predicates |
| backoff | `1m → 5m → 30m → 2h → 6h → 12h` |
| max attempts | 6 (14-09 canonical; 12h is the last nominal slot, unused after exhaustion) |

One worker wins. The loser receives zero-row/lost CAS, does not overwrite owner, does not renew the winner lease, does not run a concurrent transition, and does not duplicate revoke/alert ownership.

Reclaim is allowed only at `lease_until <= now`. A restarted worker converges from persisted PostgreSQL state, not memory.

Exhaustion at 6 attempts stays fail-closed on the credential row (no invented `dead_letter` credential status). Sanitized logger alert only.

## Secretless MAY / MUST NOT

MAY:

- scan due operations
- claim / renew / relinquish lease
- CAS/version transitions that the plan allows
- backoff and retry scheduling
- idempotent global revoke when authoritative proof is already persisted
- persist `credential_proved → revocation_committed` only when `provider_proved_at` **and** `credential_updated_at` already exist
- emit allowlisted sanitized alerts (`credential_id`, `operation_type`, `reason_code`, `attempt_count`, `exhausted`)

MUST NOT:

- call `verifyPassword` / `updatePassword` / authenticate emailpass
- invent provider proof or `credential_updated_at`
- promote ambiguous to proved without already-persisted proof
- complete reset or password change
- mint session / JWT / refresh
- return success to a user

Proof absent: claim/lease/alert only. Proof present with update marker: revoke + optional `revocation_committed`. Completion remains exclusive to the same-key request that re-presents the secret.

## Reset delegation

`auth-reset-reconcile.ts` calls the generic runner with `operationTypes: ["reset"]`, which still executes `reconcileSecretlessPasswordReset()` from `reset.ts`.

Preserved 14-16 rules:

- latest-wins
- hash-only capability
- same-key recovery
- re-presented `newPassword` required for provider proof
- secretless reconciler does not verify/update password
- intent/token completion cannot be fabricated
- unverified remains unverified
- zero session

The generic abstraction did not require relaxing reset.

## Password-change 14-17 invariants preserved

The reconciler does not replace resume-only request completion. 14-17 remains binding:

- `currentPassword` proof before claim
- wrong-current zero-write
- originating-lineage/SID HMAC v2
- sibling lineage DENY
- same-key recovery only
- re-presented `newPassword`
- fresh `update → verify`; resume `verify → optional one update → verify`
- no substitute session
- monotonic `credential_version`
- global revoke before 204

## Worker-only job

```text
name:     auth-credential-operation-reconcile
schedule: */2 * * * *
handler:  worker-only (WORKER_MODE === "worker")
discovery: Medusa auto-discovery (export const config + default export)
```

If `workerMode !== "worker"` or release-migration mode, the handler returns without scanning. No new env. No manual registry. Reset job keeps `auth-reset-reconcile` / `*/2 * * * *`.

Cadence matches the 2-minute lease, same canonical as `auth-reset-reconcile`.

## 14-18-02 runtime elevation

Executed only after the focused and full disposable-PostgreSQL suites of this plan passed.

The only new published operation is:

```text
POST /store/customers/me/password
```

Middleware order:

```text
Native CORS/publishable defense-in-depth
→ Store/Auth surface exact-set guard
→ BFF service guard
→ password-change stable-or-resume (handler)
→ handler
```

The password path is **not** mounted on the generic stable-only `customerAuthAccessGuardMiddleware`. Missing/invalid BFF credential returns generic `404 Not Found` before the handler. Valid BFF credential reaches the handler guards.

Config defense-in-depth:

```text
projectConfig.http.authMethodsPerActor = { customer: ["emailpass"] }
projectConfig.workerMode = env.WORKER_MODE
```

Surface guard + BFF remain the authorities. No new env. No real provider.

## Final exact-sets

AUTH enabled:

```text
POST /auth/customer/emailpass/register
POST /auth/customer/emailpass
POST /auth/token/refresh
POST /auth/customer/emailpass/revoke-current-lineage
POST /auth/customer/emailpass/reset-password
POST /auth/customer/emailpass/update
```

STORE enabled:

```text
GET /store/customers/me
POST /store/customers/me/verify
POST /store/customers/verify/resend
POST /store/customers/verify
GET /store/customers/me/verify/status
POST /store/customers/me/password
```

BFF protected (12):

```text
POST /auth/customer/emailpass/register
POST /auth/customer/emailpass
POST /auth/token/refresh
POST /auth/customer/emailpass/revoke-current-lineage
GET /store/customers/me
POST /store/customers/me/verify
POST /store/customers/verify/resend
POST /store/customers/verify
GET /store/customers/me/verify/status
POST /auth/customer/emailpass/reset-password
POST /auth/customer/emailpass/update
POST /store/customers/me/password
```

Remains DENY, including:

- `POST /store/customers`
- raw Customer aliases
- `/auth/session`
- native auth session primitives, callbacks, MFA
- native verification / refresh / reset aliases
- trailing-slash / case / method / provider-actor variants
- no wildcard, no prefix authorization

## Validation results

```text
Focused PostgreSQL (claim|lease|reclaim|secretless|reset):
  PASS — 14/14 (3 elevation tests skipped by name filter) + cleanup

Full auth-password-change-reconcile.postgres.spec.ts:
  PASS — 17/17 + cleanup

reset.unit.spec.ts:                              PASS — 13/13
auth-reset.postgres.spec.ts:                     PASS — 6/6 + cleanup
auth-reset.spec.ts:                              PASS — 19/19
auth-password-change.spec.ts:                    PASS — 33/33
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10 + cleanup
BFF service auth unit:                           PASS
combined focused Phase 14 HTTP:                  PASS — 103/103
Backend build:                                   PASS
Direct ESLint on touched production/unit files:  PASS — 0 errors
  (integration-test paths ignored by ESLint config; documented as warnings)
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
Real providers:                                  NONE
```

Repository lint wrapper:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No tooling change was made to mask it.

Stale Phase 13 / 14-02 inventory unit tests that still expect zero `M1_ENABLED` / all-Auth DENY were not rewritten. They are outside this plan's authorized production files and are not the Phase 14 cumulative exact-set authority. Cumulative exact-set authority for 14-18 is the Store/Auth/BFF manifests plus the predecessor suites listed above.

## 14-18-03 human verify matrix

Please confirm:

1. Scan/claim/lease/CAS/backoff are PostgreSQL-authoritative and one-winner.
2. Secretless job never calls the password provider and never completes reset or password change.
3. Reset delegation preserves 14-16 prohibitions.
4. Job is worker-only (`auth-credential-operation-reconcile`, `*/2 * * * *`).
5. Password Store path was elevated only after PostgreSQL PASS.
6. Final Store/Auth/BFF exact-sets match the matrices above.
7. BFF deny-before-handler holds; native/raw/alias remain DENY.
8. API Docs / schema / migrations / STATE.md / ROADMAP.md / 14-19 remain untouched.

## Deviations from Plan

None that changed architecture. Narrow authorized BFF amendment added `POST /store/customers/me/password` to `CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS` so publication cannot open browser-direct Medusa. Header/secret/algorithm/policy/error envelopes/runtime env were not changed.

`apps/backend/src/api/auth-surface/manifest.ts` needed no edit: the Auth enabled-set was already the final six operations.

Alerts use sanitized `logger.warn` with allowlisted keys, matching 14-16, because adding an operational-alert type would require a forbidden migration.

## Issues Encountered

Focused PostgreSQL initially selected an elevation test whose name contained `secretless`. Those tests were renamed so the 14-18-01 name filter stays reconciler-only. Middleware `method` is not a reliable `defineMiddlewares` field; mount proofs assert matcher + BFF-only middleware list.

## User Setup Required

None — no external service configuration required.

## Human-review remediation

```text
B14-18-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
B14-18-HR-02: REMEDIATED — AWAITING HUMAN RE-REVIEW
```

This section does **not** declare HUMAN APPROVED. STATE.md and ROADMAP.md were not updated. `14-19` was not started.

### B14-18-HR-01 — post-bump crash state is now reconciler-due

Cause: the 14-17 request path persisted version bump as `operation_status = credential_updated`. That status is outside the closed 14-18 due-set (`claimed | provider_outcome_ambiguous | credential_proved | revocation_pending`). A crash after bump and before global revoke left lineages active and the operation non-stable indefinitely.

Authorized state-machine alignment (no due-set expansion, no schema/migration):

```text
credential_proved → revocation_pending → revocation_committed
```

The version-bump primitive now preserves provider proof, writes `credential_updated_at`, increments `credential_version` exactly once, and transitions to `revocation_pending`. Preconditions remain fail-closed (password_change, credential_proved, current-password and provider proof present, update/revoke/completion markers absent). Double bump remains impossible.

Crash path now:

```text
credential_proved
→ version bump
→ revocation_pending
→ PROCESS CRASH
→ worker finds revocation_pending (due-set unchanged)
→ claim/lease/CAS after lease expiry
→ idempotent global revoke
→ revocation_committed
→ completed_at stays null / not stable
→ same-key request remains the only completion authority
```

Request recovery:

- `revocation_pending` with both proof markers skips provider verify/update and does not bump `credential_version` again; it only revokes and can complete.
- `revocation_committed` (worker already progressed) skips provider and bump; same-key request finalizes to `stable` and remains the only success path.
- no substitute session/JWT/refresh is minted.

PostgreSQL evidence used the real request state machine (`before_global_revoke` crash), not a seeded `credential_proved + credential_updated_at` row as the principal crash proof. After process restart with a new database adapter, `runAuthCredentialOperationReconcile()` acquired a lease/CAS, called zero provider, did not increment `credential_version` again, revoked all lineages and refresh credentials, persisted `revocation_committed`, left `completed_at` null, did not stabilize, and created no JWT/session/refresh.

Convergence: request produced `revocation_pending` → worker produced `revocation_committed` → same-key originating-lineage request completed to `stable` per the approved marker-clearing contract, with no second provider update/verify, no second credential-version bump, and no substitute session.

The `before_global_revoke` fault now leaves precisely `revocation_pending`, `credential_version = old + 1`, `credential_updated_at != null`, lineages/refresh still active. Secretless due-set was not widened to `credential_updated`. Reconciler source was not modified.

### B14-18-HR-02 — medusa-config unit exact-set

Cause: `medusa-config.ts` already registers `{ key: "customer_auth", resolve: "./src/modules/customer-auth/service" }`, but `expectedLocalModules` omitted that resolve path and then demanded exact equality.

Correction: added exactly `"./src/modules/customer-auth/service"` in the factual `medusa-config.ts` order (after `store-resource-version`, before `payment-attempt`). Exact-set character preserved (no `arrayContaining`, no cardinality relax). `medusa-config.ts` was not changed.

Proof: customer-auth resolve appears exactly once; Redis modules remain four; `workerMode` remains env-factual; `authMethodsPerActor` remains `{ customer: ["emailpass"] }`; repeated config load remains deterministic. Focused unit PASS — 8/8.

### Stale Phase 13 / 14-02 inventory tests (not edited)

Identified, not rewritten (outside authorized remediação files):

| File | Stale assertion |
|---|---|
| `apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts` | Phase 13 FND-01: `m1EnabledPolicy === 0`, all `m1_enablement` disabled, no `M1_ENABLED`, `DENY+PRESERVE_LEGACY = 58` |
| `apps/backend/src/api/store-surface/__tests__/guard.unit.spec.ts` | `counts.m1EnabledPolicy === 0`; EXTENDED/OUTSIDE_FRONTEND_M1 must not be `M1_ENABLED` |
| `apps/backend/src/api/auth-surface/__tests__/guard.unit.spec.ts` | 14-02 snapshot: `"mantem as 24 entradas em DENY neste plano"` |
| `apps/backend/integration-tests/http/store-surface-lockdown.spec.ts` | `"keeps classification distribution and zero M1_ENABLED at enforcement time"` |

These are **not** part of the current 14-18 gate:

- 14-VALIDATION focused HTTP ledger does not include `store-surface-lockdown.spec.ts`.
- Combined Phase 14 HTTP authority is `auth-reset` + `auth-customer` + `auth-verification` + `auth-password-change` (105/105 after this remediação).
- Official unit commands remain `--runTestsByPath` (customer-auth / medusa-config / BFF), not an unfiltered `npm run test:unit`.
- CI `api-docs.yml` also uses path-filtered unit.

Cumulative exact-set authority remains the Store/Auth/BFF manifests plus the predecessor suites listed in Validation results. No skip/hide was applied.

### Remediation validation

```text
Focused PostgreSQL (revocation_pending|post-bump|crash|restart|reconcile|completion):
  PASS — 19/19 + cleanup
  (describe name contains "reconcile", so the filter also selected the existing 14-18 matrix;
   the two new post-bump tests passed inside that run)

Full auth-password-change-reconcile.postgres.spec.ts:
  PASS — 19/19 + cleanup

Focused password-change HTTP (version|revoke|fault|resume|recovery):
  PASS — 25/25 (10 skipped by name filter)

auth-password-change.spec.ts:                    PASS — 35/35
reset.unit.spec.ts:                              PASS — 13/13
auth-reset.postgres.spec.ts:                     PASS — 6/6 + cleanup
auth-reset.spec.ts:                              PASS — 19/19
auth-customer.spec.ts:                           PASS — 36/36
auth-verification.spec.ts:                       PASS — 15/15
auth-multiprocess.spec.ts (disposable PG):       PASS — 10/10 + cleanup
BFF service auth unit:                           PASS — 10/10
medusa-config.unit.spec.ts:                      PASS — 8/8
combined focused Phase 14 HTTP:                  PASS — 105/105
Backend build:                                   PASS
Direct ESLint on password-change.ts:             PASS — 0 errors
Direct ESLint on unit/integration specs:         ignored by ESLint config (warnings only)
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
Real providers:                                  NONE
```

Repository lint wrapper:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No tooling change was made to mask it.

## Next

`14-18-03` is **BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW**. Do not start `14-19` (API Docs) without explicit human PASS. Do not push, deploy, or use real providers / remote DB / Redis.

---
*Phase: 14-customer-auth-verification*
*Completed: 2026-08-17*
*Remediated: 2026-08-18*
*Status: AWAITING HUMAN RE-REVIEW — not HUMAN APPROVED*
