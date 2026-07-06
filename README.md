# E-commerce POD de Camisetas — Backend

Backend headless de um e-commerce Print-on-Demand (POD) de camisetas para o mercado brasileiro, construído sobre [Medusa v2](https://docs.medusajs.com). Este repositório entrega **apenas o backend MVP**: catálogo, carrinho, checkout, pagamento (Stripe cartão + Pix), fulfillment (Gelato), tracking, operações via Admin e observabilidade. O storefront será um projeto separado — aqui expomos contratos de API estáveis para consumo futuro.

## Valor central

Um pedido (`Order`) só existe e só é enviado à produção (Gelato) após confirmação de pagamento confiável, validada e idempotente pelo webhook canônico do Stripe — sem cobrança fantasma, sem pedido duplicado, sem fulfillment indevido.

## Status do projeto

| Fase | Escopo | Status |
|------|--------|--------|
| **01 — Foundation & Observability** | Medusa v2, Postgres/Supabase, Redis, Admin, PM2/Nginx, logs, Sentry, health | Em andamento (6/7 planos) |
| 02 — Catalog & Media | Catálogo BRL, imagens Supabase Storage, metadados Gelato | Planejado |
| 03–12 | Carrinho, checkout, Stripe, webhooks, Order, Gelato, tracking, reembolsos | Planejado |

Detalhes do roadmap: [`.planning/ROADMAP.md`](.planning/ROADMAP.md)

## Stack

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| Node.js | 22.x LTS | Runtime |
| Medusa | 2.16.x | Framework de commerce headless |
| TypeScript | ^5.6 | Linguagem |
| PostgreSQL | 15+ (Supabase) | Persistência |
| Redis | 7.x | Cache, event bus, workflow engine, locking |
| Sentry | 10.59.x | Monitoramento de erros |
| Pino | 10.3.x | Logs estruturados |
| Turbo | ^2.x | Orquestração do monorepo |

Integrações previstas nas fases seguintes: Stripe (cartão + Pix), Gelato, Resend, PostHog, Supabase Storage.

## Estrutura do repositório

```text
.
├── apps/
│   └── backend/              # Aplicação Medusa v2 (@dtc/backend)
│       ├── src/
│       │   ├── api/          # Rotas HTTP (health, store, admin)
│       │   ├── config/       # Validação de ambiente (Zod)
│       │   ├── infrastructure/  # Health probes, config Redis
│       │   ├── observability/   # Logger, Sentry, sanitização
│       │   ├── modules/      # Módulos customizados (fases futuras)
│       │   ├── workflows/    # Workflows duráveis (fases futuras)
│       │   └── subscribers/  # Event subscribers (fases futuras)
│       ├── integration-tests/
│       ├── medusa-config.ts
│       └── scripts/run-migrations.mjs
├── ops/
│   ├── DEPLOY.md             # Runbook de deploy (local + production)
│   ├── pm2/                  # Ecosystem PM2 (server + worker)
│   ├── nginx/                # Template Nginx (API + Admin)
│   └── tests/                # Smoke tests de infra
├── docs/                     # PRD, SRS, DB model
├── .planning/                # Roadmap, fases e artefatos GSD
├── AGENTS.md                 # Contexto para agentes de IA
└── turbo.json
```

## Pré-requisitos

- **Node.js 22.x** (`engines`: `>=22 <23`)
- **npm 10.x** (gerenciador do monorepo)
- **PostgreSQL** acessível (local, Docker ou Supabase)
- **Redis** acessível (local, Docker ou remoto)

## Desenvolvimento local

### 1. Instalar dependências

```bash
npm ci
```

### 2. Configurar ambiente

```bash
cp apps/backend/.env.template apps/backend/.env
```

Edite `apps/backend/.env` com valores locais. **Nunca commite secrets.**

Variáveis principais:

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Conexão Postgres (runtime) |
| `DATABASE_MIGRATION_URL` | Conexão direct/session para migrações (obrigatória em production) |
| `REDIS_URL` | Redis principal |
| `CACHE_REDIS_URL`, `EVENTS_REDIS_URL`, `WE_REDIS_URL` | Contratos Redis para cache, event bus e workflow engine |
| `JWT_SECRET`, `COOKIE_SECRET` | Secrets de autenticação (mín. 32 chars em production) |
| `WORKER_MODE` | `shared` (dev), `server` ou `worker` (production) |
| `SENTRY_DSN` | Opcional em local; obrigatório em production |

Contrato completo: [`apps/backend/.env.template`](apps/backend/.env.template)

### 3. Migrar banco

```bash
cd apps/backend
npm run db:migrate:safe
```

O script usa `DATABASE_MIGRATION_URL` e rejeita pooler transacional (porta 6543).

### 4. Iniciar servidor

```bash
# Na raiz do monorepo
npm run dev

# Ou apenas o backend
npm run backend:dev
```

Medusa escuta em `http://127.0.0.1:9000`. Admin em `/app`.

### 5. Verificar health

```bash
curl -fsS http://127.0.0.1:9000/health/live
curl -fsS http://127.0.0.1:9000/health/ready
```

## Scripts

### Raiz (Turbo)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Desenvolvimento (todos os workspaces) |
| `npm run build` | Build de produção |
| `npm run start` | Inicia apps buildadas |
| `npm run lint` | Lint |
| `npm run test` | Testes |
| `npm run backend:dev` | Dev apenas do backend |

### Backend (`apps/backend`)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | `medusa develop` |
| `npm run build` | `medusa build` |
| `npm run start` | `medusa start` (requer build prévio) |
| `npm run db:migrate:safe` | Migrações via conexão direct |
| `npm run test:unit` | Testes unitários |
| `npm run test:integration:http` | Testes de integração HTTP |

## Health checks

| Endpoint | Propósito | HTTP |
|----------|-----------|------|
| `GET /health/live` | Liveness — processo responde | 200 |
| `GET /health/ready` | Readiness — Postgres + Redis | 200 ou 503 |

Resposta de readiness inclui `checks.postgres` e `checks.redis` (`up` / `down`). Falhas esperadas de dependência são logadas de forma sanitizada e não geram eventos Sentry por padrão.

## Observabilidade

- **Logs estruturados** (Pino) com sanitização allowlist-first — secrets, dados de cartão e tokens nunca aparecem em logs
- **Sentry** (`@sentry/node`) com `sendDefaultPii=false`, scrubbing de eventos/breadcrumbs e release atrelada a `APP_VERSION`
- **Health probes** com timeouts (1,5 s por dependência, 2 s global) e deduplicação de endpoints Redis

Inicialização Sentry: [`apps/backend/instrumentation.ts`](apps/backend/instrumentation.ts)

## Arquitetura (Medusa v2)

O backend segue o modelo modular do Medusa v2:

- **Modules** — domínios isolados com data models e services (ex.: Gelato, PaymentAttempt, WebhookEventLog nas fases futuras)
- **Module Links** — associações entre módulos sem foreign keys diretas
- **Workflows** — orquestração durável (Redis) para o fluxo pagamento → Order → Gelato
- **Subscribers** — reações a eventos (worker mode)
- **API routes** — contratos HTTP em `src/api/`

Modos de worker:

| Modo | Uso |
|------|-----|
| `shared` | Desenvolvimento — HTTP + background no mesmo processo |
| `server` | Production — apenas HTTP e Admin |
| `worker` | Production — jobs e subscribers, sem listener HTTP |

## Deploy em production

Production usa **PM2** (dois processos: `medusa-server` + `medusa-worker`) atrás de **Nginx** com TLS (Certbot). Medusa escuta somente em `127.0.0.1:9000`; Nginx é a borda pública.

Runbook completo: [`ops/DEPLOY.md`](ops/DEPLOY.md)

Resumo da ordem de deploy:

1. Exportar `APP_VERSION` (commit SHA ou tag)
2. `npm ci` + `npm run build`
3. `npm run db:migrate:safe` **antes** de reiniciar processos
4. `pm2 start ops/pm2/ecosystem.config.cjs`
5. Configurar Nginx + Certbot
6. Smoke tests (`ops/tests/`)

## Testes

```bash
# Unitários
cd apps/backend && npm run test:unit

# Integração HTTP (health, bootstrap, sentry)
cd apps/backend && npm run test:integration:http

# Contratos de infra (PM2, Nginx)
node --test ops/tests/pm2-config.test.mjs
bash ops/tests/nginx-routing-smoke.sh
```

## Documentação de referência

| Documento | Conteúdo |
|-----------|----------|
| [`.planning/PROJECT.md`](.planning/PROJECT.md) | Visão, requisitos e decisões |
| [`.planning/ROADMAP.md`](.planning/ROADMAP.md) | Fases e dependências |
| [`docs/PRD_Backend_v1.1.md`](docs/PRD_Backend_v1.1.md) | Product Requirements |
| [`docs/SRS_v1.5.md`](docs/SRS_v1.5.md) | Software Requirements |
| [`docs/DB_MODEL_v1.21.md`](docs/DB_MODEL_v1.21.md) | Modelo de dados |
| [`AGENTS.md`](AGENTS.md) | Contexto para desenvolvimento assistido |
| [Medusa Docs](https://docs.medusajs.com) | Documentação oficial do framework |

## Segurança

- Secrets, DSNs e chaves de API **nunca** devem ser commitados
- Tokens de tracking serão armazenados com hash (fase 10)
- Webhooks Stripe exigem raw body intacto — Nginx está configurado para não alterar o corpo (`ops/nginx/`)
- Logs e Sentry aplicam redaction antes de persistir dados sensíveis

## Licença

MIT — ver [`apps/backend/package.json`](apps/backend/package.json).