# Feature Research

**Domain:** Print-on-Demand (POD) t-shirt e-commerce — **backend only** (headless, Medusa v2, Brazil/BRL)
**Researched:** 2026-06-22
**Confidence:** HIGH

> Scope note: This document covers **backend behaviors and API contracts only**. Storefront/UI features are out of scope and excluded. "User" below means either (a) a future storefront consuming the API, (b) the end customer whose state the API represents, or (c) the internal operator using Medusa Admin. The feature set is grounded in the project's canonical docs (SRS v1.5, PRD Backend v1.1, DB_MODEL v1.21) and confirmed against `PROJECT.md` and `DB_MODEL_v1.21.md` entities.

---

## Feature Landscape

### Table Stakes (Must Have — business cannot operate without these)

These are non-negotiable. Each maps to a hard requirement and/or architectural invariant in `PROJECT.md` and `DB_MODEL_v1.21.md`. Missing any one breaks the core promise: *"an Order exists and is sent to production only after reliable, idempotent payment confirmation."*

| Feature | Why Expected (business need) | Complexity | Notes |
|---------|------------------------------|------------|-------|
| Catalog: Product / ProductVariant / Price in **BRL** | No catalog = nothing to sell; single-currency BRL is the market | LOW | Medusa v2 native modules. Price set per region BRL. |
| **Mandatory Gelato metadata on variants** | Fulfillment is impossible without product/variant→Gelato mapping (UID, print area, etc.) | MEDIUM | Validation must reject/flag variants lacking required `gelato_*` metadata (DB_MODEL §5.1). Mirror snapshot onto LineItem at order time (§5.2, §4.11). |
| Product image storage (Supabase Storage) | Storefront needs image URLs via API contract | LOW | Store URL + metadata (ProductImage, §5.3). Backend stores references, not binaries in DB. |
| Guest **and** authenticated cart | POD impulse buys require guest checkout; accounts add retention | MEDIUM | Medusa cart native + customer association. Cart is pre-Order state (DB_MODEL §2.2). |
| Checkout flow (guest + authenticated) | Conversion path; must capture email + shipping address | MEDIUM | Pre-Order; no Order created here. Validates address for Correios/Gelato. |
| **Stripe card payment** (Payment Collection / Session) | Primary BR payment rail | MEDIUM | PaymentCollection + PaymentSession custom mirrors (§4.1, §4.2). |
| **Stripe Pix payment** | Pix is dominant in BR; absence = lost majority of sales | HIGH | Async/deferred confirmation. Pending/expired/canceled/failed Pix **must not** create Order (invariant #2). Polling/webhook reconciliation needed. |
| **PaymentAttempt** tracking | Multiple attempts per cart (failed card, retried Pix) must be auditable | MEDIUM | Custom entity distinct from PaymentSession (§2.18, §4.3). |
| **Validated + idempotent Stripe webhook** (WebhookEventLog) | Webhooks redeliver; signature spoofing risk; canonical truth source | HIGH | Signature verify, persist raw event, dedupe by event id (§2.6, §4.5). The system's correctness hinges on this. |
| **Webhook-driven Order creation** (idempotent) | Invariant #1: Order only after reliable payment confirmation | HIGH | Idempotent by `payment_intent_id` (or `cart_id + payment_intent_id`) via CheckoutCompletionLog (§2.5, §4.4). |
| **Durable `purchase_completed` outbox event** (AnalyticsEventLog) | Domain event must survive regardless of PostHog/frontend success | MEDIUM | Outbox pattern; written transactionally with Order. Fulfillment depends on its existence, NOT on `status=sent` (invariants #5–#7, §4.15). |
| Confirmation email before Gelato attempt (Resend, EmailDeliveryLog) | Customer must be informed; sequencing requirement | MEDIUM | Email attempt logged (§4.13) before fulfillment trigger. |
| **Gelato fulfillment module** | The product is physically made/shipped by Gelato — core delivery | HIGH | Triggered only after confirmed Order + durable `purchase_completed` (invariant #6). One active Gelato order per Order (invariant #8). |
| **Gelato webhook** ingestion | Production/shipping status updates flow back from Gelato | MEDIUM | Reuse WebhookEventLog pattern; updates Fulfillment status (§4.10). |
| Tracking + **secure TrackingAccessToken** | Guests need order/tracking access without an account | MEDIUM | Token hashed/encrypted, never plaintext (invariant #11, §2.7, §4.6). |
| Order state model: **operational vs financial** separation | Refund must not auto-cancel; states are decoupled | MEDIUM | `order_status` vs `payment_status` recomputed transactionally (§2.9, §4.8). |
| **Admin-driven refund** confirmed by Stripe webhook (Refund) | Operators must refund; financial state only changes on reliable webhook | HIGH | Refund local state updates only after Stripe webhook (invariant #9); does not auto-set canceled (invariant #10, §4.9). |
| Operational exchanges via Admin (ExchangeRequest) | Defective/wrong prints need reprint/return handling | HIGH | Operator-driven, not customer self-service (§2.13, §4.12). Reverse logistics state machine. |
| **Correios manual/semi-automatic** reverse flow | Returns shipping for BR without Correios API integration | LOW–MEDIUM | Manual tracking codes entered in Admin; no automated Correios API (intentional). |
| Operational alerts (OperationalAlert) | Failed fulfillment / stuck payment must surface to operators | MEDIUM | Persisted alerts + Sentry (§4.16, §2.11). |
| Audit logs: AdminActionLog, EmailDeliveryLog, WebhookEventLog | Compliance + debugging of money/order/fulfillment actions | MEDIUM | Admin actions audited (§4.14); secrets/card data/plaintext tokens never logged (invariant #12). |
| Observability: Sentry, structured logs, health check | Production operability of a money-handling system | LOW–MEDIUM | Standard; health check for VPS/PM2/Nginx. |
| Critical tests for payment/Order/fulfillment invariants | Invariants are the product; must be regression-guarded | MEDIUM | Cover #1–#12 (no Order without payment, idempotency, single Gelato order, refund decoupling). |
| Stable API contracts for future storefront | Frontend is a later milestone consuming this backend | MEDIUM | PRD Frontend v1.1 is the consumption contract, not build scope. |

### Differentiators (Competitive Advantage — beyond baseline correctness)

For a backend, "differentiation" is **reliability and operational rigor**, not features. These align directly with the Core Value (zero phantom charges, zero duplicate orders, zero improper fulfillment).

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Strict **payment→Order→fulfillment ordering** as enforced invariants | Eliminates phantom charges, duplicate orders, premature production — the #1 failure mode of naive POD shops | HIGH | This rigor is the product's moat vs. typical "create order on checkout" stores. |
| **Idempotent everything** (webhooks, Order creation, fulfillment trigger) | Survives webhook storms, retries, network partitions without corruption | HIGH | CheckoutCompletionLog + WebhookEventLog dedupe keys. |
| **Outbox-based analytics** (`purchase_completed` durable, decoupled from PostHog) | Accurate revenue/conversion data even when client analytics fail | MEDIUM | Rare in small shops; protects business metrics integrity. |
| LineItem **Gelato snapshot** at order time | Order remains fulfillable even if catalog/variant changes later | MEDIUM | Immutability of fulfillment intent (§2.12, §4.11). |
| Fulfillment **retries + operational-attention** flagging | Transient Gelato failures auto-retried; persistent ones escalated, not lost | MEDIUM | §2.11, §4.10. Reduces silent order loss. |
| **Decoupled financial vs operational order state** | Partial refunds, exchanges, reprints without corrupting order lifecycle | MEDIUM | §2.9; enables nuanced operator workflows. |
| Secure guest tracking via hashed tokens | Privacy-preserving order access without forcing accounts | MEDIUM | §2.7; better than emailing raw order IDs. |
| Comprehensive **audit trail** (admin actions, emails, webhooks, alerts) | Operator accountability + fast incident forensics | MEDIUM | Differentiator for support/ops quality. |

### Anti-Features (Deliberately NOT Built)

Explicitly out of scope per `PROJECT.md` "Out of Scope" and the seed's "Fora do escopo." Documented to prevent scope creep.

| Feature | Why Requested (surface appeal) | Why Problematic | Alternative / Decision |
|---------|--------------------------------|-----------------|------------------------|
| Visual t-shirt editor | "Customers want to design" | Massive product surface; not backend; huge complexity | Out of MVP; sell predefined catalog variants. |
| Customer art upload | Personalization | Moderation, storage, IP/legal, Gelato print-file handling | Out of MVP. |
| Physical stock / inventory | "Track what we have" | Contradicts POD model — no inventory exists | POD via Gelato; no inventory module. |
| Own production | Margin/control | Capital + ops out of scope | Gelato only. |
| Multi-supplier POD | Resilience/price | Routing, mapping, snapshot complexity ×N | **Gelato only**; one active Gelato order per Order. |
| Multi-currency | International growth | Pricing, tax, FX, settlement complexity | **BRL single-currency only.** |
| International sales | Bigger market | Customs, shipping, tax, compliance | Brazil only. |
| Payment methods beyond card + Pix (boleto, wallets, installments-as-feature) | More conversion | Each rail adds reconciliation + webhook surface | **Stripe card + Pix only.** |
| Automatic Correios API integration | Automated returns | API complexity/instability; low MVP ROI | **Manual/semi-automatic** codes in Admin. |
| Full customer self-service exchange | Reduce ops load | State-machine + fraud + reverse-logistics complexity | **Operator-driven** ExchangeRequest in Admin. |
| ERP integration | "Connect everything" | Out of product vision; premature | Out of scope. |
| Marketplace (multi-seller) | Platform ambition | Fundamentally different architecture | Out of scope. |
| Frontend / storefront | "Need a site" | Separate milestone | Backend exposes API contracts only. |
| Refund auto-canceling order | "Simpler" | Conflates financial + operational state (invariant #10) | Refund updates financial state only; order_status managed separately. |

---

## Feature Dependencies

The critical chain is **payment → order → fulfillment**, gated by durable logs. This ordering dictates roadmap phase sequencing.

```
Catalog (Product/Variant/Price BRL)
    └──requires──> Mandatory Gelato metadata on variant
                       └──enables──> LineItem Gelato snapshot (at order time)

Product images (Supabase Storage) ──enhances──> Catalog

Cart (guest + auth)
    └──requires──> Catalog
        └──requires──> Checkout (collect email + address)
            └──requires──> PaymentCollection / PaymentSession
                └──requires──> PaymentAttempt (track tries)
                    └──requires──> Stripe card + Pix integration

Stripe webhook (validated + idempotent, WebhookEventLog)
    └──GATES──> Order creation (idempotent, CheckoutCompletionLog)
                    └──writes(transactional)──> purchase_completed (AnalyticsEventLog outbox)
                    └──triggers──> Confirmation email (Resend, EmailDeliveryLog)
                        └──then──> Gelato fulfillment  [requires: Order confirmed + purchase_completed durable]
                                       └──requires──> LineItem Gelato snapshot
                                       └──updated by──> Gelato webhook
                                           └──produces──> Tracking
                                               └──requires──> TrackingAccessToken (secure, hashed)

Order state model (operational vs financial)
    └──required by──> Refund (Admin → Stripe webhook confirms)
    └──required by──> ExchangeRequest (operational)
                          └──requires──> Correios manual reverse flow

Cross-cutting (depend on most flows):
  AdminActionLog ──audits──> Refund, Exchange, manual actions
  OperationalAlert ──escalates──> Fulfillment failures, stuck payments
  Observability (Sentry/logs/health) ──wraps──> everything
  Critical tests ──guard──> all invariants
```

### Dependency Notes

- **Order creation requires the validated Stripe webhook (invariant #1, #3, #4):** Order is created *only* by the canonical webhook handler, idempotently keyed on `payment_intent_id`. No checkout endpoint creates orders. This is the single most important ordering constraint — the webhook/idempotency infrastructure must land **before** order creation.
- **Gelato fulfillment requires confirmed Order + durable `purchase_completed` (invariant #6, #7):** It must NOT depend on PostHog success or `AnalyticsEventLog.status = sent` — only on the row existing. Fulfillment and analytics-delivery are decoupled.
- **Pix forces an async confirmation model (invariant #2):** Unlike card, Pix is deferred; the entire pipeline must tolerate pending payments that never resolve into Orders. This shapes PaymentAttempt + webhook reconciliation design.
- **LineItem Gelato snapshot enables order-time immutability:** Fulfillment must read the snapshot, not the live variant, so catalog edits never corrupt in-flight orders.
- **Single active Gelato order per Order (invariant #8):** Fulfillment trigger must be idempotent/guarded against duplicate dispatch (webhook redelivery, manual retry).
- **Refund decouples from order lifecycle (invariant #9, #10):** Refund updates `payment_status` after Stripe webhook; it never auto-sets `order_status = canceled`. Requires the operational/financial state separation to exist first.
- **Mandatory Gelato metadata gates fulfillability:** A variant without complete `gelato_*` metadata can be cataloged but is a fulfillment time bomb — validation should flag/reject early.
- **Secure tokens + log hygiene are cross-cutting invariants (#11, #12):** TrackingAccessToken hashing and "no secrets/card/plaintext tokens in logs" constrain every feature that logs or exposes data.

---

## MVP Definition

The entire `PROJECT.md` "Active" list **is** the MVP — it is already a ruthless backend-only slice. Sequencing within it:

### Launch With (v1) — the must-ship spine

- [ ] Medusa v2 + PostgreSQL/Supabase + Redis setup; Admin on dedicated subdomain — foundation
- [ ] Catalog: Product/Variant/Price BRL + **mandatory Gelato metadata** validation — nothing fulfillable without it
- [ ] Product images in Supabase Storage — API contract completeness
- [ ] Cart + checkout (guest + authenticated) — conversion path
- [ ] Stripe **card + Pix** via PaymentCollection/PaymentSession + **PaymentAttempt** — revenue
- [ ] **Validated, idempotent Stripe webhook** (WebhookEventLog) — correctness foundation
- [ ] **Idempotent webhook-driven Order creation** (CheckoutCompletionLog) — invariant #1
- [ ] Durable **`purchase_completed`** outbox (AnalyticsEventLog) — invariant #5
- [ ] Confirmation email (Resend, EmailDeliveryLog) — pre-fulfillment sequencing
- [ ] **Gelato fulfillment** + Gelato webhook + tracking — delivery
- [ ] Secure **TrackingAccessToken** — guest access
- [ ] Order operational/financial state model — enables refunds/exchanges
- [ ] **Admin refund** confirmed by Stripe webhook (Refund) — operations
- [ ] Operational **exchanges** (ExchangeRequest) + Correios manual flow — operations
- [ ] OperationalAlert + AdminActionLog — ops + audit
- [ ] Observability (Sentry, structured logs, health check) — operability
- [ ] Critical tests for payment/Order/fulfillment invariants — protect the moat

### Add After Validation (v1.x) — tighten once the spine is proven

- [ ] Richer fulfillment retry/backoff policies — trigger: observed Gelato flakiness
- [ ] Expanded alerting rules / dashboards — trigger: ops pain points emerge
- [ ] Partial-refund and multi-line exchange refinements — trigger: real support cases
- [ ] Webhook reconciliation/sweeper jobs (catch missed Pix confirmations) — trigger: dropped-webhook incidents

### Future Consideration (v2+) — defer until product-market fit

- [ ] Storefront (separate milestone) — explicitly later
- [ ] Additional payment methods (boleto, wallets) — defer; needs reconciliation work
- [ ] Correios API automation — defer until volume justifies
- [ ] Customer self-service exchanges — defer; ops-driven is sufficient at MVP scale

---

## Feature Prioritization Matrix

| Feature | User/Business Value | Implementation Cost | Priority |
|---------|---------------------|---------------------|----------|
| Validated idempotent Stripe webhook | HIGH | HIGH | P1 |
| Webhook-driven idempotent Order creation | HIGH | HIGH | P1 |
| Stripe card + Pix + PaymentAttempt | HIGH | HIGH | P1 |
| Gelato fulfillment + webhook + tracking | HIGH | HIGH | P1 |
| Catalog + mandatory Gelato metadata | HIGH | MEDIUM | P1 |
| Cart + checkout (guest + auth) | HIGH | MEDIUM | P1 |
| Durable `purchase_completed` outbox | HIGH | MEDIUM | P1 |
| Secure TrackingAccessToken | HIGH | MEDIUM | P1 |
| Admin refund (Stripe-confirmed) | HIGH | HIGH | P1 |
| Order operational/financial state model | HIGH | MEDIUM | P1 |
| Confirmation email (Resend) | MEDIUM | MEDIUM | P1 |
| Operational exchanges + Correios manual | MEDIUM | HIGH | P1 |
| OperationalAlert + AdminActionLog | MEDIUM | MEDIUM | P1 |
| Observability (Sentry/logs/health) | MEDIUM | LOW | P1 |
| Product images (Supabase Storage) | MEDIUM | LOW | P1 |
| Critical invariant tests | HIGH | MEDIUM | P1 |
| Fulfillment retry policy refinement | MEDIUM | MEDIUM | P2 |
| Webhook reconciliation sweeper | MEDIUM | MEDIUM | P2 |

**Priority key:** P1 = must have for backend MVP launch · P2 = should add post-validation · P3 = future.

> Note: nearly everything is P1 because the project is already scoped to an irreducible backend MVP. The differentiation between items is **sequencing** (per dependency graph), not inclusion.

---

## Competitor Feature Analysis

Backend-only comparison of how typical POD/commerce backends handle the critical money→order→fulfillment seam.

| Feature | Typical naive POD shop | Mature commerce backend | **Our Approach** |
|---------|------------------------|-------------------------|------------------|
| Order creation timing | On checkout submit (before payment confirmed) | After payment, sometimes idempotent | **Only on canonical Stripe webhook, idempotent by payment_intent_id** |
| Webhook handling | Trust event, no dedupe | Verify + dedupe | **Verify signature + persist (WebhookEventLog) + dedupe + idempotent processing** |
| Pix/async payment | Often unsupported or order-then-cancel | Supported with reconciliation | **Pending/expired/failed Pix never creates Order** |
| Fulfillment dispatch | Immediate, can duplicate on retry | Guarded | **Single active Gelato order per Order; gated on durable purchase_completed** |
| Analytics events | Client-side only (lossy) | Server events | **Durable outbox, decoupled from PostHog success** |
| Refund vs order state | Refund cancels order | Sometimes decoupled | **Financial state decoupled from operational state** |
| Guest tracking | Raw order ID in URL | Tokenized | **Hashed/encrypted TrackingAccessToken, never plaintext** |

Our approach deliberately trades MVP breadth for **transactional correctness** in the payment→order→fulfillment seam — the area where POD shops most commonly lose money.

---

## Sources

- `/.planning/PROJECT.md` — project scope, requirements, invariants, key decisions (canonical, HIGH)
- `/docs/seed/GSD_BACKEND_MVP_SEED.md` — must-haves, out-of-scope, 12 architecture invariants (canonical, HIGH)
- `/docs/DB_MODEL_v1.21.md` — entity model: PaymentCollection/Session/Attempt, CheckoutCompletionLog, WebhookEventLog, TrackingAccessToken, Refund, Fulfillment, LineItem Gelato snapshot, ExchangeRequest, EmailDeliveryLog, AdminActionLog, AnalyticsEventLog, OperationalAlert (canonical, HIGH)
- Medusa v2 module/commerce-primitive knowledge (cart, payment collection/session, fulfillment) — framework knowledge (MEDIUM)
- POD/Stripe/Pix domain patterns (async confirmation, webhook idempotency, outbox) — domain knowledge (MEDIUM)

---
*Feature research for: Brazilian POD t-shirt e-commerce backend (Medusa v2)*
*Researched: 2026-06-22*
