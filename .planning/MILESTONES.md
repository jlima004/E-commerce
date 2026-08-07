# Project Milestones: E-commerce POD de Camisetas — Backend MVP

## v1.1 Backend Storefront Readiness (Opened: 2026-08-06)

**Status:** open — manual-review gated
**Scope:** backend-only readiness for Frontend Milestone 1

### Objective

Deixar o backend completamente preparado para o início do Frontend Milestone 1, eliminando dependências backend ainda abertas e entregando Store API, contratos, persistência, segurança, testes e artefatos de handoff suficientes para que o frontend possa começar sem inventar endpoints, regras ou schemas.

### Planned delivery

- Phases: 13–22, strictly linear.
- Requirements: 91 open; 0 complete.
- FE traceability: 54/54 requirements have an explicit backend, BFF/external or legal responsibility.
- First phase: Phase 13 — Storefront Contract Foundation & Surface Lockdown.
- Current gate: Phase 13 CONTEXT not started; explicit human authorization required.
- Frontend Milestone 1: blocked, not started and not authorized.

### Definition of Done

The milestone closes only after the full gate matrix in `.planning/ROADMAP.md` passes, including Store OpenAPI `1.1.0`, Webhooks OpenAPI, auth, guest capability, cart/merge/ETag, BR checkout/CPF/consent, Gelato quote/select, PaymentAttempt, async confirmation, secure Order summary, catalog revalidation, types/Zod, fixtures/mocks, contract/backend tests, migrations/constraints, drift, lint, build, security negatives, controlled provider validation and authorized release validation.

Only an explicit human closeout may change the frontend state to `AUTHORIZED TO START`.

### Canonical artifacts

- [Active roadmap](ROADMAP.md)
- [Active requirements](REQUIREMENTS.md)
- [Milestone roadmap opening record](milestones/v1.1-ROADMAP.md)
- [Milestone requirements opening record](milestones/v1.1-REQUIREMENTS.md)

## v1.0 Backend MVP (Shipped: 2026-07-30)

**Status:** closed and archived
**Scope:** backend MVP through production release readiness

### Delivery

- Phases: 13/13 complete and closed.
- Plans: 62/62 complete.
- Requirements: 45/45 complete.
- Delivered foundation and observability, catalog/media, pre-Order cart and checkout, Stripe payment attempts, canonical idempotent webhooks and Order creation, durable analytics and email outboxes, Gelato fulfillment/tracking, refunds/exchanges, operational audit, critical invariant tests, and production release readiness.
- Active blockers: 0.
- Unresolved required verification: 0.
- Deferred artifacts carried into the next milestone: 0.

### Release evidence

- Heroku deployed release: `v78`.
- Candidate/deployed runtime SHA: `18d809e4169daa301839542191f0d6794b02d695`.
- Repository closure: PR 8.
- PR 8 head: `7eaa223e82c819271682f0ea58ca50f66bfdbe8d`.
- PR 8 merge commit and archive documentation base: `7c991bf422b3f1ca4ff202cad7e860db5a78ede8`.
- Archive pull request: PR #9, merged on 2026-07-30.
- PR #9 final head: `93bcc318e9d7c2309438ca33432fb6a93877a28d`.
- Final repository archive identity: `fbe986160535c1ba9d2a5f41ad9255e91cd13914`.
- PR #10 merge commit and baseline before the GitHub Release reconciliation: `de095d76a83e99faa0b459a58fc8b68200f02686`.
- Initial archive documentation commit: `f9c9ea1aec8bf97d91960bbdb7d07072d82e3bf1`.
- Runtime deployed identity: `18d809e4169daa301839542191f0d6794b02d695`.
- The repository archive identity and runtime deployed identity are distinct.

### Rollback

- Target: Heroku `v77`, documented and eligible.
- Executed: false.

### Remaining non-blocking limitations

- Sentry externally exercised: false.
- Stripe provider gate exercised: false.
- Resend real send proven: false.
- Gelato real dispatch proven: false.
- PostHog real event proven: false.
- Correios API exercised: false.
- Pix: deferred by account eligibility.
- Real rollback: not executed.

### Tag

- Tag: `v1.0`.
- Type: annotated.
- Tag object: `2e91dcdffef5dc677e7e994f07b99f5c3bc2f167`.
- Tag target: `fbe986160535c1ba9d2a5f41ad9255e91cd13914`.
- Created and pushed: true.
- The tag does not point to `f9c9ea1aec8bf97d91960bbdb7d07072d82e3bf1` or `18d809e4169daa301839542191f0d6794b02d695`.
- The tag remains immutable at the PR #9 merge commit and must not be moved to the future commit of this documentary reconciliation.

### GitHub Release

- GitHub Release: published.
- Release name: `v1.0 — Backend MVP`.
- Release tag: `v1.0`.
- Release URL: https://github.com/jlima004/E-commerce/releases/tag/v1.0
- Published at: `2026-07-30T17:08:24Z`.
- Draft: false.
- Prerelease: false.
- The GitHub Release publication did not move or recreate tag `v1.0`.
- The tag remains immutable at the PR #9 merge commit.

### Archive

- [Roadmap snapshot](milestones/v1.0-ROADMAP.md)
- [Requirements snapshot](milestones/v1.0-REQUIREMENTS.md)
- [Milestone audit](milestones/v1.0-MILESTONE-AUDIT.md)

### Historical next state at close

At the v1.0 close, the next milestone was not yet defined or started and Phase 13/frontend were not authorized. This historical state was superseded only by the documentary opening of v1.1 above; v1.0 itself remains immutable.
