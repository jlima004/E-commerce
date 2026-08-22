# Phase 15: Guest Cart Capability & Concurrency - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 32
**Analogs found:** 28 / 32
**Authorization:** PLAN support only. EXECUTION / product-code edits / tests / OpenAPI writer: NOT AUTHORIZED.
**Runtime as-built:** Medusa `@medusajs/*@2.16.0` (not the 2.15.x table in AGENTS.md).

Locked inputs: D15-01..D15-18, CART-01..CART-09, RESEARCH HUMAN APPROVED. Name of the dedicated module remains a PLAN decision (`guest-cart-capability` is the RESEARCH example, not a lock).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/backend/src/modules/guest-cart-capability/models/*.ts` | model | CRUD | `apps/backend/src/modules/tracking-access-token/models/tracking-access-token.ts` | exact |
| `apps/backend/src/modules/guest-cart-capability/types.ts` | utility | transform | `apps/backend/src/modules/tracking-access-token/types.ts` | exact |
| `apps/backend/src/modules/guest-cart-capability/service.ts` | service | CRUD | `apps/backend/src/modules/tracking-access-token/service.ts` (mint/hash-only) | role-match |
| `apps/backend/src/modules/guest-cart-capability/lookup.ts` | service | request-response | `apps/backend/src/modules/tracking-access-token/lookup.ts` | exact |
| `apps/backend/src/modules/guest-cart-capability/index.ts` | config | transform | `apps/backend/src/modules/tracking-access-token/index.ts` + `store-resource-version/index.ts` | exact |
| `apps/backend/src/modules/guest-cart-capability/migrations/*.ts` | migration | CRUD | `apps/backend/src/modules/store-resource-version/migrations/Migration20260809201808.ts` | exact |
| `apps/backend/src/links/guest-cart-capability-cart.ts` | config | CRUD | `apps/backend/src/links/payment-attempt-cart.ts` | exact |
| `apps/backend/medusa-config.ts` | config | transform | same file, `tracking_access_token` / `store_resource_version` entries | exact |
| `apps/backend/src/api/store/carts/active/route.ts` | route | request-response | itself (`createCartWorkflow` + actor fork) | exact |
| `apps/backend/src/modules/checkout/active-cart.ts` | service | request-response | itself (`resolveActiveCartIdentity`) | exact |
| `apps/backend/src/api/store/carts/[id]/line-items/route.ts` | route | request-response | `apps/backend/src/api/store/carts/active/route.ts` | role-match |
| `apps/backend/src/api/store/carts/[id]/line-items/[line_id]/route.ts` | route | request-response | `apps/backend/src/api/store/carts/active/route.ts` | role-match |
| `apps/backend/src/api/store/carts/line-items/validators.ts` | utility | transform | `apps/backend/src/api/store/carts/payment-attempts/validators.ts` + `apps/backend/src/api/auth-surface/validators.ts` | role-match |
| `apps/backend/src/api/store/carts/serializers.ts` | utility | transform | itself (`PublicStoreCartPreOrder`) | exact |
| `apps/backend/src/api/store-surface/manifest.ts` | config | request-response | itself + `GET /store/products` `native+local_extension` | exact |
| `apps/backend/src/api/store-surface/guard.ts` | middleware | request-response | itself | exact |
| `apps/backend/src/api/middlewares.ts` | middleware | request-response | itself (`customerAuthBffProtectedRouteEntries` + cart matchers) | exact |
| `apps/backend/src/modules/customer-auth/bff-service-auth.ts` | middleware | request-response | itself (`CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS`) | exact |
| `apps/backend/src/modules/customer-auth/access-guard.ts` | middleware | request-response | itself + `createCustomerAuthAccessGuardMiddleware` | exact |
| `apps/backend/src/modules/store-resource-version/service.ts` | service | CRUD | consume; do not rewrite | exact |
| `apps/backend/src/modules/store-idempotency/service.ts` | service | request-response | consume; do not persist secrets | exact |
| `apps/backend/src/modules/payment-attempt/cart-invalidation.ts` | service | event-driven | consume on structural mutation | exact |
| `apps/backend/src/modules/checkout/shipping-invalidation.ts` (no-op hook) | service | event-driven | — | none |
| `apps/backend/src/api/store-surface/errors.ts` | utility | request-response | itself (`PRECONDITION_FAILED` / ignored `cart`) | role-match |
| `apps/backend/src/api-docs/operations/store/carts.ts` | config | request-response | itself + `operations/store/customers.ts` M1 registration | exact |
| `apps/backend/src/api-docs/operations/store/schemas.ts` | config | transform | itself (`PublicStoreCartPreOrder`) | exact |
| `apps/backend/src/api-docs/components/{headers,parameters,errors}.ts` | config | request-response | itself (`ETag` / `If-Match` / `IdempotencyKey`) | exact |
| `apps/backend/src/api/store/carts/[id]/complete/route.ts` | route | request-response | keep DENY override; do not reopen | exact |
| `apps/backend/src/api/store/customers/me/cart/attach/route.ts` | route | request-response | keep DENY until Phase 16; do not copy | exact |
| `apps/backend/src/modules/guest-cart-capability/__tests__/*.unit.spec.ts` | test | request-response | `tracking-access-token.unit.spec.ts` | exact |
| `apps/backend/src/modules/guest-cart-capability/__tests__/*.postgres.spec.ts` | test | CRUD | `store-resource-version.postgres.spec.ts` | exact |
| `apps/backend/integration-tests/http/cart-*.spec.ts` | test | request-response | `cart-checkout-store.spec.ts` + `store-surface-lockdown.spec.ts` | role-match |

**Do not modify product code in this mapping step.** Paths above are the PLAN file set inferred from CONTEXT/RESEARCH, not an execution license.

---

## Pattern Assignments

### `apps/backend/src/modules/guest-cart-capability/models/*.ts` (model, CRUD)

**Analog:** `apps/backend/src/modules/tracking-access-token/models/tracking-access-token.ts`

Copy the Medusa `model.define` shape: prefixed id, `token_hash` UNIQUE, status enum, `expires_at` / `revoked_at`, timestamps via framework defaults. RESEARCH Q-01 also needs `consumed` status + `consumed_at` (tracking has no `consumed` — add it; do not invent nonce/HKDF columns).

**Core pattern** (lines 7–41):

```typescript
const TrackingAccessToken = model
  .define("tracking_access_token", {
    id: model.id({ prefix: "trkacc" }).primaryKey(),
    token_hash: model.text(),
    status: model.enum(TRACKING_ACCESS_TOKEN_STATUSES).default("active"),
    expires_at: model.dateTime(),
    revoked_at: model.dateTime().nullable(),
    last_used_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_tracking_access_token_token_hash_unique",
      on: ["token_hash"],
      unique: true,
    },
  ])
```

**Do not persist `cart_id` as a cross-module FK.** Cardinality “one active capability per guest cart” belongs on the **module link** + a partial unique if PLAN puts a cart-scoped column in-module. Analog for link (not FK): `apps/backend/src/links/payment-attempt-cart.ts`.

**Anti-pattern:** `customer-auth/security/capabilities.ts` persists nonce + HKDF material. CONTEXT Q-01 and RESEARCH forbid copying that primitive.

---

### `apps/backend/src/modules/guest-cart-capability/types.ts` (utility, transform)

**Analog:** `apps/backend/src/modules/tracking-access-token/types.ts`

Copy status constants, record type, mint result with plaintext **only at mint return**, never on the persisted record.

**Core pattern** (lines 1–59):

```typescript
export const TRACKING_ACCESS_TOKEN_STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const

export type MintTrackingAccessTokenResult = {
  record: TrackingAccessTokenRecord
  plaintext_token: string
}
```

Guest-cart RESEARCH statuses: `active | expired | revoked | consumed`. Add `CONSUMED` / `consumed_at`; keep the same “plaintext only in mint result” contract.

---

### `apps/backend/src/modules/guest-cart-capability/service.ts` (service, CRUD)

**Analog (mint / compare / lifecycle):** `apps/backend/src/modules/tracking-access-token/service.ts`

Copy: CSPRNG ≥ 32 bytes, persist hash only, `timingSafeEqual` on equal-length buffers, plaintext forbidden on record build, last-used / expire / revoke update builders.

**Imports / mint pattern** (lines 1–5, 225–268, 430–505):

```typescript
import { createHmac, randomBytes, timingSafeEqual } from "crypto"

export const TRACKING_ACCESS_TOKEN_RANDOM_BYTES = 32 as const

export function generateTrackingAccessToken(
  randomBytesFn: (size: number) => Buffer = randomBytes
): string {
  return randomBytesFn(TRACKING_ACCESS_TOKEN_RANDOM_BYTES).toString("base64url")
}

export function compareTrackingAccessTokenHash(
  storedHash: string,
  candidateHash: string
): boolean {
  const expectedBuffer = Buffer.from(storedHash)
  const receivedBuffer = Buffer.from(candidateHash)
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

export function mintTrackingAccessToken(...) {
  const plaintextToken = generateTrackingAccessToken(options.randomBytesFn)
  const tokenHash = hashTrackingAccessToken(plaintextToken, options.pepper)
  // record stores token_hash only
  return { record, plaintext_token: plaintextToken }
}
```

**Hash algorithm — do not copy HMAC-pepper.** Tracking hashes with `createHmac("sha256", pepper)` (lines 232–247). CART-01 / PRD §7.2 require **SHA-256 of the emitted token**, no pepper, no HKDF.

**Hash analog (unpepered SHA-256):** `apps/backend/src/modules/customer-auth/bff-service-auth.ts` lines 97–99 and `apps/backend/src/modules/store-idempotency/service.ts` `hashStoreIdempotencyScope` (lines 325+):

```typescript
function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest()
}
```

```typescript
export function hashStoreIdempotencyScope(scope: unknown): string {
  const canonical = canonicalizeSemanticValue(scope === undefined ? null : scope)
  return createHash("sha256") /* ... */ .digest("hex")
}
```

Encoding of the header token (base64url vs hex of the CSPRNG) is a PLAN decision. Tracking’s analog is `.toString("base64url")` of 32 bytes.

**Forbidden copy:** `apps/backend/src/modules/customer-auth/security/capabilities.ts` lines 1–80 (`hkdfSync`, persisted nonce, 45s recovery). Guest cart is a different primitive.

---

### `apps/backend/src/modules/guest-cart-capability/lookup.ts` (service, request-response)

**Analog:** `apps/backend/src/modules/tracking-access-token/lookup.ts`

Copy dummy-hash comparison on miss so absence vs mismatch is not distinguishable by timing. Uniform public error (D13-12). RESEARCH: guest M1 miss/expired/revoked/wrong-cart must not enumerate.

**Core pattern** (lines 17–62):

```typescript
const DUMMY_TRACKING_TOKEN_HASH = createHmac("sha256", "tracking-lookup-dummy-pepper")
  .update("tracking-lookup-dummy-token")
  .digest("hex")

function performDummyTrackingTokenHashComparison(candidateHash: string): void {
  compareTrackingAccessTokenHash(DUMMY_TRACKING_TOKEN_HASH, candidateHash)
}

const record = await deps.listByHash(candidateHash)
if (!record) {
  performDummyTrackingTokenHashComparison(candidateHash)
  throwTrackingLookupInvalidTokenError()
}
```

Adapt dummy construction to SHA-256 (no HMAC pepper). Keep the miss → dummy compare → uniform throw order.

---

### `apps/backend/src/modules/guest-cart-capability/index.ts` (config, transform)

**Analog:** `apps/backend/src/modules/tracking-access-token/index.ts` and `apps/backend/src/modules/store-resource-version/index.ts`

```typescript
export const TRACKING_ACCESS_TOKEN_MODULE = "tracking_access_token"
export default Module(TRACKING_ACCESS_TOKEN_MODULE, {
  service: TrackingAccessTokenModuleService,
})
```

Prefer also exporting the module key + types like `store-resource-version/index.ts` (lines 4–19). Register in `apps/backend/medusa-config.ts` next to existing custom modules (lines 96–106):

```typescript
{
  key: "tracking_access_token",
  resolve: "./src/modules/tracking-access-token",
},
{
  key: "store_idempotency",
  resolve: "./src/modules/store-idempotency",
},
{
  key: "store_resource_version",
  resolve: "./src/modules/store-resource-version",
},
```

---

### `apps/backend/src/modules/guest-cart-capability/migrations/*.ts` (migration, CRUD)

**Analog:** `apps/backend/src/modules/store-resource-version/migrations/Migration20260809201808.ts`

Copy Mikro `Migration` `up`/`down`, `if not exists`, partial UNIQUE `WHERE deleted_at IS NULL`. Do **not** copy bigint from superseded `13-VALIDATION.md`.

**Core pattern** (lines 3–13):

```typescript
export class Migration20260809201808 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "store_resource_version" (... constraint ... check (version > 0));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_store_resource_version_resource" ON "store_resource_version" ("resource_type", "resource_id") WHERE deleted_at IS NULL;`)
  }
  override async down(): Promise<void> {
    this.addSql(`drop table if exists "store_resource_version" cascade;`)
  }
}
```

Guest-cart table needs UNIQUE on `token_hash` (tracking analog) plus CHECK/status constraints PLAN defines. PostgreSQL is uniqueness authority.

---

### `apps/backend/src/links/guest-cart-capability-cart.ts` (config, CRUD)

**Analog:** `apps/backend/src/links/payment-attempt-cart.ts` (lines 1–7)

```typescript
import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"
import PaymentAttemptModule from "../modules/payment-attempt"

export default defineLink(CartModule.linkable.cart, {
  linkable: PaymentAttemptModule.linkable.paymentAttempt,
  isList: true,
})
```

Guest-cart RESEARCH: at most one **active** capability per guest cart. PLAN must choose `isList` vs 1:1; do not add a FK into `cart`. Read across modules with `query.graph` / remoteQuery, never another module’s DB.

---

### `apps/backend/src/api/store/carts/active/route.ts` (route, request-response)

**Analog:** the file itself. This is the local custom-route + Medusa workflow pattern RESEARCH requires for line-items too.

**Imports / workflow wrap** (lines 1–13, 134–188):

```typescript
import { createCartWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, remoteQueryObjectFromString } from "@medusajs/framework/utils"
import { assertNoPaymentOrOrderFields, resolveActiveCartIdentity } from "../../../../modules/checkout/active-cart"

const { result } = await createCartWorkflow(req.scope).run({ input })
const cart = await refetchActiveCart(req, result.id)

if (identity.actorType === "guest" && req.session) {
  req.session.active_cart_id = cart.id  // v1.0 possession — M1 must not treat this as proof
}

export async function GET(...) {
  const cart = await resolveExistingActiveCart(request)
  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No active cart found for the current actor")
  }
  assertNoPaymentOrOrderFields(cart)
  res.status(200).json({ cart })
}

export async function POST(...) {
  const existingCart = await resolveExistingActiveCart(request)
  const cart = existingCart ?? (await createActiveCart(request))
  res.status(existingCart ? 200 : 201).json({ cart })
}
```

**Keep:** `createCartWorkflow`, `currency_code: "brl"`, `assertNoPaymentOrOrderFields`, remoteQuery refetch, GET does not create (FE-CART-001).

**Change in execution (not now):** guest M1 possession from `x-indicio-guest-cart-token`; Customer M1 from BFF + `customerAuthAccessGuard` (Q-07); mint header only on 201; wire `store-idempotency` on POST; initialize `StoreResourceVersion` `resource_type = "cart"`; emit quoted `ETag`; dual-run may still **hint** `session.active_cart_id` for Phase 19 payment (Q-03) — never as M1 proof.

**Customer fork analog** is already in this file (lines 122–125 vs 127–131) and `active-cart.ts` `resolveActiveCartIdentity` (lines 113–138). RESEARCH: that fork is PRESERVE_LEGACY, not M1 Customer authority.

---

### `apps/backend/src/modules/checkout/active-cart.ts` (service, request-response)

**Analog:** itself. Guest today = session id / `active_cart_id`.

**Core pattern** (lines 113–138):

```typescript
export function resolveActiveCartIdentity(input): ActorCartIdentity {
  const customerId =
    input.auth_context?.actor_type === "customer"
      ? asNonEmptyString(input.auth_context.actor_id)
      : undefined
  if (customerId) {
    return { actorType: "customer", actorId: customerId, customerId, email: ... }
  }
  return {
    actorType: "guest",
    actorId: sessionId ?? activeCartId ?? "guest",
    sessionId,
    activeCartId,
  }
}
```

M1 must **not** treat native `authenticate("customer", ["session", "bearer"])` or this session `activeCartId` as guest possession. Payment eligibility still does (`eligibility.ts` `assertCartAccess`, lines 274–305) — Q-03 dual-run until Phase 19. Do not “fix” payment by deleting session.

Also keep `assertNoPaymentOrOrderFields` (lines 185–199) on every public cart response path (Order-birth).

---

### `apps/backend/src/api/store/carts/[id]/line-items/route.ts` and `[line_id]/route.ts` (route, request-response)

**Analog:** `apps/backend/src/api/store/carts/active/route.ts` (thin handler → workflow → refetch → public JSON).

**Not analog:** native Medusa HTTP handlers (remain DENY). RESEARCH: wrap `addToCartWorkflow` / `updateLineItemInCartWorkflow` / `deleteLineItemsWorkflow({ ids })`. Clear-all HTTP native is ABSENT; local DELETE collection lists items then one `deleteLineItemsWorkflow` call.

**Secondary analog for “local route replaces native”:** `apps/backend/src/api/store/carts/[id]/complete/route.ts` (lines 11–16) — last-writer-wins local file. Complete stays a 404 stub; line-items must **implement** locally instead of stubbing.

**Do not copy** `attach/route.ts` transfer/merge workflows (Phase 16). Its `workflowEngine.run(...)` style is valid Medusa v2, but attach remains DENY.

Handler skeleton for line-item mutations (8-plan topology, 15-05/15-06). Do **not** reverse validation and claim.

1. BFF already passed.
2. Resolve actor (guest capability **XOR** Customer access context).
3. Assert `{id}` is that actor’s active cart (uniform 404).
4. Parse + validate request/path semantics (**before** claim). Genuine non-integers (`1.5`, `1.1`, `98.9`); JSON `1` and `1.0` are the same Number.
5. Require `Idempotency-Key`.
6. `store-idempotency.claim` (**before** If-Match).
7. Replay short-circuit: refetch canonical `PublicStoreCartPreOrder` + current ETag; HTTP 200; never re-emit capability; never persist a full response DTO.
8. Require `If-Match` (missing/malformed → 400 `VALIDATION_ERROR`).
9. `StoreResourceVersion.compareAndSwapWithMutation` wrapping the Medusa workflow.
10. `applyStructuralCartInvalidation` (`invalidateActivePaymentAttemptForCartChange` + shipping no-op hooks). Helper exists before the first M1 mutation.
11. Terminalize claim with existing states only (`markCompleted` / `markFailedRetryable` / `markFailedTerminal`). Stale 412 must not leave `processing`.
12. Refetch + `assertNoPaymentOrOrderFields` + `serializeStoreCartPreOrder` + current `ETag`.

Empty clear: RESEARCH says 200 idempotent if no items (still needs ownership + If-Match + idempotency as PLAN defines). Zero items: no workflow and no structural version bump.

Wave topology for execution: Wave 0 = 15-01 … Wave 7 = 15-08 (one plan per wave).

---

### `apps/backend/src/api/store/carts/line-items/validators.ts` (utility, transform)

**Analog 1 — reject extra authority fields:** `apps/backend/src/api/store/carts/payment-attempts/validators.ts` (lines 3–61)

```typescript
export function rejectClientMoneyFields(body: unknown): void {
  if (!isPlainObject(body)) return
  const rejectedFields = findClientMoneyFields(body)
  if (rejectedFields.length === 0) return
  throw new MedusaError(MedusaError.Types.INVALID_DATA, PAYMENT_START_REJECTED_BODY_MESSAGE)
}
```

CART-06/D15-07: reject cart ID, price, extra metadata in body the same way money fields are rejected here.

**Analog 2 — strict Zod local wrapper:** `apps/backend/src/api/auth-surface/validators.ts` (lines 24–32)

```typescript
export const EmptyRequestSchema = z.object({}).strict()
export const SignupRequestSchema = z.object({ email, password, firstName, lastName }).strict()
```

Qty: integer 1–99 on add; update allows `0` (= remove) and 1–99; reject negative, decimal, `>99`. Native Medusa validators are insufficient (`quantity > 0` / `>= 0` without `.int()` or cap 99).

**Do not reuse** `CapabilitySchema` in `auth-surface/validators.ts` (lines 19–22) for the guest cart token — that schema is for **JSON body** auth tokens. Guest capability is header-only (CART-02).

---

### `apps/backend/src/api/store/carts/serializers.ts` (utility, transform)

**Analog:** itself. Q-08: `PublicStoreCartPreOrder` is the only public cart shape and the 412 snapshot. No `version` in body. No capability.

**DTO pattern** (lines 80–108, 221–258):

```typescript
export type PublicStoreCartPreOrder = {
  id: string
  email: string | null
  currency_code: string | null
  /* totals BRL major; items; shipping_address.masked_federal_tax_id; checkout_data_complete */
}

export function serializeStoreCartPreOrder(cart): PublicStoreCartPreOrder | null { /* allowlist map */ }
```

Middleware `createStoreCartPreOrderResponseMiddleware` (lines 277–298) already rewrites `{ cart }` envelopes. Keep it on M1 cart routes. Do not add `guestCartToken` to this DTO (PRD Frontend envelope is BFF cookie, frontend BLOCKED).

---

### `apps/backend/src/modules/store-resource-version/service.ts` (service, CRUD) — consume

**Analog:** consume as-is. D15-09: do not reinvent CAS.

**API to copy at call sites** (`initialize` lines 154–197, `compareAndSwapWithMutation` lines 288–337):

```typescript
async compareAndSwapWithMutation<T>(input: {
  resourceType: string
  resourceId: string
  expectedVersion: number
  sharedContext?: StoreResourceVersionMutationContext
  mutate: (sharedContext) => Promise<T>
}): Promise<StoreResourceVersionCasResult<T>>
```

Call with `resourceType: "cart"`, `resourceId: cart.id`, `expectedVersion` from `If-Match`. Result `type: "stale"` → HTTP 412 `CART_VERSION_MISMATCH`. Result `type: "updated"` → `ETag: "<n>"` quoted (RESEARCH). GET uses `initialize`/`load` without increment.

**Transaction analog:** postgres spec `store-resource-version.postgres.spec.ts` lines 330–364 (stale writer does not run `mutate`). Writes via generated MedusaService methods are fail-closed (`STORE_RESOURCE_VERSION_WRITE_FORBIDDEN`).

Redis is not an argument to this service. Do not add one.

---

### `apps/backend/src/modules/store-idempotency/service.ts` (service, request-response) — consume

**Analog:** `claim` (lines 666–732) + forbid `capability` in metadata (lines 424–449).

```typescript
async claim(input: ClaimInput): Promise<ClaimResult> // claimed | in_progress | replay | conflict

export const STORE_IDEMPOTENCY_SAFE_METADATA_KEYS = [
  "operation", "result_type", "result_id", "response_status", "failure_code", "harness", "correlation_ref",
]

const forbiddenKeys = [ /* ..., */ "capability", "tracking_token", /* ... */ ]
```

Q-09: POST active + all line-item mutations require `Idempotency-Key`. GET does not. Replay returns **safe context** (`cart_id`, DTO, ETag), never the guest secret (Q-11 Option A). `Idempotency-Key` is not ownership.

Actor/resource scope hashes: `hashStoreIdempotencyScope` (SHA-256 of canonical JSON). RESEARCH: guest actor = hash derived from capability (no plaintext stored); Customer actor = stable `customerId` from `customerAuthAccessGuard` context — **not** JWT, JWT hash, or Medusa session id. Create-before-mint scopes on hashed BFF identity.

PLAN must still define Idempotency-Key × If-Match precedence on mutation retry (RESEARCH “Must Be Decided in PLAN”).

---

### `apps/backend/src/api/store-surface/manifest.ts` (config, request-response)

**Analog:** itself. Promotion pattern for existing keys: change `runtime_policy` + `m1_enablement` + `origin` without duplicating native identity.

**Current owner_phase 15** (lines 143–177, 657–679):

```typescript
// POST .../line-items, POST/DELETE .../line-items/{line_id}: origin native, EXTENDED, DENY
// GET/POST /store/carts/active: origin local, EXTENDED, PRESERVE_LEGACY
```

**Origin analog for wrapping natives:** products (lines 556–578):

```typescript
origin: "native+local_extension",
classification: "EXTENDED",
runtime_policy: "PRESERVE_LEGACY", // Phase 21 — cart will instead go M1_ENABLED
```

RESEARCH exact-set projection: reuse the three line-item keys as `native+local_extension` (do **not** add three extra `origin: local` rows — that would break native identity 51). Only `DELETE /store/carts/{id}/line-items` is a **new** `origin: local` key (COUNT_TOTAL 63→64).

Keep DENY for create-by-id, read-by-id, complete, customer-attach, shipping-methods (lines 88–141, 682–690). Do not drop `STORE_SURFACE_PHASE14_ENABLED_OPERATIONS` (lines 811–815).

Update `validateStoreSurfaceManifest` hardcodes (lines 911–951): today `total !== 63`, `extended !== 15`, `m1EnabledPolicy !== 6`. Execution must bump counts **without** removing the six auth ops.

---

### `apps/backend/src/api/store-surface/guard.ts` (middleware, request-response)

**Analog:** itself. Policy is table-driven; promoting manifest entries is enough if `M1_ENABLED` + `m1_enablement: "enabled"`.

**Allow branch** (lines 268–294):

```typescript
if (entry.runtime_policy === "DENY") {
  return deny("DENY runtime policy", "STORE_SURFACE_DENY")
}
if (entry.runtime_policy === "PRESERVE_LEGACY") {
  return { action: "allow", entry, mode: "preserve_legacy" }
}
if (entry.runtime_policy === "M1_ENABLED") {
  if (entry.m1_enablement !== "enabled") {
    return deny("M1 policy without enablement", "STORE_SURFACE_M1_DISABLED")
  }
  return { action: "allow", entry, mode: "m1_enabled" }
}
```

Unknown/BLOCKED/DENY still 404 non-enumerating (`writeDeniedResponse`, lines 300–308). Keep `/store/carts/active` matching preferring static templates over `{id}` (lines 127–129) so local active is not swallowed by native `{id}`.

Do not teach the guard about capability/`If-Match` — those belong in route middleware/handlers. Guard is method/path authority only.

---

### `apps/backend/src/api/middlewares.ts` + `bff-service-auth.ts` (middleware, request-response)

**Analog:** closed BFF list, no prefix-match.

`CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS` (bff-service-auth.ts lines 11–24) — 12 ops, **zero cart**. RESEARCH: emit `x-indicio-guest-cart-token` only after BFF credential is on the create route. PLAN chooses extend this list vs a sister cart list; either way it must stay an exact tuple.

**Wiring analog** (middlewares.ts lines 593–648, 665–674):

```typescript
function customerAuthBffProtectedRouteEntries() {
  return CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS.map((operation) => {
    const [rawMethod, path] = operation.split(" ")
    const requiresCustomerAccess = path === "/store/customers/me" || /* exact paths */
    return {
      method: [method],
      matcher: path,
      middlewares: requiresCustomerAccess
        ? [customerAuthBffServiceGuardMiddleware, customerAuthAccessGuardMiddleware]
        : [customerAuthBffServiceGuardMiddleware],
    }
  })
}

// current cart active — NO BFF guard (legacy):
matcher: "/store/carts/active",
middlewares: [
  authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
  storeCartPreOrderQueryConfigMiddleware,
  storeCartPreOrderResponseMiddleware,
]
```

Q-07 Customer line-item mutations: same BFF guard **plus** `customerAuthAccessGuardMiddleware` (middlewares.ts lines 487–544; access-guard.ts PostgreSQL lineage lookup). Guest mutations: BFF guard + capability header, **not** `customerAuthAccessGuard`. Native `authenticate(..., allowUnauthenticated: true)` is insufficient for M1.

BFF deny analog: 404 `{ type: "not_found", message: "Not Found" }` when secret mismatch (lines 584–586) — anti-enumeration, consistent with store-surface guard.

**Note:** RESEARCH cited `apps/backend/src/lib/bff-service-auth.ts`. That path **does not exist**. Live analog is `apps/backend/src/modules/customer-auth/bff-service-auth.ts`.

---

### `apps/backend/src/modules/payment-attempt/cart-invalidation.ts` (service, event-driven)

**Analog:** consume on every structural M1 mutation (CART-09 layer 1).

**Core pattern** (lines 155–180, 191–230):

```typescript
export function invalidateActivePaymentAttemptForCartChange(attempts, cartId, at)
export function reconcileStalePaymentAttemptsForCartFingerprint(attempts, cartId, currentFingerprint, at)
```

Do not harden PaymentAttempt M1 (Phase 19). Do not implement Gelato quote (Phase 18).

---

### `apps/backend/src/api/store-surface/errors.ts` (utility, request-response)

**Analog:** envelope + 412 classification already exist; cart snapshot is **explicitly ignored**.

**Codes / 412** (lines 14–24, 290–343):

```typescript
PRECONDITION_FAILED: "PRECONDITION_FAILED",
// classify:
if (isPreconditionFailed(err, type, statusHint)) {
  return { statusCode: 412, code: STORE_ERROR_CODES.PRECONDITION_FAILED, retryable: false }
}
```

**Gap vs CART-08:** RESEARCH wants public `code = CART_VERSION_MISMATCH` (domain code) + snapshot `cart = PublicStoreCartPreOrder` + `ETag` of current version + `retryable = false`. Today:

- `STORE_ERROR_CODES` has no `CART_VERSION_MISMATCH`.
- `isStoreErrorResponse` **rejects** a `cart` key (lines 186–209).
- `toStoreErrorResponse` voids `options.cart` (lines 525–526): “Phase 13 has no approved Cart DTO.”

Planner must extend the envelope in a fail-closed way (allowlist `cart` only as serialized `PublicStoreCartPreOrder`, never capability/version-in-body). Do not leak internals because `CART_VERSION_MISMATCH` is “domain”.

`STORE_PUBLIC_FIELD_ALLOWLIST` already includes `quantity` and `variant_id` (lines 38–61) for CART-06 fieldErrors.

---

### `apps/backend/src/api-docs/operations/store/carts.ts` + components (config, request-response)

**Analog:** existing cart ops (carts.ts lines 12–93) + transversal headers/params.

Register GET/POST active plus line-item ops only when manifest `M1_ENABLED` + `include_executable_m1`. Generator filter (`api-docs/generation/build-documents.ts` lines 63–70) already drops Store paths that are not enabled M1.

Reuse:

- `IdempotencyKey` (`components/parameters.ts` lines 21–33) — description already says it is NOT ownership.
- `IfMatch` (lines 35–42) — “Cart enforcement belongs to Phase 15.”
- `ETag` (`components/headers.ts` lines 14–18).
- `PublicStoreCartPreOrder` / `StoreCartResponse` (`operations/store/schemas.ts` lines 675–774).
- `storeErrorResponse` helper.

Evolve `StoreErrorResponse.cart` placeholder (`components/errors.ts` lines 73–82) from primitive oneOf to `$ref PublicStoreCartPreOrder`.

**Sensitive header:** there is **no** live `x-sensitive` extension in `apps/backend/src/api-docs/`. Closest analog is auth `sensitive` lists (`operations/store/schemas.ts` line 433) + `assertSafeExamples` walker (`registry.ts` `SENSITIVE_EXAMPLE_PATTERNS`). CART-02: never put the token in JSON, URL, examples. RESEARCH Q-10: document `x-indicio-guest-cart-token` as a header with a synthetic/redacted schema, emit-once on 201, absent from GET.

Interactive remains `nonInteractive: true` (carts.ts lines 48–49).

---

### Tests

| New test | Analog | Copy |
|----------|--------|------|
| module unit (mint hash-only, dummy miss, no plaintext in record) | `tracking-access-token/__tests__/tracking-access-token.unit.spec.ts` | `timingSafeEqual` presence; plaintext forbidden |
| module postgres (token_hash UNIQUE, one active per cart) | `store-resource-version/__tests__/store-resource-version.postgres.spec.ts` | disposable PG harness; concurrent first-writer |
| CAS stale 412 | same postgres spec lines 330–364 | `compareAndSwapWithMutation` stale does not mutate |
| HTTP cart M1 | `integration-tests/http/cart-checkout-store.spec.ts` | session fixtures exist; add capability/BFF headers |
| exact-set / DENY natives | `store-surface/__tests__/manifest.unit.spec.ts` + `store-surface-lockdown.spec.ts` | keep Phase 14 six M1 auth keys |
| OpenAPI | `api-docs/__tests__/store-contract.unit.spec.ts` | ETag/If-Match already expected; add cart ops + no token examples |
| active-cart unit | `modules/checkout/__tests__/active-cart.unit.spec.ts` | identity helpers; extend for capability vs session |

Do not execute tests in this mapping step.

---

## Shared Patterns

### Fail-closed Store surface
**Source:** `apps/backend/src/api/store-surface/guard.ts` lines 231–308 + `middlewares.ts` `/store*` envelope+guard.
**Apply to:** all new cart HTTP. Unclassified = DENY 404. Promoting a route is a manifest change, not a guard rewrite.

### BFF caller authority (closed list)
**Source:** `apps/backend/src/modules/customer-auth/bff-service-auth.ts` lines 11–24, 110–127.
**Apply to:** GET/POST `/store/carts/active` and line-item M1 ops **before** first capability emission. Exact method+path; SHA-256 digest + `timingSafeEqual`; no prefix match.

### Customer M1 possession (Q-07)
**Source:** `access-guard.ts` + `createCustomerAuthAccessGuardMiddleware` (`middlewares.ts` 487–544) + `customers/me/route.ts` `requireAuthenticatedContext` (lines 63–80).
**Apply to:** authenticated line-item mutations on the customer’s active cart. Not native JWT/session; not guest capability.

### Guest M1 possession
**Source:** tracking mint/lookup (hash-only + dummy miss), **not** `req.session.active_cart_id`.
**Apply to:** guest GET/mutations. Session may remain a payment hint (eligibility.ts 294–302) until Phase 19.

### Idempotency ≠ ownership ≠ If-Match
**Source:** `store-idempotency/service.ts` claim + forbidden `capability` key; `parameters.ts` IdempotencyKey description.
**Apply to:** POST active + line-item mutations. Replay = HTTP 200 of refetch canonical cart + current ETag only (Q-11 Option A). Mint success = 201. Do not persist a full response DTO.

### Optimistic concurrency
**Source:** `store-resource-version/service.ts` `compareAndSwapWithMutation`; OpenAPI `ETag` / `If-Match`; errors.ts 412 → `PRECONDITION_FAILED`.
**Apply to:** structural cart writes. Version only in headers. Planner must lift snapshot + `CART_VERSION_MISMATCH` onto the public envelope.

### Public cart DTO
**Source:** `serializers.ts` `PublicStoreCartPreOrder` + `storeCartPreOrderResponseMiddleware`.
**Apply to:** 200/201 and 412 snapshot. No capability, no version field, no payment/order internals.

### Native reuse without enabling native HTTP
**Source:** `active/route.ts` `createCartWorkflow`; complete local override (DENY stub); products `native+local_extension`.
**Apply to:** add/update/delete/clear via workflows; keep native line-item HTTP DENY until local handlers exist **and** manifest origin is `native+local_extension` (not a second native identity).

### Hash-only / log redaction
**Source:** tracking `TRACKING_ACCESS_TOKEN_PLAINTEXT_FORBIDDEN`; store-idempotency `assertNoSensitiveStoreIdempotencyPersistence`; observability sanitize used by tracking.
**Apply to:** guest capability never in JSON, URL, logs, Sentry, analytics, idempotency metadata, OpenAPI examples.

### Order-birth
**Source:** `assertNoPaymentOrOrderFields`; `complete/route.ts` 404 stub; manifest BLOCKED complete.
**Apply to:** every cart mutation. Zero Orders on Store/BFF paths.

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Runtime `If-Match` parse + quoted `ETag` emission on cart handlers | middleware | request-response | Headers exist in OpenAPI only; no cart handler reads `If-Match` or sets `ETag` today |
| Public `code = CART_VERSION_MISMATCH` + `cart` snapshot on StoreErrorResponse | utility | request-response | Envelope currently **strips** `cart`; only generic `PRECONDITION_FAILED` |
| `x-indicio-guest-cart-token` header mint/verify | middleware | request-response | Grep: header string absent from code and OpenAPI |
| SHA-256 (unpepered) **token** persistence | service | CRUD | Tracking uses HMAC-pepper; auth uses HKDF/nonce — both forbidden. Use `createHash("sha256")` from BFF/idempotency **scope** hashing as algorithm analog only |
| `invalidateShippingQuote` / `invalidateShippingSelection` no-op | service | event-driven | Quote/select ABSENT until Phase 18; CART-09 layer 2 is new |
| Local `DELETE /store/carts/{id}/line-items` | route | request-response | No HTTP analog; programmatic analog is Medusa `deleteLineItemsWorkflow({ ids })` in `node_modules` |
| OpenAPI `x-sensitive: true` extension | config | transform | Not present in `api-docs/`; use auth `sensitive` + `assertSafeExamples` until PLAN defines the annotation |

Planner should take those from `15-RESEARCH.md` (not invent a second cart engine, CAS table, or HKDF guest token).

---

## Anti-Patterns (do not copy)

| Source | Why |
|--------|-----|
| `customer-auth/security/capabilities.ts` HKDF + nonce + 45s recovery | CONTEXT Q-01 / RESEARCH: different primitive |
| `req.session.active_cart_id` as M1 proof (`active/route.ts` 153–155, `eligibility.ts` 294–302) | CART-01 replaces principal proof; session is dual-run hint for payment only |
| Re-enable native `POST/GET /store/carts/{id}`, complete, attach, shipping-methods | D15-08 |
| Duplicate three line-item manifest rows as `origin: local` | Breaks native identity 51 |
| Persist capability in `store_idempotency_record` metadata or Redis | D13-17 / CART-01 hash-only |
| `GuestCartEnvelope.guestCartToken` on Store JSON | BFF cookie contract; frontend BLOCKED |
| Auth `CapabilitySchema` in JSON body | Guest token is header-only |
| `13-VALIDATION.md` bigint version schema | Superseded by HCD 13-05 integer + partial UNIQUE |

---

## Metadata

**Analog search scope:** `apps/backend/src/api/store/carts/`, `apps/backend/src/api/store-surface/`, `apps/backend/src/api/middlewares.ts`, `apps/backend/src/modules/{checkout,store-resource-version,store-idempotency,tracking-access-token,payment-attempt,customer-auth}/`, `apps/backend/src/links/`, `apps/backend/src/api-docs/`, `apps/backend/medusa-config.ts`, related unit/HTTP tests.
**Files scanned:** ~55 source files (targeted reads; no product edits).
**Pattern extraction date:** 2026-08-19
**Next consumer:** `gsd-planner` (PLAN.md actions must cite analog path + line ranges above).
