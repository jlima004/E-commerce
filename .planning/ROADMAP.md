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

- PR #9: merged.
- PR #9 final head: `93bcc318e9d7c2309438ca33432fb6a93877a28d`.
- Repository archive merge commit: `fbe986160535c1ba9d2a5f41ad9255e91cd13914`.
- PR #10 merge commit and baseline before this GitHub Release reconciliation: `de095d76a83e99faa0b459a58fc8b68200f02686`.
- Deployed release: Heroku `v78`.
- Runtime deployed SHA: `18d809e4169daa301839542191f0d6794b02d695`.
- Rollback target: `v77`, documented and eligible; rollback not executed.

The repository archive identity is distinct from the runtime deployed SHA.

## GitHub Release

- Release: `v1.0 — Backend MVP`.
- Status: published.
- Tag: `v1.0`.
- Published at: `2026-07-30T17:08:24Z`.
- URL: https://github.com/jlima004/E-commerce/releases/tag/v1.0
- Draft: false.
- Prerelease: false.

## Tag

- Tag: `v1.0`.
- Tag object: `2e91dcdffef5dc677e7e994f07b99f5c3bc2f167`.
- Tag target: `fbe986160535c1ba9d2a5f41ad9255e91cd13914`.
- Tag created and pushed: true.

The annotated tag remains on the PR #9 merge commit and does not point to the runtime deployed SHA.

## Next Milestone

The next milestone is not defined or started. Phase 13 and the frontend are not started and are not authorized.

---
*Roadmap compacted at Milestone v1.0 archive: 2026-07-30 · 13/13 phases · 62/62 plans · 45/45 requirements*
