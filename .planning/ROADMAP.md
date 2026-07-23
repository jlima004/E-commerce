# Roadmap: E-commerce POD de Camisetas — Backend MVP

## Overview

This roadmap builds a headless Medusa v2 POD backend (Brazil/BRL) around a single non-negotiable spine: **an Order is born only from the canonical, signature-verified, idempotent Stripe webhook, and Gelato production fires only after a confirmed Order plus a durable local `purchase_completed` record.** The journey runs foundation → catalog → cart/checkout (pre-Order) → payments → webhook ingest → idempotent Order creation → analytics outbox → confirmation email → Gelato fulfillment → secure tracking → refunds/exchanges → ops, audit & invariant tests. Phases are small and independently verifiable; the dependency edges along the money path (webhook → Order → outbox/email → gated fulfillment) are hard ordering constraints derived from the architecture research, not preferences.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Observability** - Medusa v2 + Supabase/Redis + Admin subdomain + PM2/Nginx + Sentry, structured logs with redaction, health check
- [x] **Phase 2: Catalog & Media** - BRL products/variants with mandatory Gelato metadata, Supabase Storage images, and a Gelato snapshot builder/contract for future Order creation (no Order LineItem persistence yet — verified in Phase 6)
- [x] **Phase 3: Cart & Checkout (pre-Order)** - Guest + authenticated cart and checkout data collection that creates no Order
- [x] **Phase 4: Stripe Payments & PaymentAttempt** - Card + async Pix via safe Stripe boundary, every try tracked in PaymentAttempt; complete. The activation blocker recorded at the 2026-06-29 closure is historical and superseded by later safe-layer, migration-audit, downstream-closure, and release-stabilization gates; separately deferred Stripe smokes/config do not reopen the phase
- [x] **Phase 5: Stripe Webhook Ingestion & Idempotency** - Raw-body signature-verified `/hooks/stripe` + WebhookEventLog DB-level dedup
- [x] **Phase 6: Idempotent Webhook-Driven Order Creation** - Order created only from `payment_confirmed_by_webhook` PaymentAttempt with `order_id = null`, idempotent on payment_intent_id, decoupled state
- [x] **Phase 7: Analytics Outbox (purchase_completed)** - Durable local outbox written with the Order + async PostHog relay
- [x] **Phase 8: Transactional Email (Resend)** - Idempotent confirmation email after confirmed Order + durable local `purchase_completed`, before the Gelato attempt *(complete; closed 2026-07-01)*
- [x] **Phase 9: Gelato Fulfillment & Webhook** - Gated single-active Gelato dispatch + Gelato webhook for status/tracking *(complete; closed 2026-07-02)*
- [x] **Phase 10: Secure Guest Tracking** - Hashed TrackingAccessToken + token-gated public tracking route *(complete; closed 2026-07-02)*
- [x] **Phase 11: Refunds & Exchanges (Admin)** - Webhook-confirmed refunds decoupled from order_status + operational exchanges + manual Correios flow *(complete; closed 2026-07-03)*
- [x] **Phase 12: Ops, Audit & Critical Tests** - OperationalAlert + AdminActionLog + automated invariant regression tests *(6/6 plans executed; human REVIEW/re-REVIEW PASS; CLOSURE PASS; complete / closed 2026-07-23; OPS-01 complete; OPS-02 complete; TEST-01 complete)*

## Phase Details

### Phase 1: Foundation & Observability

**Goal**: A secure, observable Medusa v2 backend runs locally and in production on Postgres/Supabase + Redis, with the Admin on its own production surface and log redaction active from day one.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):

  1. `medusa develop` boots locally and the production build runs under PM2 (server + worker) behind Nginx, backed by Supabase Postgres and a Redis-backed event bus, cache, and workflow engine (no in-memory defaults).
  2. Medusa Admin is reachable on its dedicated subdomain.
  3. Backend errors are reported to Sentry and the app emits structured logs with secrets, full card data, and plaintext tokens redacted (a grep of logs finds no `sk_live`/`whsec`/PAN/raw token).
  4. A health-check endpoint reports service and dependency (Postgres/Redis) health.
  5. Database migrations run on the direct/session Supabase connection (not the transaction pooler) without prepared-statement errors.

Phase 1 is valid but too large for a single Cursor execution. Planning MUST split it into small, independently reviewable plan slices. These may be planned and executed incrementally and must NOT be implemented as one large uncontrolled change.

**Historical production checkpoint (2026-06-26):** The original VPS/PM2/Nginx route from Phase 01 planning was superseded in that cycle by Heroku. The portable VPS/Nginx artifacts remain useful runbook/templates; the checkpoint was Heroku app `espacoliminar`, release `v27`, deployed commit `d02fd70`, with Supabase Postgres via pooler, Heroku Redis with TLS, Heroku release phase for migrations, and web/worker dynos up. The current canonical operational classification comes from CACHE-01A PASS, CACHE-01B PASS, INFRA-01 PASS, and the formal stabilization closure: cache Redis active on `web.1` and `worker.1`, stabilization complete, production healthy.

Expected Phase 1 plan slices:

- Plan 1.1 — Medusa local bootstrap
- Plan 1.2 — Supabase/Postgres connection strategy and migrations connection
- Plan 1.3 — Redis-backed event bus/cache/workflow engine
- Plan 1.4 — structured logger and redaction policy
- Plan 1.5 — Sentry backend integration
- Plan 1.6 — health check endpoint
- Plan 1.7 — production runbook for PM2, Nginx, server/worker, and Admin subdomain

**Plans**: 7/7 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold Medusa backend-only e runner/setup mínimo

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Estratégia Supabase/Postgres e migrations direct/session

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Event bus, cache e workflow engine Redis

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Logger estruturado e política de redaction

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Integração Sentry backend saneada
- [x] 01-06-PLAN.md — Endpoints de liveness e readiness

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-07-PLAN.md — Runbook PM2/Nginx, server/worker e Admin dedicado; current production checkpoint stabilized on Heroku/Supabase/Redis

**Historical closure status (2026-06-26):** Phase 01 is complete. The VPS/PM2/Nginx route remains as a portable blueprint. At that checkpoint, Heroku app `espacoliminar`, release `v27`, commit `d02fd70`, used `APP_VERSION=d02fd70` and `REDIS_CACHE_PROVIDER_DISABLED=true` while the TLS loop was isolated; that cache-disable state was subsequently superseded by CACHE-01A PASS, CACHE-01B PASS, INFRA-01 PASS, cache Redis active on `web.1` and `worker.1`, and the formal release-stabilization closure. Phase 02 began only in its later manual-review-gated cycle.

### Phase 2: Catalog & Media

**Goal**: Operators can model BRL-priced products/variants that carry mandatory Gelato metadata, with product images in Supabase Storage, exposed as a stable API contract — plus a Gelato snapshot builder/helper/contract ready for future Order creation. Actual `LineItem.metadata.gelato_snapshot` persistence is NOT in scope here because Order creation does not yet exist (it arrives in Phase 6).
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, MEDIA-01
**Manual gate:** Phase 02 is now closed, and Phase 03 may begin only in a separate manual-review-gated cycle.
**Scope note**: Phase 2 delivers only: (a) required Gelato metadata definition; (b) validation of sellable variants with mandatory `gelato_*` metadata; (c) Supabase Storage image references; (d) a stable catalog API contract; (e) a snapshot builder/helper/contract for future Order creation; (f) unit tests for the snapshot builder (if applicable). It does NOT require actual Order LineItem persistence — real persistence of `LineItem.metadata.gelato_snapshot` is verified in Phase 6.
**Success Criteria** (what must be TRUE):

  1. Operator can create a product with variants priced in BRL major units, positive and with at most two decimal places, via the Admin.
  2. A variant missing required `gelato_*` metadata is flagged/rejected at create/update time (validation of sellable variants).
  3. Product images upload to Supabase Storage and the API returns URL references (no binaries stored in the database).
  4. The Store catalog API returns products, variants, and BRL prices in a stable shape suitable for the future storefront.
  5. A Gelato snapshot builder/helper exists that produces an immutable snapshot from validated `ProductVariant` metadata, with a documented contract for Phase 6 Order creation to consume; unit tests cover the builder where applicable. (No Order LineItem persistence is required or verified in this phase.)

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md - Contrato tipado central da metadata Gelato e predicado `is_sellable`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md - Gate de validacao sellable/publish para produto/variante no Admin
- [x] 02-03-PLAN.md - Provider oficial `@medusajs/file-s3` para Supabase Storage e contrato de env

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md - Contrato publico estavel da Store API para catalogo e midia
- [x] 02-05-PLAN.md - Snapshot builder/helper puro e contrato consumivel pela Phase 6

**Closure status (2026-06-27):** Phase 02 is complete. `02-01`, `02-02`, `02-03`, `02-04` e `02-05` foram aceitos como executados; `CAT-01`, `CAT-02`, `CAT-03`, `CAT-04` e `MEDIA-01` ficaram coerentes com os summaries, com `02-VALIDATION.md`, `02-UAT.md` e `REQUIREMENTS.md`. O builder/helper/contrato de snapshot Gelato fecha apenas o escopo desta fase; a persistencia real em `Order`/`LineItem` continua reservada para a Phase 6. Phase 03 may begin only in a separate manual-review-gated cycle.

### Phase 3: Cart & Checkout (pre-Order)

**Goal**: Guests and authenticated customers can build a cart and complete checkout data collection without ever creating an Order.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CART-01, CART-02, CART-03, CART-04
**Manual gate:** Phase 03 is complete (closed 2026-06-27). Phase 04 planning may begin only after human review of `03-CLOSURE.md`.
**Success Criteria** (what must be TRUE):

  1. A guest can create and manage a cart without an account.
  2. An authenticated customer can create and manage a cart associated with their account.
  3. Checkout collects and validates customer email and a shipping address suitable for Gelato/Correios.
  4. Completing checkout creates no Order — the cart stays in pre-Order state (verified: no Order row exists after checkout submission).

**Plans**: 5/5 executed

Plans:
**Wave 1**

- [x] 03-01-PLAN.md - Contrato de cart ativo guest/customer sem pagamento
- [x] 03-02-PLAN.md - Attach seguro do guest cart da sessao atual no login
- [x] 03-03-PLAN.md - Email e shipping address Brasil/Gelato com `federal_tax_id`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-04-PLAN.md - `checkout_data_complete` derivado/calculado, sem status persistido

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-05-PLAN.md - Provas negativas pre-Order e contrato HTTP final

**Closure status (2026-06-27):** Phase 03 is complete. `03-01` through `03-05` were executed and verified (64 tests green: 40 unit + 24 integration HTTP; negative grep clean; build green with `ADMIN_DISABLED=true`). `CART-01`, `CART-02`, `CART-03`, and `CART-04` are complete. `checkout_data_complete` remains derived only; `federal_tax_id` lives in `shipping_address.metadata` with public `masked_federal_tax_id`; guest attach uses `req.session.active_cart_id`. No Order, PaymentAttempt, PaymentSession, webhook, Stripe/Pix, Gelato, migration, deploy, install, or secrets/config change was introduced. Phase 04 may begin **planning only** in a separate manual-review-gated cycle — execution not started.

**Cross-cutting constraints:** `federal_tax_id` must use the lowest-exposure existing cart/address storage path available and must be omitted or masked in public responses/logs/Sentry; old carts may be marked not-active only with existing core fields/metadata unless a manual migration gate is approved; guest cart attach must prove the cart belongs to the current session and cannot trust body-only `cart_id`; `checkout_data_complete` is derived only and never persisted as `ready_for_payment`; no Order, PaymentAttempt, PaymentSession, webhook, Stripe/Pix, Gelato, migration, deploy, install, or secrets/config-var change is part of Phase 03 planning or execution.

### Phase 4: Stripe Payments & PaymentAttempt

**Goal**: Customers can pay by card or Pix through Stripe Payment Collection/Session, with every attempt tracked in a custom PaymentAttempt and Pix modeled as asynchronous — still without minting an Order.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04
**Manual gate:** Phase 04 is complete and closed at the manual gate. **Historical closure note:** on 2026-06-29, activation was still blocked by the draft migration and missing real safe layers/config. Later gates implemented safe Stripe test-mode layers, RC1 confirmed the PaymentAttempt/webhook migrations applied, Phases 05–11 closed, and release stabilization recorded production healthy. Any Stripe smoke/config without specific evidence remains a separate operational concern and does not reopen Phase 04.
**Success Criteria** (what must be TRUE):

  1. Customer can initiate a credit-card payment via a Stripe Payment Session in BRL.
  2. Customer can initiate a Pix payment that surfaces a QR with `expires_at`, with UX states (`payment_instructions_displayed`, `awaiting_pix_payment`, `pix_expired`) recorded in PaymentAttempt — never treated as financial truth.
  3. Every payment try (card or Pix, including retries) is recorded as an auditable PaymentAttempt per cart.
  4. A pending, expired, cancelled, or failed Pix results in no Order and marks the PaymentAttempt accordingly.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 04-01-PLAN.md - Spike/gate de provider Stripe Medusa, `PaymentSession.data`, Pix e `client_secret`

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 04-02-PLAN.md - Modelo/contrato de `PaymentAttempt`, schema/migration planejada e uma tentativa ativa por cart
- [x] 04-03-PLAN.md - Eligibility para iniciar pagamento com amount/currency derivados server-side

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-04-PLAN.md - Iniciacao de pagamento por cartao em BRL sem dados brutos de cartao e sem persistir `client_secret`

**Wave 4** *(blocked on Wave 1 Pix gate and Wave 2 completion)*

- [x] 04-05-PLAN.md - Iniciacao de Pix em BRL com QR/instrucoes imediatas, `expires_at` e estados assincros locais

**Wave 5** *(blocked on Waves 3 and 4 completion)*

- [x] 04-06-PLAN.md - Invalidation/supersede por mudanca de cart e provas negativas finais da Phase 04

**Historical closure status (2026-06-29):** Phase 04 completed the pre-Order money-path implementation/test scope. Native-first pure Medusa Stripe was rejected after the `04-01` gate; card and Pix were implemented through `filtering_wrapper` + injectable Stripe safe layers. `PaymentAttempt` is auditable with one active attempt per cart, `checkout_data_complete` and server-side amount/currency are payment-start gates, Pix async local states persist `expires_at` without persisting QR/`next_action`, and cart mutation invalidates stale attempts through a safe fingerprint. Final evidence was 89 unit tests, 29 HTTP integration tests, build green, and negative grep clean. The activation blockers recorded at that gate were later superseded by safe Stripe test-mode layers, the RC1 applied-migration audit, Phases 05–11 closures, and formal production stabilization; this does not claim the separately deferred real Pix smoke.

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

**Plans**: 4/4 plans executed

Plans:
**Wave 1**

- [x] 05-01-PLAN.md - Schema/config de `WebhookEventLog` e contrato de env

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md - Rota raw-body `/hooks/stripe`, verificacao de assinatura e dedup

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md - Processamento PaymentIntent-to-PaymentAttempt; estado terminal `payment_confirmed_by_webhook`

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-04-PLAN.md - Validacao final, provas negativas e manual gate antes da Phase 06

**Closure status (2026-06-30):** Phase 05 is complete. `05-01` through `05-04` were executed and verified (29 unit tests, 10 HTTP integration tests, build green, focused runtime negative greps green). WHK-01 and WHK-02 are complete. The accepted terminal local state is `PaymentAttempt.status = payment_confirmed_by_webhook` with `order_id = null`. No Order, `CheckoutCompletionLog`, `purchase_completed`, Gelato, email, analytics, or refund flow was introduced. Stripe CLI real smoke remains documented only. Human review accepted Phase 05 at the manual gate. Phase 06 may begin **planning only** in a separate manual-review-gated cycle — execution not started.

### Phase 6: Idempotent Webhook-Driven Order Creation

**Goal**: An Order is born only from a confirmed `PaymentAttempt` (`status = payment_confirmed_by_webhook`, `order_id = null`), idempotently keyed on `payment_intent_id`, with decoupled operational and financial state.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: ORD-01, ORD-02, ORD-03
**Manual gate:** Phase 06 is complete and accepted at the manual gate on 2026-06-30. Phase 07 may be planned next, but execution remains blocked until explicit human approval. **Hard constraint preserved:** Order creation consumes only `PaymentAttempt` rows where `status = payment_confirmed_by_webhook` and `order_id = null` — no checkout/storefront endpoint or other entry point may create an Order.
**Success Criteria** (what must be TRUE):

  1. An Order is created only from `PaymentAttempt.status = payment_confirmed_by_webhook` with `order_id = null` — never by a checkout/storefront endpoint.
  2. Replaying or concurrently delivering the same confirmation yields exactly one Order (CheckoutCompletionLog unique on `idempotency_key`).
  3. Order creation, CheckoutCompletionLog update, and PaymentAttempt.order_id correlation occur in one transaction.
  4. Order exposes decoupled `order_status` and `payment_status`, recomputed transactionally.
  5. Order creation captures immutable Gelato snapshot data into each Order LineItem from the validated ProductVariant metadata, and later catalog edits do not alter existing Order LineItems.

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 06-01-PLAN.md - Schema/contract/helper de `CheckoutCompletionLog`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md - Guard exato de `PaymentAttempt` e entrypoint interno pos-webhook

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md - Criacao transacional real de Order com snapshots obrigatorios e correlacao

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 06-04-PLAN.md - Hardening de snapshot Gelato, imutabilidade e falha/retry

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 06-05-PLAN.md - Validacao final, provas negativas e manual gate antes da Phase 07

**Closure status (2026-06-30):** Phase 06 is complete. `06-01` through `06-05` were executed and verified (unit: 5 suites / 50 tests; HTTP integration: 2 suites / 15 tests; build PASS; Store completion grep PASS; Phase 07+ runtime-scope grep PASS; secret/payload grep PASS; docs real-secret grep PASS). `ORD-01`, `ORD-02`, and `ORD-03` are complete. The accepted outcome is: Order created only from the canonical internal post-webhook flow; `CheckoutCompletionLog` prevents duplicate Order creation under replay/concurrency; `order_status` and `payment_status` remain decoupled in `Order.metadata`; `PaymentAttempt.order_id` is correlated; and `LineItem.metadata.gelato_snapshot` is mandatory and immutable. Broad scan evidence remained informational only and preserved generic/pre-existing vocabulary outside the Phase 06 runtime surface. No Phase 07 implementation, `purchase_completed`, analytics, email, Gelato fulfillment, refund flow, Stripe CLI smoke, or real migration execution was introduced. Phase 07 is not started and remains blocked behind a separate manual gate.

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

**Plans**: 3/3 plans executed

Plans:
**Wave 1**

- [x] 07-01-PLAN.md - Contrato, modelo e idempotencia de `AnalyticsEventLog`

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 07-02-PLAN.md - Gravacao transacional de `purchase_completed` e gate local downstream

**Wave 3** *(blocked on Wave 2 manual gate)*

- [x] 07-03-PLAN.md - Relay assincrono PostHog, retry e validacao final da Phase 07

**Closure status (2026-07-01):** Phase 07 is complete. `07-01` through `07-03` were executed and verified (unit: 35/35; HTTP filtered: 3/3; build PASS; negative greps PASS; `git diff --check` PASS). `ANL-01`, `ANL-02`, and `ANL-03` are complete. The accepted outcome is: durable local `purchase_completed` written on accepted Order success; downstream local gating depends on outbox existence, never on PostHog or `status = sent`; async PostHog relay with retry/backoff/dead-letter; local gate accepts `recorded | queued | sending | sent | failed | dead_letter`; `LineItem.metadata.gelato_snapshot` remains mandatory on Order but prohibited in analytics payload; Order birth rule unchanged (canonical internal post-webhook only). `posthog-node@^5.38.2` added (resolved `5.39.2`); root `package-lock.json` updated by workspace npm. No PostHog real call, Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke, or real migration execution. Human review accepted Phase 07 at the manual gate (`07-03-SUMMARY.md`). Phase 08 may be planned next, but execution remains blocked until explicit human approval. Phase 09 remains blocked by Phase 7 + Phase 8 dependencies.

### Phase 8: Transactional Email (Resend)

**Goal**: A confirmation email is sent via Resend after Order confirmation and before the Gelato fulfillment attempt, idempotently and auditably.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: EMAIL-01, EMAIL-02
**Manual gate:** Phase 08 is complete and accepted at the manual gate on 2026-07-01. Phase 09 may be planned next, but execution remains blocked until explicit human approval.
**Success Criteria** (what must be TRUE):

  1. A confirmation email is sent via Resend only after a confirmed Order and durable local `purchase_completed` exist, and before any Gelato fulfillment attempt.
  2. Every email attempt is recorded in EmailDeliveryLog with an `idempotency_key`.
  3. Redelivery/retry does not send a duplicate email (local idempotency + Resend `idempotencyKey` guard verified).
  4. Resend success is not required to validate the Order; email failure is retried/dead-lettered without changing the Order birth rule.

**Plans**: 3/3 plans executed

Plans:
**Wave 1**

- [x] 08-01-PLAN.md - EmailDeliveryLog contract, model, idempotency and migration draft

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 08-02-PLAN.md - Local confirmation-email enqueue after Order + purchase_completed, with real runtime module registration and fail-closed behavior if `EmailDeliveryLog` is unavailable

**Wave 3** *(blocked on Wave 2 manual gate)*

- [x] 08-03-PLAN.md - Async Resend relay, retry, dead-letter and final validation

**Closure status (2026-07-01):** Phase 08 is complete. `08-01` through `08-03` were executed and verified (unit: 41/41; HTTP filtered: 4/4; build PASS; negative greps PASS; `git diff --check` PASS). `EMAIL-01` and `EMAIL-02` are complete. The accepted outcome is: confirmation e-mail enqueued locally after confirmed Order + durable local `purchase_completed`; async Resend relay with retry/backoff/dead-letter; idempotency key `order-confirmation/{order_id}`; `Order.email` as sole recipient source; full e-mail not persisted in `EmailDeliveryLog`; Resend is not a gate of Order; `status = sent` is not required to validate Order; future automatic Gelato requires `EmailDeliveryLog(order_confirmation).status = sent` or explicit operational decision; `dead_letter` never authorizes automatic Gelato; Order birth rule unchanged. `resend@^4.8.0` added (resolved `4.8.0`); root `package-lock.json` updated by workspace npm. No Resend real call, real e-mail, PostHog real call, Gelato, fulfillment, refund, exchange, tracking, Stripe CLI smoke, or real migration execution. Human review accepted Phase 08 at the manual gate (`08-03-SUMMARY.md`). Phase 09 may be planned next, but execution remains blocked until explicit human approval.

### Phase 9: Gelato Fulfillment & Webhook

**Goal**: Confirmed, durable local `purchase_completed` orders with `EmailDeliveryLog(order_confirmation).status = sent` are dispatched to Gelato exactly once, with status and tracking ingested via a validated, idempotent Gelato webhook.
**Mode:** mvp
**Depends on**: Phase 7, Phase 8
**Requirements**: FUL-01, FUL-02, FUL-03, FUL-04, WHK-03
**Manual gate:** Phase 09 is complete and accepted at the manual gate on 2026-07-02. `FUL-01`..`FUL-04` and `WHK-03` are complete. Phase 10 may be planned next, but execution remains blocked until explicit human approval.
**Success Criteria** (what must be TRUE):

  1. Gelato fulfillment is triggered only when:
     - confirmed Order exists;
     - durable local `purchase_completed` exists;
     - `EmailDeliveryLog(order_confirmation).status = sent`;
     - or explicit future operational override exists.
  2. Triggering fulfillment twice or crash-and-retry produces exactly one active Gelato order per Order (single-active guard; `connectedOrderIds` treated as one logical order).
  3. The Gelato webhook is ingested using the same validated, deduplicated, persisted-event pattern and updates the Fulfillment record (status + tracking) via the canonical `Fulfillment.gelato_order_id` lookup.
  4. Transient Gelato failures are retried; persistent failures mark `GelatoFulfillment.status = dead_letter` and `requires_operator_attention = true` with sanitized operator alert fields rather than being silently lost. This is the Phase 09 minimal alert contract and does not start the broad Phase 12 `OperationalAlert` module.
  5. `EmailDeliveryLog.dead_letter` never authorizes automatic Gelato dispatch.

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 09-01-PLAN.md - Gelato fulfillment contract, local model, idempotency and single-active guard

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 09-02-PLAN.md - Local Gelato eligibility gate after Order + purchase_completed + EmailDeliveryLog sent

**Wave 3** *(blocked on Wave 2 manual gate)*

- [x] 09-03-PLAN.md - Async Gelato dispatch relay with eligibility scan, retry/backoff/dead-letter and local operator alert

**Wave 4** *(blocked on Wave 3 manual gate)*

- [x] 09-04-PLAN.md - Gelato webhook ingestion, deduplication, authenticity, status/tracking update contract

**Wave 5** *(blocked on Wave 4 manual gate)*

- [x] 09-05-PLAN.md - Final validation, invariant tests and negative proofs

**Closure status (2026-07-02):** Phase 09 is complete/closed. `09-01` through `09-05` were executed and verified on branch `gsd/phase-09-gelato-fulfillment-webhook` (branch decision B). Validation evidence: unit 75/75, HTTP filtered 11/11, HTTP Gelato webhook 6/6 — **92 tests PASS**, build PASS. `FUL-01`, `FUL-02`, `FUL-03`, `FUL-04`, and `WHK-03` are complete. Accepted outcome includes: local `GelatoFulfillment` aggregate; single-active guard per Order; `gelato-dispatch:{order_id}` local idempotency; eligibility after confirmed Order + durable local `purchase_completed` + `EmailDeliveryLog(order_confirmation).status = sent`; async Gelato dispatch relay with retry/backoff/dead-letter and minimal operator alert fields; stale in-flight recovery without blind redispatch; `POST /hooks/gelato` with HTTP Header fail-closed auth; `WebhookEventLog` provider=gelato with dedupe by `payload.id`; MVP event `order_status_updated` only; status/tracking update into internal fulfillment summary only. No real Gelato call/order/webhook smoke, no migration applied, no tracking public route, no TrackingAccessToken, no refund, exchange, Resend real, PostHog real, or Stripe CLI smoke. Migration real, production Gelato dispatch, and production webhook dashboard smoke remain separate future gates. Human review accepted Phase 09 at the manual gate (`09-05-SUMMARY.md`, `09-CLOSURE.md`). Phase 10 is **not started** and blocked until explicit human approval.

### Phase 10: Secure Guest Tracking

**Goal**: Guests can check order/tracking status through a secure, hashed access token that is never stored in plaintext.
**Mode:** mvp
**Depends on**: Phase 9
**Requirements**: TRK-01, TRK-02
**Manual gate:** Phase 10 is complete and accepted at the manual gate on 2026-07-02. `TRK-01` and `TRK-02` are complete. Phase 11 may be planned next, but execution remains blocked until explicit human approval.
**Success Criteria** (what must be TRUE):

  1. A guest can access order/tracking status via a TrackingAccessToken-gated public route.
  2. Tracking tokens are persisted only as a hash (with `expires_at`/`revoked_at`) — a DB and log grep finds no plaintext token.
  3. The tracking route validates tokens server-side with a constant-time compare and is rate-limited against enumeration.

**Plans**: 3/3 plans executed

Plans:
**Wave 1**

- [x] 10-01-PLAN.md - TrackingAccessToken contract, model, HMAC hash, expiry/revocation and migration draft

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 10-02-PLAN.md - Public token-gated tracking route with sanitized allowlist response

**Wave 3** *(blocked on Wave 2 manual gate)*

- [x] 10-03-PLAN.md - Rate limit, enumeration protection and final validation

**Closure status (2026-07-02):** Phase 10 is complete/closed. `10-01` through `10-03` were executed and verified on branch `gsd/phase-10-secure-guest-tracking`. Validation evidence: unit 45/45, HTTP 11/11, build PASS, blocking runtime grep PASS, config/lockfile no diff, `git diff --check` PASS. `TRK-01` and `TRK-02` are complete. Accepted outcome includes: `TrackingAccessToken` hash-only persistence with HMAC-SHA256 and constant-time compare; `POST /store/tracking/lookup` body-only token route; allowlist-only public response without `trackingCode`/`trackingUrl`; rate limit / enumeration guard with indistinguishable 429; process-local in-memory store with documented multi-instance limitation. No migration applied, no Gelato real, no webhook smoke real, no refund, exchange, admin ops, deploy, or Phase 11 work. Migration real, global Redis rate limit, and client token delivery remain separate future gates. Human review accepted Phase 10 at the manual gate (`10-03-SUMMARY.md`, `10-CLOSURE.md`). Phase 11 is **not started** and blocked until explicit human approval.

### Phase 11: Refunds & Exchanges (Admin)

**Goal**: Operators can issue refunds whose local financial state updates only after a Stripe webhook confirms, and manage operational exchanges with a manual Correios reverse flow — without coupling money state to the order lifecycle.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: REF-01, REF-02, EXC-01, EXC-02
**Manual gate:** Phase 11 is complete and accepted at the manual gate on 2026-07-03. `REF-01`, `REF-02`, `EXC-01`, and `EXC-02` are complete. At that historical closure, Phase 12 had not started and remained blocked until explicit human approval.
**Success Criteria** (what must be TRUE):

  1. Operator can request a refund from the Admin; local financial state updates only after a reliable Stripe refund webhook confirms it.
  2. A refund never automatically sets `order_status` to canceled, and concurrent or over-captured refunds per Payment are blocked.
  3. Operator can create and manage an ExchangeRequest for defective/wrong prints from the Admin.
  4. Reverse logistics use a manual/semi-automatic Correios flow (tracking codes entered in the Admin) with no automated Correios API integration.

**Plans**: 4/4 plans executed

Plans:
**Wave 1**

- [x] 11-01-PLAN.md - RefundRequest contract, model, Admin-safe reservation, concurrency/idempotency

**Wave 2** *(blocked on Wave 1 manual gate)*

- [x] 11-02-PLAN.md - Stripe refund webhook confirmation, financial recomputation, `refund.created` hardening

**Wave 3** *(blocked on Wave 2 manual gate)*

- [x] 11-03-PLAN.md - ExchangeRequest Admin workflow, manual Correios fields, raw body allowlist

**Wave 4** *(blocked on Wave 3 manual gate)*

- [x] 11-04-PLAN.md - Final validation, negative proofs and manual gate before Phase 12

**Closure status (2026-07-03):** Phase 11 is complete/closed. `11-01` through `11-04` were executed and verified on branch `gsd/phase-11-refunds-exchanges-admin`. Validation evidence: unit 75/75, HTTP 29/29 — **104 tests PASS**, build PASS, greps G1–G7 PASS (G4 informational only — sanitizer Gelato URL pattern), config/lockfile no diff, `git diff --check` PASS. `REF-01`, `REF-02`, `EXC-01`, and `EXC-02` are complete. Accepted outcome includes: RefundRequest Admin-safe reservation with captured-truth guards; idempotency; process-local per-order concurrency claim; Stripe refund object webhook as sole local financial truth; `refund.created` never finalizes money; `charge.refunded` informational/idempotent; `payment_status` recomputation without auto-canceling `order_status`; ExchangeRequest operational workflow for `defect`/`wrong_product`; manual Correios reverse logistics; raw body allowlist on exchange routes; sanitization of notes, affected_items, and payloads. No real migration, `medusa db:migrate`, deploy, Stripe real, Stripe CLI smoke, Gelato real, Correios API, broad OperationalAlert, broad AdminActionLog, or Phase 12 work occurred in that closure. At that historical point, Phase 12 had not started and remained blocked until explicit human approval.

### Phase 12: Ops, Audit & Critical Tests

**Goal**: Operational failures surface as persisted alerts, money/order/fulfillment actions are audited, and automated tests regression-guard the payment→order→fulfillment invariants that are the product.
**Mode:** mvp
**Depends on**: Phases 1-11
**Requirements**: OPS-01, OPS-02, TEST-01
**Manual gate:** Plans `12-01`..`12-06` foram executados e o Plan 12-06 passou sob o gate composto P12-12-06-R1 (PostgreSQL serial disposable + Modules normal). `TEST-01`, `OPS-01` e `OPS-02` estão complete. Human REVIEW/re-REVIEW **PASS** (P12-REVIEW-R2). Phase 12 **CLOSURE PASS** — complete / closed 2026-07-23. Milestone closeout, Phase 13, push, deploy e frontend permanecem fora deste fechamento e exigem decisão/autorização separada.

**Boundary preserved:** Phase 09 `GelatoFulfillment.requires_operator_attention` / `dead_letter` remains the local fulfillment truth and closes FUL-04. Phase 12 OPS-01 adds the promotion of that condition to a persisted, consultable `OperationalAlert`; it does not reopen FUL-04.

**Known PRD divergence:** OperationalAlert email delivery via Resend is outside the Phase 12 MVP, is a known divergence from the PRD, and is not a blocker for OPS-01.
**Success Criteria** (what must be TRUE):

  1. Failed fulfillments and stuck payments surface as persisted OperationalAlerts.
  2. Every Admin action on money, order, or fulfillment is recorded in AdminActionLog for audit.
  3. Automated tests guard the core invariants — no Order without confirmed payment (INV-1/2), webhook idempotency (INV-3/4), single active Gelato order (INV-8), and refund/order-status decoupling (INV-9/10) — and they pass.

**Plans**: 6/6 executed (human REVIEW/re-REVIEW PASS; CLOSURE PASS; complete / closed 2026-07-23; OPS-01 complete; OPS-02 complete; TEST-01 complete)

Plans:
- [x] 12-01-PLAN.md — Single-owner disposable PostgreSQL lifecycle and execution-base proof foundation
- [x] 12-02-PLAN.md — OperationalAlert persistence, atomic upsert and Admin GET list/detail
- [x] 12-03-PLAN.md — Factual fulfillment/payment-stuck detections and worker scanner
- [x] 12-04-PLAN.md — Append-only AdminActionLog, terminal dedupe, failure contract and runtime reconciliation primitives
- [x] 12-05-PLAN.md — Runtime registration and explicit Strategy B audit instrumentation on refund/exchange Admin routes
- [x] 12-06-PLAN.md — Named invariant suites, PostgreSQL concurrency/reconciliation proofs and SHA-based final validation

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Observability | 7/7 | Complete | 2026-06-26 |
| 2. Catalog & Media | 5/5 | Complete | 2026-06-27 |
| 3. Cart & Checkout (pre-Order) | 5/5 | Complete | 2026-06-27 |
| 4. Stripe Payments & PaymentAttempt | 6/6 | Complete (historical activation blocker superseded by later gates) | 2026-06-29 |
| 5. Stripe Webhook Ingestion & Idempotency | 4/4 | Complete | 2026-06-30 |
| 6. Idempotent Webhook-Driven Order Creation | 5/5 | Complete | 2026-06-30 |
| 7. Analytics Outbox (purchase_completed) | 3/3 | Complete | 2026-07-01 |
| 8. Transactional Email (Resend) | 3/3 | Complete | 2026-07-01 |
| 9. Gelato Fulfillment & Webhook | 5/5 | Complete / Closed | 2026-07-02 |
| 10. Secure Guest Tracking | 3/3 | Complete / Closed | 2026-07-02 |
| 11. Refunds & Exchanges (Admin) | 4/4 | Complete / Closed | 2026-07-03 |
| 12. Ops, Audit & Critical Tests | 6/6 | Complete / Closed | 2026-07-23 |

---
*Roadmap created: 2026-06-22*
*Granularity: fine (12 phases) · Mode: mvp · Coverage: 45/45 requirements mapped*
