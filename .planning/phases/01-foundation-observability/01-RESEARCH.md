# Fase 1: Foundation & Observability - Pesquisa

**Pesquisado em:** 2026-06-22
**Domínio:** Fundação Medusa v2, configuração segura, infraestrutura Redis/Postgres e observabilidade
**Confiança:** MÉDIA-ALTA

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Topologia e domínios
- **D-01:** API e Admin usarão subdomínios separados, ambos encaminhados pelo Nginx ao mesmo servidor HTTP Medusa.
- **D-02:** O worker Medusa será um processo PM2 separado. Webhooks serão publicados exclusivamente no domínio da API.
- **D-03:** Somente o Nginx ficará público, nas portas 80/443, com TLS terminado via Let's Encrypt. Medusa escutará apenas em localhost ou interface privada; worker, Redis e banco nunca serão públicos.
- **D-04:** Não haverá acesso público temporário direto ao Medusa nem Cloudflare/CDN nesta fase.
- **D-05:** Nginx terá headers de segurança, limites de body e timeouts razoáveis. Rate limiting será seletivo para rotas sensíveis, nunca global.
- **D-06:** Rotas futuras de webhook Stripe/Gelato não poderão sofrer alteração, compressão ou transformação do raw body.
- **D-07:** Serão versionados templates parametrizados de PM2 e Nginx, além de runbook/checklist de deploy. Nenhum secret ou valor sensível específico do VPS será commitado.

### Ambientes e conexões
- **D-08:** A Fase 1 suportará `local` e `production`. `staging` terá apenas convenções documentadas para adoção futura, sem provisionamento ou requisito operacional.
- **D-09:** Servidor e worker usarão `DATABASE_URL` pooled para runtime. Migrações usarão `DATABASE_MIGRATION_URL` direta/session, nunca o transaction pooler.
- **D-10:** Deploy de produção deverá falhar se `DATABASE_MIGRATION_URL` estiver ausente ou aparentar usar transaction pooler.
- **D-11:** Uma instância Redis poderá atender o MVP, mantendo contratos separados: `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL` e `WE_REDIS_URL`.
- **D-12:** Produção nunca poderá usar fallback in-memory para cache, event bus ou workflow engine.
- **D-13:** Um schema tipado e sensível ao ambiente validará configuração no startup. Produção falhará imediatamente com URLs ausentes, secrets fracos/padrão, Redis ausente, fallback in-memory ou combinações inseguras.

### Logs, redaction e Sentry
- **D-14:** Produção emitirá JSON estruturado em `stdout/stderr`; desenvolvimento local terá formato legível. A aplicação não gerenciará arquivos nem rotação.
- **D-15:** As mesmas regras de redaction serão aplicadas em todos os ambientes.
- **D-16:** Logging HTTP seguirá allowlist: método, rota normalizada, status, duração, request/correlation ID e IDs internos seguros quando relevantes. Bodies ficam excluídos por padrão.
- **D-17:** Logs e Sentry nunca poderão conter secrets, URLs de banco/Redis, Sentry DSN, cookies, authorization headers, API keys, JWTs, session tokens, assinaturas Stripe, payloads brutos de webhook, dados completos de cartão, PII desnecessária ou tracking tokens em texto puro.
- **D-18:** IP só poderá aparecer mascarado ou como hash; user agent somente resumido e quando necessário.
- **D-19:** Sentry usará `sendDefaultPii: false`, `beforeSend` e `beforeBreadcrumb`, recebendo apenas exceção, stack, ambiente, release, serviço/processo, rota normalizada, IDs de correlação e tags/IDs internos seguros.
- **D-20:** `info` representa ciclo normal, `warn` degradação recuperável e `error` falha que exige investigação, retry, alerta ou intervenção. Cause chains devem ser preservadas.
- **D-21:** Erros serão agrupados por classe, operação, integração e rota/job normalizado, sem duplicação desnecessária entre logger e Sentry.
- **D-22:** Assinatura inválida de webhook será `warn`, sem Sentry por padrão. Falhas persistentes de integração serão `error` no Sentry e futuramente poderão gerar `OperationalAlert`.

### Health checks
- **D-23:** `/health/live` verificará somente a vida do processo HTTP e retornará 200 quando ele responder.
- **D-24:** `/health/ready` verificará Postgres/Supabase e Redis, retornando 200 apenas com todas as dependências obrigatórias disponíveis; caso contrário, 503 e `status: not_ready`.
- **D-25:** Stripe, Gelato, Resend, PostHog e Sentry não serão dependências de readiness na Fase 1.
- **D-26:** O contrato público conterá apenas `status`, `service`, `timestamp`, `version` e estados genéricos dos checks.
- **D-27:** Checks de Postgres e Redis executarão em paralelo, com timeout curto e independente. Não haverá cache de estado nesta fase.
- **D-28:** Health endpoints serão públicos, sem autenticação, baratos, fora dos rate limits sensíveis e sem logs por chamada saudável.
- **D-29:** Falhas esperadas de dependência poderão gerar `warn`, sem Sentry por padrão. Mudanças de estado, degradações relevantes e erros inesperados serão registrados com contexto saneado; erros inesperados de implementação poderão ir ao Sentry.

### the agent's Discretion
- Escolha exata das bibliotecas de schema, logging e integração Sentry, desde que preserve integralmente os contratos acima e as versões compatíveis com Medusa v2.
- Valores exatos de timeouts, limites de body, políticas de retenção do PM2/sistema e formato visual do logger local devem ser definidos na pesquisa/plano com defaults conservadores.
- Nomes concretos dos subdomínios permanecem parametrizados; os templates não devem fixar domínio real.

### Deferred Ideas (OUT OF SCOPE)
- Cloudflare/CDN poderá ser avaliado em futura fase de hardening de produção.
- Um ambiente `staging` poderá ser provisionado futuramente usando as convenções preparadas nesta fase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descrição | Suporte da pesquisa |
|----|-----------|---------------------|
| SETUP-01 | Medusa v2 roda localmente e em produção com PostgreSQL/Supabase | Bootstrap 2.16.0, build/start, schema de ambiente e estratégia session/direct. |
| SETUP-02 | Redis atende event bus, cache e workflow engine sem fallback em produção | Wiring atual dos três módulos, validação fail-fast e readiness. |
| SETUP-03 | Admin é servido em subdomínio dedicado | `admin.path`, `backendUrl`, CORS e isolamento por virtual hosts Nginx. |
| SETUP-04 | Worker separado sob PM2 e Nginx | `WORKER_MODE=server/worker`, Admin desabilitado no worker e ecosystem template. |
| SETUP-05 | Redaction central impede vazamento de dados sensíveis | Pino, serializers allowlist, sanitização de erros e testes com canários. |
| OBS-01 | Erros backend chegam ao Sentry | `instrumentation.ts`, error handler Medusa e hooks de scrubbing. |
| OBS-02 | Logs são estruturados e saneados | Adapter do logger Medusa sobre Pino, JSON em produção e pretty local. |
| OBS-03 | Health check reporta processo e dependências | Rotas live/ready, `SELECT 1`, Redis `PING`, timeout e contrato público mínimo. |
</phase_requirements>

## Resumo

A fase deve produzir um walking skeleton em sete slices, na ordem já definida no roadmap. O scaffold atual deve ser Medusa v2.16.0, com todos os pacotes `@medusajs/*` na mesma versão; essa versão foi publicada oficialmente em 18 de junho de 2026, inclui correção de segurança do MikroORM e remove fallbacks padrão de JWT/cookie secrets em produção. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0]

O desenho recomendado usa um único build Medusa e dois processos PM2: `server` recebe HTTP e serve o Admin; `worker` executa subscribers/jobs e desabilita o Admin. O Medusa documenta `shared` para desenvolvimento e `server`/`worker` separados para produção. [CITED: https://docs.medusajs.com/learn/production/worker-mode]

O maior risco da fase não é “subir o servidor”, mas criar uma fundação que pareça pronta enquanto ainda aceita configuração insegura, usa wiring Redis legado, expõe o Admin no host da API, migra pelo transaction pooler ou deixa secrets entrarem em mensagens de erro. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md] A validação deve, portanto, testar falha segura e vazamento negativo desde cada slice, não só o happy path.

**Recomendação principal:** planejar sete mudanças pequenas e cumulativas; cada uma deve deixar o backend executável, testável e revisável, com o slice 1.7 apenas operacionalizando artefatos já provados nos slices 1.1–1.6.

## Architectural Responsibility Map

| Capacidade | Tier primário | Tier secundário | Racional |
|------------|---------------|-----------------|----------|
| Bootstrap/build Medusa | API / Backend | Database / Storage | O processo Medusa concentra config, APIs e Admin; Postgres é dependência de boot. [CITED: https://docs.medusajs.com/learn/build] |
| Estratégia Supabase/migrações | Database / Storage | API / Backend | Pooling, prepared statements e migrações pertencem à camada de persistência; o app valida os contratos. [CITED: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx] |
| Cache/event bus/workflow Redis | API / Backend | Database / Storage | São módulos de infraestrutura Medusa sobre Redis; não pertencem à lógica de domínio. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis] |
| Logging/redaction | API / Backend | — | Todo dado observável deve atravessar uma política única antes de sair do processo. [VERIFIED: .planning/REQUIREMENTS.md] |
| Sentry | API / Backend | Serviço externo | Medusa captura o erro e envia somente evento saneado ao Sentry. [CITED: https://docs.medusajs.com/resources/integrations/guides/sentry] |
| Liveness/readiness | API / Backend | Database / Storage | A rota pertence ao servidor; readiness consulta Postgres e Redis. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md] |
| TLS/proxy/Admin host | CDN / Static | API / Backend | Nginx é a única borda pública e separa hosts antes de encaminhar ao Medusa privado. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md] |
| Supervisão server/worker | API / Backend | OS / VPS | PM2 mantém dois papéis do mesmo build e systemd restaura a lista após reboot. [CITED: https://pm2.keymetrics.io/docs/usage/startup/] |

## Project Constraints (from AGENTS.md)

- Responder e produzir artefatos em Português do Brasil.
- Usar Medusa v2, Node.js e TypeScript; integrações devem seguir módulos Medusa.
- Usar PostgreSQL/Supabase e Redis.
- Manter o backend headless e antecipar contratos para a storefront futura, sem implementar storefront.
- Nunca registrar secrets, dados completos de cartão ou tracking tokens em texto puro.
- Manter Brasil/BRL e single-currency como limites globais.
- Não importar serviços entre módulos nem acessar o banco de outro módulo; usar Module Links/Query quando houver domínio customizado.
- Usar Redis-backed cache, event bus e workflow engine em produção.
- Usar server e worker separados em produção.
- Seguir o workflow GSD; esta pesquisa é artefato de planejamento e não autoriza implementação.
- Execução da fase permanece bloqueada até revisão humana de CONTEXT, RESEARCH, PLAN e SPEC/SDD. [VERIFIED: .planning/STATE.md]

## Standard Stack

### Core

| Biblioteca/tecnologia | Versão | Propósito | Por que é padrão |
|-----------------------|--------|-----------|-------------------|
| Node.js | 22.x LTS; ambiente atual 22.23.0 | Runtime | O scaffolder Medusa requer Node 20+. [CITED: https://docs.medusajs.com/resources/create-medusa-app] |
| `create-medusa-app` [WARNING: flagged as suspicious — verify before using.] | 2.16.0 | Scaffold | Gera o DTC Starter oficial em monorepo; sem `--with-nextjs-starter`, remove a storefront e mantém `apps/backend`. [CITED: https://docs.medusajs.com/resources/create-medusa-app] |
| `@medusajs/medusa`, `@medusajs/framework`, `@medusajs/cli` [WARNING: flagged as suspicious — verify before using.] | 2.16.0, alinhadas | Framework/build/runtime | A release oficial exige bump conjunto dos pacotes `@medusajs/*`. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0] |
| PostgreSQL/Supabase | Postgres gerenciado; runtime via session pooler | Persistência | Supabase recomenda session mode para backend persistente em rede IPv4 e conexão direta para migrações. [CITED: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx] |
| Redis | 7.x | Cache, event bus e workflow engine | Os módulos Redis substituem defaults de desenvolvimento e sustentam trabalho assíncrono durável. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis] |

### Supporting

| Biblioteca | Versão | Propósito | Quando usar |
|------------|--------|-----------|-------------|
| `@medusajs/caching-redis` [WARNING: flagged as suspicious — verify before using.] | 2.16.0 | Provider atual de caching Redis | Registrar sob `@medusajs/medusa/caching`; não iniciar código novo no módulo legado. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/caching/providers/redis] |
| `@sentry/node` [WARNING: flagged as suspicious — verify before using.] | 10.59.0 | Captura de erros | Inicializar em `instrumentation.ts` e capturar erros no error handler Medusa. [CITED: https://docs.medusajs.com/resources/integrations/guides/sentry] |
| `pino` | 10.3.1 | JSON logger + redaction | Base do logger da aplicação e do adapter Medusa. [VERIFIED: npm registry] |
| `pino-pretty` | 13.1.3, devDependency | Saída local legível | Somente fora de produção. [VERIFIED: npm registry] |
| `zod` | 4.2.0, pin do scaffold 2.16.0 | Schema tipado de ambiente | Validar configuração antes de montar `defineConfig`; não elevar isoladamente a versão gerada. [CITED: https://raw.githubusercontent.com/medusajs/dtc-starter/main/apps/backend/package.json] |
| `ioredis` [WARNING: flagged as suspicious — verify before using.] | 5.11.1 | `PING` de readiness | Cliente reutilizável, com fila offline desabilitada e retry curto. [CITED: https://github.com/redis/ioredis] |
| `@medusajs/test-utils` [WARNING: flagged as suspicious — verify before using.] + Jest | 2.16.0 + scaffold | Testes de rota/integrados | Usar `medusaIntegrationTestRunner` para health e smoke HTTP. [CITED: https://docs.medusajs.com/learn/debugging-and-testing/testing-tools] |
| PM2 | 7.0.1 | Supervisão de server/worker | Ecosystem file com dois processos e restauração por systemd. [VERIFIED: npm registry] |
| Nginx + Certbot | Pacotes estáveis da distribuição | Proxy/TLS | Única borda pública; Certbot fornece plugin Nginx. [CITED: https://eff-certbot.readthedocs.io/en/stable/using.html#nginx] |

### Alternatives Considered

| Em vez de | Poderia usar | Trade-off |
|------------|--------------|-----------|
| Pino | Logger padrão Medusa | Menos dependências, porém não entrega a mesma política central de JSON, serializers e redaction exigida pela fase. [CITED: https://docs.medusajs.com/learn/debugging-and-testing/logging/custom-logger] |
| `@medusajs/medusa/caching` + `@medusajs/caching-redis` | `@medusajs/medusa/cache-redis` legado | Há documentação para ambos, mas o caminho de caching/provider é o padrão mais novo e extensível. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/caching/providers/redis] |
| Session pooler no runtime | Transaction pooler | Transaction mode é voltado a clientes temporários/serverless e não suporta prepared statements; não é a escolha para o processo Medusa persistente. [CITED: https://github.com/supabase/supabase/blob/master/apps/docs/content/troubleshooting/disabling-prepared-statements-qL8lEL.mdx] |

**Instalação recomendada:**

```bash
# Gerar fora do repositório existente; depois importar seletivamente o monorepo.
npx create-medusa-app@2.16.0 pod-backend \
  --directory-path /tmp \
  --skip-db \
  --version 2.16.0 \
  --use-npm \
  --no-browser

cd /tmp/pod-backend/apps/backend
npm install @medusajs/caching-redis@2.16.0 @sentry/node@10.59.0 pino@10.3.1 ioredis@5.11.1
npm install --save-dev pino-pretty@13.1.3
```

O scaffold deve ser gerado fora do repositório porque o diretório atual já contém `.planning`, `docs` e `AGENTS.md`; o Plan 1.1 deve importar seletivamente o monorepo gerado, preservando esses arquivos. O starter antigo `medusa-starter-default` está deprecated e não deve ser usado para forçar layout de backend na raiz. [CITED: https://github.com/medusajs/medusa-starter-default] Todos os pacotes `@medusajs/*` gerados devem permanecer exatamente em 2.16.0. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0]

## Package Legitimacy Audit

| Pacote | Registry | Idade/sinal | Downloads semanais | Source repo | Veredito | Disposição |
|--------|----------|-------------|---------------------|-------------|----------|------------|
| `create-medusa-app` | npm | Projeto desde 2021; release atual recente | 11.9k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@medusajs/medusa` | npm | Projeto oficial; release atual recente | 147k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@medusajs/framework` | npm | Projeto oficial; release atual recente | 141k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@medusajs/cli` | npm | Projeto oficial; release atual recente | 139k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@medusajs/test-utils` | npm | Projeto oficial; release atual recente | 89k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@medusajs/caching-redis` | npm | Projeto oficial; release atual recente | 94k | github.com/medusajs/medusa | SUS: too-new | Checkpoint humano |
| `@sentry/node` | npm | Projeto estabelecido; patch recente | 26.5M | github.com/getsentry/sentry-javascript | SUS: too-new | Checkpoint humano |
| `ioredis` | npm | Projeto estabelecido; patch recente | 22.9M | github.com/redis/ioredis | SUS: too-new | Checkpoint humano |
| `pino` | npm | Projeto estabelecido | 37.5M | github.com/pinojs/pino | OK | Aprovado |
| `pino-pretty` | npm | Projeto estabelecido | 17.3M | github.com/pinojs/pino-pretty | OK | Aprovado |
| `zod` | npm | Projeto estabelecido | 206M | github.com/colinhacks/zod | OK | Aprovado |
| `pm2` | npm | Projeto estabelecido | 3.36M | github.com/Unitech/pm2 | OK | Aprovado |

Nenhum pacote possui `postinstall` reportado no registro durante esta pesquisa. [VERIFIED: npm registry]

Os dados de versão, downloads, repositório e veredito da tabela foram coletados do npm registry e do gate `package-legitimacy` nesta sessão. [VERIFIED: npm registry]

**Packages removed due to [SLOP] verdict:** nenhum.
**Packages flagged as suspicious [SUS]:** `create-medusa-app`, pacotes `@medusajs/*`, `@sentry/node` e `ioredis`; o motivo foi recência da release, não ausência de repositório ou baixo uso. O planner deve inserir `checkpoint:human-verify` antes da instalação.

## Architecture Patterns

### System Architecture Diagram

```text
Browser Admin
   │ HTTPS admin.__DOMAIN__
   ▼
Nginx Admin vhost ── permite /app*; bloqueia /hooks* e /webhooks*
   │
   └───────────────► Medusa server em 127.0.0.1:9000
                        ▲
Future Store/API client │ HTTPS api.__DOMAIN__
   └──► Nginx API vhost ┘ bloqueia /app*
              │
              ├── /health/live ───────────────► 200 se processo responde
              └── /health/ready
                     ├── Postgres SELECT 1 ─┐
                     └── Redis PING(s) ─────┤ em paralelo + timeout
                                            ├─ todos up → 200 ready
                                            └─ algum down → 503 not_ready

PM2
├── medusa-server  WORKER_MODE=server, ADMIN_DISABLED=false
└── medusa-worker  WORKER_MODE=worker, ADMIN_DISABLED=true
        │
        ├── DATABASE_URL ─────────► Supabase session pooler (runtime)
        ├── Redis contracts ──────► uma instância Redis, URLs separadas
        ├── stdout/stderr ────────► PM2 + logrotate do SO
        └── erro saneado ─────────► Sentry

Deploy migration
└── DATABASE_MIGRATION_URL ──────► Supabase direct/session, nunca :6543
```

### Recommended Project Structure

```text
.
├── apps/
│   └── backend/
│       ├── instrumentation.ts       # init Sentry carregado pelo Medusa
│       ├── medusa-config.ts         # config validada + módulos
│       ├── .env.template            # nomes/placeholders do backend
│       ├── src/
│       │   ├── api/
│       │   │   ├── middlewares.ts   # correlation ID + error handler
│       │   │   └── health/
│       │   │       ├── live/route.ts
│       │   │       └── ready/route.ts
│       │   ├── config/
│       │   │   ├── env.ts           # schema local/production
│       │   │   └── __tests__/
│       │   ├── observability/
│       │   │   ├── logger.ts        # Pino base
│       │   │   ├── medusa-logger.ts # adapter da interface Logger
│       │   │   ├── sanitize.ts      # strings/erro/cause
│       │   │   └── __tests__/
│       │   └── infrastructure/
│       │       └── health.ts        # probes Postgres/Redis
│       └── integration-tests/http/
│           └── health.spec.ts
├── ops/
│   ├── pm2/ecosystem.config.cjs
│   ├── nginx/medusa.conf.template
│   ├── logrotate/medusa
│   └── DEPLOY.md
└── package.json                     # workspace oficial; sem app storefront
```

O layout `apps/backend` é o formato do DTC Starter atual. [CITED: https://github.com/medusajs/dtc-starter] No restante desta pesquisa, caminhos como `src/api/...` são relativos a `apps/backend`.

### Pattern 1: Configuração antes do framework

**O que:** importar e validar `env` antes de construir `defineConfig`; o schema retorna um objeto tipado e nunca imprime valores.
**Quando usar:** em todos os processos e comandos de deploy.
**Regra:** produção falha antes de conectar se faltar URL/secret, se secret for placeholder/fraco, se `WORKER_MODE` for inválido ou se qualquer contrato Redis estiver ausente. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

### Pattern 2: Mesma build, dois papéis

**O que:** usar `WORKER_MODE=server|worker` e `ADMIN_DISABLED=true` no worker.
**Quando usar:** produção sob PM2; local permanece `shared`.
**Fonte:** o Medusa recomenda duas instâncias em produção e permite desabilitar o Admin no worker. [CITED: https://docs.medusajs.com/learn/production/worker-mode]

### Pattern 3: Admin estático separado da API pelo proxy

**O que:** manter `admin.path: "/app"` e `admin.backendUrl: API_PUBLIC_URL`. O vhost da API retorna 404 para `/app`; o vhost do Admin redireciona `/` para `/app`, encaminha apenas `/app*` e não publica hooks/webhooks.
**Quando usar:** sempre que API e Admin compartilham o mesmo processo Medusa, mas precisam de superfícies públicas distintas.
**Fonte:** o Medusa permite configurar `admin.path` e `backendUrl`; a separação de hosts é decisão do projeto. [CITED: https://docs.medusajs.com/resources/medusa-cli/commands/build] [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

No vhost da API, as localizações futuras `/hooks/` e `/webhooks/` devem manter `proxy_pass_request_body on`, encaminhar `Content-Type` e headers de assinatura, e nunca usar `proxy_set_body` ou filtros que reescrevam o request. O buffering do Nginx não substitui a captura de raw body dentro do Medusa; a Fase 5 ainda deverá testar uma fixture byte a byte atravessando Nginx e o parser da aplicação. [CITED: https://nginx.org/en/docs/http/ngx_http_proxy_module.html] [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

### Pattern 4: Observabilidade por allowlist

**O que:** logar somente campos conhecidos; redaction por path é defesa adicional, não licença para registrar objetos inteiros. Serializar `Error` com `name`, mensagem saneada, stack saneada e causes com profundidade limitada.
**Quando usar:** HTTP, jobs, subscribers, integrações e health transitions.
**Fonte:** Pino suporta redaction/serializers; a allowlist e exclusão de bodies são decisões bloqueadas. [CITED: https://github.com/pinojs/pino/blob/v10.1.0/docs/api.md] [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

### Pattern 5: Readiness barata e não-cascateante

**O que:** executar `SELECT 1` pela conexão Knex registrada em `ContainerRegistrationKeys.PG_CONNECTION` e `PING` nos endpoints Redis únicos derivados dos quatro contratos. Usar timeout independente de 1.500 ms e limite global de 2.000 ms. [ASSUMED]
**Quando usar:** `/health/ready`; nunca em `/health/live`.
**Fonte:** o loader oficial do Medusa registra a conexão e testa com `pgConnection.raw("SELECT 1")`. [CITED: https://github.com/medusajs/medusa/blob/05d0423aec635cdd61a3676bf80760c4c9112f99/packages/core/framework/src/database/pg-connection-loader.ts]

### Anti-Patterns to Avoid

- **Scaffold + toda a infraestrutura no mesmo commit:** impede revisar qual slice quebrou o boot.
- **Usar `latest` sem lockfile revisado:** a release 2.16.0 introduz mudanças de config; fixar versões exatas nesta fase. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0]
- **Rodar migração com `DATABASE_URL` de runtime por conveniência:** viola D-09/D-10 e pode cair em transaction mode.
- **Expor `/app` no host da API:** “subdomínio dedicado” fica apenas cosmético.
- **Logar `req`, `res`, `error` ou `process.env` inteiros:** path redaction não cobre secrets embutidos em strings.
- **Capturar todo `warn` no Sentry:** cria duplicação e ruído; somente falhas inesperadas/persistentes são eventos.
- **Readiness chamar Stripe/Gelato/Sentry:** transforma indisponibilidade externa não essencial em remoção do backend do balanceamento.
- **Criar cliente Redis por request:** gera churn de conexão; usar clientes singleton e probes curtas.

### Defaults operacionais iniciais

- API: `client_max_body_size 2m`; Admin: `10m`.
- Proxy: connect timeout `5s`, send/read timeout `60s`.
- Health: sem rate limit; auth/login: `5r/s` por IP, `burst=10`, aplicado somente na localização sensível.
- Headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` restritiva e HSTS de 180 dias inicialmente sem `includeSubDomains`.
- Logs PM2: rotação pelo `logrotate` do SO, diária, sete arquivos comprimidos, `maxsize 100M`, com política documentada no runbook; a aplicação continua escrevendo somente em `stdout/stderr`.

Esses números são defaults conservadores de partida, não requisitos de produto; devem permanecer parametrizados/testados no VPS. [ASSUMED]

## Don't Hand-Roll

| Problema | Não construir | Usar | Por quê |
|----------|---------------|-------|---------|
| Commerce/backend | Servidor Express próprio | Medusa v2 | O projeto exige módulos, Admin, workflows e APIs Medusa. |
| Cache/event/workflow | Filas ou event bus caseiros | Módulos Redis Medusa | O framework já define contratos e lifecycle. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/event/redis] |
| JSON logger | Serialização manual com `console.log(JSON.stringify())` | Pino + adapter | Redaction, serializers, níveis e child loggers já existem. [CITED: https://github.com/pinojs/pino] |
| Monitoramento | Endpoint próprio de coleta de erros | Sentry + instrumentation/error handler | O Medusa possui integração oficial. [CITED: https://docs.medusajs.com/resources/integrations/guides/sentry] |
| Certificados TLS | Renovação manual | Certbot Nginx | Automação e rollback são suportados oficialmente. [CITED: https://eff-certbot.readthedocs.io/en/stable/using.html#nginx] |
| Supervisão | Scripts shell em loop | PM2 + systemd | PM2 gera startup e restaura a lista salva. [CITED: https://pm2.keymetrics.io/docs/usage/startup/] |
| Pool de conexões | Proxy PostgreSQL próprio | Supavisor session pooler | O Supabase já oferece o modo adequado ao backend persistente. [CITED: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx] |

**Key insight:** o código customizado desta fase deve ser política do projeto — schema de ambiente, sanitização, adapters e probes — e não reimplementação de infraestrutura já mantida por Medusa, Supabase, Redis, Sentry, PM2 ou Nginx.

## Common Pitfalls

### Pitfall 1: Wiring Redis de documentação antiga

**O que dá errado:** usar `redis.url` no workflow engine ou iniciar no módulo de cache legado.
**Por quê:** exemplos anteriores a 2.12.2 ainda circulam.
**Como evitar:** em 2.16 usar `redis.redisUrl`; preferir `@medusajs/medusa/caching` + `@medusajs/caching-redis`. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis]
**Sinal:** warning de opção depreciada ou fallback inesperado.

### Pitfall 2: “Pooled” interpretado como transaction pooler

**O que dá errado:** migrations/prepared statements falham em `:6543`.
**Por quê:** Supabase oferece mais de um modo pooled.
**Como evitar:** runtime em session pooler `:5432`; migração em direct/session `:5432`; rejeitar `:6543` e indicadores equivalentes no comando de deploy. [CITED: https://github.com/supabase/supabase/blob/master/apps/docs/content/troubleshooting/disabling-prepared-statements-qL8lEL.mdx]
**Sinal:** prepared-statement errors ou URL de migração no host pooler com porta 6543.

### Pitfall 3: Validação de env tarde demais

**O que dá errado:** módulos começam a conectar e vazam URLs em exceptions antes do fail-fast.
**Como evitar:** `env.ts` deve ser o primeiro import de configuração e seus erros devem listar somente nomes de variáveis/regras, nunca valores.
**Sinal:** stack de startup contém connection strings.

### Pitfall 4: Redaction só por chave

**O que dá errado:** `err.message` contém uma URL com senha, JWT ou assinatura e passa como string.
**Como evitar:** allowlist de campos + serializer de erro que saneia strings + testes com canários (`sk_live_`, `whsec_`, bearer, URL com credencial, PAN e token).
**Sinal:** teste negativo encontra parte do valor secreto.

### Pitfall 5: Sentry com PII “desligada”, mas contexto ainda amplo

**O que dá errado:** headers são anexados ao evento, mesmo com cookies/IP padrão desabilitados.
**Como evitar:** `sendDefaultPii: false`, `beforeSend`, `beforeBreadcrumb`, remoção explícita de request headers/body/user/IP e tags somente de allowlist. [CITED: https://docs.sentry.io/platforms/javascript/guides/node/data-management/data-collected]
**Sinal:** evento de teste mostra `authorization`, `cookie`, URL de dependência ou body.

### Pitfall 6: Health check causar outage

**O que dá errado:** probes sem timeout penduram workers HTTP ou geram tempestade de logs/Sentry.
**Como evitar:** paralelo, timeout curto, sem retry interno, sem log saudável e sem Sentry para dependência esperadamente down.
**Sinal:** `/health/ready` demora mais que o timeout do Nginx ou aparece como erro repetitivo no Sentry.

### Pitfall 7: Produção inicia a árvore errada

**O que dá errado:** PM2 executa TypeScript/source ou `medusa start` fora da build.
**Como evitar:** `medusa build`, verificar `.medusa/server`, instalar dependências conforme o artefato e iniciar a build de produção com cwd explícito. [CITED: https://docs.medusajs.com/resources/medusa-cli/commands/build]
**Sinal:** funciona em `medusa develop`, falha sob PM2.

### Pitfall 8: Nginx mistura superfícies

**O que dá errado:** `/app` aparece em `api.*` ou webhooks respondem em `admin.*`.
**Como evitar:** testes por `Host`/HTTPS nos dois vhosts; API bloqueia `/app`, Admin só encaminha `/app*`.
**Sinal:** mesmo path sensível retorna 2xx nos dois hosts.

## Code Examples

### Configuração Medusa/Redis por ambiente

```typescript
// Fontes:
// https://docs.medusajs.com/learn/production/worker-mode
// https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis
import { defineConfig } from "@medusajs/framework/utils"
import { env } from "./src/config/env"
import { medusaLogger } from "./src/observability/medusa-logger"

export default defineConfig({
  logger: medusaLogger,
  admin: {
    path: "/app",
    backendUrl: env.API_PUBLIC_URL,
    disable: env.ADMIN_DISABLED,
  },
  projectConfig: {
    databaseUrl: env.DATABASE_URL,
    workerMode: env.WORKER_MODE,
    http: {
      storeCors: env.STORE_CORS,
      adminCors: env.ADMIN_CORS,
      authCors: env.AUTH_CORS,
      jwtSecret: env.JWT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    },
  },
  modules: [
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [{
          resolve: "@medusajs/caching-redis",
          id: "caching-redis",
          is_default: true,
          options: { redisUrl: env.CACHE_REDIS_URL },
        }],
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl: env.EVENTS_REDIS_URL },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl: env.WE_REDIS_URL } },
    },
  ],
})
```

### Sentry no ponto oficial de instrumentação

```typescript
// Fonte: https://docs.medusajs.com/resources/integrations/guides/sentry
import * as Sentry from "@sentry/node"
import { scrubBreadcrumb, scrubEvent } from "./src/observability/sentry-scrub"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  tracesSampleRate: 0,
})

export function register() {}
```

O error handler em `src/api/middlewares.ts` deve chamar `Sentry.captureException(error)` e depois delegar ao `errorHandler()` original, exatamente como no guia oficial, adicionando somente tags saneadas. [CITED: https://docs.medusajs.com/resources/integrations/guides/sentry]

### Probe PostgreSQL

```typescript
// Fonte:
// https://github.com/medusajs/medusa/blob/05d0423aec635cdd61a3676bf80760c4c9112f99/packages/core/framework/src/database/pg-connection-loader.ts
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
await pg.raw("SELECT 1")
```

### Contrato público de readiness

```json
{
  "status": "ready",
  "service": "medusa-backend",
  "timestamp": "2026-06-22T20:00:00.000Z",
  "version": "git-sha-or-release",
  "checks": {
    "postgres": "up",
    "redis": "up"
  }
}
```

Em falha, manter a mesma shape, trocar `status` para `not_ready`, o check afetado para `down` e retornar 503; não retornar host, latência, exception ou URL. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

## State of the Art

| Abordagem antiga | Abordagem atual | Mudança | Impacto |
|------------------|-----------------|---------|---------|
| Medusa 2.15.x | Medusa 2.16.0 | 18/06/2026 | Greenfield deve começar já no minor atual, com secrets obrigatórios e pacotes alinhados. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0] |
| Secret default `supersecret` | Sem fallback em produção | 2.16.0 | O schema do projeto reforça comportamento que o framework já passou a exigir. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.16.0] |
| `redis.url` no workflow engine | `redis.redisUrl` | após 2.12.2 | Evitar config depreciada. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis] |
| Cache Redis monolítico legado | Caching Module + provider Redis | documentação atual 2.16 | Melhor alinhamento com provider architecture. [CITED: https://docs.medusajs.com/resources/infrastructure-modules/caching/providers/redis] |
| Inicialização Sentry ad hoc | `instrumentation.ts` + error handler Medusa | documentação atual | Ponto de extensão carregado automaticamente e captura explícita de HTTP errors. [CITED: https://docs.medusajs.com/resources/integrations/guides/sentry] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Timeout de 1.500 ms por dependência e 2.000 ms global é adequado ao VPS/Supabase escolhidos. | Architecture Patterns | Falso negativo em readiness sob latência real; parametrizar e medir. |
| A2 | API `2m`, Admin `10m`, proxy connect `5s`, read/send `60s` são defaults iniciais adequados. | Recomendações operacionais | Upload futuro ou operação longa pode exigir ajuste; manter parametrizado. |
| A3 | Readiness deve deduplicar e testar todos os endpoints Redis distintos dos quatro contratos. | Architecture Patterns | Pode ser rigoroso demais se algum contrato estiver intencionalmente isolado/manutenido; ainda é coerente com D-12/D-24. |
| A4 | `APP_VERSION` deve usar release/commit SHA do deploy. | Code Examples | Sem pipeline definido, o valor pode ficar `unknown`; o runbook deve torná-lo obrigatório em produção. |
| A5 | Rate limit de `5r/s` com burst 10 e retenção diária por sete rotações são adequados ao MVP. | Defaults operacionais | Pode bloquear automação legítima ou reter dados por tempo inadequado; revisar após tráfego real. |

## Open Questions

1. **Qual dependência local fornecerá Postgres e Redis?**
   - O que sabemos: Node 22.23.0 e npm 10.9.8 estão disponíveis; Redis, `psql`, PM2, Nginx e Certbot não estão instalados; o binário Docker existe via Windows, mas a integração WSL não funciona.
   - Lacuna: não há hoje infraestrutura local executável para o scaffold.
   - Recomendação: Plan 1.1 deve começar com checkpoint humano para habilitar Docker Desktop no WSL ou fornecer URLs de desenvolvimento externas; não esconder essa ausência com mocks.

2. **Onde serão provisionados Redis e Sentry de produção?**
   - O que sabemos: os contratos estão definidos, mas credenciais/serviços não foram inspecionados por segurança.
   - Lacuna: execução real de smoke deploy depende de recursos externos.
   - Recomendação: templates e testes locais entram na fase; deploy real recebe checkpoint humano com URLs/secrets fornecidos fora do git.

## Environment Availability

| Dependência | Requerida por | Disponível | Versão | Fallback |
|------------|---------------|------------|--------|----------|
| Node.js | Todos os slices | ✓ | 22.23.0 | — |
| npm | Scaffold/deps | ✓ | 10.9.8 | — |
| PostgreSQL/`psql` local | Bootstrap/migração | ✗ | — | Supabase dev ou Docker após habilitar WSL |
| Redis/`redis-cli` local | Redis/readiness | ✗ | — | Redis gerenciado dev ou Docker após habilitar WSL |
| Docker | Serviços locais | Parcial | Binário Windows; integração WSL indisponível | Reconfigurar Docker Desktop ou usar serviços remotos |
| PM2 | Runbook produção | ✗ | — | Instalar no VPS; não é bloqueio para código local |
| Nginx | Proxy/TLS | ✗ | — | Validar template em CI/container ou instalar no VPS |
| Certbot | TLS | ✗ | — | Instalar no VPS |
| Supabase | Runtime/migração | Não sondado | — | Requer projeto/URLs fornecidos pelo usuário |
| Sentry | OBS-01 | Não sondado | — | SDK desabilitado sem DSN fora de produção |

**Missing dependencies with no fallback:** nenhuma para concluir pesquisa/planejamento; a execução local real requer uma escolha explícita de Postgres+Redis.

**Missing dependencies with fallback:** Postgres, Redis, PM2, Nginx e Certbot têm caminhos de provisionamento documentáveis; o planner deve inserir checkpoints onde o recurso externo é necessário.

## Validation Architecture

### Test Framework

| Propriedade | Valor |
|-------------|-------|
| Framework | Jest 29.7.x + `@medusajs/test-utils` 2.16.0, gerados/configurados pelo scaffold. [CITED: https://raw.githubusercontent.com/medusajs/dtc-starter/main/apps/backend/package.json] |
| Config file | `apps/backend/jest.config.js` após Plan 1.1 |
| Quick run command | `cd apps/backend && npm run test:unit -- --runTestsByPath <arquivo>` |
| Full suite command | `cd apps/backend && npm run test:unit && npm run test:integration:http` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo | Comando automatizado | Arquivo existe? |
|--------|---------------|------|---------------------|-----------------|
| SETUP-01 | Scaffold compila, inicia e migração usa URL permitida | unit + smoke | `cd apps/backend && npm run build && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts` | ❌ Wave 0 |
| SETUP-02 | Produção exige os quatro contratos Redis e configura providers | unit + integration | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts src/infrastructure/__tests__/redis-config.unit.spec.ts` | ❌ Wave 0 |
| SETUP-03 | API não serve `/app`; Admin serve `/app` e não serve webhooks | smoke Nginx | `bash ops/tests/nginx-routing-smoke.sh` | ❌ Wave 0 |
| SETUP-04 | Ecosystem contém server/worker e worker desabilita Admin | contract test | `node --test ops/tests/pm2-config.test.mjs` | ❌ Wave 0 |
| SETUP-05 | Canários sensíveis não aparecem em logs | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/redaction.unit.spec.ts` | ❌ Wave 0 |
| OBS-01 | Error handler captura evento saneado e preserva resposta Medusa | unit + integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/sentry.spec.ts` | ❌ Wave 0 |
| OBS-02 | Produção gera JSON; local pretty; níveis e correlation ID corretos | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/logger.unit.spec.ts` | ❌ Wave 0 |
| OBS-03 | live=200; ready=200/503; checks paralelos e resposta mínima | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/health.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** teste unitário direcionado ao slice + `cd apps/backend && npm run build`.
- **Per wave merge:** `cd apps/backend && npm run test:unit && npm run test:integration:http`.
- **Phase gate:** build verde, testes completos verdes, smoke Nginx/PM2 verde e checklist manual de deploy revisado antes de `$gsd-verify-work`.

### Wave 0 Gaps

- [ ] Scaffold Medusa e scripts de teste oficiais.
- [ ] `apps/backend/jest.config.js` e `apps/backend/integration-tests/setup.js`.
- [ ] Fixtures de env local/production sem valores reais.
- [ ] Capturador de destino Pino em memória para assertions.
- [ ] Transporte Sentry de teste/mocks que nunca envia rede.
- [ ] Fakes controláveis para probe Postgres/Redis.
- [ ] Script smoke de Nginx executável quando Nginx/container estiver disponível.
- [ ] Teste de contrato do ecosystem PM2 sem iniciar processos.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Aplica | Controle padrão |
|---------------|--------|-----------------|
| V2 Authentication | sim | Auth/Admin Medusa; secrets fortes; MFA documentado para operador. [CITED: https://github.com/medusajs/medusa/releases/tag/v2.15.5] |
| V3 Session Management | sim | `COOKIE_SECRET` obrigatório, TLS, CORS explícito e cookies gerenciados pelo Medusa. |
| V4 Access Control | sim | Host da API bloqueia Admin; host do Admin não publica hooks; worker não publica HTTP. |
| V5 Input Validation | sim | Zod no ambiente; health não aceita input; Nginx limita body. [VERIFIED: npm registry] |
| V6 Cryptography | sim | TLS via Certbot; secrets gerados fora do repo; não criar criptografia própria. |

### Known Threat Patterns for Medusa/Node

| Padrão | STRIDE | Mitigação |
|--------|--------|-----------|
| Secret em log/Sentry | Information Disclosure | Allowlist, redaction por path, string scrubber e testes canário. |
| Admin exposto no host errado | Elevation of Privilege / Information Disclosure | Virtual hosts com allow/deny explícito e smoke por Host. |
| Config insegura aceita | Tampering | Schema fail-fast por ambiente e deploy gate. |
| Transaction pooler em migração | Tampering / Denial of Service | Rejeitar `:6543`; usar direct/session. |
| Health endpoint amplificando falha | Denial of Service | Probes paralelas, timeout, sem retries e sem dependências externas opcionais. |
| Log injection/cardinality | Repudiation / Denial of Service | Rotas normalizadas, campos fixos, sem bodies e sem IDs não confiáveis como labels. |
| Redis/banco públicos | Spoofing / Information Disclosure | Nginx como única borda; bind privado e firewall no runbook. |

## Recomendações Prescritivas por Slice

1. **1.1 Bootstrap:** gerar scaffold 2.16.0 sem storefront fora do repo, importar o monorepo oficial com `apps/backend`, preservar planejamento/docs, fixar Node/lockfile, manter `shared` local e provar `develop`, testes e build.
2. **1.2 Supabase/migrações:** criar schema de env; runtime session pooler; comando de migração sobrescreve `DATABASE_URL` somente no subprocesso com `DATABASE_MIGRATION_URL`; teste rejeita 6543.
3. **1.3 Redis:** configurar caching provider, event bus e workflow engine; produção falha sem qualquer URL; manter quatro nomes mesmo quando iguais.
4. **1.4 Logger:** Pino base + adapter Medusa + correlation ID; JSON prod, pretty local; testes negativos de vazamento antes de Sentry.
5. **1.5 Sentry:** `instrumentation.ts`, hooks de scrubbing, error handler que delega ao padrão; mock transport e smoke manual controlado.
6. **1.6 Health:** live sem dependência; ready com `SELECT 1`/Redis PING em paralelo, 200/503 e sem log saudável.
7. **1.7 Runbook:** PM2 server/worker, Admin desabilitado no worker, Nginx com hosts isolados, TLS, firewall, logrotate do SO, migração antes do restart e rollback.

## Sources

### Primary (HIGH confidence)

- https://github.com/medusajs/medusa/releases/tag/v2.16.0 — versão atual, breaking changes, secrets e correção MikroORM.
- https://docs.medusajs.com/resources/create-medusa-app — scaffold atual, flags e layout.
- https://github.com/medusajs/dtc-starter — monorepo oficial atual.
- https://docs.medusajs.com/learn/production/worker-mode — papéis server/worker e Admin no worker.
- https://docs.medusajs.com/resources/integrations/guides/sentry — `instrumentation.ts` e error handler.
- https://docs.medusajs.com/learn/debugging-and-testing/testing-tools — Jest/test-utils e comandos.
- https://docs.medusajs.com/resources/infrastructure-modules/caching/providers/redis — caching provider.
- https://docs.medusajs.com/resources/infrastructure-modules/event/redis — event bus.
- https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis — workflow engine.
- https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx — modos de conexão.
- https://github.com/supabase/supabase/blob/master/apps/docs/content/troubleshooting/disabling-prepared-statements-qL8lEL.mdx — prepared statements e transaction mode.
- https://github.com/pinojs/pino/blob/v10.1.0/docs/api.md — redaction e serializers.
- https://docs.sentry.io/platforms/javascript/guides/node/ — configuração e coleta de dados.
- https://github.com/redis/ioredis — opções do cliente Redis.
- https://nginx.org/en/docs/http/ngx_http_proxy_module.html — proxy/timeouts/body forwarding.
- https://nginx.org/en/docs/http/ngx_http_limit_req_module.html — rate limiting seletivo.
- https://nginx.org/en/docs/http/ngx_http_headers_module.html — headers.
- https://pm2.keymetrics.io/docs/usage/application-declaration/ — ecosystem files.
- https://pm2.keymetrics.io/docs/usage/startup/ — systemd/save.
- https://eff-certbot.readthedocs.io/en/stable/using.html#nginx — TLS.

### Secondary (MEDIUM confidence)

- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — pesquisa global cruzada com fontes atuais.
- `docs/PRD_Backend_v1.1.md`, `docs/SRS_v1.5.md`, `docs/DB_MODEL_v1.21.md` — requisitos canônicos locais.

### Tertiary (LOW confidence)

- Defaults exatos de timeout/body/retention e estratégia de `APP_VERSION`; validar no ambiente real.

## Metadata

**Confidence breakdown:**
- Standard stack: ALTA — pacotes e APIs confirmados em docs oficiais/registro; releases muito recentes exigem checkpoint.
- Architecture: ALTA — decisões do usuário combinadas com extension points oficiais Medusa.
- Pitfalls: MÉDIA-ALTA — riscos críticos confirmados; thresholds operacionais ainda precisam de medição.
- Validation: MÉDIA — framework oficial conhecido, mas o scaffold e os serviços ainda não existem no workspace.

**Research date:** 2026-06-22
**Valid until:** 2026-06-29 para versões Medusa/Sentry; 2026-07-22 para topologia e padrões estáveis.
