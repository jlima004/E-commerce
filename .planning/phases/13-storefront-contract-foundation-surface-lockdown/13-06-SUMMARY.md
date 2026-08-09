---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 06
subsystem: api-docs
tags: [openapi, store, per-surface-versioning, coverage, bff]

requires:
  - phase: 13-05
    provides: StoreResourceVersion foundation (HUMAN APPROVED — PASS)
provides:
  - Closed per-surface OpenAPI version domain with Store 1.1.0 and Admin/Webhooks 1.0.0
  - Store 1.1 transversal error, header, money, and BFF-only security components
  - Separate runtime, manifest, and executable M1 exact-set coverage
  - Registry-generated Store OpenAPI 1.1.0 artifact
affects:
  - 13-07-storefront-contract-foundation-surface-lockdown
  - 14-21-owner-phases

tech-stack:
  added: []
  patterns:
    - Closed contract version domain indexed by surface
    - Manifest enablement determines executable M1 coverage independently from legacy runtime availability
    - Future transversal components retained without introducing downstream executable operations

key-files:
  created:
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-06-SUMMARY.md
  modified:
    - apps/backend/src/api-docs/contracts.ts
    - apps/backend/src/api-docs/document.ts
    - apps/backend/src/api-docs/generation/build-documents.ts
    - apps/backend/src/api-docs/generation/validate.ts
    - apps/backend/src/api-docs/components/errors.ts
    - apps/backend/src/api-docs/components/parameters.ts
    - apps/backend/src/api-docs/components/headers.ts
    - apps/backend/src/api-docs/components/security-schemes.ts
    - apps/backend/src/api-docs/components/index.ts
    - apps/backend/src/api-docs/coverage/verify-coverage.ts
    - apps/backend/src/api-docs/__tests__/generation.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts
    - apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts
    - apps/backend/src/api-docs/generated/store.openapi.json

key-decisions:
  - "ContractVersion remains closed to 1.0.0 | 1.1.0; arbitrary strings are not accepted"
  - "Store resolves to 1.1.0 while Admin and Webhooks remain 1.0.0 and validate fail-closed per surface"
  - "PRESERVE_LEGACY runtime availability is not M1 enablement and does not enter the executable M1 exact-set"
  - "A stale native evidence fingerprint requires a 15th technical path, so the R1 execution is BLOCKED rather than scope-expanded"

requirements-completed: []
requirements-evidenced: [FND-03, FND-07, FND-08]

duration: 10min
completed: 2026-08-09
status: blocked-awaiting-human-review
---

# Phase 13 Plan 06: Store OpenAPI 1.1.0 Foundation Summary

**Store OpenAPI 1.1.0 was generated from a closed per-surface registry with transversal components and exact-set coverage, but the mandatory relevant regression remains BLOCKED by a pre-existing native evidence fingerprint that cannot be corrected inside the 14-path R1 allowlist.**

## Identity and Lineage

```text
Initial 13-06 attempt:
BLOCKED — PLAN ALLOWLIST INSUFFICIENT

Root cause:
global CONTRACT_VERSION architecture

Initial attempt mutations:
NONE

P13-13-06-PLAN-R1:
HUMAN APPROVED — PASS

Technical allowlist:
10 → 14

Pre-R1 HEAD:
fa84039ad77a5c63c5563dff13a6f5a1015d8a06

R1 execution:
BLOCKED — RELEVANT API DOCS REGRESSION REQUIRES 15TH TECHNICAL PATH
```

## Per-Surface Version Architecture

```text
Contract version domain:
1.0.0 | 1.1.0

Store expected:
1.1.0

Admin expected:
1.0.0

Webhooks expected:
1.0.0

Global single-version behavior:
REMOVED

Arbitrary string version:
NOT ALLOWED
```

Validator matrix proven by `generation.unit.spec.ts`:

| Surface / version | Result |
|---|---|
| Store 1.1.0 | PASS |
| Store 1.0.0 | REJECTED |
| Admin 1.0.0 | PASS |
| Admin 1.1.0 | REJECTED |
| Webhooks 1.0.0 | PASS |
| Webhooks 1.1.0 | REJECTED |

OpenAPI remains `3.1.2`; `x-medusa-version` remains `2.16.0`.

## Store Components

- `StoreErrorResponse`: closed object with required `code`, `message`, and `retryable`; optional sanitized `correlationId`, allowlisted `fieldErrors`, and safe primitive `cart` only.
- `Idempotency-Key`: server-side BFF retry identity only; explicitly not authentication, authorization, ownership, or capability.
- `If-Match`: transversal opaque precondition; Cart enforcement remains Phase 15.
- `ETag`: transversal server-authoritative response version; Cart emission remains Phase 15.
- `x-correlation-id`: invalid/missing input is replaced and unsafe input is never echoed.
- `Retry-After`: conditional only when retry is factual and no external effect is uncertain.
- `StoreMajorMoney`: closed `amount + currency=BRL + unit=major`.
- `StoreMinorMoney`: closed `amount + currency=BRL + unit=minor`.
- Store security schemes describe `Browser → same-origin Next.js BFF → server-to-server Medusa`; direct browser → Medusa is not authorized.

No auth, capability, Cart enforcement, checkout, shipping, PaymentAttempt M1, confirmation, Order summary, catalog revalidation, BFF, or frontend operation was introduced.

## Exact Sets

```text
Runtime:
51 native
7 local non-overlapping
58 total

Manifest:
58

AUTHORIZED:
0

EXTENDED:
10

BLOCKED:
17

OUTSIDE_FRONTEND_M1:
31

M1_ENABLED:
0

Executable Store M1 business:
0

PRESERVE_LEGACY executable:
0
```

`verifyStoreSurfaceExactSets` rejects runtime duplicate/drift, manifest violations, unknown OpenAPI business operations, invalid `PRESERVE_LEGACY` enablement, disabled exposure, and enabled operations missing from registry/document. Health/support remains separate as `GET /health/live` and `GET /health/ready`.

## Generated Artifact Isolation

```text
Writer:
npm run openapi:generate -- --surface store

store.openapi.json:
WRITER-GENERATED / CHANGED / info.version=1.1.0

admin.openapi.json:
UNCHANGED / tracked version=1.0.0

webhooks.openapi.json:
UNCHANGED / tracked version=1.0.0

manual JSON edit:
NO

OpenAPI lint:
PASS — no warn-or-higher findings

openapi:check:
NOT EXECUTED — RESERVED FOR 13-07
```

The first lint attempt correctly rejected seven unused future foundation components. The source was corrected inside the allowlist by retaining explicit non-executable component references in Store foundation metadata; the Store writer was rerun and final lint passed. No Admin/Webhooks artifact was regenerated or changed.

## Test Evidence

| Gate | Command/result | Suites | Tests | Exit |
|---|---|---:|---:|---:|
| Generation unit | `npm run test:unit -- --runTestsByPath src/api-docs/__tests__/generation.unit.spec.ts --runInBand` | 1/1 | 161/161 | 0 |
| Store contract unit | `npm run test:unit -- --runTestsByPath src/api-docs/__tests__/store-contract.unit.spec.ts --runInBand` | 1/1 | 17/17 | 0 |
| Coverage unit | `npm run test:unit -- --runTestsByPath src/api-docs/__tests__/coverage.unit.spec.ts --runInBand` | 1/1 | 15/15 | 0 |
| Combined focal | three required R1 specs | 3/3 | 193/193 | 0 |
| Relevant API Docs post-writer | 13 explicit API Docs suites excluding the separately reported failing native-fingerprint suite | 13/13 | 342/342 | 0 |
| Native extension evidence | `native-extensions.unit.spec.ts` | 0/1 | 13 passed / 2 failed / 15 | 1 |

### Blocking regression

```text
Suite:
src/api-docs/__tests__/native-extensions.unit.spec.ts

Error:
Native evidence fingerprint drift: GET /store/products apps/backend/src/api/middlewares.ts

Blocking tests:
verifies every local evidence file and all 24 bound fingerprints
fails when local evidence changes

Fix scope required:
apps/backend/src/api-docs/coverage/native-routes.ts and/or apps/backend/src/api/middlewares.ts

R1 allowlist status:
NOT AUTHORIZED — would be a 15th technical path
```

`apps/backend/src/api/middlewares.ts` is unchanged from the authorized baseline. The executor did not refresh fingerprints or alter middleware because P13-13-06-PLAN-R1 forbids a 15th technical path. Per the failure gate, this is `BLOCKED`, not PASS with debt.

## Build

```text
Command:
ADMIN_DISABLED=true npm run build -w @dtc/backend

Exit:
0

TypeScript errors:
0

Result:
PASS
```

The build completed successfully. Its 297 warnings are non-blocking; no warning was widened into an out-of-scope edit.

## Sensitive Proof

Generated Store OpenAPI contains zero `example`/`examples` nodes and zero sensitive matches. No raw Idempotency-Key, JWT, capability, confirmation token, CPF, `client_secret`, Pix payload, Authorization credential, cookie, or provider secret example was introduced.

## Scope and Integrity

- Technical paths changed: exactly 14/14 authorized paths.
- Unexpected technical paths: none.
- `manifest.ts`: unchanged.
- Store runtime outside the allowlist: unchanged.
- `package.json`: unchanged.
- `package-lock.json`: unchanged.
- `apps/backend/package.json`: unchanged.
- Admin/Webhooks generated JSON: unchanged.
- STATE/ROADMAP/REQUIREMENTS/PLAN: unchanged.
- `git diff --check`: PASS.
- Remote effects: none (no Supabase, remote DB, Heroku, deploy, Stripe, Gelato, Resend, PostHog, Sentry external, frontend, push, or PR).

## Commits

- `0c508dc` — `test(13-06): define Store OpenAPI 1.1 regressions`
- `e164576` — `feat(13-06): add per-surface OpenAPI contract versions`
- `eaa4ed3` — `feat(13-06): define Store OpenAPI 1.1 primitives`
- `6e119a5` — `feat(13-06): enforce Store executable contract coverage`
- `355e4f7` — `fix(13-06): preserve correlation header schema compatibility`
- `8c8cd8c` — `feat(13-06): generate Store OpenAPI 1.1 artifact`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Compatibility] Preserved the established correlation response-header schema shape**

- **Found during:** expanded API Docs regression
- **Issue:** adding constraints directly to the response header broke an existing exact structural assertion.
- **Fix:** retained the established `{type: string}` response schema and kept the sanitized replacement semantics in its description and request parameter.
- **Files modified:** `components/headers.ts`
- **Commit:** `355e4f7`

**2. [Rule 3 - Blocking] Linked future foundation components without executable operations**

- **Found during:** first `openapi:lint`
- **Issue:** Spectral rejected seven deliberately future-facing components as unused.
- **Fix:** referenced them through non-executable Store foundation metadata on the already-used closed error schema; no Phase 14–21 operation was added.
- **Files modified:** `components/errors.ts`, generated Store JSON
- **Commit:** `8c8cd8c`

### Deferred / Blocking Issue

The native extension fingerprint drift cannot be auto-fixed: every legitimate correction requires a path outside the exact 14-path allowlist. Execution stopped as `BLOCKED` after recording complete evidence.

## Known Stubs

None. Cart runtime ETag/If-Match and downstream owner-phase operations are explicit future-phase boundaries, not incomplete Plan 13-06 stubs.

## Threat Surface Scan

No new network endpoint, auth path, file access boundary, schema migration, provider call, or secret persistence was introduced. The BFF boundary was tightened documentarily and sensitive examples remain absent.

## Requirements and Governance

```text
FND-03:
EVIDENCED — NOT COMPLETE

FND-07:
EVIDENCED — NOT COMPLETE

FND-08:
EVIDENCED — NOT COMPLETE

requirements-completed:
[]

Plans human-approved executed:
5/7

Phase 13 requirements complete:
0/8

Milestone requirements complete:
0/91

13-06:
BLOCKED — RELEVANT API DOCS REGRESSION REQUIRES 15TH TECHNICAL PATH

13-07:
NOT AUTHORIZED
```

## Self-Check: PASSED

- All 14 authorized technical files exist and are committed.
- Commits `0c508dc`, `e164576`, `eaa4ed3`, `6e119a5`, `355e4f7`, and `8c8cd8c` exist.
- Store writer output exists at `store.openapi.json`; Admin/Webhooks artifacts are unchanged.
- The blocker is reproducible, exact, outside the R1 allowlist, and not concealed as a technical PASS.
- Governance files remain unchanged and 13-07 remains unauthorized.

---
*Phase: 13-storefront-contract-foundation-surface-lockdown — Plan 13-06 R1 BLOCKED at mandatory relevant regression gate*
