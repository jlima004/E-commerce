---
phase: 12-ops-audit-critical-tests
status: context-complete-awaiting-human-review
created_at: 2026-07-16
scope: context-only
depends_on: phases-01-through-11-closed
requirements: [OPS-01, OPS-02, TEST-01]
manual_review_gate: true
branch: gsd/phase-12-ops-audit-critical-tests
research_status: not-started
plan_status: not-started
execution_status: blocked
---

# Phase 12 Context — Ops, Audit & Critical Tests

## 1. Phase boundary

Phase 12 delivers three bounded outcomes:

1. **OPS-01** — Failed fulfillments and stuck payments surface as persisted `OperationalAlert` records.
2. **OPS-02** — Admin actions on money / order / fulfillment are recorded in append-only `AdminActionLog`.
3. **TEST-01** — Automated tests regression-guard INV-1/2, INV-3/4, INV-8, and INV-9/10 at the real boundaries that matter.

This CONTEXT gate is **documentation only**. It does **not** authorize RESEARCH, PLAN, SPEC/SDD, implementation prompts, runtime changes, new tests, migrations, dependency installs, deploy, or push.

**Branch:** `gsd/phase-12-ops-audit-critical-tests` (based on current `main` / `origin/main` after formal release-stabilization closure).

**Upstream closure facts:**

- Phases 01–11 are complete/closed at their manual gates.
- Phase 11 explicitly deferred broad `OperationalAlert` / `AdminActionLog` to Phase 12.
- Phase 09 already persists a **minimal** operator-attention contract on `GelatoFulfillment` (`requires_operator_attention`, `operator_alert_*`, `dead_letter`) — Phase 12 must promote/persist alerts without becoming a generic monitoring platform.
- Release stabilization (MNY / REL / CACHE / INFRA) is formally closed; those debts must not be reopened here.

## 2. Canonical requirements

| ID | Statement | Source |
|----|-----------|--------|
| **OPS-01** | Failed fulfillments and stuck payments surface as persisted OperationalAlerts | REQUIREMENTS.md, ROADMAP Phase 12 |
| **OPS-02** | Admin actions on money/order/fulfillment are recorded in AdminActionLog | REQUIREMENTS.md, ROADMAP Phase 12, DB_MODEL §4.14 |
| **TEST-01** | Automated tests guard INV-1/2, INV-3/4, INV-8, INV-9/10 | REQUIREMENTS.md, ROADMAP Phase 12 |

**Canonical documents (current versions):**

| Document | Version / path |
|----------|----------------|
| PROJECT | `.planning/PROJECT.md` |
| ROADMAP | `.planning/ROADMAP.md` Phase 12 |
| REQUIREMENTS | `.planning/REQUIREMENTS.md` OPS-01/02, TEST-01 |
| PRD Backend | `docs/PRD_Backend_v1.1.md` |
| DB_MODEL | `docs/DB_MODEL_v1.21.md` §4.14 / §4.16 / DATA-090 / DATA-091 / DATA-104 |
| SRS | `docs/SRS_v1.5.md` (secondary; PRD + DB_MODEL override older Order/awaiting_payment wording) |
| Phase 11 closure | `.planning/phases/11-refunds-exchanges-admin/11-CLOSURE.md` |
| Stabilization closure | `.planning/quick/260716-p3o-.../260716-p3o-SUMMARY.md` |

**Governance override preserved:** PRD Backend v1.1 + DB_MODEL v1.21 override older SRS wording that suggests Order before confirmed payment.

**PRD tension recorded (not expanded here):** PRD lists Must-Have operational alert **email** (`BE-EM-009` / `BE-AN-005`). Authorized Phase 12 CONTEXT gate excludes alert email delivery. OPS-01 is satisfied by **persisted** `OperationalAlert`; email emission remains an explicit deferred PRD debt outside this phase MVP (see §11).

## 3. Existing-system inventory

### 3.1 OperationalAlert / failure surface (runtime today)

**There is no `OperationalAlert` module yet.** Failures already leave durable traces elsewhere:

| Domain | Persisted today | Transient / logs-only today |
|--------|-----------------|-----------------------------|
| PaymentAttempt | statuses, `expires_at`, `awaiting_webhook_since`, terminal failure fields | no operator alert entity |
| CheckoutCompletionLog | `processing` / `completed` / `failed` + sanitized errors | worker noise in logs/Sentry |
| WebhookEventLog | Stripe/Gelato ingest statuses, dedupe, failures | forged-signature rejects are HTTP/log only (correct) |
| GelatoFulfillment | retry, `failed`, `dead_letter`, `requires_operator_attention`, sanitized `operator_alert_*`, `last_error_*`, `attempt_count`, stale handling (`GELATO_DISPATCH_STALE_AFTER_MS = 15m`, max attempts `5`) | Sentry/logs for unexpected exceptions |
| Analytics / Email relays | `failed` / `dead_letter` with sanitized errors | not OPS-01 alert types in Phase 12 MVP |

**Inventory answers (OPS-01 design inputs):**

1. **Already persisted:** Gelato dead-letter/operator fields; CheckoutCompletionLog failures; PaymentAttempt terminal/non-terminal states; WebhookEventLog processing outcomes.
2. **Logs/Sentry only:** unexpected exceptions, signature-reject noise, relay stack traces — not enough for OPS-01 operator visibility.
3. **Stuck-payment candidates (local evidence):**
   - `payment_confirmed_by_webhook` + `order_id = null` with missing/failed/`processing` CheckoutCompletionLog.
   - Pix non-terminal after Stripe-sourced `expires_at` (justified by provider field, not an invented SLA).
   - Card/`awaiting_webhook_confirmation` without a canonical timeout → **not** assigned an arbitrary deadline in this CONTEXT (RESEARCH).
4. **Persistently failed fulfillment:** `GelatoFulfillment.status = dead_letter` and/or `requires_operator_attention = true` (including stale `dispatching`/`submitted` operator-gated path).
5. **Existing retry/dead-letter:** Gelato dispatch relay, analytics PostHog relay, Resend email relay, CheckoutCompletionLog failed reprocess path, WebhookEventLog dedupe/replay.
6. **Idempotent alert creation site:** on transition into durable failure/stuck predicates (dead-letter / operator attention / stuck-payment detector), keyed by alert type + entity.
7. **Avoid alert spam:** upsert open alert by dedupe key; bump `last_seen_at` / `occurrence_count`; never insert a new open row on every worker tick.
8. **Ack/resolve/reopen:** DB_MODEL statuses `open | acknowledged | resolved | ignored` with timestamps; **no Admin ack/resolve UI API is required in Phase 12 MVP** — lifecycle fields must exist for later ops; reopen policy is a RESEARCH detail.

### 3.2 AdminActionLog / Admin mutating surfaces (runtime today)

**There is no `AdminActionLog` module yet.** Custom Admin mutating routes:

| Route | Mutates | Own domain trail | Admin actor captured today |
|-------|---------|------------------|----------------------------|
| `POST /admin/refunds/request` | `RefundRequest` reservation | Yes — `RefundRequest` + later webhook financial truth | **No** |
| `POST /admin/exchanges` | `ExchangeRequest` create | Yes — `ExchangeRequest` | **No** |
| `POST`/`PATCH` `/admin/exchanges/:id` | exchange status + Correios reverse fields | Yes — `ExchangeRequest` | **No** |
| `GET /admin/custom` | none | n/a | n/a |
| Catalog sellable-gate middleware | product sellability constraints | product metadata / validators | not money/order/fulfillment |

**Inventory answers (OPS-02 design inputs):**

1. Domain trails exist (`RefundRequest`, `ExchangeRequest`) but are **not** Admin audit logs.
2. No custom Admin money/order/fulfillment route records `admin_id` today.
3. Intended actor source: Medusa Admin authenticated context (`req.auth_context.actor_id`, `actor_type` for Admin user). Exact Medusa v2 field/email resolution is a RESEARCH confirmation; audited routes must **fail closed** if actor cannot be identified.
4. Auditable fields: action code, entity type/id, result, reason (when required), correlation/request id, minimal previous/new state snapshots, sanitized metadata ids.
5. Must redact/omit: secrets, PAN, tokens, `client_secret`, Pix QR/copia-e-cola, full addresses, CPF/CNPJ plaintext, raw Stripe/Gelato payloads, unsanitized notes, full financial record dumps.
6. **Minimal metadata + selective before/after** is sufficient; full event sourcing is out of scope. Use before/after only where state transition is the audit point (exchange status, refund request reservation).
7. Automatic actions that must **not** be Admin actions: Stripe/Gelato webhooks, relays, Order birth workflow, analytics/email outbox, scheduled jobs.
8. Append-only inserts; optional request-level idempotency via correlation/`idempotency_key` when the Admin action already has one (refund request key) — RESEARCH exact uniqueness strategy.

### 3.3 Critical invariant tests (current coverage)

| Invariant | Current tests | Level | Gap | Proof needed for TEST-01 |
|-----------|---------------|-------|-----|--------------------------|
| **INV-1** No Order without confirmed payment | `payment-attempt-order-eligibility.unit.spec.ts`; `webhook-order-entrypoint.unit.spec.ts`; `stripe-webhook-order-creation.spec.ts` (HTTP) | unit helper + workflow unit + HTTP | No single named invariant suite; Store complete path already negatively grepped in Phase 03/04 | Explicit suite case: only post-webhook confirmed attempt creates Order; store/checkout never mints Order |
| **INV-2** Unpaid/expired Pix never creates Order | `payment-attempt-state.unit.spec.ts`; `pix-initiation.unit.spec.ts`; eligibility/webhook units rejecting non-confirmed statuses; HTTP failure/cancel paths in order-creation suite | unit + partial HTTP | Dedicated “pix_expired → zero Order” named case may be implicit | Named proof: `pix_expired` / awaiting Pix states never call Order creation |
| **INV-3** Webhook validated | `stripe-webhook-route.unit.spec.ts` (400 missing/invalid signature / missing raw body); HTTP webhook suites with signature header doubles | unit HTTP-route + HTTP harness | Not labeled INV-3 | Keep signature fail-closed proofs in invariant suite |
| **INV-4** Webhook/Order idempotent | `webhook-event-log.unit.spec.ts`; `checkout-completion-log.unit.spec.ts`; entrypoint replay/concurrency units; `stripe-webhook-store.spec.ts` replay; order-creation HTTP duplicate/replay | unit + HTTP + concurrency-ish unit | True multi-worker DB race may be limited | Named replay + concurrent claim proofs against CheckoutCompletionLog uniqueness |
| **INV-8** One active Gelato order | `gelato-fulfillment.unit.spec.ts` (single-active); dispatch relay units; order-creation HTTP “exactly one GelatoFulfillment” when email sent | unit + HTTP filtered | Manual reprocess Admin path not present yet | Named double-trigger / retry → one active fulfillment; connected ids remain one logical order |
| **INV-9** Refund confirmed by webhook | `refund-stripe-webhook.unit.spec.ts`; `stripe-refund-webhook.spec.ts` (`refund.created` not final; object webhook confirms) | unit + HTTP | No real Stripe smoke (deferred) | Named: reservation ≠ financial truth; only refund object terminal webhook finalizes |
| **INV-10** Refund decoupled from `order_status` | `stripe-refund-webhook.spec.ts` (total refund keeps `order_status=confirmed`); refund-request units asserting no auto-cancel | unit + HTTP | Exchange paths already avoid order_status mutation | Named: total/partial refund never sets `order_status=canceled` |

## 4. OperationalAlert decisions

### D12-01 — MVP alert types only

Phase 12 MVP persists exactly two alert type families:

| `type` | Meaning |
|--------|---------|
| `payment_stuck` | Stuck payment predicates from §5 |
| `fulfillment_failed` | Persistent Gelato fulfillment failure / operator attention |

No generic monitoring taxonomy, no analytics/email dead-letter alerts, no Redis/Postgres infra alerts, no “system health” alerts.

### D12-02 — Severity

| Type | Default severity |
|------|------------------|
| `payment_stuck` | `high` |
| `fulfillment_failed` | `critical` when `dead_letter` / permanent; `high` when operator attention without dead-letter |

Severity enum follows DB_MODEL: `low | medium | high | critical`.

### D12-03 — Status lifecycle

Statuses: `open → acknowledged → resolved` with `ignored` as explicit suppress.

MVP must persist fields enabling lifecycle even if Admin ack/resolve APIs are minimal or deferred:

- `status`, `acknowledged_at`, `resolved_at`
- `sent_at` may remain null (email out of scope)

### D12-04 — Deduplication / occurrence

Dedupe key (logical):

```text
type + entity_type + entity_id
```

Behavior:

- If an alert for that key is `open` or `acknowledged`, **upsert**: update `last_seen_at`, increment `occurrence_count`, refresh sanitized message/error — do **not** create a second open alert on each worker run.
- If `resolved` / `ignored` and the failure condition is observed again, RESEARCH decides reopen vs new row; CONTEXT preference: **reopen** the same logical alert (status→`open`, clear resolved timestamps) to preserve history continuity.

`first_seen_at` / `last_seen_at` / `occurrence_count` are required MVP semantics. RESEARCH decides columns vs metadata JSON while preserving DB_MODEL minimum fields.

### D12-05 — Safe entity reference + sanitized error

- `entity_type` / `entity_id` only (canonical DB_MODEL values; e.g. `payment_attempt`, `fulfillment`/`order` as RESEARCH maps to existing Gelato aggregate naming).
- Message/metadata: sanitized codes/messages only (reuse existing Gelato/payment sanitizers).
- Never store raw Stripe/Gelato payloads, secrets, QR, PAN, tokens, full PII.

### D12-06 — Retention

No automated purge/TTL in Phase 12. Retention policy deferred. Append/update lifecycle only.

### D12-07 — Relationship to Phase 09 minimal alerts

Phase 09 `GelatoFulfillment.requires_operator_attention` remains the local fulfillment truth. Phase 12 **adds** `OperationalAlert` rows when those durable failure predicates are met (and for stuck payments). `OperationalAlert` does not replace `GelatoFulfillment` fields.

## 5. Stuck-payment definition decisions

### D12-08 — Stuck payment predicates (MVP)

A payment is **stuck** when **any** of the following local, evidence-based conditions hold:

1. **Confirmed without Order**
   - `PaymentAttempt.status = payment_confirmed_by_webhook`
   - AND `order_id IS NULL`
   - AND checkout completion is missing, `failed`, or `processing` beyond any **already-documented** local lock/recovery behavior discovered in RESEARCH (no new arbitrary SLA invented here).

2. **Pix past provider expiry still non-terminal**
   - `payment_method_type = pix`
   - AND `expires_at` is set and `< now`
   - AND status ∈ non-terminal awaiting set (`awaiting_pix_payment`, `awaiting_webhook_confirmation`, instruction/client-confirmed Pix states still open)
   - Justification: Stripe-sourced `expires_at`, not an invented timeout.

**Explicitly excluded from Phase 12 stuck detection:**

- Broad webhook reconciliation / Pix sweeper (`REL-02` v2).
- Arbitrary card `awaiting_webhook_confirmation` wall-clock timeout without a canonical source (RESEARCH may only adopt a timeout if an existing accepted constant/policy is found; otherwise leave out of MVP).
- Auto-refund / auto-cancel as remediation.

Detection may be triggered from existing workers/transitions or a **narrow** stuck-payment scanner; it must not become REL-02.

## 6. AdminActionLog decisions

### D12-09 — Included Admin actions (MVP)

| Action code | Trigger surface |
|-------------|-----------------|
| `refund_order` | `POST /admin/refunds/request` (including blocked/failed attempts relevant to audit) |
| `update_exchange` | exchange create/update including Correios reverse fields and status transitions |
| `approve_exchange` / `reject_exchange` / `cancel_exchange` | only when those status transitions are performed via Admin exchange update |

`reprocess_fulfillment` is in DB_MODEL but **no Admin reprocess route exists today** — do not invent the reprocess product flow in Phase 12; if a minimal reprocess endpoint is required by RESEARCH to satisfy OPS-02 wording for fulfillment, it must remain a thin audited wrapper around existing single-active Gelato guards (human PLAN gate). Product publish / Gelato metadata catalog edits are **out** of OPS-02 MVP (not money/order/fulfillment).

### D12-10 — Actor

- Required: `admin_id` from Medusa Admin auth context.
- Optional: `admin_email` if safely available without extra PII sprawl.
- Fail closed: audited Admin mutations must not succeed silently without an actor identity (record `blocked`/`failed` audit when appropriate).

### D12-11 — Record shape (MVP)

Minimum fields aligned with DB_MODEL §4.14:

- `admin_id`, `action`, `entity_type`, `entity_id`, `result`, `created_at`
- `reason` when required (refunds; exchange rejects/cancels; overrides if any)
- `metadata.request_id` / `correlation_id` when available
- Selective `previous_state` / `new_state` allowlisted snapshots
- Append-only (no update/delete in normal app flow)

### D12-12 — Results to record

Record `requested | succeeded | failed | blocked` for included surfaces. Refund stays `requested` at Admin reservation time (financial truth remains webhook-side).

## 7. Critical invariant test decisions

### D12-13 — Suite strategy

**Hybrid consolidation:**

- Create an **explicit invariant suite** (named INV-1/2/3/4/8/9/10 cases) that proves the boundaries.
- Prefer reusing existing harnesses/helpers over rewriting business logic tests.
- Extend existing suites only when a gap cannot be expressed cleanly in the invariant suite.

### D12-14 — Proof level targets

| Invariant | Minimum proof level for TEST-01 |
|-----------|----------------------------------|
| INV-1 | HTTP or workflow entrypoint proving Order birth only after confirmed payment |
| INV-2 | Unit/module + entrypoint proof unpaid/expired Pix never creates Order |
| INV-3 | HTTP-route/unit proving signature/raw-body fail-closed |
| INV-4 | Idempotency/replay proof at WebhookEventLog + CheckoutCompletionLog boundary (include concurrency claim if locally testable) |
| INV-8 | Module/HTTP proof single-active Gelato fulfillment under double trigger/retry |
| INV-9 | HTTP/module proof refund financial finalize only via refund-object webhook |
| INV-10 | HTTP/module proof `order_status` unchanged by refund confirmation |

### D12-15 — Test environment constraints

- Local disposable PostgreSQL/Redis only.
- No real Stripe, Gelato, Resend, PostHog, Correios.
- No production/Heroku dependency.
- Providers remain injectable doubles / existing safe boundaries.

## 8. Security / redaction constraints

- Reuse Phase 01 allowlist/redaction and Phase 09/11 sanitizers.
- `OperationalAlert` and `AdminActionLog` inherit INV-12: never persist/log secrets, PAN, plaintext tracking tokens, `client_secret`, Pix QR/copia-e-cola, raw webhook bodies, full card data, unsanitized addresses/tax ids.
- Sentry grouping must use sanitized codes only.
- Admin notes / exchange notes already sanitized — audit metadata must not reintroduce raw notes beyond allowlisted sanitized excerpts if needed.

## 9. Data and migration considerations

- New custom modules/models for `OperationalAlert` and `AdminActionLog` are expected in later PLAN/execution (not this gate).
- Migrations are **not** authored in CONTEXT.
- Schema must honor DB_MODEL §4.14 / §4.16 minimum fields; occurrence/dedupe fields are additive MVP semantics to confirm in RESEARCH.
- No changes to PaymentAttempt / Gelato / RefundRequest schemas unless RESEARCH finds a strictly necessary link field — prefer logical references via `entity_type`/`entity_id` and metadata ids.

## 10. Testing boundaries

Phase 12 testing work under TEST-01 is limited to invariant regression proofs above plus unit/module tests for the new alert/audit modules when implemented.

Out of TEST-01:

- Real Stripe CLI / Gelato / Resend / PostHog smokes
- Load/performance suites
- Admin UI e2e
- Infra/health contract redesign tests

## 11. Explicit out-of-scope

Excluded from Phase 12 MVP (unless a later human gate revises this CONTEXT):

- Dashboard / Admin alert UI beyond what is strictly required to write audit rows
- Storefront / frontend
- PagerDuty, Slack, or alert email delivery (PRD email Must-Haves deferred)
- Generic external alerting
- Event sourcing / SIEM / new distributed observability stack
- Automated remediation, auto-refund, auto-cancel Order
- New payment provider
- Generic webhook reconciliation / broad Pix sweeper (`REL-02`)
- Cross-dyno refund lock
- Correios API
- Additional Gelato API surface beyond existing dispatch/webhook
- Real Stripe/Gelato/Resend/PostHog calls
- Heroku / Redis / health-contract changes
- Reopening APP_VERSION, Redis TLS cache, `REDIS_CACHE_PROVIDER_DISABLED`, release fallback, major/minor money, web.1/worker.1 Redis proof
- Phase 13 / reliability v2 bulk transport
- Catalog product publish audit (unless later explicitly added)

## 12. Open questions for RESEARCH

1. Exact Medusa v2 Admin auth context fields for reliable `admin_id` / optional email on custom `/admin/*` routes; fail-closed pattern consistent with existing middleware.
2. Schema placement for `first_seen_at`, `last_seen_at`, `occurrence_count`, and unique open-alert constraint (columns vs metadata + index).
3. Mapping `entity_type` for Gelato aggregate (`fulfillment` vs order id) given runtime `gelato_fulfillment` module naming vs DB_MODEL `Fulfillment`.
4. Whether any accepted local constant exists for card/`awaiting_webhook_confirmation` stuck timeout; if none, keep excluded.
5. Narrow detection trigger design (transition hooks vs small scanner job) without becoming REL-02.
6. Reopen-vs-new-row policy details and whether Admin ack/resolve endpoints are in Phase 12 or fields-only.
7. Whether a thin audited Gelato reprocess Admin route is required for OPS-02 or deferred until a product action exists.
8. Invariant suite file layout (`integration-tests/http/invariants/*` vs module `__tests__/invariants/*`) and which existing harnesses to import.
9. Migration module naming/registration patterns matching Phases 05–11.
10. Confirm no contradiction requiring alert email in-phase despite authorized out-of-scope (human confirmation).

## 13. Human gates

**Stop here for human review of this CONTEXT.**

| Next step | Status |
|-----------|--------|
| Human review of `12-CONTEXT.md` | **required now** |
| RESEARCH (`12-RESEARCH.md`) | not started — blocked until CONTEXT accepted |
| PLAN / VALIDATION | not started |
| Implementation / migrations / tests | blocked |
| OPS-01 / OPS-02 / TEST-01 complete | **not** claimed |

No RESEARCH, PLAN, or execution may begin without explicit human approval of this CONTEXT.
