# Phase 12: Ops, Audit & Critical Tests - Research

**Researched:** 2026-07-16  
**Revised:** 2026-07-20 (P12-RESEARCH-R1)
**Domain:** OperationalAlert + AdminActionLog + critical invariant regression tests (Medusa v2 Admin/API)  
**Classification:** PASS  
**Confidence:** HIGH  

---

## 1. Executive conclusion

Phase 12 is **plannable and implementable** without inventing payment SLAs, without a generic `/admin/*` intercept, and without alert email. Admin actor identity is available on installed Medusa **2.16.0**, but the MVP policy is intentionally narrower than the framework: audited mutations require `req.auth_context.actor_type === "user"` and a non-empty `actor_id`; secret Admin API keys are rejected for these mutations. OPS-01 can persist two alert families (`payment_stuck`, `fulfillment_failed`) with a PostgreSQL `ON CONFLICT DO UPDATE` that deduplicates and increments atomically. OPS-02 must use **Strategy B append-only**, because the installed Medusa transaction context was verified only inside a module/repository boundary and a safe shared transaction across RefundRequest or ExchangeRequest and AdminActionLog was not proved. TEST-01 uses flat HTTP specs plus unit tests and real disposable-PostgreSQL module integration.

**Primary recommendation:** Two custom modules (`operational_alert`, `admin_action_log`) + one narrow stuck-payment/fulfillment scanner job + explicit audit wrappers on three Admin mutation routes + read-only alert list/detail + hybrid invariant suite. No new npm dependencies. Alert email remains an explicit PRD divergence debt (H12-01).

### 1.1 Classification and confidence

| Gate | Result |
|------|--------|
| Classification | **PASS** (not BLOCKED; no “PASS WITH KNOWN DEBTS”) |
| Overall confidence | **HIGH** — actor policy fixed; unsafe cross-module atomicity rejected; PostgreSQL upsert and real-DB proof boundaries specified; 15m is explicitly a local operational window |
| Admin actor identifiable | **Yes** — require `actor_type === "user"` and non-empty `actor_id`; otherwise fail closed |
| Unsafe native intercept required | **No** |
| Alert surface without large UI | **Yes** — JSON list+detail under `/admin/operational-alerts` |
| Dedupe concurrency-safe | **Yes** — unique `(type, entity_type, entity_id)` + one atomic PostgreSQL `ON CONFLICT DO UPDATE` statement |
| Stuck payment SLA invented | **No** — Pix uses Stripe `expires_at`; `CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000` is a local operational policy, not a Stripe SLA |
| AdminActionLog atomicity | **Strategy A infeasible on current proof** — no safe cross-module transaction proved; Strategy B append-only is required |
| Invariants testable at real boundaries | **Yes, with Wave 0 gap** — HTTP/unit retain doubles; constraints, claims and concurrency require disposable PostgreSQL integration |

### 1.2 User Constraints (from CONTEXT.md)

<user_constraints>

#### Locked Decisions (D12-01 … D12-15)

**D12-01 — MVP alert types only:** `payment_stuck`, `fulfillment_failed` only. No analytics/email dead-letter, infra, or generic monitoring taxonomy.

**D12-02 — Severity:** `payment_stuck` → `high`; `fulfillment_failed` → `critical` when dead_letter/permanent, `high` when operator attention without dead-letter. Enum: `low | medium | high | critical`.

**D12-03 — Status lifecycle:** `open → acknowledged → resolved` with `ignored` as suppress. Persist `status`, `acknowledged_at`, `resolved_at`; `sent_at` may remain null (email out of scope).

**D12-04 — Deduplication / occurrence:** Logical key `type + entity_type + entity_id`. Upsert open/acknowledged (bump `last_seen_at` / `occurrence_count`); CONTEXT preference reopen resolved/ignored when condition recurs.

**D12-05 — Safe entity reference + sanitized error:** `entity_type` / `entity_id` only; sanitized messages; never raw Stripe/Gelato payloads, secrets, QR, PAN, tokens, full PII.

**D12-06 — Retention:** No automated purge/TTL in Phase 12.

**D12-07 — Relationship to Phase 09:** `GelatoFulfillment.requires_operator_attention` remains local fulfillment truth; OperationalAlert is additive.

**D12-08 — Stuck payment predicates:** (1) `payment_confirmed_by_webhook` + `order_id IS NULL` + checkout completion missing/failed/processing beyond documented lock/recovery; (2) Pix past Stripe `expires_at` still non-terminal. Exclude REL-02 sweeper, arbitrary card webhook wall-clock timeout, auto-refund/cancel.

**D12-09 — Included Admin actions:** `refund_order` on `POST /admin/refunds/request`; `update_exchange` / `approve_exchange` / `reject_exchange` / `cancel_exchange` on exchange Admin routes. Do not invent Gelato reprocess product flow. Catalog publish out of OPS-02 MVP.

**D12-10 — Actor:** `admin_id` from Medusa Admin auth; optional `admin_email`; fail closed without identity.

**D12-11 — Record shape:** DB_MODEL §4.14 minimum + selective previous/new state + correlation ids; append-only.

**D12-12 — Results:** `requested | succeeded | failed | blocked`. Refund stays `requested` at Admin reservation time.

**D12-13 — Suite strategy:** Explicit named invariant suite + reuse harnesses (hybrid).

**D12-14 — Proof levels:** INV-1 HTTP/workflow; INV-2 unit+entrypoint; INV-3 HTTP-route signature; INV-4 WebhookEventLog+CheckoutCompletionLog replay/claim; INV-8 single-active Gelato; INV-9 refund object webhook finalize; INV-10 order_status unchanged by refund.

**D12-15 — Test environment:** Local disposable PG/Redis only; no real Stripe/Gelato/Resend/PostHog/Correios; injectable doubles.

#### Binding human decisions (orchestrator)

- **H12-01:** Alert email OUT of Phase 12 MVP. Record PRD divergence. No Resend/email/notification relay. Not OPS-01 blocker.
- **H12-02:** OperationalAlert needs minimal Admin read-only surface (list+detail with filters). Dashboard out. Ack/resolve/ignore = RESEARCH question (answered in §6/§8).
- **H12-03:** Inventory custom + native Admin + workflows; matrix; no generic `/admin/*` intercept.
- **H12-04:** Choose Strategy A (one terminal immutable row) OR B (correlated events). Never update `requested→succeeded` on same row. **R1 rejects Strategy A as unproved across modules and chooses Strategy B append-only.**
- **H12-05:** Fail closed without Admin actor; no unknown/system/null `admin_id` for auditable actions.
- **H12-06:** Do not alert merely because `payment_confirmed_by_webhook` just occurred; require stale evidence. P12-RESEARCH-R1 makes one explicit exception: persisted CCL `failed` is already terminal failure evidence and alerts without an additional wait.

#### Claude's Discretion

Research recommends concrete schema columns, scanner job shape, Strategy B append-only, user-only actor resolution, ack/resolve deferral (fields-only + reopen), thin reprocess route deferred, and invariant suite as flat `integration-tests/http/invariants-inv*.spec.ts` plus disposable-PostgreSQL module integration.

#### Deferred Ideas / Out of scope (OUT OF SCOPE)

Dashboard/PagerDuty/Slack/alert email; event sourcing/SIEM; automated remediation; REL-02 sweeper; cross-dyno refund lock; Correios API; new Gelato API surface; real provider calls; Heroku/Redis/health redesign; catalog publish audit; Phase 13; storefront; inventing Gelato reprocess product in CONTEXT.

</user_constraints>

### 1.3 Phase requirements map

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | Failed fulfillments and stuck payments surface as persisted OperationalAlerts | §5–§8 detection + schema + scanner; Phase 09 fields remain source for fulfillment |
| OPS-02 | Admin money/order/fulfillment actions recorded in AdminActionLog | §3–§4 user-only actor; §9 Strategy B append-only; explicit route wrappers only |
| TEST-01 | Automated tests guard INV-1/2, INV-3/4, INV-8, INV-9/10 | §10 hybrid HTTP/unit/PostgreSQL matrix |

</phase_requirements>

---

## 2. Sources and exact versions

### Installed / verified runtime

| Package / tool | Installed | Latest on npm (check date) | Notes |
|----------------|-----------|----------------------------|-------|
| `@medusajs/medusa` | **2.16.0** | 2.17.2 (2026-07-16) | Pin stays 2.16.0 — do not upgrade in Phase 12 |
| `@medusajs/framework` | **2.16.0** | 2.17.2 | Matched set |
| `@medusajs/admin-sdk` / `dashboard` | 2.16.0 | — | Bundled Admin |
| Node.js | **v22.23.1** | — | Meets stack floor |
| npm | 10.9.8 | — | — |
| PostgreSQL client (`psql`) | 17.10 | — | Local server not running at research time (`pg_isready` no response) |
| Redis CLI | unavailable in PATH | — | Tests historically use local disposable Redis when harness starts |

**Version verification commands run:** `npm view @medusajs/medusa version`, `npm view @medusajs/framework version`, `require(...package.json).version`. [VERIFIED: npm registry + local node_modules]

### Official documentation (Context7 / docs.medusajs.com)

| Topic | Source | Confidence |
|-------|--------|------------|
| `/admin` routes protected by default; `AUTHENTICATE = false` opt-out | [docs.medusajs.com — Protected Routes](https://docs.medusajs.com/learn/fundamentals/api-routes/protected-routes) | HIGH [CITED] |
| `req.auth_context?.actor_id` for Admin user; Query `entity: "user"` for details | same | HIGH [CITED] |
| `authenticate("user", ["session","bearer","api-key"])` | Auth Identity / Actor Types resources | HIGH [CITED] |
| Custom module `model.define` + `medusa db:generate` / `db:migrate` | Medusa module customization docs | HIGH [CITED] |
| Installed `AuthContext` / `AuthenticatedMedusaRequest` | `@medusajs/framework/dist/http/types.d.ts` | HIGH [VERIFIED: node_modules] |
| Default Admin auth middleware applies `authenticate` for `"user"` with `bearer|session|api-key` | `@medusajs/framework/dist/http/router.js` | HIGH [VERIFIED: node_modules] |
| `ADMIN_ACTOR_TYPE = "user"`; API key sets `actor_type: "api-key"` | `authenticate-middleware.js` | HIGH [VERIFIED: node_modules] |

### Project canonical docs

- `.planning/phases/12-ops-audit-critical-tests/12-CONTEXT.md`, `12-DISCUSSION-LOG.md`
- `.planning/PROJECT.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`
- `docs/PRD_Backend_v1.1.md` (BE-EM-009 / BE-AN-005 email Must-Have tension)
- `docs/DB_MODEL_v1.21.md` §2.17, §4.14, §4.16, DATA-090/091/092/096–098/100/104
- `docs/SRS_v1.5.md` (secondary; Order-before-payment wording superseded)
- Phase 09 / 11 RESEARCH + CLOSURE artifacts

### Package legitimacy

Phase 12 **installs no new packages**. Existing `@medusajs/*` already in tree. Seam `package-legitimacy check` flagged `@medusajs/medusa` / `@medusajs/framework` as `SUS` reason `too-new` despite official GitHub + ~100k weekly downloads — treat as false positive for already-adopted core framework; **Disposition: Approved (no install)**.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| *(none new)* | — | — | N/A — no Phase 12 installs |
| `@medusajs/medusa@2.16.0` (existing) | npm | SUS(too-new) + official | Keep pinned; do not upgrade |
| `@medusajs/framework@2.16.0` (existing) | npm | SUS(too-new) + official | Keep pinned |

**Packages removed due to SLOP:** none  
**Packages flagged SUS for new install:** none (no new installs)

---

## 3. Admin authentication findings

### Confirmed on installed Medusa 2.16.0

1. **Default protection:** Framework router applies auth middleware to `/admin` with actor type `"user"` and auth types `["bearer","session","api-key"]`. [VERIFIED: `router.js`]
2. **Actor fields:** `AuthContext` = `{ actor_id, actor_type, auth_identity_id, app_metadata, user_metadata, ... }`. [VERIFIED: `types.d.ts`]
3. **Human Admin:** JWT/session → `actor_type === "user"`, `actor_id === user.id`. Official docs + integration-test JWT pattern use `actor_type: "user"`. [CITED: docs.medusajs.com + Context7]
4. **Secret API key:** Middleware sets `actor_type: "api-key"`, `actor_id = apiKey.id` (not a User id). This proves framework capability, **not** eligibility for Phase 12 audited mutations. [VERIFIED: `authenticate-middleware.js`]
5. **Optional email:** Resolve via Query graph `entity: "user"` filtered by the validated User `actor_id`. [CITED: docs]
6. **Opt-out:** `export const AUTHENTICATE = false` disables default protection — **must not** be used on audited money routes. [CITED: docs]
7. **Project middlewares.ts:** Custom Admin routes rely on default `/admin` auth; no extra `authenticate("user")` layer today. Correlation middleware sets `req.correlationId` globally. [VERIFIED: codebase]

### Fail-closed actor resolution (H12-05) — prescribe

```typescript
// Pattern for audited Admin handlers (fictional ids)
function requireAdminActor(req: AuthenticatedMedusaRequest): {
  admin_id: string
  actor_type: "user"
} {
  const actorId = req.auth_context?.actor_id?.trim()
  const actorType = req.auth_context?.actor_type
  if (!actorId || actorType !== "user") {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "ADMIN_ACTOR_TYPE_UNSUPPORTED")
  }
  return { admin_id: actorId, actor_type: "user" }
}
```

- **Accept only** `actor_type === "user"` with non-empty `actor_id` for Phase 12 audited mutations.
- **Reject** `api-key`, missing/empty `actor_id`, `null`, invented `"system"` / `"unknown"` before any domain call.
- On rejection: no domain mutation, emit only a sanitized security log, and never invent or persist an `admin_id`.
- **Never trust** body field `requested_by_operator_id` as audit actor (see §4 — current refund route accepts it from body).

### Confidence

**HIGH** for actor_id/actor_type on `/admin`. **MEDIUM** for optional email lookup performance (Query graph is official but unused on these routes today).

---

## 4. Existing Admin mutation surface

### Matrix (H12-03)

| Ação | Rota/superfície | Nativa/custom | Ator disponível | Em OPS-02? | Justificativa |
|------|-----------------|---------------|-----------------|------------|---------------|
| `refund_order` | `POST /admin/refunds/request` | Custom | Framework auth yes; route **does not** read it today (body `requested_by_operator_id` spoofable) | **Sim** | Money reservation; D12-09 |
| `update_exchange` (create) | `POST /admin/exchanges` | Custom | Auth present; not captured | **Sim** | ExchangeRequest create |
| `update_exchange` / `reject_exchange` / `cancel_exchange` | `POST /admin/exchanges/:id` (**not** PATCH — only `POST` exported) | Custom | Auth present; not captured | **Sim** | Status + Correios reverse fields; map action by status delta (`rejected`/`canceled`/other) |
| `approve_exchange` | *(nenhuma)* | — | — | **Não** (MVP) | Runtime statuses have no `approved`; use `update_exchange` for forward transitions |
| `reprocess_fulfillment` | *(nenhuma)* | — | — | **Não** | No Admin route today; DATA-097 deferred |
| Catalog sellable gate | Admin product/variant middleware | Custom | Auth present | **Não** | Not money/order/fulfillment |
| `GET /admin/custom` | `GET /admin/custom` | Custom | Auth present | **Não** | Read-only noop |
| Native Order cancel / payment refund / fulfillment | Medusa Admin core APIs | Native | Framework may authenticate `user`/`api-key`; Phase 12 policy is user-only | **Inventário only** | Project ops path is custom refund/exchange; no generic `/admin/*` intercept |
| Stripe webhook Order/refund finalize | `/hooks/stripe` + workflows | Automatic | N/A | **Não** | Not Admin action |
| Gelato dispatch/webhook | jobs + `/hooks/gelato` | Automatic | N/A | **Não** | Not Admin action |
| Analytics/email relays | scheduled jobs | Automatic | N/A | **Não** | Not Admin action |

### Recommended typed actor (not implemented here)

```ts
type AdminActor = {
  admin_id: string           // req.auth_context.actor_id, proven user.id
  admin_email?: string       // Query entity "user".email
}
```

Validate `actor_type === "user"` and non-empty `actor_id`; fail closed otherwise. Helper suggested location: `apps/backend/src/modules/admin-action-log/require-admin-actor.ts` (PLAN).

### Feature flags

- `ADMIN_REFUND_REQUEST_ENABLED` / `ADMIN_EXCHANGE_REQUEST_ENABLED` gate custom routes. Audited paths must still fail closed on actor when enabled.

### Security debt to close in Phase 12 (OPS-02)

- Refund route copies `requested_by_operator_id` from **request body**.
- Exchange create copies `created_by_operator_id` from **request body**.

Both must be replaced by `auth_context.actor_id` for domain operator fields and `AdminActionLog.admin_id`. Body-supplied operator ids must be ignored or rejected. [VERIFIED: `apps/backend/src/api/admin/refunds/request/route.ts`, `apps/backend/src/api/admin/exchanges/route.ts`]

### No generic intercept

Do **not** add middleware matching `/admin/*` that wraps every native Medusa mutation. Audit only the three custom mutation entrypoints above via explicit helper calls in those handlers.

---

## 5. OperationalAlert schema recommendation

Align with DB_MODEL §4.16 minimum fields; add occurrence/dedupe columns required by D12-04.

### Recommended model (`operational_alert`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK (`opalert` prefix) | |
| `severity` | enum | `low\|medium\|high\|critical` |
| `type` | text | MVP: `payment_stuck` \| `fulfillment_failed` |
| `entity_type` | text | Canonical §2.17: `payment_attempt` or `fulfillment` |
| `entity_id` | text | PaymentAttempt.id or GelatoFulfillment.id |
| `message` | text | Sanitized, length-capped |
| `status` | enum | `open\|acknowledged\|resolved\|ignored` |
| `sent_at` | timestamptz null | Always null in Phase 12 (H12-01) |
| `acknowledged_at` | timestamptz null | |
| `resolved_at` | timestamptz null | |
| `first_seen_at` | timestamptz | Set once on create |
| `last_seen_at` | timestamptz | Bumped on upsert |
| `occurrence_count` | number | Default 1; increment on upsert |
| `error_code` | text null | Sanitized code |
| `metadata` | json null | Allowlisted ids only (`order_id`, `payment_intent_id`, `gelato_fulfillment_id`, `checkout_completion_log_id`, correlation) |
| `created_at` / `updated_at` | timestamptz | Medusa defaults |

### Indexes

| Index | Purpose |
|-------|---------|
| **UNIQUE** `(type, entity_type, entity_id)` | One logical alert row forever → reopen-in-place (D12-04 preference) |
| `(status, severity)` | List open/critical |
| `(entity_type, entity_id)` | Entity history |
| `(type, last_seen_at)` | Ops browsing |

### Entity mapping

| Alert type | `entity_type` | `entity_id` | metadata extras |
|------------|---------------|-------------|-----------------|
| `payment_stuck` | `payment_attempt` | PaymentAttempt.id | `order_id` null, `payment_intent_id`, `checkout_completion_log_id?` |
| `fulfillment_failed` | `fulfillment` | GelatoFulfillment.id | `order_id` (required for ops) |

Do **not** invent `gelato_fulfillment` as `entity_type` — DB_MODEL §2.17 canonical value is `fulfillment`. Runtime module key remains `gelato_fulfillment`. [CITED: DB_MODEL §2.17]

### Why columns not metadata for occurrence

`first_seen_at` / `last_seen_at` / `occurrence_count` are query/filter fields and part of dedupe semantics — store as columns (CONTEXT allowed RESEARCH choice).

---

## 6. Alert lifecycle and concurrency

### Lifecycle

```text
create → open
open → acknowledged (optional later API)
acknowledged → resolved | ignored
resolved|ignored → open   # reopen when predicate true again (CONTEXT preference)
```

**Phase 12 MVP mutation APIs for ack/resolve/ignore:** **defer** (fields exist; no PATCH required for OPS-01). H12-02 read-only surface is sufficient. Operators can still see `open` alerts; reopen path is detector-driven when a previously resolved/ignored condition recurs.

### Concurrency-safe upsert (prescribe)

`create + catch unique + reload + update` is **not** concurrency-safe: two losers can reload the same count and overwrite each other. `upsertOpenAlert(input)` must issue one parameterized PostgreSQL statement through the module-local MikroORM transaction manager/SQL connection:

```sql
INSERT INTO operational_alert (
  type, entity_type, entity_id, severity, message, error_code,
  status, occurrence_count, first_seen_at, last_seen_at
)
VALUES (..., 'open', 1, :observed_at, :observed_at)
ON CONFLICT (type, entity_type, entity_id)
DO UPDATE SET
  occurrence_count = operational_alert.occurrence_count + 1,
  last_seen_at = GREATEST(operational_alert.last_seen_at, EXCLUDED.last_seen_at),
  severity = CASE
    WHEN array_position(ARRAY['low','medium','high','critical'], EXCLUDED.severity)
       > array_position(ARRAY['low','medium','high','critical'], operational_alert.severity)
    THEN EXCLUDED.severity
    ELSE operational_alert.severity
  END,
  message = EXCLUDED.message,
  error_code = EXCLUDED.error_code,
  status = CASE
    WHEN operational_alert.status IN ('resolved', 'ignored') THEN 'open'
    ELSE operational_alert.status
  END,
  acknowledged_at = CASE
    WHEN operational_alert.status IN ('resolved', 'ignored') THEN NULL
    ELSE operational_alert.acknowledged_at
  END,
  resolved_at = CASE
    WHEN operational_alert.status IN ('resolved', 'ignored') THEN NULL
    ELSE operational_alert.resolved_at
  END,
  updated_at = CURRENT_TIMESTAMP
RETURNING *;
```

The unique constraint is the single race authority. The same statement guarantees one logical row, atomic `occurrence_count + 1`, atomic `last_seen_at`, and reopen of `resolved|ignored` without a duplicate. It applies across dynos/processes that write to the same PostgreSQL constraint. It does **not** prove or impose global temporal ordering of detections; `GREATEST` only prevents the row timestamp from regressing. The unique index must be total (not partial on `deleted_at`) because the contract is one logical row forever; soft-delete/purge is not part of this lifecycle.

### Email

`sent_at` remains null. No `EmailDeliveryLog` operational_alert emission. DATA-090 email dedupe is **future** debt when email is implemented — not Phase 12.

---

## 7. Alert detection architecture

### Principles

- Narrow scanner + transition hooks; **not** REL-02.
- H12-06: never alert on the same tick merely because confirmation exists; persisted CCL `failed` is the explicit R1 exception because it is failure evidence, not elapsed-time inference.
- Reuse sanitizers from Gelato/payment modules.

### Fulfillment failed (`fulfillment_failed`)

**Triggers (prefer transition sites + scanner backstop):**

| Predicate | Severity | When |
|-----------|----------|------|
| `GelatoFulfillment.status = dead_letter` | `critical` | On dead-letter transition in dispatch/failure builders + scanner |
| `requires_operator_attention = true` (incl. stale dispatching/submitted) | `high` (or `critical` if also dead_letter) | On `buildGelatoStaleOperatorAttentionUpdate` / failure paths + scanner |

Phase 09 constants already local: `GELATO_DISPATCH_STALE_AFTER_MS = 15 * 60_000`, `GELATO_DISPATCH_MAX_ATTEMPTS = 5`. [VERIFIED: `gelato-fulfillment/service.ts`]

OperationalAlert **does not replace** `requires_operator_attention` fields.

### Payment stuck (`payment_stuck`)

#### Predicate A — Confirmed without Order (H12-06)

All must hold:

1. `PaymentAttempt.status = payment_confirmed_by_webhook`
2. `PaymentAttempt.order_id IS NULL`
3. Checkout completion evidence of stuckness:
   - **No** CheckoutCompletionLog for the attempt/intent, **and** the specific canonical confirmation timestamp age ≥ stale window, **OR**
   - CCL `status = failed` and still no `order_id` — alert immediately, with no additional wait, **OR**
   - CCL `status = processing` **and** `order_id IS NULL` **and** `locked_at` age ≥ stale window

**Local operational window (not a Stripe SLA):**

```typescript
export const CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000
```

This is a Phase 12 operational choice informed by existing 15-minute relay conventions (`GELATO_DISPATCH_STALE_AFTER_MS`, `EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS`). It is **not** a Stripe SLA and is not an already-implemented CheckoutCompletionLog recovery rule; the current claim retries `processing` without measuring age. Use the constant for CCL `processing.locked_at` and the no-CCL confirmation timestamp. CCL `failed` alerts immediately because failure is explicit persisted evidence.

The same constant must gate CheckoutCompletionLog re-claim/retry: a `processing` row with a fresh `locked_at` cannot be re-claimed merely by replay and have its lock timestamp reset. Otherwise repeated replays could postpone stale detection indefinitely.

For the no-CCL case, use the stable, event-specific timestamp of the canonical `payment_intent.succeeded` confirmation — preferably the matching `WebhookEventLog.received_at`. `PaymentAttempt.updated_at` is rejected: webhook replay calls `updatePaymentAttempts` even when the target status is already applied, so that timestamp can move. If the canonical event cannot be matched reliably, do not enable this subpredicate until a dedicated immutable `payment_confirmed_at`/equivalent source is persisted. Missing or invalid timestamps produce no alert and only a sanitized diagnostic.

Do **not** alert while CCL is `processing` and `locked_at` is fresh (< 15m), or while no-CCL confirmation is fresh (< 15m).

#### Predicate B — Pix past provider expiry

1. `payment_method_type = pix`
2. `expires_at` set and `< now`
3. `status` ∈ non-terminal awaiting set:  
   `awaiting_pix_payment`, `awaiting_webhook_confirmation`, `payment_instructions_displayed`, `payment_client_confirmed`, `client_action_required` (and equivalent instruction-display states still open)  
4. Explicitly **exclude** terminal `pix_expired` / failed / canceled / confirmed / superseded / invalidated (those are not “stuck awaiting” — expired terminal is already modeled)

Justification: Stripe-sourced `expires_at` only.

#### Explicitly excluded

- Card `awaiting_webhook_confirmation` wall-clock timeout — **no accepted local constant found**; keep out of MVP. [VERIFIED: codebase grep — none]
- Immediate post-webhook alert without stale window (H12-06)
- REL-02 broad reconciliation sweeper
- Auto-refund / auto-cancel remediation

### Fulfillment detection option choice

| Option | Meaning | Decision |
|--------|---------|----------|
| **A** | Upsert OperationalAlert in the same Gelato transition that sets `dead_letter` / `requires_operator_attention` | **Primary** — same process as durable predicate write; no external calls; works in worker |
| **B** | Scanner-only polling of persisted Gelato predicates | **Backstop only** — covers missed hook failures / restart gaps |

**Recommend Option A + narrow scanner backstop.** Idempotency via unique `(type, entity_type, entity_id)` upsert; retries bump `occurrence_count`; partial failure of alert upsert must not roll back Gelato truth (alert is additive; scanner recovers). No Stripe/Gelato HTTP from the alert path.

### Pix expiry transition gap

`markPixExpired()` exists as a pure helper (`payment-attempt/pix.ts`) and is covered by unit tests, but **no scheduled job or webhook path calls it in runtime today**. Phase 12 stuck detection must therefore alert on the open-status + `expires_at < now` predicate without requiring a prior `pix_expired` transition. Do **not** invent a REL-02 Stripe reconciliation job; optional wiring of `markPixExpired` remains a separate PLAN question and is not required for OPS-01.

### Detection runtime shape

| Mechanism | Role |
|-----------|------|
| **Transition hooks (Option A)** | Upsert when Gelato marks dead_letter / operator attention; optional upsert when checkout completion marks `failed` without order |
| **Narrow scheduled job** `operational-alert-scanner` | Cron `*/5 * * * *` (preferred) or `* * * * *`; scans only the two predicate families; idempotent upsert backstop |
| **Not** a Pix/webhook sweeper that mutates PaymentAttempt as financial truth | Scanner writes OperationalAlert; optional `markPixExpired` is PLAN-gated and must stay local |

Job must no-op in release-migration mode (same pattern as Gelato/email relays).

---

## 8. Minimal Admin read surface

Per H12-02 — **read-only**, no dashboard UI widgets.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/operational-alerts` | List with filters: `status`, `type`, `severity`, `entity_type`, `entity_id`; pagination `limit`/`offset` |
| `GET` | `/admin/operational-alerts/:id` | Detail |

Response: sanitized fields only (no raw metadata dumps beyond allowlisted keys).

**Ack/resolve/ignore Admin APIs:** **out of Phase 12 MVP** (fields persist for later). Detector reopen covers recurrence. PLAN may add thin PATCH later only if human gate expands H12-02 — not required for PASS.

**AdminActionLog read API:** optional/not required for OPS-02 (append on write is enough). Defer list endpoint unless PLAN wants support tooling — default **defer**.

---

## 9. AdminActionLog schema and atomicity

### Strategy choice (H12-04): **Strategy B — correlated append-only rows**

| Strategy | Meaning | Decision |
|----------|---------|----------|
| **A** | One terminal immutable row written atomically with the domain mutation | **Infeasible on current proof** — cross-module transaction is not proven safe |
| **B** | Correlated append-only stream (`requested` intent + later outcome row; never UPDATE) | **Chosen** — guarantees a durable audit precedes domain work without claiming unsupported cross-module atomicity |

Implications:

- Validate actor first, then append a sanitized `requested` intent before any domain mutation. If this insert fails, return a sanitized failure and do not call the domain.
- `refund_order` Admin reservation first appends intent `result=requested`; after the RefundRequest is persisted, append a second correlated `result=requested` row with `metadata.audit_stage=outcome` and `entity_id=RefundRequest.id`. Financial truth remains Stripe webhook / RefundRequest. If the domain call fails, append a correlated `failed` row after rollback.
- Exchange create/update appends a correlated `succeeded` or `failed` outcome after the domain attempt. A `blocked` row is used only when validation/policy prevents the domain call.
- Status transitions: choose `action` from delta (`reject_exchange` if new status `rejected`; `cancel_exchange` if `canceled`; else `update_exchange`). Note: runtime ExchangeRequest has **no** `approved` status — map “approve” only if PLAN defines an explicit approve transition; otherwise use `update_exchange` for forward operational transitions. [VERIFIED: exchange statuses]

### Schema (`admin_action_log`)

DB_MODEL §4.14 fields + practical indexes:

| Column | Notes |
|--------|-------|
| `id` | `adalog` prefix |
| `admin_id` | Required — from auth_context |
| `admin_email` | Nullable |
| `action` | MVP subset of enum |
| `entity_type` | `refund` / `exchange_request` / `order` as appropriate |
| `entity_id` | RefundRequest.id or ExchangeRequest.id (or order_id when blocked pre-create) |
| `result` | `requested\|succeeded\|failed\|blocked` |
| `severity` | Optional; default `info` |
| `reason` | Required for refunds; rejects/cancels |
| `previous_state` / `new_state` | Allowlisted snapshots only |
| `metadata` | `request_id`/`correlation_id`, audit attempt id/stage, `order_id`, `idempotency_key`, `actor_type=user`, `reused_idempotency` |
| `created_at` | Append-only — **no updated_at mutations in app flow** |

Indexes per DB_MODEL: `admin_id`, `action`, `(entity_type, entity_id)`, `result`, `created_at`, `(admin_id, created_at)`.

### Transaction evidence and ordering

The installed Medusa 2.16.0 exposes `Context.transactionManager`; `@InjectTransactionManager` opens/reuses it, and generated `MedusaService` methods forward shared context. This proves transaction reuse within a compatible ORM/module context. It does **not** prove a supported shared transaction across the separately loaded RefundRequest, ExchangeRequest and AdminActionLog modules: each internal module owns its container, entity set and MikroORM manager, and the repository simply consumes the manager it receives. No project precedent passes one module manager into another.

Strategy A would be acceptable only if the PLAN could prove and test this exact sequence with one compatible transaction:

```text
ator validado
→ abrir/reusar transação
→ mutação de domínio
→ insert imutável do AdminActionLog
→ commit único
```

Because that cross-module proof is absent, **Strategy A is classified as infeasible for Phase 12's current module topology**. “Mutate → insert audit → return error if audit fails” is explicitly rejected: returning an HTTP error does not roll back an already committed domain mutation.

Strategy B ordering is mandatory:

1. Validate `actor_type === "user"` and non-empty `actor_id`; otherwise fail closed, perform no domain call, and emit only a sanitized security log.
2. For an allowed attempt, append the sanitized `requested` intent with a stable audit-attempt/correlation id. If it fails, return a sanitized audit failure; do not execute the domain.
3. Execute the domain mutation. There is therefore no persisted mutation without a preceding audit row.
4. On success, append the correlated outcome required by the action: `succeeded` for exchange; a second `requested` row with `audit_stage=outcome` and `RefundRequest.id` for refund reservation. Never update the intent row.
5. On domain failure, wait for/ensure rollback, then append `failed` in a **separate transaction**. Persist only allowlisted state and sanitized error code/message; never raw payload or an unsanitized exception.
6. For `blocked` after a valid actor but before domain work, append `blocked`. If that insert fails, return a sanitized audit failure and do not execute the domain.

If the post-success outcome append fails, return a sanitized audit failure; the pre-domain `requested` row remains the durable audit evidence. PLAN must define reconciliation for a requested intent without a correlated outcome. **Never** `UPDATE` AdminActionLog rows.

### Idempotency

- Prefer **always append** correlated rows for each HTTP attempt (including idempotent refund reuse) with `metadata.reused_idempotency=true` when applicable.
- Use a stable audit-attempt/correlation id to pair intent and outcome. Do not make a uniqueness rule that silently suppresses legitimate retries.

### `reprocess_fulfillment`

No Admin route today. **Defer** thin audited wrapper (CONTEXT + DISCUSSION). DATA-097 remains future when product action exists. OPS-02 MVP satisfied by refund + exchange surfaces that exist.

---

## 10. Critical invariant test strategy

### Layout (prescribe)

**Jest discovery constraint (VERIFIED):** `apps/backend/jest.config.js` for `TEST_TYPE=integration:http` uses:

```text
**/integration-tests/http/*.spec.[jt]s
```

Nested `integration-tests/http/invariants/*.spec.ts` would **not** be discovered today. Fix the layout as flat named files; do not widen `jest.config.js` in this phase:

```text
apps/backend/integration-tests/http/
  invariants-inv01-02-order-birth.spec.ts
  invariants-inv03-04-webhook-idempotency.spec.ts
  invariants-inv08-gelato-single-active.spec.ts
  invariants-inv09-10-refund-decoupling.spec.ts
```

Use a deliberately hybrid matrix:

- **HTTP with mocked providers/services:** authentication, actor policy, Stripe/Gelato signature handling, request validation, response/error contracts, and orchestration boundaries.
- **Unit:** pure predicates, sanitizers and state machines.
- **Module integration with disposable real PostgreSQL:** migrations, indexes, unique constraints, claims, atomic increments and concurrent writers.

The current HTTP harnesses use mocked module services, and the repository has no real-PostgreSQL `medusaIntegrationTestRunner` (or equivalent) for these paths. Therefore Wave 0 must create and validate the disposable PostgreSQL harness, database isolation, migration application and teardown. Mocks do **not** prove persistence constraints or concurrency.

### Final INV matrix (TEST-01)

| INV / concern | HTTP mock | Unit | Disposable PostgreSQL requirement |
|---------------|-----------|------|---------------------------------|
| INV-1/2 Order eligibility and no Order on non-confirmed states | Flat `invariants-inv01-02-order-birth.spec.ts` | Predicates/state machine | Not required for the behavioral proof |
| INV-3 signature/auth boundary | Flat `invariants-inv03-04-webhook-idempotency.spec.ts` | Signature/error helpers | Not required for signature proof |
| INV-4 webhook replay and Order claim | Same flat HTTP file | Replay/claim predicates | **Required:** WebhookEventLog dedupe and CheckoutCompletionLog concurrent claim/unique constraint |
| INV-8 Gelato single-active | Flat `invariants-inv08-gelato-single-active.spec.ts` | Eligibility/relay helpers | **Required:** concurrent single-active insertion and its unique index |
| INV-9/10 refund finalize and Order-status decoupling | Flat `invariants-inv09-10-refund-decoupling.spec.ts` | Refund state machine | Not required; no real Stripe provider |
| OPS-01 OperationalAlert | Mocked Admin list/detail | Upsert inputs/predicates | **Required:** concurrent `ON CONFLICT` upsert, exact count, reopen and unique constraint |
| New OPS schemas | N/A | Migration text may supplement only | **Required:** apply migrations and inspect/violate actual indexes for OperationalAlert and AdminActionLog |

### Concurrency levels (what tests can prove)

| Concern | Required PostgreSQL proof | Distributed claim |
|---------|---------------------------|-------------------|
| CheckoutCompletionLog claim | Competing transactions produce one accepted logical claim according to the real unique index | Same constraint arbitrates writers that share the database; no claim about global request order |
| WebhookEventLog dedupe | Concurrent duplicate inserts collapse according to the real provider/dedupe constraint | Cross-process/dyno dedupe derives from the shared PostgreSQL constraint |
| Gelato single-active | Concurrent attempts cannot persist two active logical fulfillments for one Order | Cross-process/dyno arbitration derives from the shared constraint |
| OperationalAlert upsert | N concurrent statements leave one row and exact `occurrence_count = N`, with atomic `last_seen_at` and reopen | Cross-process/dyno safety derives from the shared unique constraint; no global temporal order |
| AdminActionLog | Append-only rows and forbidden update/delete API behavior | Strategy B does not claim a shared cross-module transaction |

### Environment (D12-15)

- Jest scripts already: `test:unit`, `test:integration:http`, `test:integration:modules`
- Local disposable PostgreSQL (and Redis only where a job contract requires it); injectable Stripe/Gelato doubles
- The disposable PostgreSQL harness is a Wave 0 deliverable, not an existing proven facility
- No real provider smokes in TEST-01

### Module tests for new OPS modules

Unit tests cover predicates, sanitization, Strategy B append-only sequencing and actor fail-closed. Real module integration covers OperationalAlert SQL concurrency plus the required existing/new constraints and migrations. Provider HTTP remains mocked.

---

## 11. Module/migration structure

### Recommended modules (match Phases 05–11)

```text
apps/backend/src/modules/operational-alert/
  index.ts                 # Module("operational_alert", { service })
  models/operational-alert.ts
  service.ts               # atomic ON CONFLICT upsert, list/retrieve helpers, sanitizers
  types.ts
  migrations/TBD-operational-alert.ts  # or generated Migration*
  __tests__/...

apps/backend/src/modules/admin-action-log/
  index.ts                 # Module("admin_action_log", { service })
  models/admin-action-log.ts
  service.ts               # insertOnly / createAdminActionLog (no update/delete exports)
  types.ts
  migrations/TBD-admin-action-log.ts
  __tests__/...
```

### Registration (`medusa-config.ts`)

```typescript
{ key: "operational_alert", resolve: "./src/modules/operational-alert" },
{ key: "admin_action_log", resolve: "./src/modules/admin-action-log" },
```

Follow existing key style (`refund_request`, `gelato_fulfillment`).

### Migrations

- Prefer `npx medusa db:generate <moduleKey>` then review; project also uses hand-authored `TBD-*` stubs. Regardless of style, real disposable PostgreSQL must apply both migrations and prove the actual indexes.
- Safe migrate path: `npm run db:migrate:safe` / project scripts — PLAN should follow Phase 11 migration discipline (no reckless production migrate in research).
- OperationalAlert requires a total unique constraint on `(type, entity_type, entity_id)` and the custom atomic `ON CONFLICT DO UPDATE`; no create/catch/reload/update fallback.
- **No** schema changes to PaymentAttempt / GelatoFulfillment / RefundRequest unless strictly necessary — prefer `WebhookEventLog.received_at` as the stable no-CCL confirmation timestamp. If reliable matching cannot be proved, the no-CCL predicate stays disabled until a dedicated immutable confirmation timestamp exists.

### Jobs / routes

```text
apps/backend/src/jobs/operational-alert-scanner.ts
apps/backend/src/api/admin/operational-alerts/route.ts          # GET list
apps/backend/src/api/admin/operational-alerts/[id]/route.ts     # GET detail
```

Audit helpers live under e.g. `src/modules/admin-action-log/audit.ts` called from refund/exchange route handlers.

### Links

Module Links to Order optional; MVP can use metadata ids + Query later. Do not import other modules’ services across boundaries — resolve via `req.scope` / container like existing Admin routes.

---

## 12. Security and redaction

### Inherit INV-12

Reuse:

- `src/observability/sanitize.ts` (+ redaction unit tests)
- Gelato `sanitizeGelatoFulfillmentErrorText`
- Refund/Exchange sanitizers and body allowlists
- Sentry scrub (`sentry-scrub.ts`)

### Never persist/log in OperationalAlert or AdminActionLog

Secrets, PAN, tracking tokens plaintext, `client_secret`, Pix QR/copia-e-cola, raw Stripe/Gelato payloads, full addresses, CPF/CNPJ, unsanitized operator notes beyond allowlisted excerpts, Redis URLs, full financial dumps.

### Correlation

Store `metadata.correlation_id` from `req.correlationId` (global middleware). Do not log secrets alongside it.

### Actor spoofing

Ignore or reject client-supplied admin ids. Require `actor_type === "user"`; never record an API key id in `admin_id`. Missing/non-user actors produce no domain call, a sanitized security log, and no invented AdminActionLog identity.

### ASVS (security_enforcement enabled)

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V2 Authentication | yes | Default `/admin` auth + fail-closed actor |
| V3 Session Management | yes | Medusa session/bearer for these user-only audited mutations; API key rejected by domain policy |
| V4 Access Control | yes | Admin-only routes; no AUTHENTICATE=false on money paths |
| V5 Input Validation | yes | Existing allowlists + zod-like Medusa errors; alert query filters validated |
| V6 Cryptography | no new crypto | No new token schemes in Phase 12 |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Spoofed operator id in body | Spoofing | Actor only from auth_context |
| Alert/audit XSS via message | Tampering | Sanitize + length cap; Admin JSON only |
| Secret leakage in alert metadata | Information disclosure | Allowlist metadata keys + sanitizers |
| Duplicate alert spam | Denial of service (ops) | Unique key + occurrence bump |
| Audit gap on mutation | Repudiation | Strategy B persists sanitized `requested` before domain; post-rollback `failed` and post-success outcome are append-only |

---

## 13. Documentary inconsistencies

Do **not** fix these texts in this RESEARCH gate. Record only.

| Obsolete / misleading text | Where | Superseding source | Risk to PLAN | Recommend fix |
|----------------------------|-------|--------------------|--------------|---------------|
| `REDIS_CACHE_PROVIDER_DISABLED=true` as current operational truth | `REQUIREMENTS.md` SETUP-02; `ROADMAP.md` Phase 01 closure; historical STATE notes | CACHE-01A/B + INFRA-01 + stabilization SUMMARY (`260716-p3o-…`); the disabled-cache state is superseded | PLAN might re-open cache TLS debt | **Mandatory before PLAN:** mark as historical/superseded |
| Historical “production activation blocked” language on PAY-01..PAY-04 | `REQUIREMENTS.md` checklist + traceability; `ROADMAP.md` Phase 04 | Later gates (04A real layers; Phases 05–11 money path closed); production healthy per stabilization closure | PLAN might treat payments as still blocked | **Mandatory before PLAN:** classify as historical rather than current production state |
| ROADMAP Phase 12 “not started; blocked until explicit approval” | `ROADMAP.md` Phase 12 | This RESEARCH gate after human CONTEXT approval | Stale roadmap status after RESEARCH | **Mandatory before PLAN:** update status after RESEARCH acceptance (not in R1) |
| PRD BE-EM-009 / BE-AN-005 Must-Have alert **email** | `docs/PRD_Backend_v1.1.md` | CONTEXT + H12-01 | PLAN might add Resend alert | Keep deferred; cite PRD divergence in PLAN out-of-scope |
| DATA-090 email dedupe | DB_MODEL | Email out of Phase 12 | Accidental email work | Future when email ships |
| DATA-097 `reprocess_fulfillment` | DB_MODEL | No Admin route | Invent reprocess product | Defer |
| DB_MODEL `approve_exchange` vs runtime statuses | DB_MODEL §4.14 vs `EXCHANGE_REQUEST_STATUSES` | Runtime has `rejected`/`canceled` but no `approved` | Mis-tagged audit actions | Map by status deltas in PLAN |
| DB_MODEL `Fulfillment` vs runtime `gelato_fulfillment` | DB_MODEL / module | `entity_type=fulfillment` + GelatoFulfillment.id | Wrong entity_type | Follow §5 mapping |
| SRS Order-before-payment wording | `docs/SRS_v1.5.md` | PRD + DB_MODEL + Phases 05–06 | Confusion on INV-1 | Already governed; no reopen |
| ROADMAP “every Admin action on money/order/fulfillment” | Phase 12 success criteria | CONTEXT D12-09 custom refund/exchange only | Over-scope native intercept | Honor CONTEXT in PLAN |
| FUL-01..04, WHK-03, TRK-01/02, REF-01/02, EXC-01/02 still `[ ]` / “Pending”; footer still says Phase 09 not started | `REQUIREMENTS.md` checklist + traceability | Phase 09–11 CLOSURE + STATE | **High** — PLAN may re-scope closed work | **Mandatory before PLAN:** documentary sync |
| PROJECT.md Active checklist still all `[ ]` for built invariants | `.planning/PROJECT.md` | Closures 05–11 | Medium — agents think features unbuilt | **Mandatory before PLAN:** reconcile active checklist |
| FUL-04 “raise operational alert” vs Phase 09 minimal fields | REQUIREMENTS FUL-04 | 09-CLOSURE minimal; OPS-01 = Phase 12 promotion | Medium — clarify FUL-04 done; OPS-01 additive | Before PLAN |

These documents are intentionally **not corrected in P12-RESEARCH-R1**. Their reconciliation is a mandatory documentary gate before PLAN. None blocks revision of RESEARCH itself; do not reopen closed MNY/REL/CACHE/INFRA debts.

---

## 14. Recommended Phase 12 slices

> Slice suggestions only — **do not** create `12-0x-PLAN.md` in this research gate.

| Slice | Outcome | Requirements |
|-------|---------|--------------|
| **12-01** | Modules + migrations: `operational_alert`, `admin_action_log`; total unique alert index; atomic `ON CONFLICT`; disposable-PG migration/index/concurrency tests | OPS-01/02 foundation |
| **12-02** | User-only actor helper + Strategy B append-only wiring on refund/exchange; stop body operator spoof; blocked/failure sequencing tests | OPS-02 |
| **12-03** | Detection: fulfillment transition upserts + stuck-payment/fulfillment scanner job; stale window constant; unit tests | OPS-01 |
| **12-04** | Read-only `GET /admin/operational-alerts` list+detail filters; HTTP tests | OPS-01 / H12-02 |
| **12-05** | Invariant suite flat `integration-tests/http/invariants-inv*.spec.ts` plus real disposable-PG proofs for INV-4, INV-8 and OPS-01 | TEST-01 |
| **12-06** | Documentary PRD divergence note + closure greps (no email relay, no `/admin/*` generic intercept, no AdminActionLog row updates) | Governance |

Wave ordering: 12-01 → (12-02 ∥ 12-03) → 12-04 → 12-05 → 12-06.

---

## 15. Risks and unresolved blockers

### Non-blocking risks (PLAN should mitigate)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Terminal audit outcome insert fails after domain success | Incomplete correlated outcome | Pre-domain `requested` remains durable; return sanitized audit failure; PLAN defines reconciliation |
| Scanner false positives during healthy Order birth (<15m) | Ops noise | H12-06 stale window |
| API-key reaches audited mutation | Attribution violation | Reject unless `actor_type === "user"`; no domain call and no invented `admin_id` |
| Direct SQL bypasses Medusa mutation hooks | Missing future events | OPS-01 requires no such event; emit explicitly after commit if a future requirement adds one |
| Disposable PostgreSQL harness does not exist yet | Real constraints remain unproved | Wave 0 must create, validate isolation/migrations and teardown before implementation claims |
| Exchange “approve” action enum vs statuses | Mis-tagged actions | Explicit mapping table in PLAN |

### Blockers

**None for revised research PASS.** Strategy A is explicitly infeasible, but Strategy B append-only prevents domain work without a preceding audit. PostgreSQL upsert semantics and the mandatory real-DB proof gap are now explicit; PLAN remains blocked pending human review and the pre-PLAN documentary hygiene gate.

---

## 16. Items explicitly rejected

- Alert email / Resend operational_alert / PagerDuty / Slack (H12-01)
- Admin dashboard UI / widgets
- Generic `/admin/*` audit middleware intercept (H12-03)
- Strategy A as an atomic cross-module promise without proof; mutating any AdminActionLog row
- Invented card `awaiting_webhook_confirmation` wall-clock SLA
- REL-02 Pix/webhook sweeper as detection vehicle
- Auto-refund / auto-cancel remediation
- Inventing Gelato reprocess Admin product solely for DATA-097
- Analytics/email dead-letter as OperationalAlert types
- Event sourcing / SIEM
- New npm dependencies
- Upgrading Medusa 2.16.0 → 2.17.x in this phase
- Real Stripe/Gelato/Resend/PostHog in TEST-01
- Ack/resolve/ignore mutation APIs as OPS-01 requirement (deferred)

---

## 17. Questions requiring PLAN decision

1. **Exact scanner cron** — `* * * * *` (match relays) vs `*/5 * * * *` (lower noise). Recommendation: `*/5` for stuck scan; fulfillment transition hooks cover most Gelato cases.
2. **Whether thin PATCH ack/resolve** is added despite CONTEXT “not required” — Research default: **no**.
3. **Exchange action mapping table** for `approve_exchange` given no `approved` status — Research default: only `reject_exchange` / `cancel_exchange` / `update_exchange`.
4. **Strategy B reconciliation shape** for a durable `requested` intent whose post-success outcome append failed. The ordering/fail-closed policy itself is fixed in §9.
5. **Optional `GET /admin/admin-action-logs`** for support — default defer.
6. **Constant placement** for `CHECKOUT_COMPLETION_STALE_AFTER_MS` — checkout-completion module vs shared `ops/stale.ts`; value and semantics are fixed.
7. **Disposable PostgreSQL harness mechanics** — select the existing Medusa-supported runner/setup and teardown approach in Wave 0; the proof requirement is fixed.
8. **Migration style** — CLI generate vs TBD hand-authored stubs (match Phase 11 Gelato/Refund).
9. **REQUIREMENTS/PROJECT/historical production/Redis wording sync** — mandatory documentary-only gate before PLAN.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime/tests | ✓ | v22.23.1 | — |
| npm | Install/scripts | ✓ | 10.9.8 | — |
| `@medusajs/*` 2.16.0 | Framework | ✓ | 2.16.0 | — |
| PostgreSQL server | Migrations/tests | ✗ at research probe | client 17.10 present | Wave 0 must provision disposable local PostgreSQL; no existing harness proved |
| Redis | Jobs/tests | ✗ CLI missing | — | Disposable Redis only if a job-boundary test requires it |
| Docker | Disposable deps | ✓ path present | — | Use if harness needs it |

**Missing dependencies with no fallback:** none for planning.
**Execution prerequisite:** Wave 0 must establish disposable PostgreSQL before any real-constraint/concurrency claim.

## Validation Architecture

`workflow.nyquist_validation` is enabled (absent/false not set).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest via Medusa scripts (`NODE_OPTIONS=--experimental-vm-modules`) |
| Config | `apps/backend` Jest config (existing) |
| Quick run | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath <files>` |
| Full suite | unit + `test:integration:http` focused paths |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | Scanner predicates | unit | `test:unit -- --runTestsByPath src/modules/operational-alert/__tests__` | ❌ Wave 0 |
| OPS-01 | Alert concurrent upsert/reopen + unique/index migration | disposable PostgreSQL module integration | `test:integration:modules -- --runTestsByPath <operational-alert-pg-spec>` | ❌ Wave 0 |
| OPS-01 | GET list/detail | HTTP | `test:integration:http -- --runTestsByPath integration-tests/http/admin-operational-alerts.spec.ts` | ❌ Wave 0 |
| OPS-02 | Audit on refund/exchange + fail-closed actor | HTTP/unit | admin-refunds/exchanges + new audit asserts | ⚠️ extend existing |
| TEST-01 INV-1/2/3/9/10 | Named behavioral invariant suite | HTTP/unit with doubles | `integration-tests/http/invariants-inv*.spec.ts` | ❌ Wave 0 |
| TEST-01 INV-4/8 | Dedupe/claim/single-active constraints | disposable PostgreSQL module integration | `test:integration:modules -- --runTestsByPath <critical-invariants-pg-spec>` | ❌ Wave 0 |

### Sampling Rate

- Per task commit: focused unit path  
- Per wave merge: unit + relevant HTTP  
- Phase gate: full focused matrix green before verify-work  

### Wave 0 Gaps

- [ ] `src/modules/operational-alert/**` + tests  
- [ ] `src/modules/admin-action-log/**` + tests  
- [ ] disposable PostgreSQL harness with migration/isolation/teardown proof
- [ ] real-PG concurrent proofs: WebhookEventLog dedupe, CheckoutCompletionLog claim, GelatoFulfillment single-active, OperationalAlert upsert
- [ ] real-PG application/index checks for both new module migrations
- [ ] `integration-tests/http/invariants-inv*.spec.ts` (flat; no Jest config widening)
- [ ] `integration-tests/http/admin-operational-alerts.spec.ts`

- [ ] Actor fail-closed cases on admin-refunds/exchanges  

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `WebhookEventLog.received_at` can be matched reliably to the canonical succeeded event for a PaymentAttempt with no CCL | §7 | If not proved, disable that subpredicate until a dedicated immutable confirmation timestamp exists |
| A2 | A supported disposable PostgreSQL harness can be established without real providers or production access | §10 | Wave 0 blocks persistence/concurrency claims until proved |

## Sources

### Primary (HIGH)

- Installed `@medusajs/framework` 2.16.0 `router.js`, `authenticate-middleware.js`, `types.d.ts`
- Context7 `/websites/medusajs` — Protected Routes, Auth actor types, modules/migrations
- `docs/DB_MODEL_v1.21.md` §2.17, §4.14, §4.16
- Runtime: checkout-completion claim, webhook replay/update behavior, Gelato stale constants, Admin refund/exchange routes, jobs relays
- Installed Medusa transaction evidence: `@medusajs/types/dist/shared-context.d.ts`; `@medusajs/utils/dist/modules-sdk/decorators/inject-transaction-manager.js`; `medusa-service.js`; `@medusajs/modules-sdk/dist/loaders/utils/load-internal.js`; MikroORM connection loader/repository
- Project transaction-pattern evidence: separately registered `refund_request`/`exchange_request`; isolated service calls in Admin refund/exchange routes; no cross-module `transactionManager` precedent under `apps/backend/src`
- Installed MikroORM PostgreSQL query builder/connection support for parameterized `ON CONFLICT ... RETURNING`

### Secondary (MEDIUM)

- Context7 classify-confidence MEDIUM for docs provider
- Phase 09/11 RESEARCH/CLOSURE

### Tertiary (LOW)

- PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` semantics (general database behavior)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new deps; Medusa 2.16.0 verified  
- Architecture: HIGH — unsupported cross-module atomicity rejected; module-local PostgreSQL upsert selected
- Pitfalls: HIGH — actor spoof/API-key attribution, unstable `updated_at`, mock-only proof, temporal-order limits and REL-02 creep documented

**Research date:** 2026-07-16; revised 2026-07-20
**Valid until:** ~2026-08-16 (Medusa minor moves fast; re-check auth types if upgrading)

---

## RESEARCH COMPLETE

**Phase:** 12 - Ops, Audit & Critical Tests  
**Confidence:** HIGH  

### Key Findings

- Admin framework capability confirmed, but Phase 12 actor policy is fixed to `actor_type === "user"` + required `actor_id`; API keys fail closed.
- OPS-02 = explicit wrappers on refund/exchange only; Strategy A cross-module atomicity is infeasible on current proof; Strategy B correlated append-only rows; stop body actor spoof.
- OPS-01 = two alert types; atomic PostgreSQL `ON CONFLICT`; local `CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000`; no unstable `PaymentAttempt.updated_at` clock.
- Read-only alert Admin API; ack/resolve deferred; email PRD debt recorded (H12-01).
- TEST-01 = flat `integration-tests/http/invariants-inv*.spec.ts` plus disposable-PostgreSQL proofs for dedupe, claims, single-active, alert concurrency, migrations and indexes.

### File Created

`.planning/phases/12-ops-audit-critical-tests/12-RESEARCH.md`

### Human review gate

**Phase 12 RESEARCH revised — awaiting human review.**

```text
Phase 12 RESEARCH revised
awaiting human review
PLAN not started
execution blocked
```

Do **not** start PLAN, VALIDATION, SPEC/SDD, implementation prompts, runtime code, migrations, or deploy until this `12-RESEARCH.md` is explicitly accepted.
