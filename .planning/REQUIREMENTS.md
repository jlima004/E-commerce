# Requirements: E-commerce POD de Camisetas — Backend MVP

**Defined:** 2026-06-22
**Core Value:** Um pedido (Order) só existe e só é enviado à produção (Gelato) após confirmação de pagamento confiável, validada e idempotente pelo webhook canônico do Stripe.

> Scope: backend-only (headless Medusa v2, Brazil/BRL). "User" = a future storefront consuming the API, the end customer whose state the API represents, or the internal operator using Medusa Admin. Derived from the project's canonical docs (SRS v1.5, PRD Backend v1.1, DB_MODEL v1.21) and the MVP seed's 12 architecture invariants (INV-1..12).

## v1 Requirements

Requirements for the initial backend release. Each maps to a roadmap phase.

### Foundation

- [x] **SETUP-01**: Medusa v2 backend runs locally and in production with PostgreSQL/Supabase as the database. Complete via Phase 01 closure: Heroku app `espacoliminar`, release `v27`, commit `d02fd70`, with Supabase Postgres via pooler and production smoke accepted.
- [x] **SETUP-02**: Redis is wired for the event bus, cache, and workflow engine (no in-memory defaults in production). Complete via Phase 01 and the later CACHE-01A PASS, CACHE-01B PASS, and INFRA-01 PASS gates. The Redis cache is active on `web.1` and `worker.1`; the Phase 01 cache-disable workaround is historical and superseded by the formal release-stabilization closure.
- [x] **SETUP-03**: Medusa Admin is served on a dedicated subdomain. Complete via Phase 01 plan/closure evidence; the VPS/PM2/Nginx dedicated-Admin route remains a portable blueprint while the current validated production target is Heroku.
- [x] **SETUP-04**: A separate worker process runs subscribers/scheduled jobs in the production runtime. Complete via Phase 01 closure: current checkpoint uses Heroku `web.1` and `worker.1` dynos; the original PM2/Nginx route remains a portable blueprint.
- [x] **SETUP-05**: Central log redaction guarantees secrets, full card data, and plaintext tokens never appear in logs (INV-12). Complete via Phase 01 structured logging/redaction and production smoke evidence.

### Catalog

- [x] **CAT-01**: Operator can create products with variants priced in BRL. Complete via Phase 2 plan 02-01, where the central variant contract validates integer BRL cents as part of the sellable metadata gate.
- [x] **CAT-02**: Each variant carries mandatory Gelato metadata (e.g. product UID / print area), and variants missing required `gelato_*` metadata are flagged/rejected (INV — fulfillability). Complete via plans 02-01/02-02 with the central helper, sellable/publish rejection path, and automated tests.
- [x] **CAT-03**: API exposes catalog (products, variants, BRL prices) as a stable contract for the future storefront
- [x] **CAT-04**: Order line items store an immutable Gelato snapshot taken at order time, so later catalog edits do not corrupt in-flight orders. Phase 2 closes the pure builder/contract/unit-test surface; Phase 6 will consume this contract when Order/LineItem persistence exists.

### Media

- [x] **MEDIA-01**: Product images are stored in Supabase Storage and exposed via URL references through the API (binaries are not stored in the database)

### Cart & Checkout

- [x] **CART-01**: A guest can create and manage a cart without an account. Complete via Phase 3 plans 03-01/03-05: `/store/carts/active`, session-backed `req.session.active_cart_id`, 64 automated tests green.
- [x] **CART-02**: An authenticated customer can create and manage a cart associated with their account. Complete via Phase 3 plans 03-01/03-02/03-05: authenticated active cart + secure guest attach on login with server-side session proof.
- [x] **CART-03**: Checkout collects and validates customer email and shipping address (suitable for Gelato/Correios). Complete via Phase 3 plans 03-03/03-04/03-05: Brasil address validation, `federal_tax_id` in `shipping_address.metadata`, public `masked_federal_tax_id`.
- [x] **CART-04**: Checkout creates no Order — cart remains pre-Order state until payment is confirmed. Complete via Phase 3 plans 03-01..03-05: negative grep clean, no Order/PaymentAttempt/PaymentSession/webhook/Stripe/Pix/Gelato in checkout scope.

### Payments

- [x] **PAY-01**: Customer can pay by credit card via Stripe using Payment Collection / Payment Session. Complete through the Phase 04 safe pre-Order boundary (`filtering_wrapper` + `STRIPE_CARD_INITIATION_LAYER`), Gate 04A real test-mode layer/smoke, and the later webhook-to-Order closures. `client_secret` remains response-only and amount/currency gates remain server-side. The Phase 04 wording that production activation was blocked is historical and superseded by later gates and the formal production-stabilization closure.
- [x] **PAY-02**: Customer can pay by Pix via Stripe (BRL), with async confirmation handled correctly. Complete through the Phase 04 safe boundary (`STRIPE_PIX_INITIATION_LAYER`) and the later canonical webhook/Order closures; safe `expires_at` and local async states persist while QR/copia-e-cola/`next_action` remain response-only. The Phase 04 production-activation blocker is historical; no claim is made that the separately deferred real Pix smoke was performed.
- [x] **PAY-03**: Pending, expired, cancelled, or failed Pix never results in an Order (INV-2). Complete via Phase 04 negative-state proofs plus the Phase 05/06 canonical webhook-to-Order closures: `awaiting_pix_payment`, `pix_expired`, `payment_failed`, `payment_canceled`, invalidated, and superseded attempts remain pre-Order. The former Phase 04 activation-blocked wording is historical.
- [x] **PAY-04**: Every payment try is recorded as a custom PaymentAttempt, auditable per cart (multiple card/Pix retries). Complete via the Phase 04 state machine and later applied-migration evidence recorded by the RC1 audit: one active attempt per cart, retry/supersede history, and cart-mutation invalidation by safe fingerprint. The former draft-migration/production-activation blocker is historical.

### Webhooks & Idempotency

- [x] **WHK-01**: The Stripe webhook endpoint verifies the signature against the raw request body and rejects invalid events (INV-3). Phase 05 complete: raw-body `/hooks/stripe`, signature verification, HTTP 400 on forged payloads.
- [x] **WHK-02**: Every received Stripe event is persisted to WebhookEventLog and deduplicated by event id (DB-level unique constraint), making processing idempotent (INV-3). Phase 05 complete: DB-level dedup, replay/concurrent no-op, PaymentAttempt webhook states with `order_id = null`.
- [x] **WHK-03**: The Gelato webhook is ingested using the same validated, idempotent, persisted-event pattern. Complete via Phase 09 closure: `POST /hooks/gelato` uses fail-closed HTTP Header authentication, persists `WebhookEventLog(provider=gelato)`, deduplicates by `payload.id`, and updates internal fulfillment status/tracking for `order_status_updated`.

### Order Creation & State

- [x] **ORD-01**: An Order is created only by the canonical, approved Stripe webhook — never by a checkout/storefront endpoint (INV-1). Complete via Phase 06 closure: internal post-webhook entrypoint only, strict `PaymentAttempt.status = payment_confirmed_by_webhook` + `order_id = null` eligibility, no Store completion route.
- [x] **ORD-02**: Order creation is idempotent, keyed on `payment_intent_id` (or `cart_id + payment_intent_id`) via CheckoutCompletionLog, surviving webhook redelivery (INV-4). Complete via Phase 06 closure: `CheckoutCompletionLog` unique claim/reuse semantics prevent duplicate Order creation under replay/concurrency.
- [x] **ORD-03**: Order maintains decoupled operational state (`order_status`) and financial state (`payment_status`), recomputed transactionally (INV-10). Complete via Phase 06 closure: accepted local state contract persists decoupled `order_status` / `payment_status` in `Order.metadata`.

### Analytics Outbox

- [x] **ANL-01**: On Order creation, a durable `purchase_completed` event is written transactionally to AnalyticsEventLog as a local outbox (INV-5). Complete via Phase 07 closure: `07-01` module/contract + `07-02` transactional write/reuse on accepted Order success; idempotency keyed on `purchase_completed:stripe:{payment_intent_id}`.
- [x] **ANL-02**: Downstream effects depend only on the existence of the durable `purchase_completed` record, never on PostHog success or `AnalyticsEventLog.status = sent` (INV-7). Complete via Phase 07 closure: local gate accepts `recorded | queued | sending | sent | failed | dead_letter`; PostHog failure does not block Order or local gate (`07-02`, `07-03`).
- [x] **ANL-03**: A relay delivers outbox analytics events to PostHog asynchronously without blocking order/fulfillment flows. Complete via Phase 07 closure: `analytics-posthog-relay` scheduled job with retry/backoff/dead-letter; `posthog-node@^5.38.2` (resolved `5.39.2`); no PostHog real call in tests.

### Email

- [x] **EMAIL-01**: A confirmation email is sent via Resend after Order confirmation and before the Gelato fulfillment attempt. Complete via Phase 08 closure: `08-02` local enqueue after confirmed Order + durable local `purchase_completed`; `08-03` async Resend relay with retry/dead-letter; Resend is not a gate of Order validation.
- [x] **EMAIL-02**: Every email attempt is recorded in EmailDeliveryLog. Complete via Phase 08 closure: `08-01` module/contract with idempotency key `order-confirmation/{order_id}`; `08-02`/`08-03` audit trail, status lifecycle, retry/dead-letter, sanitized errors; full e-mail not persisted.

### Fulfillment (Gelato)

- [x] **FUL-01**: Gelato fulfillment is triggered only after a confirmed Order and a durable local `purchase_completed` record exist (INV-6). Complete via Phase 09 closure with the accepted eligibility gate, which also requires `EmailDeliveryLog(order_confirmation).status = sent` for automatic dispatch.
- [x] **FUL-02**: An Order cannot produce more than one active Gelato order; dispatch is guarded against duplicates from webhook redelivery or manual retry (INV-8). Complete via Phase 09 closure: single-active guard plus local idempotency key `gelato-dispatch:{order_id}`.
- [x] **FUL-03**: Gelato status/tracking updates are ingested via the Gelato webhook and update the Fulfillment record. Complete via Phase 09 closure: the accepted `order_status_updated` webhook updates the internal fulfillment summary.
- [x] **FUL-04**: Transient Gelato failures are retried; persistent failures surface instead of being silently lost. Complete via Phase 09 closure: retry/backoff/dead-letter, stale recovery without blind redispatch, and `GelatoFulfillment.requires_operator_attention` / `dead_letter` as the local fulfillment truth. Phase 12 OPS-01 remains additive: it promotes that condition to a persisted, consultable `OperationalAlert`; FUL-04 is not reopened.

### Tracking

- [x] **TRK-01**: A guest can access order/tracking status via a secure TrackingAccessToken. Complete via Phase 10 closure: body-only token lookup at `POST /store/tracking/lookup`, allowlist-only public response, and enumeration protection.
- [x] **TRK-02**: Tracking tokens are stored hashed/encrypted and never in plaintext (INV-11). Complete via Phase 10 closure: HMAC-SHA256 hash-only persistence, transient plaintext only, and constant-time verification.

### Refunds & Exchanges

- [x] **REF-01**: Operator can issue a refund from the Admin; local financial state updates only after a reliable Stripe webhook confirms it (INV-9). Complete via Phase 11 closure: Admin creates a local `requested` reservation, while terminal Stripe refund-object webhooks remain the sole local financial truth.
- [x] **REF-02**: A refund never automatically sets `order_status` to canceled (INV-10). Complete via Phase 11 closure: refund confirmation recomputes `payment_status` while preserving `order_status`.
- [x] **EXC-01**: Operator can manage operational exchanges (ExchangeRequest) for defective/wrong prints from the Admin. Complete via Phase 11 closure: operational `ExchangeRequest` flow for `defect` / `wrong_product`, without automatic financial effects.
- [x] **EXC-02**: Reverse logistics use a manual/semi-automatic Correios flow (tracking codes entered in Admin), with no automated Correios API integration. Complete via Phase 11 closure.

### Operations & Audit

- [x] **OPS-01**: Failed fulfillments and stuck payments surface as persisted OperationalAlerts. Complete via Phase 12 closure: OperationalAlert persistence, atomic upsert, factual detection/scanner, and Admin GET list/detail (`12-02`/`12-03`; `12-06-SUMMARY.md`, `12-CLOSURE.md`).
- [x] **OPS-02**: Admin actions on money/order/fulfillment are recorded in AdminActionLog for audit. Complete via Phase 12 closure: append-only AdminActionLog, user-only actor, terminal dedupe, reconciliation, and Strategy B instrumentation on custom Admin refund/exchange routes (`12-04`/`12-05`; `12-06-SUMMARY.md`, `12-CLOSURE.md`).

### Observability

- [x] **OBS-01**: Backend errors are reported to Sentry. Complete via Phase 01 Sentry backend integration and closure evidence.
- [x] **OBS-02**: The backend emits structured logs (redacted per SETUP-05). Complete via Phase 01 structured logger/redaction work and closure evidence.
- [x] **OBS-03**: A health-check endpoint reports service/dependency health for the active production runtime. Complete via Phase 01 closure: `/health/live` and `/health/ready` returned HTTP 200, with Postgres `up` and Redis `up`; the VPS/PM2/Nginx stack remains documented as a portable blueprint.

### Critical Tests

- [x] **TEST-01**: Automated tests guard the payment→order→fulfillment invariants: no Order without confirmed payment (INV-1/2), webhook idempotency (INV-3/4), single active Gelato order (INV-8), and refund/order-status decoupling (INV-9/10). Complete via Phase 12 closure: named HTTP invariant suites plus serial disposable PostgreSQL constraint/concurrency proofs under P12-12-06-R1 (`12-06-SUMMARY.md`, `12-CLOSURE.md`).

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Reliability Hardening

- **REL-01**: Richer fulfillment retry/backoff policies (trigger: observed Gelato flakiness)
- **REL-02**: Webhook reconciliation/sweeper job to catch missed Pix confirmations (trigger: dropped-webhook incidents)
- **REL-03**: Expanded alerting rules and operational dashboards (trigger: ops pain points)
- **REL-04**: Partial-refund and multi-line exchange refinements (trigger: real support cases)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Frontend / storefront | Separate later milestone; backend exposes API contracts only |
| Visual t-shirt editor | Massive non-backend product surface; out of MVP |
| Customer art upload | Moderation, storage, IP/legal, print-file handling complexity |
| Physical stock / inventory | Contradicts POD model — no inventory exists |
| Own production | Capital + ops out of scope; Gelato only |
| Multi-supplier POD | Routing/mapping complexity; Gelato only, one active Gelato order per Order |
| Multi-currency | Pricing/tax/FX complexity; BRL single-currency only |
| International sales | Customs/shipping/tax/compliance; Brazil only |
| Payment methods beyond card + Pix (boleto, wallets) | Each rail adds reconciliation/webhook surface; Stripe card + Pix only |
| Automatic Correios API integration | API complexity/instability, low MVP ROI; manual/semi-automatic codes in Admin |
| Full customer self-service exchange | State-machine + fraud + reverse-logistics complexity; operator-driven only |
| ERP integration | Out of product vision; premature |
| Marketplace (multi-seller) | Fundamentally different architecture |
| Refund auto-canceling order | Conflates financial + operational state (INV-10) |

## Traceability

Which phases cover which requirements. Phases are assigned during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETUP-01 | Phase 1 | Complete (Phase 01 closure: Medusa backend validated on Heroku with Supabase Postgres) |
| SETUP-02 | Phase 1 + CACHE-01A/B + INFRA-01 | Complete (Redis event bus/cache/workflow; cache active on web/worker; Phase 01 cache-disable workaround historical and superseded) |
| SETUP-03 | Phase 1 | Complete (Phase 01 closure; dedicated Admin route/runbook retained, Heroku is current validated target) |
| SETUP-04 | Phase 1 | Complete (Phase 01 closure: Heroku web/worker dynos validated) |
| SETUP-05 | Phase 1 | Complete (Phase 01 structured logger/redaction evidence) |
| CAT-01 | Phase 2 | Complete (02-01 central contract covers BRL integer-cent pricing) |
| CAT-02 | Phase 2 | Complete (02-01/02-02 mandatory Gelato metadata + sellable/publish gate + tests) |
| CAT-03 | Phase 2 | Complete (02-04 public Store API contract) |
| CAT-04 | Phase 2 | Complete (02-05 builder/contract; consumed by Phase 6 persistence) |
| MEDIA-01 | Phase 2 | Complete (02-03) |
| CART-01 | Phase 3 | Complete (03-01/03-05 guest active cart + session) |
| CART-02 | Phase 3 | Complete (03-01/03-02/03-05 auth cart + secure attach) |
| CART-03 | Phase 3 | Complete (03-03/03-04/03-05 email + BR address + masked federal_tax_id) |
| CART-04 | Phase 3 | Complete (03-01..03-05 pre-Order boundary + negative proofs) |
| PAY-01 | Phase 4 + Gate 04A + Phases 5–6 | Complete (safe card boundary, real test-mode layer/smoke, and canonical webhook-to-Order path; Phase 04 activation blocker is historical) |
| PAY-02 | Phase 4 + Phases 5–6 | Complete (safe async Pix boundary and canonical webhook-to-Order path; Phase 04 activation blocker historical; real Pix smoke remains separately deferred) |
| PAY-03 | Phase 4 + Phases 5–6 | Complete (unpaid/expired/canceled/failed Pix remains pre-Order; webhook truth and Order gate closed later) |
| PAY-04 | Phase 4 + RC1 | Complete (auditable PaymentAttempt lifecycle; former migration/activation blocker historical after applied-migration audit) |
| WHK-01 | Phase 5 | Complete (05-02/05-04 raw-body signature verification) |
| WHK-02 | Phase 5 | Complete (05-01/05-02/05-03/05-04 WebhookEventLog dedup + PaymentAttempt webhook states) |
| WHK-03 | Phase 9 | Complete (Phase 09 closure: authenticated, persisted, deduplicated Gelato webhook with internal status/tracking update) |
| ORD-01 | Phase 6 | Complete (Phase 06 closure: canonical internal post-webhook Order creation only) |
| ORD-02 | Phase 6 | Complete (Phase 06 closure: CheckoutCompletionLog idempotency under replay/concurrency) |
| ORD-03 | Phase 6 | Complete (Phase 06 closure: decoupled `order_status` / `payment_status` in `Order.metadata`) |
| ANL-01 | Phase 7 | Complete (Phase 07 closure: durable local `purchase_completed` on accepted Order success) |
| ANL-02 | Phase 7 | Complete (Phase 07 closure: downstream gates on local outbox existence, not PostHog/`sent`) |
| ANL-03 | Phase 7 | Complete (Phase 07 closure: async PostHog relay with retry/dead-letter, non-blocking) |
| EMAIL-01 | Phase 8 | Complete (Phase 08 closure: async Resend confirmation after Order + durable local `purchase_completed`) |
| EMAIL-02 | Phase 8 | Complete (Phase 08 closure: `EmailDeliveryLog` idempotency, audit, retry/dead-letter) |
| FUL-01 | Phase 9 | Complete (Phase 09 closure: eligibility after confirmed Order + durable local purchase_completed + confirmation email sent) |
| FUL-02 | Phase 9 | Complete (Phase 09 closure: single-active guard + idempotent gelato-dispatch:{order_id}) |
| FUL-03 | Phase 9 | Complete (Phase 09 closure: order_status_updated updates internal fulfillment status/tracking) |
| FUL-04 | Phase 9 | Complete (Phase 09 closure: retry/backoff/dead-letter + local operator-attention truth; OPS-01 promotion remains Phase 12) |
| TRK-01 | Phase 10 | Complete (Phase 10 closure: body-only token-gated lookup, allowlist response, enumeration protection) |
| TRK-02 | Phase 10 | Complete (Phase 10 closure: hash-only persistence, transient plaintext, constant-time verification) |
| REF-01 | Phase 11 | Complete (Phase 11 closure: Admin reservation + terminal Stripe refund-object webhook truth) |
| REF-02 | Phase 11 | Complete (Phase 11 closure: financial recomputation without automatic order cancellation) |
| EXC-01 | Phase 11 | Complete (Phase 11 closure: operational ExchangeRequest Admin flow without financial effects) |
| EXC-02 | Phase 11 | Complete (Phase 11 closure: manual/semi-automatic Correios reverse flow, no API) |
| OPS-01 | Phase 12 | Complete (Phase 12 closure: OperationalAlert persistence, detection, Admin surface) |
| OPS-02 | Phase 12 | Complete (Phase 12 closure: AdminActionLog append-only audit on custom Admin surfaces) |
| OBS-01 | Phase 1 | Complete (Phase 01 Sentry backend integration) |
| OBS-02 | Phase 1 | Complete (Phase 01 structured redacted logs) |
| OBS-03 | Phase 1 | Complete (Phase 01 health endpoints validated: live/ready 200, Postgres/Redis up) |
| TEST-01 | Phase 12 | Complete (Phase 12 closure: INV HTTP suites + disposable PostgreSQL proofs; P12-12-06-R1) |

**Coverage:**
- v1 requirements: 45 total (corrected from "44"; the v1 list contains 45 distinct REQ-IDs)
- Mapped to phases: 45 ✓
- Unmapped: 0 ✓
- **45/45 requirements complete**

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-07-23 during Phase 12 CLOSURE; OPS-01, OPS-02, and TEST-01 complete (45/45)*
