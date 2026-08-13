---
phase: 14-customer-auth-verification
plan: 02
subsystem: auth
tags: [auth, bff, contracts, deny-by-default, medusa, reset-confirm]

requires:
  - phase: 14-01
    provides: disposable auth validation harness and deterministic security primitives
provides:
  - Closed HTTP/BFF contract for the 12 Phase 14 auth operations
  - Strict request validators and allowlisted auth response serializers
  - Exact 24-entry auth manifest with 18 native and 6 local operations
  - Deny-by-default auth surface guard with zero runtime-enabled operations
affects:
  - 14-03-customer-auth-verification
  - 14-11-refresh-and-lineage
  - 14-15-signup-and-login
  - 14-16-password-reset

tech-stack:
  added: []
  patterns:
    - Exact method and canonical-path auth allowlisting
    - Native auth routes remain denied until an owned local override is proven
    - Reset-confirm 503 classification fails closed unless its stage is authorized

key-files:
  created:
    - apps/backend/src/api/auth-surface/contracts.ts
    - apps/backend/src/api/auth-surface/validators.ts
    - apps/backend/src/api/auth-surface/errors.ts
    - apps/backend/src/api/auth-surface/manifest.ts
    - apps/backend/src/api/auth-surface/guard.ts
    - apps/backend/src/api/auth-surface/__tests__/contracts.unit.spec.ts
    - apps/backend/src/api/auth-surface/__tests__/guard.unit.spec.ts
  modified:
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "All 24 auth manifest entries remain DENY in 14-02; later owners must promote local overrides individually."
  - "Reset-confirm exposes only AUTH_TEMPORARILY_UNAVAILABLE at pre_lookup with Retry-After 60 or AUTH_RECOVERY_PENDING at correlated_recovery."
  - "Unknown or unstaged reset-confirm 503 classifications throw internally instead of producing a third public 503."

patterns-established:
  - "Auth surface guard resolves exact method plus canonical path before any handler or container resolution."
  - "Public auth errors are rebuilt from a closed catalog and never copy provider, identity, capability, DB, or stack fields."

requirements-completed: []
requirements-evidenced: [AUTH-03, AUTH-07, AUTH-09]

duration: 43min
completed: 2026-08-13
status: human-approved-pass
---

# Phase 14 Plan 02: Closed Auth Contract and Deny-by-Default Surface Summary

**A typed 12-operation BFF contract and exact 24-entry auth manifest now keep every raw auth operation denied while preserving only the two approved reset-confirm 503 classifications.**

## Identity

Plan: 14-02  
Status: **HUMAN APPROVED — PASS**  
Branch: `gsd/phase-14-customer-auth-verification`  
Execution worktree branch: `worktree-agent-14-02-20260813T162753Z`  
Execution base: `610b04900a731c801a4b21298efeb49e36aebd14`

14-03: **NOT AUTHORIZED**

## Performance

- **Duration:** ~43 min, including corrective human re-review
- **Started:** 2026-08-13T13:34:27-03:00
- **Completed:** 2026-08-13T14:17:04-03:00
- **Tasks:** 3/3 complete, including the blocking human checkpoint
- **Files modified:** 8 implementation/test files plus this SUMMARY

## Accomplishments

- Materialized the exact 12-operation Phase 14 auth HTTP/BFF contract, strict validators, closed errors, and allowlisted session/current-customer serializers.
- Installed an exact-set guard for 18 Medusa native operations plus 6 planned local overrides; all 24 remain runtime `DENY`.
- Preserved Store guard behavior and prevented raw auth aliases, actor/provider variants, callbacks, sessions, MFA, native verification, and native refresh from reaching handlers.
- Closed `B14-02-HR-01`: invalid, unstaged, or unknown reset-confirm 503 classifications now fail internally and cannot serialize a third public 503.

## Task Commits

1. **Task 14-02-01 RED: auth contract specifications** — `9ff58ef`
2. **Task 14-02-01 GREEN: closed auth contracts** — `4fe9135`
3. **Task 14-02-02 RED: auth surface guard specifications** — `7cd666a`
4. **Task 14-02-02 GREEN: deny-by-default auth surface guard** — `07ad010`
5. **Task 14-02-01 correction: success code outside session envelope** — `4afb9ec`
6. **Document hygiene: trailing EOF whitespace** — `e628dbb`
7. **B14-02-HR-01 correction: fail-closed reset classifications** — `92d7ccc`

## Files Created/Modified

- `apps/backend/src/api/auth-surface/contracts.ts` — closed HTTP/BFF contract and allowlisted response serializers.
- `apps/backend/src/api/auth-surface/validators.ts` — strict request schemas and limits.
- `apps/backend/src/api/auth-surface/errors.ts` — closed public error catalog and fail-closed reset-confirm classification.
- `apps/backend/src/api/auth-surface/manifest.ts` — exact 18-native plus 6-local auth inventory, all initially denied.
- `apps/backend/src/api/auth-surface/guard.ts` — canonical exact-match authorization decision and anti-enumerable denial.
- `apps/backend/src/api/auth-surface/__tests__/contracts.unit.spec.ts` — exact contracts, validators, serializers, and reset-confirm regressions.
- `apps/backend/src/api/auth-surface/__tests__/guard.unit.spec.ts` — exact-set, deny-all, alias, actor/provider, and explicit-local-override regressions.
- `apps/backend/src/api/middlewares.ts` — method-less `/auth*` guard registration before handlers.

## Human Re-Review

```text
B14-02-HR-01:
CLOSED — PASS

14-02:
HUMAN APPROVED — PASS

Tasks:
3/3 COMPLETE

Contracts:
PASS — 5/5

Auth guard:
PASS — 8/8

Store guard regression:
PASS — 15/15

Manifest:
24/24 DENY
18 native + 6 local
0 runtime enabled

git diff --check:
PASS
```

## Decisions Made

- The browser-facing logout remains a BFF cookie operation; raw `/auth/session` stays denied.
- No native auth route is enabled by wildcard or by actor/provider similarity.
- Reset-confirm classification is contextual: the code alone is insufficient to authorize a public 503.

## Deviations from Plan

### Human-review corrective issue

**B14-02-HR-01 — reset-confirm allowed an unauthorized third 503**

- **Found during:** Task 14-02-03 human review.
- **Issue:** unknown errors and 503 codes without the approved stage could normalize to `503 AUTH_TEMPORARILY_UNAVAILABLE`.
- **Fix:** reject unknown reset-confirm errors and require `pre_lookup` or `correlated_recovery` for the corresponding 503 code before serialization.
- **Files modified:** `errors.ts` and `contracts.unit.spec.ts` only.
- **Verification:** contracts 5/5, auth guard 8/8, Store guard 15/15, and `git diff --check` PASS.
- **Committed in:** `92d7ccc`.

---

**Total deviations:** 1 human-review corrective issue, closed and approved.  
**Impact on plan:** narrows public behavior to the approved contract without enabling any auth route or adding a public error class.

## Issues Encountered

- Initial reset-confirm normalization inferred `AUTH_TEMPORARILY_UNAVAILABLE` for invalid contexts. The human-review correction made classification fail closed and was re-reviewed as PASS.

## User Setup Required

None — no dependency, environment, provider, migration, deploy, or frontend change was introduced.

## Next Plan Readiness

- `14-02` is complete and human-approved.
- `14-03` remains **NOT AUTHORIZED** and must not start automatically.
- Deploy remains **NOT AUTHORIZED**; frontend remains **BLOCKED**.

---
*Phase: 14-customer-auth-verification*  
*Completed: 2026-08-13*
