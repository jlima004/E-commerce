---
phase: 15
slug: guest-cart-capability-concurrency
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-19
requirements: [CART-01, CART-02, CART-03, CART-04, CART-05, CART-06, CART-07, CART-08, CART-09]
manual_review_gate: true
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
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
- **Before `/gsd-verify-work` / phase gate:** Full serial suite must be green: exact-set + CAS PostgreSQL + token leakage scans + inherited AUTH-01..09 / FND / zero-Order proofs.
- **Max feedback latency:** `<30 s` for immediate task verify; PG/HTTP matrices and leakage scans belong on plan/phase gates.

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Secure behavior | Planned automated evidence (planner binds exact paths) |
|--------|----------|-----------|-----------------|--------------------------------------------------------|
| CART-01 | Hash-only persistido; plaintext ausente no DB | module + SQL | CSPRNG ≥ 32 bytes; only SHA-256 `token_hash` stored | PG uniqueness/hash-only inspect + leakage canary |
| CART-01 | Sessão sozinha não autoriza mutação M1 | HTTP | `req.session.active_cart_id` is not the primary possession proof | HTTP mutation without capability denied |
| CART-02 | Token ausente de body, URL, logs, OpenAPI examples | unit + lint scan | header `x-indicio-guest-cart-token` only | leakage scan + OpenAPI example scan |
| CART-03 | Expirado/revogado/consumido → erro uniforme | HTTP | ownership/expiry/revocation fail closed with uniform error | HTTP matrix expired/revoked/consumed/wrong |
| CART-04 | Mesma Idempotency-Key → mesmo cart_id; GET não cria | HTTP | lazy create/get; canonical cart state | HTTP create/retry/GET-empty |
| CART-04 / Q-11 | Replay não devolve header da capability | HTTP | emit-once; replay does not re-emit secret | HTTP replay after 201 |
| CART-05 | Workflow nativo via rota local; nativo HTTP ainda DENY | HTTP + guard | no second cart engine; native create/read/complete/attach/shipping remain DENY | HTTP add/update/delete/clear + native DENY |
| CART-06 | 1–99; 0 remove; rejeitar decimal/negativo/>99 | unit + HTTP | integer qty only | unit + HTTP 1/99/0/-1/100/decimal |
| CART-07 / CART-08 | If-Match stale → 412 + snapshot sem token | HTTP + PG CAS | monotonic version; `ETag`; no destructive retry | HTTP stale aba + PG CAS |
| CART-09 | Mutação chama invalidação PA + hook SHP no-op | unit | invalidate incompatible PA; quote/select hook no-op until Phase 18; no Gelato | unit invalidation + SHP no-op |
| FND / AUTH inherit | Exact-set 6 auth intacto; complete DENY; zero Order | HTTP herdado | Phase 14 Auth M1 exact-set preserved; `POST /store/carts/{id}/complete` DENY; canonical webhook remains Order birth | inherited HTTP + Order count zero |

Frontend traceability (not extra requirements): `FE-CART-001..005`, `FE-CART-008`; `FE-PAY-006` crosses CART-09 / PAY-07.

## Per-Task Verification Map

Planner must expand this into one row per executable task. Status stays pending until execution (not authorized in this gate).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(bound by PLAN.md)* | — | — | CART-01..CART-09 | T-15-* / RESEARCH residual risks | see map above | unit / HTTP / PG | focused `--runTestsByPath` only | ❌ until PLAN names files | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Nyquist continuity: no 3 consecutive production-code tasks without an automated verify. Sampling continuity is a PLAN checker Dimension 8 gate.

## Wave 0 Requirements

Reuse Phase 13/14 infrastructure. Phase 15 Wave 0 (planner names exact files) must include:

- [ ] Deterministic CSPRNG/clock helper for guest-cart capability issuance (do **not** copy auth HKDF/nonce/45s recovery).
- [ ] Hash-only PostgreSQL inspector: plaintext token absent; `token_hash` unique.
- [ ] CAS helper on `StoreResourceVersion` for cart structural mutations (do **not** use Phase 13 bigint-as-version schema).
- [ ] Leakage canaries: header token absent from body, URL, logs, Sentry, analytics, OpenAPI examples, snapshots.
- [ ] Store-surface exact-set assertion helper: Auth M1 remains 6; cart promotions are explicit; native cart mutations stay DENY until owner enablement.
- [ ] Serial disposable Postgres runner remains one spec per process.

*Existing infrastructure covers the runner; Phase 15 still needs cart-capability-specific helpers before mutation routes are enabled.*

## Required Future Proofs

1. Guest capability is CSPRNG ≥ 32 bytes, persisted hash-only; session is not the M1 possession proof.
2. Token never appears in JSON body, URL, query, logs, Sentry, analytics, or OpenAPI examples.
3. Create is lazy/idempotent; GET does not create; replay after lost 201 does not re-emit the secret (Q-11 Option A unless PLAN records an explicit human lock otherwise).
4. Line-item add/update/delete/clear reuse Medusa 2.16.0 workflows via local routes; native HTTP cart mutations remain DENY.
5. Quantity is integer 1–99; update `0` removes; decimal/negative/`>99` rejected.
6. Structural mutation increments server-authoritative version; mutations require `If-Match`; stale → `412 CART_VERSION_MISMATCH` with token-free canonical snapshot.
7. `Idempotency-Key` does not prove ownership and must not turn a same-intent retry into a false `412` solely because the first execution advanced ETag (RESEARCH “Must Be Decided in PLAN”).
8. Structural mutation invalidates incompatible PaymentAttempt and records SHP quote/select as no-op; no Gelato in this phase.
9. Phase 14 Auth exact-set (6 M1 routes) and Order-birth invariant remain closed; cart mutations create zero Orders.
10. Dual-run session + capability is documented per route until Phase 19; BFF-only; browser-direct Medusa remains forbidden.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Human review between plans | CART-01..CART-09 | project policy (`mode=interactive`) | stop after each SUMMARY; only explicit approval unlocks next plan |
| TTL numeric (7d rolling / 30d cap) | CART-03 | RESEARCH default; human may adjust at PLAN review | confirm PLAN lock; do not call remote clocks/providers |
| Q-11 orphan policy | CART-04 | RESEARCH recommendation, not a D15 lock | confirm PLAN records default vs rotation-on-replay |
| Real providers / remote infra | — | explicitly unauthorized | do not call Stripe/Resend/Gelato/Supabase remote/Redis remote |
| Frontend cookie write (perda A) | CART-02 / FE-CART-002 | frontend BLOCKED this milestone | backend proves header emit-once; BFF/browser cookie is out of scope |

Automated verification covers all in-scope CART behaviors once PLAN binds commands. The rows above are governance/authorization, not missing product tests.

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for task-level unit verify
- [ ] `nyquist_compliant: true` set in frontmatter after planner binds per-task commands
- [ ] CART-01..CART-09 each appear in at least one PLAN `requirements` field
- [ ] Inherited Auth M1 exact-set and zero-Order proofs are in the phase gate
- [ ] No execution, deploy, real provider, remote infra, or frontend is authorized by this file

**Approval:** pending — strategy drafted from human-approved RESEARCH. Planner must bind exact spec paths. Execution remains NOT AUTHORIZED.
