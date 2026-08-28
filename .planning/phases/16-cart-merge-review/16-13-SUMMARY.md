---
phase: 16-cart-merge-review
plan: 13
subsystem: api
tags: [cart-merge, review, openapi-registry, contract, human-gate, bff]
requires:
  - phase: 16-cart-merge-review
    provides: "Plano 16-12 e rascunho do contrato Store de merge/review"
provides:
  - "Registro da decisão humana revise-contract"
  - "Blockers de contrato para remediação direcionada antes de qualquer writer"
  - "Registro da decisão humana approve-contract"
  - "Fechamento documental do Plan 16-13 sem autorizar o Plan 16-14"
affects: [Phase 16, future storefront contract, API Docs]
actuals:
  tokens: 3000
  tasks: 1
  commits: 2
tech-stack:
  added: []
  patterns:
    - "Checkpoint humano bloqueante antes da materialização de OpenAPI gerado"
key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-13-SUMMARY.md"
  modified: []
key-decisions:
  - "HUMAN DECISION — REVISE-CONTRACT"
  - "A camada de contrato do Plano 16-12 REQUER REMEDIAÇÃO DIRECIONADA"
  - "O OpenAPI writer permanece BLOQUEADO; o Plano 16-14 não está autorizado"
  - "Este resumo não implementa correção em runtime, registry ou artefatos gerados"
  - "HUMAN DECISION — APPROVE-CONTRACT (2026-08-28); a decisão histórica REVISE-CONTRACT permanece preservada"
  - "Plan 16-13: APPROVE-CONTRACT — CLOSED — PASS"
  - "Plan 16-14, OpenAPI writer/generation/check, push e deploy permanecem não autorizados"
  - "MRG-01..MRG-08 permanecem OPEN / GLOBAL RECONCILIATION PENDING"
patterns-established:
  - "Não materializar JSON gerado antes do checkpoint humano do contrato"
requirements-completed: []
coverage:
  - id: D1
    description: "Decisão humana revise-contract registrada com blockers reproduzíveis"
    verification:
      - kind: unit
        ref: "apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts — 1 suíte / 33 passed / 0 failed / 0 skipped / exit 0"
        status: pass
    human_judgment: true
    rationale: "O teste focado valida o rascunho exercitado, mas não encerra os blockers nem substitui a decisão humana."
  - id: D2
    description: "JSON Store/Admin/Webhooks permaneceu byte-identical ao baseline e sem diff no checkout"
    verification:
      - kind: other
        ref: "sha256sum e git diff --quiet nos três artefatos gerados"
        status: pass
    human_judgment: true
    rationale: "A decisão revise-contract mantém o writer bloqueado e não autoriza materialização gerada."
  - id: D3
    description: "Decisão humana explícita approve-contract e fechamento documental do Plan 16-13."
    verification: []
    human_judgment: true
    rationale: "A decisão humana fecha somente o checkpoint do Plan 16-13; não autoriza o Plan 16-14, writer, push, deploy ou reconciliação global."
duration: not measured (human-gated checkpoint)
completed: 2026-08-28
status: human-approved-pass
---

# Plan 16-13 — Contract checkpoint

## Status histórico do checkpoint

```text
Plan 16-13: HUMAN DECISION — REVISE-CONTRACT
Plan 16-12 contract layer: REQUIRES TARGETED REMEDIATION
OpenAPI writer: BLOCKED
Plan 16-14: BLOCKED / NOT AUTHORIZED
Phase 16: IN PROGRESS
MRG-01..MRG-08: OPEN / GLOBAL RECONCILIATION PENDING
```

A decisão humana foi recebida explicitamente como `revise-contract`. O contrato
Store de merge/review não está aprovado para materialização. Esta Etapa B é
documental e termina aqui; não há autorização para implementação, geração de
OpenAPI, execução do Plano 16-14 ou encerramento da Phase 16.

## Blockers que exigem remediação direcionada

### B16-13-A-001 — replay do merge não usa o serializer fechado

O endpoint canônico de merge chama `serializeStoreCartPreOrder(result.cart)` e
monta manualmente os campos de review em
[route.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/customers/me/cart/merge/route.ts:49).
O helper fechado `serializeCartMergeResponse` está em
[serializers.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/serializers.ts:453)
e é usado pelo endpoint de ACK em
[acknowledge/route.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/[id]/review/acknowledge/route.ts:119).

No replay, o serviço pode retornar o snapshot público persistido em
[service.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/cart-merge/service.ts:836),
mas a rota o trata como registro bruto e o serializa novamente. Isso pode
alterar `checkout_data_complete` e perder `masked_federal_tax_id`, além de
deixar o allowlist de itens rejeitados dependente da forma incorreta de
serialização. O contrato de replay precisa permanecer idêntico ao recibo
público persistido, conforme R16-HR-04/D16-33.

### B16-13-A-002 — `requiresReview` não está fechado no registry OpenAPI

O validator impõe a relação entre `requiresReview` e `MERGED_PARTIAL` em
[merge-review-validators.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/merge-review-validators.ts:140),
mas o registry descreve a regra apenas em texto e referencia o tipo genérico
em [schemas.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api-docs/operations/store/schemas.ts:889).
O teste focado verifica a presença da descrição em
[store-contract.unit.spec.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts:1487),
não uma união discriminada que impeça `outcome: "MERGED"` com
`requiresReview: true`. O contrato publicado precisa representar a mesma
regra fechada do validator antes que qualquer writer seja liberado.

### B16-13-A-003 — estado pendente com `reviewRef: null` não falha fechado

O `CartReviewStateSchema` rejeita uma referência não nula quando
`requiresReview` é falso, mas aceita `requiresReview: true` com
`reviewRef: null` em
[merge-review-validators.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store/carts/merge-review-validators.ts:60).
O schema correspondente no registry apresenta a mesma lacuna em
[schemas.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api-docs/operations/store/schemas.ts:889).
Isso viola o requisito R16-HR-05 de estado pendente com referência obrigatória
e precisa ser corrigido de modo consistente entre validator, registry e
evidência.

### B16-13-B-001 — capability desconhecida/estrangeira pode virar 500

O lookup real lança um `Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")` em
[service.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/guest-cart-capability/service.ts:490)
e o merge o propaga em
[service.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/cart-merge/service.ts:1375).
O normalizador de superfície não o converte para a resposta não enumerável
esperada e deixa o fallback de 500 em
[errors.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api/store-surface/errors.ts:617).
Isso diverge do contrato 404 registrado em
[carts.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/api-docs/operations/store/carts.ts:80).
O teste HTTP existente mascara o caminho ao mockar `MedusaError(NOT_FOUND)` em
[cart-merge-review.spec.ts](/home/jlima/Projetos/ecommerce/Backend/integration-tests/http/cart-merge-review.spec.ts:1591).

## Reconciliação da revisão serial

Quatro revisores foram executados serialmente e em modo somente leitura:

- Reviewer A encontrou A-001 e A-002.
- Reviewer B encontrou B-001.
- Reviewer C confirmou a superfície/leakage e os gates de exemplos, mas
  executou inadvertidamente `openapi:check`.
- Reviewer D reportou PASS independente; a reconciliação do agente principal
  rejeitou esse PASS porque os quatro blockers materiais acima são verificáveis
  no código e no contrato atual.

O incidente de governança do Reviewer C foi somente leitura: o
`openapi:check` detectou o drift esperado entre os artefatos JSON antigos e o
registry atual, não alterou arquivos e não substitui a decisão humana. O
`openapi:generate`/writer não foi executado.

## Evidência factual do Stage A

- Branch: `gsd/phase-16-cart-merge-review`.
- HEAD e remote HEAD: `589e8c6cb736b870ea7244526ca2a42e8d8102e4`.
- Worktree antes da Etapa B: limpo.
- `git diff --check -- apps/backend/src/api/store/carts apps/backend/src/api-docs`: exit 0.
- Teste autorizado: `npm run test:unit -- --runTestsByPath src/api-docs/__tests__/store-contract.unit.spec.ts`, com 1 suíte, 33 testes aprovados, 0 falhas, 0 skips, exit 0.
- Hash Store: `d984abe7d4ffa3291742a57c780c7e5f0f282ca81fdb9bd4678a7b9a377b3c98`.
- Hash Admin: `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a`.
- Hash Webhooks: `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4`.
- Os três artefatos gerados permaneceram byte-identical ao baseline; não houve
  diff gerado e nenhum arquivo gerado foi alterado.
- Não houve push, deploy, chamada a provider, mudança de banco/Redis,
  alteração de pacote/lockfile/migration, mudança de frontend ou execução do
  Plano 16-14.

## Condições para reabrir o checkpoint

O checkpoint deve ser reaberto somente após remediação direcionada e nova
revisão humana do contrato. A próxima revisão deve demonstrar, no mínimo:

1. replay canônico usando o envelope público fechado, preservando metadados e
   allowlist de rejeitados;
2. `requiresReview` fechado no validator e no registry, incluindo a condição
   discriminada de outcome;
3. `requiresReview: true` sempre acompanhado de `reviewRef` não nulo;
4. capability desconhecida/estrangeira normalizada sem enumeração e sem 500;
5. nova execução Stage A sem writer, seguida de decisão humana explícita.

Até a decisão humana posterior registrada abaixo, o OpenAPI writer, o Plano
16-14 e a reconciliação global de MRG-01 a MRG-08 permaneciam bloqueados.

## Ações não executadas por escopo

- Nenhuma correção em runtime foi aplicada.
- Nenhum registry foi alterado.
- Nenhum JSON OpenAPI foi gerado ou escrito.
- Nenhum gate global foi usado para substituir a aprovação humana.
- Nenhuma atualização de `STATE.md` ou `ROADMAP.md` foi feita.

## HUMAN DECISION — PLAN 16-13 — 2026-08-28

```text
╔══════════════════════════════════════════════════════════════╗
║ HUMAN DECISION: PLAN 16-13                                 ║
╚══════════════════════════════════════════════════════════════╝

Decision:
APPROVE-CONTRACT

Historical decision:
REVISE-CONTRACT — PRESERVED AS HISTORY

P16-16-13-R1:
HUMAN APPROVED — PASS

B16-13-A-001:
CLOSED

B16-13-A-002:
CLOSED

B16-13-A-003:
CLOSED

B16-13-B-001:
CLOSED

Current Plan 16-13 contract:
HUMAN APPROVED

Plan 16-13:
APPROVE-CONTRACT — CLOSED — PASS

Generated OpenAPI:
UNCHANGED

OpenAPI writer:
NOT EXECUTED

openapi:generate:
NOT EXECUTED

openapi:check:
NOT EXECUTED

Plan 16-14:
NOT STARTED / NOT AUTHORIZED

Push:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Phase 16:
IN PROGRESS

MRG-01..MRG-08:
OPEN / GLOBAL RECONCILIATION PENDING
```

Esta decisão humana explícita atualiza somente o gate do Plan 16-13. A decisão
histórica `HUMAN DECISION — REVISE-CONTRACT` permanece preservada acima, e o
artefato `16-13-R1-SUMMARY.md` permanece inalterado como evidência da
remediação aprovada.

Nenhum gate técnico foi reexecutado nesta Etapa B documental. Não houve
alteração de runtime, validators, serializers, registry, testes, JSON gerado,
`STATE.md` ou `ROADMAP.md`. O Plan 16-14 continua separado e não autorizado;
writer, geração/check OpenAPI, push, deploy e reconciliação global de MRG-01 a
MRG-08 continuam fora do escopo.
