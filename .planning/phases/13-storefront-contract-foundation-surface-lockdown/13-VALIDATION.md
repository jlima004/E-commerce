---
phase: 13-storefront-contract-foundation-surface-lockdown
status: draft-pending-execution-and-human-review
requirements: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]
requirements_complete: 0
plans: [13-01, 13-02, 13-03, 13-04, 13-05, 13-06, 13-07]
nyquist: enabled
manual_review_gate: true
---

# Phase 13 — Validation Strategy

## Status and evidence rule

Este documento descreve provas **futuras**. Nenhum comando foi executado no gate PLAN e nenhum requirement está completo.

```text
Status: DRAFT / PENDING EXECUTION / PENDING HUMAN REVIEW
Phase 13 requirements covered: FND-01..FND-08 = 8/8
Phase 13 requirements complete: 0/8
Milestone requirements complete: 0/91
Phases complete: 0/10
Plans executed: 0/7
Frontend Milestone 1: BLOCKED
```

Uma linha só recebe PASS quando o comando, exit code, contagem, diff e SUMMARY correspondentes existirem. Falha relevante é `BLOCKED`, nunca “PASS com débito”.

## Canonical facts under test

| Fact | Expected |
|---|---:|
| Medusa | 2.16.0 |
| Native Store operations | 51 |
| Local non-overlapping Store operations | 7 |
| Runtime Store total | 58 |
| Current Store OpenAPI operations under `/store` | 8 |
| Runtime/OpenAPI initial gap | 50 |
| Unclassified Store routes | 0 |
| AUTHORIZED | 0 |
| EXTENDED | 10 |
| BLOCKED | 17 |
| OUTSIDE_FRONTEND_M1 | 31 |

`classification` e `runtime_policy` são dimensões independentes. Cada uma das
58 entradas deve possuir `classification`, `runtime_policy`, rationale,
expectativa OpenAPI M1 e estado explícito de enablement M1. As contagens
fatuais de `DENY` e `PRESERVE_LEGACY` são produzidas no 13-01 e precisam somar
58; o PLAN não as inventa antes da decisão individual por rota.

- BLOCKED combina sempre com DENY.
- UNKNOWN não é entrada válida e qualquer lookup ausente é DENY + drift failure.
- EXTENDED e OUTSIDE_FRONTEND_M1 permanecem M1 disabled, mas declaram DENY ou
  PRESERVE_LEGACY individualmente; nenhuma classe implica política universal.
- PRESERVE_LEGACY conserva somente o comportamento v1.0 aprovado, sem ampliar
  auth/capability, sem virar contrato M1 e sem entrar no executable M1 OpenAPI.
- M1_ENABLED só é permitido após prova da owner phase. Na Phase 13: 0.

## Linear gate map

| Plan/task | Evidence produced | Blocking dependency |
|---|---|---|
| 13-01 T1 | manifest/scanner exact-set 58/58, 0 duplicates/unknown, 0/10/17/31 e decisão individual classification+runtime_policy+rationale | nenhuma |
| 13-01 T2 | Wave 0: shared transaction, rollback, one-winner CAS, Redis failure independence | bloqueia 13-02..13-07 se FAIL |
| 13-02 T1 | legacy test impact exact-set + classificação A/B/C antes de qualquer edição | 13-01 PASS |
| 13-02 T2/T3 | global guard + DENY handler-zero + PRESERVE_LEGACY sem exposição M1 + transição legada controlada + HTTP regression matrix | inventário legado fechado |
| 13-03 T1/T2 | StoreErrorResponse/status/code/correlation/redaction + Admin/Webhooks isolation | 13-02 PASS |
| 13-04 T1/T2 | DB Model v1.22 e aprovação humana antes da migration | 13-03 PASS |
| 13-04 T3 | exactly-one CLI-generated idempotency migration com filename/class/history factuais + PG constraints/states/race/TTL + scheduled lifecycle driver de 1m + cleanup | DB contract approved |
| 13-05 T1/T2 | module registration + config regression PASS + db:generate + migration identity + build + PG bootstrap/CAS/rollback | Wave 0 + DB contract + 13-04 migration concluída |
| 13-06 T1/T2 | Store OpenAPI 1.1.0 components, verify-coverage + coverage regression, writer, diff review, lint | runtime primitives approved |
| 13-07 T1/T2 | final security/HTTP + Order zero/control/replay | 13-06 approved |
| 13-07 T3 | clean read-only openapi:check, lint/build, final evidence review | tasks committed; checkout clean |

Todos os planos têm `autonomous: false` e gate humano. A execução é estritamente `13-01 → 13-02 → 13-03 → 13-04 → 13-05 → 13-06 → 13-07`.

## Wave 0 binary proof

PASS exige, no PostgreSQL descartável:

1. Medusa 2.16.0 fornece o mesmo transaction manager à mutação Medusa controlada e ao CAS de versão.
2. Sucesso gera um commit atômico de ambos.
3. Failure injection após a primeira parte rollbacka ambos.
4. Dois writers com expected version igual geram exatamente um winner.
5. O mesmo resultado vale sem Redis lock e quando a aquisição Redis simulada falha.
6. A evidência identifica o manager/transaction factual; correlação lógica não basta.

FAIL em qualquer item bloqueia migrations/integrações dependentes. É proibido contornar com dois commits, compensação eventual ou claim de “quase atômico”.

## Requirement evidence matrix

| Requirement | Plans | Concrete proof | PASS condition |
|---|---|---|---|
| FND-01 | 13-01, 13-02, 13-07 | manifest unit + installed scanner + HTTP final | 58/58; 51+7; 0 unknown/duplicate; exact 0/10/17/31; todas com classification+runtime_policy+rationale; DENY+PRESERVE_LEGACY=58; M1_ENABLED=0; version drift fails closed |
| FND-02 | 13-02, 13-07 | deny/preserve matrix + workflow spy + PG Order count | unknown e toda DENY param antes do handler; PRESERVE_LEGACY mantém somente comportamento aceito e fica fora do M1; variants denied; Store Order/invocation zero; webhook control positive |
| FND-03 | 13-03, 13-06, 13-07 | error unit/HTTP + OpenAPI schema + canaries | code/status/retryable/fieldErrors/correlation stable; auth non-enumerable; unknown/provider sanitized; Admin/Webhooks unaffected |
| FND-04 | 13-04, 13-07 | env suite + config suite + DB catalog + job unit + module PG suite | HMAC-SHA-256 com pepper dedicado/versionado; module registered once; composite unique; scope/fingerprint/result/deadlines/retention persisted; scheduled evaluation de 1m; same intent replay; todo terminal expira |
| FND-05 | 13-04, 13-07 | concurrency/lifecycle driver PG suite | incompatible fingerprint gives 409/zero side effect; same-key e two-worker races com um winner; processing/retry/reconciliation progridem sem request; restart usa PostgreSQL; Redis/idempotency não substituem constraints/locks/CAS |
| FND-06 | 13-01, 13-05, 13-07 | Wave 0 + resource-version PG suite | bigint positive/unique; lazy existing-data bootstrap; atomic CAS; one winner; rollback no partial state; no final Cart contract yet; 13-05 exige config regression PASS + backend build PASS + PostgreSQL behavior PASS |
| FND-07 | 13-02, 13-06, 13-07 | guard/BFF HTTP + OpenAPI security contract | browser direct rejected as architecture assumption; credentials/headers server-side; BFF schemes explicit; no artificial browser authorization |
| FND-08 | 13-06, 13-07 | três exact-sets em `coverage.unit.spec.ts` + registry tests + writer/lint/artifact review + later clean check | Store 1.1.0; runtime=manifest=58; executable Store operations = AUTHORIZED M1-enabled + EXTENDED M1-enabled = 0; PRESERVE_LEGACY excluído; Admin/Webhooks coverage preservado; health/support separado; closed primitives/money; JSON untouched; clean check passes |

## As-built blocker closure matrix

| Blocker | Eliminated in | Proof |
|---|---|---|
| B13-01 native complete creates Order | 13-02 + 13-07 | BLOCKED manifest, global guard, local defense, HTTP deny, workflow spy zero, PG Order zero, positive webhook + replay one Order |
| B13-02 no global allowlist | 13-01 + 13-02 | single manifest/scanner and global fail-closed guard |
| B13-03 `/store/custom` public | 13-02 + 13-07 | BLOCKED entry and HTTP handler-zero proof |
| B13-04 no transversal idempotency | 13-04 | StoreIdempotencyRecord migration/service/PG suite |
| B13-05 no resource version/CAS | 13-01 + 13-05 | Wave 0 and StoreResourceVersion PG suite |
| B13-06 wrong Store error envelope | 13-03 + 13-06 | runtime normalizer and matching closed OpenAPI component |
| B13-07 Store OpenAPI 1.0.0 | 13-06 + 13-07 | registry/writer/lint 1.1.0 then separate clean openapi:check |

## HTTP lockdown matrix

Cada decisão usa method + canonical path template do manifest e separa
classificação de runtime policy:

- UNKNOWN, BLOCKED/DENY e toda entrada com runtime_policy DENY afirmam denial
  **antes do handler**;
- PRESERVE_LEGACY afirma o comportamento legado esperado, sem enablement M1,
  sem guards owner-phase ainda inexistentes e sem operação executable M1;
- EXTENDED e OUTSIDE_FRONTEND_M1 permanecem M1 disabled independentemente da
  runtime policy;
- método correto/incorreto, unknown method, HEAD sem inferência de GET;
- OPTIONS preflight válido sem negócio e OPTIONS inválido fail-closed;
- trailing slash, double slash, encoded separator/path, query string, alias;
- path parameter, static-vs-parameter precedence e ID sintético;
- `/store/custom`, `/store/carts/{id}/complete`, native carts direct, attach/customer, payment collections/sessions, shipping list/calculate/method, orders/transfer;
- 10 EXTENDED ainda disabled e M1_ENABLED=0.

Para cada negativa DENY: status/code Store estável, handler/workflow spy zero e
nenhum Order. Para PRESERVE_LEGACY: comportamento herdado explicitamente aceito
permanece funcional, sem ampliar authority e sem aparecer no executable M1.

## Legacy test controlled transition

O `13-02` começa por um inventário **antes de qualquer edição**. O
`13-02-SUMMARY.md` registra duas identidades: exact-set de 1..4 paths únicos e
inventário de casos, permitindo várias linhas por arquivo. Cada linha possui
`Path | Case/describe/test | Family | Class | Reason | Coverage replacement`;
o case identifier é único dentro do path:

| Classe | Contrato |
|---|---|
| A — OBSOLETE_CONTRACT_EXPECTATION | a única expectativa era sucesso de uma rota agora negada; substituir pela prova fail-closed |
| B — STILL_VALID_INTERNAL_INVARIANT | preservar a lógica de domínio em boundary interna/unit/module equivalente; nunca remover coverage |
| C — MUST_REMAIN_GREEN | não contradiz o lockdown; permanece verde e não é alterado por conveniência |

É proibido deletar suite, usar `.skip`/`.only`, relaxar assertion sem razão,
aprovar snapshot para esconder erro ou reduzir coverage. O regression gate
deduplica por path/family e roda cada arquivo uma única vez, mesmo com vários
casos inventariados, além da seleção fechada de Order birth, money derivation e
serializer público. Mais de 4 paths únicos, case duplicado no mesmo path,
family divergente no mesmo arquivo, path fora de Store/checkout/payment/API
Docs/invariants diretamente afetados ou item B sem replacement equivalente
resulta em `13-02: BLOCKED` e nova revisão humana.

## Error/correlation evidence

| Family | Evidence |
|---|---|
| validation/request | fieldErrors somente para campos públicos; sem echo de body |
| auth/ownership | 401 ou política 403/404 não enumerável |
| idempotency conflict | 409 code estável; message não usado como lógica |
| optimistic stale primitive | conflito técnico genérico; `CART_VERSION_MISMATCH`/snapshot público somente Phase 15 |
| domain | 422 com code público |
| rate limit | 429 + factual Retry-After |
| provider/internal/unknown | 500/503 genérico, retryable somente quando conhecido e sem efeito incerto |
| correlation | input allowlisted até 128; inválido vira UUID; header/body/Sentry context usam o mesmo valor seguro |
| isolation | Admin/Webhooks regressions passam sem receber envelope Store |

## Idempotency persistence and concurrency

### Physical contract

`StoreIdempotencyRecord` inclui operation, actor_scope_hash,
resource_scope_hash, idempotency_key_hash, `hash_version`, `pepper_version`,
request_fingerprint, state, result_type, result_id, response_status, safe result
metadata/snapshot, locked_at, `state_deadline_at`, `next_retry_at`,
`retry_attempt_count`, `retry_started_at`, `terminalized_at`, completed_at,
failure_code, expires_at e timestamps.

`idempotency_key_hash` é HMAC-SHA-256 via `node:crypto`, usando exclusivamente
`STORE_IDEMPOTENCY_KEY_PEPPER`. Produção exige pepper base64url decodificado de
pelo menos 32 bytes; o valor nunca persiste nem aparece em log/health/OpenAPI.
Rows persistem `hash_version=hmac-sha256-v1` e `pepper_version=1`. Rotação exige
gate humano de migration/dual-read e resolver das versões anteriores; simples
troca do env é proibida. A caller key aceita `[!-~]`, 1..255 bytes, e é tratada
byte-for-byte sem trim, case-fold ou normalização.

Constraint central real:

```text
UNIQUE(operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash)
```

### State/behavior matrix

| Scenario | Expected |
|---|---|
| same key + same intent | replay do resultado seguro, zero novo efeito |
| same key + incompatible intent | 409, zero novo efeito |
| concurrent same key | um winner; demais processing/replay/conflict conforme fingerprint |
| different keys | claims independentes; constraints de domínio continuam aplicáveis |
| processing | in-progress estável; não executar paralelo |
| completed | replay allowlisted |
| failed_retryable | retry apenas sob policy e certeza de ausência de efeito |
| failed_terminal | erro terminal replayable até expiry |
| reconciliation_required | sem blind retry e sem cleanup automático |
| reconciliation_unresolved | terminal explícito após review deadline sem resolução; replay/auditoria até expiry |
| stale claim | reclaim somente com ausência de side effect provada |
| expiry/cleanup | apenas completed/failed_terminal/reconciliation_unresolved expirados removidos |

### TTL policy under validation

- default terminal replay retention 24h;
- allowed override bounds 15m..30d with owner/rationale;
- processing deadline 5m; ao ficar stale, recovery evaluation decide em no máximo 15m entre retry comprovadamente seguro, terminal replay-safe ou reconciliation_required;
- failed_retryable persiste next_retry_at/count e tem teto de 8 tentativas ou 24h, o que ocorrer primeiro; depois terminaliza ou reconcilia se efeito incerto;
- Phase 13 `local-mutation`: 24h;
- Phase 13 `uncertain-effect-simulation`: review deadline 7d; sem resolução vira reconciliation_unresolved; retention terminal 30d;
- later phases remain free to choose operation-specific TTL inside the bounds; values outside require human review.

Todo registro tem `created_at`, deadline específico do estado, regra de
terminalização e `expires_at` terminal. `claimStaleAfter`, recovery evaluation,
retry horizon, reconciliation review deadline e retention TTL são conceitos
distintos e validados separadamente.

### Lifecycle execution driver

Deadline persistido não é considerado driver. O plano materializa
`apps/backend/src/jobs/store-idempotency-lifecycle.ts` como Medusa scheduled job
factual, seguindo a infraestrutura versionada em `apps/backend/src/jobs/`:

```text
schedule: * * * * *
scan due state_deadline_at / next_retry_at / terminal expires_at
→ PostgreSQL transaction
→ row lock ou atomic conditional claim com state/version predicate
→ evaluate transition
→ persist next state/deadline
```

A cadência de um minuto é menor que `claimStaleAfter=5m`. PostgreSQL é a
fonte de verdade; Redis é coordenação opcional. O processor não mantém estado
decisório em memória e, após restart, retoma as rows due do banco.

Provas com relógio controlado, sem sleep real:

- due processing é reclamado por um worker; dois workers geram uma transição;
- row not-due permanece intocada;
- failed_retryable progride quando `next_retry_at <= now` e respeita 8/24h;
- owner phases futuras fornecem executores específicos; Phase 13 executa apenas
  harness local ou dispatch hook sem provider side effect;
- reconciliation deadline produz `reconciliation_unresolved`, que é terminal
  de auditoria e não resolução financeira, provider success ou business success;
- cleanup remove somente terminais expirados; nenhum não terminal é apagado;
- restart retoma de PostgreSQL e Redis indisponível não duplica transição.

## Env/config regression ownership

As regressões possuem suites factuais distintas:

| Suite | Responsabilidade |
|---|---|
| `src/config/__tests__/env.unit.spec.ts` | produção sem pepper, base64url malformado, decoded menor que 32 bytes, valor válido, comportamento development/test determinístico, mensagens sem secret e `.env.template` placeholder-only |
| `src/infrastructure/__tests__/medusa-config.unit.spec.ts` | `store_idempotency` exatamente uma vez; depois `store_resource_version` exatamente uma vez; módulos existentes e providers/config Redis preservados; nenhuma substituição/mutation acidental |
| `src/modules/store-idempotency/__tests__/store-idempotency.postgres.spec.ts` | persistência, estados, constraints, claims, concorrência, restart semantics e cleanup |

Nenhuma suite substitui as outras. O 13-05 estende a mesma regressão de config
ao registrar `store_resource_version`.

## Module registration before migration generation

Para cada migration custom da Phase 13, a precondition geral é:

```text
custom module definition
→ module registration in medusa-config.ts
→ dedicated registration/config regression proves each required module exactly once
→ regression PASS
→ db:generate
```

No `13-04`, essa ordem já está satisfeita pelo model/module, registro,
regression e checkpoint humano existentes antes da geração. O `13-05` deve
torná-la explícita na Task 1: registrar `store_resource_version`, executar a
regression de configuração e somente com `PASS` executar `db:generate`. Se a
regression falhar, `13-05` fica `BLOCKED` e a geração é proibida. Após
`db:generate`, migration identity e DDL review, o `13-05` ainda exige
`ADMIN_DISABLED=true npm run build -w @dtc/backend` PASS antes da Task 1
ser considerada concluída; falha de build mantém `13-05: BLOCKED` e não é
substituída pelo build final do 13-07.

A regression pré-geração deve provar:

- `store_idempotency` registrado exatamente uma vez;
- `store_resource_version` registrado exatamente uma vez;
- módulos existentes preservados;
- providers/configuração Redis preservados;
- nenhum provider substituído e nenhuma mutation acidental de configuração.

O futuro `13-05-SUMMARY.md` deve registrar `config_regression: PASS`,
`registration_proven_before_db_generate: YES` e
`db_generate_executed_after_registration: YES`, além das duas contagens.

## StoreResourceVersion / bootstrap / rollback

Physical contract: resource_type, resource_id, version bigint, timestamps, UNIQUE(resource_type,resource_id), CHECK(version&gt;0).

Chosen bootstrap: lazy serialized initialization. Existing resource without row is inserted at version 1 via insert-on-conflict, then locked/used in the same transaction. Tests require:

- preexisting resources and non-empty DB fixture;
- two concurrent first accesses produce one row/version 1;
- repeatability;
- mutation+initialization failure rollback;
- expected-version CAS and monotonic increment;
- two writers → one commit;
- failure after Medusa mutation → no mutation/version partial;
- Redis failure does not change PostgreSQL truth.

Phase 13 does not implement Cart ETag/If-Match/412/snapshot/invalidation; Phase 15 consumes the proven generic primitive.

## Order-birth invariant

Negative path:

```text
Any Store request → global guard → no completeCart/createOrder call → Order count 0
```

Positive control:

```text
POST /hooks/stripe trusted payment_intent.succeeded
→ PaymentAttempt payment_confirmed_by_webhook
→ CheckoutCompletionLog
→ completeCartWorkflow
→ exactly one Order
→ replay/concurrent replay returns same result; still one Order
```

Grep/static scan é evidência complementar, nunca suficiente isoladamente.

## BFF security boundary

- Browser → same-origin BFF → server-to-server Medusa Store API.
- Publishable key, Customer JWT quando aplicável, guest capability, confirmation session e sensitive header assembly permanecem server-side.
- CORS/publishable key sozinhos não provam autorização.
- OpenAPI descreve BFF→Medusa e não concede credencial/capability ao browser.
- Phase 13 cria somente primitives transversais; não cria BFF/Next.js nem comportamento auth/cart/checkout/payment/confirmation final.

## OpenAPI writer/check separation

Antes do writer, coverage prova separadamente:

```text
runtime inventory exact-set = 58
manifest exact-set = 58, distribuição 0/10/17/31
executable Store business OpenAPI exact-set = AUTHORIZED + enabled EXTENDED
```

Na Phase 13 inicial, `AUTHORIZED=0` e `enabled EXTENDED=0`; portanto o documento
1.1.0 publica **0 operações Store business executáveis**. Health/support pode
permanecer no documento, mas é identificado e contado separadamente. Metadata,
schemas e conhecimento histórico podem continuar no registry TypeScript sem
path+method público executável. Disabled EXTENDED, BLOCKED e
OUTSIDE_FRONTEND_M1 não aparecem como operações Store executáveis.
PRESERVE_LEGACY também não entra nesse exact-set: disponibilidade runtime
herdada não equivale a exposição M1. Uma phase
proprietária futura só inclui EXTENDED depois de implementation/proof,
enablement explícito no manifest e revalidação dos três exact-sets.

`apps/backend/src/api-docs/__tests__/coverage.unit.spec.ts` pertence
explicitamente ao closed-set de **10 paths** do 13-06 e deve regredir
`verify-coverage.ts` nos
três conjuntos. A suite prova 51 operações nativas + 7 locais não sobrepostas,
manifest 58 com 0/10/17/31 e todos os campos obrigatórios, executable M1 vazio,
PRESERVE_LEGACY fora desse terceiro conjunto, BLOCKED → DENY e
unknown/duplicate/drift fail-closed. Conhecimento histórico de schemas e
components pode permanecer sem se tornar path+method público. As regras e
operações obrigatórias de Admin/Webhooks permanecem cobertas; a nova semântica
Store não as desliga nem relaxa.

| Gate | Plan | Rule |
|---|---|---|
| Registry tests | 13-06 | read source of truth |
| Writer | 13-06 | `npm run openapi:generate -- --surface store` |
| Artifact review | 13-06 | revisar diff do generated Store; nenhum manual edit |
| Lint | 13-06 | `npm run openapi:lint` |
| Commit/clean boundary | entre 13-06 e 13-07 | writer output já versionado; checkout limpo |
| Read-only check | 13-07 | `npm run openapi:check`; writer proibido antes/dentro |

PASS exige Store version 1.1.0, closed components, money unit explicit, BFF schemes, headers/errors e runtime/manifest coverage coerentes.

## Security negative canaries

Canaries são sintéticas e nunca secrets reais. Zero match é exigido em HTTP response, structured logs, Sentry event/context, DB columns/metadata, OpenAPI examples, fixtures e test snapshots para:

- raw Idempotency-Key e `STORE_IDEMPOTENCY_KEY_PEPPER`;
- JWT;
- guest capability;
- confirmation token/session;
- CPF;
- client_secret;
- Pix QR/copia-e-cola;
- Stripe/provider IDs onde proibidos;
- provider payload;
- stack trace e raw internal error.

## Migration verification

1. DB_MODEL_v1.22 é criado/revisado humanamente antes de migration.
2. Os nove paths completos da Task 1 do 13-04 passam por checkpoint humano e `git diff --check --` exact-set antes de qualquer geração; env/config e suas duas regressões não ficam fora da revisão.
3. Para cada módulo, a definição model/module existe, o módulo está registrado em `medusa-config.ts` e a regression dedicada prova exatamente um registro antes de qualquer `db:generate`; cada plano executa uma única geração factual e compara o exact-set before/after.
4. A geração esperada por módulo é exatamente uma migration. Zero ou mais de uma bloqueia; o executor não escolhe silenciosamente um arquivo.
5. Filename e exported class permanecem intencionalmente unresolved durante PLAN. O Medusa CLI é a autoridade factual; timestamp/identidade não é pré-selecionado.
6. O checkpoint humano pré-migration é aplicado onde o plano o exige; no `13-04`, a aprovação do DB Model permanece antes da geração. No `13-05`, não se cria novo gate: a regression PASS é a precondition documental de Task 1 e o checkpoint humano existente continua na Task 3, após a prova do primitive.
7. `13-04-SUMMARY.md` e `13-05-SUMMARY.md` registram separadamente módulo, contagens de registro, resultado da registration/config regression, prova de registro antes de `db:generate`, comando, source filename, exported class, framework/history identity quando observável, identidade/timestamp aceito, DDL review e git diff exact-set. Nenhum campo pode permanecer TBD após a execução correspondente.
8. É proibido rename/copy para coincidir com o PLAN, editar a class por estética/timestamp ou manter migrations equivalentes duplicadas. Alteração técnica legítima exigida pelo framework precisa de evidência explícita.
9. A ordenação é provada por `define module → register module → registration/config regression PASS → db:generate`; pela execução/aprovação completa do 13-04 antes do 13-05; e, após a segunda geração, pela identidade real aceita pelo framework. Collision, ordering ambíguo ou incompatibilidade bloqueia o 13-05; rename ad hoc não corrige.
10. Nenhum Prisma, TypeORM schema sync, Supabase push ou DB remoto.
11. PostgreSQL descartável prova tabelas, named/semantic constraints, indexes, down/reapply e concurrency.
12. StoreIdempotencyRecord é tabela nova sem backfill.
13. StoreResourceVersion usa lazy initialization para existing data; não presume DB vazio.
14. Core Cart e CheckoutCompletionLog não mudam.
15. Rollback persistente futuro exige gate humano/migration corretiva; testes podem down apenas no banco descartável.

## Decision coverage D13-01..D13-32

| Decisions | Plans/proof |
|---|---|
| D13-01..D13-02 | 13-02 guard + 13-06 schemes + 13-07 BFF test |
| D13-03..D13-04 | 13-01 manifest/scanner + 13-02 guard |
| D13-05..D13-07 | 13-02 bypass denial + 13-07 Order proof |
| D13-08..D13-12 | 13-03 runtime errors + 13-06 schema + 13-07 canaries |
| D13-13..D13-19 | 13-04 idempotency states/scope/fingerprint/TTL/race |
| D13-20..D13-24 | 13-01 Wave 0 + 13-05 version/bootstrap/CAS; Cart integration deferred |
| D13-25..D13-29 | 13-06 Store 1.1.0 registry/components; 13-07 clean check |
| D13-30..D13-31 | all evidence distinguishes as-built from completion and fails closed on unknowns |
| D13-32 | checkpoint/manual stop in every plan |

## Phase boundary negatives

The final diff must contain no final behavior for Phase 14 auth; Phase 15 capability/Cart mutation/ETag integration; Phase 16 merge/review; Phase 17 CPF/checkout/consent; Phase 18 quote/select; Phase 19 PaymentAttempt M1 hardening; Phase 20 confirmation; Phase 21 summary/revalidation. Nenhuma das dez EXTENDED é habilitada na Phase 13.

## Multi-source coverage audit

| SOURCE | ID | Item | Plan | Status |
|---|---|---|---|---|
| GOAL | — | conhecer/bloquear Store real e impedir Order | 13-01, 13-02, 13-07 | COVERED |
| REQ | FND-01 | inventory/classification | 13-01, 13-02, 13-07 | COVERED |
| REQ | FND-02 | allowlist/native bypass/Order | 13-02, 13-07 | COVERED |
| REQ | FND-03 | error/correlation | 13-03, 13-06 | COVERED |
| REQ | FND-04 | idempotency persistence/retention | 13-04 | COVERED |
| REQ | FND-05 | incompatible intent/concurrency | 13-04 | COVERED |
| REQ | FND-06 | generic monotonic version/CAS | 13-01, 13-05 | COVERED |
| REQ | FND-07 | BFF boundary | 13-02, 13-06, 13-07 | COVERED |
| REQ | FND-08 | Store OpenAPI 1.1.0 | 13-06, 13-07 | COVERED |
| RESEARCH | surface/lockdown/order bypass | manifest, guard, 58 matrix, complete/custom proof | 13-01, 13-02, 13-07 | COVERED |
| RESEARCH | error/idempotency/version | physical primitives and concurrency proofs | 13-03, 13-04, 13-05 | COVERED |
| RESEARCH | Wave 0/TTL/bootstrap/PG vs Redis | binary gate, policy map, lazy serialized bootstrap | 13-01, 13-04, 13-05 | COVERED |
| RESEARCH | OpenAPI/money/BFF | registry 1.1.0 and clean separation | 13-06, 13-07 | COVERED |
| CONTEXT | D13-01..D13-32 | all locked decisions | 13-01..13-07 | COVERED |

Deferred ideas from CONTEXT (final behaviors Phases 14–22 and frontend) are intentionally excluded, not gaps. No source item is missing.

## Future exact command families

Os paths/comandos específicos estão nos PLANs. O gate final agrega:

```text
npm run test:unit -- <Phase 13 specs>
npm run test:integration:http -- <Phase 13 HTTP specs>
node scripts/run-disposable-postgres-tests.mjs -- npm run test:integration:modules -- <Phase 13 PG specs>
npm run openapi:lint
# em checkout limpo, sem writer anterior:
npm run openapi:check
npm run lint -w @dtc/backend
ADMIN_DISABLED=true npm run build -w @dtc/backend
git diff --check
```

## Final stop conditions

Phase 13 permanece BLOCKED se qualquer um ocorrer:

- scan != manifest, unknown/duplicate ou contagem/distribuição divergente;
- entrada sem classification/runtime_policy/rationale ou com combinação implícita;
- complete/custom ou qualquer runtime_policy DENY alcança handler;
- PRESERVE_LEGACY perde o comportamento aceito, amplia authority, recebe M1
  enablement/guards downstream ou aparece no executable M1 OpenAPI;
- qualquer Store cria Order ou chama completion path;
- same-key race tem múltiplos winners, conflicting intent executa efeito ou uncertain effect é blind-replayed;
- deadline existe sem scheduled driver factual, dois workers processam a mesma
  row, processor depende de estado in-memory/Redis para correctness, processing
  stale não é decidido em 15m, retry ultrapassa 8/24h, reconciliation
  ultrapassa 7d sem terminalização, reconciliation_unresolved é tratado como
  resolução/sucesso, ou terminal não possui expiry;
- plaintext sensível persiste/aparece em sink;
- transaction manager não é compartilhado, estado parcial existe ou dois CAS vencem;
- bootstrap presume banco vazio ou não é serializável/repetível;
- JSON OpenAPI requer edição manual, money unit/BFF boundary é ambígua, disabled/blocked/outside aparece executável, executable exact-set difere de AUTHORIZED+enabled EXTENDED, ou drift permanece;
- writer mascara o clean read-only check;
- regressão env/config fica embutida somente no spec PostgreSQL, registro de
  módulo/provider duplica ou config Redis existente muda;
- package/lockfile, core Cart, CheckoutCompletionLog, provider, deploy ou Phase 14+ entra no escopo;
- requirement/phase é marcada completa antes do gate humano apropriado.

## Artifacts this phase produces

- Manifest/scanner Store 58/58 com classification/runtime_policy independentes e global fail-closed/legacy-compatibility guard.
- StoreErrorResponse runtime/OpenAPI e correlation integration.
- DB Model v1.22, StoreIdempotencyRecord e StoreResourceVersion com migrations Medusa de identidade factual gerada pelo CLI e evidência filename/class/history separada.
- TTL policy map, scheduled lifecycle driver de 1m, env/config regressions, lazy bootstrap e PostgreSQL concurrency suites.
- Store OpenAPI 1.1.0 registry-generated.
- Final native-bypass, sensitive-negative, Order-zero/webhook-control e clean-check evidence.

## Manual review gate

Após cada SUMMARY e ao final do 13-07, parar. Mesmo com todos os comandos PASS, requirements permanecem abertos até o gate de conclusão/closure explicitamente autorizado. Não iniciar SPEC/SDD, implementation fora destes plans, REVIEW/CLOSURE, Phase 14, frontend, provider ou deploy automaticamente.
