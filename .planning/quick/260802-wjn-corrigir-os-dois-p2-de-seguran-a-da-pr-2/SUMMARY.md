# Corrigir os dois P2 do Codex na PR #20

## Resultado

**PASS** — os dois bypasses novos de segurança foram corrigidos no walker
compartilhado, com decisões idênticas em `ContractRegistryBundle` e
`validateDocument`, sem alteração dos contratos OpenAPI gerados.

Base/head antes: `eb1d4c90f546933def43d27643bce77a7d1df8e4`

Commit da correção: `2bbb0f48d66e1dc67d6a4b547f03c416445ac4ac`

## Subagents obrigatórios

- Root-cause: PASS — reproduziu a perda do ancestral sensível em propriedades
  aninhadas e a omissão de chaves de `patternProperties`; a matriz contra o
  HEAD anterior ficou RED com 14 falhas e 71 casos aprovados.
- Security-design: PASS — confirmou contexto sensível local ao ramo, sem
  contaminar siblings, e normalização conservadora sem ampliar a política
  existente `isSensitiveExampleKey(...)`.
- Test-auditor: PASS — adicionou regressões pareadas para registry e
  `validateDocument`; foco da correção ficou em 87/87.
- Final-auditor: PASS — auditou implementação, vocabulários e todos os gates;
  confirmou 9 suítes e 231/231 testes.

## Correção e regressões

- `sensitiveAncestor` agora é obrigatório no estado de travessia e é propagado
  somente no subtree descendente; propriedades irmãs externas não herdam o
  contexto.
- `properties` e `patternProperties` são tratados como mapas portadores de
  nome; padrões literais como `^provider_order_id$` e `^trackingToken$` são
  normalizados, enquanto padrões com metacaracteres não viram nomes semânticos.
- A política existente continua centralizada em `isSensitiveExampleKey(...)`.
- Cobertos: propriedades sensíveis aninhadas, snake_case/camelCase, singular,
  arrays e mapas de `examples`, padrões diretos/aninhados, siblings externos e
  controles seguros (`status`, `metadata.status`, `^status$`, `^publicField$`
  e `^.*$`).

## Gates

- `npm run openapi:check`: PASS, após commit limpo, somente leitura.
- `npm run openapi:lint`: PASS.
- `npm run openapi:verify:foundation`: PASS.
- Matriz API Docs: **9/9 suítes, 231/231 testes PASS**.
- `npm run lint -w @dtc/backend`: PASS, 0 erros e 261 avisos existentes.
- `npm run build -w @dtc/backend`: PASS.
- `git diff --check`: PASS.
- Artefatos gerados Store/Admin/Webhooks: sem diff.
- Auditoria final independente: PASS.

## Arquivos e limites

Arquivos de código/teste alterados:

- `apps/backend/src/api-docs/safe-examples.ts`
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`

Também foram atualizados somente os artefatos deste quick task e
`.planning/STATE.md`. `registry.ts`, `generation/validate.ts`, o writer
OpenAPI, os artefatos gerados, dependências, lockfile, manifestos, migrations,
secrets, providers, produção, deploy e merge permaneceram fora do escopo.

## Publicação e PR #20

- Branch `gsd/api-docs-wave-6-global-closure` publicada no commit da correção.
- Workflow API Docs `30780592881`: **verde** no SHA publicado, em 26m35s.
- Corpo da PR atualizado de `205/205` para `231/231`.
- Os dois threads P2 foram respondidos e resolvidos após o CI verde.
- Nova revisão Codex solicitada por `@codex review` no SHA corrigido.
- Nova revisão Copilot solicitada como revisor especial `Copilot` via API
  oficial; o pedido ficou pendente para processamento automático.
- Sem merge.
