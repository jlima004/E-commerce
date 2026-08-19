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

## Deferred Ideas

- Cart merge & review / capability consumption on merge — Phase 16
- Authenticated BR checkout / guest checkout remains out of Frontend M1 — Phase 17
- Gelato quote/select — Phase 18
- PaymentAttempt M1 hardening — Phase 19
- Frontend / Next.js — blocked until Phase 22 + human closeout
