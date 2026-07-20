---
phase: 12-ops-audit-critical-tests
artifact: discussion-log
status: plan-revised-checker-passed-awaiting-human-re-review
created_at: 2026-07-16
updated_at: 2026-07-20
scope: planning-only-gate
---

# Phase 12 Discussion Log — Ops, Audit & Critical Tests

## Documents consulted

| Document | Role |
|----------|------|
| `.planning/PROJECT.md` | Core value, Active requirements including OperationalAlert/AdminActionLog/critical tests |
| `.planning/ROADMAP.md` | Phase 12 goal/success criteria; Phase 09 minimal alert note; Phase 11 closure |
| `.planning/REQUIREMENTS.md` | OPS-01, OPS-02, TEST-01; REL-02 deferred sweeper |
| `.planning/STATE.md` | Stabilization closed; Phase 12 gate tracking |
| `.planning/config.json` | Interactive/manual gates; discuss_mode; no auto-advance |
| `.planning/phases/11-refunds-exchanges-admin/11-CLOSURE.md` | Refund/exchange complete; broad alert/audit deferred to Phase 12 |
| `.planning/phases/10-secure-guest-tracking/10-CLOSURE.md` | TRK-01/TRK-02 complete; hash-only token and public lookup boundary |
| `.planning/phases/09-gelato-fulfillment-webhook/09-CLOSURE.md` | FUL-01..04/WHK-03 complete; local operator-attention truth |
| `.planning/phases/11-refunds-exchanges-admin/11-04-SUMMARY.md` | Validation evidence; no Phase 12 start |
| `.planning/phases/09-gelato-fulfillment-webhook/*` | Minimal operator attention contract; Gelato stale/dead-letter |
| `.planning/quick/260715-infra01-release-infrastructure/SUMMARY.md` | INFRA-01 PASS; Redis fail-fast; closed |
| `.planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md` | CACHE-01A PASS; TLS shape; closed |
| `.planning/quick/260715-rel01-runtime-version/SUMMARY.md` | REL-01 PASS; version resolution; closed |
| `.planning/quick/260716-p3o-encerrar-formalmente-a-estabiliza-o-no-s/260716-p3o-SUMMARY.md` | Formal stabilization closure |
| `docs/PRD_Backend_v1.1.md` | Alert/audit product language; email Must-Have tension |
| `docs/DB_MODEL_v1.21.md` | §4.14 AdminActionLog, §4.16 OperationalAlert, DATA rules |
| `docs/SRS_v1.5.md` | Secondary; superseded on Order-before-payment wording |
| Installed `@medusajs/framework@2.16.0` | `AuthContext`, `/admin` authenticate middleware |
| Runtime inventory under `apps/backend/src` | PaymentAttempt, CheckoutCompletionLog, WebhookEventLog, GelatoFulfillment, Admin routes, tests |

## CONTEXT gate (prior)

Recorded as D12-01 … D12-15 in `12-CONTEXT.md`. Human review accepted CONTEXT before RESEARCH.

## RESEARCH gate

### Subagents used

| Track | Focus |
|-------|-------|
| Track 1 | Admin auth Medusa v2 (installed types + docs) |
| Tracks 2–4 | OperationalAlert schema, detection, Admin read surface |
| Track 5 | AdminActionLog inventory, Strategy A/B, actor fail-closed |
| Tracks 6–8 | Invariant suite, modules/migrations, documentary inconsistencies |
| gsd-phase-researcher | Synthesize `12-RESEARCH.md` |
| P12-RESEARCH-R1 subagents | Medusa cross-module transactions, PostgreSQL atomic upsert, test/document audit |

### Binding human decisions applied

| ID | Outcome in RESEARCH |
|----|---------------------|
| H12-01 | Alert email out; PRD divergence recorded; not OPS-01 blocker |
| H12-02 | Minimal GET list+detail `/admin/operational-alerts`; dashboard out |
| H12-03 | Full Admin mutation matrix; no generic `/admin/*` intercept |
| H12-04 | **Strategy A infeasible** without safe cross-module transaction proof; **Strategy B append-only** selected |
| H12-05 | Fail closed without actor; no unknown/system/null `admin_id` |
| H12-06 | `CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000` fixed as local operational window, not Stripe SLA; persisted CCL `failed` is the explicit no-extra-wait exception |

### Research classification

**PASS** — see `12-RESEARCH.md` §1.

### Key RESEARCH recommendations (summary)

- Admin actor policy: require `actor_type === "user"` + non-empty `actor_id`; API key fails closed and is never stored as `admin_id`.
- Modules: `operational_alert`, `admin_action_log`.
- OperationalAlert: one PostgreSQL `ON CONFLICT DO UPDATE`, exact atomic increment/reopen through the total logical-key constraint.
- AdminActionLog: Strategy B correlated append-only intent/outcome rows; refund outcome is a second correlated `result=requested` row with RefundRequest.id; no mutation without a preceding audit row.
- Detection: Gelato transition upsert + narrow scanner; CCL `processing` uses `locked_at`, CCL `failed` alerts immediately, absent CCL uses a specific canonical confirmation timestamp; Pix uses `expires_at`.
- Ack/resolve/ignore APIs deferred (fields-only).
- TEST-01: flat `integration-tests/http/invariants-inv*.spec.ts` for HTTP doubles, unit predicates/state machines, and disposable real PostgreSQL for constraints/claims/concurrency.

### Items still for PLAN (not decided as locked)

See `12-RESEARCH.md` §17 (scanner cron, exchange action mapping, Strategy B reconciliation, constant placement, disposable-PG harness mechanics, migration style, etc.). Actor policy, blocked audit behavior, Jest layout and proof levels are no longer open.

## Alternatives evaluated (CONTEXT + RESEARCH)

### OperationalAlert breadth

| Option | Outcome |
|--------|---------|
| A. Only `payment_stuck` + `fulfillment_failed` | **Accepted** |
| B. Also alert analytics/email dead-letter | Rejected |
| C. Infra/Redis/health alerts | Rejected |

### AdminActionLog atomicity

| Option | Outcome |
|--------|---------|
| A. One terminal immutable row atomically committed with domain | **Rejected in R1** — safe shared transaction across separate modules not proved |
| B. Correlated append-only intent/outcome rows | **Accepted in R1** |

### Fulfillment alert trigger

| Option | Outcome |
|--------|---------|
| A. Transition-site upsert + scanner backstop | **Accepted (RESEARCH)** |
| B. Scanner-only | Rejected as primary |

### Alert email in Phase 12

| Option | Outcome |
|--------|---------|
| A. Persist OperationalAlert only; defer email | **Accepted** (H12-01) |
| B. Implement Resend operational_alert emails now | Rejected |

## Decisions taken

CONTEXT: D12-01 … D12-15.
RESEARCH R1: Strategy B append-only; atomic PostgreSQL alert upsert; user-only actor; local 15m stale window; ack/resolve deferred; reprocess deferred; flat invariant specs under `integration-tests/http/invariants-inv*.spec.ts`; real disposable-PostgreSQL module integration required.

## Unresolved questions

Forwarded to PLAN (`12-RESEARCH.md` §17). No PLAN artifact created in this gate.

## Items rejected by scope

- Dashboard / PagerDuty / Slack / alert email
- Event sourcing / SIEM / automated remediation
- REL-02 sweeper / cross-dyno refund lock / Correios API
- Heroku/Redis/health changes; reopening closed stabilization debts
- Phase 13 and reliability v2 bulk import
- PLAN files, runtime implementation, migrations, dependency changes, new tests

## Absence of implementation

Confirmed for this RESEARCH gate:

- No runtime code changes
- No new tests executed or added
- No migrations
- No dependency/lockfile changes
- No PLAN / VALIDATION / implementation-prompt artifacts
- No deploy / push / production changes

## Post-completion factual corrections (same RESEARCH gate)

Incorporated from parallel track agents after first RESEARCH draft:

- Exchange update surface is `POST /admin/exchanges/:id` only (no PATCH export).
- Body spoof debt includes exchange `created_by_operator_id` as well as refund `requested_by_operator_id`.
- Jest HTTP `testMatch` is flat-only → prescribe `integration-tests/http/invariants-inv*.spec.ts`; do not widen config.
- Documentary: REQUIREMENTS unchecked FUL/REF/EXC and PROJECT.md stale checkboxes flagged for pre-PLAN hygiene.

## P12-RESEARCH-R1 human-review blocker corrections

- **R12-01:** Removed the false atomicity claim. Medusa 2.16.0 reuses transaction context within a compatible module manager, but no safe shared transaction was proved across RefundRequest/ExchangeRequest/AdminActionLog. Strategy A is infeasible; Strategy B append-only is required.
- **R12-02:** Replaced create/catch/reload/update with PostgreSQL `ON CONFLICT DO UPDATE`, atomic `occurrence_count + 1`, atomic `last_seen_at`, reopen without duplicate, and explicit cross-dyno-via-shared-constraint/no-global-order limits.
- **R12-03:** Fixed the hybrid proof matrix: mocked HTTP, unit predicates/state machines, real disposable PostgreSQL for WebhookEventLog dedupe, CheckoutCompletionLog claim, GelatoFulfillment single-active, OperationalAlert concurrent upsert, and new migrations/indexes.
- **R12-04:** Fixed MVP actor policy to `actor_type === "user"` and required `actor_id`; API keys fail closed.
- **R12-05:** Fixed the local 15-minute constant, required it for CCL re-claim/retry, recorded persisted CCL `failed` as the explicit no-extra-wait exception, and rejected unstable `PaymentAttempt.updated_at` as confirmation clock.
- **R12-06:** Fixed Jest layout to flat `integration-tests/http/invariants-inv*.spec.ts`.
- **R12-07:** Kept REQUIREMENTS Phase 09–11 checkboxes, PROJECT active checklist, historical production-blocked language, and superseded `REDIS_CACHE_PROVIDER_DISABLED=true` wording as mandatory documentary corrections before PLAN; those documents were not changed in this gate.

## P12-PREPLAN-DOCSYNC

Human review approved Phase 12 CONTEXT and RESEARCH. The mandatory documentary synchronization identified by R12-07 is complete:

- `WHK-03`, `FUL-01..04`, `TRK-01..02`, `REF-01..02`, and `EXC-01..02` are reconciled as complete from the accepted Phase 09–11 closures, including traceability.
- `GelatoFulfillment.requires_operator_attention` / `dead_letter` remains the Phase 09 local fulfillment truth and keeps FUL-04 closed. Phase 12 OPS-01 is the additive promotion to a persisted, consultable `OperationalAlert`; it does not reopen FUL-04.
- The Phase 01 cache-disable checkpoint is explicitly historical and superseded by CACHE-01A PASS, CACHE-01B PASS, INFRA-01 PASS, cache Redis active in `web.1` and `worker.1`, and the formal stabilization closure.
- The Phase 04 activation-blocked wording is historical and superseded by later safe-layer, applied-migration audit, downstream-closure, and stabilization gates. Separately deferred Stripe smokes/config are not overstated.
- PROJECT active checkboxes are reconciled through Phase 11; OPS-01, OPS-02, and TEST-01 remain incomplete.
- OperationalAlert email / Resend remains outside the Phase 12 MVP, is a known PRD divergence, and is not an OPS-01 blocker.
- No PLAN, VALIDATION, SPEC/SDD, implementation prompt, runtime code, test, model, migration, dependency, package/lockfile, deploy, push, or production change was started.

## Gate status

| Step | Status |
|------|--------|
| Human review of `12-CONTEXT.md` | **Approved** |
| RESEARCH (`12-RESEARCH.md`) | **Approved** |
| Pre-PLAN documentary synchronization | **Complete** |
| PLAN | **Complete — checker PASS (0 blockers / 0 warnings); awaiting human review** |
| Execution | blocked |
| Phase 12 plans | 6 planned / 0 executed |
| Milestone progress | 11/12 phases complete; 92% |
| Phase 12 requirements | OPS-01 / OPS-02 / TEST-01 incomplete |
| Next permitted step | Human review of PLAN/VALIDATION; SPEC/SDD and implementation prompt remain not started |

Baseline at P12-RESEARCH-R1 start:

```text
branch=gsd/phase-12-ops-audit-critical-tests
HEAD=5e2ba43
expected worktree=clean
observed pre-existing untracked=.planning/research/.cache/
```

The untracked cache was not edited, deleted or staged during P12-RESEARCH-R1 because it was outside that gate's allowlist. At the P12-PREPLAN-DOCSYNC baseline, `.planning/research/.cache/` was absent; `.gitignore` therefore required no change.

```text
Phase 12 CONTEXT approved
Phase 12 RESEARCH approved
pre-PLAN documentary synchronization complete
PLAN complete: 6 plans / 4 waves
execution blocked
next permitted step: human review of PLAN
```

## P12-PLAN-01

### Authorization and scope

The human explicitly authorized **planning only** on 2026-07-20. This gate created exactly six executable PLAN prompts plus `12-VALIDATION.md`, synchronized this discussion log, ROADMAP and STATE, and did not authorize implementation.

The planning authorization is recorded as binding decision **P12-PLAN-01**:

- exactly six plans;
- Wave 1: disposable PostgreSQL harness/foundation;
- Wave 2: OperationalAlert + Admin GET and AdminActionLog primitives;
- Wave 3: alert detections and factual Admin instrumentation;
- Wave 4: named invariant suites + final validation;
- all slices stop at manual review;
- no runtime edit, test run, migration run, provider call, deploy, push or commit in this gate.

### Plan decomposition

| Wave | Plan | Outcome | Depends on |
|------|------|---------|------------|
| 1 | 12-01 | Local disposable PostgreSQL harness and fail-closed proof foundation | — |
| 2 | 12-02 | OperationalAlert module, atomic upsert and Admin GET list/detail | 12-01 |
| 2 | 12-04 | AdminActionLog append-only primitives and user-only actor guard | 12-01 |
| 3 | 12-03 | Fulfillment/payment-stuck detectors and scanner | 12-02 |
| 3 | 12-05 | Explicit Strategy B instrumentation of refund/exchange Admin routes | 12-04 |
| 4 | 12-06 | INV-1/2, INV-3/4, INV-8, INV-9/10 + PostgreSQL concurrency proof | 12-03, 12-05 |

Same-wave plans have no file overlap. `apps/backend/medusa-config.ts` is changed only in sequential waves: 12-02 registers OperationalAlert and 12-05 preserves it while registering AdminActionLog.

### Decision closure

All 15 locked decisions D12-01..D12-15, all six binding human decisions H12-01..H12-06, and P12-PLAN-01 have explicit plan coverage. The full GOAL/REQ/RESEARCH/CONTEXT audit is in `12-VALIDATION.md` and is PASS with no unplanned item.

### Baseline carried into execution

```text
Unit: 49/49 suites; 766/766 tests
Modules: 29/29 suites; 463/463 tests
HTTP: 14/14 suites; 172/172 tests
Lint: 0 errors; 207 warnings
Build: PASS
```

This baseline was supplied as pre-PLAN evidence and was **not reexecuted** during planning.

### Gate status after planning

```text
Phase 12 CONTEXT approved
Phase 12 RESEARCH approved
Phase 12 PLAN complete: 6 planned / 0 executed
Phase 12 VALIDATION planned
SPEC/SDD not started
implementation prompt not started
execution blocked
next permitted step: human review of PLAN
```

## P12-PLAN-CHECKER-R1 — revision iteration 1/3

O primeiro checker do PLAN retornou **8 BLOCKERs e 1 WARNING**. Esta rodada aplicou correções direcionadas nos seis PLANs, em `12-VALIDATION.md`, ROADMAP e STATE, sem refazer o planejamento e sem alegar PASS antes do recheck.

| Finding do checker | Correção aplicada nesta rodada |
|--------------------|--------------------------------|
| XML malformado em 12-01 Task 2 | fechamento de `<behavior>` corrigido e task reescrita com XML válido |
| Referências inexistentes/históricas | paths substituídos pelos artefatos reais: `webhook-event-log.unit.spec.ts`, migrations `20260701000000`/`20260702000000`, `stripe-webhook-store.spec.ts`, `stripe-webhook-order-creation.spec.ts`, `webhook-order-entrypoint.ts` e `framework/dist/http/types.d.ts` |
| Migration Gelato não descobrível | 12-01 agora planeja renomear o draft factual para `Migration20260703000000.ts`, preservando DDL e provando discovery/catálogo somente no PostgreSQL descartável; nenhuma migration foi criada ou aplicada neste gate |
| CCL ausente sem idade mínima | 12-03/VALIDATION exigem evento canônico correlacionado, `received_at` válido e idade ≥ `CHECKOUT_COMPLETION_STALE_AFTER_MS`; evento fresco, timestamp ausente/inválido ou ambíguo não alerta |
| Inventário Admin nativo agregado | 12-05 enumera e classifica individualmente custom IN e rotas nativas OUT de refund, Order cancel/complete e fulfillment create/cancel/shipment/mark-delivered confirmadas no `@medusajs/medusa@2.16.0`, com prova de não interceptação implícita |
| INV-2/INV-3/INV-4 trocados | 12-06/VALIDATION separam: INV-2 = Pix expirado/aguardando com zero Order; INV-3 = raw body/assinatura fail-closed antes de DB/workflow; INV-4 = replay/dedupe |
| Full modules fora do runner | regressão completa de modules agora passa pelo runner PostgreSQL descartável |
| Cross-dyno não classificado | evidência futura exige as quatro classificações e declara cross-dyno real não executado/não alegado |
| Contagens de rollback/files | 12-01 lista rollback exato dos quatro arquivos de harness + rename Gelato; 12-05 foi então corrigido para onze arquivos (posteriormente rebalanceado para nove na R2) |

Validações desta rodada permanecem exclusivamente documentais/estruturais. Nenhuma suite do produto, build, lint, migration, provider, deploy, push ou commit foi executado. O resultado desta revisão é **AWAITING CHECKER RECHECK**, não PASS.

```text
revision iteration: 1/3
checker input: 8 BLOCKERs + 1 WARNING
revision applied: yes
checker recheck: pending
execution authorized: no
next permitted step: checker recheck dos artefatos PLAN/VALIDATION
```

## P12-PLAN-CHECKER-R2 — revision iteration 2/3

O segundo checker retornou **2 BLOCKERs e 3 WARNINGs**. Esta rodada corrigiu somente os seis PLANs, `12-VALIDATION.md` e este log; CONTEXT, RESEARCH, runtime, testes, configuração e demais documentos permaneceram intocados. O resultado continua **AWAITING CHECKER RECHECK**, sem alegação de PASS.

| Finding do checker | Correção aplicada nesta rodada |
|--------------------|--------------------------------|
| H12-03 incompleto | 12-05 agora contém 3 handlers custom IN e inventário individual de todos os 76 pares nativos método/path realmente exportados sob `payments`, `payment-collections`, `orders`, `fulfillments`, `returns`, `claims` e `exchanges`, com handler/workflow, decisão OUT e justificativa; a execução exige travessia sistemática e bloqueia por divergência. VALIDATION exige a mesma contagem/cobertura e negativas sobre todas as sete famílias. |
| Path inválido em 12-01 | Exact validation command 4 agora usa `apps/backend/medusa-config.ts` e preserva a negativa de manifesto/lockfile/config. |
| `DB_TEMP_NAME` não controlava o runner | 12-01, 12-02, 12-04, 12-06 e VALIDATION exigem `medusaIntegrationTestRunner({ dbName: process.env.DB_TEMP_NAME, ... })`, guardam prefixo loopback/descartável e vinculam catálogo/cleanup ao nome realmente usado. |
| Comandos sem RTK | Todos os executáveis futuros documentados nos seis PLANs e em VALIDATION agora usam prefixo `rtk`; `cd` e atribuições de ambiente permanecem operações do shell. |
| Escopo por arquivos | 12-02 consolidou tipos/casos de service no modelo/service + spec PostgreSQL (9 arquivos); 12-04 fez a mesma consolidação (8 arquivos); 12-05 concentrou regressões nos dois specs HTTP existentes (9 arquivos). Nenhuma cobertura foi removida e waves/dependências permaneceram inalteradas. |

Contagem pós-rebalanceamento:

| Plano | Arquivos modificados | Wave |
|-------|----------------------|------|
| 12-01 | 6 | 1 |
| 12-02 | 9 | 2 |
| 12-03 | 8 | 3 |
| 12-04 | 8 | 2 |
| 12-05 | 9 | 3 |
| 12-06 | 7 | 4 |

Validações desta rodada permanecem exclusivamente documentais/estruturais. Nenhuma suite do produto, build, lint, migration, provider, deploy, push ou commit foi executado.

```text
revision iteration: 2/3
checker input: 2 BLOCKERs + 3 WARNINGs
revision applied: yes
checker recheck: pending
execution authorized: no
result claimed: no PASS
next permitted step: checker recheck dos artefatos PLAN/VALIDATION
```

## P12-PLAN-CHECKER-R3 — revision iteration 3/3

O terceiro checker retornou **1 BLOCKER e 2 WARNINGs**. Esta rodada final corrigiu somente os artefatos allowlisted de planejamento/estado, sem alterar runtime, testes, CONTEXT, RESEARCH, configuração ou outros documentos. O resultado permanece **AWAITING FINAL CHECKER RECHECK**, sem alegação de PASS.

| Finding do checker | Correção aplicada nesta rodada |
|--------------------|--------------------------------|
| 12-04 dependia do registro runtime de 12-05 | O spec PostgreSQL de 12-04 agora usa a API factual de `@medusajs/test-utils@2.16.0`: `hooks.beforeServerStart(container)` resolve `ContainerRegistrationKeys.CONFIG_MODULE` e registra explicitamente `configModule.modules.admin_action_log = { resolve: "./src/modules/admin-action-log" }`. A implementação instalada chama esse hook antes de `initializeDatabase`, `migrateDatabase(appLoader)` e `appLoader.runModulesMigrations`, permitindo provar migration, trigger, service e reconciliação no PostgreSQL descartável sem depender de 12-05 e sem antecipar `medusa-config.ts`. Nenhum config/helper novo foi planejado; 12-04 permanece com 8 arquivos e sem overlap na Wave 2. |
| Negativa 12-01 não era executável | O comando factual passou a ser `rtk git diff --exit-code -- apps/backend/package.json package-lock.json apps/backend/medusa-config.ts` e agora consta em exact validation, negative proof, evidence e VALIDATION. |
| ROADMAP/STATE defasados | ROADMAP, STATE, este log e VALIDATION registram revision 3/3 aplicada, final checker pendente, revisão humana obrigatória, 6 planned/0 executed, SPEC/SDD e implementation prompt não iniciados e execução bloqueada, sem alegar PASS. As métricas permanecem 11 fases completas, 92%, 56 planos totais e 50 completos. |

Contagem final preservada:

| Plano | Arquivos modificados | Wave |
|-------|----------------------|------|
| 12-01 | 6 | 1 |
| 12-02 | 9 | 2 |
| 12-03 | 8 | 3 |
| 12-04 | 8 | 2 |
| 12-05 | 9 | 3 |
| 12-06 | 7 | 4 |

Validações desta rodada permanecem exclusivamente documentais/estruturais via RTK. Nenhuma suite do produto, build, lint, migration, provider, deploy, push ou commit foi executado.

```text
revision iteration: 3/3
checker input: 1 BLOCKER + 2 WARNINGs
revision applied: yes
final checker recheck: pending
human review: pending
execution authorized: no
result claimed: no PASS
next permitted step: final checker recheck dos artefatos PLAN/VALIDATION
```

## P12-PLAN-CHECKER-FINAL — verification passed

Após três rodadas documentais direcionadas e a sincronização mecânica final de `STATE.md`, o checker independente retornou **VERIFICATION PASSED** com **0 blockers e 0 warnings**.

O PASS cobre somente a qualidade e executabilidade documental do PLAN: seis planos, quatro waves, dependências acíclicas, cobertura de OPS-01/OPS-02/TEST-01, 22 decisões fechadas, harness PostgreSQL descartável, `OperationalAlert` com upsert atômico, `AdminActionLog` Strategy B, matriz Admin factual e suíte híbrida INV-1/2/3/4/8/9/10. Nenhum requisito foi implementado ou concluído.

```text
plans: 6 planned / 0 executed
waves: 4
checker: PASS
blockers: 0
warnings: 0
human review: pending
SPEC/SDD: not started
implementation prompt: not started
execution: blocked
next permitted step: human review of PLAN/VALIDATION
```

## P12-PLAN-R1 — audit recovery and execution validation revision

O gate documental foi reaberto exclusivamente para PLAN/VALIDATION. O PASS anterior do checker foi invalidado até nova verificação independente. CONTEXT, RESEARCH, PROJECT, REQUIREMENTS, SPEC/SDD, implementation prompt, runtime, testes, migrations, dependências e execução permaneceram intocados.

Correções incorporadas sem criar sétimo plano nem alterar as quatro waves:

| Requirement | Correção planejada |
|-------------|--------------------|
| R12-PLAN-01 | `12-04` agora cria `admin-action-log-reconciliation.ts` e unit spec, com janela local `15 * 60_000`, worker-only, release migration no-op, paginação limitada e reconciliação apenas de RefundRequest/ExchangeRequest comprovável; `12-05` fornece o registro runtime. |
| R12-PLAN-02 | Migration AdminActionLog exige UNIQUE parcial para intent e UNIQUE parcial conjunto para outcome/reconciliation; service devolve terminal canônico em conflito e seis provas PostgreSQL cobrem concorrência/retry sem uniqueness global de idempotency_key. |
| R12-PLAN-03 | Helper fixa os três contratos de falha: intent impede domínio; domain failure preserva erro original mesmo se append failed falhar; outcome failure após sucesso preserva resposta de sucesso e nunca repete domínio. |
| R12-PLAN-04 | `12-01` define ownership único: runner externo controla container/guardas/cleanup e Medusa controla exclusivamente o DB alvo; Docker inicia em `postgres`, readiness roda no container e DSN/nome alternativos são separados e revalidados. |
| R12-PLAN-05 | `PHASE12_EXECUTION_BASE_SHA` nasce no início autorizado do `12-01`, entra no SUMMARY e alimenta negativas base...HEAD; `medusa-config.ts` recebe inspeção allowlisted revisável em vez de falsa exigência de ausência de diff. |
| R12-PLAN-06 | VALIDATION e `12-06` exigem job/15m, constraints parciais, outcome versus reconciliation, contrato HTTP de sucesso, ownership do DB, SHA-base e config allowlisted. OPS-02 depende de intent + outcome + orphan detection + runtime reconciliation + terminal dedupe. |

Contagem preservada:

| Plano | Wave | Estado |
|-------|------|--------|
| 12-01 | 1 | planned / 0 executed |
| 12-02 | 2 | planned / 0 executed |
| 12-03 | 3 | planned / 0 executed |
| 12-04 | 2 | planned / 0 executed |
| 12-05 | 3 | planned / 0 executed |
| 12-06 | 4 | planned / 0 executed |

```text
Phase 12 PLAN revised
checker: PASS
blockers: 0
warnings: 0
human re-review: pending
SPEC/SDD: not started
implementation prompt: not started
execution: blocked
plans: 6 planned / 0 executed
completed phases: 11
percent: 92
```

## P12-PLAN-R1-CHECKER — verification passed

O checker independente retornou **VERIFICATION PASSED** sem findings após duas iterações documentais direcionadas. O resultado é binário: **PASS**, com 0 blockers e 0 warnings; não há `PASS WITH KNOWN DEBTS`.

O checker confirmou seis planos, quatro waves, dependências acíclicas, executor runtime da reconciliação, um único fato terminal por `action_attempt_id`, preservação de sucesso quando audit outcome falha, ownership único do PostgreSQL descartável, negativas finais baseadas em `PHASE12_EXECUTION_BASE_SHA` e ausência de alterações runtime neste gate documental.

```text
Phase 12 PLAN revised
checker PASS
awaiting human re-review
SPEC/SDD not started
implementation prompt not started
execution blocked
6 planned / 0 executed
completed_phases: 11
percent: 92
```
