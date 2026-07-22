---
phase: 12-ops-audit-critical-tests
plan: 03
subsystem: operations
tags: [operational-alert, detectors, scanner, gelato, checkout-completion, payment-stuck]

requires:
  - phase: 12-ops-audit-critical-tests
    provides: OperationalAlert foundation and upsertAlert from Plan 12-02
provides:
  - Pure factual detectors for fulfillment_failed and payment_stuck
  - Worker-only operational-alert-scanner backstop (*/5)
  - Immediate Gelato OperationalAlert promotion after local persistence
  - Shared 15-minute CheckoutCompletion reclaim/stale window
affects: [12-03, OPS-01, TEST-01]

tech-stack:
  added: []
  patterns: [pure detectors with injectable now, worker-only scanner, alert after Gelato truth, locked_at reclaim]

key-files:
  created:
    - apps/backend/src/modules/operational-alert/detectors.ts
    - apps/backend/src/modules/operational-alert/__tests__/operational-alert-detectors.unit.spec.ts
    - apps/backend/src/jobs/operational-alert-scanner.ts
    - apps/backend/src/jobs/__tests__/operational-alert-scanner.unit.spec.ts
  modified:
    - apps/backend/src/jobs/gelato-dispatch-relay.ts
    - apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts
    - apps/backend/src/modules/checkout-completion/service.ts
    - apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts

key-decisions:
  - "CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000 is the single shared constant for CCL processing, CCL-absent webhook age, and CheckoutCompletion reclaim."
  - "Service API is upsertAlert (SDD); PLAN shorthand upsertOccurrence maps to the existing method."
  - "PaymentAttempt.updated_at is never used as a detection or reclaim clock."
  - "Cascading webhook-order-creation fixture required stale locked_at to preserve retry semantics under H12-06."

requirements-completed: []

completed: 2026-07-22
status: passed
---

# Phase 12 Plan 03: Operational Alert Detection Summary

**PASS absoluto. Detecções factuais OPS-01, scanner backstop, promoção Gelato e reclaim de 15 minutos estão entregues; OPS-01 global permanece aberto até gates posteriores; 12-05 e 12-06 não iniciaram.**

## Resultado e SHAs de controle

- **Status:** `passed`
- **Tasks:** `3/3`
- **PHASE12_EXECUTION_BASE_SHA:** `1cdb597d15e74f96e5e77a17a307d168433b0e7a`
- **PLAN12_03_BASE_SHA:** `bbe3d00d3c937c5e478c0b147f2a54dcbecafd06`
- **Branch:** `gsd/phase-12-ops-audit-critical-tests`
- **OPS-01:** implementação de detecção/promoção entregue; requisito global permanece incompleto até verificação/closure posteriores
- **OPS-02 / TEST-01:** não promovidos neste plano
- **12-05 e 12-06:** não iniciados; bloqueados para revisão humana
- **Push/deploy:** não executados

## Arquivos

### Criados

- `apps/backend/src/modules/operational-alert/detectors.ts`
- `apps/backend/src/modules/operational-alert/__tests__/operational-alert-detectors.unit.spec.ts`
- `apps/backend/src/jobs/operational-alert-scanner.ts`
- `apps/backend/src/jobs/__tests__/operational-alert-scanner.unit.spec.ts`

### Modificados

- `apps/backend/src/jobs/gelato-dispatch-relay.ts`
- `apps/backend/src/jobs/__tests__/gelato-dispatch-relay.unit.spec.ts`
- `apps/backend/src/modules/checkout-completion/service.ts`
- `apps/backend/src/modules/checkout-completion/__tests__/checkout-completion-log.unit.spec.ts`
- `apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts` (cascata H12-06; fora da allowlist formal, necessário para Unit PASS)

## Constante de quinze minutos

```ts
export const CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000
```

Usada por:

1. detector CCL `processing` (`locked_at`);
2. detector CCL ausente (`WebhookEventLog.received_at`);
3. reclaim de CheckoutCompletionLog `processing`.

Sem literais duplicados de quinze minutos nos produtores.

## Matriz fulfillment

| Fato | Severity | message_code |
|------|----------|--------------|
| `dead_letter` | `critical` | `FULFILLMENT_DEAD_LETTER` |
| `requires_operator_attention` sem dead_letter | `high` | `FULFILLMENT_OPERATOR_ATTENTION` |
| ambos | `critical` | `FULFILLMENT_DEAD_LETTER` |
| estado não elegível | — | null |

Detecção lê somente verdade local `GelatoFulfillment`; nunca chama Gelato.

## Matriz payment confirmed sem Order

Pré-condição obrigatória:

```text
status = payment_confirmed_by_webhook
order_id IS NULL
```

Sem isso: não alerta. Relógio proibido: `PaymentAttempt.updated_at`.

## CCL failed

Imediato → `payment_stuck` / `high` / `PAYMENT_CONFIRMED_CHECKOUT_FAILED`. Sem espera de 15 minutos.

## CCL processing / locked_at

Alerta somente quando `locked_at` válido e `now - locked_at >= 15m` → `PAYMENT_CONFIRMED_CHECKOUT_STALE`.

Negativos: fresco, sem `locked_at`, `locked_at` inválido.

## CCL ausente / WebhookEventLog

Exige exatamente um candidato canônico:

```text
provider = stripe
event_type = payment_intent.succeeded
correlação inequívoca ao payment_intent / payment_attempt
received_at válido
now - received_at >= 15m
```

→ `PAYMENT_CONFIRMED_CHECKOUT_MISSING`

Negativos: zero, ambíguo, tipo divergente, PI divergente, fresco, timestamp inválido.

## Matriz Pix vencido

Positivos (cinco status):

```text
awaiting_pix_payment
awaiting_webhook_confirmation
payment_instructions_displayed
payment_client_confirmed
client_action_required
```

com `pix`, `order_id` null, `expires_at` válido e `now > expires_at` → `PIX_PAYMENT_EXPIRED_WITHOUT_ORDER`.

Negativos: não-Pix, sem/`expires_at` inválido, não vencido, Order existente, status terminal/desconhecido.

## Proibição de PaymentAttempt.updated_at

`rg` em `operational-alert/` + `operational-alert-scanner.ts` sem ocorrência funcional. Detectores e reclaim usam `locked_at` / `received_at` / `expires_at`.

## Scanner, cron e paginação

```ts
export const config = {
  name: "operational-alert-scanner",
  schedule: "*/5 * * * *",
}
```

- batch `100`, max pages `20`, max candidates/source `2000`, timeout `25s`
- paginação com `take`/`skip` + cursor estável `(updated_at|created_at, id)`
- stall guard quando o cursor não avança
- upsert apenas para DTO positivo via `upsertAlert`
- falha por item isolada; logs saneados (contagens/códigos/IDs internos)

## Worker / release behavior

- no-op fora de `WORKER_MODE=worker`
- no-op em release migration mode
- módulos resolvidos pelo container; sem SQL cross-module; sem providers

## Promoção imediata Gelato

Ordem:

```text
persistir GelatoFulfillment
→ confirmar dead_letter / operator attention
→ tentar upsertAlert
```

## Failure contract do alert upsert

Após verdade Gelato persistida, falha de upsert:

- preserva `GelatoFulfillment`
- log saneado
- não relança erro que cause redispatch
- não chama Gelato novamente
- scanner reconcilia depois

## Reclaim CheckoutCompletion

- `failed` → reclamável imediatamente
- `processing` → somente com `locked_at` válido e idade ≥ 15m
- `processing` fresco / sem / inválido `locked_at` → `already_processing`

## DTO e logs allowlisted

DTO: `type`, `severity`, `entity_type`, `entity_id`, `message_code`, `message`, `error_code`, `metadata` allowlisted, `observed_at`.

Sem payload Stripe/Gelato, `client_secret`, QR/copia-e-cola, CPF/CNPJ, endereço, tokens, stack ou response body externo.

## Testes focados

```text
4 suítes / 89 testes PASS
```

Paths:

- `operational-alert-detectors.unit.spec.ts`
- `operational-alert-scanner.unit.spec.ts`
- `gelato-dispatch-relay.unit.spec.ts`
- `checkout-completion-log.unit.spec.ts`

## Baselines

| Gate | Resultado |
|------|-----------|
| Unit | **54/54 suítes, 877/877 testes** (≥ 52/823) |
| Modules | **33/33 suítes, 505/505 testes** (≥ 32/466) |
| HTTP | **15/15 suítes, 195/195 testes** |
| lint | **0 erros, 207 warnings** |
| build | **PASS** |

## Negative proofs

- relógio `PaymentAttempt.updated_at` ausente nos produtores OPS-01
- manifests intactos (`package.json`, lockfile, `jest.config.js`, `medusa-config.ts`)
- sem mudanças em AdminActionLog runtime, Admin routes, migrations/models/service OperationalAlert, scripts de migration/harness
- sem provider real, reprocessamento Gelato, refund, cancel/create Order, REL-02, email, dashboard, schema novo

## Commits

1. `8bbb38d` — `feat(operations): add factual operational alert detection`
2. `586c81f` — `test(operations): prove operational alert producers`
3. (este) — `docs(12): close operational alert detection plan`

## Divergência e worktree

Registrados após o commit documental:

- branch `gsd/phase-12-ops-audit-critical-tests`
- `origin/main...HEAD` esperado avançar de `0 20` para `0 23`
- worktree limpo após summary commit

## Sistemas externos

Não contatados: Stripe, Gelato, Resend, PostHog, Correios, Supabase, Heroku, Redis real, produção.

## Gate humano

`12-03` PASS e para aqui.

```text
12-05 não iniciado
12-06 não iniciado
OPS-01 formalmente não encerrado
OPS-02 incompleto
TEST-01 incompleto
Phase 12 incompleta
```

Próximo passo permitido somente após revisão humana e autorização explícita do `12-05`.
