---
quick_id: 260709-mkp
slug: gate-tecnico-corrigir-amount-do-purchase
status: complete
created_at: "2026-07-09T19:15:15.603Z"
scope: technical-gate
---

# Quick Task 260709-mkp: Gate tecnico - corrigir amount do purchase_completed analytics

## Objetivo

Garantir que o evento local `purchase_completed` seja gravado com `amount` valido depois da Order criada, usando `PaymentAttempt.amount` como fonte preferencial em menor unidade monetaria, sem bloquear nem mascarar a criacao da Order.

## Escopo

- Localizar a origem de `ANALYTICS_AMOUNT_INVALID`.
- Normalizar o `amount` do payload de analytics no entrypoint de Order a partir de `PaymentAttempt.amount`.
- Garantir `currency_code = brl` no payload de `purchase_completed`.
- Adicionar teste regressivo focado no fluxo Order criada + `PaymentAttempt.amount = 9900` + `purchase_completed.amount = 9900`.
- Validar com teste unitario focado e `git diff --check`.

## Fora de Escopo

- Phase 12.
- Refund smoke, Stripe refund ou uso de `sk_live`.
- Chamada real para Stripe, Supabase, Gelato, Correios, PostHog ou Resend.
- Nova migration sem aprovacao.
