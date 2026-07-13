---
quick_id: 260710-rc1
slug: estabilizacao-release-backend
status: complete
scope: release-stabilization-gate-only
classification: PASS
completed_gate: rc1-f-medusa-lint-contract-recovery
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

## Gate RC1-A — restauração da validação local

Escopo aprovado: reconstruir exclusivamente `node_modules` pelo lockfile e, somente se o lint passasse, executar build e integrações contra um Postgres Docker local e descartável. Não editar runtime, manifests, lockfiles ou variáveis de configuração; não corrigir qualquer defeito revelado.

Ordem obrigatória: baseline Git limpo → `rm -rf node_modules` → `npm ci --include=dev` → provar o binário do ESLint → lint → build → banco descartável e integrações. Uma falha de lint encerra o gate antes de build, Docker e integrações.

## Gate RC1-B — correção restrita do grafo ESLint/AJV

Escopo aprovado: remover exclusivamente o override global raiz `ajv: ^8.0.0`, regenerar apenas o lockfile e validar o grafo antes de lint, unitários e build. `eslint@^9.39.4` e `@medusajs/eslint-plugin@2.16.0` não podem mudar; não pode haver override preventivo de AJV 6, `npm update`, `npm audit fix`, ajuste de lint, runtime, Docker, banco ou migration.

Resultado: a resolução aninhada de AJV 6 restaurou o carregamento de `eslint --version`, mas `npm ls ajv --all` revelou um segundo conflito real no lockfile: `@rushstack/node-core-library@5.13.0` requer `ajv~8.13.0`, enquanto o lockfile mantém `ajv@8.20.0`. Pelo critério explícito do RC1-B, o gate para sem corrigir esse conflito e não prossegue a lint, audit, unitários ou build.

## Gate RC1-C — override AJV limitado ao ramo Rushstack

Escopo aprovado: adicionar somente `overrides["@rushstack/node-core-library@5.13.0"].ajv = "8.13.0"`, preservar AJV 6 nos ramos ESLint, regenerar exclusivamente o lockfile e somente prosseguir para audit, lint, unitários e build se a árvore ficar válida sem atualização ampla. Dependências diretas, runtime, testes, Docker, integrações, bancos, migrations, deploy, tag, push e Phase 12 permanecem fora do escopo.

Resultado: o npm 10.9.8 reconheceu o pacote como `overridden`, mas `npm install --package-lock-only --include=dev --ignore-scripts` manteve o lock existente e a instalação limpa ainda resolveu AJV 8.20.0 para Rushstack. A regeneração com `node_modules` e lockfile ausentes materializou AJV 8.13.0, porém reescreveu 1.787 linhas do lockfile (839 inserções e 948 remoções), caracterizando atualização ampla. Pela regra explícita do gate, o lock RC1-B foi preservado, o gate parou e audit formal, lint, unitários, build e commit não foram executados.

## Gate RC1-E — preservar AJV runtime e escopar override Rushstack

Escopo aprovado: substituir somente o valor do override específico Rushstack de `8.13.0` para `8.20.0`, preservar o lock RC1-B sem reconstrução ampla e comprovar Rushstack em AJV 8.20.0, ESLint/eslintrc em AJV 6.15.0, ambas as árvores `npm ls` válidas e zero mudança de versão runtime. Dependência AJV direta, override global, `npm update`, `npm dedupe`, `npm audit fix`, runtime, testes, Docker, integrações, bancos, migrations, deploy, tag, push e Phase 12 permanecem proibidos.

Ordem aplicada: baseline → troca de uma linha no override → `npm ci` sobre o lock atual → fallback `npm install --package-lock-only --include=dev --ignore-scripts` somente após a primeira instalação não concluir → nova instalação limpa → versões e árvore AJV → comparação semântica → audits → lint. Unitários, build e reprodutibilidade só poderiam rodar após lint PASS.

Resultado: a árvore AJV ficou válida sem mudança de versão runtime e o lockfile permaneceu no diff RC1-B de +68 linhas. Os audits processaram a árvore e mantiveram 8 high/0 critical em produção. O lint passou a executar regras reais, mas falhou com 7 erros e 208 avisos; por isso o RC1-E encerrou `BLOCKED`, sem corrigir lint e sem executar unitários, build, reprodutibilidade ou commit.

## Gate RC1-F — corrigir sete erros reais de lint do Medusa

Escopo aprovado: corrigir somente quatro identificadores de módulo para snake_case, tornar assíncronos os três resolvers públicos de services e atualizar consumidores, tipos e testes diretamente afetados. Regras ESLint, warnings, models, migrations, schemas, lógica financeira, providers, config e integrações reais permaneceram fora do escopo.

Ordem aplicada: baseline sem diff em runtime/testes → auditoria manual de referências → mudanças mínimas → lint dirigido → lint completo → testes dirigidos unitários e contrato de rota totalmente mockado → suíte unitária completa → build → `rm -rf node_modules` e `npm ci --include=dev` → árvore AJV/ESLint → repetição de lint, unitários e build → provas negativas de models/migrations.

Resultado: `PASS`. Lint dirigido e completo encerraram com zero erros; o completo preservou exatamente 208 warnings. Os testes dirigidos passaram (149 unitários e 33 do contrato mockado), a suíte completa passou com 43/43 suites e 676/676 testes, e o build passou antes e depois do `npm ci`. A árvore permaneceu válida com Rushstack AJV 8.20.0 `overridden`, ESLint/eslintrc AJV 6.15.0 e ESLint v9.39.4. Nenhum model ou migration mudou. Um ajuste adicional estritamente tipado em `tracking/lookup/route.ts` foi necessário porque as novas constants tornaram o container gerado mais específico; os dois casts `unknown` não alteram comportamento runtime.
