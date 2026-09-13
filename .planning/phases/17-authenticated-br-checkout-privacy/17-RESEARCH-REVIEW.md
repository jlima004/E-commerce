---
phase: 17-authenticated-br-checkout-privacy
gate: research-review
status: technical-pass-human-review-required
reviewed_at: 2026-09-10
research_artifact: 17-RESEARCH.md
---

# Phase 17 — Research Adversarial Review

## 1. Identity

```text
Research checker:
SUBAGENT J — ADVERSARIAL RESEARCH REVIEW

Model:
GPT-5.6 Sol — Extra High

Mode:
SYNTHESIS REVIEW / READ-ONLY

Final status:
TECHNICAL PASS — HUMAN REVIEW REQUIRED
```

O review não aprova humanamente a RESEARCH, não altera decisões D17 e não
autoriza PLAN ou implementação.

## 2. Review Scope

O revisor confrontou `17-RESEARCH.md` com:

- briefing humano integral;
- `17-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md`, `ROADMAP.md` e `PROJECT.md`;
- Phase 16 closure e PR #28 remediation;
- código instalado Medusa 2.16, CheckoutCompletionLog, idempotência e CPF atual;
- fontes oficiais Medusa, NIST e Gelato aplicáveis;
- boundaries FIN-01..FIN-04, D17-12, BFF-only, module isolation e P18–P22.

Ataques obrigatórios incluíram claims sem fonte, docs stale, legal overclaim,
nonce/key misuse, fingerprint privacy/rotation, enfraquecimento D17-12,
Order síncrono, autoridade concorrente, browser-direct Medusa, rotas/schema
prematuros, classificação incorreta de R17-Qxx e completude do Source Register.

## 3. Review Cycles

| Cycle | P0 | P1 | material P2 | INFO | Verdict |
|---|---:|---:|---:|---:|---|
| 1 | 0 | 1 | 2 | 3 | REVISE — NOT PASS |
| 2 | 0 | 1 | 1 | 0 | BLOCKED — NOT PASS |
| 3 | 0 | 0 | 0 | 0 | PASS |

## 4. Remediation Ledger

| Finding | Initial severity | Defect | Research remediation | Final status |
|---|---|---|---|---|
| R17-J-P1-01 | P1 | Workflow Engine/async durable sinks omitted from PII matrix | Added Workflow Engine, events/subscribers, queues/jobs/retries and request-validation/cache with future sink canaries | RESOLVED |
| R17-J-P2-01 | material P2 | HMAC rotation depended circularly on persisted version before lookup | Split claim locator and semantic fingerprint key lifecycles; added retained-keyring/stable-locator alternatives | RESOLVED after follow-up below |
| R17-J-P2-02 | material P2 | Q12 marked resolved while projection/errors remained open | Reclassified Q12 as partial and updated counts to 0 resolved / 7 partial | RESOLVED |
| R17-J-I-01 | INFO | FIPS 198-1 withdrawal proposal freshness | Recorded proposed withdrawal and SP 800-224 as non-final IPD | RESOLVED |
| R17-J-R2-P1-01 | P1 | “Zero matches” wording would block every first claim | Defined 0/1/>1 semantics with complete keyring and transaction/constraint linearization | RESOLVED |
| R17-J-R2-P2-01 | material P2 | Source Register lacked per-source retrieval/classification | Added `Retrieved` and `Primary/secondary` to all 39 source rows | RESOLVED |

### 4.1 Final idempotency lookup rule

```text
0 matches + retained keyring proven complete:
create the first claim under the active version and existing transactional
constraint linearization.

1 match:
replay/reuse; only then use persisted versions for fingerprint recomputation.

>1 matches:
fail closed.

Missing retained version, incomplete keyring or corruption:
fail closed before interpreting zero as a new claim.
```

### 4.2 Final source register audit

```text
Source IDs: 39 unique
PRIMARY: 36
SECONDARY: 3
Missing/invalid Retrieved: 0
Missing/invalid Primary/secondary: 0
```

## 5. Final Invariant Audit

| Invariant | Result |
|---|---|
| D17-01..D17-16 | PRESERVED |
| Order birth only via canonical Stripe webhook + CCL | PRESERVED |
| FIN-01 | PRESERVED |
| FIN-02 | PRESERVED |
| FIN-03 | PRESERVED |
| FIN-04 | PRESERVED |
| D17-12 no raw CPF to named sinks | PRESERVED as binding rule; current gaps remain explicit |
| BFF-only / browser-direct DENY | PRESERVED |
| Medusa module isolation | PRESERVED |
| Native Store bypasses DENY | PRESERVED |
| Routes/schemas remain candidates | PRESERVED — `ARTIFACT PENDING` |
| P18–P22 implementation leakage | 0 |
| Frontend work | 0 |

## 6. External Blocker Retained

```text
R17-CONFLICT-01:
Gelato documents federalTaxId as mandatory for Brazil while D17-12 forbids CPF
transmission to Gelato.

R17-BLOCK-01:
NO-CPF GELATO COMPATIBILITY — BLOCKED
```

O adversarial PASS não remove esse resultado externo. A menor ação humana
continua sendo obter exceção oficial escrita ou adjudicar produto/provider sem
enfraquecer D17-12.

## 7. Final Verdict

```text
P0: 0
P1: 0
material P2: 0
INFO: 0

Verdict:
PASS

Phase 17 RESEARCH:
TECHNICAL RESEARCH COMPLETE — HUMAN REVIEW REQUIRED
```

## 8. Governance

```text
Phase 17 CONTEXT:
HUMAN APPROVED — PASS — CLOSED

Phase 17 RESEARCH:
TECHNICAL RESEARCH COMPLETE — HUMAN REVIEW REQUIRED

Phase 17 PLAN:
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Push / deploy / providers / remote infrastructure:
NOT AUTHORIZED

Frontend:
BLOCKED

Next permitted action:
HUMAN REVIEW OF PHASE 17 RESEARCH
```
