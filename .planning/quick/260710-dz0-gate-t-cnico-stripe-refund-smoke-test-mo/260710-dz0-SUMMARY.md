---
id: 260710-dz0
slug: gate-t-cnico-stripe-refund-smoke-test-mo
status: incomplete
completed: 2026-07-10
stop_reason: refund_schema_differs_and_refund_request_missing
key_files:
  created:
    - .planning/quick/260710-dz0-gate-t-cnico-stripe-refund-smoke-test-mo/260710-dz0-PLAN.md
    - .planning/quick/260710-dz0-gate-t-cnico-stripe-refund-smoke-test-mo/260710-dz0-SUMMARY.md
  modified:
    - .planning/STATE.md
---

# Gate técnico — Stripe refund smoke test mode

## Resultado

Gate interrompido corretamente antes de qualquer refund.

O schema real diverge da consulta inicial: `refund` é a tabela core Medusa
ligada por `payment_id`, enquanto a verdade financeira customizada do fluxo é
`refund_request`. Não há `refund_request` para o Order alvo, e o webhook
ignoraria um refund Stripe direto com `REFUND_WEBHOOK_REQUEST_NOT_FOUND`.

O plano foi ajustado para exigir primeiro a criação autenticada da reserva local
por `POST /admin/refunds/request` e somente depois o refund parcial de 100
centavos no Stripe test mode.

## Evidência do snapshot

- PaymentIntent test mode: succeeded, BRL, 9900.
- PaymentAttempt: confirmado por webhook, 9900 BRL, Order correlacionado.
- PaymentCollection: captured 9900, refunded 0.
- Order: confirmado/captured em metadata, não cancelado.
- Nenhum `refund_request`, refund Medusa ou webhook de refund.
- Um único `purchase_completed`.
- Nenhum `email_delivery_log` ou `gelato_fulfillment` para o Order.

## Lacunas expostas pelo gate

1. O handler atual não cria `refund_request`; isso precisa ocorrer antes pelo
   endpoint Admin.
2. O handler atual recalcula `Order.metadata.payment_status`, mas não grava a
   tabela core `refund` nem `payment_collection.refunded_amount`.
3. Não há fluxo de e-mail de refund; só é possível provar ausência de novo
   `email_delivery_log`, não um status refund-email `skipped/ignored`.

## Não-ações comprovadas

- Nenhum refund criado no Stripe.
- Nenhuma mutação no Supabase; somente `SELECT`.
- Nenhum webhook disparado.
- Nenhuma chamada Gelato, Resend ou PostHog.
- Nenhuma mudança de checkout, runtime, migration, config, pacote ou lockfile.
- Phase 12 não iniciada.

## Próximo gate

Aguardar aprovação explícita do plano ajustado e uma forma autenticada de criar
o `refund_request` pelo endpoint Admin. Depois, executar Stripe refund de 100
centavos e repetir o snapshot completo.
