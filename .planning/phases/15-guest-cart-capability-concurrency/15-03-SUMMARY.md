# Phase 15-03 Summary: Dual-Actor Promotion of GET/POST /store/carts/active to M1 with BFF Guard & Guest/Customer Tracers

## Execution Summary

- **Phase / Plan:** Phase 15 (`Guest Cart Capability & Concurrency`), Plan `15-03`
- **Execution Date:** 2026-08-19
- **Status:** COMPLETED — READY FOR HUMAN REVIEW CHECKPOINT (Task 15-03-04)
- **Outcome:** Promoted `GET /store/carts/active` and `POST /store/carts/active` to `M1_ENABLED` under the Store Surface Manifest (raising M1 count from 6 to 8 and reducing PRESERVE_LEGACY from 7 to 5). Implemented the dual-actor M1 resolution architecture (`resolveM1CartActor`) with strict XOR precedence (Guest capability > Customer access > Anonymous guest). Created sibling closed tuple `STORE_CART_BFF_PROTECTED_OPERATIONS` (6 operations) and wired BFF protection without unconditional customer access guard. Full HTTP tracer and unit test suites passing 100% with zero skips.

---

## Key Invariants & Architectural Deliverables

1. **Closed Sibling BFF Protection Tuple (`STORE_CART_BFF_PROTECTED_OPERATIONS`):**
   - Created in `apps/backend/src/api/store/carts/bff-protected-operations.ts` with exactly 6 operations:
     - `GET /store/carts/active`
     - `POST /store/carts/active`
     - `POST /store/carts/:id/line-items`
     - `POST /store/carts/:id/line-items/:line_id`
     - `DELETE /store/carts/:id/line-items/:line_id`
     - `DELETE /store/carts/:id/line-items`
   - Sibling tuple to Phase 14's `CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS` (12 operations remain intact).
   - Registered in `middlewares.ts` with `customerAuthBffServiceGuardMiddleware` only.
   - Proved that `customerAuthAccessGuardMiddleware` is **never** mounted unconditionally on mixed cart routes.

2. **Dual-Actor Resolution with Strict XOR Precedence (`resolveM1CartActor`):**
   - Implemented in `apps/backend/src/modules/checkout/active-cart.ts`.
   - **Branch A (Presented Guest Capability):** If `x-indicio-guest-cart-token` header is present, attempts lookup. If valid, returns `{ actorType: "guest", cartId }`. If invalid/expired/revoked/consumed, returns `{ actorType: "invalid_guest_capability" }` which fails closed with 404 and **never falls through to Customer auth**.
   - **Branch B (Customer Access):** If capability header is absent and `customerAuthContext` or `Authorization: Bearer <jwt>` is present, executes Phase 14 PostgreSQL-lineage access guard. If valid, returns `{ actorType: "customer", customerId }`. If invalid/expired, returns `{ actorType: "customer_auth_denied" }`.
   - **Branch C (Anonymous Guest):** If neither header is present, returns `{ actorType: "guest_anonymous" }` allowing anonymous guest creation on POST.

3. **M1 Route Contract for GET and POST `/store/carts/active`:**
   - **POST `/store/carts/active`:**
     - Anonymous guest (no capability, no auth) -> Creates BRL cart (201), mints guest capability, sets `x-indicio-guest-cart-token` header once in response, records session `active_cart_id` as dual-run hint (P15-D10).
     - Guest with valid capability -> Reuses existing cart (200), does not re-emit token header.
     - Customer with auth -> Reuses existing cart (200) or creates new customer cart (201), never emits capability header.
     - Invalid/expired capability present -> Uniform 404, **zero cart created**.
   - **GET `/store/carts/active`:**
     - Guest with valid capability -> Returns active cart (200), does not emit token header.
     - Customer with auth -> Returns customer active cart (200), does not emit token header.
     - Anonymous guest or session alone -> 404 (session alone does not grant M1 possession).
     - Invalid capability -> 404.

4. **Manifest and OpenAPI Sync:**
   - Updated `apps/backend/src/api/store-surface/manifest.ts`:
     - Total: 63 (Native: 51, Local: 12)
     - Runtime policy: `DENY: 50`, `PRESERVE_LEGACY: 5`, `M1_ENABLED: 8`
     - M1 exact-set: Phase 14 Auth (6) + Phase 15 Cart (2) = 8 operations.
   - Regenerated OpenAPI specs (`store.openapi.json`, `admin.openapi.json`, `webhooks.openapi.json`) and verified with `openapi:lint`.

---

## Verification Results

### Unit Tests
- `bff-protected-operations.unit.spec.ts`: 4/4 passing
- `active-cart.unit.spec.ts`: 17/17 passing
- `manifest.unit.spec.ts`: 8/8 passing
- `generation.unit.spec.ts`, `coverage.unit.spec.ts`, `admin-contract.unit.spec.ts`: 238/238 passing

### HTTP Integration Tests (Zero Skips)
- `guest-cart-bff-guard.spec.ts`: 5/5 passing
- `guest-cart-tracer.spec.ts`: 6/6 passing
- `customer-cart-active.spec.ts`: 5/5 passing
- `cart-checkout-store.spec.ts`: 25/25 passing
- Total: 41/41 passing across all 4 HTTP suites.

---

## Checkpoint Artifacts for Human Review

1. `apps/backend/src/api/store/carts/bff-protected-operations.ts`
2. `apps/backend/src/modules/checkout/active-cart.ts`
3. `apps/backend/src/api/store/carts/active/route.ts`
4. `apps/backend/src/api/store-surface/manifest.ts`
5. `apps/backend/integration-tests/http/guest-cart-bff-guard.spec.ts`
6. `apps/backend/integration-tests/http/guest-cart-tracer.spec.ts`
7. `apps/backend/integration-tests/http/customer-cart-active.spec.ts`
8. `apps/backend/integration-tests/http/cart-checkout-store.spec.ts`
