---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Backend Storefront Readiness
current_phase: 14
current_phase_name: customer-auth-verification
current_plan: 16
status: ready
last_updated: "2026-08-17T20:04:00-03:00"
progress:
  total_phases: 10
  completed_phases: 1
  total_plans: 28
  completed_plans: 22
  percent: 11
stopped_at: 14-15 DOCUMENTARY CLOSURE COMPLETE — 14-16 AUTHORIZED FOR EXECUTION
---

# Project State

## Project Reference

See: `.planning/PROJECT.md`.

**Core value:** An Order exists and ships to Gelato only after reliable, validated, idempotent Stripe-webhook payment confirmation — no phantom charge, duplicate order or improper fulfillment.

**Current focus:** Phase 14 — `14-15 HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-16 AUTHORIZED FOR EXECUTION / NOT STARTED`.

## Execution Policy

Execution remains manual-review gated.

- `mode=interactive`
- `workflow.auto_advance=false`
- `workflow._auto_chain_active=false`
- `parallelization=false`

Human approval closes only the reviewed plan. The human has explicitly authorized execution of `14-16`; that authorization does not extend to `14-17` or any later plan.

## Current Gate

```text
Phase 14 CONTEXT: HUMAN APPROVED — PASS
Phase 14 RESEARCH: HUMAN APPROVED — PASS
Phase 14 PLAN: HUMAN APPROVED — PASS
Phase 14 SPEC/SDD: HUMAN APPROVED — PASS
Phase 14 IMPLEMENTATION PROMPT: HUMAN APPROVED — PASS

14-01..14-15: HUMAN APPROVED — PASS
14-07..14-15: DOCUMENTALLY CLOSED

B14-13-HR-01: CLOSED — PASS
B14-14-HR-01: CLOSED — PASS
B14-15-HR-01: CLOSED — PASS
B14-15-HR-02: CLOSED — PASS
B14-15-HR-03: CLOSED — PASS
B14-15-HR-04: CLOSED — PASS

14-15: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
14-16: AUTHORIZED FOR EXECUTION / NOT STARTED
14-17..14-21: NOT AUTHORIZED

Deploy: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```

## Current Position

Phase 14 (customer-auth-verification) remains **EXECUTING — SERIAL / MANUAL-GATED**.

- Phase 14 plans HUMAN APPROVED: **15/21**
- Phase 14 tasks complete: **45/63**
- Latest closed plan: **14-15 — HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**
- Next plan: **14-16 — AUTHORIZED FOR EXECUTION / NOT STARTED**
- `14-17..14-21`: **NOT AUTHORIZED**

Milestone v1.1:

- phases closed: 1/10
- Phase 13 requirements complete: FND-01..FND-08 = 8/8
- milestone requirements complete: 8/91
- plans human-approved executed: 22 total (Phase 13: 7; Phase 14: 15)
- frontend: BLOCKED

AUTH-01..AUTH-09 are not globally complete merely because 14-15 closed. Later Phase 14 plans remain required.

## Accepted Evidence References

Detailed evidence remains in the plan summaries:

- `.planning/phases/14-customer-auth-verification/14-07-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-08-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-09-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-10-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-11-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-12-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-13-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-14-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-15-SUMMARY.md`

## 14-15 Accepted Closure

Plan `14-15` is fully executed, remediated, verified, human approved and documentally closed.

Accepted invariants:

- signup/login limiters execute before lookup/write/provider according to approved thresholds;
- Redis outage fails closed before business mutation;
- completed signup remains terminal and is not login/session recovery;
- initial unverified signup may have its initial lineage, but unverified relogin creates zero new lineage/JWT/refresh;
- verified login may issue a new lineage;
- login timing finalization is structurally at-most-once even if the timing primitive rejects;
- `GET /store/customers/me` is allowlisted behind the PostgreSQL access guard;
- exact-set manifests remain strict; raw Customer/native auth aliases remain denied;
- browser-direct Phase 14 calls are denied before business handler by the explicit BFF service authentication boundary;
- CORS/publishable remain defense-in-depth, not authorization;
- BFF caller credential uses `CUSTOMER_AUTH_BFF_SERVICE_SECRET` / `x-indicio-bff-auth`, server-side only;
- BFF secret comparison uses SHA-256 digests + `timingSafeEqual`;
- `.env.template` contains exactly one BFF service secret assignment and the config contract is unit-tested;
- zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects.

Final accepted evidence:

```text
BFF service auth unit: PASS — 10/10
auth-customer: PASS — 36/36
auth-verification: PASS — 15/15
auth-multiprocess: PASS — 10/10
combined focused HTTP: PASS — 61/61
env.unit.spec.ts: PASS — 84/84
Backend build: PASS
Direct ESLint: 0 errors
git diff --check: PASS
Docker local PostgreSQL/Redis cleanup: PASS
Repository lint wrapper: KNOWN TOOLING FAILURE — empty JSON / EOF
```

Human-pushed technical head before documentary closure:

`10d7022cfd79781f52676d496454d9b4962f6072`

No migration/schema/dependency/real-provider/remote-infra/deploy/frontend work was authorized by the closure.

## BFF Boundary Carry-Forward

The Phase 14 runtime now has separate authorities:

1. Native CORS / publishable — defense-in-depth only.
2. Auth/Store surface guard — exact method/path authority.
3. BFF service guard — server-to-server caller authority.
4. Customer access guard — customer JWT/lineage/credential truth where applicable.
5. Handler.

Every Phase 14 endpoint newly enabled after 14-15 must remain behind the BFF service guard before business lookup/mutation. The future Next.js BFF is not implemented yet.

Production will eventually require `CUSTOMER_AUTH_BFF_SERVICE_SECRET`; no Heroku environment change is authorized by this state update.

## 14-16 Status — AUTHORIZED FOR EXECUTION

By explicit human authorization, `14-16-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

Plan objective: implement the composed password-reset flow with latest-wins intent handling, provider-result proof, global lineage revocation and fail-closed ambiguous recovery without persisting password/capability material.

Execution sequence:

- `14-16-01` is authorized to implement/reset-domain, reconciler, access/recovery behavior and unit/disposable-PostgreSQL proof according to the approved plan.
- `14-16-02` may expose only the approved reset request/confirm overrides after the prerequisite domain evidence passes and must preserve the 14-08 reset-confirm limiter/timing/dummy protocol.
- `14-16-03` remains a **BLOCKING HUMAN VERIFY** checkpoint. Execution must stop there.

Binding 14-16 restrictions:

- latest-wins reset and one claimant;
- success only after password proof + token consumption + all lineages revoked;
- provider timeout/ambiguity remains fail-closed;
- secretless reconciler cannot prove password or mark completed;
- only same `Idempotency-Key` retry with re-presented `newPassword` may resume/prove the operation;
- unverified account remains unverified and reset never creates a session;
- reset-confirm must apply approved 14-08 pre/post/dummy rate-limit/timing protocol before protected work;
- `AUTH_TEMPORARILY_UNAVAILABLE` remains distinct from legitimate `AUTH_RECOVERY_PENDING`;
- reset/update native behavior must not bypass the custom overrides;
- BFF service authentication remains mandatory before newly enabled reset business paths.

Important scope reconciliation rule: the approved 14-16 plan predates the 14-15 BFF architecture remediation. If preserving the mandatory BFF boundary requires a production file outside the current `14-16-PLAN.md` allowlist, the agent must stop for an explicit scope amendment rather than expose an unguarded route.

`14-17` and later plans are **NOT AUTHORIZED**.

## Hard Invariants Still in Force

- Order birth remains exclusive to the trusted canonical Stripe webhook.
- Browser/BFF/Store synchronous auth paths cannot create an Order.
- PostgreSQL is auth/session validity authority; Redis coordination never grants validity.
- Backend access JWT, backend refresh credential and internal auth/session capabilities do not cross the browser boundary except through the approved BFF contract.
- One-time verification/reset capabilities remain hash-only in backend persistence.
- Auth/session/email/provider failures do not rewrite payment, Order, analytics, order-email or Gelato truth.
- Frontend remains blocked until the backend storefront-readiness milestone permits it.

## Blockers / Concerns

No open blocker remains in the human-approved scope of `14-15`.

For `14-16`, stop conditions are those in `14-16-PLAN.md`, plus the BFF-boundary carry-forward above. Deploy, real providers, remote infrastructure and frontend remain unauthorized.

Historical provider limitations remain non-blocking and are not converted into authorization:

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

## Session Continuity

**Resume file:** `.planning/phases/14-customer-auth-verification/14-15-SUMMARY.md`

Last session: 2026-08-17T20:04:00-03:00

Stopped at:

```text
14-15: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED
14-16: AUTHORIZED FOR EXECUTION / NOT STARTED
14-17: NOT AUTHORIZED
DEPLOY: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
```

Resume with:

- `.planning/STATE.md`
- `.planning/phases/14-customer-auth-verification/14-15-SUMMARY.md`
- `.planning/phases/14-customer-auth-verification/14-16-PLAN.md`
- `.planning/phases/14-customer-auth-verification/14-IMPLEMENTATION-PROMPT.md`
- `.planning/phases/14-customer-auth-verification/14-SPEC.md`
- `.planning/phases/14-customer-auth-verification/14-SDD.md`
- `.planning/phases/14-customer-auth-verification/14-VALIDATION.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`

**Next permitted step:** execute `14-16-01` according to `14-16-PLAN.md`; proceed serially through `14-16-02` only after its prerequisite evidence, then stop at `14-16-03` for blocking human review.

Do not automatically start `14-17`, deploy, exercise real providers, alter remote infrastructure, start frontend, or move/recreate tag `v1.0`.
