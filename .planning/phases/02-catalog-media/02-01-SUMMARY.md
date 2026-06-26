---
phase: 02-catalog-media
plan: "01"
subsystem: catalog
tags: [gelato, medusa, catalog, metadata, zod-free, jest, brl]

requires:
  - phase: 01-foundation-observability
    provides: Medusa v2 scaffold, Jest unit runner, structured logging/redaction
provides:
  - Typed central helper for ProductVariant Gelato metadata (`readGelatoMetadata`, `isSellableVariant`, `assertSellableVariantMetadata`)
  - Shared catalog types for the Gelato variant contract
  - RED/GREEN unit test suite locking parse/sellable/BRL/error semantics
affects: [02-02, 02-04, 02-05, phase-06-order-snapshot]

tech-stack:
  added: []
  patterns:
    - "All gelato_* reads go through apps/backend/src/modules/catalog/gelato-metadata.ts"
    - "Draft incomplete metadata is representable; sellable gate is explicit and shared between assert and isSellableVariant"

key-files:
  created:
    - apps/backend/src/modules/catalog/gelato-metadata.ts
    - apps/backend/src/modules/catalog/types.ts
    - apps/backend/src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts
  modified: []

key-decisions:
  - "Sellable contract requires template_mode=fixed plus non-empty gelato_variant_options.size/color and integer BRL cents price"
  - "assertSellableVariantMetadata throws GelatoMetadataError with stable toPayload() codes; no stack in payload"
  - "No Order/LineItem persistence in this slice — metadata helper only"

patterns-established:
  - "Pattern: CatalogVariantInput minimal stub for unit tests and future callers"
  - "Pattern: GelatoMetadataReadResult distinguishes complete vs incomplete draft without throwing"

requirements-completed: [CAT-01, CAT-02, CAT-04]

duration: 12 min
completed: 2026-06-26
status: complete
---

# Phase 02 Plan 01: Gelato Variant Metadata Contract Summary

**Typed central helper for ProductVariant Gelato metadata with shared sellable gate, BRL integer-cents validation, and stable error payloads — no Order/LineItem touch**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-26T17:32:00Z
- **Completed:** 2026-06-26T17:44:00Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- Centralized Gelato metadata contract per `docs/DB_MODEL_v1.21.md` §4.11 / §5.1 with `template_mode=fixed`
- `readGelatoMetadata` parses/normalizes raw `variant.metadata` and distinguishes complete vs incomplete draft
- `isSellableVariant` and `assertSellableVariantMetadata` share the same sellable rules including BRL integer cents
- `GelatoMetadataError.toPayload()` exposes stable codes for internal consumers without stack traces
- 17 unit tests (RED → GREEN) cover parse, sellable, BRL, and typed errors

## Task Commits

Not committed in this session — awaiting manual gate approval before atomic GSD commits.

1. **Task 1: Escrever a suite RED do contrato Gelato da variante** — pending commit
2. **Task 2: Implementar helper tipado e erros deterministas** — pending commit

## Files Created/Modified

- `apps/backend/src/modules/catalog/types.ts` — Shared Gelato catalog types and error payload shapes
- `apps/backend/src/modules/catalog/gelato-metadata.ts` — Parser, sellable predicate, strict assert, typed errors
- `apps/backend/src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts` — Contract unit tests

## Decisions Made

- Sellable variants require all four operator fields (`gelato_product_uid`, `gelato_template_id`, `gelato_variant_options`, `template_mode=fixed`) plus a BRL price in integer minor units
- Wrong `template_mode` when other fields are present maps to `GELATO_TEMPLATE_MODE_INVALID` (distinct from generic incomplete draft)
- Empty `{}` variant options reports granular missing keys (`gelato_variant_options.size`, `gelato_variant_options.color`)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Verification

```bash
cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts
# PASS — 17 tests

cd apps/backend && npm run build
# PASS — backend build completed successfully
```

## Self-Check: PASSED

- [x] key-files.created exist on disk
- [x] All acceptance_criteria re-verified (RED failed pre-impl, GREEN 17/17, draft vs sellable distinguished)
- [x] Plan-level verification commands logged above
- [x] No Order/LineItem code touched
- [x] No migrations run
- [x] No deploy performed

## Next Phase Readiness

- Ready for **02-02** (sellable/publish workflow hook) — imports `assertSellableVariantMetadata` / `isSellableVariant`
- Snapshot builder (02-05) can reuse `readGelatoMetadata` + types from this slice
- Blocked behind manual gate until human approves this SUMMARY

---
*Phase: 02-catalog-media*
*Completed: 2026-06-26*
