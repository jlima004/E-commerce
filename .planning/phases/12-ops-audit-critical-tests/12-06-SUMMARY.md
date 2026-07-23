---
phase: 12-ops-audit-critical-tests
plan: 06
subsystem: testing
tags: [invariants, postgresql, concurrency, stripe-webhook, gelato, refund, TEST-01]

requires:
  - phase: 12-ops-audit-critical-tests
    provides: disposable PostgreSQL harness (12-01), OPS-01/02 surfaces (12-02..12-05), HTTP webhook harnesses
provides:
  - Four named HTTP invariant suites (INV-1/2/3/4/8/9/10) — created, focused PASS
  - Three PostgreSQL constraint/concurrency suites — created, serial disposable PASS
  - Composite final gate: serial disposable PG + normal Modules suite
  - Diagnostic record that stacked medusaIntegrationTestRunner under disposable hits Map.prototype.set
affects: [TEST-01, OPS-01, OPS-02, human-verification]

tech-stack:
  added: []
  patterns:
    - Named INV HTTP suites reuse Stripe/Gelato/refund doubles without external providers
    - PostgreSQL concurrency via real pg.Client connections + release barrier
    - Serial disposable process per .postgres.spec.ts avoids cross-realm Map.prototype.set
    - Modules full suite via normal project command (process-local regression)

key-files:
  created:
    - apps/backend/integration-tests/http/invariants-inv01-02-order-birth.spec.ts
    - apps/backend/integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts
    - apps/backend/integration-tests/http/invariants-inv08-gelato-single-active.spec.ts
    - apps/backend/integration-tests/http/invariants-inv09-10-refund-decoupling.spec.ts
    - apps/backend/src/modules/webhooks/__tests__/webhook-event-log.postgres.spec.ts
    - apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.postgres.spec.ts
    - apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.postgres.spec.ts
    - .planning/phases/12-ops-audit-critical-tests/12-06-SUMMARY.md
  modified: []

key-decisions:
  - "P12-12-06-R1: stacked disposable Jest is not required for PASS; composite gate is serial disposable PG + normal Modules."
  - "Map.prototype.set on stacked medusaIntegrationTestRunner is a Jest/test-utils stacking limitation, not a defect of constraints or invariants."
  - "No Jest/test-utils/runner/predecessor/runtime correction attempted in Phase 12."

requirements-completed: [TEST-01, OPS-01, OPS-02]

completed: 2026-07-23
status: passed
---

# Phase 12 Plan 06: Final Invariant Verification — PASS

**PASS sob o gate composto autorizado por P12-12-06-R1:** cinco specs PostgreSQL em processos descartáveis serializados + Modules completo no comando normal do projeto. Stacked permanece diagnóstico incompatível — não classificado como PASS nem corrigido.

## Human resolution — P12-12-06-R1

A revisão humana aceitou o gate composto:

1. PostgreSQL real serial, um processo descartável por spec;
2. Modules completo no modo normal do projeto.

O modo stacked permanece conhecido como incompatível e não foi classificado
como PASS nem corrigido.

### Justificativa formal

```text
O requisito exige PostgreSQL real para constraints, claims, cardinalidade e
concorrência.

Ele não exige que cinco aplicações Medusa independentes sejam inicializadas no
mesmo processo Jest.

Cada spec serial usa PostgreSQL real e múltiplas conexões pg.Client quando a
concorrência faz parte do contrato.

A execução Modules normal prova que o conjunto completo de módulos continua
verde.

O modo stacked falha antes das assertions por incompatibilidade de realm/Map no
bootstrap de múltiplos medusaIntegrationTestRunner. Essa falha não invalida os
resultados serialmente executados.
```

Não alegado: `stacked runner PASS`, `cross-dyno real PASS`, `defeito Jest corrigido`.

## Resultado e SHAs de controle

- **Status:** `passed`
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **PLAN12_06_BASE_SHA:** `99711924db5954f91f949d3cfd8335fdfe4b79b3`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **HEAD (pré-commits 12-06):** `99711924db5954f91f949d3cfd8335fdfe4b79b3`
- **Divergência `origin/main...HEAD` (pré-commits):** `0 27`
- **Commits 12-06:** `3089b59` HTTP; `ed34d9f` PostgreSQL; + docs commit
- **Push/deploy:** não executados
- **REVIEW/CLOSURE:** não iniciados (aguardam gate humano separado)
- **Phase 12 closed / milestone closed / production validated / cross-dyno real proven / stacked runner passed:** não alegados

## Lint preflight (antes de editar)

- **Resultado:** `0` erros, `210` warnings
- **Baseline herdada:** `207` (12-04) → `210` (12-05)
- **Três warnings adicionais do 12-05** (`@medusajs/prefer-container-registration-keys` em `resolve("logger")`), commit `6a50ab07`:
  1. `apps/backend/src/api/admin/exchanges/route.ts:86`
  2. `apps/backend/src/api/admin/exchanges/[id]/route.ts:78`
  3. `apps/backend/src/api/admin/refunds/request/route.ts:106`
- Gate de edição autorizado após demonstrar origem allowlisted.

## Arquivos (allowlist)

Somente estes sete specs técnicos:

1. `apps/backend/integration-tests/http/invariants-inv01-02-order-birth.spec.ts`
2. `apps/backend/integration-tests/http/invariants-inv03-04-webhook-idempotency.spec.ts`
3. `apps/backend/integration-tests/http/invariants-inv08-gelato-single-active.spec.ts`
4. `apps/backend/integration-tests/http/invariants-inv09-10-refund-decoupling.spec.ts`
5. `apps/backend/src/modules/webhooks/__tests__/webhook-event-log.postgres.spec.ts`
6. `apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.postgres.spec.ts`
7. `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment.postgres.spec.ts`

Nenhum arquivo runtime existente modificado neste plano. Documentos autorizados atualizados sob P12-12-06-R1.

## INV results (HTTP focado — PASS)

Comando: `npm run test:integration:http -- --runTestsByPath <4 invariants> --runInBand`

| INV | Resultado | Evidência |
|-----|----------|-----------|
| INV-1 | PASS | Client confirm (`card_client_secret_created`→`payment_client_confirmed`) deixa `order_id=null`; webhook não-sucedito não chama entrypoint; `payment_intent.succeeded` chama entrypoint canônico e cria Order no double |
| INV-2 | PASS | `pix_expired`, `awaiting_pix_payment`, `awaiting_webhook_confirmation`, `payment_instructions_displayed`, `payment_client_confirmed`, `client_action_required` → Order count=0, entrypoint calls=0 |
| INV-3 | PASS | raw body ausente / assinatura ausente / assinatura inválida → 400 fail-closed antes de WebhookEventLog, CheckoutCompletionLog, workflow, Order |
| INV-4 | PASS | Replay do mesmo Stripe event dedupe; mesmo payment_intent sem segundo Order; falha intermediária recuperável com novo event id sem duplicar Order |
| INV-8 | PASS | Idempotency key determinística; guard single-active; double trigger/retry no entrypoint com Gelato double local → 1 fulfillment |
| INV-9 | PASS | `refund.created` não finaliza; `refund.updated` succeeded atualiza uma vez; replay idempotente; `charge.refunded` informacional |
| INV-10 | PASS | Refund total atualiza `payment_status` e preserva `order_status=confirmed` (não `canceled`) |

**HTTP focado:** `4/4` suites, `23/23` testes PASS. Nenhum `skip`/`todo`/`only`.

## PostgreSQL — Parte A (serial disposable) — PASS

Gate PostgreSQL (P12-12-06-R1):

- cinco specs executados serialmente;
- um processo descartável por spec;
- todos PASS;
- cleanup após cada processo.

| Spec | Suites/Tests |
|------|--------------|
| `webhook-event-log.postgres.spec.ts` | 1/3 PASS |
| `checkout-completion-log.postgres.spec.ts` | 1/4 PASS |
| `gelato-fulfillment.postgres.spec.ts` | 1/4 PASS |
| `operational-alert.postgres.spec.ts` | 1/15 PASS |
| `admin-action-log.postgres.spec.ts` | 1/13 PASS |

Cleanup: `docker ps -a --filter name=p12-pg-` vazio após cada processo. Sem Redis/provider externo. Sem skip.

### WebhookEventLog

- external event concorrente → cardinalidade final = 1
- deduplication key concorrente → cardinalidade final = 1

### CheckoutCompletionLog

- claim concorrente → um vencedor
- fresh `processing` preservado (não reclamado)
- stale por `locked_at` reclamável
- ausência de `PaymentAttempt.updated_at` no reclaim

### GelatoFulfillment

- migration `Migration20260703000000` descoberta
- índice single-active `IDX_gelato_fulfillment_order_id_unique`
- tentativas concorrentes → cardinalidade final = 1 ativo por Order

### OperationalAlert

- uma linha lógica sob upsert concorrente
- `occurrence_count` exato
- severity máxima
- `first_seen_at` preservado

### AdminActionLog

- intent único / terminal único
- outcome versus reconciliation → um fato canônico
- dois workers no mesmo órfão → um terminal
- append-only (UPDATE/DELETE/soft-delete rejeitados)
- registro runtime canônico aceito (idempotente)

## Stacked execution (diagnóstico — não gate)

```text
Stacked execution:
known incompatible Map.prototype.set failure;
not required for PASS;
no correction attempted in Phase 12.
```

Histórico (pré-R1): comando stacked com 5 paths no mesmo Jest → sempre `Method Map.prototype.set called on incompatible receiver #<Map>` (também com só operational-alert + admin-action-log). Não classificado como teste aprovado. Limitação de empilhamento Jest/test-utils, não defeito das constraints.

## Modules — Parte B (comando normal) — PASS

```fish
TMPDIR=/tmp npm run test:integration:modules -w @dtc/backend
```

**36/36** suites, **511/511** testes PASS. Nenhum omitido. Prova a regressão global process-local; não substitui a Parte A.

## Baselines finais

| Gate | Resultado |
|------|-----------|
| HTTP focado | **4/4** suites, **23/23** testes PASS |
| Unit | **54/54** suites, **877/877** testes PASS |
| Modules normal | **36/36** suites, **511/511** testes PASS |
| HTTP completo | **19/19** suites, **235/235** testes PASS |
| Lint | **0** erros, **210** warnings (via `npm run build` / medusa lint) |
| Build | PASS |

## Negativas globais

- `git diff --exit-code $PHASE12_EXECUTION_BASE_SHA...HEAD -- package.json package-lock.json jest.config.js` → vazio (exit 0)
- `medusa-config.ts` diff base...HEAD: **somente** registros `operational_alert` + `admin_action_log`
- Sem Stripe/Gelato/Resend/PostHog/Correios/Supabase/Heroku/Redis reais nos novos specs
- `git diff --check` limpo
- Sem provider externo, auto-refund, auto-cancel, REL-02, interceptor `/admin/*`, deploy, push

## Classificação dos níveis de evidência

| Nível | Status |
|-------|--------|
| process-local | executado |
| PostgreSQL transacional | executado em processos descartáveis serializados |
| cross-process/dyno | inferido pelas constraints compartilhadas |
| cross-dyno real | não executado e não alegado |

## Requisitos

| ID | Estado técnico |
|----|----------------|
| TEST-01 | **complete** |
| OPS-01 | **complete** |
| OPS-02 | **complete** |

```text
TEST-01 complete
OPS-01 complete
OPS-02 complete
```

**Não registrar:** Phase 12 closed; production validated; cross-dyno real proven; stacked runner passed.

## Worktree / commits

Três commits atômicos do 12-06 (sem push):

1. `test(invariants): add critical HTTP regression suites`
2. `test(invariants): prove database concurrency constraints`
3. `docs(12): record final invariant verification`

Próximo passo humano: **REVIEW** (não CLOSURE automático). Não iniciar Phase 13.
