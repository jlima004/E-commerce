---
phase: 16-cart-merge-review
plan: 04
subsystem: cart-merge
tags: [cart-merge, medusa, postgres, migrations, schema-identity, human-ddl-review]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-03 remediado tecnicamente, com migration/snapshot alinhados e identidade SHA-256 revisada."
provides:
  - "Decisão humana approve-ddl registrada para o DDL do cart_merge."
  - "Exact-set SHA-256 aprovado e congelado para models, migration e snapshot."
  - "Closeout documental concluído sem aplicação de migration ou alteração de schema."
affects: [phase-16-cart-merge-review, plan-16-05]

actuals:
  tokens: 1800
  tasks: 1
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Checkpoint humano de DDL com identidade exact-set congelada antes de qualquer aplicação PostgreSQL."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-04-SUMMARY.md"
  modified: []

key-decisions:
  - "HUMAN DDL REVIEW escolheu approve-ddl para a identidade remediada do Plan 16-03."
  - "A migration permanece sem backfill arbitrário e sem seleção por updated_at ou heurística temporal."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; nenhum counter, milestone, ROADMAP ou STATE foi atualizado."
  - "Plan 16-05 permanece NOT AUTHORIZED até o closeout humano deste SUMMARY."

requirements-completed: []
status: complete
---

# Phase 16: Cart Merge & Review — Plan 16-04 Summary

**DDL do cart merge aprovado por revisão humana e identidade exata congelada, sem aplicação de migration.**

## Status

- **Phase:** 16 — Cart Merge & Review — **IN PROGRESS**
- **Plan 16-03:** **HUMAN APPROVED — PASS**
- **Task 16-03-01:** **PASS**
- **Task 16-03-02:** **PASS**
- **B16-03-HR-01:** **CLOSED — PASS**
- **B16-03-HR-02:** **CLOSED — PASS**
- **B16-03-HR-03:** **CLOSED — PASS**
- **B16-04-HR-01:** **CLOSED — PASS**
- **DDL checkpoint decision:** `approve-ddl`
- **Approved schema identity:** **FROZEN**
- **Migration applied:** **NO**
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **16-05:** **NOT AUTHORIZED**
- **Push:** **NOT PERFORMED**

## Human DDL review

A revisão humana confirmou a identidade remediada registrada no `16-03-SUMMARY.md`:

- `UQ_cart_merge_result_idempotency_record` é **NON-PARTIAL UNIQUE**.
- `UQ_cart_review_review_ref` é **NON-PARTIAL UNIQUE**.
- `UQ_cart_review_merge_result` é **NON-PARTIAL UNIQUE**.
- Os três índices globais não contêm `WHERE deleted_at IS NULL` na migration nem no snapshot.
- `UQ_customer_cart_authority_active_customer` preserva `WHERE state = 'active' AND deleted_at IS NULL`.
- `UQ_customer_cart_authority_active_cart` preserva `WHERE state = 'active' AND deleted_at IS NULL`.
- `UQ_cart_review_pending_cart` preserva `WHERE status = 'pending' AND deleted_at IS NULL`.
- Somente as tabelas `customer_cart_authority`, `cart_merge_result` e `cart_review` existem no DDL aprovado.
- Não há foreign keys cross-module nem native enums extras.
- Os estados permanecem `active|superseded` e `pending|acknowledged`; os cinco outcomes aprovados permanecem inalterados.
- `idempotency_record_id`, `review_ref` e `merge_result_id` permanecem identities globais; authority ativa e review pending permanecem condicionais.
- A migration não contém backfill nem escolha arbitrária de Customer cart por `updated_at`, `created_at` ou heurística equivalente.
- A prova de collision/materialização permanece posterior, em PostgreSQL descartável e fail-closed.

## Approved schema identity — FROZEN

O bloco abaixo foi copiado sem recálculo divergente do `16-03-SUMMARY.md` e corresponde ao exact-set aprovado:

SCHEMA_IDENTITY_SHA256_BEGIN
d4e625bf2f467d7f9f8358d637e4803f4672fb6d8bf47dc97ceb5746df7f3849  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
3a1f141e4f6269a7f7a579371c8ceeb9916da88e7681673ac4408d6cec2b6522  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END

Qualquer alteração futura em model, migration ou snapshot invalida esta aprovação e exige retorno ao Plan 16-03 e novo checkpoint DDL do Plan 16-04.

## Non-actions

- Nenhuma migration foi aplicada.
- Nenhum `db:generate` ou `db:migrate` foi executado neste closeout.
- Nenhum PostgreSQL descartável, banco remoto, Docker, Redis, provider, deploy, release ou push foi utilizado.
- Nenhum model, migration, snapshot, `DB_MODEL`, STATE, ROADMAP, REQUIREMENTS ou runtime path foi alterado neste closeout.
- O Plan 16-05 não foi iniciado nem autorizado.

## Commit e limites

Este closeout documental será registrado em commit local separado. Nenhum requirement ou milestone counter é fechado por este SUMMARY; `MRG-01..MRG-08` permanecem **OPEN / UNCHANGED**.

## Next permitted action

- **Next permitted action:** **HUMAN CLOSEOUT REVIEW OF PLAN 16-04**.
- **16-05:** **NOT AUTHORIZED** até este SUMMARY passar pelo closeout humano.
- **Push:** **NOT PERFORMED**.

---
*Phase: 16-cart-merge-review*
*Plan: 16-04*
*DDL decision: approve-ddl; documentary closeout recorded on 2026-08-24*
