---
status: complete
classification: PASS
completed_at: 2026-07-13
rc1_a_completed_at: 2026-07-10
rc1_b_checked_at: 2026-07-12
rc1_c_checked_at: 2026-07-13
rc1_e_checked_at: 2026-07-13
rc1_f_completed_at: 2026-07-13
phase_12_status: not-planned-not-started-blocked
scope_revision: heroku-excluded
---

# Resumo — Gate de estabilização Backend RC1

## Resultado

**PASS.** O RC1-F recuperou os contratos exigidos pelo lint do Medusa, preservou os 208 warnings e comprovou lint, testes, build e toolchain reproduzíveis sem models ou migrations. Os blockers anteriores permanecem registrados abaixo como histórico da sequência RC1-A/B/C/E.

O Gate RC1-A reconstruiu `node_modules` exclusivamente com `npm ci --include=dev` (exit 0), sem alterar arquivos versionados. `eslint@9.39.4` e `@medusajs/eslint-plugin@2.16.0` foram resolvidos, porém o carregamento do ESLint continuou falhando por incompatibilidade de toolchain AJV; `medusa lint` reportou `eslint` como indisponível e encerrou com código 1. Pela regra de parada, build, Docker/Postgres e ambas as integrações não foram executados.

O RC1-B removeu somente o override global de AJV e atualizou restritamente o lockfile. Isso restaurou `eslint --version` para `v9.39.4`, mas a inspeção completa de AJV revelou `ELSPROBLEMS` por outro conflito preexistente no lockfile: `@rushstack/node-core-library@5.13.0` pede `ajv~8.13.0` e a árvore mantém `ajv@8.20.0`. Pelo gatilho explícito do RC1-B, a correção não foi ampliada; lint, audit, unitários e build não foram iniciados.

O RC1-C adicionou somente o override específico de Rushstack solicitado. O npm 10.9.8 não atualizou a resolução AJV do lock existente; após instalação limpa, Rushstack continuou em 8.20.0, enquanto ESLint e eslintrc permaneceram corretamente em 6.15.0 e `eslint --version` retornou `v9.39.4`. Uma reconstrução sem lock de entrada produziu Rushstack em 8.13.0, mas alterou 1.787 linhas do lockfile e elevou o resumo automático de vulnerabilidades de 99 para 104. A atualização ampla foi rejeitada e o lock RC1-B preservado foi reposto. O gate parou sem audit formal, lint, unitários, build ou commit.

O RC1-E alterou somente o override específico para AJV 8.20.0. Após um primeiro `npm ci` inconclusivo e descartado, o fallback autorizado manteve o lock RC1-B sem alteração adicional e a repetição limpa instalou 1.503 pacotes. Rushstack resolveu AJV 8.20.0 como `overridden`; ESLint e eslintrc resolveram 6.15.0; as árvores completa e produtiva saíram em 0; houve 6 adições semânticas e zero mudança de versão runtime. Os audits registraram 8 high/0 critical em produção, sem regressão de pacote runtime. O lint executou regras reais, mas falhou com 7 erros e 208 avisos; o gate parou sem unitários, build, reprodutibilidade ou commit.

O RC1-F mudou somente os quatro valores de identificadores, os três métodos públicos assíncronos, os dois consumidores card/Pix e testes diretamente afetados. A geração de tipos tornou dois casts no lookup de tracking necessários por referência direta às constants; o ajuste foi type-only. Lint completo passou com 0 erros e 208 warnings, 43/43 suites e 676/676 testes passaram, o build passou, e a repetição completa após `npm ci` reproduziu os mesmos resultados e a árvore AJV válida.

## Gate RC1-F — evidência nova

| Item | Resultado |
|---|---|
| Identificadores | Quatro constants em snake_case; nenhum diretório, model, tabela ou migration renomeado. |
| Assinaturas | Card, Pix e refund retornam Promise; rotas aguardam o service e o resolver local. |
| Regressões | 3 testes unitários de service/contexto e 4 testes de contrato mockado para prioridade/fallback/rejeição/chamada única; fixtures analytics/email atualizadas. |
| Lint | Dirigido exit 0; completo exit 0, 0 erros e 208 warnings. |
| Testes | Dirigidos: 149 unitários + 33 do contrato mockado. Completo: 43/43 suites, 676/676 testes. |
| Build | PASS antes e depois da instalação limpa. |
| Reprodutibilidade | `npm ci --include=dev` instalou 1503 pacotes sem alterar o lock; validações repetidas PASS. |
| Toolchain | Rushstack AJV 8.20.0 `overridden`; ESLint/eslintrc AJV 6.15.0; ESLint v9.39.4; árvore exit 0. |
| Model/migration | Nenhum diff e nenhuma migration gerada/aplicada. |

## Gate RC1-E — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, seis arquivos autorizados modificados, runtime/testes sem diff e `git diff --check` PASS. |
| Manifesto/lock | Override global ausente; somente Rushstack → AJV 8.20.0. Fallback `--package-lock-only --ignore-scripts` necessário após primeira instalação inconclusiva; lock final permaneceu +68 linhas do RC1-B. |
| Instalação limpa | PASS: 1503 pacotes instalados; lock não sofreu mudança adicional. |
| AJV | Rushstack 8.20.0 `overridden`; ESLint 6.15.0; eslintrc 6.15.0; `npm ls ajv --all` e `--omit=dev` exit 0. |
| Semântica do lock | 6 entradas adicionadas, 0 mudanças de versão runtime, AJV raiz 8.20.0. |
| Audits | Produção: 90 moderate/8 high/0 critical (98 total). Completo: 91 moderate/8 high/0 critical (99 total). Achados registrados, sem correção. |
| Lint | BLOCKED: exit 1, 7 erros reais e 208 avisos; nenhuma violação corrigida. |
| Demais gates | Unitários, build, reprodutibilidade e commit NOT RUN pela regra de parada. Docker, integrações, bancos, migrations, deploy, tag, push e Phase 12 não acionados. |

## Gate RC1-C — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, seis arquivos autorizados modificados e `git diff --check` PASS. |
| Manifesto | Override global ausente; somente `@rushstack/node-core-library@5.13.0 -> ajv@8.13.0`; nenhuma dependência direta adicionada ou atualizada. |
| Lock preservado | Diff final continua +68 linhas do RC1-B, limitado ao AJV 6.15.0 dos ramos ESLint e transitivos necessários. |
| Reificação restrita | ESLint/eslintrc resolveram AJV 6.15.0; Rushstack ainda resolveu AJV 8.20.0. `npm ls ajv --all` não foi repetido porque a prova direta por consumidor já falhou. |
| Reconstrução integral rejeitada | Rushstack 8.13.0 foi materializado, mas com 839 inserções/948 remoções no lockfile e 104 vulnerabilidades no resumo automático; atualização ampla restaurada para o lock RC1-B preservado. |
| ESLint | `eslint@9.39.4`, plugin Medusa `2.16.0`, `eslint --version` `v9.39.4`. |
| Audits | `npm audit --omit=dev` e `npm audit` NOT RUN; somente resumos automáticos de install/ci foram observados (99 no lock preservado; 104 na reconstrução rejeitada). |
| Demais gates | lint, unitários, build e commit NOT RUN pela regra de parada; Docker, integrações, bancos, migrations, deploy, tag, push e Phase 12 não acionados. |

## Gate RC1-B — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, worktree limpo e `git diff --check` PASS. |
| Manifesto | Somente remoção de `overrides.ajv: ^8.0.0`; `eslint` permaneceu `^9.39.4` e o plugin Medusa `2.16.0`. |
| Lockfile | +68 linhas: AJV 6.15.0 aninhado para ESLint e `@eslint/eslintrc`, com seus três transitivos; nenhuma atualização ampla ou alteração de dependência direta. |
| Instalação limpa | `npm ci --include=dev` materializou 1503 pacotes e emitiu o resumo de audit; o wrapper local permaneceu aberto após a saída do npm e foi interrompido apenas depois desse resumo. |
| ESLint | PASS: `npm ls eslint @medusajs/eslint-plugin --depth=0` mostrou `eslint@9.39.4` e `@medusajs/eslint-plugin@2.16.0`; `node_modules/.bin/eslint --version` retornou `v9.39.4`. |
| AJV | BLOCKED: `npm ls ajv --all` exit 1 / `ELSPROBLEMS`; `@rushstack/node-core-library@5.13.0` requer `~8.13.0`, mas o lockfile mantém `ajv@8.20.0`. AJV 6.15.0 está corretamente aninhado sob ESLint e `@eslint/eslintrc`. |
| Demais gates | NOT RUN por regra de parada: `npm audit --omit=dev`, `npm audit`, lint, unitários, build, Docker, integrações, banco e migrations. |

## Gate RC1-A — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD `f4bf7f1327e7fc5e035e41196171d27199480670`, worktree limpo; `git diff --check` PASS. |
| Ambiente | Node `v22.23.1`, npm `10.9.8`, `npm config get omit` vazio. |
| Reconstrução | `rm -rf node_modules` seguido de `npm ci --include=dev`: exit 0. |
| Resolução | `npm ls --depth=0`: `eslint@9.39.4` e `@medusajs/eslint-plugin@2.16.0`. |
| Binário | Presente em `node_modules/.bin/eslint`, mas `eslint --version` falhou (exit 2) em `@eslint/eslintrc` com `TypeError: Cannot set properties of undefined (setting 'defaultMeta')`; aviso AJV `missingRefs` antecede o erro. |
| Lint | `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run lint -w @dtc/backend`: exit 1; `medusa lint` informou que o pacote ESLint não está instalado. Nenhuma regra de código foi avaliada. |
| Build | NOT RUN — bloqueado pelo lint. |
| Integração HTTP | NOT RUN — Docker/Postgres não iniciado após o lint bloqueante. |
| Integração de módulos | NOT RUN — Docker/Postgres não iniciado após o lint bloqueante. |
| Banco | Nenhum banco local ou remoto foi usado; nenhuma migration foi aplicada. |
| Imutabilidade | `package.json`, `package-lock.json` e `apps/backend/package.json` sem diff; `git diff --check` PASS. |

A árvore reconstruída mostra o override raiz `"ajv": "^8.0.0"`. O grafo efetivo coloca `ajv@8.20.0` sob `@eslint/eslintrc@3.3.5`, enquanto o registro de `eslint@9.39.4` no lockfile declara `ajv@^6.14.0`; esta é a causa observável do erro de carregamento. Não houve tentativa de alterar override, manifesto, lockfile ou dependência.

## Resultados técnicos

- Git local/origin alinhado em `5fe53e1` no gate anterior; o baseline do RC1-A foi `f4bf7f1`, sem diff de runtime, package ou lockfile.
- Unit: PASS — 43/43 suites, 676/676 testes.
- Contrato HTTP diretamente afetado: PASS — 33 testes totalmente mockados, sem banco.
- Lint: PASS — 0 erros e 208 warnings antes e depois do `npm ci`.
- Build: PASS antes e depois do `npm ci`.
- Varredura rastreada: apenas canários/test fixtures e categorias públicas/test-mode revisadas; nenhum segredo real confirmado.
- Supabase: todas as invariantes canônicas passaram por leitura sanitizada.
- Migrations: nove arquivos locais correspondem a migrations aplicadas; nenhuma pendente. Os quatro nomes `TBD-*` estão aplicados, não diferidos.
- Stripe PaymentIntent: `succeeded`, BRL 9900. `livemode` e `amount_received` não comprovados; Refund não consultado após a parada.

## Escopo cancelado

Heroku ficou integralmente fora da retomada. Produção Heroku, logs do release e runbook de rollback foram cancelados por decisão humana e não contam como falha do RC.

## Arquivos documentais finais

- `.planning/quick/260710-rc1-estabilizacao-release-backend/PLAN.md`
- `.planning/quick/260710-rc1-estabilizacao-release-backend/VERIFICATION.md`
- `.planning/quick/260710-rc1-estabilizacao-release-backend/SUMMARY.md`
- `.planning/STATE.md`

## Não ações confirmadas

Nenhuma tag, migration, `db:migrate:safe`, DDL, escrita/mutação no Supabase, criação de PaymentIntent, refund, webhook replay, chamada Gelato/Resend/PostHog, acesso Heroku, deploy, rollback, alteração de config, Docker/Postgres ou chamada a banco remoto foi executada. Não houve autofix, alteração de regra ESLint, correção dos 208 warnings, push ou início da Phase 12.

## Próximo gate permitido

Submeter os três commits locais do RC1-F ao manual gate. Qualquer tag, push, produção ou abertura da Phase 12 exige autorização humana separada.
