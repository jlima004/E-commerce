---
status: blocked
classification: BLOCKED
completed_at: 2026-07-10
rc1_a_completed_at: 2026-07-10
phase_12_status: not-planned-not-started-blocked
scope_revision: heroku-excluded
---

# Resumo — Gate de estabilização Backend RC1

## Resultado

**BLOCKED.** O Gate RC1-A reconstruiu `node_modules` exclusivamente com `npm ci --include=dev` (exit 0), sem alterar arquivos versionados. `eslint@9.39.4` e `@medusajs/eslint-plugin@2.16.0` foram resolvidos, porém o carregamento do ESLint continuou falhando por incompatibilidade de toolchain AJV; `medusa lint` reportou `eslint` como indisponível e encerrou com código 1. Pela regra de parada, build, Docker/Postgres e ambas as integrações não foram executados.

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
- Unit: PASS — 43/43 suites, 673/673 testes.
- Integrações HTTP/modules: BLOCKED / NOT RUN; o RC1-A não iniciou Docker porque o lint falhou antes da etapa de banco descartável.
- Lint: BLOCKER, exit 1; após `npm ci`, o binário existe, mas falha ao carregar AJV e o Medusa o classifica como indisponível.
- Build: NOT RUN após o blocker.
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

Nenhuma tag, migration, `db:migrate:safe`, DDL, escrita/mutação no Supabase, criação de PaymentIntent, refund, webhook replay, chamada Gelato/Resend/PostHog, acesso Heroku, deploy, rollback, alteração de config, correção de lint, alteração em runtime/package/lockfile, Docker/Postgres ou chamada a banco remoto foi executada. A única mutação local permitida foi remover e reconstruir `node_modules` com o lockfile.

## Próximo gate permitido

Corrigir a compatibilidade da toolchain ESLint/AJV em outro gate autorizado, sem inferir alteração de dependências neste registro. Depois, repetir desde o lint; somente com lint PASS criar Postgres Docker descartável e executar build e integrações. A Phase 12 continua não planejada, não iniciada e bloqueada.
