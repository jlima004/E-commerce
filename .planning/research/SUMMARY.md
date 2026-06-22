# Project Research Summary

**Project:** E-commerce POD de Camisetas — Backend MVP
**Domain:** Headless Print-on-Demand (POD) t-shirt e-commerce **backend** (Medusa v2, Brazil/BRL)
**Researched:** 2026-06-22
**Confidence:** HIGH

## Executive Summary

This is a **backend-only**, headless commerce system for selling print-on-demand t-shirts in Brazil, built on **Medusa v2** and fulfilled by **Gelato**. It is not a generic store: its entire reason for existing is the **payment → order → fulfillment correctness boundary**. Experts build this kind of money-handling backend by inverting Medusa's default checkout: instead of creating the Order when the storefront returns from Stripe, the Order is born **only** from the canonical, signature-verified, idempotent Stripe webhook (`payment_intent.succeeded`). Everything downstream — analytics, email, Gelato production — is gated on durable, local state, never on external service success. The 12 architecture invariants in the seed are the product; the research is unanimous that violating any of them (eager Order creation, weak webhook dedup, treating Pix as synchronous, coupling fulfillment to PostHog) is the dominant failure mode of naive POD shops.

The recommended approach is a **modular Medusa v2 build**: core modules (Cart, Payment, Order, Fulfillment) plus a set of custom modules that each own one durable log/entity from `DB_MODEL_v1.21` (`PaymentAttempt`, `WebhookEventLog`, `CheckoutCompletionLog`, `AnalyticsEventLog`, `GelatoOrder`, `TrackingAccessToken`, `Refund`, `ExchangeRequest`, `EmailDeliveryLog`, `OperationalAlert`, `AdminActionLog`). Custom data is associated to core entities via **Module Links** (never cross-module FKs), and all critical mutations run through **durable workflows with compensation** backed by a **Redis workflow engine**. Stack is well-verified: Node 22 LTS, TypeScript, Medusa 2.15.x, PostgreSQL via Supabase, Redis 7, Stripe (card + native **Pix**), Gelato REST v4 (no official SDK — thin custom module), Resend (idempotent email), PostHog (server outbox), Sentry, deployed on a single VPS with PM2 (server + worker) behind Nginx.

The key risks are concentrated and well-understood. **Idempotency must be enforced at the database layer** (`unique` constraints + get-or-create), not in application code, because Stripe redelivers at-least-once and concurrently. **Pix is asynchronous** (QR → processing → succeeded/expired) with no manual capture, so the webhook is the only financial truth. **Gelato's `POST /v4/orders` is not idempotent** — a local single-active guard (ideally draft→confirm) is mandatory to avoid double production cost. Brazil-specific gotchas (IOF 3.5% markup, BRL integer centavos, timezone) and Supabase pooler-vs-direct connection for migrations round out the critical list. All are addressable with the patterns already specified in the canonical docs.

## Key Findings

### Recommended Stack

Medusa v2 dictates most choices; the research validated versions and integration patterns against official docs (Context7). This is backend-only — no storefront frameworks, but the bundled Medusa Admin dashboard is in scope. The whole `@medusajs/*` set must stay pinned to a single minor (2.15.x). Production **requires Redis-backed** event bus, cache, and especially the **workflow engine** (in-memory is dev-only and would break the durable Order/fulfillment guarantees).

**Core technologies:**
- **Medusa v2 (2.15.x)** + **Node 22 LTS** + **TypeScript** — mandated framework; modular (modules + workflows + links), TS-first.
- **PostgreSQL (Supabase) + Redis 7** — Postgres is Medusa's only DB (use Supabase, which also provides image Storage); Redis powers event bus, cache, queues, and the durable workflow engine.
- **Stripe (`stripe` ^19) with native Pix** — official Medusa provider; `automatic_payment_methods: true` surfaces card + Pix in BRL; webhook is canonical confirmation.
- **Gelato REST API v4 (custom module, no SDK)** — `POST /v4/orders`, `X-API-KEY`, `order_status_updated` webhook for tracking; called from a custom fulfillment module.
- **Resend ^4** (idempotent transactional email), **posthog-node ^5** (server-side `purchase_completed` outbox), **@sentry/node ^10** (error monitoring), **@medusajs/file-s3** → Supabase Storage for images.
- **PM2 (server + worker) + Nginx** on a single VPS; Nginx must pass the **raw body** for Stripe signature verification.

### Expected Features

For a backend, "features" are behaviors and API contracts, and "differentiation" is reliability rigor, not surface features. The entire `PROJECT.md` Active list is already a ruthless, irreducible MVP — nearly everything is P1; the real differentiation between items is **sequencing**, not inclusion.

**Must have (table stakes):**
- Catalog (Product/Variant/Price in **BRL**) with **mandatory Gelato metadata** on variants (fulfillment is impossible without it) + product images in Supabase Storage.
- Guest + authenticated cart and checkout (collect email + shipping address; no Order created here).
- Stripe **card + Pix** via Payment Collection/Session + custom **PaymentAttempt** tracking.
- **Validated, idempotent Stripe webhook** (WebhookEventLog) → **webhook-driven idempotent Order creation** (CheckoutCompletionLog).
- Durable **`purchase_completed`** outbox (AnalyticsEventLog) + confirmation email (Resend, EmailDeliveryLog) before Gelato.
- **Gelato fulfillment** + Gelato webhook + tracking, with **secure hashed TrackingAccessToken** for guests.
- Decoupled **operational vs financial** order state; **Admin refund** confirmed by Stripe webhook; operational **exchanges** + Correios manual reverse flow.
- OperationalAlert + AdminActionLog; observability (Sentry, structured logs, health check); critical invariant tests.

**Should have (competitive — reliability as moat):**
- Strict, invariant-enforced **payment→Order→fulfillment ordering** (eliminates phantom charges, duplicate orders, premature production).
- **Idempotent everything** (webhooks, Order creation, fulfillment trigger) surviving retries/concurrency.
- **Outbox-based analytics** decoupled from PostHog; **LineItem Gelato snapshot** for order-time immutability; fulfillment retries with operational-attention flagging.

**Defer (v1.x / v2+):**
- Storefront (separate milestone), additional payment methods (boleto/wallets), Correios API automation, customer self-service exchanges, richer retry/alerting refinements, webhook reconciliation sweepers.

### Architecture Approach

The architecture **inverts Medusa's standard checkout**: the storefront/`placeOrder` path never mints the Order; the canonical Stripe webhook does, through an idempotent `checkoutCompletionWorkflow` keyed on `payment_intent_id`. Each custom DB_MODEL entity is an isolated module; associations to core Order/Payment/Fulfillment use **Module Links** + the Query graph; all critical mutations run through **durable workflows (steps + compensation)** on the **Redis workflow engine**; subscribers + scheduled jobs handle async side effects (analytics/email outbox dispatch, Pix expiry sweeping) off the critical path.

**Major components:**
1. **API border** — Store API, Admin (+ panel), dedicated webhook receivers (`/hooks/stripe`, `/hooks/gelato`, raw-body), token-gated public tracking.
2. **Orchestration layer** — workflows (checkout completion, Stripe/Gelato webhook ingest, record-purchase-completed, Gelato fulfillment, refund) + subscribers + outbox dispatcher jobs.
3. **Domain modules** — core Medusa (Cart/Payment/Order/Fulfillment) + custom modules each owning one durable log/entity (PaymentAttempt, WebhookEventLog, CheckoutCompletionLog, AnalyticsEventLog, GelatoOrder, TrackingAccessToken, Refund, ExchangeRequest, EmailDeliveryLog, ops).
4. **Persistence/infra** — PostgreSQL/Supabase (truth), Redis (events/queues/workflow), Supabase Storage (images), external services (Stripe/Gelato/Resend/PostHog/Sentry).

### Critical Pitfalls

1. **Creating the Order from the client callback instead of the verified webhook** — make the canonical Stripe webhook the *only* Order trigger; the client may poll PaymentAttempt but never mint the Order (INV-1/4).
2. **Weak webhook idempotency / signature handling** — raw-body `constructEvent` verification + two DB-level unique layers: `WebhookEventLog(provider, deduplication_key)` from the Stripe `evt_` id, and `CheckoutCompletionLog(idempotency_key)` from `payment_intent_id`; win races via DB unique constraint, not check-then-act (INV-3/4).
3. **Treating Pix as synchronous** — only `payment_intent.succeeded` creates an Order; model Pix UX states (`pix_qr_displayed`/`expired`) in PaymentAttempt; handle expiry/failure without ever touching an Order (INV-2).
4. **Duplicate Gelato orders** — `POST /v4/orders` is not idempotent and `orderReferenceId` does not dedupe; guard locally with a single-active constraint per Order, prefer **draft→confirm** post-commit, and treat `connectedOrderIds` as one logical order (INV-8).
5. **Coupling fulfillment to PostHog/analytics success** — fulfillment gate depends only on the **local durable** `AnalyticsEventLog` record existing (`recorded`), never on `status=sent` or PostHog reachability (INV-5/7). (Plus cross-cutting: never store/log tokens/secrets in plaintext — INV-11/12; and Brazil money/IOF/Supabase-pooler gotchas.)

## Implications for Roadmap

Based on research, the suggested phase structure follows the dependency spine **infra → catalog → checkout(pre-Order) → webhook ingest → Order creation → outbox → email → fulfillment → tracking → refunds/exchanges → ops → tests**. This ordering is non-negotiable in its key edges: the webhook/idempotency infrastructure (Phase 4) **must** land before Order creation (Phase 5), which must precede the outbox (Phase 6) and gated fulfillment (Phase 8). The architecture's 12-step build order maps cleanly onto these phases.

### Phase 1: Foundation & Observability
**Rationale:** Enables everything; log redaction/security must start here (INV-12).
**Delivers:** Medusa v2 + Postgres/Supabase + Redis (event & workflow engine) scaffolded; Admin on dedicated subdomain; PM2 (server + worker) + Nginx; Sentry + structured logging with redaction; module/workflow conventions established.
**Uses:** Medusa 2.15.x, Node 22, Supabase, Redis, Sentry, PM2, Nginx (STACK.md).
**Avoids:** Pitfall 9 (module/workflow misuse), Pitfall 10 (Supabase pooler vs direct for migrations), Pitfall 8 (logging hygiene set up early).

### Phase 2: Catalog & Media
**Rationale:** Prerequisite for cart and for fulfillability; Gelato metadata gates everything downstream.
**Delivers:** Product/Variant/Price in BRL, **mandatory Gelato metadata validation**, product images in Supabase Storage, LineItem Gelato-snapshot groundwork.
**Implements:** Core catalog modules + `@medusajs/file-s3`.
**Avoids:** Pitfall 11 (BRL integer centavos), fulfillment time-bombs from missing `gelato_*` metadata.

### Phase 3: Cart & Checkout (pre-Order)
**Rationale:** Conversion path and the base for Pix's async model; explicitly creates **no** Order.
**Delivers:** Guest + authenticated cart/checkout, Payment Collection/Session (Stripe card + Pix), custom **PaymentAttempt** module with UX/confirmation states.
**Avoids:** Pitfall 4 (Pix-as-sync) by modeling Pix states in PaymentAttempt, not as financial truth.

### Phase 4: Webhook Ingestion (Stripe)
**Rationale:** The correctness foundation; must exist before any Order can be created.
**Delivers:** `webhooks` module (WebhookEventLog), raw-body `/hooks/stripe` route with signature verification and DB-level dedup; ingest workflow.
**Avoids:** Pitfalls 2 (signature/raw body), 3 (idempotency), 12 (out-of-order/early events).

### Phase 5: Idempotent Order Creation
**Rationale:** The product's core invariant — Order only after the canonical webhook (INV-1/4).
**Delivers:** `checkout` module (CheckoutCompletionLog) + `checkoutCompletionWorkflow` triggered by the Stripe webhook, idempotent on `payment_intent_id`, transactional with PaymentAttempt correlation.
**Avoids:** Pitfall 1 (eager/client-side Order creation), duplicates under redelivery.

### Phase 6: Analytics Outbox (`purchase_completed`)
**Rationale:** Domain event must be durable and decoupled from PostHog before fulfillment can gate on it.
**Delivers:** AnalyticsEventLog + `record-purchase-completed` (written transactionally with Order) + async PostHog dispatcher job.
**Avoids:** Pitfall 5 (fulfillment coupled to analytics delivery).

### Phase 7: Transactional Email (Resend)
**Rationale:** Confirmation email must be sent before the Gelato attempt (sequencing requirement).
**Delivers:** `notifications-resend` module (EmailDeliveryLog, idempotency_key) + `order.created` subscriber.
**Avoids:** Pitfall (email tied to Gelato success); duplicate emails via idempotency key.

### Phase 8: Gelato Fulfillment & Tracking
**Rationale:** Delivery; gated on confirmed Order + durable `purchase_completed`; highest external-integration risk.
**Delivers:** `gelato` module (GelatoOrder, REST v4 client) + single-active gate + `gelatoFulfillmentWorkflow` + `/hooks/gelato` webhook + `Fulfillment.gelato_order_id`; secure **TrackingAccessToken** (hashed) + token-gated public tracking route.
**Avoids:** Pitfalls 6 (duplicate Gelato orders — draft→confirm + local guard), 8 (plaintext tokens).

### Phase 9: Refunds & Exchanges (Admin)
**Rationale:** Operations; requires the operational/financial state separation to already exist.
**Delivers:** Refund (financial state updated only post-Stripe-webhook) + ExchangeRequest (operator-driven) + Correios manual reverse flow.
**Avoids:** Pitfall 7 (refund auto-canceling order; pre-webhook completion; concurrent/over-capture refunds).

### Phase 10: Ops, Audit & Critical Tests
**Rationale:** Operability + regression-guarding the invariants that *are* the product.
**Delivers:** OperationalAlert + AdminActionLog + health check; integration tests covering all 12 invariants (replay/concurrency, Pix expiry, single-active Gelato, refund decoupling, log redaction).
**Avoids:** Silent regressions across every prior pitfall.

### Phase Ordering Rationale

- **Dependency-driven:** webhook ingest (4) gates Order creation (5); Order gates outbox (6) and email (7); both gate fulfillment (8); state-separation (built across 5/9) gates refunds (9). These edges come straight from the FEATURES dependency graph and the ARCHITECTURE build order.
- **Risk-front-loaded:** the correctness boundary (webhook → Order → fulfillment) is sequenced as early as the dependencies allow, since it is where POD shops lose money.
- **Cross-cutting concerns anchored early:** log redaction, module/workflow conventions, and Supabase connection strategy land in Phase 1 because they constrain every later phase (INV-12, Pitfalls 8/9/10).

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):
- **Phase 3/4 (Stripe Pix wiring):** MEDIUM confidence on whether Medusa's bundled Stripe provider fully supports Pix vs needing a custom provider extending `AbstractPaymentProvider` + `getWebhookActionAndData`. Confirm the exact webhook→Order mapping.
- **Phase 8 (Gelato):** No official Medusa provider/SDK; custom module + draft→confirm pattern + webhook auth need API-level verification (catalog `productUid` mapping, signature scheme).
- **Phase 2 (Supabase Storage via S3 endpoint):** MEDIUM on exact `@medusajs/file-s3` endpoint/credential wiring.

Phases with standard patterns (can likely skip research-phase):
- **Phase 1 (Foundation)** and **Phase 6/7 (outbox/email)** — well-documented Medusa + outbox patterns; **Phase 9 refund state machine** follows documented DB_MODEL rules.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core platform, payments, Redis modules verified against Medusa/Stripe/Gelato official docs (Context7); MEDIUM only on a few exact patch versions and Supabase S3 wiring. |
| Features | HIGH | Grounded in canonical project docs (SRS v1.5, PRD Backend v1.1, DB_MODEL v1.21) and PROJECT.md; the Active list is the MVP. |
| Architecture | HIGH | Medusa v2 mechanisms (modules, workflows+compensation, links, subscribers) verified; Gelato integration MEDIUM (custom, no official provider). |
| Pitfalls | HIGH | Payment/webhook/fulfillment correctness verified against Stripe/Gelato/Medusa docs + a real-world Odoo duplicate-Gelato post-mortem; MEDIUM on some Brazil-operational nuances. |

**Overall confidence:** HIGH

### Gaps to Address

- **Stripe Pix via Medusa provider:** Validate during the Payments/Webhook phase whether the bundled provider maps Pix's async lifecycle correctly or a custom provider is required. Handle as a planning spike in Phase 3/4.
- **Gelato webhook signature & draft→confirm:** Confirm Gelato's webhook auth mechanism and the draft→confirm two-step against live API docs during Phase 8 planning.
- **IOF / `amount_includes_iof` policy:** Decide and document the 3.5% IOF handling and reconcile against settled (not requested) amounts before go-live; affects Payments + Refunds.
- **Supabase pooler vs direct connection:** Establish the migrations-on-direct / runtime-on-pooler convention in Phase 1 to avoid migration failures.
- **Resend exact patch version:** Pin at install (MEDIUM on patch).

## Sources

### Primary (HIGH confidence)
- Context7 `/websites/medusajs_resources`, `/medusajs/medusa` — Redis modules, Stripe provider options, payment webhook route, Payment Collection/Session, workflows (compensation/idempotent/locking), Module Links, Fulfillment.
- medusajs.com docs / GitHub releases — Medusa 2.15.5, Node 20+ (22 LTS), `create-medusa-app`, worker mode.
- Context7 `/websites/stripe`, `/stripe/stripe-node` + docs.stripe.com — Pix async lifecycle (`pix_display_qr_code.expires_at`), BRL, no manual capture, refunds, IOF/`amount_includes_iof`; Stripe Node v19.1.0.
- Context7 `/websites/dashboard_gelato` + dashboard.gelato.com/docs — v4 orders, `X-API-KEY`, `order_status_updated` webhook (trackingCode/Url), `connectedOrderIds`, draft vs order, BR domestic shipping.
- Context7 `/websites/resend` — Node SDK send + per-send `idempotencyKey`.
- Canonical project docs — `docs/seed/GSD_BACKEND_MVP_SEED.md` (12 invariants), `docs/DB_MODEL_v1.21.md` (entities, dedup keys, outbox, token hashing, refund rules), `.planning/PROJECT.md`.
- Odoo `sale_gelato` duplicate-prevention commit — real-world draft→confirm post-mortem evidence.

### Secondary (MEDIUM confidence)
- posthog.com docs + npm — posthog-node 5.38.2, Node `^20.20 || >=22.22`, server-side capture.
- npm/newreleases — @sentry/node 10.59.x current.
- Temporal / Cloudflare durable-execution guidance — idempotency-key-at-origin + unique-constraint dedup, applied to this domain.
- `ekkolon/gelato-admin-node` (community SDK) — noted as alternative, not recommended for the money path.

### Tertiary (LOW confidence)
- (None — all findings traced to primary/secondary sources; remaining uncertainty is captured under Gaps to Address.)

---
*Research completed: 2026-06-22*
*Ready for roadmap: yes*
