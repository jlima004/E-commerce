# Roadmap: E-commerce POD de Camisetas — Backend MVP

## Overview

This roadmap builds a headless Medusa v2 POD backend (Brazil/BRL) around a single non-negotiable spine: **an Order is born only from the canonical, signature-verified, idempotent Stripe webhook, and Gelato production fires only after a confirmed Order plus a durable local `purchase_completed` record.** The journey runs foundation → catalog → cart/checkout (pre-Order) → payments → webhook ingest → idempotent Order creation → analytics outbox → confirmation email → Gelato fulfillment → secure tracking → refunds/exchanges → ops, audit & invariant tests. Phases are small and independently verifiable; the dependency edges along the money path (webhook → Order → outbox/email → gated fulfillment) are hard ordering constraints derived from the architecture research, not preferences.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Observability** - Medusa v2 + Supabase/Redis + Admin subdomain + PM2/Nginx + Sentry, structured logs with redaction, health check
- [ ] **Phase 2: Catalog & Media** - BRL products/variants with mandatory Gelato metadata, Supabase Storage images, order-time Gelato snapshot
- [ ] **Phase 3: Cart & Checkout (pre-Order)** - Guest + authenticated cart and checkout data collection that creates no Order
- [ ] **Phase 4: Stripe Payments & PaymentAttempt** - Card + async Pix via Payment Collection/Session, every try tracked in PaymentAttempt
- [ ] **Phase 5: Stripe Webhook Ingestion & Idempotency** - Raw-body signature-verified `/hooks/stripe` + WebhookEventLog DB-level dedup
- [ ] **Phase 6: Idempotent Webhook-Driven Order Creation** - Order created only by the canonical webhook, idempotent on payment_intent_id, decoupled state
- [ ] **Phase 7: Analytics Outbox (purchase_completed)** - Durable local outbox written with the Order + async PostHog relay
- [ ] **Phase 8: Transactional Email (Resend)** - Idempotent confirmation email after Order, before the Gelato attempt
- [ ] **Phase 9: Gelato Fulfillment & Webhook** - Gated single-active Gelato dispatch + Gelato webhook for status/tracking
- [ ] **Phase 10: Secure Guest Tracking** - Hashed TrackingAccessToken + token-gated public tracking route
- [ ] **Phase 11: Refunds & Exchanges (Admin)** - Webhook-confirmed refunds decoupled from order_status + operational exchanges + manual Correios flow
- [ ] **Phase 12: Ops, Audit & Critical Tests** - OperationalAlert + AdminActionLog + automated invariant regression tests

## Phase Details

### Phase 1: Foundation & Observability
**Goal**: A secure, observable Medusa v2 backend runs locally and in production on Postgres/Supabase + Redis, with the Admin on its own subdomain and log redaction active from day one.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. `medusa develop` boots locally and the production build runs under PM2 (server + worker) behind Nginx, backed by Supabase Postgres and a Redis-backed event bus, cache, and workflow engine (no in-memory defaults).
  2. Medusa Admin is reachable on its dedicated subdomain.
  3. Backend errors are reported to Sentry and the app emits structured logs with secrets, full card data, and plaintext tokens redacted (a grep of logs finds no `sk_live`/`whsec`/PAN/raw token).
  4. A health-check endpoint reports service and dependency (Postgres/Redis) health.
  5. Database migrations run on the direct/session Supabase connection (not the transaction pooler) without prepared-statement errors.
**Plans**: TBD

### Phase 2: Catalog & Media
**Goal**: Operators can model BRL-priced products/variants that carry mandatory Gelato metadata, with product images in Supabase Storage and an immutable order-time Gelato snapshot, exposed as a stable API contract.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, MEDIA-01
**Success Criteria** (what must be TRUE):
  1. Operator can create a product with variants priced in BRL (integer centavos) via the Admin.
  2. A variant missing required `gelato_*` metadata is flagged/rejected at create/update time.
  3. Product images upload to Supabase Storage and the API returns URL references (no binaries stored in the database).
  4. The Store catalog API returns products, variants, and BRL prices in a stable shape suitable for the future storefront.
  5. Order line items capture an immutable Gelato snapshot taken at order time, so later catalog edits do not corrupt in-flight orders.
**Plans**: TBD

### Phase 3: Cart & Checkout (pre-Order)
**Goal**: Guests and authenticated customers can build a cart and complete checkout data collection without ever creating an Order.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CART-01, CART-02, CART-03, CART-04
**Success Criteria** (what must be TRUE):
  1. A guest can create and manage a cart without an account.
  2. An authenticated customer can create and manage a cart associated with their account.
  3. Checkout collects and validates customer email and a shipping address suitable for Gelato/Correios.
  4. Completing checkout creates no Order — the cart stays in pre-Order state (verified: no Order row exists after checkout submission).
**Plans**: TBD

### Phase 4: Stripe Payments & PaymentAttempt
**Goal**: Customers can pay by card or Pix through Stripe Payment Collection/Session, with every attempt tracked in a custom PaymentAttempt and Pix modeled as asynchronous — still without minting an Order.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04
**Success Criteria** (what must be TRUE):
  1. Customer can initiate a credit-card payment via a Stripe Payment Session in BRL.
  2. Customer can initiate a Pix payment that surfaces a QR with `expires_at`, with UX states (`pix_qr_displayed`, `awaiting_pix_payment`, `pix_expired`) recorded in PaymentAttempt — never treated as financial truth.
  3. Every payment try (card or Pix, including retries) is recorded as an auditable PaymentAttempt per cart.
  4. A pending, expired, cancelled, or failed Pix results in no Order and marks the PaymentAttempt accordingly.
**Plans**: TBD

### Phase 5: Stripe Webhook Ingestion & Idempotency
**Goal**: A signature-verified, raw-body Stripe webhook endpoint persists and deduplicates every event at the database layer — the correctness foundation that must exist before any Order can be created.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: WHK-01, WHK-02
**Success Criteria** (what must be TRUE):
  1. The `/hooks/stripe` route verifies the signature against the raw request body and rejects forged/altered payloads with HTTP 400 before any DB work.
  2. Every received Stripe event is persisted to WebhookEventLog with a DB-level `unique(provider, deduplication_key)` derived from the Stripe `evt_` id.
  3. Replaying the same event (twice and concurrently) is a no-op that returns 200 and yields exactly one log row.
  4. An event referencing not-yet-present state is recorded and safely deferred rather than crashing the handler.
**Plans**: TBD

### Phase 6: Idempotent Webhook-Driven Order Creation
**Goal**: An Order is born only from the canonical approved Stripe webhook, idempotently keyed on `payment_intent_id`, with decoupled operational and financial state.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: ORD-01, ORD-02, ORD-03
**Success Criteria** (what must be TRUE):
  1. An Order is created only by the canonical `payment_intent.succeeded` webhook path — never by a checkout/storefront endpoint.
  2. Replaying or concurrently delivering the same `payment_intent.succeeded` yields exactly one Order (CheckoutCompletionLog unique on `idempotency_key`).
  3. Order creation, CheckoutCompletionLog update, and PaymentAttempt.order_id correlation occur in one transaction.
  4. Order exposes decoupled `order_status` and `payment_status`, recomputed transactionally.
**Plans**: TBD

### Phase 7: Analytics Outbox (purchase_completed)
**Goal**: Order creation durably records a local `purchase_completed` outbox event that all downstream gating depends on, with asynchronous, non-blocking PostHog delivery.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: ANL-01, ANL-02, ANL-03
**Success Criteria** (what must be TRUE):
  1. On Order creation, a `purchase_completed` row is written to AnalyticsEventLog (status `recorded`) within the same transaction.
  2. A relay job delivers outbox events to PostHog asynchronously (recorded→queued→sent|failed) without blocking the order/fulfillment flow.
  3. Killing PostHog connectivity does not block Order creation or downstream gating (verified by test).
  4. Downstream effects depend only on the durable `recorded` record existing, never on `status = sent` or PostHog reachability.
**Plans**: TBD

### Phase 8: Transactional Email (Resend)
**Goal**: A confirmation email is sent via Resend after Order confirmation and before the Gelato fulfillment attempt, idempotently and auditably.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: EMAIL-01, EMAIL-02
**Success Criteria** (what must be TRUE):
  1. An `order.created` subscriber sends a confirmation email via Resend after Order confirmation and before any Gelato fulfillment attempt.
  2. Every email attempt is recorded in EmailDeliveryLog with an `idempotency_key`.
  3. Redelivery/retry does not send a duplicate email (idempotency_key guard verified).
**Plans**: TBD

### Phase 9: Gelato Fulfillment & Webhook
**Goal**: Confirmed, `purchase_completed` orders are dispatched to Gelato exactly once, with status and tracking ingested via a validated, idempotent Gelato webhook.
**Mode:** mvp
**Depends on**: Phase 7, Phase 8
**Requirements**: FUL-01, FUL-02, FUL-03, FUL-04, WHK-03
**Success Criteria** (what must be TRUE):
  1. Gelato fulfillment is triggered only when a confirmed Order and a durable local `purchase_completed` record both exist.
  2. Triggering fulfillment twice or crash-and-retry produces exactly one active Gelato order per Order (single-active guard; `connectedOrderIds` treated as one logical order).
  3. The Gelato webhook is ingested using the same validated, deduplicated, persisted-event pattern and updates the Fulfillment record (status + tracking) via the canonical `Fulfillment.gelato_order_id` lookup.
  4. Transient Gelato failures are retried; persistent failures raise an OperationalAlert rather than being silently lost.
**Plans**: TBD

### Phase 10: Secure Guest Tracking
**Goal**: Guests can check order/tracking status through a secure, hashed access token that is never stored in plaintext.
**Mode:** mvp
**Depends on**: Phase 9
**Requirements**: TRK-01, TRK-02
**Success Criteria** (what must be TRUE):
  1. A guest can access order/tracking status via a TrackingAccessToken-gated public route.
  2. Tracking tokens are persisted only as a hash (with `expires_at`/`revoked_at`) — a DB and log grep finds no plaintext token.
  3. The tracking route validates tokens server-side with a constant-time compare and is rate-limited against enumeration.
**Plans**: TBD

### Phase 11: Refunds & Exchanges (Admin)
**Goal**: Operators can issue refunds whose local financial state updates only after a Stripe webhook confirms, and manage operational exchanges with a manual Correios reverse flow — without coupling money state to the order lifecycle.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: REF-01, REF-02, EXC-01, EXC-02
**Success Criteria** (what must be TRUE):
  1. Operator can request a refund from the Admin; local financial state updates only after a reliable Stripe refund webhook confirms it.
  2. A refund never automatically sets `order_status` to canceled, and concurrent or over-captured refunds per Payment are blocked.
  3. Operator can create and manage an ExchangeRequest for defective/wrong prints from the Admin.
  4. Reverse logistics use a manual/semi-automatic Correios flow (tracking codes entered in the Admin) with no automated Correios API integration.
**Plans**: TBD

### Phase 12: Ops, Audit & Critical Tests
**Goal**: Operational failures surface as persisted alerts, money/order/fulfillment actions are audited, and automated tests regression-guard the payment→order→fulfillment invariants that are the product.
**Mode:** mvp
**Depends on**: Phases 1-11
**Requirements**: OPS-01, OPS-02, TEST-01
**Success Criteria** (what must be TRUE):
  1. Failed fulfillments and stuck payments surface as persisted OperationalAlerts.
  2. Every Admin action on money, order, or fulfillment is recorded in AdminActionLog for audit.
  3. Automated tests guard the core invariants — no Order without confirmed payment (INV-1/2), webhook idempotency (INV-3/4), single active Gelato order (INV-8), and refund/order-status decoupling (INV-9/10) — and they pass.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Observability | 0/TBD | Not started | - |
| 2. Catalog & Media | 0/TBD | Not started | - |
| 3. Cart & Checkout (pre-Order) | 0/TBD | Not started | - |
| 4. Stripe Payments & PaymentAttempt | 0/TBD | Not started | - |
| 5. Stripe Webhook Ingestion & Idempotency | 0/TBD | Not started | - |
| 6. Idempotent Webhook-Driven Order Creation | 0/TBD | Not started | - |
| 7. Analytics Outbox (purchase_completed) | 0/TBD | Not started | - |
| 8. Transactional Email (Resend) | 0/TBD | Not started | - |
| 9. Gelato Fulfillment & Webhook | 0/TBD | Not started | - |
| 10. Secure Guest Tracking | 0/TBD | Not started | - |
| 11. Refunds & Exchanges (Admin) | 0/TBD | Not started | - |
| 12. Ops, Audit & Critical Tests | 0/TBD | Not started | - |

---
*Roadmap created: 2026-06-22*
*Granularity: fine (12 phases) · Mode: mvp · Coverage: 45/45 requirements mapped*
