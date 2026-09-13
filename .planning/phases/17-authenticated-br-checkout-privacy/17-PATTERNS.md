# Phase 17: Authenticated BR Checkout & Privacy — Pattern Map

**Mapped:** 2026-09-10  
**Authority:** `17-CONTEXT.md`, `17-RESEARCH.md`, `17-RESEARCH-REVIEW.md`, `17-RESEARCH-HUMAN-REVIEW.md`, `17-DECISION-ADJUDICATION.md`, `16-PR28-REMEDIATION.md`  
**Harness:** Antigravity IDE  
**Model & Policy:** Gemini 3.8 Flash | Orchestrator effort: orchestrator-selected per work unit (`low | medium | high`) | Subagents: required, serial, parallelization: false  
**Waves:** 11 plans in 11 serial waves (Waves 0 to 10)  
**Scope:** Planning guidance and architectural pattern assignment; no implementation code or migrations applied.

---

## 1. Binding Baseline & Accepted Invariants

- **Exact Requirements:** `CHK-01..CHK-10` from `REQUIREMENTS.md` = 10/10 mapped, binding, and currently OPEN:
  - `CHK-01`: Exigir `Customer` autenticado antes de draft, validação, frete e pagamento do Frontend M1.
  - `CHK-02`: Separar atualização parcial válida do draft e validação final atômica.
  - `CHK-03`: Modelar endereço de pessoa física no Brasil com campos, UF, CEP e erros por campo estáveis.
  - `CHK-04`: Aceitar somente CPF no M1 e validar dígitos/checksum server-side; CNPJ permanece fora de escopo.
  - `CHK-05`: Remover CPF cru de `shipping_address.metadata` e proteger o valor com AES-256-GCM ou mecanismo equivalente, chave externa e `key_version`.
  - `CHK-06`: Materializar dados sensíveis de checkout/order e constraints conforme revisão prévia do `DB_MODEL_v1.21.md`.
  - `CHK-07`: Purgar CPF de carrinho abandonado após 7 dias e preservar somente o snapshot criptografado necessário no `Order`.
  - `CHK-08`: Retornar CPF somente mascarado e provar ausência em Stripe, Gelato, PostHog, Sentry, logs e respostas não autorizadas.
  - `CHK-09`: Persistir recibos de consentimento por finalidade com versão, timestamp, Customer/cart e sem user agent.
  - `CHK-10`: Retornar `checkout_data_complete` derivado, `fieldErrors` estáveis e bloquear total final zero.
- **Accepted Decisions:** `D17-01..D17-16` preserved 16/16 without alteration.
- **Human Adjudications:** `R17-HR-01..R17-HR-10` preserved 10/10; `R17-HR-04` and `R17-HR-05` retain `LEGAL REVIEW REQUIRED`.
- **Financial Authorities:** `FIN-01..FIN-04` preserved 4/4; unresolved financial risk freezes structural cart mutations; local timeout or failure never thaws financial state.
- **Order Birth Authority:** Orders are born exclusively via trusted canonical Stripe webhook `payment_intent.succeeded` managed by `CheckoutCompletionLog` (CCL) and `webhook-order-entrypoint.ts`. Phase 17 creates **exactly 0 synchronous Orders**.
- **External Blocker & Conflict:**
  - `R17-CONFLICT-01`: External product/provider conflict confirmed (Gelato requires `federalTaxId` for Brazil shipments, while D17-12 forbids raw CPF to Gelato).
  - `R17-BLOCK-01`: Retained as an exit/closure blocker. Brazil Gelato fulfillment must fail closed before any provider network request. Zero raw, masked, fake, or merchant CNPJ substitution. Phase 17 closure is blocked until `R17-BLOCK-01` is resolved by external authority; Phase 18 and release remain NOT AUTHORIZED.
- **Checkout Privacy Domain:** One cohesive Medusa module (`checkout_privacy`) owns protected current checkout data, legal receipts, protected Order snapshots, and sanitized purge ledgers. Module isolation is strictly maintained; zero raw sibling-module DB access.
- **Abandonment Clock:** `pii_last_meaningful_activity_at` starts on first valid protected CPF persistence and resets only on human-authenticated valid mutation, required receipt change, or successful final validation. `Cart.updated_at`, reads, replays, workers, or technical activity NEVER reset the clock. Strict 7-day deadline with zero grace period. Due purge suspended only under FIN-03/FIN-04 without advancing original due time (`deferred_financial_authority`, `due_now`).
- **Cryptography & KMS Lifecycle:** AWS KMS adapter (`AwsKmsProvider`) using `@aws-sdk/client-kms` + customer-managed symmetric KEK + per-record DEK + local AES-256-GCM (12-byte CSPRNG nonce, 16-byte tag, canonical versioned AAD without mutable revision). Zeroization of plaintext DEKs in memory; no cross-request caching. Deterministic `FakeKmsProvider` with controllable failure injection and CSPRNG keys for offline testing. Full KMS lifecycle: logical KEK registry, old-version decrypt/rewrap-only policy, annual/emergency rotation workflow, wrapped-DEK rewrap job (`rewrap-protected-data.ts`), zero-dependency inventory, and pending-deletion gates.
- **Double Keyrings (R17-HR-10):** Keyring 1 (HMAC locator) + Keyring 2 (sensitive semantic fingerprint RFC 8785). 0 matches -> first claim; 1 match -> replay; >1 matches -> fail closed (500); incomplete/corrupt keyring -> fail closed (503).
- **Surface & Precedence (R17-HR-07):** BFF-only, Customer-authenticated exact set (`GET /checkout-details`, `PATCH /checkout-details`, `POST /checkout-details/validate`). `billing_address = ABSENT` strictly rejected (400). 12-stage authority and error precedence chain enforced. Store inventory locked at 69 operations (51 native + 18 local, 17 M1 enabled).
- **Recoverable Order-Birth Architecture:** Instead of assuming synchronous transaction participation across Medusa module boundaries, Phase 17 implements a recoverable transaction pipeline in `webhook-order-entrypoint.ts` with `ensureProtectedSnapshotBoundOrReconciled` executed across all 5 recovery paths.

---

## 2. File Classification & Analogs

| File Path | Change Type | Architectural Role | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/backend/package.json` | modify | Dependency Manifest (Add `@aws-sdk/client-kms`) | Existing `package.json` dependencies | exact target |
| `apps/backend/src/modules/checkout-privacy/index.ts` | new | Module Registration & Container Export | `apps/backend/src/modules/cart-merge/index.ts` | exact role |
| `apps/backend/src/modules/checkout-privacy/types.ts` | new | Domain & DTO Types | `apps/backend/src/modules/cart-merge/types.ts` | exact role |
| `apps/backend/src/modules/checkout-privacy/service.ts` | new | Checkout Privacy Module Service | `apps/backend/src/modules/cart-merge/service.ts` | exact role |
| `apps/backend/src/modules/checkout-privacy/models/protected-checkout-data.ts` | new | Medusa Data Model (Current Cart Authority) | `apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/models/legal-receipt.ts` | new | Medusa Data Model (Immutable Legal Receipts) | `apps/backend/src/modules/guest-cart-capability/models/guest-cart-capability.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/models/protected-order-snapshot.ts` | new | Medusa Data Model (Pre-Order Snapshot) | `apps/backend/src/modules/checkout-completion/models/checkout-completion-log.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/models/sanitized-purge-ledger.ts` | new | Medusa Data Model (Idempotent Purge Audit Stream) | `apps/backend/src/modules/admin-action-log/models/admin-action-log.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/crypto/kms-provider.ts` | new | Abstract KMS Provider Interface & Types | Node.js crypto / AWS KMS SDK abstraction | role match |
| `apps/backend/src/modules/checkout-privacy/crypto/aws-kms-provider.ts` | new | Production AWS KMS Client Adapter | AWS SDK KMS Client (`GenerateDataKey`, `Decrypt`, `ReEncrypt`) | exact role |
| `apps/backend/src/modules/checkout-privacy/crypto/fake-kms-provider.ts` | new | Deterministic Offline KMS Provider (Failure Injection) | `apps/backend/integration-tests/helpers/cart-merge-postgres.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/crypto/envelope-service.ts` | new | Local AES-256-GCM & In-Memory Zeroization | Node.js `crypto.createCipheriv` / `createDecipheriv` | role match |
| `apps/backend/src/modules/checkout-privacy/crypto/keyrings.ts` | new | Double Keyrings (Locator & Semantic Fingerprint) | `apps/backend/src/modules/store-idempotency/operations.ts` | role match |
| `apps/backend/src/modules/checkout-privacy/crypto/kek-lifecycle.ts` | new | KEK Version Registry, Rotation & Zero-Dep Gates | `apps/backend/src/modules/checkout-privacy/crypto/` | exact role |
| `apps/backend/src/jobs/rewrap-protected-data.ts` | new | Scheduled Wrapped-DEK Rewrap Job | `apps/backend/src/jobs/` | role match |
| `apps/backend/src/modules/checkout-privacy/migrations/Migration20260910_checkout_privacy.ts` | new | PostgreSQL DDL Migration with One-Way-Door Guard | `apps/backend/src/modules/store-resource-version/migrations/Migration20260809201808.ts` | exact role |
| `apps/backend/medusa-config.ts` | modify | Custom Module Registration (`checkout_privacy`) | Existing entries in `medusa-config.ts:99-115` | exact |
| `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts` | modify | Module Registration Assertion Test | Same test checking `expectedLocalModules` | exact |
| `apps/backend/src/api/store-surface/manifest.ts` | modify | Store Surface Manifest (66 -> 69 operations, 14 -> 17 M1) | Phase 15/16 entries in `apps/backend/src/api/store-surface/manifest.ts` | exact |
| `apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts` | modify | Store Surface Manifest Unit Regression | Same test asserting 69 total, 17 M1 | exact |
| `apps/backend/scripts/store-surface/scan-installed.ts` | modify | Store Surface Scanner Script | Scanner asserting 69 operations | exact |
| `apps/backend/src/api-docs/coverage/verify-coverage.ts` | modify | Store Coverage Verifier | Coverage verifier asserting 69 operations | exact |
| `apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts` | modify | API Docs Coverage Unit Regression | Test asserting 69 total operations | exact |
| `apps/backend/integration-tests/http/store-foundation-final.spec.ts` | modify | Store Foundation Final Surface Regression | Test asserting 69 total operations | exact |
| `apps/backend/integration-tests/http/store-surface-lockdown.spec.ts` | modify | Store Surface Lockdown HTTP Regression | Test asserting 69 total operations | exact |
| `apps/backend/integration-tests/http/guest-cart-contract-matrix.spec.ts` | modify | Guest Cart Contract Matrix HTTP Regression | Test asserting 69 total operations | exact |
| `apps/backend/src/api/store-surface/errors.ts` | modify | Error Taxonomy, Serialization & Field Allowlist | Same file error serializers | exact |
| `apps/backend/src/api/middlewares.ts` | modify | Route Middleware Wiring (BFF + Customer Bearer) | `apps/backend/src/api/middlewares.ts:657-699` | exact |
| `apps/backend/src/api/store/carts/bff-protected-operations.ts` | modify | BFF Protected Operations List | Same file | exact |
| `apps/backend/src/api/store/carts/[id]/checkout-details/route.ts` | new | GET & PATCH `/store/carts/{id}/checkout-details` | `apps/backend/src/api/store/customers/me/cart/merge/route.ts` | role match |
| `apps/backend/src/api/store/carts/[id]/checkout-details/validate/route.ts` | new | POST `/store/carts/{id}/checkout-details/validate` | `apps/backend/src/api/store/carts/[id]/review/acknowledge/route.ts` | role match |
| `apps/backend/src/api/store/carts/checkout-details-validators.ts` | new | Strict Zod Schemas & Domain Validators | `apps/backend/src/api/store/carts/merge-review-validators.ts` | exact role |
| `apps/backend/src/api/store/carts/checkout-details-serializers.ts` | new | Allowlisted Response Projections & Masking | `apps/backend/src/api/store/carts/serializers.ts` | exact role |
| `apps/backend/src/api-docs/operations/store/checkout-details.ts` | new | TypeScript OpenAPI Contract Registration | `apps/backend/src/api-docs/operations/store/carts.ts` | exact role |
| `apps/backend/src/api-docs/operations/store/index.ts` | modify | Store Operations Registration Bundle | Same file | exact |
| `apps/backend/src/api-docs/operations/store/schemas.ts` | modify | Store OpenAPI Schemas | Same file | exact |
| `apps/backend/src/modules/gelato-fulfillment/service.ts` | modify | Fail-Closed Zero-Request Brazil Privacy Guard | Same file | exact target |
| `apps/backend/src/modules/gelato-fulfillment/types.ts` | modify | Remove `federalTaxId` from Dispatch Types | Same file | exact target |
| `apps/backend/src/jobs/gelato-dispatch-relay.ts` | modify | Blind Relay Against Brazil Domestic Dispatch | Same file | exact target |
| `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-dispatch.unit.spec.ts` | modify | Sanitize Fixtures & Assert Zero Federal Tax ID | Same file | exact target |
| `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` | modify | Recoverable Snapshot Preparation & Seam Integration | Same file (lines 2430–2520, recovery branches) | exact target |
| `apps/backend/src/modules/checkout-completion/service.ts` | modify | Hook Pre-Order Protected Snapshot in CCL | Same file | exact target |
| `apps/backend/scripts/run-disposable-postgres-modules.mjs` | modify | Modules Exact-Set Runner (Expand EXPECTED_MODULE_SPECS 17 -> 21) | Same file | exact target |
| `package-lock.json` | modify | Root Workspace Dependency Lockfile | Root package-lock.json updated via npm install | exact |
| `apps/backend/integration-tests/helpers/checkout-privacy-postgres.ts` | new | Disposable PostgreSQL Test Helper & Fixtures | `apps/backend/integration-tests/helpers/cart-merge-postgres.ts` | exact role |
| `apps/backend/src/modules/checkout-privacy/__tests__/fake-kms-provider.unit.spec.ts` | new | Unit Test Suite for FakeKmsProvider & AwsKmsProvider | Same directory | exact role |
| `apps/backend/integration-tests/http/checkout-details.spec.ts` | new | HTTP Integration Suite for Checkout Surface | `apps/backend/integration-tests/http/cart-merge-review.spec.ts` | exact role |
| `apps/backend/integration-tests/modules/checkout-privacy.postgres.spec.ts` | new | PostgreSQL Isolation, Clocks & CAS Concurrency | `apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts` | exact role |
| `apps/backend/integration-tests/modules/checkout-privacy-canary.spec.ts` | new | Negative PII Sink Multi-Canary Verification | `apps/backend/integration-tests/helpers/guest-cart-leakage.ts` | exact role |
| `apps/backend/integration-tests/modules/gelato-privacy-guard.spec.ts` | new | Zero-Request Gelato Brazil Privacy Guard Proof | `apps/backend/src/modules/gelato-fulfillment/__tests__/` | exact role |
| `apps/backend/integration-tests/modules/phase17-e2e.spec.ts` | new | End-to-End Test Suite for Phase 17 Synthesis | `apps/backend/integration-tests/modules/` | exact role |

---

## 3. Pattern Assignments

### 3.1 Module Definition & Configuration
- **Pattern Source:** `apps/backend/src/modules/cart-merge/index.ts` and `apps/backend/src/modules/store-idempotency/index.ts`.
- **Export Shape:**
  ```typescript
  export const CHECKOUT_PRIVACY_MODULE = "checkout_privacy"
  export default Module(CHECKOUT_PRIVACY_MODULE, {
    service: CheckoutPrivacyModuleService,
  })
  ```
- **Registration in `medusa-config.ts`:**
  ```typescript
  {
    key: "checkout_privacy",
    resolve: "./src/modules/checkout-privacy",
  },
  ```
- **Unit Verification:** Proved in `apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts` by adding `"checkout_privacy"` to `expectedLocalModules`.

### 3.2 Data Models, DDL & Immutability Trigger (B17-PLAN-HR-17, B17-PLAN-HR-18, B17-PLAN-HR-19, B17-PLAN-HR-27, B17-PLAN-HR-30)
- **Pattern Source:** `apps/backend/src/modules/cart-merge/models/` and `apps/backend/src/modules/store-idempotency/models/`.
- **Pre-fixed IDs:** `pcdata_...`, `lgrcp_...`, `posnap_...`, `prgled_...`.
- **ProtectedCheckoutData Schema & Independent Purge State (B17-PLAN-HR-20, B17-PLAN-HR-30):**
  - Columns:
    - `id`: primary key (`pcdata_...`)
    - `cart_id`: text (indexed)
    - `customer_id`: text (indexed)
    - `data_revision`: integer (`CHECK ("data_revision" >= 1)`)
    - `lifecycle_state`: enum (`'draft'`, `'ready'`, `'snapshot_prepared'`, `'purged'`)
    - `purge_state`: enum (`'active'`, `'freeze_suspended'`, `'due_now'`, `'purged'`, `'manual_intervention_required'`)
    - `deferred_financial_authority`: boolean NOT NULL DEFAULT false
    - Structured BR address: `first_name`, `last_name`, `phone`, `postal_code`, `street`, `number`, `neighborhood`, `city`, `province`, `country_code` (`CHECK ("country_code" = 'BR')`), `complement`
    - Encrypted envelope: `encrypted_cpf`, `cpf_nonce`, `cpf_tag`, `cpf_wrapped_dek`
    - Key & AAD versions: `key_version` (text), `aad_version` (text)
    - Timestamps & clocks: `pii_last_meaningful_activity_at`, `cpf_purge_due_at`, `purged_at`, `purge_reason`, `created_at`, `updated_at`, `deleted_at`
  - Atomic envelope constraint (HR-01 3-branch envelope):
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
  - Purge state coherence constraint:
    ```sql
    CONSTRAINT CK_protected_checkout_data_purge_coherence CHECK (
      (lifecycle_state = 'purged' AND purge_state = 'purged')
      OR
      (lifecycle_state != 'purged' AND purge_state != 'purged')
    )
    ```
  - Deferred financial authority coherence constraint:
    ```sql
    CONSTRAINT CK_protected_checkout_data_deferred_fin_auth CHECK (
      (purge_state = 'freeze_suspended' AND deferred_financial_authority = true)
      OR
      (purge_state = 'active' AND deferred_financial_authority = false)
      OR
      (purge_state = 'due_now' AND deferred_financial_authority = false)
      OR
      (purge_state = 'purged' AND deferred_financial_authority = false)
      OR
      (purge_state = 'manual_intervention_required')
    )
    ```
  - Clock check: active CPF requires `pii_last_meaningful_activity_at IS NOT NULL` and `cpf_purge_due_at IS NOT NULL`.
  - Partial unique index:
    `CREATE UNIQUE INDEX UQ_protected_checkout_data_active_cart ON protected_checkout_data (cart_id) WHERE lifecycle_state != 'purged' AND deleted_at IS NULL;`

- **ProtectedOrderSnapshot Schema & Cardinality Constraints (B17-PLAN-HR-17, B17-PLAN-HR-18, B17-PR29-HR-09):**
  - Mapeamento relacional: 23 campos lógicos obrigatórios mapeados para PK `id` (`posnap_...`) e colunas padrão Medusa v2 (26 colunas físicas no banco):
    1. `id`: primary key física (`posnap_...`, correspondente ao campo lógico `snapshot_id`)
    2. `schema_version`: integer (default `1`)
    3. `envelope_version`: text (default `'v1'`)
    4. `aad_version`: text (default `'v1'`)
    5. `key_version`: text (logical KEK version)
    6. `lifecycle_state`: enum (`'prepared'`, `'bound'`, `'purged'`, `'reconciliation_required'`)
    7. `encrypted_cpf`: text (re-encrypted with fresh snapshot DEK)
    8. `cpf_nonce`: text (fresh 12B CSPRNG nonce)
    9. `cpf_tag`: text (16B GCM authentication tag)
    10. `cpf_wrapped_dek`: text (wrapped with active KMS KEK)
    11. `source_protected_data_id`: text (lineage tracking to originating checkout data)
    12. `source_data_revision`: integer (source cart data revision)
    13. `customer_id`: text
    14. `cart_id`: text
    15. `payment_attempt_id`: text
    16. `checkout_completion_log_id`: text
    17. `order_id`: text nullable (bound exactly once)
    18. `receipt_ids`: jsonb (array of legal receipt IDs linked to this snapshot)
    19. `receipt_bindings`: jsonb (array of { receipt_id, document_digest, purpose } digests)
    20. `retention_policy_version`: text (default `'v1'`, decoupled from statutory retention limits pending R17-HR-05)
    21. `prepared_at`: timestamptz (immutable snapshot generation timestamp)
    22. `bound_at`: timestamptz nullable (timestamp of correlation to physical Medusa Order)
    23. `purged_at`: timestamptz nullable (timestamp of eventual legal lifecycle purge)
    24. `created_at`: timestamptz (coluna padrão Medusa)
    25. `updated_at`: timestamptz (coluna padrão Medusa)
    26. `deleted_at`: timestamptz nullable (coluna padrão Medusa)
  - Strict Relational Cardinality (B17-PLAN-HR-18):
    ```sql
    CONSTRAINT UQ_protected_order_snapshot_ccl_id UNIQUE ("checkout_completion_log_id");
    CONSTRAINT UQ_protected_order_snapshot_pa_id UNIQUE ("payment_attempt_id");
    CREATE UNIQUE INDEX UQ_protected_order_snapshot_order_id ON protected_order_snapshot ("order_id") WHERE "order_id" IS NOT NULL;
    ```
  - Error separation: `23505` (`unique_violation`) indicates concurrent relational collision on CCL/PaymentAttempt/Order; `55000` indicates invalid lifecycle state transitions (e.g. attempting to bind an already bound snapshot).

- **LegalReceipt Schema & Complete Immutability (B17-PLAN-HR-27, B17-PR29-HR-16):**
  - Columns: `id`, `customer_id`, `cart_id`, `purpose`, `legal_act_type` (`'contract_acceptance'`, `'policy_acknowledgement'`, `'privacy_notice_acknowledgement'`, `'consent'`), `document_version`, `document_digest` (64-char SHA-256), `policy_version`, `accepted_at`, `correlation_id`, `superseded_by_receipt_id` (nullable), `revoked_at` (nullable), `created_at`, `updated_at`, `deleted_at`.
  - Zero user agent, zero IP, zero device fingerprints.
  - Partial unique index:
    `CREATE UNIQUE INDEX UQ_legal_receipt_cart_purpose_version ON legal_receipt (cart_id, purpose, document_version, legal_act_type) WHERE deleted_at IS NULL;`
  - Soft-delete prevention constraint:
    `CONSTRAINT "CK_legal_receipt_deleted_at_null" CHECK ("deleted_at" IS NULL);`
  - Append-only immutability trigger (`trg_legal_receipt_immutable`):
    - Unconditionally blocks `DELETE` (`RAISE EXCEPTION 'LEGAL_RECEIPT_DELETE_FORBIDDEN' USING ERRCODE = '55000'`).
    - Unconditionally blocks soft-delete via `deleted_at` mutation:
      ```sql
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'LEGAL_RECEIPT_SOFT_DELETE_PROHIBITED' USING ERRCODE = '55000';
      END IF;
      ```
    - Unconditionally blocks `UPDATE` for non-consent act types.
    - For `consent`, permits `UPDATE` ONLY when transitioning `OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL`.
    - Enforces bit-for-bit immutability on ALL historical fields using `IS DISTINCT FROM`, including `superseded_by_receipt_id`:
      ```sql
      IF NEW.id IS DISTINCT FROM OLD.id OR
         NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
         NEW.cart_id IS DISTINCT FROM OLD.cart_id OR
         NEW.purpose IS DISTINCT FROM OLD.purpose OR
         NEW.legal_act_type IS DISTINCT FROM OLD.legal_act_type OR
         NEW.document_version IS DISTINCT FROM OLD.document_version OR
         NEW.document_digest IS DISTINCT FROM OLD.document_digest OR
         NEW.policy_version IS DISTINCT FROM OLD.policy_version OR
         NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR
         NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR
         NEW.superseded_by_receipt_id IS DISTINCT FROM OLD.superseded_by_receipt_id OR
         NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'LEGAL_RECEIPT_HISTORICAL_DATA_MUTATION_PROHIBITED' USING ERRCODE = '55000';
      END IF;
      ```
    - Document supersession is modeled strictly as a new append-only row insert; historical receipts are never mutated.

- **Hardened Migration Rollback Guard (B17-PLAN-HR-19):**
  - In `Migration20260910_checkout_privacy.ts down()`:
    ```sql
    IF EXISTS (SELECT 1 FROM protected_order_snapshot WHERE lifecycle_state != 'purged') THEN
      RAISE EXCEPTION 'CHECKOUT_PRIVACY_NON_PURGED_SNAPSHOTS_EXIST' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM legal_receipt) THEN
      RAISE EXCEPTION 'CHECKOUT_PRIVACY_LEGAL_RECEIPTS_EXIST' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM protected_checkout_data WHERE lifecycle_state != 'purged' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'CHECKOUT_PRIVACY_ACTIVE_CHECKOUT_DATA_EXISTS' USING ERRCODE = '55000';
    END IF;
    ```
  - Traps `reconciliation_required`, `prepared`, `bound`, and all active records with `SQLSTATE 55000`.

### 3.3 Cryptography, AWS KMS Adapter & Lifecycle Management (B17-PLAN-HR-22, B17-PR29-HR-15)
- **Pattern Source:** Node.js native `crypto` module (`createCipheriv`, `createDecipheriv`, `randomBytes`, `timingSafeEqual`) and `@aws-sdk/client-kms`.
- **KmsProvider Canonical Single Source of Truth (HR-15):**
  - A interface `KmsProvider` reside exclusivamente em `apps/backend/src/modules/checkout-privacy/crypto/kms-provider.ts`.
  - DTOs e tipos de valor (`EncryptedEnvelope`, `KmsDataKeyResult`, `KmsDecryptResult`, `KmsReEncryptResult`, `KmsEncryptionContext`, `EnvelopeAadContext`) residem em `types.ts`.
  ```typescript
  export type KmsEncryptionContext = {
    application: string
    runtime_environment: string
    domain: string
    authority_kind: "cart" | "order"
    envelope_version: string
    aad_version: string
    logical_key_version: string
  }

  export interface KmsProvider {
    generateDataKey(input: {
      keyId: string
      keySpec?: string
      encryptionContext: KmsEncryptionContext
    }): Promise<KmsDataKeyResult>

    decrypt(input: {
      ciphertextBlob: Buffer | Uint8Array
      encryptionContext: KmsEncryptionContext
      keyId?: string
    }): Promise<KmsDecryptResult>

    reEncrypt(input: {
      ciphertextBlob: Buffer | Uint8Array
      sourceKeyId?: string
      destinationKeyId: string
      sourceEncryptionContext: KmsEncryptionContext
      destinationEncryptionContext: KmsEncryptionContext
    }): Promise<KmsReEncryptResult>
  }
  ```
- **Strict EncryptionContext Whitelist & PII Prohibition:**
  - Allowed keys: `application`, `runtime_environment`, `domain`, `authority_kind`, `envelope_version`, `aad_version`, `logical_key_version`.
  - Disallowed keys (strictly forbidden, fail-closed guard): `cpf`, `customer_id`, `cart_id`, `order_id`, `payment_attempt_id`, `ccl_id`, `checkout_completion_log_id`, `email`, `address`, `phone`, `correlation_id`, `provider_*`.
  - Dynamic environment: `runtime_environment` is derived from approved app configuration / `process.env.NODE_ENV` (never hardcoded to `"production"`).
- **FakeKmsProvider Deterministic Testing:**
  - Offline, zero remote network calls to AWS.
  - Failure injection hooks: `simulateUnavailable`, `failNext`, `corruptKey`.
  - Validates `encryptionContext` cryptographically during local mock decrypt/re-encrypt: mismatched, altered, or missing contexts fail closed (`SQLSTATE`/Error).
  - CSPRNG (`crypto.randomBytes(32)`) for production DEKs, optional injectable seed for KAT vector tests.
- **Envelope Encryption Protocol:**
  - Customer-managed symmetric KEK in AWS KMS.
  - Local encryption: AES-256-GCM, 12-byte CSPRNG nonce, 16-byte tag.
  - Versioned AAD: strictly `indicio:checkout-privacy:aad:v1|<env>|<authority_kind>|<authority_id>|cpf|<envelope_version>|<key_version>` (excluding mutable `data_revision` or cart timestamps).
  - In-Memory Zeroization: Plaintext DEK buffers explicitly wiped with `buffer.fill(0)` in `finally` blocks; zero cross-request caching.
- **KMS Lifecycle & Rotation (R17-HR-03):**
  - Logical KEK version registry (`kek_version`, `arn`, `status: active | retired | disabled | pending_deletion`, `created_at`, `rotated_at`).
  - Old-version decrypt/rewrap-only policy: retired KEK versions can decrypt and rewrap, but new encryptions strictly use the active KEK version.
  - Scheduled rewrap job: `apps/backend/src/jobs/rewrap-protected-data.ts` iterates active records and re-wraps DEKs with the new KEK version via KMS `ReEncrypt`.
  - Zero-dependency inventory gate: Destruction of any KEK version requires proving 0 dependent live records in `protected_checkout_data`, 0 in `protected_order_snapshot`, and no active backup hold.
  - Pending-deletion gate: 7-30 day KMS waiting period and multi-person administrative approval.

### 3.4 Double Keyring System & Persisted Idempotency Authority (R17-HR-10, B17-PR29-HR-02, B17-PR29-HR-20)
- **Persisted Authority & Canonical Schema Contract:**
  - Reutiliza e estende a entidade canônica `StoreIdempotencyRecord` (`store_idempotency_record`), sem criar engine concorrente.
  - Tabela canônica de colunas persistidas e papéis de rotação:

| Coluna Persistida | Significado Semântico | Tipo de Dados | Papel na Rotação |
|---|---|---|---|
| `idempotency_key_hash` | Locator HMAC persistido | `text` | Consultado via HMACs candidatos gerados com as chaves retidas |
| `hash_version` | Locator hash scheme (algoritmo estável) | `text` | Esquema estável `'hmac-sha256-v1'` (NUNCA versão de chave) |
| `pepper_version` | Locator HMAC key version | `integer` (>= 1) | Versão numérica da chave do Keyring 1 usada no locator |
| `request_fingerprint` | Fingerprint HMAC semântico sensível persistido | `text` | Comparado via `crypto.timingSafeEqual` no replay |
| `fingerprint_scheme` | Fingerprint algorithm + canonicalization scheme | `text` | Esquema canônico estável `'rfc8785-hmac-sha256-v1'` |
| `fingerprint_key_version` | Sensitive semantic fingerprint key version | `integer` (>= 1) | Versão numérica da chave do Keyring 2 necessária para recomputar |
| `operation` | Identificador canônico da operação | `text` | Escopo de claim |
| `actor_scope_hash` | Hash SHA-256 do escopo do ator | `text` | Escopo de claim |
| `resource_scope_hash` | Hash SHA-256 do escopo do recurso | `text` | Escopo de claim |

  - **Proibições Estritas de Nomenclatura e Semântica:**
    - `fingerprint_version` é TERMINANTEMENTE PROIBIDO como coluna ou autoridade concorrente.
    - `hash_version` NUNCA deve ser reinterpretado como versão de chave (é o esquema do hash).
    - A chave de idempotência crua e o CPF cru NUNCA são persistidos na autoridade de idempotência.
- **Keyring 1 (Locator HMAC):**
  - Prefixo canônico: `indicio:checkout-privacy:locator:v1|<operation>|<customer_id>|<cart_id>|<idempotency_key>`.
  - Gera candidatos `idempotency_key_hash` sob `hash_version` ('hmac-sha256-v1') para todas as versões de chaves HMAC retidas (`{ pepper_version, secret }`: chave ativa + chaves antigas em janela de rotação).
  - Consulta atômica:
    `SELECT * FROM store_idempotency_record WHERE operation = $op AND actor_scope_hash = $actor AND resource_scope_hash = $cart AND idempotency_key_hash IN ($candidates) FOR UPDATE;`
- **Matriz de Decisão Canônica (4 Ramos):**
  - **0 matches + keyring completo:** primeira reivindicação (`first_claim`). Insere novo registro com a versão de chave ativa (`pepper_version`), esquema de hash ativo (`hash_version = 'hmac-sha256-v1'`), versão de chave ativa do Keyring 2 (`fingerprint_key_version`), esquema ativo (`fingerprint_scheme = 'rfc8785-hmac-sha256-v1'`) e `request_fingerprint` calculado com a chave ativa do Keyring 2.
  - **1 match:** lê `fingerprint_scheme` e `fingerprint_key_version` do registro persistido. Recomputa o request fingerprint utilizando o esquema registrado e a chave retida do Keyring 2 correspondente à `fingerprint_key_version`. Compara com o `request_fingerprint` persistido via `crypto.timingSafeEqual`:
    - Mesmo fingerprint -> `replay` (devolve resposta cacheada ou 409 locked se ainda em processamento).
    - Fingerprint divergente -> `409 IDEMPOTENCY_KEY_REUSE_CONFLICT`.
    - Versão de chave ou esquema desconhecido no keyring retido -> fail closed (`500 IDEMPOTENCY_KEYRING_UNKNOWN_VERSION`).
  - **>1 matches:** colisão de chave HMAC (`500 IDEMPOTENCY_KEYRING_COLLISION`) + alerta operacional imediato.
  - **Keyring incompleto ou corrompido:** fail-closed (`503 PRIVACY_KEYRING_UNAVAILABLE`) antes da consulta SQL para evitar falso `first_claim`.
- **Keyring 2 (Sensitive Semantic Fingerprint):**
  - RFC 8785 Canonical JSON representation domain-separated: `indicio/store/checkout-fingerprint/v1/<operation>`.
  - Ephemeral HMAC-SHA-256 computado com chave dedicada de 256 bits sob `fingerprint_scheme` ('rfc8785-hmac-sha256-v1'); comparado via `timingSafeEqual`. Payload canônico e dados crus são descartados imediatamente da memória.
- **Persistence and Concurrency Verification (HR-24):** Proved in PostgreSQL via `apps/backend/integration-tests/modules/checkout-privacy.postgres.spec.ts` (15 mandatory cases: first claim, active pepper_version persistence, locator rotation N -> N+1, hash_version stable scheme 'hmac-sha256-v1', retained fingerprint_key_version replay, new fingerprint_key_version persistence, fingerprint_scheme stable scheme, unknown versions fail-closed, >1 collision fail-closed, incomplete keyring fail-closed 503 before claim, concurrent FOR UPDATE serialization, zero raw Idempotency-Key/CPF persistence).

### 3.5 Abandonment Clock, Purge State Machine & Anti-Starvation (B17-PLAN-HR-20, B17-PLAN-HR-30, B17-PR29-HR-12)
- **Pattern Source:** `apps/backend/src/modules/guest-cart-capability/service.ts` e `17-DECISION-ADJUDICATION.md` R17-HR-01.
- **Clock Logic:**
  - Starts on first valid protected CPF persistence.
  - Resets on: 1) valid field change via PATCH, 2) required receipt change, 3) successful POST /validate.
  - NEVER resets on: GET, no-op PATCH, replay, worker, retry, Order recovery, or technical activity.
  - Strict 7-day hard deadline (`cpf_purge_due_at = pii_last_meaningful_activity_at + INTERVAL '7 days'`).
  - Suspension (FIN-03/FIN-04): Unresolved financial freeze, `reconciliation_required`, or CCL recovery in flight.
  - Row marked with `purge_state = 'freeze_suspended'`, `deferred_financial_authority = true`, alerted immediately, daily rechecks.
- **Varredura do Worker Sem Inanição (Anti-Starvation Query - HR-12):**
  - O worker de expurgo NÃO exclui `freeze_suspended` da varredura, garantindo monitoramento ativo e escalonamento de prazos:
    ```sql
    SELECT id FROM protected_checkout_data
    WHERE lifecycle_state != 'purged'
      AND (purge_state = 'due_now'
           OR (purge_state IN ('active', 'freeze_suspended', 'manual_intervention_required') AND cpf_purge_due_at <= NOW()))
    ORDER BY cpf_purge_due_at ASC
    LIMIT $batchSize
    FOR UPDATE SKIP LOCKED;
    ```
  - **Escalonamento de 30 Dias:** Se `NOW() >= cpf_purge_due_at + INTERVAL '30 days'` e o congelamento financeiro persiste, a máquina de estados transiciona para `purge_state = 'manual_intervention_required'`, mantendo `deferred_financial_authority = true` e disparando alerta crítico de incidente operacional (`CHECKOUT_CPF_PURGE_EXTREME_PROLONGED_FREEZE`), sem expurgo cego que destrua a reconciliação financeira.
  - **Liberação de Autoridade Financeira:**
    - `deferred_financial_authority` é redefinido para `false`.
    - Se `NOW() >= cpf_purge_due_at`: transiciona para `purge_state = 'due_now'` e executa expurgo em até 15 minutos pelo worker.
    - Se `NOW() < cpf_purge_due_at`: transiciona para `purge_state = 'active'` mantendo o prazo original inalterado.
  - Cryptographic erasure in PostgreSQL: live ciphertext, nonce, tag, wrapped DEK set to `NULL`; `lifecycle_state = 'purged'`, `purge_state = 'purged'`, `deferred_financial_authority = false`, `purged_at = now()`, `purge_reason` recorded.
  - Tombstone & backup replay protection: once purged, any update attempting to un-purge or partially restore ciphertext is rejected by PostgreSQL constraints.

### 3.6 Gelato Zero-Request Privacy Boundary & Canonical State (B17-PLAN-HR-21, B17-PR29-HR-03, B17-PR29-HR-04)
- **Pattern Source:** `apps/backend/src/modules/gelato-fulfillment/service.ts` e `apps/backend/src/jobs/gelato-dispatch-relay.ts`.
- **Normalização Fechada de País (HR-03):**
  - `normalizeCountryCode(val: unknown): string`: executa `typeof val === 'string' ? val.trim().toUpperCase() : ''`.
  - Cobre de forma determinística variações como `'BR'`, `'br'`, `'Br'`, `'bR'`, `' BR '`, `' br '`.
  - Fixtures brasileiras de teste NUNCA podem ser convertidas para `'US'` para contornar a guarda.
- **Ponto Autoritativo da Guarda de Privacidade (HR-04):**
  - A guarda autoritativa opera na entrada de `dispatchSingleFulfillment()` em `apps/backend/src/jobs/gelato-dispatch-relay.ts`:
    - Avalia `normalizeCountryCode(shippingAddress.country_code) === 'BR'`.
    - Ocorre ANTES de `buildGelatoDispatchPayload()`.
    - Ocorre ANTES do cálculo de hash de idempotência de requisição.
    - Ocorre ANTES de transicionar o fulfillment para `queued` ou `dispatching`.
    - Ocorre ANTES de invocar o cliente HTTP e de qualquer conexão de rede.
  - **Transição Canônica Autoritativa:**
    - `status: "dead_letter"` (status canônico terminal em `GELATO_FULFILLMENT_STATUSES`)
    - `requires_operator_attention: true`
    - `operator_alert_code: "GELATO_DISPATCH_BLOCKED_PRIVACY_BOUNDARY"`
    - `operator_alert_message: "Dispatch bloqueado: fronteira de privacidade BR e incompatibilidade de compliance (R17-BLOCK-01)."`
    - `operator_alerted_at: <ISO timestamp>`
    - `dead_lettered_at: <ISO timestamp>`
    - `last_error_code: "GELATO_DISPATCH_BLOCKED_PRIVACY_BOUNDARY"`
    - `next_retry_at: null`
    - `attempt_count: 0`
    - Emite alerta crítico via `OperationalAlertModule` sem dados pessoais.
    - Retorna `"dead_lettered"`, congelando redispatches automáticos.
  - **Defesa em Profundidade:**
    - `createGelatoDispatchClient().createOrder()` e `service.ts:createOrder()` checam `normalizeCountryCode(country_code) === 'BR'` e abortam imediatamente sem rede caso invocados.
  - Guarantees:
    - Zero automatic redispatch by background relay jobs.
    - Zero transition to `dispatching`.
    - Zero provider network requests.
    - Medusa Order remains paid and intact.
    - Operator alert is recorded cleanly without recipient PII.
    - Medusa Order remains paid and intact.
    - Operator alert is recorded cleanly without recipient PII.
    - `R17-BLOCK-01` remains retained as an exit/closure blocker.

### 3.7 Store HTTP Surface & Middleware Wiring (B17-PR29-HR-10, B17-PR29-HR-11)
- **Pattern Source:** `apps/backend/src/api/middlewares.ts` and `apps/backend/src/api/store-surface/guard.ts`.
- **Manifest & Surface Integration:**
  - 3 operações adicionadas ao `STORE_SURFACE_MANIFEST`:
    1. `GET /store/carts/{id}/checkout-details` (`operationId: "getStoreCartCheckoutDetails"`)
    2. `PATCH /store/carts/{id}/checkout-details` (`operationId: "patchStoreCartCheckoutDetails"`)
    3. `POST /store/carts/{id}/checkout-details/validate` (`operationId: "validateStoreCartCheckoutDetails"`)
  - Chaves em `STORE_SURFACE_M1_ENABLED_OPERATIONS` formatadas estritamente como `"METHOD /path-template"` (HR-11):
    - `"GET /store/carts/{id}/checkout-details"`
    - `"PATCH /store/carts/{id}/checkout-details"`
    - `"POST /store/carts/{id}/checkout-details/validate"`
  - Classificação: `EXTENDED`, Policy: `M1_ENABLED`, Enablement: `enabled`.
  - Store surface exact inventory locked at:
    - Total: 69 operations (51 native + 18 local)
    - Policies: `DENY` 46, `PRESERVE_LEGACY` 6, `M1_ENABLED` 17
  - All 7 surface regression test suites updated and verified:
    1. `manifest.ts`
    2. `manifest.unit.spec.ts`
    3. `scan-installed.ts`
    4. `verify-coverage.ts`
    5. `coverage.unit.spec.ts`
    6. `store-foundation-final.spec.ts`
    7. `store-surface-lockdown.spec.ts` & `guest-cart-contract-matrix.spec.ts`
- **BFF Protected Operations & Middleware Exact-Set (HR-10):**
  - `STORE_CART_BFF_PROTECTED_OPERATIONS` em `bff-protected-operations.ts` é um conjunto exato fechado de 3 tuplas (SEM prefixo ou wildcard):
    - `"GET /store/carts/:id/checkout-details"`
    - `"PATCH /store/carts/:id/checkout-details"`
    - `"POST /store/carts/:id/checkout-details/validate"`
  - Em `apps/backend/src/api/middlewares.ts`, `storeCartBffProtectedRouteEntries()` atualiza o cast de métodos para incluir `"PATCH"`:
    `const method = rawMethod as "GET" | "POST" | "PATCH" | "DELETE";`
  - Rotas exatas vinculam `customerAuthBffServiceGuardMiddleware` e `authenticate("customer", ["bearer"])`.

### 3.8 Authority, Error Precedence Chain & Payment Start (R17-HR-07, B17-PR29-HR-05, B17-PR29-HR-06)
- **12-Stage Pipeline:**
  1. Surface Guard -> 404
  2. BFF Service Auth (`x-customer-auth-bff`) -> 404 / 503
  3. Customer Authentication (`Authorization: Bearer`) -> 401
  4. Canonical Cart Ownership (`CustomerCartAuthority`) -> 404
  5. PostgreSQL Row Lock & Authority Recheck (`FOR UPDATE`) -> 404 / 409
  6. Unresolved Financial Freeze / Reconciliation (FIN-03) -> 409 `CHECKOUT_LOCKED`
  7. If-Match / Resource Version (CAS) -> 412 `CART_VERSION_MISMATCH`
  8. Pending CartReview (`assertNoPendingCartReview`) -> 409 `CART_REVIEW_REQUIRED`
  9. Idempotency-Key Locator & Replay -> 400 / 409 / 503
  10. Request Schema & Complete Domain Validation -> 400 (`VALIDATION_ERROR`) / 422 with deterministic top-level code (`FEDERAL_TAX_ID_REQUIRED` > `INVALID_CPF` > `ZERO_TOTAL_NOT_SUPPORTED` > `CHECKOUT_DETAILS_INVALID`)
  11. Crypto / Integrity Capability -> 500 / 503
  12. Commit & Result (200)
- **Rejection of Billing Address via Zod Schema Omission (HR-05):**
  - `PatchCheckoutDetailsBodySchema` e `ValidateCheckoutDetailsBodySchema` omitem `billing_address` do schema `.strict()` (sem usar `z.never()`).
  - Ausente: passa.
  - Presente (`{}`, `null`, objeto): rejeitado pelo `.strict()` com 400 `VALIDATION_ERROR` e `fieldErrors: { billing_address: 'Invalid value' }` sem ecoar dados do cliente.
- **Migração de Payment-Start Eligibility & Produtor de Elegibilidade (HR-06, HR-21):**
  - `validateBrazilShippingAddress` aceita `{ requireFederalTaxId: false }`, permitindo validar o endereço físico independentemente de CPF.
  - **Produtor Explícito de Projeção:** `CheckoutPrivacyModuleService.getPaymentEligibilityProjection(cartId, sharedContext?)` em `apps/backend/src/modules/checkout-privacy/service.ts`:
    - Retorna `ProtectedCheckoutEligibilityProjection`:
      ```typescript
      type ProtectedCheckoutEligibilityProjection = {
        protected_data_id: string
        cart_id: string
        customer_id: string
        lifecycle_state: "draft" | "ready" | "snapshot_prepared" | "purged"
        data_revision: number
        has_valid_cpf: boolean
      }
      ```
    - **Derivação de `has_valid_cpf` (não-persistido, derivado, saneado):**
      `has_valid_cpf = (row != null && row.lifecycle_state === "ready" && row.encrypted_cpf != null && row.cpf_nonce != null && row.cpf_tag != null && row.cpf_wrapped_dek != null && row.deleted_at == null)`
      O produtor NÃO decifra o CPF em runtime para responder elegibilidade. Como o envelope cifrado só é persistido após validação server-side de 11 dígitos e checksum módulo 11, um envelope completo no estado 'ready' garante CPF válido.
    - **Fronteira Sanitária Estrita (Zero PII):** A projeção contém zero raw CPF, zero ciphertext (`encrypted_cpf`), zero nonce, zero tag e zero wrapped DEK. Nenhum material criptográfico ou sensível cruza para o módulo `payment-attempt`.
  - **Autoridade Transacional & Consumo em Payment Start:**
    - `evaluatePaymentStartEligibility()` adquire a projeção sob o lock canônico de autoridade do carrinho (`lockCartOrderAuthority(transaction, cartId)` via `pg_advisory_xact_lock(hashtextextended(?, 1515))`).
    - Valida customer ownership (`projection.customer_id === actor.customerId`).
    - Valida estado M1: `projection.lifecycle_state === 'ready'` e `projection.has_valid_cpf === true`.
    - Valida endereço físico com `validateBrazilShippingAddress(cart.shipping_address, { requireFederalTaxId: false })`.
    - Zero consulta a `shipping_address.metadata.federal_tax_id`; zero raw CPF em metadata, PaymentAttempt, Stripe, logs ou responses.
- **Safe Cart Snapshot:** Attached ONLY after Customer auth & ownership verification for 412, 409 review, and 422 domain errors. Strictly absent for 400, 401, 404, 409 locked, 500, 503.

### 3.9 API Docs Registry Contract, One-Way-Door Checkpoint & Fail-Fast Runner (B17-PR29-HR-13, B17-PR29-HR-14)
- **Pattern Source:** `apps/backend/src/api-docs/`.
- **Operations File:** `apps/backend/src/api-docs/operations/store/checkout-details.ts`.
- **Security Schemes:** `STORE_AUTH_ACCESS_BEARER` (`bffServiceCredential`, `publishableApiKey`, `customerBearer`).
- **Headers:** `Cache-Control: no-store`, `ETag`, `x-correlation-id`.
- **Safe Synthetic Examples:** Examples use synthetic mock data without real CPF, real names, tokens, or live credentials.
- **Execution Order (One-Way-Door Gate):**
  1. Author TypeScript registry & Zod schemas in `src/api-docs/store/`
  2. Run read-only unit & coverage tests (`npm run test:unit -- src/api-docs/__tests__/`)
  3. **Human Contract Checkpoint `P17-08-CONTRACT-HR-01`** (Human reviews TypeScript contracts BEFORE writer runs)
  4. Human approval opens writer execution
  5. Writer runs: `npm run openapi:generate -- --surface store`
  6. Lint check: `npm run openapi:lint`
  7. Store scope verify: `npm run openapi:verify:store` (permits untracked/dirty during dev)
  8. **Clean Candidate Gate `P17-11-CLEAN-CANDIDATE-HR-01` (HR-13):** Precondição obrigatória para openapi:check. O repositório deve estar limpo e commitado sob autorização humana prévia. É estritamente proibido rodar gerador imediatamente antes ou dentro desse gate.
  9. **Canonical Fail-Fast Runner (HR-14):** `apps/backend/scripts/validate-phase17-final.mjs` coordena a execução de todos os 17 itens do ledger, garantindo que nenhum item seja marcado como aprovado sem evidência real e falhando na primeira divergência.

#### 3.10 Recoverable Order-Birth, Pre-CAS Durability & Option B-R (B17-PLAN-HR-24, B17-PR29-HR-07, B17-PR29-HR-08)
- **Pattern Source:** `apps/backend/src/workflows/order/webhook-order-entrypoint.ts` and `apps/backend/src/modules/checkout-completion/service.ts`.
- **Durabilidade Pré-CAS e Fronteira Transacional Compartilhada (HR-08):**
  - `withCartOrderAuthorityLock` abre transação PostgreSQL fornecendo `PaymentAttemptSqlTransaction`.
  - `CheckoutPrivacySqlTransactionAdapter` encapsula essa transação, assegurando que operações do CheckoutPrivacy compartilhem a mesma conexão física e limite de commit/rollback, proibindo transações aninhadas independentes.
- **Opção B-R: Recuperação de Snapshot Ausente com Order Durável (HR-07):**
  - Se `runCompleteCart()` comitar a Order no Medusa core, mas a transação externa abortar antes da vinculação do snapshot:
    - Order existe e é durável (Orders = 1).
    - Snapshot sofreu rollback e está ausente no banco (snapshots = 0).
  - No retry subsequente, a rotina de autoridade descobre a Order durável, detecta a ausência de snapshot, consulta o `protected_checkout_data` ativo, recria o snapshot com nova DEK e nonce gerados por CSPRNG e AAD canônica do snapshot, vincula diretamente em estado `'bound'`, expurga o envelope do carrinho para NULL e marca o CCL como completed, **sem chamar runCompleteCart novamente**.
- **Order-Birth Pipeline Execution Flow:**
  1. Acquire `withCartOrderAuthorityLock` on cart/order authority (transaction-scoped advisory lock).
  2. Adapt transaction with `CheckoutPrivacySqlTransactionAdapter`.
  3. Execute recovery candidate scan and canonical authority validation.
  4. Invoke `prepareProtectedOrderSnapshot()` inside the transaction.
  5. Irreversible execution gate CAS: `markOrderBirthExecutionStartedInTransaction`.
  6. CAS won: execute exactly-one `runCompleteCart(container, cart.id, ccl.id)` creating physical Medusa Order.
  7. Common finalizer `ensureProtectedSnapshotBoundOrReconciled()`:
     - Suporta os 5 ramos normais e o ramo de recuperação Option B-R para Orders recuperadas sem snapshot.
     - Idempotently binds snapshot to Order: `order_id = orderId`, `bound_at = NOW()`, `lifecycle_state = 'bound'`.
     - Cryptographically purges cart CPF envelope columns to `NULL` (`lifecycle_state = 'purged'`, `purge_state = 'purged'`, `purge_reason = 'order_created'`).
     - Inserts audit row in `sanitized_purge_ledger`.
- **Failpoint Test Matrix (FP1 to FP6):**
  1. **FP1 (Failure during snapshot prepare before CAS):** Failure thrown during KMS call or insert. Transaction rolls back; committed DB state: 0 snapshots, 0 Orders, cart envelope intact; retry branch: safe recreation; completeCart may run; reconciliation: none.
  2. **FP2 (Crash after snapshot prepare success before CAS):** Process crashes after snapshot row inserted but before CAS. Transaction rolls back; committed DB state: 0 snapshots, 0 Orders; retry branch: safe recreation with fresh CSPRNG DEK/nonce; completeCart may run; reconciliation: none.
  3. **FP3 (CAS won, failure before `runCompleteCart`):** CAS won (`execution_started_at` is set), but crash occurs before `runCompleteCart`. Committed DB state: 1 prepared snapshot, 0 Orders; retry branch: rescan finds 0 Orders with `execution_started_at` set -> marks `reconciliation_required` (`ORDER_BIRTH_EXECUTION_AMBIGUOUS`); completeCart calls = 0; Order count = 0; reconciliation: operator attention required.
  4. **FP4 (Order physically created, outer transaction rolled back / crash - Option B-R):** Physical Order created by runCompleteCart, but outer transaction rolled back. Committed DB state: 1 Order, 0 snapshots; retry branch: rescan finds recovered Order -> detects snapshot missing -> Option B-R recria snapshot com fresh DEK/nonce gerados por CSPRNG, vincula ao Order existente (`bound`), expurga envelope do carrinho para NULL, marca CCL completed; completeCart calls = 0 no retry (1 total histórico); Order count = 1.
  5. **FP5 (Snapshot bound, failure before cart purge completed):** Snapshot bound to `order_id`, but crash before cart purge commit. Committed DB state: 1 Order, 1 bound snapshot, cart envelope unpurged; retry branch: detects snapshot already bound -> completes cart envelope purge to `NULL`, marks completed; completeCart calls = 0; Order count = 1.
  6. **FP6 (Replay after each failpoint):** Idempotent webhook delivery after completion or failure. Verified: zero duplicate Orders, zero duplicate snapshots, zero duplicate purges.

### 3.11 Negative PII Canary Verification & E2E Synthesis Role (CHK-08, B17-PLAN-HR-23, B17-PR29-HR-18, B17-PR29-HR-19)
- **Pattern Source:** `apps/backend/integration-tests/helpers/guest-cart-leakage.ts` e `apps/backend/integration-tests/modules/checkout-privacy-canary.spec.ts`.
- **E2E Role vs Formal Requirements Proof (HR-18):**
  - A suíte E2E (`phase17-e2e.spec.ts`) demonstra a síntese de integração de ponta a ponta entre os domínios da Phase 17.
  - A prova formal e estrita de cada requisito CHK-01..CHK-10 é atestada pelas suítes e evidências dedicadas dos itens 01 a 10 do ledger de validação canonical.
- **Fixed Artifact Path (HR-19):**
  - A suíte de testes de erros reside estritamente em `apps/backend/src/api/store-surface/__tests__/errors.unit.spec.ts` (nunca no caminho órfão `api-surface`).
- **Synthetic Checksum-Valid CPF Canary Generator (B17-PLAN-HR-23):**
  - Hardcoded invalid dummy CPF (`123.456.789-01`) is strictly forbidden as canary fixture because it fails real checksum validators.
  - Implements `generateSyntheticValidCpf(seed: string)` helper:
    1. Derives 9 base digits from deterministic test seed (e.g. `"123456789"`).
    2. Verifies base is not a homogeneous/same-digit sequence (`!/^(\d)\1{8}$/.test(base)`).
    3. Computes first check digit via Modulo-11 algorithm: `sum = sum(d_i * (10 - i)); remainder = (sum * 10) % 11; dv1 = remainder === 10 ? 0 : remainder`.
    4. Computes second check digit: `sum = sum(d_i * (11 - i)) + dv1 * 2; remainder = (sum * 10) % 11; dv2 = remainder === 10 ? 0 : remainder`.
    5. Produces canonical 11-digit string: `12345678909` (formatted: `123.456.789-09`).
    6. Formally asserts validity against domain validator: `expect(isValidCpf(canary)).toBe(true)`.
    7. Generates 8 multi-variant representations:
       - `formatted`: `"123.456.789-09"`
       - `digits-only`: `"12345678909"`
       - `whitespace`: `"123 456 789 09"`
       - `punctuation`: `"123.456.789/09"`
       - `alternate_separators`: `"123-456-789.09"`
       - `url_encoded`: `"123%2E456%2E789-09"`
       - `json_escaped`: `"123.456.789-09"`
       - `normalized`: `"12345678909"`
    8. Zero real CPF data, zero external web scraping, zero real person data.
- **17 Sinks Verified Negative:**
  1. Cart metadata
  2. Order metadata
  3. Public Store responses
  4. PaymentAttempt / Idempotency records
  5. Stripe request projections
  6. Gelato fulfillment builder / request
  7. Analytics / PostHog outbox
  8. Application logs (Winston / Pino)
  9. Sentry events
  10. Stripe WebhookEventLog
  11. Gelato WebhookEventLog
  12. CheckoutCompletionLog
  13. Workflow engine Redis persistence
  14. Domain events / subscribers
  15. Queues / background jobs
  16. Validation error responses
  17. Transactional email / Resend templates
- **Verification Semantics:**
  - Raw / normalized / formatted / encoded CPF canaries: STRICTLY ABSENT (`count === 0`) from all 17 prohibited sinks.
  - Designated encrypted envelope columns (`protected_checkout_data.encrypted_cpf`, `protected_order_snapshot.encrypted_cpf`): present, non-plaintext, authenticated, randomized ciphertext (the plaintext canary string is strictly absent from the raw ciphertext bytes).
  - Authorized test decrypt: recovers the expected synthetic CPF.
  - Public representation: returns masked CPF only (`***.***.789-**` / `***.456.789-**`).
  - Current-cart envelope after purge: all 4 envelope columns are `NULL`.
  - Order snapshot envelope: encrypted and recoverable only through authorized test crypto boundary.
