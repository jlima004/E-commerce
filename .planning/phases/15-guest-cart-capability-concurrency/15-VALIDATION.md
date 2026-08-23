---
phase: 15
slug: guest-cart-capability-concurrency
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-19
replanned: 2026-08-19
requirements: [CART-01, CART-02, CART-03, CART-04, CART-05, CART-06, CART-07, CART-08, CART-09]
manual_review_gate: true
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Rebuilt for the 8-plan serial topology (waves 0–7).
> Derived from `15-RESEARCH.md` § Validation Architecture.
> This file does **not** authorize execution, real providers, remote infra,
> deploy, or frontend. PLAN is separately authorized; EXECUTION is not.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x + `@medusajs/test-utils` 2.16.0 via Medusa (`apps/backend`) |
| **Config file** | `apps/backend/jest.config.js` |
| **Quick run command** | `npm run test:unit -w @dtc/backend -- --runTestsByPath <focused unit path>` |
| **Focused HTTP** | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath <focused HTTP path>` |
| **Focused PostgreSQL** | `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath <one spec>` — exactly one spec per disposable process (P12-12-06-R1) |
| **Full suite command** | serial ledger: focused unit + cart HTTP + cart PG CAS/uniqueness + exact-set/guard + leakage scans + inherited Auth/Order regression |
| **Estimated runtime** | quick unit `<30 s`; full phase gate budget inherited from Phase 14 (serial, stop on first non-zero) |
| **Authority** | PostgreSQL for CAS, `token_hash` uniqueness, and idempotency claim; Redis is coordination only and never grants validity |

Existing Wave 0 harness from Phases 13/14 (disposable Postgres, leakage collectors, multiprocess, `git diff --check`, `openapi:lint` / `openapi:check`) is the base. Phase 15 adds cart-capability, CAS/ETag, and token-leakage proofs; it does not invent a second test runner.

## Sampling Rate

- **After every task commit:** Run the owning task's `<verify><automated>` focused unit (or documented equivalent). Target `<30 s`.
- **After every plan wave:** Run cart HTTP + store-surface guard for the promoted routes, plus `git diff --check`.
- **Before `/gsd-verify-work` / phase gate:** Full serial suite must be green: exact-set + CAS PostgreSQL + token leakage scans + inherited AUTH-01..09 / FND / zero-Order proofs. This ledger is **mandatory** (B15-P-HR-06). Partial PASS is forbidden.
- **Max feedback latency:** `<30 s` for immediate task verify; PG/HTTP matrices and leakage scans belong on plan/phase gates.

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Secure behavior | Planned automated evidence |
|--------|----------|-----------|-----------------|----------------------------|
| CART-01 | Hash-only persistido; plaintext ausente no DB | module + SQL | CSPRNG ≥ 32 bytes; only SHA-256 `token_hash` stored | PG uniqueness/hash-only inspect + leakage canary (15-01, 15-02, 15-08) |
| CART-01 | Sessão sozinha não autoriza mutação M1 | HTTP | `req.session.active_cart_id` is not the primary possession proof | HTTP mutation without capability denied (15-03) |
| CART-02 | Token ausente de body, URL, logs, OpenAPI examples | unit + lint scan | header `x-indicio-guest-cart-token` only | leakage scan + OpenAPI example scan (15-03, 15-07, 15-08) |
| CART-03 | Expirado/revogado/consumido → erro uniforme | HTTP | ownership/expiry/revocation fail closed with uniform error | HTTP matrix expired/revoked/consumed/wrong (15-04, 15-08) |
| CART-04 | Mesma Idempotency-Key → mesmo cart_id; GET não cria | HTTP | lazy create/get; canonical cart state | HTTP create/retry/GET-empty (15-03, 15-04) |
| CART-04 / Q-11 | Replay não devolve header da capability; refetch canônico | HTTP | emit-once; replay 200 materializes current cart | HTTP replay after 201 (15-04, 15-08) |
| CART-05 | Workflow nativo via rota local; nativo HTTP ainda DENY | HTTP + guard | no second cart engine; native create/read/complete/attach/shipping remain DENY | HTTP add/update/delete/clear + native DENY (15-05, 15-06, 15-08) |
| CART-06 | 1–99; 0 remove; rejeitar decimal/negativo/>99 | unit + HTTP | integer qty only; genuine non-integers `1.5`/`1.1`/`98.9` | unit + HTTP 1/99/0/-1/100/decimal (15-05, 15-08) |
| CART-07 / CART-08 | If-Match stale → 412 + snapshot sem token | HTTP + PG CAS | monotonic version; `ETag`; `markFailedTerminal` + `CART_VERSION_MISMATCH`; same-key replay remains 412 with zero mutation | HTTP stale aba + PG CAS (15-04, 15-05, 15-06, 15-08) |
| CART-09 | Mutação chama invalidação PA + hook SHP no-op | unit | invalidate incompatible PA; quote/select hook no-op until Phase 18; no Gelato | unit invalidation + SHP no-op (15-05, 15-06, 15-08) |
| FND / AUTH inherit | Exact-set 6 auth intacto; complete DENY; zero Order | HTTP herdado | Phase 14 Auth M1 exact-set preserved; `POST /store/carts/{id}/complete` DENY; canonical webhook remains Order birth | inherited HTTP + Order count zero (15-08) |

Frontend traceability (not extra requirements): `FE-CART-001..005`, `FE-CART-008`; `FE-PAY-006` crosses CART-09 / PAY-07.

Human-review blockers this topology must close:

| ID | Closed in |
|---|---|
| B15-P-HR-01 POST ACTIVE CAPABILITY CONTRACT / OPENAPI DRIFT | 15-03 runtime; 15-07 OpenAPI |
| B15-P-HR-02 IDEMPOTENCY REPLAY MATERIALIZATION | 15-04 |
| B15-P-HR-03 VALIDATION / CLAIM ORDER + CLAIM LIFECYCLE | 15-05 (reused 15-06) |
| B15-P-HR-04 CUSTOMER ACTIVE REGRESSION BETWEEN WAVES | 15-03 |
| B15-P-HR-05 IMPOSSIBLE 1.0 NUMERIC TEST | 15-05 |
| B15-P-HR-06 FINAL REGRESSION GATE IS OPTIONAL | 15-08 |

Human-review blockers closed by this documentary remediation (still pending human re-review; not execution evidence):

| ID | Closed in |
|---|---|
| B15-P-RP-HR-01 conditional Customer access on mixed Guest/Customer routes | 15-03 |
| B15-P-RP-HR-02 execution subagent policy not encoded | 15-01 (canonical); 15-03/15-04/15-05 reference; this file binds 15-02..15-08 |
| B15-P-RP-HR-03 active create→mint partial-effect policy | 15-04 |
| Stale If-Match deterministic `failed_terminal` | 15-05 |

## Per-Task Verification Map

One row per executable (`type=auto`) task, bound to the PLAN `<automated>` command. Status stays pending until execution (not authorized in this gate). Checkpoint tasks keep `git diff --check` and are omitted here.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 0 | CART-01..09 | T-15-01-* | clock/entropy/CAS/leakage/exact-set; no production hash | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-validation-foundation.unit.spec.ts` | named | ⬜ pending |
| 15-01-02 | 01 | 0 | CART-01 | T-15-01-* | hash-only PG probe + UNIQUE token_hash | PG | `node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/guest-cart-validation-foundation.postgres.spec.ts` | named | ⬜ pending |
| 15-02-01 | 02 | 1 | CART-01, CART-02 | T-15-02-* | DB_MODEL + production generate/hash/compare | docs+unit | `node -e "const s=require('fs').readFileSync('docs/DB_MODEL_v1.22.md','utf8'); for (const x of ['GuestCartCapability','guest_cart_capability','token_hash','consumed','gccap','7d','30d']) if (!s.includes(x)) throw new Error('missing '+x)" && npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-capability-hash.unit.spec.ts` | named | ⬜ pending |
| 15-02-02 | 02 | 1 | CART-01, CART-03 | T-15-02-* | mint hash-only; dummy-miss lookup | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-capability-service.unit.spec.ts` | named | ⬜ pending |
| 15-02-03 | 02 | 1 | CART-01, CART-03 | T-15-02-* | module+link+UNIQUE+one-active | unit+PG | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/infrastructure/__tests__/medusa-config.unit.spec.ts && node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-capability.postgres.spec.ts` | named | ⬜ pending |
| 15-03-01 | 03 | 2 | CART-02, CART-04 | T-15-03-01 | sibling BFF tuple of 6; conditional actor A/B/C; no raw access guard on mixed matchers | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/bff-protected-operations.unit.spec.ts src/modules/checkout/__tests__/active-cart.unit.spec.ts` | named | ⬜ pending |
| 15-03-02 | 03 | 2 | CART-01, CART-02, CART-04 | T-15-03-* | active M1=8 Guest+Customer; invalid-present no create | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts src/modules/checkout/__tests__/active-cart.unit.spec.ts` | named | ⬜ pending |
| 15-03-03 | 03 | 2 | CART-01, CART-02, CART-04 | T-15-03-* | HTTP tracer Guest+Customer; no describe.skip | HTTP | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-bff-guard.spec.ts integration-tests/http/guest-cart-tracer.spec.ts integration-tests/http/customer-cart-active.spec.ts integration-tests/http/cart-checkout-store.spec.ts` | named | ⬜ pending |
| 15-04-01 | 04 | 3 | CART-07, CART-08 | T-15-04-* | ETag quoted; 412 snapshot DTO | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/concurrency.unit.spec.ts src/api/store-surface/__tests__/errors.unit.spec.ts` | named | ⬜ pending |
| 15-04-02 | 04 | 3 | CART-03 | T-15-04-* | TTL 7d/30d; uniform 404 | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/guest-cart-capability/__tests__/guest-cart-capability-lifecycle.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-lifecycle.spec.ts` | named | ⬜ pending |
| 15-04-03 | 04 | 3 | CART-04 | T-15-04-* | replay 200 refetch; Q-11 Option A; post-create/pre-capability failure does not create a second cart | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/__tests__/idempotency-scope.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-idempotency.spec.ts integration-tests/http/guest-cart-tracer.spec.ts integration-tests/http/customer-cart-active.spec.ts` | named | ⬜ pending |
| 15-05-01 | 05 | 4 | CART-06, CART-09 | T-15-05-* | genuine decimals; CART-09 helper before mutation | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store/carts/line-items/__tests__/validators.unit.spec.ts src/modules/checkout/__tests__/shipping-invalidation.unit.spec.ts src/modules/payment-attempt/__tests__/cart-invalidation-cart-m1.unit.spec.ts` | named | ⬜ pending |
| 15-05-02 | 05 | 4 | CART-05..09 | T-15-05-* | add pipeline validate→claim→If-Match; Guest+Customer; stale 412 = failed_terminal deterministic replay | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-line-item-add.spec.ts integration-tests/http/customer-cart-line-items.spec.ts` | named | ⬜ pending |
| 15-05-03 | 05 | 4 | CART-05..09 | T-15-05-* | update qty 0=remove; genuine decimals HTTP | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts src/api/store/carts/line-items/__tests__/validators.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-line-item-update.spec.ts integration-tests/http/customer-cart-line-items.spec.ts` | named | ⬜ pending |
| 15-06-01 | 06 | 5 | CART-05, CART-07, CART-08 | T-15-06-* | DELETE by line_id | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-line-item-delete.spec.ts integration-tests/http/customer-cart-line-items.spec.ts` | named | ⬜ pending |
| 15-06-02 | 06 | 5 | CART-05, CART-07, CART-08 | T-15-06-* | clear-all + COUNT_TOTAL 64; empty no bump | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-line-item-clear.spec.ts` | named | ⬜ pending |
| 15-06-03 | 06 | 5 | CART-09, CART-05 | T-15-06-* | native DENY + Guest/Customer matrix | unit+HTTP | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api/store-surface/__tests__/manifest.unit.spec.ts && npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-native-deny.spec.ts integration-tests/http/customer-cart-line-items.spec.ts integration-tests/http/guest-cart-line-item-add.spec.ts integration-tests/http/guest-cart-line-item-update.spec.ts integration-tests/http/guest-cart-line-item-delete.spec.ts integration-tests/http/guest-cart-line-item-clear.spec.ts` | named | ⬜ pending |
| 15-07-01 | 07 | 6 | CART-02, CART-04, CART-08 | T-15-07-* | request header on all 6 ops; 201 response emit-once | unit | `npm run test:unit -w @dtc/backend -- --runTestsByPath src/api-docs/__tests__/store-contract.unit.spec.ts` | named | ⬜ pending |
| 15-07-02 | 07 | 6 | CART-02, CART-08 | T-15-07-* | writer-only Store artifact; lint | lint | `npm run openapi:lint -w @dtc/backend` | named | ⬜ pending |
| 15-08-01 | 08 | 7 | CART-01..09 | T-15-08-* | matrix HTTP + one-spec Order PG | HTTP+PG | `npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/guest-cart-contract-matrix.spec.ts && node apps/backend/scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -w @dtc/backend -- --runTestsByPath integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` | named | ⬜ pending |
| 15-08-02 | 08 | 7 | CART-01..09 | T-15-08-* | mandatory full serial ledger | check+suites | `npm run openapi:check -w @dtc/backend && npm run test:unit -w @dtc/backend && npm run test:integration:modules -w @dtc/backend && npm run test:integration:http -w @dtc/backend && npm run openapi:lint -w @dtc/backend && npm run lint -w @dtc/backend && npm run build -w @dtc/backend && git diff --check && git status --short` | named | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. File Exists = named in PLAN; not created until authorized execution.*

Nyquist continuity is a PLAN checker Dimension 8 gate. Bound 21/21 auto tasks. Execution remains NOT AUTHORIZED. `nyquist_compliant: true` after Subagent C coverage PASS (2026-08-19): all auto tasks have verify; no 3 consecutive production tasks without automated feedback; CART-01..09 coverage complete; no watch mode; final inherited proofs included; execution still unauthorized.

## Wave 0 Requirements

Reuse Phase 13/14 infrastructure. Phase 15 Wave 0 (plan 15-01) must include:

- [ ] Deterministic clock helper for guest-cart tests (do **not** copy auth HKDF/nonce/45s recovery).
- [ ] Deterministic 32-byte entropy source (injectable). Production generate/hash/compare **must not** be implemented in Wave 0.
- [ ] Hash-only PostgreSQL inspector on a probe table: plaintext token absent; `token_hash` unique.
- [ ] CAS helper on `StoreResourceVersion` for cart structural mutations (do **not** use Phase 13 bigint-as-version schema).
- [ ] Leakage canaries: header token absent from body, URL, logs, Sentry, analytics, OpenAPI examples, snapshots.
- [ ] Store-surface exact-set assertion helper: Auth M1 remains 6; cart promotions are explicit; native cart mutations stay DENY until owner enablement.
- [ ] Serial disposable Postgres runner remains one spec per process.

*Existing infrastructure covers the runner; Phase 15 still needs cart-capability-specific helpers before mutation routes are enabled.*

## Required Future Proofs

1. Guest capability is CSPRNG ≥ 32 bytes, persisted hash-only; session is not the M1 possession proof.
2. Token never appears in JSON body, URL, query, logs, Sentry, analytics, or OpenAPI examples.
3. Create is lazy/idempotent; GET does not create; replay after lost 201 does not re-emit the secret (Q-11 Option A). Replay HTTP 200 refetches canonical cart + current ETag. Mint is 201.
4. Line-item add/update/delete/clear reuse Medusa 2.16.0 workflows via local routes; native HTTP cart mutations remain DENY.
5. Quantity is integer 1–99; update `0` removes; genuine non-integers (`1.5`, `1.1`, `98.9`), negative and `>99` rejected. JSON `1` and `1.0` are the same Number.
6. Structural mutation increments server-authoritative version; mutations require `If-Match`; stale → `412 CART_VERSION_MISMATCH` with token-free canonical snapshot.
7. `Idempotency-Key` does not prove ownership. Validation happens before claim; claim happens before `If-Match`. Same-intent retry must not become a false `412` solely because the first execution advanced ETag. Claims must not remain abandoned in `processing`.
8. Structural mutation invalidates incompatible PaymentAttempt and records SHP quote/select as no-op; no Gelato in this phase. Helper exists before the first M1 mutation.
9. Phase 14 Auth exact-set (6 M1 routes) and Order-birth invariant remain closed; cart mutations create zero Orders.
10. Dual-run session + capability is documented per route until Phase 19; BFF-only; browser-direct Medusa remains forbidden.
11. Customer GET/POST active ship in the same cut as guest active M1. No `describe.skip` bridge.
12. POST active: absent header creates; present-invalid header returns uniform 404 and does not create. Request header is documented on all six Cart M1 operations.
13. Final regression ledger is mandatory. Incomplete ledger is BLOCKED, never PASS.
14. Mixed Guest+Customer cart routes: Guest request without Customer `Authorization` is not blocked by the Customer access guard. `Authorization` triggers Phase-14 Customer access authority only when present. Invalid-present capability never falls through to Customer. Raw `customerAuthAccessGuardMiddleware` is not mounted unconditionally on the six mixed cart matchers.
15. Execution subagent policy exists in 15-01 (`Phase 15 Execution Orchestration Policy`) and is mandatory when EXECUTION is authorized. It does not authorize EXECUTION. Each executed PLAN must run sequential subagents: audit + implementation + verification + adversarial review. Human checkpoint between PLANs remains blocking.
16. Simulated post-create / pre-capability failure does not create two carts for the same idempotent intention; no secret recovery; no abandoned `processing`. Classify with existing store-idempotency states only; never `failed_retryable` after confirmed create if that would allow a second create.
17. Stale If-Match = `markFailedTerminal` + `failure_code CART_VERSION_MISMATCH` + HTTP 412 + current canonical snapshot + current ETag + zero mutation. Same-key + same-fingerprint replay remains 412 without re-executing CAS/workflow.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Human review between plans | CART-01..CART-09 | project policy (`mode=interactive`) | stop after each SUMMARY; only explicit approval unlocks next plan; sequential subagents per 15-01 policy when EXECUTION is authorized |
| TTL numeric (7d rolling / 30d cap) | CART-03 | RESEARCH default; human may adjust at PLAN review | confirm PLAN lock; do not call remote clocks/providers |
| Q-11 orphan policy | CART-04 | RESEARCH recommendation locked as P15-D09 Option A | confirm PLAN records default vs rotation-on-replay |
| Real providers / remote infra | — | explicitly unauthorized | do not call Stripe/Resend/Gelato/Supabase remote/Redis remote |
| Frontend cookie write (perda A) | CART-02 / FE-CART-002 | frontend BLOCKED this milestone | backend proves header emit-once; BFF/browser cookie is out of scope |

Automated verification covers all in-scope CART behaviors once PLAN binds commands. The rows above are governance/authorization, not missing product tests.

## Exact-set staging

| After plan | total | native | local | EXTENDED | DENY | PRESERVE_LEGACY | M1 | n+le |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 15-01 / 15-02 | 63 | 51 | 12 | 15 | 50 | 7 | 6 | 2 |
| 15-03 / 15-04 | 63 | 51 | 12 | 15 | 50 | 5 | 8 | 2 |
| 15-05 | 63 | 51 | 12 | 15 | 48 | 5 | 10 | 4 |
| 15-06 / 15-07 / 15-08 | 64 | 51 | 13 | 16 | 47 | 5 | 12 | 5 |

## Validation Sign-Off

Marked from Subagent C coverage checker PASS (2026-08-19), not from execution. Wave 0 helpers and per-task Status remain pending because EXECUTION is not authorized.

- [x] All auto tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive production tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s for task-level unit verify
- [x] `nyquist_compliant: true` set in frontmatter after checker proves the items above
- [x] CART-01..CART-09 each appear in at least one PLAN `requirements` field
- [x] Inherited Auth M1 exact-set and zero-Order proofs are in the phase gate
- [x] Final regression ledger is mandatory (no optional language)
- [x] Exactly 8 active PLAN files; linear 01→08; waves 0–7
- [x] No execution, deploy, real provider, remote infra, or frontend is authorized by this file
- [x] 15-01 encodes `Phase 15 Execution Orchestration Policy` (future how-to; not EXECUTION authorization)

**Approval:** per-task map bound from PLAN `<automated>` commands. Execution remains NOT AUTHORIZED.
`wave_0_complete` remains **false**.
