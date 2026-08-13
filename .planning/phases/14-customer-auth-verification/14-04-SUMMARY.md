---
phase: 14-customer-auth-verification
plan: 04
subsystem: auth
tags: [auth, customer, email, normalization, collision-audit, postgres, cli, hmac, pii]

requires:
  - phase: 14-03
    provides: DB_MODEL reconciliation and fail-closed transaction baseline before models or migrations
provides:
  - Canonical P14-D12 customer-auth email normalization and hash-only capability primitives
  - Sanitized read-only collision audit shared with the runtime normalizer
  - Real CLI/process-level PostgreSQL evidence for PASS and BLOCKED scenarios
affects:
  - 14-05-customer-auth-verification
  - 14-07-customer-auth-verification
  - 14-14-registration
  - 14-16-password-reset
  - 14-17-password-change

tech-stack:
  added: []
  patterns:
    - Runtime normalizer is imported directly by the collision audit
    - PostgreSQL audit runs inside BEGIN READ ONLY and always rolls back
    - Sensitive report fields use domain-separated HMAC digests

key-files:
  created:
    - apps/backend/src/modules/customer-auth/security/email-normalization.ts
    - apps/backend/src/modules/customer-auth/security/capabilities.ts
    - apps/backend/src/modules/customer-auth/__tests__/auth-security.unit.spec.ts
    - apps/backend/scripts/audit-customer-auth-email-collisions.ts
    - apps/backend/integration-tests/modules/customer-auth-email-collision.postgres.spec.ts
  modified:
    - apps/backend/src/config/env.ts

key-decisions:
  - "The collision audit is proven through the real CLI child process, not only through the exported function."
  - "Invalid identity and customer inputs remain separate blockers with source-specific HMAC owner IDs; no winner, correction or merge is selected."
  - "The outer integration spec launches zero-collision and collision/invalid through distinct Docker-backed disposable PostgreSQL runners."

patterns-established:
  - "CLI PASS is exit 0; CLI BLOCKED is exit 2; stderr must remain empty and stdout is a single sanitized JSON report."
  - "Fixture writes are separated from audit writes; the audit itself is read-only and rolled back."

requirements-completed: [AUTH-01, AUTH-04, AUTH-06, AUTH-07, AUTH-09]

duration: "technical execution previously recorded; corrective validation and human re-review completed 2026-08-13"
completed: 2026-08-13
status: human-approved-pass
---

# Phase 14 Plan 04: Customer Auth Normalization and Collision Gate Summary

**P14-D12 now has one runtime email normalizer, hash-only auth primitives, and an isolated real-CLI collision gate that fails closed without writes or PII leakage.**

## Performance

- **Duration:** technical execution previously recorded; corrective validation completed locally
- **Started:** 2026-08-13
- **Completed:** 2026-08-13
- **Tasks:** 3/3 complete
- **Files modified:** 6 plan-owned technical files across the task commits; final correction touched 2 files

## Accomplishments

- Implemented and unit-tested the P14-D12 normalizer, versioned HMAC/HKDF capability primitives, and hash-only keyring validation.
- Implemented a read-only audit that imports the runtime normalizer, groups normalized owners by source, and reports only counts and opaque digests.
- Added real CLI/process-level proof: zero-collision returns `PASS` with exit `0`; collision/invalid returns `BLOCKED` with exit `2`; both scenarios use distinct Docker-backed disposable PostgreSQL runners.
- Preserved invalid-input origin: `identity` remains `identity` and `customer` remains `customer`, with source-specific opaque owner IDs.

## Task Commits

1. **Task 14-04-01 RED: add failing auth security specifications** — `055ea41`
2. **Task 14-04-01 GREEN: implement auth normalization and capabilities** — `ec98c29`
3. **Task 14-04-01 correction: keep auth env fixtures compatible** — `54a0886`
4. **Task 14-04-02: add read-only email collision audit** — `09feb33`
5. **Task 14-04-02 corrective execution: prove CLI isolation and invalid-source classification** — `e81f123`

## Files Created/Modified

- `apps/backend/src/modules/customer-auth/security/email-normalization.ts` - Canonical P14-D12 normalizer used by runtime and audit.
- `apps/backend/src/modules/customer-auth/security/capabilities.ts` - Versioned hash-only capability primitives and keyring policy.
- `apps/backend/src/modules/customer-auth/__tests__/auth-security.unit.spec.ts` - Normalization, HMAC/HKDF and key-rotation tests.
- `apps/backend/src/config/env.ts` - Auth capability key configuration and validation.
- `apps/backend/scripts/audit-customer-auth-email-collisions.ts` - Sanitized read-only CLI audit with source-preserving invalid blockers.
- `apps/backend/integration-tests/modules/customer-auth-email-collision.postgres.spec.ts` - Isolated disposable PostgreSQL and real CLI process proof.

## Decisions Made

- Keep the audit read-only and fail closed on any ambiguity or invalid input.
- Preserve source classification and HMAC owner digests without exposing e-mail addresses, tokens or secrets.
- Do not create models, migrations, DDL, provider calls, deploy artifacts or a collision winner in this plan.

## Deviations from Plan

### Authorized human-review corrections

**1. B14-04-HR-01 — real CLI/process-level proof**
- **Found during:** Task 14-04-03 human review.
- **Issue:** The original integration test called only the exported audit function and used temporary tables invisible to a child CLI process.
- **Fix:** The test now launches two distinct Docker-backed disposable PostgreSQL runner processes, creates process-visible fixtures, executes the real `.ts` CLI, and asserts exit/status/sanitization/zero-write behavior.
- **Files modified:** `apps/backend/scripts/audit-customer-auth-email-collisions.ts`, `apps/backend/integration-tests/modules/customer-auth-email-collision.postgres.spec.ts`.
- **Verification:** Approved PostgreSQL disposable test passed; zero-collision exit `0`/`PASS`, collision/invalid exit `2`/`BLOCKED`.
- **Committed in:** `e81f123`.

**2. B14-04-HR-02 — preserve invalid-input source**
- **Found during:** Task 14-04-03 human review.
- **Issue:** Invalid inputs were aggregated as `source: "identity"`.
- **Fix:** Invalid owners are collected per `OwnerSource`, and owner IDs are emitted only as source-specific HMAC digests; the test explicitly covers invalid Customer input.
- **Files modified:** `apps/backend/scripts/audit-customer-auth-email-collisions.ts`, `apps/backend/integration-tests/modules/customer-auth-email-collision.postgres.spec.ts`.
- **Verification:** Identity and customer classification both passed with no PII or secret output.
- **Committed in:** `e81f123`.

---

**Total deviations:** 2 authorized human-review corrections
**Impact on plan:** Both corrections were required to close the named blockers; no scope expansion occurred.

## Issues Encountered

- The global TypeScript check exits non-zero on preexisting diagnostics outside the two corrected files; no new diagnostics were present in the modified files.
- The outer Jest orchestration required a 30-second timeout because it starts two real disposable PostgreSQL runners sequentially.

## User Setup Required

None - no external service configuration, migration, provider call or deploy was authorized.

## Human Re-Review

```text
Task 14-04-01:
PASS — Unit 16/16

Task 14-04-02:
PASS — isolated PostgreSQL/CLI scenarios

B14-04-HR-01:
CLOSED — PASS

B14-04-HR-02:
CLOSED — PASS

14-04:
HUMAN APPROVED — PASS
```

## Next Phase Readiness

- `14-04` is complete and human-approved.
- `14-05` remains **NOT AUTHORIZED** and must wait for fresh human authorization.
- Deploy remains **NOT AUTHORIZED**; frontend remains **BLOCKED**.
- No automatic transition or phase completion was performed.

---
*Phase: 14-customer-auth-verification*
*Completed: 2026-08-13*
