---
phase: 12-ops-audit-critical-tests
artifact: discussion-log
status: context-complete-awaiting-human-review
created_at: 2026-07-16
scope: context-only
---

# Phase 12 Discussion Log — Ops, Audit & Critical Tests

## Documents consulted

| Document | Role |
|----------|------|
| `.planning/PROJECT.md` | Core value, Active requirements including OperationalAlert/AdminActionLog/critical tests |
| `.planning/ROADMAP.md` | Phase 12 goal/success criteria; Phase 09 minimal alert note; Phase 11 closure |
| `.planning/REQUIREMENTS.md` | OPS-01, OPS-02, TEST-01; REL-02 deferred sweeper |
| `.planning/STATE.md` | Stabilization closed; Phase 12 previously blocked |
| `.planning/config.json` | Interactive/manual gates; discuss_mode; no auto-advance |
| `.planning/phases/11-refunds-exchanges-admin/11-CLOSURE.md` | Refund/exchange complete; broad alert/audit deferred to Phase 12 |
| `.planning/phases/11-refunds-exchanges-admin/11-04-SUMMARY.md` | Validation evidence; no Phase 12 start |
| `.planning/quick/260715-infra01-release-infrastructure/SUMMARY.md` | INFRA-01 PASS; Redis fail-fast; closed |
| `.planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md` | CACHE-01A PASS; TLS shape; closed |
| `.planning/quick/260715-rel01-runtime-version/SUMMARY.md` | REL-01 PASS; version resolution; closed |
| `.planning/quick/260716-p3o-encerrar-formalmente-a-estabiliza-o-no-s/260716-p3o-SUMMARY.md` | Formal stabilization closure |
| `docs/PRD_Backend_v1.1.md` | Alert/audit product language; email Must-Have tension |
| `docs/DB_MODEL_v1.21.md` | §4.14 AdminActionLog, §4.16 OperationalAlert, DATA rules |
| `docs/SRS_v1.5.md` | Secondary; superseded on Order-before-payment wording |
| Runtime inventory under `apps/backend/src` | PaymentAttempt, CheckoutCompletionLog, WebhookEventLog, GelatoFulfillment, Admin routes, tests |

## Alternatives evaluated

### OperationalAlert breadth

| Option | Outcome |
|--------|---------|
| A. Only `payment_stuck` + `fulfillment_failed` | **Accepted** — matches OPS-01 and authorized gate |
| B. Also alert analytics/email dead-letter | Rejected — expands into generic ops monitoring |
| C. Infra/Redis/health alerts | Rejected — observability already Phase 01; not OPS-01 |

### Stuck-payment definition

| Option | Outcome |
|--------|---------|
| A. Evidence-based: confirmed-without-Order + Pix past `expires_at` | **Accepted** |
| B. Arbitrary card webhook wall-clock SLA | Rejected without canonical source |
| C. Broad Pix/webhook sweeper (REL-02) | Rejected — reliability v2 |

### AdminActionLog breadth

| Option | Outcome |
|--------|---------|
| A. Money/order/fulfillment Admin surfaces existing today (refund + exchange/Correios) | **Accepted** |
| B. Full DB_MODEL action enum including catalog publish + email resend | Rejected for MVP — OPS-02 wording is money/order/fulfillment |
| C. Invent Gelato reprocess Admin product in CONTEXT | Rejected — no route today; RESEARCH may note thin wrapper need |

### before/after vs minimal metadata

| Option | Outcome |
|--------|---------|
| A. Minimal metadata + selective before/after | **Accepted** |
| B. Full event sourcing / complete financial clones | Rejected |

### TEST-01 suite shape

| Option | Outcome |
|--------|---------|
| A. Explicit invariant suite + reuse harnesses (hybrid) | **Accepted** |
| B. Only sprinkle more asserts into existing files | Rejected as weaker readability/regression signal |
| C. Rewrite all money-path tests from scratch | Rejected — high maintenance |

### Alert email in Phase 12

| Option | Outcome |
|--------|---------|
| A. Persist OperationalAlert only; defer email | **Accepted** per authorized CONTEXT gate |
| B. Implement Resend operational_alert emails now | Rejected for this phase; PRD Must-Have debt recorded |

## Decisions taken

Recorded as D12-01 … D12-15 in `12-CONTEXT.md`:

- MVP alert types: `payment_stuck`, `fulfillment_failed` only.
- Severity defaults; open/ack/resolved/ignored lifecycle; dedupe by type+entity; occurrence bumping.
- Stuck payment = confirmed-without-Order and Pix past Stripe `expires_at` still non-terminal.
- AdminActionLog covers refund + exchange/Correios Admin mutations; actor from Admin auth; fail closed; append-only; redaction policy.
- TEST-01 = explicit invariant suite hybrid; local PG/Redis; no real external providers.
- Phase 09 Gelato operator fields remain local truth; OperationalAlert is additive.

## Unresolved questions

Forwarded to RESEARCH (see `12-CONTEXT.md` §12):

1. Exact Admin auth actor fields on custom routes.
2. Schema for first/last seen + occurrence + unique open constraint.
3. entity_type mapping for Gelato aggregate vs DB_MODEL Fulfillment.
4. Any existing card awaiting-webhook timeout constant.
5. Detection trigger shape (hook vs narrow scanner).
6. Reopen policy + whether ack/resolve Admin APIs are in-phase.
7. Need for thin audited Gelato reprocess route.
8. Invariant suite file layout.
9. Migration/module registration patterns.
10. Human confirmation of deferred alert-email PRD debt.

## Items forwarded to RESEARCH

All §12 open questions in `12-CONTEXT.md`. No RESEARCH artifact created in this gate.

## Items rejected by scope

- Dashboard / PagerDuty / Slack / alert email
- Event sourcing / SIEM / automated remediation
- REL-02 sweeper / cross-dyno refund lock / Correios API
- Heroku/Redis/health changes; reopening closed stabilization debts
- Phase 13 and reliability v2 bulk import
- Runtime implementation, migrations, dependency changes, new tests, PLAN files

## Absence of implementation

Confirmed for this gate:

- No runtime code changes
- No new tests executed or added
- No migrations
- No dependency/lockfile changes
- No RESEARCH / PLAN / VALIDATION / implementation-prompt artifacts
- No deploy / push / production changes

Baseline at CONTEXT start:

```text
branch=gsd/phase-12-ops-audit-critical-tests
HEAD=e2f0958eb6878cf13eb7c15c0a418f1b1c891a1d
origin/main...HEAD = 0 0
worktree clean
```
