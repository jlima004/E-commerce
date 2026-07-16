---
quick_task: 260715-infra01-release-infrastructure
status: complete
verified: 2026-07-16T16:30:00-03:00
classification: PASS
---

# INFRA-01 — Verificação

## Classificação

**PASS.** O release dyno fica classificado como migration-only DB-only; web/worker/produção normal exigem infraestrutura Redis completa com fail-fast sanitizado. CACHE-01A e CACHE-01B fecharam a precondição operacional do provider de cache. Os gates locais completos passaram após a correção TypeScript do default de `shouldWireRedisCachingProvider` e as quatro supressões locais de `@medusajs/use-medusa-error-not-generic-error` nos validadores de startup (não fronteiras HTTP).

## Resultados finais

| Gate | Resultado |
|---|---|
| Unit | 49/49, 766/766 |
| Modules | 29/29, 463/463 |
| HTTP | 14/14, 172/172 |
| Lint | 0 erros, 207 warnings |
| Build | PASS |
| CACHE-01A | PASS |
| CACHE-01B | PASS |
| INFRA-01 | PASS |

## Origem exata dos warnings históricos

| Mensagem | Origem instalada | Método |
|---|---|---|
| `redisUrl not found. A fake redis instance will be used.` | `node_modules/@medusajs/framework/dist/config/config.js:104` | `customLogger.log` |
| `Local Event Bus installed. This is not recommended for production.` | `node_modules/@medusajs/event-bus-local/dist/loaders/index.js:4` | `logger.warn` |
| `Locking module: Using "in-memory" as default.` | `node_modules/@medusajs/locking/dist/loaders/providers.js:51` | `logger.info`, com o provider default resolvido dinamicamente |

Os warnings originais não foram suprimidos, reclassificados ou filtrados pelo logger. O release DB-only evita inicializá-los; produção normal falha se faltar contrato/módulo Redis.

## Matriz classificada

| Processo | Migration mode | Redis projectConfig | Cache | Locking | Events | Workflow | Resultado |
|---|---:|---:|---:|---:|---:|---:|---|
| release | true, somente no child marcado | omitido | omitido | omitido | omitido | omitido | intencional, DB-only |
| web | false | obrigatório | Redis (CACHE-01A/B) | Redis | Redis | Redis | PASS |
| worker | false | obrigatório | Redis (CACHE-01A/B) | Redis | Redis | Redis | PASS |
| local sem Redis | false | opcional | local | local | local | local | permitido |

## Hardening implementado

- `run-migrations.mjs` deixou de mutar `process.env`; `buildMigrationChildEnv` copia o ambiente, define as duas marcas privadas e remove `WORKER_MODE`.
- `isReleaseMigrationMode` recusa `server` e `worker` mesmo se ambas as marcas forem fornecidas.
- um único snapshot de ambiente alimenta descrição, builder Redis e assertion final.
- `describeInfrastructureMode` classifica `release_migration_db_only`, `production_redis` e `local_optional` sem retornar valores sensíveis.
- contratos Redis parciais falham de forma sanitizada; local sem contratos continua opcional.
- produção normal exige `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL`, `WE_REDIS_URL`, quatro módulos e exatamente um provider Redis default para cache e locking.
- providers locais/in-memory, inclusive aninhados, são recusados.
- `REDIS_CACHE_PROVIDER_DISABLED=true` causa `Production Redis infrastructure is incomplete` em produção.
- o log DB-only é escrito sincronicamente uma única vez antes do spawn, sem URL, host, credencial ou dump de ambiente.
- default tipado de `shouldWireRedisCachingProvider` usa objeto explícito (`NODE_ENV` + flag), não `process.env` cru.
- quatro `throw new Error` de startup validation receberam `eslint-disable-next-line` local.

## Validações executadas

| Gate | Resultado |
|---|---|
| testes focados (infra) | PASS: 5/5 suítes, 59/59 testes |
| unitários completos | PASS: 49/49, 766/766 |
| integration modules | PASS: 29/29, 463/463 |
| integration HTTP | PASS: 14/14, 172/172 |
| lint | PASS: 0 erros, 207 warnings |
| build | PASS |
| `git diff --check` | PASS |
| diff de package/lockfile/Procfile | PASS: vazio |

## Manual gate — 20 itens

1. Origem dos warnings: registrada com arquivo, linha e método.
2. Processos: release DB-only; web/worker Redis-backed após CACHE-01A/B.
3. Motivo histórico: pressão do limite de 20 conexões e erros Redis no release v40.
4. Matriz: release DB-only; web/worker Redis completo; local opcional.
5. Script: child env isolado, sem mutação global, duas marcas e `WORKER_MODE` removido.
6. Log: payload estruturado DB-only, escrita síncrona antes do spawn, sanitizado.
7. Warnings Medusa originais: preservados sem supressão ou reclassificação.
8. Fail-fast: quatro contratos, quatro módulos, providers Redis exatos, sem fallback.
9. Vazamento da flag: `server`/`worker` recusados mesmo com as duas marcas.
10. Focados: 5/5 suítes e 59/59 testes.
11. Unitários completos: 49/49, 766/766.
12. Modules: 29/29, 463/463.
13. HTTP: 14/14, 172/172.
14. Lint: 0 erros, 207 warnings.
15. Build: PASS.
16. Integridade: sem diff em models, migrations, packages, lockfile, payments, refunds, Orders, catálogo, money, `APP_VERSION`, Procfile ou Phase 12.
17. Arquivos alterados: somente infraestrutura, testes diretamente afetados e documentação.
18. Commits: dois commits locais após PASS.
19. Divergência esperada pós-commit: `origin/main...HEAD = 0 2`.
20. Não-ações: nenhum `heroku config`, alteração de config var, deploy, push, tag, migration de produção, Supabase, Stripe, Gelato, Resend, PostHog ou Phase 12.
