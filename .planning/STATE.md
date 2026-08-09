---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Backend Storefront Readiness
current_phase: 13
current_phase_name: storefront-contract-foundation-surface-lockdown
status: executing
stopped_at: 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW; 13-06..13-07 NOT AUTHORIZED
last_updated: "2026-08-09T17:59:30.000Z"
last_activity: 2026-08-09
last_activity_desc: 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW; FND-06 EVIDENCED — NOT COMPLETE
progress:
  total_phases: 10
  completed_phases: 0
  total_plans: 7
  completed_plans: 4
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-06)

**Core value:** An Order exists and ships to Gelato only after reliable, validated, idempotent Stripe-webhook payment confirmation — no phantom charge, no duplicate order, no improper fulfillment.
**Current focus:** Phase 13 — storefront-contract-foundation-surface-lockdown

## Execution Policy

Execution is manual-review gated.

No phase may be executed automatically. Each phase must stop after CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW, and CLOSURE for human review before continuing.

The GSD auto chain must not continue through all phases.

**Enforcement settings (config.json):**

- `mode` was changed from `yolo` to `interactive` so GSD shows gates and confirmations instead of running autonomously. (`manual`/`controlled` are not valid GSD enum values; `interactive` is the schema-valid manual-gated mode.)
- `workflow.auto_advance` remains `false`.
- `workflow._auto_chain_active` remains `false`.
- `parallelization` remains `false`.

**Current gate:** Phase 13 CONTEXT APPROVED; RESEARCH APPROVED; PLAN R5 APPROVED; SPEC/SDD R1 APPROVED; Implementation Prompt APPROVED; P13-13-01-R1 HUMAN RE-REVIEW PASS; 13-01 HUMAN APPROVED — PASS; P13-13-02-R1 technical human re-review PASS; P13-13-02-R2 human re-review PASS; 13-02 HUMAN APPROVED — PASS; P13-13-03-R1 technical human re-review PASS; P13-13-03-R2 HUMAN REVIEW PASS; 13-03 HUMAN APPROVED — PASS; 13-04 HUMAN APPROVED — PASS after P13-13-04-T3-R1 human re-review PASS; 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW. Há 7 planos e 4 human-approved executed. FND-06 is EVIDENCED — NOT COMPLETE; Phase 13 requirements covered: FND-01..FND-08 = 8/8; Phase 13 requirements complete: 0/8; Milestone requirements complete: 0/91; completed phases remain 0/10. 13-06..13-07 remain NOT AUTHORIZED. Deploy and frontend are not authorized.

```text
Phase 12 CONTEXT approved
Phase 12 RESEARCH approved
Phase 12 PLAN: 6 planned
Phase 12 SPEC/SDD complete
12-01 PASS
12-02 PASS
12-03 PASS
12-04 PASS
12-05 PASS (R1 included)
12-06 PASS (P12-12-06-R1 composite gate)
P12-REVIEW-R1 corrections complete
P12-REVIEW-R2 human re-REVIEW PASS
P12-CLOSURE PASS
TEST-01 complete
OPS-01 complete
OPS-02 complete
completed_phases: 13
completed_plans: 62
percent: 100
Phase 12 closed; reaffirmed by P12-POST-CLOSURE-PR7-R1, R2, R3, and R4 PASS
P12-POST-CLOSURE-PR7-R1 PASS
P12-POST-CLOSURE-PR7-R2 PASS
P12-POST-CLOSURE-PR7-R3 PASS
P12-POST-CLOSURE-PR7-R4 PASS
PR 7 closed and merged into main; final head 5289d20a1169ca35b3db161fc0697c19671ae769; merge commit b4c1ee954c5d8337bff80a945eadec57ad2a0e0a
additional PR7 review required: no
Phase 12.1 CONTEXT approved
Phase 12.1 RESEARCH complete / awaiting human review
Phase 12.1 PLAN BLOCKED after checker R3 (historical)
Phase 12.1 PLAN checker R3 result: 2 blockers / 0 warnings (historical)
Phase 12.1 PLAN PASS after documentary correction R5
Phase 12.1 PLAN checker R5 result: 0 blockers / 0 warnings
Phase 12.1 SPEC/SDD skipped by explicit human decision
Phase 12.1 IMPLEMENTATION PROMPT complete
Phase 12.1 12.1-01 attempt 1: BLOCKED / committed
Phase 12.1 12.1-01 correction R1: documentary PASS / committed
Phase 12.1 12.1-01 attempt 2: BLOCKED / committed
Phase 12.1 12.1-01 correction R2: committed / human review BLOCKED
Phase 12.1 12.1-01 correction R3: committed / human review BLOCKED
Phase 12.1 12.1-01 correction R4: documentary PASS / awaiting human review
Phase 12.1 12.1-01 attempt 3: completed under the accepted corrective contract
Phase 12.1 12.1-01 through 12.1-06: complete
PHASE 12.1 VERIFICATION: PASS
C01–C18: 18 PASS / 0 BLOCKED
D12.1-01–D12.1-15: 15 PASS / 0 BLOCKED
PHASE 12.1 CLOSURE: PASS
Phase 12.1: 6 planned / 6 completed / closed
milestone phases: 13/13 closed
milestone closed/archived: yes
MILESTONE v1.0 AUDIT: PASS
MILESTONE v1.0 CLOSEOUT / ARCHIVE: PASS
active blockers: 0
unresolved required verification: 0
PR 8: merged
PR 8 head: 7eaa223e82c819271682f0ea58ca50f66bfdbe8d
PR 8 merge commit / repository archive base: 7c991bf422b3f1ca4ff202cad7e860db5a78ede8
initial archive documentation commit: f9c9ea1aec8bf97d91960bbdb7d07072d82e3bf1
archive PR: 9
archive PR state: merged
archive PR final head: 93bcc318e9d7c2309438ca33432fb6a93877a28d
final repository archive identity: fbe986160535c1ba9d2a5f41ad9255e91cd13914
deployed release: v78
deployed candidate SHA: 18d809e4169daa301839542191f0d6794b02d695
rollback target: v77
rollback executed: false
tag: v1.0
tag type: annotated
tag object: 2e91dcdffef5dc677e7e994f07b99f5c3bc2f167
tag target: fbe986160535c1ba9d2a5f41ad9255e91cd13914
tag created and pushed: true
PR #10: merged
PR #10 final head: 2aa8d4dee0f63f5fa735a83854126ac0b3132ea1
PR #10 merge commit: de095d76a83e99faa0b459a58fc8b68200f02686
GitHub Release created: true
GitHub Release status: published
GitHub Release name: v1.0 — Backend MVP
GitHub Release tag: v1.0
GitHub Release published at: 2026-07-30T17:08:24Z
GitHub Release URL: https://github.com/jlima004/E-commerce/releases/tag/v1.0
repository archive identity differs from current main: true
repository archive identity differs from runtime deployed SHA: true
next milestone: v1.1 open
Phase 13 CONTEXT: APPROVED
Phase 13 RESEARCH: APPROVED
Phase 13 PLAN R5: APPROVED
Phase 13 SPEC/SDD R1: APPROVED
Phase 13 Implementation Prompt: APPROVED
Phase 13 EXECUTING
P13-13-01-R1: HUMAN RE-REVIEW PASS
13-01: HUMAN APPROVED — PASS
P13-13-02-R1: TECHNICAL HUMAN RE-REVIEW PASS
P13-13-02-R2: HUMAN RE-REVIEW PASS
13-02: HUMAN APPROVED — PASS
P13-13-03-R1: TECHNICAL HUMAN RE-REVIEW PASS
P13-13-03-R2: HUMAN REVIEW PASS
13-03: HUMAN APPROVED — PASS
13-04: HUMAN APPROVED — PASS (P13-13-04-T3-R1 HUMAN RE-REVIEW PASS)
13-05: TECHNICAL PASS — AWAITING HUMAN REVIEW
13-06..13-07: NOT AUTHORIZED
Phase 13 plans: 7 planned / 4 human-approved executed; 13-05 awaiting human review
Phase 13 requirements covered: FND-01..FND-08 = 8/8
Phase 13 requirements complete: 0/8
FND-06: EVIDENCED — NOT COMPLETE
Milestone requirements complete: 0/91
Phases complete: 0/10
Deploy: NOT AUTHORIZED
frontend blocked / not started / not authorized
next permitted step: human review of 13-05 only; do not start 13-06 without separate explicit authorization.
```

### Limitações operacionais não bloqueantes no fechamento

```text
Sentry externally exercised: false
Stripe provider gate exercised: false
Resend real send proven: false
Gelato real dispatch proven: false
PostHog real event proven: false
Correios API exercised: false
Pix: deferred by account eligibility
rollback real: not executed
```

Os registros `BLOCKED` históricos permanecem preservados e foram supersedidos pela linhagem corretiva aprovada. Nenhuma dessas limitações é blocker ativo do milestone.

**Não-ações históricas no momento da abertura do milestone v1.1:** naquele momento original, nenhum CONTEXT/RESEARCH/PLAN de Phase 13 havia sido iniciado; tampouco código runtime, migration, pacote/lockfile, teste de runtime, build, banco, provider real, deploy, rollback, restart, scale, secret/env real, frontend ou projeto Next.js. A GitHub Release e a tag `v1.0` não foram criadas, editadas, movidas ou republicadas naquela abertura. Este registro é histórico e não contradiz o estado corrente da Phase 13 registrado no front matter, Current Position e Session Continuity.

A estabilização do release permanece formalmente encerrada (produção saudável; débitos MNY/REL/CACHE/INFRA não reabertos).

### Encerramento da estabilização

```text
Release stabilization: concluída
Incidente monetário: resolvido
Versionamento automático: resolvido
Cache Redis TLS: resolvido
Fallbacks do release: classificados e isolados
Produção: saudável
```

**Branch policy:**

`git.branching_strategy` is `phase` (GSD-supported). Archive documentation branch: `gsd/milestone-v1.0-closeout-archive`, created from merged `main` at `7c991bf422b3f1ca4ff202cad7e860db5a78ede8`. Phase 12.1 branch remains historical: `gsd/phase-12.1-mvp-release-readiness-production-validation`. Phase 12 CONTEXT branch remains historical: `gsd/phase-12-ops-audit-critical-tests` (`phase_branch_template`: `gsd/phase-{phase}-{slug}`). Phase 11 execution branch remains historical: `gsd/phase-11-refunds-exchanges-admin`. Historical Phase 09 branch decision remains preserved in `09-CONTEXT.md` and Phase 09 closure records.

## Current Position

Phase: 13 (storefront-contract-foundation-surface-lockdown) — EXECUTING
Plan: 4 of 7 human-approved; 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW
Status: 13-01..13-04 HUMAN APPROVED — PASS; 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW; 13-06..13-07 NOT AUTHORIZED
Current gate: CONTEXT APPROVED; RESEARCH APPROVED; PLAN R5 APPROVED; SPEC/SDD R1 APPROVED; Implementation Prompt APPROVED; 13-01..13-04 HUMAN APPROVED — PASS; 13-05 awaiting human verification
Last activity: 2026-08-09 — 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW; FND-06 EVIDENCED — NOT COMPLETE
Next: human review of 13-05 only; do not start 13-06

Progress: [░░░░░░░░░░] 0% phases (0/10)
Phase 13 requirements covered: FND-01..FND-08 = 8/8
Phase 13 requirements complete: 0/8
Milestone requirements complete: 0/91
Phases complete: 0/10
Plans human-approved executed: 4/7
frontend blocked

## Historical v1.0 Performance Metrics

**Velocity:**

- Total plans completed: 62 / 62 planned
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01. Foundation & Observability | 7 | Complete | — |
| 02. Catalog & Media | 5 executed / 5 planned | Complete | — |
| 03. Cart & Checkout (pre-Order) | 5 executed / 5 planned | Complete | — |
| 04. Stripe Payments & PaymentAttempt | 6 executed / 6 planned | Complete (pre-Order; historical activation blocker superseded by later gates) | — |
| 05. Stripe Webhook Ingestion & Idempotency | 4 executed / 4 planned | Complete (closed 2026-06-30) | — |
| 06. Idempotent Webhook-Driven Order Creation | 5 executed / 5 planned | Complete (closed 2026-06-30) | — |
| 07. Analytics Outbox (`purchase_completed`) | 3 executed / 3 planned | Complete (closed 2026-07-01) | — |
| 08. Transactional Email (Resend) | 3 executed / 3 planned | Complete (closed 2026-07-01) | — |
| 09. Gelato Fulfillment & Webhook | 5 executed / 5 planned | Complete / Closed | — |
| 10. Secure Guest Tracking | 3 executed / 3 planned | Complete / Closed | — |
| 11. Refunds & Exchanges (Admin) | 4 executed / 4 planned | Complete / Closed | — |
| 12. Ops, Audit & Critical Tests | 6 executed / 6 planned | Complete / Closed | — |
| 12.1. Backend MVP Release Readiness & Production Validation | 6 executed / 6 planned | Complete / Closed | — |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [P12-POST-CLOSURE-PR7-R2]: Disposable PostgreSQL harness invokes `docker` directly; `rtk` is an optional Codex agent wrapper only (`RTK.md`), never a versioned runtime dependency. Cursor/WSL2 proven with direct Docker.
- [P12-12-06-R1]: Final Plan 12-06 gate is composite — serial disposable PostgreSQL (one process per spec) + normal Modules suite. Stacked `medusaIntegrationTestRunner` `Map.prototype.set` remains a known Jest/test-utils stacking limitation; not required for PASS; not corrected in Phase 12.
- [Phase 12 closure]: Phase 12 closed after 6/6 plans, technical requirements OPS-01/OPS-02/TEST-01 complete, P12-REVIEW-R2 PASS and P12-CLOSURE PASS. PostgreSQL serial disposable + normal Modules formed the accepted final gate. Cross-dyno real and stacked runner PASS are not claimed.

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Order created only by the canonical Stripe webhook; webhook ingest (P5) lands before Order creation (P6).
- [Roadmap]: purchase_completed is a durable backend outbox event (P7); Gelato fulfillment (P9) gates on the local `recorded` record, never on PostHog success.
- [Roadmap]: Refund updates financial state only post-webhook and never auto-cancels the order (P11).
- [Governance]: For implementation, PRD Backend v1.1 + DB_MODEL v1.21 override older SRS wording that suggests Order/awaiting_payment before confirmed payment. Pre-payment state lives in Cart, PaymentCollection, PaymentSession, and PaymentAttempt. Order exists only after canonical Stripe webhook payment confirmation. (Also recorded in PROJECT.md Key Decisions for planning-agent visibility.)
- [Governance]: Phase 2 (Catalog & Media) delivers only the Gelato snapshot builder/helper/contract + unit tests; actual `LineItem.metadata.gelato_snapshot` persistence is verified in Phase 6 where Order creation exists.
- [Phase 02 planning]: Phase 02 was decomposed into 5 plans across 3 waves: central Gelato metadata contract, sellable/publish gate, Supabase Storage provider wiring, public Store API contract, and pure Gelato snapshot builder with future Phase 6 contract.
- [Phase 02 execution]: All five planned slices have approved SUMMARY artifacts and the phase is now closed documentally; Phase 03 remains intentionally not started behind manual review.
- [Plan 01-03]: Locking module uses `REDIS_URL` via `@medusajs/medusa/locking-redis`; no fifth Redis contract in Phase 01.
- [Plan 01-04]: Logging uses allowlist-first sanitization with exact-pinned `pino@10.3.1` and dev-only `pino-pretty@13.1.3`; audit findings remain documented and non-blocking because fixes require broad dependency changes outside Plan 01-04.
- [Plan 01-05]: Sentry uses exact-pinned `@sentry/node@10.59.0`, `sendDefaultPii=false`, allowlist scrubbing hooks, and a single Medusa-delegating error capture path keyed by sanitized grouping metadata.
- [Plan 01-06]: Health readiness checks only Postgres and Redis in parallel; expected dependency failures are sanitized warnings and do not create Sentry events by default.
- [Plan 01-07 / Deployment checkpoint]: The original VPS/PM2/Nginx route was superseded in this cycle by Heroku as the current production target. The validated app is `espacoliminar`, release `v27`, deployed commit `d02fd70`, with `APP_VERSION=d02fd70`.
- [Plan 01-07 / Deployment checkpoint]: Current production operations use Heroku web/worker dynos, Supabase Postgres through the pooler, Heroku Redis with TLS, and Heroku release phase for `db:migrate:safe`.
- [Plan 01-07 / Deployment checkpoint histórico]: `REDIS_CACHE_PROVIDER_DISABLED=true` foi usado no checkpoint `v27` para isolar o loop TLS então existente. Esse estado foi superado pelo fechamento de CACHE-01A/B e INFRA-01; não há reativação de cache pendente.
- [Plan 01-07 / Deployment checkpoint]: `/health/live` and `/health/ready` were validated in production with HTTP 200; readiness reports Postgres `up` and Redis `up`; `web.1` and `worker.1` are up.
- [Plan 01-07 / Deployment checkpoint]: Local branch `gsd/phase-01-foundation-observability`, `origin/gsd-...`, and `heroku/main` are synchronized on `d02fd70`.
- [Production smoke histórico]: No checkpoint de 2026-06-26, o app Heroku `espacoliminar` estava no release `v27`, com `APP_VERSION=d02fd70` e `REDIS_CACHE_PROVIDER_DISABLED=true`; `web.1` e `worker.1` estavam `up`, `/health/live` e `/health/ready` retornavam 200, Postgres e Redis estavam `up`, e as rotas públicas read-only não retornaram 5xx. A classificação operacional corrente é a do encerramento da estabilização acima.
- [Phase 01 closure]: Closure completed on 2026-06-26. The original VPS/PM2/Nginx route remains as a portable blueprint, while the validated operational checkpoint for this cycle is Heroku app `espacoliminar` with Supabase Postgres via pooler, Heroku Redis with TLS, Heroku release phase for `db:migrate:safe`, and Phase 02 left unstarted behind a human review gate.
- [Plan 02-03]: `@medusajs/file-s3@2.16.0` wired via `@medusajs/medusa/file` + `@medusajs/medusa/file-s3` with `forcePathStyle: true`; production env fail-fast for six S3 vars; manual Admin upload smoke confirmed public Supabase URL and product media association — MEDIA-01 closed.
- [Plan 02-04]: The standard Medusa Store API now exposes only the stable shopper-facing catalog surface, with BRL pricing, public media URLs, and no public `gelato_*` fields; non-sellable variants stay hidden from the public contract.
- [Plan 02-05]: `buildGelatoSnapshot` closed as a pure typed immutable contract, reusing the same sellable validation source as 02-01/02-02; CAT-04 is complete for Phase 02 via builder + contract + unit tests, while actual `LineItem.metadata.gelato_snapshot` persistence remains deferred to Phase 6 consumption.
- [Phase 02 closure]: `02-CLOSURE.md` records the accepted scope as CAT-01, CAT-02, CAT-03, CAT-04, and MEDIA-01 complete for the phase, with no additional runtime verification performed during the closure cycle itself.
- [Phase 03 research]: Research for cart-checkout pre-order completed and reviewed at manual gate; planning proceeded with `--skip-research` after explicit approval. No execution started.
- [Phase 03 planning]: Phase 03 was decomposed into 5 manual-review-gated plans across 3 waves: active cart contract, secure guest-cart attach, Brasil/Gelato checkout data with `federal_tax_id`, derived `checkout_data_complete`, and final pre-Order negative proofs. `03-VALIDATION.md` defines Jest/build verification and required negative checks.
- [Phase 03 planning]: Plan checker passed with no blockers or warnings. CART-01, CART-02, CART-03, CART-04 and decisions D-01..D-33 are covered; execution remains blocked behind human review.
- [Phase 03 execution]: Plans 03-01..03-05 implemented and verified — 64 tests green (40 unit + 24 integration HTTP), negative grep clean, build green with `ADMIN_DISABLED=true`.
- [Phase 03 closure]: `03-CLOSURE.md` records CART-01..CART-04 complete; `checkout_data_complete` derived only; `federal_tax_id` in shipping metadata with public mask; guest attach session-backed; no Order/PaymentAttempt/PaymentSession/webhook/Stripe/Pix/Gelato; Phase 04 not started.
- [Phase 04 execution]: Plans 04-01..04-05 complete on branch `gsd/phase-04-stripe-payments-payment-attempt`. Card (04-04) and Pix (04-05) use `filtering_wrapper` + injectable Stripe layers; no native-first Medusa Stripe. Migration draft not applied; Stripe real/config still pending.
- [Phase 04 replan]: Plans 04-04 and 04-05 revised after 04-01 proved native-first pure unsafe. Card/Pix execution proved safe boundary via custom layer + allowlist-only persistence; `PaymentSession.data` allowlist-only when used. `client_secret`, QR/copia-e-cola, `next_action` and raw Stripe payloads are response-only and never persisted.
- [Phase 04 pre-execution alignment]: `PAYMENT_SESSION_ID_NULLABLE_DECISION=model_and_migration_nullable`; `PaymentAttempt.payment_session_id` is nullable/opcional in model, types, and helpers to allow local `created` attempts before provider session association. Migration draft remains not applied.
- [Plan 04-04]: Card initiation pre-Order via `STRIPE_CARD_INITIATION_LAYER`; `client_secret` response-only; fail-closed without audit trail.
- [Plan 04-05]: Pix initiation pre-Order via `STRIPE_PIX_INITIATION_LAYER`; QR/copia-e-cola/`expires_at` response-only for instructions, `expires_at` persisted; local states `awaiting_pix_payment`, `pix_expired`, `payment_failed`, `payment_canceled` never create Order.
- [Plan 04-06]: Cart mutation invalidates active PaymentAttempt via safe fingerprint; retry/supersede leaves one active attempt; final negative proofs confirm no Order, webhook, completion, `purchase_completed`, Gelato, or persisted Stripe secrets/QR/`next_action`.
- [Phase 04 closure — histórico]: Phase 04 completed the money-path pre-Order implementation/test scope. At the 2026-06-29 closure, production activation was blocked by the draft migration and missing real Stripe layers/config. Later safe-layer work, the RC1 applied-migration audit, Phases 05–11 closures, and formal production stabilization superseded that blocker. Separately deferred Stripe smokes/config without specific evidence do not reopen PAY-01..PAY-04.
- [Gate 04A]: Real Stripe card/Pix initiation layers are implemented and registered behind `STRIPE_REAL_INITIATION_ENABLED=true` with `sk_test_...` only. The layers call Stripe directly, not native-first Medusa Stripe, and hand raw PaymentIntent data immediately to the existing safe boundary. `client_secret`, Pix QR/copia-e-cola, hosted instructions, and integral `next_action` remain response-only; `PaymentAttempt` migration is prepared but not applied; no webhook, Order, `purchase_completed`, or Gelato work was introduced.
- [Gate 04A validation]: Real Stripe card initiation smoke passed in test mode on local port 9001. The card route returned `201 Created`, created a Stripe test-mode PaymentIntent through the real safe layer, and persisted `PaymentAttempt` with `payment_method_type=card`, `status=card_client_secret_created`, `amount=9900`, `currency_code=brl`, and `order_id=null`. No Order, webhook, `CheckoutCompletionLog`, `WebhookEventLog`, `purchase_completed`, or Gelato fulfillment was created. Pix real smoke remains deferred due to Stripe account eligibility. Phase 05 remains not started.
- [Phase 05 planning]: Phase 05 was drafted as planning-only into four manual slices: WebhookEventLog schema/config, raw-body `/hooks/stripe` signature route, PaymentIntent-to-PaymentAttempt processing, and final validation/negative proofs. Planned success state is `PaymentAttempt.status = payment_confirmed_by_webhook` with `order_id = null`; Phase 06 remains responsible for `Order` creation via `CheckoutCompletionLog`. No runtime code, endpoint, migration execution, Order, `purchase_completed`, Gelato, e-mail, analytics or refund flow was implemented during planning.
- [Phase 05 execution]: Plans `05-01`..`05-04` completed under manual gating. Final validation closed with 29 targeted unit tests, 10 HTTP integration tests, green build, focused runtime greps green, and broad grep false positives limited to tests/canaries or Stripe initiation code outside webhook runtime. `PaymentAttempt` webhook handling now stops at `payment_confirmed_by_webhook` with `order_id = null`; no Order, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics, refund or Stripe CLI real smoke was introduced.
- [Phase 05 closure]: Human review accepted Phase 05 at manual gate on 2026-06-30 (evidence: `05-04-SUMMARY.md`, 29/29 unit, 10/10 HTTP integration, build green, negative greps green). `05-CLOSURE.md` recorded. WHK-01 and WHK-02 complete. Phase 06 may be planned next; execution blocked. Hard constraint: Order creation must consume only `PaymentAttempt.status = payment_confirmed_by_webhook` with `order_id = null`.
- [Phase 06 planning]: Planning-only artifacts created for Idempotent Webhook-Driven Order Creation: `06-CONTEXT.md`, `06-RESEARCH.md`, `06-VALIDATION.md`, and five slices `06-01`..`06-05`. The plan defines a single internal post-webhook entrypoint, `CheckoutCompletionLog` idempotency keyed by PaymentIntent, transactional `Order + CheckoutCompletionLog + PaymentAttempt.order_id` correlation, decoupled `order_status/payment_status`, immutable Gelato snapshots on Order LineItems, and negative proofs excluding `purchase_completed`, Gelato, email, analytics, refund and Stripe CLI smoke. No runtime implementation was started.
- [Phase 06 execution]: Plans `06-01`..`06-05` completed under manual gating. Final validation closed with 5 unit suites / 50 tests, 2 HTTP suites / 15 tests, build PASS, Store completion grep PASS, Phase 07+ runtime-scope grep PASS, secret/payload grep PASS, and docs real-secret grep PASS. Order creation now exists only behind the canonical internal post-webhook flow; `CheckoutCompletionLog` guarantees idempotent replay/concurrency handling; `PaymentAttempt.order_id` is correlated; `Order.metadata.order_status/payment_status` are accepted as decoupled local state; and `LineItem.metadata.gelato_snapshot` is mandatory and immutable. No `purchase_completed`, analytics, email, Gelato fulfillment, refund, Stripe CLI smoke, or real migration execution was introduced.
- [Phase 06 closure]: Human review accepted Phase 06 at manual gate on 2026-06-30 (evidence: `06-05-SUMMARY.md`, `06-CLOSURE.md`, 5/50 unit matrix, 2/15 HTTP matrix, build PASS, focused negative greps PASS). `ORD-01`, `ORD-02`, and `ORD-03` are complete. Phase 07 may be planned next, but execution is blocked until explicit human approval.
- [Phase 07 planning]: Planning-only artifacts created for Analytics Outbox (`purchase_completed`): `07-CONTEXT.md`, `07-RESEARCH.md`, `07-VALIDATION.md`, and three slices `07-01`..`07-03`. The plan defines `AnalyticsEventLog`, `purchase_completed:stripe:{payment_intent_id}` idempotency, local durable downstream gate independent of PostHog success, async PostHog relay with retry/dead-letter, and negative proofs excluding Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke and migration application. Follow-up documentary correction split the prohibited-payload grep into a blocking analytics-payload scope plus broad informational scan so legitimate Phase 06 `gelato_snapshot` usage in Order workflows does not block Phase 07 validation; `07-03` records controlled lockfile handling for any future PostHog SDK install. No runtime implementation was started during planning.
- [Phase 07 execution]: Plans `07-01`..`07-03` completed under manual gating. Final validation closed with 35 unit tests, 3 filtered HTTP integration tests, build PASS, negative greps PASS, and `git diff --check` PASS. `purchase_completed` is durably recorded in `AnalyticsEventLog` on accepted Order success; local downstream gate accepts `recorded | queued | sending | sent | failed | dead_letter`; async PostHog relay with retry/backoff/dead-letter; PostHog is not a business gate and `status = sent` is not a downstream requirement. `posthog-node@^5.38.2` added (resolved `5.39.2`); root `package-lock.json` updated by workspace npm. No PostHog real call, Email, Gelato, fulfillment, refund, tracking, Stripe CLI smoke, or real migration execution.
- [Phase 07 closure]: Human review accepted Phase 07 at manual gate on 2026-07-01 (evidence: `07-03-SUMMARY.md`, `07-CLOSURE.md`, 35/35 unit, 3/3 HTTP filtered, build PASS, negative greps PASS). `ANL-01`, `ANL-02`, and `ANL-03` are complete. Phase 08 may be planned next, but execution is blocked until explicit human approval. Phase 09 execution blocked until explicit human approval and required dependencies.
- [Phase 08 planning]: Planning-only artifacts created for Transactional Email (Resend): `08-CONTEXT.md`, `08-RESEARCH.md`, `08-VALIDATION.md`, and three slices `08-01`..`08-03`. The plan defines `EmailDeliveryLog`, idempotency key `order-confirmation/{order_id}`, local enqueue after confirmed Order + durable local `purchase_completed`, canonical recipient source `Order.email`, async Resend relay with retry/backoff/dead-letter, and negative proofs excluding Gelato, fulfillment, refund, exchange, tracking, Stripe CLI smoke and migration application. No runtime implementation, tests, migrations, install, package/lockfile change, Resend call, real e-mail, PostHog call, Gelato, fulfillment, refund, exchange or tracking work was started during planning.
- [Phase 08 execution]: Plans `08-01`..`08-03` completed under manual gating. Final validation closed with 41 unit tests, 4 filtered HTTP integration tests, build PASS, negative greps PASS, and `git diff --check` PASS. Confirmation e-mail is enqueued locally after accepted Order success + durable local `purchase_completed`; async Resend relay with retry/backoff/dead-letter; idempotency key `order-confirmation/{order_id}`; `Order.email` sole recipient source; full e-mail not persisted in `EmailDeliveryLog`; Resend is not a gate of Order; `status = sent` is not required to validate Order; future automatic Gelato requires `EmailDeliveryLog(order_confirmation).status = sent` or explicit operational decision; `dead_letter` never authorizes automatic Gelato. `resend@^4.8.0` added (resolved `4.8.0`); root `package-lock.json` updated by workspace npm. No Resend real call, real e-mail, PostHog real call, Gelato, fulfillment, refund, exchange, tracking, Stripe CLI smoke, or real migration execution.
- [Phase 08 closure]: Human review accepted Phase 08 at manual gate on 2026-07-01 (evidence: `08-03-SUMMARY.md`, `08-CLOSURE.md`, 41/41 unit, 4/4 HTTP filtered, build PASS, negative greps PASS). `EMAIL-01` and `EMAIL-02` are complete. Phase 09 may be planned next, but execution is blocked until explicit human approval.
- [Phase 09 planning]: Planning-only artifacts created for Gelato Fulfillment & Webhook: `09-CONTEXT.md`, `09-RESEARCH.md`, `09-VALIDATION.md`, and five manual-review-gated slices `09-01`..`09-05`. Branch decision B was recorded: use `gsd/phase-09-gelato-fulfillment-webhook`. Documentary correction before execution requires real runtime registration as `gelato_fulfillment`, preserves e-mail `sent` as hard automatic-dispatch gate, moves normal post-email creation/reuse into the `09-03` relay eligibility scan so Stripe webhook replay is not required, closes `FUL-04` through minimal operator-alert fields on `GelatoFulfillment`, requires build for `09-02` and `09-03`, and preserves the `09-04` Gelato webhook authenticity blocker. The plan defines local `GelatoFulfillment`, single-active guard per `Order`, `gelato-dispatch:{order_id}` local idempotency, eligibility after confirmed `Order` + local durable `purchase_completed` + `EmailDeliveryLog(order_confirmation).status = sent`, async dispatch retry/dead-letter/alert contract, Gelato webhook dedupe/status/tracking, and negative proofs excluding refund, exchange, tracking public, Stripe CLI smoke and Phase 10. No runtime implementation, tests, migrations, install, package/lockfile change, real Gelato call/order/webhook/fulfillment, Resend call, PostHog call, refund, exchange, tracking or Stripe CLI smoke was started.
- [Phase 09 post-hardening reconciliation]: Phase 09 planning reconciled after Phase 08 Email Outbox Hardening. Gelato relay planning includes stale in-flight recovery and no blind redispatch after possible external Gelato call. Phase 09 execution remains blocked until explicit human approval.
- [Phase 09 pre-09-04 reconciliation]: Gelato webhook authenticity blocker resolved documentally (2026-07-02). Dashboard/API Portal confirms Authorization Type = HTTP Header with configurable Header Name/Value. Chosen mechanism: dedicated header `X-GELATO-WEBHOOK-SECRET`, env `GELATO_WEBHOOK_AUTH_HEADER_NAME` + `GELATO_WEBHOOK_SECRET`; do not reuse `GELATO_API_KEY`; no HMAC/signature/timestamp confirmed; fail-closed before DB side effect; dedupe via `WebhookEventLog.payload.id` with `payload_hash` as safe fallback only. Phase 09 MVP accepts only `order_status_updated`; other official Gelato underscore event names remain out of MVP.
- [Phase 09 execution]: Plans `09-01`..`09-04` completed under manual gating on branch `gsd/phase-09-gelato-fulfillment-webhook`. Branch decision B preserved.
- [Phase 09 validation]: Plan `09-05` completed (2026-07-02). Final battery: 7 unit suites / 75 tests, 11 HTTP filtered + 6 HTTP Gelato webhook = **92 tests PASS**, build PASS. Negative proofs documented. `FUL-01`..`FUL-04` and `WHK-03` evidenced.
- [Phase 09 closure]: Human review accepted Phase 09 at manual gate on 2026-07-02 (evidence: `09-05-SUMMARY.md`, `09-CLOSURE.md`, 92/92 tests, build PASS). `FUL-01`..`FUL-04` and `WHK-03` complete. Branch decision B preserved (`gsd/phase-09-gelato-fulfillment-webhook`). Migration real not applied; production Gelato dispatch/webhook smoke deferred. Phase 10 may be planned next, but execution remains blocked until explicit human approval.
- [Phase 10 planning]: Planning-only artifacts created for Secure Guest Tracking: `10-CONTEXT.md`, `10-RESEARCH.md`, `10-VALIDATION.md`, and three manual-review-gated slices `10-01`..`10-03`. The plan defines a tokenized public guest tracking surface, `TrackingAccessToken` hash-only persistence with `expires_at`/`revoked_at`, server-side constant-time comparison, sanitized minimal public response, rate limit against enumeration, and explicit negative proofs excluding `order_id`-only lookup, e-mail/telefone/CPF lookup, financial data exposure, refund, exchange, admin ops, and Phase 11. No runtime implementation, tests, build, migration, deploy, real Gelato, real webhook smoke, or Phase 11 work was started during planning.
- [Phase 10 execution]: Plans `10-01`..`10-03` completed under manual gating on branch `gsd/phase-10-secure-guest-tracking`. Final validation closed with 45 unit tests, 11 HTTP integration tests, build PASS, blocking runtime grep PASS, config/lockfile no diff, and `git diff --check` PASS. `TrackingAccessToken` hash-only module; `POST /store/tracking/lookup` body-only token route; allowlist-only public response; rate limit / enumeration guard with indistinguishable 429; process-local limitation documented. No migration applied, no Gelato real, no webhook smoke real, no refund, exchange, admin ops, deploy, or Phase 11 work.
- [Phase 10 closure]: Human review accepted Phase 10 at manual gate on 2026-07-02 (evidence: `10-03-SUMMARY.md`, `10-CLOSURE.md`, 45/45 unit, 11/11 HTTP, build PASS, blocking grep PASS). `TRK-01` and `TRK-02` complete. Migration real, global Redis rate limit, and client token delivery remain deferred. Phase 11 may be planned next, but execution remains blocked until explicit human approval.
- [Phase 11 planning]: Planning-only artifacts created for Refunds & Exchanges (Admin): `11-CONTEXT.md`, `11-RESEARCH.md`, `11-VALIDATION.md`, and four manual-review-gated slices `11-01`..`11-04`. Branch registered as `gsd/phase-11-refunds-exchanges-admin`. The plan defines local `RefundRequest`, Admin-safe refund request/reservation, Stripe refund object webhook confirmation as the only local final financial truth, transactional `payment_status` recomputation without automatic `order_status = canceled`, local concurrency/idempotency guards against over-refund, operational `ExchangeRequest`, and manual/semi-automatic Correios reverse-logistics fields entered in Admin. `charge.refunded` cannot double-count financial truth; if handled, it is informational/idempotent and subordinate to refund object events. No runtime implementation, tests, build, migration, deploy, real Stripe, real Gelato, Correios API call, Stripe CLI smoke, broad `OperationalAlert`, broad `AdminActionLog`, or Phase 12 work was started.
- [Phase 11 execution]: Plans `11-01`..`11-04` completed under manual gating on branch `gsd/phase-11-refunds-exchanges-admin`. Final validation closed with 75 unit tests, 29 HTTP integration tests, build PASS, negative greps G1–G7 PASS (G4 informational only — sanitizer Gelato URL pattern), config/lockfile no diff, and `git diff --check` PASS. RefundRequest Admin-safe reservation with captured-truth guards, idempotency, and process-local per-order concurrency claim; Stripe refund object webhook as sole local financial truth with `refund.created` never finalizing money and `charge.refunded` informational/idempotent; `payment_status` recomputation without auto-canceling `order_status`; ExchangeRequest operational workflow for `defect`/`wrong_product` with manual Correios fields and raw body allowlist on exchange routes; sanitization of notes, affected_items, and payloads. No real migration, `medusa db:migrate`, deploy, Stripe real, Stripe CLI smoke, Gelato real, Correios API, broad OperationalAlert, broad AdminActionLog, or Phase 12 work.
- [Phase 11 closure — histórico]: Human review accepted Phase 11 at manual gate on 2026-07-03 (evidence: `11-04-SUMMARY.md`, `11-CLOSURE.md`, 75/75 unit, 29/29 HTTP, 104/104 total, build PASS, greps G1–G7 PASS, `git diff --check` PASS). `REF-01`, `REF-02`, `EXC-01`, and `EXC-02` are complete. Migration real, cross-dyno refund lock, Stripe refund production smoke, and broad alert/audit modules remain deferred. At that closure gate, Phase 12 was not planned or started and remained blocked until explicit human approval.
- [Phase 12 CONTEXT]: Authorized CONTEXT-only gate completed and approved on branch `gsd/phase-12-ops-audit-critical-tests`. Decisions D12-01..D12-15 lock MVP `OperationalAlert` types (`payment_stuck`, `fulfillment_failed`), stuck-payment predicates (confirmed-without-Order; Pix past Stripe `expires_at`), AdminActionLog on refund/exchange Admin surfaces, hybrid INV suite for TEST-01, and explicit out-of-scope (alert email, REL-02 sweeper, dashboards, real providers). PLAN/execution have not started.
- [Phase 12 RESEARCH R1]: `12-RESEARCH.md` was revised after human-review blockers R12-01..R12-07 and is approved. Strategy A cross-module atomicity is infeasible on current proof; Strategy B correlated append-only is required. OperationalAlert uses atomic PostgreSQL `ON CONFLICT`; actor is user-only; stale window is local 15m with stable timestamps; invariant HTTP files are flat and persistence/concurrency requires disposable real PostgreSQL. PLAN/VALIDATION/execution remain not started and blocked pending explicit authorization.
- [Phase 09/12 boundary]: `GelatoFulfillment.requires_operator_attention` / `dead_letter` remains the Phase 09 local fulfillment truth and keeps FUL-04 closed. Phase 12 OPS-01 promotes that condition to a persisted, consultable `OperationalAlert`; it does not reopen FUL-04.
- [Phase 12 alert email]: Resend delivery for `OperationalAlert` is outside the Phase 12 MVP, is a known PRD divergence, and is not a blocker for OPS-01.
- [Phase 12 PLAN]: Planning-only gate P12-PLAN-01 created exactly six manual-review-gated plans across four waves plus `12-VALIDATION.md`. Wave 1 establishes local disposable PostgreSQL proof; Wave 2 builds OperationalAlert/Admin GET and AdminActionLog primitives; Wave 3 connects factual detections and explicit refund/exchange audit wrappers; Wave 4 adds named INV-1/2, INV-3/4, INV-8 and INV-9/10 suites with PostgreSQL constraint/concurrency proofs. All D12-01..D12-15, H12-01..H12-06 and P12-PLAN-01 are covered. No runtime, tests, migration execution, provider, deploy, push or commit occurred.
- [Phase 12 PLAN checker R1]: Revision iteration 1/3 corrected 8 BLOCKERs and 1 WARNING documentally: XML/task references, discoverable Gelato migration planning in 12-01, CCL-absent 15m/`received_at` gate, factual native Admin route inventory, INV-2/3/4 contracts, disposable-runner full modules command, evidence-strength classification and file/rollback counts. Recheck remains pending; no PASS is claimed. No runtime, product test, build, lint, migration, provider, deploy, push or commit occurred.
- [Phase 12 implementation prompt]: Pacote consolidado criado para execução manual estritamente sequencial `12-01 → 12-02 → 12-04 → 12-03 → 12-05 → 12-06`, com gate humano entre planos, SHA-base futuro, allowlists exatas, summaries/commits separados, stop conditions e negativas. Checker documental PASS com 0 blockers e 0 warnings. Nenhum plano, runtime, teste, migration, Docker/PostgreSQL, provider, deploy ou push foi executado.
- [Phase 12.1 CONTEXT]: Inserted operational phase selected after PR 7 was accepted, closed, and merged into `main`. Baseline is merged `main` at `b4c1ee954c5d8337bff80a945eadec57ad2a0e0a`. Scope is release readiness and production validation only, with no new product requirements and no provider or production mutation authorized. CONTEXT approved.
- [Phase 12.1 RESEARCH]: Research-only gate completed on 2026-07-24. Consolidated the factual release/web/worker topology, the 11-migration inventory and Gelato identity risk, pooled versus direct/session connections, dynamic SHA, live/ready and public read-only smoke contracts, Admin fail-closed authentication, sanitized evidence, current/previous release discovery, rollback criteria, dynamic monitoring, evidence matrix, and recommended future PLAN decomposition. No tests, build, migration, production/provider access, deploy, rollback, PLAN, commit, or push occurred. Awaiting human review; PLAN remains blocked.
- [Phase 12.1 PLAN]: Planning-only gate created exactly six sequential manual-review-gated plans across six waves plus `12.1-VALIDATION.md`. Checker revision 1 corrected the factual PLAN baseline/fish variables, disposable migration/catalog invocation, child-command `rtk` misuse, safe config/migration preflight, fish status test, complete three-sample production procedure, optional provider branches, the 12.1-06 external-read checkpoint, and operational disposition of all four RESEARCH open questions while keeping `12.1-RESEARCH.md` read-only. The plan covers C01–C18 and D12.1-01..D12.1-15; execution and independent recheck remain blocked behind the next manual gate. No plan execution, tests, build, npm install, Docker/PostgreSQL operation, production/provider access, migration, deploy, rollback, commit or push occurred.
- [Phase 12.1 PLAN documentary correction R5]: Human-authorized corrective gate fixed the candidate SHA deployment deadlock without changing the six-plan/six-wave decomposition. Deploy uses exact candidate refspec `$P12_CANDIDATE_SHA`:refs/heads/main`; documentary HEAD may descend only by SUMMARYs 01/02; `previous_eligible_release` is historical evidence only (no automatic rollback substitution). Checker R5 PASS with 0 blockers / 0 warnings. No execution, deploy, provider, migration, SPEC/SDD, implementation prompt, push, or PR.
- [Phase 12.1 Plan 12.1-01 documentary correction R1]: Attempt 1 correctly BLOCKED under stacked Modules+disposable contract (`Map.prototype.set` on five PostgreSQL Medusa suites); Unit/lint/build PASS; HTTP/audit not executed; product/runtime regression not demonstrated. BLOCKED SUMMARY committed historically. Documentary correction replaces stacked Modules gate with composite gate (Modules normal + five isolated PostgreSQL specs + HTTP + exact-set audit). No technical changes. Retry requires separate authorization. 12.1-02 remains blocked.
- [Phase 12.1 Plan 12.1-01 documentary correction R2]: Attempt 2 correctly BLOCKED under R1 Prova D manifests; Unit/lint/build/Modules normal/PostgreSQL 5/5/HTTP PASS; tables 11/11; indexes 76/76; blocker restricted to documentary Prova D (class-name vs MikroORM basename for three TBD files; 33 stable names treated as total constraint set vs 28 inline generated-name checks). BLOCKED SUMMARY committed historically. Documentary correction separates source classes from history basenames, adds 11 mappings, and replaces total constraint exact-set with stable named (33/33 present) + generated semantic exact multiset + unexpected=0. No migration/runtime/test changes. Attempt 3 requires separate authorization. 12.1-02 remains blocked.
- [Phase 12.1 Plan 12.1-01 documentary correction R3]: R2 checker PASS; R2 human review BLOCKED. Attempt 2 and correction R2 preserved. Added closed semantic ID contract for 33 stable constraints, deterministic fail-closed canonicalization for 28 generated CHECKs, PK/UNIQUE ordered-column verification, bucket assignment with duplicate=0, and corrected execution metadata. No migration/runtime/test changes. Attempt 3 requires authorization after R3. 12.1-02 remains blocked.
- [Phase 12.1 Plan 12.1-01 documentary correction R4]: R3 checker PASS; R3 human review BLOCKED. Attempt 2 and corrections R1–R3 preserved. Stable/generated inventories and execution metadata accepted. Remaining blocker restricted to PostgreSQL-decompiled BETWEEN form for five `btrim-length-between` constraints. Added closed equivalence `BETWEEN` ↔ `>= lower AND <= upper` with same-column/`AND`/`>=`then`<=`/exact-bounds enforcement; compatible `::text` casts only; malformed resemblance BLOCKED (no silent no-match). No migration/runtime/test changes. Attempt 3 requires authorization after R4. 12.1-02 remains blocked.
- [Phase 12.1 closure — historical gate]: Plans 12.1-01..12.1-06 are complete. `12.1-06-CORRECTION-C4-SUMMARY.md` is the final verification authority: PHASE 12.1 VERIFICATION PASS, C01–C18 18/18 PASS, D12.1-01–D12.1-15 15/15 PASS. Release v78 maps to candidate SHA `18d809e4169daa301839542191f0d6794b02d695`; rollback target v77 is documented and eligible but rollback was not executed. Historical BLOCKED SUMMARYs and C1→C4 corrections remain preserved. Sentry, Stripe, Resend, Gelato, PostHog, Correios and Pix limitations remain declared, not promoted to provider execution. At that closure gate, the milestone archive, Phase 13 and frontend were blocked; the archive restriction is now superseded by this v1.0 closeout, while Phase 13 and frontend remain blocked.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Roadmap]: REQUIREMENTS.md summary previously stated "44 total"; the v1 list actually contains 45 distinct REQ-IDs. Count corrected to 45 during roadmap creation.
- [Phase 4/5]: Medusa bundled Stripe native-first is **not** accepted for Phase 04 card/Pix because unsafe provider payloads can persist through `PaymentSession.data`. Phase 04 uses safe layers. The earlier closure-time migration blocker is historical: the RC1 read-only audit confirmed the PaymentAttempt and webhook migrations applied; real Stripe card/Pix setup remains a separate activation concern.
- [Phase 9]: Gelato has no official Medusa provider/SDK confirmed in the consulted official docs; REST direct remains planned. Gelato webhook auth resolved documentally and implemented (`09-04`): HTTP Header fail-closed. Phase 09 closed at manual gate (`09-CLOSURE.md`). The closure-time migration blocker is historical: the RC1 read-only audit confirmed the Gelato migration applied. Production Gelato dispatch/webhook smoke remains a separate gate.
- [Phase 10]: Public guest tracking implemented as token-only, hash-only, sanitized, rate-limited, fail-closed surface on branch `gsd/phase-10-secure-guest-tracking`. Phase 10 closed at manual gate (`10-CLOSURE.md`). The closure-time migration blocker is historical: the RC1 read-only audit confirmed the tracking migration applied. Process-local rate limit documented; global Redis/DB-backed limiter deferred.
- [Phase 11]: Refund/exchange/admin scope is complete and closed on branch `gsd/phase-11-refunds-exchanges-admin` (`11-CLOSURE.md`). Refund financial truth finalized only by Stripe refund object webhook confirmation; `charge.refunded` does not double-count; refund does not auto-cancel `order_status`; exchanges remain operational without automatic refunds; Correios remains manual/semi-automatic with no API integration; broad `OperationalAlert` / `AdminActionLog` stays Phase 12. The closure-time migration blocker is historical: the RC1 read-only audit confirmed refund/exchange migrations applied. Cross-dyno refund lock and any future Stripe smoke remain separate gates.
- [Quick 260710-dz0]: Stripe refund smoke preflight stopped before mutation because core `refund` has no `order_id`/`status`/`currency_code` and no local `refund_request` exists for the target Order. A direct Stripe refund would be ignored as `REFUND_WEBHOOK_REQUEST_NOT_FOUND`. The adjusted gate requires authenticated `POST /admin/refunds/request` before the Stripe test-mode refund. It also records that current runtime updates `refund_request` + Order metadata, not core `refund`/`payment_collection.refunded_amount`, and has no refund-email flow.
- [Quick 260710-rc1 / RC1-A até RC1-H]: RC1-H está `PASS`: a fixture deixou de ser coletada sem remover suíte real; modules passou 28/28 e 454/454; HTTP passou 14/14 e 170/170; unitários 43/43 e 676/676; lint 0/208; build PASS. As 12 falhas RC1-G foram recuperadas somente em Jest/quatro specs, sem runtime, schema, manifest ou lockfile. Upgrade/bootstrap do RC1-G permaneceram válidos e não precisaram repetição. Nenhum Supabase, Heroku, provider externo, deploy, rollback, tag, push ou Phase 12 foi acionado.
- [Quick 260713-mny01]: MNY-01 está `PASS`: Medusa core/PaymentSession agora usam major units, Stripe/PaymentAttempt/refund/downstream customizado preservam minor units, e o guard da Order converte componentes antes da soma. Unit 44/44 e 717/717, modules 28/28 e 462/462, HTTP 14/14 e 170/170, lint 0/208 e build PASS. Nenhum schema, package/lockfile, APP_VERSION, infraestrutura, produção, provider externo, push ou Phase 12 foi tocado. Preços existentes do catálogo permanecem para correção manual em gate separado.
- [Quick 260715-rel01]: REL-01 está `PASS`: `HEROKU_BUILD_COMMIT > HEROKU_SLUG_COMMIT > APP_VERSION`, com `dev` somente fora de produção; live, ready e Sentry usam a mesma versão resolvida e PM2/VPS preserva o fallback `APP_VERSION`. Env 53/53, health 9/9, Sentry 13/13, PM2 6/6, unit 44/44 e 730/730, lint 0/208 e build PASS. O versionamento automático está resolvido e não há investigação de `APP_VERSION` pendente.
- [Quick 260715-infra01]: INFRA-01 está `PASS`: release DB-only isolation and Redis production fail-fast; Unit 49/49 e 766/766, Modules 29/29 e 463/463, HTTP 14/14 e 172/172, lint 0/207, build PASS. Nenhum config var, deploy, push, tag, Supabase, provider externo ou Phase 12 foi acionado.
- [Release stabilization closure]: incidente monetário resolvido; versionamento automático resolvido; cache Redis TLS resolvido; CACHE-01A/B e INFRA-01 PASS; cache Redis ativo em `web.1` e `worker.1`; fallbacks do release classificados e isolados; produção saudável. Não restam próximos passos para investigar `APP_VERSION`, reativar cache Redis, provar Redis em `web.1`/`worker.1` ou revisar fallbacks do release.
- [Phase 12 — historical pre-P12-PLAN-R1 snapshot]: CONTEXT and RESEARCH were approved and the earlier PLAN had 6 plans / 0 executed with `12-VALIDATION.md`; its checker passed with 0 blockers and 0 warnings, and human review remained required. That earlier PASS was superseded/invalidated when P12-PLAN-R1 reopened and revised PLAN/VALIDATION. P12-PLAN-R1 later passed its checker. The separately authorized SPEC/SDD gate initially found two transient documentary blockers, resolved by P12-SPEC-SDD-R1. The implementation prompt gate later completed with checker PASS; the current authority is recorded at the top.

### Roadmap Evolution

- Phase 12.1 inserted after Phase 12: Backend MVP Release Readiness & Production Validation (URGENT)

## Deferred Items

Known deferred artifact items at v1.0 close: 0.

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

**Resume file:** .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-05-PLAN.md

Last session: 2026-08-09T17:59:30.000Z

Stopped at: 13-05 TECHNICAL PASS — AWAITING HUMAN REVIEW; 13-06..13-07 NOT AUTHORIZED

Resume files:
`.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-05-PLAN.md`,
`.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-05-SUMMARY.md`,
`.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md`

Next permitted step: perform human review of 13-05 and provide an explicit verdict. Do not start 13-06 without separate explicit authorization.

Do not automatically start 13-06..13-07, Phase 14, or frontend,
edit or republish GitHub Release `v1.0`, deploy, exercise providers, execute
rollback, or move or recreate tag `v1.0`.

## Quick Tasks Completed

| Date | Task | Summary |
|------|------|---------|
| 2026-08-03 | api-docs-01-documentary-closure | Closed API-DOCS-01 documentally after PR #20 merge (4fe414f); CLOSURE.md records Waves 1–6 PASS, 304/304 API Docs, 1257/1257 unit, gates PASS; no code/tests/deploy; Phase 13 and frontend remain blocked. |
| 2026-08-03 | 260803-nla-nested-lookaround-fail-closed | Normalização recursiva limitada de lookarounds positivos aninhados (depth≤4, fail-closed); bypass tracking_token/api_key fechado nas duas fronteiras; API Docs 304/304, unit 1257/1257; CI/thread deliberadamente não aguardados. |
| 2026-08-03 | 260803-1el-corrigir-os-dois-p2-residuais-do-re-revi | Corrigidos os bypasses de patternProperties e componentes schemas/responses, incluindo separadores, tokens e classes literais escapados; matriz API Docs 272/272, unit completa 1225/1225, CI 30795192149 em execução, PR atualizada, thread final pendente e sem merge. |
| 2026-08-02 | 260802-wjn-corrigir-os-dois-p2-de-seguran-a-da-pr-2 | Corrigidos os bypasses de ancestral sensível em propriedades aninhadas e de `patternProperties` nos dois gates; matriz API Docs 231/231, gates locais e CI verde; PR atualizada, threads respondidos/resolvidos e novos reviews Codex/Copilot solicitados. |
| 2026-08-02 | 260802-u9e-corrigir-p2-da-pr-20-preservar-nomes-sen | Preserved semantic names for parameters, headers, components and nested schema vocabularies in both API Docs safety gates; paired regressions pass 205/205, OpenAPI/lint/build pass, generated artifacts unchanged; publish/review follow-through authorized and tracked in the quick SUMMARY. |
| 2026-08-02 | 260802-q1o-corrigir-p2-da-pr-20-rejeitando-exemplos | Preserved schema-property ownership through `example`/`examples` in both API Docs security gates; paired regressions cover singular, array, map and nested forms while safe status examples remain accepted; artifacts unchanged. |
| 2026-07-23 | P12-POST-CLOSURE-PR7-R4 | Moved stale/reclaim policy to pure `checkout-completion/staleness.ts`; OperationalAlert consumes it; money path no longer imports alert module; focused + full regression PASS; two local commits; no push/deploy; Phase 12.1 not started. |
| 2026-07-23 | P12-POST-CLOSURE-PR7-R3 | Restricted OperationalAlert Admin reads to user actors via `requireAdminActor`; API-key actors rejected; focused HTTP/Unit + full regression PASS; two local commits; no push/deploy; Phase 12.1 not started. |
| 2026-07-23 | P12-POST-CLOSURE-PR7-R2 | Removed runtime `rtk` dependency from disposable PostgreSQL Docker harness; Cursor/WSL2 Docker proven; serial PG 5/5 + full regression PASS; two local commits; no push/deploy; Phase 12.1 not started. |
| 2026-07-23 | P12-POST-CLOSURE-PR1 | Corrected three Codex PR7 findings (refund replay audit, exchange reconciliation, alert scanner pagination); focused + full regression PASS; two local commits; no push/deploy; Phase 12.1 not started. |
| 2026-07-23 | phase-12-closure | Closed Phase 12 documentally after accepted execution, validation and human REVIEW; all 12 backend MVP phases closed; no Phase 13, milestone closeout, push or deploy. |
| 2026-07-16 | 260716-p3o-encerrar-formalmente-a-estabiliza-o-no-s | Estabilização formalmente encerrada; incidente monetário, versionamento automático e TLS do cache Redis resolvidos; fallbacks classificados e isolados; produção saudável; próximos passos obsoletos removidos. |
| 2026-07-16 | 260715-infra01-release-infrastructure | INFRA-01 PASS: release DB-only isolation and Redis production fail-fast; Unit 766/766, Modules 463/463, HTTP 172/172, lint 0/207, build PASS. CACHE-01A/B PASS; two local commits; no push/deploy. |
| 2026-06-25 | 260625-i9n-remover-canary-de-stripe-com-formato-rea | Removed a Stripe-shaped test canary from observability tests and rewrote the local 01-04 commit with autosquash so GitHub Push Protection can accept the branch push. |
| 2026-06-26 | 260626-hsr-heroku-supabase-redis-checkpoint | Documented the Heroku/Supabase/Redis deployment stabilization checkpoint and recorded the next cycle as production backend smoke test. |
| 2026-06-26 | 2026-06-26-production-backend-smoke | Validated production backend smoke on Heroku/Supabase/Redis with health, version, dynos, logs, public read-only routes, and no business-data mutation; Phase 01 is ready for closure while Phase 02 remains blocked. |
| 2026-06-26 | phase-01-closure | Closed Phase 01 with sanitized evidence, preserved the release-dyno Redis migration debt as deferred investigation, and left Phase 02 available only as the next manual-review-gated cycle. |
| 2026-06-26 | phase-02-planning | Planned only the Catalog & Media phase from the approved 02-CONTEXT.md, producing 5 execution plans plus validation strategy, while keeping execution blocked behind manual review. |
| 2026-06-27 | phase-02-closure | Closed Phase 02 documentally after reconciling validation, UAT, requirements, and the accepted plan summaries; Phase 03 remains not started. |
| 2026-06-27 | phase-03-verification | Automated UAT/validation for Phase 03 — 64 tests green, negative grep clean, build passing; manual closeout gate recorded in `03-UAT.md`. |
| 2026-06-27 | phase-03-closure | Closed Phase 03 documentally; CART-01..CART-04 complete; Phase 04 planning only as next permitted step. |
| 2026-06-29 | phase-04-planning | Planned Phase 04 into 6 manual-review-gated plans plus `04-VALIDATION.md`; no code, migrations, Stripe config, webhook, Order, purchase event, deploy, secrets/config, or Gelato work started. |
| 2026-06-29 | phase-04-closure | Closed Phase 04 documentally as pre-Order card/Pix PaymentAttempt implementation/test scope; production activation remains blocked by migration and real Stripe layer/config gates; Phase 05 not started. |
| 2026-06-30 | phase-05-validation-closeout | Closed Phase 05 at `05-04-SUMMARY.md` with green unit/integration/build, negative runtime proofs, documented future Stripe CLI smoke, and explicit manual gate before Phase 06. |
| 2026-06-30 | phase-05-closure | Human review accepted Phase 05 at manual gate; `05-CLOSURE.md` recorded; Phase 06 planning permitted with hard Order-creation constraint; execution not started. |
| 2026-06-30 | phase-06-closure | Closed Phase 06 documentally after accepted `06-01`..`06-05` evidence; `ORD-01`..`ORD-03` complete; Phase 07 planning-ready only, with execution still blocked. |
| 2026-07-01 | phase-07-planning | Planned Phase 07 into 3 manual-review-gated slices plus context, research and validation artifacts; later corrected payload grep scope and future PostHog lockfile handling documentally; no runtime, tests, migrations, Stripe CLI smoke, PostHog call, Email, Gelato, fulfillment, refund or tracking work started. |
| 2026-07-01 | phase-07-closure | Closed Phase 07 documentally after accepted `07-01`..`07-03` evidence; `ANL-01`..`ANL-03` complete; Phase 08 planning-ready only, execution blocked; Phase 09 blocked by dependencies. |
| 2026-07-01 | phase-08-planning | Planned Phase 08 into 3 manual-review-gated slices plus context, research and validation artifacts; no runtime, tests, migrations, install, Resend call, e-mail, PostHog call, Gelato, fulfillment, refund, exchange, tracking or Stripe CLI smoke started. |
| 2026-07-01 | phase-08-closure | Closed Phase 08 documentally after accepted `08-01`..`08-03` evidence; `EMAIL-01`..`EMAIL-02` complete; Phase 09 planning-ready only, execution blocked. |
| 2026-07-02 | phase-09-planning | Planned Phase 09 into 5 manual-review-gated slices plus context, research and validation artifacts; branch decision B recorded for `gsd/phase-09-gelato-fulfillment-webhook`; documentary blockers corrected before execution; no runtime, tests, migrations, install, package/lockfile change, real Gelato call/order/webhook/fulfillment, Resend call, PostHog call, refund, exchange, tracking, Stripe CLI smoke or Phase 10 work started. |
| 2026-07-02 | phase-09-validation | Final validation at `09-05-SUMMARY.md` — 92 tests green, build PASS, FUL-01..FUL-04 and WHK-03 evidenced, negative greps documented; manual gate before closure; Phase 10 not started. |
| 2026-07-02 | phase-09-closure | Closed Phase 09 documentally after accepted `09-01`..`09-05` evidence; `FUL-01`..`FUL-04` and `WHK-03` complete; branch decision B preserved; Phase 10 planning-ready only, execution blocked. |
| 2026-07-02 | phase-10-planning | Planned Phase 10 into 3 manual-review-gated slices plus context, research and validation artifacts; no runtime, tests, build, migration, deploy, real Gelato, real webhook smoke, refund, exchange, admin ops or Phase 11 work started. |
| 2026-07-02 | phase-10-closure | Closed Phase 10 documentally after accepted `10-01`..`10-03` evidence; `TRK-01` and `TRK-02` complete; Phase 11 blocked until explicit approval. |
| 2026-07-02 | phase-11-planning | Planned Phase 11 into 4 manual-review-gated slices plus context, research and validation artifacts; no runtime, tests, build, migration, deploy, real Stripe, real Gelato, Correios API, Stripe CLI smoke, broad Phase 12 alert/audit module, or Phase 12 work started. |
| 2026-07-08 | 260708-q76-propagar-erro-real-da-cria-o-de-order-no | Propagated sanitized real Order creation errors through `CheckoutCompletionLog`, `WebhookEventLog` and structured Stripe webhook logs; no Phase 12, migrations, package changes, real Stripe/Gelato/Correios or manual Order work. |
| 2026-07-09 | 260709-mkp-gate-tecnico-corrigir-amount-do-purchase | Corrected `purchase_completed` analytics amount normalization from `PaymentAttempt.amount`, preserving Order/PaymentAttempt creation and validating with focused unit tests plus build; no Phase 12, migrations, refund smoke, Stripe refund, `sk_live`, or real Stripe/Supabase/Gelato/Correios calls. |
| 2026-07-09 | 260709-qtj-gate-tecnico-corrigir-email-delivery-sup | Gated confirmation-email enqueue on complete Resend config, so an incomplete smoke provider preserves terminal Order and local analytics without resolving EmailDeliveryLog or calling Resend; no migration, package/config secret, real provider, or Phase 12 work. |
| 2026-07-09 | 260709-r41-gate-tecnico-substituir-id-fixo-anlevt-o | Removed the fixed AnalyticsEventLog preview ID before persistence, preserving PaymentIntent idempotency while letting the module generate unique IDs for distinct checkouts; no migration, package/config change, real provider, or Phase 12 work. |
| 2026-07-10 | 260710-dz0-gate-t-cnico-stripe-refund-smoke-test-mo | Completed and smoke-refund validated, no DB mutation occurred. |
| 2026-07-10 | 260710-iyt-corrigir-perda-de-contexto-this-do-refun | Preserved RefundRequest MedusaService method context in the Admin refund endpoint; context-dependent regression, 201/200 replay, related tests and build pass; remote Stripe smoke remains manually gated. |
| 2026-07-15 | 260715-rel01-runtime-version | Resolved runtime version from Heroku build/slug metadata before APP_VERSION, preserved PM2/VPS fallback, and passed env, health, Sentry, PM2, full unit, lint, build, and integrity gates without external actions. |
| 2026-07-03 | phase-11-closure | Closed Phase 11 documentally after accepted `11-01`..`11-04` evidence; `REF-01`..`REF-02`, `EXC-01`..`EXC-02` complete; Phase 12 blocked until explicit approval. |
| 2026-07-13 | 260710-rc1-estabilizacao-release-backend | RC1-H PASS: fixture discovery repaired; modules 28/28 and 454/454, HTTP 14/14 and 170/170, unit 43/43 and 676/676, lint 0/208, build/integrity/cleanup PASS; test commit `e45adf9`; no runtime, schema, provider, push or Phase 12 work. |
| 2026-07-13 | 260713-mny01-major-minor-units | MNY-01 PASS: Medusa/PaymentSession major units separated from Stripe/PaymentAttempt/custom minor units; exact conversion and Order guard proved; unit 717/717, modules 462/462, HTTP 170/170, lint/build/integrity/cleanup PASS; no production, schema, package, infra, push or Phase 12. |
