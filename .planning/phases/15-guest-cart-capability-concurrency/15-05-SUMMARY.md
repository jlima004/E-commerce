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

## Human Review Findings — Remediation

The original blocked execution report above is preserved. The following findings were remediated under the explicit 15-05 remediation authorization, starting from blocked HEAD `ba9885051880586ce1ce5146484cbe716c14e4cb` on the same branch.

### B15-05-HR-01 — failure_code vocabulary

Root cause: the existing lowercase label validator was also applied to the canonical Cart failure codes, rejecting required values such as `CART_VERSION_MISMATCH` and `CART_MUTATION_FAILED`. The authorized `store-idempotency/service.ts` correction now uses a dedicated structured `failure_code` validator, preserves the approved casing, rejects spaces/separators/control characters/oversized values and continues the sensitive-value sink checks. `operation`, `result_type` and `harness` retain the lowercase contract.

### B15-05-HR-02 — ownership precedence

Root cause: line-item body, path and idempotency-key validation occurred before the canonical cart ownership check. The mutation pipeline now resolves the actor, validates the minimum cart identity, refetches the active cart and enforces ownership before validating `line_id`, body or `Idempotency-Key`. Wrong-owner requests therefore fail closed without a claim or workflow invocation.

### B15-05-HR-03 — terminal CAS lost

Root cause: the `markFailedTerminal` result was ignored on terminal error exits. The mutation pipeline now checks every lifecycle result, including retryable failure, stale-result recording, terminalization, reconciliation and completion. A lost CAS returns the canonical retryable 409 `IDEMPOTENCY_KEY_IN_PROGRESS`; it never fabricates a 412 or success response. The stale path passes the state-version returned by `recordProcessingResult` into terminalization.

### B15-05-HR-04 — Customer authority evidence

Root cause: the Customer HTTP harness injected `req.customerAuth` directly instead of exercising the approved Authorization-to-PostgreSQL authority path. The harness now issues a real customer access JWT, creates synthetic lineage/credential rows, passes `Authorization: Bearer ...`, and resolves authority through the PostgreSQL-backed query seam. Positive, invalid-Authorization, unavailable-authority and wrong-owner negative paths assert claim/workflow suppression.

## Human Review Remediation

- Scope expansion used: only the authorized `store-idempotency/service.ts`, canonical StoreIdempotency test, line-item mutation source and the three 15-05 HTTP test surfaces were changed. No migration or schema change was made.
- Harness/model: Codex / GPT-5; no subagents exposed; A → B → C → D executed sequentially with `parallelization=false`, `auto-chain=false` and `auto_advance=false`.
- Remediation commits: `0ca6337` (`failure_code` contract), `350abe9` (ownership/lifecycle fail-closed behavior), `10b2e0e` (Customer PostgreSQL authority evidence).
- Evidence: failure-code unit **16/16 PASS**; altered/service focused units **6 suites / 134 tests PASS**; 15-05 focused units **4 suites / 31 tests PASS**; line-item HTTP **3 suites / 26 tests PASS**; active-cart regressions **3 suites / 31 tests PASS**; canonical disposable-PostgreSQL StoreIdempotency **1 suite / 18 tests PASS**.
- Build and lint: **PASS** with zero lint errors (repository warnings retained); `git diff --check`: **PASS**; no new `.skip`, `.todo` or `.only`.
- Negative scope proof: Plan 15-06 was not executed; no OpenAPI generation, Order, provider/network, migration, package/lockfile, push, PR or deploy action occurred.

## Remediation Gate

`15-05 TECHNICAL: REMEDIATED — PASS`

`Task 15-05-04: AWAITING HUMAN RE-REVIEW`

`Plan 15-05: REMEDIATED — AWAITING HUMAN RE-REVIEW`

`15-06: NOT AUTHORIZED`

Technical remediation is complete, but no human re-review or approval is implied by this record.

## Second Human Re-Review Findings

### B15-05-HR-05 — Guest capability is not bound to target cart ID

Root cause: `resolveM1CartActor` correctly derived `actor.cartId` from
`capabilityRecord.cart_id`, but `assertActorOwnsCart` only rejected a Guest cart
owned by a Customer. A valid capability for Guest Cart A could therefore reach
Guest Cart B supplied by the path. The `{id}` path and `Idempotency-Key` are not
ownership authorities.

### B15-05-HR-06 — Line-item idempotency operations have no finite lifecycle executor

Root cause: the lifecycle worker had exact handling for
`store.carts.active.create` and the Phase-13 harness operations only. The
line-item operations `store.carts.line-items.add` and
`store.carts.line-items.update` were classified as unsupported, leaving stale
`processing` or `failed_retryable` rows without a finite, operation-specific
disposition.

### B15-05-HR-07 — Shipping invalidation no-op seams are not invoked by default runtime

Root cause: quote and selection hooks used optional chaining. The real mutation
runtime injects only `paymentAttemptModule`, so both Phase-15 shipping no-op seams
were skipped instead of being traversed after PaymentAttempt invalidation.

## Second Human Re-Review Remediation

- Harness/model: Codex / GPT-5. No subagents were used or invented; A → B → C → D ran sequentially with `parallelization=false`, `auto-chain=false` and `auto_advance=false`.
- Authorized base: `PLAN15_05_REMEDIATION2_BASE_SHA=e8f8c53c5e9179522e8228d24d58f260d1e7a2f9` on `gsd/phase-15-guest-cart-capability-concurrency`, with clean initial worktree.
- Guest authority: `assertActorOwnsCart` now requires `cart.id === actor.cartId` and still rejects Customer-owned carts. The discriminating HTTP tests use distinct carts A and B, prove A != B, return uniform 404 for capability A → path B, and observe zero claim, zero CAS, zero workflow, zero CART-09 and zero mutation. Positive A → A remains allowed for add and update.
- Canonical operations: the two line-item operation constants now belong to the narrow StoreIdempotency `operations.ts` owner and are consumed by both the API mutation pipeline and lifecycle worker. No API→job dependency was introduced.
- `processing`: stale exact add/update rows transition only after `listDue → claimLifecycleRow`; known cart pointers are preserved and null pointers remain null. Both dispositions become `reconciliation_required` with `stale_store_cart_line_item_partial_effect` or `stale_store_cart_line_item_uncertain_effect`.
- `failed_retryable`: below the existing attempts/time caps, exact add/update rows become `reconciliation_required`; at or above a cap they become `failed_terminal`. The worker never returns them to `processing` and never retries a Medusa mutation workflow.
- Finite lifecycle: add is explicitly proven as `processing → reconciliation_required → reconciliation_unresolved`; the same exact dispatcher covers update. Claim loss performs no transition; transition loss increments `failed_items` and is not counted as transitioned. The transition uses the claimed N+1 `state_version`, never the listed N.
- Negative lifecycle proof: fake suffixes and the bare prefix remain unsupported; the worker has zero `addToCartWorkflow` calls, zero `updateLineItemInCartWorkflow` calls, zero provider calls and zero network calls. Existing `store.carts.active.create` behavior remains unchanged and green.
- CART-09: production defaults now contain real local no-op functions for shipping quote and selection. The shared runner always executes PaymentAttempt → quote → selection; injected overrides remain supported. The testable default resolver uses no global mutable counter. Network and Gelato remain absent.
- Regression status: HR-01 uppercase-safe failure codes PASS; HR-02 ownership-before-validation PASS; HR-03 terminal CAS-lost fail-closed PASS; HR-04 Customer Authorization → PostgreSQL authority PASS. Success replay, stale 412 replay, quantity rules, quantity 0 removal and the native workflows-inside-CAS contract remain green.
- Manifest remains total 63, native identity 51, local-only 12, EXTENDED 15, DENY 48, PRESERVE_LEGACY 5, M1_ENABLED 10 and nativeLocalExtension 4. DELETE line item remains DENY; DELETE collection remains not implemented.
- RED evidence: capability A → cart B resolved instead of returning 404; lifecycle constants/dispatcher were absent; shipping default runner was absent. GREEN evidence followed without broad refactor.
- Lifecycle unit: **1 suite / 42 tests PASS**.
- Shipping unit: **1 suite / 3 tests PASS**.
- StoreIdempotency failure-code: **1 suite / 16 tests PASS**.
- 15-05 focused units: **4 suites / 33 tests PASS**.
- Line-item HTTP: **3 suites / 30 tests PASS**.
- Active-cart regressions: **3 suites / 31 tests PASS**.
- Build: **PASS** (backend and frontend). Lint: **PASS, 0 errors / 439 repository warnings**. `git diff --check`: **PASS**. New `.skip`, `.todo` or `.only`: **NONE**.
- `B15-05 SECOND REMEDIATION ADVERSARIAL REVIEW`: **PASS**. The review found no prefix match, blind retry, heuristic cart lookup, lost-pointer synthesis, listed-version reuse, workflow/provider/network dependency, CART-09 order regression, HR-01..04 regression or scope expansion.
- Scope proof: no migration, new state, schema change, package/lockfile change, DELETE implementation, 15-06 execution, OpenAPI generation/artifact change, remote PostgreSQL/Redis, Stripe, Gelato, Resend, network, Order, deploy, push or PR.

`15-05 TECHNICAL: SECOND REMEDIATION — PASS`

`Task 15-05-04: AWAITING HUMAN RE-REVIEW`

`Plan 15-05: REMEDIATED — AWAITING HUMAN RE-REVIEW`

`15-06: NOT AUTHORIZED`

This technical PASS stops at the named human re-review checkpoint and does not
constitute human approval or authorization for any later plan.
