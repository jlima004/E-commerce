# Phase 15-04 Summary: Cart Concurrency, Lifecycle 7d/30d TTL & Idempotency Replay Contract

## Execution Summary

- **Phase / Plan:** Phase 15 (`guest-cart-capability-concurrency`), Plan `15-04`
- **Execution Date:** 2026-08-19
- **Status:** COMPLETED — READY FOR HUMAN REVIEW CHECKPOINT (Task 15-04-04 / B15-P-HR-02)
- **Outcome:** Implemented integer resource versioning with quoted ETag format (`"1"`), strong `If-Match` parsing, 412 `CART_VERSION_MISMATCH` safe snapshot envelope, 7-day rolling / 30-day absolute guest capability lifecycle with completed cart consumption, and canonical `store.carts.active.create` idempotency claiming with 200 replay (omitting plaintext token) and Q-11 matrix support.

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
| **3. Canonical Refetch on Replay** | Replay refetches current cart & ETag from DB | Verified in `guest-cart-idempotency.spec.ts` (`res2.headers['etag'] === '"1"'`, `cart2.id === cart1.id`, zero stored DTO) | VERIFIED |
| **4. Q-11 Token Loss Matrix** | New key creates new cart; old cart orphaned | Tested in `guest-cart-idempotency.spec.ts` (new key -> 201 with new cart ID, 2 distinct carts in DB) | VERIFIED |
| **5. Post-Create Failure Protection** | Simulated mint failure transitions to reconciliation_required, never creates 2nd cart | Tested in `guest-cart-idempotency.spec.ts` (`storedRecord.state === 'reconciliation_required'`, 1 cart in DB, retry fails closed with 409) | VERIFIED |
| **6. 412 Snapshot Sanitization** | 412 error response contains allowlisted cart pre-order without sensitive tokens | Tested in `concurrency.unit.spec.ts` (`isPublicStoreCartPreOrderSnapshot` passes, no leaked version/tokens) | VERIFIED |

---

## Automated Test Verification

### 1. Concurrency & Error Envelope Unit Tests
```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/concurrency.unit.spec.ts src/api/store-surface/__tests__/errors.unit.spec.ts
```
**Result:** 2 test suites passed, 37 tests passed.

### 2. Guest Cart Capability Lifecycle & TTL Unit Tests
```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-capability-lifecycle.unit.spec.ts
```
**Result:** 1 test suite passed, 10 tests passed.

### 3. Guest Cart Capability Lifecycle Integration Tests
```bash
npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-lifecycle.spec.ts
```
**Result:** 1 test suite passed, 3 tests passed.

### 4. Idempotency Scopes Unit Tests
```bash
npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/idempotency-scope.unit.spec.ts
```
**Result:** 1 test suite passed, 6 tests passed.

### 5. Full Guest & Customer HTTP Matrix Integration Tests
```bash
npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-idempotency.spec.ts integration-tests/http/guest-cart-tracer.spec.ts integration-tests/http/customer-cart-active.spec.ts
```
**Result:** 3 test suites passed, 18 tests passed.

---

## Commit Log

- `5590d01` — `feat(15-04): add cart concurrency primitives, etag emission and 412 envelope`
- `072900f` — `feat(15-04): add guest capability rolling ttl, completed cart consumption and uniform 404`
- `58c36c0` — `feat(15-04): add POST active idempotency claiming, replay refetch and failure transitions`
