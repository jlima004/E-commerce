---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 03
subsystem: api
tags: [store-error, StoreErrorResponse, correlation, redaction, isolation]

requires:
  - phase: 13-02
    provides: Fail-closed Store surface guard and DENY matrix (HUMAN APPROVED — PASS)
provides:
  - Closed StoreErrorResponse catalog and normalizer
  - Store-only error handler branch + early DENY envelope rewrite
  - Unit/HTTP proof of correlation, non-enumeration, and Admin/Webhooks isolation
affects:
  - 13-06-storefront-contract-foundation-surface-lockdown
  - 13-07-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - Allowlist-first StoreErrorResponse envelope (code/message/retryable/correlationId)
    - Early guard DENY rewritten via Store envelope middleware without editing guard.ts
    - Store-only createSentryErrorHandler branch; Admin/Webhooks keep Medusa delegation

key-files:
  created:
    - apps/backend/src/api/store-surface/errors.ts
    - apps/backend/src/api/store-surface/__tests__/errors.unit.spec.ts
    - apps/backend/integration-tests/http/store-error-contract.spec.ts
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-03-SUMMARY.md
  modified:
    - apps/backend/src/api/middlewares.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md

key-decisions:
  - "Early DENY conforms to StoreErrorResponse via /store* envelope middleware wrapping res.json; guard.ts untouched"
  - "Auth ownership uses identical public 404 NOT_FOUND shape (non-enumerating)"
  - "retryable=true only for RATE_LIMITED and known SERVICE_UNAVAILABLE without uncertainSideEffect"
  - "FND-03 evidenced only; completion still requires 13-06 and 13-07"

patterns-established:
  - "Store errors never copy err.message/provider/stack into public fields"
  - "Same sanitized correlationId across header, body, log context, and Sentry extra"
  - "Admin/Webhooks remain on existing Medusa error delegation path"

requirements-completed: []
requirements-evidenced: [FND-03]

duration: 5min
completed: 2026-08-08
status: technical-pass-awaiting-human-review
---

# Phase 13 Plan 03: Store Error Contract Summary

**Closed StoreErrorResponse + Store-only normalization eliminate B13-06 at the HTTP boundary; Admin/Webhooks contracts preserved; FND-03 evidenced (not complete).**

## Identity

Plan: 13-03  
Technical implementation: PASS  
13-03: TECHNICAL PASS — AWAITING HUMAN REVIEW  
13-03: NOT YET HUMAN-APPROVED  
13-04: NOT AUTHORIZED  
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
Execution base SHA: `5e8d371db56c46164104998325c71dcb55460a3b`  
Pre-plan HEAD / P13_13_03_PRE_HEAD: `5e8d371db56c46164104998325c71dcb55460a3b`  
Post-technical HEAD: `deba5c39f371fea029ad6f18b3b0804b6fdb37cc`

Post-execution commits:
- `3022943` — test(13-03): define Store error contract regressions
- `3416690` — feat(13-03): implement Store error normalization
- `a7119dd` — test(13-03): add Store error contract HTTP regressions
- `deba5c3` — feat(13-03): integrate Store error handler and envelope
- (this SUMMARY / STATE / ROADMAP docs commit)

## Pre-implementation consistency

| Question | Result |
| --- | --- |
| Early Store guard DENY writer | `guard.ts` `writeDeniedResponse` → `404` + `{ type, message }` direct JSON (bypasses error handler) |
| Universal StoreErrorResponse without `guard.ts` change | YES |
| How | `/store*` `storeErrorEnvelopeMiddleware` wraps `res.json` before guard; DENY body rewritten to `StoreErrorResponse` |
| Allowlist expansion | NONE — `guard.ts` / `manifest.ts` untouched |
| Fail-closed weakened? | NO — still 404, still no `next()`, no second allowlist, no reclassification |

## Store error contract

| Topic | Value |
| --- | --- |
| Envelope fields | `code`, `message`, `retryable`, optional `correlationId`, optional `fieldErrors`, optional `cart` |
| Code catalog | `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED`, `DOMAIN_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` |
| Status families | 400 / 401 / 404 / 409 / 412 / 422 / 429 / 500 / 503 |
| Message semantics | presentation only; stable per public code; never business discriminator |
| Retryable semantics | `true` only for known-safe `RATE_LIMITED` and `SERVICE_UNAVAILABLE` without uncertain side effect |
| fieldErrors | public allowlist only (`STORE_PUBLIC_FIELD_ALLOWLIST`) |
| cart | optional; never materialized by default; no Phase 15 Cart contract |

## Correlation

| Topic | Value |
| --- | --- |
| Allowed pattern | `[A-Za-z0-9._-]{1,128}` |
| Invalid replacement | generated UUID |
| Header/body identity | same sanitized value |
| Log context | `correlation_id` on access/store_error logs |
| Sentry context | `extra.correlation_id` via existing `buildSentryCaptureContext` |

## Security

| Topic | Value |
| --- | --- |
| Auth enumeration | missing/invalid → identical 401 `UNAUTHORIZED` |
| Ownership enumeration | unknown/other-owner → identical 404 `NOT_FOUND` |
| Unknown / provider | sanitized 500/503; no raw message/payload |
| Raw payload / stack | never copied into public envelope |
| Canaries | synthetic Idempotency-Key/JWT/Authorization/cookie/capability/confirmation/CPF/client_secret/Pix/provider/stack/DB — absent from body/headers/Sentry extra |

## Surface isolation

| Surface | Behavior |
| --- | --- |
| Store | always `StoreErrorResponse` for thrown errors + early DENY JSON |
| Admin | existing Medusa delegation preserved (`createSentryErrorHandler` non-Store branch) |
| Webhooks | existing contract preserved; `api-docs-runtime-webhooks-header-override.spec.ts` PASS |
| Sentry global behavior | unchanged SDK/config/scrubber; Store still captures scrubbed context before response |

## 13-02 regression

| Metric | Value |
| --- | ---: |
| Runtime Store ops | 58 |
| AUTHORIZED / EXTENDED / BLOCKED / OUTSIDE_FRONTEND_M1 | 0 / 10 / 17 / 31 (unchanged; guard/manifest not modified) |
| DENY | 51 |
| PRESERVE_LEGACY | 7 |
| M1_ENABLED | 0 |
| UNKNOWN | 0 |
| `/store/custom` | still DENY → 404 StoreErrorResponse |
| `/store/carts/{id}/complete` | still DENY before handler; local override untouched |
| Order from Store | 0 |

## Tests

| Suite | Result |
| --- | --- |
| `errors.unit.spec.ts` | PASS / 21 |
| `store-error-contract.spec.ts` | PASS / 9 |
| `api-docs-runtime-webhooks-header-override.spec.ts` | PASS / 1 |
| additional Admin regression | NOT RUN — no authorized Admin suite path required by PLAN; Admin isolation covered inside `store-error-contract.spec.ts` |
| `git diff --check` | PASS |

## Scope

| Topic | Value |
| --- | --- |
| Technical files modified | `errors.ts`, `middlewares.ts`, `errors.unit.spec.ts`, `store-error-contract.spec.ts` |
| Unexpected technical files | none |
| Package/lockfile | none |
| Migration | none |
| OpenAPI generated | none |
| Provider / Deploy / Frontend | none |

## Requirements

| ID | Evidence in 13-03 | Status |
| --- | --- | --- |
| FND-03 | StoreErrorResponse catalog + HTTP isolation/correlation/redaction proofs | Evidenced only (still needs 13-06 OpenAPI schema + 13-07 canaries gate) |
| B13-06 | Store error contract inadequate | Eliminated at runtime boundary |

`requirements-completed: []` remains true.

## Latent out-of-allowlist note

`integration-tests/http/sentry.spec.ts` includes a Store-path assertion that the Medusa error handler still writes a native-shaped body. That file is outside the 13-03 allowlist and was not modified; PLAN-focused verifies did not run it. Admin/Webhooks isolation for 13-03 is proven in `store-error-contract.spec.ts` instead.

## Governance after technical PASS

```text
13-01: HUMAN APPROVED — PASS
13-02: HUMAN APPROVED — PASS
13-03: TECHNICAL PASS — AWAITING HUMAN REVIEW
13-04..13-07: NOT AUTHORIZED
Plans human-approved executed: 2/7
Phase requirements complete: 0/8
Milestone requirements complete: 0/91
Deploy: NOT AUTHORIZED
Frontend M1: BLOCKED
```

## Task 3 checkpoint

`checkpoint:human-verify` / `gate:blocking`

Human must review public status/code/retryable/correlation matrix and isolation evidence in this SUMMARY before authorizing any further plan.
