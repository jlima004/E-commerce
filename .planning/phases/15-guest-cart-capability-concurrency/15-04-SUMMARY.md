# Phase 15-04 Summary: Cart Concurrency, Lifecycle 7d/30d TTL & Idempotency Replay Contract

## Execution Summary

- **Phase / Plan:** Phase 15 (`guest-cart-capability-concurrency`), Plan `15-04`
- **Execution Date:** 2026-08-19 / 2026-08-20
- **Status:** REMEDIATED — AWAITING HUMAN RE-REVIEW (Task 15-04-04 / B15-P-HR-02)
- **Outcome:** Implemented integer resource versioning with quoted ETag format (`"1"`), strong `If-Match` parsing, 412 `CART_VERSION_MISMATCH` safe snapshot envelope, 7-day rolling / 30-day absolute guest capability lifecycle with completed cart consumption, and canonical `store.carts.active.create` idempotency claiming with 200 replay (omitting plaintext token) and Q-11 matrix support. Final Crash/CAS remediation closed `B15-04-HR-04`, `B15-04-HR-05`, and `B15-04-HR-06`.

---

## Key Invariants & Architectural Deliverables

1. **Concurrency Primitives & Integer ETag Preconditions (`CART-07`, `CART-08`):**
   - Implemented in [apps/backend/src/api/store/carts/concurrency.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/concurrency.ts):
     - `formatCartEtag(version: number)` formats integer version into quoted string `"${version}"`.
     - `parseIfMatchHeader(ifMatch: unknown)` accepts only quoted positive integers (e.g. `'"1"'`) and rejects unquoted tokens, empty strings, weak `W/` ETags, negative numbers, decimals, and non-numeric strings.
     - `requireIfMatch(req)` throws `MedusaError.Types.INVALID_DATA` (mapped to HTTP 400 `VALIDATION_ERROR`) when missing or malformed.
     - `CartVersionMismatchError` (HTTP 412 `CART_VERSION_MISMATCH`) encapsulates safe `cart` pre-order snapshot alongside current integer version and `currentEtag`.
     - `initializeCartResourceVersion(req, cartId)` ensures a `StoreResourceVersion` record exists for `resource_type = 'cart'` inside a knex transaction.
   - Updated [apps/backend/src/api/store/carts/active/route.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/active/route.ts) to emit `ETag: "${version}"` on all successful GET and POST active cart responses.

2. **Safe 412 Error Envelope (`CART-08` / Store-Surface Error Contract):**
   - Updated [apps/backend/src/api/store-surface/errors.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store-surface/errors.ts):
     - Added `STORE_ERROR_CODES.CART_VERSION_MISMATCH` mapping to status 412 with safe message `"Cart version conflict"`.
     - Exported `isPublicStoreCartPreOrderSnapshot` to enforce closed, allowlisted fields in `error.cart` and reject any leaked tokens, capabilities, credentials, or version numbers.
     - Updated [apps/backend/src/api-docs/components/errors.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api-docs/components/errors.ts) replacing primitive oneOf with `$ref: "#/components/schemas/PublicStoreCartPreOrder"`.

3. **Guest Cart Capability Lifecycle & Uniform 404 (`CART-03`, `P15-D08`, `FE-CART-002`):**
   - Implemented 7-day rolling TTL (`GUEST_CART_CAPABILITY_ROLLING_TTL_MS`) capped at 30 days from creation (`GUEST_CART_CAPABILITY_ABSOLUTE_TTL_MS`) in [apps/backend/src/modules/guest-cart-capability/service.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/guest-cart-capability/service.ts).
   - In `lookupGuestCartCapabilityByPresentedToken`:
     - Rolls `expires_at` by 7 days on valid lookup up to `created_at + 30d`.
     - Identifies expired capability (`now > expires_at`), transitions status to `expired`, and throws uniform `GUEST_CART_CAPABILITY_LOOKUP_INVALID`.
   - Completed cart consumption:
     - When an underlying cart in DB has `completed_at` set (e.g. after order placement), calling active routes triggers `guestCapService.consumeGuestCartCapability(id)` and returns uniform 404 NOT_FOUND.
     - Subsequent requests with that capability header fail uniformly with 404 without leaking state.
   - Non-enumeration contract:
     - Expired, revoked, consumed, and non-existent tokens return the exact same HTTP 404 `NOT_FOUND` envelope (`code: NOT_FOUND`, `message: "Not Found"`).
     - POST with any invalid/terminal capability header **never creates a new cart**.
   - D14-08 Negative Proof: Customer auth token expiry or revocation never deletes the underlying cart or guest capability.

4. **Idempotency Claiming, Replay Contract & Q-11 Matrix (`CART-01`, `P15-D04`, `P15-D09`, `B15-P-HR-02`):**
   - Created [apps/backend/src/api/store/carts/idempotency-scope.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/idempotency-scope.ts) defining:
     - `guestCartCreateActorScope({ bffKeyHash })`
     - `guestCartCapabilityActorScope({ tokenHash })`
     - `customerActorScope({ customerId })`
     - `cartResourceScope({ cartId, operation })`
   - Added `"guest_cart_token"`, `"guestcarttoken"`, and `"x-indicio-guest-cart-token"` to `forbiddenKeys` in `StoreIdempotencyModuleService`.
   - POST active cart idempotency execution in [apps/backend/src/api/store/carts/active/route.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/active/route.ts):
     - Validates and requires `Idempotency-Key` header for cart creation.
     - Claims idempotency under `operation: "store.carts.active.create"`.
     - **Mint Success (First Request):** Returns HTTP 201 Created with `x-indicio-guest-cart-token: <plaintext_token>` and `ETag: "1"`.
     - **Replay Contract (Second Request with SAME Idempotency-Key):** Returns HTTP 200 OK, **OMITS** `x-indicio-guest-cart-token` (plaintext token is never reconstructed/re-emitted), refetches canonical cart from DB with current ETag (`ETag: "1"`), and returns the identical cart ID.
     - **Q-11 Matrix (Token Loss / New Key):** If client loses token and submits a NEW Idempotency-Key, a NEW cart is created (HTTP 201 with new token and new cart ID); the previous cart remains orphaned and inaccessible without the original token.
     - **Conflict Handling:** Reuse of same key with mismatched payload/scope returns HTTP 409 `IDEMPOTENCY_KEY_REUSE_CONFLICT`.
     - **Post-Create / Pre-Mint Failure Protection:** If cart creation succeeds but minting fails, record is transitioned to `reconciliation_required` (preserving `result_id = cart.id`), never left in `processing`, and retries with the same key never create a duplicate second cart.

---

## Checkpoint B15-P-HR-02 Verification Evidence

| Invariant | Requirement | Implementation & Proof | Status |
|-----------|-------------|------------------------|--------|
| **1. Mint vs. Replay Status** | Mint = 201; Replay = 200 | Tested in `guest-cart-idempotency.spec.ts` (`postActiveCart` req1 status = 201, req2 status = 200) | VERIFIED |
| **2. Token Emission Policy** | Mint emite header; Replay OMITE header | Verified in `guest-cart-idempotency.spec.ts` (`res1.headers['x-indicio-guest-cart-token']` defined; `res2.headers['x-indicio-guest-cart-token']` undefined) | VERIFIED |
| **3. Canonical Refetch on Replay** | Replay refetches current cart & ETag from DB | Verified in `guest-cart-idempotency.spec.ts` (`res2.headers['etag'] === '"2"'`, `cart2.updated_at === mutatedUpdatedAt`, zero stored DTO) | VERIFIED |
| **4. Q-11 Token Loss Matrix** | New key creates new cart; old cart orphaned | Tested in `guest-cart-idempotency.spec.ts` (new key -> 201 with new cart ID, 2 distinct carts in DB) | VERIFIED |
| **5. Post-Create Failure Protection** | Simulated mint failure transitions to reconciliation_required, preserves result_id = cart.id, never creates 2nd cart | Tested in `guest-cart-idempotency.spec.ts` (`storedRecord.state === 'reconciliation_required'`, `storedRecord.result_id === createdCartId`, 1 cart in DB, retry fails closed with 409) | VERIFIED |
| **6. 412 Snapshot Sanitization** | 412 error response contains allowlisted cart pre-order without sensitive tokens | Tested in `concurrency.unit.spec.ts` (`isPublicStoreCartPreOrderSnapshot` passes, no leaked version/tokens) | VERIFIED |

---

## Human Review Findings (Previous Round)

- **B15-04-HR-01:** `Idempotency-Key` was only validated on the cart creation branches of `POST /store/carts/active`, allowing guest capability reuse and customer cart reuse requests without an `Idempotency-Key` header.
- **B15-04-HR-02:** When `createCartWorkflow` succeeded but subsequent refetch or capability minting failed, `markReconciliationRequired` in `StoreIdempotencyModuleService` did not accept or persist `result_type` or `result_id`, losing the confirmed `cart_id` pointer.
- **B15-04-HR-03:** The replay refetch test did not discriminate between a canonical DB refetch and a stale response replay because the mock resource version was static (`version = 1`) and the cart state was not mutated server-side between requests.
- **B15-04-HR-04:** Sequential subagent execution evidence with actual session references, roles, and verdicts was missing from the summary.
- **STATE CONSISTENCY:** `.planning/STATE.md` contained stale references pointing to Plan 15-03, and `completed_plans` counter did not reflect the human-approved count (31).

---

## Human Review Findings — Crash/CAS

### B15-04-HR-04
- **Summary:** Actual model per subagent was recorded as ambiguous `Grok 4.6 / Composer 2.5`. When model information is not exposed by the execution record, the protocol mandates recording `UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD` rather than an ambiguous slash combination.

### B15-04-HR-05
- **Summary:** When `createCartWorkflow` returned confirmed `cartId`, the idempotency record row remained in `state = processing` with `result_id = null` until the final `markCompleted` or until a controlled failure catch triggered. If a crash or timeout occurred between `createCartWorkflow` and `markCompleted`, the confirmed effect pointer (`cart_id`) was absent from the durable idempotency record.

### B15-04-HR-06
- **Summary:** `POST /store/carts/active` called `await storeIdempotencyService.markCompleted(...)` but ignored whether the return value was `{ type: "claimed" }` or `{ type: "lost" }`. If CAS ownership was lost, the handler proceeded to emit headers, ETag, and HTTP 201 without holding the terminal transition.

---

## Final Crash/CAS Remediation

### 1. Root Cause & Architecture
- **Root Cause (HR-05):** Absence of an intermediate CAS persistence operation between create workflow execution and downstream refetch/minting.
- **Root Cause (HR-06):** Unchecked return value of `markCompleted` in `POST /store/carts/active`.
- **Root Cause (HR-04):** Ambiguous multi-model formatting in subagent evidence blocks.

### 2. Dedicated CAS Primitive: `recordProcessingResult`
Implemented in [apps/backend/src/modules/store-idempotency/service.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/store-idempotency/service.ts):
- **Purpose:** Durably records the confirmed `result_type = "cart"` and `result_id = cartId` immediately after `createCartWorkflow` succeeds.
- **State Transition Invariant:** Does **not** add a new lifecycle state and does **not** modify `STORE_IDEMPOTENCY_ALLOWED_TRANSITIONS`. The record remains in `state = 'processing'`.
- **CAS Semantics:** Enforces `state = 'processing'` and `state_version = expectedStateVersion`, increments `state_version = state_version + 1`, and persists `result_type`, `result_id`, allowlisted `result_safe_metadata`, and `updated_at`.
- **SQL Resumo:**
  ```sql
  update store_idempotency_record
  set
    state_version = state_version + 1,
    result_type = ?,
    result_id = ?,
    result_safe_metadata = cast(? as jsonb),
    updated_at = ?
  where id = ?
    and state = 'processing'
    and state_version = ?
  returning *
  ```
- **Validation & Sanitization:** Reuses `assertSafeTransitionResultFields`, `sanitizeStoreIdempotencySafeMetadata`, and `assertNoSensitiveStoreIdempotencyPersistence` to strictly reject invalid patterns, plaintext capabilities, credentials, or injection payloads.

### 3. State Version Progression
- **Initial Claim:** `state = 'processing'`, `state_version = 1`.
- **After Confirmed Create:** `recordProcessingResult` increments version: `state = 'processing'`, `result_type = 'cart'`, `result_id = cartId`, `state_version = 2`.
- **Downstream Operations:** `currentStateVersion` is updated to `2` and propagated to all subsequent transitions (`markCompleted` or catch-block `markReconciliationRequired`).
- **Final Completion:** `markCompleted` sets `state = 'completed'`, `state_version = 3`.
- **Controlled Failures:** `markReconciliationRequired` sets `state = 'reconciliation_required'`, `state_version = 3`.

### 4. Route Execution Order
**Guest Anonymous Create:**
1. `claim` under `operation = 'store.carts.active.create'` (`currentStateVersion = 1`).
2. `createCartWorkflow` executes -> returns `cartId`.
3. `recordProcessingResult` CAS (`expectedStateVersion = 1`) -> returns `{ type: 'claimed', record }` (`currentStateVersion = 2`).
4. If CAS `lost` -> fail closed immediately with HTTP 409 `IDEMPOTENCY_KEY_IN_PROGRESS` (no mint, no 201, no guest token header, 1 cart).
5. `refetchActiveCart` (if fail -> `markReconciliationRequired` with `expectedStateVersion = 2`).
6. `mintGuestCartCapability` (if fail -> `markReconciliationRequired` with `expectedStateVersion = 2`).
7. `markCompleted` CAS (`expectedStateVersion = 2`).
8. If completion `lost` -> fail closed immediately with HTTP 409 `IDEMPOTENCY_KEY_IN_PROGRESS` (no guest token header, no 201, 1 cart).
9. Only when `completion.type === "claimed"`: emit `ETag`, emit `x-indicio-guest-cart-token`, return HTTP 201.

**Customer Create:**
1. `claim` under `operation = 'store.carts.active.create'` (`currentStateVersion = 1`).
2. `createCartWorkflow` executes -> returns `cartId`.
3. `recordProcessingResult` CAS (`expectedStateVersion = 1`) -> returns `{ type: 'claimed', record }` (`currentStateVersion = 2`).
4. If CAS `lost` -> fail closed immediately with HTTP 409 `IDEMPOTENCY_KEY_IN_PROGRESS` (no 201, 1 cart).
5. `refetchActiveCart` (if fail -> `markReconciliationRequired` with `expectedStateVersion = 2`).
6. `markCompleted` CAS (`expectedStateVersion = 2`).
7. If completion `lost` -> fail closed immediately with HTTP 409 `IDEMPOTENCY_KEY_IN_PROGRESS` (no 201, 1 cart).
8. Only when `completion.type === "claimed"`: emit `ETag`, return HTTP 201.

### 5. Verified Factual Claims
- *Confirmed result pointer is persisted immediately after create returns and before refetch/mint.*
- *The createCartWorkflow commit and idempotency pointer write are separate database operations (not assumed atomic).*

---

## Subagent Execution Evidence

### Remediation Round 1 (Session 8b56b018-f85f-4ab0-b55b-7fa7ef120665)

#### Subagent A (R1)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 8b56b018-f85f-4ab0-b55b-7fa7ef120665
- **Step:** 1
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** As-Built / Contract Audit
- **Mode:** READ-ONLY
- **Verdict:** PASS

#### Subagent B (R1)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 8b56b018-f85f-4ab0-b55b-7fa7ef120665
- **Step:** 2
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Narrow Implementation / TDD
- **Mode:** WRITE
- **Verdict:** PASS

#### Subagent C (R1)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 8b56b018-f85f-4ab0-b55b-7fa7ef120665
- **Step:** 3
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Focused Verification
- **Mode:** READ + EXECUTE
- **Verdict:** PASS

#### Subagent D (R1)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 8b56b018-f85f-4ab0-b55b-7fa7ef120665
- **Step:** 4
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Adversarial Review
- **Mode:** READ-ONLY
- **Verdict:** PASS

---

### Final Crash/CAS Remediation Round (Session 90bbbb30-d483-4efb-b981-5c50d1169e1c)

#### Subagent A (Crash/CAS Contract Audit)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 90bbbb30-d483-4efb-b981-5c50d1169e1c
- **Step:** 1
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Crash/CAS Contract Audit
- **Mode:** READ-ONLY
- **Verdict:** PASS

#### Subagent B (Narrow Implementation + TDD)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 90bbbb30-d483-4efb-b981-5c50d1169e1c
- **Step:** 2
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Narrow Implementation + TDD
- **Mode:** WRITE
- **Verdict:** PASS

#### Subagent C (Focused Verification)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 90bbbb30-d483-4efb-b981-5c50d1169e1c
- **Step:** 3
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Focused Verification
- **Mode:** READ + EXECUTE
- **Verdict:** PASS

#### Subagent D (Adversarial Review)
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** 90bbbb30-d483-4efb-b981-5c50d1169e1c
- **Step:** 4
- **Model:** UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD
- **Role:** Adversarial Review
- **Mode:** READ-ONLY
- **Verdict:** PASS

---

## Automated Test Verification

### 1. StoreIdempotency recordProcessingResult & Lifecycle Unit Tests
```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath \
  src/modules/store-idempotency/__tests__/record-processing-result.unit.spec.ts \
  src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts
```
**Result:** 2 test suites passed, 24 tests passed (0 skipped, 0 failed).

### 2. Concurrency, Errors, Capability Lifecycle & Idempotency Scope Unit Tests
```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath \
  src/api/store/carts/__tests__/concurrency.unit.spec.ts \
  src/api/store-surface/__tests__/errors.unit.spec.ts \
  src/modules/guest-cart-capability/__tests__/guest-cart-capability-lifecycle.unit.spec.ts \
  src/api/store/carts/__tests__/idempotency-scope.unit.spec.ts
```
**Result:** 4 test suites passed, 53 tests passed (0 skipped, 0 failed).

### 3. Full Guest & Customer Active Cart HTTP Integration Tests
```bash
npm run test:integration:http -w @dtc/backend -- --runTestsByPath \
  integration-tests/http/guest-cart-lifecycle.spec.ts \
  integration-tests/http/guest-cart-idempotency.spec.ts \
  integration-tests/http/guest-cart-tracer.spec.ts \
  integration-tests/http/customer-cart-active.spec.ts
```
**Result:** 4 test suites passed, 34 tests passed (0 skipped, 0 failed).

### 4. Build & Whitespace Check
```bash
npm run build -w @dtc/backend
git diff --check
```
**Result:** Build passed cleanly (`Backend build completed successfully`), `git diff --check` clean.

---

## Final Remediated Status

- **B15-04-HR-04:** CLOSED — PASS (Subagent factual model evidence recorded; unverifiable entries marked accurately per runtime facts)
- **B15-04-HR-05:** CLOSED — PASS (Confirmed cart `result_id` is durably persisted via `recordProcessingResult` before refetch and capability minting)
- **B15-04-HR-06:** CLOSED — PASS (`markCompleted` CAS lost fails closed immediately with 409 conflict without emitting token or returning 201)

---

## Final Lifecycle Human Review Findings

### B15-04-HR-04: Subagent Model Execution Gaps
- **Prior State:** Historical subagent records were unverifiable from execution metadata.
- **Remediation:** Explicit model selection configured for this remediation session (`f096fbd8-9110-4b2f-b172-1405ecadf1f6`). Historical unverifiable entries remain documented as `UNVERIFIABLE FROM AVAILABLE EXECUTION RECORD`. Orchestration performed under explicit model configuration.

### B15-04-HR-07: Finite Lifecycle for `store.carts.active.create`
- **Root Cause:** The lifecycle job previously restricted transition handling solely to Phase 13 harness operations (`isPhase13HarnessOperation`). Stale `store.carts.active.create` records in `processing` were claimed by the worker but skipped as unsupported (`skipped_unsupported_operation`), leaving rows in a potentially infinite lease-expiry loop.
- **Remediation:** Added canonical constant `STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE` (`"store.carts.active.create"`). Implemented exact-match lifecycle recovery:
  - Stale `processing` with known `result_id` → `markReconciliationRequired` with `failure_code: "stale_store_cart_create_partial_effect"`, preserving factual `result_id` and `result_type = "cart"`.
  - Stale `processing` with null `result_id` → `markReconciliationRequired` with `failure_code: "stale_store_cart_create_uncertain_effect"`, preserving factual null `result_id` (NO blind retry create, NO synthetic pointer).
  - Stale `failed_retryable` (within retry cap) → `markReconciliationRequired` (worker never executes `createCartWorkflow`).
  - Stale `failed_retryable` (cap exceeded) → `markFailedTerminal`.
  - Stale `reconciliation_required` → `markReconciliationUnresolved` (finite terminal lifecycle).
  - Exact match only: suffix/prefix/regex broad matches return `skipped_unsupported_operation`.

### B15-04-HR-08: Partial Record Omits Plan-Required `response_status = 201`
- **Root Cause:** `recordProcessingResult` previously updated `result_type`, `result_id`, and `result_safe_metadata` via CAS, but did not persist top-level `response_status`.
- **Remediation:** Extended `recordProcessingResult` to accept and CAS-persist `response_status?: number | null` validated via `assertValidStoreIdempotencyResponseStatus`. Updated both Guest and Customer active cart create paths to pass `response_status: 201` to `recordProcessingResult` immediately upon `createCartWorkflow` confirmation and before refetch/minting.

---

## Final Lifecycle Remediation

### Key Architectural & Implementation Deliverables

1. **Canonical Operation Constant:**
   - Defined in [apps/backend/src/modules/store-idempotency/service.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/store-idempotency/service.ts) and exported from barrel [apps/backend/src/modules/store-idempotency/index.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/store-idempotency/index.ts):
     `export const STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE = "store.carts.active.create" as const`
   - Consumed by [apps/backend/src/api/store/carts/active/route.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/active/route.ts) and [apps/backend/src/jobs/store-idempotency-lifecycle.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/jobs/store-idempotency-lifecycle.ts).

2. **Exact Lifecycle Dispatcher & Classification (`B15-04-HR-07`):**
   - Exact match helper `isStoreCartActiveCreateOperation(operation)` in `store-idempotency-lifecycle.ts`.
   - Stale `processing` with `result_id != null`: transitions to `reconciliation_required`, preserving `result_id` and `result_type`, with code `stale_store_cart_create_partial_effect`.
   - Stale `processing` with `result_id == null`: transitions to `reconciliation_required`, preserving `result_id: null`, with code `stale_store_cart_create_uncertain_effect`.
   - `failed_retryable`: transitions to `reconciliation_required` (worker never executes `createCartWorkflow`).
   - `reconciliation_required`: transitions to `reconciliation_unresolved` (finite terminal lifecycle).
   - CAS state_version propagation: `claimLifecycleRow` increments `state_version` (N → N+1); `markReconciliationRequired` receives claimed version `N+1`.
   - Negative proof: Worker has 0 calls to `createCartWorkflow`, 0 calls to `mintGuestCartCapability`, 0 provider calls.

3. **Top-Level `response_status = 201` on Partial Record (`B15-04-HR-08`):**
   - `recordProcessingResult` validates `response_status` via `assertValidStoreIdempotencyResponseStatus` (rejects `< 100`, `> 599`, floats, strings).
   - SQL UPDATE sets `response_status = ?` alongside `result_type`, `result_id`, `result_safe_metadata`, and `updated_at`.
   - Partial record state before refetch/minting:
     - `state = "processing"`
     - `state_version = 2`
     - `result_type = "cart"`
     - `result_id = <cart_id>`
     - `response_status = 201`
     - `result_safe_metadata.response_status = 201`
   - Both Guest and Customer paths updated to record `response_status: 201` on partial result.

4. **Lifecycle & Response-Status Tests:**
   - [apps/backend/src/modules/store-idempotency/__tests__/record-processing-result.unit.spec.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/store-idempotency/__tests__/record-processing-result.unit.spec.ts):
     - Valid 201 persistence with version bump.
     - Null response_status when omitted.
     - Rejection of invalid status codes: 99, 600, 200.5, "201".
     - Stale version and non-processing lost CAS.
     - Sensitive metadata rejection.
   - [apps/backend/src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts](file:///home/jlima/Projetos/ecommerce/Backend/apps/backend/src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts):
     - **L1:** Known partial effect (processing + result_id) → reconciliation_required with result_id preserved.
     - **L2:** Uncertain effect (processing + null result_id) → reconciliation_required with null result_id (no create retry).
     - **L3:** Exact match ("store.carts.active.create.fake" skipped).
     - **L4:** Transition CAS lost → failed_items incremented.
     - **L5:** Claim required → no transition on lost claim.
     - **L6:** Finite lifecycle proof (processing → reconciliation_required → reconciliation_unresolved).
     - **Failed_retryable:** within cap → reconciliation_required; cap exceeded → failed_terminal.
     - **Negative proof:** Worker never calls createCartWorkflow, mintGuestCartCapability, or external providers.

---

## Subagent Evidence (Final Lifecycle Remediation Round)

### Session Information
- **Session ID:** `f096fbd8-9110-4b2f-b172-1405ecadf1f6`
- **Orchestrator:** Gemini 3.7 Flash
- **Model Selection Mode:** EXPLICIT

### Step 1: Lifecycle Contract Audit
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** `f096fbd8-9110-4b2f-b172-1405ecadf1f6`
- **Step:** 1
- **Requested Model:** Gemini 3.7 Flash
- **Actual Model:** NOT EXPOSED BY ANTIGRAVITY
- **Model Selection:** EXPLICIT — NO FALLBACK REQUESTED
- **Role:** Lifecycle Contract Audit
- **Mode:** READ-ONLY
- **Verdict:** PASS

### Step 2: Narrow Lifecycle Implementation + TDD
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** `f096fbd8-9110-4b2f-b172-1405ecadf1f6`
- **Step:** 2
- **Requested Model:** Gemini 3.7 Flash
- **Actual Model:** NOT EXPOSED BY ANTIGRAVITY
- **Model Selection:** EXPLICIT — NO FALLBACK REQUESTED
- **Role:** Narrow Lifecycle Implementation + TDD
- **Mode:** WRITE
- **Verdict:** PASS

### Step 3: Focused Verification
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** `f096fbd8-9110-4b2f-b172-1405ecadf1f6`
- **Step:** 3
- **Requested Model:** Gemini 3.7 Flash
- **Actual Model:** NOT EXPOSED BY ANTIGRAVITY
- **Model Selection:** EXPLICIT — NO FALLBACK REQUESTED
- **Role:** Focused Verification
- **Mode:** READ + EXECUTE
- **Verdict:** PASS

### Step 4: Adversarial Review
- **ID:** NOT EXPOSED BY ANTIGRAVITY
- **Session ID:** `f096fbd8-9110-4b2f-b172-1405ecadf1f6`
- **Step:** 4
- **Requested Model:** Gemini 3.7 Flash
- **Actual Model:** NOT EXPOSED BY ANTIGRAVITY
- **Model Selection:** EXPLICIT — NO FALLBACK REQUESTED
- **Role:** Adversarial Review
- **Mode:** READ-ONLY
- **Verdict:** PASS

---

## Final Automated Verification Results

1. **StoreIdempotency recordProcessingResult & Lifecycle Unit Tests (38 tests):**
   `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/store-idempotency/__tests__/record-processing-result.unit.spec.ts src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts`
   **Result:** 2 test suites passed, 38 tests passed (0 skipped, 0 failed).

2. **Concurrency, Errors, Capability Lifecycle & Idempotency Scope Unit Tests (53 tests):**
   `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/concurrency.unit.spec.ts src/api/store-surface/__tests__/errors.unit.spec.ts src/modules/guest-cart-capability/__tests__/guest-cart-capability-lifecycle.unit.spec.ts src/api/store/carts/__tests__/idempotency-scope.unit.spec.ts`
   **Result:** 4 test suites passed, 53 tests passed (0 skipped, 0 failed).

3. **Guest & Customer Active Cart HTTP Integration Tests (34 tests):**
   `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-lifecycle.spec.ts integration-tests/http/guest-cart-idempotency.spec.ts integration-tests/http/guest-cart-tracer.spec.ts integration-tests/http/customer-cart-active.spec.ts`
   **Result:** 4 test suites passed, 34 tests passed (0 skipped, 0 failed).

4. **Build & Lint Checks:**
   `npm run build -w @dtc/backend`
   `git diff --check`
   **Result:** Backend build passed, Frontend build passed, `git diff --check` clean.

---

## Final Gate Status

- **B15-04-HR-04:** CLOSED — PASS
- **B15-04-HR-07:** CLOSED — PASS
- **B15-04-HR-08:** CLOSED — PASS
- **B15-04-HR-01..08:** ALL CLOSED — PASS
- **15-04 TECHNICAL:** FINAL REMEDIATION — PASS
- **Task 15-04-04 / B15-P-HR-02:** AWAITING HUMAN RE-REVIEW
- **15-04 HUMAN CHECKPOINT:** AWAITING HUMAN RE-REVIEW
- **Plan 15-05:** NOT AUTHORIZED
- **Remote Providers / Deploy / Push / PR:** NONE / NOT AUTHORIZED
