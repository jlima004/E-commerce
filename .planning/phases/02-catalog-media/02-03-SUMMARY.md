---
phase: 02-catalog-media
plan: "03"
subsystem: infra
tags: [medusa, file-s3, supabase, storage, s3, env-schema, catalog-media]

requires:
  - phase: 02-catalog-media
    plan: "02"
    provides: Sellable/publish gate complete; catalog metadata contract stable
provides:
  - Supply-chain verification for @medusajs/file-s3@2.16.0 aligned with Medusa 2.16.0 stack
  - Human gate checklist for public Supabase Storage bucket + S3 credentials (outside Git)
affects: [02-04, 02-05]

tech-stack:
  added: []
  patterns:
    - "D-11/D-12: official @medusajs/file-s3 only — no custom Supabase SDK provider in this phase"
    - "D-13/D-14: catalog images are public bucket URLs; no binaries in Postgres"
    - "D-15: signed URLs out of scope"

key-files:
  created: []
  modified: []

key-decisions:
  - "Stop before install/configure per Task 1 blocking gate — no provider wiring until human approves bucket/credentials"
  - "Pin @medusajs/file-s3@2.16.0 to match existing @medusajs/* 2.16.0 set (not 2.15.x from older STACK.md prose)"
  - "Supabase S3 wiring will use forcePathStyle: true per Medusa docs for Supabase compatibility"

patterns-established: []

requirements-completed: []

duration: 8min
completed: 2026-06-26
status: pending-checkpoint
checkpoint:
  task: 1
  type: blocking-human
  resume_signal: done
---

# Phase 02 Plan 03: Supabase Storage Provider — Supply-Chain Gate Summary

**Supply-chain verified for `@medusajs/file-s3@2.16.0`; execution paused at blocking human gate before install, env schema, or medusa-config wiring**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-26T20:00:00Z
- **Completed:** 2026-06-26T20:08:00Z (checkpoint only — Tasks 2–3 deferred)
- **Tasks:** 1 of 3 (automated portion of Task 1 only)
- **Files modified:** 0 (by design — plan forbids changes before gate)

## Accomplishments

- Confirmed `@medusajs/file-s3@2.16.0` exists on npm and matches the installed Medusa stack (`@medusajs/*` all at **2.16.0** in `apps/backend/package.json`)
- Confirmed official repository: `git+https://github.com/medusajs/medusa.git`
- Documented human provisioning steps for public Supabase Storage bucket + S3-compatible credentials
- **Did not** install packages, modify `medusa-config.ts`, extend `env.ts`, run migrations, deploy, or write secrets to Git

## Task Status

| Task | Status | Notes |
|------|--------|-------|
| **Task 1:** Supply-chain + bucket/credentials gate | ⏸ **Checkpoint** | Automated verify ✅; human verify ⏳ awaiting `done` |
| **Task 2:** RED env contract tests | ⬜ Blocked | Starts after human gate |
| **Task 3:** Install provider + env schema + medusa-config | ⬜ Blocked | Starts after Task 2 RED |

## Automated Verification (Task 1)

```bash
npm view @medusajs/file-s3@2.16.0 version repository.url
```

**Result: PASS**

```
version = '2.16.0'
repository.url = 'git+https://github.com/medusajs/medusa.git'
```

**Stack alignment: PASS** — backend already pins `@medusajs/framework`, `@medusajs/medusa`, `@medusajs/cli`, etc. at `2.16.0`. No version skew if `@medusajs/file-s3@2.16.0` is added in Task 3.

## Checkpoint: Human Action Required

Before Tasks 2–3 may proceed, confirm **all** of the following in an authorized environment only (Heroku config vars, local `.env`, Supabase dashboard — **never** committed to Git):

### 1. Public bucket for catalog images (D-13)

- Create or select a Supabase Storage bucket for product images (PRD name: `SUPABASE_STORAGE_BUCKET_PRODUCT_IMAGES`).
- Bucket must be **public** for MVP catalog URLs (no signed URLs — D-15).
- Objects should be readable via stable public URLs (not Postgres binaries — D-14).

### 2. S3-compatible credentials (server-side only)

In Supabase Dashboard → **Storage** → **S3 configuration**:

1. Enable S3 protocol if not already enabled.
2. Generate **Access Key ID** + **Secret Access Key** (server-side credentials — not anon/publishable keys).
3. Copy **endpoint** and **region** from the S3 settings page.

Reference endpoint shape:

`https://<project-ref>.storage.supabase.co/storage/v1/s3`

Docs: [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)

### 3. Provision env vars (names for Task 3 — values stay secret)

Medusa File Module (official docs) expects these options via env:

| Env var (planned) | Purpose |
|-------------------|---------|
| `S3_ENDPOINT` | Supabase S3 endpoint URL |
| `S3_REGION` | Region from Supabase S3 settings |
| `S3_BUCKET` | Public product-images bucket name |
| `S3_ACCESS_KEY_ID` | S3 access key (server-side) |
| `S3_SECRET_ACCESS_KEY` | S3 secret key (server-side) |
| `S3_FILE_URL` | Public base URL for catalog image references returned by API |

Task 3 will also set `additional_client_config.forcePathStyle: true` in `medusa-config.ts` (required for Supabase per Medusa docs).

**Set these in:** Heroku config vars for `espacoliminar`, local `.env` (gitignored), or your secrets manager — **not** in repo files.

### 4. Resume signal

When bucket, endpoint, region, and credentials are provisioned, reply **`done`** to continue 02-03 (Tasks 2–3 only). Do **not** paste secret values in chat.

## Deferred Work (after `done`)

| Step | Command / action |
|------|------------------|
| Task 2 RED tests | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t "storage\|s3\|supabase\|public url"` |
| Task 3 implement | Install `@medusajs/file-s3@2.16.0`, extend `env.ts`, register File Module in `medusa-config.ts` |
| Verify | `cd apps/backend && npm run test:unit -- ... && npm run build` |
| Manual smoke | Upload one test image in authorized env (post-implementation) |

**Explicitly out of scope for this continuation:** migrations, deploy, 02-04, signed URLs, custom file provider.

## Decisions Made

- Honored plan gate: zero application changes before human approval (D-11 supply-chain only verified)
- Will use `@medusajs/medusa/file` + `@medusajs/medusa/file-s3` provider pattern from Medusa docs (not standalone `@medusajs/file-s3` top-level module resolve — to be confirmed during Task 3 implementation against installed package exports)

## Deviations from Plan

None — stopped exactly at Task 1 blocking checkpoint as requested.

## Issues Encountered

None.

## User Setup Required

**Yes — blocking.** Complete the checkpoint checklist above, then signal `done`.

## Next Phase Readiness

- **02-04** (Store API catalog contract) remains blocked until 02-03 Tasks 2–3 complete
- **02-05** (Gelato snapshot builder) can proceed in parallel wave 3 per roadmap, but catalog media URLs depend on 02-03 completion

## Self-Check: CHECKPOINT

- [x] Supply-chain automated verify passed
- [x] No secrets in Git or SUMMARY
- [x] No migrations or deploy attempted
- [x] No advance to 02-04
- [ ] Human bucket/credentials gate — **awaiting `done`**

---
*Phase: 02-catalog-media*
*Checkpoint: 2026-06-26*
