---
quick_id: 260625-i9n
slug: remover-canary-de-stripe-com-formato-rea
status: planned
created_at: "2026-06-25T16:09:10.752Z"
---

# Quick Task: Remover canary Stripe com formato real

## Objetivo

Desbloquear o push da branch `gsd/phase-01-foundation-observability` removendo dos testes de observabilidade o literal que o GitHub Push Protection classifica como chave Stripe.

## Plano

1. Trocar os canaries `sk_live_*` dos testes por valores montados em runtime.
2. Verificar que não sobra literal de falsa chave Stripe nos testes de observabilidade.
3. Rodar os testes de observabilidade afetados.
4. Reescrever o commit local bloqueado via fixup/autosquash para remover o falso segredo do histórico.
5. Fazer push da branch atual para `origin`.
