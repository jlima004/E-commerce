---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 07
status: blocked
requirements: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]
requirements-completed: []
requirements-evidenced: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07]
blocked_by: B13-07-R1-01
---

# Phase 13 Plan 07: Final Security, Native-Bypass and Validation Gate

## Status

```text
P13-13-07:
BLOCKED — OPENAPI READ-ONLY DRIFT

13-06:
HUMAN APPROVED — PASS

13-07:
BLOCKED

Phase 14:
NOT AUTHORIZED
```

The technical test additions passed, but the mandatory clean read-only
`openapi:check` failed on the committed Admin artifact. The writer was not
executed and the drift was not repaired inside Plan 13-07.

## Identity

```text
Plan:
13-07

Branch:
gsd/phase-13-storefront-contract-foundation-surface-lockdown

Pre-13-07 HEAD:
26ff983a2b272b610fda3c0541d82f590acfb8e5

Post-technical HEAD:
56c2c36fbcf8a5625f810f4096a502eb77282298

13-06:
HUMAN APPROVED — PASS

13-07:
BLOCKED — OPENAPI READ-ONLY DRIFT

Phase 14:
NOT AUTHORIZED
```

## Scope

```text
Technical files changed:
apps/backend/integration-tests/http/store-foundation-final.spec.ts
apps/backend/src/api/store-surface/__tests__/security-negative.unit.spec.ts
apps/backend/src/modules/checkout-completion/__tests__/store-order-birth-canonical.postgres.spec.ts

Technical path count:
3

Unexpected technical paths:
NONE

Runtime changes:
NONE

Model changes:
NONE

Migration changes:
NONE

OpenAPI source changes:
NONE

OpenAPI JSON changes:
NONE

Package/lockfile/Jest config changes:
NONE

Dependencies installed:
NO
```

## Task 1 Evidence

```text
Native:
51

Local non-overlap:
7

Runtime:
58

Manifest:
58

Unknown:
0

Duplicates:
0

AUTHORIZED:
0

EXTENDED:
10

BLOCKED:
17

OUTSIDE_FRONTEND_M1:
31

M1_ENABLED:
0

Store public business path+method:
0

Health/support:
2

BLOCKED -> DENY:
PASS

UNKNOWN fail-closed:
PASS

PRESERVE_LEGACY runtime-only:
PASS

PRESERVE_LEGACY M1 executable:
0

Disabled EXTENDED M1 executable:
0

BFF server-to-server boundary:
PASS

Direct browser authority:
NO

Sensitive canary leaks:
0

Admin isolation:
PASS

Webhooks isolation:
PASS
```

Sensitive categories covered with synthetic values only:

```text
raw Idempotency-Key
pepper
JWT
guest capability
confirmation token/session
CPF
client_secret
Pix QR/copy-paste material
provider ID/payload
stack
raw internal error

leaks:
0
```

## Task 2 Order-Birth Evidence

```text
Store completeCartWorkflow invocation:
0

Store createOrder invocation:
0

Store Order count:
0

Canonical trusted payment_intent.succeeded:
PASS

PaymentAttempt:
payment_confirmed_by_webhook

CheckoutCompletionLog:
correlated in disposable PostgreSQL

Order after canonical webhook:
1

Replay:
PASS — same persisted result

Order after replay:
1

Concurrent replay:
PASS — 3 accepted attempts, exactly one persisted birth

Final Order count:
1
```

The concurrent proof used the real PostgreSQL uniqueness/correlation mechanism
of `CheckoutCompletionLog`; it did not serialize calls or substitute an
in-memory mutex. No real Stripe call or remote database was used.

## Idempotency Lifecycle Evidence

Inherited runtime evidence was revalidated by the Task 1 composite:

```text
Scheduled job:
* * * * *

Processing deadline:
5m

Recovery evaluation:
15m

failed_retryable ceiling:
8 attempts or 24h

Reconciliation review:
7d

Two-worker claim:
ONE OWNER

Restart durability:
POSTGRESQL-BACKED

Redis correctness dependency:
NO

Terminal expiry:
PASS

Terminal-only cleanup:
PASS

reconciliation_unresolved semantics:
AUDIT-ONLY
```

## Commands

### Task 1 unit composite

```text
command:
cd apps/backend && npm run test:unit -- --runTestsByPath src/api/store-surface/__tests__/security-negative.unit.spec.ts src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts src/config/__tests__/env.unit.spec.ts src/infrastructure/__tests__/medusa-config.unit.spec.ts --runInBand

exit:
0

suites:
4/4 passed

tests:
109/109 passed

result:
PASS
```

### Task 1 HTTP final

```text
command:
cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/store-foundation-final.spec.ts --runInBand

exit:
0

suites:
1/1 passed

tests:
7/7 passed

result:
PASS
```

### Task 2 disposable PostgreSQL

```text
command:
cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath src/modules/checkout-completion/__tests__/store-order-birth-canonical.postgres.spec.ts --runInBand

exit:
0

suites:
1/1 passed

tests:
3/3 passed

result:
PASS
```

### OpenAPI clean read-only gate

```text
command:
npm run openapi:check

checkout before command:
CLEAN

exit:
1

suites:
N/A

tests:
N/A

result:
FAIL

error:
Generated OpenAPI artifact drift: admin.openapi.json
```

### Gates after OpenAPI failure

```text
lint:
NOT EXECUTED — blocked by mandatory prior OpenAPI gate

build:
NOT EXECUTED — blocked by mandatory prior OpenAPI gate

final relevant regression set:
NOT EXECUTED — blocked by mandatory prior OpenAPI gate
```

## Blocking Gate

```text
B13-07-R1-01:
OPEN

Blocking invariant:
clean read-only openapi:check must pass without running the writer

Expected:
exit 0; no generated artifact drift

Actual:
exit 1; Generated OpenAPI artifact drift: admin.openapi.json

Owning plan:
13-06 — Store OpenAPI/per-surface generation and committed writer artifacts

Required corrective gate:
new human-authorized owner-plan correction; Plan 13-07 cannot run the writer or edit OpenAPI source/JSON
```

## OpenAPI Integrity

```text
Checkout clean before check:
YES

Writer executed in 13-07:
NO

openapi:check:
FAIL

Reported drifting artifact:
admin.openapi.json

Generated artifacts modified by 13-07:
NONE
```

## Requirements and Blockers

```text
FND-01:
EVIDENCED — NOT COMPLETE

FND-02:
EVIDENCED — NOT COMPLETE

FND-03:
EVIDENCED — NOT COMPLETE

FND-04:
EVIDENCED — NOT COMPLETE

FND-05:
EVIDENCED — NOT COMPLETE

FND-06:
EVIDENCED — NOT COMPLETE

FND-07:
EVIDENCED — NOT COMPLETE

FND-08:
FAIL — clean read-only OpenAPI drift gate

requirements-completed:
[]

Phase 13 requirements complete:
0/8

Milestone requirements complete:
0/91
```

```text
B13-01:
ELIMINATED — EVIDENCED

B13-02:
ELIMINATED — EVIDENCED

B13-03:
ELIMINATED — EVIDENCED

B13-04:
ELIMINATED — EVIDENCED

B13-05:
ELIMINATED — EVIDENCED

B13-06:
ELIMINATED — EVIDENCED

B13-07:
OPEN — admin.openapi.json read-only drift
```

## Git and Remote Effects

```text
Technical commits:
886a042 test(13-07): add final Store foundation security gate
56c2c36 test(13-07): prove canonical Order birth invariant

Technical checkout before openapi:check:
CLEAN

OpenAPI writer:
NOT EXECUTED

Push:
NOT DONE

PR:
NOT OPENED

Supabase / remote DB / Heroku / deploy:
NO

Stripe real / Gelato / Resend / PostHog / Sentry external / Correios:
NO

Frontend:
NO
```

## Governance Stop

```text
Plans human-approved executed:
6/7

13-07:
BLOCKED — OPENAPI READ-ONLY DRIFT

Phase 13:
NOT CLOSED

Phase 14:
NOT AUTHORIZED

Frontend:
BLOCKED

Deploy:
NOT AUTHORIZED
```

No STATE/ROADMAP/REQUIREMENTS update, Phase 13 closure, Phase 14 work,
frontend work, deploy, writer execution, push or PR is authorized by this
blocked checkpoint.
