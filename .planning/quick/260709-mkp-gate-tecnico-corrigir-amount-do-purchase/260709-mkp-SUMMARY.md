---
quick_id: 260709-mkp
slug: gate-tecnico-corrigir-amount-do-purchase
status: complete
completed_at: "2026-07-09T16:22:00-03:00"
---

# Quick Task 260709-mkp: Gate tecnico - corrigir amount do purchase_completed analytics

## Resultado

Corrigido o payload local de analytics para que `purchase_completed.amount` seja derivado de `PaymentAttempt.amount`, normalizado para inteiro positivo em menor unidade monetaria antes da chamada ao builder do `AnalyticsEventLog`.

## Mudancas

- `AnalyticsEventLog` agora aceita `amount` de entrada como `number`, `string` ou `bigint`, persistindo o payload canonico como `number`.
- O entrypoint de Order normaliza explicitamente `PaymentAttempt.amount` e força `currency_code = brl` para o payload local de `purchase_completed`.
- Adicionado teste regressivo para Order criada com `PaymentAttempt.amount` vindo em formato runtime numerico e `purchase_completed.amount = 9900`.
- Adicionado teste de contrato do builder cobrindo `number`, `string` e `bigint`.

## Validacao

- PASS: `env TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/analytics-event-log/__tests__/analytics-event-log.unit.spec.ts src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts` — 25 testes.
- PASS: `env TMPDIR=/tmp HOME=/tmp XDG_CONFIG_HOME=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend`.
- PASS: `git diff --check`.

## Nao Feito

- Nenhuma Phase 12.
- Nenhum refund smoke, Stripe refund, `sk_live`, deploy, migration nova, ou chamada real para Stripe, Supabase, Gelato, Correios, PostHog ou Resend.
