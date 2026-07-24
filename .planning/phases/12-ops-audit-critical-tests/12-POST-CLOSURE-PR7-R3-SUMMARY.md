# P12-POST-CLOSURE-PR7-R3 Summary

## Gate

```text
gate: P12-POST-CLOSURE-PR7-R3
PR: https://github.com/jlima004/E-commerce/pull/7
reviewer: chatgpt-codex-connector
reviewed commit: e7b94737a24c9715214ea62beee263e68162471d
finding: Require user actors for alert reads
priority: P2
classification: valid
```

## Base SHA

```text
e7b94737a24c9715214ea62beee263e68162471d
```

## Finding

```text
Require user actors for alert reads
```

## Diagnosis

Medusa Admin middleware can authenticate `/admin` routes with session, bearer, or
secret API key. For a secret API key, `auth_context` may be:

```ts
{ actor_id: "<api-key-id>", actor_type: "api-key" }
```

The local OperationalAlert guard
`assertOperationalAlertAdminAuthenticated` only required a non-empty
`actor_id`. It did **not** require `actor_type === "user"`.

Consequence: a valid secret API key could read OperationalAlert list/detail,
diverging from the user-only policy already applied to Admin refund/exchange
actions via `requireAdminActor`.

This is not missing global Admin middleware. Adding manual `authenticate(...)`
in `middlewares.ts` is out of scope and incorrect for this finding.

## Impact

```text
API-key actors: could pass the partial guard and consult listSafe/retrieveSafe
Admin user actors: already accepted
Missing auth: rejected, but with generic UNAUTHORIZED message
```

## Correction

Reuse the shared helper without changing it:

```text
requireAdminActor(req)
```

- List route: remove `assertOperationalAlertAdminAuthenticated`; call
  `requireAdminActor` before query parse / module resolve / `listSafe`.
- Detail route: import `requireAdminActor` from
  `../../_shared/require-admin-actor` (no dependency on the list route);
  call before ID validation / module resolve / `retrieveSafe`.
- Call sites use the same `MedusaRequest & { auth_context?: … }` cast as
  refund/exchange routes so TypeScript accepts `auth_context` (helper
  unchanged).

```text
API-key actors: rejected before service resolution
Admin user actors: accepted
middleware global: unchanged
schema/migrations: unchanged
```

## Technical paths

```text
apps/backend/src/api/admin/operational-alerts/route.ts
apps/backend/src/api/admin/operational-alerts/[id]/route.ts
apps/backend/integration-tests/http/admin-operational-alerts.spec.ts
```

Read-only reuse:

```text
apps/backend/src/api/admin/_shared/require-admin-actor.ts
```

## Focused tests

```text
Focused HTTP admin-operational-alerts.spec.ts: PASS (27)
Focused Unit audit-admin-action.unit.spec.ts (requireAdminActor): PASS (17)
```

HTTP regressions cover:

- valid user actor → 200; listSafe/retrieveSafe called
- missing/null auth → UNAUTHORIZED / ADMIN_ACTOR_REQUIRED; no resolve
- api-key actor → NOT_ALLOWED / ADMIN_ACTOR_TYPE_FORBIDDEN; no resolve
- empty user actor_id → UNAUTHORIZED / ADMIN_ACTOR_REQUIRED; no resolve

Body spoof proof remains in the shared helper unit suite.

## Full regression

```text
Full Unit: PASS (54 suites / 890 tests)
Full HTTP: PASS (19 suites / 240 tests)
Lint: PASS (0 errors / 210 pre-existing warnings)
Build: PASS (ADMIN_DISABLED=true)
Modules: not required (no module/schema/service changes; guard before resolve)
PostgreSQL disposable: not required
```

## Negative proofs

```text
rg assertOperationalAlertAdminAuthenticated under operational-alerts: empty
rg requireAdminActor under operational-alerts: route.ts + [id]/route.ts
rg api-key|ADMIN_ACTOR_TYPE_FORBIDDEN in HTTP spec: present
git diff --check: empty
package/lockfile/medusa-config/middlewares/jest/RTK.md/AGENTS.md vs base: no diff
schema/migrations/providers/frontend: unchanged
secrets displayed: no
```

## Commits

```text
technical: fix(admin): restrict operational alerts to user actors
documentary: docs(12): record PR7 alert authorization correction
```

## Git state

```text
branch: gsd/phase-12-ops-audit-critical-tests
base: e7b94737a24c9715214ea62beee263e68162471d
new commits: 2 (local only)
push: not executed
```

## Push / deploy status

```text
Push: not executed
Deploy: not executed
GitHub replies: not executed
Threads resolved: no
Codex re-review request: not executed
```

## Phase 12 closure reaffirmation

Phase 12 closure is reaffirmed by this third post-closure addendum.
Requirements remain 45/45 complete (OPS-01, OPS-02, TEST-01 complete).
The finding corrects a post-review authorization gap; it does not reopen
requirements.

## Phase 12.1 status

```text
Phase 12.1: not started / blocked pending PR update and re-review
```

## Result

```text
P12-POST-CLOSURE-PR7-R3: PASS
Finding classification: valid P2
Finding corrected: yes
Phase 12 closure: reaffirmed
Phase 12.1: not started / blocked
```

## Next permitted step

Separate authorization to push, reply to the Codex finding, and request a new
Codex review.
