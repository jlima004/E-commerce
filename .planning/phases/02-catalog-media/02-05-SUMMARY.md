---
phase: 02-catalog-media
plan: "05"
subsystem: catalog
tags: [gelato, catalog, snapshot, contract, phase-6, jest]

requires:
  - phase: 02-catalog-media
    plan: "01"
    provides: readGelatoMetadata, assertSellableVariantMetadata, central typed Gelato contract
  - phase: 02-catalog-media
    plan: "02"
    provides: sellable gate and shared validation source
provides:
  - Pure typed `buildGelatoSnapshot` helper with immutable output
  - Unit test suite locking canonical snapshot shape and fail-loud behavior
  - Documented v1 snapshot contract for future Phase 6 persistence
affects: [phase-06-order-snapshot]

tech-stack:
  added: []
  patterns:
    - "Snapshot builder reuses assertSellableVariantMetadata as the single source of truth"
    - "Source variant id/sku and captured_at are derived by the builder, never operator-entered"
    - "No Order/LineItem persistence in this slice; Phase 6 will only consume the frozen contract"

key-files:
  created:
    - apps/backend/src/modules/catalog/gelato-snapshot.ts
    - apps/backend/src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts
    - docs/contracts/gelato-snapshot-v1.md
  modified: []

key-decisions:
  - "buildGelatoSnapshot fails loud on invalid metadata by delegating to assertSellableVariantMetadata"
  - "Missing source variant id/sku throws snapshot-specific typed errors before any partial object escapes"
  - "captured_at is normalized as ISO-8601 UTC and the returned object is shallow-frozen with nested options frozen too"

patterns-established:
  - "Pattern: downstream order creation must persist the exact GelatoSnapshot shape without renaming fields"
  - "Pattern: snapshot tests prove later ProductVariant mutations cannot rewrite already-built payloads"

requirements-completed: [CAT-04]

duration: 19 min
completed: 2026-06-27
status: complete
---

# Phase 02 Plan 05: Gelato Snapshot Builder Summary

**Contrato futuro de `gelato_snapshot` entregue como helper puro, tipado, imutável e pronto para a Phase 6 — sem persistência precoce em Order/LineItem**

## Performance

- **Duration:** 19 min
- **Started:** 2026-06-27T14:10:00Z
- **Completed:** 2026-06-27T14:29:00Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- `buildGelatoSnapshot` gera o shape canônico exigido por `docs/DB_MODEL_v1.21.md` §4.11
- O builder reaproveita `assertSellableVariantMetadata` de `02-01/02-02` como única fonte de verdade
- `source_product_variant_id`, `source_product_variant_sku` e `captured_at` são derivados no builder, não digitados manualmente
- O retorno é imutável (`Object.freeze` no objeto e em `gelato_variant_options`)
- Metadata ausente/inválida continua falhando com erro tipado; nunca há snapshot parcial
- O contrato para persistência futura ficou documentado em `docs/contracts/gelato-snapshot-v1.md`

## Task Commits

Not committed in this session — stop requested at the manual gate with SUMMARY only.

1. **Task 1: Escrever testes RED do snapshot builder** — pending commit
2. **Task 2: Implementar builder puro e documentar contrato para a Phase 6** — pending commit

## Files Created/Modified

- `apps/backend/src/modules/catalog/gelato-snapshot.ts` — Helper puro, tipos do snapshot e erros tipados de source variant/captured_at
- `apps/backend/src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` — Prova do shape canônico, imutabilidade e fail-loud
- `docs/contracts/gelato-snapshot-v1.md` — Contrato v1 para consumo futuro da Phase 6

## Decisions Made

- O builder não lê `variant.metadata.gelato_*` diretamente; ele chama `assertSellableVariantMetadata` e usa apenas o retorno validado
- Ausência de `variant.id` ou `variant.sku` falha com erro tipado específico do snapshot
- `captured_at` aceita override opcional para teste/integração futura, mas precisa continuar em ISO-8601 UTC canônico

## Deviations from Plan

- Nenhum desvio funcional. A verificação de build precisou de `XDG_CONFIG_HOME=/tmp/medusa-config`, `TMPDIR=/tmp` e `HMR_PORT=5173` para contornar restrições do sandbox local, sem alterar código nem config do projeto.

## Issues Encountered

- O Jest inicialmente falhou ao criar diretório temporário fora do sandbox; resolvido com `TMPDIR=/tmp`
- O `medusa build` inicialmente falhou por escrita em `~/.config/medusa` e por descoberta de porta do admin bundler; resolvido apenas no comando de verificação com variáveis de ambiente temporárias

## User Setup Required

None

## Verification

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts
# PASS — 6 tests

cd apps/backend && XDG_CONFIG_HOME=/tmp/medusa-config TMPDIR=/tmp HMR_PORT=5173 npm run build
# PASS — backend and frontend build completed successfully
```

## Self-Check: PASSED

- [x] key-files.created exist on disk
- [x] Snapshot builder is pure and does not persist anything in Order/LineItem
- [x] Invalid metadata never emits partial snapshot data
- [x] Contract for Phase 6 matches the same validation source used in this phase
- [x] No migrations run
- [x] No deploy performed
- [x] No secrets/config vars changed
- [x] Did not advance to 02-04

## Next Phase Readiness

- **02-04** remains untouched and still requires its own explicit manual gate
- **Phase 6** can import `buildGelatoSnapshot` and persist the exact `GelatoSnapshot` shape in `LineItem.metadata.gelato_snapshot`
- This plan stops here at manual review with SUMMARY, per request

---
*Phase: 02-catalog-media*
*Completed: 2026-06-27*
