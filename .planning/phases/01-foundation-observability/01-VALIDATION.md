---
phase: 1
slug: foundation-observability
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Fase 1 — Estratégia de Validação

> Contrato de validação por fase para amostragem contínua durante a execução.

---

## Infraestrutura de Testes

| Propriedade | Valor |
|-------------|-------|
| **Framework** | Jest 29.7.x + `@medusajs/test-utils` 2.16.0 |
| **Arquivo de configuração** | `apps/backend/jest.config.js` — criado no Wave 0 |
| **Comando rápido** | `cd apps/backend && npm run test:unit -- --runTestsByPath <arquivo>` |
| **Suíte completa** | `cd apps/backend && npm run build && npm run test:unit && npm run test:integration:http` |
| **Tempo estimado** | ~120 segundos após o scaffold |

---

## Taxa de Amostragem

- **Após cada commit de tarefa:** executar o teste direcionado do slice e `cd apps/backend && npm run build`.
- **Após cada wave:** executar `cd apps/backend && npm run test:unit && npm run test:integration:http`.
- **Antes de `$gsd-verify-work`:** build, suítes completas, smoke Nginx e contrato PM2 devem estar verdes.
- **Latência máxima de feedback:** 180 segundos para verificações automatizadas locais.

---

## Mapa de Verificação por Tarefa

| Task ID | Plano | Wave | Requisito | Threat Ref | Comportamento seguro | Tipo | Comando automatizado | Arquivo existe | Status |
|---------|-------|------|-----------|------------|----------------------|------|----------------------|----------------|--------|
| 01-01-01 | 01 | 1 | SETUP-01 | T-01-SC | Pacotes oficiais 2.16.0 são confirmados antes do scaffold | supply-chain gate | `npm view create-medusa-app@2.16.0 version repository.url` + demais pacotes | n/a | ⬜ pending |
| 01-01-02 | 01 | 1 | SETUP-01 | T-01-01 | Scaffold preserva docs, não cria storefront, compila e possui runner mínimo | build + isolated contract | `cd apps/backend && npm run build && npm run test:integration:http -- --runTestsByPath integration-tests/http/bootstrap.spec.ts` | ❌ slice 01 | ⬜ pending |
| 01-02-01 | 02 | 2 | SETUP-01 | T-01-03 | Config production falha cedo e nunca imprime valores sensíveis | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t environment` | ❌ slice 02 | ⬜ pending |
| 01-02-02 | 02 | 2 | SETUP-01 | T-01-04 | Migration rejeita ausência/porta 6543 e não muta env pai | unit + check | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t migration && node scripts/run-migrations.mjs --check-only` | ❌ slice 02 | ⬜ pending |
| 01-02-03 | 02 | 2 | SETUP-01 | T-01-05 | Postgres+Redis reais existem via Docker/WSL ou URLs externas antes do smoke | blocking external smoke | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts && node scripts/run-migrations.mjs --check-only` | após 01-02-02 | ⬜ pending |
| 01-03-01 | 03 | 3 | SETUP-02 | T-01-SC | Provider/cliente oficiais e URLs Redis externas são aprovados antes do install | supply-chain + provisioning gate | `npm view @medusajs/caching-redis@2.16.0 version repository.url && npm view ioredis@5.11.1 version repository.url` | n/a | ⬜ pending |
| 01-03-02 | 03 | 3 | SETUP-02 | T-01-06 | Quatro contratos Redis e ausência de fallback têm RED/GREEN próprio | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/redis-config.unit.spec.ts src/config/__tests__/env.unit.spec.ts` | ❌ slice 03 | ⬜ pending |
| 01-03-03 | 03 | 3 | SETUP-02 | T-01-07 | Providers Redis aprovados estão conectados e compilam | unit + build | `cd apps/backend && npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/redis-config.unit.spec.ts src/config/__tests__/env.unit.spec.ts && npm run build` | após 01-03-02 | ⬜ pending |
| 01-04-01 | 04 | 4 | SETUP-05 | T-01-09 | Canários de secrets, PAN, tokens e URLs credenciadas não saem | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/redaction.unit.spec.ts` | ❌ slice 04 | ⬜ pending |
| 01-04-02 | 04 | 4 | OBS-02 | T-01-10 | Logger gera JSON/pretty e agrupamento estável sem IDs crus | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/logger.unit.spec.ts -t "Pino|output|levels|grouping|cardinality"` | ❌ slice 04 | ⬜ pending |
| 01-04-03 | 04 | 4 | OBS-02 | T-01-11 | Middleware gera/propaga correlation ID e exclui bodies/query values | integration + build | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/logging.spec.ts && npm run build` | ❌ slice 04 | ⬜ pending |
| 01-05-01 | 05 | 5 | OBS-01 | T-01-SC | SDK oficial e DSN de produção fora do Git são aprovados | supply-chain + provisioning gate | `npm view @sentry/node@10.59.0 version repository.url engines` | n/a | ⬜ pending |
| 01-05-02 | 05 | 5 | OBS-01 | T-01-12 | Scrub e fingerprint/tags têm cardinalidade controlada | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/sentry.spec.ts -t "scrub|capture policy"` | ❌ slice 05 | ⬜ pending |
| 01-05-03 | 05 | 5 | OBS-01 | T-01-14 | Sentry captura uma vez e estende o middleware sem sobrescrevê-lo | integration + build | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/logging.spec.ts integration-tests/http/sentry.spec.ts && npm run build` | após 01-05-02 | ⬜ pending |
| 01-06-01 | 06 | 5 | OBS-03 | T-01-16 | Probes Postgres/Redis são paralelos, baratos e limitados por timeout | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/health.spec.ts -t probes` | ❌ slice 06 | ⬜ pending |
| 01-06-02 | 06 | 5 | OBS-03 | T-01-15 | Live/ready retornam 200/503 com shape mínima | integration + build | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/health.spec.ts && npm run build` | após 01-06-01 | ⬜ pending |
| 01-07-01 | 07 | 6 | SETUP-03, SETUP-04 | T-01-18 | Testes RED exigem isolamento por Host e bind explícito em loopback | contract RED | `! node --test ops/tests/pm2-config.test.mjs && ! bash ops/tests/nginx-routing-smoke.sh` | ❌ slice 07 | ⬜ pending |
| 01-07-02 | 07 | 6 | SETUP-03, SETUP-04 | T-01-19 | PM2/Nginx passam com server em 127.0.0.1 e worker sem HTTP | contract + smoke | `node --test ops/tests/pm2-config.test.mjs && bash ops/tests/nginx-routing-smoke.sh` | após 01-07-01 | ⬜ pending |
| 01-07-03 | 07 | 6 | SETUP-03, SETUP-04 | T-01-19 | DNS/TLS/reboot/hosts/readiness reais são comprovados no VPS | blocking deployment gate | `node --test ops/tests/pm2-config.test.mjs && bash ops/tests/nginx-routing-smoke.sh && cd apps/backend && npm run build && npm run test:unit && npm run test:integration:http` | após 01-07-02 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requisitos do Wave 0

- [ ] `apps/backend/jest.config.js` e `apps/backend/integration-tests/setup.js` — única infraestrutura compartilhada criada no plano 01-01.
- [ ] `apps/backend/integration-tests/http/bootstrap.spec.ts` — teste específico do próprio slice 01-01.
- [ ] Cada teste de 01-02..01-07 é criado test-first no plano que implementa o comportamento; nenhum placeholder verde ou `test.todo` futuro é materializado no Wave 0.

---

## Verificações Exclusivamente Manuais

| Comportamento | Requisito | Por que é manual | Instruções |
|---------------|-----------|------------------|------------|
| TLS válido e renovação Certbot | SETUP-03 | Depende de DNS, VPS e emissão externa | Publicar os dois hosts parametrizados, executar `certbot --nginx`, confirmar HTTPS e `certbot renew --dry-run`. |
| Restore após reboot | SETUP-04 | Depende de PM2/systemd no VPS | Executar `pm2 save`, configurar `pm2 startup`, reiniciar o VPS e confirmar server/worker online. |
| Migração real no Supabase | SETUP-01 | Requer credenciais e projeto fornecidos pelo operador | Rodar o comando de migração com `DATABASE_MIGRATION_URL` direct/session e confirmar ausência de erro de prepared statement. |
| Evento de teste no projeto Sentry | OBS-01 | Requer DSN e acesso ao projeto externo | Gerar exceção controlada, confirmar evento e inspecionar ausência dos canários sensíveis. |
| Infra local real | SETUP-01, SETUP-02 | Depende de Docker Desktop/WSL ou serviços externos | Confirmar Postgres+Redis via Docker quando disponível ou exportar URLs externas fora do Git antes dos smokes. |
| Bind privado do Medusa | SETUP-04 | Depende do socket real no VPS | Executar `ss -ltnp` e confirmar `127.0.0.1:9000`, sem `0.0.0.0:9000`/`[::]:9000`. |

---

## Aprovação da Validação

- [x] Todas as 19 tarefas reais estão enumeradas com wave e verificação automatizada; gates externos também têm prova humana bloqueante.
- [x] Não há três tarefas consecutivas sem verificação automatizada.
- [x] O Wave 0 cobre somente runner/setup compartilhado; cada referência específica nasce test-first no próprio slice.
- [x] Nenhum comando usa modo watch.
- [x] Latência esperada de feedback inferior a 180 segundos.
- [x] `nyquist_compliant: true` definido no frontmatter.

**Aprovação:** pendente até o Wave 0 ficar verde.
