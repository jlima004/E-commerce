---
phase: 16-cart-merge-review
plan: 03
subsystem: cart-merge
tags: [cart-merge, medusa, postgres, migrations, schema-identity]

requires:
  - phase: 16-cart-merge-review
    provides: "Models CustomerCartAuthority, CartMergeResult e CartReview, além do wiring cart_merge aprovado nos Plans 16-01 e 16-02."
provides:
  - "Schema local cart_merge gerado exclusivamente pela CLI Medusa, ainda não aplicado."
  - "Snapshot, migration e identidade SHA-256 exact-set para revisão humana do DDL."
  - "Consolidação do CartMergeModuleService preservada e validada sem duplicação de wiring."
affects: [phase-16-cart-merge-review, plan-16-04]

actuals:
  tokens: 4576
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Geração de schema Medusa com PostgreSQL disposable em loopback e lifecycle explícito CREATE DATABASE → geração única → DROP DATABASE."
    - "Identidade de schema formada por models, snapshot e migrations ordenados deterministicamente com SHA-256."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-03-SUMMARY.md"
    - "apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json"
    - "apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts"
  modified:
    - "apps/backend/src/modules/cart-merge/service.ts"
    - "docs/DB_MODEL_v1.22.md"

key-decisions:
  - "CUSTOMER_CART_PRESERVED permanece enum-only; nenhum branch positivo foi criado."
  - "Nenhuma migration foi aplicada; o DDL permanece sujeito à revisão humana antes do Plan 16-04."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; não houve atualização de counters, milestone, ROADMAP ou STATE."
  - "Containers históricos parados ecommerce-postgres/ecommerce-redis não pertencem ao retry, não estavam ativos e não foram removidos; o cleanup P12 disposable passou."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-03 Summary

**Identidade de schema cart_merge gerada pela CLI Medusa em PostgreSQL disposable, auditada byte a byte e preservada para revisão humana do DDL.**

## Status

- **Phase:** 16 — Cart Merge & Review — **IN PROGRESS**
- **Plan:** 16-03 — **PASS técnico / aguardando HUMAN DDL-CLOSEOUT REVIEW**
- **Task 16-03-01:** **PASS — PRESERVED / NOT REEXECUTED**
- **Task 16-03-02:** **PASS**
- **B16-03-HR-01:** **CLOSED — PASS** — preflight, allowlist e lifecycle autorizado.
- **B16-03-HR-02:** **CLOSED — PASS** — geração única e cleanup disposable.
- **B16-03-HR-03:** **CLOSED — PASS** — schema audit e gates finais; alerta extra de containers históricos foi revisado como não normativo.
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **16-04:** **NOT STARTED / NOT AUTHORIZED**
- **Push:** **NOT PERFORMED**

## Execução do retry humano

O retry final usou PostgreSQL disposable exclusivamente em loopback, por meio de `apps/backend/scripts/run-disposable-postgres-tests.mjs` e wrapper transitório em `/tmp`:

- `P12_DISPOSABLE_POSTGRES_READY`: **PASS**
- Host: **LOOPBACK CONFIRMED**
- `DB_TEMP_NAME`: validado contra `^p12_disposable_[a-z0-9_]+$`
- Database descartável: criação controlada **PASS**
- `npx medusa db:generate cart_merge`: executado **uma única vez**
- Exit code real: **0**
- Migration/snapshot gerados: **YES**
- Database descartável: DROP controlado **PASS**
- `P12_DISPOSABLE_POSTGRES_CLEAN`: **PASS**
- Migration aplicada: **NO**

O histórico dos blockers foi preservado de forma factual: a tentativa inicial encontrou `ECONNREFUSED 127.0.0.1:5432`; o primeiro retry foi interrompido antes do exit code; o segundo retry encontrou database temporária inexistente. O retry final corrigiu somente o lifecycle autorizado, criando explicitamente `DB_TEMP_NAME` antes da CLI e removendo-a em `finally`.

## Schema exact-set auditado

O exact-set contém somente:

- `CustomerCartAuthority` → `customer_cart_authority`
- `CartMergeResult` → `cart_merge_result`
- `CartReview` → `cart_review`

O snapshot e a migration não contêm entidade inesperada, foreign key ou native enum adicional. Foram confirmados os estados/outcomes/status aprovados, uniques parciais respeitando `deleted_at`, `review_ref`/`merge_result_id`, `pending` por cart, snapshots originais, ETag, versões, `expires_at` e os campos nullable/safe. `CUSTOMER_CART_PRESERVED` continua reservado e unreachable no service.

## Schema identity SHA-256

Paths ordenados deterministicamente; hashes calculados após a geração e antes do commit técnico:

SCHEMA_IDENTITY_SHA256_BEGIN
ecd52d6899197a44c9d85989684f254029b1ea4913e458e480d0beeda9deebf8  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
742d77c09486438b9412ff31677e18813ae1105767eb72ecc0b72cccb829f421  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END

## Validações finais

| Gate | Resultado |
|---|---|
| Config unit `medusa-config.unit.spec.ts` | **8/8 PASS** |
| `npm run build` | **PASS** — 0 erros; 457 warnings informativos |
| Unicidade `CART_MERGE_MODULE = "cart_merge"` | **PASS** |
| Unicidade `key: "cart_merge"` | **PASS** |
| Migration em `src/modules/cart-merge/migrations/` | **PASS** |
| `git diff --check` | **PASS** |
| `state validate` | **PASS** — `valid: true`, `drift: {}` |
| Allowlist | **PASS** — somente service, docs e migrations; nada staged fora do escopo |

O validador final também observou dois containers Docker históricos parados (`ecommerce-postgres` e `ecommerce-redis`), ambos sem relação com o prefixo disposable, sem atividade e sem residue do retry. Nenhum container foi removido.

## Commits técnicos

1. **Task 16-03-01 preservado + Task 16-03-02** — `032f250` — `feat(16-03): generate cart merge schema identity`.

O commit técnico contém somente:

- `apps/backend/src/modules/cart-merge/service.ts`
- `apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json`
- `apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts`
- `docs/DB_MODEL_v1.22.md`

O commit documental deste SUMMARY é separado e local. Nenhum push foi feito.

## Limites do fechamento

Este SUMMARY registra o PASS técnico do Plan 16-03 e encerra somente o retry autorizado. Não aplica migration, não fecha MRG-01..MRG-08, não fecha a Phase 16, não atualiza counters/milestone/STATE, não inicia o Plan 16-04 e não autoriza provider, deploy, release ou infraestrutura remota.

## Next permitted action

- **Next permitted action:** **HUMAN DDL/CLOSEOUT REVIEW OF PLAN 16-03**.
- **16-04:** **NOT STARTED / NOT AUTHORIZED**.
- **Push:** **NOT PERFORMED**.

---
*Phase: 16-cart-merge-review*
*Plan: 16-03*
*Technical execution: PASS; documentary closeout recorded on 2026-08-24*
