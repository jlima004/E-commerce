# Plan 16-13 R1 — Targeted Contract-Layer Remediation

## Status

**TECHNICAL PASS — READY TO REOPEN PLAN 16-13 STAGE A**

Esta é a remediação autorizada dos blockers `B16-13-A-001`,
`B16-13-A-002`, `B16-13-A-003` e `B16-13-B-001`. Ela não é o Plan 16-14,
não produz `approve-contract` e não autoriza o writer OpenAPI.

## Baseline e escopo

- Ambiente: Codex Harness.
- Branch: `gsd/phase-16-cart-merge-review`.
- Baseline local: `495832f` — `docs(cart-merge): record plan 16-13 contract revision`.
- Remote baseline: `589e8c6cb736b870ea7244526ca2a42e8d8102e4`.
- Worktree no início: limpo.
- Arquivos de runtime, registry e testes alterados: somente os sete arquivos
  autorizados pelo harness.
- Nenhum `STATE.md`, `ROADMAP.md`, package, lockfile, migration, schema,
  config, provider ou arquivo condicional foi alterado.

Commit corretivo local:

- `c1f8cbf764c737c9388436c4dc83dd3c9dc3f107` —
  `fix(cart-merge): remediate contract-layer blockers`.

O commit histórico `495832f` não foi amendado nem reescrito.

## Blockers remediados

### B16-13-A-001 — RESOLVED

A rota canônica de merge agora usa `serializeCartMergeResponse`, o único
serializer fechado da resposta pública. O resultado de replay mantém tipo
explícito `StoreCartPreOrderRecord | PublicStoreCartPreOrder`; o snapshot
persistido não é tratado como registro bruto.

O replay continua receipt-authoritative: preserva outcome, review, ETag e a
projeção pública persistida sem refetch para construir a resposta, sem
recalcular `checkout_data_complete` e sem perder `masked_federal_tax_id`.

O teste discriminante também injeta uma chave interna em `rejectedItems` no
snapshot persistido e confirma que ela não chega à resposta pública.

- Replay canonical serializer: **PASS**.
- Replay public snapshot: **PRESERVED**.
- `checkout_data_complete` no replay: **PRESERVED**.
- `masked_federal_tax_id` no replay: **PRESERVED**.

### B16-13-A-002 — RESOLVED

O registry TypeScript agora representa estruturalmente, via componentes
fechados e `oneOf`, os ramos:

- `MERGED_PARTIAL` + review pending;
- `MERGED`, `GUEST_CART_ATTACHED`, `CUSTOMER_CART_PRESERVED` e `NO_ITEMS` +
  review clear.

Os testes verificam a topologia e as combinações opostas não são ramos
válidos. `CUSTOMER_CART_PRESERVED` permanece reservado, sem exemplo positivo
ou novo branch de runtime.

- OpenAPI `requiresReview ↔ MERGED_PARTIAL`: **STRUCTURALLY CLOSED**.

### B16-13-A-003 — RESOLVED

`CartReviewStateSchema` usa estados discriminados fechados:

- `requiresReview: true` exige `reviewRef` string não vazia;
- `requiresReview: false` exige `reviewRef: null`.

Os quatro testes de combinação passaram. O contrato do ACK não foi alterado:
`reviewRef: string | null` continua válido no request, inclusive `null` no
no-op sem review pending; a resposta de ACK usa o estado clear.

- Pending `reviewRef`: **NON-NULL REQUIRED**.
- Clear `reviewRef`: **NULL REQUIRED**.
- ACK `reviewRef: null`: **STILL VALID**.

### B16-13-B-001 — RESOLVED

No boundary do Cart Merge, `GUEST_CART_CAPABILITY_LOOKUP_INVALID` em cart ativo
é convertido para `MedusaError.NOT_FOUND` sanitizado. O caso de capability
foreign continua 404 não enumerável, sem cart ID, token hash, existência ou
detalhe interno. O caso de cart guest terminal após merge committed continua
`409 CART_MERGE_GUEST_CART_UNSUPPORTED`.

- Invalid capability: **404 NON-ENUMERATING**.
- Foreign capability: **404 NON-ENUMERATING**.
- Raw lookup-invalid → 500: **IMPOSSIBLE / PROVEN**.
- Terminal committed-merge conflict: **409 PRESERVED**.

## Verificações

### Focadas

- Unitário focal (`store-contract`, `decision`, `review-guard`): **3 suítes / 55 aprovados / 0 falhas / 0 skipped / exit 0**.
- HTTP `integration-tests/http/cart-merge-review.spec.ts`: **1 suíte / 51 aprovados / 0 falhas / 0 skipped / exit 0**.
- API Docs afetado (`store-contract`, `security`, `coverage`, `generation`, `swagger-config`, `runtime-documents`, `admin-contract`): **7 suítes / 276 aprovados / 0 falhas / 0 skipped / exit 0**.

### Superfície preservada

Os testes de `guest-cart-bff-guard`, `guest-cart-native-deny` e
`cart-checkout-store` passaram. As invariantes reconfirmadas são:

- M1 exact-set: **14**;
- BFF Cart exact-set: **8**;
- attach: **UNCHANGED / EXCLUDED**;
- native attach: **UNCHANGED / DENY**.

A suíte adicional `guest-cart-contract-matrix` reproduziu dois failures
históricos de harness (`req.scope.createScope is not a function` e `No active
cart found for the current actor`), sem relação com os sete arquivos R1.

### Full unit

Comando: `npm run test:unit` em `apps/backend`.

- 104 suítes;
- 103 passed, 1 failed;
- 1.897 testes passed, 2 failed;
- 0 skipped;
- 1 snapshot passed;
- exit 1.

A única suíte que falhou foi
`src/api-docs/__tests__/native-extensions.unit.spec.ts`, nos mesmos dois
testes e no mesmo fingerprint histórico: `GET /store/products` em
`apps/backend/src/api/middlewares.ts`. Portanto: **R1-caused regressions = 0**.

O `npm run build` também foi executado; terminou exit 1 por 18 diagnósticos
TypeScript fora dos sete arquivos R1, sem erro nos arquivos alterados. A fase
de lint do build não reportou erros, apenas warnings já existentes. Esse
problema de saúde preexistente do repositório não foi ampliado nem corrigido
nesta remediação autorizada.

## Integridade de artefatos e governança

Hashes antes/depois — byte-identical:

- Store: `d984abe7d4ffa3291742a57c780c7e5f0f282ca81fdb9bd4678a7b9a377b3c98`.
- Admin: `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a`.
- Webhooks: `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4`.

`git diff -- apps/backend/src/api-docs/generated`: **EMPTY**.

- Writer: **NOT EXECUTED**.
- `openapi:generate`: **NOT EXECUTED**.
- `openapi:check`: **NOT EXECUTED**.
- `git diff --check`: **PASS**.
- Push: **NOT PERFORMED**.
- Deploy: **NOT PERFORMED**.
- Provider/produção/banco/Redis: **NOT TOUCHED**.

`GOV-16-13-01` permanece incidente procedural histórico apenas; não houve
recorrência nesta remediação. O `16-13-SUMMARY.md` original permanece intacto
com a decisão histórica `HUMAN DECISION — REVISE-CONTRACT`.

## Revisões independentes

- Subagente E — Kierkegaard — GPT-5.6 Luna Extra high: **OVERALL PASS**.
- Subagente F — Boole — GPT-5.6 Luna Extra high: **OVERALL PASS**.
- Subagentes arquitetos: Ampere (A), Rawls (B), Arendt (C), Socrates (D),
  todos GPT-5.6 Luna Extra high; nenhum executou writer ou commit.
- Validação G — Gibbs — GPT-5.6 Luna Extra high: **INDEPENDENT FINAL VALIDATOR: PASS**.
  Confirmou independentemente o repositório, este resumo, as quatro
  remediações, os testes, os hashes, o escopo e a ausência de comandos
  proibidos.

## Estado final esperado

- Decisão histórica Plan 16-13: **REVISE-CONTRACT — PRESERVED**.
- Plan 16-14: **NOT STARTED / NOT AUTHORIZED**.
- Próxima ação permitida: **HUMAN REVIEW OF R1 EVIDENCE**.
