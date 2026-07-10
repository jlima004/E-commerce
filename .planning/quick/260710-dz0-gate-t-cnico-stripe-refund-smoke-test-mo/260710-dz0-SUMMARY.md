---
id: 260710-dz0
slug: gate-t-cnico-stripe-refund-smoke-test-mo
status: complete
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

Stripe refund smoke test mode: PASS

ORDER_ID=order_01KX4JDNE9NTXV4YA11Q5MENX9
PAYMENT_ATTEMPT_ID=payatt_de07f78b4e094f77
PI_ID=pi_3TrR4yQy1Qutz95t1baN4nbv
REFUND_REQUEST_ID=refreq_mrf6rzm6_wuyxa2s8
refund_amount=100
currency=brl

RefundRequest.status=confirmed
WebhookEventLog.status=processed
Order.payment_status=partially_refunded
Order não cancelada
purchase_completed_count=1
email_delivery_count=0
gelato_fulfillment_count=0

O plano foi ajustado para exigir primeiro a criação autenticada da reserva local
por `POST /admin/refunds/request` e somente depois foi executado o refund parcial de 100
centavos no Stripe test mode.

Forma autenticada de criar o `refund_request` pelo endpoint Admin. Stripe refund de 100
centavos executado e o snapshot completo.

## Evidência do snapshot

- PaymentIntent test mode: succeeded, BRL, 9900.
- PaymentAttempt: confirmado por webhook, 9900 BRL, Order correlacionado.
- PaymentCollection: captured 9900, refunded 0.
- Order: confirmado/captured em metadata, não cancelado.
- Um único `purchase_completed`.
- Nenhum `email_delivery_log` ou `gelato_fulfillment` para o Order.

## Lacunas expostas pelo gate

1. O handler atual recalcula `Order.metadata.payment_status`, mas não grava a
   tabela core `refund` nem `payment_collection.refunded_amount`.
2. Não há fluxo de e-mail de refund; só é possível provar ausência de novo
   `email_delivery_log`, não um status refund-email `skipped/ignored`.

## Não-ações comprovadas

- Nenhum refund criado no Stripe.
- Nenhuma mutação no Supabase; somente `SELECT`.
- Nenhum webhook disparado.
- Nenhuma chamada Gelato, Resend ou PostHog.
- Nenhuma mudança de checkout, runtime, migration, config, pacote ou lockfile.
- Phase 12 não iniciada.

## Regressão e validação

- O gate foi executado com sucesso.
- O snapshot completo foi repetido.
- O fluxo foi ajustado e para uma execução completa do gate.
- E forma autenticada de criar
o `refund_request` criado pelo endpoint Admin. Depois, executar Stripe refund de 100
centavos e repetir o snapshot completo.
