---
phase: 13-storefront-contract-foundation-surface-lockdown
plan: 01
subsystem: api
tags: [store-surface, manifest, scanner, transaction, cas, postgres, medusa-2.16.0]

requires:
  - phase: 12
    provides: disposable PostgreSQL harness and CheckoutCompletionLog module used as controlled Medusa mutation subject
provides:
  - Closed Store surface manifest SSOT (58 ops, Medusa 2.16.0)
  - Exact-set installed-route scanner with Phase 13 M1 guards
  - Wave 0 proof that Medusa mutation + version CAS share one PostgreSQL TM/commit
affects:
  - 13-02-storefront-contract-foundation-surface-lockdown
  - 13-04-storefront-contract-foundation-surface-lockdown
  - 13-05-storefront-contract-foundation-surface-lockdown
  - 13-06-storefront-contract-foundation-surface-lockdown

tech-stack:
  added: []
  patterns:
    - Dual classification/runtime_policy Store surface entries with per-route rationale
    - Disposable probe tables for transactional feasibility without product migrations
    - PostgreSQL CAS as truth; Redis locking optional and non-authoritative

key-files:
  created:
    - apps/backend/src/api/store-surface/manifest.ts
    - apps/backend/scripts/store-surface/scan-installed.ts
    - apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts
    - apps/backend/src/infrastructure/store-foundation-transaction-compatibility.ts
    - apps/backend/src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts
    - .planning/phases/13-storefront-contract-foundation-surface-lockdown/13-01-SUMMARY.md
  modified: []

key-decisions:
  - "PRESERVE_LEGACY reserved for 7 Store 1.0.0-accepted routes; all other EXTENDED/OUTSIDE get DENY with individual rationale"
  - "attach remains BLOCKED+DENY despite prior Store 1.0.0 exposure (merge contract blocked)"
  - "Wave 0 uses CheckoutCompletionLog create as controlled Medusa mutation joining shared TM; probe tables only in disposable DB"
  - "Scanner verify uses npm exec ts-node because workspace hoisting omits apps/backend/node_modules/.bin/ts-node"

patterns-established:
  - "Store surface SSOT lives only in manifest.ts; scanners/guards/OpenAPI consume the same export"
  - "BLOCKED â‡’ DENY mandatory; EXTENDED/OUTSIDE never imply a universal runtime_policy"
  - "Transactional foundation feasibility proven before StoreResourceVersion module/migration"

# Evidence produced in 13-01 (not completion â€” Phase 13 still requires later plans):
# FND-01: 13-01 + 13-02 + 13-07
# FND-06: 13-01 + 13-05 + 13-07
requirements-completed: []
requirements-evidenced: [FND-01, FND-06]

duration: 7min
completed: 2026-08-08
status: human-approved-pass
---

# Phase 13 Plan 01: Surface Manifest & Feasibility Gate Summary

**Closed Medusa 2.16.0 Store surface SSOT (58 ops, 0/10/17/31, DENY=51/PRESERVE_LEGACY=7) plus Wave 0 proof that Medusa mutation and version CAS share one PostgreSQL transaction manager**

## Identity

Plan: 13-01  
Status: HUMAN APPROVED â€” PASS
Branch: `gsd/phase-13-storefront-contract-foundation-surface-lockdown`  
PHASE13_EXECUTION_BASE_SHA: `1c6a1dfcea4c74db4dd988a733213f103b5447f4`  
Pre-plan HEAD: `1c6a1dfcea4c74db4dd988a733213f103b5447f4`  
Post-plan implementation commit(s):
- `0e93d9d` â€” feat(13-01): lock Store surface manifest and exact-set scanner
- `ce1ce38` â€” feat(13-01): prove Wave 0 shared transaction manager and CAS

Post-R1 correction commit(s):
- `aad75bc` â€” fix(13-01): prove CAS rollback after executed update
- `8948af5` â€” docs(13-01): reconcile R1 review findings

## Performance

- **Duration:** ~7 min
- **Started:** 2026-08-08T00:59:10Z
- **Completed:** 2026-08-08T01:06:30Z
- **Tasks:** 2 automated + 1 human checkpoint (PASS)
- **Files modified:** 5 product + 1 SUMMARY

## Accomplishments

- Materialized the closed 58-operation Store surface manifest as the single SSOT with independent `classification`, `runtime_policy`, `m1_enablement`, `openapi_m1_expectation`, and non-empty `rationale`.
- Added a read-only exact-set scanner that discovers 51 native + 7 local non-overlapping operations against Medusa 2.16.0 and fails closed on drift/invalid combos/M1_ENABLED.
- Proved Wave 0 binary feasibility: same transaction manager identity, same `txid_current()`, joint commit/rollback, exactly one CAS winner, Redis locking absent/failing.

## Surface inventory (exact counts)

| Metric | Count |
|---|---:|
| runtime Store operations | 58 |
| native (incl. native+local_extension) | 51 |
| local non-overlapping | 7 |
| native+local_extension (products) | 2 |
| AUTHORIZED | 0 |
| EXTENDED | 10 |
| BLOCKED | 17 |
| OUTSIDE_FRONTEND_M1 | 31 |
| UNKNOWN | 0 |
| runtime_policy DENY | 51 |
| runtime_policy PRESERVE_LEGACY | 7 |
| runtime_policy M1_ENABLED | 0 |
| m1_enablement enabled | 0 |

PRESERVE_LEGACY keys (Store 1.0.0 accepted v1.0 behavior only):

1. `GET /store/products` â€” EXTENDED
2. `GET /store/products/{id}` â€” EXTENDED
3. `GET /store/carts/active` â€” EXTENDED
4. `POST /store/carts/active` â€” EXTENDED
5. `POST /store/carts/{id}/payment-attempts/card` â€” EXTENDED
6. `POST /store/carts/{id}/payment-attempts/pix` â€” OUTSIDE_FRONTEND_M1
7. `POST /store/tracking/lookup` â€” OUTSIDE_FRONTEND_M1

Notable BLOCKED+DENY despite prior Store 1.0.0 exposure: `POST /store/customers/me/cart/attach`.  
Scaffold `GET /store/custom` is BLOCKED+DENY.

## Manifest invariants

- Exact-set 58/58; 0 duplicates; 0 unknown installed routes
- Distribution AUTHORIZED/EXTENDED/BLOCKED/OUTSIDE = 0/10/17/31
- Every entry has classification + runtime_policy + rationale + openapi_m1_expectation
- BLOCKED â‡’ DENY (mandatory)
- DENY + PRESERVE_LEGACY = 58
- Phase 13: M1_ENABLED policy count = 0; m1_enablement enabled = 0
- No class-wide inference for EXTENDED/OUTSIDE beyond individual DENY|PRESERVE_LEGACY decisions
- Medusa package version locked to `2.16.0`

## Wave 0 evidence

| Claim | Result | Evidence |
|---|---|---|
| Manager identity | PASS | `transactionManager === activeManager === mutationManager === casManager`; identity tokens equal |
| Same PostgreSQL transaction | PASS | `txid_current()` identical across mutation and CAS (`sameTransactionId=true`) |
| Single atomic commit | PASS | CheckoutCompletionLog row + probe mutation row + version bump all present after success |
| Atomic rollback | PASS | CAS successfully executed inside same transaction; injected failure occurred after successful CAS and before commit; external post-rollback reads prove Medusa row=0, probe mutation=0, version restored to original |
| CAS concurrency | PASS | Two writers same `expectedVersion` â†’ exactly one winner, one `STORE_FOUNDATION_CAS_CONFLICT` |
| Redis independence | PASS | Disposable env Redis URLs empty; failing locking coordinator; CAS still correct |

Controlled Medusa mutation subject: `checkoutCompletion.createCheckoutCompletionLogs(..., sharedContext)`.  
Probe tables (`store_foundation_tx_probe_mutation`, `store_foundation_tx_probe_version`) created only in disposable DB â€” no product migration.

### Atomic rollback (R1 corrected contract)

```text
Atomic rollback: PASS

Evidence:
CAS successfully executed inside same transaction (onCasSucceeded + in-tx version read 3â†’4);
injected failure occurred after successful CAS and before commit (injectErrorAfterCas);
external post-rollback reads prove:
Medusa row=0,
probe mutation=0,
version restored to original (3).
```

## Tests

### Unit â€” manifest

```text
Command: cd apps/backend && npm run test:unit -- --runTestsByPath src/api/store-surface/__test²È="25ÍÁ•Œ¹ÑÌ€´µÉÕ¹%¹	…¹)á¥Ğ½‘”è€À)MÕ¥Ñ•Ìè€ÄÁ…ÍÍ•°€ÄÑ½Ñ…°)Q•ÍÑÌè€ØÁ…ÍÍ•°€ØÑ½Ñ…°)I•ÍÕ±ĞèAML)€((ŒŒM½Á”()ğ¡•¬ğI•ÍÕ±Ğğ)ğ´´µğ´´µğ)ğ±±½İ±¥ÍÑ•ÁÉ½‘ÕĞ™¥±•Ì½¹±äğeLƒŠP€Ô™¥±•Ìğ)ğU¹•áÁ•Ñ•ÁÉ½‘ÕĞ™¥±•Ìğ9=9ğ)ğÁ…­…”¹©Í½¸€¼Á…­…”µ±½¬¹©Í½¸ğ9=P5=%%ğ)ğµ•‘ÕÍ„µ½¹™¥œ¹ÑÌğ9=P5=%%ğ)ğAÉ½‘ÕĞµ¥É…Ñ¥½¸ğ9=9ğ)ğI•µ½Ñ”ğ9=9€¡‘¥ÍÁ½Í…‰±”½¹±ä¤ğ)ğAÉ½Ù¥‘•È€¼‘•Á±½ä€¼™É½¹Ñ•¹ğ9=9ğ)ğ=Á•¹A$É•¥ÍÑÉä½)M=8ğ9=P5=%%ğ)ğ¹Á´¥¹ÍÑ…±°ğ9=PIU8ğ((ŒŒ¥Ğ()	É…¹ èÍ½Á¡…Í”´ÄÌµÍÑ½É•™É½¹Ğµ½¹ÑÉ…Ğµ™½Õ¹‘…Ñ¥½¸µÍÕÉ™…”µ±½­‘½İ¹€€€)HÄ¥µÁ±•µ•¹Ñ…Ñ¥½¸½‘½Õµ•¹Ñ…Ñ¥½¸½µµ¥ÑÌİ•É”ÁÕÍ¡•‰•™½É”Ñ¡¥Ì½Ù•É¹…¹”Íå¹¡É½¹¥é…Ñ¥½¸¸9¼AH¸()ğ½µµ¥Ğğ5•ÍÍ…”ğ)ğ´´µğ´´µğ)ğ€Á”äÍå‘€ğ™•…Ğ ÄÌ´ÀÄ¤è±½¬MÑ½É”ÍÕÉ™…”µ…¹¥™•ÍĞ…¹•á…ĞµÍ•ĞÍ…¹¹•Èğ)ğ”Å”Ìá€ğ™•…Ğ ÄÌ´ÀÄ¤èÁÉ½Ù”]…Ù”€ÀÍ¡…É•ÑÉ…¹Í…Ñ¥½¸µ…¹…•È…¹Lğ()U¹É•±…Ñ•‘¥ÉÑä™¥±”±•™ĞÕ¹Ñ½Õ¡•è€¹Á±…¹¹¥¹œ½MQQ¹µ‘€€¡‰•¥¸µÁ¡…Í”‰½½­­••Á¥¹œ¤¸((ŒŒQ…Í¬½µµ¥ÑÌ((Ä¸€¨©Q…Í¬€Äè¥á…Èµ…¹¥™•ÍĞƒé¹¥¼”Í…¹¹•È•á…ĞµÍ•Ğ¨¨ƒŠP€Á”äÍå‘€€¡™•…Ğ¤(È¸€¨©Q…Í¬€Èèá•ÕÑ…È]…Ù”€À‰¥»…É¥„‘”ÑÉ…¹Í‡Ÿ¼½µÁ…ÉÑ¥±¡…‘„”L¨¨ƒŠP”Å”Ìá€€¡™•…Ğ¤(Ì¸€¨©Q…Í¬€ÌèI•Ù¥Í…È¼É•ÍÕ±Ñ…‘¼‰¥»…É¥¼‘„]…Ù”€À¨¨ƒŠP!U58IY%\AML((ŒŒ•¥Í¥½¹Ì5…‘”((´AIMIY}1d±¥µ¥Ñ•Ñ¼Ñ¡”Í•Ù•¸MÑ½É”€Ä¸À¸Àµ…•ÁÑ•É½ÕÑ•Ì±¥ÍÑ•…‰½Ù”ì…±°É•µ…¥¹¥¹œaQ9½=UQM%¥¹‘¥Ù¥‘Õ…±±ä9d¸(´A=MP€½ÍÑ½É”½ÕÍÑ½µ•ÉÌ½µ”½…ÉĞ½…ÑÑ…¡€­•ÁĞ	1=-­9d€¡µ•É”½¹ÑÉ…Ğ¹½ĞÉ”µ…ÕÑ¡½É¥é•¤¸(´]…Ù”€ÀÕÍ•Ì¡•­½ÕÑ½µÁ±•Ñ¥½¹1½œ…ÌÑ¡”½¹ÑÉ½±±•5•‘ÕÍ„İÉ¥Ñ”©½¥¹•Ù¥„Í¡…É•‘½¹Ñ•áĞ¹ÑÉ…¹Í…Ñ¥½¹5…¹…•É€ì™½Õ¹‘…Ñ¥½¸ÁÉ½‰”Ñ…‰±•ÌÍÑ…ä‘¥ÍÁ½Í…‰±”µ½¹±ä¸(´M…¹¹•È1$Ù•É¥™¥•Ù¥„¹Á´•á•Œ€´´ÑÌµ¹½‘•€‘Õ”Ñ¼İ½É­ÍÁ…”‰¥¸¡½¥ÍÑ¥¹œ¸((ŒŒ•Ù¥…Ñ¥½¹Ì™É½´A±…¸((ŒŒŒÕÑ¼µ™¥á•%ÍÍÕ•Ì((¨¨Ä¸mIÕ±”€Ì€´	±½­¥¹tM…¹¹•ÈÁ…Ñ ÁÉ•™¥à½µ¥ÑÑ•€½ÍÑ½É•€¨¨(´€¨©½Õ¹‘ÕÉ¥¹œè¨¨Q…Í¬€ÄÙ•É¥™¥…Ñ¥½¸(´€¨©%ÍÍÕ”è¨¨…¹½¹¥…±¥é…Ñ¥½¸ÕÍ•…Á¥I½½Ğ…±É•…‘ä•¹‘¥¹œ…Ğ€¸¸¸½ÍÑ½É•€°ÁÉ½‘Õ¥¹œ€½…ÉÑÍ€¥¹ÍÑ•…½˜€½ÍÑ½É”½…ÉÑÍ€¸(´€¨©¥àè¨¨AÉ•Á•¹€½ÍÑ½É•€¥¸…¹½¹¥…±¥é•A…Ñ¡Q•µÁ±…Ñ•€¸(´€¨©¥±•Ìµ½‘¥™¥•è¨¨…ÁÁÌ½‰…­•¹½ÍÉ¥ÁÑÌ½ÍÑ½É”µÍÕÉ™…”½Í…¸µ¥¹ÍÑ…±±•¹ÑÍ€(´€¨©½µµ¥ÑÑ•¥¸è¨¨€Á”äÍå‘€((¨¨È¸mIÕ±”€Ì€´	±½­¥¹tA±…¸Ù•É¥™äÁ…Ñ €¸½¹½‘•}µ½‘Õ±•Ì¼¹‰¥¸½ÑÌµ¹½‘•€µ¥ÍÍ¥¹œ¨¨(´€¨©½Õ¹‘ÕÉ¥¹œè¨¨Q…Í¬€ÄÙ•É¥™¥…Ñ¥½¸(´€¨©%ÍÍÕ”è¨¨¹Á´İ½É­ÍÁ…•Ì¡½¥ÍĞ‰¥¹…É¥•ÌÑ¼É•Á¼É½½Ğì…ÁÁÌ½‰…­•¹½¹½‘•}µ½‘Õ±•Ì¼¹‰¥¹€‘½•Ì¹½Ğ•á¥ÍĞ¸(´€¨©¥àè¨¨UÍ•¹Á´•á•Œ€´´ÑÌµ¹½‘”€´µÍİŒ€¸¸¹€€¡•ÍÑ…‰±¥Í¡•=Á•¹A$ÍÉ¥ÁĞÁ…ÑÑ•É¸¤¸9¼Á…­…”½±½­™¥±”¡…¹•Ì¸(´€¨©¥±•Ìµ½‘¥™¥•è¨¨¹½¹”€¡¥¹Ù½…Ñ¥½¸½¹±ä¤(´€¨©½µµ¥ÑÑ•¥¸è¨¨¸½„€¡‘½Õµ•¹Ñ•¤((¨©Q½Ñ…°‘•Ù¥…Ñ¥½¹Ìè¨¨€È…ÕÑ¼µ™¥á•€¡IÕ±”€Ìƒ\È¤€€(¨©%µÁ…Ğ½¸Á±…¸è¨¨½ÉÉ•Ñ¹•ÍÌµ½¹±äì¹¼Í½Á”É••Àì¹¼…É¡¥Ñ•ÑÕÉ…°¡…¹”¸((ŒŒ%ÍÍÕ•Ì¹½Õ¹Ñ•É•()9½¹”‰•å½¹Ñ¡”‘•Ù¥…Ñ¥½¹Ì…‰½Ù”¸((ŒŒ-¹½İ¸MÑÕ‰Ì()9½¹”ƒŠPµ…¹¥™•ÍĞ¥Ì½µÁ±•Ñ”ì]…Ù”€À…‘…ÁÑ•È¥Ì„™•…Í¥‰¥±¥ÑäÁÉ½‰”€¡¥¹Ñ•¹Ñ¥½¹…°¹½¸µÁÉ½‘ÕĞµ½‘Õ±”¤…¹‘½•Ì¹½ĞÍÑÕˆMÑ½É•I•Í½ÕÉ•Y•ÉÍ¥½¸¸((ŒŒQ¡É•…Ğ±…Ì()9½¹”‰•å½¹Ñ¡”Á±…¸Ñ¡É•…Ğµ½‘•°¸M…¹¹•È¥ÌÉ•…µ½¹±äìÁÉ½‰”Ñ…‰±•Ì…É”‘¥ÍÁ½Í…‰±”µ½¹±äì¹¼¹•Ü¹•Ñİ½É¬•¹‘Á½¥¹ÑÌ¸((ŒŒUÍ•ÈM•ÑÕÀI•ÅÕ¥É•()9½¹”€´¹¼•áÑ•É¹…°Í•ÉÙ¥”½¹™¥ÕÉ…Ñ¥½¸É•ÅÕ¥É•¸((ŒŒ9•áĞA¡…Í”I•…‘¥¹•ÍÌ((´9´ÀÄè€ÄÌ´ÀÄ•Ù¥‘•¹”ÁÉ½‘Õ•€¡•á…ĞµÍ•ĞMM=P€¬Í…¹¹•È¤¸9½Ğ½µÁ±•Ñ”ƒŠPÍÑ¥±°É•ÅÕ¥É•Ì€ÄÌ´ÀÈ€¬€ÄÌ´ÀÜ¸(´9´ÀØè]…Ù”€ÀÁÉ•É•ÅÕ¥Í¥Ñ”•Ù¥‘•¹”ÁÉ½‘Õ•€¡Í¡…É•Q4€¬L€¬½ÉÉ•Ñ•É½±±‰…¬¤¸9½Ğ½µÁ±•Ñ”ƒŠPÍÑ¥±°É•ÅÕ¥É•Ì€ÄÌ´ÀÔ€¬€ÄÌ´ÀÜ¸(´A¡…Í”€ÄÌÉ•ÅÕ¥É•µ•¹ÑÌ½µÁ±•Ñ”è€À¼à(´5¥±•ÍÑ½¹”É•ÅÕ¥É•µ•¹ÑÌ½µÁ±•Ñ”è€À¼äÄ(´A±…¹Ì•á•ÕÑ•è€Ä¼Ü(´€¨©@ÄÌ´ÄÌ´ÀÄµHÄ!U58IµIY%\èAML¨¨ƒŠP€ÄÌ´ÀÄ¥Ì¡Õµ…¸µ…ÁÁÉ½Ù•¸(´€¨¨ÄÌ´ÀÈƒŠP…¥°µ±½Í•MÑ½É”1½­‘½İ¸èaUQ%=8UQ!=I%i¨¨‰ä•áÁ±¥¥Ğ¡Õµ…¸…Ñ”¸(´á•ÕÑ¥½¸Í½Á”¥Ì¹½Ü±¥µ¥Ñ•Ñ¼…ÕÑ¡½É¥é•€ÄÌ´ÀÉ€ì‘¼¹½ĞÍÑ…ÉĞ€ÄÌ´ÀÌ¬°¥‘•µÁ½Ñ•¹ä°É•Í½ÕÉ”µÙ•ÉÍ¥½¸°=Á•¹A$€Ä¸Ä¸À°‘•Á±½ä°½ÈÉ½¹Ñ•¹4Ä¸((ŒŒ!Õµ…¸I•Ù¥•ÜHÄ½ÉÉ•Ñ¥½¸()=É¥¥¹…°¡Õµ…¸É•Ù¥•Üè€¨©HÄIEU%I¨¨()	±½­•ÉÌè(´ÄÌ´ÀÄµHÄ´ÀÄÉ½±±‰…¬LÁÉ½½˜(´ÄÌ´ÀÄµHÄ´ÀÈÁÉ•µ…ÑÕÉ”É•ÅÕ¥É•µ•¹Ğ½µÁ±•Ñ¥½¸(´ÄÌ´ÀÄµHÄ´ÀÌÍÑ…±”MQQ½I=5@()]…É¹¥¹œè(´\ÄÌ´ÀÄµHÄ´ÀÄ…Ñ…±½œ½İ¹•É}Á¡…Í”É•½¹¥±¥…Ñ¥½¸((ŒŒŒHÄ½ÉÉ•Ñ¥½¹Ì…ÁÁ±¥•()ğ¥¹‘¥¹œğI•ÍÕ±Ğğ)ğ´´µğ´´µğ)ğÄÌ´ÀÄµHÄ´ÀÄğ%aƒŠP¥¹©•ÑÉÉ½É™Ñ•É…Í€…™Ñ•ÈÍÕ•ÍÍ™Õ°Lì½¹…ÍMÕ••‘•‘€€¬¥¸µÑàÙ•ÉÍ¥½¸Ù•É¥™äÁÉ½Ù”L•á•ÕÑ•ìÁ½ÍĞµÉ½±±‰…¬5•‘ÕÍ„½ÁÉ½‰”½Ù•ÉÍ¥½¸…±°É•ÍÑ½É•ğ)ğÄÌ´ÀÄµHÄ´ÀÈğ%aƒŠPÉ•ÅÕ¥É•µ•¹ÑÌµ½µÁ±•Ñ•èmu€ì9´ÀÄ½9´ÀØÉ•½É‘•…Ì•Ù¥‘•¹•½¹±äğ)ğÄÌ´ÀÄµHÄ´ÀÌğ%aƒŠPMQQ½I=5@ÕÉÉ•¹Ğ…Ñ”Íå¹¡É½¹¥é•Ñ¼€ÄÌ´ÀÄHÄ…İ…¥Ñ¥¹œ¡Õµ…¸É”µÉ•Ù¥•Üğ)ğ\ÄÌ´ÀÄµHÄ´ÀÄğ=IIQ]%Q UQ!=I%QdƒŠPÍ•”…Ñ…±½œ½İ¹•É}Á¡…Í”É•½¹¥±¥…Ñ¥½¸ğ((ŒŒŒ…Ñ…±½œ½İ¹•É}Á¡…Í”É•½¹¥±¥…Ñ¥½¸()Ñ•áĞ)…Ñ…±½œ½İ¹•É}Á¡…Í”É•½¹¥±¥…Ñ¥½¸è)=IIQ]%Q UQ!=I%Qd()=İ¹•Èè(ÈÄ()AÉ•Ù¥½ÕÌ€¡¥¹½ÉÉ•Ğ¤è(ÄØ()ÕÑ¡½É¥Ñäè(´€¹Á±…¹¹¥¹œ½I=5@¹µA¡…Í”€ÈÄ€ô=É‘•È½¹™¥Éµ…Ñ¥½¸€˜…Ñ…±½œ!…¹‘½™˜€¡P´ÀÄ¸¹P´ÀĞ¤(´€¹Á±…¹¹¥¹œ½IEU%I59QL¹µA¡…Í”€ÈÄP´ÀÄ¸¹P´ÀĞ€¡…Ñ…±½œ¡…¹‘±”½Q<½É•Ù…±¥‘…Ñ¥½¸¤(´€ÄÌµIMI ¹µƒ
œÄà½İ¹ÍÑÉ•…´¥¹‘¥¹ÌA¡…Í”€ÈÄ=É‘•È½…Ñ…±½œè(€€‰AÉ½‘ÕĞÉ½ÕÑ•ÌÁÉ•Í•ÉÙ…´Í•É¥…±¥é•È…ÑÕ…°ˆ(´€ÄÌµMA¹µ€¼€ÄÌµ=9QaP¹µèA¡…Í”€ÄØ€ôµ•É”½É•Ù¥•Ü½¹±äì(€A¡…Í”€ÈÄ€ô½É‘•ÈÍÕµµ…Éä€¼…Ñ…±½œÉ•Ù…±¥‘…Ñ¥½¸()I•…Í½¸è)9¼…ÁÁÉ½Ù•…ÕÑ¡½É¥Ñä…ÍÍ¥¹ÌP€½ÍÑ½É”½ÁÉ½‘ÕÑÌ½ÈP€½ÍÑ½É”½ÁÉ½‘ÕÑÌ½í¥‘ô)Ñ¼A¡…Í”€ÄØ€¡…ÉĞ5•É”€˜I•Ù¥•Ü¤¸…Ñ…±½œ4Ä½İ¹•ÉÍ¡¥À…¹ÁÉ½‘ÕĞµÉ½ÕÑ”)ÁÉ•Í•ÉÙ…Ñ¥½¸…É”‰½Õ¹Ñ¼A¡…Í”€ÈÄ¸±…ÍÍ¥™¥…Ñ¥½¸°ÉÕ¹Ñ¥µ•}Á½±¥ä°)´Å}•¹…‰±•µ•¹Ğ°½Á•¹…Á¤•áÁ•Ñ…Ñ¥½¸°…¹€ÔàµÉ½ÕÑ”•á…ĞµÍ•ĞÕ¹¡…¹•¸)€((ŒŒŒ!Õµ…¸É”µÉ•Ù¥•ÜÉ•ÍÕ±Ğ()Ñ•áĞ)@ÄÌ´ÄÌ´ÀÄµHÄ!U58IµIY%\èAML)HÄ‰±½­•ÉÌ½ÉÉ•Ñ•è€Ì¼Ì)HÄİ…É¹¥¹Ì½ÉÉ•Ñ•è€Ä¼Ä)9•Ü¡Õµ…¸µÉ•Ù¥•Ü‰±½­•ÉÌè€À)9•Ü¡Õµ…¸µÉ•Ù¥•Üİ…É¹¥¹Ìè€À(ÄÌ´ÀÄè!U58AAI=YƒŠPAML(ÄÌ´ÀÈè1%%	1=HMAIQUQ!=I%iQ%=8)€()MÕ‰Í•ÅÕ•¹Ğ•áÁ±¥¥Ğ¡Õµ…¸…Ñ”è€ÄÌ´ÀÈƒŠP…¥°µ±½Í•MÑ½É”1½­‘½İ¹€€¨©aUQ%=8UQ!=I%i¨¨¸((ŒŒŒHÄ]…Ù”€ÀÉ•Ù…±¥‘…Ñ¥½¸()Ñ•áĞ)½µµ…¹è…ÁÁÌ½‰…­•¹€˜˜¹½‘”ÍÉ¥ÁÑÌ½ÉÕ¸µ‘¥ÍÁ½Í…‰±”µÁ½ÍÑÉ•ÌµÑ•ÍÑÌ¹µ©Ì€´´¹Á´ÉÕ¸Ñ•ÍĞé¥¹Ñ•É…Ñ¥½¸éµ½‘Õ±•Ì€´´€´µÉÕ¹Q•ÍÑÍ	åA…Ñ ÍÉŒ½µ½‘Õ±•Ì½¡•­½ÕĞ½}}Ñ•ÍÑÍ}|½ÍÑ½É”µ™½Õ¹‘…Ñ¥½¸µÑÉ…¹Í…Ñ¥½¸µ½µÁ…Ñ¥‰¥±¥Ñä¹ÍÁ•Œ¹ÑÌ€´µÉÕ¹%¹	…¹)á¥Ğ½‘”è€À)MÕ¥Ñ•Ìè€ÄÁ…ÍÍ•°€ÄÑ½Ñ…°)Q•ÍÑÌè€ØÁ…ÍÍ•°€ØÑ½Ñ…°)I•ÍÕ±ĞèAML)€((ŒŒŒHÄµ…¹¥™•ÍĞÉ•É•ÍÍ¥½¸()Ñ•áĞ)½µµ…¹è…ÁÁÌ½‰…­•¹€˜˜¹Á´ÉÕ¸Ñ•ÍĞéÕ¹¥Ğ€´´€´µÉÕ¹Q•ÍÑÍ	åA…Ñ ÍÉŒ½…Á¤½ÍÑ½É”µÍÕÉ™…”½}}Ñ•ÍÑÍ}|½µ…¹¥™•ÍĞ¹Õ¹¥Ğ¹ÍÁ•Œ¹ÑÌ€´µÉÕ¹%¹	…¹)á¥Ğ½‘”è€À)MÕ¥Ñ•Ìè€ÄÁ…ÍÍ•°€ÄÑ½Ñ…°)Q•ÍÑÌè€àÁ…ÍÍ•°€àÑ½Ñ…°)I•ÍÕ±ĞèAML()M…¹¹•ÈèMQ=I}MUI}M9}=,ƒŠP€Ôà¼Ôà°€À¼ÄÀ¼ÄÜ¼ÌÄ°9dôÔÄ°AIMIY}1dôÜ°4Å}9	1ôÀ)€((ŒŒ…Ñ”()Ñ•áĞ)@ÄÌ´ÄÌ´ÀÄµHÄè!U58IµIY%\AML(ÄÌ´ÀÄè!U58AAI=YƒŠPAML(ÄÌ´ÀÈèaUQ%=8UQ!=I%i(ÄÌ´ÀÌ¸¸ÄÌ´ÀÜè9=PUQ!=I%i)•Á±½äè9=PUQ!=I%i)É½¹Ñ•¹4Äè	1=-)A¡…Í”€ÄÌÉ•ÅÕ¥É•µ•¹ÑÌ½µÁ±•Ñ”è€À¼à)5¥±•ÍÑ½¹”É•ÅÕ¥É•µ•¹ÑÌ½µÁ±•Ñ”è€À¼äÄ)A±…¹Ì•á•ÕÑ•è€Ä¼Ü)€()!Õµ…¸É”µÉ•Ù¥•ÜÉ•½É‘•AML¸M•Á…É…Ñ”¡Õµ…¸…ÕÑ¡½É¥é…Ñ¥½¸™½È€ÄÌ´ÀÈ¡…Ì…±Í¼‰••¸É•½É‘•ì•á•ÕÑ¥½¸µ…äÁÉ½••½¹±ä™½È€ÄÌ´ÀÈ¸((ŒŒM•±˜µ¡•¬èAMM((´mát…ÁÁÌ½‰…­•¹½ÍÉŒ½…Á¤½ÍÑ½É”µÍÕÉ™…”½µ…¹¥™•ÍĞ¹ÑÍ€=U5(´mát…ÁÁÌ½‰…­•¹½ÍÉ¥ÁÑÌ½ÍÑ½É”µÍÕÉ™…”½Í…¸µ¥¹ÍÑ…±±•¹ÑÍ€=U9(´mát…ÁÁÌ½‰…­•¹½ÍÉŒ½…Á¤½ÍÑ½É”µÍÕÉ™…”½}}Ñ•ÍÑÍ}|½µ…¹¥™•ÍĞ¹Õ¹¥Ğ¹ÍÁ•Œ¹ÑÍ€=U9(´mát…ÁÁÌ½‰…­•¹½ÍÉŒ½¥¹™É…ÍÑÉÕÑÕÉ”½ÍÑ½É”µ™½Õ¹‘…Ñ¥½¸µÑÉ…¹Í…Ñ¥½¸µ½µÁ…Ñ¥‰¥±¥Ñä¹ÑÍ€=U5(´mát…ÁÁÌ½‰…­•¹½ÍÉŒ½µ½‘Õ±•Ì½¡•­½ÕĞ½}}Ñ•ÍÑÍ}|½ÍÑ½É”µ™½Õ¹‘…Ñ¥½¸µÑÉ…¹Í…Ñ¥½¸µ½µÁ…Ñ¥‰¥±¥Ñä¹ÍÁ•Œ¹ÑÍ€=U9(´mát½µµ¥Ğ€Á”äÍå‘€=U5(´mát½µµ¥Ğ”Å”Ìá€=U9((´´´(©A¡…Í”è€ÄÌµÍÑ½É•™É½¹Ğµ½¹ÑÉ…Ğµ™½Õ¹‘…Ñ¥½¸µÍÕÉ™…”µ±½­‘½İ¸¨(©½µÁ±•Ñ•è€ÈÀÈØ´Àà´Àà¨(