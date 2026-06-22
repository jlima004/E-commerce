# Phase 1: Foundation & Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 1-Foundation & Observability
**Areas discussed:** Topologia e domínios, Ambientes e conexões, Logs/redaction/Sentry, Contrato do health check

---

## Topologia e domínios

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Publicação | Mesmo servidor Medusa em subdomínios separados; Admin em rota; deploy separado | Subdomínios separados no mesmo servidor |
| Exposição | Somente Nginx; acesso Medusa temporário; CDN/proxy | Somente Nginx público |
| Política Nginx | Segurança seletiva; proxy mínimo; rate limit global | Segurança seletiva desde o início |
| Artefatos | Templates reproduzíveis; somente runbook; configs preenchidas | Templates parametrizados + runbook |

**User's choice:** API/Admin separados por subdomínio, mesmo HTTP server Medusa, worker PM2 separado e webhooks no domínio da API.

**Notes:** TLS via Let's Encrypt; somente 80/443 públicos; Medusa em interface privada; rate limit apenas em rotas sensíveis; raw webhook body intacto; nenhum secret ou valor sensível de VPS no repositório.

---

## Ambientes e conexões

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Ambientes | Local+production; incluir staging; somente local | Local + production |
| Supabase | Runtime pooled + migração direta; direta para tudo; pooled para tudo | Runtime pooled + migração direta |
| Redis | Uma instância com URLs lógicas; uma variável; instâncias separadas | URLs lógicas separadas |
| Startup | Fail-fast; avisos/defaults; validação somente no deploy | Fail-fast na aplicação |

**User's choice:** Dois ambientes ativos, conexões de runtime/migração separadas, uma instância Redis com contratos por papel e validação tipada obrigatória.

**Notes:** `staging` somente documentado; produção sem fallback in-memory; deploy rejeita URL de migração ausente ou aparentemente ligada a transaction pooler.

---

## Logs, redaction e Sentry

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Formato | JSON em produção; JSON sempre; arquivos da aplicação | JSON em produção, legível localmente |
| HTTP logging | Allowlist; blacklist; sem logs HTTP | Allowlist segura |
| Sentry | Contexto mínimo; contexto amplo; somente stack | Contexto mínimo saneado |
| Severidade | Níveis definidos; todo warn/error no Sentry; só não tratados | Níveis e agrupamento definidos |

**User's choice:** Telemetria estruturada e útil, mas estritamente allowlisted e saneada em todos os ambientes.

**Notes:** Bodies excluídos; `sendDefaultPii: false`; hooks de saneamento; cause chains preservadas; sem duplicação logger/Sentry; eventos esperados não geram ruído.

---

## Contrato do health check

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Endpoints | Live+ready; endpoint único; três endpoints | `/health/live` + `/health/ready` |
| Resposta | Contrato mínimo; diagnóstico detalhado; somente HTTP | Contrato mínimo e estável |
| Execução | Paralela com timeout; sequencial; cache | Paralela, timeout por dependência |
| Operação | Público e silencioso; autenticado; log por chamada | Público, barato e silencioso |

**User's choice:** Liveness de processo e readiness de Postgres/Redis separadas, sem detalhes internos.

**Notes:** Readiness retorna 503/`not_ready` em falha; integrações externas não são verificadas; sem cache; chamadas saudáveis não são logadas; falhas esperadas não vão ao Sentry por padrão.

---

## the agent's Discretion

- Bibliotecas concretas e valores operacionais exatos, desde que respeitem os contratos registrados.

## Deferred Ideas

- Cloudflare/CDN como hardening futuro.
- Provisionamento de `staging` em fase futura.
