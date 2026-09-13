# Phase 17 — Post-Approval PR #29 Residual Review Remediation (PR29-R3)

## 1. Identity & Governance

```text
Project:
Indicio Cult / Ecommerce

Repository:
jlima004/E-commerce

Phase:
17 — Authenticated BR Checkout & Privacy

Milestone:
v1.1 Backend Storefront Readiness

PR:
#29 (https://github.com/jlima004/E-commerce/pull/29)

Branch:
gsd/phase-17-authenticated-br-checkout-privacy

Last Known Pushed PR Head:
f57f5e5529ba84237bcfa884336bda64f0462296

Trigger:
Post-Perspective H7 Human Residual Review identifying 2 residual defects:
  - B17-PR29-HR-24 — P1 (PostgreSQL keyring persistence test is unreachable by the actual test harness)
  - B17-PR29-HR-25 — P2 DOCUMENTAL (ROADMAP has stale `plans 50/50`)

Authority Status:
P17-PLAN-HR-01: OPEN — REVISE (Awaiting Human Decision post-PR29-R3)
Phase 17 PLAN: PR29-R3 TECHNICALLY REMEDIATED — PERSPECTIVE H8 PASS — AWAITING HUMAN RE-APPROVAL (NOT HUMAN APPROVED)
Phase 17 Execution: NOT AUTHORIZED (Execute 17-01: NOT AUTHORIZED)
PR #29 Merge: NOT AUTHORIZED
Phase 17 Closure: BLOCKED by retained R17-BLOCK-01
Phase 18 / Phase 18+: NOT AUTHORIZED
```

---

## 2. Non-Implementation & Non-Mutation Statement

```text
THIS IS STRICTLY A PLANNING RECONCILIATION AND TECHNICAL DOCUMENTAL REMEDIATION SESSION.

1. ZERO modifications to apps/backend/src/ or any runtime code.
2. ZERO git commits, git pushes, branch modifications, or PR merges.
3. ZERO calls to external services (AWS KMS, Stripe, Gelato, Resend, remote DBs/Redis).
4. ZERO resolution of PR review threads without explicit human authorization.
5. All findings are addressed strictly within the Phase 17 planning and governance artifacts:
   - 17-03-PLAN.md
   - 17-11-PLAN.md
   - 17-PATTERNS.md
   - 17-VALIDATION.md
   - 17-PLAN-REVIEW.md
   - 17-PR29-R2-REMEDIATION.md
   - 17-PR29-R3-REMEDIATION.md (this document)
   - STATE.md, ROADMAP.md
```

---

## 3. Detailed Breakdown of Residual Findings (B17-PR29-HR-24 & B17-PR29-HR-25)

### B17-PR29-HR-24 (P1): PostgreSQL Keyring Persistence Test is Unreachable by the Actual Test Harness

#### A. Root Cause & Harness Archaeology
In PR29-R2, `17-03-PLAN.md` specified a future integration test artifact:
```text
apps/backend/src/modules/store-idempotency/__tests__/keyrings-persistence.integration.spec.ts
```
to prove double-keyring persistence, locator rotation, fingerprint rotation, `FOR UPDATE` concurrency, replay, collision, and non-persistence of raw secrets.

However, auditing the repository's actual Jest configuration and test orchestrators revealed an execution reachability gap:

1. **Unit Runner (`npm run test:unit`):**
   - Configured in `apps/backend/package.json`:
     `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules jest --silent --runInBand --forceExit`
   - Configured in `apps/backend/jest.config.js`:
     ```js
     } else if (process.env.TEST_TYPE === "unit") {
       module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
     }
     ```
   - Filename `keyrings-persistence.integration.spec.ts` fails the `*.unit.spec.[jt]s` pattern and is completely ignored by the unit runner.

2. **Module Integration Runner (`npm run test:integration:modules`):**
   - Invokes `apps/backend/scripts/run-disposable-postgres-modules.mjs`.
   - Discovers module specs strictly within `apps/backend/integration-tests/modules/` matching `*.spec.ts`.
   - Validates that discovered files match `EXPECTED_MODULE_SPECS` exact-set.
   - Files placed in `apps/backend/src/modules/*/__tests__/` are **NEVER** scanned, scheduled, or executed by `run-disposable-postgres-modules.mjs`.

3. **Consequence:**
   The planned test `keyrings-persistence.integration.spec.ts` was silently unreachable by all automated test commands and runners in the repository.

#### B. Remediation Architecture (Lowest Churn)
- **Constraint:** Do NOT create a 22nd module spec `integration-tests/modules/keyrings-persistence.spec.ts`, as that would force expanding `EXPECTED_MODULE_SPECS` from 21 to 22 across multiple orchestrators and plans.
- **Solution:** Reuse `apps/backend/integration-tests/modules/checkout-privacy.postgres.spec.ts`. This file is already an authoritative Phase 17 PostgreSQL integration suite running inside disposable PostgreSQL.
- **15 Mandatory PostgreSQL Test Cases:**
  `checkout-privacy.postgres.spec.ts` is explicitly extended in `17-03-PLAN.md` (Task 17-03-01) to cover:
  1. First claim persists active `pepper_version`
  2. Old locator created with `pepper_version=N` still matches after rotation to `N+1`
  3. New locator after rotation persists `pepper_version=N+1`
  4. `hash_version` remains exactly the locator scheme `'hmac-sha256-v1'` and is never interpreted as a key version
  5. Old `fingerprint_key_version` remains replayable while retained
  6. New fingerprint persists current `fingerprint_key_version`
  7. `fingerprint_scheme` remains algorithm/canonicalization scheme (`'rfc8785-hmac-sha256-v1'`)
  8. Unknown retained locator key version -> fail closed (500)
  9. Unknown `fingerprint_key_version` -> fail closed (500)
  10. >1 locator candidate record match -> `IDEMPOTENCY_KEYRING_COLLISION` (500)
  11. Incomplete/corrupt locator keyring -> fail closed (503 `PRIVACY_KEYRING_UNAVAILABLE`) before 0 matches can become first claim
  12. Concurrent lookup/claim uses `FOR UPDATE` and cannot create competing first claims
  13. Raw `Idempotency-Key` is not persisted
  14. Raw CPF is not persisted
  15. Fingerprint canonical payload is not persisted

#### C. Final Test Location & Executable Commands
- **Unit suite (in-memory HMAC & decision matrix):**
  ```bash
  cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/checkout-privacy/__tests__/keyrings.unit.spec.ts
  ```
- **PostgreSQL disposable integration (persistence, rotation, locking, relational semantics):**
  ```bash
  cd apps/backend && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/checkout-privacy.postgres.spec.ts
  ```

#### D. Ledger Integration (`17-VALIDATION.md` & `17-11-PLAN.md`)
- **Ledger Item 03:** Previously only ran unit tests while claiming persistence/replay evidence.
- Now separated and explicitly defined:
  - **03A (Unit evidence):** `keyrings.unit.spec.ts`, `reencryption.unit.spec.ts`, `kek-lifecycle.unit.spec.ts`
  - **03B (PostgreSQL disposable evidence):** `checkout-privacy.postgres.spec.ts`
  - **Item 03 Command:**
    ```bash
    cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/checkout-privacy/__tests__/keyrings.unit.spec.ts src/modules/checkout-privacy/__tests__/reencryption.unit.spec.ts src/modules/checkout-privacy/__tests__/kek-lifecycle.unit.spec.ts && node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/checkout-privacy.postgres.spec.ts
    ```
  - Gate Type: `Automated Unit + Module (Disposable PG)`.
  - In `17-11-PLAN.md`, Task 17-11-02 updates `validate-phase17-final.mjs` Item 03 to coordinate both suites without expanding `EXPECTED_MODULE_SPECS 21`.

---

### B17-PR29-HR-25 (P2 DOCUMENTAL): ROADMAP Has Stale `plans 50/50`

#### A. Root Cause & Scan Results
In `.planning/ROADMAP.md`, under the post-closure PR #28 section, the text asserted:
`Milestone counters: phases closed 4/10; requirements 34/91; open requirements 57; plans 50/50; percent 40.`
under a header describing "Current state".

While `50/50` was accurate at the time of Phase 16 / PR #28 closure (50 plans existed and all 50 were completed), Phase 17 subsequently materialized 11 plans (`17-01` through `17-11`). Therefore, the active milestone total plans expanded to 61 (50 completed / 61 materialized).

#### B. Historical vs. Current Classification & Remediation
- **Historical snapshots:**
  - `ROADMAP.md` line 267: Explicitly labeled as `Historical milestone counters at Phase 16 closeout: phases closed 4/10; requirements 34/91; open requirements 57; plans 50/50; percent 40.`
  - `ROADMAP.md` line 337: Explicitly labeled as `Historical milestone counters at Phase 16 / PR #28 closeout: phases closed 4/10; requirements 34/91; open requirements 57; plans 50/50; percent 40.`
- **Current milestone counters:**
  - `ROADMAP.md` line 339: Added `Current milestone counters: phases closed 4/10; requirements 34/91; open requirements 57; plans 50 completed / 61 materialized; percent 40%.`
  - `STATE.md` line 220: Updated to `- known plans human-approved executed: **50 completed / 61 materialized** (Historical Phase 16 closeout: 50/50; Phase 13: 7; Phase 14: 21; Phase 15: 8; Phase 16: 16-01..16-14 executed; Phase 17: 11 materialized, 0 executed)`.
- **Result:** 0 ambiguous occurrences of current `50/50`.

---

## 4. Reconciled File Matrix (PR29-R3)

| File | Changes Applied in PR29-R3 | Finding |
|---|---|---|
| `17-03-PLAN.md` | Removed unreachable `keyrings-persistence.integration.spec.ts`; added `checkout-privacy.postgres.spec.ts` to `files_modified`, Task 17-03-01 `files`, `read_first`, action step 6 (15 cases), `verify` (unit + disposable PG), and artifacts list. | HR-24 |
| `17-11-PLAN.md` | Updated Task 17-11-02 behavior for Item 03 to coordinate unit + disposable PG tests while preserving `EXPECTED_MODULE_SPECS 21`. | HR-24 |
| `17-PATTERNS.md` | Updated §3.4 to reference `checkout-privacy.postgres.spec.ts` for persistence/concurrency verification. | HR-24 |
| `17-VALIDATION.md` | Updated status header to PR29-R3; updated Wave 2 test description; updated Item 03 in `P17_FINAL_VALIDATION_LEDGER_V1` with combined unit + disposable PG command and split 03A/03B expected evidence. | HR-24 |
| `17-PLAN-REVIEW.md` | Recorded H7 as HISTORICAL PASS; added Human Residual Review post-H7; documented HR-24 and HR-25; recorded Perspective H8 PASS; updated evidence table. | HR-24, HR-25 |
| `17-PR29-R2-REMEDIATION.md` | Preserved HR-20..23 as CLOSED — PASS and added post-H7 human residual review note. | HR-24, HR-25 |
| `ROADMAP.md` | Labeled historical 50/50 counters; added current milestone counters (`50 completed / 61 materialized`); updated Phase 17 status. | HR-25 |
| `STATE.md` | Updated `stopped_at`, current focus, Governance Chronology, and known plans counter (`50 completed / 61 materialized`). | HR-25 |
| `17-PR29-R3-REMEDIATION.md` | Created authoritative PR29-R3 remediation artifact. | HR-24, HR-25 |

---

## 5. Adversarial Audit Results (Perspective H8)

Perspective H8 executed an independent adversarial audit targeting test discoverability, executable validation evidence, module exact-set integrity, and milestone counter consistency:

### Attack A: Test Discoverability
- **Vector:** Check if any planned test cannot be executed by Jest or module runners.
- **Audit:**
  - `keyrings.unit.spec.ts`: matches `**/src/**/__tests__/**/*.unit.spec.[jt]s` under `TEST_TYPE=unit` (PASS).
  - `reencryption.unit.spec.ts`: matches `**/src/**/__tests__/**/*.unit.spec.[jt]s` under `TEST_TYPE=unit` (PASS).
  - `kek-lifecycle.unit.spec.ts`: matches `**/src/**/__tests__/**/*.unit.spec.[jt]s` under `TEST_TYPE=unit` (PASS).
  - `checkout-privacy.postgres.spec.ts`: located in `integration-tests/modules/`, discovered by `run-disposable-postgres-modules.mjs`, executable via `--runTestsByPath` under disposable Postgres harness (PASS).
  - `keyrings-persistence.integration.spec.ts`: 0 references remaining across all planning artifacts (PASS).
- **Verdict:** **PASS — 0 unreachable test artifacts.**

### Attack B: Ledger Command vs. Evidence Consistency
- **Vector:** Compare claimed evidence against actual command for each ledger item, especially Item 03.
- **Audit:**
  - Item 03 command executes both unit suites (`npm run test:unit -- --runTestsByPath ...`) AND the disposable PostgreSQL module test (`node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/checkout-privacy.postgres.spec.ts`).
  - Expected evidence explicitly bifurcated into 03A (Unit) and 03B (PostgreSQL persistence).
  - Every material evidence claim has a corresponding executable command path.
- **Verdict:** **PASS — 0 false executable evidence claims.**

### Attack C: Restricted Module Runner Invocation Semantics
- **Vector:** Ensure focused disposable module calls pass exactly one spec, and full modules runner runs directly.
- **Audit:**
  - Focused calls in `17-02`, `17-03`, `17-04`, `17-05`, `17-09`, `17-10`, `17-11`, and `17-VALIDATION.md` invoke `scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath integration-tests/modules/<single-spec>.spec.ts` (PASS).
  - Full module regression runs directly: `npm run test:integration:modules` without nested disposable wrappers (PASS).
- **Verdict:** **PASS — 0 nested/invalid runner invocations.**

### Attack D: Module Exact-Set Integrity
- **Vector:** Verify that PR29-R3 did not expand `EXPECTED_MODULE_SPECS` beyond 21.
- **Audit:**
  - `checkout-privacy.postgres.spec.ts` was already planned in `17-02-PLAN.md` (expanding 17 -> 18).
  - `gelato-privacy-guard.spec.ts` in `17-05` (18 -> 19).
  - `checkout-privacy-canary.spec.ts` in `17-10` (19 -> 20).
  - `phase17-e2e.spec.ts` in `17-11` (20 -> 21).
  - Reusing `checkout-privacy.postgres.spec.ts` for double-keyring persistence adds 0 new module files.
  - Final `EXPECTED_MODULE_SPECS` count remains exactly 21.
- **Verdict:** **PASS — EXPECTED_MODULE_SPECS preserved at 21.**

### Attack E: Milestone Counters Audit
- **Vector:** Scan for stale or ambiguous `50/50` occurrences.
- **Audit:**
  - `completed_phases`: 4/10 (PASS)
  - `requirements_complete`: 34/91 (PASS)
  - `requirements_open`: 57 (PASS)
  - `completed_plans`: 50 (PASS)
  - `total_plans`: 61 (PASS)
  - `progress`: 40% (PASS)
  - Ambiguous current `50/50` occurrences: 0 (PASS).
  - Historical `50/50` occurrences are explicitly labeled as historical closeout snapshots.
- **Verdict:** **PASS — 0 counter ambiguities.**

### Attack F: Regression Sanity
- **Vector:** Confirm that PR29-R3 did not alter previously approved invariants.
- **Audit:**
  - Double-keyring persistence schema contract: `hash_version` (scheme), `pepper_version` (key version), `fingerprint_scheme`, `fingerprint_key_version` strictly preserved.
  - `has_valid_cpf` producer (`getPaymentEligibilityProjection`) strictly preserved.
  - Option B-R pre-CAS transaction and recovery strictly preserved.
  - Gelato Brazil privacy guard fail-closed strictly preserved.
  - BFF exact-set (3 tuples) strictly preserved.
  - Snapshot 23 logical / 26 physical columns mapping strictly preserved.
- **Verdict:** **PASS — 0 regressions.**

---

## 6. Perspective H8 Scorecard

| Category | Count | Status | Notes |
|---|:---:|:---:|---|
| **P0 (Catastrophic / Invariant Violation)** | **0** | CLEAN | No security bypasses, money leaks, or unrecoverable states. |
| **P1 (Material Correctness / Unreachable Test)** | **0** | CLEAN | HR-24 completely resolved by reusing `checkout-privacy.postgres.spec.ts`. |
| **P2 (Documental / Counter Ambiguity)** | **0** | CLEAN | HR-25 completely resolved with explicit historical vs. current counters. |
| **P3 (Informational Observation)** | **0** | CLEAN | All references, manifests, and commands verified against runtime scripts. |

---

## 7. Required Test Discoverability & Evidence Table

| Evidence | Planned File | Test Class | Actual Runner | Discoverable? | Ledger Item | Status |
|---|---|---|---|:---:|:---:|:---:|
| Double-Keyring HMAC & Decision Matrix | `src/modules/checkout-privacy/__tests__/keyrings.unit.spec.ts` | Unit (`*.unit.spec.ts`) | `npm run test:unit -- --runTestsByPath ...` | YES | 03A | **PASS** |
| Double-Keyring PostgreSQL Persistence & Concurrency | `integration-tests/modules/checkout-privacy.postgres.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 03B (and 02, 04, 09) | **PASS** |
| Snapshot Reencryption & Canonical AAD | `src/modules/checkout-privacy/__tests__/reencryption.unit.spec.ts` | Unit (`*.unit.spec.ts`) | `npm run test:unit -- --runTestsByPath ...` | YES | 03A | **PASS** |
| KEK Version Registry & Lifecycle | `src/modules/checkout-privacy/__tests__/kek-lifecycle.unit.spec.ts` | Unit (`*.unit.spec.ts`) | `npm run test:unit -- --runTestsByPath ...` | YES | 03A | **PASS** |
| PostgreSQL DDL, Constraints & Immutability | `integration-tests/modules/checkout-privacy.postgres.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 02 | **PASS** |
| Purge State Machine & Clock | `integration-tests/modules/checkout-privacy.postgres.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 04 | **PASS** |
| Gelato Fail-Closed Privacy Guard | `integration-tests/modules/gelato-privacy-guard.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 05 | **PASS** |
| Order Birth Pipeline (Option B-R) | `integration-tests/modules/checkout-privacy.postgres.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 09 | **PASS** |
| 17-Sink Multi-Canary Negative PII Audit | `integration-tests/modules/checkout-privacy-canary.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 10 | **PASS** |
| E2E Integrated Synthesis | `integration-tests/modules/phase17-e2e.spec.ts` | Disposable PostgreSQL Module | `run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- --runTestsByPath ...` | YES | 11 | **PASS** |
