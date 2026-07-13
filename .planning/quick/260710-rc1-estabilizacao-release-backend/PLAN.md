---
quick_id: 260710-rc1
slug: estabilizacao-release-backend
status: complete
scope: release-stabilization-gate-only
classification: PASS
completed_gate: rc1-h-integration-suite-recovery
phase_12_status: not-planned-not-started-blocked
---

# Gate de estabilização do release — Backend RC1

## Objetivo

Qualificar o backend atual como release candidate reproduzível por evidências de Git local/origin, suíte local, build, lint, invariantes financeiras read-only no Supabase, Stripe test mode read-only e migrations. Este gate não inicia nem executa a Phase 12.

## Retomada após rotação

O usuário confirmou que as variáveis foram rotacionadas e reabriu o gate com escopo revisado. Heroku está integralmente fora do escopo. As etapas de produção Heroku, logs do release e runbook de rollback foram canceladas por decisão humana e não contam como falha técnica.

## Limites preservados

- Até o RC1-G, nenhum runtime ou teste podia ser alterado. O RC1-H autorizou somente `jest.config.js` e os testes comprovadamente afetados; runtime, dependências, package e lockfile permaneceram imutáveis.
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

## Gate RC1-G — integrações isoladas e compatibilidade de upgrade

Escopo aprovado: executar as suítes HTTP e modules contra bancos PostgreSQL 16 independentes em `127.0.0.1:55432`, criar um terceiro schema descartável com o runtime `a729e65`, aplicar o runtime atual sobre esse mesmo schema, comprovar o bootstrap dos quatro módulos renomeados e repetir AJV, ESLint, lint e build. Somente os três bancos locais poderiam receber migrations; runtime, testes, manifests, lockfile, providers externos, Supabase, Heroku, deploy, tag, push e Phase 12 permaneceram fora do escopo.

Ordem aplicada: baseline limpo → container e três bancos descartáveis → guardas localhost → integração HTTP → integração modules → worktree do runtime anterior e `npm ci` → migrations anteriores → snapshot de tabelas/migrations → migrations atuais no mesmo banco → snapshot e prova de não duplicação → bootstrap atual → AJV/ESLint/lint/build → limpeza integral.

Resultado: `BLOCKED`. A suíte HTTP terminou com 4/14 suítes e 12/170 testes falhando; a suíte modules terminou com 1/29 suíte falhando porque um fixture sem testes foi coletado, embora os 454 testes executados tenham passado. As falhas não eram ausência de schema, então os bancos HTTP/modules não receberam migrations nem repetição. A prova de upgrade passou: runtime anterior e atual saíram em 0, 152 tabelas e os contadores de migration 23/175/5 permaneceram idênticos, sem duplicatas. O bootstrap atual atingiu a porta 9011 sem erro dos quatro módulos; Redis carregado pelo `.env` era localhost e nenhum provider externo foi chamado. AJV, ESLint, lint 0/208 e build passaram. Container e worktree foram removidos, mas não há commit documental porque o commit foi autorizado somente após `PASS`.

## Gate RC1-H — recuperação das suítes de integração

Escopo aprovado: corrigir somente a coleta indevida da fixture, reproduzir e classificar as 12 falhas HTTP em quatro bancos PostgreSQL 16 independentes em `127.0.0.1:55433`, ajustar apenas expectativas, mocks e isolamento de ambiente comprovadamente obsoletos, repetir as quatro suítes dirigidas e então executar modules, HTTP, unitários, lint e build completos. Runtime, models, migrations, manifests, lockfile, Supabase, Heroku, providers reais, deploy, rollback, tag, push e Phase 12 permaneceram proibidos.

Ordem aplicada: baseline preservando os quatro documentos RC1 → inventário e `--listTests` → correção mínima de `testMatch` → descoberta exata de `sentry.spec.ts` → Postgres descartável e ambiente sanitizado → reprodução das quatro suítes → diagnóstico sem `UNKNOWN` → correções restritas a quatro specs → repetição dirigida em bancos recriados → modules/HTTP completos → unitários/lint/build → provas negativas de schema/package → limpeza → commits atômicos.

Resultado: `PASS`. A coleta modules caiu de 29 para 28 caminhos removendo exclusivamente `fixtures/payment-start-cart.ts`; 28/28 suítes e 454/454 testes passaram. As quatro suítes dirigidas passaram com 17/17, 24/24, 10/10 e 12/12 testes. HTTP completo passou 14/14 e 170/170; unitários passaram 43/43 e 676/676; lint encerrou com zero erros e 208 warnings; build passou. Nenhum arquivo de runtime, model, migration, manifest ou lockfile mudou. O container e os temporários foram removidos. O commit de testes/configuração é `e45adf9`; não houve commit de runtime.
