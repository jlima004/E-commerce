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
| 01-01-01 | 01 | 1 | SETUP-01 | T-01-01 | Scaffold preserva docs, fixa versões e compila sem storefront | build + smoke | `cd apps/backend && npm run build` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | SETUP-01 | T-01-02 | Produção rejeita URL de migração ausente ou em transaction pooler | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | SETUP-02 | T-01-03 | Produção exige os quatro contratos Redis e não aceita fallback in-memory | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/redis-config.unit.spec.ts` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 3 | SETUP-05, OBS-02 | T-01-04 | Canários de secrets, PAN, tokens e URLs credenciadas não aparecem na saída | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/observability/__tests__/redaction.unit.spec.ts src/observability/__tests__/logger.unit.spec.ts` | ❌ W0 | ⬜ pending |
| 01-05-01 | 05 | 4 | OBS-01 | T-01-05 | Evento Sentry é saneado e não inclui headers, body, PII ou secrets | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/sentry.spec.ts` | ❌ W0 | ⬜ pending |
| 01-06-01 | 06 | 4 | OBS-03 | T-01-06 | Live não consulta dependências; ready retorna 200/503 com resposta mínima | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/health.spec.ts` | ❌ W0 | ⬜ pending |
| 01-07-01 | 07 | 5 | SETUP-03 | T-01-07 | Host API bloqueia `/app`; host Admin bloqueia hooks e publica `/app` | smoke | `bash ops/tests/nginx-routing-smoke.sh` | ❌ W0 | ⬜ pending |
| 01-07-02 | 07 | 5 | SETUP-04 | T-01-08 | PM2 declara server e worker, e o worker desabilita o Admin | contract | `node --test ops/tests/pm2-config.test.mjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requisitos do Wave 0

- [ ] `apps/backend/jest.config.js` e `apps/backend/integration-tests/setup.js` — infraestrutura oficial de testes do scaffold.
- [ ] `apps/backend/src/config/__tests__/env.unit.spec.ts` — fixtures `local` e `production` sem valores reais.
- [ ] `apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts` — contratos Redis e proibição de fallback.
- [ ] `apps/backend/src/observability/__tests__/redaction.unit.spec.ts` — destino Pino em memória e canários sensíveis.
- [ ] `apps/backend/src/observability/__tests__/logger.unit.spec.ts` — JSON de produção, saída local, níveis e correlation ID.
- [ ] `apps/backend/integration-tests/http/sentry.spec.ts` — transporte Sentry falso, sem acesso à rede.
- [ ] `apps/backend/integration-tests/http/health.spec.ts` — fakes controláveis de Postgres e Redis.
- [ ] `ops/tests/nginx-routing-smoke.sh` — smoke por `Host` quando Nginx ou container estiver disponível.
- [ ] `ops/tests/pm2-config.test.mjs` — teste estrutural do ecosystem sem iniciar processos.

---

## Verificações Exclusivamente Manuais

| Comportamento | Requisito | Por que é manual | Instruções |
|---------------|-----------|------------------|------------|
| TLS válido e renovação Certbot | SETUP-03 | Depende de DNS, VPS e emissão externa | Publicar os dois hosts parametrizados, executar `certbot --nginx`, confirmar HTTPS e `certbot renew --dry-run`. |
| Restore após reboot | SETUP-04 | Depende de PM2/systemd no VPS | Executar `pm2 save`, configurar `pm2 startup`, reiniciar o VPS e confirmar server/worker online. |
| Migração real no Supabase | SETUP-01 | Requer credenciais e projeto fornecidos pelo operador | Rodar o comando de migração com `DATABASE_MIGRATION_URL` direct/session e confirmar ausência de erro de prepared statement. |
| Evento de teste no projeto Sentry | OBS-01 | Requer DSN e acesso ao projeto externo | Gerar exceção controlada, confirmar evento e inspecionar ausência dos canários sensíveis. |

---

## Aprovação da Validação

- [x] Todas as tarefas previstas têm verificação automatizada ou dependência explícita do Wave 0.
- [x] Não há três tarefas consecutivas sem verificação automatizada.
- [x] O Wave 0 cobre todas as referências ainda inexistentes.
- [x] Nenhum comando usa modo watch.
- [x] Latência esperada de feedback inferior a 180 segundos.
- [x] `nyquist_compliant: true` definido no frontmatter.

**Aprovação:** pendente até o Wave 0 ficar verde.
