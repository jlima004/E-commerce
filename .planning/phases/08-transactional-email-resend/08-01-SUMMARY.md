---
phase: 08
plan: 01
status: completed
manual_review_gate: true
updated_at: 2026-07-01T18:10:00-03:00
---

# 08-01 - EmailDeliveryLog Contract, Model, Idempotency And Migration Draft

## Decisao explicita de branch

O trabalho foi realinhar para branch `gsd/phase-08-transactional-email-resend`.

## Escopo executado

Executado somente o plano `.planning/phases/08-transactional-email-resend/08-01-PLAN.md`.

## Arquivos criados/alterados

- `apps/backend/src/modules/email-delivery-log/index.ts`
- `apps/backend/src/modules/email-delivery-log/models/email-delivery-log.ts`
- `apps/backend/src/modules/email-delivery-log/service.ts`
- `apps/backend/src/modules/email-delivery-log/types.ts`
- `apps/backend/src/modules/email-delivery-log/migrations/Migration20260701181000.ts`
- `apps/backend/src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts`
- `.planning/phases/08-transactional-email-resend/08-01-SUMMARY.md`

## Contrato do modelo

Modulo local criado: `email-delivery-log`

Tabela/modelo `email_delivery_log`:

- `id` com prefixo `emlog`
- `email_type = order_confirmation`
- `template_key = order_confirmation_v1`
- `template_version = 1`
- `provider = resend`
- `idempotency_key`
- `order_id`
- `cart_id`
- `payment_attempt_id`
- `checkout_completion_log_id`
- `analytics_event_log_id`
- `payment_intent_id`
- `status`
- `recipient_email_hash`
- `recipient_email_domain`
- `payload`
- `metadata`
- `provider_message_id`
- `attempt_count`
- `last_error_code`
- `last_error_message`
- `next_retry_at`
- `recorded_at`
- `queued_at`
- `sending_started_at`
- `sent_at`
- `failed_at`
- `dead_lettered_at`
- `created_at`
- `updated_at`
- `deleted_at`

Statuses locais implementados:

- `recorded`
- `queued`
- `sending`
- `sent`
- `failed`
- `dead_letter`

## Idempotency key

Helper puro criado:

```text
buildOrderConfirmationEmailIdempotencyKey({ order_id })
=> order-confirmation/{order_id}
```

## Payload/template permitido

Builder persistido `buildOrderConfirmationEmailPayload(...)` grava somente:

- `order_id`
- `order_reference`
- `amount`
- `currency_code`
- `item_count`
- `items[].sku`
- `items[].quantity`
- `items[].unit_price`
- `items[].subtotal`
- `support_email`

Campos de auditoria persistidos fora do payload:

- `recipient_email_hash`
- `recipient_email_domain`

## Payload proibido

O builder/metadata sanitizado rejeita persistencia de:

- segredo/chave/header de autenticacao
- e-mail completo do cliente
- nome completo
- telefone
- documento fiscal pessoal/juridico
- endereco de entrega/cobranca
- segredo/payload bruto Stripe
- QR/instrucoes Pix
- cookies/sessao/IP bruto
- token de tracking
- snapshot/payload Gelato
- referencia de pedido Gelato
- dados de refund/exchange

## Hash/domain do destinatario

Estrategia implementada:

- normalizacao para `trim + lowercase`
- hash `sha256` do destinatario normalizado
- persistencia somente de `recipient_email_hash`
- persistencia adicional de `recipient_email_domain`
- nenhum campo para e-mail completo no modelo

## Migration draft revisavel

Migration draft criada em:

- `apps/backend/src/modules/email-delivery-log/migrations/Migration20260701181000.ts`

Constraints/checks incluidos:

- check de `email_type`
- check de `template_key`
- check de `template_version = 1`
- check de `provider`
- check de `status`
- check de `attempt_count >= 0`

Indexes/uniques incluidos:

- unique logico `email_type + idempotency_key`
- unique logico `email_type + order_id`
- index `status + next_retry_at`
- index `order_id`
- index `analytics_event_log_id`
- index `payment_attempt_id`
- index `checkout_completion_log_id`
- index `payment_intent_id`

Observacao: migration permaneceu somente como draft revisavel e nao foi aplicada.

## Testes executados

Unit focado:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts
```

Prova negativa focada:

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|gelato_order_id|create.*Fulfillment|refund|Refund|ExchangeRequest|TrackingAccessToken|tracking_token|stripe listen|stripe trigger|Authorization|client_secret|copy_paste|hosted_instructions_url|federal_tax_id|cpf|cnpj|shipping_address|gelato_snapshot" -- src/modules/email-delivery-log; status=$?; test $status -eq 1'
```

Prova de nao alteracao do Order entrypoint:

```bash
bash -lc 'cd apps/backend && git diff -- src/workflows/order/webhook-order-entrypoint.ts --exit-code'
```

Prova de nao alteracao do Medusa config:

```bash
bash -lc 'cd apps/backend && git diff -- medusa-config.ts --exit-code'
```

Diff check:

```bash
git diff --check
```

## Resultado dos testes e greps

- Unit focado: PASS (16 testes / 1 suite) apos rerun com runtime Linux valido
- Prova negativa focada: PASS
- Prova negativa de e-mail literal completo no modulo: PASS
- `webhook-order-entrypoint.ts` inalterado: PASS
- `medusa-config.ts` inalterado: PASS
- `git diff --check`: PASS

## Post-review adjustment

- Causa do blocker: a sessao anterior persistia `last_error_code` e `last_error_message` apenas com `sanitizeString`, o que nao removia e-mail completo do destinatario; alem disso, o `npm` padrao do `PATH` apontava para runtime Windows e nao para Node Linux dentro do WSL.
- Correcao de sanitizacao: `sanitizeEmailDeliveryError(...)` passou a redigir e-mail completo, `Authorization/Bearer`, valores Stripe secret-shaped, Pix copy/QR-shaped, CPF/CNPJ-like e telefone-like; a mesma sanitizacao agora tambem e aplicada em `buildEmailDeliveryLogRecord(...)` para `last_error_code` e `last_error_message`.
- Diagnostico de runtime:
  - `type -a node npm` inicial mostrou `node` ausente e `npm` em `/mnt/c/Program Files/nodejs/npm`
  - runtime Linux valido encontrado em `/usr/local/lib/heroku/bin/node`
  - confirmacao Linux: `/usr/bin/env node -p "process.platform + ' ' + process.execPath"` => `linux /usr/local/lib/heroku/bin/node`
- Unit focado rerodado em ambiente Node/npm Linux valido: PASS
- Comando efetivo usado para o rerun:

```bash
cd apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules TMPDIR=/tmp TMP=/tmp TEMP=/tmp PATH="/usr/local/lib/heroku/bin:/home/jlima/Projetos/ecommerce/Backend/node_modules/.bin:$PATH" /usr/local/lib/heroku/bin/node /home/jlima/Projetos/ecommerce/Backend/node_modules/jest/bin/jest.js --silent --runInBand --forceExit --runTestsByPath src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts
```

- Resultado do unit focado: `PASS src/modules/email-delivery-log/__tests__/email-delivery-log.unit.spec.ts` com `16 passed, 16 total`
- Grep negativo focado: PASS
- Grep de e-mail literal completo no modulo: PASS
- `webhook-order-entrypoint.ts` inalterado: PASS
- `medusa-config.ts` inalterado: PASS
- `git diff --check`: PASS
- `08-02` nao foi iniciado.
- `08-03` nao foi iniciado.
- Resend real, PostHog real, Gelato, fulfillment, refund, exchange, tracking, Stripe CLI smoke e migration real nao foram executados.

## Confirmacoes de escopo

- `08-02` nao foi iniciado
- `08-03` nao foi iniciado
- `webhook-order-entrypoint.ts` nao foi alterado
- `medusa-config.ts` nao foi alterado
- `Order` flow nao foi tocado
- `resend` nao foi instalado
- `package.json` nao foi alterado
- lockfile nao foi alterado
- migration real nao foi aplicada
- `medusa db:migrate` nao foi executado
- Resend real nao foi chamado
- e-mail real nao foi enviado
- PostHog real nao foi chamado
- Gelato nao foi chamado
- fulfillment nao foi criado
- `gelato_order_id` nao foi persistido
- refund nao foi implementado
- exchange nao foi implementado
- tracking nao foi implementado
- Stripe CLI smoke nao foi executado
- Phase 09 nao foi iniciada

## Manual gate

Parando no manual gate apos `08-01-SUMMARY.md`.
