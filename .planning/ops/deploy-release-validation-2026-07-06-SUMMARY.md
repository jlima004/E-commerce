# Deploy Release Validation — 2026-07-06

## Resultado

PASS.

## Release final

- Heroku release final: v42
- Code deploy: v41 / c0eb4bc5
- Config release: v42 / APP_VERSION=c0eb4bc5
- Health version: c0eb4bc5
- Build: PASS
- Release command: PASS
- `db:migrate:safe`: PASS
- Redis-lite migration mode: aplicado

## Release output

Ausentes:

- `ECONNRESET`
- `MaxRetriesPerRequestError`
- `Failed to reconnect to Redis`
- `[stripe-real-initiation] loader reached`

Presentes e esperados em migration mode:

- `redisUrl not found. A fake redis instance will be used.`
- `Local Event Bus installed. This is not recommended for production.`
- `Locking module: Using "in-memory" as default.`

Interpretação: aceitável apenas no release command com `DTC_RELEASE_MIGRATION_MODE=true`; runtime normal preserva Redis.

## Runtime validation

- `web.1`: up
- `worker.1`: up
- `GET /health`: OK
- `GET /health/live`: PASS
- `GET /health/ready`: PASS — `postgres=up`, `redis=up`

## Observação

- `GET /` retorna 404; esperado/não bloqueante.
- Deploy não iniciou Phase 12.
- Stripe refund smoke ainda não foi executado.
