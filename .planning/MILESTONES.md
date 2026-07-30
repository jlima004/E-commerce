# Project Milestones: E-commerce POD de Camisetas — Backend MVP

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
- Initial archive documentation commit: `f9c9ea1aec8bf97d91960bbdb7d07072d82e3bf1`.
- Archive pull request: PR #9, open and awaiting human review and merge.
- Final repository archive identity: the future PR #9 merge commit in `main`.
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

### Planned tag

- Planned tag: `v1.0`.
- Target: the future PR #9 merge commit in `main`.
- The tag must not point to `f9c9ea1aec8bf97d91960bbdb7d07072d82e3bf1` or `18d809e4169daa301839542191f0d6794b02d695`.
- Tag creation and push require separate authorization after the archive merge.
- Tag created in this gate: false.

### Archive

- [Roadmap snapshot](milestones/v1.0-ROADMAP.md)
- [Requirements snapshot](milestones/v1.0-REQUIREMENTS.md)
- [Milestone audit](milestones/v1.0-MILESTONE-AUDIT.md)

### What is next

The next milestone is not defined or started. Phase 13 and the frontend are not started and are not authorized.
