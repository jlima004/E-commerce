---
phase: 10-secure-guest-tracking
status: planned
created_at: 2026-07-02
research_type: repo-and-security-patterns
---

# Phase 10 Research - Secure Guest Tracking

## Research Boundary

This research is documentary and repo-derived. It does not implement runtime,
does not run tests, does not run build, does not run migrations, does not call
external providers, and does not start Phase 11.

## Current State

Phase 09 delivered internal Gelato status/tracking only:

- `GelatoFulfillment.tracking_summary` stores local status-level tracking
  summary.
- Gelato webhook payloads containing `trackingCode` / `trackingUrl` are
  sanitized before persistence.
- Phase 09 negative proofs confirmed no public tracking route and no
  `TrackingAccessToken`.

The current backend already contains useful patterns:

- `apps/backend/src/api/hooks/gelato/route.ts` uses `timingSafeEqual` for
  constant-time secret comparison.
- `apps/backend/src/observability/sanitize.ts` strips forbidden context keys
  and redacts secrets/tokens from string values.
- `apps/backend/src/api/middlewares.ts` logs route templates and sanitized
  access metadata, not request bodies.
- Gelato/e-mail/analytics/webhook modules use allowlist-first metadata and
  error sanitizers.

## Security Decision: Token Transport

Do not plan a route such as `/store/tracking/:token`.

Even if app access logs use route templates, tokens in path or query can leak
through browser history, proxy logs, referrer headers, screenshots, analytics,
and third-party tooling. The safer backend contract is:

- `POST /store/tracking/lookup`;
- token submitted in JSON body as `token`;
- body never logged or copied to Sentry;
- response never echoes the token.

The future storefront can still receive a link that lands client-side and
submits the token to this route, but the backend should not require token in
URL.

## Security Decision: Hashing

Use high-entropy random tokens and persist only a keyed hash:

- generate with `crypto.randomBytes` using at least 32 bytes;
- encode with base64url or equivalent URL-safe alphabet;
- compute `HMAC-SHA256(TRACKING_TOKEN_PEPPER, token)`;
- persist `token_hash`, never plaintext token;
- require `TRACKING_TOKEN_PEPPER` in non-test production-like runtime;
- compare candidate hash to stored hash using `timingSafeEqual`.

Because the raw token is high entropy, a plain SHA-256 hash would resist online
guessing, but an HMAC pepper reduces impact if the database alone leaks.

The plaintext token may exist only transiently:

- in memory during creation;
- in the intended one-time return from the minting helper to the caller that
  will deliver the tracking access to the customer;
- in tests that explicitly assert it is not persisted or logged.

It must not be persisted in DB, metadata, logs, Sentry, WebhookEventLog,
EmailDeliveryLog, GelatoFulfillment, AnalyticsEventLog, Order metadata, or
public tracking responses.

## Security Decision: Lookup Semantics

Public lookup must be token-first and server-side:

- compute hash from submitted token;
- search by hash;
- constant-time compare stored hash vs candidate hash;
- reject if `expires_at <= now`;
- reject if `revoked_at` is set;
- reject if token is not active for the resolved Order/Gelato fulfillment;
- return the same public error shape for invalid, unknown, expired, revoked,
  and rate-limited cases where possible.

Do not support:

- `GET /store/orders/:order_id/tracking`;
- `GET /store/tracking/:order_id`;
- lookup by e-mail;
- lookup by phone;
- lookup by CPF/CNPJ;
- lookup by cart id;
- lookup by payment id.

## Response Shape

The public response should be intentionally small. Planned safe fields:

- stable public order reference, if one exists and is not the raw internal
  `order_id`;
- order/tracking status enum;
- fulfillment status enum;
- delivery/tracking status summary;
- item count or line-level safe labels only if already public catalog data;
- `updated_at`;
- support-safe message such as "tracking not available yet".

Prohibited response fields:

- full e-mail;
- phone;
- CPF/CNPJ;
- full address or address lines;
- payment data;
- card/Pix details;
- Stripe IDs unless already public-safe and necessary;
- `client_secret`;
- raw Order payload;
- raw Gelato payload;
- `trackingCode`;
- `trackingUrl`;
- submitted token;
- token hash;
- headers;
- cookies;
- secrets.

If a carrier URL/code is required later, it must be introduced through a
separate explicit decision because the Phase 09 contract deliberately kept
provider tracking details internal.

## Rate Limit / Enumeration Protection

The tracking route is public and must resist enumeration. Future execution
should add a rate-limit layer before or around token lookup:

- key by a non-PII server-side bucket such as HMAC of client IP + summarized
  user agent + time window;
- never persist raw IP or full user agent;
- limit repeated invalid token attempts;
- optionally apply per-token failure counters when a token row exists;
- avoid responses that reveal whether a token exists, expired, or was revoked;
- keep lockout metadata sanitized.

For a multi-dyno production target, a DB-backed or Redis-backed bucket is safer
than in-memory-only state. If the implementation needs a persistent
`TrackingAccessRateLimit` model, it belongs inside the Phase 10 tracking
module and remains in the same phase.

## Chosen Decomposition

Plan 10-01 creates the local token contract: model, hashing, expiry,
revocation, and sanitized helpers.

Plan 10-02 creates the public token-gated route and safe response serializer.

Plan 10-03 adds rate-limit/enumeration hardening and final validation/negative
proofs.

All slices remain manual-review-gated. No Phase 11 work is included.
