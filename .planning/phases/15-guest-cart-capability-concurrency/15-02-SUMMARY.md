# Phase 15-02 Summary: Guest Cart Capability Domain, Service, Migrations & Postgres Proof

## Execution Summary

- **Phase / Plan:** Phase 15 (`Guest Cart Capability & Concurrency`), Plan `15-02`
- **Execution Date:** 2026-08-19
- **Status:** COMPLETED — PASS
- **Outcome:** Implemented the full `GuestCartCapability` module domain, CSPRNG token generator, SHA-256 hashing, timing-safe lookup with dummy comparison on miss/inactive states, Medusa module service, Medusa config module registration and link definition with `Cart`, MikroORM migration and snapshot, and verified 100% against PostgreSQL disposable harness and unit test suites.

---

## Key Invariants & Architectural Guarantees

1. **Token Cryptographic Shape (P15-D01):**
   - 32 bytes of CSPRNG entropy encoded as `base64url` (43 characters).
   - Generated via `generateGuestCartCapability()` using `crypto.randomBytes(32)`.
   - Never contains customer PII, cart ID, or timestamp in the plaintext token.

2. **Hash-Only Persistence (P15-D02, P15-D08):**
   - Stored strictly as SHA-256 utf8 hex string (`token_hash`, 64 hex characters).
   - Plaintext token is NEVER persisted to the database, NEVER logged, and NEVER serialized into error messages or telemetry.
   - Proved by `assertRecordHasNoPlaintext` and PostgreSQL canary test in `guest-cart-capability.postgres.spec.ts`.

3. **Constant-Time Timing-Safe Comparison & Dummy on Miss (P15-D03):**
   - Lookup by presented token computes SHA-256 hash and looks up capability record.
   - If missing, invalid, or non-active (expired, revoked, consumed), performs `performDummyGuestCartCapabilityHashComparison()` using `crypto.timingSafeEqual` with two pre-allocated dummy buffers.
   - Throws uniform `GUEST_CART_CAPABILITY_LOOKUP_INVALID` error code to eliminate timing or enumeration side-channels.

4. **Lifecycle & Rolling TTL (P15-D04):**
   - Initial TTL: 7 days from creation.
   - Rolling renewal on access: `now + 7 days`, capped strictly at `created_at + 30 days` (absolute maximum lifetime).
   - Explicit lifecycle transitions: `active` → `consumed`, `active` → `expired`, `active` → `revoked`.

5. **PostgreSQL Relational Authority & Partial UNIQUE (P15-D06):**
   - Table `guest_cart_capability` with primary key `id` (prefix `gccap`).
   - UNIQUE constraint on `token_hash` (`UQ_guest_cart_capability_token_hash`).
   - Partial UNIQUE index `UQ_guest_cart_capability_active_cart` on `(cart_id) WHERE status = 'active' AND deleted_at IS NULL` — prevents concurrent active tokens for the same cart while allowing historical consumed/expired/revoked records.
   - CHECK constraint on `status IN ('active', 'expired', 'revoked', 'consumed')`.

6. **Medusa v2 Module Isolation & Link Architecture (P15-D05):**
   - Registered under module key `guest_cart_capability` in `medusa-config.ts`.
   - Linked to `CartModule.linkable.cart` via `defineLink(CartModule.linkable.cart, { linkable: GuestCartCapabilityModule.linkable.guestCartCapability, isList: true })`.
   - No cross-module service imports or direct foreign keys.

---

## Artifacts Produced

1. **Documentation:**
   - `docs/DB_MODEL_v1.22.md`: Added Section 4.19 `GuestCartCapability` and updated Section 3.8 Changelog.
2. **Types & Domain:**
   - `apps/backend/src/modules/guest-cart-capability/types.ts`: Constants, enums, DTOs, and error codes.
   - `apps/backend/src/modules/guest-cart-capability/hash.ts`: CSPRNG generation, SHA-256 hashing, timing-safe equality, and dummy hash execution.
   - `apps/backend/src/modules/guest-cart-capability/models/guest-cart-capability.ts`: Medusa DML model with partial unique index.
3. **Service & Lookup:**
   - `apps/backend/src/modules/guest-cart-capability/service.ts`: `GuestCartCapabilityModuleService` with rolling TTL and lifecycle transitions.
   - `apps/backend/src/modules/guest-cart-capability/lookup.ts`: `lookupGuestCartCapabilityByPresentedToken` with dummy-on-miss.
   - `apps/backend/src/modules/guest-cart-capability/index.ts`: Module export.
4. **Configuration & Links:**
   - `apps/backend/medusa-config.ts`: Registered `guest_cart_capability`.
   - `apps/backend/src/links/guest-cart-capability-cart.ts`: Link definition between Cart and GuestCartCapability.
5. **Migrations & Snapshots:**
   - `apps/backend/src/modules/guest-cart-capability/migrations/Migration20260819210000.ts`: DDL migration.
   - `apps/backend/src/modules/guest-cart-capability/migrations/.snapshot-guest_cart_capability.json`: MikroORM schema snapshot.
6. **Test Suites:**
   - `apps/backend/src/modules/guest-cart-capability/__tests__/guest-cart-capability-hash.unit.spec.ts` (15/15 PASS)
   - `apps/backend/src/modules/guest-cart-capability/__tests__/guest-cart-capability-service.unit.spec.ts` (17/17 PASS)
   - `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts` (8/8 PASS)
   - `apps/backend/src/modules/guest-cart-capability/__tests__/guest-cart-capability.postgres.spec.ts` (5/5 PASS in disposable Docker PostgreSQL)

---

## Verification Proofs

| Suite / Check | Result | Details |
|---|---|---|
| `guest-cart-capability-hash.unit.spec.ts` | **PASS (15/15)** | CSPRNG 32 bytes, base64url shape, SHA-256 determinism, timingSafeEqual, dummy compare. |
| `guest-cart-capability-service.unit.spec.ts` | **PASS (17/17)** | Minting, rolling TTL cap at 30d, dummy-on-miss, lookup invalid/inactive uniform errors. |
| `medusa-config.unit.spec.ts` | **PASS (8/8)** | Module registration in `medusa-config.ts` without regressions. |
| `guest-cart-capability.postgres.spec.ts` | **PASS (5/5)** | Schema catalog contract, UNIQUE token_hash, partial UNIQUE active cart, hash-only canary, status checks in disposable PostgreSQL. |
| `npm run build -w @dtc/backend` | **PASS (exit 0)** | 0 errors across TypeScript compilation and Medusa build. |
| `git diff --check` | **PASS (clean)** | Zero whitespace or formatting issues. |

---

## Non-Deploy & Scope Boundary Verification

- **No Remote Database Alterations:** All migration tests and schema verification were conducted exclusively against disposable local Docker PostgreSQL containers.
- **No Storefront Route Promotion:** `POST /store/carts` and `GET/POST /store/carts/active` route promotion is reserved for Plan `15-03`.
- **Exact-Set Catalog:** Surface lock remained untouched; no unauthorized endpoints were exposed.
