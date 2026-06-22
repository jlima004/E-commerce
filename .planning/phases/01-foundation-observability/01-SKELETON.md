# Walking Skeleton — E-commerce POD de Camisetas — Backend MVP

**Phase:** 1
**Generated:** 2026-06-22

## Capability Proven End-to-End

> Um operador inicia o backend Medusa, acessa o Admin em `/app` pelo host dedicado e obtém evidência de que a aplicação compilada usa migrations PostgreSQL/Supabase e reporta saúde de Postgres e Redis sem expor dados sensíveis.

## Phase Goal

**Como operador**, **quero iniciar e observar o backend Medusa com Admin, banco e Redis reais**, **para que as próximas capacidades de comércio sejam construídas sobre uma fundação executável, segura e verificável**.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Medusa v2.16.0, Node.js 22.x LTS e TypeScript no layout `apps/backend` do DTC Starter | Preserva o framework obrigatório, mantém todos os pacotes `@medusajs/*` no mesmo minor e não cria storefront. |
| Data layer | PostgreSQL/Supabase; `DATABASE_URL` pooled/session para runtime e `DATABASE_MIGRATION_URL` direct/session para migrations | Cumpre D-09 e D-10, evitando transaction pooler em migrations. |
| Infraestrutura assíncrona | Redis 7 com contratos `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL` e `WE_REDIS_URL` | Cumpre D-11 e D-12 e permite futura separação física sem alterar contratos. |
| Auth | Autenticação nativa do Medusa Admin; nenhuma autenticação de storefront nesta fase | O Walking Skeleton é backend-only e a interação real de UI é o Admin em `/app`. |
| Observabilidade | Pino com allowlist/redaction central, Sentry com scrubbing e health `/health/live` + `/health/ready` | Implementa SETUP-05 e OBS-01..03 com as políticas D-14..D-29. |
| Deployment target | VPS Linux com Nginx/Let's Encrypt e PM2 em dois processos (`server` e `worker`) | Implementa D-01..D-07 e SETUP-03/04 sem expor Medusa, Redis ou Postgres diretamente. |
| Directory layout | Monorepo oficial sem storefront: `apps/backend`, mais `ops/pm2`, `ops/nginx`, `ops/logrotate`, `ops/tests` | Mantém artefatos runtime separados dos templates operacionais versionados. |

## Stack Touched in Phase 1

- [ ] Project scaffold — Medusa v2.16.0, build, lint e Jest.
- [ ] Routing — Medusa Admin em `/app`, `/health/live` e `/health/ready`.
- [ ] Database — migrations reais no PostgreSQL/Supabase e probe `SELECT 1`.
- [ ] UI — login/navegação do Medusa Admin servido pelo host Admin dedicado.
- [ ] Deployment — comando local documentado e templates de produção Nginx/PM2.

## Walking Skeleton Execution Path

1. O executor valida a legitimidade dos pacotes recentes antes de cada instalação.
2. O scaffold Medusa é importado sem storefront e cria a infraestrutura Wave 0.
3. Migrations usam `DATABASE_MIGRATION_URL` somente no subprocesso e o runtime volta a usar `DATABASE_URL`.
4. Cache, event bus e workflow engine usam Redis em produção.
5. Logger e Sentry saneiam telemetria antes de qualquer saída.
6. `/health/live` prova vida do processo; `/health/ready` prova Postgres e Redis.
7. PM2 inicia `server` e `worker`; Nginx publica API e Admin em hosts separados.

## Out of Scope (Deferred to Later Slices)

- Storefront, páginas públicas ou Stripe.js.
- Catálogo, mídia de produtos e metadados Gelato.
- Carrinho, checkout, pagamento, webhooks e criação de Order.
- Fulfillment, tracking, e-mail, analytics, reembolso e trocas.
- Cloudflare/CDN e provisionamento de staging.
- Qualquer domínio, credencial ou secret real versionado.

## Subsequent Slice Plan

- Phase 2: catálogo e mídia, com preços BRL e contratos Gelato.
- Phase 3: carrinho e checkout pré-Order.
- Phase 4: pagamentos Stripe e PaymentAttempt.
- Phases 5–12: ingestão idempotente, Order pós-webhook, outbox, e-mail, Gelato, tracking, operação e testes críticos.

## Contract for Later Phases

- `apps/backend/medusa-config.ts` é a composição central e recebe apenas configuração já validada.
- Código de domínio futuro não pode contornar o logger/redaction nem registrar request bodies, secrets ou tokens.
- Processamento assíncrono futuro pertence ao processo `worker`; HTTP/Admin pertence ao processo `server`.
- Rotas futuras de webhook existem somente no host API e dependem de raw body intacto.
- Toda nova dependência de readiness deve ser explicitamente aprovada; Stripe, Gelato, Resend, PostHog e Sentry permanecem fora do readiness.

