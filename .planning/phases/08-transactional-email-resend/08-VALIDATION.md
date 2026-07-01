---
phase: 08
slug: transactional-email-resend
status: planning_manual_gate
created: 2026-07-01
manual_review_gate: true
---

# Phase 08 - Validation Strategy

> Contrato de validacao para e-mail transacional via Resend depois de `Order` confirmada e depois de `purchase_completed` local duravel. Esta estrategia deve provar idempotencia, auditoria, ausencia de dados proibidos, Resend nao bloqueante para `Order`, e nenhuma chamada Gelato/fulfillment/refund/tracking/Stripe CLI.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0 |
| Config file | `apps/backend/jest.config.js` |
| Unit command | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts src/jobs/__tests__/email-resend-relay.unit.spec.ts` |
| HTTP command | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|EmailDeliveryLog|Resend|purchase_completed"` |
| Build command | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |

Nenhum comando acima foi executado durante planejamento.

## Required Coverage

| Area | Required proof |
|------|----------------|
| Model contract | `EmailDeliveryLog` tem `email_type`, `template_key`, `template_version`, `provider`, `idempotency_key`, `order_id`, referencias a Phase 06/07, status, payload allowlist, retry fields and timestamps. |
| Runtime module registration | `EmailDeliveryLog` e registrado no runtime real do Medusa em `apps/backend/medusa-config.ts` com `key: "email_delivery_log"` e `resolve: "./src/modules/email-delivery-log"` ou forma equivalente real do projeto mantendo a key sem hifen. |
| Idempotency | `order-confirmation/{order_id}` e deterministico; replay/concurrency geram um registro local e uma chamada Resend idempotente. |
| Local enqueue | Registro local e criado somente depois de `Order` confirmada e `purchase_completed` local duravel. |
| Module unavailable fail-closed | `EmailDeliveryLog` ausente ou mal configurado gera erro estavel/sanitizado, nao considera o webhook/order entrypoint completamente processado, nao chama Resend, nao inicia Gelato e permite retry/recovery posterior. |
| Customer email source | Relay usa somente `Order.email`; nao usa Stripe payload, request body, cookies, session ou headers. |
| Payload allowlist | Template usa somente variaveis permitidas e nao persiste e-mail completo ou dados proibidos. |
| Resend relay | Relay processa assincronamente `recorded/failed`, marca `sent` em sucesso e `failed/dead_letter` em falha sem bloquear `Order`. |
| Gelato boundary | Phase 08 nao chama Gelato; contrato registra que Phase 09 deve esperar e-mail enviado antes do dispatch automatico. |
| Scope negatives | Sem Gelato/fulfillment, refund/exchange, tracking token, Stripe CLI smoke, PostHog real ou migration real aplicada. |

## Per-Plan Verification Map

| Plan | Wave | Requirement | Test Type | Command | Gate |
|------|------|-------------|-----------|---------|------|
| 08-01 | 1 | EMAIL-02 | unit/source | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts` | Review model, idempotency, payload/template allowlist and migration draft before wiring Order entrypoint. |
| 08-02 | 2 | EMAIL-01, EMAIL-02 | unit + HTTP + build | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|EmailDeliveryLog|purchase_completed" && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` | Review local enqueue after `purchase_completed`, real `medusa-config.ts` module registration and fail-closed behavior before any Resend relay. |
| 08-03 | 3 | EMAIL-01, EMAIL-02 | unit + HTTP/build/greps | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts src/jobs/__tests__/email-resend-relay.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/stripe-webhook-order-creation.spec.ts -t "email|Resend|does not block"` | Manual gate before Phase 09; prove Resend does not validate Order and no Gelato starts. |

## Negative Proofs Required

For negative `git grep` proofs, interpret exit codes as: `1` = PASS/no matches, `0` = FAIL/matches found, `2` = command/path error.

**Shell note:** Wrap negative greps in `bash -lc '...'`.

No Gelato, fulfillment, refund, exchange, tracking or Stripe CLI in Phase 08 runtime scope:

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|gelato_order_id|create.*Fulfillment|Fulfillment|fulfillment|refund|Refund|ExchangeRequest|TrackingAccessToken|tracking_token|stripe listen|stripe trigger" -- src/modules/email-delivery-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

No real external smoke/calls in tests or planning docs:

```bash
bash -lc 'git grep -n -E "RESEND_API_KEY=.*re_|resend\\.emails\\.send\\(.*real|posthog\\.capture\\(.*real|order\\.gelatoapis\\.com|stripe listen|stripe trigger|whsec_|sk_test_|sk_live_|pi_[A-Za-z0-9_]+_secret_|00020126[0-9A-Z]{20,}" -- .planning/phases/08-transactional-email-resend apps/backend/src/modules/email-delivery-log apps/backend/src/jobs apps/backend/src/workflows/order/__tests__ integration-tests/http/stripe-webhook-order-creation.spec.ts; status=$?; test $status -eq 1'
```

Required email payload proof. This scan is the blocking payload gate and must cover only the surfaces that can create or send `EmailDeliveryLog.payload`:

```bash
bash -lc 'cd apps/backend && git grep -n -E "Authorization|Bearer|cookies|session_id|raw_body|payload_raw|client_secret|pi_[A-Za-z0-9_]+_secret_|pix_display_qr_code|copy_paste|hosted_instructions_url|federal_tax_id|cpf|cnpj|shipping_address|billing_address|full_address|phone|telephone|tracking_token|gelato_snapshot|gelato_order_id|refund|ExchangeRequest" -- src/modules/email-delivery-log src/jobs; status=$?; test $status -eq 1'
```

No full customer email persisted in `EmailDeliveryLog` surfaces. Tests may include explicit negative examples only if they are isolated and asserted as rejected:

```bash
bash -lc 'cd apps/backend && git grep -n -E "\"recipient_email\"|'\''recipient_email'\''|customer_email|to_email|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" -- src/modules/email-delivery-log src/jobs; status=$?; test $status -eq 1'
```

No Store checkout completion/public Order creation path introduced:

```bash
bash -lc 'cd apps/backend && git grep -n -E "POST.*/store/carts/.*/complete|/store/carts/\\[id\\]/complete" -- src/api/store; status=$?; test $status -eq 1'
```

Positive source proof for local email log and Resend relay only:

```bash
cd apps/backend && git grep -n -E "EmailDeliveryLog|email_delivery_log|order-confirmation|order_confirmation|Resend|resend|recorded|queued|sent|dead_letter" -- src/modules/email-delivery-log src/workflows/order src/jobs integration-tests/http/stripe-webhook-order-creation.spec.ts
```

## Required Unit Tests

- `buildOrderConfirmationEmailIdempotencyKey` returns `order-confirmation/{order_id}` and rejects missing order id.
- `buildOrderConfirmationEmailPayload` accepts only template variables allowed in `08-CONTEXT.md`.
- Payload builder rejects or strips full email, Authorization, cookies, raw Stripe payload, Pix QR/copy-paste, full address, CPF/CNPJ, phone, tracking tokens, Gelato data and refund data.
- `EmailDeliveryLog` statuses are limited to `recorded`, `queued`, `sending`, `sent`, `failed`, `dead_letter`.
- Duplicate `email_type + idempotency_key` resolves as reuse/no-op.
- Duplicate `email_type + order_id` is detected as idempotent reuse or conflict.
- Local enqueue returns/reuses existing log under replay/concurrency.
- `EmailDeliveryLog module missing or misconfigured -> no silent success`: does not call Resend, does not start Gelato, does not return enqueue success, returns stable/sanitized error, and if validation happens before `completeCartWorkflow`, does not call `completeCartWorkflow`.
- Relay resolves recipient only from `Order.email`.
- Relay does not persist full recipient email in `EmailDeliveryLog`.
- Relay transient failure increments attempt count, stores sanitized error and schedules `next_retry_at`.
- Relay success marks `sent` and stores only provider message id, never API key or Authorization header.
- `dead_letter` does not invalidate `Order`, but does not satisfy automatic Gelato eligibility.

## Required HTTP Integration Tests

- Valid `payment_intent.succeeded` for eligible attempt creates one `Order`, one `purchase_completed` local event and one `EmailDeliveryLog`.
- Duplicate webhook event does not create a second `Order`, analytics event or email log.
- Concurrent webhook deliveries create one `Order`, one completed `CheckoutCompletionLog`, one correlated `PaymentAttempt.order_id`, one `AnalyticsEventLog` and one `EmailDeliveryLog`.
- Recovery path with existing `Order` + `purchase_completed` and missing e-mail log creates the missing local email log idempotently.
- Recovery path with existing `Order` + `purchase_completed` + missing email log + unavailable/misconfigured `EmailDeliveryLog` module fails stably without silent success.
- Resend unavailable does not block `Order` creation once local `EmailDeliveryLog` is recorded.
- Missing/invalid `Order.email` does not call Resend and records sanitized failure state.
- Response/evidence contains no Gelato, fulfillment, refund, exchange, tracking or Stripe CLI side effects.

## Acceptance Criteria

- EMAIL-01: Confirmation email is sent via Resend only after confirmed `Order` and durable local `purchase_completed`, and before any future automatic Gelato attempt.
- EMAIL-02: Every confirmation email attempt is recorded in `EmailDeliveryLog` with idempotency, status, retry/dead-letter fields and sanitized audit data.
- Existing Phase 06 and Phase 07 invariants remain true: no public checkout completion, no `Order` outside canonical post-webhook internal flow, no downstream dependency on PostHog success.
- Resend success is not required to validate `Order`.
- `EmailDeliveryLog` module absence/misconfiguration is never treated as successful local enqueue and never starts Resend or Gelato.
- Final `08-03-SUMMARY.md` stops at manual gate before Phase 09.

## Manual-Only Verifications

| Behavior | Why Manual | Instruction |
|----------|------------|-------------|
| Dependency install | Alters package and lockfile. | Do not install during planning; add only inside approved `08-03` execution. |
| Migration application | Schema changes real DB. | Review generated migration and apply only after explicit human approval. |
| Resend real smoke | Sends or attempts external email. | Do not run during planning or automated execution unless separately approved. |
| Stripe CLI smoke | Requires local Stripe CLI secret and real/test event alignment. | Do not run in Phase 08 planning. |
| Gelato start | Separate Phase 09. | Start only after human acceptance of Phase 08 summary/closure and explicit Phase 09 approval. |

## Sign-Off State

This validation document is planning-only. No tests, migrations, runtime commands, installs, Stripe CLI smoke, PostHog calls, Resend calls, real e-mail, Gelato, fulfillment, refund, exchange or tracking work were executed during planning. Execution remains blocked until explicit user approval.
