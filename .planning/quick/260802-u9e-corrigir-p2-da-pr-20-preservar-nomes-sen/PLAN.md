---
name: corrigir-p2-da-pr-20-preservar-nomes-sensiveis
created: 2026-08-02
status: complete
---

# Corrigir P2 da PR #20: nomes sensíveis em examples

## Objetivo

Corrigir os dois gates de segurança de API Docs para preservar nomes
semânticos de Parameter Objects, Header Objects, headers nomeados e componentes
OpenAPI reconhecíveis ao validar `example`/`examples`, mantendo a política
existente `isSensitiveExampleKey(...)` e sem alterar artefatos gerados.

## Escopo autorizado

- `apps/backend/src/api-docs/registry.ts`;
- `apps/backend/src/api-docs/generation/validate.ts`;
- `apps/backend/src/api-docs/safe-examples.ts`;
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`;
- artefatos quick/GSD necessários (`PLAN.md`, `SUMMARY.md`, `.planning/STATE.md`);
- commit, push, resposta/resolução do thread após CI verde e solicitação de novo review.

Fora de escopo: merge, deploy, migrations, providers/produção, secrets,
manifests/lockfile, geração dos artefatos OpenAPI, novas listas sensíveis,
supressões ou casts inseguros.

## Plano de execução

1. Coordenar subagents obrigatórios: root-cause, security-design, test e final-auditor.
2. Reproduzir o bypass nas fronteiras `ContractRegistryBundle` e
   `validateDocument(...)` e auditar `parameters`, `headers`,
   `components.parameters`, `components.headers`, schemas de request/response e
   maps de examples.
3. Implementar propagação estrutural mínima de contexto nomeado nos dois gates,
   sem interpretar `name` arbitrário como identificador sensível.
4. Adicionar matriz RED/GREEN pareada para nomes sensíveis snake_case/camelCase,
   arrays/maps de examples, operações aninhadas, componentes e controles seguros,
   preservando as regressões de propriedades existentes.
5. Executar os gates focados, `openapi:check`, lint, verify, build e diff dos
   artefatos; confirmar ausência de supressões/casts inseguros.
6. Criar commit objetivo, fazer push, aguardar workflow API Docs verde, responder
   e resolver o thread aberto, atualizar o corpo da PR com o total comprovado e
   solicitar novo review do Codex/Copilot. Não fazer merge.

## Evidência esperada

- bypass reproduzido antes da correção e RED/GREEN comprovado;
- decisões idênticas nas duas fronteiras;
- nomes sensíveis de parâmetros/headers/componentes rejeitados;
- parâmetros/headers não sensíveis permitidos;
- regressões de propriedades, arrays, mapas e objetos aninhados verdes;
- 9/9 suítes API Docs focadas, além dos gates OpenAPI, lint e build;
- artefatos gerados sem diff e nenhuma alteração de dependência/configuração.
