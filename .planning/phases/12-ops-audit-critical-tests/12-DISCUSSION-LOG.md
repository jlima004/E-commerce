---
phase: 12-ops-audit-critical-tests
artifact: discussion-log
status: phase-12-closed
created_at: 2026-07-16
updated_at: 2026-07-23
scope: closure-gate
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

## P12-SPEC-SDD — contracts complete, checker BLOCKED

### Autorização e limite

O humano autorizou separadamente apenas SPEC/SDD em 2026-07-21, com leitura integral, consulta read-only do runtime, uso de subagentes e parada obrigatória para revisão. Foram criados somente `12-SPEC.md` e `12-SDD.md`; este log, ROADMAP e STATE foram sincronizados. Nenhum PLAN/VALIDATION, runtime, teste, migration, package/lockfile, provider, PostgreSQL/Docker, deploy, push ou produção foi alterado/executado.

### Correções factuais de inventário

- O `12-04-PLAN.md` atual contém **10 arquivos**, não 8. As contagens de 8 nas tabelas históricas R2/R3 antecedem a inclusão de `admin-action-log-reconciliation.ts` e seu unit spec pelo P12-PLAN-R1. O PLAN atual é a autoridade; os registros históricos não foram reescritos.
- O contrato antigo do RESEARCH que sugeria devolver falha após erro no append do outcome foi supersedido pelo P12-PLAN-R1/H12-S04: após domínio persistido, preservar status/body de sucesso, não repetir domínio, logar erro saneado e reconciliar o intent órfão.

### Checker documental

Resultado binário: **BLOCKED**. Não há `PASS WITH KNOWN DEBTS`.

| Blocker | Evidência | Impacto |
|---|---|---|
| B12-SPEC-01 — enum de severidade | O prompt SPEC/SDD exige `OperationalAlert.severity = info|warning|critical`; CONTEXT, RESEARCH, DB_MODEL e 12-02/12-03 fixam `low|medium|high|critical`, com detectores emitindo `high|critical`. `info|warning|critical` é o enum de severity do AdminActionLog. | PLAN/VALIDATION precisam de decisão/revisão explícita; não é permitido corrigir silenciosamente. |
| B12-SDD-02 — rename Gelato fora do allowlist | 12-01 renomeia `TBD-gelato-fulfillment.ts` para `Migration20260703000000.ts`, mas `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts` referencia literalmente o nome antigo e não consta em `files_modified`. | A execução quebraria a prova existente ou tocaria arquivo não previsto; 12-01 requer revisão antes da implementação. |

O checker também confirmou que o gate atual foi aberto pela autorização SPEC/SDD desta sessão, portanto o antigo texto “SPEC/SDD not started” era histórico, não um terceiro blocker.

### Estado do gate

```text
Phase 12 SPEC/SDD complete
checker BLOCKED: 2 blockers / 0 warnings
awaiting human review
implementation prompt not started
execution blocked
6 planned / 0 executed
completed_phases: 11
total_plans: 56
completed_plans: 50
percent: 92
OPS-01 incomplete
OPS-02 incomplete
TEST-01 incomplete
commit: not created because PASS was not reached
```

## P12-SPEC-SDD-R1 — blockers documentais resolvidos

### Correções autorizadas

- `OperationalAlert.severity` foi restaurado ao contrato canônico `low|medium|high|critical`, com ordem monotônica `1..4`; os detectores MVP emitem `payment_stuck=high`, `fulfillment_failed/dead_letter=critical` e operator attention/stale reconhecido=`high`.
- `AdminActionLog.severity` permaneceu independente e inalterado em `info|warning|critical`.
- O 12-01 passou a incluir `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.unit.spec.ts` no rename planejado: path, classe exportada e referência literal serão atualizados, as demais asserções serão preservadas e o DDL factual não mudará.
- `12-VALIDATION.md` registra o teste unitário Gelato focado, inspeção por `rg`, discovery no PostgreSQL descartável e a allowlist por SHA-base.

### Checker documental

Resultado binário: **PASS**, com **0 blockers e 0 warnings**. Não há `PASS WITH KNOWN DEBTS`.

```text
Phase 12 SPEC/SDD complete
checker PASS
awaiting human review
implementation prompt not started
execution blocked
6 planned / 0 executed
completed_phases: 11
total_plans: 56
completed_plans: 50
percent: 92
OPS-01 incomplete
OPS-02 incomplete
TEST-01 incomplete
```

## P12-IMPLEMENTATION-PROMPT — execução manual preparada

### Autorização e limite

O humano autorizou somente a criação do pacote documental consolidado para a futura execução manual da Phase 12. Foi criado `12-IMPLEMENTATION-PROMPT.md`; este log, ROADMAP e STATE foram sincronizados. Nenhum plano, runtime, teste, migration, Docker/PostgreSQL, dependência, package/lockfile, provider, deploy, push ou produção foi executado.

### Contrato operacional consolidado

- ordem sequencial obrigatória: `12-01 → 12-02 → 12-04 → 12-03 → 12-05 → 12-06`;
- uma autorização humana abre somente um plano e cada summary encerra o gate ativo;
- `PHASE12_EXECUTION_BASE_SHA` será capturado somente no início futuro autorizado do `12-01`, após o commit deste gate;
- cada packet reproduz a allowlist exata do PLAN e permite somente o respectivo `12-0X-SUMMARY.md` como exceção documental;
- commits atômicos de implementação precedem um commit documental separado do summary, sem amend;
- o SPEC/SDD final prevalece sobre shorthand histórico do PLAN no único conflito conhecido: `OperationalAlert.sent_at` não será criado;
- VERIFICATION, REVIEW e CLOSURE permanecem gates separados mesmo depois do `12-06`.

### Checker documental

Resultado binário: **PASS**, com **0 blockers e 0 warnings**. Não há `PASS WITH KNOWN DEBTS`.

```text
Phase 12 implementation prompt complete
checker PASS
awaiting human review
6 planned / 0 executed
execution not started
next permitted step: explicit authorization of 12-01
completed_phases: 11
total_plans: 56
completed_plans: 50
percent: 92
OPS-01 incomplete
OPS-02 incomplete
TEST-01 incomplete
```

## P12-12-03-R1 — reconciliação da fixture cascata de reclaim de checkout

### Autorização

Gate humano exclusivamente documental. Sem alteração de runtime, sem alteração de testes, sem rewrite/amend dos commits `8bbb38d` e `586c81f`, sem 12-05/12-06, migrations, manifests, Jest config, providers, PostgreSQL/Docker, push ou deploy. A mudança técnica já commitada permanece intacta.

### Cronologia factual

1. O gate original do Plan 12-03 autorizava **oito** paths técnicos.
2. A Unit completa revelou uma fixture preexistente em `webhook-order-creation.unit.spec.ts` incompatível com H12-06: o cenário `processing` retryable não possuía `locked_at`, e o reclaim passou a exigir idade ≥ 15 minutos.
3. O agente modificou um **nono** path técnico sem autorização prévia na allowlist formal (adição de comentário H12-06 + `locked_at: "2026-06-30T15:45:00.000Z"` com `now = 2026-06-30T16:00:00.000Z`).
4. A revisão humana classificou o resultado como **BLOCKED documental** (escopo fora da allowlist), não como falha funcional da fixture.
5. P12-12-03-R1 auditou o diff `PLAN12_03_BASE_SHA...HEAD` desse arquivo: +2 linhas apenas (comentário + `locked_at` stale); status permanece `processing`; assertions, mocks, callbacks e demais cenários intactos.
6. A exceção estreita foi aprovada somente para a adição de `locked_at` stale / comentário explicativo; nenhuma alteração runtime adicional foi autorizada.
7. `12-05` e `12-06` permaneceram bloqueados / não iniciados.

### Decisão humana vinculante

Path formalmente incorporado à allowlist do 12-03:

```text
apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
```

Motivo: alinhar a fixture processing retryable ao contrato H12-06 sem alterar a intenção ou as assertions do teste.

Contagem factual reconciliada: **9 paths técnicos** + `12-03-SUMMARY.md`. Número de tasks do plano permanece 3.

### Artefatos atualizados neste gate

- `12-03-PLAN.md` — allowlist / task reclaim / validações / evidence / rollback
- `12-VALIDATION.md` — allowlist SHA-base + prova cascata + teste focado
- `12-03-SUMMARY.md` — reconciliação de escopo; status `passed` após auditoria
- este discussion log

`ROADMAP.md` / `STATE.md` não foram alterados: não registravam 12-03 como aprovado sem a reconciliação.

## P12-12-06-R1 — gate PostgreSQL serial + Modules normal

### Autorização

O humano formalizou o gate final do Plan 12-06 como composto:

1. cinco specs PostgreSQL em processos descartáveis independentes (serial);
2. suíte Modules completa pelo comando normal do projeto;
3. combinação das duas evidências para o gate final.

Não é mais obrigatório empilhar múltiplos `medusaIntegrationTestRunner` no mesmo processo Jest. A falha `Map.prototype.set` permanece registrada como limitação de empilhamento Jest/test-utils — não defeito das constraints — e não foi corrigida.

### Proibido

Corrigir Jest/`@medusajs/test-utils`; alterar runner 12-01; modificar specs predecessores; modificar runtime/migrations/models/services; alterar manifests/lockfile/Jest config; consolidar runners; criar dependências; push; deploy; REVIEW; CLOSURE. Sem PASS parcial.

### Evidência técnica (2026-07-23)

- Parte A: 5/5 PostgreSQL serial disposable PASS; cleanup sem residual `p12-pg-*`
- Parte B: Modules normal 36/36 · 511/511
- HTTP focado 4/4 · 23/23; Unit 54/54 · 877/877; HTTP completo 19/19 · 235/235
- Lint 0 erros / 210 warnings; Build PASS
- Negativas package/lockfile/Jest vazias; medusa-config allowlist-only
- `TEST-01` / `OPS-01` / `OPS-02` complete tecnicamente
- Phase 12 closed / cross-dyno real / stacked PASS: não alegados

### Artefatos atualizados

- `12-06-PLAN.md`, `12-VALIDATION.md`, `12-IMPLEMENTATION-PROMPT.md`, este log, `12-06-SUMMARY.md`
- `STATE.md` / `ROADMAP.md` após PASS técnico: seis planos executados; aguardam REVIEW

## P12-REVIEW-R1 — correção dos blockers do REVIEW humano

### Blockers originais

1. INV-4 ainda não provava dois eventos Stripe `payment_intent.succeeded` **distintos** para o mesmo `payment_intent` (o caso reutilizava o mesmo `event.id`).
2. A evidência final não registrava explicitamente o estado do worktree após o commit documental `30c8612`.

### Correção estreita

- Único arquivo técnico: `apps/backend/integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts`
- Caso INV-4 corrigido para `evt_inv04_success_a` + `evt_inv04_success_b`, ambos `pi_inv03_123`
- Harness de claim via `CheckoutCompletionLog` (idempotency_key = payment_intent); segundo evento → `reused_existing_order`
- Preservados: replay do mesmo event, raw body/assinatura ausente/inválida, falha intermediária recuperável, zero persistência pré-auth, IDs INV

### Comandos e resultados

```text
TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts --runInBand
→ 1/1 suite, 6/6 PASS

TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  <four invariant specs> --runInBand
→ 4/4 suites, 23/23 PASS

TMPDIR=/tmp npm run test:integration:http -w @dtc/backend
→ 19/19 suites, 235/235 PASS
```

Negativas: `git diff --check` limpo; config/lockfile/jest/medusa-config sem diff vs `P12_REVIEW_R1_BASE_SHA`; rg external providers sem matches no spec.

### Git

- `P12_REVIEW_R1_BASE_SHA`: `30c8612515832a181d80f1313ee26e7cf56624e6`
- Commit técnico: `7609d8473b252b7545bb272b189438a416c96b0e` — `test(invariants): prove distinct webhook events share one order claim`
- First documentary correction commit: `e06249ee05f00380368383949ac227e3356c1159` — `docs(12): record invariant review corrections` (P12-REVIEW-R1 first attempt; remains in Git history; corrected by P12-REVIEW-R2)
- `origin/main...HEAD` after first documentary correction: `0 32`
- worktree: vazio após commit documental (`git status --short --untracked-files=all` vazio)
- `git diff --check`: vazio
- Push/deploy: não executados

### Final Git evidence

O commit documental deste gate não registra o próprio SHA dentro de seu
conteúdo. O HEAD autoritativo deve ser obtido após o commit por:

`git rev-parse HEAD`

A evidência pós-commit será registrada no resultado externo do gate.

Estado esperado após o commit:

- `origin/main...HEAD`: `0 33`
- `git status --short --untracked-files=all`: vazio
- `git diff --check`: vazio
- push/deploy: não executados
- CLOSURE: não iniciado
- Phase 13: não iniciada

### Decisão de parada

```text
stopped for human re-review
CLOSURE: not started
Phase 13: not started
next permitted step: human REVIEW only
```

## P12-REVIEW-R2 — human re-REVIEW PASS

### Escopo

Gate exclusivamente documental para corrigir:

1. SHA pós-commit incorreto registrado em P12-REVIEW-R1;
2. Session Continuity obsoleta em STATE.md.

Nenhum runtime, teste, migration, manifesto, configuração, provider ou
comportamento de produto foi alterado.

### Resultado do re-REVIEW

Os dois blockers originais do REVIEW estão resolvidos:

- INV-4 prova dois eventos `payment_intent.succeeded` distintos para o mesmo
  `payment_intent`, com dois WebhookEventLogs, um claim canônico e uma Order.
- O estado final do Git é verificado externamente após o commit documental,
  sem tentar registrar o SHA do próprio commit dentro dele.

As inconsistências documentais posteriores também foram corrigidas:

- SHA fictício `7ca6948...` removido;
- Session Continuity sincronizada com o gate atual.

### Decisão humana

`Phase 12 human REVIEW/re-REVIEW: PASS`

Esta decisão aprova REVIEW somente.

Não constitui autorização para:

- CLOSURE;
- Phase 13;
- push;
- deploy;
- merge;
- tag.

### Próximo gate permitido

Phase 12 CLOSURE somente mediante autorização humana separada.

## P12-CLOSURE — Phase 12 closed

### Authorization

Human authorization covered Phase 12 CLOSURE only.

### Result

`Phase 12 CLOSURE: PASS`

- Plans 12-01..12-06: complete
- OPS-01: complete
- OPS-02: complete
- TEST-01: complete
- Human REVIEW/re-REVIEW: PASS
- Phase 12: closed
- completed phases: 12/12
- completed plans: 56/56

### Boundaries

No runtime, tests, migration, dependency, provider, deploy, push, merge, tag,
milestone-closeout, Phase 13 or frontend work occurred.

Cross-dyno real execution and stacked Jest PASS are not claimed.

### Next decision

The next step is a separate Product Manager decision about milestone v1.0
closeout, release-readiness/production validation, or creation of a new
milestone.

No next phase starts automatically.

---

## P12-POST-CLOSURE-PR7-R1 — Codex PR 7 corrective gate

### Authorization

Human authorization covered exclusively:

```text
P12-POST-CLOSURE-PR7-R1
```

Local technical + documentary gate only. No push, deploy, GitHub write,
Phase 12.1, Phase 13, or milestone closeout.

### Findings

Reviewer `chatgpt-codex-connector` on commit
`96cf6452f9a893350ee582b41378eea1b3c51725` (PR 7):

1. **Point replay audits at the reused refund request**
   (`apps/backend/src/api/admin/refunds/request/route.ts`)
2. **Don’t reconcile failed updates as successful creates**
   (`apps/backend/src/jobs/admin-action-log-reconciliation.ts`)
3. **Use one pagination strategy for alert scans**
   (`apps/backend/src/jobs/operational-alert-scanner.ts`)

All three confirmed and corrected.

### Technical decisions

- Pre-resolve refund replay by `idempotency_key` before audit intent; keep
  claim-time authoritative lookup.
- Typed `resolveOutcomeEntityId` for success outcomes; error outcomes remain on
  original intent entity id.
- Reconciliation may override `entity_id` factually and resolve refunds by
  unambiguous idempotency key.
- Exchange intents carry immutable `exchange_operation` (`create`|`update`) and
  intended allowlisted state for update/reject/cancel.
- Alert scanner uses pure offset pagination ordered by `id ASC` only.

### Files changed

Technical allowlist only (12 files) plus documentary allowlist
(`12-POST-CLOSURE-PR7-R1-SUMMARY.md`, `12-DISCUSSION-LOG.md`, `12-CLOSURE.md`,
`ROADMAP.md`, `STATE.md`).

### Tests

```text
Focused Unit PASS
Focused HTTP PASS
Focused PostgreSQL PASS (admin-action-log disposable)
Full Unit PASS (889)
Full Modules PASS (511)
Full HTTP PASS (236)
Lint PASS (0 errors)
Build PASS
```

### Result

```text
P12-POST-CLOSURE-PR7-R1: PASS
Phase 12 closure: reaffirmed by post-closure addendum
Phase 12.1: not started / blocked until PR re-review
Push/deploy: not executed
```

### Next gates

Separate authorization may permit:

```text
push → PR 7 update → Codex re-review → thread resolution after confirmation
```

---

## P12-POST-CLOSURE-PR7-R2 — Docker harness portability

### Authorization

Human authorization covered exclusively:

```text
P12-POST-CLOSURE-PR7-R2
```

Local technical + documentary gate only. No push, deploy, GitHub write,
Phase 12.1, Phase 13, or milestone closeout.

### Findings

Reviewer `chatgpt-codex-connector` on commit
`4ed9fc86be9833f85716c1df3a3ef8d66942e231` (PR 7):

1. **P1 Admin authentication** — Product Manager classified as **false
   positive**; out of technical scope; no runtime changes.
2. **P2 Use one portable Docker invocation strategy in the disposable
   PostgreSQL harness** — confirmed and corrected.

### Binding distinction (rtk vs docker)

```text
rtk: optional external Codex agent wrapper (RTK.md)
docker: canonical runtime dependency of the versioned harness
Cursor: executes the runner directly without rtk
Codex: may prefix outer shell commands with rtk; script still calls docker
```

Historical PLAN/SUMMARY command lines that show Codex using `rtk` remain
historical execution records only.

### Technical decision

Replace `run("rtk", ["docker", …])` with `run("docker", …)` in
`apps/backend/scripts/run-disposable-postgres-tests.mjs`. Keep `spawn` without
`shell: true`, argv separation, redaction, cleanup, signals, loopback-only
guards, and existing error codes. No `P12_DOCKER_BIN` override.

### Files changed

Technical allowlist only (2 files) plus documentary allowlist
(`12-POST-CLOSURE-PR7-R2-SUMMARY.md`, `12-DISCUSSION-LOG.md`, `12-CLOSURE.md`,
`ROADMAP.md`, `STATE.md`). Adapter
`disposable-postgres-harness.ts` unchanged.

### Tests

```text
Focused harness unit PASS (24)
Disposable smoke PASS (direct docker, no rtk)
PostgreSQL serial 5/5 PASS; residual containers 0
Full Unit PASS (890)
Full Modules PASS (511)
Full HTTP PASS (236)
Lint PASS (0 errors)
Build PASS
```

### Result

```text
P12-POST-CLOSURE-PR7-R2: PASS
Phase 12 closure: reaffirmed by second post-closure addendum
Phase 12.1: not started / blocked until PR update + re-review
Push/deploy/GitHub replies: not executed
```

### Next gates

Separate authorization may permit:

```text
push → reply to P1/P2 threads → Codex re-review → thread resolution after confirmation
```

## P12-POST-CLOSURE-PR7-R3 — OperationalAlert user-only read policy

### Authorization

Human authorization covered exclusively:

```text
P12-POST-CLOSURE-PR7-R3
```

Local technical + documentary gate only. No push, deploy, GitHub write,
Phase 12.1, Phase 13, or milestone closeout.

### Finding

Reviewer `chatgpt-codex-connector` on commit
`e7b94737a24c9715214ea62beee263e68162471d` (PR 7):

```text
Require user actors for alert reads — P2 — classified valid
```

### Diagnosis

Partial guard `assertOperationalAlertAdminAuthenticated` accepted any non-empty
`actor_id`, so secret API-key auth contexts could read OperationalAlert
list/detail. Refund/exchange already use `requireAdminActor` (user-only).

### Decision

Reuse `requireAdminActor` on both read routes; reject API-key / missing / empty
actors before module resolution. Do not add manual `authenticate(...)` to
`middlewares.ts`. Do not alter the shared helper.

### Files

```text
apps/backend/src/api/admin/operational-alerts/route.ts
apps/backend/src/api/admin/operational-alerts/[id]/route.ts
apps/backend/integration-tests/http/admin-operational-alerts.spec.ts
+ documentary allowlist (R3 summary, CLOSURE, DISCUSSION-LOG, ROADMAP, STATE)
```

### Tests

```text
Focused HTTP: PASS (27)
Focused Unit (requireAdminActor suite): PASS (17)
Full Unit: PASS (890)
Full HTTP: PASS (240)
Lint: PASS (0 errors)
Build: PASS
```

### Result

```text
P12-POST-CLOSURE-PR7-R3: PASS
Phase 12 closure: reaffirmed by third post-closure addendum
Phase 12.1: not started / blocked until PR update + re-review
Push/deploy/GitHub replies: not executed
```

### Next gates

Separate authorization may permit:

```text
push → reply to Codex finding → request new Codex review
```
