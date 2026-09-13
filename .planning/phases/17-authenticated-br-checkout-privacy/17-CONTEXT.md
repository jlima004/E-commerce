---
phase: 17-authenticated-br-checkout-privacy
gate: context
status: technical-draft-human-review-required
prepared_at: 2026-09-08
depends_on:
  - phase: 16-cart-merge-review
    status: closed-human-approved
requirements:
  - CHK-01
  - CHK-02
  - CHK-03
  - CHK-04
  - CHK-05
  - CHK-06
  - CHK-07
  - CHK-08
  - CHK-09
  - CHK-10
---

# Phase 17 — Authenticated BR Checkout & Privacy — Context

## 1. Identity

```text
Phase:
17 — Authenticated BR Checkout & Privacy

Gate:
CONTEXT

Status:
TECHNICAL DRAFT — HUMAN REVIEW REQUIRED

Depends on:
Phase 16 CLOSED — HUMAN APPROVED
```

This document is the authoritative technical draft for the Phase 17 CONTEXT
gate. It records product meaning, accepted constraints, decisions already
supported by repository authority, unanswered questions and phase boundaries.
It does not authorize RESEARCH, PLAN, implementation, migration, provider use,
push, deploy, remote infrastructure or frontend work.

## 2. Objective

Phase 17 defines authenticated checkout preparation for an individual customer
in Brazil while removing raw CPF from the current generic address-metadata path.
It establishes the product and privacy contract for customer identity, canonical
cart ownership, partial checkout draft, atomic final validation, Brazilian
address data, CPF lifecycle, consent receipts, derived readiness, stable errors,
concurrency and interaction with review and financial freeze.

Successful future closure of the phase will make an authenticated cart
authoritatively ready for the later shipping and payment phases. It will not
quote shipping, start or confirm payment, create an Order, dispatch fulfillment
or implement the storefront.

## 3. Binding Inputs

The following local authorities bind this context:

- `.planning/PROJECT.md` — project value, backend-only milestone, BFF boundary,
  Brazil/BRL scope and Order-birth invariant.
- `.planning/STATE.md` — current milestone counters, Phase 16 closure, PR #28
  remediation acceptance and manual-gate governance.
- `.planning/ROADMAP.md` — Phase 17 goal and the linear boundaries of Phases
  18–22.
- `.planning/REQUIREMENTS.md` — exact Phase 17 requirement set.
- `.planning/phases/16-cart-merge-review/16-CLOSURE.md` — human-approved Phase
  16 closure, including review authority and checkout blocking.
- `.planning/phases/16-cart-merge-review/16-PR28-REMEDIATION.md` — accepted
  FIN-01..FIN-04 financial contracts and post-Order recovery authority.
- Accepted FND, AUTH, CART and MRG context/closure artifacts from Phases 13–16.
- `docs/PRD_Backend_v1.1.md`, `docs/PRD_frontend_v1.1.md`,
  `docs/SRS_v1.5.md`, `docs/DB_MODEL_v1.21.md` and
  `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — product, data and future-consumer
  contracts, subject to the precedence and stale-statement rules below.

Where an older or generic statement conflicts with accepted later authority,
the later accepted authority wins. In particular:

- pre-payment state remains in Cart, PaymentCollection, PaymentSession and
  PaymentAttempt; no older wording may create an Order before the canonical
  Stripe webhook;
- the generic guest-checkout data model does not override the authenticated
  Phase 17 requirement;
- the pre-remediation cart-invalidation model does not override FIN-03
  financial freeze;
- as-built Medusa package versions and accepted closure evidence take
  precedence over stale stack-version prose.

## 4. Product Scope

### 4.1 Authenticated checkout

Authenticated checkout is the server-authoritative preparation of the
canonical active cart belonging to the current Customer. A guest capability,
path identifier, body field, browser snapshot or idempotency key cannot create
Customer authority. The initial still-unverified Customer session retains only
the purchase allowance already accepted in Phase 14; Phase 17 does not invent a
new guest exception or a new email-verification requirement.

### 4.2 Brazilian individual customer

The M1 buyer in this phase is a natural person with a Brazilian delivery
address and CPF. Country is fixed to `BR`; CNPJ, company checkout, state-tax
identity, international address and multi-currency behavior are outside this
phase. The account email is server-derived and read-only in checkout identity.
Recipient/address data does not replace account identity.

### 4.3 Checkout privacy

Checkout privacy means collecting only the data required for the accepted M1
purpose, storing sensitive data in an explicit protected lifecycle, exposing
only allowlisted projections and preventing raw CPF from reaching unrelated
storage, provider, analytics, observability, error, example or response sinks.
Masking a response alone is not proof of privacy.

### 4.4 Customer/cart relationship

The eligible cart is the canonical cart bound to the authenticated Customer.
Ambiguous or conflicting authority fails closed. A session expiration or
revocation blocks new client actions but does not delete server-side cart or
checkout state. Resume after reauthentication must reload and revalidate the
current canonical state rather than trust a browser snapshot.

### 4.5 Checkout preparation and address data

Checkout preparation has two distinct semantics:

- a partial draft accepts and persists only fields that are present and valid;
- final validation evaluates the complete checkout atomically, returns the
  complete stable error set on failure and applies no partial success.

The individual BR delivery contract includes first name, last name, account
email, phone, CPF, CEP, street, number or `S/N`, neighborhood, city, UF, fixed
country `BR` and optional complement. CEP lookup may be a future BFF convenience;
it is not backend proof that the final address is valid or deliverable.

### 4.6 Identity and privacy boundaries

The trusted request boundary remains:

```text
Browser → future same-origin Next.js BFF → Medusa backend
```

The browser never receives BFF service authority and does not call protected
Medusa M1 operations directly. Customer authentication and BFF service
authorization are distinct checks. Sensitive input may exist transiently only
long enough to validate and protect it; downstream public and operational
projections are allowlisted.

## 5. Explicit In-Scope

Phase 17 owns the future definition and implementation, under later separately
authorized gates, of:

- authentication and Customer ownership before checkout draft and validation;
- the protected BFF-only checkout-details surface and its fail-closed guards;
- canonical Customer cart selection and resume/revalidation behavior;
- partial valid draft versus atomic final validation semantics;
- the structured individual Brazilian address contract;
- CPF-only validation, protected persistence, masking and lifecycle;
- data-model review and constraints for sensitive checkout data and the
  necessary encrypted Order snapshot;
- abandoned-cart CPF purge after seven days, with financial-finality safety;
- purpose-specific, versioned consent receipts tied to Customer and cart;
- stable, sanitized field errors and error precedence;
- derived `checkout_data_complete` and rejection of a final zero total;
- optimistic concurrency, idempotency and replay behavior for Phase 17
  mutations without persisting raw sensitive input;
- negative privacy proof across named storage, response, provider, analytics,
  observability and logging sinks;
- preservation of pending-review and unresolved-financial-freeze blocks.

Context capture is the only action authorized by this gate. The list above does
not itself authorize implementation.

## 6. Explicit Out-of-Scope and Deferrals

| Classification | Deferred concern | Boundary |
|---|---|---|
| OUTSIDE PHASE 17 / DEFERRED TO PHASE 18 | Real Gelato shipping quote and selection; provider calls; quote TTL; provider-failure semantics; shipping-method dispatch | Phase 17 may define validated address/readiness as an input only. |
| OUTSIDE PHASE 17 / DEFERRED TO PHASE 19 | PaymentAttempt M1 hardening; removal of guest/Pix from the new M1 contract; payment status, retry and client-secret behavior | Phase 17 preserves the prerequisite that payment cannot start before valid authenticated checkout. |
| OUTSIDE PHASE 17 / DEFERRED TO PHASE 20 | Async payment confirmation, polling, confirmation tokens/sessions, refresh, multi-tab and late-success recovery UX | FIN-01..FIN-04 remain binding inputs, not Phase 17 deliverables. |
| OUTSIDE PHASE 17 / DEFERRED TO PHASE 21 | Order confirmation/reference/summary and catalog handoff/revalidation | Phase 17 defines only the necessary protected-data boundary consumed by canonical Order birth. |
| OUTSIDE PHASE 17 / DEFERRED TO PHASE 22 | Final OpenAPI/types/Zod/fixtures/mocks kit, cross-phase contract verification, provider/release verification and go-live authorization | Phase 17 must keep its own registry evidence current when later implementation is authorized, but does not deliver the final kit now. |
| OUTSIDE PHASE 17 | Frontend/Next.js implementation | Frontend remains blocked. |
| OUTSIDE PHASE 17 | Deploy, production operations, remote PostgreSQL/Redis, real providers, push, PR and merge | Not authorized by this gate. |

Additional exclusions:

- no synchronous Order from browser, BFF, Store checkout, cart mutation,
  checkout validation or payment-start;
- no native Store route reopening for cart completion, PaymentCollection,
  PaymentSession, saved-address CRUD, generic regions or shipping options;
- no CNPJ/company checkout, international checkout or non-BRL currency;
- no legal conclusion inferred from product prose;
- no final table, column, module, algorithm, job, transaction boundary or key
  provider selected during CONTEXT.

## 7. Existing Authorities and Invariants

### 7.1 Order birth

Order birth remains exclusive to the trusted canonical Stripe
`payment_intent.succeeded` flow. `CheckoutCompletionLog` remains the
project-owned authority for exactly-one Order birth and recovery. The Medusa
`order_cart` link is not an independent Order-birth authority.

```text
Browser:             0 synchronous Orders
BFF:                 0 synchronous Orders
Store checkout:      0 synchronous Orders
Cart mutations:      0 Orders
Checkout validation: 0 Orders
Payment-start:       0 Orders
```

### 7.2 Financial authority

- **FIN-01 — PRE-PROVIDER AUTHORITY: PRESERVED.** No provider dispatch may
  begin from unvalidated, stale or concurrently mutating local state.
- **FIN-02 — CANONICAL MONEY SNAPSHOT: PRESERVED.** Authoritative BRL totals
  remain consistent across cart, payment and Order boundaries.
- **FIN-03 — FINANCIAL FINALITY: PRESERVED.** Unresolved financial risk freezes
  structural cart changes; local timeout, failure or expiry cannot invent thaw.
- **FIN-04 — POST-ORDER RECOVERY: PRESERVED.** Canonical webhook success yields
  exactly one recoverable Order or durable reconciliation, never silent loss.

Phase 17 consumes these contracts without redesigning them. Address and consent
changes are structural for freeze purposes.

### 7.3 Browser, BFF and Store surface

- protected Frontend M1 operations remain BFF-only;
- the BFF credential is scoped by exact operation and remains distinct from the
  Customer credential;
- browser-direct Medusa remains forbidden;
- native bypass routes remain `DENY` or outside the Frontend M1 exact set;
- the TypeScript registry under `apps/backend/src/api-docs/` remains the HTTP
  contract authority; generated OpenAPI JSON is never hand-edited;
- public errors and examples contain no secrets, capabilities, tokens, provider
  identifiers or sensitive PII.

### 7.4 Customer, cart, review and concurrency

- `CustomerCartAuthority` and server-authenticated identity determine the cart;
- multiple or inconsistent authority rows fail closed;
- PostgreSQL is the authority for version, ownership, locks, uniqueness and
  atomicity; Redis is coordination only;
- `ETag`/`If-Match` guard lost updates and remain separate from review identity;
- pending `CartReview` blocks checkout until a valid idempotent/versioned ACK;
- idempotency never replaces authentication, ownership, CAS, transaction locks
  or domain constraints.

### 7.5 Privacy and observability

- no secrets, tokens, Authorization values, cookies or raw payment credentials
  in logs;
- no unnecessary PII in logs, Sentry, analytics or public errors;
- production logging remains structured and allowlisted;
- Sentry must not receive prohibited PII;
- raw CPF is forbidden in Stripe, Gelato, PostHog, Sentry, logs, public examples
  and unauthorized responses;
- any full-document access that future research proves necessary must be
  explicit, least-privilege and auditable.

### 7.6 Medusa v2 module isolation

No sibling-module service or raw sibling database access becomes an authority
path. Cross-domain work uses accepted workflows, Module Links, Query graph and
explicit domain authorities. Phase 17 may require new authorities later, but
CONTEXT does not choose their implementation.

## 8. Repository Archaeology: Proven Primitives and Known Gaps

This section separates repository fact from future design. A present primitive
is not automatically evidence that the Phase 17 requirement is satisfied.

### 8.1 Proven existing primitives

- `apps/backend/src/modules/checkout/checkout-data.ts` validates CEP/UF and
  document checksum, masks document output and derives checkout completeness.
- `apps/backend/src/api/store/carts/customer-active-cart.ts` and the cart-merge
  authority implement canonical Customer-cart resolution and ambiguity failure.
- `StoreResourceVersion` supplies transactional version/CAS behavior and public
  stale-state handling.
- `CartReview` is a PostgreSQL checkout block rather than client metadata.
- PaymentAttempt financial authority preserves unresolved freeze until
  provider-authoritative cancellation or Order birth.
- PaymentCollection/PaymentSession creation remains internal while native
  bypass routes remain denied.
- the canonical Stripe request projection contains amount/currency/method and
  technical identifiers, not CPF, address, email or phone;
- Store errors and access logs already use closed projections;
- the cart serializer already exposes a masked document rather than the raw
  value.

### 8.2 Known gaps; not implementation decisions

- raw CPF/CNPJ is still stored in
  `shipping_address.metadata.federal_tax_id`;
- the legacy input accepts CPF or CNPJ plus company/state-tax semantics and does
  not model all individual BR address fields required here;
- Phase 17 checkout-details routes, manifest entries, BFF exact-set entries,
  middleware contracts and OpenAPI operations do not yet exist;
- no protected CPF authority, `ConsentReceipt` authority or abandoned-cart CPF
  purge job exists;
- current completeness logic admits guest state and does not yet incorporate
  all consent, review, freeze and positive-total prerequisites;
- final zero total is blocked later in payment eligibility, not yet at Phase 17
  final validation;
- current Card/Pix routes admit guest lineage; broad payment hardening remains
  Phase 19;
- billing-address semantics are not authoritatively decided;
- field-error allowlists do not yet cover the complete Phase 17 field set;
- the existing PaymentAttempt fingerprint retains some email/address-derived
  information and needs a privacy assessment;
- the current Gelato dispatch reads and sends raw
  `shipping_address.metadata.federal_tax_id`, which conflicts with the required
  no-CPF-to-Gelato boundary;
- existing observability sanitizers and canaries do not yet prove removal of
  both formatted and unformatted CPF in arbitrary message/stack/key aliases;
- `docs/DB_MODEL_v1.21.md` and `docs/DB_MODEL_v1.22.md` do not yet materialize
  the Phase 17 protected-document and consent authorities.

These gaps must shape a future authorized RESEARCH gate. They do not authorize
repair during CONTEXT and they are not proof that accepted earlier phase
closures were invalid.

## 9. Decisions Already Made

The following decisions are supported by accepted repository authority. They
lock product and architecture boundaries for later research and planning, but
do not select unproven implementation details.

### Identity, ownership and trust boundary

- **D17-01 — Authenticated individual M1 checkout.** Checkout draft, final
  validation, shipping and payment require an authenticated Customer. Guest
  checkout, CNPJ and company checkout are outside the M1 contract. The initial
  unverified-session allowance from Phase 14 is preserved without creating a
  new guest or verification exception.
- **D17-02 — Server-authoritative identity and cart.** Customer identity and
  email come from authenticated server context. The only eligible cart is the
  canonical cart bound to that Customer; recipient/address data, body fields,
  path IDs and browser state cannot override identity or ownership.
- **D17-03 — BFF-only protected surface.** The trust path remains Browser →
  same-origin BFF → Medusa. Browser-direct Medusa is forbidden; BFF service
  authority and Customer authentication are separate mandatory checks.
- **D17-04 — Resume preserves state, not expired authority.** Session expiry or
  revocation preserves server-side cart/checkout state but blocks new actions.
  Reauthentication reloads and revalidates canonical state rather than trusting
  a browser snapshot.

### Checkout behavior

- **D17-05 — Existing authorities remain preconditions.** Canonical ownership,
  current cart version, acknowledged review and absence of incompatible
  unresolved financial freeze are mandatory before a Phase 17 mutation or
  successful final validation.
- **D17-06 — Draft and final validation are distinct.** Draft persists only
  supplied, individually valid fields and never persists invalid CPF. Final
  validation is atomic, returns the complete stable error set and writes no
  partial successful subset on failure.
- **D17-07 — Structured individual BR address.** The delivery contract contains
  first name, last name, read-only account email, phone, CPF, CEP, street,
  number or `S/N`, neighborhood, city, UF, fixed country `BR` and optional
  complement. CEP lookup is a BFF aid, not backend address authority.
- **D17-08 — Derived readiness and positive final total.**
  `checkout_data_complete` is derived from canonical state and never accepted as
  client authority. Stable sanitized `fieldErrors` describe invalid state, and
  final total zero is unsupported; free shipping alone is allowed.

### CPF, consent and privacy

- **D17-09 — CPF-only server validation.** M1 accepts CPF only and validates
  normalized digits/checksum server-side. CNPJ remains outside scope.
- **D17-10 — Protected CPF lifecycle.** Raw CPF leaves
  `shipping_address.metadata`; protected storage uses AES-256-GCM or an
  equivalent approved authenticated mechanism, external key authority and
  `key_version`. Store output is masked. Abandoned-cart CPF is purged after
  seven days, while only the necessary encrypted snapshot is preserved for a
  canonically born Order.
- **D17-11 — Purpose-specific consent receipts.** Terms of Purchase, Exchange
  Policy and awareness of the Privacy Policy are distinct purposes. Receipts
  bind purpose, document version, timestamp, Customer, cart and correlation
  identity. User agent is not persisted; optional purposes cannot be bundled
  with required ones.
- **D17-12 — Negative PII boundary.** Raw CPF must be absent from Stripe,
  Gelato, PostHog, Sentry, logs, events, idempotency artifacts, errors, OpenAPI
  examples and unauthorized responses. Public errors do not echo the submitted
  value. Masked output is allowlisted rather than inferred from object spread.

### Concurrency, financial safety and architecture

- **D17-13 — Concurrency and replay remain authority-safe.** Phase 17 mutations
  use current version/`If-Match`, transactional authority and operation-scoped
  idempotency. Replay cannot persist raw CPF or bypass Customer ownership,
  review, financial freeze, CAS or domain constraints.
- **D17-14 — No new Order or financial authority.** Successful Phase 17
  validation prepares state only. Order birth remains exclusively canonical
  Stripe webhook + CheckoutCompletionLog, and FIN-01..FIN-04 remain unchanged.
- **D17-15 — Module and contract authorities remain closed.** Medusa v2 module
  isolation, PostgreSQL correctness authority, closed Store manifest, BFF
  exact-set and TypeScript OpenAPI registry continue to govern any later
  implementation.
- **D17-16 — Linear future-phase boundary.** Real shipping belongs to Phase 18,
  PaymentAttempt hardening to Phase 19, async confirmation to Phase 20,
  Order/catalog handoff to Phase 21 and final contract/release kit to Phase 22.
  Frontend, deploy and real providers remain unauthorized.

## 10. Open Questions for RESEARCH

Every item below is unresolved. It must not be answered from external knowledge
until a separate human authorization opens Phase 17 RESEARCH.

### R17-Q01 — Sensitive-checkout data model and constraints

- **Question:** Which explicit entities/fields, links, cardinalities,
  constraints and lifecycle states materialize protected CPF, consent receipts
  and the necessary encrypted Order snapshot?
- **Why it matters:** the requirement cites prior review of
  `DB_MODEL_v1.21.md`, while the current v1.21/v1.22 documents do not materialize
  those authorities.
- **Missing evidence:** reconciled model decision, collision/cardinality rules,
  Cart→Order boundary and migration candidates.
- **Owner:** future Phase 17 RESEARCH, followed by human review before PLAN.

### R17-Q02 — Cryptography, key authority and rotation

- **Question:** What approved authenticated-encryption envelope, nonce/tag
  handling, external key provider, `key_version`, rotation/re-encryption and
  fail-closed corruption/unavailability behavior will be used?
- **Why it matters:** AES-256-GCM or equivalent defines a floor, not the
  operational contract.
- **Missing evidence:** technical threat model, provider-independent interface,
  rotation proof and failure semantics.
- **Owner:** future Phase 17 security RESEARCH.

### R17-Q03 — Seven-day abandonment and purge semantics

- **Question:** Which authoritative event starts or resets abandonment, which
  states suspend purge, and how does purge race safely with validation,
  financial freeze, late success and Order birth?
- **Why it matters:** early deletion can break a legitimate financially live
  flow; late deletion violates minimization.
- **Missing evidence:** abandonment state machine, clock/grace rules, locking,
  retry/idempotency and sanitized audit model.
- **Owner:** future Phase 17 RESEARCH, constrained by FIN-03/FIN-04.

### R17-Q04 — Protected snapshot handoff at canonical Order birth

- **Question:** How are the necessary encrypted CPF snapshot and consent
  evidence preserved during exactly-one webhook-driven Order birth and crash
  recovery?
- **Why it matters:** the handoff must survive retry without becoming a second
  Order authority or weakening CheckoutCompletionLog.
- **Missing evidence:** transaction/recovery contract and data-minimization
  proof across the Cart→Order boundary.
- **Owner:** future Phase 17 RESEARCH with explicit FIN-04 compatibility review.

### R17-Q05 — Existing Gelato CPF conflict

- **Question:** Which compatible adaptation removes the current
  `federalTaxId` dispatch while preserving the already binding D17-12/CHK-08
  no-CPF-to-Gelato rule and the accepted fulfillment invariant?
- **Why it matters:** current Gelato dispatch reads raw CPF from address metadata,
  while the Phase 17 privacy boundary forbids CPF reaching Gelato.
- **Missing evidence:** authorized compatibility research and local dispatch
  proof demonstrating that fulfillment works without transmitting CPF.
- **Owner:** future Phase 17 RESEARCH, strictly subordinate to D17-12/CHK-08.
  If no compatible no-CPF contract can be proven, Phase 17 closure is blocked;
  that result never authorizes CPF transmission and cannot defer the privacy
  obligation to Phase 18. Phase 18 may consume only a compatible contract.

### R17-Q06 — Billing-address product rule

- **Question:** Does M1 exclude a distinct billing address, derive it from
  shipping, or support an independently supplied address?
- **Why it matters:** the runtime relation exists, but no accepted product rule
  authorizes duplicated PII or defines equivalence.
- **Missing evidence:** explicit product decision and payment-contract need.
- **Owner:** future Phase 17 product/contract RESEARCH and human decision.

### R17-Q07 — Stable error taxonomy and precedence

- **Question:** Which exact public codes, field keys, ordering and mask rules
  cover missing/invalid CPF, BR address fields, consent, ownership, stale
  version, review, freeze and cryptographic failure?
- **Why it matters:** legacy runtime and prospective documents use overlapping
  but non-identical names; unstable errors would corrupt the later BFF contract.
- **Missing evidence:** closed TypeScript/OpenAPI schema, precedence matrix and
  negative no-echo proof.
- **Owner:** future Phase 17 contract RESEARCH.

### R17-Q08 — Consent/legal meaning, IP, access and retention

- **Question:** Which document versions and acceptance semantics are approved,
  whether IP is necessary, who may access/decrypt CPF and which retention rules
  are legally justified?
- **Why it matters:** repository prose contains proposals, not authoritative
  Brazilian legal conclusions.
- **Missing evidence:** authorized legal/human review and approved access,
  retention and deletion policy.
- **Owner:** future Phase 17 RESEARCH for the data contract and Phase 22 human
  go-live gate. External legal facts are **RESEARCH REQUIRED**.

### R17-Q09 — Sensitive idempotency fingerprint

- **Question:** How can replay distinguish semantically different CPF inputs
  without persisting raw CPF, randomized ciphertext or a reversible derivative?
- **Why it matters:** omitting CPF permits incompatible replay; retaining it
  violates the privacy boundary.
- **Missing evidence:** approved keyed derivation/pepper and rotation approach,
  versioning, lifecycle and collision/replay proof.
- **Owner:** future Phase 17 security/idempotency RESEARCH.

### R17-Q10 — Exact resume contract

- **Question:** Which operation returns persisted draft, how does
  reauthentication reconcile a changed canonical cart, and which data is
  revalidated after session expiry?
- **Why it matters:** state preservation is decided, but response shape and
  ambiguity/replacement behavior are not.
- **Missing evidence:** route/schema inventory and auth/cart/review/freeze
  matrix. Async confirmation/multi-tab behavior remains Phase 20.
- **Owner:** future Phase 17 contract RESEARCH.

### R17-Q11 — Closed Store/BFF surface integration

- **Question:** How do the Phase 17 operations enter the Store manifest, BFF
  exact-set, middleware and OpenAPI registry without reopening native update,
  complete or payment bypasses?
- **Why it matters:** the current closed allowlists do not yet contain the new
  checkout-details operations.
- **Missing evidence:** installed-surface archaeology, exact operation inventory
  and negative route matrix.
- **Owner:** future Phase 17 RESEARCH/PLAN.

### R17-Q12 — Address mapping, normalization and CEP seam

- **Question:** How are number, `S/N`, neighborhood and complement mapped to
  Medusa address storage; what normalization is canonical; and what is the exact
  non-authoritative BFF CEP contract?
- **Why it matters:** the existing address shape does not retain all required
  domain fields unambiguously.
- **Missing evidence:** mapping comparison, serializer contract, normalization
  and field-level error behavior.
- **Owner:** future Phase 17 contract/data RESEARCH. External CEP provider work
  remains outside the backend implementation.

### R17-Q13 — Collateral PII and negative-proof matrix

- **Question:** Which existing fingerprints, metadata, messages, stack traces,
  provider payloads and telemetry paths retain address/email/document-derived
  data, and what exact local proof closes every named sink?
- **Why it matters:** key-name filtering and masked public output do not prove
  absence of formatted or unformatted CPF under aliases or arbitrary strings.
- **Missing evidence:** complete data-flow inventory, allowlists and negative
  canaries for storage, Stripe, Gelato, PostHog, Sentry, logs, events, errors,
  idempotency artifacts, OpenAPI examples and unauthorized responses.
- **Owner:** future Phase 17 privacy/security RESEARCH; final cross-phase release
  proof remains Phase 22.

## 11. Requirement Coverage

The active repository contains exactly ten Phase 17 requirements. Each appears
exactly once in this coverage matrix.

| Requirement | Exact current wording | Context coverage | Decisions / open questions | Status |
|---|---|---|---|---|
| CHK-01 | Exigir `Customer` autenticado antes de draft, validação, frete e pagamento do Frontend M1. | Authenticated individual scope, server identity, canonical cart and BFF-only boundary. | D17-01..D17-05; R17-Q10..R17-Q11 | COVERED BY CONTEXT |
| CHK-02 | Separar atualização parcial válida do draft e validação final atômica. | Distinct draft/final semantics, no invalid CPF persistence and no partial final-write success. | D17-06; R17-Q07, R17-Q09 | COVERED BY CONTEXT |
| CHK-03 | Modelar endereço de pessoa física no Brasil com campos, UF, CEP e erros por campo estáveis. | Structured BR individual address and sanitized stable field-error contract. | D17-07; R17-Q07, R17-Q12 | COVERED BY CONTEXT |
| CHK-04 | Aceitar somente CPF no M1 e validar dígitos/checksum server-side; CNPJ permanece fora de escopo. | CPF-only boundary, server validation and explicit company/CNPJ exclusion. | D17-01, D17-09 | COVERED BY CONTEXT |
| CHK-05 | Remover CPF cru de `shipping_address.metadata` e proteger o valor com AES-256-GCM ou mecanismo equivalente, chave externa e `key_version`. | Protected CPF lifecycle and explicit legacy-path gap. | D17-10; R17-Q01..R17-Q02 | COVERED BY CONTEXT |
| CHK-06 | Materializar dados sensíveis de checkout/order e constraints conforme revisão prévia do `DB_MODEL_v1.21.md`. | Binding model reference, module/DB authority and unresolved materialization boundary. | D17-10, D17-15; R17-Q01, R17-Q04 | COVERED BY CONTEXT |
| CHK-07 | Purgar CPF de carrinho abandonado após 7 dias e preservar somente o snapshot criptografado necessário no `Order`. | Seven-day minimization rule, canonical Order handoff and financial-race constraints. | D17-10, D17-14; R17-Q03..R17-Q04, R17-Q08 | COVERED BY CONTEXT |
| CHK-08 | Retornar CPF somente mascarado e provar ausência em Stripe, Gelato, PostHog, Sentry, logs e respostas não autorizadas. | Negative PII boundary, named sinks and current Gelato/observability gaps. | D17-12; R17-Q05, R17-Q13 | COVERED BY CONTEXT |
| CHK-09 | Persistir recibos de consentimento por finalidade com versão, timestamp, Customer/cart e sem user agent. | Separate purpose/version receipts with minimized identity and no user agent. | D17-11; R17-Q01, R17-Q08 | COVERED BY CONTEXT |
| CHK-10 | Retornar `checkout_data_complete` derivado, `fieldErrors` estáveis e bloquear total final zero. | Server-derived readiness, stable sanitized errors and positive final total. | D17-08; R17-Q07 | COVERED BY CONTEXT |

No requirement is complete merely because it is covered here. Completion and
counter changes require later authorized implementation, proof and human gates.

## 12. Threat and Privacy Considerations

| Concern | Context constraint | Evidence still required later |
|---|---|---|
| Identity confusion / IDOR | Authenticated server identity plus canonical Customer-cart authority; body/recipient cannot select Customer. | Negative cross-customer and ambiguous-authority matrices. |
| Guest capability escalation | Guest capability authorizes no Phase 17 checkout operation. | Manifest/middleware/BFF exact-set negative proof. |
| Browser/direct-route bypass | BFF-only; native update/complete/payment routes remain closed. | Installed-surface and route-enumeration proof. |
| Address leakage | Address returned only to the authorized actor through allowlisted DTOs. | Cross-customer, unauthenticated, error and cache proofs. |
| Logging leakage | Structured allowlist; no request body, auth/cookie/token or raw CPF. | Formatted/unformatted/aliased CPF canaries in logs. |
| Telemetry leakage | Sentry/PostHog/events receive no raw CPF or unnecessary address data. | Message/stack/breadcrumb/context/outbox negative canaries. |
| Error leakage | Stable public code and field key; no echoed submitted value or internal cause. | Error precedence and serialization tests. |
| Replay/idempotency | Operation/Customer/cart intent is bound without retaining raw sensitive input. | Safe fingerprint design and incompatible-reuse proof. |
| Concurrency/lost update | PostgreSQL transaction and current `If-Match`/version remain authoritative. | Race proof for draft/final/purge/Order handoff. |
| Review-state bypass | Pending review blocks checkout until valid ACK. | Draft/final negative proof under pending/stale review. |
| Financial-freeze bypass | Unresolved freeze blocks address, consent and structural checkout changes. | Card/Pix/failure/late-success truth table, preserving FIN-03. |
| Partial persistence | Invalid CPF is never persisted; failed final validation writes no subset. | Transactional persistence and rollback proof. |
| Cryptographic failure | Unknown key version, invalid tag, corruption or unavailable authority fails closed. | Authorized crypto/KMS research and failure tests. |
| Purge versus late success | Purge cannot destroy data needed by financially live canonical success or retain it indefinitely. | Time/race/recovery model and disposable PostgreSQL proof. |
| Session expiry/resume | Server state survives; authority does not. Reauthentication reloads canonical state. | Revoked/expired/replaced-cart matrix. |
| Overcollection | Billing duplication, IP, user agent and provider-required PII are not assumed necessary. | Product/legal/provider evidence under authorized RESEARCH. |
| Module boundary violation | No raw sibling database/service coupling becomes an authority path. | Plan-time architecture check and integration proof. |

## 13. Canonical References

Downstream agents must read these local authorities before future authorized
research, planning or implementation.

### Project, milestone and governance

- `.planning/PROJECT.md` — core value, milestone boundary and precedence.
- `.planning/STATE.md` — current accepted state, counters and governance.
- `.planning/ROADMAP.md` — Phase 17 goal and Phase 18–22 boundaries.
- `.planning/REQUIREMENTS.md` — exact active requirement set.
- `.planning/phases/16-cart-merge-review/16-CLOSURE.md` — direct dependency
  closure.
- `.planning/phases/16-cart-merge-review/16-PR28-REMEDIATION.md` — accepted
  financial-finality contracts.

### Accepted prior decisions

- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md`
  — Store/BFF, idempotency, errors, OpenAPI and zero-synchronous-Order rules.
- `.planning/phases/14-customer-auth-verification/14-CONTEXT.md` — Customer
  session, verification lineage and auth behavior.
- `.planning/phases/15-guest-cart-capability-concurrency/15-CONTEXT.md` — guest
  boundary, versioning, canonical active cart and payment interaction.
- `.planning/phases/16-cart-merge-review/16-CONTEXT.md` — merge, review ACK,
  cart authority and future-phase deferrals.

### Product, data and future-consumer contracts

- `docs/PRD_Backend_v1.1.md` — checkout, CPF, consent, privacy, errors and
  concurrency intent.
- `docs/PRD_frontend_v1.1.md` — future BFF/frontend consumer behavior; not
  frontend implementation authority for this gate.
- `docs/SRS_v1.5.md` — normative requirement background, subject to later
  accepted precedence.
- `docs/DB_MODEL_v1.21.md` — explicit data-model reference from the active
  persistence requirement.
- `docs/DB_MODEL_v1.22.md` — later as-built comparison input; does not silently
  override the v1.21 reference or Phase 17 requirements.
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — named prospective operations,
  schemas and error traceability.

### Existing runtime seams to inspect in future gates

- `apps/backend/src/modules/checkout/checkout-data.ts`
- `apps/backend/src/api/store/carts/serializers.ts`
- `apps/backend/src/api/store/carts/customer-active-cart.ts`
- `apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts`
- `apps/backend/src/modules/cart-merge/models/cart-review.ts`
- `apps/backend/src/modules/cart-merge/review-guard.ts`
- `apps/backend/src/modules/store-resource-version/service.ts`
- `apps/backend/src/modules/payment-attempt/financial-authority.ts`
- `apps/backend/src/modules/payment-attempt/provider-request-authority.ts`
- `apps/backend/src/modules/checkout-completion/models/checkout-completion-log.ts`
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/modules/gelato-fulfillment/service.ts`
- `apps/backend/src/observability/sanitize.ts`
- `apps/backend/src/observability/logger.ts`
- `apps/backend/src/observability/sentry-scrub.ts`
- `apps/backend/src/modules/analytics-event-log/service.ts`
- `apps/backend/src/modules/store-idempotency/service.ts`
- `apps/backend/src/api/store/carts/bff-protected-operations.ts`
- `apps/backend/src/api/store-surface/manifest.ts`
- `apps/backend/src/api/store-surface/errors.ts`
- `apps/backend/src/api/middlewares.ts`
- `apps/backend/src/api-docs/registry.ts`

## 14. Exit Criteria for CONTEXT

The Phase 17 CONTEXT gate may be recommended for human approval only when:

- all ten Phase 17 requirements are mapped exactly once;
- the authenticated individual BR checkout and privacy scope is explicit;
- accepted FND/AUTH/CART/MRG and FIN-01..FIN-04 constraints are preserved;
- existing primitives are separated from known gaps and future design;
- decisions already supported by repository authority are captured;
- unanswered product, data, crypto, legal, provider and proof questions are
  explicit and owned by a future gate;
- Phase 18–22 work is explicitly deferred rather than pulled forward;
- frontend, provider, remote-infrastructure, deploy and push authorization is
  absent;
- no P0, P1 or material P2 CONTEXT defect remains after adversarial review;
- milestone counters and requirement completion states remain unchanged;
- human review remains the only next permitted action.

## 15. Governance

```text
Phase 17 CONTEXT:
TECHNICAL DRAFT — HUMAN REVIEW REQUIRED

Phase 17 RESEARCH:
NOT AUTHORIZED

Phase 17 PLAN:
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Push:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Real providers:
NOT AUTHORIZED

Remote infrastructure:
NOT AUTHORIZED

Frontend:
BLOCKED
```
