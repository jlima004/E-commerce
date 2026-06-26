---
quick_task: production-backend-smoke
status: complete
created: 2026-06-26
completed: 2026-06-26
scope: production-read-only-smoke
target:
  heroku_app: espacoliminar
  production_url: https://espacoliminar-5c3343d789bf.herokuapp.com
  expected_release_minimum: v27
  expected_app_version: d02fd70
---

# Smoke Test backend em producao

## Objetivo

Validar o runtime backend em producao no Heroku/Supabase/Redis ja estabilizado, sem alterar dados de negocio e sem iniciar Phase 02.

## Contexto obrigatorio lido

- `.planning/STATE.md`
- `.planning/phases/01-foundation-observability/01-CONTEXT.md`
- `.planning/phases/01-foundation-observability/01-07-SUMMARY.md`
- `ops/DEPLOY.md`

## Guardrails

- Somente comandos de leitura/validacao.
- Permitido consultar Heroku releases, dynos, config vars nao secretas e logs.
- Permitido chamar endpoints publicos com `curl`.
- Proibido alterar codigo, secrets, config vars, runtime, deploy, migrations ou dados de negocio.
- Proibido criar pedido, pagamento, webhook Stripe/Gelato ou fulfillment.
- Phase 02 permanece bloqueada ate o smoke e closure da Phase 01.

## Plano de execucao

1. Confirmar worktree limpo com `git status --short`.
2. Identificar release atual do Heroku app `espacoliminar`.
3. Conferir `APP_VERSION` e `REDIS_CACHE_PROVIDER_DISABLED`.
4. Conferir dynos `web.1` e `worker.1`.
5. Validar `/health/live` e `/health/ready`.
6. Filtrar logs recentes de web/worker para loops Redis/TLS.
7. Smoke read-only de base HTTP, Admin, Store API e CORS conservador.
8. Registrar evidencias sanitizadas e atualizar estado do projeto.

