---
phase: 02-catalog-media
plan: "04"
subsystem: api
tags: [store-api, catalog, media, serializer, medusa, jest]

requires:
  - phase: 02-catalog-media
    plan: "01"
    provides: central typed Gelato metadata contract and isSellableVariant gate
  - phase: 02-catalog-media
    plan: "02"
    provides: sellable gating policy reused by the public Store API filter
  - phase: 02-catalog-media
    plan: "03"
    provides: public storage URL contract for catalog images
provides:
  - Stable shopper-facing Store API contract for catalog products and media
  - Query config override that requests only the public catalog surface
  - Response serializer that strips internal fulfillment wiring and hides non-sellable variants
affects: [storefront-future, phase-03-cart-checkout]

tech-stack:
  added: []
  patterns:
    - "Store API extension via middleware only, without custom catalog routes"
    - "Public catalog responses reuse isSellableVariant and never expose gelato metadata"
    - "Catalog media stays on public Supabase URLs already validated in 02-03"

key-files:
  created:
    - apps/backend/src/api/store/products/query-config.ts
    - apps/backend/src/api/store/products/serializers.ts
    - apps/backend/integration-tests/http/catalog-store.spec.ts
  modified:
    - apps/backend/src/api/middlewares.ts

key-decisions:
  - "The implementation extends the standard Medusa Store API through middleware, not a parallel catalog route"
  - "The response serializer emits only shopper-facing fields and drops any gelato_* wiring before the response leaves the backend"
  - "Variants remain visible publicly only when isSellableVariant returns true against the central metadata and BRL price contract"

patterns-established:
  - "Pattern: override Store API field selection in middleware so the public contract stays stable independent of caller fields"
  - "Pattern: response serialization is the final public boundary for catalog payload shaping"

requirements-completed: [CAT-03, MEDIA-01]

duration: 28 min
completed: 2026-06-27
status: complete
---

# Phase 02 Plan 04: Store API Public Contract Summary

**Contrato público estável da Store API entregue com BRL, imagens públicas e filtro de variantes vendáveis, sem rota custom e sem vazamento de `gelato_*`**

## Performance

- **Duration:** 28 min
- **Started:** 2026-06-27T14:22:00Z
- **Completed:** 2026-06-27T14:50:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- A Store API padrão do Medusa agora força um field selection mínimo e estável para catálogo público
- O payload público foi serializado para expor apenas dados shopper-facing: produto, mídia, opções visíveis, preço BRL em centavos inteiros e `is_sellable`
- Variantes não vendáveis deixaram de aparecer na superfície pública por reuso direto de `isSellableVariant`
- O contrato de imagens permaneceu no storage público já validado em `02-03`, sem rotas extras nem binário no banco

## Task Commits

Not committed in this session — stop requested at the manual gate with SUMMARY only.

1. **Task 1: Escrever testes RED do contrato público de catálogo** — pending commit
2. **Task 2: Implementar query config mínima e serializer público** — pending commit

## Files Created/Modified

- `apps/backend/src/api/store/products/query-config.ts` — seleção estável dos campos públicos da Store API
- `apps/backend/src/api/store/products/serializers.ts` — serializer shopper-facing e filtro de variantes não vendáveis
- `apps/backend/src/api/middlewares.ts` — wiring dos middlewares nas rotas padrão `/store/products` e `/store/products/:id`
- `apps/backend/integration-tests/http/catalog-store.spec.ts` — prova do contrato HTTP público sem `gelato_*`

## Decisions Made

- Não foi criada rota custom de catálogo; a extensão ficou restrita à Store API padrão do Medusa
- O boundary público final ficou no serializer, que remove campos internos independentemente do shape bruto retornado pela query
- O contrato reaproveita o gate central `isSellableVariant` e o storage público já validado, sem duplicar regra de vendabilidade nem regra de mídia

## Deviations from Plan

- Nenhum desvio funcional. Para o build no sandbox, foi necessário rodar `ADMIN_DISABLED=true` para pular o bundler do Admin, que tentava abrir porta local e falhava com `listen EPERM 0.0.0.0`; isso não alterou código nem contrato público da Store API.

## Issues Encountered

- A spec inicialmente falhou por resolver a rota core do Medusa via subpath não exportado no Jest; a prova foi ajustada para importar o build hoisted em `node_modules` da raiz do workspace
- O `medusa build` completo falhou no bundler do Admin dentro do sandbox; a verificação efetiva do backend passou com `ADMIN_DISABLED=true`

## User Setup Required

None

## Verification

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts
# PASS — 4 tests

cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
# PASS — backend build completed successfully
```

## Self-Check: PASSED

- [x] `/store/products` expõe apenas o shape shopper-facing esperado
- [x] `/store/products/:id` reutiliza o mesmo boundary público
- [x] Nenhum `gelato_*` vaza na API pública
- [x] Variantes não vendáveis deixam de aparecer publicamente
- [x] Não foram criadas rotas custom de catálogo
- [x] Não houve migrations
- [x] Não houve deploy
- [x] Não houve secrets no Git
- [x] Não houve avanço para fechamento da Phase 02

## Next Phase Readiness

- O contrato público de catálogo está pronto para consumo da storefront futura
- A Phase 02 não deve ser fechada automaticamente a partir daqui; o próximo passo continua dependendo de gate manual humano
- O diff desta execução permanece estritamente no slice `02-04`

---
*Phase: 02-catalog-media*
*Completed: 2026-06-27*
