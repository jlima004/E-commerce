---
phase: 10-secure-guest-tracking
status: planned
created_at: 2026-07-02
validation_scope: planned-for-future-execution
documentary_validation_this_cycle: git-diff-check-only
---

# Phase 10 Validation Plan

## Boundary For This Planning Cycle

Run only:

```bash
git diff --check
```

Do not run Jest, integration tests, build, migrations, deploy, real Gelato,
real webhook smoke, refund, exchange, or Phase 11 work during this planning
cycle.

## Future Execution Validation Matrix

When Phase 10 execution is separately approved, validation must prove each
criterion below.

### Token Storage

- Plaintext token is never persisted.
- DB rows contain only `token_hash`, `expires_at`, `revoked_at`, status and
  safe audit timestamps.
- `token_hash` is a keyed HMAC or equivalent non-plaintext digest.
- No plaintext token appears in `Order.metadata`, `GelatoFulfillment`,
  `WebhookEventLog`, `EmailDeliveryLog`, `AnalyticsEventLog`, logs, Sentry or
  public responses.

### Token Verification

- Valid token returns the sanitized public tracking response.
- Invalid token is rejected.
- Unknown token is rejected.
- Expired token is rejected.
- Revoked token is rejected.
- Malformed token is rejected.
- Hash comparison uses constant-time server-side comparison.
- Failure response does not reveal whether the token existed, expired, or was
  revoked.

### Query Boundary

- `order_id` without token does not work.
- `cart_id` without token does not work.
- payment IDs without token do not work.
- e-mail lookup does not work.
- phone lookup does not work.
- CPF/CNPJ lookup does not work.
- address lookup does not work.
- GET route with token in path/query is not introduced unless separately
  approved.

### Public Response Sanitization

The public response must not contain:

- full address;
- address lines;
- full e-mail;
- phone;
- CPF;
- CNPJ;
- payment data;
- Stripe `client_secret`;
- Pix QR/copia-e-cola;
- raw Stripe payload;
- raw Gelato payload;
- raw Order payload;
- request headers;
- cookies;
- secrets;
- plaintext token;
- token hash;
- `trackingCode`;
- `trackingUrl`.

Allowed response fields must remain minimal and documented, such as status,
safe public order reference, item count, tracking status summary, and
`updated_at`.

### Rate Limit / Enumeration

- Repeated invalid lookups are rate-limited.
- Repeated malformed lookups are rate-limited.
- Rate-limit bucket does not persist raw IP or full user-agent.
- Rate-limit response does not disclose token existence.
- Rate-limit logic runs before expensive or revealing lookup work where
  practical.
- Enumeration attempts cannot distinguish invalid vs expired vs revoked vs
  unknown tokens through response body.

### Observability

- Access logs do not include token values.
- Sentry context/tags/extras do not include token values.
- Expected invalid-token/rate-limit failures are not captured as high-cardinality
  Sentry events.
- Error messages are sanitized before persistence/logging.
- `correlation_id` may be logged; token/order sensitive fields must not.

### Scope Negatives

- No refund implementation.
- No exchange implementation.
- No admin refund/exchange operations.
- No real Gelato call.
- No real Gelato webhook smoke.
- No Stripe CLI smoke.
- No migration real applied unless a separate execution/deployment gate
  approves it.
- No Phase 11 start.

### Config And Module Registration Build Gate

Any Phase 10 slice that changes environment contracts, `medusa-config.ts`, or
Medusa module registration must run a build inside that same slice, using the
slice-approved build command. This is required even when the slice also has
focused unit or HTTP tests, because config/module registration failures may not
be covered by targeted tests.

## Planned Proof Commands

These commands are for future execution, not for this planning-only cycle.

```bash
# Future targeted unit tests
cd apps/backend && npx jest --runInBand src/modules/tracking-access-token

# Future HTTP integration tests
cd apps/backend && npx jest --runInBand integration-tests/http/tracking-access-token.spec.ts

# Future build, only when execution is approved and required by slice scope
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build

# Future negative grep examples
git grep -n -E "tracking_token|TrackingAccessToken|/store/tracking/:|order_id.*tracking|email.*tracking|phone.*tracking|cpf.*tracking|cnpj.*tracking|refund|Refund|ExchangeRequest" -- apps/backend/src apps/backend/integration-tests/http
```

The future final validation slice must document false positives explicitly and
separate blocking runtime-surface greps from broad informational greps.
