---
phase: 16-cart-merge-review
plan: 12
subsystem: api-docs/cart-merge
tags: [cart-merge, review, openapi-registry, zod, bff, idempotency, etag, security]

requires:
  - phase: 16-cart-merge-review
    provides: "Plan 16-11 R2 technical evidence: attach bearer-only, PRESERVE_LEGACY, native DENY and zero-order boundary."
provides:
  - "Registry TypeScript de merge/review fechado e alinhado ao runtime, sem tocar JSON gerado."
  - "Contrato de segurança, headers, erros, replay e exclusão deprecated do attach documentado para revisão humana."
affects: [Phase 16, future storefront contract, API Docs]

actuals:
  tokens: 6000
  tasks: 3
  commits: 6
  docs_commit: this-file

tech-stack:
  added: []
  patterns:
    - "Zod strict + serializers allowlisted + registry additionalProperties:false."
    - "BFF + publishable + Customer bearer como tuple obrigatório para merge/ACK."
    - "OpenAPI registry-only checkpoint; writer e JSON gerado permanecem intocados."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-12-SUMMARY.md"
  modified:
    - "apps/backend/src/api/store/carts/merge-review-validators.ts"
    - "apps/backend/src/api/store/carts/serializers.ts"
    - "apps/backend/src/api-docs/operations/store/schemas.ts"
    - "apps/backend/src/api-docs/components/parameters.ts"
    - "apps/backend/src/api-docs/operations/store/carts.ts"
    - "apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts"
    - "apps/backend/src/api-docs/__tests__/security.unit.spec.ts"
    - "apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts"
    - "apps/backend/src/api-docs/__tests__/generation.unit.spec.ts"
    - "apps/backend/src/api-docs/__tests__/admin-contract.unit.spec.ts"
  verified_without_changes:
    - "apps/backend/src/api-docs/components/errors.ts"
    - "apps/backend/src/api-docs/components/security-schemes.ts"
    - "apps/backend/src/api-docs/coverage/exclusions.ts"

key-decisions:
  - "CUSTOMER_CART_PRESERVED permanece reservado, sem branch ou exemplo positivo."
  - "Replay reproduz a projeção original; não adiciona mergeReceipt/currentState nem refaz leitura temporal."
  - "Attach segue OUTSIDE_FRONTEND_M1/PRESERVE_LEGACY, excluído do M1 executável, com remoção futura human-gated."

requirements-completed: []

coverage:
  - id: D1
    description: "Bodies, outcomes, rejected items, review state, responses e nullability runtime/registry fechados."
    requirement: "MRG-02"
    verification:
      - kind: unit
        ref: "store-contract + decision unit — 2 suites / 46 passed / 0 failed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Security tuple, headers, erro 409/412, ETag/no-store, provenance e non-interactive registrados."
    requirement: "MRG-06"
    verification:
      - kind: unit
        ref: "API Docs final discovered suites — 7 suites / 276 passed / 0 failed"
        status: pass
    human_judgment: false
  - id: D3
    description: "Attach exclusion, secret/example scan, native denial e exact-set M1 preservados."
    requirement: "MRG-08"
    verification:
      - kind: integration
        ref: "cart-merge-review + guest-cart-native-deny — 2 suites / 101 passed / 0 failed"
        status: pass
    human_judgment: false
  - id: D4
    description: "Checkpoint final do Plan 16-12."
    verification: []
    human_judgment: true
    rationale: "A revisão humana do Plan 16-12 ainda é o próximo gate; o validador independente L permanece PENDING."

status: halted
---

# Phase 16: Cart Merge & Review — Plan 16-12 Summary

**Contrato TypeScript de merge/review fechado e reconciliado com runtime, segurança e exclusões, mantendo os artefatos JSON gerados byte-identical para revisão humana.**

## Status e escopo

- **Plan 16-12:** **TECHNICAL PASS — PENDING HUMAN REVIEW**.
- **Phase 16:** **IN PROGRESS**; `MRG-01..MRG-08` continuam **OPEN / global reconciliation pending**.
- **Plan 16-13:** **NOT STARTED / NOT AUTHORIZED**. Plan 16-14 também não foi iniciado.
- **Próxima ação permitida:** **HUMAN REVIEW OF PLAN 16-12**.
- `STATE.md` e `ROADMAP.md` não foram atualizados. Push e deploy não foram realizados.

## Execution environment

| Campo | Valor |
|---|---|
| Environment | Cursor |
| Primary model | GPT-5.6 Luna |
| Orchestrator | GPT-5.6 Luna |
| Subagents used | YES |

### Mapeamento real de agentes

Todos os agentes abaixo usaram **GPT-5.6 Luna**:

| ID | Task |
|---|---|
| A | Preflight / contract inventory — READ-ONLY |
| B | Runtime/schema parity architect — READ-ONLY |
| C | Task 16-12-01 implementer |
| D | Security/operation architect — READ-ONLY |
| E | Task 16-12-02 registry implementer |
| F | Deprecation/leakage auditor — READ-ONLY |
| G | Task 16-12-03 safety implementer |
| H | Focused validation reviewer |
| I | Regression validator; encontrou seis falhas causais de collateral |
| R1 | Directly-affected API Docs test remediation |
| R2 | Runtime closed-cart-schema remediation |
| R3 | Whitespace parity remediation |
| J | Initial security/diff review |
| J2 | Final security/diff reconciliation — **OVERALL PASS** |
| K | Este summary writer |
| L | Independent final validator — **PENDING** |

O agente L não foi declarado executado nem aprovado.

## Baseline, histórico e artefatos gerados

Baseline: `b9c027c2bff6e696aede031cf59561d3f84e9a95`, branch `gsd/phase-16-cart-merge-review`, worktree inicialmente limpo.

Commits técnicos preservados, sem amend, rebase, squash ou rewrite:

1. `d788aa8` — `feat(api-docs): define phase 16 merge review schemas`
2. `858a13b` — `feat(api-docs): register phase 16 merge review operations`
3. `be396f5` — `test(api-docs): lock phase 16 contract safety`
4. `7f0b2c5` — `test(api-docs): reconcile registry-only phase 16 expectations`
5. `d2fc300` — `fix(api-docs): close phase 16 cart response validation`
6. `75f4e640` — `fix(api-docs): align merge whitespace validation`

Os três arquivos gerados permaneceram byte-identical antes/depois:

| Artefato | SHA-256 antes | SHA-256 depois |
|---|---|---|
| `apps/backend/src/api-docs/generated/store.openapi.json` | `d984abe7d4ffa3291742a57c780c7e5f0f282ca81fdb9bd4678a7b9a377b3c98` | `d984abe7d4ffa3291742a57c780c7e5f0f282ca81fdb9bd4678a7b9a377b3c98` |
| `apps/backend/src/api-docs/generated/admin.openapi.json` | `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` | `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a` |
| `apps/backend/src/api-docs/generated/webhooks.openapi.json` | `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` | `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4` |

`git diff -- apps/backend/src/api-docs/generated` ficou vazio. `openapi:generate`, `openapi:check` e qualquer writer/generator/check de JSON não foram executados.

## Tasks

### Task 16-12-01 — Fixar bodies, responses e property sets runtime

**PASS.** Runtime Zod, serializers e registry descrevem os mesmos shapes fechados. O serializer usa allowlist explícita, sem spread público, e o replay mantém o shape original.

### Task 16-12-02 — Registrar security, headers e erros das operações M1

**PASS.** Merge e ACK têm operation IDs, paths, provenance, security, headers, responses e classificação non-interactive. O vocabulário separa conflito `409` de precondição stale `412`.

### Task 16-12-03 — Fechar exclusão deprecated e secret-free registry

**PASS.** Attach permanece explicitamente excluído do M1 executável; o scan de secrets/examples passa e Swagger continua não interativo.

I encontrou seis falhas causais em testes collateral diretamente afetados; R1 as remediou. R2 fechou a validação de schemas cart fechados após a revisão de segurança e R3 alinhou a validação de whitespace ao pattern do registry. Essas correções permaneceram dentro do escopo técnico do Plan 16-12; regressões causadas pelo plano no estado final: **0**.

## Contrato público final

### Requests, enum e rejeições

- Merge request exato: `{guestCartId}` (`guestCartId: string`).
- ACK request exato: `{reviewRef: string|null}`.
- Outcome exato: `[MERGED, MERGED_PARTIAL, GUEST_CART_ATTACHED, CUSTOMER_CART_PRESERVED, NO_ITEMS]`.
- `CUSTOMER_CART_PRESERVED` é **RESERVED**: não há branch, regra determinística ou exemplo positivo.
- `RejectedItem` exato: `[variantId, requestedQuantity, acceptedQuantity, rejectedQuantity, reason]`.
- Reasons exatos: `[VARIANT_INVALID, VARIANT_UNAVAILABLE, QUANTITY_LIMIT_EXCEEDED]`.
- Invariante: `rejectedQuantity = requestedQuantity - acceptedQuantity` e `acceptedQuantity + rejectedQuantity = requestedQuantity`; `acceptedQuantity` não excede `requestedQuantity` e permanece no limite `0..99`.

### Review, responses e replay

- `CartReview`/`CartReviewState` exato: `[requiresReview, reviewRef, rejectedItems]`.
- Relação iff: `requiresReview === true` se e somente se `outcome === MERGED_PARTIAL`; nos demais outcomes, `requiresReview === false`.
- Merge response exato: `[cart, outcome, review]`.
- ACK response exato: `[cart, review]`.
- `cart` é nullable e `reviewRef` é `string|null`; schemas e objetos aninhados são strict/closed, com `additionalProperties:false`.
- O replay same-key/same-fingerprint `COMMITTED` preserva **shape original, public cart snapshot, review original, outcome original e ETag original**. Não refaz fetch do estado atual e não expõe `mergeReceipt` ou `currentState`.
- Campos internos, snapshots de catálogo, timestamps de review, actor/internal IDs, hashes, workflow, audit, provider IDs e secrets não entram no contrato público.

### Segurança, headers e erros

- **Merge:** security tuple obrigatório `BFF service credential + publishable API key + Customer bearer`; capability guest obrigatória, `Idempotency-Key` obrigatório e `If-Match` obrigatório referenciando a versão do **guest source**.
- **ACK:** mesmo tuple BFF + publishable + Customer bearer; capability e `Idempotency-Key` são ausentes/não aceitos; `If-Match` é obrigatório.
- `409`: conflito válido de authority/state/idempotency ou review, incluindo `REVIEW_REQUIRED`.
- `412`: exclusivamente precondição stale, `CART_VERSION_MISMATCH`; não recebe semântica de review ou idempotência.
- Resposta `200`: **ETag + `Cache-Control: no-store`**.
- Resposta `412`: **ETag** (e correlação) somente; o envelope de erro runtime não define `Cache-Control`. Esta é uma nota de hardening fora do escopo, não bloqueante, e o registry está alinhado ao runtime.

### Attach e superfície

- `/store/customers/me/cart/attach`: `OUTSIDE_FRONTEND_M1`, `PRESERVE_LEGACY`, excluído do contrato M1 executável, owner **Phase 16**, remoção somente após futuro **HUMAN GATE** explícito, sem data inventada.
- Attach não possui segundo engine semântico nem session fallback; permanece facade controlada do motor canônico.
- `POST /store/carts/{id}/customer`: **DENY**, `404` não enumerante; aliases e vizinhos desconhecidos também falham fechado.
- M1 exact-set: **14** operações — Phase 14 (6) + Phase 15 cart (6) + Phase 16 merge/ACK (2).
- BFF protected tuple: **8** operações — Phase 15 (6) + Phase 16 merge/ACK (2); attach está ausente.
- Swagger permanece globalmente `nonInteractive`.

## Verification

### Focused final

Store contract + decision unit:

```text
2 suites / 46 passed / 0 failed / 0 skipped / exit 0
```

### API Docs affected final

Suites descobertas: `store-contract`, `security`, `coverage`, `generation`, `swagger-config`, `runtime-documents`, `admin-contract`.

```text
7 suites / 276 passed / 0 failed / 0 skipped / exit 0
```

### Required Phase 16 HTTP final

`cart-merge-review` + `guest-cart-native-deny`:

```text
2 suites / 101 passed / 0 failed / 0 skipped / exit 0
```

### Full unit

`npm run test:unit`:

```text
103 passed / 1 failed / 104 suites
1,897 passed / 2 failed / 1,899 tests
0 skipped / 1 snapshot passed / exit 1
```

A única suite que falhou foi `src/api-docs/__tests__/native-extensions.unit.spec.ts`, com o fingerprint drift nativo já estabelecido em R2 para `GET /store/products` em `apps/backend/src/api/middlewares.ts`; são os mesmos nomes de teste, classe e input do fingerprint preexistente de R2. Não é regressão deste plano. Como evidência suplementar fora do full-unit, os dois failures do handler harness em `guest-cart-contract-matrix.spec.ts` também são pré-existentes e não causados por 16-12.

`ReadLints`: **sem erros**. `git diff --check`: **PASS**.

## Security / diff review

J2 reconciliou o diff, source, registry, testes e evidências finais: **OVERALL PASS**. A nota sobre `412` é apenas hardening fora do escopo e não bloqueia o checkpoint: o runtime error envelope não define `Cache-Control`, portanto o registry mantém ETag/correlação sem declarar no-store para `412`.

O secret/example scan passou sem capability guest, Customer JWT, raw key, PII, provider ID, payload Pix/tracking ou identificador interno em exemplos/projeções públicas. O contrato permanece BFF-only e a denial nativa continua não enumerante.

## Worktree e próximos gates

- Worktree antes deste arquivo: limpo após `75f4e640`.
- Commit técnico: histórico acima preservado.
- Commit deste arquivo: `docs(cart-merge): record plan 16-12 contract evidence`.
- Worktree final: deve permanecer limpo após este commit.
- Push: **NOT PERFORMED**.
- Deploy: **NOT PERFORMED**.
- Independent final validator L: **PENDING** — não executado, não aprovado.

---
*Phase: 16-cart-merge-review*
*Plan: 16-12*
*Technical status: PASS; human review pending*
