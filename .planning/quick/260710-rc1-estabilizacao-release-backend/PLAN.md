---
quick_id: 260710-rc1
slug: estabilizacao-release-backend
status: blocked
scope: release-stabilization-gate-only
classification: BLOCKED
blocker: lint-unavailable-and-integration-db-not-isolated
phase_12_status: not-planned-not-started-blocked
---

# Gate de estabilização do release — Backend RC1

## Objetivo

Qualificar o backend atual como release candidate reproduzível por evidências de Git local/origin, suíte local, build, lint, invariantes financeiras read-only no Supabase, Stripe test mode read-only e migrations. Este gate não inicia nem executa a Phase 12.

## Retomada após rotação

O usuário confirmou que as variáveis foram rotacionadas e reabriu o gate com escopo revisado. Heroku está integralmente fora do escopo. As etapas de produção Heroku, logs do release e runbook de rollback foram canceladas por decisão humana e não contam como falha técnica.

## Limites preservados

- Nenhum runtime, teste, dependência, package ou lockfile pode ser alterado.
- Nenhuma migration, `db:migrate:safe`, mutação de banco, deploy, rollback, tag ou alteração de config pode ser executada.
- Nenhuma chamada mutável a Stripe e nenhuma chamada a Gelato, Resend ou PostHog pode ser feita.
- A Phase 12 permanece não planejada, não iniciada e bloqueada.
- Logs Heroku não podem ser consultados. Se algum valor operacional precisar ser lido por mecanismo não-Heroku, deve ser mantido em constante/processo e nunca impresso.
- Valores públicos ou test-mode devem ser classificados pelo tipo e finalidade antes de qualquer severidade: Stripe `pk_test_*`, Medusa publishable API key, Supabase `sb_publishable_*`/anon, Sentry DSN, PostHog project ingestion key e IDs/chaves operacionais Stripe test-mode não são automaticamente segredo crítico. Chaves pessoais/administrativas continuam sensíveis.

## Etapas planejadas e estado

1. Congelar Git local/origin — repetir após a retomada e registrar SHAs/diffs.
2. Executar suíte local — unit, integrações somente com banco isolado comprovado, lint e build.
3. Verificação estática e de segredos — classificar achados pelo tipo antes da severidade.
4. Produção Heroku — **CANCELADA / FORA DO ESCOPO**.
5. Smoke canônico Supabase — executar somente `SELECT` e sanitizar PII.
6. Stripe test mode read-only — consultar somente os objetos canônicos, sem mutação.
7. Auditoria de migrations — confrontar inventário local com o banco somente por leitura.
8. Logs do release Heroku — **CANCELADA / FORA DO ESCOPO**.
9. Runbook de rollback Heroku — **CANCELADA / FORA DO ESCOPO**.

## Regra de encerramento

A classificação final considera apenas as etapas mantidas no escopo. A tag `v1.0-backend-rc1` permanece apenas proposta e depende de resultado técnico elegível mais aprovação humana separada.
