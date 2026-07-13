---
status: passed
classification: PASS
verified_at: 2026-07-13
rc1_a_verified_at: 2026-07-10
rc1_b_checked_at: 2026-07-12
rc1_c_checked_at: 2026-07-13
rc1_e_checked_at: 2026-07-13
rc1_f_verified_at: 2026-07-13
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

**PASS.** O RC1-F corrigiu os sete erros reais sem alterar regras ESLint nem os 208 warnings. Lint, testes dirigidos, 43/43 suites unitárias, build e reprodução pós-`npm ci` passaram; a árvore AJV permaneceu válida e nenhum model/migration mudou. Docker, bancos, integrações reais, migrations, deploy, rollback, tag, push e Phase 12 não foram acionados. A tag `v1.0-backend-rc1` continua dependente de aprovação humana separada.
