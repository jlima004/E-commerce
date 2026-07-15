---
quick_task: 260715-rel01-runtime-version
status: passed
date: 2026-07-15
code_commit: f1d4d39
---

# REL-01 — Verificação

## Resultado

**PASS.** A versão efetiva é resolvida uma única vez por `parseEnv`, com precedência `HEROKU_BUILD_COMMIT > HEROKU_SLUG_COMMIT > APP_VERSION`; `dev` existe somente como fallback fora de produção. Health live, health ready e Sentry continuam consumindo exclusivamente `env.APP_VERSION`.

## Baseline

| Prova | Resultado |
|---|---|
| Branch | `main` |
| HEAD inicial | `1b134833e77519c4f8486a81ea943119bad0b8ac` |
| Worktree inicial | limpo |
| `git diff --check` | PASS |
| `git fetch origin` | PASS |
| `origin/main...HEAD` inicial | `0 0` |

## Contrato verificado

- `HEROKU_BUILD_COMMIT` válido (SHA hexadecimal de 7 a 40 caracteres) vence `HEROKU_SLUG_COMMIT` e uma `APP_VERSION` antiga.
- `HEROKU_SLUG_COMMIT` válido funciona como fallback legado e vence `APP_VERSION`.
- `APP_VERSION` aceita identificadores não-SHA para VPS/PM2, incluindo tag e versão composta.
- Cada candidato é submetido a `trim`; vazio, whitespace, `null` e `undefined` literais são rejeitados.
- `dev` e `unknown` são rejeitados em produção.
- Fonte Heroku inválida cai para a próxima fonte válida.
- Produção sem fonte válida falha com a mensagem fixa `Missing required runtime version: HEROKU_BUILD_COMMIT, HEROKU_SLUG_COMMIT or APP_VERSION`.
- A mensagem de erro não contém SHA, versão canário nem qualquer valor de ambiente rejeitado.
- Fora de produção, ausência de todas as fontes retorna `APP_VERSION=dev` e `APP_VERSION_SOURCE=development_default`.

## Validações executadas

| Validação | Resultado |
|---|---|
| Env focado — `src/config/__tests__/env.unit.spec.ts` | PASS — 1/1 suíte, 53/53 testes |
| Health HTTP focado — `integration-tests/http/health.spec.ts` | PASS — 1/1 suíte, 9/9 testes |
| Sentry focado — `integration-tests/http/sentry.spec.ts` | PASS — 1/1 suíte, 13/13 testes |
| PM2 — `node --test ops/tests/pm2-config.test.mjs` | PASS — 1/1 suíte, 6/6 testes |
| Unit completo — `npm run test:unit -w @dtc/backend` | PASS — 44/44 suítes, 730/730 testes |
| Lint — `npm run lint -w @dtc/backend` | PASS — 0 erros, 208 warnings; baseline preservado |
| Build — `npm run build -w @dtc/backend` | PASS — exit 0 |
| `git diff --check` | PASS |

O teste HTTP focado usa doubles locais e não exigiu PostgreSQL. Nenhum banco local ou remoto foi iniciado, e Supabase não foi acessado.

## Health e Sentry

- `/health/live`: mantém o contrato JSON existente e retorna o `HEROKU_BUILD_COMMIT` resolvido em `version` quando ele coexiste com `APP_VERSION` antiga.
- `/health/ready`: mantém o contrato JSON existente e retorna exatamente a mesma versão resolvida.
- `createSentryInitOptions(env).release`: recebe exatamente a mesma versão resolvida.
- Nenhum endpoint expõe `APP_VERSION_SOURCE`, metadata Heroku, app name, dyno ID, release description ou config vars adicionais.

## PM2/VPS e Heroku

- `ops/pm2/ecosystem.config.cjs` permaneceu inalterado e continua repassando somente `APP_VERSION: process.env.APP_VERSION`.
- VPS/PM2 não exige `HEROKU_BUILD_COMMIT` nem `HEROKU_SLUG_COMMIT`.
- No Heroku, metadata válida prevalece sobre `APP_VERSION` antiga.
- A disponibilização automática da metadata exige habilitação manual posterior de `runtime-dyno-metadata` e `runtime-dyno-build-metadata`; nenhum comando de habilitação foi executado neste gate.

## Integridade e provas negativas

Arquivos de runtime/testes no commit `f1d4d39`:

- `apps/backend/src/config/runtime-version.ts`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/config/__tests__/env.unit.spec.ts`
- `apps/backend/integration-tests/http/health.spec.ts`
- `apps/backend/integration-tests/http/sentry.spec.ts`

Não houve alteração em models, migrations, `package.json`, `package-lock.json`, `Procfile`, `ops/pm2/ecosystem.config.cjs`, processos web/worker, contratos monetários, catálogo, PaymentAttempt, Stripe, refunds, Redis, Event Bus, locking ou providers. Não houve Git em runtime, subprocesso Git, Heroku API/CLI, Heroku Labs, deploy, push, tag, Supabase, banco remoto ou chamada externa. Phase 12 permanece não planejada, não iniciada e bloqueada.
