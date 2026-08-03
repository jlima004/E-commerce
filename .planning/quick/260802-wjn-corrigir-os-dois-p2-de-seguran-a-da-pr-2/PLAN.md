---
name: corrigir-os-dois-p2-de-seguranca-da-pr-20
created: 2026-08-03
status: in-progress
---

# Corrigir os dois P2 do Codex na PR #20

## Objetivo

Corrigir no walker compartilhado de exemplos OpenAPI os dois bypasses novos da
PR #20: preservar um ancestral sensível durante todo o subtree e interpretar
chaves de `patternProperties` como nomes semânticos conservadores. Validar as
duas fronteiras (`ContractRegistryBundle` e `validateDocument`) sem alterar os
contratos gerados.

## Escopo autorizado

- `apps/backend/src/api-docs/safe-examples.ts`;
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`;
- `registry.ts` e `generation/validate.ts` somente se a integração exigir;
- artefatos deste quick task e `.planning/STATE.md`;
- commit, push, atualização/resposta/resolução dos dois threads somente após
  todos os gates e CI verde; solicitar novos reviews; não fazer merge.

Fora de escopo: deploy, migrations, produção/providers, secrets/env,
dependências/manifests/lockfile, artefatos OpenAPI, geração para ocultar drift,
skips/waivers/suppressions, casts inseguros e merge.

## Plano

1. Coordenar subagents obrigatórios de root-cause, security design, regressões
   de testes e auditoria final independente.
2. Reproduzir os dois bypasses antes da correção e adicionar regressões RED
   pareadas para ancestral sensível, `patternProperties`, profundidade, arrays,
   mapas, siblings e controles seguros.
3. Implementar a menor propagação estrutural segura no walker compartilhado,
   preservando a política existente `isSensitiveExampleKey(...)`.
4. Confirmar GREEN nas duas fronteiras e executar todos os gates locais:
   OpenAPI check/lint/foundation, matriz API Docs 9 suítes, lint, build e
   verificações de diff.
5. Criar commits objetivos, fazer push, aguardar CI API Docs verde, atualizar o
   total da PR, responder/resolver somente os dois threads e solicitar novos
   reviews Codex/Copilot. Nunca fazer merge.

## Evidência esperada

- bypasses RED antes e GREEN depois;
- decisões idênticas em `ContractRegistryBundle` e `validateDocument`;
- ancestral sensível ativo somente dentro do subtree;
- `patternProperties` normalizado conservadoramente sem nova lista sensível;
- controles `status`, `metadata.status`, `^status$` e `^publicField$` aceitos;
- vocabulários adicionais auditados sem expansão não demonstrada;
- artefatos Store/Admin/Webhooks byte-idênticos.
