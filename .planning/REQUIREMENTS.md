# Requirements: E-commerce POD de Camisetas — Backend MVP

**Defined:** 2026-06-22
**Core Value:** Um pedido (Order) só existe e só é enviado à produção (Gelato) após confirmação de pagamento confiável, validada e idempotente pelo webhook canônico do Stripe.

> Scope: backend-only (headless Medusa v2, Brazil/BRL). "User" = a future storefront consuming the API, the end customer whose state the API represents, or the internal operator using Medusa Admin. Derived from the project's canonical docs (SRS v1.5, PRD Backend v1.1, DB_MODEL v1.21) and the MVP seed's 12 architecture invariants (INV-1..12).

## v1 Requirements

Requirements for the initial backend release. Each maps to a roadmap phase.

### Foundation

- [ ] **SETUP-01**: Medusa v2 backend runs locally and in production with PostgreSQL/Supabase as the database
- [ ] **SETUP-02**: Redis is wired for the event bus, cache, and workflow engine (no in-memory defaults in production)
- [ ] **SETUP-03**: Medusa Admin is served on a dedicated subdomain
- [ ] **SETUP-04**: A separate worker process runs subscribers/scheduled jobs in the production runtime. Current checkpoint uses Heroku web/worker dynos; the original PM2/Nginx route remains a portable blueprint.
- [ ] **SETUP-05**: Central log redaction guarantees secrets, full card data, and plaintext tokens never appear in logs (INV-12)

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

- [ ] **PAY-01**: Customer can pay by credit card via Stripe using Payment Collection / Payment Session
- [ ] **PAY-02**: Customer can pay by Pix via Stripe (BRL), with async confirmation handled correctly
- [ ] **PAY-03**: Pending, expired, cancelled, or failed Pix never results in an Order (INV-2)
- [ ] **PAY-04**: Every payment try is recorded as a custom PaymentAttempt, auditable per cart (multiple card/Pix retries)

### Webhooks & Idempotency

- [ ] **WHK-01**: The Stripe webhook endpoint verifies the signature against the raw request body and rejects invalid events (INV-3)
- [ ] **WHK-02**: Every received Stripe event is persisted to WebhookEventLog and deduplicated by event id (DB-level unique constraint), making processing idempotent (INV-3)
- [ ] **WHK-03**: The Gelato webhook is ingested using the same validated, idempotent, persisted-event pattern

### Order Creation & State

- [ ] **ORD-01**: An Order is created only by the canonical, approved Stripe webhook — never by a checkout/storefront endpoint (INV-1)
- [ ] **ORD-02**: Order creation is idempotent, keyed on `payment_intent_id` (or `cart_id + payment_intent_id`) via CheckoutCompletionLog, surviving webhook redelivery (INV-4)
- [ ] **ORD-03**: Order maintains decoupled operational state (`order_status`) and financial state (`payment_status`), recomputed transactionally (INV-10)

### Analytics Outbox

- [ ] **ANL-01**: On Order creation, a durable `purchase_completed` event is written transactionally to AnalyticsEventLog as a local outbox (INV-5)
- [ ] **ANL-02**: Downstream effects depend only on the existence of the durable `purchase_completed` record, never on PostHog success or `AnalyticsEventLog.status = sent` (INV-7)
- [ ] **ANL-03**: A relay delivers outbox analytics events to PostHog asynchronously without blocking order/fulfillment flows

### Email

- [ ] **EMAIL-01**: A confirmation email is sent via Resend after Order confirmation and before the Gelato fulfillment attempt
- [ ] **EMAIL-02**: Every email attempt is recorded in EmailDeliveryLog

### Fulfillment (Gelato)

- [ ] **FUL-01**: Gelato fulfillment is triggered only after a confirmed Order and a durable local `purchase_completed` record exist (INV-6)
- [ ] **FUL-02**: An Order cannot produce more than one active Gelato order; dispatch is guarded against duplicates from webhook redelivery or manual retry (INV-8)
- [ ] **FUL-03**: Gelato status/tracking updates are ingested via the Gelato webhook and update the Fulfillment record
- [ ] **FUL-04**: Transient Gelato failures are retried; persistent failures raise an operational alert rather than being silently lost

### Tracking

- [ ] **TRK-01**: A guest can access order/tracking status via a secure TrackingAccessToken
- [ ] **TRK-02**: Tracking tokens are stored hashed/encrypted and never in plaintext (INV-11)

### Refunds & Exchanges

- [ ] **REF-01**: Operator can issue a refund from the Admin; local financial state updates only after a reliable Stripe webhook confirms it (INV-9)
- [ ] **REF-02**: A refund never automatically sets `order_status` to canceled (INV-10)
- [ ] **EXC-01**: Operator can manage operational exchanges (ExchangeRequest) for defective/wrong prints from the Admin
- [ ] **EXC-02**: Reverse logistics use a manual/semi-automatic Correios flow (tracking codes entered in Admin), with no automated Correios API integration

### Operations & Audit

- [ ] **OPS-01**: Failed fulfillments and stuck payments surface as persisted OperationalAlerts
- [ ] **OPS-02**: Admin actions on money/order/fulfillment are recorded in AdminActionLog for audit

### Observability

- [ ] **OBS-01**: Backend errors are reported to Sentry
- [ ] **OBS-02**: The backend emits structured logs (redacted per SETUP-05)
- [ ] **OBS-03**: A health-check endpoint reports service/dependency health for the active production runtime. Current checkpoint validates Heroku/Supabase/Redis; the VPS/PM2/Nginx stack remains documented as a portable blueprint.

### Critical Tests

- [ ] **TEST-01**: Automated tests guard the payment→order→fulfillment invariants: no Order without confirmed payment (INV-1/2), webhook idempotency (INV-3/4), single active Gelato order (INV-8), and refund/order-status decoupling (INV-9/10)

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
| SETUP-01 | Phase 1 | Pending |
| SETUP-02 | Phase 1 | Pending |
| SETUP-03 | Phase 1 | Pending |
| SETUP-04 | Phase 1 | Pending |
| SETUP-05 | Phase 1 | Pending |
| CAT-01 | Phase 2 | Complete (02-01 central contract covers BRL integer-cent pricing) |
| CAT-02 | Phase 2 | Complete (02-01/02-02 mandatory Gelato metadata + sellable/publish gate + tests) |
| CAT-03 | Phase 2 | Complete (02-04 public Store API contract) |
| CAT-04 | Phase 2 | Complete (02-05 builder/contract; consumed by Phase 6 persistence) |
| MEDIA-01 | Phase 2 | Complete (02-03) |
| CART-01 | Phase 3 | Complete (03-01/03-05 guest active cart + session) |
| CART-02 | Phase 3 | Complete (03-01/03-02/03-05 auth cart + secure attach) |
| CART-03 | Phase 3 | Complete (03-03/03-04/03-05 email + BR address + masked federal_tax_id) |
| CART-04 | Phase 3 | Complete (03-01..03-05 pre-Order boundary + negative proofs) |
| PAY-01 | Phase 4 | Pending |
| PAY-02 | Phase 4 | Pending |
| PAY-03 | Phase 4 | Pending |
| PAY-04 | Phase 4 | Pending |
| WHK-01 | Phase 5 | Pending |
| WHK-02 | Phase 5 | Pending |
| WHK-03 | Phase 9 | Pending |
| ORD-01 | Phase 6 | Pending |
| ORD-02 | Phase 6 | Pending |
| ORD-03 | Phase 6 | Pending |
| ANL-01 | Phase 7 | Pending |
| ANL-02 | Phase 7 | Pending |
| ANL-03 | Phase 7 | Pending |
| EMAIL-01 | Phase 8 | Pending |
| EMAIL-02 | Phase 8 | Pending |
| FUL-01 | Phase 9 | Pending |
| FUL-02 | Phase 9 | Pending |
| FUL-03 | Phase 9 | Pending |
| FUL-04 | Phase 9 | Pending |
| TRK-01 | Phase 10 | Pending |
| TRK-02 | Phase 10 | Pending |
| REF-01 | Phase 11 | Pending |
| REF-02 | Phase 11 | Pending |
| EXC-01 | Phase 11 | Pending |
| EXC-02 | Phase 11 | Pending |
| OPS-01 | Phase 12 | Pending |
| OPS-02 | Phase 12 | Pending |
| OBS-01 | Phase 1 | Pending |
| OBS-02 | Phase 1 | Pending |
| OBS-03 | Phase 1 | Pending |
| TEST-01 | Phase 12 | Pending |

**Coverage:**
- v1 requirements: 45 total (corrected from "44"; the v1 list contains 45 distinct REQ-IDs)
- Mapped to phases: 45 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-27 after Phase 03 closure for CART-01..CART-04*
