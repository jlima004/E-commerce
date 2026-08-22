# Phase 15 — PR #27 Post-Closure Remediation

## Trigger

Codex PR review on PR #27 (`gsd/phase-15-guest-cart-capability-concurrency`),
against reviewed commit `d2d78723e783eaa4e04cbf7fff3f0315bbc0f385`.

The phase was historically `HUMAN APPROVED — CLOSED`. The human-authorized
post-closure remediation addressed the six accepted findings B15-PR27-HR-01
through B15-PR27-HR-06. This record is additive and does not rewrite
`15-08-SUMMARY.md` or `15-CLOSURE.md`.

**Final remediation status:** `REMEDIATED — AWAITING HUMAN RE-REVIEW`.

## Findings and technical result

| Finding | Severity | Root cause | Files changed / evidence | Technical result |
|---|---:|---|---|---|
| B15-PR27-HR-01 | P1 | Cart CAS/version commit and PaymentAttempt invalidation could complete in separate transactional windows, allowing stale webhook authority. | `apps/backend/src/modules/payment-attempt/transactional-authority.ts`; `apps/backend/src/api/store/carts/line-item-mutation.ts`; `apps/backend/src/api/store/carts/shipping-invalidation.ts`; webhook/order authority and regression fixtures. | Cart mutation, invalidation, advisory locking, conditional PaymentAttempt transition and Order-entrypoint validation are PostgreSQL-transactional and fail closed. Focused unit/PG and full regressions PASS. |
| B15-PR27-HR-02 | P1 | Capability lookup, lifecycle validation and touch were not one authorization boundary. | `apps/backend/src/modules/guest-cart-capability/service.ts`, types and capability/transaction tests. | Active, unexpired, unconsumed and not revoked state is checked and conditionally touched in the mutation transaction; terminal capabilities cannot authorize or revive. Unit and disposable PostgreSQL interleavings PASS. |
| B15-PR27-HR-03 | P2 | A post-CAS refetch could pair a later body snapshot with an earlier ETag. | `apps/backend/src/api/store/carts/line-item-mutation.ts` and add/update/delete/clear/snapshot HTTP tests. | Successful, replay and `412` responses use one transaction-scoped canonical snapshot/version pair. Deterministic A/B interleaving and composed error tests PASS. |
| B15-PR27-HR-04 | P2 | The declared Cart ↔ GuestCartCapability link was not materialized. | `apps/backend/src/api/store/carts/active/route.ts`; `guest-cart-capability-link.postgres.spec.ts`. | Real `LINK.create`, traversal/idempotency and explicit link/capability/cart compensation are proven. Link failure leaves no active orphan cart/capability and no plaintext. |
| B15-PR27-HR-05 | P2 | `POST /store/carts/active` runtime 409 outcomes were absent from the authoritative Store OpenAPI. | `apps/backend/src/api-docs/operations/store/carts.ts`, Store contract tests and generated Store artifact. | Public 409 is `StoreErrorResponse` with `CONFLICT`, correlation header and semantic coverage for reuse, in-progress and terminal/reconciliation conflicts; internal diagnostics remain private. |
| B15-PR27-HR-06 | P2 | Cart mutation `412` documented the body but not its current `ETag`; the global Sentry composition also dropped it. | `apps/backend/src/api-docs/operations/store/carts.ts`, `apps/backend/src/api/middlewares.ts`, contract tests and native evidence fingerprints. | Cart `CART_VERSION_MISMATCH` documents and emits `StoreErrorResponse`, `x-correlation-id` and `ETag`; unrelated errors do not receive `ETag`. |

The six findings are not marked closed. Each remains
`REMEDIATED — AWAITING HUMAN RE-REVIEW`.

## Implementation commits

- `41722de371a8c334f1bd932fce1582e7f5feb029` — `fix(cart): remediate PR27 concurrency findings`
- `a4663883466345f8f6ed67a2ecfeabba38bdfce8` — `docs(api): align cart conflict and etag contracts`
- `9baec0ff4d2452010d3a5d65f7658d885c43048d` — `test(cart): align order authority fixtures`
- `a0e7dce9543542fabc3537ed1fe543e0bf33ad7d` — `test(cart): align HTTP authority fixtures`
- `c987b4b6a17a676ab1037f31f9f218693f4db143` — `fix(cart): close adversarial cart gaps`
- `6c22e19b8aca47fa9858680565496744c991d223` — `fix(api): preserve cart mismatch etag`
- `0901986be9fc13238d40da131dcf79f9e2fb747e` — `test(api-docs): refresh native evidence fingerprints`

## Subagent evidence

All subagents used the mandatory model GPT 5.6 Luna. Runtime handles are
recorded where exposed; the subagent reports themselves identify the agent ID
as not exposed by the runtime.

### Subagent A — Root Cause / Design Audit

- model: GPT 5.6 Luna
- id: `01a02a6b-51b7-7dc3-865e-a289d0e8f156`
- mode: READ-ONLY
- files inspected: Phase-15 authorities, cart mutation/active routes, capability service, PaymentAttempt state/invalidation, Stripe webhook and Order entrypoint, module links, middleware and API Docs machinery.
- files modified: none
- tests executed: design/interleaving audit; no writes or test changes
- verdict: PASS as root-cause handoff; the six accepted race/contract gaps were confirmed and routed to B–E
- blockers found: HR-01 through HR-04 required implementation before final verification

### Subagent B — Payment / Order Safety Remediation

- model: GPT 5.6 Luna
- id: `01a02a76-494a-75d3-9ac3-4055e9b8c928`
- mode: WRITE + TEST
- files modified: payment transactional authority, cart mutation/invalidation and webhook/order-authority code, focused PaymentAttempt unit/PG tests, and affected Order/HTTP authority fixtures
- tests executed: focused transactional-authority unit `1 suite / 4 tests`; disposable PostgreSQL `1 suite / 3 tests`; subsequent authority fixture suites PASS; final broad ledger PASS
- verdict: PASS
- blockers found: initial authority fixtures required alignment after the transactional contract was correctly hardened; no unresolved blocker

### Subagent C — Capability Atomicity Remediation

- model: GPT 5.6 Luna
- id: `01a02a9a-c81e-7d12-b508-6355c2c9580b`
- mode: WRITE + TEST
- files modified: GuestCartCapability service/types, cart authorization path and unit/disposable-PostgreSQL capability tests
- tests executed: `3 suites / 44 tests` unit; `1 suite / 12 tests` disposable PostgreSQL; exit 0
- verdict: PASS
- blockers found: none after the transaction-bound authorization correction

### Subagent D — Cart Response / Module Link Remediation

- model: GPT 5.6 Luna
- id: `01a02aa9-17ae-7721-b490-4dccccca3fd9`
- mode: WRITE + TEST
- files modified: active-cart link/compensation route and focused Guest Cart HTTP/PG tests; later adversarial pass strengthened response-body assertions and orphan cleanup proof
- tests executed: final focused PG `1 suite / 1 test`, unit `2 suites / 47 tests`, HTTP `5 suites / 29 tests`, all exit 0; P12 cleanup confirmed
- verdict: PASS
- blockers found: first link PG invocation needed the repository disposable runner/region fixture; resolved before final PASS. First adversarial review also required explicit cart-orphan compensation, then PASS.

### Subagent E — OpenAPI Contract Remediation

- model: GPT 5.6 Luna
- id: `01a02ac0-3d3c-7cc1-84b7-3b822e00e7cd`
- mode: WRITE + TEST
- files modified: Store Cart registry/tests/generated Store artifact; Sentry error middleware/composition test; six native evidence fingerprints
- tests executed: API Docs `15 suites / 406 tests`; focused Store contract `1 suite / 24 tests`; native evidence owner `15/15`; related API Docs `5 suites / 248 tests`; Store error contract `17/17`; OpenAPI generation, lint and Store verification PASS; `git diff --check` PASS
- verdict: PASS
- blockers found: first adversarial F run exposed native evidence fingerprint drift after the legitimate middleware change; six hashes were refreshed in `native-routes.ts`, with operations/URLs/owners/24 bindings unchanged, then all owner/API Docs tests PASS.

### Subagent F — Integration / Regression Verification

- model: GPT 5.6 Luna
- id: `01a02ac6-c7ff-7ae2-a5c7-be7de1faa982`
- mode: READ + EXECUTE TESTS
- files modified: none
- tests executed: final ledger and residual exact-set/security/multiprocess proofs recorded below
- verdict: initial run BLOCKED at Unit item 3 by native fingerprint drift; after E correction, final PASS with no RED
- blockers found: only the resolved fingerprint drift; no unresolved test or infrastructure blocker

### Subagent G — Adversarial Final Review

- model: GPT 5.6 Luna
- id: `01a02b0c-82d4-7a80-a441-f8cd4f671421`
- mode: READ-ONLY
- files modified: none
- tests executed: adversarial code/test/evidence review; it relied on F's final test ledger and did not re-run tests
- verdict: initial review BLOCKED on body/ETag composition, link-failure orphan compensation and Sentry ETag propagation; after D/E corrections, final PASS
- blockers found: those three counterexamples were corrected and explicitly re-audited; no remaining material counterexample

## Verification ledger

All commands below exited `0` unless stated otherwise. The ledger obeyed
stop-on-first-RED: F's first post-adversarial run stopped at the native
fingerprint RED, and the corrected run restarted from item 1.

### Final F broad ledger

| Check | Exact command / cwd | Result |
|---|---|---|
| PG link | cwd `apps/backend`: `node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/guest-cart-capability-link.postgres.spec.ts --runInBand` | `1/1 suite`, `2/2 tests`, exit 0; P12 cleanup PASS |
| HTTP focused | root: `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-line-item-add.spec.ts integration-tests/http/guest-cart-line-item-clear.spec.ts integration-tests/http/guest-cart-line-item-delete.spec.ts integration-tests/http/guest-cart-line-item-update.spec.ts integration-tests/http/guest-cart-mutation-snapshot-concurrency.spec.ts integration-tests/http/store-error-contract.spec.ts` | `6/6 suites`, `46/46 tests`, exit 0 |
| Full Unit | root: `npm run test:unit -w @dtc/backend` | `102/102 suites`, `1863/1863 tests`, `1 snapshot`, exit 0 |
| Full Modules | root: `npm run test:integration:modules -w @dtc/backend` | `62/62 suites`, `889/889 tests`, exit 0 |
| Full HTTP | root: `npm run test:integration:http -w @dtc/backend` | `49/49 suites`, `565/565 tests`, exit 0 |
| OpenAPI drift | root: `npm run openapi:check -w @dtc/backend` | exit 0 |
| OpenAPI lint | root: `npm run openapi:lint -w @dtc/backend` | exit 0 |
| Lint | root: `npm run lint -w @dtc/backend` | exit 0, 0 errors |
| Build | root: `npm run build -w @dtc/backend` | exit 0; backend/frontend completed |
| Diff/worktree | root: `git diff --check`; `git status --short` | exit 0; clean |

### Residual final proofs

| Proof | Exact command / cwd | Result |
|---|---|---|
| Exact-set | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts` | `1/1 suite`, `9/9 tests`, exit 0 |
| Native DENY | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-native-deny.spec.ts` | `1/1 suite`, `6/6 tests`, exit 0 |
| Contract/order matrix | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-contract-matrix.spec.ts integration-tests/http/invariants-inv01-02-order-birth.spec.ts` | `2/2 suites`, `13/13 tests`, exit 0 |
| PG Order invariants | cwd `apps/backend`: `node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts --runInBand` | `1/1 suite`, `2/2 tests`, exit 0; P12 cleanup PASS |
| Multiprocess | `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/auth-multiprocess.spec.ts` | `1/1 suite`, `10/10 tests`, exit 0; P12 cleanup PASS |
| Leakage/security | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-validation-foundation.unit.spec.ts src/api/store-surface/__tests__/security-negative.unit.spec.ts` | `2/2 suites`, `21/21 tests`, exit 0 |

The focused API Docs evidence is `15/15 suites / 406/406 tests`, and the
generated Store artifact was produced by the repository writer. Admin and
Webhooks generated artifacts remained byte-identical. No provider, remote
database, remote Redis or production side effect was used.

## Invariants

- Order birth preserved: Store/BFF synchronous Cart paths create `0` Orders.
- `payment_intent.succeeded` remains the sole accepted canonical webhook Order authority.
- Store exact-set unchanged: `64 / 51 / 13 / 16 / 47 / 5 / 12`.
- Auth M1: `6`; Cart M1: `6`; Global M1: `12`; native Cart bypass remains DENY.
- Capability leakage: `ZERO` across database, Redis/jobs, logs, Sentry, OpenAPI, fixtures/snapshots, analytics and persisted provider payloads.
- Real providers: `NONE`; remote DB/Redis: `NONE`.
- BFF service authority remains required; no Store M1 promotion was introduced.
- Historical `15-08-SUMMARY.md` and `15-CLOSURE.md`: unchanged.

## Governance

- Phase 15: `HISTORICALLY HUMAN APPROVED — CLOSED`.
- PR #27 remediation: `IMPLEMENTED — AWAITING HUMAN RE-REVIEW`.
- B15-PR27-HR-01..HR-06: `REMEDIATED — AWAITING HUMAN RE-REVIEW`.
- Phase 16 CONTEXT: `DOCUMENTALLY AUTHORIZED`; execution is suspended pending human acceptance of this PR-27 remediation.
- Phase 16 RESEARCH+: `NOT AUTHORIZED`.
- Merge, deploy, release, frontend, real providers and remote infrastructure: `NOT AUTHORIZED`.
- PR #27 is not merged and no review thread is being resolved as human acceptance.
