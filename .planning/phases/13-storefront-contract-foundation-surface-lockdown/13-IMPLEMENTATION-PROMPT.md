---
phase: 13-storefront-contract-foundation-surface-lockdown
artifact: implementation-prompt
status: complete-awaiting-human-review
created_at: 2026-08-07
scope: implementation-prompt-only
requirements: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]
requirements_covered: 8
requirements_complete: 0
plans: 7
plans_executed: 0
parallelization: false
auto_advance: false
manual_review_gate: true
approved_plan_revision: R5
approved_plan_baseline: 973310f7b6fb8d9731beca8368bdb131da092bfb
repository_baseline: 883404af68762f24b91b99c90660c06f194fc9e6
spec_sdd_revision: R1
spec_sdd_human_review: PASS
implementation_prompt_creation: AUTHORIZED
execution_status: not-authorized
branch: gsd/phase-13-storefront-contract-foundation-surface-lockdown
---

# Phase 13 Implementation Prompt — Storefront Contract Foundation & Surface Lockdown

## 0. Gate e finalidade

Este artefato consolida **como iniciar e governar a futura execução** dos sete
PLANs aprovados da Phase 13. Ele não substitui os PLANs e **não autoriza a
execução de nenhum deles**.

Estado humano corrente deste gate:

```text
Phase 13 CONTEXT: APPROVED
Phase 13 RESEARCH: APPROVED
Phase 13 PLAN R5: APPROVED
Phase 13 SPEC/SDD R1: APPROVED BY HUMAN RE-REVIEW
Phase 13 Implementation Prompt creation: AUTHORIZED

Execution: NOT AUTHORIZED
13-01: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
Frontend M1: BLOCKED
```

### 0.1 Reconciliação do snapshot documental

O baseline remoto `883404af68762f24b91b99c90660c06f194fc9e6` ainda contém
`STATE.md`, `13-SPEC.md`, `13-SDD.md` e `13-VALIDATION.md` com wording anterior
à re-revisão humana, por exemplo `R1 COMPLETE / AWAITING HUMAN RE-REVIEW` e
`Implementation Prompt: NOT AUTHORIZED`.

Esses campos de **status de gate** foram supersedidos pela decisão humana
posterior `P13-SPEC-SDD-R1 HUMAN RE-REVIEW: PASS` e pela autorização explícita
para criação deste Implementation Prompt. Isso não altera os contratos técnicos
desses documentos e não concede autorização para EXECUTION.

Este artefato não deve editar retroativamente aqueles documentos para esconder
a linhagem histórica. Qualquer sincronização documental de STATE/SPEC/SDD é um
gate separado.

---

## 1. Autoridades vinculantes

Antes de cada plano futuramente autorizado, ler integralmente:

```text
AGENTS.md
.planning/PROJECT.md
.planning/ROADMAP.md
.planning/REQUIREMENTS.md
.planning/STATE.md
.planning/config.json

.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md
.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-RESEARCH.md
.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-SPEC.md
.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-SDD.md
.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-VALIDATION.md
.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-0N-PLAN.md
```

Quando existir predecessor, ler também o `13-0(N-1)-SUMMARY.md` aprovado.

### 1.1 Precedência

Para comportamento e desenho:

```text
1. CONTEXT D13-01..D13-32 aprovado
2. SPEC/SDD R1 aprovado
3. PLAN R5 aprovado
4. VALIDATION
5. RESEARCH
6. requirements/docs canônicos
7. as-built apenas para fato/integration detail
```

Divisão operacional:

```text
SPEC       = WHAT observável
SDD        = HOW aprovado
PLAN       = tasks, files_modified, commands, checkpoints e acceptance criteria
VALIDATION = provas e evidências
```

O PLAN continua autoridade para allowlist de arquivos e comandos. SPEC/SDD R1
continua autoridade quando um texto histórico de PLAN divergir do contrato de
comportamento já corrigido.

Divergência material que não possa ser resolvida por essa precedência:

```text
ACTIVE PLAN: BLOCKED
```

Não editar silenciosamente CONTEXT/RESEARCH/SPEC/SDD/PLAN/VALIDATION durante
execução para fazer um gate passar.

---

## 2. Topologia de execução

A decomposição aprovada é imutável:

```text
13-01 — Surface Manifest & Feasibility Gate
  ↓ human review
13-02 — Fail-Closed Store Lockdown
  ↓ human review
13-03 — Store Error Contract & Correlation
  ↓ human review
13-04 — Idempotency Foundation
  ↓ human pre-migration checkpoint dentro do plano
  ↓ human continuation
  ↓ human review ao final
13-05 — Resource Version & Atomic Concurrency
  ↓ human review
13-06 — Store OpenAPI 1.1.0 Foundation
  ↓ human review
13-07 — Security, Native-Bypass & Final Validation
  ↓ human review
```

Configuração vinculante:

```text
mode = interactive
workflow.auto_advance = false
workflow._auto_chain_active = false
parallelization = false
autonomous = false em todos os PLANs
```

Nenhum `PASS` de predecessor autoriza automaticamente o sucessor.

Após futuro `13-07 PASS`, ainda são gates separados:

```text
Phase 13 VERIFICATION
Phase 13 REVIEW
Phase 13 CLOSURE
```

Phase 14 e Frontend continuam bloqueados até seus gates próprios.

---

## 3. Baselines

### 3.1 Baseline do PLAN

```text
973310f7b6fb8d9731beca8368bdb131da092bfb
```

### 3.2 Baseline documental remoto deste Implementation Prompt

```text
883404af68762f24b91b99c90660c06f194fc9e6
```

No início futuro e explicitamente autorizado de `13-01`, registrar o
`PHASE13_EXECUTION_BASE_SHA` factual do checkout aprovado antes da primeira
alteração runtime/test e preservá-lo nos SUMMARYs seguintes. Não inventar ou
recalcular esse SHA em cada plano.

---

## 4. Invariantes globais

### 4.1 Order birth

```text
Order creation = canonical trusted Stripe webhook only
```

Qualquer Store request:

```text
MUST NOT create Order
MUST NOT reach completeCart/createOrder Order-birth path
```

Controle positivo permanece:

```text
trusted payment_intent.succeeded
→ PaymentAttempt payment_confirmed_by_webhook
→ CheckoutCompletionLog
→ completeCartWorkflow internal
→ exactly one Order
```

Replay/concurrent replay continua em exatamente um Order.

### 4.2 Store surface

```text
Medusa = 2.16.0
runtime Store = 58
native = 51
local non-overlapping = 7

AUTHORIZED = 0
EXTENDED = 10
BLOCKED = 17
OUTSIDE_FRONTEND_M1 = 31
UNKNOWN = invalid
M1_ENABLED = 0
```

Cada entrada possui, de forma independente:

```text
classification
runtime_policy
m1_enablement
openapi_m1_expectation
rationale
```

Regras:

```text
BLOCKED → DENY
UNKNOWN/lookup ausente → DENY + drift failure
EXTENDED != runtime allowed automaticamente
OUTSIDE_FRONTEND_M1 != DENY automaticamente
PRESERVE_LEGACY != M1_ENABLED
PRESERVE_LEGACY != executable M1 OpenAPI
```

Vocabulário único de `openapi_m1_expectation`:

```text
include_executable_m1 | exclude | support_only
```

### 4.3 BFF boundary

```text
Browser → same-origin Next.js BFF → Medusa Store API
```

Phase 13 não cria Next.js/BFF.

Publishable key, JWT e capabilities futuras permanecem server-side. CORS e
publishable key não constituem autorização BFF.

### 4.4 Domínio/segurança

Preservar:

```text
provider/runtime failure never rewrites financial truth
Pix frontend remains outside M1
refund truth remains trusted-webhook-driven
refund != automatic Order cancellation
purchase_completed remains durable backend truth
Gelato remains downstream of confirmed Order + durable gates
```

Nunca expor/persistir de forma proibida:

```text
raw Idempotency-Key
STORE_IDEMPOTENCY_KEY_PEPPER
JWT
capability
guest capability
confirmation token/session
CPF
client_secret
Pix QR/copia-e-cola
provider raw payload
stack/raw internal error
```

---

## 5. SPEC/SDD R1 — contratos que não podem regredir

### 5.1 Reconciliation

```text
reconciliation_required
→ completed
  ONLY after explicit review/evidence proving successful effect

reconciliation_required
→ failed_terminal
  ONLY after explicit review/evidence proving terminal failure/no successful effect

reconciliation_required
→ reconciliation_unresolved
  ONLY when the 7d review deadline expires unresolved
```

Proibido:

```text
reconciliation_required → processing as blind retry
reconciliation_required → failed_retryable
automatic success/failure inference
automatic retry queue
```

```text
resolution != retry
```

`reconciliation_unresolved` é terminal de auditoria e não significa financial,
provider ou business success.

### 5.2 `state_version`

```text
StoreIdempotencyRecord.state_version
→ positive monotonic lifecycle transition generation
→ protects idempotency lifecycle transitions
```

Não confundir com:

```text
StoreResourceVersion.version
→ protects application-resource mutation concurrency
```

Exactly-one lifecycle claim deve ser provado por:

```text
transaction + row lock + expected state predicate
```

ou:

```text
atomic conditional update
WHERE state = expected_state
  AND state_version = expected_state_version
```

ou mecanismo PostgreSQL equivalente que prove exactly-one claimant e no lost
transition.

### 5.3 Router ordering

Não declarar precedência factual do framework antes da execução.

```text
APPROVED TARGET:
Store Surface Guard executes before any Store business handler/middleware that
could violate fail-closed behavior.

EXECUTION-TIME FACT:
exact Medusa 2.16.0 router/middleware ordering is verified in 13-02.
```

Se a ordem factual impedir o interception model:

```text
13-02 BLOCKED
```

Sem monkey patch de `node_modules`.

---

## 6. Escopo externo e dependencies

Nenhum PLAN da Phase 13 autoriza:

```text
production/Heroku mutation
remote Supabase/PostgreSQL mutation
real Stripe/Gelato/Resend/PostHog/Sentry calls
Correios API
deploy/rollback/scale/restart production
frontend
Phase 14+
npm install
new dependency
package.json/package-lock.json change
```

PostgreSQL autorizado significa **somente disposable local PostgreSQL** pelo
harness já versionado.

Redis nunca é correctness truth.

Se dependency nova se tornar necessária:

```text
ACTIVE PLAN: BLOCKED
```

---

# 7. Execution Packet — 13-01

## Preconditions

Somente autorização humana explícita de `13-01` pode iniciar este packet.

Requirements: `FND-01`, `FND-06`.

Allowlist exata do PLAN:

```text
apps/backend/src/api/store-surface/manifest.ts
apps/backend/scripts/store-surface/scan-installed.ts
apps/backend/src/api/store-surface/__tests__/manifest.unit.spec.ts
apps/backend/src/infrastructure/store-foundation-transaction-compatibility.ts
apps/backend/src/modules/checkout/__tests__/store-foundation-transaction-compatibility.spec.ts
```

### Task 1 — manifest/scanner

Materializar exatamente:

```text
58/58
51 native + 7 local
0/10/17/31
M1_ENABLED=0
0 unknown/duplicate
```

Cada EXTENDED e OUTSIDE recebe decisão individual `DENY` ou
`PRESERVE_LEGACY` com rationale factual. Não inferir policy pela classificação.

`DENY + PRESERVE_LEGACY = 58` é execution-time fact.

Executar exatamente os verifies do `13-01-PLAN.md`.

### Task 2 — Wave 0 binária

Disposable PostgreSQL prova:

```text
same factual transaction manager
single atomic commit
injected failure rolls back both sides
two expected-version writers → exactly one winner
Redis absent/failing → same correctness
```

Duas transactions correlacionadas ou two-commit fallback = FAIL.

### Task 3 — blocking human checkpoint

Produzir `13-01-SUMMARY.md`, apresentar evidence e parar.

Somente human PASS permite pedir autorização de `13-02`.

---

# 8. Execution Packet — 13-02

Precondition: `13-01 PASS` humano.

Requirements: `FND-01`, `FND-02`, `FND-07`.

Paths fixos:

```text
apps/backend/src/api/store-surface/guard.ts
apps/backend/src/api/middlewares.ts
apps/backend/src/api/store/carts/[id]/complete/route.ts
apps/backend/src/api/store-surface/__tests__/guard.unit.spec.ts
apps/backend/integration-tests/http/store-surface-lockdown.spec.ts
```

Mais somente o `<legacy-test-exact-set>` de **1..4 paths únicos**, fechado antes
da primeira edição legada.

### Task 1 — inventory antes da edição

Criar em `13-02-SUMMARY.md`:

```text
## Legacy test impact inventory (pre-change)
exact_set_status: LOCKED_BEFORE_EDIT
```

Tabela obrigatória:

```text
Path | Case/describe/test | Family | Class | Reason | Coverage replacement
```

Classes:

```text
A — OBSOLETE_CONTRACT_EXPECTATION
B — STILL_VALID_INTERNAL_INVARIANT
C — MUST_REMAIN_GREEN
```

Family: `unit|http|modules`.

B exige replacement. C não pode ser alterado por conveniência.

Proibido delete suite, `.skip`, `.only`, relaxamento sem justificativa ou
snapshot para esconder regressão.

### Task 2 — guard/override/matriz

Provar ordering factual Medusa 2.16.0 durante este plano.

Enforcement:

```text
UNKNOWN → DENY
BLOCKED → DENY
runtime_policy DENY → DENY
PRESERVE_LEGACY → accepted v1.0 behavior only
M1_ENABLED → no entries in Phase 13
```

`/store/carts/{id}/complete` recebe defesa local em profundidade.

Cobrir method/path variants, HEAD, OPTIONS, trailing/double slash, encoded path,
unknown/alias e static-vs-param.

DENY exige handler/workflow/Order zero. PRESERVE_LEGACY exige compatibilidade
legada sem M1 enablement/exposure.

Executar os verifies literais do PLAN, inclusive o runner por family do exact-set
legado e a seleção fechada de invariants.

### Task 3

Human checkpoint. Criar `13-02-SUMMARY.md` e parar.

---

# 9. Execution Packet — 13-03

Precondition: `13-02 PASS` humano.

Requirement: `FND-03`.

Allowlist:

```text
apps/backend/src/api/store-surface/errors.ts
apps/backend/src/api/middlewares.ts
apps/backend/src/api/store-surface/__tests__/errors.unit.spec.ts
apps/backend/integration-tests/http/store-error-contract.spec.ts
```

Implementar `StoreErrorResponse` fechado:

```text
code: string
message: string
correlationId?: string
retryable: boolean
fieldErrors?: Record<string,string>
cart?: safe primitive only
```

`code` é machine contract; `message` não é.

Cobrir status families 400/401/403-or-404/409/412/422/429/500/503 e sanitizar
unknown/provider.

Correlation input permitido:

```text
[A-Za-z0-9._-]{1,128}
```

Missing/invalid → UUID gerado. Header/body/log/Sentry usam o mesmo sanitized ID.

Admin/Webhooks mantêm seus contratos.

Executar verifies do PLAN, produzir `13-03-SUMMARY.md` e parar no human gate.

---

# 10. Execution Packet — 13-04

Preconditions:

```text
13-03 PASS humano
13-01 Wave 0 PASS
```

Requirements: `FND-04`, `FND-05`.

Allowlist do PLAN:

```text
docs/DB_MODEL_v1.22.md
apps/backend/.env.template
apps/backend/src/config/env.ts
apps/backend/src/config/__tests__/env.unit.spec.ts
apps/backend/src/modules/store-idempotency/index.ts
apps/backend/src/modules/store-idempotency/service.ts
apps/backend/src/modules/store-idempotency/models/store-idempotency-record.ts
<CLI-generated store-idempotency migration>
apps/backend/src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts
apps/backend/src/jobs/store-idempotency-lifecycle.ts
apps/backend/src/jobs/__tests__/store-idempotency-lifecycle.unit.spec.ts
apps/backend/medusa-config.ts
apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
```

## 10.1 Task 1 — nove paths antes da migration

Os nove paths da Task 1 são exatamente:

```text
docs/DB_MODEL_v1.22.md
apps/backend/.env.template
apps/backend/src/config/env.ts
apps/backend/src/config/__tests__/env.unit.spec.ts
apps/backend/src/modules/store-idempotency/index.ts
apps/backend/src/modules/store-idempotency/service.ts
apps/backend/src/modules/store-idempotency/models/store-idempotency-record.ts
apps/backend/medusa-config.ts
apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
```

Materializar `StoreIdempotencyRecord` conforme SPEC/SDD R1, incluindo
`state_version`, HMAC-SHA-256, pepper dedicado/versionado, finite lifecycle e
module registration `store_idempotency` exatamente uma vez.

`STORE_IDEMPOTENCY_KEY_PEPPER` em production:

```text
required
base64url
decoded >=32 bytes
never logged/persisted
```

Caller `Idempotency-Key`:

```text
visible US-ASCII [!-~]
1..255 bytes
byte-for-byte
no trim/case-fold/Unicode normalization
```

### Task-1 gates obrigatórios **antes do checkpoint humano**

Executar literalmente:

```bash
cd apps/backend && npm run test:unit -- --runTestsByPath \
  src/config/__tests__/env.unit.spec.ts \
  src/infrastructure/__tests__/medusa-config.unit.spec.ts \
  --runInBand
```

E também:

```bash
ADMIN_DISABLED=true npm run build -w @dtc/backend
```

**Esse build pertence ao Task 1 do 13-04 e deve estar PASS antes do checkpoint
pré-migration.** Não omitir nem transferir esse gate para 13-05/13-07.

Nenhuma migration pode existir antes do checkpoint.

## 10.2 Task 2 — human pre-migration checkpoint

STOP obrigatório.

Revisar integralmente os nove paths da Task 1 e executar o `git diff --check --`
exact-set definido no PLAN.

Sem `approved` humano explícito:

```text
NO db:generate
NO migration
NO Task 3
```

## 10.3 Task 3 — generation/lifecycle/PG

Somente após autorização de continuação:

```text
capture before migration exact-set
→ execute exactly one factual Medusa CLI db:generate for store_idempotency
→ capture after exact-set
→ delta exactly one migration
→ capture factual source filename/exported class/framework identity
→ review DDL
```

Não preselecionar timestamp. Não rename/copy/class-edit estético.

Migration DDL deve refletir o contrato aprovado, inclusive seis states,
`state_version`/claim predicate, counters/deadlines/terminal expiry e indexes.

Scheduled job:

```text
name: store-idempotency-lifecycle
schedule: "* * * * *"
PostgreSQL = truth
Redis = coordination only
```

Lifecycle timing:

```text
processing stale = 5m
recovery decision horizon = 15m
failed_retryable = max 8 attempts OR 24h
reconciliation review = 7d
default terminal retention = 24h
reconciliation_unresolved retention = 30d
```

Aplicar o contrato R1 de reconciliation. O job pode terminalizar uma
`reconciliation_required` vencida como `reconciliation_unresolved`; uma
resolução anterior para `completed`/`failed_terminal` exige evidence/review
explícito e não é retry automático.

Executar exatamente os verifies unit + disposable PostgreSQL do PLAN.

Produzir `13-04-SUMMARY.md` com registration/config, migration identity, DDL,
exact-set e evidências. Parar para human review antes de `13-05`.

---

# 11. Execution Packet — 13-05

Preconditions:

```text
13-04 complete + human-approved
13-04 migration factual captured
Wave 0 PASS
DB_MODEL_v1.22 approved
```

Requirement: `FND-06`.

Allowlist:

```text
apps/backend/src/modules/store-resource-version/index.ts
apps/backend/src/modules/store-resource-version/service.ts
apps/backend/src/modules/store-resource-version/models/store-resource-version.ts
<CLI-generated store-resource-version migration>
apps/backend/src/modules/store-resource-version/__tests__/store-resource-version.postgres.spec.ts
apps/backend/medusa-config.ts
apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts
```

## 11.1 Task 1 — ordem vinculante

Executar na ordem factual:

```text
1. create index/service/model
2. register store_resource_version exactly once
3. update medusa-config.unit.spec.ts
4. execute config regression
5. require PASS
6. only then db:generate
7. capture migration exact-set/identity
8. DDL review
9. execute ADMIN_DISABLED=true npm run build -w @dtc/backend
10. require PASS
11. only then Task 1 complete
```

A precondition de `db:generate` é:

```text
module registered + config regression PASS
```

O build não precisa anteceder generation, mas é obrigatório antes do Task 1
complete. Build vermelho → `13-05 BLOCKED`; o build de `13-07` não substitui.

Config regression prova:

```text
store_idempotency_count = 1
store_resource_version_count = 1
existing modules/providers preserved
Redis config preserved
no replacement/mutation accidental
```

Migration: CLI-authoritative, exactly one, sem rename. Collision/ordering ambíguo
versus migration factual do 13-04 → BLOCKED.

## 11.2 Task 2 — disposable PostgreSQL

Provar lazy serialized bootstrap `version=1`, existing data, two concurrent first
accesses, monotonic CAS, stale zero mutation, two writers one winner, rollback
conjunto e Redis failure independence.

Não materializar Cart ETag/If-Match/412/snapshot/invalidation; isso pertence à
Phase 15.

## 11.3 Task 3

Human review do primitive e da boundary Phase 15.

`13-05-SUMMARY.md` deve conter inequivocamente:

```text
module_registration:
  store_idempotency_count: 1
  store_resource_version_count: 1
  config_regression: PASS
  registration_proven_before_db_generate: YES
  db_generate_executed_after_registration: YES
```

Além de migration identity/DDL/exact-set/precedence e backend build PASS.

Parar antes de `13-06`.

---

# 12. Execution Packet — 13-06

Precondition: `13-05 PASS` humano.

Requirements: `FND-03`, `FND-07`, `FND-08`.

## 12.1 Closed-set exato de 10 paths

```text
apps/backend/src/api-docs/components/errors.ts
apps/backend/src/api-docs/components/parameters.ts
apps/backend/src/api-docs/components/headers.ts
apps/backend/src/api-docs/components/security-schemes.ts
apps/backend/src/api-docs/components/index.ts
apps/backend/src/api-docs/document.ts
apps/backend/src/api-docs/coverage/verify-coverage.ts
apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts
apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts
apps/backend/src/api-docs/generated/store.openapi.json
```

Nenhum 11º path.

Target:

```text
Store OpenAPI = 1.1.0
TypeScript registry = sole authority
generated JSON = generated artifact only
manual JSON edit = forbidden
```

Components:

```text
StoreErrorResponse
Idempotency-Key
If-Match
ETag
x-correlation-id
Retry-After
StoreMajorMoney
StoreMinorMoney
BFF security descriptions
```

Money BRL major/minor explícito; no global conversion.

## 12.2 Três exact-sets

`coverage.unit.spec.ts` pertence explicitamente ao 13-06 e prova:

```text
runtime = 58 = 51 native + 7 local
manifest = 58 / 0-10-17-31
M1 executable Store business operations = AUTHORIZED enabled + EXTENDED enabled = 0
```

`PRESERVE_LEGACY`, disabled EXTENDED, BLOCKED e OUTSIDE ficam fora do terceiro
set. Health/support é contado separadamente. Admin/Webhooks coverage não pode
ser relaxado.

## 12.3 Writer/check separation

Task 1: componentes; revisar diff dos cinco component paths antes da Task 2.

Task 2, depois de registry/coverage tests:

```bash
npm run openapi:generate -- --surface store
npm run openapi:lint
```

Revisar o generated diff nos 10 paths. Somente `store.openapi.json` pode ser o
artefato generated.

**Proibido em 13-06:**

```text
npm run openapi:check
```

Criar `13-06-SUMMARY.md`, executar human checkpoint e parar.

---

# 13. Execution Packet — 13-07

Preconditions:

```text
13-01..13-06 PASS + human-approved
commits correspondentes concluídos
checkout limpo antes do clean openapi:check
```

Requirements: `FND-01..FND-08`.

## 13.1 Exact file allowlist

Somente:

```text
apps/backend/integration-tests/http/store-foundation-final.spec.ts
apps/backend/src/api/store-surface/__tests__/security-negative.unit.spec.ts
apps/backend/src/modules/checkout-completion/__tests__/store-order-birth-canonical.postgres.spec.ts
```

Nenhum runtime/model/migration/OpenAPI registry/JSON edit.

### Task 1

Revalidar surface/lockdown/BFF/error/security e finite idempotency lifecycle,
inclusive R1 reconciliation e `state_version` exactly-one claim.

Executar os unit + HTTP verifies literais do PLAN.

### Task 2

Disposable PostgreSQL prova:

```text
Store → completeCart invocation 0 / Order 0
trusted webhook → exactly one Order
same event replay/concurrent replay → still exactly one Order
```

Sem Stripe real e sem alterar CheckoutCompletionLog.

### Task 3 — blocking human checkpoint e clean gates

Somente depois de Tasks 1–2 committed e checkout limpo:

```bash
npm run openapi:check
npm run lint -w @dtc/backend && ADMIN_DISABLED=true npm run build -w @dtc/backend
git diff --check
```

Não rodar writer antes/dentro do clean check. Se writer for necessário para fazer
`openapi:check` passar, o gate está BLOCKED e a correção pertence ao 13-06.

Consolidar evidência `FND/B13/D13` e parar em `13-07-SUMMARY.md`.

Mesmo com todos os gates verdes:

```text
requirements complete != automatic
phase complete != automatic
Phase 14 != authorized
Frontend != authorized
```

---

## 14. Migration governance consolidada

Somente 13-04 e 13-05 geram migrations desta Phase.

Para cada módulo:

```text
model/module definition
→ module registration
→ dedicated config regression PASS
→ db:generate exactly once
→ delta exactly one migration
→ factual CLI filename/class/history identity
→ DDL review
```

Se delta = 0 ou >1: BLOCKED.

Proibido:

```text
preselected MigrationYYYY
rename/copy to fit PLAN
class edit for cosmetic ordering
duplicate equivalent migration
Prisma/TypeORM schema sync
Supabase push
remote DB migration
```

13-04 exige checkpoint humano **antes** da primeira generation.

13-05 exige config regression PASS **antes** da segunda generation e build PASS
antes de concluir Task 1.

---

## 15. OpenAPI governance consolidada

```text
13-06:
  registry/components/coverage
  writer Store
  artifact review
  openapi:lint
  NO clean openapi:check

13-07:
  NO writer
  clean checkout
  read-only openapi:check
```

Writer imediatamente antes/dentro do clean check invalida a prova.

---

## 16. Evidence / stop policy

A autoridade detalhada permanece `13-VALIDATION.md`.

Resultado de cada gate:

```text
PASS
or
BLOCKED
```

Nunca:

```text
PASS WITH KNOWN DEBTS
```

Stop imediatamente por qualquer um dos seguintes:

```text
unexpected path outside active PLAN allowlist
package/lockfile/dependency change
provider/remote DB/production action
secret/PII/raw payload evidence leak
manifest/runtime exact-set drift
M1_ENABLED > 0
PRESERVE_LEGACY promoted to M1
Store-created Order/completeCart invocation
two idempotency winners
two lifecycle claimants
two CAS winners
PostgreSQL atomicity failure
Redis required for correctness
nonterminal state without finite progression
terminal state without finite expiry
blind reconciliation retry
migration generation delta != 1
migration identity/order ambiguity
manual OpenAPI JSON edit
writer masking clean check
required test/build/lint/OpenAPI gate red
premature requirement/phase completion
auto-advance attempt
```

Falha encontrada em 13-07 deve voltar ao **owner plan**; não corrigir
ad hoc em file fora do allowlist do 13-07.

---

## 17. Security evidence

Canaries são sempre sintéticas. Evidência deve ser allowlist-first e sanitizada.

Zero match onde proibido para:

```text
raw Idempotency-Key
pepper
JWT
capabilities
confirmation tokens
CPF
client_secret
Pix material
provider raw payload
stack/raw internal error
```

Nenhum secret real em SUMMARY, logs ou fixtures.

---

## 18. SUMMARYs e manual gates

Cada plano cria seu `13-0N-SUMMARY.md` segundo o workflow GSD factual e para no
checkpoint humano previsto no próprio PLAN.

O SUMMARY deve registrar fatos, nunca resultados inferidos:

```text
plan/status
requirements e blockers abordados
files changed / allowlist
commands + resultados
migration identity quando aplicável
security/negative proofs
external systems not contacted
blocking failures/warnings
next human gate
```

Nenhum SUMMARY autoriza o próximo PLAN.

---

## 19. Current completion counters

Durante este Implementation Prompt e antes da execução:

```text
D13 represented: 32/32
FND covered: 8/8
FND complete: 0/8
B13 mapped: 7/7
Plans: 7
Plans executed: 0/7
Milestone requirements complete: 0/91
Phases complete: 0/10
Frontend M1: BLOCKED
```

Implementation evidence futura não deve atualizar completion counters antes do
gate formal apropriado.

---

## 20. Human review deste Implementation Prompt

Checklist obrigatório:

- [ ] exatamente 7 execution packets, lineares;
- [ ] nenhuma autorização de execução embutida;
- [ ] PLANs continuam autoridade de paths/tasks/commands;
- [ ] SPEC/SDD R1 reconciliation preservada;
- [ ] `state_version` preservado e distinto de `StoreResourceVersion.version`;
- [ ] router ordering permanece execution-time fact do 13-02;
- [ ] Store = 58 / 51+7 / 0-10-17-31 / M1_ENABLED=0;
- [ ] `13-04` Task 1 inclui unit config/env **e build PASS antes do checkpoint**;
- [ ] `13-04` checkpoint humano ocorre antes de qualquer migration;
- [ ] `13-04`/`13-05` migrations continuam CLI-generated e unresolved até execução;
- [ ] `13-05` registration-before-generation preservado;
- [ ] `13-05` build local preservado antes de Task 1 complete;
- [ ] `13-06` closed-set exatamente 10 paths;
- [ ] `coverage.unit.spec.ts` pertence ao 13-06;
- [ ] writer + lint ficam em 13-06;
- [ ] clean `openapi:check` fica apenas em 13-07;
- [ ] `13-07` altera somente três test files;
- [ ] nenhuma Phase 14–21 ou frontend materializada;
- [ ] nenhuma dependency/package/lockfile autorizada;
- [ ] nenhum provider/deploy/DB remoto autorizado;
- [ ] requirements complete permanecem 0/8;
- [ ] plans executed permanecem 0/7.

Resultado deste gate documental:

```text
PASS
or
BLOCKED
```

---

## 21. Próximo passo permitido

Após **human review PASS deste Implementation Prompt**, o único próximo gate
possível é:

```text
explicit human authorization of 13-01
```

Mesmo após aprovação deste documento:

```text
13-01 remains NOT AUTHORIZED until explicit separate authorization
```

Não iniciar `13-01`, PostgreSQL, tests, migration generation, OpenAPI writer,
provider ou deploy automaticamente.

**STOP.**
