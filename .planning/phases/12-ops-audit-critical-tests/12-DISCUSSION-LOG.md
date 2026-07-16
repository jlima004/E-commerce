---
phase: 12-ops-audit-critical-tests
artifact: discussion-log
status: research-complete-awaiting-human-review
created_at: 2026-07-16
updated_at: 2026-07-16
scope: research-gate
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

### Binding human decisions applied

| ID | Outcome in RESEARCH |
|----|---------------------|
| H12-01 | Alert email out; PRD divergence recorded; not OPS-01 blocker |
| H12-02 | Minimal GET list+detail `/admin/operational-alerts`; dashboard out |
| H12-03 | Full Admin mutation matrix; no generic `/admin/*` intercept |
| H12-04 | **Strategy A** — one immutable terminal row per Admin attempt |
| H12-05 | Fail closed without actor; no unknown/system/null `admin_id` |
| H12-06 | No immediate alert after `payment_confirmed_by_webhook`; 15m stale derived from existing relay/lock conventions |

### Research classification

**PASS** — see `12-RESEARCH.md` §1.

### Key RESEARCH recommendations (summary)

- Admin actor: `req.auth_context.actor_id` + `actor_type` `user`|`api-key` (Medusa 2.16.0).
- Modules: `operational_alert`, `admin_action_log`.
- Detection: Gelato transition upsert (Option A) + narrow scanner; Pix stuck via `expires_at` (markPixExpired unwired).
- Ack/resolve/ignore APIs deferred (fields-only).
- TEST-01: `integration-tests/http/invariants/*` hybrid.

### Items still for PLAN (not decided as locked)

See `12-RESEARCH.md` §17 (scanner cron, exchange action mapping, blocked-audit failure policy, constant placement, migration style, etc.).

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
| A. One terminal immutable row | **Accepted (RESEARCH)** |
| B. Correlated requested→succeeded events | Rejected for MVP |

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
RESEARCH: Strategy A; Option A detection; 15m stale window derivation; ack/resolve deferred; reprocess deferred; invariant suite under `integration-tests/http/invariants/`.

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

## Gate status

| Step | Status |
|------|--------|
| Human review of `12-CONTEXT.md` | Accepted (authorized RESEARCH) |
| RESEARCH (`12-RESEARCH.md`) | **Complete — awaiting human review** |
| PLAN / VALIDATION | not started |
| Implementation | blocked |

Baseline at RESEARCH start:

```text
branch=gsd/phase-12-ops-audit-critical-tests
HEAD=0f6a54527451f293eeb03fc44b0eec5440cb4f74
origin/main...HEAD = 0 1
worktree clean
```
