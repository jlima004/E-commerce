# Phase 12: Ops, Audit & Critical Tests - Research

**Researched:** 2026-07-16  
**Domain:** OperationalAlert + AdminActionLog + critical invariant regression tests (Medusa v2 Admin/API)  
**Classification:** PASS  
**Confidence:** HIGH  

---

## 1. Executive conclusion

Phase 12 is **plannable and implementable** without inventing payment SLAs, without a generic `/admin/*` intercept, and without alert email. Admin actor identity is available on installed Medusa **2.16.0** via `req.auth_context.actor_id` on default-protected `/admin` routes (`actor_type` is `"user"` for session/bearer JWT, or `"api-key"` for secret Admin API keys). OPS-01 can persist two alert families (`payment_stuck`, `fulfillment_failed`) with concurrency-safe unique dedupe and reopen-in-place. OPS-02 can append-only audit the existing refund/exchange Admin surfaces with **Strategy A** (one immutable terminal row per Admin attempt — never mutate `requested → succeeded` on the same row). TEST-01 can consolidate named INV proofs by reusing existing HTTP/unit harnesses under a dedicated invariant suite folder.

**Primary recommendation:** Two custom modules (`operational_alert`, `admin_action_log`) + one narrow stuck-payment/fulfillment scanner job + explicit audit wrappers on three Admin mutation routes + read-only alert list/detail + hybrid invariant suite. No new npm dependencies. Alert email remains an explicit PRD divergence debt (H12-01).

### 1.1 Classification and confidence

| Gate | Result |
|------|--------|
| Classification | **PASS** (not BLOCKED; no “PASS WITH KNOWN DEBTS”) |
| Overall confidence | **HIGH** — Admin auth verified on installed types + official docs; schemas mapped to DB_MODEL; local stuck window derived from existing 15m in-flight stale convention |
| Admin actor identifiable | **Yes** — fail-closed on missing/empty `actor_id` |
| Unsafe native intercept required | **No** |
| Alert surface without large UI | **Yes** — JSON list+detail under `/admin/operational-alerts` |
| Dedupe concurrency-safe | **Yes** — unique `(type, entity_type, entity_id)` + upsert/reopen |
| Stuck payment SLA invented | **No** — Pix uses Stripe `expires_at`; confirmed-without-Order uses CheckoutCompletionLog `locked_at` age aligned to existing 15m relay stale constants |
| AdminActionLog append-only+atomic | **Yes** — Strategy A + same-request audit insert; fail request if audit insert fails after mutation attempt policy below |
| Invariants testable at real boundaries | **Yes** — existing HTTP/unit suites already exercise those boundaries |

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
- **H12-04:** Choose Strategy A (one terminal immutable row) OR B (correlated events). Never update `requested→succeeded` on same row. **Research chooses A.**
- **H12-05:** Fail closed without Admin actor; no unknown/system/null `admin_id` for auditable actions.
- **H12-06:** Do not alert immediately after `payment_confirmed_by_webhook`; derive stale window from CheckoutCompletionLog lock/recovery.

#### Claude's Discretion

Research recommends concrete schema columns, scanner job shape, Strategy A, actor resolution including API-key (PLAN may tighten to user-only), ack/resolve deferral (fields-only + reopen), thin reprocess route deferred, and invariant suite as flat `integration-tests/http/invariants-inv*.spec.ts` (jest discovery constraint).

#### Deferred Ideas / Out of scope (OUT OF SCOPE)

Dashboard/PagerDuty/Slack/alert email; event sourcing/SIEM; automated remediation; REL-02 sweeper; cross-dyno refund lock; Correios API; new Gelato API surface; real provider calls; Heroku/Redis/health redesign; catalog publish audit; Phase 13; storefront; inventing Gelato reprocess product in CONTEXT.

</user_constraints>

### 1.3 Phase requirements map

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | Failed fulfillments and stuck payments surface as persisted OperationalAlerts | §5–§8 detection + schema + scanner; Phase 09 fields remain source for fulfillment |
| OPS-02 | Admin money/order/fulfillment actions recorded in AdminActionLog | §3–§4 actor; §9 Strategy A atomicity; explicit route wrappers only |
| TEST-01 | Automated tests guard INV-1/2, INV-3/4, INV-8, INV-9/10 | §10 hybrid suite + existing harness inventory |

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
4. **Secret API key:** Middleware sets `actor_type: "api-key"`, `actor_id = apiKey.id` (not a User id). [VERIFIED: `authenticate-middleware.js`]
5. **Optional email:** Resolve via Query graph `entity: "user"` filtered by `actor_id` when `actor_type === "user"`. Skip email lookup for `api-key` (store `admin_email = null`, metadata `actor_type`). [CITED: docs]
6. **Opt-out:** `export const AUTHENTICATE = false` disables default protection — **must not** be used on audited money routes. [CITED: docs]
7. **Project middlewares.ts:** Custom Admin routes rely on default `/admin` auth; no extra `authenticate("user")` layer today. Correlation middleware sets `req.correlationId` globally. [VERIFIED: codebase]

### Fail-closed actor resolution (H12-05) — prescribe

```typescript
// Pattern for audited Admin handlers (fictional ids)
function requireAdminActor(req: AuthenticatedMedusaRequest): {
  admin_id: string
  actor_type: "user" | "api-key"
} {
  const actorId = req.auth_context?.actor_id?.trim()
  const actorType = req.auth_context?.actor_type
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "ADMIN_ACTOR_REQUIRED")
  }
  if (actorType !== "user" && actorType !== "api-key") {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "ADMIN_ACTOR_TYPE_UNSUPPORTED")
  }
  return { admin_id: actorId, actor_type: actorType }
}
```

- **Accept** both `user` and `api-key` as identifiable Admin actors (secret keys are Admin-grade).
- **Reject** missing/empty `actor_id`, `null`, invented `"system"` / `"unknown"`.
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
| Native Order cancel / payment refund / fulfillment | Medusa Admin core APIs | Native | Framework `user`/`api-key` | **Inventário only** | Project ops path is custom refund/exchange; no generic `/admin/*` intercept |
| Stripe webhook Order/refund finalize | `/hooks/stripe` + workflows | Automatic | N/A | **Não** | Not Admin action |
| Gelato dispatch/webhook | jobs + `/hooks/gelato` | Automatic | N/A | **Não** | Not Admin action |
| Analytics/email relays | scheduled jobs | Automatic | N/A | **Não** | Not Admin action |

### Recommended typed actor (not implemented here)

```ts
type AdminActor = {
  admin_id: string           // req.auth_context.actor_id (user.id or apiKey.id)
  admin_email?: string       // Query entity "user".email when actor_type === "user"
}
```

Validate `actor_type ∈ {"user","api-key"}`; fail closed otherwise. Helper suggested location: `apps/backend/src/modules/admin-action-log/require-admin-actor.ts` (PLAN).

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

Service method `upsertOpenAlert(input)`:

1. Attempt insert with `status=open`, `occurrence_count=1`, `first_seen_at=last_seen_at=now`.
2. On unique violation on `(type, entity_type, entity_id)`:
   - If existing `open|acknowledged`: update `last_seen_at`, `occurrence_count += 1`, refresh sanitized `message`/`error_code`/`severity` (severity may escalate dead_letter→critical), keep status.
   - If existing `resolved|ignored`: **reopen** → `status=open`, clear `acknowledged_at`/`resolved_at`, bump occurrence, set `last_seen_at`, refresh message.
3. Never insert a second row for the same logical key.

Use DB unique constraint as the race authority (not check-then-act). Application catch of unique violation + reload/update is acceptable and matches CheckoutCompletionLog claim style in this codebase. [ASSUMED: Medusa service layer will use try/catch around create rather than raw SQL `ON CONFLICT` unless PLAN adds a custom SQL migration helper.]

### Email

`sent_at` remains null. No `EmailDeliveryLog` operational_alert emission. DATA-090 email dedupe is **future** debt when email is implemented — not Phase 12.

---

## 7. Alert detection architecture

### Principles

- Narrow scanner + transition hooks; **not** REL-02.
- H12-06: never alert on the same tick as confirmation without stale evidence.
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
   - **No** CheckoutCompletionLog for the attempt/intent, **and** `PaymentAttempt.updated_at` (or confirmed transition time if available) age ≥ stale window, **OR**
   - CCL `status = failed` and still no `order_id`, **OR**
   - CCL `status = processing` **and** `order_id IS NULL` **and** `locked_at` age ≥ stale window

**Stale window derivation (no invented Stripe SLA):**  
CheckoutCompletionLog has **no** dedicated wall-clock constant today; stale processing is marked `CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER` on the **next claim** (`retry_processing_without_order`). [VERIFIED: `checkout-completion/service.ts`]  
Existing in-flight stale convention in this repo is **15 minutes** (`GELATO_DISPATCH_STALE_AFTER_MS`, `EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS`).  

**Prescribe:** export `CHECKOUT_COMPLETION_STALE_PROCESSING_MS = 15 * 60_000` next to checkout-completion claim helpers (or shared ops constant) and use it for scanner age checks on `locked_at` / confirmed-without-CCL. This **derives** from documented local lock/recovery + existing relay stale policy, not from a new card/Pix provider timeout.

Do **not** alert while CCL is `processing` and `locked_at` is fresh (< 15m).

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

### Strategy choice (H12-04): **Strategy A — one terminal immutable row**

| Strategy | Meaning | Decision |
|----------|---------|----------|
| **A** | One row per Admin attempt; `result` is terminal for that attempt; never UPDATE | **Chosen** |
| **B** | Correlated event stream (`requested` row + later `succeeded` row) | Rejected for MVP complexity; violates “never update requested→succeeded on same row” if done poorly |

Implications:

- `refund_order` Admin reservation → insert `result = requested` (financial truth remains Stripe webhook / RefundRequest — not an AdminActionLog update).
- Exchange create/update → insert `succeeded` | `failed` | `blocked` for that HTTP attempt.
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
| `metadata` | `request_id`/`correlation_id`, `order_id`, `idempotency_key`, `actor_type`, `reused_idempotency` |
| `created_at` | Append-only — **no updated_at mutations in app flow** |

Indexes per DB_MODEL: `admin_id`, `action`, `(entity_type, entity_id)`, `result`, `created_at`, `(admin_id, created_at)`.

### Atomicity / ordering (resolve append-only + atomic)

Prescribe per audited route:

1. Resolve actor (**fail closed** before domain work).
2. Run domain mutation (RefundRequest / ExchangeRequest).
3. **Insert** AdminActionLog with final `result` for this attempt.
4. If step 3 fails after step 2 succeeded: **fail the HTTP request** with sanitized error and rely on domain idempotency keys for safe retry (refund `idempotency_key` already unique). Do not swallow audit failures.
5. For validation/`blocked` before domain write: insert `result=blocked` (best-effort) then return error — if blocked audit insert fails, still return the business error but log sanitized ops error (PLAN may harden to fail closed always).

**Never** `UPDATE` AdminActionLog rows. No `requested → succeeded` mutation.

### Idempotency

- Prefer **always append** one row per HTTP attempt (including idempotent refund reuse) with `metadata.reused_idempotency=true` when applicable.
- Optional unique `(action, metadata.idempotency_key)` is **not** required if append-always is chosen; avoid silent audit loss.

### `reprocess_fulfillment`

No Admin route today. **Defer** thin audited wrapper (CONTEXT + DISCUSSION). DATA-097 remains future when product action exists. OPS-02 MVP satisfied by refund + exchange surfaces that exist.

---

## 10. Critical invariant test strategy

### Layout (prescribe)

**Jest discovery constraint (VERIFIED):** `apps/backend/jest.config.js` for `TEST_TYPE=integration:http` uses:

```text
**/integration-tests/http/*.spec.[jt]s
```

Nested `integration-tests/http/invariants/*.spec.ts` would **not** be discovered today. Prefer one of:

1. **Flat named files (default):** `integration-tests/http/invariants-inv01-02-order-birth.spec.ts` (etc.) — no jest.config change.
2. **Nested folder:** only if PLAN also widens `testMatch` to `**/integration-tests/http/**/*.spec.[jt]s`.

```text
apps/backend/integration-tests/http/
  invariants-inv01-02-order-birth.spec.ts
  invariants-inv03-04-webhook-idempotency.spec.ts
  invariants-inv08-gelato-single-active.spec.ts
  invariants-inv09-10-refund-decoupling.spec.ts
```

Plus module unit mirrors only when a gap cannot be expressed at HTTP/workflow boundary:

```text
apps/backend/src/modules/**/__tests__/*.unit.spec.ts  # extend / thin INV-named describes
```

HTTP “integration” harnesses today use **mocked** module services (no real Postgres suite / no `medusaIntegrationTestRunner` for these INV paths). TEST-01 proves boundaries via existing mock HTTP + unit claim/unique patterns; do not claim cross-dyno DB races.

### Final INV matrix (TEST-01)

| INV | Existing test | Real DB? | HTTP? | Concurrency? | Gap | Recommended file |
|-----|---------------|----------|-------|--------------|-----|------------------|
| INV-1 | `payment-attempt-order-eligibility.unit.spec.ts`; `webhook-order-entrypoint.unit.spec.ts`; `stripe-webhook-order-creation.spec.ts` | No (mock HTTP harness) | Yes | Partial (claim units) | Not named as INV-1 suite | `integration-tests/http/invariants-inv01-02-order-birth.spec.ts` (+ keep unit eligibility) |
| INV-2 | `payment-attempt-state.unit.spec.ts`; `pix-initiation.unit.spec.ts`; eligibility/webhook rejects; HTTP cancel/fail paths | No | Partial | No | Named `pix_expired → zero Order` may be implicit | same `invariants-inv01-02-*.spec.ts` + unit assert |
| INV-3 | `stripe-webhook-route.unit.spec.ts`; HTTP webhook suites with signature doubles | No | Yes | No | Not labeled INV-3 | `integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts` |
| INV-4 | `webhook-event-log.unit.spec.ts`; `checkout-completion-log.unit.spec.ts`; entrypoint replay units; HTTP duplicate/replay | No | Yes | Process-local / unique-constraint simulation | True multi-worker cross-dyno unproven | same `invariants-inv03-04-*.spec.ts` |
| INV-8 | `gelato-fulfillment.unit.spec.ts` (single-active); dispatch relay units; HTTP “exactly one GelatoFulfillment” | No | Yes | Unique `order_id` design + mock | Manual Admin reprocess path absent | `integration-tests/http/invariants-inv08-gelato-single-active.spec.ts` |
| INV-9 | `refund-stripe-webhook.unit.spec.ts`; `stripe-refund-webhook.spec.ts` | No | Yes | Process-local refund claim | No real Stripe smoke (deferred) | `integration-tests/http/invariants-inv09-10-refund-decoupling.spec.ts` |
| INV-10 | `stripe-refund-webhook.spec.ts`; refund-request units (no auto-cancel) | No | Yes | No | Named INV-10 case (partial+total) | same `invariants-inv09-10-*.spec.ts` |

### Concurrency levels (what tests can prove)

| Concern | Process-local | Postgres transactional | Cross-dyno |
|---------|---------------|------------------------|------------|
| CheckoutCompletionLog unique claim | Covered in units/HTTP | Unique `payment_intent_id` | Unproven |
| WebhookEventLog dedupe | Covered | Unique provider event key | Unproven |
| Gelato single-active | Covered | Unique `order_id` / idempotency_key | Unproven |
| AdminActionLog idempotency | Append-always (+ optional key metadata) | No unique required for MVP | Unproven |
| OperationalAlert upsert | create+catch unique | Unique `(type, entity_type, entity_id)` | Unproven |

TEST-01 must not claim cross-dyno proofs.

### Environment (D12-15)

- Jest scripts already: `test:unit`, `test:integration:http`, `test:integration:modules`
- Local disposable PG/Redis only; injectable Stripe/Gelato doubles (existing pattern)
- No real provider smokes in TEST-01

### Module tests for new OPS modules

Unit tests for upsert/reopen, sanitization, Strategy A immutability, actor fail-closed — under each new module `__tests__/`.

---

## 11. Module/migration structure

### Recommended modules (match Phases 05–11)

```text
apps/backend/src/modules/operational-alert/
  index.ts                 # Module("operational_alert", { service })
  models/operational-alert.ts
  service.ts               # upsertOpenAlert, list/retrieve helpers, sanitizers
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

- Prefer `npx medusa db:generate <moduleKey>` then review; project also uses hand-authored `TBD-*` stubs with grepped SQL in unit tests (Gelato/Refund pattern).
- Safe migrate path: `npm run db:migrate:safe` / project scripts — PLAN should follow Phase 11 migration discipline (no reckless production migrate in research).
- **No** schema changes to PaymentAttempt / GelatoFulfillment / RefundRequest unless strictly necessary — prefer logical `entity_type`/`entity_id` references. Exception: stop trusting body `requested_by_operator_id` (behavior change, column already exists).

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

Ignore client-supplied admin ids. API-key actors recorded as `admin_id=<api_key_id>` with `metadata.actor_type=api-key` (not a User email).

### ASVS (security_enforcement enabled)

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V2 Authentication | yes | Default `/admin` auth + fail-closed actor |
| V3 Session Management | yes | Medusa session/bearer/api-key |
| V4 Access Control | yes | Admin-only routes; no AUTHENTICATE=false on money paths |
| V5 Input Validation | yes | Existing allowlists + zod-like Medusa errors; alert query filters validated |
| V6 Cryptography | no new crypto | No new token schemes in Phase 12 |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Spoofed operator id in body | Spoofing | Actor only from auth_context |
| Alert/audit XSS via message | Tampering | Sanitize + length cap; Admin JSON only |
| Secret leakage in alert metadata | Information disclosure | Allowlist metadata keys + sanitizers |
| Duplicate alert spam | Denial of service (ops) | Unique key + occurrence bump |
| Audit gap on success | Repudiation | Fail request if audit insert fails post-mutation |

---

## 13. Documentary inconsistencies

Do **not** fix these texts in this RESEARCH gate. Record only.

| Obsolete / misleading text | Where | Superseding source | Risk to PLAN | Recommend fix |
|----------------------------|-------|--------------------|--------------|---------------|
| `REDIS_CACHE_PROVIDER_DISABLED=true` as current operational truth | `REQUIREMENTS.md` SETUP-02; `ROADMAP.md` Phase 01 closure; historical STATE notes | CACHE-01A/B + INFRA-01 + stabilization SUMMARY (`260716-p3o-…`); STATE already notes supersession | PLAN might re-open cache TLS debt | Doc hygiene before/during PLAN Wave 0 — mark historical |
| “production activation blocked” on PAY-01..PAY-04 | `REQUIREMENTS.md` checklist + traceability; `ROADMAP.md` Phase 04 | Later gates (04A real layers; Phases 05–11 money path closed); production healthy per stabilization closure | PLAN might treat payments as still blocked | Clarify “historical Phase 04 gate language” vs current production |
| ROADMAP Phase 12 “not started; blocked until explicit approval” | `ROADMAP.md` Phase 12 | This RESEARCH gate after human CONTEXT approval | Stale roadmap status after RESEARCH | Update ROADMAP status at PLAN start (not now) |
| PRD BE-EM-009 / BE-AN-005 Must-Have alert **email** | `docs/PRD_Backend_v1.1.md` | CONTEXT + H12-01 | PLAN might add Resend alert | Keep deferred; cite PRD divergence in PLAN out-of-scope |
| DATA-090 email dedupe | DB_MODEL | Email out of Phase 12 | Accidental email work | Future when email ships |
| DATA-097 `reprocess_fulfillment` | DB_MODEL | No Admin route | Invent reprocess product | Defer |
| DB_MODEL `approve_exchange` vs runtime statuses | DB_MODEL §4.14 vs `EXCHANGE_REQUEST_STATUSES` | Runtime has `rejected`/`canceled` but no `approved` | Mis-tagged audit actions | Map by status deltas in PLAN |
| DB_MODEL `Fulfillment` vs runtime `gelato_fulfillment` | DB_MODEL / module | `entity_type=fulfillment` + GelatoFulfillment.id | Wrong entity_type | Follow §5 mapping |
| SRS Order-before-payment wording | `docs/SRS_v1.5.md` | PRD + DB_MODEL + Phases 05–06 | Confusion on INV-1 | Already governed; no reopen |
| ROADMAP “every Admin action on money/order/fulfillment” | Phase 12 success criteria | CONTEXT D12-09 custom refund/exchange only | Over-scope native intercept | Honor CONTEXT in PLAN |
| FUL-01..04, WHK-03, TRK-01/02, REF-01/02, EXC-01/02 still `[ ]` / “Pending”; footer still says Phase 09 not started | `REQUIREMENTS.md` checklist + traceability | Phase 09–11 CLOSURE + STATE | **High** — PLAN may re-scope closed work | **Before PLAN** documentary sync |
| PROJECT.md Active checklist still all `[ ]` for built invariants | `.planning/PROJECT.md` | Closures 05–11 | Medium — agents think features unbuilt | Before PLAN |
| FUL-04 “raise operational alert” vs Phase 09 minimal fields | REQUIREMENTS FUL-04 | 09-CLOSURE minimal; OPS-01 = Phase 12 promotion | Medium — clarify FUL-04 done; OPS-01 additive | Before PLAN |

None of these are unresolvable canonical contradictions that BLOCK research. Do not reopen closed MNY/REL/CACHE/INFRA debts.

---

## 14. Recommended Phase 12 slices

> Slice suggestions only — **do not** create `12-0x-PLAN.md` in this research gate.

| Slice | Outcome | Requirements |
|-------|---------|--------------|
| **12-01** | Modules + migrations: `operational_alert`, `admin_action_log`; register in config; unit tests for models/upsert/insert-only | OPS-01/02 foundation |
| **12-02** | Actor helper + AdminActionLog wiring on refund + exchange routes; stop body operator spoof; HTTP tests for audit rows + fail-closed | OPS-02 |
| **12-03** | Detection: fulfillment transition upserts + stuck-payment/fulfillment scanner job; stale window constant; unit tests | OPS-01 |
| **12-04** | Read-only `GET /admin/operational-alerts` list+detail filters; HTTP tests | OPS-01 / H12-02 |
| **12-05** | Invariant suite flat `integration-tests/http/invariants-inv*.spec.ts` (or widen jest `testMatch`); consolidate INV-1/2/3/4/8/9/10 | TEST-01 |
| **12-06** | Documentary PRD divergence note + closure greps (no email relay, no `/admin/*` generic intercept, no Strategy B updates) | Governance |

Wave ordering: 12-01 → (12-02 ∥ 12-03) → 12-04 → 12-05 → 12-06.

---

## 15. Risks and unresolved blockers

### Non-blocking risks (PLAN should mitigate)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Audit insert fails after RefundRequest create | Orphan reservation without audit | Fail HTTP; idempotent retry safe |
| Scanner false positives during healthy Order birth (<15m) | Ops noise | H12-06 stale window |
| API-key `admin_id` is key id not user id | Attribution clarity | metadata.actor_type; optional docs for operators |
| Medusa create+catch unique vs SQL upsert | Rare double-bump races | Unique constraint + reload; tests under concurrency if feasible |
| Local PG/Redis not running in this research shell | Exec environment | Existing test harnesses start disposables — verify in PLAN Wave 0 |
| Exchange “approve” action enum vs statuses | Mis-tagged actions | Explicit mapping table in PLAN |

### Blockers

**None for research PASS.** No unresolved item meets the orchestrator BLOCKED list (actor identifiable; no unsafe intercept; alerts surfaceable; dedupe safe; no invented payment SLA; append-only atomicity defined; invariants testable; docs tensions resolved by CONTEXT/H12).

---

## 16. Items explicitly rejected

- Alert email / Resend operational_alert / PagerDuty / Slack (H12-01)
- Admin dashboard UI / widgets
- Generic `/admin/*` audit middleware intercept (H12-03)
- Strategy B correlated multi-row lifecycle updates mutating the same row (H12-04)
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
4. **Blocked-path audit failure policy** — fail closed always vs best-effort blocked row. Recommendation: best-effort for pre-domain blocks; fail closed after successful domain mutation.
5. **Optional `GET /admin/admin-action-logs`** for support — default defer.
6. **Constant placement** for `CHECKOUT_COMPLETION_STALE_PROCESSING_MS` — checkout-completion module vs shared `ops/stale.ts`.
7. **Invariant suite layout** — flat `invariants-inv*.spec.ts` (default) vs nested folder + jest `testMatch` widen; optional `test:invariants` script.
8. **Migration style** — CLI generate vs TBD hand-authored stubs (match Phase 11 Gelato/Refund).
9. **Actor policy for `api-key`** — accept as `admin_id` (current RESEARCH default) vs **user-only** fail-closed (stricter attribution; Track 1 preference). Default remains accept both until PLAN decides.
10. **REQUIREMENTS.md checkbox sync** for closed Phases 09–11 / SETUP-02 wording — documentary-only before PLAN Wave 0.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime/tests | ✓ | v22.23.1 | — |
| npm | Install/scripts | ✓ | 10.9.8 | — |
| `@medusajs/*` 2.16.0 | Framework | ✓ | 2.16.0 | — |
| PostgreSQL server | Migrations/tests | ✗ at research probe | client 17.10 present | Test harness disposable PG (existing) |
| Redis | Jobs/tests | ✗ CLI missing | — | Harness/docker disposable Redis (existing project pattern) |
| Docker | Disposable deps | ✓ path present | — | Use if harness needs it |

**Missing dependencies with no fallback:** none for planning (execution uses existing test infra patterns).  
**Missing with fallback:** local PG/Redis daemons — use project test disposable approach.

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
| OPS-01 | Alert upsert/reopen + scanner predicates | unit | `test:unit -- --runTestsByPath src/modules/operational-alert/__tests__` | ❌ Wave 0 |
| OPS-01 | GET list/detail | HTTP | `test:integration:http -- --runTestsByPath integration-tests/http/admin-operational-alerts.spec.ts` | ❌ Wave 0 |
| OPS-02 | Audit on refund/exchange + fail-closed actor | HTTP/unit | admin-refunds/exchanges + new audit asserts | ⚠️ extend existing |
| TEST-01 INV-* | Named invariant suite | HTTP/unit | `integration-tests/http/invariants-inv*.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- Per task commit: focused unit path  
- Per wave merge: unit + relevant HTTP  
- Phase gate: full focused matrix green before verify-work  

### Wave 0 Gaps

- [ ] `src/modules/operational-alert/**` + tests  
- [ ] `src/modules/admin-action-log/**` + tests  
- [ ] `integration-tests/http/invariants-inv*.spec.ts` (flat; or nested + jest `testMatch` widen)
- [ ] `integration-tests/http/admin-operational-alerts.spec.ts`

- [ ] Actor fail-closed cases on admin-refunds/exchanges  

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Medusa module service will implement upsert via create+catch unique rather than raw `ON CONFLICT` | §6 | PLAN may need custom SQL for atomic upsert |
| A2 | `PaymentAttempt.updated_at` is reliable enough for confirmed-without-CCL age when no CCL exists | §7 | May need explicit confirmed_at field later |
| A3 | Accepting `api-key` as `admin_id` satisfies DATA-091 “admin user” spirit for MVP | §3 | Human may require user-only actors |

## Sources

### Primary (HIGH)

- Installed `@medusajs/framework` 2.16.0 `router.js`, `authenticate-middleware.js`, `types.d.ts`
- Context7 `/websites/medusajs` — Protected Routes, Auth actor types, modules/migrations
- `docs/DB_MODEL_v1.21.md` §2.17, §4.14, §4.16
- Runtime: checkout-completion claim, gelato stale constants, Admin refund/exchange routes, jobs relays

### Secondary (MEDIUM)

- Context7 classify-confidence MEDIUM for docs provider
- Phase 09/11 RESEARCH/CLOSURE

### Tertiary (LOW)

- WebSearch upsert/partial unique index patterns (general PG practice)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new deps; Medusa 2.16.0 verified  
- Architecture: HIGH — modules/routes/jobs match repo patterns  
- Pitfalls: HIGH — actor spoof, immediate alert, Strategy B mutation, REL-02 creep documented  

**Research date:** 2026-07-16  
**Valid until:** ~2026-08-16 (Medusa minor moves fast; re-check auth types if upgrading)

---

## RESEARCH COMPLETE

**Phase:** 12 - Ops, Audit & Critical Tests  
**Confidence:** HIGH  

### Key Findings

- Admin actor confirmed: `auth_context.actor_id` + `actor_type` `user`|`api-key` on default-protected `/admin` (Medusa 2.16.0).
- OPS-02 = explicit wrappers on refund/exchange only; Strategy A immutable rows; stop body `requested_by_operator_id` spoof.
- OPS-01 = two alert types; unique logical key; 15m stale window derived from CheckoutCompletionLog lock + existing relay stale constants; narrow scanner.
- Read-only alert Admin API; ack/resolve deferred; email PRD debt recorded (H12-01).
- TEST-01 = flat `integration-tests/http/invariants-inv*.spec.ts` hybrid reuse (jest `testMatch` is flat-only today).

### File Created

`.planning/phases/12-ops-audit-critical-tests/12-RESEARCH.md`

### Human review gate

**RESEARCH COMPLETE — stop for human review.**
Do **not** start PLAN, VALIDATION, SPEC/SDD, implementation prompts, runtime code, migrations, or deploy until this `12-RESEARCH.md` is explicitly accepted.
