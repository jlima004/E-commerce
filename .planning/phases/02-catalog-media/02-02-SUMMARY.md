---
phase: 02-catalog-media
plan: "02"
subsystem: catalog
tags: [gelato, medusa, catalog, admin, sellable-gate, workflow, middleware, jest]

requires:
  - phase: 02-catalog-media
    plan: "01"
    provides: assertSellableVariantMetadata, isSellableVariant, GelatoMetadataError contract
provides:
  - Sellable/publish gate on admin product + variant create/update routes
  - validateSellableCatalogMutationWorkflow reusing central Gelato contract
  - Operator-safe MedusaError mapping for Admin validation failures
  - is_sellable re-export from single source for future Store API (02-04)
affects: [02-04, 02-05]

tech-stack:
  added: []
  patterns:
    - "Gate runs only when product is published or transitioning to published; drafts stay permissive"
    - "Admin middleware delegates to validateSellableCatalogMutationWorkflow + assertSellableVariantMetadata"
    - "GelatoMetadataError mapped to MedusaError INVALID_DATA with sanitized operator messages"

key-files:
  created:
    - apps/backend/src/workflows/catalog/validate-sellable-variant.ts
    - apps/backend/src/api/admin/products/validators.ts
    - apps/backend/src/api/admin/products/sellable-gate-middleware.ts
    - apps/backend/integration-tests/http/catalog-admin.spec.ts
  modified:
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "Product workflows in Medusa 2.16 lack pre-validate hooks; gate integrates via POST middleware on /admin/products* routes before core workflows run"
  - "Publishing without variant payload validates all existing variants from query graph"
  - "is_sellable remains a re-export of isSellableVariant — no duplicate sellability rules"

patterns-established:
  - "Pattern: validateSellableCatalogMutation centralizes draft vs publish enforcement"
  - "Pattern: formatGelatoMetadataAdminMessage blocks stack traces and secret-shaped canaries in operator errors"

requirements-completed: [CAT-02, CAT-03]

duration: 28 min
completed: 2026-06-26
status: complete
---

# Phase 02 Plan 02: Sellable/Publish Gate Summary

**Admin gate blocks publish/sell on invalid Gelato metadata while preserving incomplete drafts — single source of truth via assertSellableVariantMetadata**

## Performance

- **Duration:** 28 min
- **Started:** 2026-06-26T19:05:00Z
- **Completed:** 2026-06-26T19:33:00Z
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- Draft create/update with incomplete `gelato_*` metadata remains allowed (D-06)
- Hard block only when product is `published` or transitioning to `published` (D-07, D-08)
- `validateSellableCatalogMutationWorkflow` + admin POST middleware on product/variant routes
- `isSellableVariant` re-exported for deterministic `is_sellable` in 02-04 (D-09)
- Operator-facing `MedusaError` messages without stack traces or secret canaries
- 13 integration tests covering draft, publish, update, gelato error safety, and middleware

## Task Commits

Not committed in this session — awaiting manual gate review per project execution policy.

1. **Task 1: Criar testes RED do gate de sellable/publish** — pending commit
2. **Task 2: Implementar o gate compartilhando a mesma fonte de verdade** — pending commit

## Files Created/Modified

- `apps/backend/src/workflows/catalog/validate-sellable-variant.ts` — Gate logic, merge helpers, durable workflow, admin validation entrypoints
- `apps/backend/src/api/admin/products/validators.ts` — GelatoMetadataError → MedusaError operator messages
- `apps/backend/src/api/admin/products/sellable-gate-middleware.ts` — POST middleware for admin catalog mutations
- `apps/backend/src/api/middlewares.ts` — Registers sellable gate on `/admin/products*` POST routes
- `apps/backend/integration-tests/http/catalog-admin.spec.ts` — HTTP contract tests for draft vs publish gate

## Decisions Made

- Medusa 2.16 product workflows expose post-create hooks only; pre-flight validation uses admin middleware calling the catalog validation workflow (closest supported integration point)
- Variant update on published products merges existing graph data with request payload before assert
- Publish-without-variants payload loads all product variants from query graph for full-catalog validation

## Deviations from Plan

- Middleware-based integration instead of native workflow `hooks.validate` (not available on product workflows in 2.16). Behavioral contract unchanged: block before persistence on sellable/publish paths.

## Issues Encountered

None

## User Setup Required

None

## Verification

```bash
cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts
# PASS — 13 tests

cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts
# PASS — 17 tests (02-01 regression)

cd apps/backend && npm run build
# PASS — backend build completed successfully
```

## Self-Check: PASSED

- [x] key-files.created exist on disk
- [x] Draft incomplete passes; publish/sellable invalid fails with clear safe errors
- [x] Single validation source: assertSellableVariantMetadata / isSellableVariant
- [x] No migrations run
- [x] No deploy performed
- [x] Did not advance to 02-03

## Next Phase Readiness

- **02-03** (Supabase Storage provider) remains unstarted — manual gate before execution
- **02-04** can import `isSellableVariant` from `validate-sellable-variant.ts` for public catalog shaping
- **02-05** snapshot builder should call `assertSellableVariantMetadata` (same contract as gate, D-10)

---
*Phase: 02-catalog-media*
*Completed: 2026-06-26*
