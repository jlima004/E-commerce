---
phase: 08-transactional-email-resend
summary_type: post-merge-hardening
status: complete
origin: "PR #1 / Copilot review"
created_at: "2026-07-01T23:47:00-03:00"
manual_gate: true
phase_09_executed: false
---

# Phase 08 Hardening Summary

## Origin

This hardening addresses the three post-merge review points raised on PR #1 / Copilot review before any Phase 09 slice.

## Files Changed

- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts`
- `apps/backend/src/jobs/email-resend-relay.ts`
- `apps/backend/src/jobs/__tests__/email-resend-relay.unit.spec.ts`
- `apps/backend/src/modules/email-delivery-log/service.ts`
- `apps/backend/src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts`
- `.planning/STATE.md`
- `.planning/phases/08-transactional-email-resend/08-HARDENING-SUMMARY.md`

## Corrections

1. Fixed-id create risk removed.
   - `createEmailDeliveryLogs` now receives create input without `id`, `created_at`, `updated_at`, or `deleted_at`.
   - The module/model can generate the primary key.
   - Duplicate-key failures without a reusable existing `EmailDeliveryLog` are rethrown instead of becoming silent success.

2. Missing SKU fallback added.
   - Order confirmation item SKU now resolves through `variant.sku`, `variant.id`, `variant_id`, then `line_item.id`.
   - Missing `variant.sku` no longer blocks Order completion, durable `purchase_completed`, or local `EmailDeliveryLog` enqueue when a stable fallback exists.
   - The persisted allowlist field remains `items[].sku`.

3. Stale in-flight recovery added to the Resend relay.
   - `recorded` and `failed` remain eligible only when due.
   - `queued` and `sending` are eligible only when stale by `queued_at`, `sending_started_at`, or `updated_at`.
   - The cutoff is `EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS = 15 * 60 * 1000`.
   - `sent` and `dead_letter` are never reprocessed.
   - Retry sends still use `idempotencyKey = order-confirmation/{order_id}`.

## Verification

Requested npm command was attempted first but the local PATH resolved `npm` to the Windows shim and failed before tests started:

```text
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
```

Equivalent commands were run with the local Linux Node runtime at `/home/jlima/node`.

Unit tests:

```bash
env TMPDIR=/tmp TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules /home/jlima/node ../../node_modules/jest/bin/jest.js --silent --runInBand --forceExit --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts src/jobs/__tests__/email-resend-relay.unit.spec.ts
```

Result: PASS — 3 suites, 48 tests.

Filtered HTTP integration:

```bash
env TMPDIR=/tmp TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules /home/jlima/node ../../node_modules/jest/bin/jest.js --silent=false --runInBand --forceExit --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|EmailDeliveryLog|Resend|does not block"
```

Result: PASS — 1 suite, 4 filtered tests.

Build:

```bash
env HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true /home/jlima/node ../../node_modules/@medusajs/cli/cli.js build
```

Result: PASS — backend build completed successfully.

Negative greps:

```bash
bash -lc 'cd apps/backend && git grep -n "emlog_order_entrypoint_pending" -- src/workflows/order src/jobs src/modules/email-delivery-log; status=$?; test $status -eq 1'
```

Result: PASS.

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|/hooks/gelato|gelato_order_id|TrackingAccessToken|tracking_token|refund|Refund|ExchangeRequest|stripe listen|stripe trigger" -- src/workflows/order src/jobs src/modules/email-delivery-log integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Result: PASS.

Whitespace:

```bash
git diff --check
```

Result: PASS.

## Non-Actions Confirmed

- Phase 09 was not executed.
- No Resend real call was made.
- No real e-mail was sent.
- No Gelato call was made.
- No tracking implementation was added.
- No refund implementation was added.
- No exchange implementation was added.
- No Stripe CLI smoke was executed.
- No real migration was applied.
- `medusa-config.ts`, `package.json`, and lockfile were not changed.

## Gate

Stop here at the manual gate. Phase 09 remains blocked until explicit human approval in a separate manual-review-gated cycle.
