---
quick_task: 260715-rel01-runtime-version
status: complete
date: 2026-07-15
scope: rel-01-runtime-version
autonomous: false
must_haves:
  truths:
    - "HEROKU_BUILD_COMMIT prevalece sobre HEROKU_SLUG_COMMIT e APP_VERSION."
    - "HEROKU_SLUG_COMMIT funciona como fallback legado e APP_VERSION continua suportando VPS/PM2."
    - "Producao falha sem nenhuma fonte valida, sem incluir valores de ambiente no erro."
    - "Health live, health ready e Sentry usam a mesma versao resolvida por env.APP_VERSION."
    - "Nenhuma chamada Heroku/externa, deploy, push, migration ou alteracao de dependencia ocorre."
  artifacts:
    - apps/backend/src/config/runtime-version.ts
    - apps/backend/src/config/env.ts
    - apps/backend/src/config/__tests__/env.unit.spec.ts
    - apps/backend/integration-tests/http/health.spec.ts
    - apps/backend/integration-tests/http/sentry.spec.ts
    - .planning/quick/260715-rel01-runtime-version/VERIFICATION.md
    - .planning/quick/260715-rel01-runtime-version/SUMMARY.md
  key_links:
    - "Metadata Heroku -> resolveRuntimeVersion -> env.APP_VERSION -> health live/ready"
    - "Metadata Heroku -> resolveRuntimeVersion -> env.APP_VERSION -> Sentry release"
    - "APP_VERSION -> resolveRuntimeVersion -> VPS/PM2 sem metadata Heroku"
---

# REL-01 — Resolver automaticamente a versão do runtime

## Limites

Executar somente a resolução canônica da versão do runtime, sua integração no parser de ambiente, as provas de health/Sentry/PM2 e a documentação mínima. Permanecem fora de escopo contratos monetários, catálogo, PaymentAttempt, Stripe, refunds, Redis, Event Bus, locking, Procfile, processos web/worker, models, migrations, providers, package/lockfile, deploy, push, tag, Heroku CLI/Labs, banco remoto e Phase 12.

## Tarefas

### 1. Implementar o resolvedor canônico e integrar ao ambiente

**Arquivos:** `apps/backend/src/config/runtime-version.ts` e `apps/backend/src/config/env.ts`.

**Ação:** criar função pura com precedência `HEROKU_BUILD_COMMIT > HEROKU_SLUG_COMMIT > APP_VERSION`, normalização segura, validação de SHA para fontes Heroku, fallback `dev` somente fora de produção e erro production sem valores. Fazer `AppEnv.APP_VERSION` carregar o valor efetivo e adicionar `APP_VERSION_SOURCE`.

**Verificação:** testes unitários comprovam precedência, fallbacks, rejeições e ausência de vazamento; nenhum endpoint ou integração lê fonte paralela.

**Done:** uma `APP_VERSION` antiga nunca prevalece sobre metadata Heroku válida e VPS/PM2 continua funcionando apenas com `APP_VERSION`.

### 2. Fixar regressões de env, health, Sentry e fixtures tipadas

**Arquivos:** testes diretamente afetados em `apps/backend/src/config`, `apps/backend/src/infrastructure/__tests__` e `apps/backend/integration-tests/http`.

**Ação:** cobrir todas as combinações e valores inválidos; provar que live e ready retornam a versão de `HEROKU_BUILD_COMMIT` quando `APP_VERSION` é antiga; provar que `createSentryInitOptions(...).release` recebe o valor resolvido; atualizar apenas fixtures `AppEnv` afetadas pelo novo campo.

**Verificação:** testes focados de env, health e Sentry passam; teste PM2 confirma `APP_VERSION: process.env.APP_VERSION` sem exigir metadata Heroku.

**Done:** health e Sentry permanecem convergentes e o contrato JSON dos endpoints não muda.

### 3. Validar e encerrar o gate

**Arquivos:** `VERIFICATION.md`, `SUMMARY.md` e `.planning/STATE.md`.

**Ação:** executar testes focados, unitários completos, HTTP health, PM2, lint e build; provar integridade e ausência de diffs proibidos; registrar a habilitação manual futura de `runtime-dyno-metadata` e `runtime-dyno-build-metadata` sem executá-la; criar somente os dois commits permitidos.

**Verificação:** todas as evidências e contagens ficam registradas; o resultado é classificado apenas como `PASS` ou `BLOCKED`.

**Done:** gate termina localmente, sem push/deploy/chamada externa, com divergência final contra `origin/main` reportada e Phase 12 ainda bloqueada.
