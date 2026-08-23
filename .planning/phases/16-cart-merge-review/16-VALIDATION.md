---
phase: 16
slug: cart-merge-review
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-22
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest `^29.7.0` + `@medusajs/test-utils` `2.16.0` |
| **Config file** | `apps/backend/jest.config.js` |
| **Quick run command** | `cd apps/backend && npm run test:unit -- --runTestsByPath <phase-unit-file>` |
| **Full suite command** | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/cart-merge/__tests__/decision.unit.spec.ts && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` |
| **Estimated runtime** | To be measured during Wave 0; keep per-task feedback under 30 seconds where the selected test permits |

---

## Sampling Rate

- **After every task commit:** Run the directly affected unit or contract file.
- **After every plan wave:** Run the Phase 16 HTTP and PostgreSQL suites.
- **Before `/gsd-verify-work`:** Run the complete relevant suites, leakage, multiprocess, zero-Order and final clean `openapi:check` gate.
- **Max feedback latency:** 30 seconds for the normal per-task sample; longer PostgreSQL integration evidence runs at wave gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Assigned by planner | TBD | 0+ | MRG-01 | T16-transaction / T16-replay | Atomic, idempotent authenticated merge with no pre-webhook Order birth | HTTP + PostgreSQL | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-02 | T16-contract | Exact outcome enum and deterministic decision matrix | unit + HTTP | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/cart-merge/__tests__/decision.unit.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-03 | T16-overflow | Variant aggregation, ceiling 99 and safe retry behavior | unit + PostgreSQL | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/cart-merge/__tests__/decision.unit.spec.ts && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-04 | T16-partial | Local rejection cannot silently become whole-request failure or lose accepted items | unit + HTTP | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-05 | T16-transaction / T16-capability | Rollback leaves carts, versions, capability, review, idempotency and Orders unchanged | PostgreSQL failpoints | `cd apps/backend && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-06 | T16-review | Review is persisted once and acknowledged under version precondition | HTTP + PostgreSQL | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-07 | T16-review / T16-replay | Pending review blocks structural mutation; compatible acknowledge replay is a no-op | unit + HTTP | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts` | ❌ W0 | ⬜ pending |
| Assigned by planner | TBD | 0+ | MRG-08 | T16-auth / T16-leakage | Adapter preserves contract parity, denies sessions, and leaks no sensitive value | HTTP + contract | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts && npm run test:unit -- --runTestsByPath src/api-docs/__tests__/store-contract.unit.spec.ts` | ❌ W0 / partial existing coverage | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/backend/src/modules/cart-merge/__tests__/decision.unit.spec.ts` — outcome, normalization and fingerprint cases for MRG-02..MRG-04.
- [ ] `apps/backend/integration-tests/http/cart-merge-review.spec.ts` — full HTTP contract, review, acknowledge and attach-adapter cases for MRG-01 and MRG-04..MRG-08.
- [ ] `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts` — rollback, lock ordering, same-key replay and multiprocess races for MRG-01 and MRG-03..MRG-07.
- [ ] Phase 16 failpoint fixtures and child-process workers that use disposable PostgreSQL and no real providers.
- [ ] Phase 16 cases in leakage, zero-Order, Store manifest and OpenAPI suites.

---

## Manual-Only Verifications

All Phase 16 behaviors are expected to have automated evidence. Human review remains required for the final OpenAPI diff and for authorization of execution; neither substitutes for automated contract, PostgreSQL, leakage or concurrency proof.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Wave 0 covers all MISSING references.
- [ ] No watch-mode flags.
- [ ] Feedback latency under 30 seconds for normal per-task samples.
- [ ] `nyquist_compliant: true` set in frontmatter after validation.

**Approval:** pending
