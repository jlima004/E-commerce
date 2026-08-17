---
phase: 14-customer-auth-verification
plan: 15
subsystem: auth
status: complete
completed: 2026-08-17
requirements: [AUTH-01, AUTH-02, AUTH-03, AUTH-09]
requirements-completed: []
---

# Phase 14: Customer Auth Verification — Plan 15 Summary

`14-15` is **HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED**.

This closure supersedes the awaiting-review status recorded in the pre-closure summary at technical head `10d7022cfd79781f52676d496454d9b4962f6072`. Detailed execution/remediation history remains preserved in Git history through that commit.

## Final governance status

```text
B14-15-HR-01: CLOSED — PASS
B14-15-HR-02: CLOSED — PASS
B14-15-HR-03: CLOSED — PASS
B14-15-HR-04: CLOSED — PASS

14-15-01: HUMAN APPROVED — PASS
14-15-02: HUMAN APPROVED — PASS
14-15-03: HUMAN APPROVED — PASS
14-15: HUMAN APPROVED — PASS
DOCUMENTALLY CLOSED

14-16: AUTHORIZED FOR EXECUTION / NOT STARTED
14-17..14-21: NOT AUTHORIZED

DEPLOY: NOT AUTHORIZED
REAL RESEND / REAL PROVIDERS: NOT AUTHORIZED
REMOTE DB / REDIS: NOT AUTHORIZED
FRONTEND: BLOCKED
```

AUTH-01/AUTH-02/AUTH-03/AUTH-09 are **not globally closed** by this plan. Later Phase 14 plans remain required.

## Published runtime surface

Plan 14-15 publishes the exact BFF-only customer auth surface:

| Method | Path | Contract |
|---|---|---|
| POST | `/auth/customer/emailpass/register` | signup; initial unverified lineage allowed only after Customer + lineage + verification/outbox |
| POST | `/auth/customer/emailpass` | login; unverified relogin cannot mint a new lineage |
| GET | `/store/customers/me` | allowlisted current-state behind PostgreSQL access guard |

Pre-existing Phase 14 enabled operations remain active:

- `POST /auth/token/refresh`
- `POST /auth/customer/emailpass/revoke-current-lineage`
- `POST /store/customers/me/verify`
- `POST /store/customers/verify/resend`
- `POST /store/customers/verify`
- `GET /store/customers/me/verify/status`

Raw Customer primitives, native auth session/callback/MFA, aliases, case/trailing-slash variants and unapproved reset/update paths remain DENY.

## Accepted signup/login/current-state invariants

- Signup rate limits execute before coordinator/lookup/write: `5/IP/15m + 3/email/h`.
- Login rate limits execute before provider/identity lookup: `10/(IP,email)/15m + 30/IP/15m`.
- Redis outage fails closed before lookup/mutation.
- Completed signup is terminal and maps to generic `409 AUTH_REQUEST_REJECTED`; signup never becomes login/session recovery.
- Initial signup may return its initial lineage while the account remains unverified.
- A later valid login for an unverified account returns `EMAIL_VERIFICATION_REQUIRED` and creates zero new lineage/JWT/refresh.
- Verified login may issue a new lineage through the previously approved session primitives.
- Login anti-enumeration uses the approved dummy scrypt/timing envelope; timing finalization is memoized and executes at most once even if timing itself rejects.
- `GET /store/customers/me` requires the PostgreSQL access guard and returns only the approved allowlist; identity/provider/lineage/version/token internals remain omitted.
- PostgreSQL remains validity authority; Redis never grants auth validity.
- Zero Order/Payment/Stripe/Gelato/cart/checkout/fulfillment side effects occur on these auth paths.

## BFF service authentication boundary

Human architecture review found that CORS alone could not enforce the approved invariant that the browser never calls Medusa directly. `B14-15-HR-02` therefore introduced and verified an explicit BFF service caller boundary.

Topology:

```text
Browser → same-origin Next.js BFF → x-indicio-bff-auth → Medusa
Browser → Medusa directly → generic deny before business mutation
```

The Next.js BFF itself remains **FUTURE OWNER-PHASE** and was not implemented.

Authorities remain separate and ordered:

1. Native CORS / publishable context — defense-in-depth only; not authorization.
2. Surface guard — exact method/path authority.
3. BFF service guard — server-to-server caller authority.
4. Customer access guard — JWT/lineage/credential truth where applicable.
5. Handler.

BFF credential contract:

- env: `CUSTOMER_AUTH_BFF_SERVICE_SECRET`
- header: `x-indicio-bff-auth`
- server-side only
- production required; minimum 32 characters; placeholder values rejected
- compared as SHA-256 digests using `timingSafeEqual`
- missing/invalid caller credential → generic `404`
- missing/invalid runtime secret → `503` fail-closed
- no fallback to Origin/CORS/publishable/IP/User-Agent/`bffAuthorized`
- never browser/log/persistence/response/Sentry/PostHog

The guard protects the exact currently enabled Phase 14 operation set; it is not mounted as a broad `/auth*` or `/store*` authorization prefix.

## Human-review blockers

### B14-15-HR-01 — CLOSED — PASS

Verified login originally bypassed the timing envelope; first remediation added the success path, and second remediation made timing structurally exactly-once by memoizing the timing Promise (`finishOnce`). Rejection of the timing Promise cannot cause a second timing invocation.

### B14-15-HR-02 — CLOSED — PASS

The original OPTIONS/CORS proof was insufficient. Runtime analysis proved CORS could hide a response while still allowing server-side mutation. Human architecture decision authorized the explicit BFF service authentication boundary described above. Browser/direct requests without the service credential now fail before business handler effects.

### B14-15-HR-03 — CLOSED — PASS

Predecessor verification and multiprocess suites were updated to assert the cumulative exact-set rather than stale pre-14-15 snapshots. The exact equality checks remain strict; predecessor 14-11/14-13 semantics were not weakened.

### B14-15-HR-04 — CLOSED — PASS

`.env.template` had a duplicate `CUSTOMER_AUTH_BFF_SERVICE_SECRET=` assignment. The duplicate was removed and `env.unit.spec.ts` now proves assignment cardinality equals exactly one. The summary/config contract also records the future production/BFF setup requirement.

## Final accepted validation

```text
BFF service auth unit:            PASS — 10/10
auth-customer.spec.ts:            PASS — 36/36
auth-verification.spec.ts:        PASS — 15/15
auth-multiprocess.spec.ts:        PASS — 10/10
combined focused Phase 14 HTTP:   PASS — 61/61
env.unit.spec.ts:                 PASS — 84/84
Backend build:                    PASS
Direct ESLint:                    PASS — 0 errors
git diff --check:                 PASS
Docker local PG/Redis cleanup:    PASS
```

Repository lint wrapper remains the previously accepted tooling-only failure:

```text
KNOWN TOOLING FAILURE — empty ESLint JSON / EOF while parsing
```

No package/tooling change was made to mask it.

## Technical commit history

Initial 14-15 execution:

1. `0c42b5c` — RED signup/login/me HTTP proofs
2. `e6e439a` — handlers
3. `7187381` — exact-set elevation
4. `1f431ea` — initial summary

Human-review remediation:

5. `bee24f4`
6. `3f55865`
7. `222a961`
8. `af30a91`
9. `c917ac8`
10. `68162ef`
11. `2561f6f`

BFF architecture remediation:

12. `342532d` — BFF RED proofs
13. `04b89b3` — BFF service authentication boundary
14. `ae0042c` — guard ordering/regressions
15. `67b4832` — architecture remediation documentation

Final config cleanup:

16. `10d7022cfd79781f52676d496454d9b4962f6072` — single BFF service-secret template contract

Technical branch was pushed by the human through `10d7022…` before documentary closure.

## Scope / negative evidence

- No migration/schema change.
- No package.json/lockfile/dependency change.
- No real Resend/provider traffic.
- No remote DB/Redis mutation.
- No deploy/release.
- No frontend implementation.
- No Next.js BFF implementation.
- No Heroku env change.

## 14-16 authorization

By explicit human authorization, `14-16-PLAN.md` is **AUTHORIZED FOR EXECUTION / NOT STARTED**.

The plan remains serial/manual-gated:

- `14-16-01` may execute the approved reset-domain/recovery/reconciler work and its unit/PostgreSQL evidence.
- `14-16-02` may expose only the approved reset overrides after its prerequisite domain evidence is satisfied.
- `14-16-03` remains a **BLOCKING HUMAN VERIFY** checkpoint. Execution must stop there.
- `14-17..14-21` remain **NOT AUTHORIZED**.

Binding carry-forward from 14-15: every newly enabled Phase 14 endpoint must remain behind the BFF service authentication boundary before business lookup/mutation. If executing the existing 14-16 plan requires a production file outside its approved file scope to preserve that boundary, execution must stop for an explicit scope amendment rather than expose an unguarded route.

Deploy/release, real providers, remote infrastructure and frontend remain unauthorized.

---
*Phase: 14-customer-auth-verification*
*Plan: 14-15*
*Status: HUMAN APPROVED — PASS / DOCUMENTALLY CLOSED; 14-16 AUTHORIZED FOR EXECUTION*