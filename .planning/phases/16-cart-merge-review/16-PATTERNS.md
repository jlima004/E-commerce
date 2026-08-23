# Phase 16: Cart Merge & Review - Pattern Map

**Mapped:** 2026-08-23
**Authority:** `16-CONTEXT.md`, `16-RESEARCH.md`, `16-RESEARCH-REVIEW.md`, `16-VALIDATION.md`
**Files/families classified:** 45
**Primary analogs found:** 5 / 5 architectural roles
**Scope:** planning guidance only; no source, test, migration, config, generated artifact, roadmap, state or requirements file was changed

## Binding Baseline

- Preserve `D16-01..D16-42` exactly.
- Apply `R16-HR-01..R16-HR-08` over any conflicting recommendation or open decision in `16-RESEARCH.md`.
- Keep `MRG-01..MRG-08` **OPEN / UNCHANGED**.
- Preserve the current milestone counters: phases closed `3/10`; requirements complete `26/91`; open requirements `65`; plans `36/36`; progress `30%`.
- `CUSTOMER_CART_PRESERVED` remains in the closed enum but has no positive branch or positive fixture.
- `If-Match` on merge versions the guest source; the Customer destination version is resolved and locked server-side.
- A pending review blocks every structural mutation, including another merge, with `409 REVIEW_REQUIRED` and zero effect.
- Same-key/same-fingerprint replay returns the original public cart snapshot, original review, original outcome and original ETag.
- Acknowledge accepts strict `{ reviewRef: string | null }`, always requires `If-Match`, and must not introduce `Idempotency-Key`.
- PostgreSQL is the authority. Redis, session state and `updated_at DESC` are not merge/canonicality authorities.
- No Phase 16 cart path creates an `Order`.

## File Classification

The authorities call these files “probable” rather than an execution allowlist. New filenames below follow the repository layout recommended by the approved research; the planner must keep them within the approved responsibilities and may only rename them without changing the semantics.

| New/Modified File | Change | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `apps/backend/src/modules/cart-merge/index.ts` | new | config/provider | request-response | `src/modules/store-idempotency/index.ts` | role-match |
| `apps/backend/src/modules/cart-merge/types.ts` | new | utility/model types | transform | `src/modules/guest-cart-capability/types.ts` | role-match |
| `apps/backend/src/modules/cart-merge/service.ts` | new | service | CRUD + transform + request-response | `src/api/store/carts/line-item-mutation.ts` | data-flow match |
| `apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts` | new | model | CRUD | `src/modules/store-idempotency/models/store-idempotency-record.ts` | role-match |
| `apps/backend/src/modules/cart-merge/models/cart-merge-result.ts` | new | model | CRUD | `src/modules/store-idempotency/models/store-idempotency-record.ts` | role-match |
| `apps/backend/src/modules/cart-merge/models/cart-review.ts` | new | model | CRUD + event-state | `src/modules/guest-cart-capability/models/guest-cart-capability.ts` | role-match |
| `apps/backend/src/modules/cart-merge/migrations/Migration<timestamp>.ts` | new/generated | migration | batch | `src/modules/store-resource-version/migrations/Migration20260809201808.ts` | role-match |
| `apps/backend/src/modules/cart-merge/__tests__/decision.unit.spec.ts` | new | test | transform | `src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts` | role/data-flow match; semantics must be replaced |
| `apps/backend/medusa-config.ts` | modify | config | startup | existing custom-module entries in the same file | exact |
| `apps/backend/src/api/store/customers/me/cart/merge/route.ts` | new | route/controller | request-response | `src/api/store/customers/me/cart/attach/route.ts` | role-match; do not copy legacy authority |
| `apps/backend/src/api/store/carts/[id]/review/acknowledge/route.ts` | new | route/controller | request-response | `src/api/store/carts/[id]/line-items/[line_id]/route.ts` + resource-version service | role/data-flow match |
| `apps/backend/src/api/store/carts/merge-review-validators.ts` | new/inferred | utility/validator | transform | `src/api/store/carts/line-items/validators.ts` | exact role |
| `apps/backend/src/api/store/customers/me/cart/attach/route.ts` | modify | route/adapter | request-response | same file + canonical merge route | exact target; current core is an anti-pattern |
| `apps/backend/src/modules/checkout/attach-guest-cart.ts` | modify | utility/legacy adapter | transform | same file | exact target; remove decision authority |
| `apps/backend/src/api/store/carts/customer-active-cart.ts` | modify | service/utility | CRUD read + request-response | same file + resource-version locking style | exact target; timestamp selector must go |
| `apps/backend/src/api/store/carts/active/route.ts` | modify | route/controller | CRUD + request-response | same file | exact target; join Customer authority lock |
| `apps/backend/src/api/store/carts/line-item-mutation.ts` | modify | service/controller | CRUD + request-response | same file | exact target; add `REVIEW_REQUIRED` guard in the shared transaction |
| `apps/backend/src/modules/guest-cart-capability/service.ts` | modify | service | CRUD + request-response | same file | exact |
| `apps/backend/src/modules/guest-cart-capability/types.ts` | modify | model types | transform | same file | exact |
| `apps/backend/src/modules/store-idempotency/operations.ts` | modify | config/utility | transform | same file | exact |
| `apps/backend/src/modules/store-idempotency/service.ts` | modify | service | CRUD + request-response | same file | exact; make claim/terminal operations shared-context aware |
| `apps/backend/src/modules/store-idempotency/models/store-idempotency-record.ts` | modify if link/retention schema needs it | model | CRUD | same file | exact |
| `apps/backend/src/api/store/carts/serializers.ts` | modify | utility/serializer | transform | same file | exact |
| `apps/backend/src/api/store/carts/bff-protected-operations.ts` | modify | config/security | request-response | same file | exact |
| `apps/backend/src/api/middlewares.ts` | modify | middleware | request-response | exact-set BFF and cart response middleware blocks | exact |
| `apps/backend/src/api/store-surface/manifest.ts` | modify | config/surface policy | transform | Phase 15 Cart entries in same file | exact |
| `apps/backend/src/api-docs/operations/store/carts.ts` | modify | config/contract registry | request-response | line-item registration in same file | exact |
| `apps/backend/src/api-docs/operations/store/schemas.ts` | modify | config/schema registry | transform | strict Cart request/response schemas in same file | exact |
| `apps/backend/src/api-docs/components/parameters.ts` | modify if a merge-only required capability parameter is needed | config/schema | request-response | existing `IfMatch`, `IdempotencyKey`, guest token parameters | exact role |
| `apps/backend/src/api-docs/components/errors.ts` | modify | config/schema | request-response | existing Store Cart error envelope | exact role |
| `apps/backend/src/api-docs/components/security-schemes.ts` | modify/reuse | config/security | request-response | `STORE_CART_M1_BFF_OPTIONAL_CUSTOMER` and Customer-auth tuples | role-match; merge requires both Customer and capability |
| `apps/backend/src/api-docs/coverage/exclusions.ts` | modify | config/coverage | transform | current attach support/exclusion | exact |
| `apps/backend/src/api-docs/generated/store.openapi.json` | writer output only | generated config | batch | current registry writer output | exact; never hand-edit |
| `apps/backend/integration-tests/http/cart-merge-review.spec.ts` | new | test | request-response | `guest-cart-idempotency.spec.ts` + snapshot concurrency suite | role/data-flow match |
| `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts` | new | test | CRUD + batch/concurrency | `store-resource-version.postgres.spec.ts` | role/data-flow match |
| `apps/backend/integration-tests/helpers/cart-merge-*.ts` | new/inferred | test utility/worker/failpoints | event-driven + batch | `helpers/auth-multiprocess.ts` + guest-cart helpers | role-match |
| `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` | modify | test | request-response | same file | exact; add checkout review guard and zero-Order assertions |
| `apps/backend/integration-tests/http/customer-cart-active.spec.ts` | modify | test | request-response | same file | exact; replace newer-cart-wins expectation with ambiguity fail-closed |
| `apps/backend/integration-tests/http/guest-cart-idempotency.spec.ts` | modify/extend | test | request-response | same file | exact for claim/replay/conflict |
| `apps/backend/integration-tests/http/guest-cart-mutation-snapshot-concurrency.spec.ts` | modify/extend | test | request-response + concurrency | same file | exact for body/ETag snapshot barriers |
| `apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts` | modify/extend | test | request-response | same file | exact for native attach bypass denial |
| `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` | modify/extend | test | CRUD + batch | same file | exact for real zero-Order proof |
| `apps/backend/integration-tests/helpers/guest-cart-leakage.ts` and leakage suites | modify/extend | test utility/tests | transform + request-response | same helper/suites | exact for eight-sink leakage proof |
| `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts` and surface contract tests | modify/extend | test | transform | same files | exact for strict schema/security/exact-set |
| `docs/DB_MODEL_v1.22.md` or the next human-approved snapshot | modify only with schema gate | documentation | file-I/O | current DB model snapshot | role-match |

## Pattern Assignments

### 1. Cart merge module, models and registration

**Apply to:** `src/modules/cart-merge/index.ts`, `types.ts`, `service.ts`, all three model files, generated migration, `medusa-config.ts`.

**Module export/registration pattern — source:** `apps/backend/src/modules/store-idempotency/index.ts:1-4,58-60`

```typescript
import { Module } from "@medusajs/framework/utils"
import StoreIdempotencyModuleService from "./service"

export const STORE_IDEMPOTENCY_MODULE = "store_idempotency"

export default Module(STORE_IDEMPOTENCY_MODULE, {
  service: StoreIdempotencyModuleService,
})
```

Mirror this shape for `CART_MERGE_MODULE`, then add one custom-module entry beside the existing entries in `apps/backend/medusa-config.ts:99-113`:

```typescript
{
  key: "store_idempotency",
  resolve: "./src/modules/store-idempotency",
},
{
  key: "store_resource_version",
  resolve: "./src/modules/store-resource-version",
},
{
  key: "guest_cart_capability",
  resolve: "./src/modules/guest-cart-capability",
},
```

**Constrained model pattern — source:** `apps/backend/src/modules/store-idempotency/models/store-idempotency-record.ts:26-75`

```typescript
const StoreIdempotencyRecord = model
  .define("store_idempotency_record", {
    id: model.id({ prefix: "stidem" }).primaryKey(),
    operation: model.text(),
    request_fingerprint: model.text(),
    state: model.enum([...STORE_IDEMPOTENCY_STATES]).default("processing"),
    result_safe_metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_store_idempotency_record_claim_scope",
      on: ["operation", "actor_scope_hash", "resource_scope_hash", "idempotency_key_hash"],
      unique: true,
    },
  ])
```

Use explicit enums, unique indexes and minimal JSON. For `CartReview`, copy the partial-unique pattern from `guest-cart-capability.ts:15-30`; enforce at most one pending review per cart. Do not use unrestricted `Cart.metadata`.

**Physical responsibilities approved by research review:**

- `CustomerCartAuthority`: unique Customer pointer and unique active cart; ambiguous/backfill states fail closed and never choose by timestamp.
- `CartMergeResult`: immutable original public snapshot/ETag/outcome/review plus safe bindings and expiry coordinated with `StoreIdempotency`.
- `CartReview`: `pending|acknowledged` terminal semantics needed for exact ACK replay; no public timestamps, actor IDs, internal IDs or hashes.
- No positive state transition emits `CUSTOMER_CART_PRESERVED` until a future human rule exists.

### 2. Single PostgreSQL transaction and snapshot

**Apply to:** `cart-merge/service.ts`, merge route, acknowledge route, `customer-active-cart.ts`, `active/route.ts`, `line-item-mutation.ts`, PG tests.

**Transaction/shared-context pattern — source:** `apps/backend/src/api/store/carts/line-item-mutation.ts:532-622`

```typescript
return transaction.call(cartModule.baseRepository_, async (transactionManager) => {
  const transactionContext = transactionManager.getTransactionContext?.()
  if (!transactionContext) {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  await lockCartOrderAuthority(transactionContext, cartId)
  const context = currentVersionContext(transactionContext)

  const casResult = await versionService.compareAndSwapWithMutation({
    resourceType: "cart",
    resourceId: cartId,
    expectedVersion,
    sharedContext: context,
    mutate: async (sharedContext) => nativeWorkflow.run({ input, context: sharedContext }),
  })

  const snapshot = await retrieveCartSnapshotInTransaction(
    cartModule,
    cartId,
    casResult.type === "updated" ? casResult.version : casResult.actualVersion,
    context
  )
  return { casResult, snapshot }
})
```

Extend this pattern rather than calling independent workflows. Phase 16 must keep Customer-scope lock, lexically ordered cart locks, capability row, idempotency/result/review writes, version changes, guest superseding/association and the response snapshot under one transaction manager and one visible commit.

**CAS pattern — source:** `apps/backend/src/modules/store-resource-version/service.ts:288-337`

```typescript
const current = await this.initialize(
  input.resourceType,
  input.resourceId,
  sharedContext
)
if (current.version !== expected) {
  return { type: "stale", expectedVersion: expected, actualVersion: current.version }
}

const mutationResult = await input.mutate(sharedContext!)
const updated = await rows(knex, `update store_resource_version
  set version = version + 1
  where resource_type = ? and resource_id = ? and version = ?
  returning version`, [input.resourceType, input.resourceId, expected])
```

For ACK, use `loadForUpdate`/version comparison but do not increment: D16-23 and R16-HR-05 require zero structural bump. For merge, return the original committed snapshot on replay rather than the current-cart refetch used by Phase 15.

### 3. Idempotency fingerprint, transactional claim and immutable replay

**Apply to:** `store-idempotency/operations.ts`, service/model, `cart-merge/service.ts`, merge route, HTTP/PG tests.

**Canonical fingerprint pattern — source:** `apps/backend/src/modules/store-idempotency/service.ts:273-327`

```typescript
function canonicalizeSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeSemanticValue(entry))
  }
  const keys = Object.keys(value).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = canonicalizeSemanticValue(value[key])
  }
  return out
}

export function buildStoreIdempotencyRequestFingerprint(input: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeSemanticValue(input)), "utf8")
    .digest("hex")
}
```

Arrays retain input order, so `normalizedGuestIntent` must be explicitly sorted by public `variantId` before fingerprinting. The merge semantic object must include operation, Customer, guest cart, Customer destination or `null`, both authoritative versions and normalized intent. Never include raw capability, JWT or raw idempotency key.

**Claim/replay/conflict pattern — source:** `apps/backend/src/modules/store-idempotency/service.ts:692-795`

```typescript
const keyHash = hashStoreIdempotencyKey(input.rawIdempotencyKey, this.pepper())
const actorScopeHash = hashStoreIdempotencyScope(input.actorScope)
const resourceScopeHash = hashStoreIdempotencyScope(input.resourceScope ?? null)
const fingerprint = buildStoreIdempotencyRequestFingerprint(input.canonicalSemanticObject)

// INSERT ... ON CONFLICT, then SELECT ... FOR UPDATE
if (!fingerprintsMatch(record.request_fingerprint, fingerprint)) {
  return { type: "conflict", record, publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT" }
}
if (isStoreIdempotencyTerminalState(record.state)) {
  return { type: "replay", record }
}
return { type: "in_progress", record }
```

Do not copy the existing post-commit completion at `line-item-mutation.ts:864-893`; the approved merge needs transaction-aware claim/result/completion in the same commit as cart, review and capability. `CartMergeResult` holds the composed allowlisted replay snapshot because `StoreIdempotencySafeMetadata` permits only scalars.

### 4. Capability authorization, lock order and terminal replay

**Apply to:** `guest-cart-capability/service.ts`, `types.ts`, merge service/route and capability leakage tests.

**Preflight/final authorization pattern — source:** `apps/backend/src/api/store/carts/line-item-mutation.ts:140-155,544-563`

```typescript
lookupGuestCapability: (token: string) =>
  guestCapabilityService.lookupGuestCartCapabilityByPresentedToken(token, {
    touch: false,
  })

await guestCapabilityService.authorizeGuestCartCapabilityForMutation(
  presentedToken,
  cartId,
  { now: new Date() },
  context
)
```

**Lock/lifecycle pattern — source:** `apps/backend/src/modules/guest-cart-capability/service.ts:403-497,570-664`

```typescript
await lockCartOrderAuthority(transaction as never, cartId)
const lockedRows = await capabilityRows(
  transaction,
  `select ${capabilityColumns()} from guest_cart_capability
   where token_hash = ? and deleted_at is null for update`,
  [presentedHash]
)

const updatedRows = await capabilityRows(
  transaction,
  `update guest_cart_capability
   set status = 'consumed', consumed_at = ?, updated_at = ?
   where id = ? and status = 'active'
     and consumed_at is null and revoked_at is null
     and expires_at > ? and deleted_at is null
   returning ${capabilityColumns()}`,
  bindings
)
```

Preserve cart-lock-before-capability-row ordering. Add a terminal lookup restricted to authenticated BFF + Customer + same key/fingerprint/safe capability binding. It must not touch TTL, reactivate the capability or authorize a new mutation. Consumption lives inside the merge transaction and is visible only on commit; `NO_ITEMS` does not consume.

### 5. Thin routes, BFF-only security and deprecated adapter

**Apply to:** merge route, ACK route, attach route/helper, BFF operation tuple, middlewares.

**Current route import/error style — source:** `apps/backend/src/api/store/customers/me/cart/attach/route.ts:1-18,165-177`

```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // thin authentication/input translation, then delegate to one service
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Customer authentication is required"
    )
  }
}
```

Do **not** copy the legacy core at `attach/route.ts:179-255`: it trusts session guest state, chooses `updated_at DESC`, runs transfer/update/supersede as separate workflows, refetches after the writes and emits legacy outcomes. The adapter must use the same validator, dual authority, idempotency operation, merge service and serializer as the canonical route. Session-only requests receive a stable deprecation/migration error with zero effect.

**Exact-set BFF pattern — source:** `apps/backend/src/api/store/carts/bff-protected-operations.ts:1-13`

```typescript
export const STORE_CART_BFF_PROTECTED_OPERATIONS = [
  "GET /store/carts/active",
  "POST /store/carts/active",
  // exact operations only; never authorize by prefix
] as const
```

**Fail-closed BFF guard — source:** `apps/backend/src/api/middlewares.ts:582-618`

```typescript
const decision = authenticateBffServiceRequest({
  expectedSecret: env.CUSTOMER_AUTH_BFF_SERVICE_SECRET,
  headerValue: req.headers[CUSTOMER_AUTH_BFF_AUTH_HEADER],
})
if (decision.outcome === "authorized") {
  request.customerAuthBff = { authorized: true }
  next()
  return
}
if (!res.headersSent) {
  res.status(404).json({ type: "not_found", message: "Not Found" })
}
```

Add exact merge and ACK entries. Mount Customer bearer authentication for both; merge also requires the operation-specific guest capability header. Remove `session` from attach authority. ACK has no capability and no `Idempotency-Key`.

### 6. Canonical Customer authority and review guard

**Apply to:** `customer-active-cart.ts`, `active/route.ts`, merge service, line-item mutation, future checkout guard.

The current selector at `customer-active-cart.ts:11-38` is explicitly an anti-pattern for Phase 16:

```typescript
function sortByUpdatedAtDesc(a: StoreCartPreOrderRecord, b: StoreCartPreOrderRecord) {
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
}

export function selectCanonicalCustomerActiveCart(carts: readonly StoreCartPreOrderRecord[]) {
  return [...carts].filter(isActiveCartForCheckout).sort(sortByUpdatedAtDesc)[0] ?? null
}
```

Replace its decision with a discriminated `none|single|ambiguous` authority under a Customer advisory transaction lock and durable pointer. `active/route.ts:352-380` must acquire the same Customer authority before reusing or creating a cart, closing the phantom-cart race. More than one usable candidate without an unambiguous authority returns stable 409 with no effects.

Before any structural mutation, load pending `CartReview` in the same transaction. Pending means `409 REVIEW_REQUIRED`; do not claim idempotency, run workflows, bump versions, consume capability or alter the review. Only valid ACK clears it. This implements R16-HR-03 and supersedes the earlier research recommendation to auto-supersede review on mutation.

### 7. Closed public serializers and validators

**Apply to:** `serializers.ts`, `merge-review-validators.ts`, merge/ACK routes and OpenAPI schemas.

**Allowlist serializer pattern — source:** `apps/backend/src/api/store/carts/serializers.ts:221-274`

```typescript
export function serializeStoreCartPreOrder(cart: StoreCartPreOrderRecord | null) {
  if (!cart) return null
  return {
    id: cart.id,
    email: cart.email ?? null,
    currency_code: cart.currency_code ?? null,
    items: (cart.items ?? []).map((item) => ({
      id: item.id ?? null,
      quantity: item.quantity ?? 0,
      variant_id: item.variant_id ?? null,
    })),
  }
}
```

Create explicit serializers for `RejectedItem`, `CartReviewState`, merge response and ACK response. Never spread persisted result/review rows. Public rejected items contain exactly safe variant ID, requested/accepted/rejected quantities and one of the three approved reason codes. Public review contains exactly `requiresReview`, `reviewRef`, `rejectedItems`.

Validation must be strict and mirror OpenAPI. Merge body binds only `{ guestCartId: string }`; ACK body is exactly `{ reviewRef: string | null }`. Malformed persisted carts fail stable 409 rather than becoming artificial `VARIANT_INVALID`.

### 8. Store manifest and OpenAPI registry

**Apply to:** manifest, cart registry/schemas/components, exclusions, generated Store artifact and contract tests.

**Manifest pattern — source:** `apps/backend/src/api/store-surface/manifest.ts:673-708,835-854`

```typescript
entry({
  method: "POST",
  pathTemplate: "/store/carts/active",
  origin: "local",
  classification: "EXTENDED",
  runtime_policy: "M1_ENABLED",
  m1_enablement: "enabled",
  openapi_m1_expectation: "include_executable_m1",
  owner_phase: "15",
  owner_domain: "cart",
})
```

Add merge and ACK to the M1 exact set with Phase 16 ownership. Keep attach outside M1 as a controlled deprecated adapter with an explicit exclusion reason/owner/review trigger. Continue DENY for native `/store/carts/{id}/customer`. Recompute manifest counters from code; do not hard-code or silently weaken the exact-set tests.

**Registry operation pattern — source:** `apps/backend/src/api-docs/operations/store/carts.ts:85-124`

```typescript
registry.registerOperation({
  surface: "store",
  method: config.method,
  path: config.path,
  operationId: config.operationId,
  tags: ["Cart"],
  security: [...STORE_CART_M1_BFF_OPTIONAL_CUSTOMER],
  parameters: [CORRELATION_ID_HEADER, STORE_IF_MATCH_REF, STORE_IDEMPOTENCY_KEY_REF],
  responses: { "200": cartJsonResponse("Cart mutation completed."), ...errors },
  sourceFiles: [sourceFile, serializerFile, "apps/backend/src/api/middlewares.ts"],
  testEvidence: [testFile],
  interactiveCandidate: false,
  nonInteractive: true,
})
```

Use the exact approved security tuple, not `STORE_CART_M1_BFF_OPTIONAL_CUSTOMER` unchanged where it permits a guest-or-Customer alternative. Merge requires BFF + publishable + Customer bearer + required merge-only capability parameter; ACK requires BFF + publishable + Customer bearer. Both require `If-Match`; only merge requires `Idempotency-Key`.

**Strict schema pattern — source:** `apps/backend/src/api-docs/operations/store/schemas.ts:675-718,809-818`

```typescript
registry.registerComponent("store", "schemas", "StoreAddCartLineItemRequest", {
  type: "object",
  additionalProperties: false,
  required: ["variant_id", "quantity"],
  properties: { /* closed fields */ },
})
```

Registry TypeScript is authoritative. Generate only the Store surface after authorized implementation, review the diff, lint, and run `openapi:check` later as a clean-worktree read-only gate. Never hand-edit `generated/store.openapi.json`; never add sensitive examples; Swagger remains non-interactive.

### 9. Test and evidence patterns

**Apply to:** decision unit, new HTTP/PG suites, failpoint/multiprocess helpers, all existing suites listed in classification.

**Decision-table unit pattern — source:** `apps/backend/src/modules/checkout/__tests__/attach-guest-cart.unit.spec.ts:22-38,88-112`

```typescript
function buildCart(overrides: Partial<CheckoutCartLike> = {}): CheckoutCartLike {
  return { id: "cart_guest_01", currency_code: "brl", items: [/* fixture */], ...overrides }
}

expect(buildDecision({ customerCart, guestCart })).toEqual({
  action: "transfer",
  guestCartId: "cart_guest_01",
})
```

Copy the fixture/explicit equality style, not legacy session or outcome semantics. Cover aggregation by variant, ceiling 99, all accepted, partial, all rejected, malformed persisted state, exact five-literal enum and no positive `CUSTOMER_CART_PRESERVED` fixture.

**Snapshot barrier pattern — source:** `apps/backend/integration-tests/http/guest-cart-mutation-snapshot-concurrency.spec.ts:287-324`

```typescript
const promiseA = addLineItem(requestA, responseA)
await harness.aSnapshotCaptured.promise
const promiseB = addLineItem(requestB, responseB)
await harness.bWaitingForLock.promise
expect(bCompleted).toBe(false)

harness.allowASnapshotToReturn.resolve()
await Promise.all([promiseA, promiseB])
expect(responseA.headers.etag).toBe('"2"')
expect(responseB.headers.etag).toBe('"3"')
expect(harness.snapshotTransactions).toEqual(harness.casTransactions)
```

Adapt this to prove original merge snapshot/ETag replay and coherent ACK snapshots. Do not use a late `remoteQuery` result for the body or ETag.

**Real PostgreSQL rollback pattern — source:** `apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts:392-440`

```typescript
await expect(
  inTransaction(async (context) => {
    const result = await service.compareAndSwapWithMutation({
      resourceType: "product",
      resourceId: "prod_rollback",
      expectedVersion: 1,
      sharedContext: context,
      mutate: async (sameContext) => createControlledMutation("probe", sameContext),
    })
    expect(result.type).toBe("updated")
    throw new Error("INJECTED_FAILURE")
  })
).rejects.toThrow("INJECTED_FAILURE")

expect(mutationTransactionId).toBe(transactionId)
expect(await readVersion("product", "prod_rollback")).toBeNull()
```

The Phase 16 PG suite must inject a failure after every relevant write and assert baseline carts/lines/versions, capability ACTIVE, guest active, no committed result/review/idempotency, and real Orders count unchanged. Use disposable PostgreSQL, real transaction IDs and the existing multiprocess child-worker pattern; Redis must be absent or explicitly non-authoritative.

Required cross-cutting evidence:

- same-key replay before and after consumed capability; conflicting key/fingerprint and different-key loser;
- merge vs guest mutation, Customer mutation and active-cart creation races;
- exact one line per variant, exact quantities, exact version bumps and one review;
- pending review blocks line-item mutation, another merge and checkout;
- valid ACK, ACK replay, `null` no-op, pending+null, foreign/divergent ref and stale `If-Match`;
- attach adapter parity and session-only zero-effect denial;
- eight-sink zero leakage using distinct capability/JWT/raw-key canaries;
- real PostgreSQL/Medusa zero-Order count for every outcome, conflict, replay, ACK, race and rollback.

## Shared Patterns

### Authentication and authorization

- BFF service credential, publishable authority, Customer bearer and guest capability are distinct checks.
- Merge authenticates Customer and capability simultaneously; do not reuse the XOR/precedence actor helper.
- ACK authenticates BFF + publishable + Customer bearer only.
- Foreign/invalid capability/cart/review remains non-enumerable and zero-effect.

### Error handling

- `412` is reserved for well-formed stale `If-Match` and uses `CART_VERSION_MISMATCH` with a coherent safe snapshot/ETag where allowed.
- `409` covers ambiguous authority, idempotency conflict/in-progress, consumed capability under another intention, malformed persisted cart, `REVIEW_REQUIRED`, divergent review ref and a different-key race loser.
- Variant invalid/unavailable/overflow are item decisions inside `MERGED_PARTIAL` or `NO_ITEMS`, not request-level technical errors.
- Technical exceptions roll back; never translate them into `VARIANT_UNAVAILABLE`.

### Lock order

1. Customer-scope advisory transaction lock.
2. Resolve `none|single|ambiguous` authority.
3. Affected cart advisory/row locks in lexical cart-ID order.
4. Resource-version rows in the same order.
5. Guest capability row.
6. Idempotency, merge-result and review rows.
7. Revalidate ownership, active/completed state, items, versions and review before deciding.

### Response projection

- Capture cart, version/ETag, review and original replay response in the transaction.
- `requiresReview === true` if and only if the applied outcome is `MERGED_PARTIAL`.
- `NO_ITEMS` changes no cart/review/version/capability state but may commit an immutable receipt.
- ACK returns current cart/review coherently and never bumps the structural version.

## No Exact Analog Found

| File/Concern | Role | Data Flow | Reason / Planner Action |
|---|---|---|---|
| `customer-cart-authority.ts` | model | CRUD | No durable Customer→canonical-cart authority exists. Compose the constrained Medusa model pattern with PostgreSQL Customer-scope locking; never copy timestamp selection. |
| `cart-merge-result.ts` | model | CRUD | Existing idempotency metadata cannot hold the immutable composed public replay. Create a minimized receipt with coordinated retention. |
| `cart-review.ts` | model | CRUD + state machine | No version-bound review/ACK model exists. Use constrained enums/unique pending index and exact ref/version semantics. |
| `cart-merge/service.ts` | service | multi-resource CRUD/transform | No current service commits two carts, capability, receipt, review and versions atomically. Compose the five assigned analog patterns under one manager. |
| Merge multiprocess/failpoint suite | test | concurrency + batch | Existing tests cover pieces, not the complete multi-cart lock graph. Reuse disposable PG and child-process harnesses and add Phase 16-specific assertions. |
| Positive `CUSTOMER_CART_PRESERVED` branch/test | none | none | Intentionally forbidden by R16-HR-01 until a future human-approved deterministic rule exists. Do not create it. |

## Explicit Anti-Patterns

- Do not copy `updated_at DESC` canonical selection.
- Do not use session as guest merge authority.
- Do not run transfer, update, supersede, consume, review and completion in separate commits.
- Do not complete merge idempotency after the cart transaction.
- Do not fetch the current cart to synthesize a committed replay.
- Do not supersede/clear a pending review through structural mutation; block with `REVIEW_REQUIRED`.
- Do not introduce `Idempotency-Key` on ACK.
- Do not store raw capability, JWT, raw idempotency key, unrestricted cart entity, catalog snapshot, provider IDs or internal review/audit fields.
- Do not hand-edit OpenAPI JSON or make Swagger interactive.
- Do not create an `Order`, invoke real providers, touch remote DB/Redis or deploy infrastructure.

## Metadata

**Analog search scope:** `apps/backend/src/api/store/**`, `apps/backend/src/modules/{checkout,guest-cart-capability,store-idempotency,store-resource-version}/**`, `apps/backend/src/api-docs/**`, `apps/backend/integration-tests/**`, `apps/backend/medusa-config.ts`

**Primary analogs:**

1. `apps/backend/src/api/store/carts/line-item-mutation.ts`
2. `apps/backend/src/modules/store-idempotency/service.ts`
3. `apps/backend/src/modules/guest-cart-capability/service.ts`
4. `apps/backend/src/modules/store-resource-version/service.ts`
5. `apps/backend/src/api/store/customers/me/cart/attach/route.ts` (route shell plus explicit anti-pattern)

**Supporting pattern sources:** serializers, Store registry/schemas, exact-set BFF middleware/manifest, decision unit test, snapshot concurrency test and resource-version PostgreSQL rollback test.

**Pattern extraction date:** 2026-08-23
