---
phase: 12-ops-audit-critical-tests
artifact: discussion-log
status: pre-plan-documentary-sync-complete-awaiting-plan-authorization
created_at: 2026-07-16
updated_at: 2026-07-20
scope: pre-plan-documentary-sync-gate
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
| PLAN | not started |
| Execution | blocked |
| Phase 12 plans | 0 planned / 0 executed |
| Milestone progress | 11/12 phases complete; 92% |
| Phase 12 requirements | OPS-01 / OPS-02 / TEST-01 incomplete |
| Next permitted step | Human review and explicit authorization of PLAN |

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
PLAN not started
execution blocked
next permitted step: human review and explicit authorization of PLAN
```
