# Phase 17 — Post-Approval PR #29 Residual Review Remediation (PR29-R2)

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
Post-Perspective H6 Human Residual Review finding 4 residual defects:
  - B17-PR29-HR-20 — P1 (Double-keyring persistence contract is internally inconsistent)
  - B17-PR29-HR-21 — P1 (`has_valid_cpf` is consumed without an explicit producer)
  - B17-PR29-HR-22 — material P2 (Eliminate all 23-logical / 26-physical schema ambiguity)
  - B17-PR29-HR-23 — documental P2 (Validation status header is stale)

Authority Status (Historical PR29-R2 Snapshot — Superseded by PR29-R3 and Final Human Re-Approval):
Historical P17-PLAN-HR-01 at R2: OPEN — REVISE (Historical; closed via subsequent PR29-R3 and final human re-approval)
Historical Phase 17 PLAN at R2: PR29-R2 REMEDIATED (Historical; subsequently PR29-R3 remediated and HUMAN APPROVED — PASS)
Phase 17 Execution: NOT AUTHORIZED (Execute 17-01: NOT AUTHORIZED)
PR #29 Merge: NOT AUTHORIZED
Phase 17 Closure: BLOCKED by retained R17-BLOCK-01 (RETAINED)
Phase 18 / Phase 18+: NOT AUTHORIZED
```

---

## 2. Non-Implementation & Non-Mutation Statement

```text
THIS IS STRICTLY A PLANNING RECONCILIATION AND REMEDIATION SESSION.

1. ZERO modifications to apps/backend/src/ or any runtime implementation code.
2. ZERO git commits, git pushes, branch modifications, or PR merges.
3. ZERO calls to external services (AWS KMS, Stripe, Gelato, Resend, remote DBs/Redis).
4. ZERO resolution of PR review threads without explicit human authorization.
5. All 4 residual findings are addressed strictly within the Phase 17 planning and governance artifacts:
   - 17-02-PLAN.md
   - 17-03-PLAN.md
   - 17-07-PLAN.md
   - 17-PATTERNS.md
   - 17-VALIDATION.md
   - 17-PLAN-REVIEW.md
   - 17-PR29-R1-REMEDIATION.md
   - 17-PR29-R2-REMEDIATION.md (this document)
   - STATE.md, ROADMAP.md
```

---

## 3. Comprehensive Breakdown of Findings & Resolutions (B17-PR29-HR-20..HR-23)

### B17-PR29-HR-20 (P1): Double-Keyring Persistence Contract is Internally Inconsistent

- **Root Cause & Runtime Archaeology:**
  The existing runtime in `apps/backend/src/modules/store-idempotency/` already defines:
  - `idempotency_key_hash` (text): Locator HMAC
  - `hash_version` (text, default `'hmac-sha256-v1'`): the stable algorithm/scheme of the locator hash, **NOT** a key version!
  - `pepper_version` (integer, default `1`): the numeric version of the key used to compute the locator HMAC
  - `request_fingerprint` (text): the semantic fingerprint HMAC
  
  In PR29-R1, `17-02-PLAN.md` correctly planned relaxing `pepper_version` to `>= 1` and adding `fingerprint_scheme` and `fingerprint_key_version`. However, `17-03-PLAN.md`, `17-PATTERNS.md`, and remediation documentation used conflicting terminology: they described `hash_version` as the "locator key version" and introduced `fingerprint_version` as the "semantic fingerprint key version", creating internal contradiction with the existing database schema and migration definitions.

- **Canonical Persistence Authority (Frozen):**
  The persistence contract is frozen to preserve existing schema semantics while supporting rotation:

| Persisted Column | Semantic Meaning | Data Type & Constraint | Rotation Role |
|---|---|---|---|
| `idempotency_key_hash` | Persisted Locator HMAC | `text NOT NULL` | Looked up via candidate HMACs generated across active + retained keys |
| `hash_version` | Locator hash scheme (stable algorithm) | `text NOT NULL DEFAULT 'hmac-sha256-v1'` | Fixed scheme `'hmac-sha256-v1'` (**NEVER** a key version) |
| `pepper_version` | Locator HMAC key version | `integer NOT NULL DEFAULT 1 CHECK (pepper_version >= 1)` | Numeric version of Keyring 1 key used for this locator |
| `request_fingerprint` | Persisted sensitive semantic fingerprint HMAC | `text NOT NULL` | Compared via `crypto.timingSafeEqual` during replay |
| `fingerprint_scheme` | Fingerprint algorithm + canonicalization scheme | `text NOT NULL DEFAULT 'rfc8785-hmac-sha256-v1'` | Fixed algorithm scheme `'rfc8785-hmac-sha256-v1'` |
| `fingerprint_key_version` | Sensitive semantic fingerprint key version | `integer NOT NULL DEFAULT 1 CHECK (fingerprint_key_version >= 1)` | Numeric version of Keyring 2 key needed to recompute and verify fingerprint |
| `operation` | Canonical operation identifier | `text NOT NULL` | Claim scope |
| `actor_scope_hash` | SHA-256 hash of actor scope | `text NOT NULL` | Claim scope |
| `resource_scope_hash` | SHA-256 hash of resource scope | `text NOT NULL` | Claim scope |

- **Strict Prohibitions:**
  - `fingerprint_version` is **TERMINANTEMENTE PROIBIDO** as a database column or concurrent authority.
  - `hash_version` is **NEVER** reinterpreted as a key version.
  - Raw idempotency key and raw CPF are **NEVER** persisted in idempotency records.

- **Candidate Generation & Replay Operations:**
  - **Candidate Locator Generation:** For each retained locator key `{ pepper_version, secret }`, generate `idempotency_key_hash` under the stable scheme `hash_version = 'hmac-sha256-v1'`. Query:
    ```sql
    SELECT * FROM store_idempotency_record
    WHERE operation = $op
      AND actor_scope_hash = $actor
      AND resource_scope_hash = $cart
      AND idempotency_key_hash IN ($candidateLocators)
    FOR UPDATE;
    ```
  - **Replay Evaluation:** For a matched record, read `fingerprint_scheme` and `fingerprint_key_version`. Recompute request fingerprint using that specific scheme and the retained Keyring 2 secret for `fingerprint_key_version`. Compare with persisted `request_fingerprint` via `crypto.timingSafeEqual`.
    - Match -> replay.
    - Divergence -> 409 `IDEMPOTENCY_KEY_REUSE_CONFLICT`.
    - Unknown `fingerprint_key_version` or `fingerprint_scheme` -> fail closed (`500 IDEMPOTENCY_KEYRING_UNKNOWN_VERSION`).
    - >1 matches -> fail closed (`500 IDEMPOTENCY_KEYRING_COLLISION`) + operational alert.
    - Incomplete/corrupted keyring -> fail closed (`503 PRIVACY_KEYRING_UNAVAILABLE`) before SQL query.

- **Required Test Specifications in Plan:**
  Future integration and unit tests in `17-03-PLAN.md` specify:
  1. Old locator `pepper_version` replay after rotation.
  2. New locator uses active `pepper_version`.
  3. `hash_version` remains scheme, not key version.
  4. Old `fingerprint_key_version` replay after rotation.
  5. New fingerprint uses active `fingerprint_key_version`.
  6. `fingerprint_scheme` remains algorithm/canonicalization scheme.
  7. Unknown retained locator key version -> fail closed (500).
  8. Unknown fingerprint key version -> fail closed (500).
  9. >1 retained locator match -> fail closed (500).
  10. 0 match with incomplete keyring -> fail closed (503) before first_claim.
  11. Raw idempotency key never persisted; raw CPF never persisted.

- **Files Reconciled:** `17-02-PLAN.md`, `17-03-PLAN.md`, `17-PATTERNS.md` (§3.4), `17-VALIDATION.md` (item 03), `17-PLAN-REVIEW.md`, `17-PR29-R1-REMEDIATION.md`.

---

### B17-PR29-HR-21 (P1): `has_valid_cpf` is Consumed Without an Explicit Producer

- **Root Cause & Architectural Problem:**
  PR29-R1 updated `evaluatePaymentStartEligibility` in `17-07-PLAN.md` to consume a sanitized projection containing `lifecycle_state === "ready"` and `has_valid_cpf === true`. However, the plan did not define:
  1. Which service produces `has_valid_cpf`.
  2. How `has_valid_cpf` is derived.
  3. Which method returns the projection.
  4. What transactional lock authority it executes under.
  5. How PII boundary isolation is maintained.

- **Authoritative Producer Definition:**
  Materialized on `CheckoutPrivacyModuleService` in `apps/backend/src/modules/checkout-privacy/service.ts`:
  ```typescript
  async getPaymentEligibilityProjection(
    cartId: string,
    sharedContext?: SharedTransactionContext
  ): Promise<ProtectedCheckoutEligibilityProjection | null>
  ```

- **Public Inter-Module Projection Type:**
  Exported from `apps/backend/src/modules/checkout-privacy/types.ts`:
  ```typescript
  export type ProtectedCheckoutEligibilityProjection = {
    protected_data_id: string
    cart_id: string
    customer_id: string
    lifecycle_state: "draft" | "ready" | "snapshot_prepared" | "purged"
    data_revision: number
    has_valid_cpf: boolean
  }
  ```

- **Derivation Semantics (Derived, Non-Persisted, Sanitized):**
  - No `has_valid_cpf` column is created in `protected_checkout_data` (avoiding redundant persisted booleans).
  - The producer **NEVER** decrypts CPF to answer payment eligibility.
  - Derivation rule:
    ```typescript
    has_valid_cpf = (
      row != null &&
      row.lifecycle_state === "ready" &&
      row.encrypted_cpf != null &&
      row.cpf_nonce != null &&
      row.cpf_tag != null &&
      row.cpf_wrapped_dek != null &&
      row.deleted_at == null
    )
    ```
  - Rationale: Encrypting and persisting the CPF envelope in `protected_checkout_data` occurs **ONLY** after CPF normalization and server-side modulo-11 checksum validation. Therefore, a complete 4-column envelope in `ready` state is mathematical proof of a valid, validated CPF.

- **Zero PII Boundary Isolation:**
  The projection contains:
  - ZERO raw CPF
  - ZERO encrypted ciphertext (`encrypted_cpf`)
  - ZERO nonce (`cpf_nonce`)
  - ZERO authentication tag (`cpf_tag`)
  - ZERO wrapped DEK (`cpf_wrapped_dek`)
  Neither plaintext nor ciphertext crosses into the `payment-attempt` module.

- **Transactional Lock Authority:**
  `evaluatePaymentStartEligibility()` executes under the canonical cart/payment authority lock:
  ```typescript
  await lockCartOrderAuthority(transaction, cartId)
  // PostgreSQL: select pg_advisory_xact_lock(hashtextextended(?, 1515))
  ```
  It validates:
  1. Canonical customer/cart ownership (`projection.customer_id === actor.customerId`).
  2. Active row existence (`projection != null`).
  3. Lifecycle state ready (`projection.lifecycle_state === "ready"`).
  4. CPF validity (`projection.has_valid_cpf === true`).
  5. Physical shipping address validity (`validateBrazilShippingAddress(cart.shipping_address, { requireFederalTaxId: false })`).
  6. Zero reliance on `cart.shipping_address.metadata.federal_tax_id`.

- **Required Test Specifications in Plan:**
  Future unit and HTTP integration tests in `17-07-PLAN.md` specify:
  1. Valid protected checkout + `shipping_address.metadata` without `federal_tax_id` + lifecycle ready + complete envelope -> payment start eligible.
  2. Draft without CPF -> payment start ineligible (`CHECKOUT_DATA_INCOMPLETE`).
  3. Draft with CPF but not final-ready -> payment start ineligible.
  4. Purged protected data -> payment start ineligible.
  5. Ready row with impossible/missing envelope -> DB constraint violation or fail closed.
  6. Projection contains no plaintext or ciphertext CPF.
  7. Payment eligibility never reads `shipping_address.metadata.federal_tax_id`.

- **Files Reconciled:** `17-07-PLAN.md` (`files_modified`, `must_haves`, `artifacts`, `key_links`, Tasks 17-07-02 and 17-07-03), `17-PATTERNS.md` (§3.8), `17-VALIDATION.md` (item 07), `17-PLAN-REVIEW.md`.

---

### B17-PR29-HR-22 (Material P2): Eliminate All 23-Logical / 26-Physical Schema Ambiguity

- **Root Cause & Analysis:**
  Certain sentences in `17-02-PLAN.md`, `17-VALIDATION.md`, and `17-PLAN-REVIEW.md` used shorthand expressions such as "com 23 colunas exatas" or "complete 23-column snapshot". In PostgreSQL, the Medusa v2 framework adds 3 framework metadata columns (`created_at`, `updated_at`, `deleted_at`), resulting in exactly 26 physical columns for the 23 logical fields.

- **Canonical Authority & Mandatory Wording:**
  All documents must strictly use:
  ```text
  23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns
  including Medusa framework metadata columns.
  ```
  And map logical `snapshot_id` to physical primary key column `id` with prefix `posnap_...`.

- **Global Scan & Remediation:**
  - `17-02-PLAN.md` line 45: Replaced "com 23 colunas exatas e DEK própria" with "com 23 campos lógicos mandatórios mapeados a 26 colunas físicas no PostgreSQL (incluindo metadados de framework Medusa) e DEK própria".
  - `17-VALIDATION.md` line 62: Replaced "complete 23-column protected_order_snapshot" with "protected_order_snapshot with 23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns".
  - `17-VALIDATION.md` line 74: Replaced "complete 23-column protected_order_snapshot schema" with "protected_order_snapshot schema with 23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns".
  - `17-VALIDATION.md` line 94: Clarified "23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns (PK id posnap_...)".
  - `17-PLAN-REVIEW.md` line 155: Replaced "exact 23-column snapshot" with "23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns".

- **Files Reconciled:** `17-02-PLAN.md`, `17-VALIDATION.md`, `17-PLAN-REVIEW.md`.

---

### B17-PR29-HR-23 (Documental P2): Validation Status Header is Stale

- **Root Cause & Analysis:**
  `17-VALIDATION.md` retained a stale status line referencing an earlier review cycle: `POST-PLANNING VALIDATION STRATEGY (Remediated for B17-PLAN-HR-30..B17-PLAN-HR-32)`.

- **Remediation (Historical PR29-R2 Record):**
  Historically updated `17-VALIDATION.md` header during R2 to:
  ```markdown
  **Status:** POST-APPROVAL PR #29 PLAN VALIDATION — PR29-R2 REMEDIATION IN PROGRESS (Historical: P17-PLAN-HR-01 was OPEN at R2)
  ```
  (Subsequently superseded by PR29-R3 and final Human Re-Approval: `P17-PLAN-HR-01 HUMAN RE-APPROVED — PASS — CLOSED`).
  Synchronized `STATE.md` and `ROADMAP.md` to reflect the residual review findings and the PR29-R2 remediation state, ensuring historical references to H6 remain marked as historical PASS.

- **Files Reconciled:** `17-VALIDATION.md`, `STATE.md`, `ROADMAP.md`.

---

## 4. Reconciled Plan Matrix (PR29-R2)

| Plan | Waves | Primary Focus | Findings Reconciled in PR29-R2 |
|---|---|---|---|
| `17-01-PLAN.md` | Wave 0 | FakeKmsProvider, AWS KMS adapter, Envelope Encryption | (Verified consistent) |
| `17-02-PLAN.md` | Wave 1 | PostgreSQL DDL, atomic constraints, immutability triggers | HR-20, HR-22 |
| `17-03-PLAN.md` | Wave 2 | Double keyrings, StoreIdempotencyRecord integration | HR-20 |
| `17-04-PLAN.md` | Wave 3 | Purge worker scan, 30d escalation, FIN-03/04 suspension | (Verified consistent) |
| `17-05-PLAN.md` | Wave 4 | Gelato dispatch relay entry guard, country normalization | (Verified consistent) |
| `17-06-PLAN.md` | Wave 5 | Store surface manifest, BFF exact-set, PATCH support | (Verified consistent) |
| `17-07-PLAN.md` | Wave 6 | `getPaymentEligibilityProjection` producer, payment start | HR-21 |
| `17-08-PLAN.md` | Wave 7 | OpenAPI registry, Store contract, human contract gate | (Verified consistent) |
| `17-09-PLAN.md` | Wave 8 | Option B-R recoverable snapshot, transaction adapter, FP1..FP6 | (Verified consistent) |
| `17-10-PLAN.md` | Wave 9 | 17-sink negative PII canary verification (CHK-08 proof) | (Verified consistent) |
| `17-11-PLAN.md` | Wave 10 | E2E synthesis, validate-phase17-final.mjs, clean gate | (Verified consistent) |

---

## 5. Summary of Verification & Static Scans

- **Double-Keyring Persisted Schema Scan:**
  - `fingerprint_version` as persisted column: **0 occurrences** (clean).
  - `hash_version` used as key version: **0 occurrences** (clean; consistently represents locator hash scheme `'hmac-sha256-v1'`).
  - `pepper_version` used as locator key version: **100% consistent**.
  - `fingerprint_key_version` used as semantic fingerprint key version: **100% consistent**.
  - `fingerprint_scheme` used as algorithm/canonicalization scheme: **100% consistent**.

- **Payment Eligibility Producer/Consumer Scan:**
  - `has_valid_cpf` consumer without producer: **0 occurrences** (clean; produced exclusively by `CheckoutPrivacyModuleService.getPaymentEligibilityProjection`).
  - PII boundary: Zero raw CPF, zero ciphertext, zero nonce, zero tag, zero DEK in projection.
  - Transaction authority: Operates under canonical cart authority lock `lockCartOrderAuthority`.

- **Snapshot Schema Wording Scan:**
  - Contradictory "23 physical columns" wording: **0 occurrences** (clean).
  - All occurrences adhere to `23 mandatory logical snapshot fields mapped to 26 physical PostgreSQL columns including Medusa framework metadata columns`.

- **GSD Consistency:**
  - `CHK-01..CHK-10`: 10/10 mapped and covered.
  - `D17-01..D17-16`: 16/16 preserved.
  - `R17-HR-01..R17-HR-10`: 10/10 preserved.
  - `FIN-01..FIN-04`: 4/4 preserved.
  - `R17-BLOCK-01`: Retained.

- **Hygiene:**
  - Runtime files modified: **0**.
  - Commits: **0**.
  - Pushes: **0**.
  - PR thread resolutions: **0**.

---

## 6. Post-Perspective H7 Human Residual Review Note

Perspective H7 executed and passed with **HISTORICAL PASS** (P0=0, P1=0, P2=0, P3=0). Findings `B17-PR29-HR-20` through `B17-PR29-HR-23` remain **CLOSED — PASS**.

Subsequent human residual review identified two residual items:
- **B17-PR29-HR-24 — P1:** PostgreSQL keyring persistence test (`keyrings-persistence.integration.spec.ts`) was located outside the Jest unit test pattern and outside the module runner's exact-set directory, creating an unreachable test gap. Reconciled in PR29-R3 by reusing `apps/backend/integration-tests/modules/checkout-privacy.postgres.spec.ts`.
- **B17-PR29-HR-25 — P2 DOCUMENTAL:** ROADMAP retained stale `plans 50/50` counter under Current state instead of canonical `50 completed / 61 materialized`. Reconciled in PR29-R3.

Authority and full technical remediation details are recorded in `.planning/phases/17-authenticated-br-checkout-privacy/17-PR29-R3-REMEDIATION.md`.
