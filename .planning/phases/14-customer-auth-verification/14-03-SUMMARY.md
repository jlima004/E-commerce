---
phase: 14-customer-auth-verification
plan: 03
subsystem: auth
tags: [auth, postgres, transactions, db-model, reconciliation]

requires:
  - phase: 14-02
    provides: closed auth contract and deny-by-default auth surface
provides:
  - Reconciled Phase 14 auth persistence authority in DB_MODEL_v1.21
  - Executable transaction-capability matrix for Auth provider and Customer seams
  - Fail-closed reconciliation baseline when Medusa cross-module atomicity is unproven
affects:
  - 14-04-customer-auth-verification
  - 14-14-registration
  - 14-16-password-reset
  - 14-17-password-change

tech-stack:
  added: []
  patterns:
    - PostgreSQL disposable probe with manager, query-runner, transaction-id and rollback evidence
    - RECONCILIATION_REQUIRED blocks login/refresh during intermediate recovery states

key-files:
  created:
    - apps/backend/integration-tests/modules/customer-auth-transaction-compatibility.postgres.spec.ts
  modified:
    - docs/DB_MODEL_v1.21.md
    - apps/backend/src/infrastructure/customer-auth-transaction-compatibility.ts

key-decisions:
  - "EmailDeliveryLog remains non-auth/order-operational and, as-built, restricted to order_confirmation; AuthNotificationOutbox exclusively owns verification/reset auth notifications."
  - "All three Medusa transaction seams remain RECONCILIATION_REQUIRED because shared manager/query-runner atomicity was not proven."
  - "The DB_MODEL → normalizer/collision audit → models → migration order remains mandatory; this plan authorizes no model, migration, DDL or automatic collision winner."

patterns-established:
  - "SUPPORTED_STRONG is emitted only after joint commit and complete fault rollback under identical manager, query runner and transaction identities."
  - "claimed, credential_updated and other non-stable recovery states fail closed for login and refresh."

requirements-completed: [AUTH-01, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08]

duration: "technical execution previously recorded; human re-review closed 2026-08-13"
completed: 2026-08-13
status: human-approved-pass
---

# Phase 14 Plan 03: Auth Persistence Reconciliation and Transaction Capability Summary

**DB_MODEL_v1.21 now has one normative split for order-operational versus auth e-mail, while disposable PostgreSQL evidence establishes a fail-closed reconciliation baseline for every Medusa Auth/Customer transaction seam.**

## Accomplishments

- Reconciled the seven auth persistence states, constraints, lifecycles, TTLs, leases, CAS/retry fields, proof markers, relations and indexes in `DB_MODEL_v1.21.md`.
- Made `EmailDeliveryLog` exclusively non-auth/order-operational (as-built: `order_confirmation`) and `AuthNotificationOutbox` exclusively responsible for verification/reset auth notifications; the v1.11 historical wording is preserved and marked superseded.
- Preserved executable evidence for `auth_provider`, `customer_workflow` and `combined`: all three classify as `RECONCILIATION_REQUIRED`, with intermediate recovery states failing closed for login/refresh.
- Closed `B14-03-HR-01` after human re-review. No technical file was changed during re-review, so the previously accepted transaction evidence was not re-executed.

## Task Commits

1. **Task 14-03-01: reconcile customer auth data model** — `f67e0d9`
2. **Task 14-03-02 RED: add failing auth transaction probe** — `4a5eaf7`
3. **Task 14-03-02 GREEN: record auth transaction capability** — `f168efd`

## Human Re-Review

```text
B14-03-HR-01:
CLOSED — PASS

Task 14-03-01:
PASS

Task 14-03-02:
PASS

Transaction capability:
Auth provider seam: RECONCILIATION_REQUIRED — ACCEPTED
Customer workflow seam: RECONCILIATION_REQUIRED — ACCEPTED
Combined seam: RECONCILIATION_REQUIRED — ACCEPTED

DB_MODEL reconciliation:
PASS

DB_MODEL verify:
PASS

Textual consistency:
PASS

git diff --check:
PASS

14-03:
HUMAN APPROVED — PASS
```

## Files Created/Modified

- `docs/DB_MODEL_v1.21.md` — normative auth persistence model and e-mail-domain reconciliation.
- `apps/backend/src/infrastructure/customer-auth-transaction-compatibility.ts` — conservative capability classifier and fail-closed recovery predicate.
- `apps/backend/integration-tests/modules/customer-auth-transaction-compatibility.postgres.spec.ts` — disposable PostgreSQL manager/query-runner/rollback probe.

## Deviations from Plan

None. The human re-review was documentary and did not alter technical files or require re-execution of the accepted transaction evidence.

## User Setup Required

None — no provider, migration, deploy or frontend configuration was authorized.

## Next Phase Readiness

- `14-03` is complete and human-approved.
- `14-04` remains **NOT AUTHORIZED** and must wait for fresh human authorization.
- The accepted `RECONCILIATION_REQUIRED` baseline is binding for registration, reset and password-change planning.
- Deploy remains **NOT AUTHORIZED**; frontend remains **BLOCKED**.

---
*Phase: 14-customer-auth-verification*
*Completed: 2026-08-13*
