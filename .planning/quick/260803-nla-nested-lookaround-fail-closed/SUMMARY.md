---
name: nested-lookaround-fail-closed
created: 2026-08-03
status: completed
---

# SUMMARY — nested lookaround remediation (PR #20 P2)

## Result

PASS — bounded recursive normalization of retained positive lookaround
assertions (`MAX_LOOKAROUND_NESTING_DEPTH = 4`), fail-closed on depth
exceed / malformed.

## Bypass

`^(?=tracking_(?=token)token$).+$` previously retained
`tracking_(?=token)token$` without recursive strip → fragments
`tracking` + `tokentoken`. Same class for `api_key`.

## Fix locus

`stripRegexLookaroundAssertions` in `safe-examples.ts` — recurse into
retained positive assertion bodies; flatten nested pattern + positives
into candidates.

## Evidence

- Focused API Docs suites: 304/304 (9/9)
- Full unit: 1257/1257
- openapi:lint + foundation: PASS
- openapi:check: run after commit (requires clean worktree)
- Lint: 0 errors / 261 warnings (pre-existing)
- Build: PASS
- Generated OpenAPI artifacts: unchanged

## Strategy note

Pure fail-closed on any nested lookaround was rejected because it would
false-positive allowed controls `public_(?=status)status` and
`display_(?=name)name`.
