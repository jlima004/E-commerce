---
phase: 16-cart-merge-review
plan: 05
subsystem: cart-merge
tags: [cart-merge, medusa, postgres, idempotency, capability, replay, rollback]

requires:
  - phase: 16-cart-merge-review
    provides: "DDL cart_merge aprovado e identidade SHA-256 exact-set congelada no Plan 16-04."
provides:
  - "Prova PostgreSQL disposable das tabelas, constraints e collision audit fail-closed."
  - "Idempotency/capability transaction-aware com replay terminal compatível pós-consumo."
  - "CartMergeResult receipt, replay imutável, NO_ITEMS e rollback por failpoints."
affects: [phase-16-cart-merge-review, plan-16-06]

actuals:
  tokens: 26721
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Claim, receipt, cart writes, capability lifecycle e terminalização compartilham o mesmo transaction manager."
    - "Replay COMMITTED usa somente o receipt original e não reconstrói resposta pelo cart atual."
    - "Provas de schema, constraints e rollback usam somente PostgreSQL local disposable com cleanup obrigatório."

key-files:
  created:
    - "apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.unit.spec.ts"
    - ".planning/phases/16-cart-merge-review/16-05-SUMMARY.md"
  modified:
    - "apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts"
    - "apps/backend/integration-tests/helpers/cart-merge-postgres.ts"
    - "apps/backend/src/modules/store-idempotency/service.ts"
    - "apps/backend/src/modules/guest-cart-capability/service.ts"
    - "apps/backend/src/modules/guest-cart-capability/types.ts"
    - "apps/backend/src/modules/cart-merge/service.ts"

key-decisions:
  - "A suíte unitária omitida do files_modified foi criada somente após B16-05-HR-01 autorizar explicitamente sua expansão de allowlist."
  - "A identidade de schema aprovada no Plan 16-04 permaneceu byte-identical; models, snapshot e migration não foram alterados."
  - "Capability consumida só é reconhecida para replay compatível com Customer, chave, fingerprint, scope e result bindings; não autoriza nova mutation."
  - "NO_ITEMS cria apenas o receipt idempotente permitido, preserva capability ACTIVE e não altera carts, versões, review ou Order."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; Phase 16 permanece IN PROGRESS."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-05 Summary

**Receipt transacional de cart merge com replay imutável, capability pós-consumo controlada e rollback PostgreSQL disposable comprovado.**

## Status

- **Phase 16:** **IN PROGRESS**
- **Plan 16-05:** **TECHNICAL PASS — HUMAN CLOSEOUT PENDING**
- **Task 16-05-01:** **PASS — accepted in the separate human gate before continuation**
- **Task 16-05-02:** **PASS**
- **Task 16-05-03:** **PASS**
- **B16-05-HR-01:** inconsistência documental registrada; remediação autorizada e concluída, sem blocker técnico pendente.
- **Schema identity:** **FROZEN / PASS antes e depois**
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **16-06:** **NOT STARTED / NOT AUTHORIZED**
- **Push:** **NOT PERFORMED**

## Performance

- **Duração observável:** aproximadamente 1h56 entre o primeiro commit técnico e a conclusão da validação independente; o preflight anterior não foi cronometrado.
- **Primeiro commit técnico:** `2026-08-24T14:41:15-03:00`
- **Último commit técnico:** `2026-08-24T16:28:23-03:00`
- **Tasks:** 3/3 PASS
- **Arquivos técnicos modificados/criados:** 7

## Accomplishments

- Migration fresh, tabelas, columns, CHECKs, uniques globais/parciais, indexes e collision audit ambíguo foram provados em PostgreSQL real disposable; a ambiguidade retorna `selectedCartId: null` sem heurística temporal.
- Claim/load/complete/fail de StoreIdempotency e lifecycle de capability respeitam `sharedContext`, fingerprint canônica, bindings terminais, conflito de reuse e replay compatível pós-consumo.
- `CartMergeResult` preserva receipt original, replay não refaz writes, `NO_ITEMS` mantém estado estrutural, e failpoints deixam baseline transacional íntegro com Order delta zero.

## Task Commits

1. **Task 16-05-01 RED:** `812ab8089ad17e7936d52a6390a62f6dd57fa15a` — `test(16-05): add PostgreSQL schema collision proofs`
2. **Task 16-05-01 GREEN:** `068a5f590cc32aff488f04b86ff359ca050da918` — `test(16-05): prove frozen cart merge schema`
3. **Task 16-05-02 RED:** `3fe25b4` — `test(16-05-02): add failing claim and replay coverage`
4. **Task 16-05-02 GREEN:** `2fef94c12c6bc07e8ac00d97ac500833688e9df4` — `feat(16-05-02): close idempotency replay lifecycle`
5. **Task 16-05-03:** `db4437c15bfb350511791cd539acb5fe138dd877` — `feat(16-05-03): persist cart merge receipts atomically`

O commit documental deste SUMMARY é separado e local.

## Files Created/Modified

- `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts` — constraints, receipt, replay, NO_ITEMS e failpoint ledger PostgreSQL.
- `apps/backend/integration-tests/helpers/cart-merge-postgres.ts` — fixtures e assertions persistidos do audit/rollback.
- `apps/backend/src/modules/store-idempotency/service.ts` — claim, replay, result binding, sharedContext e terminalização.
- `apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.unit.spec.ts` — cobertura unitária real do service, criada pela expansão autorizada B16-05-HR-01.
- `apps/backend/src/modules/guest-cart-capability/service.ts` — lookup terminal hash-only e lifecycle transaction-aware.
- `apps/backend/src/modules/guest-cart-capability/types.ts` — contratos de replay/transaction context.
- `apps/backend/src/modules/cart-merge/service.ts` — receipt, replay imutável, NO_ITEMS e failpoints.

Nenhum model, migration ou snapshot foi modificado.

## Schema Identity SHA-256

O exact-set foi recalculado antes e depois das tasks, com paths ordenados e diff vazio:

```text
SCHEMA_IDENTITY_SHA256_BEGIN
d4e625bf2f467d7f9f8358d637e4803f4672fb6d8bf47dc97ceb5746df7f3849  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
3a1f141e4f6269a7f7a579371c8ceeb9916da88e7681673ac4408d6cec2b6522  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END
```

## Evidence and Gates

### Task 16-05-01

- PostgreSQL disposable: **6/6 PASS**, exit code 0.
- `[P12_DISPOSABLE_POSTGRES_CLEAN]`: **PASS**.
- Migration: aplicada somente no database disposable local/loopback.
- Collision audit: **FAIL-CLOSED PASS**; múltiplos candidatos não selecionam cart.
- Constraints reais e indexes: **PASS**.
- Order delta: **0**.

### Task 16-05-02

- Unit gate: **3 suites / 39 tests PASS**.
- First claim, replay, conflict, in-progress, sharedContext, bindings, metadata allowlisted e expiry: **PASS**.
- Capability consumed: replay compatível somente; different key/new mutation negada.
- Build: **PASS**, 0 erros; 458 warnings existentes.
- `git diff --check`: **PASS**.
- `state validate`: **PASS**, `valid: true`, drift vazio.
- Leakage scan: **PASS**.

### Task 16-05-03

- PostgreSQL disposable: **13 testes PASS**, exit code 0.
- `[P12_DISPOSABLE_POSTGRES_CLEAN]`: **PASS**.
- Receipt e committed replay original após alteração do cart: **PASS**, sem write/version bump.
- `NO_ITEMS`: **PASS**, receipt permitido, capability ACTIVE, zero alteração estrutural e Order delta 0.
- Failpoints: **PASS** para cart, invalidation, version, association, result, capability consume e idempotency completion; review/supersede não aplicáveis ao tracer atual.
- Shared transaction manager e rollback baseline: **PASS**.

### Final validation independente

Os oito gates finais foram executados por subagent independente, somente leitura, e passaram:

1. SHA frozen antes/depois.
2. Unit suites relevantes.
3. PostgreSQL integration disposable e cleanup.
4. Build.
5. `git diff --check` contra o predecessor e working tree.
6. `state validate`.
7. Leakage/source scan.
8. Allowlist, branch e worktree.

Resultados consolidados:

- **Order invariant:** delta persistido `0` nas provas PostgreSQL; nenhum caminho pre-Order criou Order.
- **Leakage:** nenhum raw capability, raw Idempotency-Key, JWT, Authorization, cookie, provider payload, nova PII ou secret persistido/logado nas superfícies auditadas.
- **Allowlist:** diff técnico entre `1cf8f490c2acf6dc24e640c4650acbac0322510e` e `db4437c` contém somente os sete paths autorizados pela allowlist expandida.
- **Worktree:** limpo.
- **Remote action:** nenhuma migration remota, provider, Redis remoto, deploy ou push.

## Human Review Remediation

`B16-05-HR-01` registrou que o plano exigia uma suíte unitária inexistente sem incluí-la em `files_modified`. A criação de `apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.unit.spec.ts` foi autorizada explicitamente e limitada a esse propósito. A remediação passou sem mudança de contrato ou schema.

## Deviations from Plan

Uma expansão documental de allowlist foi autorizada pelo gate humano B16-05-HR-01 para materializar o teste unitário já exigido pelo plano. Não houve outra divergência ou escopo técnico adicional.

## Issues Encountered

O único blocker foi a inconsistência de allowlist documentada em B16-05-HR-01. Após a autorização humana, o teste foi criado, a Task 16-05-02 passou e as Tasks 16-05-03/final validation foram concluídas sem blocker.

## User Setup Required

None - no external service configuration required.

## Limits of Closeout

Este SUMMARY registra **technical PASS**, não `HUMAN APPROVED`. MRG-01..MRG-08 permanecem abertos; counters, milestone, STATE e ROADMAP não foram atualizados; o Plan 16-06 não foi iniciado nem autorizado.

## Next Phase Readiness

Plan 16-05 está pronto para **HUMAN CLOSEOUT REVIEW**. Nenhuma ação posterior é automática ou autorizada por este SUMMARY; 16-06 permanece NOT AUTHORIZED.

---
*Phase: 16-cart-merge-review*
*Plan: 16-05*
*Technical execution: PASS; human closeout pending*
