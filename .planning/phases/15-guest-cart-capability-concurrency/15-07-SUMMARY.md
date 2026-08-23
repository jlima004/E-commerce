---
phase: 15-guest-cart-capability-concurrency
plan: 07
subsystem: api-docs
tags: [openapi, store-api, cart, guest-capability, swagger]

requires:
  - phase: 15-06
    provides: "Cart M1 runtime exact-set and Guest/Customer line-item mutations closed with human PASS."
provides:
  - "Store registry documentation for the six Cart M1 operations."
  - "Writer-generated Store OpenAPI artifact with guest capability and concurrency headers."
affects: [phase-15-08, storefront-contract]

tech-stack:
  added: []
  patterns:
    - "Optional BFF-only guest capability request parameter with no examples."
    - "Capability response header emitted only on guest mint 201; replay and mutations omit it."

key-files:
  created:
    - ".planning/phases/15-guest-cart-capability-concurrency/15-07-SUMMARY.md"
  modified:
    - "apps/backend/src/api-docs/operations/store/carts.ts"
    - "apps/backend/src/api-docs/operations/store/schemas.ts"
    - "apps/backend/src/api-docs/components/headers.ts"
    - "apps/backend/src/api-docs/components/parameters.ts"
    - "apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts"
    - "apps/backend/src/api-docs/generated/store.openapi.json"

key-decisions:
  - "Preserved the six approved Cart M1 operationIds exactly as authorized by Plan 15-07."
  - "Kept the existing runtime manifest and runtime surface unchanged; this plan only materializes already-authorized operations in API Docs."
  - "Did not run openapi:check; that global gate remains reserved for Plan 15-08."

patterns-established:
  - "Cart mutation requests reuse Idempotency-Key and If-Match component references and return the canonical StoreCartResponse with ETag."
  - "CART_VERSION_MISMATCH responses reuse StoreErrorResponse, whose cart property references PublicStoreCartPreOrder."

requirements-completed: [CART-02, CART-04, CART-08]

duration: "~20 min"
completed: 2026-08-21
status: human-approved-pass
---

# Phase 15 Plan 15-07 Summary

**Store OpenAPI now documents the six approved Cart M1 operations with fail-closed guest capability and cart-version contracts.**

## Status

- `15-07 TECHNICAL EXECUTION: PASS`
- `15-07 HUMAN APPROVED — PASS`
- `15-07 DOCUMENTALLY CLOSED`
- `15-08 EXECUTION: HUMAN AUTHORIZED — NOT STARTED`
- `DEPLOY: NOT AUTHORIZED`

## Accomplishments

- Materialized exactly six Cart M1 operations with operationIds `getActiveStoreCart`, `createActiveStoreCart`, `addCartLineItem`, `updateCartLineItem`, `removeCartLineItem`, and `clearCartLineItems`.
- Added `x-indicio-guest-cart-token` as an optional request header on all six operations, with `x-bff-only`, `x-not-browser-credential`, and `x-sensitive`; no `example` or `examples` fields were added.
- Added the capability response header only to `POST /store/carts/active` `201`; replay `200`, GET, and all four mutations omit it.
- Documented required `Idempotency-Key` on POST active, required `If-Match` and `Idempotency-Key` on all four mutations, and `412 CART_VERSION_MISMATCH` using `StoreErrorResponse.cart -> PublicStoreCartPreOrder`.
- Added strict add/update line-item request schemas matching the runtime quantity rules.
- Generated only `store.openapi.json` through the writer.

## Verification

- Store contract unit: `22/22 PASS` via `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/store-contract.unit.spec.ts`.
- Writer: `PASS` via `npm run openapi:generate -w @dtc/backend -- --surface store`.
- OpenAPI lint: `PASS` via `npm run openapi:lint -w @dtc/backend`.
- Sanitized artifact inspection: `6/6` Cart M1 operations; guest request header `6/6`; `required: false`; capability response location only `POST /store/carts/active 201`; `0` examples; `0` unsafe examples; no Pix payload, tracking token, or credential examples.
- Admin artifact unchanged: SHA-256 `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` before and after writer.
- Webhooks artifact unchanged: SHA-256 `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` before and after writer.
- Store artifact was writer output: SHA-256 changed from `4e1693221a8b7ffe2f601b4e694cf1f15f42cec1d473b831a07a91894ad81dc7` to `9f4e04974691768ca99ccc047089f9ba1e88f6b9c717895f0522ae1f04e166a6`.
- `git diff --check`: `PASS`.
- Runtime surface/manifest: unchanged; no route was promoted.
- `openapi:check`: intentionally **NOT RUN** per Plan 15-07.

## Task Commits

1. Task 15-07-01 TDD RED: `9a69854` — `test(15-07): add Store cart contract assertions`.
2. Task 15-07-01 GREEN: `0783550` — `feat(15-07): materialize Store cart M1 contract`.
3. Task 15-07-02: `636fb5b` — `feat(15-07): generate Store OpenAPI cart contract`.
4. Task 15-07-03: human checkpoint — HUMAN APPROVED — PASS; no implementation commit.

## Files Modified

- `apps/backend/src/api-docs/operations/store/carts.ts` — six Cart M1 operations, headers, preconditions, responses, and operationIds.
- `apps/backend/src/api-docs/operations/store/schemas.ts` — strict add/update line-item request schemas.
- `apps/backend/src/api-docs/components/parameters.ts` — optional guest capability request parameter and line-item path parameter.
- `apps/backend/src/api-docs/components/headers.ts` — ETag and guest capability response-header mappings.
- `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts` — exact-set, header, response, DTO, non-interactive, and safe-example assertions.
- `apps/backend/src/api-docs/generated/store.openapi.json` — generated exclusively by the Store writer.

`components/errors.ts` and `coverage/exclusions.ts` required no diff: the approved `PublicStoreCartPreOrder` error property and DENY exclusions were already present and remain unchanged.

## Deviations from Plan

None - plan executed within the authorized scope. The existing test suite was already RED on the four runtime-promoted line-item routes before implementation; the TDD GREEN change resolved that exact coverage gap.

## Issues Encountered

None blocking. No remote DB/Redis, real provider, Resend, secret/env change, deploy, push, PR, or runtime-surface change was performed.

## Human Review Remediation — B15-07-HR-01

`B15-07-HR-01`: Cart OpenAPI initially omitted the mandatory BFF service
authority.

**Root cause:** the Cart registry reused `STORE_OPTIONAL_CUSTOMER`, whose
security alternatives did not contain `bffServiceCredential`.

**Remediation:** introduced the Cart-M1-specific
`STORE_CART_M1_BFF_OPTIONAL_CUSTOMER` exact-set, requiring
`bffServiceCredential` plus `publishableApiKey` in every alternative, with
optional Customer bearer/session variants. Added a regression assertion for
the exact six operations and three alternatives.

**Runtime:** UNCHANGED

**Store surface:** UNCHANGED

**OpenAPI artifact:** REGENERATED BY WRITER

**Admin/Webhooks:** UNCHANGED

Remediation evidence:

- Cart M1 security exact-set: `6/6` operations require
  `bffServiceCredential` and `publishableApiKey` in all `3` alternatives.
- Publishable-only alternatives: `0`.
- Guest alternative has no Customer bearer/session; bearer and session
  alternatives remain mutually exclusive.
- Store contract unit: `23/23 PASS`.
- `openapi:lint`: `PASS`.
- Generated Store artifact SHA-256:
  `4c8f8dd2b95ebe089146531d250f40f6b274b04687f63c5037026ac9e8432a92`.
- Admin artifact unchanged: SHA-256
  `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a`.
- Webhooks artifact unchanged: SHA-256
  `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4`.
- Previous 15-07 locks revalidated: Cart M1 `6/6`; guest request header
  `6/6` with `required: false`; capability response header only on POST
  active `201`; replay `200`, GET and mutations omit it; `412
  CART_VERSION_MISMATCH -> PublicStoreCartPreOrder`; non-interactive and
  sensitive-example assertions remain PASS.
- Swagger `nonInteractive`: `PASS`; sensitive examples: `0`.
- Admin OpenAPI changed: `NO`; Webhooks OpenAPI changed: `NO`.
- `git diff --check`: `PASS`.
- Remediation commit: `637f19d` — `fix(15-07): require BFF authority in cart OpenAPI`.
- `openapi:check`: **NOT RUN** by explicit scope restriction.

Human review is **CLOSED — PASS**. `B15-07-HR-01` is **CLOSED — PASS**.
Plan 15-08 execution was explicitly human-authorized on 2026-08-21 and remains
**NOT STARTED**.

## Human Checkpoint

- Human decision: **PASS**.
- `B15-07-HR-01`: **CLOSED — PASS**.
- Plan 15-07: **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.
- Plan 15-08 execution: **HUMAN AUTHORIZED — NOT STARTED**.
- `openapi:check` remained **NOT RUN** during Plan 15-07 and is now permitted only inside the mandatory Plan 15-08 ledger.
- Phase 16, frontend, deploy, real providers and remote infrastructure remain unauthorized.

---
*Phase: 15-guest-cart-capability-concurrency*
*Plan: 15-07*
*Technical execution completed: 2026-08-21*
