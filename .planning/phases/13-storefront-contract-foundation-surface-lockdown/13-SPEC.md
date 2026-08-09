---
phase: 13-storefront-contract-foundation-surface-lockdown
artifact: spec
status: approved-active-execution
created_at: 2026-08-07
updated_at: 2026-08-09
scope: spec-sdd-only
gate: P13-SPEC-SDD-R1
requirements: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]
requirements_covered: 8
requirements_complete: 0
plans: 7
plans_executed: 5
implementation_prompt: approved
execution_status: executing
manual_review_gate: true
baseline_plan_commit: 973310f7b6fb8d9731beca8368bdb131da092bfb
branch: gsd/phase-13-storefront-contract-foundation-surface-lockdown
---

# Phase 13 SPEC — Storefront Contract Foundation & Surface Lockdown

## 0. Autoridade e gate

Este documento fixa **o que** a Phase 13 entrega: contratos observáveis, invariantes,
limites de fase e critérios de aceitação. Não autoriza Implementation Prompt,
execução dos planos `13-01..13-07`, runtime, testes, migrations, OpenAPI writer,
package/lockfile, provider, deploy ou frontend.

**Precedência em divergência:**

```text
1. Phase 13 CONTEXT approved decisions D13-01..D13-32
2. Phase 13 PLAN R5 approved (baseline 973310f)
3. Phase 13 VALIDATION approved
4. Phase 13 RESEARCH
5. canonical project requirements / PRD / SRS / traceability
6. as-built code (factibilidade e integration detail apenas)
```

Rotulagem obrigatória de afirmações materiais:

| Label | Significado |
|---|---|
| `AS-BUILT` | fato do código/pacote instalado hoje |
| `APPROVED TARGET` | estado obrigatório após execução futura da Phase 13 |
| `FUTURE OWNER-PHASE` | comportamento das Phases 14–22 / frontend |
| `EXECUTION-TIME FACT` | identidade/contagem só observável na execução |

Artefato irmão (como): `13-SDD.md`.
Convenção factual do repositório: SPEC e SDD separados (igual Phase 12).

Este gate documental foi posteriormente **HUMAN APPROVED — PASS**. O Implementation Prompt também foi aprovado e a execução da Phase 13 está em andamento sob gates manuais; 13-01..13-05 estão HUMAN APPROVED — PASS, 13-06 está EXECUTION AUTHORIZED e 13-07 permanece NOT AUTHORIZED.

---

## 1. Scope

### 1.1 In scope (`APPROVED TARGET`)

- `FND-01..FND-08` cobertos (não completos);
- inventário/manifest único das **58** operações Store runtime (Medusa `2.16.0`);
- classificação `AUTHORIZED|EXTENDED|BLOCKED|OUTSIDE_FRONTEND_M1` e
  `runtime_policy` independente `DENY|PRESERVE_LEGACY|M1_ENABLED`;
- guard HTTP fail-closed Store + defesa pontual do bypass nativo de Order birth;
- envelope `StoreErrorResponse` + correlation sanitizada (Store only);
- módulo/persistência `StoreIdempotencyRecord` + lifecycle job;
- módulo/persistência `StoreResourceVersion` + CAS genérico (sem Cart público);
- fundação Store OpenAPI `1.1.0` (registry TypeScript) com **0** operações
  business executáveis M1;
- provas negativas de native-bypass / Order-zero / security canaries;
- Wave 0 de atomicidade transacional (prova binária).

### 1.2 Out of scope (`FUTURE OWNER-PHASE`)

| Domínio | Owner |
|---|---|
| Auth, verificação, reset, refresh | Phase 14 |
| Guest capability / mutações Cart finais / ETag·If-Match·412 Cart | Phase 15 |
| Merge/review | Phase 16 |
| CPF / checkout BR / consentimentos | Phase 17 |
| Shipping quote/select | Phase 18 |
| PaymentAttempt storefront hardening | Phase 19 |
| Confirmação assíncrona | Phase 20 |
| Order summary / catalog revalidation | Phase 21 |
| Types/Zod/fixtures/mocks/release kit | Phase 22 |
| Frontend / Next.js / BFF runtime | fora do backend milestone |
| Provider real, deploy, Heroku, Supabase remoto, Stripe/Gelato/Resend/PostHog/Sentry externos | fora desta phase |

### 1.3 Assumptions

- Pin Medusa permanece `2.16.0` matched set; upgrade reabre inventário.
- PostgreSQL descartável + harness existente bastam para provas PG futuras.
- Redis Locking já configurado permanece coordenação; nunca verdade.
- Nenhuma dependência nova é necessária (`APPROVED TARGET` de RESEARCH/PLAN).
- Frontend M1 permanece bloqueado até Phase 22 + closeout humano.

### 1.4 Dependencies

- Milestone v1.0 fechado/arquivado/tagueado/publicado (imutável).
- API-DOCS-01 fechada; registry/generator/coverage preservados.
- Phase 13 CONTEXT, RESEARCH e PLAN R5 aprovados.
- Wave 0 PASS humano em `13-01` bloqueia `13-02..13-07` se FAIL.
- `13-04` completo (migration idempotency) precede `13-05`.

### 1.5 Hard invariants globais (imutáveis)

```text
1. Order creation: canonical Stripe webhook only
2. Store/BFF MUST NEVER synchronously/directly create Order
3. purchase_completed: durable backend domain/outbox truth
4. Gelato: only after confirmed Order + durable downstream gates
5. financial truth: provider/runtime failure never rewrites financial truth
6. Pix: outside Frontend M1 (OUTSIDE_FRONTEND_M1)
7. refund: financial truth only after trusted Stripe webhook;
   refund != automatic Order cancellation
8. Any Store request MUST NOT reach completeCart/createOrder Order-birth path
   except the canonical trusted webhook flow (positive control)
9. Secrets/tokens/capabilities/CPF cru never in logs/telemetry/OpenAPI examples
10. Tag/Release/archive v1.0 remain immutable
```

### 1.6 Phase boundaries

```text
13-01 → 13-02 → 13-03 → 13-04 → 13-05 → 13-06 → 13-07
Waves: 7 | parallelization: false | autonomous: false
Plans human-approved executed: 5/7
Phase 13 requirements covered: 8/8 | complete: 0/8
Milestone requirements complete: 0/91 | phases complete: 0/10
```

Não criar `13-08`, nova wave, paralelização, novo requirement ou feature M1.

---

## 2. Requirement traceability

Nenhum requisito é marcado complete neste SPEC/SDD.

| ID | Contrato verificável (`APPROVED TARGET`) | SPEC § | SDD components | Plans | Future tests/evidence |
|---|---|---|---|---|---|
| FND-01 | Inventário 58/58 classificado; 0 unknown; distribuição 0/10/17/31; cada entrada com classification+runtime_policy+rationale+openapi expectation+m1 enablement | §4 | Manifest, scanner | 13-01, 13-02, 13-07 | manifest.unit + scan-installed + HTTP final |
| FND-02 | Allowlist fail-closed; DENY antes do handler; zero Order Store; positive webhook control | §5, §15 | Guard, complete override | 13-02, 13-07 | lockdown HTTP + workflow spy + PG Order zero |
| FND-03 | `StoreErrorResponse` fechado; codes estáveis; correlation sanitizada; Admin/Webhooks isolados | §9, §10 | Error normalizer | 13-03, 13-06, 13-07 | errors.unit + store-error-contract HTTP + OpenAPI schema |
| FND-04 | `StoreIdempotencyRecord` persistido; fingerprint; TTL; lifecycle job `* * * * *` | §6, §7 | store_idempotency module + job | 13-04, 13-07 | env/config unit + postgres + lifecycle unit |
| FND-05 | Intent incompatível → 409 zero side effect; race um winner; idempotency ≠ locks/CAS | §6 | claim/replay APIs | 13-04, 13-07 | concurrency/lifecycle PG |
| FND-06 | `StoreResourceVersion` integer positivo monotônico; CAS atômico; Wave 0 shared TM | §8 | store_resource_version + Wave 0 adapter | 13-01, 13-05, 13-07 | Wave 0 PG + resource-version PG |
| FND-07 | BFF same-origin único consumidor; credentials server-side; OpenAPI documenta BFF→Medusa | §11 | Guard boundary + security schemes | 13-02, 13-06, 13-07 | BFF HTTP + OpenAPI security |
| FND-08 | Store OpenAPI `1.1.0`; registry authority; executable business = 0; money BRL explícito | §12, §13 | api-docs components/registry/writer | 13-06, 13-07 | store-contract + coverage + writer/lint + clean check |

```text
covered = 8/8
complete = 0/8
```

---

## 3. As-built blockers B13-01..B13-07

| ID | Current problem (`AS-BUILT`) | Target Phase 13 state (`APPROVED TARGET`) | Owning plan(s) | Verification |
|---|---|---|---|---|
| B13-01 | `POST /store/carts/{id}/complete` nativo executa `completeCartWorkflow` e cria Order | Entrada BLOCKED+DENY; guard nega antes do handler; override local defesa; zero invocação/Order Store | 13-02, 13-07 | HTTP deny + spy + PG Order=0 + webhook positive |
| B13-02 | Sem allowlist global; 50 ops `/store` fora do OpenAPI | Manifest 58 + scanner + guard `/store*` fail-closed | 13-01, 13-02, 13-07 | exact-set + drift fail-closed |
| B13-03 | `GET /store/custom` scaffold retorna 200 | BLOCKED+DENY; handler-zero | 13-02, 13-07 | HTTP + spy |
| B13-04 | Sem idempotency store transversal | `StoreIdempotencyRecord` + job lifecycle | 13-04, 13-07 | PG constraints/states/race/TTL |
| B13-05 | Sem version monotônica/CAS | Wave 0 + `StoreResourceVersion` | 13-01, 13-05, 13-07 | shared TM + CAS + bootstrap |
| B13-06 | `StoreError` = `{type,message,code?}`; auth nativo pode escapar | Normalizer Store → envelope fechado | 13-03, 13-06, 13-07 | unit/HTTP + OpenAPI + canaries |
| B13-07 | Store contract `info.version=1.0.0` sem primitives 1.1.0 | Registry→writer Store `1.1.0`; clean check em 13-07 | 13-06, 13-07 | writer/lint then clean openapi:check |

---

## 4. Store surface contract

### 4.1 Contagens canônicas (`APPROVED TARGET` / RESEARCH PROVEN)

```text
runtime Store total     = 58
native                  = 51
local non-overlapping   = 7
AUTHORIZED              = 0
EXTENDED                = 10
BLOCKED                 = 17
OUTSIDE_FRONTEND_M1     = 31
UNKNOWN                 = 0
M1_ENABLED              = 0   (Phase 13)
```

Contagens factuais de `DENY` vs `PRESERVE_LEGACY` por rota são
`EXECUTION-TIME FACT` do `13-01` (devem somar 58). SPEC/SDD **não inventa**
a distribuição individual.

### 4.2 Dimensões formais por entrada

Cada uma das 58 entradas declara **todas** as dimensões:

| Dimensão | Valores | Notas |
|---|---|---|
| `classification` | `AUTHORIZED` \| `EXTENDED` \| `BLOCKED` \| `OUTSIDE_FRONTEND_M1` | inventário de intenção M1 |
| `runtime_policy` | `DENY` \| `PRESERVE_LEGACY` \| `M1_ENABLED` | comportamento HTTP imediato |
| `m1_enablement` | disabled \| enabled | Phase 13: todas disabled; `M1_ENABLED` policy count = 0 |
| `openapi_m1_expectation` | `include_executable_m1` \| `exclude` \| `support_only` | vocabulário canônico idêntico ao SDD |
| `rationale` | texto não-nulo | motivo fechado |

Semântica canônica de `openapi_m1_expectation`:

```text
include_executable_m1
→ operation belongs to executable M1 exact-set when all enablement conditions are satisfied

exclude
→ operation must not appear as executable M1 business operation

support_only
→ schema/header/component/support knowledge may exist without exposing a business path+method
```

Phase 13: `include_executable_m1` business operations actually enabled = 0.
`PRESERVE_LEGACY` permanece fora do executable exact-set.

### 4.3 Invariantes dimensionais

```text
classification != runtime_policy   (dimensões independentes)
BLOCKED → DENY                     (obrigatório)
UNKNOWN → invalid + fail closed    (lookup ausente = DENY + drift)
PRESERVE_LEGACY != M1_ENABLED
PRESERVE_LEGACY != autorização M1
EXTENDED != runtime allowed automatically
M1_ENABLED = 0 in Phase 13
```

`EXTENDED` / `OUTSIDE_FRONTEND_M1` podem individualmente ser `DENY` ou
`PRESERVE_LEGACY` (PLAN R5). Nenhuma classe implica política universal além de
`BLOCKED→DENY`.

### 4.4 Semântica de classification

| Class | Significado |
|---|---|
| AUTHORIZED | executável quando controles transversais + enablement satisfeitos |
| EXTENDED | candidata a reuso futuro; **não** autorizada só por existir |
| BLOCKED | incompatível; sempre DENY |
| OUTSIDE_FRONTEND_M1 | fora do contrato M1; DENY ou PRESERVE_LEGACY individual |

---

## 5. Runtime policy semantics

### 5.1 DENY (`APPROVED TARGET`)

```text
request rejected before business handler/workflow
stable Store error envelope
zero handler invocation
zero Order creation
zero completeCartWorkflow invocation from Store
```

### 5.2 PRESERVE_LEGACY (`APPROVED TARGET`)

```text
only previously accepted v1.0 behavior
no expansion of authority
no new frontend M1 contract
no M1 enablement
no automatic executable OpenAPI M1 exposure
no owner-phase guards yet nonexistent
```

### 5.3 M1_ENABLED

Proibido na Phase 13 (count = 0). Só após owner-phase proof + enablement
explícito no manifest + revalidação dos três exact-sets OpenAPI.

### 5.4 Unknown route/method

```text
fail closed
drift signal
no implicit fallback
no HEAD inheritance from GET
OPTIONS: valid CORS preflight only; invalid OPTIONS fail-closed
```

Normalização obrigatória coberta na matriz HTTP: trailing slash, double slash,
encoded separators, path params, static-vs-param precedence, query string,
aliases. Detalhe mecânico no SDD §3–4.

---

## 6. Idempotency contract — StoreIdempotencyRecord

### 6.1 Purpose

Primitivo transversal Store de claim/replay/conflito. **Não** reutiliza
`CheckoutCompletionLog` (escopo exclusivo Order birth).

### 6.2 Campos lógicos (`APPROVED TARGET`)

| Campo | Regra |
|---|---|
| `id` | identidade módulo |
| `operation` | identificador estável da operação |
| `actor_scope_hash` | hash de ator/ownership |
| `resource_scope_hash` | hash de recurso quando aplicável |
| `idempotency_key_hash` | HMAC da caller key |
| `hash_version` | `hmac-sha256-v1` |
| `pepper_version` | `1` |
| `request_fingerprint` | canônico pós-validação (campos semânticos) |
| `state` | máquina abaixo |
| `state_version` | geração monotônica de transição lifecycle/claim (ver §6.2.1) |
| `result_type`, `result_id`, `response_status` | resultado allowlisted |
| safe result metadata/snapshot | sem secrets/PII/capabilities plaintext |
| `locked_at` | claim concurrency |
| `state_deadline_at` | deadline do estado corrente |
| `next_retry_at`, `retry_attempt_count`, `retry_started_at` | retry |
| `terminalized_at`, `completed_at` | terminalização |
| `failure_code` | código estável quando aplicável |
| `expires_at` | retenção terminal |
| timestamps | created/updated |

#### 6.2.1 `state_version` — lifecycle transition generation

```text
type:
  positive monotonic integer

initialization:
  initialized when the row is created

purpose:
  optimistic lifecycle/claim transition generation

mutation:
  increment on every successful state/claim transition that uses the versioned predicate

correctness:
  used with expected state/version predicate when the implementation chooses
  conditional-update claiming
```

`state_version` **não** substitui row lock. O PLAN permite exatamente uma das
estratégias (ou equivalente) por transição, desde que garanta um único claimant:

```text
Strategy A:
  transaction + SELECT FOR UPDATE / row lock + expected state predicate

Strategy B:
  atomic conditional UPDATE
  WHERE
    id = ...
    AND state = expected_state
    AND state_version = expected_state_version
  SET
    state = ...
    state_version = state_version + 1
  RETURNING ...
```

Obrigatório em ambas:

```text
exactly one lifecycle claimant
no lost transition
```

Distinção inequívoca (conceitos distintos):

```text
StoreIdempotencyRecord.state_version
→ protects idempotency lifecycle state transitions

StoreResourceVersion.version
→ protects application resource mutation concurrency
```

Tipo SQL concreto e DDL de migration permanecem `EXECUTION-TIME FACT` /
autoridade do CLI em `13-04`; este SPEC não inventa DDL factual.

### 6.3 Constraint e hashing

```text
UNIQUE(operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash)

Hash algorithm: HMAC-SHA-256
Pepper env: STORE_IDEMPOTENCY_KEY_PEPPER
hash_version = hmac-sha256-v1
pepper_version = 1

Caller key:
  visible US-ASCII [!-~]
  1..255 bytes
  byte-for-byte
  no trim
  no case fold
  no Unicode normalization
```

Produção: pepper **obrigatório**, base64url, decoded ≥32 bytes; nunca logado.
Rotação exige gate humano futuro (dual-read); troca simples de env é proibida.

### 6.4 Estados

```text
processing
completed
failed_retryable
failed_terminal
reconciliation_required
reconciliation_unresolved
```

### 6.5 State transition matrix

| From \ To | processing | completed | failed_retryable | failed_terminal | reconciliation_required | reconciliation_unresolved |
|---|---|---|---|---|---|---|
| *(new claim)* | ALLOW | — | — | — | — | — |
| processing | — | ALLOW | ALLOW | ALLOW | ALLOW | — |
| failed_retryable | ALLOW (retry claim) | ALLOW | — | ALLOW | ALLOW | — |
| completed | FORBIDDEN | — | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN |
| failed_terminal | FORBIDDEN | FORBIDDEN | FORBIDDEN | — | FORBIDDEN | FORBIDDEN |
| reconciliation_required | FORBIDDEN (blind retry) | ALLOW (review/evidence only) | FORBIDDEN | ALLOW (review/evidence only) | — | ALLOW (unresolved 7d deadline only) |
| reconciliation_unresolved | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | — |

#### 6.5.1 `reconciliation_required` — resolution ≠ retry

Contrato aprovado pelo PLAN R5:

```text
reconciliation_required
  ├─ review/evidence proves successful effect
  │    → completed
  │
  ├─ review/evidence proves terminal failure / no successful effect
  │    → failed_terminal
  │
  └─ unresolved until 7d review deadline
       → reconciliation_unresolved
```

Semântica de resolução (somente após review/evidence explícitos; nunca inferência automática):

```text
completed
=
reconciliation evidence proves the original operation/effect completed successfully
and the safe replay result is known

failed_terminal
=
reconciliation evidence proves terminal failure / no successful effect
and retry is no longer appropriate

reconciliation_unresolved
=
review deadline expired without sufficient evidence to classify success/failure
```

`reconciliation_unresolved` continua:

```text
terminal audit state
not financial truth
not provider success
not business success
```

Proibições explícitas:

```text
reconciliation_required → processing
  FORBIDDEN as blind retry

reconciliation_required → failed_retryable
  FORBIDDEN

reconciliation_required is NOT an automatic retry queue
reconciliation_required is NOT automatic success/failure inference
resolution != retry
```

Regras gerais:

- same intent + `completed` → replay seguro, zero novo efeito;
- incompatible fingerprint → conflito público estável (HTTP 409), zero efeito;
- concurrent same key → um winner via UNIQUE + claim condicional (state/version ou row lock);
- `reconciliation_required` → sem blind retry; sem cleanup automático; resolução só por review/evidence ou deadline → `reconciliation_unresolved`;
- `reconciliation_unresolved` = terminal de auditoria, **não** sucesso financeiro/provider;
- cleanup remove somente `completed` / `failed_terminal` / `reconciliation_unresolved` **expirados**.

---

## 7. Idempotency lifecycle timing

| Conceito | Valor fechado |
|---|---|
| processing stale deadline (`claimStaleAfter`) | 5m |
| recovery decision horizon | 15m |
| retry cap | 8 attempts **OR** 24h (o que ocorrer primeiro) |
| reconciliation review deadline | 7d → `reconciliation_unresolved` |
| default terminal retention | 24h |
| `reconciliation_unresolved` retention | 30d |
| owner override bounds | 15m..30d (rationale obrigatório) |
| Phase 13 `local-mutation` | 24h |
| Phase 13 `uncertain-effect-simulation` | review 7d; terminal retention 30d |

```text
Driver: Medusa scheduled job
Path (future): apps/backend/src/jobs/store-idempotency-lifecycle.ts
schedule: "* * * * *"

Truth:
  PostgreSQL = correctness source
  Redis = optional coordination only
  in-memory correctness = FORBIDDEN
```

Lifecycle driver (equivalente ao PLAN R5):

```text
scan due rows
→ transaction
→ claim with row lock OR state+state_version conditional predicate
→ exactly one worker owns transition
→ evaluate due state
→ persist transition/deadline
→ increment state_version when applicable
→ commit
```

Dois workers podem observar; só um claim (row lock **ou** predicate
`state`+`state_version`) vence. Restart retoma de PostgreSQL. Redis outage
não altera correção. PostgreSQL = truth; Redis = coordination only.

---

## 8. StoreResourceVersion contract

### 8.1 Physical contract (`APPROVED TARGET`)

`P13-13-05-HCD-01` supersede explicitamente apenas o target físico original
`bigint + UNIQUE não parcial`. D13-20..D13-24 e todos os invariantes
comportamentais permanecem inalterados.

```text
resource_type
resource_id
version PostgreSQL integer
timestamps
UNIQUE(resource_type,resource_id)
WHERE deleted_at IS NULL
CHECK(version > 0)
```

### 8.2 Bootstrap

```text
lazy serialized initialization
version = 1
INSERT ON CONFLICT (resource_type, resource_id)
WHERE deleted_at IS NULL
DO NOTHING
lock/load in same transaction
```

Não presume DB vazio. Dois first-access concorrentes → uma row version=1.

### 8.3 Concurrency

```text
server authoritative
CAS via expected-version check
one winner
no destructive retry
same transaction manager as protected Medusa mutation
single commit
rollback both on any failure
no two-commit fallback
```

### 8.4 Explicitly deferred (`FUTURE OWNER-PHASE` — Phase 15)

```text
Cart ETag response
If-Match enforcement on Cart mutations
HTTP 412 CART_VERSION_MISMATCH
Cart safe snapshot on error
Cart snapshot/invalidation
```

Phase 13 pode definir **components OpenAPI** transversais `ETag`/`If-Match`/412
genérico; integração pública Cart permanece Phase 15 (D13-21/D13-22/D13-28).

---

## 9. Error contract

### 9.1 Envelope fechado (`APPROVED TARGET`)

```text
StoreErrorResponse {
  code: string            // required, stable machine contract
  message: string         // required, presentation only — NOT machine contract
  correlationId?: string  // same sanitized value as header when present
  retryable: boolean      // required
  fieldErrors?: Record<string, string>  // public fields only
  cart?: <safe cart snapshot>           // optional; concrete Cart shape = Phase 15
}
```

`AS-BUILT`: schema OpenAPI atual é `StoreError` com `{type,message,code?}`.

### 9.2 Status families

| Family | HTTP | Regras |
|---|---:|---|
| validation | 400 | `fieldErrors` allowlisted; sem eco de body |
| auth/ownership | 401 / 403-or-404 | não enumerável; mensagem genérica |
| idempotency conflict | 409 | code estável; message não é lógica |
| optimistic stale primitive | 412 | genérico na Phase 13; `CART_VERSION_MISMATCH` público = Phase 15 |
| domain | 422 | code público |
| rate limit | 429 | `Retry-After` somente quando factual |
| provider/internal | 500 / 503 | sanitizado; `retryable` só se conhecido e sem efeito incerto |

Admin/Webhooks **não** recebem este envelope.

---

## 10. Correlation contract

```text
Header: x-correlation-id
Input allowlist: [A-Za-z0-9._-]{1,128}
Invalid/missing: replace with generated UUID
```

`AS-BUILT`: `resolveCorrelationId` em `middlewares.ts` já aplica essa allowlist.

Mesmo valor seguro deve aparecer em:

```text
response header
safe error body (correlationId)
structured log
Sentry context
```

Sem transportar PII/secrets/tokens/capabilities.

---

## 11. BFF boundary

```text
Browser
  → same-origin Next.js BFF
    → Medusa Store API (server-to-server)
```

Phase 13 **não cria** Next.js/BFF (`FUTURE OWNER-PHASE`).

Contrato server-to-server futuro:

- Browser **não** recebe diretamente: publishable API key, Customer JWT,
  guest capability, confirmation capability/session, other server credentials;
- CORS + publishable key **não** constituem autorização BFF;
- OpenAPI documenta BFF→Medusa, nunca browser→Medusa como consumidor autorizado.

---

## 12. OpenAPI target

```text
Store OpenAPI version = 1.1.0
TypeScript registry = authority
generated JSON = generated artifact only
manual JSON edit = forbidden
```

Três conjuntos independentes:

```text
1) runtime inventory = 58
2) manifest = 58 / distribution 0/10/17/31
3) M1 executable Store business operations
   = AUTHORIZED M1_ENABLED + EXTENDED M1_ENABLED
   = 0 in Phase 13
```

`PRESERVE_LEGACY` pode existir em runtime e **MUST NOT** entrar no executable M1
exact-set só porque o runtime existe.

Health/support: contados separadamente.
Admin/Webhooks: coverage semantics preservadas (não relaxar).

Writer (`13-06`) e clean `openapi:check` (`13-07`) são gates separados.
`coverage.unit.spec.ts` ownership: **13-06** (closed-set de 10 paths).

---

## 13. OpenAPI components (`APPROVED TARGET`)

| Component | Contrato |
|---|---|
| `StoreErrorResponse` | envelope §9 |
| `Idempotency-Key` | parameter; key rules §6 |
| `If-Match` | header component transversal; Cart enforcement = Phase 15 |
| `ETag` | header component transversal; Cart emission = Phase 15 |
| `x-correlation-id` | request/response; §10 |
| `Retry-After` | condicional factual |
| `StoreMajorMoney` | amount + BRL + major unit explicit |
| `StoreMinorMoney` | amount + BRL + minor unit explicit |
| BFF security descriptions | server-to-server; browser direto proibido |

Money: major/minor unit explícitos; BRL; **no global conversion** no contrato.

---

## 14. Migration contract

Política (sem inventar arquivos):

Para ambos `store_idempotency` e `store_resource_version`:

```text
model/module definition
→ register module exactly once
→ config regression PASS
→ db:generate
→ exactly one migration
→ capture factual identity
→ DDL review
```

```text
Filename/class: UNRESOLVED during SPEC/SDD
No invented MigrationYYYY...
No arbitrary rename to match a preselected identity
```

Required future evidence (SUMMARYs):

```text
source filename
exported class
framework/history identity when observable
generation exact-set (before/after)
DDL review
registration counts
config_regression: PASS
registration_proven_before_db_generate: YES
db_generate_executed_after_registration: YES
```

`13-04` additionally:

```text
Task 1 = 9 paths (DB model + model/service/env/config before migration)
Task 2 = human pre-migration review of all 9
Task 3 = generation/PG/job
```

`13-05` additionally preserves:

```text
1 model/service
2 module registration
3 config regression setup
4 config regression PASS
5 db:generate
6 migration identity capture
7 DDL review
8 backend build PASS   ← before Task 1 completion
9 Task 1 complete
```

Core Cart e CheckoutCompletionLog **não mudam**.
Nenhum Prisma/TypeORM sync/Supabase push/DB remoto.

---

## 15. Order-birth acceptance contract

### Negative (`APPROVED TARGET`)

```text
Any Store request
  → global Store surface guard
  → no completeCart/createOrder Order-birth path
  → Order count remains 0
  → workflow spy invocations = 0
```

### Positive control (existing canonical path)

```text
POST /hooks/stripe trusted payment_intent.succeeded
  → PaymentAttempt payment_confirmed_by_webhook
  → CheckoutCompletionLog claim
  → completeCartWorkflow (internal)
  → exactly one Order
  → replay/concurrent replay → same result; still one Order
```

`AS-BUILT` bypass: native `POST /store/carts/{id}/complete`.

---

## 16. Decisions D13-01..D13-32 representation

| Decisions | Represented in |
|---|---|
| D13-01..D13-02 | §11 BFF; SDD security; plans 13-02/13-06/13-07 |
| D13-03..D13-04 | §4 surface; SDD manifest |
| D13-05..D13-07 | §5, §15; SDD guard |
| D13-08..D13-12 | §9, §10 |
| D13-13..D13-19 | §6, §7 |
| D13-20..D13-24 | §8 (Cart público deferred Phase 15) |
| D13-25..D13-29 | §12, §13 |
| D13-30..D13-31 | labeling AS-BUILT vs TARGET; fail-closed unknowns |
| D13-32 | every plan human checkpoint; this gate stops for review |

All 32 decisions are represented. None relaxed.

---

## 17. Plan-by-plan SPEC traceability

### 13-01 — Surface Manifest & Feasibility Gate

| Field | Value |
|---|---|
| Requirements | FND-01, FND-06 |
| Blockers | B13-02 (manifest), B13-05 (feasibility) |
| Components | Manifest, installed scanner, Wave 0 adapter |
| Files expected | `manifest.ts`, `scan-installed.ts`, `manifest.unit.spec.ts`, `store-foundation-transaction-compatibility.ts`, `store-foundation-transaction-compatibility.spec.ts` |
| Preconditions | CONTEXT/RESEARCH/PLAN approved |
| Algorithms | exact-set 58; classification+policy; shared TM probe |
| Tests | unit manifest; scanner `--check`; disposable PG Wave 0 |
| Human checkpoint | Task 3 Wave 0 binary review |
| Stop conditions | drift; invalid combo; M1_ENABLED>0; TM not shared; two CAS winners; Redis truth |
| Artifacts | `13-01-SUMMARY.md` |

### 13-02 — Fail-Closed Store Lockdown

| Field | Value |
|---|---|
| Requirements | FND-01, FND-02, FND-07 |
| Blockers | B13-01, B13-02, B13-03 |
| Components | Global guard, complete override, legacy test transition |
| Files expected | `guard.ts`, `middlewares.ts`, `store/carts/[id]/complete/route.ts`, `guard.unit.spec.ts`, `store-surface-lockdown.spec.ts`, legacy exact-set ≤4 paths (inventoried first) |
| Preconditions | 13-01 PASS |
| Algorithms | `/store*` lookup; DENY before handler; PRESERVE_LEGACY only v1.0 |
| Tests | guard unit; lockdown HTTP; order-birth invariants; legacy A/B/C |
| Human checkpoint | Task 3 lockdown review |
| Stop conditions | complete/custom reachable; PRESERVE gains M1; Order from Store; legacy set invalid |
| Artifacts | `13-02-SUMMARY.md` |

### 13-03 — Store Error Contract & Correlation

| Field | Value |
|---|---|
| Requirements | FND-03 |
| Blockers | B13-06 |
| Components | Error catalog/normalizer; Store errorHandler branch |
| Files expected | `errors.ts`, `middlewares.ts`, `errors.unit.spec.ts`, `store-error-contract.spec.ts` |
| Preconditions | 13-02 PASS |
| Algorithms | map native/domain → StoreErrorResponse; same correlation |
| Tests | unit + HTTP; Admin/Webhooks isolation |
| Human checkpoint | Task 3 catalog/isolation review |
| Stop conditions | native envelope escape; correlation diverge; Admin/Webhooks regression |
| Artifacts | `13-03-SUMMARY.md` |

### 13-04 — Idempotency Foundation

| Field | Value |
|---|---|
| Requirements | FND-04, FND-05 |
| Blockers | B13-04 |
| Components | store_idempotency module, pepper env, lifecycle job |
| Files expected | 13 authorized paths incl. `DB_MODEL_v1.22.md`, env, module, job, medusa-config, config/env tests; migration = `<CLI-generated store-idempotency migration>` **UNRESOLVED** |
| Preconditions | 13-03 PASS; Wave 0 PASS; Task 2 human approval of 9 Task-1 paths |
| Algorithms | claim/replay/conflict; TTL matrix; minute job |
| Tests | env.unit; medusa-config.unit; lifecycle.unit; store-idempotency.postgres |
| Human checkpoint | Task 2 pre-migration; stop before 13-05 |
| Stop conditions | 0/>1 migration; pepper leak; multi-winner; blind retry; no driver |
| Artifacts | `13-04-SUMMARY.md` |

### 13-05 — Resource Version & Atomic Concurrency

| Field | Value |
|---|---|
| Requirements | FND-06 |
| Blockers | B13-05 |
| Components | store_resource_version module |
| Files expected | 7 paths; migration = `<CLI-generated store-resource-version migration>` **UNRESOLVED** |
| Preconditions | 13-04 complete; Wave 0 PASS; config regression PASS before generate |
| Algorithms | lazy bootstrap; CAS; shared TM |
| Tests | medusa-config.unit; store-resource-version.postgres; **build PASS** |
| Human checkpoint | Task 3 primitive/Phase-15 boundary |
| Stop conditions | sequence violation; build FAIL; two winners; Cart public contract leaked |
| Artifacts | `13-05-SUMMARY.md` |

### 13-06 — Store OpenAPI 1.1.0 Foundation

| Field | Value |
|---|---|
| Requirements | FND-03, FND-07, FND-08 |
| Blockers | B13-07 |
| Components | Registry components, verify-coverage, writer Store |
| Files expected | **exactly 10 paths** incl. `coverage.unit.spec.ts` and `store.openapi.json` |
| Preconditions | 13-05 PASS |
| Algorithms | three exact-sets; writer `--surface store`; lint; **no** openapi:check |
| Tests | store-contract.unit; coverage.unit; generate+lint |
| Human checkpoint | components diff; Task 3 artifact review |
| Stop conditions | manual JSON edit; executable≠0; Admin/Webhooks coverage relaxed |
| Artifacts | `13-06-SUMMARY.md` |

### 13-07 — Security, Native-Bypass & Final Validation

| Field | Value |
|---|---|
| Requirements | FND-01..FND-08 |
| Blockers | B13-01..B13-07 revalidation |
| Components | Final HTTP/security/Order-birth suites only |
| Files expected | `store-foundation-final.spec.ts`, `security-negative.unit.spec.ts`, `store-order-birth-canonical.postgres.spec.ts` |
| Preconditions | 13-01..13-06 approved+committed; clean checkout before openapi:check |
| Algorithms | composite negatives; webhook positive/replay; clean check |
| Tests | unit/HTTP/PG composites; openapi:check; lint; build |
| Human checkpoint | Task 3 final evidence; keep requirements incomplete |
| Stop conditions | any Store Order; sensitive match; clean-check masked by writer |
| Artifacts | `13-07-SUMMARY.md` |

---

## 18. Governance

```text
SPEC/SDD complete != implementation authorization
SPEC/SDD complete != execution authorization
requirements remain incomplete (0/8 Phase 13; 0/91 milestone)
frontend remains blocked
plans human-approved executed = 5/7; 13-06 execution authorized; 13-07 not authorized
```

Unresolved during this gate (must stay unresolved):

```text
migration filenames / exported classes / history basenames
generated timestamps
DENY/PRESERVE_LEGACY per-route factual distribution
runtime evidence / test counts / exit codes
generated OpenAPI diff
```

Não declarar PASS de execução futura.

---

## 19. Critério de conclusão desta etapa documental

O SPEC cobre FND-01..FND-08 (8/8 covered, 0/8 complete), B13-01..B13-07 (7/7),
D13-01..D13-32 (32/32) e os 7 planos lineares. O gate SPEC/SDD está **HUMAN APPROVED — PASS**. O Implementation Prompt foi aprovado; a Phase 13 está em execução manual-gated com 13-01..13-05 HUMAN APPROVED — PASS, 13-06 EXECUTION AUTHORIZED e 13-07 NOT AUTHORIZED.
