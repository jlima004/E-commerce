---
phase: 10-secure-guest-tracking
status: planned-manual-gate
created_at: 2026-07-02
scope: planning-only
depends_on: 09-gelato-fulfillment-webhook
requirements: [TRK-01, TRK-02]
manual_review_gate: true
---

# Phase 10 Context - Secure Guest Tracking

## Objective

Plan Phase 10 only. Do not implement runtime, do not run tests, do not build,
do not run real migrations, do not deploy, do not call Gelato, do not run real
webhook smoke, do not start refund/exchange/admin ops, and do not start Phase
11.

Phase 10 will later add a secure guest tracking surface for confirmed Orders
using a token that is never stored in plaintext. The public response must be
minimal, sanitized, and derived from already accepted backend state.

## Dependency State

Phase 09 is closed in
`.planning/phases/09-gelato-fulfillment-webhook/09-CLOSURE.md`.

Accepted Phase 09 facts that Phase 10 depends on:

- `GelatoFulfillment` exists as the local aggregate for Gelato dispatch.
- Gelato dispatch is single-active per Order.
- Gelato webhook ingestion updates `GelatoFulfillment.tracking_summary`.
- `tracking_summary` is internal only in Phase 09.
- Phase 09 explicitly did not create a public tracking route.
- Phase 09 explicitly did not create `TrackingAccessToken`.
- Phase 09 did not implement refund, exchange, real Gelato smoke, or migration
  application.

## Requirements

- `TRK-01`: A guest can access order/tracking status via a secure
  `TrackingAccessToken`.
- `TRK-02`: Tracking tokens are stored hashed/encrypted and never in plaintext.

## Locked Scope

Phase 10 future implementation may create only the secure tracking contract
needed for guest read access:

- local `TrackingAccessToken` module/model/service;
- high-entropy token generation;
- server-side token hashing and constant-time comparison;
- expiry and revocation;
- token-gated public lookup route;
- sanitized public tracking response;
- rate limit / replay / enumeration protection;
- tests and negative proofs for the above when execution is separately
  approved.

## Non-Goals

Phase 10 planning and future execution must not introduce:

- refund;
- exchange;
- admin refund/exchange operations;
- automated Correios flow;
- real Gelato call;
- real Gelato webhook smoke;
- Stripe CLI smoke;
- raw payment data exposure;
- tracking by `order_id` alone;
- tracking lookup by e-mail, phone, CPF, CNPJ, or address;
- plaintext tracking token persistence;
- plaintext tracking token in logs, Sentry, metadata, or unintended responses;
- public exposure of full address, full e-mail, phone, CPF/CNPJ, headers,
  secrets, complete Gelato payloads, complete Order payloads, or complete
  payment payloads;
- Phase 11.

## Existing Runtime Patterns To Reuse Later

Use existing project patterns instead of inventing parallel surfaces:

- Medusa module/model/service layout under `apps/backend/src/modules/**`.
- Draft migrations in module-local `migrations/` when real migration execution
  is not approved.
- Route files under `apps/backend/src/api/store/**`.
- Existing correlation/access logging middleware in
  `apps/backend/src/api/middlewares.ts`.
- Existing global redaction helpers in `apps/backend/src/observability/**`.
- Existing `timingSafeEqual` pattern from
  `apps/backend/src/api/hooks/gelato/route.ts`.
- Existing allowlist-style sanitizers from Gelato, webhooks, analytics and
  e-mail modules.
- Existing test style under `apps/backend/src/modules/**/__tests__` and
  `apps/backend/integration-tests/http/**`.

## Planned Public Route Shape

Prefer `POST /store/tracking/lookup` with the token in the JSON body, not in
path or query string. This avoids leaking the token through route paths,
browser history, proxy logs, access logs, Sentry route tags, referrers, and
analytics URLs.

The route must be public but token-gated:

- it must not accept `order_id` without a valid token;
- it must not accept e-mail, phone, CPF/CNPJ, or address lookup;
- it must not return the submitted token;
- it must return indistinguishable unauthorized responses for invalid,
  expired, revoked, unknown, or mismatched tokens;
- it must expose only the minimal safe order/tracking state.

## Manual Gate

This planning cycle stops after the planning artifacts and documentary
validation. Phase 10 execution remains blocked until explicit human approval.
Phase 11 remains blocked.
