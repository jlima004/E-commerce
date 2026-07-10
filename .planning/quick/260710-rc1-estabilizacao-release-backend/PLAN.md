---
quick_id: 260710-rc1
slug: estabilizacao-release-backend
status: blocked
scope: release-stabilization-gate-only
classification: BLOCKED
blocker: accidental-heroku-config-vars-exposure
phase_12_status: not-planned-not-started-blocked
---

# Gate de estabilização do release — Backend RC1

## Objetivo

Qualificar o backend atual como release candidate reproduzível por evidências de Git, suíte local, build, lint, produção read-only, invariantes financeiras, migrations e operação. Este gate não inicia nem executa a Phase 12.

## Resultado desta execução

**BLOCKED.** Durante uma consulta read-only de metadados de releases, o CLI Heroku materializou config vars completas no transcript. Nenhum valor é reproduzido nestes artefatos. Pela regra do gate, todas as verificações foram interrompidas e nenhuma correção ou rotação foi tentada.

## Limites preservados

- Nenhum runtime, teste, dependência, package ou lockfile pode ser alterado.
- Nenhuma migration, `db:migrate:safe`, mutação de banco, deploy, rollback, tag ou alteração de config pode ser executada.
- Nenhuma chamada mutável a Stripe e nenhuma chamada a Gelato, Resend ou PostHog pode ser feita.
- A Phase 12 permanece não planejada, não iniciada e bloqueada.
- O incidente exige um gate de segurança separado, com aprovação humana, para contenção e eventual rotação/revogação.

## Etapas planejadas e estado

1. Congelar Git — concluído antes do blocker; registrar SHAs e diferenças sanitizadas.
2. Executar suíte local — interrompido; não atribuir PASS a execução sem resultado conclusivo.
3. Verificação estática e de segredos — incompleta.
4. Produção read-only — parcialmente concluída; health, dynos e releases obtidos antes do blocker.
5. Smoke canônico Supabase — não executado após a ordem de parada.
6. Stripe test mode read-only — não executado após a ordem de parada.
7. Auditoria de migrations — inventário local parcial; confronto com banco não executado.
8. Logs do release — não executado.
9. Runbook — documentado, não executado e não validado quanto à compatibilidade de schema.
10. Dívidas — registradas sem correção.

## Regra de encerramento

Somente documentação sanitizada e validação local do diff documental são permitidas após o blocker. A tag `v1.0-backend-rc1` não está apta a criação ou publicação. Uma nova execução integral do gate depende da resolução do incidente e de aprovação humana.
