---
phase: 16-cart-merge-review
plan: 08
subsystem: cart-merge
tags: [cart-merge, review, acknowledge, etag, concurrency]

requires:
  - phase: 16-cart-merge-review
    provides: "Schema CartReview/StoreResourceVersion congelado, autoridade Customer e merge MERGED_PARTIAL dos planos anteriores."
provides:
  - "Contrato strict e handler POST /store/carts/{id}/review/acknowledge."
  - "Acknowledge versionado e idempotente por estado, sem bump estrutural."
  - "Matriz unitária/HTTP de applied, replay, no-op, stale, conflito e fail-closed."
affects: [phase-16-cart-merge-review, plan-16-11]

actuals:
  tokens: 11019
  tasks: 1
  technical_commits: 2
  documentation_commits: 1

tech-stack:
  added: []
  patterns:
    - "Zod strict para params/body e If-Match como autoridade obrigatória de versão."
    - "ACK transacional sob Customer/cart/StoreResourceVersion/CartReview locks no mesmo manager."
    - "Estado público fechado e sem superfície runtime antecipada."

key-files:
  created:
    - "apps/backend/src/api/store/carts/merge-review-validators.ts"
    - "apps/backend/src/api/store/carts/[id]/review/acknowledge/route.ts"
    - "apps/backend/src/modules/cart-merge/__tests__/review-guard.unit.spec.ts"
  modified:
    - "apps/backend/src/modules/cart-merge/service.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"

key-decisions:
  - "B16-08-HR-01 foi rejeitado como falso blocker: registry, middleware e manifest pertencem ao Plan 16-11 e não foram antecipados."
  - "O handler falha fechado com 404 sem customerAuthBff.authorized=true; a validação de surface fica deferida por desenho."
  - "Linha StoreResourceVersion ausente e CartReview malformado falham 409 sem initialize, write ou bump."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; Phase 16 permanece IN PROGRESS."

patterns-established:
  - "Applied e replay compatível retornam cart/review público fechado, ETag preservado e Cache-Control no-store."
  - "Mutation posterior invalida ACK antigo pela versão produzida, sem reativar review automaticamente."

coverage:
  - id: D1
    description: "ACK strict com applied, replay, no-op, pending-null, stale e ref conflict."
    requirement: MRG-06
    verification:
      - kind: unit
        ref: "apps/backend/src/modules/cart-merge/__tests__/review-guard.unit.spec.ts — 5 testes"
        status: pass
      - kind: integration
        ref: "apps/backend/integration-tests/http/cart-merge-review.spec.ts — 24 testes"
        status: pass
    human_judgment: false
  - id: D2
    description: "ACK versionado preserva a barreira de review e permite no-op idempotente."
    requirement: MRG-07
    verification:
      - kind: integration
        ref: "HTTP matrix: locks, zero bump/write, replay, mutation posterior, ownership, capability e leakage"
        status: pass
      - kind: other
        ref: "Validação independente read-only Faraday — INDEPENDENT PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "Closeout humano do Plan 16-08 e confirmação do sequenciamento de surface para 16-11."
    verification: []
    human_judgment: true
    rationale: "Os gates técnicos não substituem a revisão humana; surface activation está deliberadamente fora desta wave."
---

# Phase 16: Cart Merge & Review — Plan 16-08 Summary

**TECHNICAL PASS — HUMAN CLOSEOUT PENDING.**

## Status

- **B16-08-HR-01:** **REJECTED — FALSE POSITIVE / PLANNED SEQUENCING**.
- **Plan 16-08:** **TECHNICAL PASS — HUMAN CLOSEOUT PENDING**.
- **Phase 16:** **IN PROGRESS**.
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**.
- **Plan 16-09+:** **NOT AUTHORIZED / NOT STARTED**.
- **Surface BFF/M1:** **DEFERRED BY DESIGN TO PLAN 16-11**.
- **STATE, ROADMAP e counters:** **NOT UPDATED**.
- **Push, deploy, provider, PostgreSQL/Redis remoto:** **NOT PERFORMED**.

## B16-08-HR-01

O claim de que o ACK precisava estar registrado em `STORE_CART_BFF_PROTECTED_OPERATIONS` foi rejeitado. O Plan 16-08 entrega o contrato e o motor do ACK sob autoridade já resolvida; registry, middleware, manifest e testes de surface pertencem ao Plan 16-11.

O handler exige `customerAuthBff.authorized === true` e retorna 404 antes de executar o service quando essa autoridade não está presente. Nenhum path de surface foi alterado.

## Entrega técnica

- Validator Zod strict para params `{ id: string }` e body exatamente `{ reviewRef: string | null }`.
- `If-Match` obrigatório em applied, replay e no-op.
- Capability guest e `Idempotency-Key` rejeitados sem resolver, consumir ou claim.
- Customer canonical authority, ownership, versão e review revalidados no mesmo transaction manager.
- Ordem de locks: Customer → cart → `StoreResourceVersion FOR UPDATE` → `CartReview FOR UPDATE`.
- Pending matching é reconhecido sem bump estrutural; replay compatível não escreve nem altera timestamp.
- Mutation posterior invalida a revisão antiga; `null` só é aceito sem pending; pending + `null` retorna 409.
- Estado malformado, múltiplos pending, identidade/ref incoerentes ou versão ausente falham fechado sem escrita.
- Resposta pública fechada: `requiresReview`, `reviewRef`, `rejectedItems`; `ETag` preservado e `Cache-Control: no-store`.
- Nenhum Order é criado ou tocado pelo ACK.

## Subagentes e commits

- **Hooke — preflight:** identificou o conflito histórico/surface; nenhuma edição fora do escopo foi feita.
- **Plato — RED matrix:** **PASS**, testes strict e HTTP; commit `0f8b37f` (`test(16-08): define strict cart review acknowledge contract`).
- **Euclid — implementação:** **PASS**, route, validator e service; o ajuste de harness foi resolvido na matriz HTTP.
- **Kepler — HTTP matrix:** **PASS**, 24/24 testes e mutation-posterior coverage.
- **Faraday — validação independente corrigida:** **INDEPENDENT PASS**, read-only; surface registration corretamente deferida ao 16-11.
- Commit técnico GREEN: `1224336` (`feat(16-08): implement versioned cart review acknowledge`).

## Verification Gates

- **Unit:** **PASS** — 1 suite, 5/5 testes, exit 0.
- **HTTP:** **PASS** — 1 suite, 24/24 testes, exit 0.
- **Build:** **PASS** — backend e frontend, exit 0; 0 erros e 475 warnings globais preexistentes de lint.
- **`git diff --check`:** **PASS**.
- **Allowlist técnica desde `006a2cf6`:** **PASS** — exatamente os cinco paths autorizados; este SUMMARY é o único path documental adicional.
- **Leakage scan:** **PASS** — linhas adicionadas e arquivos novos sem Authorization/Bearer, JWT, capability plaintext, token hash ou segredo.
- **`state validate`:** **PASS** — `valid: true`, `warnings: []`, `drift: {}`.
- **Frozen schema:** **PASS / UNCHANGED** — hashes recalculados e preservados.

## Schema Identity SHA-256

```text
SCHEMA_IDENTITY_SHA256_BEGIN
d4e625bf2f467d7f9f8358d637e4803f4672fb6d8bf47dc97ceb5746df7f3849  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
3a1f141e4f6269a7f7a579371c8ceeb9916da88e7681673ac4408d6cec2b6522  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END
```

## Limits of Closeout

Este SUMMARY registra **TECHNICAL PASS**, não aprovação humana nem fechamento de requisitos. O próximo passo permitido é **HUMAN CLOSEOUT REVIEW OF PLAN 16-08**. Não iniciar Plan 16-09, 16-10, 16-11 ou qualquer outro plano.

*Phase: 16-cart-merge-review*
*Plan: 16-08*
*Technical execution: PASS; human closeout pending*
