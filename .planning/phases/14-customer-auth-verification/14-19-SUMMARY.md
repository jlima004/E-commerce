---
phase: 14-customer-auth-verification
plan: 19
subsystem: api-docs
tags: [openapi, auth, bff, coverage, store-partition]
status: complete
completed: 2026-08-18
requirements: [AUTH-03, AUTH-07, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-18 closed runtime exact-set and AUTH_HTTP_CONTRACT
provides:
  - TypeScript API Docs registry for the 12 approved BFF/backend auth contracts
  - Store documentation partition for /store/*, /health/*, and the exact 6 approved /auth method+path pairs
  - Auth schemas, non-interactive security, coverage, and documentation deny inventory
affects: [14-20, api-docs]
---

# Phase 14: Customer Auth Verification — Plan 19 Summary

`14-19` is **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.

The TypeScript API Docs registry now represents exactly the 12 approved Phase 14 BFF/backend auth contracts. `B14-19-HR-01` and `B14-19-PUSH-01` are **CLOSED — PASS**. Generated OpenAPI JSON was not written by this plan. By explicit human authorization, `14-20` is **AUTHORIZED FOR EXECUTION / NOT STARTED**; `14-21` remains **NOT AUTHORIZED**.

## Governance

```text
14-18: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
14-19 SCOPE AMENDMENT: HUMAN APPROVED — PASS
B14-19-HR-01: CLOSED — PASS
B14-19-PUSH-01: CLOSED — PASS
14-19-01: HUMAN APPROVED — PASS
14-19-02: HUMAN APPROVED — PASS
14-19-03: HUMAN APPROVED — PASS
14-19: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED

14-20: AUTHORIZED FOR EXECUTION / NOT STARTED
14-21: NOT AUTHORIZED / NOT STARTED
DEPLOY / PR / MERGE: NOT AUTHORIZED
REAL PROVIDERS / REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
AUTO-CHAIN: FORBIDDEN
```

Human-pushed execution/remediation head before documentary closure:

`394b7d49f68c31c331f14873f26dc9ef863832ad`

Published 14-19 chain:

1. `67b468ef0b68c3f5d53b55730b587cb563d9a31c` — `feat(14-19): register Phase 14 BFF auth contracts in the Store API Docs registry`
2. `f61f90a6d80420e671d3f02edfec53d9041e7e8d` — `docs(14-19): record execution evidence`
3. `9a1f0a86ea970e4745995d9dddf010ed912b0dbe` — `fix(14-19): document mandatory bff service credential`
4. `394b7d49f68c31c331f14873f26dc9ef863832ad` — `docs(14-19): record bff caller auth remediation`

## Human Scope Amendment

The as-built API Docs machinery originally could not document the six approved `/auth/*` operations in the Store document. The human-authorized amendment added only the documentation machinery required to support exact Store-document ownership without changing runtime ownership:

- `apps/backend/src/api-docs/coverage/verify-coverage.ts`
- `apps/backend/src/api-docs/generation/validate.ts`
- `coverage.unit.spec.ts`
- `store-contract.unit.spec.ts`
- `security.unit.spec.ts`
- `generation.unit.spec.ts`

Runtime semantics remain unchanged:

```text
/auth/*  -> Auth runtime surface
/store/* -> Store runtime surface
```

Store documentation accepts `/store/*`, `/health/*`, and only the six approved `/auth` method+path pairs. Generic `/auth/*` remains fail-closed.

## Exact-set 12/12

AUTH documentation-owned operations:

1. `POST /auth/customer/emailpass/register`
2. `POST /auth/customer/emailpass`
3. `POST /auth/token/refresh`
4. `POST /auth/customer/emailpass/revoke-current-lineage`
5. `POST /auth/customer/emailpass/reset-password`
6. `POST /auth/customer/emailpass/update`

STORE operations:

7. `GET /store/customers/me`
8. `POST /store/customers/me/verify`
9. `POST /store/customers/verify/resend`
10. `POST /store/customers/verify`
11. `GET /store/customers/me/verify/status`
12. `POST /store/customers/me/password`

Store registry after 14-19: **9 legacy + 12 Phase 14 = 21**. No 13th operation, wildcard, prefix authorization, browser logout endpoint, `/auth/session`, callback, MFA or native auth alias was added.

## B14-19-HR-01 — CLOSED — PASS

Human review found that the first registry version incorrectly represented `publishableApiKey` as the complete public BFF security requirement. Runtime caller authority is the mandatory `x-indicio-bff-auth` BFF service credential.

Accepted remediation:

- `bffServiceCredential` added as `apiKey` / header / `x-indicio-bff-auth`;
- server-to-server only; no example/default;
- AND-composed with `publishableApiKey` on all 12 contracts;
- AND-composed with `customerBearer` where `AUTH_HTTP_CONTRACT` requires access bearer;
- `STORE_AUTH_PUBLIC_BFF` decoupled from legacy `STORE_PUBLISHABLE_ONLY`;
- `x-indicio-bff-auth` is not duplicated as an ordinary header parameter;
- browser-direct Medusa remains forbidden;
- Swagger remains non-interactive;
- runtime remained untouched.

Final security matrix:

```text
public_bff                         -> BFF + publishable
public_bff_no_session              -> BFF + publishable; no customer bearer/session
access_bearer                      -> BFF + publishable + customerBearer
refresh_header_and_idempotency_key -> BFF + publishable + refresh header + Idempotency-Key
capability_and_idempotency_key     -> BFF + publishable + capability body + Idempotency-Key
access_bearer_and_idempotency_key  -> BFF + publishable + customerBearer + Idempotency-Key
```

Store security schemes are exactly:

- `bffServiceCredential`
- `publishableApiKey`
- `customerBearer`
- `customerSession`

## B14-19-PUSH-01 — CLOSED — PASS

The first push attempt was rejected by GitHub Push Protection because a synthetic negative-test fixture matched the Stripe Test API Secret Key detector.

Resolution:

- no bypass;
- no repository protection disabled;
- no real credential identified;
- synthetic `sk_test_*` fixture removed from every unpublished 14-19 commit by local history rewrite;
- test intent preserved using semantic sensitive field `provider_order_id` with a non-secret-shaped synthetic value;
- no force push;
- normal fast-forward push succeeded from `10c23e4748e250817adce57c07827841f7f4a851` to `394b7d49f68c31c331f14873f26dc9ef863832ad`.

## Coverage / exclusions / safe examples

Accepted invariants:

- `discoverRoutes()` factual count: 35;
- installed Store runtime exact-set: 63 = 51 native + 12 local;
- six Store customer operations are executable M1 entries;
- six `/auth` contracts are Store-document owned but remain Auth runtime operations;
- omission of any approved `/auth` contract fails coverage;
- `ROUTE_EXCLUSIONS` remains the closed discovered 4-entry set;
- browser/raw logout remains a documentation deny with no invented endpoint;
- raw Customer, `/auth/session`, callbacks, MFA and native aliases remain denied;
- sensitive walker was not weakened;
- no examples expose JWT, password, refresh/reset/verification capability, BFF secret, real email, provider credential/metadata, cookie, internal lineage/SID or operation HMAC;
- all 12 operations remain `nonInteractive: true` and `interactiveCandidate: false`.

## Generated JSON boundary

Writer: **NOT EXECUTED by 14-19**.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| `store.openapi.json` | 33096 | `481d1206f00c72e06363b8c17d87b050d3a6ca38d8879480f342da3f4726c4a9` |
| `admin.openapi.json` | 98767 | `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` |
| `webhooks.openapi.json` | 21736 | `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` |

Before = after; generated JSON diff was empty. `14-20` owns the Store writer/artifact step.

## Accepted validation evidence

```text
auth-contract.unit.spec.ts: PASS — 24/24
security.unit.spec.ts: PASS — 15/15
cumulative auth-contract + coverage + store-contract + security + generation: PASS — 247/247
swagger-config / swagger-assets / exposure / runtime-documents / security-headers: PASS — 90/90
openapi:lint: PASS
backend build: PASS
direct ESLint touched production: 0 errors
git diff --check: PASS
generated JSON bytes/SHA256: PASS — identical
git diff generated JSON: EMPTY
runtime: UNTOUCHED
repository lint wrapper: KNOWN TOOLING FAILURE — empty JSON / EOF
```

Historical `native-extensions.unit.spec.ts` fingerprint drift on unmodified `apps/backend/src/api/middlewares.ts` remains pre-existing debt and was not remediated by 14-19.

## 14-20 authorization

By explicit human authorization, `14-20-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

Authorized sequence:

1. `14-20-01` — run only the Store writer (`npm run openapi:generate -w @dtc/backend -- --surface store`) and prove the diff is only `store.openapi.json`; Admin/Webhooks stay byte-identical.
2. `14-20-02` — prove Store artifact determinism, auth-contract/sensitive walker and OpenAPI lint; do not run global `openapi:check`.
3. `14-20-03` — **BLOCKING HUMAN VERIFY**; stop and present writer command, exact Store diff, 12/12 operation list, hashes and sanitized validation outputs.

Binding restrictions:

- no manual JSON editing;
- no Admin/Webhooks writer drift;
- no sensitive example;
- no Swagger interactivity;
- no `openapi:check` in 14-20; that clean-check remains owned by plan 21;
- no dependency/package/env/runtime/schema/migration changes;
- no deploy, real providers, remote DB/Redis or frontend work;
- no auto-chain into `14-21`.

## Final status

```text
B14-19-HR-01: CLOSED — PASS
B14-19-PUSH-01: CLOSED — PASS
14-19-01: HUMAN APPROVED — PASS
14-19-02: HUMAN APPROVED — PASS
14-19-03: HUMAN APPROVED — PASS
14-19: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
14-20: AUTHORIZED FOR EXECUTION / NOT STARTED
14-21: NOT AUTHORIZED / NOT STARTED
DEPLOY: NOT AUTHORIZED
REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```
