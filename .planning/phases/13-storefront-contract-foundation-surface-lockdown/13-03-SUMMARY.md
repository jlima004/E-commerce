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
    - apps/backend/integration-tests/http/sentry.spec.ts
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
status: r1-correction-complete-awaiting-human-re-review
---

# Phase 13 Plan 03: Store Error Contract Summary

**Closed StoreErrorResponse + Store-only normalization eliminate B13-06 at the HTTP boundary; Admin/Webhooks contracts preserved; FND-03 evidenced (not complete).**

## Identity

Plan: 13-03
Technical implementation: PASS (initial) → HUMAN REVIEW R1 REQUIRED → R1 CORRECTION COMPLETE
13-03: R1 CORRECTION COMPLETE — AWAITING HUMAN RE-REVIEW
13-03: NOT YET HUMAN-APPROVED
13-04: NOT AUTHORIZED
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`
Execution base SHA: `5e8d371db56c46164104998325c71dcb55460a3b`
Pre-plan HEAD / P13_13_03_PRE_HEAD: `5e8d371db56c46164104998325c71dcb55460a3b`
Post-technical HEAD (initial 13-03): `deba5c39f371fea029ad6f18b3b0804b6fdb37cc`
Pre-R1 HEAD: `118fdd3bc9259b12b19b058b8a4711fcc6f898e3`
Post-R1 technical HEAD: `389e0e9f830526520bf61da25af6db3da47e4712`
Post-R1 final/documentary HEAD: `30478cb5776a36c51bb898ed2da81a7280ec7025`

Post-execution commits (initial technical PASS — preserved history):
- `3022943` — test(13-03): define Store error contract regressions
- `3416690` — feat(13-03): implement Store error normalization
- `a7119dd` — test(13-03): add Store error contract HTTP regressions
- `deba5c3` — feat(13-03): integrate Store error handler and envelope
- `118fdd3` — docs(13-03): complete Store Error Contract plan (awaiting human review)

Human review returned `P13-13-03 HUMAN REVIEW: R1 REQUIRED` (core architecture ACCEPTED; 5 blockers / 2 warnings).

R1 commits:
- `389e0e9` — fix(13-03): harden Store error contract fail-closed behavior
- `30478cb` — docs(13-03): record R1 human review corrections

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
| Envelope fields | `code`, `message`, `retryable`, optional `correlationId`, optional `fieldErrors` (cart never public in R1) |
| Code catalog | `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED`, `DOMAIN_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` |
| Status families | 400 / 401 / 404 / 409 / 412 / 422 / 429 / 500 / 503 |
| Message semantics | presentation only; stable per public code; never business discriminator |
| Retryable semantics | `true` only for known-safe `RATE_LIMITED` / known `SERVICE_UNAVAILABLE` without `uncertainSideEffect`; generic 503 → false |
| fieldErrors | public allowlist keys + closed value `Invalid value` (never echo raw input) |
| cart | fail-closed omit for unknown/arbitrary input; no Phase 15 Cart DTO |

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

## Tests — initial technical PASS (historical)

The following results are preserved as the pre-R1 technical PASS snapshot and are superseded by the final R1 regression matrix below.

| Suite | Result |
| --- | --- |
| `errors.unit.spec.ts` | PASS / 21 |
| `store-error-contract.spec.ts` | PASS / 9 |
| `api-docs-runtime-webhooks-header-override.spec.ts` | PASS / 1 |
| additional Admin regression | NOT RUN — no authorized Admin suite path required by PLAN; Admin isolation covered inside `store-error-contract.spec.ts` |
| `git diff --check` | PASS |

## Scope — initial technical PASS (historical)

The following scope snapshot is preserved as pre-R1 history. The accepted R1 expansion added `sentry.spec.ts`; see **Files modified (R1)** below.

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

## Latent out-of-allowlist note (historical — closed by R1)

Initial technical PASS recorded that `integration-tests/http/sentry.spec.ts` still expected a Medusa-shaped Store body and was outside the original 13-03 allowlist. Human review R1 authorized updating that obsolete Store expectation and closing the Sentry sink proof. See **P13-13-03-R1 Human Review Corrections** below.

## Governance after initial technical PASS (historical)

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

Human review returned: `P13-13-03 HUMAN REVIEW: R1 REQUIRED` — 13-03 NOT HUMAN-APPROVED; 13-04 NOT AUTHORIZED.

## P13-13-03-R1 Human Review Corrections

Pre-R1 HEAD: `118fdd3bc9259b12b19b058b8a4711fcc6f898e3`
Architecture preserved: correlation → Store error envelope → Store Surface Guard → handlers; `guard.ts` untouched; no allowlist/manifest/Order-birth/Admin/Webhook/OpenAPI changes.

### Findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B13-03-R1-01 — Pre-shaped envelope bypass | CLOSED | `attachStoreErrorEnvelope` / `toStoreErrorResponse` always rebuild; no `isStoreErrorResponse` passthrough; `code: StoreErrorCode` closed catalog; malicious `{ code:"ANY_INTERNAL_CODE", message:"client_secret=...", retryable:true }` rebuilt to `INTERNAL_ERROR` + safe message + `retryable:false` + no extras |
| B13-03-R1-02 — fieldErrors value leakage | CLOSED | Allowlisted keys keep names; values always `STORE_PUBLIC_FIELD_ERROR_MESSAGE` (`"Invalid value"`); canaries in email/password/postal_code/shipping_address absent from JSON |
| B13-03-R1-03 — unsafe cart | CLOSED | `options.cart` ignored; arbitrary cart with client_secret/CPF/auth/provider/capability omitted from public body |
| B13-03-R1-04 — retryable certainty | CLOSED | 429 safe→true; 429+uncertainSideEffect→false; known SERVICE_UNAVAILABLE safe→true; known+uncertain→false; generic 503→false; provider/500→false |
| B13-03-R1-05 — Sentry regression/sink proof | CLOSED | See pre/post results below |
| W13-03-R1-01 — middleware order | CLOSED | `/store*` index0=`storeErrorEnvelopeMiddleware`, index1=`storeSurfaceGuardMiddleware` (non-tautological identity checks) |
| W13-03-R1-02 — Store prefix boundary | CLOSED | `isCanonicalStoreRequestPath` / `isStoreApiRequest`: `/store` and `/store/...` true; `/storefront`, `/store-admin`, `/storeXYZ`, `/admin/store`, `/hooks/store` false |

### Final contract policies (R1)

- **codes:** closed `STORE_ERROR_CODES` only (`StoreErrorCode`, not `string`)
- **fieldErrors:** allowlisted keys + `"Invalid value"` only
- **cart:** omit unknown/unsafe (Phase 15 DTO not introduced)
- **retryable:** known-safe category ∧ certain safe retry ∧ `uncertainSideEffect !== true`
- **correlation:** `[A-Za-z0-9._-]{1,128}`; invalid → UUID; same value in header/body/log/Sentry extra

### Prefix / matcher fact

Medusa route matcher `/store*` may still mount envelope+guard for adjacent prefixes. Guard path normalization (untouched) remains fail-closed SSOT for surface DENY. Error-handler Store branch now uses the strict `/store` + `/store/` boundary only.

### B13-03-R1-05 Sentry

| Step | Result |
| --- | --- |
| Pre-R1 `sentry.spec.ts` | FAIL — 1 failed / 12 passed / 13 total. Sole failure: Store-path test `captura uma unica vez...` → `TypeError: res.setHeader is not a function` because Store branch now writes StoreErrorResponse (obsolete Medusa-body expectation). No Admin/Webhook/scrub/security failure beyond that obsolete Store expectation. |
| Change | Updated obsolete Store expectation to `StoreErrorResponse`; added Admin Medusa-preservation test; extended mock with `setHeader`; added sink proof via `sanitizeError(captureException[0])` + `scrubEvent(...)` (project `beforeSend` path) proving canaries absent from sanitized sink — not merely `extra.correlation_id`. |
| Post-R1 `sentry.spec.ts` | PASS / 14 |

### Tests executed (R1)

| Suite | Result |
| --- | --- |
| `errors.unit.spec.ts` | PASS / 25 |
| `store-error-contract.spec.ts` | PASS / 10 |
| `sentry.spec.ts` | PASS / 14 |
| `api-docs-runtime-webhooks-header-override.spec.ts` | PASS / 1 |
| `store-surface-lockdown.spec.ts` | PASS / 8 (DENY 51 preserved) |
| `guard.unit.spec.ts` | PASS / 15 |
| `git diff --check` | PASS |

### 13-02 invariants (revalidated)

Runtime 58 / Native 51 / Local 7; AUTHORIZED 0 / EXTENDED 10 / BLOCKED 17 / OUTSIDE_FRONTEND_M1 31; DENY 51 / PRESERVE_LEGACY 7 / M1_ENABLED 0 / UNKNOWN 0; `/store/custom` DENY; complete DENY; completeCartWorkflow 0; Store Order creation 0.

### Files modified (R1)

Technical: `errors.ts`, `middlewares.ts`, `errors.unit.spec.ts`, `store-error-contract.spec.ts`, `sentry.spec.ts`
Docs: `13-03-SUMMARY.md`, `STATE.md`, `ROADMAP.md`
Unexpected / package / lock / migrations / OpenAPI: NONE

### Governance after R1

```text
13-01: HUMAN APPROVED — PASS
13-02: HUMAN APPROVED — PASS
13-03: R1 CORRECTION COMPLETE — AWAITING HUMAN RE-REVIEW
13-04: NOT AUTHORIZED
13-05..13-07: NOT AUTHORIZED
Plans human-approved executed: 2/7
Phase requirements covered: 8/8
Phase requirements complete: 0/8
Milestone requirements complete: 0/91
Deploy: NOT AUTHORIZED
Frontend M1: BLOCKED
```

## P13-13-03-R2 Documentary Reconciliation

Documentary-only synchronization after the technical human re-review of R1. No runtime, tests, `STATE.md`, `ROADMAP.md`, OpenAPI, package/lockfile, migration, provider, deploy, or frontend artifacts are changed by R2.

Corrections applied:
- `key-files.modified` now includes `apps/backend/integration-tests/http/sentry.spec.ts`;
- Post-R1 final/documentary HEAD is recorded as `30478cb5776a36c51bb898ed2da81a7280ec7025`;
- the R1 documentation commit is recorded as `30478cb` rather than a placeholder;
- pre-R1 `Tests` and `Scope` sections are explicitly historical and superseded by the final R1 evidence below.

Gate remains unchanged pending human documentary re-review:

```text
13-03: R1 CORRECTION COMPLETE — AWAITING HUMAN RE-REVIEW
13-03: NOT YET HUMAN-APPROVED
13-04..13-07: NOT AUTHORIZED
Plans human-approved executed: 2/7
Phase requirements complete: 0/8
Milestone requirements complete: 0/91
Deploy: NOT AUTHORIZED
Frontend M1: BLOCKED
```

## Task 3 checkpoint

`checkpoint:human-verify` / `gate:blocking`

Human must re-review R1 fail-closed hardening evidence in this SUMMARY before marking 13-03 HUMAN APPROVED — PASS. 13-04 remains NOT AUTHORIZED until that approval.
