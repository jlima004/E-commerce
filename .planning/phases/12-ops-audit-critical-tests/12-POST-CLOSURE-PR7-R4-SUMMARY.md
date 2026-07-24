# P12-POST-CLOSURE-PR7-R4 Summary

## Gate

```text
gate: P12-POST-CLOSURE-PR7-R4
PR: https://github.com/jlima004/E-commerce/pull/7
reviewer: chatgpt-codex-connector
reviewed commit: 8a0f759ec45cb2a7a6384887bf7205141276dcbe
finding: Keep checkout completion independent of alert module
priority: P2
classification: valid
```

## Base SHA

```text
8a0f759ec45cb2a7a6384887bf7205141276dcbe
```

## Finding

```text
Keep checkout completion independent of alert module
```

## Diagnosis

```text
runtime bug before correction:
  no immediate proven runtime failure

architecture violation:
  yes

money path dependency on operational-alert:
  removed

single stale-policy definition:
  yes

stale window:
  unchanged at 15 minutes
```

`CheckoutCompletionModuleService` / claim helpers imported
`CHECKOUT_COMPLETION_STALE_AFTER_MS` and `isCheckoutCompletionLockedStale` from
`operational-alert/detectors.ts`. That inverted ownership: the money-path reclaim
policy lived inside the alert observer module.

Disabling OperationalAlert registration at runtime would not necessarily break a
pure import, but removing, refactoring, or isolating the operational domain could
break checkout because the money path imported alert-module implementation.

### Previous dependency

```text
checkout-completion (money path)
            ↓
operational-alert/detectors (stale policy + detectors)
```

### Corrected dependency

```text
checkout-completion/staleness (pure stale/reclaim contract)
            ↑
operational-alert/detectors (observer only)
```

## Correction

Created pure contract:

```text
apps/backend/src/modules/checkout-completion/staleness.ts
```

- No MedusaService, models, container, DB, env, side effects, or external deps.
- Owns `CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000`.
- Owns `isCheckoutCompletionLockedStale(lockedAt, now, staleAfterMs?)`.
- Invalid/missing `locked_at` → false; below 15m → false; exactly/above 15m → true.

`checkout-completion/service.ts` now imports from `./staleness` and re-exports only
the constant for existing public compatibility. Zero imports of `operational-alert`.

`operational-alert/detectors.ts` consumes the same contract; local `parseTimestamp`
remains for webhook/`expires_at` detectors. Stale symbols are not re-exported from
detectors.

### Behavior preserved

```text
processing without order_id + locked_at valid + age >= 15m
  → failed/retryable + reclaim (retry_processing_without_order)

processing below 15m
  → already_processing (no reclaim)

alert detectors
  → same stale window for PAYMENT_CONFIRMED_CHECKOUT_STALE
  → same CCL-absent received_at gate using the shared constant
```

## Technical paths

```text
apps/backend/src/modules/checkout-completion/staleness.ts
apps/backend/src/modules/checkout-completion/service.ts
apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts
apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.postgres.spec.ts
apps/backend/src/modules/operational-alert/detectors.ts
apps/backend/src/modules/operational-alert/__tests__/operational-alert-detectors.unit.spec.ts
apps/backend/src/jobs/__tests__/operational-alert-scanner.unit.spec.ts
```

Additional inventory consumer (import-only):

```text
checkout-completion-log.postgres.spec.ts
```

Read-only / unchanged:

```text
apps/backend/src/jobs/operational-alert-scanner.ts
apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
apps/backend/src/modules/checkout-completion/index.ts
apps/backend/src/modules/checkout-completion/types.ts
Admin R3 requireAdminActor routes
```

## Focused tests

```text
Focused Unit (4 suites / 91 tests): PASS
  checkout-completion-log.unit.spec.ts
  operational-alert-detectors.unit.spec.ts
  operational-alert-scanner.unit.spec.ts
  webhook-order-creation.unit.spec.ts
Early build: PASS (ADMIN_DISABLED=true)
```

Coverage added/preserved:

- Direct stale-contract proofs (constant, invalid/null, exact/below/above 15m, Date/ISO)
- Claim reclaim regressions at/above/below 15m
- Structural proof: `service.ts` does not contain the alert module path
- Detector + scanner behavior unchanged

## Full regression

```text
Full Unit: PASS (54 suites / 899 tests)
Full Modules: PASS (36 suites / 520 tests)
Full HTTP: PASS (19 suites / 240 tests)
Lint: PASS (0 errors / 210 pre-existing warnings)
Build: PASS (ADMIN_DISABLED=true)
PostgreSQL disposable: not required (pure time contract; no schema/migration)
```

## Negative proofs

```text
checkout-completion → operational-alert imports: zero
const CHECKOUT_COMPLETION_STALE_AFTER_MS definitions: 1 (staleness.ts)
function isCheckoutCompletionLockedStale definitions: 1 (staleness.ts)
package.json / lockfile / medusa-config / middlewares / jest: unchanged
Admin R3 requireAdminActor routes: unchanged
schema/migrations: unchanged
```

## Commits

```text
technical: 42fdffc2428aca3582aff23c7bd1f22bd8974be2
  fix(checkout): own stale claim policy
documentary: (this commit)
  docs(12): record PR7 module isolation correction
```

## Git final (after documentary commit)

```text
base: 8a0f759ec45cb2a7a6384887bf7205141276dcbe
new commits: 2
origin/main...HEAD: expected 0 42
origin phase branch...HEAD: expected 0 2
push: not executed
deploy: not executed
GitHub replies / thread resolution / Codex re-review: not executed
```

## Closure

```text
Phase 12 closure: reaffirmed by fourth post-closure addendum (R4)
Phase 12.1: not started / blocked pending PR update and re-review
milestone archived: no
completed phases: 12
completed plans: 56
requirements: 45/45
OPS-01 / OPS-02 / TEST-01: complete
```

## Next permitted step

```text
separate authorization to push, reply to the Codex finding and request a new Codex review
```
