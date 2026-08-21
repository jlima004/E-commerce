# Phase 15-05 Summary: Line-Item Mutation Core — Add & Update

## Execution status

- Phase / Plan: Phase 15 (`guest-cart-capability-concurrency`), Plan `15-05`
- Date: 2026-08-21
- Status: **BLOCKED — HUMAN REVIEW REQUIRED**
- Harness: Codex
- Executor/model: Codex / GPT-5
- Subagents: **NOT EXPOSED / NOT AVAILABLE IN CODEX HARNESS**
- Execution roles: A → B → C → D performed sequentially by the main Codex executor
- Branch: `gsd/phase-15-guest-cart-capability-concurrency`
- Remote sync: PASS; local branch matched `origin` before execution
- `PLAN15_05_EXECUTION_BASE_SHA`: `9e18cb31c0905e9ad9052758d37238208e8b1278`
- Initial HEAD: `9e18cb31c0905e9ad9052758d37238208e8b1278`
- Final implementation HEAD: `a2868b9e2de24f50bbd4d410e8c5875d5b3f6180`

## Commits

- `568367b` — `test(15-05): add failing line-item foundation tests`
- `a431937` — `feat(15-05): enable guest and customer line-item mutations`
- `a2868b9` — `fix(15-05): preserve mutation claim lifecycle on terminal errors`

Diff from the authorized base: **14 files, 1,752 additions, 21 deletions**.

## Task results

- Task 15-05-01: **PASS** in the focused unit harness.
- Task 15-05-02: **BLOCKED at production idempotency compatibility**; synthetic Guest/Customer HTTP evidence passed.
- Task 15-05-03: **BLOCKED at the same production compatibility gate**; synthetic Guest/Customer HTTP evidence passed.
- Task 15-05-04: **AWAITING HUMAN REVIEW**; no 15-06 work started.

## Implemented contract

Pipeline order is implemented as:

`BFF → actor → ownership → validation → Idempotency-Key → claim → replay short-circuit → If-Match → CAS/workflow → CART-09 → terminalize → canonical refetch → ETag`

- Validation-before-claim: PASS; invalid body test observed zero claim and zero mutation.
- Claim-before-If-Match: PASS by pipeline ordering and stale/missing-precondition paths.
- Native workflows: `addToCartWorkflow` and `updateLineItemInCartWorkflow`, only inside CAS.
- `quantity: 0` uses the native update workflow and removes the line item.
- CART-09: real local PaymentAttempt invalidation plus injectable no-op shipping quote/selection seams.
- No JSON `1.0` versus `1` rejection test was added.

## Replay and lifecycle evidence

- Same-key success replay: synthetic HTTP PASS — canonical refetch, current ETag, HTTP 200, zero second workflow.
- First stale If-Match: synthetic HTTP PASS — HTTP 412, `failed_terminal`, `CART_VERSION_MISMATCH`, zero mutation.
- Same-key stale replay: synthetic HTTP PASS — HTTP 412, current snapshot/ETag, zero CAS/workflow.
- Invalid body: no idempotency row created in the synthetic harness.
- Invalidation and completion failure paths attempt reconciliation instead of intentionally leaving `processing`.

### Blocking production finding

The existing `apps/backend/src/modules/store-idempotency/service.ts` uses the label pattern `^[a-z][a-z0-9._-]{0,127}$`. A local probe against the built service showed:

- `CART_VERSION_MISMATCH` → `invalid_data`
- `CART_MUTATION_FAILED` → `invalid_data`
- `cart_version_mismatch` → accepted

The Plan requires the persisted stale failure code to be exactly `CART_VERSION_MISMATCH`. Therefore the real PostgreSQL-backed `markFailedTerminal` path cannot currently satisfy the Plan. `service.ts` is outside the 15-05 allowlist. Per the explicit governance gate, no out-of-scope edit was made and the Plan is BLOCKED pending human authorization or an approved existing-service resolution.

## Guest / Customer matrix

- Add Guest: synthetic PASS for quantities 1 and 99; ownership/capability path exercised.
- Add Customer: synthetic PASS for quantities 1 and 99; Customer authority path exercised without guest capability.
- Update Guest: synthetic PASS for quantity 2 and quantity 0 removal; decimals 1.1/98.9 rejected.
- Update Customer: synthetic PASS for quantity 0 removal and native workflow invocation.
- No Order, Stripe, Gelato, Resend, provider, network, remote PostgreSQL or remote Redis was used.

## Quantity matrix

| Operation | PASS | FAIL |
|---|---|---|
| Add | `1`, `99` | `0`, `-1`, `100`, `1.5`, `1.1`, `98.9` |
| Update | `0` removes, `1`, `99` | `-1`, `100`, `1.5`, `1.1`, `98.9` |

JSON `1.0` special rejection test: **ABSENT — CORRECT**.

## Final manifest evidence

- total: 63
- native identity: 51
- local-only: 12
- EXTENDED: 15
- DENY: 48
- PRESERVE_LEGACY: 5
- M1_ENABLED: 10
- nativeLocalExtension: 4

The two promoted line-item operations remain EXTENDED; EXTENDED was not incremented. DELETE line-item and DELETE collection were not implemented.

## Verification

- Focused units: **4 suites / 31 tests PASS**.
- Focused line-item HTTP: **3 suites / 13 tests PASS**.
- Required active-cart regression: **3 suites / 31 tests PASS** (`guest-cart-idempotency`, `guest-cart-tracer`, `customer-cart-active`).
- Lint: **PASS, 0 errors**; existing output reports 435 warnings.
- Build: **PASS**; backend and frontend build completed successfully.
- `git diff --check`: **PASS**.
- New `.skip`, `.todo` or `.only`: **NONE**.
- Worktree after implementation commits: clean.

## Scope and negative proofs

- Plan 15-06 started: **NO**.
- DELETE line item: **NOT IMPLEMENTED**.
- DELETE collection / clear-all: **NOT IMPLEMENTED**.
- New migration: **NO**.
- New idempotency state: **NO**.
- Package or lockfile change: **NO**.
- Generated OpenAPI: **UNCHANGED**; generation was not run.
- Order creation: **ZERO**.
- Capability leakage: **NONE observed in focused synthetic evidence**.
- Deploy / push / PR: **NONE**.

## Gate

`15-05: BLOCKED — HUMAN REVIEW REQUIRED`

`Task 15-05-04: AWAITING HUMAN REVIEW`

`15-06: NOT AUTHORIZED`

No further implementation, service-scope expansion, push, PR, deploy or 15-06 execution was performed.
