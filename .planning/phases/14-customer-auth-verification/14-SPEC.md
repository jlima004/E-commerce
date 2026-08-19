---
phase: 14-customer-auth-verification
artifact: spec
status: complete-awaiting-human-re-review
created_at: 2026-08-12
updated_at: 2026-08-12
scope: spec-sdd-only
gate: P14-SPEC-SDD-R1
requirements: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09]
requirements_covered: 9
requirements_complete: 0
plans: 21
plans_executed: 0
manual_review_gate: true
branch: gsd/phase-14-customer-auth-verification
baseline_plan_commit: 6d5f94e1be19ca4276c6078a618797a244f8ed10
implementation_prompt: not-authorized
execution_status: blocked
---

# Phase 14 SPEC — Customer Auth & Verification

## 0. Autoridade e gate

Este documento fixa **o que** a Phase 14 entrega: contratos observáveis, invariantes,
limites de fase e critérios de aceitação. Não autoriza Implementation Prompt,
execução dos planos `14-01..14-21`, runtime, testes, migrations, OpenAPI writer,
package/lockfile, provider, deploy ou frontend.

Artefato irmão (como): `14-SDD.md`.
Convenção factual do repositório: SPEC e SDD separados (igual Phase 13).

**Precedência em divergência:**

```text
1. Phase 14 CONTEXT — D14-01..D14-16 HUMAN APPROVED
2. Phase 14 PLAN — HUMAN APPROVED, pós R4.1 (14-01..14-21, P14-D01..P14-D14)
3. Phase 14 VALIDATION
4. Phase 14 RESEARCH corrigido — installed npm artifact 2.16.0
5. canonical REQUIREMENTS / PRD Backend / SRS / traceability
6. DB_MODEL as currently documented
7. as-built runtime/source/package — feasibility/integration facts only
8. inference
```

Rotulagem obrigatória de afirmações materiais:

| Label | Significado |
|---|---|
| `AS-BUILT` | fato comprovado hoje no repositório ou package instalado |
| `APPROVED TARGET` | comportamento obrigatório da Phase 14 após execução futura |
| `PLAN-DECIDED` | escolha técnica já fechada pelo PLAN humano aprovado |
| `EXECUTION-TIME FACT` | fato que somente a execução futura poderá determinar |
| `FUTURE OWNER-PHASE` | comportamento pertencente a Phase 15+ ou frontend |

Nenhum requisito AUTH é marcado COMPLETE neste gate.

```text
AUTH-01..AUTH-09: 9/9 COVERED
AUTH COMPLETE: 0/9
Implementation Prompt: NOT AUTHORIZED
Execution: NOT AUTHORIZED
Frontend: BLOCKED
Deploy: NOT AUTHORIZED
```

---

## 1. Scope

### 1.1 In scope (`APPROVED TARGET` / `PLAN-DECIDED`)

- `AUTH-01..AUTH-09` cobertos (não completos);
- 12 contratos backend/BFF fechados em `14-02-PLAN.md`;
- registration recovery (intenção parcial, mismatch zero-write, um Customer);
- sessão inicial flexível não verificada (teto absoluto 30d);
- refresh de mesma lineage, uso único, replay-revoke;
- revogação de lineage e credential version;
- verificação de e-mail (auto intent/outbox, latest-wins, confirm público);
- auth notification outbox hash-only;
- reset composto fail-closed;
- password change com senha atual e revogação global;
- limiter/anti-enumeração P14-D11;
- normalização de e-mail P14-D12;
- superfície Auth/Store exact-set staged;
- contrato API Docs (registry 14-19, writer 14-20);
- invariantes de segurança/negativos (Order/Stripe, hash-only, BFF-only).

### 1.2 Out of scope (`FUTURE OWNER-PHASE`)

| Domínio | Owner |
|---|---|
| MFA | fora da Phase 14 |
| social login | fora da Phase 14 |
| passwordless | fora da Phase 14 |
| implementação frontend | fora do backend milestone |
| Next.js runtime / BFF implementation | fora do backend milestone |
| cart capability | Phase 15 |
| merge | Phase 16 |
| checkout CPF | Phase 17 |
| Gelato shipping | Phase 18 |
| PaymentAttempt hardening | Phase 19 |
| async confirmation | Phase 20 |
| Order summary / catalog | Phase 21 |
| kit / release | Phase 22 |
| provider real (Resend/Stripe/Gelato/Supabase/PostHog) | gate separado |
| deploy | gate separado |
| retenção legal além dos TTLs operacionais aprovados | gate externo |
| Pix frontend | fora da Phase 14 |

Não incluir feature nova.

### 1.3 Assumptions

- Pin Medusa permanece o artifact npm **2.16.0** instalado; a tag Git `v2.16.0` não é autoridade do verification seam (`AS-BUILT` / RESEARCH).
- PostgreSQL descartável + harness existente bastam para provas PG futuras.
- Redis Locking/cache já configurados permanecem coordenação; nunca verdade.
- Nenhuma dependência npm nova é necessária (`PLAN-DECIDED` RESEARCH).
- Frontend M1 permanece bloqueado até Phase 22 + closeout humano.

### 1.4 Dependencies

- Phase 13 CLOSED — HUMAN APPROVED (`AS-BUILT` documental).
- Phase 14 CONTEXT, RESEARCH e PLAN HUMAN APPROVED — PASS.
- Medusa installed npm **2.16.0** é a autoridade as-built de Auth/emailpass/core-flows.
- Cadeia serial `14-01 → … → 14-21` (`parallelization=false`).
- `14-03` reconcilia `docs/DB_MODEL_v1.21.md` **antes** de model/migration (`PLAN-DECIDED` P14-D04). Este SPEC/SDD **não** altera DB_MODEL.
- `customerAuthAccessGuard` (14-11) precede qualquer exposição autenticada de verification request/status, me e password (`PLAN-DECIDED`).
- Domain-before-surface: 14-10 antes de 14-11; 14-12 antes de 14-13; 14-14 antes de 14-15; 14-17 handler DENY até 14-18.

### 1.5 Hard invariants globais (imutáveis)

```text
1. Order birth = canonical trusted Stripe webhook only
2. Auth cannot create Order
3. Auth expiry/revoke cannot erase cart/checkout
4. Stripe webhook may finish server-side work after client session expires
5. purchase_completed semantics unchanged
6. Gelato semantics unchanged
7. refund semantics unchanged
8. BFF-only — browser never receives backend session JWT, backend refresh credential, or internal auth/session capabilities and never calls Medusa directly. One-time verification/reset capabilities may arrive out-of-band to the user/browser and are submitted only through the same-origin BFF.
9. PostgreSQL is validity authority
10. Redis never grants validity
11. tokens/capabilities/password never persisted/logged in plaintext
12. native incompatible auth routes remain denied
```

---

## 2. Requirement traceability

Gates de evidência permitidos (exact-set; nenhum inventado):

```text
V14-W0 V14-CTR V14-DB V14-LIM V14-OUT V14-SES
V14-VER V14-REG V14-RST V14-CHG V14-DOC V14-NEG
```

A matriz Per-Task de `14-VALIDATION.md` é o mapa de evidência. A matriz AUTH de `14-21-PLAN.md` é o agregador **final** (V14-NEG e gates de fechamento), **não** uma dispensa dos gates anteriores. AUTH só pode ser COMPLETE depois que **todos** os gates da coluna abaixo passarem. D14-16 usa **V14-CHG** (VALIDATION plans 17-18) além de V14-RST quando 14-21 o lista.

Unknown/native DENY (`PLAN-DECIDED` 14-02): 404 anti-enumerável `AuthErrorResponse`, sem oracle, antes do handler.

| Requirement | Observable contract | SPEC | SDD | Owning plans | Evidence gates |
|---|---|---|---|---|---|
| AUTH-01 | Cadastro coordenado identity+Customer; JWT de register ≠ Customer; intenção parcial recuperável; um Customer; mismatch zero-write; TTL 24h; zero Order | §4 | registration / RegistrationIntent | 04,05,07,14,15,21 | V14-W0, V14-DB, V14-LIM, V14-REG, V14-NEG |
| AUTH-02 | Lineage inicial não verificada **autoriza** compra futura (Phase 15+); refresh não reinicia teto; novo login unverified bloqueado; expiry não apaga checkout | §5 | lineage / login / access-guard | 05,07,10,11,14,15,21 | V14-W0, V14-DB, V14-SES, V14-REG, V14-NEG |
| AUTH-03 | Login BFF-only; sem operação Store de logout; revoke interno; `/auth/session` DENY | §3, §12 | auth-surface / Store routes | 02,11,15,17,18,19,20,21 | V14-W0, V14-CTR, V14-SES, V14-REG, V14-CHG, V14-DOC, V14-NEG |
| AUTH-04 | Reset request uniforme; confirm composto; tokens hash-only/uso único/15m; anti-enum; dois 503 distintos | §8, §10 | reset / AuthResetIntent | 04,06,07,08,09,16,18,21 | V14-W0, V14-DB, V14-LIM, V14-RST, V14-CHG, V14-NEG |
| AUTH-05 | Reset/change revogam todas as lineages; sessão antiga rejeitada; password change exige senha atual; 204 só após proof+revoke | §8, §9 | access-guard / credential version | 05,07,10,11,16,17,18,21 | V14-W0, V14-DB, V14-SES, V14-RST, V14-CHG, V14-NEG |
| AUTH-06 | Refresh somente para opaque refresh válido da mesma lineage; N→N+1; 45s recovery; replay revoga; native refresh DENY | §6 | session / jwt / refresh route | 04,05,07,08,10,11,21 | V14-W0, V14-DB, V14-LIM, V14-SES, V14-NEG |
| AUTH-07 | Request/resend/confirm/status; pending\|verified; confirm sem sessão; resend uniforme; auto intent | §7 | verification / Store verify routes | 02,04,06,07,08,09,12,13,19,20,21 | V14-W0, V14-CTR, V14-DB, V14-LIM, V14-OUT, V14-VER, V14-DOC, V14-NEG |
| AUTH-08 | Estado próprio de verificação + outbox auth hash-only; sem Event Bus de capability; recipient opaco | §7, §11 | AuthVerificationIntent / AuthNotificationOutbox | 03,06,07,09,12,21 | V14-W0, V14-DB, V14-OUT, V14-VER, V14-NEG |
| AUTH-09 | Rate limit + anti-enum em cadastro, login, reset, resend e verificação; timing; Redis outage fail-closed | §10 | rate-limit / timing | 02,04,08,09,12–21 | V14-W0, V14-CTR, V14-LIM, V14-OUT, V14-VER, V14-REG, V14-RST, V14-CHG, V14-DOC, V14-NEG |

FE-AUTH-001..007 permanecem rastreabilidade de produto; este SPEC não marca artefatos FE COMPLETE. Envelope browser do BFF é `FUTURE OWNER-PHASE` (FE-AUTH-007).

---

## 3. Public HTTP/BFF contract

`PLAN-DECIDED` P14-D01. Fonte canônica: tabela de `14-02-PLAN.md`.

Todos os endpoints são **BFF→backend**. `x-publishable-api-key`, Origin/CORS e correlation ID seguem a Phase 13.

Browser MUST NOT receive:
- backend access JWT
- backend refresh capability
- internal lineage/session/auth capabilities
- provider/internal auth state

Browser MAY receive as user-facing out-of-band input:
- one-time email-verification capability
- one-time password-reset capability

These one-time capabilities:
- may arrive from an email/user-facing flow;
- are submitted only to the same-origin BFF;
- never authorize direct browser → Medusa requests;
- are never returned by backend success/error responses;
- remain hash-only in backend persistence;
- exact browser↔BFF transport belongs to the future frontend/BFF owner (`FUTURE OWNER-PHASE`).

Browser never calls Medusa directly. Não existe method/path Store ou Auth de logout browser; o browser chama somente o BFF, que usa internamente `POST /auth/customer/emailpass/revoke-current-lineage`. Browser cookie/storage handling is `FUTURE OWNER-PHASE`. `/auth/session` permanece DENY.

Campo extra, limite ou shape inválido → `400 INVALID_REQUEST` (validators `.strict()`), mesmo quando a coluna de falhas da operação não relista esse código.

### 3.1 As 12 operações

| # | Operação | Método/path | Auth | Request | Success | Falhas públicas | Sensitive | Anti-enum | Owner |
|---|---|---|---|---|---|---|---|---|---|
| 1 | signup | `POST /auth/customer/emailpass/register` | pública ao BFF | `{email,password,firstName,lastName}` | `201 AuthSessionEnvelope`, code `AUTHENTICATED` | `400 INVALID_REQUEST`, `409 AUTH_REQUEST_REJECTED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | password, accessToken, refreshToken | 409 genérico; falha parcial não é oracle | 14-15 |
| 2 | login | `POST /auth/customer/emailpass` | pública ao BFF | `{email,password}` | `200 AuthSessionEnvelope` (sem code de sucesso enumerado) | `400 INVALID_REQUEST`, `401 INVALID_CREDENTIALS`, `403 EMAIL_VERIFICATION_REQUIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | password, tokens | missing/wrong → mesmo `401` | 14-15 |
| 3 | refresh | `POST /auth/token/refresh` | header `x-indicio-refresh-token` + `Idempotency-Key` | body vazio | `200 AuthSessionEnvelope` da mesma lineage | `400 INVALID_REQUEST`, `401 AUTHENTICATION_REQUIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | refresh capability, tokens, Idempotency-Key | replay revoga sem ecoar token | 14-11 |
| 4 | revoke current lineage | `POST /auth/customer/emailpass/revoke-current-lineage` | access bearer válido | body vazio | `204` | `401 AUTHENTICATION_REQUIRED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | access JWT | 204 idempotente; sem oracle | 14-11 |
| 5 | verification request | `POST /store/customers/me/verify` | access bearer válido | body vazio | `202 {code:"REQUEST_ACCEPTED"}` | `401 AUTHENTICATION_REQUIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | verification capability | 429/503 antes de lookup/write | 14-13 |
| 6 | verification public resend | `POST /store/customers/verify/resend` | pública ao BFF | `{email}` | sempre `202 {code:"REQUEST_ACCEPTED"}` | schema inválido `400 INVALID_REQUEST`; **sem** 429/`Retry-After` distinguível | email input only — never log plaintext; verification capability — never log/persist plaintext | uniforme para inexistente/verificado/inelegível/limitado/provider failure | 14-13 |
| 7 | verification confirm | `POST /store/customers/verify` | sem sessão | `{token}` | `200 {code:"EMAIL_VERIFIED",state:"verified"}` | `400 VERIFICATION_INVALID_OR_EXPIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | token (nunca ecoado) | missing/expired/used → mesmo 400; **nunca cria sessão** | 14-13 |
| 8 | verification status | `GET /store/customers/me/verify/status` | access bearer válido | — | `200 {state:"pending"\|"verified"}` | `401 AUTHENTICATION_REQUIRED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | IDs internos | só pending\|verified | 14-13 |
| 9 | reset request | `POST /auth/customer/emailpass/reset-password` | pública ao BFF | `{email}` | sempre `202 {code:"REQUEST_ACCEPTED"}` | schema inválido `400 INVALID_REQUEST`; sem oracle/`Retry-After` | email input only — never log plaintext; reset capability — never log/persist plaintext | known/unknown/limited/outage/provider = 202 | 14-16 |
| 10 | reset confirm | `POST /auth/customer/emailpass/update` | capability no body + `Idempotency-Key` | `{token,newPassword}` | `200 {code:"PASSWORD_RESET_COMPLETED"}` | `400 RESET_INVALID_OR_EXPIRED`, `429 RATE_LIMITED`, `503 AUTH_TEMPORARILY_UNAVAILABLE`, `503 AUTH_RECOVERY_PENDING` | token, newPassword (memória) | missing/malformed/expired/used/superseded/unknown → somente `400 RESET_INVALID_OR_EXPIRED` | 14-16 |
| 11 | password change | `POST /store/customers/me/password` | access bearer válido + `Idempotency-Key` | `{currentPassword,newPassword}` | `204`; todas lineages revogadas; nenhuma sessão substituta | `400 CURRENT_CREDENTIAL_INVALID`, `401 AUTHENTICATION_REQUIRED`, `429 RATE_LIMITED`, `503 AUTH_RECOVERY_PENDING`; Redis outage `503 AUTH_TEMPORARILY_UNAVAILABLE` + `Retry-After: 60` (`PLAN-DECIDED` P14-D11 / 14-08; complementar à tabela 14-02) | currentPassword, newPassword | wrong current = 400 zero-write | handler 14-17 DENY; enable 14-18 |
| 12 | current auth/customer state | `GET /store/customers/me` | access bearer válido | — | `200 {customer:{id,email,firstName,lastName},auth:{verificationState,originalAuthenticatedAt,absoluteExpiresAt}}` | `401 AUTHENTICATION_REQUIRED`, `503 AUTH_TEMPORARILY_UNAVAILABLE` | JWT, lineage id, cv, tokens | DTO allowlist | 14-15 |

Não existe 13ª operação. Não criar logout Store artificial.

### 3.2 Envelopes públicos

`AuthErrorResponse` (`PLAN-DECIDED`): `{code,message,retryable,correlationId}`. Mensagens fixas; sem identity/provider/state interno.

`AuthSessionEnvelope` (`PLAN-DECIDED`): `accessToken`, `accessExpiresAt`, `refreshToken`, `refreshExpiresAt`, `originalAuthenticatedAt`, `absoluteExpiresAt`, Customer minimizado (`id,email,firstName,lastName`), verification state. **Exclusivamente server-to-server.** Não redefine o envelope browser do BFF (`FUTURE OWNER-PHASE`).

Current-state DTO **não** inclui metadata, password hash, identity/provider IDs, lineage ID, credential version ou token.

`AuthVerificationState` público Phase 14: `"pending" | "verified"`. `blocked` do FE-AUTH **não** é estado público deste contrato (`PLAN-DECIDED` 14-02).

### 3.3 Dois 503 de reset-confirm (`PLAN-DECIDED`)

| Code | Quando | Headers |
|---|---|---|
| `AUTH_TEMPORARILY_UNAVAILABLE` | Redis limiter indisponível; fail-closed **antes** de lookup, claim, consumo, provider ou mutação | `Retry-After: 60` |
| `AUTH_RECOVERY_PENDING` | operação de reset legitimamente correlacionada à mesma operation e `Idempotency-Key`, já em estado composto ambíguo/reconciliável | não substitui outage/invalid |

### 3.4 Validators (`PLAN-DECIDED` 14-02)

- senha / `newPassword` / `currentPassword`: 12..128 caracteres, **sem trim silencioso**;
- e-mail: somente via normalizador P14-D12;
- token/capability: 43..512, **nunca ecoado**;
- extra fields falham; schemas `.strict()`;
- `Idempotency-Key` obrigatório em refresh, reset-confirm e password change.

---

## 4. Registration contract

`APPROVED TARGET` D14-01..D14-04; `PLAN-DECIDED` P14-D12 / 14-14 / 14-15.

- Chave de identidade = e-mail **normalizado** pela função única P14-D12.
- Identidade sem Customer é intenção pendente **recuperável**.
- Retry compatível (mesmas credenciais + payload semanticamente compatível) retoma sem duplicar identity ou Customer.
- Retry semanticamente incompatível → **zero-write** (nome/senha/pendente inalterados) + `409 AUTH_REQUEST_REJECTED` genérico.
- No máximo **um** Customer; concorrência observa um resultado canônico persistido.
- `RegistrationIntent` TTL **24h**; após expirar não é reutilizada; novo cadastro pode iniciar sem revelar estado anterior.
- Entrega do provedor de e-mail é **independente**: falha/atraso não reverte cadastro nem muda a resposta pública de signup.
- Após identity+Customer confirmados: intent/outbox de verificação **automáticos**.
- Lineage inicial somente após sucesso de Customer.
- Signup **não** cria Order.
- `POST /store/customers` permanece DENY; signup público é o register coordenado.
- Native duplicity/error de emailpass **nunca** vaza. Qualquer signup que não complete o coordinator usa somente classes já fechadas em 14-02 (`400` / `409 AUTH_REQUEST_REJECTED` / `429` / `503`). Conta já `completed` (identity+Customer canônicos) **não** é D14-01 recovery; rejeição pública, se ocorrer, permanece `409 AUTH_REQUEST_REJECTED` — a mesma classe de mismatch — sem código novo e sem oracle nativo.
- Recuperação D14-01 é **retry de signup**, não login.

---

## 5. Initial session / login contract

`APPROVED TARGET` D14-05..D14-08; `PLAN-DECIDED` 14-15.

- Sessão inicial **não verificada** é permitida. Essa lineage **autoriza** compra futura na Phase 15+; Phase 14 prova a exceção de sessão e zero Order, **não** executa compra.
- Teto absoluto: **30d** a partir de `originalAuthenticatedAt`; refresh **não** reinicia.
- Revoke / logout BFF / reset / password change / expiração absoluta encerram a exceção.
- Novo login unverified (Customer já criado, `email_verified_at` ausente) → `403 EMAIL_VERIFICATION_REQUIRED`; **não** emite nova lineage.
- Login verificado é permitido e cria nova lineage (teto 30d a partir desta autenticação).
- Identity **sem** Customer (intenção `pending_identity` / `pending_customer` / `failed_reconcilable`) **não** usa `403` (isso revelaria cadastro parcial). Login percorre o caminho dummy/`401 INVALID_CREDENTIALS` já fechado. Recovery continua sendo retry de signup (D14-01).
- Login/refresh **não** são bloqueados por RegistrationIntent pendente. O fail-closed `claimed|credential_updated` de 14-03 aplica-se a **operações de credencial** (reset/password-change), não ao coordinator de signup. Login nessa condição usa `401 INVALID_CREDENTIALS` (classe já fechada; não `AUTH_RECOVERY_PENDING` e não `AUTHENTICATION_REQUIRED`). Refresh usa `401 AUTHENTICATION_REQUIRED` (classe já fechada de refresh).
- Sem grace de checkout no cliente: expiry bloqueia chamadas autenticadas imediatamente.
- Processamento server-side confiável e webhook Stripe canônico **permanecem** aptos após expirar a sessão do cliente.
- Login missing vs senha errada compartilham `401 INVALID_CREDENTIALS` (anti-enum).
- Login **nunca** devolve `AUTH_RECOVERY_PENDING` (oracle de operação composta).

---

## 6. Refresh / revocation contract

`APPROVED TARGET` D14-05..D14-07; `PLAN-DECIDED` P14-D06 / P14-D07.

Observável:

- refresh é **one-time**: N consumido → exatamente um descendente N+1 na **mesma** lineage;
- lost-response: mesma `Idempotency-Key`, ≤**45s**, descendente **unused** → **mesmo** N+1 (não N+2);
- key diferente / janela expirada / descendente usado / replay → **revoga a lineage inteira** (incluindo descendentes);
- access JWT **10m** (`exp=min(now+10m, absolute)`); access antigo rejeitado pelo guard após revoke/version bump;
- inactivity refresh **7d** por geração, limitado pelo absoluto 30d;
- native refresh **não** é exposto; override custom na mesma path após 14-11;
- Redis **nunca** concede validade.

Guard PostgreSQL (`PLAN-DECIDED` P14-D07) verifica, em toda request autenticada Phase 14:

```text
JWT cryptographic validity
lineage active
identity ownership
customer ownership
credential version
absolute deadline
stable recovery state
```

---

## 7. Verification contract

`APPROVED TARGET` D14-09..D14-12; `PLAN-DECIDED` P14-D08.

- Intent/outbox **automáticos** após identity+Customer.
- Latest-wins: reenvio elegível cria nova geração e invalida anteriores; um pending.
- Confirm concorrente: **um** vencedor; após sucesso nenhum token da identidade permanece utilizável.
- Confirm é **público / no-session**; token **não autentica** e **não** emite JWT.
- One-time verification capability MAY arrive out-of-band to the user/browser (email/user-facing flow) and is submitted only through the same-origin BFF. It never authorizes direct browser → Medusa requests and is never returned by backend success/error responses. Exact browser↔BFF transport is `FUTURE OWNER-PHASE`.
- Resend público é **uniforme** (`202 REQUEST_ACCEPTED`).
- Status autenticado: `pending | verified`.
- Falha do provedor é independente: não reverte cadastro, não encerra sessão inicial, não muda resposta pública de signup/resend.
- Native verification routes/events permanecem DENY; capability **não** via Event Bus.
- Confirm CAS exige `hash + pending + expiry` (`PLAN-DECIDED` 14-12). Crash após `claimed` e antes de `confirmed` é fail-closed: o token apresentado não confirma; resend latest-wins pode superseder `claimed` e emitir N+1. Não há classe pública extra.
- AuthVerificationIntent.status model-declared values (14-06): `pending`, `claimed`, `confirmed`, `superseded`, `expired`, `dead_letter`.
- `AuthVerificationIntent.dead_letter` is a **reserved model state** inherited from the approved 14-06 model contract. No Phase 14 runtime transition caused by provider-delivery failure is authorized to move a verification intent into this state. No implementation path may use this state to invalidate an otherwise pending verification capability unless a later separately approved contract defines such a transition.
- Provider delivery exhaustion MUST NOT transition `AuthVerificationIntent.status` → `dead_letter`. Provider delivery dead-letter belongs exclusively to `AuthNotificationOutbox.status = dead_letter`.
- For verification delivery exhaustion: AuthVerificationIntent remains `pending` and confirmable until successful confirm, TTL expiry, or resend/supersede. Confirm CAS remains `hash + pending + expiry`; provider delivery status MUST NOT participate in capability validity. Status público continua `pending|verified`.

---

## 8. Reset contract

`APPROVED TARGET` D14-13..D14-15; `PLAN-DECIDED` P14-D09.

- Request uniforme `202 REQUEST_ACCEPTED`.
- TTL **15m**; latest-wins; um pending.
- Unverified **permanece** unverified; reset **não** autentica e **não** cria sessão.
- One-time reset capability MAY arrive out-of-band to the user/browser (email/user-facing flow) and is submitted only through the same-origin BFF. It never authorizes direct browser → Medusa requests and is never returned by backend success/error responses. Exact browser↔BFF transport is `FUTURE OWNER-PHASE`.
- Sucesso composto: senha persistida **e** token consumido **e** todas as lineages revogadas. Sem sucesso público enquanto qualquer garantia estiver incerta.
- Same `Idempotency-Key` retry; `newPassword` deve ser **reapresentada**.
- Dois 503 distintos (§3.3).
- Reconciler secretless **não** pode provar senha nem completar.

---

## 9. Password-change contract

`APPROVED TARGET` D14-16; `PLAN-DECIDED` P14-D09 / 14-17 / 14-18.

- Access válido **e** recovery `stable` (primeira chamada); senha atual obrigatória.
- `newPassword` atualiza credencial; `credential_version` sobe; **todas** as lineages, inclusive a corrente, são revogadas.
- `204` somente após proof + revoke; **nenhuma** sessão substituta.
- Resume-only: mesma operação + mesma `Idempotency-Key` + mesmo identity/customer; não autoriza me/verification/refresh/outras rotas.
- Unverified permanece unverified.
- Handler existe em 14-17 mas a path permanece DENY até 14-18.

---

## 10. Anti-enumeration contract

`PLAN-DECIDED` P14-D11. Thresholds fechados:

| Operação | Thresholds | Limite público | Redis outage |
|---|---|---|---|
| signup | 5/IP/15m + 3/email/h | `429 RATE_LIMITED` | `503 AUTH_TEMPORARILY_UNAVAILABLE` `Retry-After: 60` antes de lookup/write |
| login | 10/(IP,email)/15m + 30/IP/15m | `429 RATE_LIMITED` | idem 503 |
| reset request / public resend | 3/email/h + 10/IP/h | absorvido em `202` sem `Retry-After` distinguível | absorvido em `202`; **sem** intent/outbox |
| verification request autenticado | 3/lineage/h + 10/IP/h | `429 RATE_LIMITED` | 503 antes de lookup/write |
| verification confirm | 10/(IP,input-token)/15m pre + 10/(IP,intent)/15m post | `429` / `400 VERIFICATION_INVALID_OR_EXPIRED` | 503 antes de lookup |
| reset confirm | PRE 30/IP/15m + 10/(IP,presented-reset-token)/15m; POST 10/(IP,reset-intent)/15m | ver abaixo | 503 **antes** de lookup/claim/consume/provider/write |
| refresh | 60/IP/15m + 10/(IP,presented-refresh)/min pre + 10/lineage/min post | `429` / `401 AUTHENTICATION_REQUIRED` | 503 antes de lookup |
| password change | 5/lineage/h | `429 RATE_LIMITED` | 503 antes de lookup/mutation |

### 10.1 Reset-confirm classes públicas

```text
PRE:  30 / IP / 15m
      10 / (IP, presented-reset-token) / 15m
POST: 10 / (IP, reset-intent) / 15m
missing/malformed/unknown: dummy post derived from pre-digest
invalid public class: missing | malformed | expired | used | superseded
  => 400 RESET_INVALID_OR_EXPIRED
rate exceeded => 429 RATE_LIMITED
Redis outage => 503 AUTH_TEMPORARILY_UNAVAILABLE Retry-After: 60
  before lookup/claim/consume/provider/write
legitimate ambiguous recovery => 503 AUTH_RECOVERY_PENDING
```

### 10.2 Timing (`PLAN-DECIDED`)

```text
floor 350ms
CSPRNG jitter 0..50ms
40 samples/class
median delta <= 50ms
p95 delta <= 75ms
```

Aplica-se a verification-confirm, reset-confirm e refresh (classes públicas aplicáveis). `newPassword` somente em memória.

IP: `req.ip` após trust-proxy; prefixo /32 IPv4 ou /64 IPv6. E-mail: forma P14-D12. Keys HMAC com `key_version` e domain separation; IP/token/IDs puros nunca na key.

---

## 11. Security / data contract

`APPROVED TARGET` regras transversais; `PLAN-DECIDED` P14-D05, P14-D10, P14-D12.

```text
hash-only: refresh / verification / reset persist only SHA-256 + nonce + key_version
CSPRNG 32 bytes for capabilities
HMAC/HKDF domain-separated by purpose + key_version
PII minimization: no plaintext email in durable AuthNotificationOutbox
plaintext email MUST NOT appear in logs, telemetry, Sentry, Redis, or OpenAPI examples
plaintext email MAY exist transiently in request/provider resolution memory when required by the approved flow
existing Customer/Auth provider storage is not redefined here
no secrets in logs
no tokens in Redis jobs
no token in OpenAPI examples
no capability in provider persistence / Event Bus
outbox recipient_identity_id opaque + recipient_hash/domain
newPassword / currentPassword memory-only
```

### 11.1 Email normalization P14-D12 (`PLAN-DECIDED`)

```text
trim
exactly one @
ASCII local-part lowercase
EAI / non-ASCII local rejected
domainToASCII(domain) then domain lowercase
plus preserved
dots preserved
no Gmail / provider-specific canonicalization
same function for identity / Customer / intents / limiter / audit
collision audit before normalized constraints (read-only; no auto-winner)
```

### 11.2 TTLs P14-D05 (`PLAN-DECIDED`; 30d é também `APPROVED TARGET`)

| Item | Valor |
|---|---|
| RegistrationIntent | 24h |
| Verification | 30m |
| Reset | 15m |
| Access JWT | 10m |
| Refresh inactivity | 7d |
| Lost-response recovery | 45s |
| Initial session absolute | 30d |
| Outbox / reconciler lease | 2m |

---

## 12. Surface contract

`PLAN-DECIDED` P14-D13.

### 12.1 Auth

- deny-by-default; exact method/path;
- actor `customer`; provider `emailpass`;
- 18 operações nativas npm 2.16.0 nascem DENY;
- 6 operações locais nascem DENY e sobem só após prova do owner;
- native session / callback / MFA / verification / refresh / reset **permanecem DENY**.
- Unknown/native DENY devolve **404** anti-enumerável `AuthErrorResponse` antes do handler (`PLAN-DECIDED` 14-02).

Enablement staged:

| Plano | Enablement |
|---|---|
| 14-02 | total DENY baseline (24/24) |
| 14-11 | custom refresh + revoke |
| 14-15 | signup + login |
| 14-16 | reset request + reset confirm overrides |

### 12.2 Store

Somente exact Phase 14 operations conforme staged plan:

| Plano | Paths |
|---|---|
| 14-13 | `POST /store/customers/me/verify`, `POST /store/customers/verify/resend`, `POST /store/customers/verify`, `GET /store/customers/me/verify/status` |
| 14-15 | `GET /store/customers/me` |
| 14-17 | password handler existe, path **DENY** |
| 14-18 | `POST /store/customers/me/password` enablement final |

Raw `POST /store/customers` e demais Customer nativos incompatíveis permanecem DENY.

---

## 13. D14-01..D14-16 representation (16/16)

| ID | Representado em | Label |
|---|---|---|
| D14-01 recoverable partial signup | §4 | `APPROVED TARGET` |
| D14-02 concurrency one Customer | §4 | `APPROVED TARGET` |
| D14-03 mismatch zero-write | §4 | `APPROVED TARGET` |
| D14-04 RegistrationIntent TTL finito | §4, §11.2 (24h `PLAN-DECIDED`) | `APPROVED TARGET` |
| D14-05 refresh mesma lineage | §5, §6 | `APPROVED TARGET` |
| D14-06 refresh single-use | §6 | `APPROVED TARGET` |
| D14-07 replay revoga lineage | §6 | `APPROVED TARGET` |
| D14-08 absolute 30d; server-side preserved | §5, invariantes | `APPROVED TARGET` |
| D14-09 automatic verification intent/outbox | §7 | `APPROVED TARGET` |
| D14-10 verification latest-wins | §7 | `APPROVED TARGET` |
| D14-11 verification token não autentica | §7 | `APPROVED TARGET` |
| D14-12 resend uniforme | §7, §3 | `APPROVED TARGET` |
| D14-13 reset mantém unverified | §8 | `APPROVED TARGET` |
| D14-14 reset latest-wins | §8 | `APPROVED TARGET` |
| D14-15 reset composed fail-closed | §8 | `APPROVED TARGET`; tx `EXECUTION-TIME FACT` |
| D14-16 password change exige current password | §9 | `APPROVED TARGET` |

---

## 14. P14-D01..P14-D14 representation (14/14)

| ID | Representado em | Label |
|---|---|---|
| P14-D01 HTTP/BFF | §3 | `PLAN-DECIDED` |
| P14-D02 transaction boundary | SDD §5; **não escolhido aqui** | `EXECUTION-TIME FACT` `SUPPORTED_STRONG \| RECONCILIATION_REQUIRED` |
| P14-D03 persistence (7 states) | SDD §3 | `PLAN-DECIDED` |
| P14-D04 DB_MODEL prerequisite | §1.4; este gate **não** edita DB_MODEL | `PLAN-DECIDED` |
| P14-D05 TTLs | §11.2 | `PLAN-DECIDED` |
| P14-D06 refresh protocol | §6 | `PLAN-DECIDED` |
| P14-D07 access/revocation | §6 | `PLAN-DECIDED` |
| P14-D08 verification | §7 | `PLAN-DECIDED` |
| P14-D09 reset/password composed | §8, §9 | `PLAN-DECIDED` |
| P14-D10 auth outbox | §11, SDD | `PLAN-DECIDED` |
| P14-D11 limiter/anti-enum | §10 | `PLAN-DECIDED` |
| P14-D12 email normalization | §11.1 | `PLAN-DECIDED` |
| P14-D13 Auth/Store surface | §12 | `PLAN-DECIDED` |
| P14-D14 validation architecture | §16; SDD §19 | `PLAN-DECIDED` |

---

## 15. Research disposition

Installed npm **2.16.0** é autoridade as-built. Tag Git `v2.16.0` não substitui o artifact.

### 15.1 4 RESEARCH blockers (4/4 disposed)

| # | Finding | Owner / component | Evidence | SPEC/SDD dispose |
|---|---|---|---|---|
| 1 | Superfície auth não fail-closed | 02,11,13,15,18–20 / auth-surface guard | V14-CTR, V14-DOC, V14-NEG | deny-by-default exact-set; native session/callback/MFA/verification/refresh DENY |
| 2 | Refresh nativo incompatível | 10,11 / session+jwt | V14-SES | opaque refresh custom; native DENY |
| 3 | Reset composto ausente | 03,16,18 / reset SM | V14-RST, V14-CHG | composed fail-closed; **não** afirmar atomicidade até 14-03 |
| 4 | Signup pendente mutável / e-mail não normalizado | 04,05,07,14,15 / normalizer+coordinator | V14-DB, V14-REG | P14-D12 + mismatch zero-write + collision audit |

### 15.2 8 MUST-address (8/8 disposed)

| # | Finding | Owner | Evidence | Dispose |
|---|---|---|---|---|
| 1 | Evento nativo com `code` plaintext / Event Bus | 09,12 | V14-OUT, V14-VER | outbox custom; native event unused |
| 2 | Confirm nativo sem one-winner comprovado | 07,12,13 | V14-VER | SM custom latest-wins |
| 3 | Bearer sem lineage/version | 11 | V14-SES | PG guard P14-D07 |
| 4 | Timing oracle emailpass | 08,15 | V14-LIM, V14-REG | dummy scrypt + floor 350ms |
| 5 | Relay order-only / CAS unproven | 09 | V14-OUT | sibling outbox CAS/lease |
| 6 | Sem limiter auth global | 08 | V14-LIM | Redis atomic P14-D11 |
| 7 | Leak de provider_metadata / erros específicos | 02,13,19 | V14-CTR, V14-DOC | envelopes allowlist |
| 8 | Capability em logs/Sentry/OpenAPI | 01,21 | V14-W0, V14-NEG | allowlist + canaries |

---

## 16. Acceptance criteria

Estes critérios permitem afirmar **posteriormente** `AUTH 9/9 COMPLETE` somente após execução + validation + closure. **Nunca agora.**

| ID | Critério observável | Gate |
|---|---|---|
| AC-AUTH-01 | Signup coordenado produz no máximo um Customer; parcial é recuperável via retry de signup; mismatch/completed usam `409` fechado sem leak nativo; 24h; zero Order | V14-REG, V14-NEG |
| AC-AUTH-02 | Lineage inicial unverified **autoriza** compra futura; relogin unverified `403`; absoluto 30d; checkout preservado; Phase 14 não executa compra | V14-SES, V14-REG, V14-NEG |
| AC-AUTH-03 | 12 ops BFF fechadas; sem logout Store; `/auth/session` DENY; OpenAPI registry/writer | V14-CTR, V14-DOC, V14-NEG |
| AC-AUTH-04 | Reset 15m latest-wins; composto; anti-enum; dois 503; no-session; unverified stays unverified | V14-RST, V14-LIM |
| AC-AUTH-05 | Após reset/change, access/refresh antigos rejeitados cross-process; 204 só após proof+revoke | V14-SES, V14-RST, V14-CHG |
| AC-AUTH-06 | N→N+1; 45s same-key; replay revoga; native refresh DENY | V14-SES |
| AC-AUTH-07 | Auto intent; latest-wins; resend uniforme; confirm no-session; status pending\|verified | V14-VER |
| AC-AUTH-08 | Outbox hash-only; recipient opaco; sem Event Bus capability; CAS/lease | V14-OUT, V14-VER |
| AC-AUTH-09 | Thresholds P14-D11; timing 350ms+jitter; Redis outage fail-closed; canaries ausentes | V14-LIM, V14-NEG |

Wave 0, ledger PostgreSQL de 11 processos, HTTP focado, OpenAPI e regressão seguem `14-VALIDATION.md` integralmente. Nenhuma execução neste gate.

---

## 17. Lower-authority documentary drift (não reabre D14/P14)

PRD Backend 7.1, SRS e `FRONTEND_CONTRACT_TRACEABILITY` ainda descrevem, em trechos, dois passos públicos de signup, resend autenticado `/me/verify/resend`, refresh como “JWT” e omitem `POST /store/customers/me/password`.

**Disposição deste SPEC (`PLAN-DECIDED` / precedência §0):** o contrato público da Phase 14 é a tabela de 12 operações de `14-02-PLAN.md` + CONTEXT D14. Isso **não** é decisão nova. Atualização documental de PRD/SRS/FE-AUTH é trabalho posterior, fora deste gate. Este SPEC **não** edita esses arquivos.

---

## 18. Governance

```text
SPEC/SDD complete != implementation authorization
SPEC/SDD complete != execution authorization
requirements remain incomplete (0/9 Phase 14 AUTH; 8/91 milestone)
frontend remains blocked
plans executed = 0/21
SPEC/SDD human approval: NOT YET GRANTED
```

Unresolved during this gate (must stay unresolved):

```text
SUPPORTED_STRONG | RECONCILIATION_REQUIRED (14-03 spike)
live email collision-audit result
runtime PHASE14_ENABLED bits
generated OpenAPI bytes
test counts / exit codes
```

Não declarar PASS de execução futura.

---

## 19. Critério de conclusão desta etapa documental

O SPEC cobre AUTH-01..AUTH-09 (9/9 covered, 0/9 complete), D14-01..D14-16 (16/16), P14-D01..P14-D14 (14/14) e os 21 planos. O gate SPEC/SDD está **DOCUMENTALLY COMPLETE — AWAITING HUMAN REVIEW**. SPEC/SDD **não** está human-approved. Implementation Prompt e todos os gates posteriores permanecem blocked.
