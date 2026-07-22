---
phase: 12-ops-audit-critical-tests
artifact: validation-plan
status: spec-sdd-checker-passed-awaiting-human-review
created_at: 2026-07-20
updated_at: 2026-07-21
requirements: [OPS-01, OPS-02, TEST-01]
execution_authorized: false
---

# Phase 12 Validation — Ops, Audit & Critical Tests

## Gate status

Este documento planeja a validação; nenhum comando de runtime, teste, migration, provider, deploy ou commit foi executado neste gate.

Resultado atual: **SPEC/SDD COMPLETE — CHECKER PASS — AWAITING HUMAN REVIEW**. O checker documental retornou PASS binário com 0 blockers e 0 warnings. Esse PASS é exclusivamente documental; OPS-01, OPS-02 e TEST-01 continuam incompletos, e a revisão humana permanece obrigatória antes do implementation prompt ou execução.

O resultado de execução futuro é binário:

- **PASS** somente com todas as provas abaixo completas.
- **BLOCKED** se PostgreSQL descartável estiver indisponível, qualquer teste for ignorado, uma baseline regredir, houver resíduo ou qualquer negativa falhar.

## Inherited baseline before Phase 12

Baseline fornecida e preservada como ponto de comparação, não reexecutada durante o PLAN:

| Gate | Baseline |
|------|----------|
| Unit | 49/49 suites; 766/766 tests |
| Modules | 29/29 suites; 463/463 tests |
| HTTP | 14/14 suites; 172/172 tests |
| Lint | 0 errors; 207 warnings |
| Build | PASS |

As contagens finais podem aumentar pelos novos testes, mas nenhuma suite/teste baseline pode desaparecer ou falhar. Warnings de lint não podem crescer sem explicação e revisão humana.

## Validation principles

1. D12-13: suíte híbrida — specs de invariantes nomeados e reuse dos harnesses existentes.
2. D12-14: HTTP/unit provam comportamento; PostgreSQL real prova unique constraints, claims e concorrência.
3. D12-15: somente PostgreSQL local descartável; Redis e providers permanecem doubles.
4. Falta de infraestrutura local não autoriza `skip`, mock substituto ou PASS parcial.
5. Cada slice para no gate manual antes de iniciar a próxima onda.
6. `PHASE12_EXECUTION_BASE_SHA` é capturado no início autorizado do 12-01, registrado em `12-01-SUMMARY.md` e reutilizado até o gate final; worktree limpo não substitui diff base...HEAD.
7. O runner externo possui container/porta/credenciais/guardas/cleanup; somente `medusaIntegrationTestRunner` cria, migra, isola, usa e remove `DB_TEMP_NAME`.

## Per-plan gates

| Plan | Gate técnico obrigatório | Gate negativo obrigatório | Resultado permitido |
|------|--------------------------|---------------------------|--------------------|
| 12-01 | rename Gelato com path descobrível, classe timestamped, referência literal do teste atualizada, DDL preservado, teste unitário focado PASS + ownership único de migrations/isolamento/cleanup em PostgreSQL descartável | manutenção `postgres`; readiness no container; alvo/DSN separados; negativos de allowlist/sinal/Docker; migration descoberta no PostgreSQL descartável; base SHA capturado | PASS/BLOCKED |
| 12-02 | PG service/atomic upsert/concurrency + HTTP GET list/detail | sem email, mutation route, purge ou raw metadata | PASS/BLOCKED |
| 12-03 | matriz integral dos detectores + jobs/claim; SUMMARY propaga PHASE12_EXECUTION_BASE_SHA | sem PaymentAttempt.updated_at, REL-02 ou efeito automático; sua negativa worktree-only é intermediária, nunca autorizadora do PASS final | PASS/BLOCKED |
| 12-04 | helper + job de 15m + hook test-only + dois UNIQUE parciais + seis provas PG de concorrência/retry/terminal dedupe | sem dependência runtime de 12-05, provider, alteração/remoção, terminal ambíguo, actor body/API key ou Strategy A | PASS/BLOCKED |
| 12-05 | registro runtime allowlisted + HTTP de três rotas/failure modes + outcome failure preservando sucesso + inventário 3 IN/76 OUT | sem retry enganoso, segunda execução do domínio, interceptor, approve fictício ou reprocess route | PASS/BLOCKED |
| 12-06 | quatro specs nomeados + cinco specs PG + job/helper/HTTP recovery + suites completas + negativas base...HEAD | sem provider real, skip, resíduo ou drift fora da allowlist de config | PASS/BLOCKED |

## Focused validation commands

Executar somente durante o respectivo execution gate aprovado.

### 12-01 — disposable PostgreSQL foundation

1. Antes de qualquer mudança: `set PHASE12_EXECUTION_BASE_SHA (git rev-parse HEAD)`; registrar o SHA em `12-01-SUMMARY.md`.
2. `cd apps/backend && TMPDIR=/tmp rtk npm run test:unit -- --runTestsByPath src/infrastructure/__tests__/disposable-postgres-harness.unit.spec.ts --runInBand`
3. `cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runTestsByPath src/modules/webhooks/__tests__/disposable-postgres-harness.spec.ts --runInBand`
4. `TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts`
5. `rg -n 'TBD-gelato-fulfillment|Migration20260703000000' apps/backend/src/modules/gelato-fulfillment`

Prova obrigatória do rename Gelato:

- path descobrível;
- classe correspondente ao timestamp;
- teste de referência literal atualizado, sem alterar as demais asserções;
- DDL preservado;
- teste unitário Gelato focado PASS;
- migration descoberta no PostgreSQL descartável.

### 12-02 — OperationalAlert

1. `cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runTestsByPath src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts --runInBand`
2. `cd apps/backend && TMPDIR=/tmp rtk npm run test:integration:http -- --runTestsByPath integration-tests/http/admin-operational-alerts.spec.ts --runInBand`

### 12-03 — detections

1. `cd apps/backend && TMPDIR=/tmp rtk npm run test:unit -- --runTestsByPath src/modules/operational-alert/__tests__/operational-alert-detectors.unit.spec.ts src/jobs/__tests__/operational-alert-scanner.unit.spec.ts src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts --runInBand`

O executor deve registrar em `12-03-SUMMARY.md` o mesmo `PHASE12_EXECUTION_BASE_SHA` de `12-01-SUMMARY.md`. Qualquer comando legado do 12-03 que compare apenas o worktree, inclusive se exigir ausência de diff em `medusa-config.ts`, é evidência focada intermediária e não pode autorizar o resultado final.

### 12-04 — AdminActionLog primitives

1. `cd apps/backend && TMPDIR=/tmp rtk npm run test:unit -- --runTestsByPath src/api/admin/_shared/__tests__/audit-admin-action.unit.spec.ts src/jobs/__tests__/admin-action-log-reconciliation.unit.spec.ts --runInBand`
2. `cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runTestsByPath src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts --runInBand`

O spec PostgreSQL deve usar a API factual de `@medusajs/test-utils@2.16.0`: `hooks.beforeServerStart(container)` resolve `ContainerRegistrationKeys.CONFIG_MODULE` e registra `configModule.modules.admin_action_log = { resolve: "./src/modules/admin-action-log" }`. O runner executa esse hook antes de `initializeDatabase` e `runModulesMigrations`; a evidência deve mostrar migration, trigger, dois UNIQUE parciais, service e seis casos concurrency-safe carregados sem alteração antecipada de `apps/backend/medusa-config.ts` e sem depender de 12-05. O job unit prova `ADMIN_ACTION_ORPHAN_AFTER_MS = 15 * 60_000`, paginação limitada, worker-only, release migration no-op, ausência de provider/mutação e ambiguidades mantidas órfãs.

### 12-05 — factual Admin instrumentation

1. `cd apps/backend && TMPDIR=/tmp rtk npm run test:integration:http -- --runTestsByPath integration-tests/http/admin-refunds.spec.ts integration-tests/http/admin-exchanges.spec.ts --runInBand`
2. `rtk node -e 'const fs=require("fs"),p=require("path"),root="node_modules/@medusajs/medusa/dist/api/admin",domains=new Set(["payments","payment-collections","orders","fulfillments","returns","claims","exchanges"]),walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]),rows=[];for(const f of walk(root).filter(f=>f.endsWith("/route.js"))){const rel=p.relative(root,f);if(!domains.has(rel.split(p.sep)[0]))continue;const s=fs.readFileSync(f,"utf8"),route="/admin/"+rel.replace(/\/route\.js$/,"" ).replace(/\[([^\]]+)\]/g,":$1");for(const m of ["POST","PUT","PATCH","DELETE"]){const a=s.indexOf("const "+m+" = async"),b=s.indexOf("exports."+m+" = "+m+";");if(a<0||b<a)continue;const calls=[...new Set([...s.slice(a,b).matchAll(/core_flows_1\.([A-Za-z0-9_]+)/g)].map(x=>x[1]))];rows.push(m+" | "+route+" | "+calls.join(","))}}console.log(rows.sort().join("\n"));console.log("TOTAL="+rows.length);if(rows.length!==76)process.exitCode=1'`

### 12-06 — named invariants and real constraints

1. `cd apps/backend && TMPDIR=/tmp rtk npm run test:integration:http -- --runTestsByPath integration-tests/http/invariants-inv01-02-order-birth.spec.ts integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts integration-tests/http/invariants-inv08-gelato-single-active.spec.ts integration-tests/http/invariants-inv09-10-refund-decoupling.spec.ts --runInBand`
2. `cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runTestsByPath src/modules/webhooks/__tests__/webhook-event-log.postgres.spec.ts src/modules/checkout-completion/__tests__/checkout-completion-log.postgres.spec.ts src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.postgres.spec.ts src/modules/operational-alert/__tests__/operational-alert.postgres.spec.ts src/modules/admin-action-log/__tests__/admin-action-log.postgres.spec.ts --runInBand`

## Full regression gate

Executar após todos os focused gates PASS:

1. Recarregar `PHASE12_EXECUTION_BASE_SHA` do valor exato registrado em `12-01-SUMMARY.md`.
2. `cd apps/backend && TMPDIR=/tmp rtk npm run test:unit -- --runInBand`
3. `cd apps/backend && TMPDIR=/tmp rtk node scripts/run-disposable-postgres-tests.mjs -- rtk npm run test:integration:modules -- --runInBand`
4. `cd apps/backend && TMPDIR=/tmp rtk npm run test:integration:http -- --runInBand`
5. `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp ADMIN_DISABLED=true HMR_PORT=5173 rtk npm run lint`
6. `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp ADMIN_DISABLED=true HMR_PORT=5173 rtk npm run build`
7. `rtk git diff --check`
8. `rtk git status --short`
9. `rtk git diff --exit-code "$PHASE12_EXECUTION_BASE_SHA"...HEAD -- apps/backend/package.json package-lock.json apps/backend/jest.config.js`
10. `rtk git diff "$PHASE12_EXECUTION_BASE_SHA"...HEAD -- apps/backend/medusa-config.ts` e inspeção allowlisted registrada.

O gate recusa PASS se qualquer SUMMARY ou revisão confiar apenas em worktree limpo, no comando legado do 12-03 ou em ausência total de alteração de `medusa-config.ts`. A única negativa final autorizadora para manifests/Jest é a comparação base...HEAD acima; para `medusa-config.ts`, é obrigatória a inspeção separada do diff base...HEAD, aceitando exclusivamente os registros `operational_alert` e `admin_action_log`.

## PostgreSQL evidence gate

Evidence obrigatória:

- Docker container inicia no banco de manutenção `postgres`, sem `DB_TEMP_NAME` em `POSTGRES_DB`; readiness roda por `docker exec ... pg_isready ... -d postgres`, sem binário no host.
- Runner externo controla container/porta/credenciais/validações/sinais/finally/confirmação residual; `medusaIntegrationTestRunner` controla exclusivamente criação, migrations, isolamento e remoção de `DB_TEMP_NAME=p12_disposable_*`.
- Alternativa separa `P12_DISPOSABLE_DATABASE_URL` de `P12_DISPOSABLE_DB_NAME`; URL aponta a manutenção loopback, alvo tem prefixo, difere do database da URL e é revalidado antes de DROP. O database da DSN nunca é removido.
- Negativos explícitos: host não loopback, nome sem prefixo, alvo igual à manutenção, nome vazio, cleanup fora da allowlist, Docker indisponível e interrupção por sinal.
- Migration discovery pelo `medusaIntegrationTestRunner({ dbName: process.env.DB_TEMP_NAME, ... })`; toda nova invocação Phase 12 passa o nome explicitamente e não executa `rtk medusa db:migrate` contra qualquer DB persistente. Em 12-04, `hooks.beforeServerStart` registra explicitamente `admin_action_log` em `configModule.modules` antes de `runModulesMigrations`, sem depender do wiring runtime de 12-05.
- Rename Gelato provado por path `Migration20260703000000.ts`, classe `Migration20260703000000`, referência literal atualizada em `gelato-fulfillment.unit.spec.ts`, teste focado PASS e diff normalizado vazio contra o SHA-base após substituir somente `MigrationTBDGelatoFulfillment` pelo nome timestamped; o DDL factual permanece equivalente.
- Catálogo PostgreSQL exibindo constraints/índices testados sem incluir credenciais.
- Concorrência iniciada por múltiplas operações/conexões reais, não Promise mocks.
- Cardinalidade/estado final de WebhookEventLog, CheckoutCompletionLog, GelatoFulfillment, OperationalAlert e AdminActionLog.
- Catálogo dos UNIQUE parciais de AdminActionLog e cardinalidade de dois intents concorrentes, dois outcomes, outcome versus reconciliation, dois workers, retry com novo attempt e idempotency_key repetida entre attempts.
- Cleanup do DB/container confirmado mesmo após cenário de falha.
- Classificação explícita da força da evidência: **process-local executado**; **PostgreSQL transacional executado**; **cross-process/dyno inferido pela constraint PostgreSQL compartilhada**; **cross-dyno real não executado e não alegado**.

## Invariant evidence matrix

| Invariant | Spec nomeado | Prova complementar | Aceitação |
|-----------|--------------|--------------------|-----------|
| INV-1 | `invariants-inv01-02-order-birth.spec.ts` | entrypoint/workflow HTTP | checkout/client confirmation e evento não sucedido não criam Order; somente confirmação canônica pode alcançar o entrypoint |
| INV-2 | `invariants-inv01-02-order-birth.spec.ts` | PaymentAttempt state/entrypoint | `pix_expired` e `awaiting_pix_payment`, `awaiting_webhook_confirmation`, `payment_instructions_displayed`, `payment_client_confirmed`, `client_action_required` produzem zero Order |
| INV-3 | `invariants-inv03-04-webhook-idempotency.spec.ts` | route/raw-body/signature | raw body e assinatura válida são obrigatórios; raw body ausente e assinatura ausente/inválida falham antes de DB/workflow |
| INV-4 | `invariants-inv03-04-webhook-idempotency.spec.ts` | WebhookEventLog + CCL PostgreSQL | replay/dedupe deixam um fato/claim canônico sob concorrência |
| INV-8 | `invariants-inv08-gelato-single-active.spec.ts` | GelatoFulfillment PostgreSQL | no máximo um ativo por Order |
| INV-9 | `invariants-inv09-10-refund-decoupling.spec.ts` | refund object webhook | dinheiro finaliza somente por fato refund correto |
| INV-10 | `invariants-inv09-10-refund-decoupling.spec.ts` | Order snapshot | refund não cancela order_status |

## OPS-01 evidence matrix

| Behavior | Evidence |
|----------|----------|
| atomic dedupe/increment/reopen | OperationalAlert PostgreSQL spec |
| fulfillment failed promotion | Gelato relay + scanner unit cases |
| confirmed-without-Order | detector matrix: failed imediato; processing ≥15m; CCL ausente somente com evento `payment_intent.succeeded` inequivocamente correlacionado, `received_at` válido e idade ≥ `CHECKOUT_COMPLETION_STALE_AFTER_MS`; evento fresco/timestamp ausente ou ambíguo não alerta |
| Pix expired | expires_at passed + exact nonterminal status matrix |
| Admin consultability | authenticated list/detail HTTP spec |
| redaction | service/API negative fixtures and greps |

## OPS-02 evidence matrix

| Behavior | Evidence |
|----------|----------|
| append-only | PostgreSQL trigger rejects update/delete |
| actor user-only | route/helper tests for user, missing actor and API key |
| Strategy B | ordered intent/domain/outcome tests and orphan reconciliation |
| intent | append obrigatório antes do domínio; falha impede callback e retorna falha saneada |
| outcome | domínio falho tenta failed e preserva erro original; domínio bem-sucedido preserva sucesso mesmo se audit outcome falhar |
| orphan detection | query paginada encontra somente intents sem terminal e mais antigos que 15 minutos |
| runtime reconciliation | job worker-only/release-mode no-op anexa apenas RefundRequest/ExchangeRequest comprovável e mantém ambiguidade órfã |
| terminal dedupe | UNIQUE parcial garante um outcome/reconciliation por action_attempt_id e conflito devolve o fato canônico |
| refund factual result | outcome requested after reservation |
| exchange factual result | succeeded/failed/blocked by actual transition |
| retries | new attempt rows + reused_idempotency metadata |
| surface inventory | matriz factual individual em 12-05 para 3 handlers custom IN e todos os 76 pares nativos método/path OUT em payments/payment-collections/orders/fulfillments/returns/claims/exchanges; cada linha tem handler/workflow e justificativa; contagem diferente bloqueia; prova de nenhum intercept genérico/implícito |

OPS-02 somente pode ser marcado `COVERED` quando as cinco linhas obrigatórias — intent, outcome, orphan detection, runtime reconciliation e terminal dedupe — estiverem PASS. A concorrência outcome versus reconciliation e dois workers no mesmo órfão precisam deixar um único fato terminal. Os HTTP specs devem provar que falha de audit outcome após domínio persistido conserva status/body de sucesso e callback executado exatamente uma vez.

## Security and redaction negative proofs

Todos devem PASS:

1. Nenhum secret, PAN, tracking token puro, `client_secret`, Pix QR/copia-e-cola, raw webhook body, endereço integral, CPF/CNPJ ou tax ID em alert/audit/evidence.
2. Nenhum actor client-supplied aceito e nenhuma API key persistida como `admin_id`.
3. Nenhuma metadata fora da allowlist nas respostas Admin.
4. Nenhuma chamada real a Stripe, Gelato, Resend, PostHog, Correios, Supabase ou Heroku.
5. Nenhum auto-refund, auto-cancel, Order pré-webhook, reprocess fulfillment ou REL-02.

Comandos:

- `rtk rg -n "sk_live|api\.stripe\.com|gelatoapis\.com|api\.resend\.com|posthog|supabase|heroku" apps/backend/integration-tests/http/invariants-*.spec.ts apps/backend/src/modules/operational-alert apps/backend/src/modules/admin-action-log`
- `rtk rg -n "requested_by_operator_id|created_by_operator_id" apps/backend/src/api/admin/refunds apps/backend/src/api/admin/exchanges`
- `rtk rg -n "reprocess_fulfillment|approve_exchange" apps/backend/src/api/admin apps/backend/src/modules/admin-action-log`
- `rtk git diff --exit-code "$PHASE12_EXECUTION_BASE_SHA"...HEAD -- apps/backend/package.json package-lock.json apps/backend/jest.config.js`

Resultados não vazios só podem ser aceitos quando forem constantes/testes negativos sanitizados e forem classificados linha a linha na evidência; chamadas ou persistência reais bloqueiam o gate.

## Workspace integrity

- `rtk git diff --check` PASS.
- `rtk git status --short` registrado separadamente.
- Nenhum arquivo fora do allowlist do respectivo plano.
- A comparação final por `PHASE12_EXECUTION_BASE_SHA...HEAD` aceita `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts` no 12-01 exclusivamente para atualizar a referência literal do rename; isso não é scope creep e nenhum outro teste pode mudar por esse rename.
- Nenhuma alteração no intervalo base...HEAD em packages, lockfile ou Jest config.
- `apps/backend/medusa-config.ts` pode mudar somente para registrar `operational_alert` e `admin_action_log`; o diff base...HEAD é evidência revisável e qualquer mudança em Redis, cache, event bus, workflow, locking, database, providers, health ou release migration mode bloqueia.
- O `12-03-SUMMARY.md` leva o SHA-base adiante e classifica sua negativa worktree-only como intermediária/superseded pelo gate final; ela nunca é usada isoladamente para PASS.
- Nenhum container/banco/arquivo temporário residual.
- Nenhum commit, push, tag ou deploy sem autorização humana separada.

## Multi-source coverage audit

### GOAL / requirements

| Source item | Coverage | Status |
|-------------|----------|--------|
| Phase goal: failures persisted/consultable | 12-02 + 12-03 | COVERED |
| Phase goal: Admin actions audited | 12-04 + 12-05 | COVERED |
| Phase goal: critical invariant tests | 12-01 + 12-06 | COVERED |
| OPS-01 | 12-02, 12-03, 12-06 | COVERED |
| OPS-02: intent + outcome + orphan detection + runtime reconciliation + terminal dedupe | 12-04, 12-05, 12-06 | COVERED |
| TEST-01 | 12-01, 12-06 | COVERED |

### CONTEXT locked decisions

| Decision | Plan coverage | Status |
|----------|---------------|--------|
| D12-01 alert types | 12-02 | COVERED |
| D12-02 severity | 12-02, 12-03 | COVERED |
| D12-03 lifecycle | 12-02 | COVERED |
| D12-04 dedupe/occurrence | 12-02 | COVERED |
| D12-05 safe entity/error | 12-02, 12-03 | COVERED |
| D12-06 no purge | 12-02 | COVERED |
| D12-07 Gelato local truth | 12-03 | COVERED |
| D12-08 stuck predicates | 12-03 | COVERED |
| D12-09 included Admin actions | 12-04, 12-05 | COVERED |
| D12-10 actor | 12-04, 12-05 | COVERED |
| D12-11 shape/append-only | 12-04 | COVERED |
| D12-12 results | 12-04, 12-05 | COVERED |
| D12-13 hybrid suite | 12-06 | COVERED |
| D12-14 proof levels | 12-01, 12-06 | COVERED |
| D12-15 local environment | 12-01, 12-06 | COVERED |

### Binding human decisions

| Decision | Plan coverage | Status |
|----------|---------------|--------|
| H12-01 email out | 12-02 negative scope | COVERED |
| H12-02 GET list/detail only | 12-02 | COVERED |
| H12-03 full matrix/no generic intercept | 12-05 | COVERED |
| H12-04 Strategy B | 12-04, 12-05 | COVERED |
| H12-05 user-only actor | 12-04, 12-05 | COVERED |
| H12-06 15m/failed immediate | 12-03 | COVERED |
| P12-PLAN-01 planning-only, six plans/four waves/no commit | this plan set + ROADMAP/STATE | COVERED |
| P12-PLAN-R1 audit recovery/execution validation | 12-01, 12-04, 12-05, 12-06 + VALIDATION | COVERED |

### RESEARCH constraints/features

| Research item | Plan coverage | Status |
|---------------|---------------|--------|
| atomic PostgreSQL upsert | 12-02 | COVERED |
| local scanner + transition promotion | 12-03 | COVERED |
| Strategy A infeasible; B required | 12-04/12-05 | COVERED |
| disposable PG gap | 12-01 | COVERED |
| flat HTTP spec discovery | 12-06 | COVERED |
| package legitimacy | no installs planned | EXCLUDED — not applicable |

Deferred/out-of-scope ideas — alert email, mutable alert lifecycle API/UI, generic monitoring, REL-02, Gelato reprocess Admin product flow, provider smokes, Admin UI e2e, load tests — não aparecem como implementation tasks.

Audit result: **PASS — no unplanned source item and no deferred idea implemented**.

## Manual review checklist

- [ ] Seis PLANs existem, são 2–3 tasks e têm arquivos exatos.
- [ ] Waves/dependencies não têm overlap de arquivo na mesma wave.
- [ ] Todas as decisões D12/H12/P12 têm cobertura explícita.
- [ ] Cada plano contém gate manual e resultado PASS/BLOCKED.
- [ ] Nenhum runtime/test/migration/provider/deploy/commit foi executado no PLAN gate.
- [ ] O checker SPEC/SDD passou e o humano revisou o gate antes do implementation prompt ou execução.

## Completion record template

Preencher somente após execução autorizada:

| Field | Value |
|-------|-------|
| Branch/HEAD | — |
| PostgreSQL disposable target | — sanitized — |
| Process-local evidence | executado / não executado |
| PostgreSQL transactional evidence | executado / não executado |
| Cross-process/dyno evidence | inferido pela constraint / não inferido |
| Real cross-dyno execution | não executado e não alegado |
| Focused gates | — |
| Unit final | — |
| Modules final | — |
| HTTP final | — |
| Lint final | — |
| Build final | — |
| Negative proofs | — |
| Cleanup | — |
| Result | PASS / BLOCKED |
| Human approval | — |
