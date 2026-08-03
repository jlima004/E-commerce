---
name: corrigir-os-dois-p2-residuais-do-re-review-codex
created: 2026-08-03
status: in_progress
---

# Corrigir os dois P2 residuais do re-review Codex na PR #20

## Objetivo

Corrigir os dois bypasses reais encontrados pelo re-review no commit `2bbb0f4`
e os bypasses concretos subsequentes encontrados pelo Codex no mesmo walker:
patterns semânticos, componentes `schemas`/`responses` e escapes equivalentes
que ainda poderiam ocultar nomes sensíveis.

## Escopo autorizado

- `apps/backend/src/api-docs/safe-examples.ts`;
- `apps/backend/src/api-docs/registry.ts` somente para semear nomes de
  componentes `schemas`/`responses` na fronteira do registry;
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`;
- este quick e `.planning/STATE.md`;
- commit, push, PR/review follow-through somente após todos os gates e CI verde.

Fora de escopo: contratos de negócio, artefatos OpenAPI, dependências,
lockfile, manifests, migrations, secrets, providers, produção, deploy e merge.

## Plano

1. Reproduzir os bypasses nas duas fronteiras e confirmar o desenho mínimo com
   as auditorias de root-cause/security/tests.
2. Tratar tokens semânticos reconhecíveis em patterns regex sem transformar
   metacaracteres isolados como `^.*$` em nomes; sem nova lista sensível.
3. Preservar nomes de componentes `schemas`/`responses` no registry e no
   documento final, sem alterar `$defs`/`dependentSchemas`.
4. Decodificar escapes literais equivalentes antes da tokenização e preservar
   classes unitárias que continuam representando um único caractere literal.
5. Adicionar regressões RED/GREEN pareadas, executar a matriz e todos os gates.
6. Publicar, aguardar CI, responder/resolver cada thread Codex correspondente,
   solicitar nova revisão e atualizar os artefatos de closeout.

As auditorias Codex encontraram, em sequência, separadores escapados, letras
escapadas e classes unitárias escapadas. Cada caso era um bypass reproduzível
do mesmo contexto de `patternProperties`; todos foram corrigidos sem alterar a
política sensível ou contratos gerados.

## Evidência esperada

- `^(provider_order_id)$` e `^provider[_-]order[_-]id$` rejeitados nas duas
  fronteiras;
- `^.*api[._-]?key.*$`, `^provider[\\._-]order[\\._-]id$` e
  `^.*provider[_-]order[_-]id.*$` rejeitados nas duas fronteiras;
- `^tracking\\x5ftoken$`, `^api\\u005Fkey$`,
  `^tracking_[\\x74]oken$` e `^api_[\\u006b]ey$` rejeitados nas duas
  fronteiras;
- `components.schemas.TrackingToken` e
  `components.responses.TrackingTokenResponse` rejeitados nas duas
  fronteiras;
- `^.*$`, `^status$` e `^publicField$` continuam permitidos;
- nenhuma nova lista sensível, supressão ou cast inseguro;
- artefatos Store/Admin/Webhooks sem diff.
