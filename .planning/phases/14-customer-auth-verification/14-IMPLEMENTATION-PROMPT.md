---
phase: 14-customer-auth-verification
artifact: implementation-prompt
status: complete-awaiting-human-review
created_at: 2026-08-12
scope: implementation-prompt-only
requirements: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09]
requirements_covered: 9
requirements_complete: 0
plans: 21
plans_executed: 0
parallelization: false
auto_advance: false
manual_review_gate: true
approved_plan_baseline: 6d5f94e1be19ca4276c6078a618797a244f8ed10
repository_baseline: 55cd323ad3df9ac0113d13807d0d1911460e43a6
spec_sdd_revision: R1
spec_sdd_human_review: PASS
implementation_prompt_creation: AUTHORIZED
execution_status: not-authorized
branch: gsd/phase-14-customer-auth-verification
---

# Phase 14 Implementation Prompt — Customer Auth & Verification

## 0. Gate e finalidade

Este artefato consolida **como iniciar e governar a futura execução** dos 21 PLANs aprovados da Phase 14. Ele não substitui CONTEXT, SPEC/SDD, PLAN ou VALIDATION e **não autoriza a execução de nenhum plano**.

Estado humano corrente deste gate:

```text
Phase 14 CONTEXT: HUMAN APPROVED — PASS
Phase 14 RESEARCH: HUMAN APPROVED — PASS
Phase 14 PLAN: HUMAN APPROVED — PASS
Phase 14 SPEC/SDD R1: HUMAN APPROVED — PASS
Phase 14 Implementation Prompt creation: AUTHORIZED

Execution: NOT AUTHORIZED
14-01: NOT AUTHORIZED
Verification: NOT AUTHORIZED
Review: NOT AUTHORIZED
Closure: NOT AUTHORIZED
Phase 15: NOT AUTHORIZED
Frontend: BLOCKED
Deploy: NOT AUTHORIZED
```

### 0.1 Reconciliação do snapshot documental

O baseline remoto `55cd323ad3df9ac0113d13807d0d1911460e43a6` ainda registra em `STATE.md`/`ROADMAP.md` que o SPEC/SDD aguarda human re-review e que o Implementation Prompt não está autorizado. Esse wording foi supersedido pelas decisões humanas posteriores:

```text
P14-SPEC-SDD-R1: HUMAN RE-REVIEW PASS
Phase 14 SPEC/SDD: HUMAN APPROVED — PASS
Phase 14 Implementation Prompt: AUTHORIZED
```

Esta reconciliação de gate não altera contratos técnicos e não autoriza EXECUTION. Este artefato não reescreve retroativamente STATE/ROADMAP; sincronização documental desses arquivos permanece separada.

---

## 1. Autoridades vinculantes

Antes de qualquer plano futuramente autorizado, ler integralmente:

```text
AGENTS.md
.planning/PROJECT.md
.planning/ROADMAP.md
.planning/REQUIREMENTS.md
.planning/STATE.md
.planning/config.json

.planning/phases/14-customer-auth-verification/14-CONTEXT.md
.planning/phases/14-customer-auth-verification/14-RESEARCH.md
.planning/phases/14-customer-auth-verification/14-SPEC.md
.planning/phases/14-customer-auth-verification/14-SDD.md
.planning/phases/14-customer-auth-verification/14-VALIDATION.md
.planning/phases/14-customer-auth-verification/14-NN-PLAN.md
```

Quando existir predecessor, ler também o `14-(NN-1)-SUMMARY.md` **human-approved**.

### 1.1 Precedência

```text
1. CONTEXT D14-01..D14-16 — HUMAN APPROVED
2. SPEC/SDD R1 — HUMAN APPROVED
3. PLAN — HUMAN APPROVED (P14-D01..P14-D14)
4. VALIDATION
5. RESEARCH corrigido — installed npm artifact 2.16.0
6. REQUIREMENTS / PRD / SRS / traceability
7. as-built runtime/source/package para fatos de integração
8. inference
```

Divisão operacional:

```text
SPEC       = WHAT observável
SDD        = HOW aprovado
PLAN       = tasks, files_modified, verifies, checkpoints e acceptance
VALIDATION = evidências e gates V14-*
```

Se uma divergência material não puder ser resolvida por essa precedência:

```text
ACTIVE PLAN: BLOCKED
HUMAN DECISION REQUIRED
```

Não editar silenciosamente CONTEXT, SPEC/SDD, PLAN, VALIDATION ou REQUIREMENTS durante execução para fazer um gate passar.

---

## 2. Topologia obrigatória de execução

A decomposição é imutável e estritamente serial:

```text
14-01 Wave 0 Validation Harness
  ↓ human review
14-02 HTTP/BFF Contract + Auth Surface Total DENY
  ↓ human review
14-03 DB_MODEL Reconciliation + Transaction Probe
  ↓ human review
14-04 Email Normalization + Capabilities + Collision Audit
  ↓ human review
14-05 Core Auth Models
  ↓ human review
14-06 Verification/Reset/Outbox Models
  ↓ human review
14-07 Service + Migration + PostgreSQL Constraints
  ↓ human review
14-08 Rate Limiting + Timing Equivalence
  ↓ human review
14-09 Auth Notification Outbox Runtime
  ↓ human review
14-10 Session / JWT / Refresh Domain
  ↓ human review
14-11 Access Guard + Refresh/Revoke HTTP
  ↓ human review
14-12 Verification Domain
  ↓ human review
14-13 Verification Store HTTP
  ↓ human review
14-14 Registration Coordinator
  ↓ human review
14-15 Signup / Login / Me HTTP
  ↓ human review
14-16 Reset Domain + HTTP
  ↓ human review
14-17 Password Change Domain/Handler — route stays DENY
  ↓ human review
14-18 Reconciler + Final Password Surface Enablement
  ↓ human review
14-19 API Docs TypeScript Registry
  ↓ human review
14-20 Generated Store OpenAPI Writer Artifact
  ↓ human review
14-21 Final Security / Contract / Order Invariants
  ↓ human review
Phase 14 VERIFICATION
  ↓ human review
Phase 14 REVIEW
  ↓ human review
Phase 14 CLOSURE
```

Configuração vinculante:

```text
mode = interactive
workflow.auto_advance = false
workflow._auto_chain_active = false
parallelization = false
autonomous = false nos 21 PLANs
```

**PASS de predecessor é necessário, mas nunca suficiente para iniciar o sucessor.** Cada plano exige autorização humana explícita própria.

---

## 3. Baselines

### 3.1 Baseline do PLAN aprovado

```text
6d5f94e1be19ca4276c6078a618797a244f8ed10
```

### 3.2 Baseline remoto deste Implementation Prompt

```text
55cd323ad3df9ac0113d13807d0d1911460e43a6
```

Quando `14-01` for futuramente autorizado, registrar o `PHASE14_EXECUTION_BASE_SHA` factual antes da primeira alteração runtime/test. Preservar esse SHA nos SUMMARYs seguintes; não recalcular um “base” novo por plano.

---

## 4. Invariantes globais não negociáveis

### 4.1 Order / Stripe

```text
Order birth = canonical trusted Stripe webhook only
Auth path = zero Order creation
```

Signup, login, refresh, revoke, verification, reset e password-change:

```text
MUST NOT create Order
MUST NOT reach completeCart/createOrder Order-birth path
MUST NOT rewrite PaymentAttempt/Stripe financial truth
```

Expiry/revoke não apaga cart/checkout já existente. O webhook Stripe canônico pode concluir trabalho server-side após a sessão do cliente expirar.

### 4.2 BFF boundary

```text
Browser → same-origin BFF → Medusa
Browser → Medusa directly = FORBIDDEN
```

Browser **não recebe**:

```text
backend access JWT
backend refresh credential
internal lineage/session/auth capabilities
provider/internal auth state
```

Verification/reset one-time capabilities podem chegar **out-of-band** ao usuário/browser e são submetidas somente ao same-origin BFF. Elas não autorizam browser→Medusa, não são retornadas por backend success/error e permanecem hash-only no backend. Transporte browser↔BFF é FUTURE OWNER-PHASE.

### 4.3 Persistence / validity

```text
PostgreSQL = validity authority
Redis = coordination/rate-limit only
Redis MUST NEVER grant validity
```

Sete responsabilidades persistentes e nenhuma oitava autoridade:

```text
RegistrationIntent
AuthCredentialState
AuthSessionLineage
AuthRefreshCredential
AuthVerificationIntent
AuthResetIntent
AuthNotificationOutbox
```

Campos de operação reset/password-change ficam em `AuthCredentialState`.

### 4.4 Sensitive material

Nunca persistir/logar em plaintext onde proibido:

```text
password/currentPassword/newPassword
access token
refresh token
verification token
reset token
Authorization
cookie
capability URL
provider raw payload
plaintext email em logs/telemetry/Sentry/Redis/OpenAPI/AuthNotificationOutbox
```

Plaintext email pode existir transitoriamente em request/provider resolution memory quando necessário. Customer/Auth provider storage existente não é redefinido.

### 4.5 Transaction truth

Até `14-03` provar cada seam:

```text
SUPPORTED_STRONG | RECONCILIATION_REQUIRED = EXECUTION-TIME FACT
```

Nunca afirmar `all auth changes are atomic`.

Duas transactions correlacionadas != atomicidade cross-module.

### 4.6 Verification delivery

`AuthVerificationIntent.dead_letter` permanece valor de modelo reservado, mas **provider delivery failure nunca transiciona o intent para dead_letter**. Delivery dead-letter pertence ao `AuthNotificationOutbox`. Verification intent permanece pending/confirmable até confirm, TTL ou supersede; confirm CAS = `hash + pending + expiry`.

---

## 5. Contratos fechados que não podem regredir

### 5.1 Exact HTTP set — 12 operações

A autoridade é `14-SPEC.md §3` + `14-02-PLAN.md`. Não criar 13ª operação.

```text
1 POST /auth/customer/emailpass/register
2 POST /auth/customer/emailpass
3 POST /auth/token/refresh
4 POST /auth/customer/emailpass/revoke-current-lineage
5 POST /store/customers/me/verify
6 POST /store/customers/verify/resend
7 POST /store/customers/verify
8 GET  /store/customers/me/verify/status
9 POST /auth/customer/emailpass/reset-password
10 POST /auth/customer/emailpass/update
11 POST /store/customers/me/password
12 GET /store/customers/me
```

Browser logout é responsabilidade do BFF; não existe Store logout artificial. `/auth/session`, callbacks, MFA e native incompatible verification/refresh/reset permanecem DENY.

### 5.2 TTLs

```text
RegistrationIntent       24h
Verification             30m
Reset                    15m
Access JWT               10m
Refresh inactivity       7d
Lost-response recovery   45s
Initial session absolute 30d
Outbox/reconciler lease  2m
```

### 5.3 Refresh

```text
32-byte opaque CSPRNG
SHA-256 persisted
single-use N → N+1
same lineage
same absolute deadline
same Idempotency-Key <=45s + unused descendant → SAME N+1
other key / expired window / used descendant / replay → revoke whole lineage
```

### 5.4 Reset-confirm limiter

```text
PRE:  30/IP/15m
      10/(IP,presented-reset-token)/15m
POST: 10/(IP,reset-intent)/15m
missing/malformed/unknown → dummy post from pre-digest
```

Public invalid class:

```text
missing | malformed | expired | used | superseded
→ 400 RESET_INVALID_OR_EXPIRED
```

Rate limit:

```text
429 RATE_LIMITED
```

Redis outage:

```text
503 AUTH_TEMPORARILY_UNAVAILABLE
Retry-After: 60
before lookup/claim/consume/provider/write
```

Legitimate correlated ambiguous operation only:

```text
503 AUTH_RECOVERY_PENDING
```

Timing:

```text
floor 350ms
CSPRNG jitter 0..50ms
40 samples/class
median delta <=50ms
p95 delta <=75ms
```

`newPassword` nunca participa de limiter key, log, telemetry, persistence ou fingerprint.

### 5.5 Email normalization

```text
trim
exactly one @
ASCII local-part lowercase
EAI/non-ASCII local reject
domainToASCII(domain) + lowercase
plus preserved
dots preserved
no provider/Gmail canonicalization
same normalizer in identity/Customer/intents/limiter/audit
```

Collision audit é read-only e deve passar antes de normalized constraints/migration.

---

## 6. Infra e operações permitidas durante futura execução

Somente quando o plano proprietário estiver explicitamente autorizado:

```text
local unit/HTTP tests
local isolated Redis test instance/namespace
local disposable PostgreSQL via versioned harness
local Docker only as required by disposable harness
local generated OpenAPI writer in plan 14-20
lint/build in gates that own them
```

Nunca por este Implementation Prompt sozinho:

```text
remote Supabase mutation
Heroku mutation/deploy/rollback/restart/scale
real Stripe/Resend/Gelato/PostHog/Sentry/Correios provider calls
frontend/Next.js
npm install/update
new dependency
package.json/package-lock.json change
real secrets/env mutation
```

Se uma dependency nova ou provider real se tornar necessário:

```text
ACTIVE PLAN: BLOCKED
HUMAN DECISION REQUIRED
```

---

# 7. Execution Packet — 14-01

**Owner:** Wave 0 / `V14-W0` / AUTH-01..09.

Somente autorização explícita de `14-01` inicia este packet.

Objetivo: criar clock/entropy/HMAC determinísticos, provider mocks, fault injection, leakage collectors, disposable PostgreSQL, Redis isolado e dois processos compartilhando autoridades de teste.

Regras:

- usar somente allowlist exata de `14-01-PLAN.md`;
- test hooks falham fora de `NODE_ENV=test`;
- targets DB/Redis devem ser temporários/isolados e explicitamente seguros;
- real provider e infra remota são proibidos;
- provar cleanup mesmo após failure.

Executar exatamente os `<verify><automated>` do PLAN. Depois criar `14-01-SUMMARY.md`, registrar PIDs/targets/cleanup/canários sanitizados e **parar para human review**.

---

# 8. Execution Packet — 14-02

**Owner:** `V14-CTR` / AUTH-03,07,09.

Precondition: `14-01 HUMAN PASS` + autorização explícita de `14-02`.

Objetivo: materializar os 12 contratos, validators/envelopes e instalar Auth surface fail-closed com 24/24 entradas inicialmente DENY.

Regras críticas:

- exact method/path/actor `customer`/provider `emailpass`;
- aliases, percent encoding, double/trailing slash, HEAD/OPTIONS indevidos e unknown → DENY;
- nenhum wildcard;
- native session/callback/MFA/verification/refresh/reset permanecem DENY;
- browser→Medusa direto continua proibido;
- reset-confirm distingue os dois 503;
- sensitive material não entra em examples/fixtures.

Executar verifies do PLAN, criar `14-02-SUMMARY.md` e parar.

---

# 9. Execution Packet — 14-03

**Owner:** `V14-DB` / transaction boundary + DB_MODEL prerequisite.

Precondition: `14-02 HUMAN PASS` + autorização explícita.

Objetivo:

1. reconciliar `docs/DB_MODEL_v1.21.md` antes de model/migration;
2. executar o spike factual para cada cross-module seam;
3. classificar separadamente:

```text
SUPPORTED_STRONG
ou
RECONCILIATION_REQUIRED
```

O plano **não pode** transformar inference em proof. Same transaction manager + fault rollback de todos os writes é requisito mínimo para STRONG. Caso contrário, preservar branch de reconciliation fail-closed.

Qualquer impossibilidade de reconciliar DB_MODEL sem decisão nova → BLOCKED.

Criar `14-03-SUMMARY.md` com resultado factual do probe e parar.

---

# 10. Execution Packet — 14-04

**Owner:** `V14-DB` / normalization + capabilities.

Precondition: `14-03 HUMAN PASS`.

Objetivo: materializar normalização única P14-D12, primitives CSPRNG/SHA/HMAC/HKDF versionadas e collision audit read-only.

Regras:

- collision audit usa a MESMA função de normalização do runtime futuro;
- zero auto-winner em colisão;
- capability plaintext apenas em memória;
- nenhuma senha/fingerprint persistida;
- não avançar para schema/migration se audit não for zero/aceito.

SUMMARY + human stop.

---

# 11. Execution Packet — 14-05

**Owner:** `V14-DB` / core models.

Materializar somente:

```text
RegistrationIntent
AuthCredentialState
AuthSessionLineage
AuthRefreshCredential
```

Preservar uniques/partial uniques/CAS/version/TTL/absolute deadline definidos no SDD. Não criar oitava autoridade ou migration fora do owner posterior.

SUMMARY + human stop.

---

# 12. Execution Packet — 14-06

**Owner:** `V14-DB` / intent + outbox models.

Materializar:

```text
AuthVerificationIntent
AuthResetIntent
AuthNotificationOutbox
```

Regras:

- verification latest-wins;
- reset latest-wins;
- tokens hash-only;
- outbox sem e-mail/body/capability plaintext;
- recipient identity opaca + hash/domain;
- `AuthVerificationIntent.dead_letter` reservado; provider delivery dead-letter é exclusivamente `AuthNotificationOutbox.dead_letter`.

SUMMARY + human stop.

---

# 13. Execution Packet — 14-07

**Owner:** `V14-DB` / service + migration + PostgreSQL constraints.

Preconditions obrigatórias:

```text
DB_MODEL reconciled
normalizer implemented/tested
collision audit accepted
models human-approved
```

Gerar/aplicar migration **somente em disposable local PostgreSQL**, provar uniques/checks/indexes/CAS semantics e service boundary. Nada remoto.

Se generated schema divergir do DB_MODEL aprovado ou collision audit deixar dúvida → BLOCKED.

SUMMARY + human stop.

---

# 14. Execution Packet — 14-08

**Owner:** `V14-LIM` / rate-limit + timing.

Materializar policy map completa P14-D11, HMAC versionado/domain-separated, pre/post/dummy paths e Redis fail-closed.

Obrigatório provar nominalmente:

```text
verification-confirm
reset-confirm
refresh
```

Reset-confirm deve provar integralmente 30/10/10, short-circuit pre-lookup, dummy post, dois 503, 429, invalid class única, Redis-call equivalence e timing 40 samples.

Nenhum IP/token/internal ID cru em Redis key/log. `newPassword` ausente de sinks.

SUMMARY + human stop.

---

# 15. Execution Packet — 14-09

**Owner:** `V14-OUT` / AuthNotificationOutbox runtime.

Materializar claim/lease/CAS, recipient resolution autorizada, constant-time hash comparison, capability rederivation em memória, retry/backoff/dead-letter, batch 25 e provider idempotency estável.

Native Event Bus **não** transporta capability. Provider failure não altera verification intent para dead_letter e não reverte signup/session.

Somente provider mocks; nenhum send real.

SUMMARY + human stop.

---

# 16. Execution Packet — 14-10

**Owner:** `V14-SES` / session+jwt+refresh domain.

Materializar lineage, access JWT 10m, refresh N→N+1, inactivity 7d, absolute 30d, 45s same-key lost-response recovery e replay family revoke.

Recovery deve devolver o **mesmo N+1**, nunca N+2. Descendant used/key diferente/janela expirada → revoke.

SUMMARY + human stop.

---

# 17. Execution Packet — 14-11

**Owner:** `V14-SES` / access guard + refresh/revoke HTTP.

Materializar `customerAuthAccessGuard` e elevar somente custom refresh + revoke após proof.

Guard PostgreSQL verifica:

```text
JWT crypto validity
lineage active
identity ownership
customer ownership
credential_version
absolute deadline
recovery stable
```

DB outage nega; Redis nunca concede. Native refresh/session permanecem DENY.

Nenhuma verification/me/password authenticated surface sobe antes do guard estar aprovado.

SUMMARY + human stop.

---

# 18. Execution Packet — 14-12

**Owner:** `V14-VER` / verification domain.

Materializar auto intent/outbox, latest-wins, one-winner confirm, supersede, TTL 30m, verified state e no-session confirm.

Confirm authority:

```text
hash + pending + expiry
```

Provider delivery status não participa da capability validity. Native verification/event capability permanece DENY/unused.

SUMMARY + human stop.

---

# 19. Execution Packet — 14-13

**Owner:** `V14-VER` / verification Store HTTP.

Elevar somente as quatro paths exatas de verification previstas no SPEC:

```text
POST /store/customers/me/verify
POST /store/customers/verify/resend
POST /store/customers/verify
GET  /store/customers/me/verify/status
```

Request/status usam access guard aprovado. Resend público é uniforme. Confirm é no-session e nunca emite sessão/JWT.

SUMMARY + human stop.

---

# 20. Execution Packet — 14-14

**Owner:** `V14-REG` / registration coordinator.

Materializar recovery 24h, one Customer, mismatch zero-write, compatible retry, identity→Customer seam conforme resultado factual do 14-03, initial lineage somente após Customer e verification intent/outbox exatamente uma vez.

Identity sem Customer continua recoverable por retry de signup; login não vira oracle dessa condição.

Zero Order/Stripe/Gelato.

SUMMARY + human stop.

---

# 21. Execution Packet — 14-15

**Owner:** `V14-REG` / signup+login+me HTTP.

Elevar somente signup/login/me owners após domínio aprovado.

Regras:

- initial unverified session permitida;
- relogin unverified → `403 EMAIL_VERIFICATION_REQUIRED` sem nova lineage;
- missing/wrong/partial identity login → dummy `401 INVALID_CREDENTIALS`;
- current-state DTO allowlist;
- raw `POST /store/customers` continua DENY;
- no browser direct Medusa.

SUMMARY + human stop.

---

# 22. Execution Packet — 14-16

**Owner:** `V14-RST` + reuse integral de `V14-LIM` / reset.

Materializar reset request uniforme e reset-confirm composto.

Sucesso somente depois de:

```text
password/provider proof
reset capability consumed
global credential version/revoke committed
```

Ambiguous provider outcome → fail-closed/reconcilable; `AUTH_RECOVERY_PENDING` somente para mesma operation + mesma Idempotency-Key. Same-key retry exige `newPassword` reapresentada. Reconciler secretless não prova senha/não completa.

Preservar integralmente protocolo 14-08 reset-confirm e no-session/unverified-stays-unverified.

SUMMARY + human stop.

---

# 23. Execution Packet — 14-17

**Owner:** `V14-CHG` / password-change domain + handler.

Materializar currentPassword proof, operation claim, provider update/proof, version bump/global revoke, resume-only same op/key e `204` somente após proof+revoke.

A rota `POST /store/customers/me/password` **permanece DENY** neste plano mesmo com handler existente.

Nenhuma replacement session. Unverified stays unverified.

SUMMARY + human stop.

---

# 24. Execution Packet — 14-18

**Owner:** `V14-CHG` / secretless reconciler + final runtime surface.

Materializar scan/claim/lease/CAS/backoff para credential operations. Reconciler pode convergir efeitos já autoritativamente provados, revogar/alertar, mas nunca provar senha ou completar operação sem proof válido.

Somente após PostgreSQL/domain/handler PASS:

```text
POST /store/customers/me/password → PHASE14_ENABLED
```

Fechar exact runtime set; native/session/MFA/callback/raw Customer continuam DENY.

SUMMARY + human stop.

---

# 25. Execution Packet — 14-19

**Owner:** `V14-DOC` / API Docs TypeScript registry.

Registrar exatamente as 12 operações, schemas/status/codes/security e exemplos sintéticos seguros.

Regras:

- registry TypeScript only;
- generated JSON **não** é alterado neste plano;
- nenhum token/capability/password/PII/provider ID em examples;
- Swagger não vira fluxo browser-interativo de auth.

SUMMARY + human stop.

---

# 26. Execution Packet — 14-20

**Owner:** `V14-DOC` / generated Store OpenAPI.

Executar somente writer autorizado para Store artifact. O JSON é writer-owned, determinístico e nunca editado manualmente.

Obrigatório provar:

```text
Store OpenAPI mudou somente pelo writer esperado
Admin OpenAPI byte-identical
Webhooks OpenAPI byte-identical
registry ↔ generated artifact consistent
```

`openapi:check` de checkout limpo pertence ao gate final 14-21.

SUMMARY + human stop.

---

# 27. Execution Packet — 14-21

**Owner:** `V14-NEG` / final aggregation and invariants.

Precondition: `14-20 HUMAN PASS` + autorização explícita de `14-21`.

Criar somente suites agregadoras/negative proofs definidas pelo PLAN; não duplicar business logic.

Obrigatório provar:

```text
AUTH-01..AUTH-09 = 9/9 evidenced
D14-01..D14-16 = 16/16 evidenced
P14-D01..P14-D14 = 14/14 evidenced
4 RESEARCH blockers disposed
8 MUST-address disposed
12 HTTP contracts exact
zero auth Order birth
canonical Stripe webhook positive control
capability/email/password leakage negative
cross-process revoke
reset-confirm limiter closure
```

### 27.1 Serial PostgreSQL ledger

Executar exatamente o ledger `14-VALIDATION.md`: 11 invocações independentes, uma suite por processo disposable, nenhuma paralelização, stop-on-first-failure e cleanup 11/11.

### 27.2 Full phase gate

Ordem vinculante:

```text
1 checkout clean + openapi:check
2 quick unit
3 Focused HTTP
4 disposable PostgreSQL ledger 1..11
5 full Unit regression
6 full Modules regression normal
7 full HTTP regression
8 OpenAPI lint
9 lint
10 build
11 negative scans
12 git diff --check
```

Budget máximo 90 min; stop no primeiro exit não-zero. Não representar o gate como um único command rápido.

Somente depois da execução completa e checkpoint humano criar `14-21-SUMMARY.md` conforme workflow. **14-21 technical PASS não fecha a Phase 14.**

---

## 28. Validation gates vinculantes

Exact-set permitido:

```text
V14-W0
V14-CTR
V14-DB
V14-LIM
V14-OUT
V14-SES
V14-VER
V14-REG
V14-RST
V14-CHG
V14-DOC
V14-NEG
```

Nenhum gate inventado substitui os acima. `14-21` agrega; não dispensa evidence owner anterior.

O ledger PostgreSQL e os Focused HTTP são os definidos em `14-VALIDATION.md`; paths ausentes, skipped, empilhados no mesmo Jest, paralelizados ou sem cleanup → BLOCKED.

---

## 29. Summary contract após cada plano

Para todo `14-NN` futuramente autorizado:

1. executar somente files/tasks/commands permitidos pelo PLAN owner;
2. registrar factual commands + exit codes + evidence sanitizada;
3. executar `git diff --check`;
4. não esconder failure com `.skip`, `.only`, relaxamento de assertion ou fixture falsa;
5. produzir `14-NN-SUMMARY.md` apenas conforme o workflow/PLAN;
6. declarar `PASS` ou `BLOCKED`, nunca `PASS WITH KNOWN DEBTS` para gate obrigatório;
7. **parar para human review**;
8. não iniciar `14-(NN+1)` sem autorização explícita.

Se o plano descobrir necessidade material de alterar decisão/contract:

```text
ACTIVE PLAN: BLOCKED
Do not self-replan
Await human decision
```

---

## 30. Git / package / environment safety futura

Este Implementation Prompt não autoriza nenhum write de execução agora.

Durante plano futuramente autorizado:

- preservar alterações preexistentes;
- não `reset --hard`, `clean`, stash destrutivo ou rebase não autorizado;
- package/lockfile permanece imutável em toda Phase 14; necessidade de dependency nova = BLOCKED;
- secrets/env reais não são exibidos ou alterados;
- provider real/remote infra/deploy permanecem proibidos;
- push/PR/merge dependem de autorização humana separada quando aplicável.

---

## 31. Stop conditions globais

Parar imediatamente como `BLOCKED` se ocorrer qualquer um:

```text
browser→Medusa required
native incompatible auth route precisa ser liberada
Order é criado por auth
Redis precisa conceder validity
capability/password/plaintext email vaza em sink proibido
new dependency/package change torna-se necessária
remote DB/provider/deploy torna-se necessário
transaction seam exige claim não provado
DB_MODEL não pode ser reconciliado
collision audit não pode ser fechado com segurança
one-winner/latest-wins/refresh replay não é demonstrável
reset/password ambiguous flow pode retornar false success
reconciler precisa de password/token plaintext para completar
OpenAPI exige manual JSON edit
PostgreSQL ledger não pode rodar isolado/serial/cleanup exato
required test/build/lint/negative gate falha
```

Não corrigir via scope creep.

---

## 32. Phase-level gates após 14-21

Mesmo após `14-21 HUMAN APPROVED — PASS`, permanecem separados e requerem autorização humana:

```text
Phase 14 VERIFICATION
Phase 14 REVIEW
Phase 14 CLOSURE
```

Somente CLOSURE humana pode marcar:

```text
AUTH-01..AUTH-09 COMPLETE
Phase 14 CLOSED
Phase 15 eligible for next gate
```

Frontend continua bloqueado pelo milestone v1.1 até Phase 22/closeout específico.

---

## 33. Estado deste artefato

```text
Phase 14 Implementation Prompt:
DOCUMENTALLY COMPLETE — AWAITING HUMAN REVIEW

Requirements covered:
9/9

Requirements complete:
0/9

Plans:
21 planned / 0 executed

Execution:
NOT AUTHORIZED

14-01:
NOT AUTHORIZED

Frontend:
BLOCKED

Deploy:
NOT AUTHORIZED
```

## 34. Próximo ato permitido

**Somente human review deste Implementation Prompt.**

Não executar `14-01`, não gerar runtime/test/migration, não chamar providers, não fazer deploy e não avançar automaticamente.
