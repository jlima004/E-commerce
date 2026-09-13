# Phase 17 — Post-Approval PR #29 Review Remediation (PR29-R1)

## 1. Identity & Governance

```text
Phase:
17 — Authenticated BR Checkout & Privacy

Milestone:
v1.1 Backend Storefront Readiness

PR:
#29 (https://github.com/jlima004/E-commerce/pull/29)

Repository:
jlima004/E-commerce

Branch:
gsd/phase-17-authenticated-br-checkout-privacy

PR Head:
f57f5e5529ba84237bcfa884336bda64f0462296

PR Base:
main (df51c0d79f99f184d8cd7c16a8be3bfb6cf540e8)

Trigger:
Post-approval PR #29 code reviews conducted by Codex and GitHub Copilot

Remediation Scope:
Findings B17-PR29-HR-01 through B17-PR29-HR-19

Authority Status:
Historical P17-PLAN-HR-01 approval is SUPERSEDED by PR #29 review findings.
PR #29 status: OPEN, BLOCKED — REVIEW REMEDIATION REQUIRED.
Phase 17 Execution: NOT AUTHORIZED. Wave 0 / Plan 17-01: NOT AUTHORIZED.
Phase 17 Closure: BLOCKED by retained R17-BLOCK-01.
```

---

## 2. Non-Implementation & Non-Mutation Statement

```text
THIS IS STRICTLY A PLANNING RECONCILIATION SESSION.

1. ZERO modifications to apps/backend/src/ or any runtime implementation code.
2. ZERO git commits, git pushes, branch updates, or PR merges.
3. ZERO calls to external services (AWS KMS, Stripe, Gelato, Resend, remote DBs).
4. ZERO resolution of PR review threads without explicit human authorization.
5. All 19 findings are addressed strictly within the Phase 17 planning artifacts:
   - 17-01-PLAN.md through 17-11-PLAN.md
   - 17-PATTERNS.md
   - 17-VALIDATION.md
   - 17-PLAN-REVIEW.md
   - STATE.md, ROADMAP.md
```

---

## 3. Comprehensive Breakdown of Findings & Resolutions (B17-PR29-HR-01..HR-19)

### B17-PR29-HR-01 (P1): Partial Draft Without CPF Must Be Persistable in `protected_checkout_data`
- **Problem:** Previous envelope check constraint required all 4 envelope columns (`encrypted_cpf`, `cpf_nonce`, `cpf_tag`, `cpf_wrapped_dek`) to be `NOT NULL` in `draft` state. However, when a draft cart is first initialized, the customer may not yet have provided their CPF, causing an immediate check constraint violation on draft creation.
- **Resolution:** Updated `CK_protected_checkout_data_envelope_atomicidade` to allow a 3-branch condition:
  ```sql
  CONSTRAINT "CK_protected_checkout_data_envelope_atomicidade" CHECK (
    (lifecycle_state = 'draft' AND (
      (encrypted_cpf IS NULL AND cpf_nonce IS NULL AND cpf_tag IS NULL AND cpf_wrapped_dek IS NULL)
      OR
      (encrypted_cpf IS NOT NULL AND cpf_nonce IS NOT NULL AND cpf_tag IS NOT NULL AND cpf_wrapped_dek IS NOT NULL)
    ))
    OR
    (lifecycle_state IN ('ready', 'snapshot_prepared') AND
     encrypted_cpf IS NOT NULL AND cpf_nonce IS NOT NULL AND cpf_tag IS NOT NULL AND cpf_wrapped_dek IS NOT NULL)
    OR
    (lifecycle_state = 'purged' AND
     encrypted_cpf IS NULL AND cpf_nonce IS NULL AND cpf_tag IS NULL AND cpf_wrapped_dek IS NULL)
  )
  ```
- **Files Reconciled:** `17-02-PLAN.md`, `17-PATTERNS.md` (§3.2), `17-VALIDATION.md` (Wave 1, item 02).

### B17-PR29-HR-02 (P1): Double Keyrings Need Persisted Authority and Wiring
- **Problem:** `17-03-PLAN.md` defined in-memory keyring managers and HMAC locators, but did not define where locators and semantic fingerprints are persisted across requests, leaving `R17-HR-10` unexecutable.
- **Resolution:** Integrated double keyrings directly into the existing `store_idempotency_record` table via `Migration20260910120000_store_idempotency_keyrings.ts`:
  - `locator_hmac` mapped to `idempotency_key_hash` with `hash_version` ('hmac-sha256-v1' locator hash scheme) and `pepper_version` (locator key version integer >= 1).
  - `semantic_fingerprint_hmac` mapped to `request_fingerprint` with `fingerprint_scheme` ('rfc8785-hmac-sha256-v1') and `fingerprint_key_version` (fingerprint key version integer >= 1).
  - Candidate query runs across all active + retained locator key versions:
    ```sql
    SELECT * FROM store_idempotency_record
    WHERE operation = $op
      AND actor_scope_hash = $actor
      AND resource_scope_hash = $cart
      AND idempotency_key_hash IN ($candidateLocators)
    FOR UPDATE;
    ```
  - Decision matrix: 0 matches -> first claim; 1 match + same fingerprint -> replay; 1 match + different fingerprint -> 409 conflict; >1 matches -> fail-closed 500 + alert; incomplete keyring -> fail-closed 503 before query.
  - Invariant verified: Raw idempotency key and raw CPF are NEVER persisted in idempotency records.
- **Files Reconciled:** `17-02-PLAN.md`, `17-03-PLAN.md`, `17-PATTERNS.md` (§3.3), `17-VALIDATION.md` (Wave 2, item 03).

### B17-PR29-HR-03 (P1): Gelato Country Normalization
- **Problem:** Guard logic expected exact uppercase `"BR"`, but input variants like `"br"`, `" Br "`, `" bR "` could slip past or cause inconsistent dispatch behavior.
- **Resolution:** Implemented authoritative closed normalization function:
  ```typescript
  export function normalizeCountryCode(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim().toUpperCase();
  }
  ```
  Evaluated before payload build, request hash, or relay queueing. Strictly prohibits converting BR test fixtures to US to bypass guards.
- **Files Reconciled:** `17-05-PLAN.md`, `17-PATTERNS.md` (§3.5), `17-VALIDATION.md` (Wave 4, item 05).

### B17-PR29-HR-04 (P1): Gelato Authoritative Guard Point in Relay Dispatcher
- **Problem:** The guard was placed inside `createGelatoDispatchClient().createOrder()`, which only receives `{ payload, apiKey }` and cannot update fulfillment status, set `requires_operator_attention`, or raise operator alerts.
- **Resolution:** Relocated the authoritative privacy boundary guard to the entry of `dispatchSingleFulfillment()` in `apps/backend/src/jobs/gelato-dispatch-relay.ts`:
  - Executes BEFORE `buildGelatoDispatchPayload()`.
  - Executes BEFORE request hash calculation.
  - Executes BEFORE updating fulfillment status to `'queued'` or `'dispatching'`.
  - For BR orders: immediately updates fulfillment to `status = 'dead_letter'`, `requires_operator_attention = true`, `operator_alert_code = 'GELATO_DISPATCH_BLOCKED_PRIVACY_BOUNDARY'`, raises sanitized operational alert, and returns `'dead_lettered'` (skipping redispatch).
  - HTTP client in `createOrder()` retains fail-closed defense-in-depth. `R17-BLOCK-01` remains formally retained.
- **Files Reconciled:** `17-05-PLAN.md`, `17-PATTERNS.md` (§3.5), `17-VALIDATION.md` (Wave 4, item 05).

### B17-PR29-HR-05 (P1): Zod `billing_address` Rejection Without Making It Mandatory
- **Problem:** Previous plan used `billing_address: z.never(...)` in Zod 3, which can cause validation failure when the field is completely absent from request bodies.
- **Resolution:** Omit `billing_address` entirely from the `.strict()` schema:
  - Request body without `billing_address`: PASSES validation.
  - Request body containing `billing_address: {}`, `null`, or any value: REJECTED with 400 `VALIDATION_ERROR` and `fieldErrors: { billing_address: "Invalid value" }` without echoing input.
- **Files Reconciled:** `17-07-PLAN.md`, `17-PATTERNS.md` (§3.7), `17-VALIDATION.md` (Wave 6, item 07).

### B17-PR29-HR-06 (P1 CRITICAL): Removal of CPF from Metadata Must NOT Break Payment Start
- **Problem:** Removing raw CPF from `shipping_address.metadata` would cause existing `evaluatePaymentStartEligibility()` to fail because it called `calculateCheckoutDataComplete()` which expected `shippingAddress.federal_tax_id`.
- **Resolution:** Migrated `evaluatePaymentStartEligibility()` to read from `protected_checkout_data`:
  - `validateBrazilShippingAddress` receives `{ requireFederalTaxId: false }` during payment eligibility check.
  - Under transactional authority lock, reads `ProtectedCheckoutEligibilityProjection`: asserts `lifecycle_state === 'ready'`, `has_valid_cpf === true`, valid physical shipping address, and zero raw CPF in metadata.
  - Invariants strictly preserved: zero raw CPF in `shipping_address.metadata`, `PaymentAttempt.metadata`, Stripe metadata, or logs.
- **Files Reconciled:** `17-07-PLAN.md`, `17-PATTERNS.md` (§3.7, §3.8), `17-VALIDATION.md` (Wave 6, item 07).

### B17-PR29-HR-07 (P1 CRITICAL): Option B-R / Order Durable + Snapshot Rollback Recovery
- **Problem:** In Option B, snapshot was prepared inside an outer SQL transaction. `runCompleteCart()` committed the Medusa Order in its own transaction. If the process crashed or the outer transaction rolled back after `runCompleteCart()`, the Order was durable in DB but the snapshot was missing! The previous FP4 assumed snapshot was persisted, which was false.
- **Resolution:** Designed Option B-R (Recoverable Missing Snapshot):
  - Retains pre-CAS snapshot inside outer transaction.
  - If outer tx rolls back after `runCompleteCart()`: Order count = 1, snapshot count = 0.
  - On retry: acquire `withCartOrderAuthorityLock`, discover recovered Order, detect missing snapshot, read still-active `protected_checkout_data`, recreate snapshot with fresh CSPRNG DEK + nonce + AAD, bind directly in `bound` state, purge cart CPF to NULL, reconcile CCL and PaymentAttempt.
  - STRICTLY PROHIBITS calling `runCompleteCart()` a second time.
  - Complete rewrite of failpoints FP1 through FP6 in `17-09-PLAN.md`.
- **Files Reconciled:** `17-02-PLAN.md`, `17-09-PLAN.md`, `17-PATTERNS.md` (§3.10), `17-VALIDATION.md` (Wave 8, item 09).

### B17-PR29-HR-08 (P1): Explicit Outer Transaction Adapter
- **Problem:** `withCartOrderAuthorityLock()` provides `PaymentAttemptSqlTransaction`. Invoking CheckoutPrivacy operations required sharing the exact transaction boundary without nesting or independent commits.
- **Resolution:** Defined `CheckoutPrivacySqlTransactionAdapter`:
  ```typescript
  export class CheckoutPrivacySqlTransactionAdapter implements CheckoutPrivacyTransaction {
    constructor(private readonly outerTx: PaymentAttemptSqlTransaction) {}
    query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      return this.outerTx.query<T>(sql, params);
    }
    // Prohibits commit/rollback inside adapter; delegated to withCartOrderAuthorityLock
  }
  ```
- **Files Reconciled:** `17-09-PLAN.md`, `17-PATTERNS.md` (§3.10).

### B17-PR29-HR-09 (P1): Medusa Primary Key (`id`) & Logical Snapshot Schema
- **Problem:** Plan previously specified "exactly 23 physical DB columns" with `snapshot_id` as PK, conflicting with Medusa framework conventions where physical PK is `id` (`posnap_...`) and columns include `created_at`, `updated_at`, `deleted_at`.
- **Resolution:** Reconciled to:
  - 23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns.
  - Logical `snapshot_id` maps to physical primary key `id` with prefix `posnap_...`.
- **Files Reconciled:** `17-02-PLAN.md`, `17-PATTERNS.md` (§3.2), `17-VALIDATION.md` (Wave 1, item 02).

### B17-PR29-HR-10 (P1): BFF Exact-Set (3 Tuples) Without Wildcard/Prefix Matching
- **Problem:** Store cart BFF operations must be an exact closed set. Wildcard/prefix authorization was prohibited, and `middlewares.ts` lacked `PATCH` method casting.
- **Resolution:**
  - Added exact closed-set tuples to `STORE_CART_BFF_PROTECTED_OPERATIONS`:
    - `"GET /store/carts/:id/checkout-details"`
    - `"PATCH /store/carts/:id/checkout-details"`
    - `"POST /store/carts/:id/checkout-details/validate"`
  - Updated method casting in `middlewares.ts`: `const method = rawMethod as "GET" | "POST" | "PATCH" | "DELETE"`.
- **Files Reconciled:** `17-06-PLAN.md`, `17-PATTERNS.md` (§3.6), `17-VALIDATION.md` (Wave 5, item 06).

### B17-PR29-HR-11 (Material P2): Store Surface M1 Manifest Uses `"METHOD /path-template"`
- **Problem:** `17-07-PLAN.md` mistakenly referred to `operationId`s in `STORE_SURFACE_M1_ENABLED_OPERATIONS`, but `manifest.ts` uses method/path template strings.
- **Resolution:** Corrected registration in `manifest.ts`:
  - `"GET /store/carts/{id}/checkout-details"`
  - `"PATCH /store/carts/{id}/checkout-details"`
  - `"POST /store/carts/{id}/checkout-details/validate"`
- **Files Reconciled:** `17-06-PLAN.md`, `17-07-PLAN.md`, `17-PATTERNS.md` (§3.6).

### B17-PR29-HR-12 (P1): Purge Worker Candidate Scan Anti-Starvation
- **Problem:** `17-04-PLAN.md` previously filtered `purge_state != 'freeze_suspended'`, preventing rows suspended under FIN-03/04 from being evaluated for 30-day escalation or released when financial authority ended.
- **Resolution:** Updated candidate scan query to include `freeze_suspended`:
  ```sql
  SELECT * FROM protected_checkout_data
  WHERE lifecycle_state != 'purged'
    AND (
      purge_state = 'due_now'
      OR (purge_state IN ('active', 'freeze_suspended', 'manual_intervention_required')
          AND cpf_purge_due_at <= NOW())
    )
  ORDER BY cpf_purge_due_at ASC
  LIMIT $batchSize
  FOR UPDATE SKIP LOCKED;
  ```
  - Under FIN-03/04 hold: if `NOW() >= cpf_purge_due_at + INTERVAL '30 days'`, escalates to `manual_intervention_required` with operator alert.
  - When financial hold is released: transitions to `due_now` and purges envelope to NULL.
- **Files Reconciled:** `17-04-PLAN.md`, `17-PATTERNS.md` (§3.4), `17-VALIDATION.md` (Wave 3, item 04).

### B17-PR29-HR-13 (Material P2): `openapi:check` Requires Clean Candidate
- **Problem:** Running `openapi:check` requires a clean git worktree. If run with untracked or modified files, it fails immediately.
- **Resolution:** Added explicit human boundary checkpoint `P17-11-CLEAN-CANDIDATE-HR-01` in `17-11-PLAN.md` before executing ledger item 16 (`npm run openapi:check`), requiring all artifacts to be reviewed and worktree clean.
- **Files Reconciled:** `17-11-PLAN.md`, `17-VALIDATION.md` (§6).

### B17-PR29-HR-14 (Material P1/P2): Canonical Fail-Fast Final Ledger Coordinator Script
- **Problem:** Task 17-11-02 could not be validated by a single manual command without risking incomplete verification or false PASS.
- **Resolution:** Designed and specified `apps/backend/scripts/validate-phase17-final.mjs`:
  - Executes all 17 ledger items in strict sequential order.
  - Fail-fast on the first failing command.
  - Emits machine-readable and human-readable summary reports.
  - Provides cryptographic/deterministic proof of all 17 checks passing.
- **Files Reconciled:** `17-11-PLAN.md`, `17-VALIDATION.md` (§5).

### B17-PR29-HR-15 (Material P2): Single Home for `KmsProvider` Interface
- **Problem:** `KmsProvider` interface was duplicated across `types.ts` and `crypto/kms-provider.ts` in `17-01-PLAN.md`.
- **Resolution:** Standardized `crypto/kms-provider.ts` as the canonical source of truth for the `KmsProvider` interface, while `types.ts` maintains DTOs and value types (`EncryptedEnvelope`, `KmsDataKeyResult`, `KmsDecryptResult`, `KmsReEncryptResult`, `KmsEncryptionContext`, `EnvelopeAadContext`).
- **Files Reconciled:** `17-01-PLAN.md`, `17-PATTERNS.md` (§3.1).

### B17-PR29-HR-16 (Material P2): `LegalReceipt` Soft Delete Immutability
- **Problem:** Trigger `trg_legal_receipt_immutable` prevented physical deletion and field mutation, but did not explicitly guard `deleted_at` from soft deletion.
- **Resolution:** Updated `fn_legal_receipt_immutable()` trigger:
  ```plpgsql
  IF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'LegalReceipt cannot be soft deleted' USING ERRCODE = '55000';
    END IF;
    -- Only allowed mutation: consent revocation from NULL to non-NULL
  END IF;
  ```
  Added table check constraint `CK_legal_receipt_deleted_at_null CHECK ("deleted_at" IS NULL)`.
- **Files Reconciled:** `17-02-PLAN.md`, `17-PATTERNS.md` (§3.2), `17-VALIDATION.md` (Wave 1, item 02).

### B17-PR29-HR-17 (Documental P2): Milestone Counter Integrity
- **Problem:** Stale counters in planning documentation could report inaccurate plan counts.
- **Resolution:** Verified and synchronized milestone counters across all documents:
  - `total_phases = 10`, `completed_phases = 4`
  - `total_plans = 61`, `completed_plans = 50`, `percent = 40%`
  - `requirements = 34/91`, `open_requirements = 57`
  - Phase 17 plans (11 plans) are materialized and in review; none are marked completed.
- **Files Reconciled:** `STATE.md`, `ROADMAP.md`.

### B17-PR29-HR-18 (Material P2): Phase 17 E2E Suite as Cross-Domain Synthesis
- **Problem:** Claims in `17-10-PLAN.md` and `17-11-PLAN.md` implied the E2E suite was the sole proof for CHK requirements, diluting the role of dedicated unit/integration specs.
- **Resolution:** Clarified that the E2E suite (`phase17-e2e.spec.ts`) serves as cross-domain integration synthesis, while dedicated scoped proofs for CHK-01..CHK-10 remain in ledger items 01..10.
- **Files Reconciled:** `17-10-PLAN.md`, `17-11-PLAN.md`, `17-VALIDATION.md`.

### B17-PR29-HR-19 (Documental P2): Path Fix for Store Surface Errors Unit Spec
- **Problem:** Plan referenced nonexistent path `apps/backend/src/api-surface/__tests__/errors.unit.spec.ts`.
- **Resolution:** Corrected path to `apps/backend/src/api/store-surface/__tests__/errors.unit.spec.ts`.
- **Files Reconciled:** `17-06-PLAN.md`, `17-VALIDATION.md` (item 06).

---

## 4. Reconciled Plan Matrix

| Plan | Waves | Primary Focus | Findings Reconciled |
|---|---|---|---|
| `17-01-PLAN.md` | Wave 0 | FakeKmsProvider, AWS KMS adapter, Envelope Encryption | HR-15 |
| `17-02-PLAN.md` | Wave 1 | PostgreSQL DDL, atomic constraints, immutability triggers | HR-01, HR-02, HR-07, HR-09, HR-16 |
| `17-03-PLAN.md` | Wave 2 | Double keyrings, StoreIdempotencyRecord integration | HR-02 |
| `17-04-PLAN.md` | Wave 3 | Purge worker scan, 30d escalation, FIN-03/04 suspension | HR-12 |
| `17-05-PLAN.md` | Wave 4 | Gelato dispatch relay entry guard, country normalization | HR-03, HR-04 |
| `17-06-PLAN.md` | Wave 5 | Store surface manifest, BFF exact-set, PATCH support | HR-10, HR-11, HR-19 |
| `17-07-PLAN.md` | Wave 6 | Zod billing rejection, payment start eligibility migration | HR-05, HR-06, HR-11 |
| `17-08-PLAN.md` | Wave 7 | OpenAPI registry, Store contract, human contract gate | (Verified consistent) |
| `17-09-PLAN.md` | Wave 8 | Option B-R recoverable snapshot, transaction adapter, FP1..FP6 | HR-07, HR-08 |
| `17-10-PLAN.md` | Wave 9 | 17-sink negative PII canary verification (CHK-08 proof) | HR-18 |
| `17-11-PLAN.md` | Wave 10 | E2E synthesis, validate-phase17-final.mjs, clean gate | HR-13, HR-14, HR-18 |

---

## 5. GSD Tooling & Consistency Status

- `gsd-tools verify plan-structure`: **ALL 11 PLANS PASS (`"valid": true`, 0 errors)**
- `gsd-tools check decision-coverage-plan`: **PASS (`no trackable decisions in CONTEXT.md`)**
- `gsd-tools check gap-analysis-plan-post`: **PASS (`CHK-01..CHK-10 = 10/10 covered`)**
- Producer / Consumer cross-plan analysis: **PASS (0 orphan artifacts)**
- Local repository hygiene: `git status --short` shows ONLY planning files modified; zero runtime files touched; `git diff --check` is clean.
