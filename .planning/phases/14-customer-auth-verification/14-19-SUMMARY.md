---
phase: 14-customer-auth-verification
plan: 19
subsystem: api-docs
tags: [openapi, auth, bff, coverage, store-partition]
status: executed-awaiting-human-review
completed: 2026-08-18
requirements: [AUTH-03, AUTH-07, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-18 closed runtime exact-set and AUTH_HTTP_CONTRACT
provides:
  - TypeScript API Docs registry for the 12 approved BFF/backend auth contracts
  - Store documentation partition for /store/*, /health/*, and the exact 6 approved /auth paths
  - Auth schemas, non-interactive security, coverage, and documentation deny list
affects: [14-20, api-docs]
---

# Phase 14: Customer Auth Verification — Plan 19 Summary

`14-19` is **EXECUTED — AWAITING HUMAN REVIEW**. It is **NOT YET HUMAN APPROVED**.

This plan materializes the TypeScript API Docs registry for the 12 approved BFF/backend contracts. Generated OpenAPI JSON was not written. `14-20` was not started.

## Governance

```text
14-18: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
B14-18-HR-01: CLOSED — PASS
B14-18-HR-02: CLOSED — PASS

14-19 ORIGINAL PLAN: AUTHORIZED FOR EXECUTION
14-19 SCOPE AMENDMENT: HUMAN AUTHORIZED — PASS TO PROCEED / EXECUTED WITHIN HUMAN AUTHORIZATION
14-19-01: EXECUTED — AWAITING HUMAN REVIEW
14-19-02: EXECUTED — AWAITING HUMAN REVIEW
14-19-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN REVIEW
14-19: NOT YET HUMAN APPROVED

14-20..14-21: NOT AUTHORIZED / NOT STARTED
DEPLOY / PUSH / PR / MERGE: NOT AUTHORIZED
REAL PROVIDERS / REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
AUTO-CHAIN: FORBIDDEN
STATE.md: UNCHANGED
ROADMAP.md: UNCHANGED
```

Documentary head at start: `10c23e4748e250817adce57c07827841f7f4a851`

## Human Scope Amendment

Reason: API Docs as-built coverage/generation partition could not represent the approved 12 BFF/backend operations because six canonical operations use `/auth/*` paths while documentation ownership is the Store document.

Authorized additional production files:

- `apps/backend/src/api-docs/coverage/verify-coverage.ts`
- `apps/backend/src/api-docs/generation/validate.ts`

Authorized additional regression specs:

- `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/security.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`

Runtime Auth/Store semantics: **UNCHANGED**

Generated JSON: **BYTE UNCHANGED**

Writer: **NOT EXECUTED**

14-20: **NOT STARTED**

Fail-closed rule kept: Store documentation does **not** accept generic `/auth/*`. Only the six approved method+path keys are Store-document owned.

## Subagent Execution

Subagents ran **sequentially** under MAIN AGENT orchestration. `parallelization=false` was binding. The MAIN AGENT did not implement the plan in a single context.

| Order | Subagent | Role | Result |
|---|---|---|---|
| A | [Contract analysis](bea922ee-f5b8-41aa-868c-fb40e2256362) | READ-ONLY contract / as-built analysis | 12/12 mapping confirmed; amendment sufficient; no extra production file; baseline JSON match; `discoverRoutes()` = 35; `auth.ts` missing; `customers.ts` empty |
| B | [Schemas/security](bd078344-af3d-4122-9632-54edc0f9e200) | Task 14-19-01 TDD RED→GREEN | schemas + security schemes + `auth-contract.unit.spec.ts`; 16 tests PASS; lint PASS; JSON unchanged |
| C | [Coverage/partition](5bc4b9f2-0800-4859-9b8e-ce1306821268) | Human-authorized partition machinery | exact-set `/auth` mapping; runtime 63 = 51 native + 12 local; four specs updated to cumulative contract; HANDOFF_TO_D until registry existed |
| D | [Registry/exclusions](ad1410ee-0a86-4050-ac49-6d8e0571ffdb) | Task 14-19-02 | created `auth.ts`; filled `customers.ts`; wired `index.ts`; deny list; 12/12 registered; 24 auth-contract + 245 combined PASS |
| E | [Independent review](40193a77-6782-4408-a015-8ba67ff4f6d9) | Adversarial read-only review | **PASS** — checklist 1–19 PASS; no blockers |

MAIN AGENT post-E remediation (allowlist only): TypeScript build errors in `auth.ts` and `auth-contract.unit.spec.ts` (`retryAfterSeconds` union narrowing; `scheme` unknown). No scope expansion.

## Exact-set 12/12

| # | Contract operation | Method / path | operationId | Auth | Success | Public failures |
|---|---|---|---|---|---|---|
| 1 | signup | `POST /auth/customer/emailpass/register` | `storeAuthRegisterCustomer` | `public_bff` | 201 `AUTHENTICATED` / session | 400 `INVALID_REQUEST`, 409 `AUTH_REQUEST_REJECTED`, 429 `RATE_LIMITED`, 503 `AUTH_TEMPORARILY_UNAVAILABLE` |
| 2 | login | `POST /auth/customer/emailpass` | `storeAuthLoginCustomer` | `public_bff` | 200 session | 400, 401 `INVALID_CREDENTIALS`, 403 `EMAIL_VERIFICATION_REQUIRED`, 429, 503 |
| 3 | refresh | `POST /auth/token/refresh` | `storeAuthRefreshToken` | `refresh_header_and_idempotency_key` | 200 session | 400, 401 `AUTHENTICATION_REQUIRED`, 429, 503 |
| 4 | revoke_current_lineage | `POST /auth/customer/emailpass/revoke-current-lineage` | `storeAuthRevokeCurrentLineage` | `access_bearer` | 204 empty | 401, 503 |
| 5 | reset_request | `POST /auth/customer/emailpass/reset-password` | `storeAuthRequestPasswordReset` | `public_bff` | 202 `REQUEST_ACCEPTED` | 400 `INVALID_REQUEST` |
| 6 | reset_confirm | `POST /auth/customer/emailpass/update` | `storeAuthConfirmPasswordReset` | `capability_and_idempotency_key` | 200 `PASSWORD_RESET_COMPLETED` | 400 `RESET_INVALID_OR_EXPIRED`, 429, 503 `AUTH_TEMPORARILY_UNAVAILABLE` (Retry-After 60 in description at `pre_lookup`), 503 `AUTH_RECOVERY_PENDING` |
| 7 | current_auth_customer | `GET /store/customers/me` | `storeCustomersGetMe` | `access_bearer` | 200 current customer | 401, 503 |
| 8 | verification_request | `POST /store/customers/me/verify` | `storeCustomersRequestVerification` | `access_bearer` | 202 `REQUEST_ACCEPTED` | 401, 429, 503 |
| 9 | verification_resend | `POST /store/customers/verify/resend` | `storeCustomersResendVerification` | `public_bff` | 202 `REQUEST_ACCEPTED` | 400 |
| 10 | verification_confirm | `POST /store/customers/verify` | `storeCustomersConfirmVerification` | `public_bff_no_session` | 200 `EMAIL_VERIFIED` | 400 `VERIFICATION_INVALID_OR_EXPIRED`, 429, 503 |
| 11 | verification_status | `GET /store/customers/me/verify/status` | `storeCustomersGetVerificationStatus` | `access_bearer` | 200 status | 401, 503 |
| 12 | password_change | `POST /store/customers/me/password` | `storeCustomersChangePassword` | `access_bearer_and_idempotency_key` | 204 empty | 400 `CURRENT_CREDENTIAL_INVALID`, 401, 429, 503 `AUTH_RECOVERY_PENDING` |

Store registry after this plan: **9 legacy + 12 Phase 14 = 21**. No 13th operation. No wildcard. No prefix authorization.

`AUTH_HTTP_CONTRACT` is the HTTP authority. Password-change public failures follow the contract (SPEC complementary Redis `503 AUTH_TEMPORARILY_UNAVAILABLE` is not documented as a public password-change code).

## Schemas

Added Store auth schemas (no examples on password, token, email, session material):

- `StoreAuthCustomer`
- `StoreAuthEmptyRequest`
- `StoreAuthSignupRequest`
- `StoreAuthLoginRequest`
- `StoreAuthEmailRequest`
- `StoreAuthVerificationConfirmRequest`
- `StoreAuthResetConfirmRequest`
- `StoreAuthPasswordChangeRequest`
- `StoreAuthSessionEnvelope`
- `StoreAuthRequestAccepted`
- `StoreAuthVerificationResult`
- `StoreAuthVerificationStatus`
- `StoreAuthPasswordResetResult`
- `StoreAuthCurrentCustomer`
- `StoreAuthErrorResponse`

`STORE_AUTH_SCHEMA_CONTRACT` is derived from `AUTH_HTTP_CONTRACT`.

## Security

Scheme names **unchanged**:

- `publishableApiKey`
- `customerBearer`
- `customerSession`

Refresh is documented as header parameter `XIndicioRefreshToken` (`x-indicio-refresh-token`) with `x-bff-only` and `x-not-browser-credential`. It is **not** a fourth Swagger-interactive scheme.

Publishable key remains the BFF→Medusa hop credential, not caller authentication. BFF secret is not documented as a user/browser credential.

All 12 operations: `nonInteractive: true`, `interactiveCandidate: false`.

Swagger remains globally non-interactive.

## Provenance

Each of the 12 operations has:

- `sourceClassification: project-custom`
- `sourceFiles` pointing at the real route file + `middlewares.ts`
- Phase 14 HTTP `testEvidence`
- GitHub `officialReference`
- `inclusionReason`: BFF/backend contract; browser must not call Medusa directly
- Description of Browser → same-origin Next.js BFF → BFF service credential → Medusa

## Coverage

- `discoverRoutes()` factual count: **35** (stale 23 updated)
- Installed Store runtime exact-set: **63 = 51 native + 12 local**
- Manifest: total 63, EXTENDED 15, BLOCKED 17, OUTSIDE_FRONTEND_M1 31, `m1Enabled` 6
- Executable Store M1 keys are the six `/store/customers...` ops only (`/auth` is documentation-owned, not a Store-runtime prefix)
- Coverage requires all 12 approved operations; omitting one `/auth` key fails store coverage

## Exclusions

`ROUTE_EXCLUSIONS` remains the discovered 4:

- `GET /store/custom`
- `GET /admin/custom`
- `POST /store/carts/{id}/complete`
- `POST /store/customers/me/cart/attach`

`AUTH_DOCUMENTATION_DENY_EXCLUSIONS` documents (not fed to `validateRouteExclusions`, because those paths are not AST-discovered):

- browser/raw logout (`path: null` — no invented endpoint)
- `/auth/session` (native POST/DELETE)
- callbacks
- MFA
- native auth session primitives
- native verification / refresh / reset aliases
- provider/actor variants
- raw Customer DENY (`POST /store/customers`, `POST /store/customers/me`, addresses, attach)

None of the 12 approved operations is hidden in an exclusion.

## Documentation partition

Store document may contain:

- `/store/*`
- `/health/*`
- exact approved `/auth` method+path pairs in `STORE_DOCUMENTATION_AUTH_OPERATIONS`

Composition (fail-closed):

1. Coverage maps only those six keys to Store; anything else throws incompatible surface
2. `validateSurfacePartition("store")` accepts method+path exact-set, not `/auth/*`
3. Registry exact-set is 12

Unsupported `/auth` proven outside: `/auth/session`, callbacks, MFA, trailing slash, case, GET vs POST, `/auth/refresh`, `/auth/token`, native aliases.

Runtime:

- `/auth/*` remains Auth runtime surface
- `/store/*` remains Store runtime surface

This plan did not edit auth-surface or store-surface runtime manifests.

## Logout distinction

Backend approved: `POST /auth/customer/emailpass/revoke-current-lineage` (registered).

Browser/raw logout: documentation deny only. No browser logout operation was invented.

## Sensitive walker / examples

Existing walker was not weakened. Auth schemas omit examples on sensitive fields. Planted JWT / capability / password / real email / provider metadata are rejected by the walker tests.

No examples contain JWT, Authorization, backend bearer, refresh/reset/verification capability, password, currentPassword, newPassword, BFF secret, cookie, real email, provider metadata, operation HMAC, or lineage/SID.

## Swagger non-interactive

Unchanged. Auth operations are `nonInteractive: true`. Refresh is not Try-It-Out. No interactivity flag or bypass was added.

## Generated JSON

Writer: **NOT EXECUTED**

| Artifact | Before bytes | After bytes | Before SHA256 | After SHA256 |
|---|---:|---:|---|---|
| `store.openapi.json` | 33096 | 33096 | `481d1206f00c72e06363b8c17d87b050d3a6ca38d8879480f342da3f4726c4a9` | identical |
| `admin.openapi.json` | 98767 | 98767 | `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` | identical |
| `webhooks.openapi.json` | 21736 | 21736 | `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` | identical |

`git diff --` the three generated JSON files: **EMPTY**

In-memory built Store document is ahead of committed JSON by design (14-20 owns the writer).

## Validation results

```text
auth-contract.unit.spec.ts:                         PASS — 24/24
coverage + store-contract + security + generation:  PASS — 245/245 combined with auth-contract
swagger-config / exposure / runtime-documents /
  security-headers:                                 PASS
openapi:lint:                                       PASS
exact-set 12/12:                                    PASS
unsupported /auth DENY:                             PASS
generated JSON bytes/SHA256:                        PASS — identical
git diff generated JSON:                            EMPTY
backend build:                                      PASS
direct ESLint touched files:                        0 errors
git diff --check:                                   PASS
native-extensions.unit.spec.ts:                     PRE-EXISTING at 14-18 head — fingerprint drift on unmodified apps/backend/src/api/middlewares.ts; not in 14-19 allowlist; not remediated
repository lint wrapper:                            KNOWN TOOLING FAILURE — empty JSON / EOF
```

## Commits

Local only. No push.

1. `5da97264e58272cb52d9aa3a4746a3ea1a03a603` — `feat(14-19): register Phase 14 BFF auth contracts in the Store API Docs registry`
2. this summary commit — `docs(14-19): record execution evidence`

TDD RED→GREEN happened in Subagent B before registry registration. Intermediate RED state was not reconstructed as a separate commit so the implementation commit stays green.

## Files

Created:

- `apps/backend/src/api-docs/operations/store/auth.ts`
- `apps/backend/src/api-docs/__tests__/auth-contract.unit.spec.ts`
- `.planning/phases/14-customer-auth-verification/14-19-SUMMARY.md`

Modified:

- `apps/backend/src/api-docs/operations/store/customers.ts`
- `apps/backend/src/api-docs/operations/store/schemas.ts`
- `apps/backend/src/api-docs/operations/store/index.ts`
- `apps/backend/src/api-docs/components/security-schemes.ts`
- `apps/backend/src/api-docs/coverage/exclusions.ts`
- `apps/backend/src/api-docs/coverage/verify-coverage.ts`
- `apps/backend/src/api-docs/generation/validate.ts`
- `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/security.unit.spec.ts`
- `apps/backend/src/api-docs/__tests__/generation.unit.spec.ts`

## Not done (binding)

- no runtime Auth/Store change
- no schema / migration
- no dependency / package.json / lockfile / env
- no writer / generated JSON edit
- no 14-20
- no push / deploy / PR / merge
- no real providers / remote DB / Redis
- no STATE.md / ROADMAP.md update
- no HUMAN APPROVED declaration
