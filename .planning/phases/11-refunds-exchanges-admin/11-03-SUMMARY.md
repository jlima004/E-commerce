---
phase: 11-refunds-exchanges-admin
plan: 11-03
status: complete-awaiting-manual-review
executed_at: 2026-07-03
correction_at: 2026-07-03
branch: gsd/phase-11-refunds-exchanges-admin
requirements: [EXC-01, EXC-02]
manual_review_gate: true
---

# 11-03 Summary — ExchangeRequest Admin Workflow and Manual Correios Reverse Logistics

## Scope Executed

Only plan `11-03` was executed, including the **body allowlist hardening correction**. Plans `11-04` and Phase 12 were **not** started.

Operational `ExchangeRequest` Admin create/update workflow for `defect` and `wrong_product`, with manual/semi-automatic Correios reverse-logistics fields. No automatic refund, no financial state mutation, no Order creation, no Gelato dispatch, no Correios API.

## Correction (2026-07-03) — Strict Raw Body Allowlist

Admin create/update routes now validate the **raw JSON body** before building typed inputs:

- `assertExchangeRequestCreateBodyAllowed(body)` — strict allowlist for `POST /admin/exchanges`
- `assertExchangeRequestUpdateBodyAllowed(body)` — strict allowlist for `POST /admin/exchanges/:id`

### Create allowlist (top-level keys)

`order_id`, `reason`, `affected_items`, `customer_visible_note`, `operator_note`, `reverse_logistics_provider`, `reverse_tracking_code`, `reverse_authorization_code`, `reverse_label_reference`, `created_by_operator_id`

### Update allowlist (top-level keys)

`status`, `customer_visible_note`, `operator_note`, `reverse_logistics_provider`, `reverse_tracking_code`, `reverse_authorization_code`, `reverse_label_reference`

### Rejection rules

| Condition | Error code |
|-----------|------------|
| Unknown top-level key | `EXCHANGE_REQUEST_BODY_INVALID` |
| Forbidden top-level key (metadata, payload, raw_body, headers, cookies, refund, payment_status, payment_data, stripe/gelato/correios payloads, client_secret, tracking_token, CPF/CNPJ, email, phone, address keys, etc.) | `EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD` |
| PII/secrets inside notes or affected_items (existing sanitizer) | `EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD` |

Forbidden keys are checked **before** field parsing; update rejects forbidden keys even when paired with a valid `status`.

## Files Changed

| Path | Action |
|------|--------|
| `apps/backend/src/modules/exchange-request/types.ts` | created |
| `apps/backend/src/modules/exchange-request/models/exchange-request.ts` | created |
| `apps/backend/src/modules/exchange-request/migrations/TBD-exchange-request.ts` | created (draft only) |
| `apps/backend/src/modules/exchange-request/service.ts` | created + body allowlist helpers |
| `apps/backend/src/modules/exchange-request/index.ts` | created |
| `apps/backend/src/modules/exchange-request/__tests__/exchange-request.unit.spec.ts` | created + allowlist tests |
| `apps/backend/src/api/admin/exchanges/route.ts` | created — `POST /admin/exchanges` + create body gate |
| `apps/backend/src/api/admin/exchanges/[id]/route.ts` | created — `POST /admin/exchanges/:id` + update body gate |
| `apps/backend/integration-tests/http/admin-exchanges.spec.ts` | created + forbidden top-level HTTP tests |
| `apps/backend/src/config/env.ts` | modified — `ADMIN_EXCHANGE_REQUEST_ENABLED` |
| `apps/backend/medusa-config.ts` | modified — register `exchange_request` module |
| `.planning/phases/11-refunds-exchanges-admin/11-03-SUMMARY.md` | updated |

No other files modified. `package.json` and lockfile have **no diff**.

## ExchangeRequest Contract

### Model fields

- `id` (`excreq` prefix)
- `order_id`
- `reason`: `defect | wrong_product`
- `status` (see vocabulary below)
- `affected_items` — allowlisted structured summary (`line_item_id`, `product_title`, `variant_title`, `quantity`)
- `customer_visible_note`, `operator_note` — sanitized text
- `reverse_logistics_provider`: `correios_manual | other_manual | null`
- `reverse_tracking_code`, `reverse_authorization_code`, `reverse_label_reference`
- `return_received_at`, `resolved_at` — milestone timestamps
- `created_by_operator_id` nullable/safe
- timestamps / soft delete

### Admin routes

- `POST /admin/exchanges` — create exchange (status `opened`); raw body allowlist enforced
- `POST /admin/exchanges/:id` — update status, notes, reverse-logistics fields; raw body allowlist enforced
- Gated by `ADMIN_EXCHANGE_REQUEST_ENABLED` (default `true`)

### Order eligibility

- Target Order must exist with `Order.metadata.order_status = "confirmed"`
- Exchange does **not** read or mutate `payment_status`

## Migration

- Draft: `apps/backend/src/modules/exchange-request/migrations/TBD-exchange-request.ts`
- **Not applied** — no `medusa db:migrate` executed

## Status Vocabulary and Transitions

Full enum: `opened | awaiting_customer_return | return_in_transit | return_received | replacement_review | resolved | rejected | canceled`

| From | Allowed to |
|------|------------|
| `opened` | `awaiting_customer_return`, `rejected`, `canceled` |
| `awaiting_customer_return` | `return_in_transit`, `rejected`, `canceled` |
| `return_in_transit` | `return_received`, `rejected`, `canceled` |
| `return_received` | `replacement_review`, `resolved`, `rejected`, `canceled` |
| `replacement_review` | `resolved`, `rejected`, `canceled` |
| `resolved`, `rejected`, `canceled` | terminal — immutable |

Milestone timestamps:

- `return_received_at` set on first transition to `return_received`
- `resolved_at` set on first transition to `resolved`

Invalid transitions throw `EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID`. Terminal updates throw `EXCHANGE_REQUEST_TERMINAL_STATUS_IMMUTABLE`.

## Manual Correios / Reverse Logistics Fields

Operator-entered only (no API):

- `reverse_logistics_provider`: `correios_manual` or `other_manual`
- `reverse_tracking_code` — whitespace-stripped, max 64
- `reverse_authorization_code` — whitespace-stripped, max 64
- `reverse_label_reference` — sanitized, max 120

Creatable on create; updatable on update without requiring status change.

## Sanitization

Rejections for prohibited payload in notes, affected_items, and **raw request bodies**:

- Raw payload keys (`raw_body`, `payload`, `metadata`, `headers`, `cookies`, payment/Stripe/Gelato/Correios payload keys, `payment_status`, `refund`)
- PII patterns (email, CPF/CNPJ, phone, full address keys)
- Secrets (`sk_*`, `whsec_*`, `pi_*_secret_*`, Bearer tokens, Pix QR patterns)
- External API URL markers (`api.correios.com.br`, `order.gelatoapis.com`)
- Unknown top-level keys on create/update routes

`sanitizeExchangeRequestError` redacts sensitive patterns in error messages.

## Tests and Results

### Unit

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/exchange-request/__tests__/exchange-request.unit.spec.ts
```

**Result: 30/30 PASS**

Covers: defect/wrong_product create, status transitions, invalid transition rejection, terminal immutability, milestone timestamps, Correios field persistence/update, affected_items allowlist, forbidden payload rejection, **raw body allowlist (create/update forbidden + unknown keys)**, negative record shape (no refund/financial fields), service import negative proof.

### HTTP integration

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/admin-exchanges.spec.ts
```

**Result: 13/13 PASS**

Covers: Admin create defect/wrong_product, update status + Correios fields, invalid transition rejection, **create rejects metadata/payload/headers/payment_status/refund top-level**, **update rejects gelato_payload even with valid status**, forbidden operator_note, no RefundRequest side effect, disabled route gate.

## Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

**Result: PASS** (backend build completed successfully)

## Negative Proofs

| Proof | Evidence |
|-------|----------|
| Raw body with headers/cookies/secrets rejected | Unit + HTTP tests (forbidden top-level keys) |
| Raw body with refund/payment_status/payment_data rejected | Unit + HTTP tests |
| Raw body with stripe/gelato/correios payload rejected | Unit + HTTP tests |
| Unknown top-level keys rejected | Unit tests |
| Exchange defect created and managed | Unit + HTTP tests |
| Exchange wrong_product created and managed | Unit + HTTP tests |
| Invalid transitions rejected | Unit + HTTP tests |
| Manual Correios fields stored/updated | Unit + HTTP tests |
| Exchange does not create RefundRequest | Record shape + harness tests; service has no refund imports |
| Exchange does not alter `payment_status` | Order metadata unchanged in HTTP test; no field on model |
| Exchange does not alter `order_status` automatically | No order update path in routes/service |
| Exchange does not create Order | No order create in module/routes |
| Exchange does not call Stripe real | No Stripe imports/calls in scope files |
| Exchange does not call Gelato | No Gelato imports/calls; forbidden URL pattern only in sanitizer |
| Exchange does not dispatch Gelato replacement | No fulfillment/dispatch code |
| Exchange does not call Correios API | No fetch/axios; forbidden URL in sanitizer only |
| No broad OperationalAlert | Grep clean in service (test asserts) |
| No broad AdminActionLog | Grep clean in service (test asserts) |
| Phase 12 not started | No Phase 12 planning directory |
| 11-04 not started | No `11-04-SUMMARY.md` |
| `package.json` / lockfile unchanged | `git diff` empty for those paths |
| `git diff --check` | PASS |

## Out of Scope Confirmation

- Plan `11-04` **not** executed
- Phase 12 **not** started
- No real migration, deploy, Stripe, Gelato, Correios API, Stripe CLI smoke

## Manual Gate

Execution stops here for human review of plan `11-03` (including body allowlist correction) before any `11-04` work.
