---
phase: 14-customer-auth-verification
plan: 18
subsystem: auth
tags: [credential-reconciler, secretless, lease, cas, password-change, reset-delegation, exact-set, bff-service-guard, worker-only]
status: complete
completed: 2026-08-17
requirements: [AUTH-03, AUTH-04, AUTH-05, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-17 password-change protocol, 14-16 secretless reset reconciler, 14-09 backoff/lease/batch canonical
provides:
  - Generic secretless credential-operation reconciler for reset and password change
  - Reset job delegation of scan/claim/lease/CAS/backoff/alert primitives without relaxing 14-16
  - Worker-only Medusa job auth-credential-operation-reconcile on */2 * * * *
  - Final Phase 14 runtime exact-set elevating only POST /store/customers/me/password behind BFF
affects: [14-19, customer-auth, store-surface, auth-surface, api-docs]
---

# Phase 14: Customer Auth Verification — Plan 18 Summary

`14-18` is **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.

This closure supersedes the awaiting-human-re-review status at human-pushed technical/remediation head `13ecc46fe54e84bd393020d03857546281d297df`. Detailed execution and remediation history remains preserved in Git history through that commit.

## Final governance status

```text
B14-18-HR-01: CLOSED — PASS
B14-18-HR-02: CLOSED — PASS

14-18-01: HUMAN APPROVED — PASS
14-18-02: HUMAN APPROVED — PASS
14-18-03: HUMAN APPROVED — PASS
14-18: HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

14-19: AUTHORIZED FOR EXECUTION / NOT STARTED
14-20..14-21: NOT AUTHORIZED

DEPLOY: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```

AUTH-03 / AUTH-04 / AUTH-05 / AUTH-09 are **not globally closed** by this plan. Later Phase 14 plans remain required.

## Accepted credential-operation reconciler contract

The human-approved implementation establishes:

- generic reconciliation covers `password_change` and delegated reset work;
- PostgreSQL is the authority for due-state scan, one-winner lease/CAS, retry/backoff, reclaim and restart convergence;
- due states remain the closed set `claimed | provider_outcome_ambiguous | credential_proved | revocation_pending`;
- eligibility requires **OPERATION DUE AND LEASE CLAIMABLE**, never the historical OR;
- batch size is 25 and lease duration is 2 minutes;
- CAS uses `operation_version` plus expected status and still-claimable predicates;
- backoff remains `1m → 5m → 30m → 2h → 6h → 12h`, with max-attempt semantics inherited from the accepted 14-09 contract;
- concurrent workers converge to exactly one claimant; a loser cannot overwrite the winner lease or perform a concurrent transition;
- reclaim is allowed only at lease expiry;
- restart recovers from persisted PostgreSQL state, not process memory;
- exhaustion stays fail-closed and emits only sanitized allowlisted alert metadata.

The reconciler is strictly secretless. It does not possess or call with `currentPassword`, `newPassword`, reset capability plaintext or provider credential. It does not call password-provider verify/update, invent proof, fabricate `credential_updated_at`, complete reset/password change, stabilize an operation, return user success or mint JWT/session/refresh.

When authoritative provider proof and the credential-update marker already exist, secretless work may perform only the remaining idempotent global revoke and persist `revocation_committed`. Request-bound same-key recovery remains the completion authority.

## B14-18-HR-01 accepted remediation

Human review found a post-version-bump crash window: the request originally persisted `operation_status = credential_updated`, but that state was outside the closed reconciler due-set.

The accepted remediation aligns the real password-change state machine to the approved contract:

```text
credential_proved
→ revocation_pending
→ revocation_committed
→ same-key request stabilization
```

The version-bump primitive now atomically:

- preserves authoritative provider proof;
- writes `credential_updated_at`;
- increments `credential_version` exactly once;
- transitions to `revocation_pending`.

A crash after the bump and before global revoke now leaves a real reconciler-due state. Disposable-PostgreSQL proof executed the actual password-change state machine, injected the crash at `before_global_revoke`, restarted through a new adapter and proved:

- `revocation_pending` is reclaimed only when claimable;
- zero additional provider calls;
- no second credential-version bump;
- all lineages and refresh credentials are revoked idempotently;
- worker persists `revocation_committed`;
- `completed_at` remains null and the worker does not stabilize;
- the same-key originating-lineage request subsequently completes without another provider update/verify or version bump.

```text
B14-18-HR-01: CLOSED — PASS
```

## B14-18-HR-02 accepted remediation

Human review found that `medusa-config.unit.spec.ts` used an exact local-module inventory that omitted the already-registered customer-auth module.

The accepted correction keeps the assertion exact and adds exactly:

```text
./src/modules/customer-auth/service
```

in the factual runtime order. `medusa-config.ts` itself was not changed by the remediation.

Accepted proof confirms:

- customer-auth local resolve exactly once;
- four Redis modules preserved;
- `workerMode` remains env-factual;
- `authMethodsPerActor = { customer: ["emailpass"] }` remains unchanged;
- repeated config load remains deterministic.

```text
B14-18-HR-02: CLOSED — PASS
```

## Reset delegation accepted

`auth-reset-reconcile.ts` delegates common scan/claim/lease/CAS/backoff/alert primitives through the generic runner while preserving reset-specific domain authority.

Accepted 14-16 invariants remain intact:

- latest-wins;
- hash-only capability;
- same-key recovery;
- re-presented `newPassword` required for provider proof;
- secretless worker never verifies or updates password;
- intent/token completion cannot be fabricated;
- unverified remains unverified;
- no substitute session.

## Worker-only job accepted

```text
name: auth-credential-operation-reconcile
schedule: */2 * * * *
mode: WORKER_MODE === "worker"
discovery: Medusa auto-discovery
```

Server/web mode and release-migration mode do not execute scanner work. No new env or manual job registry was introduced.

## Final Phase 14 runtime surface

`14-18-02` elevated exactly one new Store operation after the required disposable-PostgreSQL reconciler PASS:

```text
POST /store/customers/me/password
```

It remains protected by the approved order:

```text
Native CORS/publishable defense-in-depth
→ Store/Auth exact surface guard
→ BFF service guard
→ password-change stable-or-resume handler authority
→ handler
```

The password path intentionally does not inherit the generic stable-only customer access middleware because the handler owns the strictly bounded same-operation resume protocol.

Missing or invalid BFF service credential returns generic `404 Not Found` before the handler. No browser-direct Medusa authority was introduced.

Final AUTH enabled exact-set:

```text
POST /auth/customer/emailpass/register
POST /auth/customer/emailpass
POST /auth/token/refresh
POST /auth/customer/emailpass/revoke-current-lineage
POST /auth/customer/emailpass/reset-password
POST /auth/customer/emailpass/update
```

Final STORE enabled exact-set:

```text
GET /store/customers/me
POST /store/customers/me/verify
POST /store/customers/verify/resend
POST /store/customers/verify
GET /store/customers/me/verify/status
POST /store/customers/me/password
```

Final BFF protected exact-set contains those 12 approved backend contracts. Raw Customer creation, `/auth/session`, native session/callback/MFA/verification/refresh/reset aliases, trailing slash/case/method variants, wildcard and prefix authorization remain DENY.

## Final accepted evidence

```text
Focused PostgreSQL remediation:                  PASS — 19/19 + cleanup
Full auth-password-change-reconcile PG:          PASS — 19/19 + cleanup
Focused password-change HTTP remediation:        PASS — 25/25
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
Direct ESLint on touched production:             PASS — 0 errors
git diff --check:                                PASS
Docker disposable PostgreSQL:                    CLEAN
Remote infrastructure:                           NONE
Real providers:                                  NONE
Repository lint wrapper:                         KNOWN TOOLING FAILURE — empty JSON / EOF
```

Human-pushed execution/remediation head before documentary closure:

`13ecc46fe54e84bd393020d03857546281d297df`

No schema, migration, package/dependency, real-provider, remote-persistence, deploy or frontend work is authorized by this closure.

Historical Phase 13 / 14-02 inventory tests that encode pre-elevation snapshots remain documented as stale historical assertions and were not silently rewritten or skipped during 14-18 remediation.

## 14-19 authorization

By explicit human authorization, `14-19-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

Objective: materialize the Phase 14 API Docs **TypeScript registry** for the 12 BFF/backend operations after runtime/password surface approval, while keeping generated JSON untouched.

Authorized sequence:

- `14-19-01`: define schemas and security schemes against the existing auth HTTP contract, with synthetic safe examples and sensitive-data walker proof;
- `14-19-02`: register the 12 exact operations, coverage and explicit logout/raw/native exclusions with provenance and review triggers;
- `14-19-03`: **BLOCKING HUMAN VERIFY**; present operation list, exclusions, schemas/security, sensitive walker and proof that generated JSON is byte-unchanged, then stop.

Binding restrictions:

- registry must match the 12 runtime-approved BFF/backend contracts exactly;
- registry TypeScript only; do not run the writer or modify generated OpenAPI JSON in 14-19;
- examples must contain no JWT, capability, password, real email or provider metadata;
- Swagger must not become interactive;
- logout browser/raw/native exclusions must remain explicit with owner/review trigger;
- coverage must remain exact and traceable to the runtime/auth contract;
- no package installation;
- `14-20..14-21` remain NOT AUTHORIZED;
- no deploy, real providers, remote infrastructure or frontend.

## Next

Execute `14-19-01` according to `14-19-PLAN.md`, proceed serially to `14-19-02` after its gate evidence, then stop at `14-19-03` for explicit human review.

Do not automatically start `14-20`.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-18*
*Executed: 2026-08-17*
*Remediated: 2026-08-18*
*Human approval: PASS*
*Documentary closure: COMPLETE — 2026-08-18*