---
phase: 14-customer-auth-verification
plan: 20
subsystem: api-docs
tags: [openapi, store-artifact, writer, determinism]
status: executed-awaiting-human-review
completed: 2026-08-18
requirements: [AUTH-03, AUTH-07, AUTH-09]
requirements-completed: []

requires:
  - phase: 14-customer-auth-verification
    provides: 14-19 TypeScript Store API Docs registry for the 12 approved BFF/backend auth contracts
provides:
  - Writer-generated Store OpenAPI artifact from the approved 14-19 registry
  - Deterministic Store bytes with Admin/Webhooks remaining byte-identical
affects: [14-21, api-docs]

key-files:
  created:
    - .planning/phases/14-customer-auth-verification/14-20-SUMMARY.md
  modified:
    - apps/backend/src/api-docs/generated/store.openapi.json
    - apps/backend/src/api-docs/__tests__/generation.unit.spec.ts
---

# Phase 14: Customer Auth Verification — Plan 20 Summary

`14-20` executed the Store OpenAPI writer from the HUMAN APPROVED 14-19 TypeScript registry. The generated Store artifact is deterministic, sensitive-safe and Admin/Webhooks byte-identical. This plan is **NOT YET HUMAN APPROVED**. Execution stops at `14-20-03` for blocking human review.

## Governance

```text
14-19: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
14-20-01: EXECUTED — PASS
14-20-02: EXECUTED — PASS
B14-20-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
14-20-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
14-20: NOT YET HUMAN APPROVED
14-21: NOT AUTHORIZED / NOT STARTED
DEPLOY / PR / MERGE / PUSH: NOT AUTHORIZED
REAL PROVIDERS / REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
AUTO-CHAIN: FORBIDDEN
openapi:check: NOT EXECUTED
```

Base HEAD before execution:

`b39d70b561cb97b8b4f5d89f1f46c3ee7485c44d`

## Subagents

Mandatory sequential subagents (`parallelization=false`). Orchestrator: Grok 4.6.

| Order | Subagent | Role | Model | Mode | Verdict |
|---|---|---|---|---|---|
| 1 | [A — Pre-writer audit](17f3b0c0-5f93-4aad-a07a-b720bd032e02) | Confirm clean tree, HEAD, 14-19 registry, baseline hashes, Store-only writer, 14-21 blocked | Grok 4.6 | READ-ONLY | PASS |
| 2 | Orchestrator | Run Store writer (`14-20-01`) | — | write generated Store JSON only | PASS |
| 3 | [B — Artifact / determinism review](96c1ac6b-5106-4678-9f87-953462902420) | Review Store diff, 12/12 operations, BFF AND, examples, Admin/Webhooks | Composer 2.5 | READ-ONLY after writer | PASS |
| 4 | Orchestrator | Repeat writer + auth-contract / walker / Swagger / lint (`14-20-02`) | — | no runtime edits | PASS |
| 5 | [C — Adversarial final review](dc5aa35d-1805-447f-8ac8-a94723024ab6) | Hunt extra files, nondeterminism, sensitive examples, security/Swagger/14-21 drift | Grok 4.6 | READ-ONLY | **14-20 ARTIFACT REVIEW — PASS** |
| 6 | [A — Contract / test intent review](efbdfd33-9859-4d29-b0db-844c47d99ab2) | Confirm Store SHA, 14 paths, `buildContracts()` byte-equal, stale 2-path assertion is the only divergence | Grok 4.6 | READ-ONLY before B14-20-HR-01 edit | PASS |
| 7 | Orchestrator | Replace stale committed-path snapshot with `builtStore.bytes === committedStore` | — | `generation.unit.spec.ts` only | PASS |
| 8 | [B — Remediation review](a856b5ea-8af1-4f64-86aa-d42b1a692bb8) | Confirm no leftover 2-path snapshot, no new 14-path freeze, byte equality, `/auth/session` deny | Composer 2.5 | READ-ONLY after implementation | **B14-20-HR-01 REMEDIATION REVIEW — PASS** |
| 9 | [C — Adversarial final review](89e2839d-6589-472d-aa92-6a6b9cd88208) | Hunt leftover 2-path freeze, new 14-path freeze, hash drift, registry/runtime, 14-21, `openapi:check` | Grok 4.6 | READ-ONLY | **B14-20-HR-01: REMEDIATION REVIEW — PASS** |

No parallel subagent dispatch.

## Writer command

Authorized and executed command (only):

```bash
npm run openapi:generate -w @dtc/backend -- --surface store
```

- exit 0
- stdout: `Generated apps/backend/src/api-docs/generated/store.openapi.json`
- Admin/Webhooks writers were not executed
- no manual JSON editing

Repeat of the same command compared byte-equal (`cmp` PASS) with SHA256 unchanged.

## Generated artifact hashes

| Artifact | Stage | Bytes | SHA256 |
|---|---|---:|---|
| `store.openapi.json` | before (14-19 baseline) | 33096 | `481d1206f00c72e06363b8c17d87b050d3a6ca38d8879480f342da3f4726c4a9` |
| `store.openapi.json` | after writer / after repeat | 82624 | `4e1693221a8b7ffe2f601b4e694cf1f15f42cec1d473b831a07a91894ad81dc7` |
| `admin.openapi.json` | before = after | 98767 | `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` |
| `webhooks.openapi.json` | before = after | 21736 | `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` |

Admin JSON: **BYTE UNCHANGED**. Webhooks JSON: **BYTE UNCHANGED**.

## Diff inventory

Against `b39d70b561cb97b8b4f5d89f1f46c3ee7485c44d`:

```text
apps/backend/src/api-docs/generated/store.openapi.json
  1 file changed, 1560 insertions(+), 35 deletions(-)
```

No other production, registry, runtime, env, dependency, Admin JSON, Webhooks JSON, STATE.md or ROADMAP.md changes.

`git diff --check -- apps/backend/src/api-docs/generated/store.openapi.json`: **PASS**

## Exact-set 12/12

| # | Method + path | Present | Security AND |
|---|---|---|---|
| 1 | `POST /auth/customer/emailpass/register` | YES | BFF + publishable |
| 2 | `POST /auth/customer/emailpass` | YES | BFF + publishable |
| 3 | `POST /auth/token/refresh` | YES | BFF + publishable + refresh header + Idempotency-Key |
| 4 | `POST /auth/customer/emailpass/revoke-current-lineage` | YES | BFF + publishable + customerBearer |
| 5 | `POST /auth/customer/emailpass/reset-password` | YES | BFF + publishable |
| 6 | `POST /auth/customer/emailpass/update` | YES | BFF + publishable + capability body + Idempotency-Key |
| 7 | `GET /store/customers/me` | YES | BFF + publishable + customerBearer |
| 8 | `POST /store/customers/me/verify` | YES | BFF + publishable + customerBearer |
| 9 | `POST /store/customers/verify/resend` | YES | BFF + publishable |
| 10 | `POST /store/customers/verify` | YES | BFF + publishable (`public_bff_no_session`) |
| 11 | `GET /store/customers/me/verify/status` | YES | BFF + publishable + customerBearer |
| 12 | `POST /store/customers/me/password` | YES | BFF + publishable + customerBearer + Idempotency-Key |

Also present: `GET /health/live`, `GET /health/ready`. Extra Phase 14 auth/customer operations: **none**. `/auth/session`, MFA, callbacks and browser logout remain absent.

Generated Store path count: **14** = 2 health + 12 Phase 14. Catalog/cart/payment/tracking remain registry-only in this artifact (not a 14-20 regression; they were already absent from the pre-writer committed JSON).

## BFF security

Store schemes remain exactly:

- `bffServiceCredential` (`apiKey` / header / `x-indicio-bff-auth`) — no example/default
- `publishableApiKey`
- `customerBearer`
- `customerSession`

All 12 Phase 14 operations use a single security object (AND), never OR. All 12 include `bffServiceCredential`. `x-indicio-bff-auth` is not duplicated as an ordinary header parameter. Browser-direct Medusa remains forbidden.

## Determinism

- First writer SHA256: `4e1693221a8b7ffe2f601b4e694cf1f15f42cec1d473b831a07a91894ad81dc7`
- Repeat writer: **byte-equal** (`cmp` PASS), same SHA256
- Subagent C independently compared file bytes to in-memory `buildContracts()` Store bytes: **equal**
- Canonical JSON: lexicographic keys, trailing newline, no `generatedAt`

## Sensitive walker / Swagger

```text
auth-contract.unit.spec.ts: PASS — 24/24
  includes: omits sensitive examples, walker on auth schemas, walker on registered operations, Swagger non-interactive for auth ops
swagger-config.unit.spec.ts: PASS — 11/11
  supportedSubmitMethods: []
  tryItOutEnabled: false
generation.unit.spec.ts walker filter: PASS — 91 passed / 72 skipped
  -t "rejects unsafe examples|rejects examples owned by sensitive|rejects nested sensitive"
openapi:lint: PASS — Spectral 6.16.2 and TypeScript OpenAPI checks
```

No `example` / `examples` / `default` fields in the generated Store JSON. No JWT, `sk_live`/`sk_test`, password literals, capability tokens, real emails, Pix payload, tracking token, cookies, lineage/SID, HMAC or BFF secret values.

## `openapi:check` NOT EXECUTED

Global `npm run openapi:check` was not run by the orchestrator or any subagent. That read-only clean-check remains reserved for plan `14-21` on a clean checkout.

## 14-21 NOT STARTED

No `14-21-SUMMARY.md`. No 14-21 target specs created or modified. STATE.md and ROADMAP.md were not updated.

## Runtime / dependencies / env

Unchanged: registry TypeScript, `auth.ts`, schemas, security-schemes, coverage, validate, manifests, middleware, handlers, auth runtime, jobs, `medusa-config`, schema/migrations, env, `package.json`, lockfile.

## Human-gate disclosure — leftover generation snapshot

`generation.unit.spec.ts` (`keeps Store correlation semantics isolated from stable Admin and generated artifacts`) still asserted committed Store `paths` equal `["/health/live","/health/ready"]` after the 14-20 writer. That freeze was added in 14-19 while the writer had not run.

Human review opened **B14-20-HR-01**. The leftover snapshot was remediated in this same plan (see below). 14-20 originally did **not** edit `generation.unit.spec.ts`; the authorized amendment later allowed that test file plus this SUMMARY.

## Human-review remediation — B14-20-HR-01

Root cause:
`generation.unit.spec.ts` still froze the pre-writer committed Store paths to
health-only, while the approved writer artifact now contains the 12 Phase 14
operations plus health.

Correction:
- removed stale health-only snapshot;
- did NOT replace it with a hardcoded 14-path snapshot;
- committed Store bytes are now proven exactly equal to buildContracts() Store
  bytes;
- `/auth/session` deny proof preserved;
- Admin/Webhooks equality preserved;
- registry/runtime unchanged;
- Store artifact unchanged.

Results:

```text
generation.unit.spec.ts full PASS — 163/163
auth-contract.unit.spec.ts PASS — 24/24
openapi:lint PASS
writer repeat byte-equal
Store SHA unchanged: 4e1693221a8b7ffe2f601b4e694cf1f15f42cec1d473b831a07a91894ad81dc7 (82624 bytes)
Admin SHA unchanged: 6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a (98767 bytes)
Webhooks SHA unchanged: 47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4 (21736 bytes)
openapi:check NOT EXECUTED
14-21 NOT STARTED
STATE.md / ROADMAP.md UNCHANGED
```

Status:

```text
B14-20-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
14-20-01: EXECUTED — PASS
14-20-02: EXECUTED — PASS
14-20-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
14-20: NOT YET HUMAN APPROVED
14-21: NOT AUTHORIZED
```

## Local commits

1. `3c87f8924642e7cb70e13109d890ec5fd00c33bd` — `docs(api-docs): generate Phase 14 Store OpenAPI artifact`
2. `7177415` — `docs(14-20): record Store artifact evidence` — original SUMMARY
3. `3606179f0c34f7923fa3d81ffd63c1dbca7bfc00` — `test(14-20): align generation snapshot with writer artifact`
4. `docs(14-20): record generation snapshot remediation` — this SUMMARY update

No push of this remediation. Branch is ahead of origin locally after these commits.

## Validation checklist (pre-human-gate)

| # | Item | Result |
|---|---|---|
| 1 | writer Store | PASS |
| 2 | Store artifact diff only | PASS |
| 3 | exact-set 12/12 | PASS |
| 4 | `bffServiceCredential` present | PASS |
| 5 | security AND | PASS |
| 6 | sensitive walker | PASS |
| 7 | Swagger non-interactive | PASS |
| 8 | deterministic bytes | PASS |
| 9 | Admin unchanged | PASS |
| 10 | Webhooks unchanged | PASS |
| 11 | auth-contract | PASS — 24/24 |
| 12 | `openapi:lint` | PASS |
| 13 | `git diff --check` | PASS |
| 14 | no runtime/dependency/env changes | PASS |
| 15 | `openapi:check` | NOT EXECUTED |
| 16 | 14-21 | NOT STARTED |
| 17 | B14-20-HR-01 generation snapshot | REMEDIATED — AWAITING HUMAN RE-REVIEW |

## Final status

```text
B14-20-HR-01: REMEDIATED — AWAITING HUMAN RE-REVIEW
14-20-01: EXECUTED — PASS
14-20-02: EXECUTED — PASS
14-20-03: BLOCKING HUMAN VERIFY — AWAITING HUMAN RE-REVIEW
14-20: NOT YET HUMAN APPROVED
14-21: NOT AUTHORIZED
STORE OPENAPI: GENERATED BY WRITER
STORE ARTIFACT: DETERMINISTIC / UNCHANGED BY REMEDIATION
ADMIN OPENAPI: BYTE UNCHANGED
WEBHOOKS OPENAPI: BYTE UNCHANGED
BUILT STORE == COMMITTED STORE: PASS
OPENAPI:CHECK: NOT EXECUTED
RUNTIME: UNCHANGED
STATE / ROADMAP: UNCHANGED
PUSH: NONE
DEPLOY: NONE
REAL PROVIDERS: NONE
REMOTE DB/REDIS: NONE
```

Do not start `14-21` without explicit human approval of `14-20`.
