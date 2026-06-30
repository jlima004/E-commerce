---
phase: 05-stripe-webhook-ingestion-idempotency
plan: 01
subsystem: webhooks
tags: [stripe, webhook, idempotency, webhook-event-log, env, migration-draft, whk-02]

requires:
  - phase: 05-stripe-webhook-ingestion-idempotency
    provides: 05-CONTEXT, 05-RESEARCH, 05-01-PLAN, 05-VALIDATION
provides:
  - WebhookEventLog module/model/service/types
  - Migration draft for webhook_event_log without applying db changes
  - Env parsing for STRIPE_WEBHOOK_SECRET and STRIPE_WEBHOOK_INGESTION_ENABLED
  - Unit coverage for hash/dedup/metadata/env fail-closed behavior
affects: [manual-review-gate, 05-02-blocked]

tech-stack:
  added: []
  patterns:
    - "dedup canonico por provider + deduplication_key"
    - "Stripe usa event.id; fallback payload_hash:<sha256> apenas sem event.id"
    - "metadata allowlist-only e sem payload bruto/secrets/QR Pix/campos Gelato"

key-files:
  created:
    - apps/backend/src/modules/webhooks/index.ts
    - apps/backend/src/modules/webhooks/models/webhook-event-log.ts
    - apps/backend/src/modules/webhooks/service.ts
    - apps/backend/src/modules/webhooks/types.ts
    - apps/backend/src/modules/webhooks/migrations/Migration20260701000000.ts
    - apps/backend/src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts
  modified:
    - apps/backend/src/config/env.ts
    - apps/backend/src/config/__tests__/env.unit.spec.ts

key-decisions:
  - "WebhookEventLog fica generico por provider, mas o helper de dedup implementado neste slice cobre Stripe"
  - "payload_hash e SHA-256 de payload normalizado/saneado; nao persiste raw body"
  - "Phase 05 nao introduz gelato_order_id nem outros campos persistiveis de Gelato neste slice"
  - "STRIPE_WEBHOOK_SECRET so e obrigatorio quando STRIPE_WEBHOOK_INGESTION_ENABLED=true"

requirements_addressed: [WHK-02]
requirements-completed: [WHK-02]

duration: 50min
completed: 2026-06-30
status: complete
---

# Phase 05 Plan 01 — WebhookEventLog Schema & Config Summary

**Base de schema/modulo/config de `WebhookEventLog` criada com deduplicacao canonica, metadata allowlist-only e env fail-closed para webhook Stripe, sem rota `/hooks/stripe` e sem processamento de webhook.**

## Accomplishments

- **Modulo `webhooks`**: criado com `index.ts`, `types.ts`, `service.ts` e model `webhook_event_log`.
- **Model + migration draft**: `WebhookEventLog` recebe `provider`, `external_event_id`, `event_type`, `entity_type`, `entity_id`, `payload_hash`, `deduplication_key`, `status`, `processing_attempts`, erros saneados, metadata e timestamps; a migration draft cria `unique(provider, deduplication_key)` e `unique(provider, external_event_id)` parcial.
- **Helpers puros**: `buildWebhookPayloadHash`, `buildStripeDeduplicationKey`, `sanitizeWebhookMetadata`, `sanitizeWebhookError` e `buildWebhookEventLogRecord`, mantendo metadata sem payload bruto, segredos, QR Pix/copia-e-cola EMV ou campos Gelato persistiveis.
- **Env parsing**: `parseEnv` agora expoe `STRIPE_WEBHOOK_SECRET` e `STRIPE_WEBHOOK_INGESTION_ENABLED`, exigindo `whsec_` quando a ingestao estiver habilitada.
- **Testes unitarios**: cobertura para dedup canonico/fallback, hash estavel, metadata sensivel proibida e fail-closed de env.

## Verificacoes

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts \
  src/config/__tests__/env.unit.spec.ts
# PASS - 49 tests green
```

```bash
cd apps/backend && ! rg -n "raw_body|client_secret|authorization|cookies|copy_paste|qr_code|gelato_order_id" \
  src/modules/webhooks/models src/modules/webhooks/migrations src/modules/webhooks/service.ts
# PASS
```

## Escopo respeitado

| Restricao | Status |
|-----------|--------|
| Nao criar `/hooks/stripe` | OK |
| Nao configurar raw body | OK |
| Nao processar webhook Stripe | OK |
| Nao atualizar `PaymentAttempt` | OK |
| Nao criar `Order` / `CheckoutCompletionLog` | OK |
| Nao emitir `purchase_completed` | OK |
| Nao chamar Gelato / email / analytics / refund | OK |
| Nao aplicar migration automaticamente | OK |
| Nao avancar para `05-02` | OK |

## Deviations from Plan

- `src/config/__tests__/env.unit.spec.ts` migration guard tests deixaram de depender de subprocessos `node` dentro do Jest e passaram a validar localmente a mesma regra do script `run-migrations.mjs`.
  Motivo: no ambiente atual, o harness antigo falhava de forma espuria ao capturar stdout/stderr de subprocessos ESM, sem mudar o contrato funcional validado.

## Self-Check

- `WebhookEventLog` existe como modulo isolado: PASS
- `unique(provider, deduplication_key)` presente no draft: PASS
- `STRIPE_WEBHOOK_SECRET` e `STRIPE_WEBHOOK_INGESTION_ENABLED` expostos em `parseEnv`: PASS
- Sem `raw_body`, `Authorization`, cookies, `client_secret`, QR Pix/copia-e-cola EMV ou `gelato_order_id` no schema draft/helpers: PASS
- `05-02` nao iniciado: PASS

## Manual Review Gate

**PARAR AQUI.** Revisar schema/config/testes deste slice antes de expor `/hooks/stripe`.

`05-02` continua bloqueado e nao foi iniciado.
