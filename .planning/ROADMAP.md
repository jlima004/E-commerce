# Roadmap: E-commerce POD de Camisetas — Backend MVP

## Overview

This roadmap delivered a headless Medusa v2 POD backend for Brazil/BRL around one non-negotiable spine: **an Order is born only from the canonical, signature-verified, idempotent Stripe webhook, and Gelato production fires only after a confirmed Order plus a durable local `purchase_completed` record.**

Milestone v1.0 completed the backend MVP through production release readiness. The detailed roadmap at the time of close is preserved in [the v1.0 archive](milestones/v1.0-ROADMAP.md).

## Milestones

| Milestone | Status | Closed / archived | Phases | Plans | Requirements |
|---|---|---|---:|---:|---:|
| v1.0 Backend MVP | COMPLETE / CLOSED / ARCHIVED | 2026-07-30 | 13/13 | 62/62 | 45/45 |

MILESTONE v1.0 CLOSEOUT / ARCHIVE: PASS

## Archived Phases

<details>
<summary>v1.0 — 13 complete and closed phases</summary>

| Phase | Plans | Final state |
|---|---:|---|
| 01. Foundation & Observability | 7/7 | Complete / Closed |
| 02. Catalog & Media | 5/5 | Complete / Closed |
| 03. Cart & Checkout (pre-Order) | 5/5 | Complete / Closed |
| 04. Stripe Payments & PaymentAttempt | 6/6 | Complete / Closed |
| 05. Stripe Webhook Ingestion & Idempotency | 4/4 | Complete / Closed |
| 06. Idempotent Webhook-Driven Order Creation | 5/5 | Complete / Closed |
| 07. Analytics Outbox (`purchase_completed`) | 3/3 | Complete / Closed |
| 08. Transactional Email (Resend) | 3/3 | Complete / Closed |
| 09. Gelato Fulfillment & Webhook | 5/5 | Complete / Closed |
| 10. Secure Guest Tracking | 3/3 | Complete / Closed |
| 11. Refunds & Exchanges (Admin) | 4/4 | Complete / Closed |
| 12. Ops, Audit & Critical Tests | 6/6 | Complete / Closed |
| 12.1. Backend MVP Release Readiness & Production Validation | 6/6 | Complete / Closed — INSERTED |

Gate 04A remains preserved as a historical gate and is not counted as a milestone phase.

</details>

## Archive

- [v1.0 roadmap snapshot](milestones/v1.0-ROADMAP.md)
- [v1.0 requirements snapshot](milestones/v1.0-REQUIREMENTS.md)
- [v1.0 milestone audit](milestones/v1.0-MILESTONE-AUDIT.md)
- [Milestone registry](MILESTONES.md)

The original phase directories remain in place as historical documentation.

## Release Identity

- Repository closure: PR 8.
- PR 8 head: `7eaa223e82c819271682f0ea58ca50f66bfdbe8d`.
- PR 8 merge commit / archive documentation base: `7c991bf422b3f1ca4ff202cad7e860db5a78ede8`.
- Deployed release: Heroku `v78`.
- Candidate/deployed runtime SHA: `18d809e4169daa301839542191f0d6794b02d695`.
- Rollback target: `v77`, documented and eligible; rollback not executed.

The repository archive identity is distinct from the runtime deployed SHA.

## Planned Tag

Tag `v1.0` is planned for the future merge commit of the archive documentation in `main`. It was not created in this gate and must not point to the runtime deployed SHA. Creation and push require separate authorization after merge.

## Next Milestone

The next milestone is not defined or started. Phase 13 and the frontend are not started and are not authorized.

---
*Roadmap compacted at Milestone v1.0 archive: 2026-07-30 · 13/13 phases · 62/62 plans · 45/45 requirements*
