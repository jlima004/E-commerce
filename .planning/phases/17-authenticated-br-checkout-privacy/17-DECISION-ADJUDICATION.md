---
phase: 17-authenticated-br-checkout-privacy
gate: pre-plan-human-decisions
status: human-approved-pass
prepared_at: 2026-09-10
baseline: 9e3652da332899175434d68a2515eadc9bc71649
checkpoint: R17-HR-ADJ-01
checkpoint_status: human-approved-pass
coverage:
  human_decisions: 10/10
  external_blockers: 1/1
  total: 11/11
---

# Phase 17 — Pre-PLAN Decision Adjudication

## 1. Gate identity

```text
Phase:
17 — Authenticated BR Checkout & Privacy

Gate:
PRE-PLAN HUMAN DECISIONS

Status:
HUMAN APPROVED — PASS

Checkpoint:
R17-HR-ADJ-01 — HUMAN APPROVED — PASS
```

This document is the final human-approved decision adjudication. Approval was
recorded on 2026-09-10 with the mandatory Phase-boundary correction for
`R17-HR-09` and `R17-BLOCK-01`. It does not complete `CHK-01..CHK-10`, does not
authorize PLAN or implementation, and does not remove legal or external
dependencies explicitly retained below.

## 2. Baseline and entry gate

Entry was verified before this file was created:

```text
Branch:
gsd/phase-17-authenticated-br-checkout-privacy

HEAD:
9e3652da332899175434d68a2515eadc9bc71649

Expected baseline:
9e3652da332899175434d68a2515eadc9bc71649

Worktree at entry:
CLEAN

Fast-forward:
NOT REQUIRED
```

No reset, rebase, force checkout, stash mutation, push, PR, merge, deploy,
remote-infrastructure change or provider operation was performed.

## 3. Authority hierarchy

The following precedence governed this adjudication:

1. Current accepted governance in `.planning/STATE.md`, then the current
   Phase 17 position in `.planning/ROADMAP.md` and the exact requirements in
   `.planning/REQUIREMENTS.md`.
2. Binding `D17-01..D17-16` in `17-CONTEXT.md`.
3. Human-accepted findings and constraints in `17-RESEARCH.md`, its
   adversarial review and its human-review artifact.
4. Accepted `FIN-01..FIN-04` in `16-PR28-REMEDIATION.md` and the historical
   Phase 16 closure in `16-CLOSURE.md`.
5. Project/PRD/SRS/data/traceability documents only where needed to resolve a
   product or contract detail. Prospective text remains prospective, and stale
   historical governance never overrides current accepted state.
6. Current application code only as evidence of existing behavior and naming;
   it is not authority to weaken a later accepted privacy rule.

`R17-CONFLICT-01` remains a confirmed conflict carried by `R17-HR-09` and
`R17-BLOCK-01`; it is not silently counted as a twelfth adjudication item.

### 3.1 Narrow current-source refresh

The accepted Phase 17 Source Register was not replaced. Two materially
mutable facts were refreshed from primary official sources on 2026-09-10:

- Gelato's current Create Order v4 reference still says that
  `federalTaxId` is mandatory for Brazil and identifies CPF/CNPJ as the
  Brazilian recipient values:
  <https://dashboard.gelato.com/docs/orders/v4/create/>.
- AWS KMS officially supports envelope encryption, `GenerateDataKey`,
  `ReEncrypt`, encryption context and retained historical key material. The
  relevant current references are:
  <https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html>,
  <https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html>,
  <https://docs.aws.amazon.com/kms/latest/APIReference/API_ReEncrypt.html>,
  <https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html>
  and
  <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>.

This was documentation research only. No Gelato or AWS object, key, order,
credential or infrastructure was created or accessed.

## 4. Exact coverage ledger

| ID | Covered | Final adjudication |
|---|---|---|
| R17-HR-01 | YES | HUMAN APPROVED — binding product/state-machine decision |
| R17-HR-02 | YES | HUMAN APPROVED — binding data-authority decision |
| R17-HR-03 | YES | HUMAN APPROVED — binding security architecture |
| R17-HR-04 | YES | HUMAN APPROVED — provisional policy; LEGAL REVIEW REQUIRED retained |
| R17-HR-05 | YES | HUMAN APPROVED — provisional policy; LEGAL REVIEW REQUIRED retained |
| R17-HR-06 | YES | HUMAN APPROVED — binding product decision |
| R17-HR-07 | YES | HUMAN APPROVED — binding public-contract decision |
| R17-HR-08 | YES | HUMAN APPROVED — binding resume/surface decision |
| R17-HR-09 | YES | HUMAN APPROVED — BINDING PRODUCT DIRECTION; governance correction applied |
| R17-HR-10 | YES | HUMAN APPROVED — binding cryptographic/idempotency lifecycle |
| R17-BLOCK-01 | YES | ADJUDICATED — EXTERNAL BLOCKER RETAINED; PHASE 17 EXIT/CLOSURE BLOCKER |

```text
R17-HR exact-set:
01..10 = 10/10

R17-BLOCK exact-set:
01 = 1/1

Total:
11/11
```

## 5. Individual adjudications

## R17-HR-01 — Abandonment clock and prolonged freeze

**Question**

Which authoritative event starts or resets the seven-day CPF-abandonment
clock, which states suspend physical purge, and exactly when does purge occur
after suspension ends?

**Binding evidence**

- CHK-07 and D17-10 require abandoned-cart CPF purge after seven days.
- FIN-03 forbids local timeout, expiry, status or convenience from inventing
  financial thaw.
- FIN-04 requires late canonical success to yield exactly one recoverable
  Order or durable reconciliation.
- `Cart.updated_at` changes for technical activity and is not human meaningful
  activity authority.
- Soft delete does not purge ciphertext.

**Options considered**

1. Start/reset from `Cart.updated_at`.
2. Start at the first protected draft and reset on any read or technical
   activity.
3. Use a dedicated server-side clock started by first valid CPF persistence
   and reset only by a closed set of meaningful authenticated actions.
4. Apply a fixed maximum suspension and purge even while financial finality is
   unresolved.

**Rejected options**

- Options 1 and 2 allow GET, replay, webhook, worker and retry traffic to retain
  PII indefinitely.
- Option 4 violates FIN-03/FIN-04 by deleting data needed for a financially
  live or canonically successful flow, or by manufacturing a local thaw.
- A grace period after an already elapsed seven-day clock adds retention
  without a new purpose.

**Adjudicated decision**

Create a dedicated `pii_last_meaningful_activity_at` and derived
`cpf_purge_due_at` owned by the protected checkout authority.

The clock starts when a valid CPF is first committed to protected current
checkout data. It resets only when a new, human-originated, authenticated,
BFF-authorized transaction:

1. successfully changes at least one Phase 17 protected checkout field;
2. successfully records or changes a required receipt for the same cart; or
3. successfully completes final checkout validation, even if no value changed.

It does not reset on GET/resume, failed or no-op PATCH, idempotency replay,
automatic retry, worker/job, webhook, Order recovery, provider callback,
reencryption/rewrap, purge claim, lock/CAS failure, telemetry or internal
normalization.

There is no post-deadline grace period. At `cpf_purge_due_at`, physical purge is
due. Purge is suspended only while at least one of these authorities is true:

- unresolved financial freeze under FIN-03;
- `reconciliation_required` or equivalent unresolved financial authority;
- canonical payment success has been accepted but CCL recovery, exactly-one
  Order resolution or protected snapshot binding is incomplete.

The original due time is never advanced by suspension. A due-and-suspended row
is marked `deferred_financial_authority`, alerted immediately, rechecked at
least daily, and escalated as a security/operations incident after 30 days;
this escalation never purges or thaws by itself.

When Order birth/recovery and snapshot binding succeed, current-cart CPF is
physically purged in that same serialized completion transaction, even if the
seven-day deadline has not arrived. Otherwise, when a suspension clears:

- if the original due time has passed, the clearing transaction must purge in
  the same transaction or create a durable `due_now` claim processed within
  15 minutes;
- if it has not passed, the original `cpf_purge_due_at` remains unchanged.

Every purge path locks and rechecks ownership, due time, snapshot/Order state
and FIN predicates in the same PostgreSQL transaction. Ambiguity fails closed
and alerts. Purge removes plaintext if any, ciphertext, nonce, tag and wrapped
DEK from live authorities; a sanitized ledger remains.

**Why**

This creates a deterministic clock tied to human checkout activity, avoids
technical-retention drift, and preserves late-success recovery without
inventing financial finality.

**Security/privacy impact**

Retention is bounded to meaningful activity. Physical/cryptographic removal is
distinguished from soft delete. Prolonged financial exceptions are observable
instead of silent.

**Operational impact**

A transactional purge claimant, due-now path, daily suspended-row check,
15-minute execution SLO and 30-day incident escalation are required. Provider
or local operational status cannot clear suspension.

**Phase-boundary impact**

The state machine belongs to Phase 17. Payment confirmation UX remains Phase
20; provider shipping remains Phase 18. Phase 17 only reads already accepted
financial authorities.

**Residual risk**

A provider-authority outage may retain due CPF longer than seven days. This is
an explicit, alerted FIN-03 exception, not a reset or new retention purpose.
Backup erasure remains governed by R17-HR-05.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

Legal review should confirm the exception/incident wording before go-live, but
the technical state machine and PLAN are not blocked by that review.

**PLAN consequence**

PLAN must specify the state machine, locks, due-now path, physical purge,
backup-deletion replay, alerts and time-controlled PostgreSQL tests. It must not
use `Cart.updated_at` as the clock.

**Binding decision text**

> The seven-day CPF clock starts on first valid protected CPF persistence and
> resets only on successful human-originated Phase 17 mutation, required-receipt
> change or successful final validation. Reads, replays and technical activity
> never reset it. There is no grace period. Due purge is suspended only by
> unresolved FIN-03/FIN-04 authority, retains its original due time and executes
> immediately when that authority clears; no local timeout creates thaw.

## R17-HR-02 — Protected authority and minimum Order snapshot

**Question**

Which domain owns protected current checkout data, receipts, the protected
Order snapshot and purge evidence; what are their cardinalities and minimum
fields; and how do they bind to PaymentAttempt, CCL and exactly one Order?

**Binding evidence**

- CPF must leave generic `shipping_address.metadata`.
- Medusa Module Links do not replace same-domain PostgreSQL constraints.
- Medusa shipping address cannot reconstruct the required structured domain
  fields `number`, `neighborhood` and `complement` reliably.
- CCL remains the sole project Order-birth/recovery authority.
- Preparing a snapshot after Order creation leaves a crash window; allowing the
  snapshot to create an Order creates a competing authority.

**Options considered**

1. Keep encrypted CPF in generic address metadata.
2. Split unrelated services/tables across modules and coordinate by loose
   links.
3. One cohesive Checkout Privacy domain with explicit current-data, receipt,
   snapshot and purge-ledger responsibilities.
4. Copy full address, email and receipt payloads into every snapshot.

**Rejected options**

- Generic metadata has uncontrolled propagation and lifecycle.
- Cross-module loose coordination cannot enforce the required cardinalities.
- Duplicating email/address/receipt payloads expands the breach and retention
  surface when authoritative records already exist.

**Adjudicated decision**

Adopt one `Checkout Privacy` Medusa module/domain with four owned
responsibilities and no raw sibling-module DB access:

1. **Protected current checkout data.** Exactly zero or one active record per
   canonical cart; one Customer may have multiple historical cart records but
   only the canonical cart is actionable. It owns a stable opaque authority ID,
   Customer/cart scalar bindings, resource/data revision, lifecycle state,
   structured recipient fields (`first_name`, `last_name`, `phone`, `postal_code`,
   `street`, `number`, `neighborhood`, `city`, `province`, fixed `BR`, optional
   `complement`), the CPF encryption envelope and the R17-HR-01 clocks. Account
   email is server-derived and is not duplicated. The Medusa shipping address
   is an allowlisted projection, never the reconstruction authority.
2. **Legal receipts.** Zero or more immutable append-only records per
   Customer/cart, unique by purpose + document version + legal-act semantics.
   Each contains receipt ID, purpose, legal-act type, document version and
   digest, accepted/acknowledged timestamp, Customer/cart IDs, sanitized
   correlation ID, supersession/revocation reference when applicable and
   policy version. No CPF, address, email, IP or user agent is stored in a
   receipt.
3. **Protected Order snapshot.** Exactly one snapshot per CCL and exactly one
   per PaymentAttempt, prepared only after CCL claim/reuse and before the
   irreversible Order-creation seam. `order_id` begins null and can be bound
   once to the exactly-one Order found or created by CCL. Rebinding to another
   Order, multiple snapshots or missing required snapshot causes durable
   reconciliation; it never reruns Order creation.
4. **Sanitized purge ledger.** One idempotent event stream keyed by protected
   authority/snapshot and action. It may retain reason enum, state, due/claim/
   completion timestamps, attempts and safe error class, but no CPF, ciphertext,
   wrapped DEK, address, email, provider payload or raw exception.

The snapshot identity is a random stable `snapshot_id` generated in the CCL
claim transaction. The current Cart envelope is not copied byte-for-byte: the
CPF is decrypted only in an authorized local boundary and reencrypted with a
new per-snapshot DEK, nonce and snapshot AAD. The minimum exact snapshot is:

- stable `snapshot_id`, schema/envelope/AAD versions and lifecycle state;
- encrypted normalized CPF envelope only;
- source protected-current authority ID and immutable data revision;
- scalar `customer_id`, `cart_id`, `payment_attempt_id`, `checkout_completion_log_id`;
- nullable-on-prepare, unique-on-bind `order_id`;
- exact receipt IDs plus purpose/document-version/document-digest bindings;
- retention-policy version and prepared/bound/purged timestamps.

It does not duplicate account email, recipient name, phone or shipping address;
the canonical Order/address authorities hold those values. It does not contain
provider IDs or provider compatibility claims.

**Why**

The module owns every protected lifecycle transition while preserving module
isolation. The minimum snapshot survives crash/recovery and proves which CPF
and receipts were bound without becoming a second Order authority.

**Security/privacy impact**

CPF is removed from generic propagation. Snapshot minimization excludes
duplicate address/email. Unique constraints and AAD prevent cross-record
substitution.

**Operational impact**

PLAN needs explicit same-module constraints, state transitions, Query/Link
projections, CCL preparation/bind hooks and reconciliation for every
cardinality conflict.

**Phase-boundary impact**

Phase 17 owns protected preparation/binding. CCL remains FIN-04 authority;
Phase 21 owns public Order summaries and Phase 18 owns provider shipping.

**Residual risk**

The Order's ordinary shipping-address PII remains governed by its existing
authority and retention; this decision minimizes only the protected snapshot
and does not declare ordinary address data anonymous.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

The fields/cardinalities are technically decidable. Numeric retention for
Order snapshot and receipts still requires the R17-HR-05 legal schedule.

**PLAN consequence**

PLAN may select physical model names but must preserve these four
responsibilities, cardinalities, exact snapshot minimum and CCL-only Order
authority. DB model documentation must be reconciled before implementation.

**Binding decision text**

> A single Checkout Privacy domain owns one active structured protected record
> per cart, append-only purpose-specific receipts, one minimal protected
> snapshot per CCL/PaymentAttempt and a sanitized purge ledger. The snapshot is
> prepared after CCL claim and before Order creation, binds once to CCL's
> exactly-one Order, contains encrypted CPF plus authority/receipt bindings only,
> and never creates or retries an Order.

## R17-HR-03 — External key authority and lifecycle

**Question**

Which key provider and envelope model meet the threat model, availability,
rotation, recovery, destruction and Cart-to-Order handoff requirements?

**Binding evidence**

- Cryptographic floor: AES-256-GCM, 96-bit nonce, 128-bit tag, canonical
  versioned AAD, fail closed, no plaintext fallback.
- Database and backups must not contain plaintext keys or CPF.
- Remote AEAD would send CPF to the remote cryptographic processor.
- AWS KMS currently documents customer-managed symmetric KEKs,
  `GenerateDataKey`, `ReEncrypt`, non-secret encryption context, key policies
  and retained prior key material.
- Current public AWS KMS pricing lists USD 1 per customer-managed key-month,
  20,000 free requests/month and USD 0.03 per 10,000 ordinary requests beyond
  that tier; pricing is operational planning input, not a fixed project fact.

**Options considered**

1. Exportable application secret as one shared DEK.
2. Supabase Vault or new pgsodium/TCE as a complete KMS.
3. Remote KMS encryption of CPF plaintext.
4. AWS KMS customer-managed KEK plus shared versioned DEK.
5. AWS KMS customer-managed KEK plus per-record DEK and local AEAD.

**Rejected options**

- One exportable shared key has an excessive blast radius and weak deletion
  isolation.
- Accepted research does not prove Supabase Vault as the required full KMS;
  new pgsodium/TCE adoption is not recommended by the consulted authority.
- Remote AEAD unnecessarily transmits CPF to AWS KMS.
- A shared versioned DEK makes compromise and record-level cryptographic erasure
  broader than necessary for this low-volume MVP.

**Adjudicated decision**

Select **AWS KMS customer-managed symmetric keys as external KEK authority,
with one DEK per protected record version and AES-256-GCM performed locally in
the Node.js process**.

Threat model and boundaries:

- protected: database-only theft, backup theft, accidental SQL/operator read,
  generic metadata propagation and a KMS-unprivileged DBA;
- reduced but not eliminated: compromised application host/process while it has
  authorized decrypt capability;
- not claimed as protected: an attacker controlling both the running
  application and its live KMS authorization. That event requires incident
  response and key/data compromise analysis.

Key and envelope contract:

- separate customer-managed KEK per environment; production never shares test
  or preview keys;
- `GenerateDataKey(AES_256)` returns one plaintext DEK and wrapped DEK per new
  current-record or snapshot envelope;
- CPF never enters a KMS request. KMS encryption context contains only
  non-secret constants: application, environment, authority kind, envelope
  version and purpose. It contains no CPF, Customer/cart/Order/provider ID,
  email, address or correlation ID because encryption context is logged;
- local AES-256-GCM uses a fresh CSPRNG 12-byte nonce and full 16-byte tag per
  encryption; plaintext is not released before authentication succeeds;
- the persisted envelope includes algorithm, envelope version, logical
  `key_version`, AAD version, canonical base64url nonce/ciphertext/tag, wrapped
  DEK and KEK reference/version;
- local AAD binds application domain, environment, authority kind, stable
  opaque authority ID, field `cpf`, envelope/AAD version and logical key
  version. It contains no CPF and no mutable cart version;
- current Cart and Order snapshot have distinct authority IDs, DEKs, nonces and
  AAD. Handoff always reencrypts; it never reuses the current envelope.

Key use and access:

- active KEK version may `GenerateDataKey`, decrypt and reencrypt under a
  least-privilege runtime principal constrained by environment and encryption
  context;
- prior application-level KEK versions are decrypt/`ReEncryptFrom` only; new
  wrapping is denied;
- destination active key allows `ReEncryptTo`;
- plaintext DEKs are request/job scoped, are never persisted or placed in
  Redis/queue/log/telemetry, have no cross-request cache, and their buffers are
  best-effort zeroed immediately after use. The maximum application-held
  lifetime is the current transaction/job, capped at 60 seconds;
- encryption, semantic fingerprint, Idempotency-Key lookup, Customer auth,
  analytics and tracking use separate keys and policies.

Availability and failures:

- KMS timeout/denial/unavailability before an irreversible effect returns
  sanitized `503 PRIVACY_SERVICE_UNAVAILABLE`, retryable only when no uncertain
  side effect exists;
- unknown version, malformed envelope, AAD/tag failure or corruption returns
  sanitized `500 PRIVACY_DATA_UNAVAILABLE`, never an oracle and never
  retryable;
- no path stores or uses plaintext as fallback;
- after canonical payment success, any KMS/snapshot failure enters durable
  reconciliation under FIN-04; it neither loses the success nor creates a
  second Order.

Rotation, rewrap and recovery:

- create a new logical KEK version at least every 365 days and make it active;
  emergency rotation occurs immediately on suspected compromise;
- retain old versions decrypt/rewrap-only. KMS-internal automatic rotation may
  additionally be enabled, but it does not replace application-level
  `key_version` or rewrap data keys;
- routine rotation rewraps only the wrapped DEK using `ReEncrypt`, under CAS,
  leaving the locally encrypted CPF ciphertext unchanged. CPF is not sent to
  KMS. A data-DEK compromise forces full decrypt/re-encrypt with new DEK,
  nonce and envelope;
- backups must contain ciphertext/wrapped DEKs and the non-secret key registry,
  never plaintext keys. Restore must have the corresponding KMS keys and first
  replay purge tombstones before protected data becomes accessible;
- a KEK version may enter destruction only when a transactional inventory proves
  zero live envelopes/claims, all backups and restore points that reference it
  have expired, all legal/replay holds are exhausted, and two authorized people
  approve. Use a 30-day pending-deletion window with alerting and a restore
  drill before final destruction.

Heroku/Supabase compatibility:

- AEAD occurs in the Heroku Node process through the AWS SDK/API; Supabase
  PostgreSQL stores only ciphertext and wrapped DEK;
- no AWS workload or database migration is required merely to call KMS;
- deployment credentials must come from the authorized secret authority, be
  least privilege and never enter the repo/database. Their provisioning is a
  separate, currently unauthorized operational gate.

**Why**

Per-record DEKs minimize blast radius and make rewrap/record lifecycle
explicit. Local AEAD avoids transmitting CPF to the key provider. AWS KMS has
the required envelope, policy, audit and rotation primitives at an MVP-viable
operational cost.

**Security/privacy impact**

Database/backup compromise does not expose CPF without KMS authority.
Record-to-record substitution fails AAD/tag validation. Key separation prevents
one digest/auth key from becoming a general decrypt key.

**Operational impact**

KMS becomes a required dependency with request cost, latency, quota,
CloudTrail/audit and recovery obligations. No DEK cache favors security over
latency at current MVP scale.

**Phase-boundary impact**

This selects architecture only. It does not provision KMS, credentials or
remote infrastructure. Production provisioning remains separately gated.

**Residual risk**

A fully compromised authorized application process can observe CPF while it is
legitimately processed. Availability depends on external KMS. Key deletion can
make backups permanently unreadable, hence the destruction gates.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

AWS account/security ownership and any cross-border processor assessment must
be approved before production. They do not block a provider-interface PLAN or
local fake-based implementation.

**PLAN consequence**

PLAN must define a provider-independent crypto interface, AWS KMS adapter,
local deterministic envelope validation, fake KMS tests, failure injection,
rotation/rewrap jobs, inventory/destruction gates and no-provider-call default
for local tests.

**Binding decision text**

> Use an AWS KMS customer-managed KEK per environment, per-record AES-256 DEKs
> and local AES-256-GCM. CPF never enters KMS; no plaintext fallback or
> cross-request DEK cache exists. Cart-to-Order handoff reencrypts under a new
> identity/DEK/nonce/AAD. Rotate logical KEKs at least annually, retain old
> versions decrypt/rewrap-only, and destroy only after zero dependencies across
> live data, claims, backups and holds.

## R17-HR-04 — Legal purpose/base and receipt semantics

**Question**

What purpose, intended legal basis, recipient/processor set and receipt
semantics apply to each Phase 17 datum, and what does revocation mean?

**Binding evidence**

- LGPD requires purpose, adequacy, necessity, transparency, security and a
  lawful basis by processing activity.
- Consent is only one possible basis and cannot be bundled or universal.
- Project authority requires three distinct acts: Terms of Purchase, Exchange
  Policy and awareness of the Privacy Policy.
- The accepted research is not legal advice and leaves qualified legal review
  open.

**Options considered**

1. One “accept all” consent.
2. Treat every required checkout act as consent.
3. Distinguish contractual acceptance, policy acknowledgement, privacy notice
   acknowledgement and any future optional consent.
4. Defer all semantics and let implementation invent them.

**Rejected options**

- Options 1 and 2 misstate consent and make revocation incoherent.
- Option 4 leaves schema, validation and UI contract undefined.

**Adjudicated decision**

Adopt the following as a **PROVISIONAL PRODUCT/TECHNICAL DECISION — LEGAL
REVIEW REQUIRED**:

| Data/treatment | Purpose | Intended legal basis | Required recipients/processors | Receipt/document semantics | Revocation/effect |
|---|---|---|---|---|---|
| Customer ID and account email | Identify the authenticated buyer and communicate transaction state | Contract/pre-contract; legal validation required | Backend/database and transaction communication processors only | No consent receipt; server-derived identity | Account/right requests follow applicable obligations; identity cannot be removed while an active transaction/legal hold requires it |
| Structured recipient name/address/phone | Validate and perform delivery for the purchase | Contract/pre-contract; legal validation required | Backend/database; later only a compatible authorized fulfillment/carrier processor | No consent receipt; checkout-purpose record | Correction replaces current draft; Order history follows retention/rights policy |
| CPF | Validate the individual BR checkout and preserve the minimum protected transaction snapshot | Contract and/or legal/regulatory obligation are intended candidates; qualified counsel must select/confirm the basis and necessity | Checkout Privacy runtime, database ciphertext and KMS for keys only; CPF is forbidden to Stripe, Gelato, analytics, logs, Sentry and email | No universal consent; protected-purpose record linked to accepted required documents | No consent-style withdrawal. Correction/deletion applies when purpose/obligation permits; D17-12 always applies |
| Terms of Purchase | Evidence that the customer accepted the transaction terms/version | Contract and regular exercise of rights are intended candidates; legal validation required | Backend/database; authorized legal/support access when necessary | `contract_acceptance`, required for final validation, append-only by version | Cannot be “revoked” to erase a concluded transaction; cancellation/withdrawal rights are separate domain events |
| Exchange Policy | Evidence that the customer saw/acknowledged the applicable exchange rules without waiving statutory rights | Contract, legal obligation and/or regular exercise of rights; legal validation required | Backend/database; authorized legal/support access when necessary | `policy_acknowledgement`, required for final validation; never represented as waiver of consumer rights | New version requires new acknowledgement for a new transaction; no retroactive erasure of the historical act while lawfully retained |
| Privacy Policy | Evidence that the notice/version was presented and acknowledged | Transparency/legal obligation; not the lawful basis for all underlying processing | Backend/database; privacy/legal access when necessary | `privacy_notice_acknowledgement`, required for final validation; explicitly not blanket consent | Acknowledgement is not withdrawable consent; rights requests affect the underlying treatments by their own bases |
| Future optional purpose, if separately authorized | The single named optional purpose only | Consent only if counsel/product explicitly choose consent for that purpose | Only processors listed for that purpose | `consent`, optional, unbundled, off by default, exact document/purpose version | Withdrawal stops future processing for that purpose and records a revocation event; it does not rewrite prior lawful processing |
| Security/correlation audit | Prevent abuse, prove authority transitions and investigate incidents | Legitimate interest and/or legal obligation are intended candidates; balancing/legal validation required | Restricted security/operations systems | No checkout consent; sanitized audit record | Retained/deleted by its own policy; never contains CPF or full request data |
| IP/source port, only if legal review says applicable | Statutory application-access log purpose only | Legal obligation, if applicable | Separate restricted access-log authority/provider | Never part of a checkout/receipt record | Not consent-based; subject to the exact statutory lifecycle and rights exceptions |

Receipt exact semantics are therefore not all “consent.” The existing
`ConsentReceipt` requirement/name may be retained for traceability only if its
schema has a mandatory closed `legal_act_type`:

```text
contract_acceptance
policy_acknowledgement
privacy_notice_acknowledgement
consent
```

Final validation requires the first three acts for the exact current document
versions. Optional consent is absent from Phase 17 unless separately
authorized. A document update never silently rewrites or supersedes historical
evidence; it creates a new required version for later transactions.

**Why**

The matrix closes product/schema semantics while refusing to make an
unqualified legal conclusion or use privacy notice as blanket consent.

**Security/privacy impact**

Purpose limitation and processor allowlists are explicit. CPF and optional
purposes cannot leak through a broad acceptance flag.

**Operational impact**

Document version/digest publishing, receipt validation, supersession and legal
content ownership need named processes. No user-agent/IP collection is added to
checkout.

**Phase-boundary impact**

Phase 17 can implement the typed receipt/purpose contract. Final legal copy,
processor assessment and go-live approval remain the Phase 22 external gate.

**Residual risk**

The intended legal bases, especially CPF necessity and the Exchange Policy
classification, are provisional until qualified Brazilian counsel confirms
them.

**Human approval status**

HUMAN APPROVED — PASS, with LEGAL REVIEW REQUIRED retained. This product and
technical approval is not legal approval.

**Legal/external dependency?**

YES — qualified Brazilian legal review must confirm purpose, necessity, legal
basis, document content and processor disclosures before real-data go-live.

**PLAN consequence**

Legal review does not block technical PLAN because the data model uses closed
semantic types and versioned policy. PLAN must include a pre-go-live blocking
legal checkpoint and must not hard-code an unapproved legal claim.

**Binding decision text**

> PROVISIONAL PRODUCT/TECHNICAL DECISION — LEGAL REVIEW REQUIRED. Terms of
> Purchase are contractual acceptance, Exchange Policy is a policy
> acknowledgement, and Privacy Policy is notice acknowledgement, not universal
> consent. Any future consent is optional, purpose-specific, unbundled and
> revocable. Legal bases, CPF necessity, copy and processor disclosures require
> qualified review before go-live but do not block the technical PLAN.

## R17-HR-05 — Retention, access, rights and IP

**Question**

What lifecycle applies per data category; who may decrypt; how do DSAR,
correction, deletion, revocation, break-glass, backups and IP/source-port logs
work?

**Binding evidence**

- Seven days is the product contract for abandoned-cart CPF only.
- No accepted source proves five years as a universal retention period.
- Receipts and pseudonymized ciphertext remain personal data.
- Financial/contractual/legal evidence cannot always be erased on request while
  a valid obligation or claim requires it.
- If Marco Civil access-log obligations apply, IP/time and potentially source
  port require a purpose/lifecycle separate from CPF and receipts.

**Options considered**

1. Retain everything for five years.
2. Delete everything immediately upon any request.
3. Use category-specific clocks, holds, access roles and a legal-policy version.
4. Put IP/user-agent in every receipt as defensive evidence.

**Rejected options**

- Universal five-year retention has no accepted basis and over-retains cart
  CPF/privacy acknowledgements.
- Immediate universal deletion can destroy active transaction, financial,
  consumer-right or legal-claim evidence.
- IP/user-agent in receipts couples unrelated purposes; user agent is forbidden.

**Adjudicated decision**

Adopt the following **PROVISIONAL TECHNICAL LIFECYCLE POLICY — LEGAL REVIEW
STILL REQUIRED**:

| Category | Clock and retention rule | Purge/deletion |
|---|---|---|
| Current-cart CPF/envelope | R17-HR-01 dedicated clock; seven days from last meaningful activity, or earlier immediately after successful Order snapshot bind | Physical live purge of ciphertext/nonce/tag/wrapped DEK; no soft-delete substitute |
| Current structured checkout draft | Same cart lifecycle while actively needed; on cart replacement/expiry/consumption, no silent transfer | Delete/minimize under the cart policy; ordinary non-CPF PII remains subject to rights/operational rules |
| Protected Order CPF snapshot | Clock starts at Order delivery/transaction operational closure, whichever is later; active refund, exchange, chargeback, fraud investigation, reconciliation or legal hold suspends deletion | `retention_due_at` is calculated from a legally approved versioned schedule; then destroy envelope/wrapped DEK and replay tombstone on restore |
| Terms and Exchange receipts | Clock starts at delivery or final cancellation; later dispute/claim resolution restarts only the legally approved claim-evidence clock | Retain only for the counsel-approved contractual/consumer/legal-claim period; do not hard-code “five years” before approval |
| Privacy-notice acknowledgement | Clock starts when that notice version is last used for a transaction; it is not automatically co-retained with all contract evidence | Retain for the counsel-approved accountability period, independently versioned |
| Optional-consent receipt/revocation, if later introduced | From acceptance until withdrawal; evidence clock begins at withdrawal/last processing | Stop future processing immediately on withdrawal; retain only minimum proof for the approved accountability period |
| Sanitized purge/security audit | 12 months from event unless an active incident/legal hold requires longer | Delete automatically; no CPF/ciphertext/address/email/raw exception |
| KMS/crypto key version | Until zero live/backup/replay/legal dependencies per R17-HR-03 | Two-person-approved destruction after inventory and backup expiry |
| IP/time/source port access log | Not collected by Phase 17. If counsel confirms Marco Civil/provider applicability, use a separate authority and the legally required minimum period (accepted research identifies six months as the candidate minimum) | Separate restricted purge; never linked into receipt/CPF records beyond a lawful case reference |

The exact numeric durations for Order CPF and each legal receipt are deliberately
not invented. The smallest material missing fact is a signed Brazilian legal
retention schedule mapping each category to exact duration, starting event,
hold conditions and statutory basis. Product/legal owner must provide that
schedule before production data or go-live. Technical PLAN stores
`retention_policy_version`, `retention_started_at`, `retention_due_at` and
lawful hold state so the approved schedule can be applied without schema drift.

Access/decrypt policy:

- normal checkout runtime may decrypt only the owning authenticated cart after
  BFF/auth/ownership/lock/recheck;
- CCL/Order recovery worker may decrypt only the snapshot involved in that
  claimed recovery;
- DBAs, analytics, support agents and ordinary admins have no KMS decrypt
  permission;
- privacy/legal support access requires a case/ticket, named human identity,
  approved purpose, MFA/JIT role, least-field projection and sanitized audit;
- break-glass requires two-person approval, critical alert, one-hour maximum
  grant and post-incident review. No audit record contains CPF.

Rights/DSAR policy:

- verify Customer identity through the existing auth authority; never accept
  target identity from body alone and never reveal cross-customer existence;
- export an allowlisted, human-readable record; CPF is masked by default. Any
  full-CPF disclosure requires a separately approved legally necessary secure
  channel and audit;
- correction creates a new current protected record revision/envelope; it does
  not mutate immutable historical receipts or a concluded Order without the
  applicable correction process;
- deletion physically/cryptographically removes eligible data. Refusal or
  deferral due to active obligation/hold is recorded with reason and review
  date, not an indefinite generic flag;
- consent withdrawal applies only to an actual consent purpose. Contract or
  notice acknowledgements are not retroactively relabeled as consent.

Backup/erasure policy:

- live purge deletes the wrapped per-record DEK and ciphertext;
- immutable backups expire on their own approved schedule. On restore, the
  purge ledger/tombstone stream must replay before application access so a
  deleted record is not resurrected;
- KEK destruction waits for backup dependency exhaustion under R17-HR-03.

**Why**

This is concrete about category, clock, access and deletion mechanics while
refusing an unsupported universal number. It keeps technical schema stable and
makes the one missing legal schedule explicit.

**Security/privacy impact**

Least privilege, JIT access, independent IP authority and cryptographic purge
reduce unnecessary exposure. Ciphertext is never misclassified as anonymous.

**Operational impact**

A policy registry, retention calculator, legal-hold review, DSAR workflow,
JIT/break-glass process, restore tombstone replay and periodic access audit are
required.

**Phase-boundary impact**

Phase 17 owns the data/retention mechanisms. Production access roles,
infrastructure logs and final legal schedule are operational/Phase 22 gates.

**Residual risk**

Until counsel supplies numeric legal durations, Order/receipt production
retention cannot be safely enabled. Development must use synthetic data and no
real providers.

**Human approval status**

HUMAN APPROVED — PASS, with LEGAL REVIEW REQUIRED retained.

**Legal/external dependency?**

YES — signed exact legal retention and Marco Civil applicability review before
real-data go-live.

**PLAN consequence**

The missing legal schedule does not block a technical PLAN built around a
versioned policy engine and a blocking production configuration gate. It does
block production enablement, real-data migration and final release.

**Binding decision text**

> PROVISIONAL TECHNICAL POLICY — LEGAL REVIEW STILL REQUIRED. Apply the exact
> seven-day cart-CPF rule, purpose-specific Order/receipt clocks, least-privilege
> JIT decrypt, audited one-hour two-person break-glass, real purge plus restore
> tombstone replay, and a separate IP-log authority only if legally applicable.
> No universal five-year period is adopted. Exact Order/receipt durations and
> Marco Civil scope must be approved before real-data go-live.

## R17-HR-06 — Billing address

**Question**

Is the Phase 17/M1 billing-address contract absent, derived from shipping or
independent?

**Binding evidence**

- Accepted Card/Pix provider request authority contains no billing address or
  CPF.
- Medusa supports optional independent shipping/billing relations but does not
  require both.
- No current fiscal, fraud or operational authority proves an independent
  billing address need.
- Data minimization disfavors duplicated address PII.

**Options considered**

`ABSENT`, `DERIVED_FROM_SHIPPING`, `INDEPENDENT`.

**Rejected options**

- `DERIVED_FROM_SHIPPING` creates an unnecessary duplicate and future ambiguity
  about which copy is authoritative.
- `INDEPENDENT` expands collection, validation, retention and provider contract
  without a current need.

**Adjudicated decision**

Choose **`ABSENT`** as a deliberate M1 contract:

- Phase 17 request schemas reject `billing_address` and billing aliases as
  unknown fields;
- protected current data and Order snapshot do not store it;
- Store responses/OpenAPI omit it from Phase 17 checkout DTOs;
- no derived billing relation is materialized in Medusa;
- Stripe authority remains the accepted narrow allowlist with no CPF/address;
- a future proved fiscal/antifraud/provider requirement requires a new human
  product/privacy/contract gate and cannot silently extend M1.

**Why**

Absence meets current payment behavior with the smallest PII surface and no
conflicting copy.

**Security/privacy impact**

Eliminates an unnecessary address collection/storage/retention path.

**Operational impact**

Validators and exact-set/noisy-object tests must reject rather than ignore the
field.

**Phase-boundary impact**

No hypothetical payment/fiscal expansion is pulled into Phase 17 or Phase 19.

**Residual risk**

A later provider configuration may require billing data. That is a future
explicit contract change, not a reason to collect it now.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

None for the current technical contract; future legal/provider need reopens a
separate gate.

**PLAN consequence**

PLAN must encode exact schema absence, negative body tests and no model/
projection field.

**Binding decision text**

> Billing address is `ABSENT` in M1: not accepted, persisted, derived or
> returned. Any future need requires a separate human-approved product/privacy/
> contract change.

## R17-HR-07 — Public error taxonomy and precedence

**Question**

Which codes/statuses/field keys, single-versus-multiple behavior, ordering,
messages, retry semantics and safe cart snapshots apply, and what is the exact
authority/error precedence?

**Binding evidence**

- The existing closed envelope is `{code,message,retryable,correlationId?,
  fieldErrors?,cart?}` and rebuilds output by allowlist.
- Current authority already maps stale cart version to 412 and hides ownership
  as 404.
- The mandatory prefix is surface → BFF → auth → ownership → lock/recheck.
- Replay cannot bypass auth, ownership, CAS, review, freeze or domain rules.
- Public output cannot include CPF, provider IDs, crypto internals or raw input.

**Options considered**

1. Expose raw validator/provider/crypto messages.
2. Return a list of competing top-level domain errors.
3. Return one deterministic top-level code plus all safe field errors.
4. Perform idempotency replay before authority revalidation.

**Rejected options**

- Raw messages are PII/oracle risks.
- Multiple top-level errors make status and BFF handling ambiguous.
- Early replay can return a historical success after authority became stale,
  reviewed or financially frozen.

**Adjudicated decision**

Use exactly one closed error envelope and one top-level code. Domain validation
returns every applicable field error in deterministic allowlist order.

Phase 17 public code/status contract:

| Code | HTTP | retryable | Public use |
|---|---:|---|---|
| `NOT_FOUND` | 404 | false | Unknown surface, bad/missing caller BFF credential or absent/foreign/replaced cart; uniform non-enumerating shape |
| `SERVICE_UNAVAILABLE` | 503 | false | Mandatory server-side BFF guard configuration absent/invalid; fixed message and operational alert |
| `UNAUTHORIZED` | 401 | false | Missing/expired/revoked Customer authentication after BFF gate |
| `VALIDATION_ERROR` | 400 | false | Malformed JSON, unknown field, type/size/schema failure before domain validation |
| `CHECKOUT_LOCKED` | 409 | false | Unresolved financial freeze or reconciliation; no financial/provider detail |
| `CART_VERSION_MISMATCH` | 412 | false | Stale/missing incompatible `If-Match` on mutation/final validation |
| `CART_REVIEW_REQUIRED` | 409 | false | Pending authoritative CartReview |
| `IDEMPOTENCY_KEY_REUSED` | 409 | false | Same operation-scoped key with incompatible semantic fingerprint, multiple locator matches or unsafe terminal conflict |
| `CHECKOUT_DETAILS_INVALID` | 422 | false | One or more checkout/address/receipt domain fields invalid without a more specific required top-level code |
| `FEDERAL_TAX_ID_REQUIRED` | 422 | false | CPF absent at final validation |
| `INVALID_CPF` | 422 | false | CPF supplied with invalid normalized length/checksum |
| `ZERO_TOTAL_NOT_SUPPORTED` | 422 | false | Final authoritative total equals zero |
| `PRIVACY_SERVICE_UNAVAILABLE` | 503 | true only before any uncertain side effect | Required KMS/keyring dependency temporarily unavailable |
| `PRIVACY_DATA_UNAVAILABLE` | 500 | false | Unknown version, corrupt envelope, tag/AAD failure or ambiguous protected authority |

Messages are fixed presentation strings such as `Not Found`,
`Authentication required`, `Checkout is temporarily locked`, `Invalid
checkout details`, `Privacy service unavailable` and `Internal Server Error`.
They never use raw exception/input text. Crypto corruption and key version are
not distinguished publicly.

Exact `fieldErrors` key allowlist and order:

```text
first_name
last_name
account_email
phone
federal_tax_id
postal_code
street
number
neighborhood
city
province
country_code
complement
terms_of_purchase
exchange_policy
privacy_policy
items
total
```

`account_email` is read-only and may indicate account correction is required;
it is never accepted as identity input. `complement` appears only when supplied
but invalid. Public values are limited to `Required`, `Invalid value` or
`Unsupported value`; no submitted value appears.

When several domain errors exist, return one envelope with all field keys in
the order above. Select the single top-level code by this deterministic order:

```text
FEDERAL_TAX_ID_REQUIRED
→ INVALID_CPF
→ ZERO_TOTAL_NOT_SUPPORTED
→ CHECKOUT_DETAILS_INVALID
```

Exact processing/precedence:

```text
surface
→ BFF service authority
→ Customer auth
→ canonical ownership
→ PostgreSQL lock + ownership/authority recheck
→ unresolved financial freeze/reconciliation
→ If-Match/current version
→ pending CartReview
→ Idempotency-Key locator + complete keyrings + replay compatibility
→ request schema and complete domain validation
→ protected-state decrypt/integrity + encryption capability
→ commit/result
```

Schema validation may parse enough to reject unsafe/oversize input at the
network boundary, but it cannot return a resource-specific replay/domain result
before the authority prefix. Idempotent success is returned only after every
preceding authority is currently valid. Missing/incomplete/corrupt locator or
fingerprint keyring returns `PRIVACY_SERVICE_UNAVAILABLE` before zero matches
can mean a new claim. Missing or malformed `Idempotency-Key` returns
`400 VALIDATION_ERROR` only when execution reaches the idempotency stage;
incompatible reuse returns `409 IDEMPOTENCY_KEY_REUSED`. Transient KMS
unavailability may be retryable only before any uncertain side effect; missing,
incomplete or corrupt key configuration is not advertised as retryable.

Safe cart snapshot policy:

- allowed only after successful Customer/ownership recheck for
  `CART_VERSION_MISMATCH`, `CART_REVIEW_REQUIRED` and 422 domain validation;
- snapshot must be the current post-lock allowlisted pre-Order serializer with
  masked CPF and current ETag;
- absent for 400/401/404, freeze/reconciliation, idempotency conflict, crypto
  failure and all 5xx responses.

**Why**

The order hides protected/financial state until authority is proven, prevents
replay bypass, gives the BFF deterministic remediation and aggregates all safe
field feedback without echoing PII.

**Security/privacy impact**

Uniform 404 prevents enumeration; fixed messages and allowlisted fields remove
PII/provider/crypto oracles. Freeze is public only as a generic lock.

**Operational impact**

The existing generic Store code set must gain a closed Phase 17 mapping and
tests for every pairwise precedence conflict. Retry headers apply only to safe
503/429 categories.

**Phase-boundary impact**

No Phase 18 shipping or Phase 19/20 payment-specific public states are
introduced. `CHECKOUT_LOCKED` does not expose `RECONCILIATION_REQUIRED` detail.

**Residual risk**

One top-level code cannot express every field-specific cause, so the BFF must
use safe `fieldErrors` for form display and top-level code only for flow state.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

None.

**PLAN consequence**

PLAN must update the TypeScript registry/normalizer and tests before writer
generation, preserve existing accepted mappings outside Phase 17, and include
noisy-object, no-echo, precedence and exact-keyset matrices.

**Binding decision text**

> Phase 17 returns one closed error envelope, one deterministic top-level code
> and all allowlisted field errors. Authority precedence is surface → BFF → auth
> → ownership → lock/recheck → freeze/reconciliation → stale → review → safe
> idempotency/replay → domain → crypto → commit. Replay never bypasses an
> earlier authority. Safe cart snapshots exist only for owned stale, review and
> domain errors.

## R17-HR-08 — Resume operation and replaced cart

**Question**

Should resume be a dedicated Customer-only GET or extend active-cart, and what
happens to a replaced/expired cart, old draft, receipts, reauthentication and
stale browser state?

**Binding evidence**

- Current `GET /store/carts/active` supports guest and Customer cart location
  but does not own protected draft/receipt semantics.
- Reauthentication must resolve server-authoritative Customer and canonical
  cart anew.
- Browser snapshot/path ID cannot restore authority.
- CPF and receipt authority cannot silently transfer between carts.

**Options considered**

1. Extend `GET /store/carts/active` with protected checkout data.
2. Add a dedicated Customer-only checkout-details GET.
3. Automatically move the draft/receipts to any replacement canonical cart.

**Rejected options**

- Extending active-cart mixes guest and Customer/protected semantics and risks
  exposing protected data through an older broader operation.
- Silent transfer changes purpose/cart binding and can attach CPF or legal acts
  to a cart the customer did not review.

**Adjudicated decision**

Add the future exact operation:

```text
GET /store/carts/{id}/checkout-details
```

It is Customer-only and BFF-only. It requires publishable Store authority, BFF
service credential, current Customer bearer, canonical Customer/cart ownership
and an unambiguous authority recheck. GET requires neither `If-Match` nor
`Idempotency-Key`, causes no mutation and never resets the abandonment clock.

The response is `Cache-Control: no-store`, returns current ETag, and is an
allowlisted projection containing:

- cart ID and current cart/resource revision needed by the BFF;
- structured recipient/address fields;
- server-derived read-only account email;
- masked CPF only;
- current required-document versions and per-purpose satisfied/not-satisfied
  state, not internal receipt rows;
- derived `checkout_data_complete` and safe incomplete field keys;
- no ciphertext, wrapped key, internal snapshot/receipt/provider IDs, legal
  basis claim, raw audit or financial details.

Replaced/expired behavior:

- old, foreign, expired, deleted or noncanonical cart path returns uniform
  `404 NOT_FOUND` without confirming existence;
- the BFF may separately call the existing active-cart operation to locate the
  current canonical cart, then call the dedicated GET for that ID;
- an old cart's protected draft and receipts remain bound to that cart and
  follow purge/retention; they are never copied, merged or accepted for a new
  cart automatically;
- the new canonical cart begins without protected draft/receipt satisfaction.
  The Customer must re-enter/reconfirm the applicable data/documents;
- after reauthentication, all identity/cart/receipt/version authorities are
  resolved from PostgreSQL; expired browser state is ignored;
- stale browser mutation receives 412 and the safe current cart snapshot under
  R17-HR-07. A plain resume GET always returns the current owned representation.

Future Store/BFF exact set consequence is exactly three Phase 17 operations:

```text
GET   /store/carts/{id}/checkout-details
PATCH /store/carts/{id}/checkout-details
POST  /store/carts/{id}/checkout-details/validate
```

No aliases, guest variants, saved-address route, native cart-complete/update or
browser-direct path is implied.

**Why**

The dedicated route has one protected meaning and avoids widening a guest-aware
locator. Explicit re-entry is safer than transferring CPF/legal authority.

**Security/privacy impact**

Customer/BFF/ownership checks precede protected projection. `no-store`, masked
CPF and no transfer reduce cache/cross-cart leakage.

**Operational impact**

The BFF performs active-cart location followed by protected resume. Replacement
may create user friction because data/acknowledgements must be re-entered.

**Phase-boundary impact**

This is checkout resume only. It is not Phase 20 payment polling, Order summary
or frontend implementation.

**Residual risk**

Two GETs may add latency. The narrower security contract outweighs that cost;
the BFF may coordinate them server-side without browser-direct Medusa.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

None.

**PLAN consequence**

PLAN must add exactly the three-operation manifest/BFF/registry set, negative
route enumeration, cache headers, replaced-cart/reauth matrices and zero
transfer tests.

**Binding decision text**

> Resume uses a dedicated BFF-only, Customer-only
> `GET /store/carts/{id}/checkout-details`. It returns only current owned,
> allowlisted, no-store, masked state. Replaced/expired carts are hidden as 404;
> protected drafts and receipts never transfer silently to another cart.

## R17-HR-09 — Gelato/provider adjudication

**Question**

What product direction preserves D17-12 while Gelato's public Brazil contract
requires recipient `federalTaxId`?

**Binding evidence**

- Current Gelato v4 documentation refreshed on 2026-09-10 still says
  `federalTaxId` is mandatory for Brazil and CPF/CNPJ identifies the recipient.
- No accepted official exception exists for individual apparel/local production.
- Current local dispatch reads raw CPF from metadata.
- D17-12 absolutely forbids raw CPF to Gelato.

**Options considered**

1. Send raw CPF.
2. Send masked/fictitious CPF, merchant CNPJ or hide CPF in another field.
3. Omit the mandatory field and claim compatibility.
4. Keep BR Gelato shipping fail-closed while seeking an official written
   no-CPF exception.
5. Change product/provider in a separately authorized roadmap gate.

**Rejected options**

- Options 1–3 violate D17-12 and/or falsify provider compatibility.
- Option 5 cannot occur implicitly inside Phase 17; Gelato-only is current
  project authority.

**Adjudicated decision**

Proceed with the technical Phase 17 privacy work, but make every BR Gelato
dispatch **fail closed before any provider request** while no authoritative
no-CPF contract exists:

- remove raw CPF from generic address/Order/provider projections;
- prohibit `federalTaxId`, masked/fictitious values, merchant CNPJ and aliases
  in every Gelato request builder/hash/log/fixture;
- for a BR recipient, the dispatch boundary returns a sanitized internal
  `provider_contract_blocked` outcome, creates no Gelato order/request, retains
  the locally born Order and records an operational alert without CPF/address;
- do not claim that fulfillment works, do not fall back to another provider,
  and do not call Gelato during Phase 17;
- permit only documentation/contact work in a separate explicitly authorized
  gate to obtain written Gelato confirmation that an individual BR order is
  accepted without `federalTaxId`;
- if that confirmation is unavailable, resolving the blocker requires a new
  human roadmap/architecture/privacy decision that supersedes the Gelato-only
  assumption while preserving D17-12; Phase 18 remains wholly unauthorized.

This direction means no Phase 17 implementation requires CPF transmission and
no decision falsifies provider compatibility. Phase 17 can prepare checkout,
protect/purge CPF and prove zero prohibited requests after a separately
authorized PLAN and execution. A successful zero-request guard is not proof of
Gelato compatibility. `R17-BLOCK-01` remains a Phase 17 exit/closure blocker;
because the roadmap is linear `17 → 18`, Phase 18 as a whole, Phase 18+ and the
release remain blocked until compatibility or a separate provider/product
decision is authoritative.

**Why**

It preserves the hard privacy boundary immediately and turns an incompatible
runtime path into an explicit operational block rather than an unsafe request.

**Security/privacy impact**

No raw/masked/fictitious CPF reaches Gelato. Alerts and errors are allowlisted
and contain no recipient data.

**Operational impact**

Paid Orders may remain `requires_attention` and cannot be fulfilled through
Gelato while the blocker exists. Operations must not manually paste CPF into
Gelato as a workaround.

**Phase-boundary impact**

Phase 17 owns removal/prohibition/proof at the privacy sink. Phase 17 closure is
blocked by retained `R17-BLOCK-01`. Phase 18 as a whole, Phase 18+ and release
remain blocked; provider substitution is not authorized.

**Residual risk**

The product cannot fulfill BR orders through the sole current provider. This is
visible product unavailability, not a privacy compromise.

**Human approval status**

HUMAN APPROVED — BINDING PRODUCT DIRECTION. The mandatory governance
correction in the 2026-09-10 human decision is incorporated here.

**Legal/external dependency?**

YES — authoritative written Gelato exception or a separate human-approved
provider/product change.

**PLAN consequence**

Phase 17 PLAN is eligible for separate human authorization and may include
removal of the CPF sink, protected CPF lifecycle, negative proof of zero
prohibited sinks, a zero-request fail-closed guard, proof that no masked,
fictitious, merchant or aliased tax ID substitutes CPF, and the other approved
`R17-HR-*` work. PLAN remains NOT AUTHORIZED. Any later PLAN must not implement
shipping quotation/selection, call Gelato, select a new provider, claim that
the zero-request guard proves compatibility or convert `R17-BLOCK-01` into
PASS. Phase 17 execution remains NOT AUTHORIZED; Phase 17 closure remains
blocked; Phase 18 as a whole and Phase 18+ remain NOT AUTHORIZED; release is
BLOCKED.

**Binding decision text**

> While Gelato requires `federalTaxId`, BR dispatch is blocked before any
> provider request. No CPF, mask, fictitious value or merchant CNPJ is sent and
> compatibility is not claimed. Phase 17 PLAN is eligible only for separate
> human authorization and remains NOT AUTHORIZED; execution is NOT AUTHORIZED.
> The zero-request guard does not prove Gelato compatibility. `R17-BLOCK-01`
> remains a Phase 17 exit/closure blocker. Phase 18 as a whole, Phase 18+ and
> release remain blocked until authoritative written no-CPF compatibility or a
> separate human-approved provider/product decision preserving D17-12 exists.

## R17-HR-10 — Sensitive fingerprint key lifecycle

**Question**

How are claims found across key rotation, how is the semantic fingerprint
computed/versioned, and what happens on rotation, compromise, destruction and
replay?

**Binding evidence**

- Raw SHA-256 over low-entropy CPF is enumerable; randomized ciphertext cannot
  provide stable semantic equality.
- Current lookup/fingerprint lifecycle is circular if a persisted version is
  needed before the claim can be found.
- Lookup and semantic fingerprint keys must be separate from each other and
  from encryption/auth/tracking keys.
- Zero matches is safe only when the retained locator keyring is complete.

**Options considered**

1. Raw SHA-256 or deterministic encryption of CPF.
2. Use only the active locator key after rotation.
3. Stable opaque locator with no rotation semantics.
4. Generate locator candidates with every retained lookup-key version, then
   validate a separate semantic fingerprint.

**Rejected options**

- Raw hash/deterministic encryption is correlatable/enumerable.
- Active-key-only lookup converts old replay into a new claim.
- A permanently non-rotating locator secret creates an unmanaged lifetime and
  compromise problem.

**Adjudicated decision**

Choose **all-retained-key locator candidates**, with two complete and separate
keyrings:

1. `Idempotency-Key locator` keyring finds the operation/actor/resource claim.
2. `Sensitive semantic fingerprint` keyring proves payload/context equality.

Claim locator:

- normalize only the syntactic Idempotency-Key form, never the request body;
- for the exact operation + Customer authority + cart resource scope, compute
  HMAC-SHA-256 candidates with every retained lookup key version;
- query all candidates in one bounded transaction and persist locator scheme/
  version on creation;
- the retained-version manifest is explicit and complete, not inferred from
  secrets that happened to load.

Semantic fingerprint:

- HMAC-SHA-256, full 32-byte digest, compared with `timingSafeEqual`;
- dedicated random 256-bit key per version, never reused as AES KEK/DEK,
  locator pepper, auth, analytics or tracking key;
- RFC 8785 canonical JSON/UTF-8 with a closed schema and domain separation
  `indicio/store/checkout-fingerprint/v1/<operation>`;
- persist only digest, fingerprint scheme/version and key version, never the
  canonical DTO;
- the exact semantic DTO contains:
  `schema`, operation, Customer authority ID, canonical cart ID, cart resource
  version, protected checkout data revision, sorted `fields_present`, normalized
  first/last name, server account email, phone, CPF digits, postal code, street,
  number, neighborhood, city, province, fixed country, complement, exact receipt
  purpose/document-version/digest set, authoritative total minor/currency for
  final validation, and no client-supplied authority/provider ID;
- CPF/email/address exist only in the in-memory canonical DTO long enough to
  compute HMAC and are then discarded. Ciphertext is never the fingerprint.

For partial PATCH, `fields_present` distinguishes omitted from explicit
clear/update, and only submitted semantic fields are hashed with the current
authority bindings. For final validation, the complete canonical protected
revision, receipt set and authoritative total are hashed.

Mandatory lookup/replay rule:

```text
complete retained keyring + 0 matches
→ first claim may be created under active locator and fingerprint versions,
  subject to the existing PostgreSQL uniqueness/transaction linearization

1 match
→ replay/reuse; only now do the persisted scheme/key versions select the
  fingerprint key and stored result

>1 matches
→ fail closed and alert

incomplete/missing/corrupt keyring or required retained version
→ fail closed before interpreting 0 as a new claim
```

Lifecycle:

- new active versions create new claims; retained locator versions remain
  candidate-generating and retained fingerprint versions remain verify-only;
- normal rotation occurs at least annually and may occur sooner. Old versions
  remain until every dependent claim/result has passed terminal retention and
  every backup/recovery window has expired;
- key manifests are versioned/config-authoritative and health-checked before
  traffic. Partial load makes the operation unavailable;
- suspected locator/fingerprint-key compromise immediately disables new claims
  under that version. Existing potentially affected claims enter quarantine:
  reuse only after recomputation from current protected authoritative data or
  manual reconciliation; never create a replacement financial intent merely
  because equality cannot be trusted;
- destruction requires a zero-dependency inventory, backup expiry and two-
  person approval. Destruction never precedes PaymentAttempt/CCL/idempotency
  recovery exhaustion.

**Why**

All retained locator candidates remove the version-before-lookup cycle. A
separate HMAC protects low-entropy CPF semantics and preserves replay across
rotation without persisting reversible input.

**Security/privacy impact**

Database-only attackers cannot enumerate CPF without the HMAC key. Separation
limits compromise blast radius. Digest remains pseudonymous personal data and
follows claim retention.

**Operational impact**

Every request performs a bounded number of HMAC candidates; keyring size must
be capped by claim retention and monitored. Missing versions fail traffic
closed instead of creating duplicate intent.

**Phase-boundary impact**

Phase 17 establishes the primitive and checkout fingerprint. Phase 19 consumes
it for PaymentAttempt compatibility without redesigning locator semantics.

**Residual risk**

More retained versions increase key exposure and lookup cost. A compromised
semantic key can enable offline CPF guesses if both digests and domain bindings
are stolen, so incident quarantine remains mandatory.

**Human approval status**

HUMAN APPROVED — PASS.

**Legal/external dependency?**

None for the technical rule; key provisioning remains a separate operational
gate.

**PLAN consequence**

PLAN must materialize separate schemes/version manifests, canonical DTO tests,
0/1/>1 matrices, incomplete-keyring failures, rotation/compromise/destruction
tests and concurrency proof that first claim remains exactly one.

**Binding decision text**

> Locate a claim using HMAC candidates from the complete retained locator
> keyring, then verify its separate versioned HMAC-SHA-256 semantic fingerprint
> over the closed canonical DTO. Complete+0 creates the first claim, 1 replays,
> >1 fails, and any incomplete/missing/corrupt keyring fails before zero can mean
> new. Old keys remain locator/verify-only until all claim, recovery and backup
> dependencies expire.

## R17-BLOCK-01 — External Gelato blocker

**Question**

Has authoritative evidence resolved the no-CPF Gelato compatibility conflict,
or is a deterministic product direction possible while the external condition
remains unresolved?

**Binding evidence**

- Accepted GEL-01..GEL-05 research and the 2026-09-10 official-doc refresh say
  `federalTaxId` is mandatory for Brazil.
- No written individual-recipient no-CPF exception has been obtained.
- D17-12 forbids raw CPF to Gelato without exception.
- R17-HR-09 selects a fail-closed zero-request direction and does not claim
  compatibility.

**Options considered**

A. `RESOLVED — authoritative external evidence obtained`.

B. `ADJUDICATED — EXTERNAL BLOCKER RETAINED`.

C. `OPEN — MATERIAL HUMAN/EXTERNAL DECISION STILL MISSING`.

**Rejected options**

- A is false because no official exception was obtained.
- C is no longer applicable after the human approval of R17-HR-09: product
  behavior is deterministic even though provider compatibility remains
  external and Phase 17 closure remains blocked.

**Adjudicated decision**

Classify exactly:

```text
B. ADJUDICATED — EXTERNAL BLOCKER RETAINED
   PHASE 17 EXIT/CLOSURE BLOCKER
   Product direction is now deterministic, but provider compatibility
   remains externally blocked.
```

Smallest resolving action: obtain official written Gelato confirmation that an
individual Brazilian recipient/order in the intended apparel flow is accepted
without `federalTaxId`, including the applicable API contract. A later
authorized non-production contract test would still be required before release.
If Gelato will not provide that contract, a separate human-approved
product/provider decision must supersede the current Gelato-only assumption
while preserving D17-12; this gate does not do so.

**Why**

Human approval of R17-HR-09 is sufficient to determine safe current behavior:
no request. It is not sufficient to assert external fulfillment compatibility.

**Security/privacy impact**

D17-12 remains absolute. The blocker cannot be resolved by transmitting,
masking, fabricating, substituting or hiding CPF.

**Operational impact**

Gelato fulfillment for BR remains unavailable and explicitly alerted; real
Orders cannot be released while this blocker persists.

**Phase-boundary impact**

Phase 17 technical PLAN is eligible for separate human authorization because it
needs no CPF transmission and may implement the fail-closed sink. PLAN and
execution remain NOT AUTHORIZED. The retained blocker prevents Phase 17
closure. Because the roadmap is linear `17 → 18`, Phase 18 as a whole, Phase
18+ and release remain blocked.

**Residual risk**

The sole configured fulfillment provider may never offer a compatible
contract, forcing a separately governed product/provider change.

**Human approval status**

HUMAN APPROVED AS ADJUDICATED — EXTERNAL BLOCKER RETAINED — PHASE 17
EXIT/CLOSURE BLOCKER.

**Legal/external dependency?**

YES — Gelato written evidence or separate product/provider adjudication.

**PLAN consequence**

This blocker does not prevent drafting a Phase 17 privacy PLAN after separate
human authorization under R17-HR-09. It blocks Phase 17 exit/closure. Any Phase
17 PLAN that calls Gelato, claims compatibility, treats a zero-request guard as
compatibility proof or lets a `CHK-*`/technical ledger convert the blocker into
PASS is invalid. Phase 18 as a whole and Phase 18+ remain NOT AUTHORIZED;
release remains BLOCKED.

**Binding decision text**

> R17-BLOCK-01 is `ADJUDICATED — EXTERNAL BLOCKER RETAINED` and remains a
> `PHASE 17 EXIT/CLOSURE BLOCKER`. A separately authorized Phase 17 PLAN may
> remove/prove the CPF sink with BR dispatch blocked before request, but no
> technical gate proves Gelato compatibility or resolves the blocker. Phase 17
> cannot close; Phase 18 as a whole, Phase 18+ and release remain blocked until
> official written no-CPF compatibility or a separate human-approved
> provider/product decision preserving D17-12 exists.

## 6. Conflict disposition

### R17-CONFLICT-01 — Gelato BR tax ID versus D17-12

```text
Status before checkpoint:
OPEN — CONFIRMED

Final disposition:
EXTERNAL CONFLICT RETAINED
PRODUCT DIRECTION ADJUDICATED
NOT RESOLVED
```

The conflict is not called resolved. D17-12 wins at the application boundary;
Gelato dispatch remains blocked before any provider request. The retained
conflict blocks Phase 17 exit/closure through `R17-BLOCK-01`; Phase 18 as a
whole and Phase 18+ remain NOT AUTHORIZED. The accepted historical research
artifacts are not rewritten.

## 7. Rejected-alternative ledger

The following alternatives are rejected across all decisions:

- raw, masked, fictitious or substituted CPF in Gelato;
- CPF or encrypted CPF in generic metadata;
- browser-direct Medusa or Customer/BFF authority conflation;
- Cart/Order/link/snapshot/idempotency records as new Order-birth authority;
- local timeout/status/expiry as financial thaw;
- replay before current auth/ownership/freeze/CAS/review/domain checks;
- raw SHA-256 or deterministic encryption of CPF;
- missing key/keyring interpreted as a new claim;
- GCM nonce reuse, short tag, unauthenticated plaintext release or plaintext
  fallback;
- cross-request plaintext DEK cache;
- soft delete labeled as CPF purge;
- key destruction while live data, claim, backup, recovery or hold depends on
  it;
- universal consent, universal five-year retention or privacy notice as blanket
  lawful basis;
- billing-address collection without a current proved need;
- silent protected draft/receipt transfer between carts;
- public raw validator/provider/crypto/financial messages;
- Phase 18–22 implementation, PLAN material or provider operations in this gate.

## 8. Invariants audit

| Invariant | Result |
|---|---|
| D17-01..D17-16 | PRESERVED |
| D17-12 — no raw CPF to Gelato/named sinks | PRESERVED |
| Canonical `payment_intent.succeeded` + CCL only Order birth | PRESERVED |
| FIN-01 | PRESERVED |
| FIN-02 | PRESERVED |
| FIN-03 | PRESERVED |
| FIN-04 | PRESERVED |
| Browser → BFF → Medusa | PRESERVED |
| Customer auth distinct from BFF authority | PRESERVED |
| PostgreSQL correctness authority | PRESERVED |
| Medusa module isolation | PRESERVED |
| Store/BFF exact-set default deny | PRESERVED |
| Phase 18–22 implementation leakage | 0 |
| Application-code changes in this gate | 0 |
| Migration/schema changes in this gate | 0 |
| Provider operational calls in this gate | 0 |
| Counter changes | 0 |

## 9. Legal and external caveats

Two dependencies deliberately remain after the approved adjudication:

1. **Qualified Brazilian legal review.** It must confirm CPF necessity/basis,
   each document's content/semantics, exact Order/receipt retention durations,
   rights exceptions, processor disclosures, international processing and
   Marco Civil access-log applicability before real-data go-live. This does not
   block a technical PLAN that keeps policies versioned and production disabled.
2. **Gelato compatibility.** Written official no-CPF compatibility is absent.
   `R17-BLOCK-01` therefore remains an explicit Phase 17 exit/closure blocker.
   It does not prevent drafting a Phase 17 privacy PLAN after separate human
   authorization when its binding behavior is zero Gelato requests for BR and
   no compatibility claim. A successful zero-request guard is not compatibility
   proof. Because the roadmap is linear `17 → 18`, Phase 18 as a whole and
   Phase 18+ remain NOT AUTHORIZED; release remains BLOCKED.

The external blocker can be resolved only by authoritative written Gelato
no-CPF compatibility sufficient for the intended BR individual flow, or by a
separate human-approved product/provider decision that supersedes the current
Gelato-only assumption while preserving D17-12. Neither dependency authorizes
real providers, remote infrastructure or release.

## 10. PLAN eligibility analysis

Human approval at `R17-HR-ADJ-01` is recorded as PASS. Every
technical/product ambiguity necessary to draft a Phase 17 PLAN now has a
deterministic answer:

- purge state machine and suspension rules are exact;
- protected authorities/cardinalities/minimum snapshot are exact;
- crypto provider/envelope/key lifecycle are selected;
- receipt semantics and policy-version model are concrete while legal claims
  remain provisional;
- billing is absent;
- error taxonomy/precedence and resume exact-set are exact;
- fingerprint lookup/rotation semantics are exact;
- Gelato behavior is zero-request fail-closed and the external blocker is
  explicitly carried.

Therefore the approved state is:

```text
PLAN ELIGIBLE FOR SEPARATE HUMAN AUTHORIZATION
```

Even then:

```text
Phase 17 PLAN:
ELIGIBLE FOR SEPARATE HUMAN AUTHORIZATION
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 17 CLOSURE:
BLOCKED UNTIL R17-BLOCK-01 IS RESOLVED

Phase 18:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Release:
BLOCKED
```

Eligibility is not authorization. A future Phase 17 PLAN may cover removal of
raw CPF from the current generic metadata path, protected CPF lifecycle,
negative proof of zero prohibited sinks, the D17-12-preserving Gelato
zero-request guard, proof that no masked/fictitious/merchant/aliased tax ID is
substituted, and the other approved `R17-HR-*` technical work. It may not treat
successful implementation, a `CHK-*` completion or a technical ledger as proof
of Gelato compatibility or as resolution of `R17-BLOCK-01`.

## 11. Final acceptance ledger

```text
R17-HR exact-set:
01..10 = 10/10 HUMAN APPROVED

R17-BLOCK exact-set:
01 = 1/1 ADJUDICATED — EXTERNAL BLOCKER RETAINED

Total adjudication coverage:
11/11

D17-01..D17-16:
PRESERVED

FIN-01..FIN-04:
PRESERVED

D17-12:
PRESERVED — NO RAW CPF TO GELATO

Order authority:
PRESERVED

BFF-only:
PRESERVED

Medusa module isolation:
PRESERVED

Phase 18–22 implementation leakage:
0

Application-code changes:
0

Migration/schema changes:
0

Provider operational calls:
0

Counter changes:
0

Phases closed:
4/10

Requirements:
34/91 complete — 57 open

Plans:
50/50 complete

Progress:
40%

CHK-01..CHK-10:
OPEN

Phase 17 PLAN:
ELIGIBLE FOR SEPARATE HUMAN AUTHORIZATION
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 17 CLOSURE:
BLOCKED UNTIL R17-BLOCK-01 IS RESOLVED

R17-CONFLICT-01:
EXTERNAL CONFLICT RETAINED
PRODUCT DIRECTION ADJUDICATED
NOT RESOLVED

Phase 18:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Release:
BLOCKED

R17-HR-ADJ-01:
HUMAN APPROVED — PASS
```

## 12. Adversarial self-review

Four review cycles attacked the packet against the mandatory security,
privacy, financial and governance list. Cycle 1 found one material P2 contract
omission (server-side BFF guard misconfiguration had not been distinguished
from an invalid caller credential) and one INFO typo. Both were corrected
before Cycle 2. Human review then identified one P1 governance defect: the
packet under-scoped `R17-BLOCK-01` to Phase 18 provider implementation/release
instead of retaining it as a Phase 17 exit/closure blocker under R17-Q05. Cycle
3 recorded that finding and triggered the mandatory correction. Cycle 4 reran
the full adversarial review after correction.

| Attack | Result after remediation |
|---|---|
| D17-12 weakening / raw CPF propagation | PASS — no transmission path or exception introduced |
| Gelato compatibility invented | PASS — explicitly unproven; zero-request block retained |
| Zero-request guard treated as compatibility proof | PASS — expressly prohibited |
| Phase 17 closure while `R17-BLOCK-01` remains | PASS — closure is explicitly BLOCKED |
| Linear `17 → 18` boundary bypass | PASS — Phase 18 as a whole and Phase 18+ remain NOT AUTHORIZED |
| `CHK-*`/technical ledger silently resolves external blocker | PASS — expressly prohibited |
| Order-birth authority drift / FIN-04 second authority | PASS — only canonical webhook + CCL creates/recovers Order |
| FIN-01 bypass | PASS — checkout decisions do not start provider/payment work |
| FIN-02 drift | PASS — authoritative total remains server-side and only fingerprint-bound |
| FIN-03 local thaw | PASS — due time/alerts never clear financial authority |
| Browser-direct Medusa | PASS — every protected operation remains BFF-only |
| Customer/BFF authority confusion | PASS — credentials/checks remain separate |
| Idempotency bypass / rotation duplicate claim | PASS — current authorities precede replay; complete 0/1/>1 rule is binding |
| GCM nonce/key misuse | PASS — per-record DEK, fresh 96-bit nonce, 128-bit tag, authenticated final and new handoff envelope |
| Key destruction before dependency exhaustion | PASS — live/claim/backup/recovery/hold inventory and two-person gate required |
| Soft delete called purge | PASS — physical envelope/wrapped-DEK removal and restore tombstones required |
| Legal overclaim / universal consent | PASS — product/technical policy is provisional and acts are separated |
| Invented universal retention | PASS — only product seven-day and operational 12-month rules are selected; legal durations remain an explicit external schedule |
| Silent draft/receipt transfer | PASS — explicitly forbidden; re-entry required |
| Error oracle / PII echo | PASS — fixed messages, exact fields, uniform 404 and restricted snapshots |
| Phase 18–22 leakage / premature PLAN | PASS — PLAN is only eligible for separate authorization; no PLAN or implementation exists |
| Counter drift / historical rewriting | PASS — counters unchanged and accepted artifacts untouched |

Cycle ledger:

| Cycle | P0 | P1 | material P2 | INFO | Result |
|---|---:|---:|---:|---:|---|
| 1 | 0 | 0 | 1 | 1 | REVISE |
| 2 | 0 | 0 | 0 | 0 | PASS |
| 3 — human governance correction | 0 | 1 | 0 | 0 | REVISE |
| 4 — final post-correction review | 0 | 0 | 0 | 0 | PASS |

Final result:

```text
P0: 0
P1: 0
material P2: 0
INFO: 0
```

## 13. Consolidated human checkpoint — final record

The explicit 2026-09-10 human answer approved every adjudication, with the
mandatory `R17-HR-09` / `R17-BLOCK-01` Phase-boundary correction incorporated
in this final record. No second approval checkpoint is required merely to
accept that specified correction.

| ID | Final status | Binding consequence retained |
|---|---|---|
| R17-HR-01 | HUMAN APPROVED — PASS | Dedicated clock, closed meaningful-activity reset set and FIN suspension preserve the original due time |
| R17-HR-02 | HUMAN APPROVED — PASS | Protected authority/snapshot cardinalities remain distinct from Order-birth authority |
| R17-HR-03 | HUMAN APPROVED — PASS | AWS KMS envelope lifecycle, no plaintext fallback/cache and re-encryption boundary are binding |
| R17-HR-04 | HUMAN APPROVED — PASS; LEGAL REVIEW REQUIRED | Product/technical policy is binding; legal approval remains a pre-go-live dependency |
| R17-HR-05 | HUMAN APPROVED — PASS; LEGAL REVIEW REQUIRED | Category retention/access/purge policy is binding; exact legal schedule remains external |
| R17-HR-06 | HUMAN APPROVED — PASS | Billing address is `ABSENT` from the Phase 17/M1 contract |
| R17-HR-07 | HUMAN APPROVED — PASS | Closed safe error contract and authority precedence are binding |
| R17-HR-08 | HUMAN APPROVED — PASS | Dedicated BFF-only Customer resume operation; no cross-cart protected-data transfer |
| R17-HR-09 | HUMAN APPROVED — BINDING PRODUCT DIRECTION | BR/Gelato dispatch fails closed before provider request; D17-12 preserved; Phase 17 closure blocked while `R17-BLOCK-01` remains |
| R17-HR-10 | HUMAN APPROVED — PASS | Retained locator candidates and separate semantic HMAC lifecycle are binding |
| R17-BLOCK-01 | ADJUDICATED — EXTERNAL BLOCKER RETAINED; PHASE 17 EXIT/CLOSURE BLOCKER | No technical gate proves compatibility; Phase 18 as a whole, Phase 18+ and release remain blocked |

```text
R17-HR-09:
HUMAN APPROVED — BINDING PRODUCT DIRECTION

BR/Gelato dispatch:
FAIL CLOSED BEFORE PROVIDER REQUEST

D17-12:
PRESERVED

R17-BLOCK-01:
ADJUDICATED — EXTERNAL BLOCKER RETAINED
PHASE 17 EXIT/CLOSURE BLOCKER

R17-CONFLICT-01:
EXTERNAL CONFLICT RETAINED
PRODUCT DIRECTION ADJUDICATED
NOT RESOLVED

Phase 17 PLAN:
ELIGIBLE FOR SEPARATE HUMAN AUTHORIZATION
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 17 CLOSURE:
BLOCKED UNTIL R17-BLOCK-01 IS RESOLVED

Phase 18:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Release:
BLOCKED

CHECKPOINT R17-HR-ADJ-01:
HUMAN APPROVED — PASS
```

`CHK-01..CHK-10`, milestone counters and requirement counts are unchanged. No
PLAN, code, migration, provider operation, commit, push, PR, merge or deploy is
authorized or produced by this checkpoint.
