# Release Migration Redis-Lite — 2026-07-06

## Objetivo

Reduzir o footprint do release command `db:migrate:safe` no Heroku para evitar conexões Redis excessivas no plano Mini (limite 20 conexões), mantendo Redis obrigatório no runtime normal web/worker.

## Problema observado

- Release v40 promovido, mas o release command gerou `ECONNRESET`, `Connection is closed` e `MaxRetriesPerRequestError` em providers Redis.
- Migrations estavam up-to-date; runtime health respondeu `postgres up` / `redis up`.
- Problema restrito ao carregamento de runtime/Redis durante release migrations.

## Solução implementada

### Modo explícito: `DTC_RELEASE_MIGRATION_MODE=true`

| Arquivo | Mudança |
|---------|---------|
| `apps/backend/scripts/run-migrations.mjs` | Define `DTC_RELEASE_MIGRATION_MODE=true` no processo pai e no `childEnv` antes de `medusa db:migrate` |
| `apps/backend/src/infrastructure/release-migration-mode.ts` | Helper `isReleaseMigrationMode()` |
| `apps/backend/src/infrastructure/redis-config.ts` | Em migration mode: não registra cache/event-bus/workflow/locking Redis; omite `projectConfig.redisUrl` |
| `apps/backend/src/modules/payment-attempt/loaders/stripe-real-initiation.ts` | No-op silencioso (sem logs) em migration mode |
| `apps/backend/src/jobs/*-relay.ts` (3 jobs) | No-op nos entrypoints de scheduled jobs em migration mode |

### Comportamento preservado

- **Runtime production normal** (sem `DTC_RELEASE_MIGRATION_MODE`): Redis modules ativos; `REDIS_URL` / `CACHE_REDIS_URL` / `EVENTS_REDIS_URL` / `WE_REDIS_URL` obrigatórios; sem fallback in-memory.
- **Migration release mode**: migrations continuam rodando; falhas retornam exit code != 0; apenas evita carregar providers Redis e runtime operacional desnecessário.

### Fora de escopo (não alterado)

- `package.json` / `package-lock.json`
- Variáveis Redis/S3 no Heroku
- Novas migrations de schema
- Phase 12 / Stripe smoke / Gelato / Correios

## Validações locais (executar após merge)

```bash
npm test -- --runInBand apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts
npm run build -w @dtc/backend
git diff --check
git diff --name-only package.json package-lock.json apps/backend/package.json  # deve retornar vazio
```

## Manual gate — deploy validation

**Parar aqui.** Deploy somente após aprovação manual:

```bash
git push heroku HEAD:main
heroku releases -a espacoliminar | head -10
heroku releases:output <nova-release> -a espacoliminar
```

Confirmar **ausência** no output da release:

- `ECONNRESET`
- `MaxRetriesPerRequestError`
- `Failed to reconnect to Redis`
- `[stripe-real-initiation] loader reached`

### Runtime validation pós-deploy

```bash
heroku ps -a espacoliminar
curl -fsS https://espacoliminar-5c3343d789bf.herokuapp.com/health
curl -fsS https://espacoliminar-5c3343d789bf.herokuapp.com/health/live
curl -fsS https://espacoliminar-5c3343d789bf.herokuapp.com/health/ready
```

Esperado: web/worker healthy; Redis modules ativos no runtime normal.
