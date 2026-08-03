# Corrigir os dois P2 residuais do re-review Codex na PR #20

## Resultado local

**PASS local; fechamento externo pendente.** Os dois bypasses do re-review
original foram corrigidos no walker compartilhado. As revisões Codex seguintes
encontraram quatro variantes concretas do mesmo escopo — resposta reutilizável,
separadores escapados, letras escapadas e classes unitárias escapadas — e cada
uma recebeu correção e regressão pareada. O contexto de schemas permaneceu
isolado e os artefatos OpenAPI gerados não mudaram.

Base do residual: `92415036faa08dedcc4b2425290f2c6dfec9280f`.

Commits de código desta sequência:

- `ab7093d` — nomes de componentes schemas e padrões agrupados/separados;
- `1e8b8f5` — isolamento de schema maps e padrões amplos;
- `b4e17a4` — separadores escapados/opcionais e curingas;
- `59d99a7` — nomes de componentes responses e mapa de respostas;
- `6e872e0` — controle positivo para status `200`/`default`;
- `2a63644` — separadores literais `\\x`/`\\u`;
- `5be1b94` — letras literais `\\xNN`/`\\uNNNN`;
- `4080626` — classes unitárias literais escapadas.

## Auditorias

- Root-cause: confirmou o descarte de nomes de componentes e os formatos regex
  que não chegavam à política semântica.
- Security-design: exigiu resetar contexto em `$defs`/`dependentSchemas` e
  avaliar nomes locais sem criar nova lista sensível.
- Test-auditor: reproduziu RED e confirmou GREEN nas duas fronteiras.
- Auditorias finais anteriores: encontraram bypasses reproduzíveis e foram
  incorporadas à sequência acima.
- Nova revisão Codex do HEAD `4080626` será solicitada após o CI verde.

## Correção e regressões

- `components.schemas` e `components.responses` preservam a chave do
  componente como nome semântico no registry e no walker final.
- `$defs` e `dependentSchemas` começam contexto próprio; nomes locais sensíveis
  são avaliados sem contaminar siblings seguros.
- `patternProperties` preserva tokens semânticos reconhecíveis em agrupamentos,
  classes separadoras, separadores opcionais, curingas e escapes literais.
- O decoder converte `\\xNN`/`\\uNNNN` antes da extração, e classes unitárias
  alfanuméricas equivalentes permanecem no token.
- A política existente `isSensitiveExampleKey` permanece a única fonte de
  classificação sensível.
- Rejeitados nas duas fronteiras: `provider_order_id`, `trackingToken`,
  `api[._-]?key`, padrões entre curingas, `TrackingToken`,
  `TrackingTokenResponse`, `^tracking\\x5ftoken$`, `^api\\u005Fkey$`,
  `^tracking_[\\x74]oken$` e `^api_[\\u006b]ey$`.
- Permitidos e protegidos por regressões: `status`, `publicField`, `^.*$`,
  status `200`/`default`, grupos sem nome semântico, classes compostas e
  siblings seguros sob `$defs`/`dependentSchemas`.

## Gates locais

- `openapi:check`: PASS em checkout limpo, somente leitura.
- `openapi:lint`: PASS sem warning Spectral.
- `openapi:verify:foundation`: PASS.
- Matriz API Docs: 9/9 suítes, `272/272` testes PASS.
- Geração focada: `128/128` PASS.
- Unit completa: 68 suítes, `1225/1225` testes PASS.
- Lint backend: PASS, 0 erros e 261 avisos existentes.
- Build backend: PASS.
- `git diff --check`: PASS.
- Store/Admin/Webhooks gerados: sem diff.

## Limites

Somente `safe-examples.ts`, `registry.ts`, `generation.unit.spec.ts` e os
artefatos GSD deste quick/STATE foram tocados. Não houve alteração de
contratos de negócio, dependências, lockfile, manifests, migrations, secrets,
providers, produção, deploy, merge ou artefatos OpenAPI gerados.

## Publicação e PR

O código foi publicado no branch `gsd/api-docs-wave-6-global-closure` no SHA
`4080626fd2f6d85c2c2ec38f436de2794c7de951`. O workflow API Docs
`30795192149` ainda está em execução neste closeout. O corpo da PR foi
atualizado para `272/272` e `1225/1225`. A thread corrente é
`PRRT_kwDOTEQ5Nc6V5Uky` (`3702148563`), ainda pendente de resposta/resolução
após o CI. Sem merge.
