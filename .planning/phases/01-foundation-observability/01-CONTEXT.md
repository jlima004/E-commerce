# Phase 1: Foundation & Observability - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Entregar a fundação executável, segura e observável do backend Medusa v2: bootstrap local, conexões de produção com Supabase/Postgres e Redis, processos HTTP/worker, publicação de API e Admin via Nginx/TLS, configuração validada, logs saneados, Sentry e health checks. Não inclui funcionalidades de catálogo, checkout, pagamentos ou integrações externas de negócio.

</domain>

<decisions>
## Implementation Decisions

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

### Adendo operacional: Heroku/Supabase/Redis (2026-06-26)
- **D-30:** A rota original VPS/PM2/Nginx foi substituída neste ciclo por Heroku como alvo atual de produção. O app validado é `espacoliminar`.
- **D-31:** A release estabilizada é `v27`, commit `d02fd70`, com `APP_VERSION=d02fd70`.
- **D-32:** O runtime atual usa Heroku web/worker dynos: `web.1` e `worker.1` validados como `up`.
- **D-33:** O Postgres de produção permanece Supabase via pooler; migrations rodam pela release phase Heroku com `cd apps/backend && npm run db:migrate:safe`.
- **D-34:** O Redis de produção atual é Heroku Redis com TLS. Redis segue ativo para health e módulos Redis restantes.
- **D-35:** `REDIS_CACHE_PROVIDER_DISABLED=true` está ativo no Heroku; o provider `@medusajs/caching-redis` fica temporariamente desativado por flag para evitar loop TLS/self-signed no Heroku.
- **D-36:** `/health/live` e `/health/ready` foram validados em produção com HTTP 200; `/health/ready` reporta Postgres `up` e Redis `up`.
- **D-37:** Logs filtrados de web/worker para `Redis cache connection error`, `self-signed certificate`, `MaxRetriesPerRequestError` e `ECONNRESET` retornaram vazio.
- **D-38:** Pendência menor: o release dyno ainda pode emitir `ECONNRESET`/`ioredis` durante `db:migrate:safe`. Isso não bloqueou a release nem apareceu no runtime web/worker; investigar depois se migrations podem rodar sem inicializar providers Redis desnecessários.

### the agent's Discretion
- Escolha exata das bibliotecas de schema, logging e integração Sentry, desde que preserve integralmente os contratos acima e as versões compatíveis com Medusa v2.
- Valores exatos de timeouts, limites de body, políticas de retenção do PM2/sistema e formato visual do logger local devem ser definidos na pesquisa/plano com defaults conservadores.
- Nomes concretos dos subdomínios permanecem parametrizados; os templates não devem fixar domínio real.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e requisitos
- `.planning/ROADMAP.md` — objetivo, critérios de sucesso e slices obrigatórios da Fase 1.
- `.planning/REQUIREMENTS.md` — requisitos SETUP-01..05 e OBS-01..03.
- `.planning/PROJECT.md` — limites do backend MVP, stack, segurança e decisões globais.
- `.planning/STATE.md` — política de revisão manual e posição atual do projeto.

### Arquitetura e riscos
- `.planning/research/STACK.md` — versões e wiring recomendado para Medusa, Redis, Supabase, Sentry, PM2 e Nginx.
- `.planning/research/ARCHITECTURE.md` — topologia Medusa v2, processos e pontos de integração.
- `.planning/research/PITFALLS.md` — riscos de segurança, conexão, observabilidade e operação.

### Documentos canônicos do produto
- `docs/PRD_Backend_v1.1.md` — infraestrutura backend, Admin em subdomínio, Redis, observabilidade e health checks.
- `docs/SRS_v1.5.md` — requisitos de TLS, secrets, Admin, PM2, Nginx, Supabase, Redis, Sentry e health check.
- `docs/DB_MODEL_v1.21.md` — restrições de não exposição de secrets, tokens e payloads sensíveis em logs/Sentry.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Não há aplicação Medusa ou código runtime existente; a fase começa pelo scaffold.
- Os documentos em `.planning/research/` fornecem o wiring e a estrutura arquitetural inicial.

### Established Patterns
- Medusa v2 com módulos Redis separados para cache, event bus e workflow engine.
- Configuração e operação devem ser reproduzíveis, parametrizadas e livres de secrets no repositório.
- O caminho financeiro futuro depende de raw webhook body intacto; a fundação de Nginx/logging não pode inviabilizá-lo.

### Integration Points
- `medusa-config.ts` concentrará conexões, módulos Redis, worker mode e configuração HTTP.
- Bootstrap/middleware da aplicação receberá validação de ambiente, logger, Sentry e correlation IDs.
- Rotas `src/api/health/live/route.ts` e `src/api/health/ready/route.ts` exporão os checks.
- Templates de PM2/Nginx e runbook de deploy formarão a superfície operacional da produção.

</code_context>

<specifics>
## Specific Ideas

- O ambiente local deve funcionar bem para desenvolvimento no Cursor e validação isolada.
- O contrato de variáveis deve antecipar futura separação física dos papéis Redis sem exigir isso no MVP.
- O deploy deve rejeitar explicitamente uma URL de migração incompatível com a estratégia do Supabase.
- Observabilidade deve ser útil sem transformar dados de clientes, credenciais ou webhooks em telemetria.

</specifics>

<deferred>
## Deferred Ideas

- Cloudflare/CDN poderá ser avaliado em futura fase de hardening de produção.
- Um ambiente `staging` poderá ser provisionado futuramente usando as convenções preparadas nesta fase.

</deferred>

---

*Phase: 1-Foundation & Observability*
*Context gathered: 2026-06-22*
