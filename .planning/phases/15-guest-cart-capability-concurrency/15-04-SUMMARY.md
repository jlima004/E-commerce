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
- **15-04 TECHNICAL:** FINAL REMEDIATION — PASS
- **Task 15-04-04 / B15-P-HR-02:** AWAITING HUMAN RE-REVIEW
- **15-04 HUMAN CHECKPOINT:** AWAITING HUMAN RE-REVIEW
- **Plan 15-05:** NOT AUTHORIZED
- **Remote Providers / Deploy / Push / PR:** NONE / NOT AUTHORIZED
