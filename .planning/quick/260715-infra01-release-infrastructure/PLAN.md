---
quick_task: 260715-infra01-release-infrastructure
phase: quick-260715-infra01-release-infrastructure
plan: 01
status: blocked
date: 2026-07-15
scope: infra-01-release-infrastructure
type: execute
wave: 1
depends_on: []
autonomous: false
requirements:
  - INFRA-01
files_modified:
  - apps/backend/scripts/run-migrations.mjs
  - apps/backend/medusa-config.ts
  - apps/backend/src/infrastructure/release-migration-mode.ts
  - apps/backend/src/infrastructure/redis-config.ts
  - apps/backend/src/infrastructure/infrastructure-mode.ts
  - apps/backend/src/infrastructure/__tests__/run-migrations.unit.spec.ts
  - apps/backend/src/infrastructure/__tests__/release-migration-mode.unit.spec.ts
  - apps/backend/src/infrastructure/__tests__/infrastructure-mode.unit.spec.ts
  - apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts
  - apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
  - apps/backend/src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts
  - apps/backend/src/jobs/__tests__/email-resend-relay.unit.spec.ts
  - apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts
  - apps/backend/src/modules/payment-attempt/__tests__/stripe-real-initiation-loader.unit.spec.ts
  - .planning/quick/260715-infra01-release-infrastructure/VERIFICATION.md
  - .planning/quick/260715-infra01-release-infrastructure/SUMMARY.md
  - .planning/STATE.md
must_haves:
  truths:
    - "O release dyno executa migrations em modo DB-only, sem registrar cache, locking, event bus ou workflow engine Redis e sem executar loaders ou jobs operacionais."
    - "O modo de migration existe somente no ambiente filho criado por run-migrations.mjs e uma tentativa de usá-lo sem a marca interna do script falha antes de iniciar um runtime permanente."
    - "Web e worker em producao registram exatamente os quatro modulos Redis, usam os providers Redis esperados e nao aceitam fallback local ou in-memory."
    - "Producao normal falha com mensagem sanitizada quando qualquer contrato Redis falta ou quando o cache Redis seria desabilitado."
    - "Um unico log estruturado e sanitizado identifica release_migration_db_only antes dos avisos do framework, que permanecem visiveis e sem reclassificacao ampla."
    - "Desenvolvimento sem Redis continua opcional e desenvolvimento com os quatro contratos registra Redis de forma deterministica."
    - "Fixtures finais de WORKER_MODE=server e WORKER_MODE=worker provam a mesma infraestrutura Redis obrigatoria, enquanto o valor textual false nunca ativa migration mode."
    - "Erros e logs de infraestrutura nao expoem esquemas Redis, username, password ou host canario, mesmo quando os inputs sinteticos contem esses valores."
    - "A protecao historica contra excesso de conexoes no release e preservada sem alterar contratos comerciais, financeiros, models, migrations, manifests, lockfile ou providers externos."
  artifacts:
    - path: apps/backend/src/infrastructure/infrastructure-mode.ts
      provides: "Classificacao pura e sanitizada de release_migration_db_only, production_redis e local_optional."
    - path: apps/backend/scripts/run-migrations.mjs
      provides: "Ambiente filho isolado e log DB-only anterior ao comando Medusa."
    - path: apps/backend/medusa-config.ts
      provides: "Montagem final com assertion fail-fast para o runtime Redis de producao."
    - path: apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
      provides: "Prova da configuracao final exportada, alem dos testes do builder Redis."
    - path: .planning/quick/260715-infra01-release-infrastructure/VERIFICATION.md
      provides: "Evidencias locais, matriz de processos, classificacao PASS ou BLOCKED e manual gate."
    - path: .planning/quick/260715-infra01-release-infrastructure/SUMMARY.md
      provides: "Encerramento factual do quick task sem alegar uso de Redis pelo release."
  key_links:
    - "Procfile release -> run-migrations.mjs -> childEnv com duas marcas internas -> medusa db:migrate -> configuracao DB-only."
    - "Procfile web/worker -> ausencia das marcas de migration -> medusa-config.ts -> projectConfig.redisUrl + quatro modulos Redis."
    - "medusa-config.ts -> infrastructure-mode.ts/redis-config.ts -> assertion sanitizada antes de aceitar a configuracao de producao."
    - "log DB-only do script -> avisos exatos do framework -> evidencia de fallback esperado restrito ao processo de migration."
---

# INFRA-01 — Classificar e endurecer o modo de infraestrutura do release

## Objetivo

Classificar e provar a separacao entre o release migration-only DB-only e os processos permanentes Redis-backed; endurecer o isolamento da flag, a montagem final da configuracao e a observabilidade; preservar a mitigacao de conexoes do release sem esconder avisos reais nem alterar comportamento comercial ou financeiro.

## Contexto confirmado na auditoria de planejamento

- Baseline recebido do orquestrador: `main`, HEAD `12dea994f81c4713ceaa68c2352de3e2956e412d`, worktree limpo, `git diff --check` limpo e `origin/main...HEAD = 0 0` apos fetch.
- `Procfile` define a flag em nenhum processo permanente; `web` e `worker` definem apenas `WORKER_MODE`, enquanto `release` chama `npm run db:migrate:safe`.
- `run-migrations.mjs` atualmente faz mutacao no `process.env` do processo chamador durante o carregamento e volta a definir a flag no `childEnv`; o plano deve remover a primeira mutacao e manter o contrato somente no filho.
- `medusa-config.ts` atualmente omite `projectConfig.redisUrl` e todos os descritores Redis quando o helper informa migration mode; em producao normal ele consome `resolveProjectRedisUrl(env)` e `buildRedisModules(env)`.
- `redis-config.ts` ja conhece os quatro descritores e os providers corretos, mas `REDIS_CACHE_PROVIDER_DISABLED=true` ainda permite apenas tres modulos em producao e `assertNoInMemoryInfrastructure` ainda nao protege a configuracao final montada.
- Os tres jobs relay e o loader de iniciacao Stripe retornam antes de qualquer trabalho quando migration mode esta ativo, mas faltam regressoes comportamentais diretas desses entrypoints.
- A mitigacao historica foi criada apos `ECONNRESET`, `Connection is closed` e `MaxRetriesPerRequestError` no release v40, sob limite Redis Mini de 20 conexoes; migrations estavam atualizadas e o runtime continuava com Postgres/Redis `up`.
- Origem exata dos avisos: `@medusajs/framework/dist/config/config.js` usa `customLogger.log` para a ausencia de `projectConfig.redisUrl`; `@medusajs/event-bus-local/dist/loaders/index.js` usa `logger.warn`; `@medusajs/locking/dist/loaders/providers.js` usa `logger.info` ao selecionar dinamicamente o provider default `in-memory`.

## Matriz obrigatoria de classificacao

| Processo | Migration mode | Redis projectConfig | Cache | Locking | Events | Workflow |
|---|---:|---:|---:|---:|---:|---:|
| release | true, com marca interna do filho | omitido | omitido | omitido | omitido | omitido |
| web | false | obrigatorio | Redis | Redis | Redis | Redis |
| worker | false | obrigatorio | Redis | Redis | Redis | Redis |
| local sem Redis | false | opcional | local | local | local | local |

Qualquer evidencia de fallback em `web` ou `worker`, de migration mode sem a marca privada do filho, ou de runtime de producao aceitando apenas tres modulos deve classificar o gate como `BLOCKED`.

## Limites

Nao executar `heroku config`, nao imprimir config vars ou URLs Redis, nao alterar config vars/Redis provisionado, nao executar migration em producao, nao fazer deploy/push/tag, nao acessar Supabase e nao chamar Stripe, Gelato, Resend ou PostHog. Nao alterar models, migrations, packages/lockfile, pagamentos, refunds, Orders, unidades monetarias, catalogo, `APP_VERSION`, metadata Heroku ou Phase 12. Nao mudar `NODE_ENV`, reduzir logs, remover fail-fast, reativar Redis no release, nem filtrar genericamente mensagens de Redis/fallback.

## Justificativa da superficie

A superficie e maior que uma quick task comum porque o gate exige provas independentes no script ESM, helper de modo, builder Redis, configuracao final, tres entrypoints de jobs e loader. As alteracoes de producao ficam limitadas a cinco arquivos de infraestrutura/configuracao; nove arquivos sao testes diretamente necessarios para provar isolamento, montagem final, no-op operacional e sanitizacao, e os tres restantes sao os artefatos documentais obrigatorios. Nao ha expansao para dominios comerciais, models, migrations ou dependencias.

## Tarefas

<tasks>

<task type="auto" tdd="true">
  <name>Tarefa 1: Isolar e identificar explicitamente o processo filho de migrations</name>

  <files>apps/backend/scripts/run-migrations.mjs, apps/backend/src/infrastructure/release-migration-mode.ts, apps/backend/src/infrastructure/infrastructure-mode.ts, apps/backend/src/infrastructure/__tests__/run-migrations.unit.spec.ts, apps/backend/src/infrastructure/__tests__/release-migration-mode.unit.spec.ts, apps/backend/src/infrastructure/__tests__/infrastructure-mode.unit.spec.ts, apps/backend/src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts, apps/backend/src/jobs/__tests__/email-resend-relay.unit.spec.ts, apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts, apps/backend/src/modules/payment-attempt/__tests__/stripe-real-initiation-loader.unit.spec.ts</files>

  <behavior>
    - A construcao do childEnv define as duas marcas sem alterar o objeto fonte ou process.env.
    - A flag primaria sem a marca interna e recusada com erro sanitizado.
    - WORKER_MODE=server e WORKER_MODE=worker com a flag primaria true, mas sem a marca interna, sao recusados antes da configuracao permanente.
    - Os valores ausente e false da flag nao ativam migration mode; true com as duas marcas ativa o modo de forma deterministica inclusive localmente.
    - Check-only devolve o childEnv controlado sem executar o subprocesso.
    - Jobs e loader retornam antes de resolver dependencias ou emitir logs operacionais.
    - O registro DB-only e emitido uma vez, antes do spawn, sem valores de infraestrutura.
    - Log e erros permanecem sem redis://, rediss://, username, password e host canario fornecidos por fixtures sinteticas.
  </behavior>

  <action>Remover a mutacao top-level de `process.env.DTC_RELEASE_MIGRATION_MODE` e fazer `buildMigrationChildEnv` produzir uma copia que define tanto `DTC_RELEASE_MIGRATION_MODE=true` quanto uma segunda marca interna, nao secreta e exclusiva do script. Fazer `isReleaseMigrationMode(input)` aceitar o modo somente quando ambas as marcas estiverem presentes; flag primaria isolada deve lancar erro sanitizado de vazamento de runtime tanto em fixture `WORKER_MODE=server` quanto `WORKER_MODE=worker`, enquanto o valor textual `false` deve equivaler a flag ausente. Implementar helper puro `describeInfrastructureMode(input)` com os tipos `release_migration_db_only | production_redis | local_optional` e o estado dos modulos `enabled | intentionally_omitted | optional`, usando apenas `NODE_ENV`, as duas marcas e presenca booleana dos quatro contratos, sem retornar valores. Antes do `spawnSync`, emitir exatamente uma linha JSON com `operation=release_migration.infrastructure_mode`, `mode=release_migration_db_only`, `redis_runtime_modules=intentionally_omitted` e `operational_jobs=disabled`; nao carregar logger Medusa nem tocar Redis. Preservar `--check-only` sem spawn e com o mesmo `childEnv`. Cobrir que o objeto fonte e o `process.env` do teste nao mudam, que migrations usam a copia controlada, que jobs/loaders retornam sem resolver container, criar clientes ou escrever logs operacionais, e que nenhum erro/log replica os valores canario de esquema, identidade, credencial ou host.</action>

  <verify>
    <automated>TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/infrastructure/__tests__/run-migrations.unit.spec.ts src/infrastructure/__tests__/release-migration-mode.unit.spec.ts src/infrastructure/__tests__/infrastructure-mode.unit.spec.ts src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts src/jobs/__tests__/email-resend-relay.unit.spec.ts src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts src/modules/payment-attempt/__tests__/stripe-real-initiation-loader.unit.spec.ts</automated>
  </verify>

  <done>A unica configuracao que autoriza DB-only e o filho criado por `run-migrations.mjs`; nenhum processo chamador ou permanente recebe a flag por mutacao global, e o modo e observavel antes dos avisos do framework.</done>
</task>

<task type="auto" tdd="true">
  <name>Tarefa 2: Fechar a montagem Redis do runtime permanente e testar a configuracao final</name>

  <files>apps/backend/src/infrastructure/redis-config.ts, apps/backend/medusa-config.ts, apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts, apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts</files>

  <behavior>
    - Producao normal monta projectConfig.redisUrl, quatro modulos e os providers Redis esperados nas fixtures server e worker.
    - Qualquer contrato ausente, cache desabilitado ou resolve de fallback causa erro sanitizado.
    - Release migration valido omite projectConfig.redisUrl e os quatro modulos.
    - Local sem Redis permanece opcional e local completo monta os quatro modulos.
    - Valores canario contendo redis://, rediss://, username, password e host sintetico nunca aparecem nas mensagens de falha.
  </behavior>

  <action>Montar `redisModules` uma unica vez e adicionar assertion de infraestrutura sobre a configuracao final antes de exporta-la. Em `NODE_ENV=production` sem migration mode valido, exigir `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL` e `WE_REDIS_URL`, `projectConfig.redisUrl`, os quatro resolves Redis e os providers `@medusajs/caching-redis` e `@medusajs/medusa/locking-redis`; recusar o escape `REDIS_CACHE_PROVIDER_DISABLED=true`, qualquer resolve local/in-memory e qualquer conjunto parcial com `Production Redis infrastructure is incomplete`, citando no maximo nomes ausentes e nunca valores. Migration mode valido continua retornando lista vazia e omitindo `projectConfig.redisUrl`; local sem contratos continua opcional e local com contratos completos registra os quatro modulos de forma deterministica. Criar teste que carrega a exportacao final de `medusa-config.ts` sob fixtures de producao `WORKER_MODE=server` e `WORKER_MODE=worker`, em isolamento de modulos, e inspeciona `projectConfig` e `modules`; nao limitar a prova a `buildRedisModules`. Exercitar falhas com canarios distintos para os quatro contratos e provar ausencia literal dos esquemas, identidade, credencial e host nas mensagens. Nao alterar `medusa-logger.ts`: manter os tres avisos originais e usar o log da Tarefa 1 como contexto; somente se uma reproducao demonstrar impossibilidade concreta, parar como `BLOCKED` antes de qualquer reclassificacao.</action>

  <verify>
    <automated>TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/infrastructure/__tests__/redis-config.unit.spec.ts src/infrastructure/__tests__/medusa-config.unit.spec.ts</automated>
  </verify>

  <done>A configuracao final do web/worker nao consegue iniciar com Redis incompleto ou fallback, enquanto o release continua sem abrir conexoes Redis e o desenvolvimento local preserva seu comportamento opcional.</done>
</task>

<task type="auto">
  <name>Tarefa 3: Reproduzir localmente, executar todos os gates e encerrar documentacao/commits</name>

  <files>.planning/quick/260715-infra01-release-infrastructure/VERIFICATION.md, .planning/quick/260715-infra01-release-infrastructure/SUMMARY.md, .planning/STATE.md</files>

  <action>Criar PostgreSQL 16 e Redis descartaveis com portas publicadas exclusivamente em loopback e armazenamento temporario, registrando PIDs/nomes e instalando `trap` de cleanup antes de iniciar qualquer processo. Construir cada comando de migration, teste, health e runtime com `env -i`: permitir somente `PATH`, HOME/TMPDIR temporarios, variaveis locais indispensaveis e segredos sinteticos; nao herdar o ambiente chamador nem carregar endpoints remotos. Antes de cada spawn, validar sem imprimir valores que os hosts de `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL` e `WE_REDIS_URL` pertencem a `localhost`, `127.0.0.1` ou `::1`. No filho, sombrear explicitamente chaves/endpoints de Stripe, Gelato, Resend, PostHog e storage com vazio e manter `STRIPE_REAL_INITIATION_ENABLED=false`, `GELATO_DISPATCH_ENABLED=false` e `RESEND_ORDER_CONFIRMATION_ENABLED=false`, impedindo que `loadEnv` recupere valores de arquivos locais; a allowlist deve falhar antes do spawn se surgir variavel nao aprovada. Executar `db:migrate:safe` somente contra o banco local, sem contratos Redis, e provar exit zero, log DB-only anterior aos tres avisos, ausencia de loaders/jobs e nenhuma construcao de cliente externo. Depois iniciar `WORKER_MODE=server` com `DTC_RELEASE_MIGRATION_MODE=false` e os quatro contratos apontando ao Redis local, provar cache/locking/events/workflow sem aviso de fallback e consultar apenas o `/health/ready` local, exigindo Postgres e Redis `up`. Encerrar o runtime pelo PID registrado, remover containers/recursos temporarios no caminho de sucesso ou falha e provar que nada INFRA-01 permaneceu. Executar todos os gates automatizados abaixo, confirmar nenhuma diferenca em models/migrations/manifests/lockfile/payments/refunds/catalog/money/APP_VERSION/Heroku/providers/Phase 12 e registrar os 20 itens do manual gate. Atualizar o `STATE.md` apenas no encerramento. Classificar exclusivamente `PASS` ou `BLOCKED`; criar os dois commits permitidos somente apos PASS, primeiro runtime/testes e depois documentacao, sem push.</action>

  <verify>
    <automated>
Todos os comandos de migration, runtime e testes que carregam a aplicacao devem ser executados pelo launcher `env -i`/allowlist e pelo preflight loopback descritos na acao; os comandos abaixo sao os gates internos passados ao launcher.

Focused unit: `TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/infrastructure/__tests__/run-migrations.unit.spec.ts src/infrastructure/__tests__/release-migration-mode.unit.spec.ts src/infrastructure/__tests__/infrastructure-mode.unit.spec.ts src/infrastructure/__tests__/redis-config.unit.spec.ts src/infrastructure/__tests__/medusa-config.unit.spec.ts src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts src/jobs/__tests__/email-resend-relay.unit.spec.ts src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts src/modules/payment-attempt/__tests__/stripe-real-initiation-loader.unit.spec.ts`

Focused health local: `TMPDIR=/tmp npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/health.spec.ts`

Unit completo: `TMPDIR=/tmp npm run test:unit -w @dtc/backend`

Modules local: `TMPDIR=/tmp npm run test:integration:modules -w @dtc/backend`

HTTP local: `TMPDIR=/tmp npm run test:integration:http -w @dtc/backend`

Lint: `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run lint -w @dtc/backend`

Build: `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend`

Integridade: `git diff --check`; `git status --short`; `git diff --stat`; `git diff --name-only`; `git diff --exit-code -- package.json package-lock.json apps/backend/package.json apps/backend/src/modules/*/models apps/backend/src/modules/*/migrations`

Cleanup: o `trap` executa `kill "$INFRA01_RUNTIME_PID"`, `docker rm -f "$INFRA01_POSTGRES_CONTAINER" "$INFRA01_REDIS_CONTAINER"` e remove qualquer recurso temporario nomeado; depois `docker ps -a --filter name=infra01- --format '{{.ID}}'` e `docker volume ls --filter name=infra01- --format '{{.Name}}'` devem ficar vazios, e `! kill -0 "$INFRA01_RUNTIME_PID"` deve confirmar o processo encerrado.

Divergencia: `git fetch origin`; `git rev-list --left-right --count origin/main...HEAD` deve reportar zero commits somente no lado de `origin/main`, preservando os dois commits locais permitidos no lado de HEAD.
    </automated>
    <human-check>Revisar os 20 itens do manual gate e aceitar somente uma classificacao PASS ou BLOCKED.</human-check>
  </verify>

  <done>`VERIFICATION.md` e `SUMMARY.md` distinguem claramente release DB-only de web/worker Redis, documentam avisos contextualizados sem dizer que foram eliminados, trazem todas as contagens e nao-acoes, e os dois commits locais existem sem deploy, push, tag ou chamada externa.</done>
</task>

</tasks>

## Verificacao global e classificacao

`PASS` exige simultaneamente: fallbacks observados somente no release; log DB-only sanitizado; flag restrita ao filho; web e worker com quatro modulos Redis e sem fallback; fail-fast sanitizado; health Redis preservado; migrations locais, testes focados, unitarios completos, modules, HTTP, lint e build verdes; cleanup concluido; zero diff proibido. A evidencia read-only de logs/release pode ser usada, mas nao pode consultar config vars nem imprimir valores.

`BLOCKED` e obrigatorio se qualquer processo permanente usar fallback, a flag puder alcancar runtime sem marca interna, cache puder ser omitido em producao, uma falha Redis cair silenciosamente para local/in-memory, um warning for escondido por filtro amplo, um log expuser valor sensivel, um gate falhar, a reproducao exigir Redis no release ou a mitigacao de 20 conexoes deixar de ser preservada. Nao usar `PASS WITH KNOWN DEBTS`.

## Manual gate obrigatorio

O relatorio final deve enumerar: (1) origem exata dos tres warnings; (2) processos onde aparecem; (3) causa historica do redis-lite; (4) matriz release/web/worker/local; (5) mudancas do script; (6) log estruturado; (7) tratamento dos warnings; (8) fail-fast normal; (9) protecao da flag; (10) testes focados; (11) unitarios completos; (12) modules; (13) HTTP; (14) lint; (15) build; (16) ausencia de diff proibido; (17) arquivos alterados; (18) commits; (19) divergencia com `origin/main`; (20) confirmacao de que Heroku config/deploy, providers, Supabase e Phase 12 nao foram acionados.

## Saida

Criar `.planning/quick/260715-infra01-release-infrastructure/VERIFICATION.md` e `SUMMARY.md`, atualizar `.planning/STATE.md` e parar no manual gate. Nao iniciar Phase 12 nem executar qualquer acao remota mutavel.
