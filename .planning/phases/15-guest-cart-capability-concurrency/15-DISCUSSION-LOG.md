# Phase 15: Guest Cart Capability & Concurrency - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `15-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-08-19
**Phase:** 15-guest-cart-capability-concurrency
**Areas discussed:** Documentary CONTEXT capture from existing sources (no interactive gray-area Q&A)

---

## Gate posture (human instruction)

| Option | Description | Selected |
|--------|-------------|----------|
| Interactive gray-area Q&A then CONTEXT | Standard `/gsd-discuss-phase` default mode | |
| Documentary CONTEXT from locked sources; leave remaining ambiguities as open questions | User command: CONTEXT ONLY; do not reinvent decided requirements; stop at human review | ✓ |
| Auto-advance to RESEARCH/PLAN | Workflow `--chain` / `auto_advance` | |

**User's choice:** Documentary CONTEXT only. RESEARCH, PLAN, execution, frontend, providers reais, DB/Redis remotos, push e deploy permanecem não autorizados. Sem auto-chain.

**Notes:** Orchestration used sequential read-only subagents: CONTEXT INPUT AUDIT (Grok 4.6, PASS) then ADVERSARIAL REVIEW (Composer 2.5, PASS). Context7 was consulted during CONTEXT capture to inspect current Medusa v2 documentation (native add/update/delete line-item operations; qty 0 removes). That consultation is a historical record only: it did not close a decision, is not PLAN authority, does not replace RESEARCH, and does not make external Medusa documentation CONTEXT technical authority. Any claim about native Medusa capabilities must be reconfirmed in authorized RESEARCH against the version/runtime actually used. Q-05 (clear-all) remains open.

---

## Requirement authority

| Option | Description | Selected |
|--------|-------------|----------|
| Invent Phase 15 success criteria to fill thin ROADMAP section | Would create ungrounded DoD | |
| Derive boundary from REQUIREMENTS `CART-01..CART-09` + PRD §7.2–7.3 + SRS-BE-CART + Phase 13/14 closures; flag ROADMAP thinness | User: do not reinvent decided requirements | ✓ |

**User's choice:** Do not invent success criteria. Cite v1.1 CART IDs; disambiguate archived v1.0 `CART-01..CART-04`.

---

## Gray areas Q-01..Q-11

| Option | Description | Selected |
|--------|-------------|----------|
| Close gray areas as D15 decisions in this CONTEXT | Would anticipate RESEARCH/implementation | |
| Record as open questions; Agent Discretion may not close them | CONTEXT lists dúvidas abertas; RESEARCH not authorized | ✓ |

**User's choice:** Leave Q-01..Q-11 open (capability persistence, TTL, session dual-run, PRESERVE_LEGACY promotion timing, clear-all mechanism, CART-09 vs Phase 18, authenticated-cart mutations, Cart DTO, Idempotency-Key on mutations, Store vs BFF header split, idempotent create vs hash-only capability replay after lost response).

**Notes:** No conversational prompting turns were run. The human prompt already specified the CONTEXT sections and forbade later gates.

---

## Claude's Discretion

None for closing Q-01..Q-11 or promoting routes. Discretion is reserved for a future authorized RESEARCH comparison of mechanisms only, without relaxing hash-only, BFF-only, Order-birth, If-Match, qty 1–99, or Phase 14 exact-sets.

Non-blocking nits from adversarial review were applied: canonical-refs heading now addresses future RESEARCH/planning agents without authorizing those gates; test paths listed as as-built evidence, not a test plan.

---

## RESEARCH gate (2026-08-19)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-chain to PLAN after RESEARCH | Forbidden by operator | |
| Research-only; stop at human review of 15-RESEARCH.md | `/gsd-plan-phase 15 --research-phase`; PLAN not authorized | ✓ |

**Sources consulted:** 15-CONTEXT.md (boundary), STATE/ROADMAP/REQUIREMENTS, Phase 13/14 closures, PRD Backend/Frontend, SRS, DB_MODEL v1.21/v1.22, as-built Medusa 2.16.0 (`node_modules` + project routes), Context7 `/websites/medusajs` (secondary).

**Subagents (sequential, read-only until RESEARCH.md write):**
- A as-built — Composer 2.5 — PASS
- B security/concurrency — Grok 4.6 — PASS
- C Medusa/runtime + Context7 — Composer 2.5 — PASS
- D adversarial review — Grok 4.6 — PASS (warnings applied before commit)

**Q-01..Q-11:** RESEARCH recommendations only, not D15 locks. Human may diverge on TTL numeric value and Q-11 orphan rotation. Exact-set 63→64 is a human-review lock of this RESEARCH, not a silent PLAN default.

**Not authorized by this log:** PLAN, execution, frontend, deploy, providers reais, infra remota, push.

---

## Human review remediation (2026-08-19) — B15-R-HR-01 / B15-R-HR-02

| Option | Description | Selected |
|--------|-------------|----------|
| Promote Q-11 Option A to a D15 lock | Would close an open question without human RESEARCH lock | |
| Keep Q-11 as RESEARCH recommendation; distinguish lost-response A vs B; remove in-process Store→BFF conflation | Corrects B15-R-HR-01 without locking Q-11 | ✓ |
| Treat Customer M1 ownership / idempotency actor scope as JWT/session Customer | Contradicts Phase 14 BFF service guard + customerAuthAccessGuard | |
| Correct Customer proof and actor scope to Phase 14 authorized context; keep Guest vs Customer proofs distinct | Corrects B15-R-HR-02; no Phase 14 JWT change; no new Medusa actor_type / actor_id | ✓ |
| Auto-advance to PLAN / write PLAN.md | Forbidden at this gate | |
| Record INTERACTION Idempotency-Key × If-Match as a mandatory PLAN decision without designing it | Future PLAN only | ✓ |

**B15-R-HR-01 identified and corrected** in `15-RESEARCH.md` only. Option A now splits: (A) Store→BFF received, BFF→browser failed — cookie MAY preserve possession, browser retry MAY recover via cookie + GET; (B) Store committed, Store→BFF lost before BFF received the capability — BFF has no secret, hash-only blocks reconstruction, same Idempotency-Key MUST NOT recover/re-emit the capability, key is not a recovery credential, retry MAY recover safe context only, cart is orphaned, new create uses a new key, orphan expires via TTL. Removed the claim that in-process retry covers Store→BFF loss while the BFF still has the 201 in memory. Not adopted: plaintext persistence, encrypted recoverable token, HKDF/reversible derivation, rotation-on-replay, Idempotency-Key as capability. Q-11 remains a RESEARCH recommendation, not a D15 lock.

**B15-R-HR-02 identified and corrected** in `15-RESEARCH.md` only (Q-07, Q-09, responsibility map, threat model, incidental Q-05 ownership wording). M1 Customer ownership is BFF service guard + Phase 14 `customerAuthAccessGuard` / PostgreSQL-backed access state + stable Customer/identity principal from that context. Must not use native `authenticate("customer", ["session", "bearer"])`, raw JWT, JWT hash, Medusa native session id, or guest capability for Customer. Idempotency actor scope: Guest = capability-derived hash without plaintext persistence; Customer = stable identity from Phase 14 authorized context; not JWT / JWT hash / Medusa session id, so refresh/rotation does not change scope while identity is unchanged. Guest and Customer MAY reuse the same M1 operations; possession proofs remain distinct. No Phase 14 JWT change. No new Medusa `actor_type` / `actor_id`.

**Locked requirements:** D15-01..D15-18 and inherited D13/D14 unchanged. No locked-requirement edits.

**Research:** no new external research; no Context7; no code changes. Documentary remediation of human-review blockers against current documents and as-built Phase 14 / store-idempotency / middlewares.

**PLAN:** remains unauthorized. `15-PLAN.md` must not be created. INTERACTION Idempotency-Key × If-Match is recorded as a mandatory future PLAN decision (same-intention retry must not become 412 merely because the first apply advanced ETag; key still does not replace ownership or If-Match). Not designed in this remediation.

**Not authorized by this log:** PLAN, execution, frontend, deploy, providers reais, infra remota, push, third-file edits.

---

## Deferred Ideas

- Cart merge & review / capability consumption on merge — Phase 16
- Authenticated BR checkout / guest checkout remains out of Frontend M1 — Phase 17
- Gelato quote/select — Phase 18
- PaymentAttempt M1 hardening — Phase 19
- Frontend / Next.js — blocked until Phase 22 + human closeout
