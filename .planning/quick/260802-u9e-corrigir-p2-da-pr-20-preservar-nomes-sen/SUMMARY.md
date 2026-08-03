# Corrigir P2 da PR #20: nomes sensíveis em examples

## Resultado

**PASS** — o contexto semântico de objetos OpenAPI reconhecíveis é preservado
nos dois gates de segurança, sem criar contexto a partir de `name` arbitrário e
sem alterar os artefatos OpenAPI gerados.

Base/head antes: `4ddae4351fe733171bc90bd1c8bb01637e289fed`

## Subagents obrigatórios

- Root-cause: PASS — reproduziu o bypass nos gates `ContractRegistryBundle` e
  `validateDocument` e isolou a perda de contexto de `Parameter.name`, headers
  nomeados e componentes.
- Security-design: PASS — definiu propagação somente em objetos OpenAPI
  reconhecíveis; `name` arbitrário e chaves de mapas `examples` não criam
  contexto sensível.
- Test-auditor: PASS — confirmou a matriz pareada e os controles positivos;
  geração `61/61`.
- Final-auditor: PASS — após dois achados adicionais (`dependentSchemas`,
  `patternProperties`, `unevaluatedProperties`, `contentSchema`, `$defs` e
  `unevaluatedItems`), não identificou bypass estrutural remanescente.

## Correção e regressões

- `safe-examples.ts` concentra o walker contextual e a política existente
  `isSensitiveExampleKey(...)`.
- `registry.ts` e `generation/validate.ts` usam o mesmo walker, mantendo apenas
  os padrões de valor já existentes em cada gate.
- Cobertos: parâmetros snake_case/camelCase, `example` singular, arrays/maps
  de `examples`, headers de resposta, `components.parameters`,
  `components.headers`, request/response content/schema e vocabulários de
  schema aninhados.
- Preservados: exemplos de propriedades, objetos aninhados, arrays/maps,
  status/fields seguros, chaves de mapa de examples e `name` arbitrário fora
  de contexto semântico.

## Gates

- API Docs focado: **9/9 suítes, 205/205 testes PASS**.
- `npm run openapi:lint`: PASS.
- `npm run openapi:verify:foundation`: PASS.
- `npm run lint -w @dtc/backend`: PASS, 0 erros e 261 avisos existentes.
- `npm run build -w @dtc/backend`: PASS.
- `git diff --check`: PASS.
- Artefatos gerados (`store`, `admin`, `webhooks`): sem diff.
- Supressões/casts inseguros novos: nenhum.
- `npm run openapi:check`: PASS após commit limpo, em modo somente leitura.

## Arquivos e limites

Arquivos alterados:

- `apps/backend/src/api-docs/safe-examples.ts`
- `apps/backend/src/api-docs/registry.ts`
- `apps/backend/src/api-docs/generation/validate.ts`
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`
- este quick e `.planning/STATE.md`

Não foram tocados writer OpenAPI, artefatos gerados, dependências, lockfile,
manifestos, migrations, secrets, providers, produção, deploy ou merge.

## Publicação autorizada

- Commit principal: criado após os gates locais; o `HEAD` publicado é a
  referência final do commit.
- Push da branch `gsd/api-docs-wave-6-global-closure`: autorizado e a registrar.
- Corpo da PR #20: atualizar total focado de `161/161` para `205/205`.
- Thread P2: responder e resolver somente após CI verde.
- Novo review Codex: solicitar após push/CI; Copilot somente se necessário.
