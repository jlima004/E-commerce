---
phase: 12-ops-audit-critical-tests
artifact: implementation-prompt
status: complete-awaiting-human-review
scope: documentation-only
requirements: [OPS-01, OPS-02, TEST-01]
planned_plans: 6
executed_plans: 0
manual_review_gate: true
auto_advance: false
parallelization: false
next_permitted_step: explicit-human-authorization-of-12-01
---

# Phase 12 Implementation Prompt — Ops, Audit & Critical Tests

## 0. Purpose and use

Este documento é o pacote consolidado para a futura execução manual dos seis planos da Phase 12. Ele organiza autoridade, sequência, gates, evidências e condições de parada, mas **não substitui** `12-SPEC.md`, `12-SDD.md`, nenhum `12-0X-PLAN.md` nem `12-VALIDATION.md`. Em caso de dúvida, o executor deve parar e solicitar um novo gate humano; não deve improvisar uma ampliação de escopo.

Estado deste gate:

```text
implementation prompt = documental
execution = não autorizada
6 planned / 0 executed
next executable gate = 12-01 somente após aprovação humana explícita
```

Este documento não autoriza código runtime, testes, migrations reais, Docker, PostgreSQL, dependências, alteração de package/lockfiles, summaries de execução, deploy, push, produção ou Phase 13.

## 1. Authority and boundaries

### 1.1 Fontes vinculantes

Antes de executar qualquer plano autorizado, ler integralmente e tratar como vinculantes:

- `12-CONTEXT.md`;
- `12-RESEARCH.md`;
- `12-SPEC.md`;
- `12-SDD.md`;
- o `12-0X-PLAN.md` ativo;
- `12-VALIDATION.md`;
- o summary do plano predecessor, quando houver;
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` e `.planning/config.json`.

O executor pode consultar runtime somente dentro da leitura e da allowlist estabelecidas no plano explicitamente autorizado. Cada autorização humana abre **um único plano**. Nenhum predecessor concluído autoriza o sucessor.

### 1.1.1 Precedência de contratos aprovados

`12-SPEC.md` e `12-SDD.md` são os contratos finais e mais específicos de comportamento e desenho físico. Os PLANs continuam vinculantes para tasks, arquivos e validações, mas um shorthand histórico de PLAN não pode reintroduzir campo ou comportamento excluído pelo SPEC/SDD final.

A única divergência conhecida já resolvida por essa precedência é `OperationalAlert.sent_at`: o `12-02-PLAN.md` histórico menciona `sent_at = null`, enquanto `12-SDD.md` §3.2 exclui expressamente a coluna e `12-SPEC.md` não a inclui na resposta segura. A execução do `12-02` deve seguir o SDD final e **não criar `sent_at`**. Qualquer outra divergência exige `BLOCKED` e novo gate humano; não autoriza editar os documentos aprovados durante execução.

### 1.2 Sequência operacional obrigatória

Mesmo que o planejamento descreva quatro waves e oportunidades de paralelismo, a configuração vigente é:

```text
parallelization = false
workflow.auto_advance = false
```

A ordem operacional é estritamente:

```text
12-01
→ revisão humana
12-02
→ revisão humana
12-04
→ revisão humana
12-03
→ revisão humana
12-05
→ revisão humana
12-06
→ revisão humana de VERIFICATION
```

Justificativa de dependências:

- `12-01` fornece o PostgreSQL local descartável e a base de prova;
- `12-02` cria `OperationalAlert`;
- `12-04` cria `AdminActionLog` e suas primitivas antes da instrumentação;
- `12-03` depende de `OperationalAlert` para detecção e promoção;
- `12-05` depende de `AdminActionLog` e consolida o registro runtime dos módulos;
- `12-06` executa as provas finais e consolida as evidências.

Qualquer texto histórico dos PLANs que diga que uma aprovação libera waves inteiras, aponte outro sucessor imediato ou ainda descreva SPEC/SDD/implementation prompt como não iniciado fica supersedido somente quanto ao unlock operacional. A ordem sequencial e os gates deste documento são a autoridade de execução; conteúdo técnico, allowlists e validações dos PLANs permanecem vinculantes.

### 1.3 Exclusões globais

Permanecem fora de todos os packets:

- push, deploy, rollback remoto, tag ou alteração de produção;
- Heroku, Supabase, banco externo ou migration de produção;
- providers reais Stripe, Gelato, Resend, PostHog ou Correios;
- Redis, cache, event bus, workflow engine ou locking;
- health contract ou release migration mode;
- dependências, `package.json`, lockfiles ou Jest config;
- alert email, dashboard/Admin UI, API key como ator Admin;
- REL-02, Phase 13 ou fechamento automático da Phase 12.

## 2. Global baseline and execution-base SHA

### 2.1 Preflight de cada autorização

No início de cada gate, antes de qualquer alteração, usar a saída real do Git como fonte de verdade:

```fish
cd /home/jlima/Projetos/ecommerce/Backend

git status --short --untracked-files=all
git branch --show-current
git rev-parse HEAD
git diff --check

git fetch origin
git rev-list --left-right --count origin/main...HEAD
git log --oneline origin/main..HEAD
```

O branch esperado é `gsd/phase-12-ops-audit-critical-tests`. O SHA e a divergência devem ser registrados a partir da saída real, nunca inferidos de um prompt anterior. Parar diante de arquivo desconhecido, staged diff, mudança runtime não explicada ou divergência remota desconhecida. `git fetch` é somente leitura do remoto; **não fazer push**.

### 2.2 SHA-base único da execução

O SHA-base da futura execução **não é** o HEAD anterior a este gate documental. No primeiro instante da autorização futura do `12-01`, antes de qualquer mudança runtime, executar:

```fish
set PHASE12_EXECUTION_BASE_SHA (git rev-parse HEAD)
echo "$PHASE12_EXECUTION_BASE_SHA"
```

Esse valor deve corresponder ao commit documental final deste gate e deve ser registrado literalmente em `12-01-SUMMARY.md`. Todos os planos posteriores devem carregar o mesmo valor, sem recalculá-lo. As negativas e diffs finais usam:

```fish
git diff "$PHASE12_EXECUTION_BASE_SHA"...HEAD
```

Um worktree limpo depois dos commits não substitui a comparação do intervalo. `12-03-SUMMARY.md` deve classificar qualquer negativa apenas de worktree como evidência intermediária, nunca como prova final.

## 3. Global invariants

Os contratos abaixo são vinculantes e não podem ser reinterpretados durante a execução:

```text
OperationalAlert severity:
low | medium | high | critical

AdminActionLog severity:
info | warning | critical

Admin actor:
actor_type === user
actor_id obrigatório

Audit cardinality:
1 intent
0 ou 1 terminal

Terminal:
outcome ou reconciliation

Audit failure after domain success:
preservar sucesso do domínio
não executar domínio novamente
deixar intent órfão
```

Consequências obrigatórias:

- os enums de severity são independentes e nunca podem ser misturados;
- o ator é obtido exclusivamente de `req.auth_context`; body, header arbitrário e API key não definem ator;
- Strategy B persiste intent antes do domínio e outcome depois, com reconciliation apenas para fato local inequívoco;
- dois UNIQUE parciais protegem um intent e um terminal por `action_attempt_id`;
- outcome e reconciliation competem pela mesma cardinalidade terminal; o vencedor é o fato canônico;
- falha ao persistir intent impede o domínio;
- falha de domínio tenta registrar `failed` e devolve o erro original sanitizado;
- falha ao persistir outcome após sucesso durável não muda o sucesso HTTP/do domínio, não repete callback e deixa intent órfão para reconciliation;
- `OperationalAlert` usa upsert PostgreSQL atômico `ON CONFLICT`, ocorrência/reopen e promoção monotônica de severity;
- nenhum detector cria Order, refund, cancelamento ou efeito externo.

## 4. Global stop conditions

Parar imediatamente e classificar o plano como `BLOCKED` se ocorrer qualquer item abaixo:

- branch incorreta;
- worktree inesperadamente sujo, arquivo staged ou arquivo desconhecido;
- commit remoto ou divergência desconhecida;
- arquivo fora da allowlist do plano ativo;
- segredo, senha, DSN integral, token ou payload proibido em logs/evidências;
- tentativa de usar Supabase, Heroku, produção ou banco externo;
- Docker/PostgreSQL local indisponível no `12-01` ou em qualquer prova PostgreSQL;
- teste destrutivo cujo banco não tenha prefixo `p12_disposable_`;
- alvo descartável igual ao database de manutenção ou host não loopback;
- alteração em package/lockfile ou Jest config;
- mudança em Redis, cache, event bus, workflow engine ou locking;
- mudança de health contract ou release migration mode;
- provider externo real;
- teste marcado como skip/ignored/todo por falta de infraestrutura;
- resíduo de banco/container após o runner;
- checker ou validação com warning ou blocker;
- baseline regressiva sem resolução e nova revisão humana;
- necessidade de modificar CONTEXT, RESEARCH, SPEC, SDD, PLAN ou VALIDATION aprovados sem novo gate;
- tentativa de auto-advance, iniciar outro plano, closure ou Phase 13.

O resultado de qualquer gate é binário: `PASS` ou `BLOCKED`. **Não usar `PASS WITH KNOWN DEBTS`.**

## 5. Commit and evidence policy

Para cada plano explicitamente autorizado:

1. confirmar preflight, predecessor e allowlist do plano ativo;
2. trabalhar somente nos arquivos allowlisted por esse plano;
3. não misturar tarefas ou commits de planos diferentes;
4. executar apenas as validações autorizadas pelo packet e pelo plano;
5. executar `git diff --check`;
6. inspecionar nomes, stat e diff completo antes de stage;
7. revisar o staged diff e executar `git diff --cached --check`;
8. criar commit(s) atômicos de implementação pertencentes ao plano, sem amend de commits anteriores;
9. criar o `12-0X-SUMMARY.md` depois desses commits, registrando seus SHAs, e versioná-lo em commit documental separado; o summary não precisa nem pode registrar antecipadamente o SHA do próprio commit;
10. registrar a divergência real com `origin/main`, o estado final do worktree e as negativas;
11. parar para revisão humana, sem push, deploy ou início do próximo plano.

Cada summary deve registrar, no mínimo:

```text
plan
requirements
files changed
tests focused
full gates executados
negative proofs
commit(s)
PHASE12_EXECUTION_BASE_SHA
divergence with origin
worktree state
external systems not contacted
next gate blocked
```

O summary não pode ocultar skip, resíduo, comando não executado, warning ou blocker. Um plano `BLOCKED` continua bloqueado até nova autorização humana; o executor não corrige contratos aprovados por conta própria.

## 6. Execution packet — 12-01

### Authority

Referências vinculantes: `12-01-PLAN.md`, `12-SPEC.md`, `12-SDD.md` e `12-VALIDATION.md`. Este é o **único** plano que poderá ser autorizado no primeiro gate de execução.

### Required outcome

- criar o runner/harness PostgreSQL local descartável previsto no plano, sem dependência nova;
- iniciar o container no banco de manutenção `postgres`, nunca com o alvo em `POSTGRES_DB`;
- restringir host e porta publicada a loopback;
- gerar/validar `DB_TEMP_NAME=p12_disposable_*`;
- manter ownership separado: runner externo controla container, porta, credenciais, guardas, sinais, `finally` e confirmação de cleanup; `medusaIntegrationTestRunner({ dbName: process.env.DB_TEMP_NAME })` é o único owner de criação, migrations, isolamento, uso e remoção do banco alvo;
- na alternativa sem Docker, separar `P12_DISPOSABLE_DATABASE_URL` de `P12_DISPOSABLE_DB_NAME`, exigir manutenção loopback, prefixo correto e alvo diferente do database da URL, revalidando antes de DROP;
- tratar Docker/PostgreSQL indisponível como `BLOCKED`, nunca skip;
- renomear a migration Gelato `TBD-gelato-fulfillment.ts` para `Migration20260703000000.ts` e a classe para `Migration20260703000000`;
- atualizar somente a referência literal correspondente em `gelato-fulfillment.unit.spec.ts`;
- preservar DDL factual/equivalente e todas as demais asserções;
- executar o teste Gelato focado e as provas de discovery, isolamento e cleanup previstas no plano;
- não criar `OperationalAlert`, `AdminActionLog` nem os testes finais de invariantes.

### Allowlist exata

Somente estes paths de implementação/teste podem mudar, mais `12-01-SUMMARY.md` como única exceção documental do plano:

```text
apps/backend/scripts/run-disposable-postgres-tests.mjs
apps/backend/integration-tests/postgres/disposable-postgres-harness.ts
apps/backend/src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts
apps/backend/src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts
apps/backend/src/modules/gelato-fulfillment/migrations/TBD-gelato-fulfillment.ts
apps/backend/src/modules/gelato-fulfillment/migrations/Migration20260703000000.ts
apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts
```

### Gate and evidence

Capturar `PHASE12_EXECUTION_BASE_SHA` antes da primeira mudança. Provar readiness no banco `postgres`, discovery da migration, isolamento, cleanup e ausência residual sem registrar senha ou DSN integral. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-01-SUMMARY.md
```

Parar após o summary. `12-02` permanece bloqueado até revisão e autorização humana explícita.

## 7. Execution packet — 12-02

### Authority

Referências vinculantes: `12-02-PLAN.md`, `12-SPEC.md`, `12-SDD.md`, `12-VALIDATION.md` e `12-01-SUMMARY.md` aprovado.

### Required outcome

- criar o módulo e a migration `OperationalAlert` conforme schema aprovado;
- usar severity exatamente `low | medium | high | critical`;
- implementar dedupe por chave lógica e upsert PostgreSQL atômico `ON CONFLICT`;
- preservar `first_seen_at`, avançar `last_seen_at`, incrementar ocorrência uma vez, promover severity monotonicamente e implementar reopen aprovado;
- provar constraints e concorrência no PostgreSQL descartável obrigatório;
- expor somente Admin GET list/detail com filtros/paginação/allowlist do SPEC;
- não criar mutações ack/resolve/ignore, purge/TTL, dashboard ou alert email;
- não confundir severity de `OperationalAlert` com severity de `AdminActionLog`;
- não contatar provider ou infraestrutura externa.

O schema físico segue o SDD final: **não criar `sent_at`**, apesar do shorthand histórico no PLAN.

### Allowlist exata

Somente estes paths de implementação/teste podem mudar, mais `12-02-SUMMARY.md` como única exceção documental do plano:

```text
apps/backend/src/modules/operational-alert/models/operational-alert.ts
apps/backend/src/modules/operational-alert/migrations/Migration20260720000100.ts
apps/backend/src/modules/operational-alert/service.ts
apps/backend/src/modules/operational-alert/index.ts
apps/backend/src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts
apps/backend/src/api/admin/operational-alerts/route.ts
apps/backend/src/api/admin/operational-alerts/[id]/route.ts
apps/backend/integration-tests/http/admin-operational-alerts.spec.ts
apps/backend/medusa-config.ts
```

### Gate and evidence

Executar os gates focados de módulo/PostgreSQL e HTTP list/detail do plano. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-02-SUMMARY.md
```

Parar após o summary. `12-04` permanece bloqueado até revisão e autorização humana explícita.

## 8. Execution packet — 12-04

### Authority

Referências vinculantes: `12-04-PLAN.md`, `12-SPEC.md`, `12-SDD.md`, `12-VALIDATION.md` e os summaries predecessores aprovados.

### Required outcome

- criar `AdminActionLog`, migration, service, helper de Strategy B e job de reconciliation;
- aceitar ator somente quando `actor_type === "user"` e `actor_id` estiver presente;
- usar severity exatamente `info | warning | critical`;
- implementar dois UNIQUE parciais: um intent e um terminal (`outcome` ou `reconciliation`) por `action_attempt_id`;
- criar trigger PostgreSQL append-only que bloqueie UPDATE/DELETE;
- garantir que o helper execute o callback de domínio no máximo uma vez;
- preservar sucesso do domínio quando o outcome falhar, deixando intent órfão sem repetir o domínio;
- executar `admin-action-log-reconciliation` somente no worker, cron `*/5 * * * *`, com idade mínima de quinze minutos e release migration mode no-op;
- reconciliar somente fatos locais inequívocos; ausência de entidade não prova falha e mantém o intent órfão;
- provar outcome versus reconciliation, dois workers no mesmo órfão e terminal canônico em PostgreSQL real descartável;
- não chamar provider nem executar mutação de domínio durante reconciliation;
- não registrar `admin_action_log` em `medusa-config.ts` neste plano; usar apenas o wiring test-only aprovado. O registro runtime pertence ao `12-05`.

### Allowlist exata

Somente estes 10 paths de implementação/teste podem mudar, mais `12-04-SUMMARY.md` como única exceção documental do plano:

```text
apps/backend/src/modules/admin-action-log/models/admin-action-log.ts
apps/backend/src/modules/admin-action-log/migrations/Migration20260720000200.ts
apps/backend/src/modules/admin-action-log/service.ts
apps/backend/src/modules/admin-action-log/index.ts
apps/backend/src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts
apps/backend/src/jobs/admin-action-log-reconciliation.ts
apps/backend/src/jobs/__tests__/admin-action-log-reconciliation.unit.spec.ts
apps/backend/src/api/admin/_shared/require-admin-actor.ts
apps/backend/src/api/admin/_shared/audit-admin-action.ts
apps/backend/src/api/admin/_shared/__tests__/audit-admin-action.unit.spec.ts
```

### Gate and evidence

Executar helper/job unitários e as seis provas PostgreSQL previstas no plano, incluindo migration, trigger, UNIQUE parciais, concorrência e retry com novo attempt. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-04-SUMMARY.md
```

Parar após o summary. `12-03` permanece bloqueado até revisão e autorização humana explícita.

## 9. Execution packet — 12-03

### Authority

Referências vinculantes: `12-03-PLAN.md`, `12-SPEC.md`, `12-SDD.md`, `12-VALIDATION.md` e os summaries predecessores aprovados.

### Required outcome

- implementar somente a detecção estreita de `payment_stuck` e a promoção de `fulfillment_failed`;
- alertar CCL `failed` imediatamente para payment confirmado sem Order;
- considerar CCL `processing` stale somente pelo `locked_at` válido e idade mínima de quinze minutos;
- considerar CCL ausente somente quando houver `payment_intent.succeeded` canônico, válido, inequivocamente correlacionado e antigo o bastante por `WebhookEventLog.received_at`;
- proibir `PaymentAttempt.updated_at` como relógio;
- cobrir Pix vencido somente nos cinco estados aprovados — `awaiting_pix_payment`, `awaiting_webhook_confirmation`, `payment_instructions_displayed`, `payment_client_confirmed` e `client_action_required` — sem ampliar enum por inferência;
- promover imediatamente a verdade Gelato já persistida: `dead_letter` como `critical` e operator attention/stale elegível como `high`;
- executar scanner `*/5 * * * *`, paginado, worker-only e no-op em release migration mode;
- não chamar Stripe ou Gelato, não criar Order/refund/cancelamento e não implementar REL-02;
- falha de upsert de alerta não reverte a verdade do domínio;
- propagar o `PHASE12_EXECUTION_BASE_SHA` de `12-01-SUMMARY.md`.

### Allowlist exata

Somente estes paths de implementação/teste podem mudar, mais `12-03-SUMMARY.md` como única exceção documental do plano:

```text
apps/backend/src/modules/operational-alert/detectors.ts
apps/backend/src/modules/operational-alert/__tests__/operational-alert-detectors.unit.spec.ts
apps/backend/src/jobs/operational-alert-scanner.ts
apps/backend/src/jobs/__tests__/operational-alert-scanner.unit.spec.ts
apps/backend/src/jobs/gelato-dispatch-relay.ts
apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts
apps/backend/src/modules/checkout-completion/service.ts
apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts
```

### Gate and evidence

Executar a matriz integral de predicates/state/redaction, scanner e promoções prevista no plano. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-03-SUMMARY.md
```

Parar após o summary. `12-05` permanece bloqueado até revisão e autorização humana explícita.

## 10. Execution packet — 12-05

### Authority

Referências vinculantes: `12-05-PLAN.md`, `12-SPEC.md`, `12-SDD.md`, `12-VALIDATION.md` e os summaries predecessores aprovados.

### Required outcome

Instrumentar somente estas três superfícies customizadas:

```text
POST /admin/refunds/request
POST /admin/exchanges
POST /admin/exchanges/:id
```

Contratos vinculantes:

- obter ator exclusivamente de `req.auth_context`; body não define ator;
- rejeitar/fail-closed actor ausente, não-user e spoof de `requested_by_operator_id` ou `created_by_operator_id` conforme o contrato da rota;
- não criar interceptor genérico `/admin/*`;
- não inventar rota Gelato, `reprocess_fulfillment`, approve route ou produto Admin novo;
- preservar Strategy B: intent antes do domínio, callback uma única vez, outcome depois;
- preservar o sucesso do domínio e a resposta de sucesso quando outcome falhar, deixando intent órfão para reconciliation;
- registrar no runtime somente os módulos `operational_alert` e `admin_action_log` nos pontos allowlisted de `medusa-config.ts`;
- executar cron jobs no worker;
- manter release migration mode no-op;
- não alterar Redis, cache, event bus, workflow, locking, database, providers, health ou worker mode;
- manter inventário factual de três superfícies IN e mutações Medusa nativas OUT, conforme o plano; não transformar as rotas nativas em escopo de instrumentação.

### Allowlist exata

Somente estes paths de implementação/teste podem mudar, mais `12-05-SUMMARY.md` como única exceção documental do plano:

```text
apps/backend/medusa-config.ts
apps/backend/src/api/admin/refunds/request/route.ts
apps/backend/src/api/admin/exchanges/route.ts
apps/backend/src/api/admin/exchanges/[id]/route.ts
apps/backend/src/modules/refund-request/service.ts
apps/backend/src/modules/exchange-request/service.ts
apps/backend/src/modules/exchange-request/types.ts
apps/backend/integration-tests/http/admin-refunds.spec.ts
apps/backend/integration-tests/http/admin-exchanges.spec.ts
```

### Gate and evidence

Executar os specs HTTP flat/failure modes e revisar o diff allowlisted de `medusa-config.ts`. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-05-SUMMARY.md
```

Parar após o summary. `12-06` permanece bloqueado até revisão e autorização humana explícita.

## 11. Execution packet — 12-06

### Authority

Referências vinculantes: `12-06-PLAN.md`, `12-SPEC.md`, `12-SDD.md`, `12-VALIDATION.md` e todos os summaries predecessores aprovados.

### Required outcome

- criar/executar os quatro specs HTTP flat: `invariants-inv01-02-order-birth.spec.ts`, `invariants-inv03-04-webhook-idempotency.spec.ts`, `invariants-inv08-gelato-single-active.spec.ts` e `invariants-inv09-10-refund-decoupling.spec.ts`;
- executar unitários de predicates, state e redaction;
- usar PostgreSQL real local descartável para constraints, migrations e concorrência;
- provar INV-1/2/3/4/8/9/10 nos níveis definidos pelo `12-VALIDATION.md`;
- distinguir e provar outcome versus reconciliation;
- provar dois workers concorrendo pelo mesmo intent órfão com um único terminal;
- provar `OperationalAlert` concurrent upsert com cardinalidade, ocorrência e severity finais corretas;
- provar migration discovery, inclusive Gelato renomeada;
- executar gates completos de unit, modules, HTTP, lint e build;
- executar suites PostgreSQL pelo runner descartável, não por Jest direto;
- comparar todo o intervalo desde `PHASE12_EXECUTION_BASE_SHA`;
- revisar linha a linha o diff allowlisted de `apps/backend/medusa-config.ts`;
- provar diff vazio no intervalo para package, lockfile e Jest config;
- classificar honestamente: process-local executado; PostgreSQL transacional executado; cross-process/dyno apenas inferido pela constraint compartilhada; cross-dyno real não executado e não alegado.

### Allowlist exata

Somente estes sete specs novos podem mudar, mais `12-06-SUMMARY.md` como única exceção documental do plano; nenhum runtime existente pode ser alterado:

```text
apps/backend/integration-tests/http/invariants-inv01-02-order-birth.spec.ts
apps/backend/integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts
apps/backend/integration-tests/http/invariants-inv08-gelato-single-active.spec.ts
apps/backend/integration-tests/http/invariants-inv09-10-refund-decoupling.spec.ts
apps/backend/src/modules/webhooks/__tests__/webhook-event-log.postgres.spec.ts
apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.postgres.spec.ts
apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.postgres.spec.ts
```

### Gate and evidence

Qualquer infra indisponível, skip, resíduo, regressão, warning ou negativa falha torna o resultado `BLOCKED`. A saída obrigatória é:

```text
.planning/phases/12-ops-audit-critical-tests/12-06-SUMMARY.md
```

Parar para `VERIFICATION` humana. Não iniciar REVIEW, CLOSURE ou Phase 13.

## 12. Global validation matrix

Baseline herdada de `12-VALIDATION.md`:

| Gate | Baseline mínima sem regressão |
|------|-------------------------------|
| Unit | 49/49 suites; 766/766 tests |
| Modules | 29/29 suites; 463/463 tests |
| HTTP | 14/14 suites; 172/172 tests |
| Lint | 0 errors; 207 warnings |
| Build | PASS |

As contagens finais podem crescer, mas não regredir. Warnings de lint não podem aumentar sem explicação e nova revisão humana. Testes PostgreSQL destrutivos usam exclusivamente infraestrutura local descartável, loopback e banco com prefixo `p12_disposable_`. Ausência dessa infraestrutura é `BLOCKED`, nunca skip.

Matriz mínima de cobertura:

| Contrato | Evidência obrigatória |
|----------|-----------------------|
| INV-1/2 | Order nasce somente após confirmação canônica; estados Pix não terminais/vencidos deixam zero Order |
| INV-3/4 | raw body/assinatura fail-closed; replay, dedupe e concorrência nas constraints reais |
| INV-8 | double trigger/retry mantém no máximo um GelatoFulfillment ativo por Order |
| INV-9/10 | webhook de refund é verdade financeira; refund não cancela `order_status` |
| OPS-01 | upsert/concorrência, predicates estreitos, scanner e promoção Gelato |
| OPS-02 | intent, outcome, orphan detection, runtime reconciliation e terminal dedupe |

## 13. Negative proofs

Cada summary deve declarar e sustentar, conforme aplicável, as seguintes negativas:

```text
sem Stripe real
sem Gelato real
sem Resend real
sem PostHog real
sem Correios real
sem Supabase
sem Heroku
sem deploy
sem push
sem alert email
sem dashboard
sem API key como admin
sem raw payload auditado
sem client_secret
sem QR Pix
sem CPF/CNPJ
sem endereço completo
sem auto-refund
sem auto-cancel
sem REL-02
sem interceptor genérico /admin/*
sem alteração Redis/health/release mode
sem package/lockfile/Jest config
sem migration remota ou produção
sem provider externo
sem auto-advance
```

No gate final, as negativas de integridade usam o intervalo `PHASE12_EXECUTION_BASE_SHA...HEAD`; não se apoiam somente em `git status` limpo. O diff de `medusa-config.ts` pode conter exclusivamente os dois registros aprovados. Dados de evidência devem ser sanitizados e jamais incluir DSN integral, senha, segredo, token, stack/raw payload ou PII proibida.

## 14. Documentary reviewer/checker gate

Antes de aceitar este implementation prompt, um reviewer/checker documental independente deve confirmar:

- [ ] existe um único implementation prompt consolidado;
- [ ] existem seis execution packets;
- [ ] a ordem é `12-01 → 12-02 → 12-04 → 12-03 → 12-05 → 12-06`;
- [ ] há gate manual e proibição de auto-advance após cada plano;
- [ ] `PHASE12_EXECUTION_BASE_SHA` será definido no futuro início autorizado do `12-01`, após o commit documental deste gate;
- [ ] nenhum plano foi executado e nenhum summary de execução foi criado;
- [ ] nenhum runtime, teste, migration real, Docker/PostgreSQL, dependência ou provider foi executado;
- [ ] SPEC, SDD, PLAN e VALIDATION permanecem referências vinculantes e inalteradas;
- [ ] a precedência do SPEC/SDD final resolve `sent_at` sem editar documentos aprovados, e qualquer outra divergência bloqueia;
- [ ] cada packet reproduz a allowlist exata do PLAN ativo mais somente seu `12-0X-SUMMARY.md`;
- [ ] commits atômicos de implementação precedem um commit documental separado do summary, sem amend;
- [ ] `OperationalAlert.severity` e `AdminActionLog.severity` não estão misturados;
- [ ] rename Gelato, classe timestamped, DDL equivalente e referência literal do teste estão contemplados;
- [ ] Strategy B, intent órfão, outcome e reconciliation estão contemplados;
- [ ] PostgreSQL descartável é loopback, prefixado, ownership único e fail-closed;
- [ ] todas as negativas obrigatórias estão presentes;
- [ ] VERIFICATION, REVIEW e CLOSURE permanecem gates separados;
- [ ] OPS-01, OPS-02 e TEST-01 permanecem incompletos;
- [ ] resultado: 0 blockers e 0 warnings.

Qualquer blocker ou warning impede PASS. Não aceitar `PASS WITH KNOWN DEBTS`.

## 15. Final phase boundary

Mesmo depois de um futuro `12-06` aprovado:

```text
execution complete ≠ phase closed
```

Continuam necessários gates humanos separados:

```text
VERIFICATION
REVIEW
CLOSURE
```

Não marcar OPS-01, OPS-02 ou TEST-01 como concluídos antes da evidência e revisão correspondentes. Não alterar `completed_phases`, `completed_plans` ou o percentual antes do gate formal apropriado. Neste momento documental, os invariantes permanecem:

```text
completed_phases: 11
total_plans: 56
completed_plans: 50
percent: 92
Phase 12: 6 planned / 0 executed
execution not started
next permitted step: explicit authorization of 12-01
```

Ao concluir este implementation prompt e obter checker documental `PASS` com 0 blockers e 0 warnings, parar obrigatoriamente para revisão humana. Não executar `12-01`.
