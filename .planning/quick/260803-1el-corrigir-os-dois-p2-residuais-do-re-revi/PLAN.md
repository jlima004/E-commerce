---
name: corrigir-os-dois-p2-residuais-do-re-review-codex
created: 2026-08-03
status: complete
---

# Corrigir os dois P2 residuais do re-review Codex na PR #20

## Objetivo

Corrigir somente os dois bypasses reais encontrados pelo re-review no commit
`2bbb0f4`: padrões regex que ainda identificam nomes sensíveis e nomes de
componentes `schemas` que não chegam ao contexto semântico do walker.

## Escopo autorizado

- `apps/backend/src/api-docs/safe-examples.ts`;
- `apps/backend/src/api-docs/registry.ts` somente para semear o nome de um
  componente `schemas` na fronteira do registry;
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`;
- este quick e `.planning/STATE.md`;
- commit, push, PR/review follow-through somente após todos os gates e CI verde.

Fora de escopo: contratos de negócio, artefatos OpenAPI, dependências,
lockfile, manifests, migrations, secrets, providers, produção, deploy e merge.

## Plano

1. Reproduzir os dois bypasses residuais nas duas fronteiras e confirmar o
   desenho mínimo com subagents de root-cause/security/tests.
2. Tratar tokens semânticos reconhecíveis em patterns regex sem transformar
   metacaracteres isolados como `^.*$` em nomes; sem nova lista sensível.
3. Preservar nomes de componentes `schemas` no registry e no documento final,
   sem alterar o tratamento de `$defs`/`dependentSchemas`.
4. Adicionar regressões RED/GREEN pareadas, executar a matriz e todos os gates.
5. Auditar independentemente, publicar, aguardar CI, responder/resolver apenas
   estas duas threads residuais e atualizar os artefatos de closeout.

Durante a auditoria final surgiu um bypass real no mesmo escopo: separadores
escapados/opcionais e curingas entre tokens (api_key e provider_order_id). O
item foi corrigido com regressões adicionais, sem alterar a política sensível.

## Evidência esperada

- `^(provider_order_id)$` e `^provider[_-]order[_-]id$` rejeitados nas duas
  fronteiras;
- `^.*api[._-]?key.*$`, `^provider[\\._-]order[\\._-]id$` e
  `^.*provider[_-]order[_-]id.*$` rejeitados nas duas fronteiras;
- `components.schemas.TrackingToken` rejeitado nas duas fronteiras;
- `^.*$`, `^status$` e `^publicField$` continuam permitidos;
- nenhuma nova lista sensível, supressão ou cast inseguro;
- artefatos Store/Admin/Webhooks sem diff.
