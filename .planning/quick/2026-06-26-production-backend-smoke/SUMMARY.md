---
quick_task: production-backend-smoke
status: complete
completed: 2026-06-26
result: passed
target:
  heroku_app: espacoliminar
  release: v27
  app_version: d02fd70
  production_url: https://espacoliminar-5c3343d789bf.herokuapp.com
phase_02_status: blocked-until-phase-01-closure
---

# Production backend smoke summary

## Resultado

Smoke test backend em producao **aprovado** em 2026-06-26.

O runtime Heroku/Supabase/Redis respondeu dentro dos criterios definidos: release identificada, `APP_VERSION` consistente com health, dynos web/worker online, liveness/readiness saudaveis, Postgres e Redis `up`, logs web/worker sem loop Redis/TLS recente, rotas publicas sem 5xx e nenhuma mutacao de dados de negocio executada.

## Evidencias tecnicas

| Check | Resultado |
|-------|-----------|
| `git status --short` | sem saida antes da documentacao do smoke |
| `heroku releases -a espacoliminar \| head -n 8` | current release `v27`; deploy anterior `v26` em `d02fd704`; flag Redis em `v25` |
| `heroku config:get APP_VERSION -a espacoliminar` | `d02fd70` |
| `heroku config:get REDIS_CACHE_PROVIDER_DISABLED -a espacoliminar` | `true` |
| `heroku ps -a espacoliminar` | `web.1: up`; `worker.1: up` |
| `GET /health/live` | HTTP 200; `status: live`; `version: d02fd70` |
| `GET /health/ready` | HTTP 200; `status: ready`; `version: d02fd70`; `postgres: up`; `redis: up` |
| logs web filtrados | sem saida para `Redis cache connection error`, `self-signed certificate`, `MaxRetriesPerRequestError`, `ECONNRESET` |
| logs worker filtrados | sem saida para `Redis cache connection error`, `self-signed certificate`, `MaxRetriesPerRequestError`, `ECONNRESET` |

Respostas health observadas:

```json
{"status":"live","service":"medusa-backend","timestamp":"2026-06-26T15:25:51.056Z","version":"d02fd70"}
```

```json
{"status":"ready","service":"medusa-backend","timestamp":"2026-06-26T15:25:49.746Z","version":"d02fd70","checks":{"postgres":"up","redis":"up"}}
```

## Evidencias read-only

| Check | Resultado |
|-------|-----------|
| `GET /` | HTTP 404; aceito porque nao e 5xx |
| `GET /app` | HTTP 200 |
| `GET /store/regions` | HTTP 400 por ausencia de `x-publishable-api-key`; sem 5xx |
| `GET /store/products?limit=1` | HTTP 400 por ausencia de `x-publishable-api-key`; sem 5xx |
| `OPTIONS /store/products?limit=1` com `Origin: https://espacoliminar.herokuapp.com` e `Access-Control-Request-Method: GET` | HTTP 204; `Access-Control-Allow-Origin: https://espacoliminar.herokuapp.com` |
| `GET /store/products?limit=1` com `Origin: https://espacoliminar.herokuapp.com` | HTTP 400 por ausencia de `x-publishable-api-key`; inclui `Access-Control-Allow-Origin` correto; sem 5xx |

Corpo observado nas rotas Store API sem chave publicavel:

```json
{"type":"not_allowed","message":"Publishable API key required in the request header: x-publishable-api-key. You can manage your keys in settings in the dashboard."}
```

## Guardrails preservados

- Nenhum `POST`, `PUT`, `PATCH` ou `DELETE` foi executado.
- Nenhum pedido, pagamento, webhook Stripe/Gelato ou fulfillment foi criado/disparado.
- Nenhum secret, config var ou runtime foi alterado.
- Nenhum deploy ou migration foi executado.
- Nenhum dado de negocio em producao foi escrito.
- Phase 02 nao foi iniciada.

## Conclusao

Phase 01 esta pronta para o ciclo de closure. Phase 02 permanece bloqueada ate o fechamento explicito da Phase 01.

