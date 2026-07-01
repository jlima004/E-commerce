---
phase: 07
slug: analytics-outbox-purchase-completed
status: planning_manual_gate
created: 2026-07-01
manual_review_gate: true
---

# Phase 07 - Validation Strategy

> Contrato de validacao para `purchase_completed` como outbox local duravel. Esta estrategia deve provar que o evento local e gravado de forma idempotente junto ao nascimento aceito da `Order`, que downstream depende do registro local e que PostHog e assincrono/nao bloqueante.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| Config file | `apps/backend/jest.config.js` |
| Unit command | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts` |
| HTTP command | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "purchase_completed|analytics outbox|PostHog"` |
| Build command | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |

Nenhum comando acima foi executado durante planejamento.

## Required Coverage

| Area | Required proof |
|------|----------------|
| Model contract | `AnalyticsEventLog` tem `event_name`, `event_version`, `idempotency_key`, `order_id`, `payment_attempt_id`, `checkout_completion_log_id`, `payment_intent_id`, `status`, `payload`, retry fields and timestamps. |
| Idempotency | `purchase_completed:stripe:{payment_intent_id}` e deterministico; replay/concurrency geram um evento local. |
| Transactional local gate | `Order` confirmada e `AnalyticsEventLog.recorded` ficam juntos no sucesso aceito; recovery cria evento local faltante para `Order` existente. |
| Payload allowlist | Payload minimo contem somente IDs operacionais, totais BRL, status e resumo de itens sem PII/secrets/raw Stripe/Pix/Gelato/refund. |
| Downstream rule | Helper/gate local aceita existencia de `purchase_completed` local em `recorded|queued|sending|sent|failed|dead_letter`; nao exige `sent`. |
| Relay | PostHog relay processa assincronamente `recorded/failed`, marca `sent` em sucesso e `failed/dead_letter` em falha sem bloquear Order. |
| Failure/retry | Falha PostHog nao reverte `Order`, nao remove o evento local e agenda retry. |
| Scope negatives | Sem Email/Resend, Gelato/fulfillment, refund/exchange, tracking token, Stripe CLI smoke ou migration real aplicada. |

## Per-Plan Verification Map

| Plan | Wave | Requirement | Test Type | Command | Gate |
|------|------|-------------|-----------|---------|------|
| 07-01 | 1 | ANL-01 | unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts` | Review model, idempotency, payload allowlist and migration draft before wiring Order entrypoint. |
| 07-02 | 2 | ANL-01, ANL-02 | unit + HTTP | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "purchase_completed|analytics outbox"` | Review local transactional outbox gate before relay work. |
| 07-03 | 3 | ANL-02, ANL-03 | unit + HTTP/build/greps | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/jobs/__tests__/analytics-posthog-relay.unit.spec.ts src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "PostHog|does not block|purchase_completed"` | Manual gate before Email/Gelato phases; prove PostHog does not block local gate. |

## Negative Proofs Required

For negative `git grep` proofs, interpret exit codes as: `1` = PASS/no matches, `0` = FAIL/matches found, `2` = command/path error.

**Shell note:** Wrap negative greps in `bash -lc '...'`.

No Email, Gelato, fulfillment, refund or tracking in Phase 07 runtime scope:

```bash
bash -lc 'cd apps/backend && git grep -n -E "EmailDeliveryLog|resend|order\\.gelatoapis\\.com|gelato_order_id|create.*Fulfillment|Fulfillment|refund|Refund|ExchangeRequest|TrackingAccessToken|tracking_token" -- src/modules/analytics-event-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

No Store checkout completion/public Order creation path introduced:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\\[id\\]/complete" -- src/api/store; status=$?; test $status -eq 1'
```

Required analytics payload proof. This scan is the blocking payload gate and must cover only the surfaces that can create or send `AnalyticsEventLog.payload`:

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/jobs; status=$?; test $status -eq 1'
```

If analytics-specific tests are created, they may be added to this blocking grep only if they avoid prohibited vocabulary outside explicit negative assertions.

Broad prohibited-payload scan for informational review only. This must not block on `gelato_snapshot` under `src/workflows/order`, because `LineItem.metadata.gelato_snapshot` is legitimate Phase 06 Order-creation behavior. `gelato_snapshot` remains forbidden inside `AnalyticsEventLog.payload` and the relay payload surface covered by the required scan above.

```bash
bash -lc 'cd apps/backend && git grep -n -E "client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|raw_body|payload_raw|Authorization|cookies|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|tracking_token|gelato_snapshot" -- src/modules/analytics-event-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts || true'
```

No real secrets embedded in Phase 07 planning docs:

```bash
bash -lc 'git grep -n -E "whsec_[A-Za-z0-9]{8,}|sk_(test|live)_[A-Za-z0-9]{8,}|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]{8,}|00020126[0-9A-Z]{20,}" -- .planning/phases/07-analytics-outbox-purchase-completed; status=$?; test $status -eq 1'
```

Positive source proof for local outbox and non-PostHog gate:

```bash
cd apps/backend && git grep -n -E "AnalyticsEventLog|analytics_event_log|purchase_completed|recorded|queued|sent|dead_letter|canProceedAfterPurchase|PostHog" -- src/modules/analytics-event-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts
```

## Required Unit Tests

- `buildAnalyticsPurchaseCompletedIdempotencyKey` returns `purchase_completed:stripe:{payment_intent_id}` and rejects missing PI.
- `buildPurchaseCompletedPayload` accepts only required allowlist fields.
- Payload builder rejects or strips `client_secret`, raw Stripe payload, Pix QR/copy-paste, full address, CPF/CNPJ, full email, cookies, auth headers, tracking tokens and Gelato payload.
- `AnalyticsEventLog` statuses are limited to `recorded`, `queued`, `sending`, `sent`, `failed`, `dead_letter`.
- Duplicate `event_name + idempotency_key` resolves as reuse/no-op.
- Duplicate `event_name + order_id` is detected as idempotent reuse or conflict.
- Local downstream helper returns true for any durable local status, including `failed` and `dead_letter`, and false when no local event exists.
- Relay maps payload to PostHog capture without mutating `Order`, `PaymentAttempt` or `CheckoutCompletionLog`.
- Relay transient failure increments attempt count, stores sanitized error and schedules `next_retry_at`.
- Relay success marks `sent` and stores no PostHog secret/token in metadata.

## Required HTTP Integration Tests

- Valid `payment_intent.succeeded` for eligible attempt creates one `Order` and one `purchase_completed` local event.
- Duplicate webhook event does not create a second `Order` or second analytics event.
- Concurrent webhook deliveries create one `Order`, one completed `CheckoutCompletionLog`, one correlated `PaymentAttempt.order_id` and one `AnalyticsEventLog`.
- Recovery path with existing `Order` and missing outbox creates the missing local event idempotently.
- PostHog unavailable does not block `Order` creation once local `AnalyticsEventLog.recorded` exists.
- Downstream gate helper does not require `status = sent`.
- Response/evidence contains no Email/Gelato/refund/tracking side effects.

## Acceptance Criteria

- ANL-01: `purchase_completed` is written transactionally/idempotently to `AnalyticsEventLog` as local outbox on accepted Order creation.
- ANL-02: Downstream depends only on local durable `purchase_completed`, never PostHog success or `status = sent`.
- ANL-03: Relay delivers to PostHog asynchronously with retry/failure state and does not block Order or downstream local gate.
- Existing Phase 06 invariants remain true: no public checkout completion, no Order outside canonical post-webhook internal flow, no missing Gelato snapshots.
- Final `07-03-SUMMARY.md` stops at manual gate before Email/Gelato phases.

## Manual-Only Verifications

| Behavior | Why Manual | Instruction |
|----------|------------|-------------|
| Migration application | Schema changes real DB. | Review generated migration and apply only after explicit human approval. |
| PostHog real smoke | Calls external analytics service. | Do not run during planning or automated execution unless separately approved. |
| Stripe CLI smoke | Requires local Stripe CLI secret and real/test event alignment. | Do not run in Phase 07 planning. |
| Email/Gelato start | Separate phases. | Start only after human acceptance of Phase 07 summary/closure. |

## Sign-Off State

This validation document is planning-only. No tests, migrations, runtime commands, Stripe CLI smoke, PostHog calls, Email, Gelato, fulfillment, refund or tracking work were executed during planning. Execution remains blocked until explicit user approval.
