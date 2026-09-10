---
phase: 17-authenticated-br-checkout-privacy
gate: research-human-review
status: human-approved-pass-closed
reviewed_at: 2026-09-10
research_artifact: 17-RESEARCH.md
technical_review_artifact: 17-RESEARCH-REVIEW.md
---

# Phase 17 — Research Human Review

## 1. Adjudication

```text
PHASE17-RESEARCH:
HUMAN REVIEWED — PASS — CLOSED

17-RESEARCH.md:
HUMAN APPROVED — PASS

17-RESEARCH-REVIEW.md:
HUMAN APPROVED — PASS

Research methodology:
PASS

Source quality:
PASS

Invariant preservation:
PASS

Phase-boundary discipline:
PASS
```

This human acceptance closes the RESEARCH gate only. It does not complete any
`CHK-*` requirement, does not authorize PLAN or implementation, and does not
remove unresolved product/legal/provider decisions.

## 2. Accepted Research Ledger

```text
R17-Q01..R17-Q13:
13/13 RESEARCHED AND CLASSIFIED

PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN:
7

HUMAN PRODUCT DECISION REQUIRED:
4

LEGAL/HUMAN REVIEW REQUIRED:
1

BLOCKED — EXTERNAL CONSTRAINT:
1

RESOLVED — EVIDENCE SUFFICIENT:
0
```

The absence of fully resolved questions is accepted: the research produced
sufficient constraints for human adjudication without pretending that product,
security, legal or provider choices had already been made.

## 3. Human Decisions Still Open

The following IDs remain stable and OPEN:

```text
R17-HR-01 — Abandonment clock and prolonged freeze
R17-HR-02 — Protected authority and minimum Order snapshot
R17-HR-03 — External key authority and lifecycle
R17-HR-04 — Legal purpose/base and receipt semantics
R17-HR-05 — Retention, access, rights and IP
R17-HR-06 — Billing address
R17-HR-07 — Public error taxonomy and precedence
R17-HR-08 — Resume operation and replaced cart
R17-HR-09 — Gelato/provider adjudication
R17-HR-10 — Sensitive fingerprint key lifecycle
```

These decisions must be adjudicated separately before PLAN may be considered.

## 4. Gelato / CPF Blocker

```text
R17-CONFLICT-01:
OPEN — CONFIRMED

R17-BLOCK-01:
OPEN — CONFIRMED

Affected question:
R17-Q05

NO-CPF GELATO COMPATIBILITY:
NOT PROVEN / BLOCKED

Raw CPF transmission to Gelato:
FORBIDDEN — D17-12 PRESERVED
```

The research established a material product/provider conflict: Gelato public
documentation requires `federalTaxId` for Brazil, while the accepted Phase 17
privacy boundary forbids raw CPF transmission to Gelato.

Research PASS does not resolve this conflict and does not authorize CPF
transmission, silent field omission, provider substitution or Phase 18
implementation. The smallest safe next action is human/provider adjudication
that preserves D17-12.

## 5. Accepted Security / Privacy Findings

The human review accepts the RESEARCH framing that:

- CPF is personal data; the research does not incorrectly classify CPF alone as
  automatically belonging to every LGPD sensitive-data category;
- consent is not assumed to be a universal lawful basis;
- no universal retention period is invented;
- legal conclusions remain bounded and subject to human/legal review where
  identified;
- AES-256-GCM and keyed/versioned HMAC are research constraints, not an
  implementation plan;
- claim lookup and semantic fingerprint key lifecycles remain separate;
- incomplete keyrings, missing retained versions and corruption fail closed;
- the PII sink matrix includes durable workflow, events, queues/retries,
  validation, provider, observability and public-response boundaries.

## 6. Invariants Preserved

```text
Order birth:
PRESERVED — canonical Stripe payment_intent.succeeded + CheckoutCompletionLog

FIN-01:
PRESERVED

FIN-02:
PRESERVED

FIN-03:
PRESERVED

FIN-04:
PRESERVED

BFF-only:
PRESERVED

Browser-direct Medusa:
FORBIDDEN — PRESERVED

Medusa module isolation:
PRESERVED

D17-12:
PRESERVED

Phase 18–22 implementation leakage:
0
```

## 7. Counters

No milestone counter changes are authorized by RESEARCH acceptance:

```text
Phases closed:
4/10

Requirements complete:
34/91

Requirements open:
57

Plans complete:
50/50

Progress:
40%
```

`CHK-01..CHK-10` remain OPEN.

## 8. Governance

```text
Phase 17 CONTEXT:
HUMAN APPROVED — PASS — CLOSED

Phase 17 RESEARCH:
HUMAN APPROVED — PASS — CLOSED

R17-HR-01..R17-HR-10:
OPEN — HUMAN DECISIONS REQUIRED

R17-CONFLICT-01:
OPEN — CONFIRMED

R17-BLOCK-01:
OPEN — CONFIRMED

Phase 17 PLAN:
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Real provider actions:
NOT AUTHORIZED

Remote infrastructure:
NOT AUTHORIZED

Frontend:
BLOCKED
```

## 9. Next Permitted Action

```text
Human adjudication of R17-HR-01..R17-HR-10 and R17-BLOCK-01.

PLAN remains NOT AUTHORIZED until a separate human decision after those
adjudications are materialized.
```
