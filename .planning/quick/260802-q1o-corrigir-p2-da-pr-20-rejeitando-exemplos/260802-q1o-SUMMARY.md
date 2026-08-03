---
quick_task: 260802-q1o
status: complete
classification: PASS
date: 2026-08-02
scope: api-docs-security-hardening
---

# Rejeição de exemplos sensíveis no nível de propriedades

## Resultado

Os gates `ContractRegistryBundle` e `validateDocument(...)` agora preservam o
nome da propriedade de schema ao atravessar `example` e `examples`. Quando esse
nome é classificado pela política existente `isSensitiveExampleKey`, o exemplo
é rejeitado independentemente de o valor parecer opaco, sintético, redigido,
estar em array ou estar em mapa.

## Evidência TDD

- Baseline anterior: suíte `generation.unit.spec.ts` verde em 17/17.
- Bypass reproduzido nas duas fronteiras para `tracking_token.example`,
  `authorization.examples`, propriedade sensível aninhada e `examples` em mapa.
- RED: 12 regressões negativas falharam como esperado; 21 testes, incluindo
  quatro controles permitidos e os 17 casos anteriores, permaneceram verdes.
- GREEN: `generation.unit.spec.ts` passou em 33/33.
- Matriz API Docs obrigatória: 9/9 suítes, 177/177 testes.

## Gates locais

- `npm run openapi:lint`: PASS.
- `npm run lint -w @dtc/backend`: PASS, 0 erros; 263 warnings preexistentes.
- `npm run build -w @dtc/backend`: PASS.
- `git diff --check`: PASS.
- Artefatos Store/Admin/Webhooks: sem diff.
- Nenhuma supressão ou cast inseguro novo.

O `openapi:check` read-only será executado no checkout limpo pela auditoria
independente antes do push, conforme o contrato do próprio gate.

## Escopo preservado

Somente os três arquivos autorizados de implementação/teste e os artefatos
quick/GSD foram alterados. Nenhum writer OpenAPI, migration, provider, secret,
variável de ambiente, deploy ou merge foi executado.
