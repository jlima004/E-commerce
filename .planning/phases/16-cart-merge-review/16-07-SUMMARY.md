---
phase: 16-cart-merge-review
plan: 07
subsystem: cart-merge
tags: [cart-merge, review, postgres, concurrency, idempotency]

requires:
  - phase: 16-cart-merge-review
    provides: "Schema cart-merge frozen, customer authority transacional e contratos de Cart Merge dos planos anteriores."
provides:
  - "Decisão e execução transacional dos outcomes MERGED, MERGED_PARTIAL, GUEST_CART_ATTACHED e NO_ITEMS."
  - "Projeção HTTP do review real com Cache-Control no-store, sem refetch/query adicional."
  - "Prova PostgreSQL disposable de failpoints, races, replay, capability, versões, authority e zero Order."
affects: [phase-16-cart-merge-review, plan-16-08]

actuals:
  tasks: 3
  technical_commits: 5
  documentation_commits: 1

key-decisions:
  - "A rota projeta explicitamente somente requiresReview, reviewRef e rejectedItems do CartMergeExecutionResult."
  - "Native Cart workflows recebem o mesmo transaction manager por uma facade não-module-shaped e índices MedusaContext; não há transação detached."
  - "Uma chave diferente após capability consumida e guest cart superseded retorna 409 CART_MERGE_GUEST_CART_UNSUPPORTED sem novo efeito; a chave original continua replay-safe."
  - "O comando PostgreSQL com duas specs no mesmo processo foi tratado como diagnóstico de interferência de realm Map do harness; cada spec foi executada isoladamente no wrapper disposable, com exit e cleanup obrigatórios."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; Phase 16 permanece IN PROGRESS."
---

# Phase 16: Cart Merge & Review — Plan 16-07 Summary

**TECHNICAL PASS — HUMAN CLOSEOUT PENDING.**

## Status

- **B16-07-HR-01:** **CLOSED — PASS**
- **Allowlist expansion:** **PASS** — o único path adicional autorizado foi `apps/backend/src/api/store/customers/me/cart/merge/route.ts`.
- **Plan 16-07:** **TECHNICAL PASS — HUMAN CLOSEOUT PENDING**
- **Phase 16:** **IN PROGRESS**
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **Plan 16-08:** **NOT AUTHORIZED / NOT STARTED**
- **Push, deploy, provider, frontend, Supabase, PostgreSQL remoto e Redis remoto:** **NOT PERFORMED**
- **STATE, ROADMAP e counters:** **NOT UPDATED**

## B16-07-HR-01

O blocker foi encontrado no preflight: a rota necessária para Task 16-07-02 estava fora da allowlist documental. O HUMAN REVIEW autorizou exclusivamente sua inclusão. A rota agora:

- projeta `result.review` com o property set público fechado;
- emite `Cache-Control: no-store`;
- usa `result.cart`, `result.review` e `result.version` do mesmo resultado do service;
- não faz refetch, query de review/versão, acesso direto ao banco ou consulta pós-commit;
- não altera autenticação, BFF, parsing, input, serializer, status normal ou concorrência.

## Task Results

- **Task 16-07-01:** **PASS** — decision/service, invalidation estrutural, Customer destination real e unit coverage.
- **Task 16-07-02:** **PASS** — RED/GREEN da rota real, review parcial explícito, non-partial/replay, ETag e `Cache-Control: no-store`.
- **Task 16-07-03:** **PASS** — races, rollback/failpoints, replay, capability lifecycle, versões/quantidades, authority e zero Order em PostgreSQL real disposable.

## Technical Commits

1. `76960d1c7afbccf81adce71612072a384ef6e8d5` — `test(16-07): add failing persisted-state decision case`
2. `59e01d341609ec09f7c10abaa7da7071723e7ce2` — `feat(16-07): implement transactional cart merge outcomes`
3. `0e5c15906122d9b0913312e45f99646faaf28e5d` — `test(16-07-02): add failing HTTP review projection coverage`
4. `61b587b3ace08125944794032c146e5dfe510c51` — `feat(16-07-02): expose cart merge review snapshot safely`
5. `13249dc38f30fed5f37bfe2d6dbbef785e833de3` — `feat(16-07): prove transactional merge races`

Todos são commits locais; nenhum commit anterior foi amendado.

## Verification Gates

- **Unit:** 2 suites, 16 testes PASS, exit 0 (`decision.unit.spec.ts` e `shipping-invalidation.unit.spec.ts`).
- **HTTP:** 2 suites, 6 testes PASS, exit 0 (`cart-merge-review.spec.ts` e `guest-cart-mutation-snapshot-concurrency.spec.ts`).
- **PostgreSQL Cart Merge isolado:** 1 suite, 18/18 testes PASS, exit 0; failpoints, active-vs-active, active-vs-merge, merge-vs-merge, replay e ambiguity passaram; `[P12_DISPOSABLE_POSTGRES_CLEAN]` confirmado.
- **PostgreSQL Guest Order invariants isolado:** 1 suite, 3/3 testes PASS, exit 0; `[P12_DISPOSABLE_POSTGRES_CLEAN]` confirmado.
- **PostgreSQL combinado:** a tentativa literal com as duas specs no mesmo processo reproduziu a falha conhecida de realm (`Map.prototype.set called on incompatible receiver`) do harness, com cleanup confirmado. As duas specs foram então executadas separadamente, cada uma em processo/harness disposable próprio, e são a evidência autoritativa do gate.
- **Corrida merge-vs-merge:** workers/processos e conexões distintos produziram `GUEST_CART_ATTACHED` e `MERGED`, dois receipts distintos, customer versions/quantidades/linhas exatos, uma authority ativa, capability consumida e Order delta zero. Chave diferente retornou 409 sem alteração; chave original reproduziu o receipt.
- **Rollback:** failpoints pós-cart, invalidation, version, association, result, capability consumption e idempotency completion reverteram o baseline completo.
- **Build:** **PASS** backend e frontend; 0 erros, com warnings globais preexistentes não bloqueantes.
- **`git diff --check`:** **PASS** antes do commit técnico e no fechamento.
- **`state validate`:** `valid: true`, `warnings: []`, `drift: {}`.
- **Leakage:** **PASS** — response público fechado; nenhum capability, raw Idempotency-Key, JWT, Authorization ou metadata interna é projetado; somente hashes/fixtures sintéticos aparecem nas provas autorizadas.
- **Allowlist audit:** **PASS** — o diff desde `d976de89fa57dbff5f471e7ff68efe3745906473` contém somente oito paths efetivamente alterados, todos dentro da allowlist expandida.
- **Order delta:** **0** nos cenários PostgreSQL; não há Order em outcome, conflito, replay ou rollback.
- **Worktree antes deste SUMMARY:** **CLEAN** após o commit técnico.

## Schema Identity SHA-256

O exact-set foi recalculado e permaneceu byte-identical antes e depois:

```text
SCHEMA_IDENTITY_SHA256_BEGIN
d4e625bf2f467d7f9f8358d637e4803f4672fb6d8bf47dc97ceb5746df7f3849  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
3a1f141e4f6269a7f7a579371c8ceeb9916da88e7681673ac4408d6cec2b6522  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END
```

Nenhum model, migration ou snapshot foi alterado.

## Limits of Closeout

Este SUMMARY registra **TECHNICAL PASS**, não `HUMAN APPROVED`. O próximo e único passo permitido é **HUMAN CLOSEOUT REVIEW OF PLAN 16-07**. Plan 16-08 não foi iniciado nem autorizado.

*Phase: 16-cart-merge-review*
*Plan: 16-07*
*Technical execution: PASS; human closeout pending*
