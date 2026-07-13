---
status: passed
classification: PASS
verified_at: 2026-07-13
rc1_a_verified_at: 2026-07-10
rc1_b_checked_at: 2026-07-12
rc1_c_checked_at: 2026-07-13
rc1_e_checked_at: 2026-07-13
rc1_f_verified_at: 2026-07-13
rc1_g_checked_at: 2026-07-13
rc1_h_verified_at: 2026-07-13
scope_revision: heroku-excluded
---

# Verificação — Backend RC1

## Escopo efetivo

O usuário confirmou a rotação das variáveis e retomou o gate sem Heroku. Produção Heroku, logs do release e runbook de rollback foram cancelados por decisão humana e não são critérios desta classificação. Nenhuma consulta Heroku foi realizada na retomada.

O RC1-A restringiu-se à recuperação do ambiente local: remover/reconstruir `node_modules` com o lockfile e executar as validações em ordem. Não autorizou ajustes de dependência, código, configuração, banco remoto ou produção. O lint bloqueou antes de build e antes da criação do Postgres Docker descartável.

## Baseline Git

| Campo | Resultado |
|---|---|
| Branch | `main` |
| LOCAL_SHA antes dos documentos da retomada | `5fe53e1c3cf9a86ade505836915a768226e96c7f` |
| ORIGIN_MAIN_SHA | `5fe53e1c3cf9a86ade505836915a768226e96c7f` |
| Divergência local/origin | `0/0` |
| Diff local/origin | vazio |
| Package/lockfiles alterados | não |
| Tag `v1.0-backend-rc*` existente | não encontrada |

`git diff --check` não apresentou erro antes da atualização documental. O worktree passou a conter somente as alterações documentais desta retomada.

## Suítes locais

| Verificação | Exit | Resultado | Duração | Evidência |
|---|---:|---|---:|---|
| `TMPDIR=/tmp npm run test:unit -w @dtc/backend` | 0 | PASS | Jest 84,194 s; wall 89,01 s | 43/43 suites e 673/673 testes passaram; 0 snapshots. |
| `test:integration:http` | — | BLOCKED / NOT RUN | — | Não há `.env.test`; o Postgres local não está comprovado como banco isolado e descartável. |
| `test:integration:modules` | — | BLOCKED / NOT RUN | — | Mesmo bloqueio de isolamento. |
| `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run lint -w @dtc/backend` | 1 | **BLOCKER** | wall 4,33 s | `medusa lint` pulou a análise porque `eslint` não está instalado; lifecycle encerrou com código 1. Aviso AJV `missingRefs` também observado. |
| `build` | — | NOT RUN | — | Gate interrompido após o blocker do lint, sem correção. |

### RC1-A — reconstrução e repetição controlada

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| `rm -rf node_modules` + `npm ci --include=dev` | 0 | PASS | Instalação concluída a partir do lockfile. |
| `npm ls eslint @medusajs/eslint-plugin --depth=0` | 0 | PASS | `eslint@9.39.4`; `@medusajs/eslint-plugin@2.16.0`. |
| `node_modules/.bin/eslint --version` | 2 | **BLOCKER** | Binário existe, mas falha no carregamento com AJV `missingRefs` e `TypeError ... defaultMeta`. |
| lint do workspace | 1 | **BLOCKER** | `medusa lint` ainda informa ESLint indisponível; nenhuma regra foi executada. |
| build | — | NOT RUN | Regra de parada após lint. |
| HTTP/modules | — | NOT RUN | Docker/Postgres, guard localhost e migrations descartáveis não foram iniciados após lint. |

O `package.json` raiz mantém o override `ajv: ^8.0.0`; o grafo efetivo instalou `ajv@8.20.0` para `@eslint/eslintrc@3.3.5`, enquanto o lockfile registra `eslint@9.39.4` com dependência `ajv@^6.14.0`. A incompatibilidade foi apenas registrada; não foi corrigida.

Nenhuma dependência foi adicionada ou alterada em manifests/lockfiles; `npm ci --include=dev` somente reconstruiu `node_modules` a partir do lockfile.

### RC1-B — grafo ESLint/AJV

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| Baseline Git | 0 | PASS | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, worktree limpo e `git diff --check` PASS. |
| Remoção do override | 0 | PASS | `package.json` removeu somente `overrides.ajv`; versões diretas de ESLint e plugin Medusa preservadas. |
| Lockfile restrito | 0 | PASS | +68 linhas, apenas AJV 6.15.0 para ramos ESLint e três transitivos; sem update amplo. |
| `eslint --version` | 0 | PASS | `v9.39.4`. |
| `npm ls ajv --all` | 1 | **BLOCKER** | `ELSPROBLEMS`: `@rushstack/node-core-library@5.13.0` requer `ajv~8.13.0`, mas `node_modules/ajv` está em 8.20.0. |
| audit, lint, unitários e build | — | NOT RUN | A regra RC1-B exige registrar e parar quando a remoção revelar incompatibilidade adicional. |

AJV 6.15.0 ficou corretamente isolado em `eslint/node_modules/ajv` e `@eslint/eslintrc/node_modules/ajv`; AJV 8.20.0 continuou no ramo Rushstack. A incompatibilidade AJV 8 já estava no lockfile original e foi revelada pela inspeção completa agora exigida; este gate não autoriza corrigir a faixa ou ampliar a atualização.

### RC1-C — override Rushstack/AJV e regeneração do lockfile

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| Baseline Git | 0 | PASS | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, somente os seis arquivos autorizados já modificados e `git diff --check` PASS. |
| Versão Rushstack | 0 | PASS | `@rushstack/node-core-library@5.13.0`. |
| Manifesto | 0 | PASS | Override global continua removido; foi adicionado somente `@rushstack/node-core-library@5.13.0 -> ajv@8.13.0`; ESLint `^9.39.4` e plugin Medusa `2.16.0` preservados. |
| Regeneração sobre lock existente | 0 | BLOCKED | O npm 10.9.8 reconheceu Rushstack como `overridden`, mas não alterou a resolução AJV 8 do lockfile. |
| Instalação limpa sobre lock preservado | 0 | BLOCKED | 1503 pacotes instalados; `eslint@9.39.4`, plugin Medusa `2.16.0` e `eslint --version` `v9.39.4`; consumidores ESLint/eslintrc resolveram AJV 6.15.0, mas Rushstack continuou em AJV 8.20.0. |
| Regeneração sem `node_modules` e sem lock de entrada | 0 | **BLOCKER** | Materializou Rushstack AJV 8.13.0, mas produziu atualização ampla: 1.787 linhas alteradas no lockfile (839 inserções/948 remoções) e resumo automático de 104 vulnerabilidades (91 moderate/13 high), contra 99 (91 moderate/8 high) no lock preservado. |
| Preservação do lock RC1-B | 0 | PASS | O lock anterior foi restaurado a partir da cópia preservada fora do repositório, sem `git reset`, `checkout`, `restore` ou edição manual. Diff final do lock voltou a +68 linhas do RC1-B. |
| `npm ls ajv --all`, audits formais, lint, unitários e build | — | NOT RUN | A prova por consumidor falhou antes de `npm ls`: Rushstack permaneceu em 8.20.0 no lock restrito; a alternativa gerou atualização ampla e acionou a regra de parada. |

O resumo de vulnerabilidades acima foi emitido automaticamente por `npm install`/`npm ci`; `npm audit --omit=dev` e `npm audit` não foram executados como gates formais. Como a árvore válida só foi obtida junto com atualização ampla, não houve base autorizada para classificar advisories por caminho de produção ou prosseguir às suítes.

### RC1-E — AJV runtime preservado e override Rushstack escopado

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| Baseline Git | 0 | PASS | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, somente os seis arquivos autorizados já modificados, sem diff em runtime/testes e `git diff --check` PASS. |
| Manifesto | 0 | PASS | Override global ausente; somente `@rushstack/node-core-library@5.13.0 -> ajv@8.20.0`; nenhuma dependência AJV direta e nenhuma outra linha funcional alterada. |
| Primeira instalação | interrompida | INCONCLUSIVA | O primeiro `npm ci` não reportou inconsistência, mas permaneceu mais de 11 minutos em CPU ativa, sem exit, log avançando ou árvore completa. O PTY não encerrou o filho no primeiro `^C`; os processos órfãos foram terminados, a árvore parcial removida e essa tentativa contaminada descartada como evidência. |
| Fallback de lockfile | 0 | PASS | `npm install --package-lock-only --include=dev --ignore-scripts`: `up to date`; diff do lock continuou +68 linhas do RC1-B, sem reconstrução ampla. |
| Instalação limpa repetida | 0 | PASS | `npm ci --include=dev`: 1503 pacotes instalados e 1505 auditados; nenhuma alteração adicional do lockfile. |
| Versões diretas | 0 | PASS | `eslint@9.39.4`, `@medusajs/eslint-plugin@2.16.0`, `eslint --version` = `v9.39.4`. |
| AJV por consumidor | 0 | PASS | Rushstack = 8.20.0; ESLint = 6.15.0; `@eslint/eslintrc` = 6.15.0. |
| `npm ls ajv --all` | 0 | PASS | Rushstack aparece `overridden`; sem `ELSPROBLEMS`, `invalid` ou `extraneous`. |
| `npm ls ajv --all --omit=dev` | 0 | PASS | Árvore produtiva válida; Rushstack em AJV 8.20.0 `overridden`. |
| Comparação semântica do lock | 0 | PASS | 6 mudanças semânticas, todas adições do AJV 6/transitivos do RC1-B; `runtime_version_changes=0`; AJV raiz = 8.20.0. |
| Audit produção | 1 | PASS COM ACHADOS PREEXISTENTES | 0 low, 90 moderate, 8 high, 0 critical, total 98; árvore processada e nenhuma versão/pacote produtivo mudou neste candidato. |
| Audit completo | 1 | PASS COM ACHADOS PREEXISTENTES | 0 low, 91 moderate, 8 high, 0 critical, total 99; nenhum `audit fix` executado. |
| Lint | 1 | **BLOCKER** | ESLint executou as regras: 215 problemas, 7 erros e 208 avisos. |
| Unitários, build e reprodutibilidade | — | NOT RUN | Regra de parada após lint real com exit 1. |

Erros reais de lint registrados, sem correção neste gate:

- `apps/backend/src/modules/analytics-event-log/index.ts:6:23` — `@medusajs/module-name-snake-case`;
- `apps/backend/src/modules/email-delivery-log/index.ts:6:23` — `@medusajs/module-name-snake-case`;
- `apps/backend/src/modules/gelato-fulfillment/index.ts:6:23` — `@medusajs/module-name-snake-case`;
- `apps/backend/src/modules/payment-attempt/service.ts:68:3` — `@medusajs/service-methods-must-be-async`;
- `apps/backend/src/modules/payment-attempt/service.ts:76:3` — `@medusajs/service-methods-must-be-async`;
- `apps/backend/src/modules/refund-request/service.ts:519:3` — `@medusajs/service-methods-must-be-async`;
- `apps/backend/src/modules/tracking-access-token/index.ts:6:23` — `@medusajs/module-name-snake-case`.

### RC1-F — contratos Medusa e lint recuperados

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| Baseline Git | 0 | PASS | `main`, HEAD `2ee1cf5161758c5f281105ea99ab1bc9aca49158`, seis arquivos preexistentes modificados, sem diff em runtime/testes e `git diff --check` PASS. |
| Identificadores | 0 | PASS | `analytics_event_log`, `email_delivery_log`, `gelato_fulfillment` e `tracking_access_token`; diretórios, classes, models, tabelas e migrations preservados. |
| Services assíncronos | 0 | PASS | Resolvers card, Pix e refund agora retornam `Promise<Layer | null>`; helpers top-level permaneceram síncronos e o contexto `this` foi coberto por regressões unitárias. |
| Consumidores | 0 | PASS | Rotas card/Pix aguardam o fallback do service e o `POST`; token direto continua prioritário, fallback ocorre uma vez, rejeição vira layer ausente e o comportamento fail-closed foi preservado. |
| Lint dirigido | 0 | PASS | Zero erros e 12 warnings preexistentes nos dois services. |
| Lint completo | 0 | PASS | 208 problemas: 0 erros e 208 warnings; contagem idêntica ao RC1-E. |
| Testes dirigidos | 0 | PASS | 7 suites unitárias / 149 testes e contrato mockado das rotas / 33 testes; nenhuma conexão com banco. |
| Suíte unitária completa | 0 | PASS | 43/43 suites e 676/676 testes; baseline preservado e 3 testes unitários adicionados. |
| Build | 0 | PASS | Primeiro build revelou dois casts TypeScript diretamente ligados às novas constants; após ajuste type-only no consumidor de tracking/Gelato, o build passou. |
| Reprodutibilidade | 0 | PASS | `npm ci --include=dev` instalou 1503 pacotes sem alterar o lock; lint 0/208, unitários 43/43 e 676/676, build exit 0. |
| AJV/ESLint | 0 | PASS | Rushstack AJV 8.20.0 `overridden`; ESLint e eslintrc AJV 6.15.0; `npm ls ajv --all` exit 0; ESLint v9.39.4. |
| Models/migrations | 0 | PASS | Ambos os `git diff --name-only` direcionados sem saída; nenhuma geração ou aplicação de migration. |

### RC1-G — integrações isoladas e compatibilidade de upgrade

| Verificação | Exit | Resultado | Duração | Evidência |
|---|---:|---|---:|---|
| Baseline Git | 0 | PASS | — | `main`, HEAD `47c41f00648ff9d6bc0649e1c07a37ae03130858`, `origin/main` no mesmo SHA (0 à frente/0 atrás), worktree e `git diff --check` limpos; nenhum diff em runtime, integrações, manifests ou lockfile. O contexto inicial dizia três commits à frente, mas o ref local observado no início e no fim já estava alinhado; nenhum fetch ou push foi executado. |
| Banco HTTP | 0 | PASS | — | Guard confirmou `rc1g_http` em `127.0.0.1:55432`, sem `supabase`, `amazonaws`, `heroku` ou `pooler`. |
| Integração HTTP | 1 | **BLOCKER** | 86 s; Jest 74,826 s | 14 suítes / 170 testes: 10 suítes e 158 testes passaram; 4 suítes e 12 testes falharam. Falhas: 5 em `stripe-webhook-order-creation`, 2 em `cart-checkout-store`, 4 em `stripe-webhook-store` e 1 em `sentry`. |
| Migration HTTP | — | NOT RUN | — | As falhas eram de contrato/mocks, não ausência de schema; nenhuma migration e nenhuma repetição foram executadas. |
| Banco modules | 0 | PASS | — | Guard confirmou `rc1g_modules` em `127.0.0.1:55432`; banco independente do HTTP. |
| Integração modules | 1 | **BLOCKER** | 37 s; Jest 34,551 s | 29 suítes / 454 testes: 28 suítes e todos os 454 testes passaram; `fixtures/payment-start-cart.ts` foi coletado como suíte e falhou por não conter testes. |
| Migration modules | — | NOT RUN | — | A falha era descoberta indevida de fixture, não ausência de schema; nenhuma migration e nenhuma repetição foram executadas. |
| Runtime anterior | 0 | PASS | `npm ci` 232 s; migration 64 s | Worktree detached em `a729e65`; 1.497 pacotes instalados; migrations aplicadas somente em `rc1g_upgrade`. Schema resultante: 152 tabelas. |
| Snapshot anterior | 0 | PASS | — | `link_module_migrations=23`, `mikro_orm_migrations=175`, `script_migrations=5`. |
| Runtime atual no schema anterior | 0 | PASS | 40 s | Todos os módulos reportaram banco atualizado; `analytics_event_log`, `email_delivery_log`, `gelato_fulfillment` e `tracking_access_token` foram reconhecidos sem reaplicar migrations. Nenhum conflito de tabela ou DDL de projeto foi observado. |
| Snapshot posterior | 0 | PASS | — | 152 tabelas; contadores 23/175/5 inalterados; zero duplicatas por `table_name`, `name` e `script_name`. |
| Bootstrap atual | — | PASS | 128 s até encerramento | `Server is ready on port: 9011`; nenhum erro de módulo, registro duplicado ou migration. O `.env` carregou Redis somente em localhost; Stripe real permaneceu desabilitado e não havia PostHog, Resend ou Gelato configurados. Processo encerrado manualmente após a prova. |
| AJV/ESLint | 0 | PASS | AJV 5 s | Rushstack AJV 8.20.0 `overridden`; ESLint/eslintrc AJV 6.15.0; ESLint v9.39.4. |
| Lint | 0 | PASS | 4 s | 0 erros e 208 warnings. |
| Build | 0 | PASS | 26 s | Backend build concluído com sucesso. |
| Limpeza | 0 | PASS | — | O trap de segurança removeu worktree/container ao encerrar o smoke; a limpeza final confirmou container ausente, somente o worktree principal listado, checkout limpo e `git diff --check` exit 0 antes dos documentos. |

As migrations foram aplicadas exclusivamente em `rc1g_upgrade`. Os bancos `rc1g_http` e `rc1g_modules` permaneceram sem migration porque suas falhas não eram de schema. Nenhuma URL ou senha foi registrada.

### RC1-H — recuperação das suítes de integração

Baseline: `main` em `47c41f00648ff9d6bc0649e1c07a37ae03130858`, igual ao `origin/main` observado, `git diff --check` limpo e somente os quatro documentos RC1 previamente modificados. Não havia diff em runtime, integrações, Jest, manifests ou lockfile antes das correções.

#### Descoberta modules antes/depois

| Verificação | Antes | Depois | Resultado |
|---|---:|---:|---|
| Arquivos em `src/modules/**/__tests__/**` | 29 | 29 | 28 specs legítimas e 1 fixture. |
| Jest `--listTests` | 29 | 28 | Somente `fixtures/payment-start-cart.ts` saiu. |
| Specs legítimas | 28 | 28 | Nenhuma suíte real desapareceu. |
| Padrão | `**/*.[jt]s` | `**/*.spec.[jt]s` | Não foi necessário `testPathIgnorePatterns`. |

O arquivo Sentry descoberto foi `integration-tests/http/sentry.spec.ts`.

#### Diagnóstico das 12 falhas HTTP do RC1-G/primeira repetição RC1-H

| # | Arquivo e teste | Erro / esperado / recebido sanitizado | Primeiro frame do projeto | Contrato e causa comprovada | Classificação |
|---:|---|---|---|---|---|
| 1 | `stripe-webhook-order-creation.spec.ts` — `EmailDeliveryLog local e gravado depois de purchase_completed sem chamar Resend` | assertion; comprimento 1; recebeu `[]` | spec:1873 | Phase 08 criou o enqueue; o hardening `864cb5d` passou a exigir três envs completos, mas o teste isolava apenas `SUPPORT_EMAIL`. | `ENVIRONMENT_ISOLATION` |
| 2 | mesmo arquivo — `email recovery cria EmailDeliveryLog ausente...` | assertion; comprimento 1; recebeu `[]` | spec:1993 | Mesmo gate de configuração incompleto no cenário de recovery. | `ENVIRONMENT_ISOLATION` |
| 3 | mesmo arquivo — `Resend indisponivel does not block Order...` | assertion; `recorded`; recebeu `undefined` | spec:2070 | O log local não foi criado porque o próprio teste deixou o provider incompleto; o client do teste já era injetado e não fazia rede. | `ENVIRONMENT_ISOLATION` |
| 4 | mesmo arquivo — `accepted Order path cria Order e logs locais...` | assertion; `recorded`; recebeu `undefined` | spec:2328 | O gate Phase 09 depende do log local de email; a configuração do teste não satisfazia o contrato aprovado. | `ENVIRONMENT_ISOLATION` |
| 5 | mesmo arquivo — `quando EmailDeliveryLog sent existe em recovery/replay...` | assertion; comprimento 1; recebeu `[]` | spec:2474 | Sem provider local habilitado, o entrypoint não reutilizava o email `sent` e o gate Gelato permanecia fechado. | `ENVIRONMENT_ISOLATION` |
| 6 | `cart-checkout-store.spec.ts` — `nao registra handlers de webhook nas rotas... Phase 03` | assertion; 0 rotas; recebeu somente `/hooks/stripe` | spec:1135 | A assertion da Phase 03 passou a inspecionar todas as rotas; a Phase 05 adicionou legitimamente o hook global sem colocá-lo nas rotas de cart/checkout. | `STALE_TEST_EXPECTATION` |
| 7 | mesmo arquivo — `mantem grep estatico limpo...` | assertion regex negativa; recebeu rota card/uso puro de fingerprint `PaymentAttempt` | spec:1151 | A varredura recursiva da Phase 03 passou a incluir iniciação Phase 04 e, depois do primeiro ajuste, o fingerprint puro de invalidação; nenhum fluxo criava Order no checkout. | `STALE_TEST_EXPECTATION` |
| 8 | `stripe-webhook-store.spec.ts` — `payment_intent.succeeded confirma exatamente uma tentativa` | assertion; `processed`; recebeu `failed` | spec:271 | O mock Phase 05 não injetava o entrypoint terminal obrigatório desde Phase 06; o runtime tentou resolver `analytics_event_log`. | `STALE_MOCK_OR_CONTAINER_KEY` |
| 9 | mesmo arquivo — `payment_intent deduplica replay sem duplicar mutacao` | assertion; `processed`; recebeu `failed` | spec:531 | Mesmo mock incompleto no replay. | `STALE_MOCK_OR_CONTAINER_KEY` |
| 10 | mesmo arquivo — `payment_intent com WebhookEventLog recebido...` | assertion; `processed`; recebeu `failed` | spec:595 | Mesmo mock incompleto no registro `received`. | `STALE_MOCK_OR_CONTAINER_KEY` |
| 11 | mesmo arquivo — `marca evento nao suportado como ignored...` | assertion; `ignored`; recebeu `processed` | spec:714 | `charge.refunded` deixou de ser não suportado quando a Phase 11 adicionou o fluxo informacional/idempotente de refund. | `STALE_TEST_EXPECTATION` |
| 12 | `sentry.spec.ts` — `mantem o middleware de correlacao...` | assertion; 1 rota total; recebeu 13 | spec:489 | A assertion Phase 01 congelava a contagem global; fases posteriores adicionaram rotas sem remover o middleware de correlação nem o error handler. | `STALE_TEST_EXPECTATION` |

As ocorrências dos quatro módulos foram comparadas com `analytics_event_log`, `email_delivery_log`, `gelato_fulfillment` e `tracking_access_token`. O teste de Order já importava as constants atuais; nenhuma substituição global ou alias de runtime foi aplicada. Nenhuma falha permaneceu `UNKNOWN` e nenhum `REAL_RUNTIME_DEFECT` foi comprovado.

#### Correções e resultados

| Verificação | Exit | Resultado |
|---|---:|---|
| Order dirigida | 0 | 17/17 testes PASS; env fake/local completo apenas nos cinco cenários Phase 08/09, restaurado após cada teste; zero client externo real. |
| Cart dirigida | 0 | 24/24 PASS; provas negativas restritas às superfícies pre-Order e às operações realmente proibidas. |
| Stripe store dirigida | 0 | 10/10 PASS; entrypoint terminal injetado no mock e evento não suportado trocado para `customer.created`. |
| Sentry dirigida | 0 | 12/12 PASS; middleware global localizado por matcher, sem congelar a contagem total de rotas. |
| Modules completa | 0 | 28/28 suítes e 454/454 testes PASS; fixture não coletada. |
| HTTP completa | 0 | 14/14 suítes e 170/170 testes PASS. |
| Unitários | 0 | 43/43 suítes e 676/676 testes PASS. |
| Lint | 0 | 0 erros e 208 warnings; sem aumento material. |
| Build | 0 | Backend build concluído com sucesso. |
| Schema/packages | 0 | Nenhum diff em models, migrations, `package.json` ou `package-lock.json`. |
| Limpeza | 0 | Container `ecommerce-rc1h-postgres` ausente; `/tmp/rc1-h*` removido; credenciais/URLs removidas do shell. |

Os seis bancos usados foram exclusivamente locais e descartáveis em `127.0.0.1:55433`. Nenhuma URL completa ou senha foi registrada nos documentos. Como somente Jest e testes mudaram, a prova completa de upgrade/bootstrap do RC1-G não foi repetida. Commit de testes/configuração: `e45adf9`; nenhum commit de runtime.

## Verificação estática e classificação de valores

- Nenhum segredo rastreado real foi confirmado.
- Ocorrências de `sk_live_*`, `sk_test_*`, `whsec_*`, `pi_*_secret_*` e `Bearer` foram revisadas sem imprimir valores e classificadas como canários deliberados/test fixtures curtos ou lógica de sanitização.
- DSN-like e PostHog ingestion-key-like apareceram somente em template/testes e não foram classificados automaticamente como segredo crítico.
- Nenhum `connect.sid` com valor, `pk_test_*` ou `sb_publishable_*` foi detectado.
- Chaves públicas, publishable keys, DSNs e identificadores/objetos Stripe test-mode foram classificados por finalidade antes da severidade. Nenhuma chave pessoal/administrativa foi identificada nesta trilha.

## Supabase read-only — smoke canônico

Projeto único confirmado como `ecommerce`, estado `ACTIVE_HEALTHY`. Somente `SELECT`/ferramentas de leitura foram usados; email, metadata e payload brutos não foram exibidos.

| Invariante | Resultado |
|---|---|
| PaymentAttempt | `payment_confirmed_by_webhook`, Stripe, BRL 9900, Order e PaymentIntent corretos |
| CheckoutCompletionLog | `completed`, correlações corretas, sem erro terminal |
| Order | pagamento `partially_refunded`, order status `confirmed`, não cancelada |
| `purchase_completed_count` | `1` |
| Analytics | exatamente um evento `recorded`, correlações corretas |
| RefundRequest | `confirmed`, BRL 100, correlações corretas, sem falha |
| `email_delivery_count` | `0` |
| `gelato_fulfillment_count` | `0` |
| `refund_request_count` | `1` |

Todas as invariantes de banco mantidas no escopo passaram.

## Stripe test mode read-only

- PaymentIntent canônico: `status=succeeded`, `amount=9900`, `currency=brl`.
- O conector seguro não expôs `livemode` nem `amount_received`; esses dois campos não foram comprovados.
- Refund ID foi obtido do banco, mas o objeto Refund não foi consultado porque o gate já havia parado no blocker do lint.
- Nenhuma criação, refund, replay ou outra chamada mutável foi executada.

## Auditoria de migrations

- Nove arquivos locais inventariados.
- A fonte efetiva da aplicação é `public.mikro_orm_migrations`, com 181 entradas aplicadas.
- Todos os nove arquivos locais têm entrada correspondente aplicada.
- Não foi encontrada migration local pendente.
- Os quatro arquivos com nome `TBD-*` não são drafts pendentes: estão aplicados desde 2026-07-03. A nomenclatura é uma observação documental, não uma migration esquecida.
- Nenhum DDL ou comando de migration foi executado.

## Etapas canceladas

- Etapa 4 — Produção somente leitura Heroku: cancelada/fora do escopo.
- Etapa 8 — Logs do release atual: cancelada/fora do escopo.
- Etapa 9 — Runbook de rollback: cancelada/fora do escopo.

## Classificação final

**PASS.** O RC1-H removeu somente a coleta indevida da fixture, corrigiu contratos de teste comprovadamente obsoletos e recuperou todas as suítes: modules 28/28 e 454/454, HTTP 14/14 e 170/170, unitários 43/43 e 676/676, lint 0/208 e build PASS. Não houve mudança de runtime, schema, manifest ou lockfile; todos os recursos descartáveis foram removidos. Supabase, banco remoto, providers externos, Heroku, deploy, rollback, tag, push e Phase 12 não foram acionados.
