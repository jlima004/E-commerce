---
name: nested-lookaround-fail-closed
created: 2026-08-03
status: completed
---

# Corrigir P2 de lookaround aninhado na PR #20

## Objetivo

Fechar o bypass em que assertions positivas retidas não eram normalizadas
recursivamente, permitindo fragmentos como `tracking` + `tokentoken` em vez de
reconhecer `tracking_token` nas duas fronteiras (`ContractRegistryBundle` e
`validateDocument`).

## Escopo autorizado

- `apps/backend/src/api-docs/safe-examples.ts`
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`
- este quick e `.planning/STATE.md`
- commit e push na branch `gsd/api-docs-wave-6-global-closure`

Fora de escopo: merge, deploy, CI await, resposta/resolução de thread, nova
review, `registry.ts`/`validate.ts` salvo necessidade demonstrada, artefatos
OpenAPI, dependências.

## Estratégia

Normalização recursiva limitada das assertions positivas retidas
(`MAX_LOOKAROUND_NESTING_DEPTH = 4`), fail-closed ao exceder o limite ou em
assertions malformadas/não fechadas. Fail-closed puro em qualquer lookaround
aninhado foi descartado porque rejeitaria controles permitidos
(`public_(?=status)status`, `display_(?=name)name`).

## Plano

1. Reproduzir o bypass e localizar o locus em `stripRegexLookaroundAssertions`.
2. Implementar recursão limitada nas bodies de assertions positivas.
3. Adicionar regressões RED/GREEN pareadas nas duas fronteiras.
4. Executar gates OpenAPI, unitários focados/completos, lint e build.
5. Commit + push; não aguardar CI nem tocar no thread.
