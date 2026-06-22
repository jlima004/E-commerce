# Pitfalls Research

**Domain:** Brazilian POD t-shirt e-commerce backend (Medusa v2 + Stripe card/Pix + Gelato fulfillment + outbox analytics)
**Researched:** 2026-06-22
**Confidence:** HIGH (payment/webhook/fulfillment correctness verified against official Stripe, Gelato, and Medusa v2 docs; MEDIUM on some Brazil-operational and ops-tooling nuances)

> Scope note: this domain's entire reason for existing is the **payment → order → fulfillment correctness boundary**. The 12 architecture invariants in `docs/seed/GSD_BACKEND_MVP_SEED.md` are not "nice to have" — most of the critical pitfalls below are concrete ways each invariant gets violated in practice. References to "INV-N" map to those numbered invariants.

---

## Critical Pitfalls

### Pitfall 1: Creating the Order from the checkout response / client callback instead of from the verified webhook

**What goes wrong:**
The Order is created when the storefront (or a `cart.complete` call) returns "payment confirmed", or when Stripe's client-side `confirmPayment` resolves. This produces Orders with no real settled payment, double Orders (client retries + webhook), and — for Pix — Orders for payments that never actually arrive. Directly violates **INV-1** and **INV-4**.

**Why it happens:**
Medusa's default `completeCartWorkflow` is built to create the Order synchronously at the end of checkout. Teams wire the storefront "thank you" page or the cart-complete endpoint to be the source of truth because it's the path of least resistance and matches the default tutorials. Client-side confirmation *feels* authoritative for cards.

**How to avoid:**
Make the canonical Stripe webhook the **only** trigger that creates an Order. Decouple "checkout submitted" (creates/updates `PaymentAttempt`, `PaymentSession`, `PaymentCollection`) from "Order created" (driven by `payment_intent.succeeded` → `CheckoutCompletionLog` → Order). The client callback may *poll* order status but must never *create* it. Override/replace the default cart completion so it does not mint the Order eagerly.

**Warning signs:**
Orders exist with `payment_status` not `captured/paid`; an Order can be found whose `payment_intent` is still `requires_action`/`processing`; integration tests pass without ever firing a webhook.

**Phase to address:** Webhooks & Order Creation (must be designed before any "checkout works end to end" demo is accepted).

---

### Pitfall 2: Skipping or mis-implementing Stripe webhook signature verification

**What goes wrong:**
The webhook endpoint parses `req.body` as JSON and trusts it, or verifies the signature against an already-parsed/re-serialized body. Result: forged events can create Orders or trigger refunds/fulfillment; or legitimate events fail verification because the raw bytes were mutated. Violates **INV-3**.

**Why it happens:**
Body-parser middleware (Medusa/Express) consumes the raw body before the handler sees it, so `stripe.webhooks.constructEvent` fails on the re-stringified payload. Developers "fix" it by removing verification instead of preserving the raw buffer. Also: using the wrong signing secret (Dashboard vs CLI `whsec_…`, or per-endpoint secret) and not handling clock skew/tolerance.

**How to avoid:**
Mount the Stripe webhook route with a **raw body** parser (exclude it from global JSON parsing), verify with `constructEvent(rawBody, sig, endpointSecret)`, and keep distinct secrets per environment. Reject (HTTP 400) on verification failure *before* any DB work. Use one dedicated endpoint per provider with its own secret. Keep the same discipline for the Gelato webhook (verify its signature/shared secret).

**Warning signs:**
Webhook handler reads `req.body` (already an object); signature failures in logs "fixed" by disabling checks; only one shared secret across dev/prod; Gelato webhook has no auth at all.

**Phase to address:** Webhooks & Order Creation.

---

### Pitfall 3: Webhook processing that isn't truly idempotent (duplicate Orders under redelivery)

**What goes wrong:**
Stripe redelivers events (retries on non-2xx, at-least-once delivery, occasional duplicates) and may deliver out of order. A handler that just "create Order if not exists by cart" races itself on concurrent redelivery and produces duplicate Orders, duplicate `purchase_completed`, and eventually duplicate Gelato orders. Violates **INV-3** and **INV-4**.

**Why it happens:**
Idempotency is implemented as a check-then-act in application code (`SELECT` then `INSERT`) with no DB-level uniqueness, so two concurrent deliveries both pass the check. Or dedup is keyed on `payload_hash` alone (fragile — Stripe can resend semantically identical events with differing payloads/timestamps).

**How to avoid:**
Two layers: (1) **WebhookEventLog** with `unique(provider, deduplication_key)` — derive `deduplication_key` from the trustworthy `external_event_id` (Stripe `evt_…`) when present, else a normalized deterministic key (per DB_MODEL v1.21 §4.5/1.19); treat `payload_hash` as diagnostic only. (2) **CheckoutCompletionLog** with a unique `idempotency_key` on `payment_intent_id` (or `cart_id + payment_intent_id`) guarding Order creation. Rely on the DB unique constraint + `INSERT … ON CONFLICT`/catch-unique to win the race; on conflict, return the existing `order_id`. Make Order creation + `CheckoutCompletionLog` update + `PaymentAttempt.order_id` update transactional (DB_MODEL §4.4).

**Warning signs:**
Idempotency enforced only in code, no `@@unique`; dedup keyed on `payload_hash`; load test with concurrent duplicate events yields >1 Order; replaying a Stripe event in the CLI creates a second Order.

**Phase to address:** Webhooks & Order Creation. Verify with an explicit "replay the same event twice / concurrently" test.

---

### Pitfall 4: Treating Pix like a synchronous card payment (pending/expired/cancelled wrongly creating Orders)

**What goes wrong:**
Pix is asynchronous and customer-initiated: confirming the PaymentIntent yields `requires_action` with a `pix_display_qr_code` (`data` + `expires_at`), then `processing`, then later `succeeded` **or** `payment_failed` (including QR-code expiry). Code that creates the Order when the QR is displayed, or on `requires_action`/`processing`, mints Orders for money that may never arrive. Violates **INV-2**.

**Why it happens:**
The card mental model ("user clicked pay → done") is applied to Pix. The QR-displayed UX state gets conflated with payment success. `payment_intent.processing` is misread as "paid".

**How to avoid:**
Only `payment_intent.succeeded` (canonical, webhook-verified) creates the Order — for **both** card and Pix. Model Pix UX states (`pix_qr_displayed`, `awaiting_pix_payment`, `pix_expired`) in `PaymentAttempt.client_confirmation_state`, never as financial truth (DB_MODEL §2.18). Explicitly handle `payment_intent.payment_failed`/expiry: mark the `PaymentAttempt` failed/expired, never the Order (Order doesn't exist yet). Persist `expires_at` so you can reconcile silently-expired QRs.

**Warning signs:**
Order or fulfillment logic branches on `requires_action`/`processing`; no handling for Pix expiry; a generated-but-unpaid Pix QR results in a findable Order; tests only cover the card happy path.

**Phase to address:** Payments (Stripe card + Pix / PaymentAttempt) and Webhooks & Order Creation.

---

### Pitfall 5: Coupling Gelato fulfillment to PostHog/analytics delivery success

**What goes wrong:**
Fulfillment waits for `AnalyticsEventLog.status = sent` (or for the PostHog HTTP call to succeed). When PostHog is slow/down or the frontend analytics fails, paid Orders never go to production — a revenue-impacting outage caused by a non-critical analytics dependency. Violates **INV-5** and **INV-7**.

**Why it happens:**
"`purchase_completed` then fulfill" gets implemented as "send analytics, await ack, then fulfill" because the outbox/local-durable distinction is subtle and easy to collapse into one synchronous chain.

**How to avoid:**
`purchase_completed` is a **backend domain event** persisted durably in `AnalyticsEventLog` (status `recorded`), with external PostHog delivery enqueued asynchronously and reprocessable (DB_MODEL v1.18 §DATA-003/DATA-103). Fulfillment depends on the **local durable record existing** (INV-6), not on `status = sent` and not on PostHog. External delivery failures must never block fulfillment.

**Warning signs:**
Fulfillment query filters `AnalyticsEventLog.status = 'sent'`; fulfillment code awaits the PostHog client; killing PostHog connectivity halts production orders in tests.

**Phase to address:** Analytics outbox (purchase_completed) and Fulfillment (Gelato).

---

### Pitfall 6: Duplicate Gelato orders (one paid Order → multiple production orders)

**What goes wrong:**
The Gelato `POST /v4/orders` call creates a **new** Gelato order for **every** request — it is not idempotent on its own. Retries, webhook redeliveries, worker restarts mid-flight, or concurrent triggers produce multiple real production+shipping orders for one paid Order (double cost, double shipment). Violates **INV-8**.

**Why it happens:**
Developers assume passing `orderReferenceId` (your internal id) dedupes server-side. It does not — Gelato allows many orders with the same `orderReferenceId`. Fulfillment is fired from a non-idempotent step with no local guard.

**How to avoid:**
Guard locally before calling Gelato: a unique constraint keyed on `Order` (e.g. one active `Fulfillment` per Order) so only one trigger can proceed; check `Fulfillment.gelato_order_id` is empty before submitting. Prefer the **draft → confirm** two-step pattern (create `orderType: "draft"`, then `PATCH` to `order` only after the local transaction commits) so a rollback/retry deletes/ignores the draft instead of confirming a duplicate — this is the documented fix for "concurrent post-payment processing creates duplicate Gelato orders." Persist `gelato_order_id` immediately. Make the fulfillment workflow step idempotent (Medusa retries steps). Reconcile via Gelato **Search orders by `orderReferenceId`** before re-submitting after a crash.

**Important nuance (avoid false alarms):** Gelato may legitimately split one submission into multiple **`connectedOrderIds`** (same `orderReferenceId`, different Gelato order ids). That is *not* a duplicate. INV-8's "one active Gelato order per Order, save controlled manual reprocessing" must treat connected orders as one logical fulfillment, and your dedup must be on *your* trigger, not on counting Gelato order ids.

**Warning signs:**
Fulfillment call site has no pre-check on existing `gelato_order_id`; no `@@unique` preventing two active fulfillments per Order; retry/restart during fulfillment yields two Gelato orders in the dashboard; dedup logic confuses `connectedOrderIds` with duplicates.

**Phase to address:** Fulfillment (Gelato). Verify with a "trigger fulfillment twice / crash-and-retry" test.

---

### Pitfall 7: Coupling refund (financial) state to order_status (cancel-on-refund)

**What goes wrong:**
An Admin refund automatically flips `order_status` to `canceled`, or the Order is marked refunded before Stripe confirms. This corrupts operational state (partial refunds shouldn't cancel; a refund may settle days later), and can wrongly stop/duplicate fulfillment or reporting. Violates **INV-9** and **INV-10**.

**Why it happens:**
"Refunded == cancelled" is an intuitive but wrong simplification. Financial state and fulfillment/order lifecycle are conflated into one status field.

**How to avoid:**
Keep financial state (`Refund`, `Payment`) decoupled from `order_status` (DB_MODEL §4.x). A local `Refund` only updates financial state **after** the Stripe refund webhook confirms (INV-9); it never auto-sets `order_status = canceled` (INV-10). Support partial refunds. Block concurrent `requested`/`processing` refunds per `Payment` and block refunds above captured amount (DB_MODEL v1.16/1.14). Correlate every refund webhook to `WebhookEventLog` and the `Refund` row.

**Warning signs:**
Refund handler writes `order_status`; refund marked complete on Admin click (pre-webhook); no partial-refund support; two refunds can be `processing` for one Payment.

**Phase to address:** Refunds & Exchanges (Admin).

---

### Pitfall 8: Storing tracking tokens / secrets / card data in plaintext or logs

**What goes wrong:**
Guest tracking tokens are stored in plaintext (DB or `EmailDeliveryLog`), or Stripe secrets / full card data / raw tokens / full webhook payloads land in application logs or Sentry. A DB leak or log exposure then hands out order access and PII; logging card data risks PCI scope. Violates **INV-11** and **INV-12**.

**Why it happens:**
Tokens are convenient to store as-is for "resend the link" features. Verbose request/payload logging during debugging captures secrets and PANs. Sentry breadcrumbs capture request bodies/headers by default.

**How to avoid:**
Persist only `TrackingAccessToken.token_hash` (hash/crypt, never plaintext), with `expires_at` and `revoked_at`; validate server-side; reference `metadata.tracking_token_id` instead of embedding the token (DB_MODEL §4.6/4.13, DATA rules). Never log secrets, full card data, or raw tokens (INV-12). Use a redaction layer in structured logging and configure Sentry `beforeSend`/PII scrubbing + `sendDefaultPii=false`. Authenticated customers access tracking via account ownership, not tokens.

**Warning signs:**
A `token` column with readable values; logs containing `sk_live`/`whsec`/PAN-like strings; full Stripe payloads dumped to logs/Sentry; email logs storing the raw tracking link.

**Phase to address:** Tracking & tokens; Observability (logging/Sentry redaction). Cross-cutting — set logging redaction up early in Foundation.

---

### Pitfall 9: Medusa v2 module/workflow misuse (cross-module FKs, side effects without compensation, non-idempotent steps)

**What goes wrong:**
Custom logic bypasses Medusa v2's module boundaries and workflow engine: direct cross-module foreign keys/joins instead of Module Links; multi-service side effects crammed into one step with no compensation; long external calls (Gelato/Stripe) made in steps that aren't idempotent on retry. Results: broken data integrity on upgrade, partial failures that can't roll back, and the duplicate-effects in Pitfalls 3/6.

**Why it happens:**
Medusa v2's modular architecture (isolated module services, Module Links, workflow steps + compensation, `idempotent`/locking options) is a real learning curve. v1 habits (shared DB, direct relations) and "just call the API inline" are faster short-term.

**How to avoid:**
Use **workflows with steps + compensation** for payment/order/fulfillment orchestration; keep steps small and self-contained; make any step with external side effects idempotent (guard before write) since steps are retried. Use the workflow `idempotent: true` / transaction id and the **Locking module** to prevent concurrent execution on the same Order/cart. Respect module isolation — link modules via Module Links, not raw FKs. Don't encapsulate the whole flow in one giant step. For Pix's wait-for-async use long-running workflow patterns (`setStepSuccess`/`setStepFailure`) rather than blocking.

**Warning signs:**
Raw SQL joins across module tables; steps with no `compensate`; external API calls in steps with no pre-write guard; no locking around per-Order workflows; "it worked in v1" patterns.

**Phase to address:** Foundation/Setup (establish module + workflow conventions) and every payment/fulfillment phase.

---

### Pitfall 10: Supabase/Postgres + Redis transactional pitfalls (pooler + cross-store "transactions")

**What goes wrong:**
(a) Running Medusa migrations or transactional work through Supabase's **PgBouncer transaction-mode pooler** breaks prepared statements / advisory locks / long transactions → migration failures and subtle data races. (b) Treating Redis (queue/cache/lock) as part of a DB transaction: enqueue happens but the DB commit rolls back (or vice-versa), so a job fires for an Order that doesn't exist, or an Order commits but the fulfillment job is lost. (c) Relying on Redis `SETNX` locks without TTL/ownership for idempotency, which fail open on crash.

**Why it happens:**
Supabase exposes both a direct (5432) and pooled (6543) connection; people point everything at the pooler. Redis "looks transactional" but is a separate system; the dual-write outbox concern is easy to miss.

**How to avoid:**
Use the **direct/session** connection for migrations and the pooler appropriately for runtime (per Supabase + Prisma/Medusa guidance); confirm `search_path`/prepared-statement settings. Don't span a logical transaction across Postgres and Redis — use the **outbox pattern**: commit the state change + an outbox row in one DB transaction, then a relay/worker publishes to Redis/PostHog/Gelato (this is exactly what `AnalyticsEventLog` and the log tables are for; reuse the pattern for fulfillment dispatch). Make Redis locks have TTL + owner token and treat lock loss as "fall back to DB unique constraint," never as the sole idempotency guarantee.

**Warning signs:**
Migrations run against port 6543/pooler and intermittently fail; jobs enqueued before the DB commit; an Order missing because its fulfillment job was enqueued then the tx rolled back; Redis locks with no TTL.

**Phase to address:** Foundation/Setup (DB connection strategy) and Webhooks/Fulfillment (outbox dispatch).

---

### Pitfall 11: Brazil/BRL/Pix-specific gotchas (IOF tax, BRL minor units, no manual capture, expiry windows, timezone)

**What goes wrong:**
- **IOF tax on Pix:** Stripe marks the customer's amount up 3.5% by default (`amount_includes_iof: never`), so the amount the customer sees/pays in their bank app differs from your intent amount — reconciliation and refund-amount math break if unaccounted. (Verified: Stripe Pix docs.)
- **Currency minor units:** BRL is charged in centavos (integer). Float reais or wrong scaling causes off-by-100 charges/refunds.
- **No manual capture for Pix:** auth-then-capture flows assumed from cards don't exist for Pix; refund is the only reversal.
- **Pix QR expiry:** short-lived; expiry must be handled as `payment_failed`, and late payments after expiry are an edge case to reconcile.
- **Timezone/locale:** America/Sao_Paulo vs UTC mismatches corrupt expiry calculations, reporting, and "order placed at" displays.

**Why it happens:**
Stripe tutorials are USD/card-centric; Brazilian payment tax and Pix semantics aren't on the default happy path.

**How to avoid:**
Decide and document IOF handling (`amount_includes_iof`) and reconcile against settled amount, not requested amount. Store money as integer minor units in BRL end-to-end; centralize formatting. Don't build manual-capture flows for Pix. Treat QR `expires_at` as authoritative and reconcile expired/late Pix. Store timestamps in UTC, render in America/Sao_Paulo.

**Warning signs:**
Refund amounts mismatch settled amounts; amounts stored as decimals; capture logic applied to Pix; expiry math in server-local time; customers report being charged 3.5% more than expected.

**Phase to address:** Payments (Stripe card + Pix), Catalog & Pricing (BRL modeling), Refunds.

---

### Pitfall 12: Out-of-order / partial-flow webhooks treated as a strict happy-path sequence

**What goes wrong:**
The flow assumes events arrive in order (`payment_intent.succeeded` before any related event) and exactly once per Order. In reality, related events (`charge.refunded`, Gelato status updates, payment failures) can arrive before correlated state exists, simultaneously, or interleaved across card vs Pix attempts on the same cart — leading to dropped events, orphaned state, or processing against missing rows.

**Why it happens:**
Linear thinking about an inherently concurrent, at-least-once delivery system; multiple `PaymentAttempt`s per cart (e.g. customer tries card, fails, then Pix) aren't modeled.

**How to avoid:**
Persist every relevant webhook to `WebhookEventLog` **before** processing; make handlers tolerant of "referenced entity not yet present" (record + safely defer/no-op rather than crash); correlate strictly by `payment_intent_id`/`orderReferenceId`. Allow multiple `PaymentAttempt`s per cart but ensure exactly one leads to Order creation (idempotency key). Keep handlers commutative where possible.

**Warning signs:**
Handlers throw on missing correlated rows; assumption of single attempt per cart; no persisted log before processing; reordering events in tests breaks the flow.

**Phase to address:** Webhooks & Order Creation; Refunds; Fulfillment.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Create Order in `completeCart` (default Medusa flow) | Checkout demo works fast | Phantom Orders, duplicates, Pix-for-unpaid; rewrite of the core boundary | **Never** — this is the product's reason to exist (INV-1) |
| Idempotency only in app code (no DB unique constraint) | Less schema work | Duplicate Orders/fulfillment under concurrency | **Never** for Order/fulfillment; OK for non-critical dedup |
| Call Gelato `orderType:"order"` directly inline | Simplest fulfillment call | Duplicate production+shipping cost on any retry | Only with a local pre-submit unique guard; prefer draft→confirm |
| Store tracking token in plaintext "to resend links" | Easy resend feature | Token/PII leak on DB or log exposure | **Never** (INV-11) — store hash + reference id |
| Verbose payload logging for debugging | Faster debugging | Secrets/PAN/token leakage (INV-12), PCI scope | Temporary, redacted, local only — never prod |
| Synchronous PostHog send before fulfillment | One less moving part | Analytics outage halts revenue (INV-7) | **Never** — use durable outbox |
| Point all connections at Supabase pooler | One connection string | Migration failures, prepared-stmt bugs | Runtime queries OK; migrations need direct/session conn |
| Single mega workflow step doing payment+order+fulfill | Fewer files | No compensation, non-idempotent retries, partial failures | **Never** — split into compensable steps |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe webhooks | Parsing JSON body before signature check; one shared secret | Raw-body verify with `constructEvent`; per-endpoint/env secrets; 400 on failure before DB work |
| Stripe Pix | Treating `requires_action`/`processing` as paid; ignoring IOF & expiry | Order only on `payment_intent.succeeded`; model UX states in `PaymentAttempt`; handle expiry as failure; account for 3.5% IOF |
| Gelato orders | Assuming `orderReferenceId` dedupes; firing `order` inline | Local unique guard + draft→confirm on post-commit; search-by-reference reconcile; treat `connectedOrderIds` as one logical order |
| Gelato webhooks | No signature/auth; matching on `metadata.gelato_order_id` | Verify webhook auth; canonical lookup via `Fulfillment.gelato_order_id` (DB_MODEL §4.5) |
| PostHog | Synchronous, fulfillment-blocking send | Durable `AnalyticsEventLog` outbox; async, reprocessable delivery |
| Resend (email) | Fire-and-forget, no idempotency | `EmailDeliveryLog` with `idempotency_key` + retry_count; send confirmation before Gelato attempt |
| Supabase Postgres | Migrations via transaction pooler | Direct/session connection for migrations; pooler for runtime |
| Redis | Cross-store "transaction" with Postgres; TTL-less locks | Outbox pattern (commit state+outbox together); locks with TTL + owner token, DB constraint as source of truth |
| Sentry | Default PII/breadcrumb capture leaks secrets | `sendDefaultPii=false`, `beforeSend` scrubbing, redact payloads |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Returning 2xx to Stripe only after slow work (Order+Gelato+email inline in webhook) | Stripe timeouts → retries → duplicate processing | Persist event, ack fast (2xx), process async via queue/workflow | Under load or when Gelato/Resend slow |
| Polling Gelato for status instead of using webhooks | Rate-limit/throttling, lag | Consume Gelato order/item webhooks; reconcile by exception only | As order volume grows |
| `AnalyticsEventLog`/`WebhookEventLog` without indexes on dedup/correlation keys | Slow dedup lookups, lock contention | Indexes on `deduplication_key`, `payment_intent_id`, `order_id`, `idempotency_key` | Log tables grow into 100k+ rows |
| Unbounded webhook retry without backoff/poison handling | Hot loops on a permanently-failing event | Bounded retries, `status=failed` with error_code, dead-letter/manual reprocess | First malformed/edge event in prod |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tracking token stored/logged in plaintext | Guest order access + PII leak | Store `token_hash` only; expiry + revocation; reference id in logs (INV-11) |
| Secrets/full card data/raw tokens in logs or Sentry | Credential/PAN leak, PCI scope | Redaction layer; Sentry PII off; never log full payloads (INV-12) |
| No/weak Gelato & Stripe webhook authentication | Forged Orders, refunds, fulfillment | Verify signatures/shared secrets before processing |
| Guest tracking endpoint without rate limiting / constant-time token compare | Token brute force, enumeration | Rate limit; hash compare; short expiry; revoke on use as needed |
| Admin refund/exchange actions unaudited | Fraud, no traceability | `AdminActionLog` for every operator action; least-privilege Admin |
| PaymentIntent metadata trusted as authorization | Tampered amounts/ids | Treat Stripe object from verified event as truth; re-fetch via API if unsure |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Order confirmed" shown before webhook settles (esp. Pix) | Customer expects shipment; payment may never arrive | Show "awaiting payment" for Pix; confirm only after `succeeded` |
| No feedback on Pix QR expiry | Customer pays an expired/late QR, confusion | Surface `expires_at`; allow regenerate; clear expired-state messaging |
| Refund shown as instant | Customer disputes when bank shows delay | Communicate refund is pending until Stripe confirms; reflect partial refunds |
| Confirmation email tied to Gelato success | No email when fulfillment lags/fails | Send confirmation (with `EmailDeliveryLog`) before Gelato attempt (per requirements) |

## "Looks Done But Isn't" Checklist

- [ ] **Checkout:** Often missing webhook-driven Order creation — verify no Order exists until `payment_intent.succeeded` is processed (INV-1).
- [ ] **Webhook idempotency:** Often missing DB-level uniqueness — verify replaying the same event twice (and concurrently) yields exactly one Order (INV-3/INV-4).
- [ ] **Pix:** Often missing expiry/failure handling — verify an unpaid/expired Pix QR creates no Order and marks `PaymentAttempt` failed (INV-2).
- [ ] **Fulfillment dedup:** Often missing local guard — verify triggering fulfillment twice / crash-retry yields one Gelato order; `connectedOrderIds` not miscounted (INV-8).
- [ ] **Analytics decoupling:** Often missing — verify killing PostHog connectivity does NOT block fulfillment (INV-5/INV-7).
- [ ] **Refund decoupling:** Often missing — verify a refund does not flip `order_status` to canceled and updates finance only post-webhook (INV-9/INV-10).
- [ ] **Token/secret hygiene:** Often missing — grep DB + logs for plaintext tokens/secrets/PAN; verify only `token_hash` persisted (INV-11/INV-12).
- [ ] **Webhook signature:** Often missing raw-body handling — verify forged/altered payloads are rejected with 400 (INV-3).
- [ ] **BRL money:** Often missing integer minor-unit handling and IOF accounting — verify refund amounts match settled amounts.
- [ ] **Migrations:** Often missing correct connection — verify migrations run on direct/session conn, not pooler.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate Orders created | MEDIUM | Identify by `payment_intent_id`; cancel/merge duplicates; backfill `CheckoutCompletionLog` unique key; add DB constraint to stop recurrence |
| Duplicate Gelato orders | HIGH | Cancel extra Gelato order(s) fast (production starts quickly); refund/eat cost; add local guard + draft→confirm; reconcile via search-by-reference |
| Order created for unpaid/expired Pix | MEDIUM | Cancel Order + any fulfillment; mark `PaymentAttempt` expired; fix trigger to `succeeded`-only |
| Fulfillment stalled by PostHog coupling | LOW | Hotfix: depend on local `AnalyticsEventLog` record, not `sent`; reprocess stuck Orders |
| Plaintext tokens/secrets leaked | HIGH | Revoke/rotate all tokens & secrets; invalidate `TrackingAccessToken`s; purge logs; add redaction; disclose if PII exposed |
| Webhook signature disabled | LOW-MEDIUM | Re-enable with raw body; audit for forged events processed during the gap |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Order from client/callback not webhook | Webhooks & Order Creation | No Order until `succeeded` processed; checkout test fails without webhook |
| 2. Webhook signature not verified | Webhooks & Order Creation | Forged/altered payload → 400; raw-body confirmed |
| 3. Non-idempotent webhook → dup Orders | Webhooks & Order Creation | Replay same event 2x + concurrently → 1 Order; `@@unique` present |
| 4. Pix treated as sync | Payments + Webhooks | Expired/unpaid Pix → no Order; only `succeeded` creates Order |
| 5. Fulfillment coupled to analytics | Analytics outbox + Fulfillment | PostHog down → fulfillment still proceeds |
| 6. Duplicate Gelato orders | Fulfillment (Gelato) | Double-trigger/crash-retry → 1 Gelato order; draft→confirm in place |
| 7. Refund couples to order_status | Refunds & Exchanges | Refund leaves `order_status` unchanged; finance updates post-webhook |
| 8. Plaintext tokens/secrets/logs | Tracking & tokens + Observability | Only `token_hash` stored; log/Sentry redaction verified |
| 9. Medusa module/workflow misuse | Foundation + payment/fulfillment phases | Steps have compensation + idempotency; Module Links used; locking present |
| 10. Supabase/Redis transactional | Foundation + Fulfillment dispatch | Migrations on direct conn; outbox dispatch; TTL'd locks |
| 11. BRL/Pix/IOF gotchas | Payments + Catalog & Pricing | Integer minor units; IOF reconciled; UTC storage |
| 12. Out-of-order/partial webhooks | Webhooks + Refunds + Fulfillment | Reordered/early events don't crash; logged before processing |

## Sources

- Stripe — Pix payments (async lifecycle, `pix_display_qr_code.expires_at`, IOF/`amount_includes_iof`, no manual capture, refunds): https://docs.stripe.com/payments/pix and https://docs.stripe.com/payments/pix/accept-a-payment — **HIGH**
- Stripe — Payment status updates / PaymentIntent lifecycle (`requires_action` → `processing` → `succeeded`/`payment_failed`; fulfill server-side on webhook): https://docs.stripe.com/payments/payment-intents/verifying-status, https://docs.stripe.com/payments/paymentintents/lifecycle — **HIGH**
- Gelato — Get Started / How orders work / Search orders (`orderReferenceId` not dedup-safe, `connectedOrderIds`, draft vs order, webhooks include reference id): https://dashboard.gelato.com/docs/get-started/, https://dashboard.gelato.com/docs/orders/order_details/, https://dashboard.gelato.com/docs/orders/v4/search/ — **HIGH**
- Odoo `sale_gelato` duplicate-prevention fix (draft→confirm on post-commit to avoid duplicate Gelato orders during payment post-processing): https://github.com/odoo/odoo/commit/9466c72cfa2270b474044253a63f6f064f778b26 — **HIGH** (real-world post-mortem evidence)
- Medusa v2 — Workflows: long-running, compensation, retries, idempotent option, locking, workflow engine (`setStepSuccess`/`setStepFailure`, idempotencyKey): https://docs.medusajs.com/learn/fundamentals/workflows/long-running-workflow, https://docs.medusajs.com/resources/references/workflows/classes/workflows.LocalWorkflow, https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/how-to-use — **HIGH**
- Idempotency in durable systems (idempotency key as close to origin as possible; unique-constraint as dedup): Temporal, https://temporal.io/blog/idempotency-and-durable-execution; Cloudflare "Rules of Workflows" — **MEDIUM** (general durable-execution guidance, applied to this domain)
- Project canonical context: `docs/seed/GSD_BACKEND_MVP_SEED.md` (12 invariants), `docs/DB_MODEL_v1.21.md` (WebhookEventLog dedup key, CheckoutCompletionLog, AnalyticsEventLog outbox, TrackingAccessToken hash, PaymentAttempt/PaymentSession boundary, Refund rules), `.planning/PROJECT.md` — **HIGH**

---
*Pitfalls research for: Brazilian POD t-shirt e-commerce backend on Medusa v2*
*Researched: 2026-06-22*
