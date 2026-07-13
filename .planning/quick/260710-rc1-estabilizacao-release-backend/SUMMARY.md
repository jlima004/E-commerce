---
status: complete
classification: PASS
completed_at: 2026-07-13
rc1_a_completed_at: 2026-07-10
rc1_b_checked_at: 2026-07-12
rc1_c_checked_at: 2026-07-13
rc1_e_checked_at: 2026-07-13
rc1_f_completed_at: 2026-07-13
rc1_g_checked_at: 2026-07-13
rc1_h_completed_at: 2026-07-13
phase_12_status: not-planned-not-started-blocked
scope_revision: heroku-excluded
---

# Resumo — Gate de estabilização Backend RC1

## Resultado

**PASS.** O RC1-H recuperou as suítes de integração sem alterar runtime. O Jest deixou de coletar uma fixture, as 12 falhas HTTP foram reproduzidas e classificadas sem `UNKNOWN`, as correções ficaram restritas a quatro specs e `jest.config.js`, e todos os gates locais passaram. Não há `PASS WITH KNOWN DEBTS`.

O RC1-H usou seis bancos PostgreSQL 16 independentes em localhost, sem Supabase ou banco remoto. Modules passou 28/28 e 454/454; HTTP passou 14/14 e 170/170; unitários passaram 43/43 e 676/676; lint passou com 0 erros/208 warnings; build passou. Nenhum model, migration, manifest ou lockfile mudou. O container, os bancos e os temporários foram removidos. Commit de testes/configuração: `e45adf9`; não houve commit de runtime.

O Gate RC1-A reconstruiu `node_modules` exclusivamente com `npm ci --include=dev` (exit 0), sem alterar arquivos versionados. `eslint@9.39.4` e `@medusajs/eslint-plugin@2.16.0` foram resolvidos, porém o carregamento do ESLint continuou falhando por incompatibilidade de toolchain AJV; `medusa lint` reportou `eslint` como indisponível e encerrou com código 1. Pela regra de parada, build, Docker/Postgres e ambas as integrações não foram executados.

O RC1-B removeu somente o override global de AJV e atualizou restritamente o lockfile. Isso restaurou `eslint --version` para `v9.39.4`, mas a inspeção completa de AJV revelou `ELSPROBLEMS` por outro conflito preexistente no lockfile: `@rushstack/node-core-library@5.13.0` pede `ajv~8.13.0` e a árvore mantém `ajv@8.20.0`. Pelo gatilho explícito do RC1-B, a correção não foi ampliada; lint, audit, unitários e build não foram iniciados.

O RC1-C adicionou somente o override específico de Rushstack solicitado. O npm 10.9.8 não atualizou a resolução AJV do lock existente; após instalação limpa, Rushstack continuou em 8.20.0, enquanto ESLint e eslintrc permaneceram corretamente em 6.15.0 e `eslint --version` retornou `v9.39.4`. Uma reconstrução sem lock de entrada produziu Rushstack em 8.13.0, mas alterou 1.787 linhas do lockfile e elevou o resumo automático de vulnerabilidades de 99 para 104. A atualização ampla foi rejeitada e o lock RC1-B preservado foi reposto. O gate parou sem audit formal, lint, unitários, build ou commit.

O RC1-E alterou somente o override específico para AJV 8.20.0. Após um primeiro `npm ci` inconclusivo e descartado, o fallback autorizado manteve o lock RC1-B sem alteração adicional e a repetição limpa instalou 1.503 pacotes. Rushstack resolveu AJV 8.20.0 como `overridden`; ESLint e eslintrc resolveram 6.15.0; as árvores completa e produtiva saíram em 0; houve 6 adições semânticas e zero mudança de versão runtime. Os audits registraram 8 high/0 critical em produção, sem regressão de pacote runtime. O lint executou regras reais, mas falhou com 7 erros e 208 avisos; o gate parou sem unitários, build, reprodutibilidade ou commit.

O RC1-F mudou somente os quatro valores de identificadores, os três métodos públicos assíncronos, os dois consumidores card/Pix e testes diretamente afetados. A geração de tipos tornou dois casts no lookup de tracking necessários por referência direta às constants; o ajuste foi type-only. Lint completo passou com 0 erros e 208 warnings, 43/43 suites e 676/676 testes passaram, o build passou, e a repetição completa após `npm ci` reproduziu os mesmos resultados e a árvore AJV válida.

O RC1-G criou `rc1g_http`, `rc1g_modules` e `rc1g_upgrade` no mesmo Postgres 16 local em `127.0.0.1:55432`. HTTP terminou com 10/14 suítes e 158/170 testes passando; modules terminou com 28/29 suítes passando e 454/454 testes executados verdes, mas um fixture sem testes foi coletado como suíte. Como nenhuma falha era ausência de schema, os dois bancos de integração não receberam migrations. O runtime `a729e65` criou 152 tabelas no banco de upgrade; o runtime atual aceitou o schema sem nova migration, conflito ou duplicação, preservando 23/175/5 registros nas três tabelas de migration. O backend atual iniciou na porta 9011 e reconheceu os quatro módulos renomeados; Redis era somente localhost e não houve chamada externa.

## Gate RC1-H — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD/origin observado `47c41f0`; somente quatro documentos RC1 modificados; código/testes/Jest/manifests limpos; `git diff --check` PASS. |
| Coleta modules | 29 antes, 28 depois; saiu apenas `fixtures/payment-start-cart.ts`; 28 specs legítimas preservadas. |
| Diagnóstico HTTP | 12 falhas: 5 `ENVIRONMENT_ISOLATION`, 3 `STALE_MOCK_OR_CONTAINER_KEY`, 4 `STALE_TEST_EXPECTATION`; zero `UNKNOWN` e zero defeito real de runtime. |
| Testes corrigidos | Configuração Resend fake/local explicitamente isolada; provas Phase 03 limitadas às superfícies pre-Order; entrypoint terminal injetado no mock Phase 05; evento realmente não suportado; Sentry sem contagem global congelada. |
| Dirigidas | Order 17/17; cart 24/24; Stripe store 10/10; Sentry 12/12. |
| Modules completa | 28/28 suítes, 454/454 testes, exit 0. |
| HTTP completa | 14/14 suítes, 170/170 testes, exit 0. |
| Unitários | 43/43 suítes, 676/676 testes, exit 0. |
| Lint/build | Lint exit 0, 0 erros/208 warnings; build exit 0. |
| Imutabilidade | Sem diff em runtime, models, migrations, `package.json` ou `package-lock.json`; nenhuma migration gerada/aplicada. |
| Isolamento/limpeza | Seis bancos exclusivamente em `127.0.0.1:55433`; container e `/tmp/rc1-h*` removidos; nenhuma senha/URL completa documentada. |
| Commits | `e45adf9` testes/configuração; nenhum commit de runtime; documentação em commit separado. |

## Gate RC1-G — evidência nova

| Item | Resultado |
|---|---|
| Baseline | `main`, HEAD `47c41f00648ff9d6bc0649e1c07a37ae03130858`, `origin/main` no mesmo SHA (0 à frente/0 atrás), worktree limpo e nenhum diff em runtime/testes/manifests; nenhum fetch ou push foi executado. |
| HTTP | **BLOCKER**: exit 1 em 86 s; 14 suítes/170 testes, 10 suítes e 158 testes PASS, 4 suítes e 12 testes FAIL; migration não necessária. |
| Modules | **BLOCKER**: exit 1 em 37 s; 29 suítes/454 testes, 28 suítes e 454 testes PASS; um fixture sem testes coletado como suíte; migration não necessária. |
| Isolamento | Guardas confirmaram `rc1g_http`, `rc1g_modules` e `rc1g_upgrade` em localhost; nenhuma URL/senha registrada e nenhum banco remoto usado. |
| Runtime anterior | `a729e65`; `npm ci` exit 0/232 s; migration exit 0/64 s; 152 tabelas. |
| Migrations antes | `link_module_migrations=23`, `mikro_orm_migrations=175`, `script_migrations=5`. |
| Runtime atual | Migration exit 0/40 s; schema atualizado, sem conflito de tabela, migration de projeto ou DDL inesperado. |
| Migrations depois | 152 tabelas e contadores 23/175/5 inalterados; zero duplicatas nas três tabelas. |
| Bootstrap | Backend pronto na porta 9011; `analytics_event_log`, `email_delivery_log`, `gelato_fulfillment` e `tracking_access_token` resolvidos sem erro. |
| Toolchain final | AJV exit 0; ESLint v9.39.4; lint exit 0 com 0 erros/208 warnings; build exit 0. |
| Limpeza | Container e worktree temporário ausentes; somente checkout principal listado; `git diff --check` limpo antes da documentação. |

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

- Git no RC1-G: `main` e `origin/main` em `47c41f0` (0 à frente/0 atrás), sem diff de runtime, package ou lockfile. O contexto inicial informava três commits à frente, mas o ref local observado já estava alinhado; nenhum fetch ou push foi executado.
- Unit: PASS — 43/43 suites, 676/676 testes.
- Integração HTTP completa: PASS — 14/14 suítes e 170/170 testes.
- Integração modules completa: PASS — 28/28 suítes e 454/454 testes; fixture não coletada.
- Upgrade local: PASS — runtime anterior e atual aceitaram o mesmo schema, sem duplicação de migration.
- Lint: PASS — 0 erros e 208 warnings antes e depois do `npm ci`.
- Build final: PASS.
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

No RC1-H nenhuma migration foi gerada ou aplicada; os seis bancos foram locais e descartáveis. Nenhuma tag, acesso ou mutação no Supabase, criação real de PaymentIntent, refund, webhook replay externo, chamada real Stripe/Gelato/Resend/PostHog, acesso Heroku, deploy, rollback, alteração de config, autofix, push ou início da Phase 12 ocorreu. Nenhum arquivo de runtime, model, migration, package ou lockfile foi alterado.

## Próximo gate permitido

Revisão humana do RC1-H concluído. Qualquer tag, push, produção, provider real ou abertura da Phase 12 exige autorização humana separada.
