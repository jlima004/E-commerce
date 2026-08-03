# Corrigir os dois P2 residuais do re-review Codex na PR #20

## Resultado

**PASS local** — os dois bypasses residuais encontrados no re-review foram
corrigidos no walker compartilhado. Uma auditoria final encontrou ainda um
terceiro formato concreto do mesmo bypass de patternProperties; ele também foi
corrigido antes da publicação final. O contexto de schemas permaneceu isolado
e os artefatos OpenAPI gerados não mudaram.

Base do residual: 92415036faa08dedcc4b2425290f2c6dfec9280f

Commits de código residual:

- ab7093d3df0e5aed7f1d8c47f57af273a2c56343 — nomes de componentes schemas e
  padrões agrupados/separados;
- 1e8b8f526ab8f966f7454f10ac7170a309e06952 — isolamento de schema maps e
  padrões amplos;
- b4e17a4c296ea769bfe6261e07d7b8478712dc56 — separadores escapados/opcionais
  e tokens sensíveis separados por curingas.

## Subagents

- Root-cause: PASS — confirmou o descarte do nome de componentes schemas e
  as formas regex que não chegavam à política semântica.
- Security-design: a primeira revisão parcial bloqueou a propagação de
  contexto de schema maps; o desenho foi corrigido para resetar contexto em
  defs/dependentSchemas e avaliar nomes locais, sem criar nova lista sensível.
- Test-auditor: PASS — reproduziu RED residual e confirmou GREEN nas regressões
  pareadas das duas fronteiras.
- Final-auditor 1: BLOCKED — encontrou as variantes
  api[._-]?key/provider_order_id escondidas por classes e curingas.
- Final-auditor 2: PASS — commit b4e17a4, zero P0/P1/P2; confirmou padrões,
  TrackingToken, defs/dependentSchemas e siblings.

## Correção e regressões

- components.schemas agora usa uma localização própria e preserva a chave do
  componente como nome semântico no registry e no documento final.
- defs e dependentSchemas começam contexto próprio; nomes locais sensíveis são
  avaliados, sem contaminar siblings seguros.
- patternProperties normaliza apenas padrões literais seguros. Classes compostas
  por separadores pontuam o candidato semântico, enquanto metacaracteres
  isolados, grupos nomeados e classes de caracteres não viram nomes.
- A política existente isSensitiveExampleKey permanece a única fonte de
  classificação sensível.
- Rejeitados nas duas fronteiras: grouped provider_order_id, classes
  provider[_-]order[_-]id, trackingToken, api[._-]key, api[._-]?key,
  provider[\\._-]order[\\._-]id, provider[_-]order[_-]id entre curingas e
  token em padrão amplo.
- Permitidos e protegidos por regressões: status/publicField, ^.*$, grupo
  nomeado sem nome semântico e classe [token] tratada como classe, além de
  defs/dependentSchemas seguros sob siblings sensíveis.

## Gates locais

- openapi:check: PASS em checkout limpo, somente leitura.
- openapi:lint: PASS sem warning Spectral.
- openapi:verify:foundation: PASS.
- Matriz API Docs: 9/9 suítes, 259/259 testes PASS.
- geração focada: 115/115 PASS.
- lint backend: PASS, 0 erros e 261 avisos existentes.
- build backend: PASS.
- git diff --check: PASS.
- Store/Admin/Webhooks gerados: sem diff.

## Limites

Somente safe-examples.ts, registry.ts, generation.unit.spec.ts e os artefatos
GSD deste quick/STATE foram tocados. Não houve alteração de contratos de
negócio, dependências, lockfile, manifests, migrations, secrets, providers,
produção, deploy, merge ou artefatos OpenAPI gerados.

## Publicação e PR

O código residual foi publicado no branch
gsd/api-docs-wave-6-global-closure no SHA b4e17a4. O workflow API Docs
30785084449 ficou verde no SHA publicado em 26m48s. O corpo da PR foi
atualizado para 259/259. As duas threads residuais foram respondidas e
resolvidas após o CI verde. Nova revisão Codex foi solicitada pelo comentário
5162520432; a nova solicitação Copilot foi aceita, mas o bot retornou
novamente bloqueio por quota. Sem merge.
